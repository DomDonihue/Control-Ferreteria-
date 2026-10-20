-- =====================================================================
-- Control Ferretería — Motivo del rechazo de una solicitud
-- =====================================================================
--
-- Al rechazar una solicitud (el ITO en su revisión o el Director), la app
-- pide un motivo obligatorio y lo guarda acá. Se muestra en "Solicitudes"
-- y en el expediente para quien hizo la solicitud.
--
-- Es idempotente. Correr UNA vez en el SQL Editor de Supabase.
-- =====================================================================

alter table solicitud add column if not exists motivo_rechazo text;
