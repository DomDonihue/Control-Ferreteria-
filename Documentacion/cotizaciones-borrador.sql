-- =====================================================================
-- Control Ferretería — Cotización Obras: borrador privado + Hevia solo el ITO
-- =====================================================================
--
-- 1. BORRADOR PRIVADO. Una solicitud de cotización nace en 'preparacion':
--    solo la ve quien la creó (y el Administrador), no avisa al ITO y se puede
--    guardar incompleta (aunque tenga una sola cotización) y retomar después.
--    Cuando está lista, "Enviar al ITO" la pasa a 'borrador' (por emitir). Para
--    enviarla hacen falta productos y las 2 cotizaciones externas registradas.
--
--      preparacion --enviar--> borrador --emitir (ITO)--> emitida --> solicitud_creada
--
--    Los productos se pueden cambiar en 'preparacion' y en 'borrador'.
--
-- 2. LA COTIZACIÓN DEL PROVEEDOR DEL CONTRATO (Hevia, slot 1) solo la registra
--    el ITO (o el Administrador). Quien hace la solicitud sube las externas.
--
-- Las solicitudes que ya existen no cambian de estado.
-- Requiere haber corrido antes cotizaciones-obras.sql.
-- Es idempotente. Correr UNA vez en el SQL Editor de Supabase, y publicar la
-- versión nueva de la app enseguida (la anterior no sabe del borrador).
-- =====================================================================

begin;

-- 1) Estado nuevo ----------------------------------------------------------
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.proceso_cotizacion'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) ilike '%solicitud_creada%'
  loop
    execute format('alter table public.proceso_cotizacion drop constraint %I', c.conname);
  end loop;
end $$;

alter table proceso_cotizacion add constraint proceso_cotizacion_estado_check
  check (estado in ('preparacion','borrador','emitida','solicitud_creada'));
alter table proceso_cotizacion alter column estado set default 'preparacion';

-- 2) Reglas de orden (valen para todos, incluso por API) -------------------
create or replace function public.fn_validar_proceso()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text := public.rol_actual();
begin
  if new.estado is distinct from old.estado then
    if new.estado = 'borrador' then
      -- Enviar al ITO: solo desde el borrador privado, con productos y las 2 externas.
      if old.estado <> 'preparacion' or v_rol not in ('admin', 'admin_ito', 'solicitante_obras') then
        raise exception 'Cambio de estado no permitido.';
      end if;
      if jsonb_array_length(new.items) = 0 then
        raise exception 'Agrega al menos un producto antes de enviar al ITO.';
      end if;
      if (select count(*) from proceso_cotizacion_oferta where proceso_id = new.id and slot in (2, 3)) < 2 then
        raise exception 'Faltan las 2 cotizaciones externas para enviar al ITO.';
      end if;
    elsif new.estado = 'emitida' then
      if old.estado <> 'borrador' or v_rol not in ('admin', 'admin_ito') then
        raise exception 'Solo el ITO puede emitir la solicitud de cotización.';
      end if;
      if (select count(*) from proceso_cotizacion_oferta where proceso_id = new.id and slot in (2, 3)) < 2 then
        raise exception 'Faltan las 2 cotizaciones externas para poder emitir.';
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
  if old.estado not in ('preparacion', 'borrador') and new.items is distinct from old.items then
    raise exception 'Una solicitud de cotización ya emitida no puede cambiar sus productos.';
  end if;
  return new;
end $$;

drop trigger if exists trg_validar_proceso on proceso_cotizacion;
create trigger trg_validar_proceso
  before update on proceso_cotizacion
  for each row execute function public.fn_validar_proceso();

-- 3) Permisos (RLS) --------------------------------------------------------
-- Ver: el borrador privado solo lo ve quien lo creó (y el Administrador).
drop policy if exists "proceso ve" on proceso_cotizacion;
create policy "proceso ve" on proceso_cotizacion for select using (
  case when estado = 'preparacion'
       then (creado_por = auth.uid() or public.rol_actual() = 'admin')
       else (public.rol_actual() in ('admin', 'admin_ito', 'lector_operativo', 'lector_pagos')
             or (public.rol_actual() = 'solicitante_obras' and unidad_id = public.unidad_del_usuario()))
  end
);

-- Crear: siempre como borrador privado.
drop policy if exists "proceso crea" on proceso_cotizacion;
create policy "proceso crea" on proceso_cotizacion for insert with check (
  estado = 'preparacion' and (
    public.rol_actual() in ('admin', 'admin_ito')
    or (public.rol_actual() = 'solicitante_obras' and unidad_id = public.unidad_del_usuario())
  )
);

-- Editar: el borrador privado, solo su autor; lo demás como antes.
drop policy if exists "proceso edita" on proceso_cotizacion;
create policy "proceso edita" on proceso_cotizacion for update
  using (
    case when estado = 'preparacion'
         then (creado_por = auth.uid() or public.rol_actual() = 'admin')
         else (public.rol_actual() in ('admin', 'admin_ito')
               or (public.rol_actual() = 'solicitante_obras' and unidad_id = public.unidad_del_usuario()))
    end
  )
  with check (
    public.rol_actual() in ('admin', 'admin_ito')
    or (public.rol_actual() = 'solicitante_obras' and unidad_id = public.unidad_del_usuario())
  );

-- Cotizaciones: se registran en borrador privado, enviada y emitida; la del
-- proveedor del contrato (slot 1) solo la sube el ITO.
drop policy if exists "oferta registra" on proceso_cotizacion_oferta;
create policy "oferta registra" on proceso_cotizacion_oferta for insert with check (
  public.rol_actual() in ('admin', 'admin_ito', 'solicitante_obras')
  and (slot <> 1 or public.rol_actual() in ('admin', 'admin_ito'))
  and exists (select 1 from proceso_cotizacion p where p.id = proceso_id and p.estado in ('preparacion', 'borrador', 'emitida'))
);

drop policy if exists "oferta corrige" on proceso_cotizacion_oferta;
create policy "oferta corrige" on proceso_cotizacion_oferta for update
  using (
    public.rol_actual() in ('admin', 'admin_ito', 'solicitante_obras')
    and (slot <> 1 or public.rol_actual() in ('admin', 'admin_ito'))
    and exists (select 1 from proceso_cotizacion p where p.id = proceso_id and p.estado in ('preparacion', 'borrador', 'emitida'))
  )
  with check (
    public.rol_actual() in ('admin', 'admin_ito', 'solicitante_obras')
    and (slot <> 1 or public.rol_actual() in ('admin', 'admin_ito'))
    and exists (select 1 from proceso_cotizacion p where p.id = proceso_id and p.estado in ('preparacion', 'borrador', 'emitida'))
  );

commit;

-- =====================================================================
-- PRUEBA
--   1. Como usuario de Obras: Cotización Obras > Nueva > agrega productos y UNA
--      cotización externa > "Guardar borrador". Queda "en preparación"; el ITO
--      no la ve ni recibe aviso.
--   2. Ábrela de nuevo, agrega la segunda externa y pulsa "Enviar al ITO".
--   3. Como ITO: la ve "por emitir"; emite el PDF; sube la cotización de Hevia.
-- =====================================================================
