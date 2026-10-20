-- =====================================================================
-- Control Ferretería — DESHACER la carga de "catálogo único con precios"
-- =====================================================================
--
-- Deshace lo que hizo catalogo-precios.sql en Supabase:
--   * borra los productos que ese script CREÓ (unidad 'un', con N°),
--   * les quita N°/marca/precio a los productos que ya existían,
--   * borra el índice y la función auxiliar que creó.
--
-- IMPORTANTE: después de correr ese script no hay forma 100% segura de
-- distinguir un producto creado por él de uno que ya existía con unidad 'un'.
-- Por eso son DOS PASOS: primero mira la lista (PASO 1) y revisa que TODOS
-- los productos que aparecen sean de los que no existían antes. Si alguno ya
-- existía, agrégalo a la lista de excepciones del PASO 2.
--
-- Los productos que ya estén usados en una solicitud NO se borran.
-- Se puede correr más de una vez sin problema.
-- =====================================================================


-- =====================================================================
-- PASO 1 — SOLO LECTURA. Corre solo esto y revisa el resultado.
-- Lista lo que el PASO 2 va a BORRAR. Debería ser casi todo el listado
-- (cerca de 111 menos los que ya tenías). Fíjate en la columna `id`: los
-- creados por el script suelen ser un bloque seguido de los id más altos.
-- =====================================================================
select a.id, a.item, a.descripcion, a.unidad_medida
from articulo a
where a.item is not null
  and a.unidad_medida = 'un'
  and not exists (select 1 from solicitud_detalle d where d.articulo_id = a.id)
order by a.id;

-- Resumen (opcional):
-- select count(*) filter (where item is not null) as con_n, count(*) as total from articulo;

-- Lo que NO se borra y solo pierde el N°/precio (existía antes o ya se usó):
-- select item, descripcion, unidad_medida from articulo
-- where item is not null and not (unidad_medida = 'un'
--       and not exists (select 1 from solicitud_detalle d where d.articulo_id = articulo.id))
-- order by item;


-- =====================================================================
-- PASO 2 — DESHACER. Corre esto SOLO después de revisar el PASO 1.
-- Si en el PASO 1 apareció algún producto que ya existía antes, escribe su
-- N° en la lista de excepciones (ej: ('3.2','5.6')) antes de correrlo.
-- =====================================================================
begin;

-- 2.1 borrar lo que creó el script (y que ninguna solicitud usa)
delete from articulo a
where a.item is not null
  and a.unidad_medida = 'un'
  and a.item not in ('__ninguna__')            -- <- excepciones: a.item not in ('3.2','5.6')
  and not exists (select 1 from solicitud_detalle d where d.articulo_id = a.id);

-- 2.2 los que quedan con N° existían antes: se les quita lo que puso el script
update articulo set item = null, marca = null, precio_neto = null where item is not null;

-- 2.3 índice y función auxiliar del script
drop index if exists articulo_item_uidx;
drop function if exists public._norm_desc(text);

commit;

-- Para ver cómo quedó el catálogo:
select count(*) as articulos_ahora from articulo;


-- =====================================================================
-- OPCIONAL — dejar la base idéntica a antes quitando también las columnas
-- nuevas. Las columnas vacías NO molestan a la app, por eso va comentado.
-- Úsalo solo si estás seguro de que `marca` y `precio_neto` no existían en
-- `articulo` antes del script (si existían, se perderían sus datos).
--
-- alter table articulo drop column if exists item;
-- alter table articulo drop column if exists marca;
-- alter table articulo drop column if exists precio_neto;
-- alter table solicitud_detalle drop column if exists precio_unitario_neto;
-- =====================================================================
