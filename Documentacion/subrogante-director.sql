-- =====================================================================
-- Control Ferretería — Director de Obras subrogante
-- =====================================================================
--
-- Cuando el Director sale (vacaciones, comisión, etc.) otra persona lo
-- subroga: aprueba solicitudes y decide cotizaciones, y lo que firma sale
-- como "Director de Obras Municipales (S)".
--
--   * La persona subrogante tiene el rol propio 'subrogante_director'.
--     SIN la subrogancia activa no puede aprobar nada (solo ve su Inicio).
--   * El Director (o el Administrador) ACTIVA la subrogancia, con una fecha
--     de término opcional, y la DESACTIVA cuando vuelve. La subrogante no
--     puede activarla ni desactivarla ella misma.
--   * Mientras está vigente, rol_actual() la trata como 'lector_operativo'
--     (Director): todas las reglas de la base (RLS, triggers, funciones) ya
--     lo respetan, sin tocarlas una por una.
--   * Todo lo que apruebe queda marcado (aprobado_subrogante /
--     decidido_subrogante) para que los PDF lleven su firma y el "(S)".
--
-- Después de correrlo: en la app, Usuarios -> asigna el rol "Director de
-- Obras (S)" a la persona, y en Convenio / ferretería carga su firma.
-- Es idempotente. Correr UNA vez en el SQL Editor de Supabase.
-- =====================================================================

begin;

-- 1) Rol nuevo ----------------------------------------------------------------
alter table perfiles drop constraint if exists perfiles_rol_check;
alter table perfiles add constraint perfiles_rol_check
  check (rol in ('admin','admin_ito','solicitante','solicitante_obras',
                 'lector_operativo','lector_pagos','lector_ejecutivo','pendiente',
                 'subrogante_director'));

-- 2) Estado de la subrogancia (una sola fila) y su historial -----------------------
create table if not exists subrogancia (
  id            boolean primary key default true check (id),
  activa        boolean not null default false,
  subrogante_id uuid references perfiles(id),
  desde         timestamptz,
  hasta         date,
  activado_por  uuid references perfiles(id),
  actualizado_en timestamptz not null default now()
);
insert into subrogancia (id) values (true) on conflict (id) do nothing;

create table if not exists subrogancia_historial (
  id            bigint generated always as identity primary key,
  accion        text not null check (accion in ('activar', 'desactivar')),
  subrogante_id uuid references perfiles(id),
  hasta         date,
  hecho_por     uuid references perfiles(id),
  hecho_en      timestamptz not null default now()
);

-- Nadie lee ni escribe estas tablas directo: solo las funciones de abajo.
alter table subrogancia enable row level security;
alter table subrogancia_historial enable row level security;
revoke all on subrogancia, subrogancia_historial from anon, authenticated;

-- 3) Funciones de apoyo ------------------------------------------------------------
create or replace function public._subrogancia_vigente(p_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from subrogancia s
                 where s.activa and s.subrogante_id = p_uid
                   and (s.hasta is null or s.hasta >= current_date))
$$;

-- ¿Quien actúa es la persona subrogante (tenga o no la subrogancia activa)?
create or replace function public.es_subrogante_actual()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from perfiles where id = auth.uid() and rol = 'subrogante_director')
$$;

-- Para la app: ¿la subrogancia de quien consulta está vigente?
create or replace function public.subrogancia_activa()
returns boolean language sql stable security definer set search_path = public as $$
  select public._subrogancia_vigente(auth.uid())
$$;

-- EL PUNTO CLAVE: con la subrogancia vigente, la subrogante es Director.
create or replace function public.rol_actual()
returns text language sql stable security definer set search_path = public as $$
  select case when p.rol = 'subrogante_director' and public._subrogancia_vigente(p.id)
              then 'lector_operativo' else p.rol end
  from public.perfiles p where p.id = auth.uid()
$$;

-- 4) Activar / desactivar / consultar (Director o Administrador) -----------------------
create or replace function public.subrogancia_estado()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare s subrogancia%rowtype;
begin
  if public.rol_actual() not in ('admin', 'lector_operativo') or public.es_subrogante_actual() then
    raise exception 'Solo el Director de Obras o el Administrador administran la subrogancia.';
  end if;
  select * into s from subrogancia where id;
  return jsonb_build_object(
    'activa', s.activa,
    'vigente', s.activa and (s.hasta is null or s.hasta >= current_date),
    'subrogante_id', s.subrogante_id,
    'subrogante_nombre', (select nombre from perfiles where id = s.subrogante_id),
    'desde', s.desde, 'hasta', s.hasta,
    'candidatos', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'nombre', nombre) order by nombre)
                            from perfiles where rol = 'subrogante_director'), '[]'::jsonb),
    'historial', coalesce((select jsonb_agg(jsonb_build_object(
                              'accion', h.accion, 'hecho_en', h.hecho_en, 'hasta', h.hasta,
                              'subrogante', (select nombre from perfiles where id = h.subrogante_id),
                              'por', (select nombre from perfiles where id = h.hecho_por)) order by h.hecho_en desc)
                           from (select * from subrogancia_historial order by hecho_en desc limit 10) h), '[]'::jsonb));
end $$;

create or replace function public.activar_subrogancia(p_subrogante uuid, p_hasta date default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.rol_actual() not in ('admin', 'lector_operativo') or public.es_subrogante_actual() then
    raise exception 'Solo el Director de Obras o el Administrador pueden activar la subrogancia.';
  end if;
  if not exists (select 1 from perfiles where id = p_subrogante and rol = 'subrogante_director') then
    raise exception 'Esa persona no tiene el rol de Director de Obras (S): asígnalo primero en Usuarios.';
  end if;
  if p_hasta is not null and p_hasta < current_date then
    raise exception 'La fecha de término no puede ser anterior a hoy.';
  end if;
  update subrogancia
     set activa = true, subrogante_id = p_subrogante, desde = now(), hasta = p_hasta,
         activado_por = auth.uid(), actualizado_en = now()
   where id;
  insert into subrogancia_historial (accion, subrogante_id, hasta, hecho_por)
  values ('activar', p_subrogante, p_hasta, auth.uid());
end $$;

create or replace function public.desactivar_subrogancia()
returns void language plpgsql security definer set search_path = public as $$
declare v_sub uuid;
begin
  if public.rol_actual() not in ('admin', 'lector_operativo') or public.es_subrogante_actual() then
    raise exception 'Solo el Director de Obras o el Administrador pueden desactivar la subrogancia.';
  end if;
  select subrogante_id into v_sub from subrogancia where id;
  update subrogancia set activa = false, actualizado_en = now() where id;
  insert into subrogancia_historial (accion, subrogante_id, hecho_por) values ('desactivar', v_sub, auth.uid());
end $$;

revoke all on function public.subrogancia_estado(), public.activar_subrogancia(uuid, date),
  public.desactivar_subrogancia(), public.subrogancia_activa(), public.es_subrogante_actual(),
  public._subrogancia_vigente(uuid) from public, anon;
grant execute on function public.subrogancia_estado(), public.activar_subrogancia(uuid, date),
  public.desactivar_subrogancia(), public.subrogancia_activa(), public.es_subrogante_actual()
  to authenticated;

-- 5) Lo aprobado por la subrogante queda marcado (para la firma y el "(S)") -----------
alter table solicitud add column if not exists aprobado_subrogante boolean not null default false;
alter table proceso_cotizacion add column if not exists decidido_subrogante boolean not null default false;

create or replace function public.fn_marcar_subrogante_solicitud()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado = 'aprobada' and (tg_op = 'INSERT' or old.estado is distinct from 'aprobada') then
    new.aprobado_subrogante := public.es_subrogante_actual();
  end if;
  return new;
end $$;

drop trigger if exists trg_marcar_subrogante on solicitud;
create trigger trg_marcar_subrogante
  before insert or update on solicitud
  for each row execute function public.fn_marcar_subrogante_solicitud();

create or replace function public.fn_marcar_subrogante_proceso()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.estado in ('solicitud_creada', 'rechazada') and old.estado is distinct from new.estado then
    new.decidido_subrogante := public.es_subrogante_actual();
  end if;
  return new;
end $$;

drop trigger if exists trg_marcar_subrogante_proceso on proceso_cotizacion;
create trigger trg_marcar_subrogante_proceso
  before update on proceso_cotizacion
  for each row execute function public.fn_marcar_subrogante_proceso();

commit;

-- =====================================================================
-- PRUEBA
--   1. Usuarios: asigna a Matías el rol "Director de Obras (S)".
--   2. Entra como Matías: solo ve Inicio, con el aviso "subrogancia no activa".
--   3. Entra como Director (o Administrador): menú Subrogancia > elige a Matías
--      > Activar. En un minuto Matías ve el menú del Director.
--   4. Matías aprueba una solicitud: la hoja de solicitud sale con su firma y
--      "Director de Obras Municipales (S)".
--   5. Al volver el Director: Subrogancia > Desactivar.
-- =====================================================================
