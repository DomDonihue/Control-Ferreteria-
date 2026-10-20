-- =====================================================================
-- Control Ferretería — Solicitante de Dirección de Obras + V°B° del ITO
-- =====================================================================
--
-- Flujo de las solicitudes de la Dirección de Obras (tipo 'operaciones',
-- formulario "Solicitudes Encargado"):
--
--   usuario de Obras (rol solicitante_obras) crea        -> pendiente
--   ITO revisa y da su V°B°                              -> visada
--   Director de Obras aprueba                            -> aprobada
--   (de ahí en adelante igual que el resto: enviada, recibida, facturada...)
--
-- Si la crea el propio Encargado (ITO) entra directo como 'visada'.
-- Las solicitudes de las demás direcciones NO cambian: pendiente -> Director.
--
-- Este script:
--   1. Agrega el rol 'solicitante_obras' a perfiles.
--   2. Agrega el estado 'visada' y el tipo 'operaciones' a solicitud, y las
--      columnas visado_por / visado_en.
--   3. Políticas (RLS) para que el solicitante_obras cree y vea SOLO las de
--      su propia dirección, y para que el ITO pueda visar/rechazar.
--   4. Un trigger que obliga el orden: una solicitud de Obras no puede
--      aprobarse sin el V°B° del ITO, ni visarse por quien no es ITO.
--
-- Es idempotente. Correr UNA vez en el SQL Editor de Supabase.
-- Después: en Usuarios, asignar a cada persona de Obras el rol
-- "Solicitante Dirección de Obras" y la unidad "Dirección de Obras".
-- =====================================================================

begin;

-- 1. Rol nuevo ---------------------------------------------------------
alter table perfiles drop constraint if exists perfiles_rol_check;
alter table perfiles add constraint perfiles_rol_check
  check (rol in ('admin','admin_ito','solicitante','solicitante_obras',
                 'lector_operativo','lector_pagos','lector_ejecutivo','pendiente'));

-- 2. Estado, tipo y columnas del visado ---------------------------------
alter table solicitud drop constraint if exists solicitud_estado_check;
alter table solicitud add constraint solicitud_estado_check
  check (estado in ('pendiente','visada','aprobada','rechazada','enviada',
                    'recibida','facturada','cerrada'));

alter table solicitud drop constraint if exists solicitud_tipo_check;
alter table solicitud add constraint solicitud_tipo_check
  check (tipo in ('normal','especial','operaciones'));

alter table solicitud add column if not exists visado_por uuid references perfiles(id);
alter table solicitud add column if not exists visado_en  timestamptz;

-- 3. Políticas del solicitante_obras ------------------------------------
create or replace function public.unidad_del_usuario()
returns uuid language sql stable security definer set search_path = public
as $$ select unidad_id from public.perfiles where id = auth.uid() $$;

drop policy if exists "obras crea solicitud" on solicitud;
create policy "obras crea solicitud" on solicitud for insert
  with check (
    public.rol_actual() = 'solicitante_obras'
    and tipo = 'operaciones'
    and estado = 'pendiente'
    and unidad_id = public.unidad_del_usuario()
  );

drop policy if exists "obras ve sus solicitudes" on solicitud;
create policy "obras ve sus solicitudes" on solicitud for select
  using (public.rol_actual() = 'solicitante_obras' and unidad_id = public.unidad_del_usuario());

drop policy if exists "obras crea detalle" on solicitud_detalle;
create policy "obras crea detalle" on solicitud_detalle for insert
  with check (
    public.rol_actual() = 'solicitante_obras'
    and exists (select 1 from solicitud s
                where s.id = solicitud_id
                  and s.unidad_id = public.unidad_del_usuario()
                  and s.estado = 'pendiente')
  );

drop policy if exists "obras ve detalle" on solicitud_detalle;
create policy "obras ve detalle" on solicitud_detalle for select
  using (
    public.rol_actual() = 'solicitante_obras'
    and exists (select 1 from solicitud s
                where s.id = solicitud_id and s.unidad_id = public.unidad_del_usuario())
  );

-- El ITO revisa las pendientes de Obras: las visa o las rechaza.
drop policy if exists "ito visa solicitud" on solicitud;
create policy "ito visa solicitud" on solicitud for update
  using (public.rol_actual() = 'admin_ito' and tipo = 'operaciones' and estado = 'pendiente')
  with check (public.rol_actual() = 'admin_ito' and estado in ('visada','rechazada'));

-- 4. Orden del flujo (vale para todos, incluso por API) ------------------
create or replace function public.fn_validar_flujo_operaciones()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text := public.rol_actual();
begin
  if new.tipo = 'operaciones' and new.estado is distinct from old.estado then
    if new.estado = 'visada'
       and not (old.estado = 'pendiente' and v_rol in ('admin','admin_ito')) then
      raise exception 'Solo el ITO puede dar el V°B° a una solicitud pendiente.';
    end if;
    if new.estado = 'aprobada' and old.estado in ('pendiente','visada')
       and not (old.estado = 'visada' and v_rol in ('admin','lector_operativo')) then
      raise exception 'La solicitud de Obras necesita el V°B° del ITO antes de la aprobación del Director.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_validar_flujo_operaciones on solicitud;
create trigger trg_validar_flujo_operaciones
  before update on solicitud
  for each row execute function public.fn_validar_flujo_operaciones();

commit;

-- =====================================================================
-- PRUEBA
--   1. Con un usuario solicitante_obras: "Solicitudes Encargado" -> ingresar
--      una solicitud. Debe quedar 'pendiente' con la dirección fija.
--   2. Como ITO: en "Solicitudes" aparece con "Dar V°B°" -> pasa a 'visada'.
--   3. Como Director: aparece con "Aprobar" solo cuando está 'visada'.
-- =====================================================================
