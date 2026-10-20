-- =====================================================================
-- Control Ferretería — Bitácora de la solicitud (ingreso y cambios de estado)
-- =====================================================================
--
-- La bitácora solo registraba documentos (guías, facturas, notas de crédito)
-- y reversos del convenio. Este script agrega el registro de la solicitud:
--   - al ingresarla                       -> 'crear'
--   - en cada cambio de estado            -> 'cambiar_estado'
--     (pendiente -> visada -> aprobada -> enviada -> ... o rechazada)
--     y si se rechaza, queda el motivo.
--
-- Quién lo ve no cambia: Administrador, Director de Obras y DAF.
-- Solo registra de ahora en adelante (no inventa historia anterior).
-- Requiere haber corrido antes anulacion-y-bitacora.sql (tabla bitacora).
--
-- Es idempotente. Correr UNA vez en el SQL Editor de Supabase.
-- =====================================================================

create or replace function public.fn_bitacora_solicitud()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into bitacora(actor_id, actor_nombre, entidad, entidad_id, solicitud_id, accion, detalle)
    values (auth.uid(), public._actor_nombre(), 'solicitud', new.id, new.id, 'crear',
            jsonb_build_object('n', to_jsonb(new)->>'correlativo', 'tipo', new.tipo, 'estado', new.estado));

  elsif tg_op = 'UPDATE' and new.estado is distinct from old.estado then
    insert into bitacora(actor_id, actor_nombre, entidad, entidad_id, solicitud_id, accion, motivo, detalle)
    values (auth.uid(), public._actor_nombre(), 'solicitud', new.id, new.id, 'cambiar_estado',
            case when new.estado = 'rechazada' then to_jsonb(new)->>'motivo_rechazo' end,
            jsonb_build_object('de', old.estado, 'a', new.estado, 'n', to_jsonb(new)->>'correlativo'));
  end if;
  return null;
end $$;

drop trigger if exists trg_bitacora_solicitud on solicitud;
create trigger trg_bitacora_solicitud
  after insert or update on solicitud
  for each row execute function public.fn_bitacora_solicitud();
