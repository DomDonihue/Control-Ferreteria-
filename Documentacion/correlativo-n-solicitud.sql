-- =====================================================================
-- Control Ferretería — Correlativo automático de solicitudes (n_solicitud)
-- =====================================================================
--
-- La columna solicitud.n_solicitud existía pero nunca se numeraba sola
-- (quedaba null salvo que alguien la llenara a mano). Este script:
--   1. Crea una secuencia y la deja como default de n_solicitud, para que
--      cada solicitud nueva (normal, especial u operaciones) reciba el
--      siguiente número automáticamente, en el orden en que se crean.
--   2. Numera las solicitudes que ya existen, en orden de creación,
--      para que también queden con su correlativo.
--
-- Es idempotente: se puede correr más de una vez sin problema.
-- Correr UNA vez en el SQL Editor de Supabase.
-- =====================================================================

begin;

create sequence if not exists solicitud_n_solicitud_seq;

-- Numera las solicitudes existentes que aún no tienen correlativo,
-- respetando el orden de creación.
with pendientes as (
  select id, row_number() over (order by creado_en, id) as rn
  from solicitud
  where n_solicitud is null
)
update solicitud s
set n_solicitud = nextval('solicitud_n_solicitud_seq')
from pendientes p
where s.id = p.id;

-- Deja la secuencia apuntando después del máximo actual, para que las
-- solicitudes nuevas sigan el correlativo sin chocar con las de arriba.
select setval('solicitud_n_solicitud_seq', coalesce((select max(n_solicitud) from solicitud), 0));

alter table solicitud alter column n_solicitud set default nextval('solicitud_n_solicitud_seq');

commit;

-- =====================================================================
-- PRUEBA
--   Ingresa una solicitud nueva (normal u operaciones) y revisa que en
--   el listado de "Solicitudes" y en el expediente aparezca su N°.
-- =====================================================================
