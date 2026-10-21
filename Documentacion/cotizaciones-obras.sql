-- =====================================================================
-- Control Ferretería — Cotización Obras: 3 cotizaciones → solicitud especial
-- =====================================================================
--
-- Para productos que NO están en el catálogo del contrato, solo para la
-- Dirección de Obras (las demás direcciones siguen como estaban):
--
--   1. Un usuario de Obras (o el ITO) prepara una SOLICITUD DE COTIZACIÓN con
--      los productos (producto, cantidad, unidad)            -> 'borrador'
--   2. El ITO la EMITE (PDF con su firma; queda la fecha de envío) -> 'emitida'
--   3. Se registran a mano las 3 cotizaciones, con el precio de cada producto:
--        1 = proveedor del contrato (Importadora Hevia)
--        2 y 3 = cotizaciones externas (ferretería local o cadena)
--   4. Con las 3 registradas se crea la SOLICITUD ESPECIAL, que sigue el mismo
--      recorrido que una solicitud de Obras (V°B° del ITO, Director, hoja a
--      Hevia, guías y factura, que se descuenta del convenio).
--                                                              -> 'solicitud_creada'
--
-- Este script crea las tablas, los permisos (RLS) y las reglas de orden.
-- Requiere haber corrido antes flujo-solicitante-obras.sql (rol
-- solicitante_obras, estado 'visada').
--
-- Es idempotente. Correr UNA vez en el SQL Editor de Supabase.
-- (Si Supabase pregunta por RLS, las tablas ya la traen activada en este
--  script: elige "Run and enable RLS" o "Run without RLS", da lo mismo.)
-- =====================================================================

begin;

-- Apoyo (por si no estaban de scripts anteriores) -----------------------
create or replace function public.unidad_del_usuario()
returns uuid language sql stable security definer set search_path = public
as $$ select unidad_id from public.perfiles where id = auth.uid() $$;

create table if not exists correlativo_contador (
  clave  text primary key,
  ultimo integer not null default 0
);
alter table correlativo_contador enable row level security;

-- Tablas ---------------------------------------------------------------
create table if not exists proceso_cotizacion (
  id            uuid primary key default gen_random_uuid(),
  correlativo   text,                                   -- CT-2026-001
  estado        text not null default 'borrador'
                check (estado in ('borrador','emitida','solicitud_creada')),
  unidad_id     uuid not null references unidad(id),    -- dirección responsable
  unidad_interna text,                                  -- Operaciones / Aseo y Ornato / Edificios
  solicitante   text not null,
  ubicacion     text,                                   -- dónde se usarán los materiales
  motivo        text,
  lugar_entrega text not null default 'Avenida Estación 344, Doñihue',
  items         jsonb not null default '[]'::jsonb,     -- [{id, producto, cantidad, unidad}]
  fecha_envio   date,                                   -- la pone el sistema al emitir
  emitida_por   uuid references perfiles(id),
  creado_por    uuid references perfiles(id) default auth.uid(),
  creado_en     timestamptz not null default now()
);

create table if not exists proceso_cotizacion_oferta (
  id          uuid primary key default gen_random_uuid(),
  proceso_id  uuid not null references proceso_cotizacion(id) on delete cascade,
  slot        smallint not null check (slot in (1, 2, 3)),  -- 1 = contrato, 2 y 3 = externas
  proveedor   text not null,
  numero      text,                                     -- N° de la cotización del proveedor
  fecha       date,
  precios     jsonb not null default '{}'::jsonb,       -- { "<id del producto>": precio unitario neto }
  archivo_url text,
  creado_por  uuid references perfiles(id) default auth.uid(),
  creado_en   timestamptz not null default now(),
  unique (proceso_id, slot)
);

alter table solicitud add column if not exists proceso_cotizacion_id uuid references proceso_cotizacion(id);
create index if not exists solicitud_proceso_idx on solicitud(proceso_cotizacion_id);

-- Correlativo CT-AAAA-NNN ---------------------------------------------
create or replace function public.fn_correlativo_proceso()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_anio integer := extract(year from coalesce(new.creado_en, now()))::int;
  v_n    integer;
begin
  if new.correlativo is null or btrim(new.correlativo) = '' then
    insert into correlativo_contador(clave, ultimo) values ('CT-' || v_anio, 1)
    on conflict (clave) do update set ultimo = correlativo_contador.ultimo + 1
    returning ultimo into v_n;
    new.correlativo := 'CT-' || v_anio || '-' || lpad(v_n::text, 3, '0');
  end if;
  return new;
end $$;

drop trigger if exists trg_correlativo_proceso on proceso_cotizacion;
create trigger trg_correlativo_proceso
  before insert on proceso_cotizacion
  for each row execute function public.fn_correlativo_proceso();

-- Reglas de orden (valen para todos, incluso por API) ----------------------
create or replace function public.fn_validar_proceso()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text := public.rol_actual();
begin
  if new.estado is distinct from old.estado then
    if new.estado = 'emitida' then
      if old.estado <> 'borrador' or v_rol not in ('admin', 'admin_ito') then
        raise exception 'Solo el ITO puede emitir la solicitud de cotización.';
      end if;
      new.fecha_envio := coalesce(new.fecha_envio, current_date);
      new.emitida_por := auth.uid();
    elsif new.estado = 'solicitud_creada' then
      if old.estado <> 'emitida'
         or (select count(*) from proceso_cotizacion_oferta where proceso_id = new.id) < 3 then
        raise exception 'Se necesitan las 3 cotizaciones registradas para crear la solicitud.';
      end if;
    else
      raise exception 'Cambio de estado no permitido.';
    end if;
  end if;
  if old.estado <> 'borrador' and new.items is distinct from old.items then
    raise exception 'Una solicitud de cotización ya emitida no puede cambiar sus productos.';
  end if;
  return new;
end $$;

drop trigger if exists trg_validar_proceso on proceso_cotizacion;
create trigger trg_validar_proceso
  before update on proceso_cotizacion
  for each row execute function public.fn_validar_proceso();

-- Permisos (RLS) -------------------------------------------------------
alter table proceso_cotizacion enable row level security;
alter table proceso_cotizacion_oferta enable row level security;

drop policy if exists "proceso ve" on proceso_cotizacion;
create policy "proceso ve" on proceso_cotizacion for select using (
  public.rol_actual() in ('admin', 'admin_ito', 'lector_operativo', 'lector_pagos')
  or (public.rol_actual() = 'solicitante_obras' and unidad_id = public.unidad_del_usuario())
);

drop policy if exists "proceso crea" on proceso_cotizacion;
create policy "proceso crea" on proceso_cotizacion for insert with check (
  estado = 'borrador' and (
    public.rol_actual() in ('admin', 'admin_ito')
    or (public.rol_actual() = 'solicitante_obras' and unidad_id = public.unidad_del_usuario())
  )
);

drop policy if exists "proceso edita" on proceso_cotizacion;
create policy "proceso edita" on proceso_cotizacion for update
  using (
    public.rol_actual() in ('admin', 'admin_ito')
    or (public.rol_actual() = 'solicitante_obras' and unidad_id = public.unidad_del_usuario())
  )
  with check (
    public.rol_actual() in ('admin', 'admin_ito')
    or (public.rol_actual() = 'solicitante_obras' and unidad_id = public.unidad_del_usuario())
  );

drop policy if exists "oferta ve" on proceso_cotizacion_oferta;
create policy "oferta ve" on proceso_cotizacion_oferta for select using (
  public.rol_actual() in ('admin', 'admin_ito', 'lector_operativo', 'lector_pagos', 'solicitante_obras')
  and exists (select 1 from proceso_cotizacion p where p.id = proceso_id)
);

drop policy if exists "oferta registra" on proceso_cotizacion_oferta;
create policy "oferta registra" on proceso_cotizacion_oferta for insert with check (
  public.rol_actual() in ('admin', 'admin_ito', 'solicitante_obras')
  and exists (select 1 from proceso_cotizacion p where p.id = proceso_id and p.estado = 'emitida')
);

drop policy if exists "oferta corrige" on proceso_cotizacion_oferta;
create policy "oferta corrige" on proceso_cotizacion_oferta for update
  using (
    public.rol_actual() in ('admin', 'admin_ito', 'solicitante_obras')
    and exists (select 1 from proceso_cotizacion p where p.id = proceso_id and p.estado = 'emitida')
  )
  with check (
    public.rol_actual() in ('admin', 'admin_ito', 'solicitante_obras')
    and exists (select 1 from proceso_cotizacion p where p.id = proceso_id and p.estado = 'emitida')
  );

-- Los usuarios de Obras adjuntan el PDF de cada cotización (bucket "memos").
drop policy if exists "memos obras sube" on storage.objects;
create policy "memos obras sube" on storage.objects for insert
  with check (bucket_id = 'memos' and public.rol_actual() = 'solicitante_obras');

commit;

-- =====================================================================
-- PRUEBA
--   1. Como usuario de Obras: menú "Cotización Obras" > Nueva > agrega
--      productos > Guardar. Queda "por emitir" con número CT-AAAA-NNN.
--   2. Como ITO: abre esa cotización > Emitir y descargar PDF (queda la fecha
--      de envío y el PDF sale con su firma).
--   3. Registra las 3 cotizaciones con el precio de cada producto > "Crear
--      solicitud especial".
-- =====================================================================
