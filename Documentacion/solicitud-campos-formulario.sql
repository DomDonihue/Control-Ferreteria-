-- =====================================================================
-- Control Ferretería — Campos del formulario "Nueva solicitud"
-- =====================================================================
--
-- Agrega (si faltan) las columnas que usa app.js al guardar una solicitud:
-- datos del formulario oficial (correlativo, contacto, supervisor, etc.),
-- los respaldos que se pueden marcar con checkbox (fotográfico, informe
-- técnico, presupuesto, otro) y las situaciones especiales (CDP negativo,
-- fuera de catálogo).
--
-- Es idempotente: se puede correr más de una vez sin problema.
-- Correr UNA vez en el SQL Editor de Supabase.
-- =====================================================================

begin;

alter table solicitud add column if not exists correlativo text;
alter table solicitud add column if not exists contacto text;
alter table solicitud add column if not exists supervisor text;
alter table solicitud add column if not exists descripcion_requerimiento text;
alter table solicitud add column if not exists situacion_actual text;
alter table solicitud add column if not exists trabajo_ejecutar text;

alter table solicitud add column if not exists resp_fotografico boolean not null default false;
alter table solicitud add column if not exists num_fotos integer;
alter table solicitud add column if not exists resp_fotografico_url text;
alter table solicitud add column if not exists resp_informe_tecnico boolean not null default false;
alter table solicitud add column if not exists resp_presupuesto boolean not null default false;
alter table solicitud add column if not exists resp_otro boolean not null default false;
alter table solicitud add column if not exists resp_otro_texto text;

alter table solicitud add column if not exists cdp_negativo boolean not null default false;
alter table solicitud add column if not exists cdp_negativo_url text;
alter table solicitud add column if not exists tipo text not null default 'normal';
alter table solicitud add column if not exists justificacion_especial text;
alter table solicitud add column if not exists just_juridica_url text;
alter table solicitud add column if not exists just_daf_url text;
alter table solicitud add column if not exists just_reforzada_url text;
alter table solicitud add column if not exists pronunciamiento_juridica_url text;

alter table solicitud add column if not exists memo_url text;

commit;

-- =====================================================================
-- PRUEBA
--   Ingresa una solicitud nueva marcando "Solicitud con CDP negativo" y
--   guarda: ya no debe aparecer el error
--   "Could not find the 'cdp_negativo' column of 'solicitud' in the schema cache".
-- =====================================================================
