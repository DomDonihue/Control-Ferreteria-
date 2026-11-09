-- =====================================================================
-- Control Ferretería — Devolver una solicitud para corregirla
-- =====================================================================
--
-- Solicitudes de la Dirección de Obras (tipo 'operaciones'), ANTES de que el
-- Director las apruebe. Al devolver, la solicitud vuelve a la PERSONA ANTERIOR
-- del recorrido (estado 'devuelta' + columna devuelta_a):
--
--   Director (visada)  --devolver-->  vuelve al ITO          (devuelta_a = 'ito')
--   ITO (pendiente o visada) --devolver-->  vuelve a quien la hizo
--                                                           (devuelta_a = 'solicitante')
--
--   Quien la recibe la corrige (cantidades, productos, datos) y la reenvía:
--     usuario de Obras  -> vuelve a 'pendiente' (el ITO la revisa de nuevo)
--     ITO / Admin       -> queda 'visada' (pasa al Director; no se revisa a sí mismo)
--   El ITO que recibió una devolución del Director también puede, en vez de
--   corregirla él, devolverla al solicitante (con su propio motivo).
--
-- No se pueden devolver las ya aprobadas, ni las que nacen de una cotización
-- de Obras (sus productos y precios vienen de las 3 cotizaciones).
--
-- Todo se hace con dos funciones (devolver_solicitud y reenviar_solicitud)
-- que validan rol, estado y pertenencia, y cambian los productos y el estado
-- en una sola transacción. No se abre ninguna política nueva de escritura.
--
-- Es idempotente: se puede volver a correr (si ya habías corrido la versión
-- anterior, correr esta la actualiza). Correr en el SQL Editor de Supabase.
-- Requiere haber corrido antes: flujo-solicitante-obras.sql, motivo-rechazo.sql
-- y bitacora-solicitudes.sql.
-- =====================================================================

begin;

-- 1) Estado y columnas ---------------------------------------------------
alter table solicitud drop constraint if exists solicitud_estado_check;
alter table solicitud add constraint solicitud_estado_check
  check (estado in ('pendiente','visada','devuelta','aprobada','rechazada',
                    'enviada','recibida','facturada','cerrada'));

alter table solicitud add column if not exists motivo_devolucion text;
alter table solicitud add column if not exists devuelto_por uuid references perfiles(id);
alter table solicitud add column if not exists devuelto_en  timestamptz;
alter table solicitud add column if not exists devuelta_a   text;

alter table solicitud drop constraint if exists solicitud_devuelta_a_check;
alter table solicitud add constraint solicitud_devuelta_a_check
  check (devuelta_a is null or devuelta_a in ('ito','solicitante'));

-- 2) Orden del flujo (vale para todos, incluso por API) -------------------
create or replace function public.fn_validar_flujo_operaciones()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_rol text := public.rol_actual();
begin
  if new.tipo = 'operaciones' and new.estado is distinct from old.estado then

    if new.estado = 'visada'
       and not (old.estado in ('pendiente','devuelta') and v_rol in ('admin','admin_ito')) then
      raise exception 'Solo el ITO puede dar el V°B° a una solicitud pendiente.';
    end if;

    if new.estado = 'aprobada' and old.estado in ('pendiente','visada','devuelta')
       and not (old.estado = 'visada' and v_rol in ('admin','lector_operativo')) then
      raise exception 'La solicitud de Obras necesita el V°B° del ITO antes de la aprobación del Director.';
    end if;

    -- Devolver: solo antes de la aprobación, por el ITO o el Director, con motivo.
    if new.estado = 'devuelta' then
      if not (old.estado in ('pendiente','visada') and v_rol in ('admin','admin_ito','lector_operativo')) then
        raise exception 'Solo el ITO o el Director pueden devolver una solicitud que aún no está aprobada.';
      end if;
      if v_rol = 'lector_operativo' and old.estado <> 'visada' then
        raise exception 'El Director solo devuelve las solicitudes que el ITO ya visó.';
      end if;
      if coalesce(btrim(new.motivo_devolucion), '') = '' then
        raise exception 'La devolución necesita un motivo.';
      end if;
      new.visado_por   := null;
      new.visado_en    := null;
      new.devuelto_por := coalesce(new.devuelto_por, auth.uid());
      new.devuelto_en  := coalesce(new.devuelto_en, now());
      -- vuelve a la persona anterior: Director -> ITO; ITO -> solicitante
      new.devuelta_a := case when v_rol = 'lector_operativo' then 'ito'
                             when v_rol = 'admin_ito' then 'solicitante'
                             when old.estado = 'visada' then 'ito'
                             else 'solicitante' end;
    end if;

    -- Desde 'devuelta' solo se reenvía: a 'pendiente' (Obras) o 'visada' (ITO).
    if old.estado = 'devuelta' and new.estado not in ('pendiente','visada') then
      raise exception 'Una solicitud devuelta solo puede corregirse y reenviarse.';
    end if;
    if old.estado = 'devuelta' and new.estado = 'pendiente'
       and not (v_rol in ('solicitante_obras','admin','admin_ito')) then
      raise exception 'Solo quien hizo la solicitud puede corregirla y reenviarla.';
    end if;
    if old.estado = 'devuelta' and new.estado = 'pendiente' and v_rol = 'solicitante_obras'
       and coalesce(old.devuelta_a, 'solicitante') <> 'solicitante' then
      raise exception 'La solicitud está en manos del ITO.';
    end if;
    -- Al reenviarla se limpia el motivo: la próxima devolución exige el suyo
    -- (el anterior queda en la bitácora).
    if old.estado = 'devuelta' then
      new.motivo_devolucion := null;
      new.devuelta_a := null;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_validar_flujo_operaciones on solicitud;
create trigger trg_validar_flujo_operaciones
  before update on solicitud
  for each row execute function public.fn_validar_flujo_operaciones();

-- 3) Devolver ------------------------------------------------------------
-- Devuelve a quién queda: 'ito' o 'solicitante'.
drop function if exists public.devolver_solicitud(uuid, text);
create function public.devolver_solicitud(p_id uuid, p_motivo text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_rol text := public.rol_actual();
  s solicitud%rowtype;
  v_a  text;
begin
  if v_rol not in ('admin','admin_ito','lector_operativo') then
    raise exception 'Sin permiso para devolver solicitudes';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'La devolución necesita un motivo.';
  end if;

  select * into s from solicitud where id = p_id for update;
  if not found then raise exception 'La solicitud no existe'; end if;
  if s.tipo <> 'operaciones' then
    raise exception 'Solo se devuelven las solicitudes de la Dirección de Obras.';
  end if;
  if (to_jsonb(s)->>'proceso_cotizacion_id') is not null then
    raise exception 'Esta solicitud nace de una cotización: no se edita, se rechaza si hay que rehacerla.';
  end if;

  -- El ITO también puede pasar al solicitante lo que el Director le devolvió.
  if not (s.estado in ('pendiente','visada')
          or (s.estado = 'devuelta' and s.devuelta_a = 'ito' and v_rol in ('admin','admin_ito'))) then
    raise exception 'Solo se puede devolver antes de la aprobación (estado actual: %).', s.estado;
  end if;
  if v_rol = 'lector_operativo' and s.estado <> 'visada' then
    raise exception 'El Director solo devuelve las solicitudes que el ITO ya visó.';
  end if;

  v_a := case when v_rol = 'lector_operativo' then 'ito'
              when v_rol = 'admin_ito' then 'solicitante'
              when s.estado = 'visada' then 'ito'
              else 'solicitante' end;

  update solicitud
     set estado = 'devuelta', motivo_devolucion = btrim(p_motivo),
         devuelto_por = auth.uid(), devuelto_en = now(), devuelta_a = v_a
   where id = p_id;
  return v_a;
end $$;

-- 4) Corregir y reenviar ---------------------------------------------------
-- p_lineas: [{"articulo_id":123,"descripcion":"…","unidad_medida":"…","cantidad":2.5}, …]
create or replace function public.reenviar_solicitud(
  p_id uuid, p_unidad_interna text, p_solicitante text, p_ubicacion text,
  p_motivo text, p_lineas jsonb)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_rol    text := public.rol_actual();
  s        solicitud%rowtype;
  v_nuevo  text;
begin
  if v_rol not in ('admin','admin_ito','solicitante_obras') then
    raise exception 'Sin permiso para reenviar solicitudes';
  end if;

  select * into s from solicitud where id = p_id for update;
  if not found then raise exception 'La solicitud no existe'; end if;
  if s.tipo <> 'operaciones' or s.estado <> 'devuelta' then
    raise exception 'Solo se corrigen las solicitudes de Obras que están devueltas.';
  end if;
  if (to_jsonb(s)->>'proceso_cotizacion_id') is not null then
    raise exception 'Esta solicitud nace de una cotización y no se edita.';
  end if;
  if v_rol = 'solicitante_obras' and s.unidad_id is distinct from public.unidad_del_usuario() then
    raise exception 'La solicitud no es de tu dirección.';
  end if;
  if v_rol = 'solicitante_obras' and coalesce(s.devuelta_a, 'solicitante') <> 'solicitante' then
    raise exception 'La solicitud está en manos del ITO.';
  end if;

  if coalesce(btrim(p_unidad_interna),'') = '' or coalesce(btrim(p_solicitante),'') = ''
     or coalesce(btrim(p_ubicacion),'') = '' then
    raise exception 'Faltan la unidad, el responsable o la ubicación.';
  end if;
  if p_lineas is null or jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 then
    raise exception 'Agrega al menos un material.';
  end if;
  if exists (select 1 from jsonb_array_elements(p_lineas) l
             where coalesce((l->>'cantidad')::numeric, 0) <= 0
                or coalesce(btrim(l->>'descripcion'), '') = '') then
    raise exception 'Cada material necesita descripción y una cantidad mayor que cero.';
  end if;

  -- Los productos se reemplazan completos, en esta misma transacción.
  delete from solicitud_detalle where solicitud_id = p_id;
  insert into solicitud_detalle (solicitud_id, articulo_id, descripcion_libre, unidad_medida_libre, cantidad_solicitada)
  select p_id, (select a.id from articulo a where a.id::text = nullif(l->>'articulo_id','') limit 1),
         btrim(l->>'descripcion'),
         nullif(btrim(l->>'unidad_medida'),''), (l->>'cantidad')::numeric
  from jsonb_array_elements(p_lineas) l;

  -- Obras vuelve a la revisión del ITO; el ITO no se revisa a sí mismo.
  v_nuevo := case when v_rol = 'solicitante_obras' then 'pendiente' else 'visada' end;
  update solicitud
     set unidad_interna = btrim(p_unidad_interna), solicitante = btrim(p_solicitante),
         ubicacion = btrim(p_ubicacion),
         motivo = coalesce(nullif(btrim(p_motivo), ''), motivo),
         estado = v_nuevo,
         visado_por = case when v_nuevo = 'visada' then auth.uid() end,
         visado_en  = case when v_nuevo = 'visada' then now() end
   where id = p_id;
  return v_nuevo;
end $$;

revoke all on function public.devolver_solicitud(uuid, text) from public, anon;
revoke all on function public.reenviar_solicitud(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function public.devolver_solicitud(uuid, text) to authenticated;
grant execute on function public.reenviar_solicitud(uuid, text, text, text, text, jsonb) to authenticated;

-- 5) Bitácora: la devolución queda con su motivo y a quién volvió ----------
create or replace function public.fn_bitacora_solicitud()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into bitacora(actor_id, actor_nombre, entidad, entidad_id, solicitud_id, accion, detalle)
    values (auth.uid(), public._actor_nombre(), 'solicitud', new.id, new.id, 'crear',
            jsonb_build_object('n', to_jsonb(new)->>'correlativo', 'tipo', new.tipo, 'estado', new.estado));

  elsif tg_op = 'UPDATE' and (new.estado is distinct from old.estado
        or (new.estado = 'devuelta' and new.devuelta_a is distinct from old.devuelta_a)) then
    insert into bitacora(actor_id, actor_nombre, entidad, entidad_id, solicitud_id, accion, motivo, detalle)
    values (auth.uid(), public._actor_nombre(), 'solicitud', new.id, new.id, 'cambiar_estado',
            case new.estado
              when 'rechazada' then to_jsonb(new)->>'motivo_rechazo'
              when 'devuelta'  then to_jsonb(new)->>'motivo_devolucion'
            end,
            jsonb_build_object('de', old.estado, 'a', new.estado, 'n', to_jsonb(new)->>'correlativo',
                               'devuelta_a', to_jsonb(new)->>'devuelta_a'));
  end if;
  return null;
end $$;

commit;

-- =====================================================================
-- PRUEBA
--   1. Como usuario de Obras: ingresa una Solicitud Obras (queda pendiente).
--   2. Como ITO: "Devolver" con motivo -> vuelve al SOLICITANTE (devuelta).
--   3. Como usuario de Obras: "Corregir y reenviar" -> vuelve a 'pendiente'.
--   4. ITO: V°B° -> visada. Como Director: "Devolver" -> vuelve al ITO.
--   5. Como ITO: "Corregir y reenviar" (queda visada) o "Devolver" para pasarla
--      al solicitante.
-- =====================================================================
