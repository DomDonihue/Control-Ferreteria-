-- =====================================================================
-- Control Ferretería — Catálogo único: N°, detalle y precio unitario
-- =====================================================================
--
-- Deja la tabla `articulo` como UNA SOLA LISTA: la del Formulario N°5 del
-- contrato (111 productos): N° de ítem (id del listado), detalle y precio
-- unitario neto. Es la única lista que se puede pedir en la app.
--
-- Qué hace:
--   1. Agrega a `articulo`: item (N° del listado, ej. 1.1), marca y
--      precio_neto. Agrega a `solicitud_detalle`: precio_unitario_neto (el
--      precio vigente al pedir, para que una hoja emitida no cambie si
--      después se corrige un precio).
--   2. Cada producto de la lista se asocia al que YA existe en el catálogo
--      (así se conservan su unidad de medida y las solicitudes ya hechas):
--      primero por descripción idéntica (sin tildes ni signos) y luego por
--      descripción que sea prefijo de la otra, solo si el calce es único.
--   3. Los productos de la lista que no existían se CREAN (unidad 'un':
--      corrígela en Catálogo si hace falta; el reporte los lista).
--   4. Los productos antiguos que no están en la lista quedan SIN N° y la
--      app ya no los ofrece. No se borran (podrían estar en solicitudes
--      antiguas); el reporte los muestra y al final hay un bloque opcional
--      para eliminar los que no se usan.
--
-- Es idempotente: se puede correr de nuevo si cambian los precios.
-- Correr UNA vez en el SQL Editor de Supabase, ANTES de usar la versión
-- nueva de la app (la app lee estas columnas).
-- =====================================================================

begin;

alter table articulo add column if not exists item text;
alter table articulo add column if not exists marca text;
alter table articulo add column if not exists precio_neto numeric;
create unique index if not exists articulo_item_uidx on articulo(item) where item is not null;

alter table solicitud_detalle add column if not exists precio_unitario_neto numeric;

create or replace function public._norm_desc(t text)
returns text language sql immutable as $$
  select regexp_replace(
           translate(lower(coalesce(t, '')), 'áéíóúüñ', 'aeiouun'),
           '[^a-z0-9]+', '', 'g')
$$;

drop table if exists _lista_precios;
create temp table _lista_precios (
  item text, descripcion text, marca text, precio_neto numeric
);
insert into _lista_precios (item, descripcion, marca, precio_neto) values
  ('1.1', 'Tubo PVC 20mm de 6 mt', 'HOFFENS', 2824),
  ('1.2', 'Tubo PVC 25mm de 6 mt', 'HOFFENS', 3853),
  ('1.3', 'Tubo PVC 32mm de 6 mt', 'HOFFENS', 4290),
  ('1.4', 'Tubo PVC Sanitario Gris 75mm de 3mt', 'HOFFENS', 7206),
  ('1.5', 'Tubo PVC Sanitario Gris 75mm de 6mt', 'HOFFENS', 11365),
  ('1.6', 'Tubo PVC Sanitario Gris 110mm de 3mt', 'HOFFENS', 10344),
  ('1.7', 'Tubo PVC Sanitario Gris 110mm de 6mt', 'HOFFENS', 12173),
  ('1.8', 'Codo 87,5º PVC Sanitario Gris de 75mm', 'HOFFENS', 2163),
  ('1.9', 'Codo 87,5º PVC Sanitario Gris de 110mm', 'HOFFENS', 3037),
  ('1.10', 'Cañería de cobre agua 1/2" 3mt', 'HOFFENS', 17759),
  ('1.11', 'Cañería de cobre agua 1/2" 6mt', 'HOFFENS', 31912),
  ('1.12', 'Cañería de cobre agua 3/4" 3mt', 'HOFFENS', 31425),
  ('1.13', 'Cañería de cobre agua 3/4" 6mt', 'HOFFENS', 52383),
  ('1.14', 'Llave de jardín HE 1/2" x 1/2"plg', 'HOFFENS', 1947),
  ('1.15', 'Adhesivo en pote para PVC 240cc', 'HOFFENS', 3516),
  ('1.16', 'Adhesivo en pomo para PVC 60cc', 'HOFFENS', 2818),
  ('1.17', 'Sifón lavamanos', 'HOFFENS', 2677),
  ('1.18', 'Sifón lavaplatos', 'HOFFENS', 3680),
  ('1.19', 'Flexible de agua 25 cm', 'HOFFENS', 1793),
  ('2.1', 'Luminarias Publicas solares de 150 wts.', 'LOGIC', 16326),
  ('2.2', 'Interruptor Automático 1x25A', 'SCHNEIDER', 3058),
  ('2.3', 'Cable de cobre tipo eva 1,5 mm rojo, blanco y verde / 100 mt', 'COCESA', 13328),
  ('2.4', 'Cable de cobre tipo eva 2,5 mm rojo, blanco y verde / 100 mt', 'COCESA', 21470),
  ('2.5', 'Alambre NYA 1,5 mm rojo, blanco y verde /100 mt', 'COCESA', 12291),
  ('2.6', 'Alambre NYA 2,5 mm rojo, blanco y verde /100 mt', 'COCESA', 21168),
  ('2.7', 'Tuberia PVC CONDUIT 20 mm x 3 mt', 'HOFFENS', 1485),
  ('2.8', 'Caja Distribución PVC Rectangular negra de embutir', 'SCHNEIDER', 1404),
  ('2.9', 'Caja Distribución PVC Rectangular Naranja de embutir', 'SCHNEIDER', 1092),
  ('2.10', 'Caja Chuqui plástica PVC Rectangular', 'SCHNEIDER', 1290),
  ('2.11', 'Tapa Ciega PVC Rectangular', 'SCHNEIDER', 130),
  ('2.12', 'Placa Armada PVC Enchufe Sencillo', 'SCHNEIDER', 2304),
  ('2.13', 'Placa Armada PVC Enchufe Doble', 'SCHNEIDER', 835),
  ('2.14', 'Placa Armada PVC Enchufe Triple', 'SCHNEIDER', 1406),
  ('2.15', 'Enchufe PVC Enchufe Sencillo blanco', 'SCHNEIDER', 2499),
  ('2.16', 'Enchufe PVC Enchufe doble blanco', 'SCHNEIDER', 881),
  ('2.17', 'Enchufe PVC Enchufe Triple blanco', 'SCHNEIDER', 2347),
  ('2.18', 'Interruptor PVC Sencillo 9/12 10 A Blanco', 'SCHNEIDER', 1945),
  ('3.1', 'Asfalto en Frío en bolsas de 20 kilos', 'MARVEL', 9208),
  ('3.2', 'Yeso 25 kg', 'ROMERAL', 8330),
  ('3.3', 'Yeso espuma 25 kg', 'ROMERAL', 7913),
  ('3.4', 'Cemento 25 kg', 'POLPAICO', 8281),
  ('3.5', 'Mortero piso 25 kilos', 'TOPEX', 3996),
  ('4.1', 'Clavo corriente acero 2", 1 kg', 'INCHALAM', 3835),
  ('4.2', 'Clavo corriente acero 3", 1kg', 'INCHALAM', 2688),
  ('4.3', 'Clavo corriente acero 4", 1kg', 'INCHALAM', 2688),
  ('4.4', 'Tornillo volcanita 2 1/2" en 6mm, 100 unidades', 'MAMUT', 6630),
  ('4.5', 'Tornillo volcanita 2 1/2" en 6mm, 100 unidades', 'MAMUT', 6630),
  ('4.6', 'Tornillo techo 1 1/2" con sello en 12mm, 100 unidades', 'MAMUT', 5321),
  ('4.7', 'Tornillo techo 2 1/2" con sello en 12mm, 100 unidades', 'MAMUT', 8427),
  ('4.8', 'Perno de anclaje 1/4 x 2 1/4", 100 unidades', 'MAMUT', 10432),
  ('5.1', 'Perfil cuadrado 100x100 mm en 5mm, tira de 6 mt', 'KUPFER', 111701),
  ('5.2', 'Perfil cuadrado 50x50 mm en 5mm, tira de 6 mt', 'KUPFER', 47300),
  ('5.3', 'Perfil cuadrado 40x40 mm en 5mm, tira de 6 mt', 'KUPFER', 38640),
  ('5.4', 'Perfil cuadrado 25x25 mm en 1,5mm, tira de 6 mt', 'KUPFER', 10400),
  ('5.5', 'Perfil cuadrado 20x20 mm en 1,5mm, tira de 6 mt', 'KUPFER', 8948),
  ('5.6', 'Soldadura 6011 3/32", 1 Kg', 'MYH', 4328),
  ('6.1', 'Aislante Fisiterm estándar 55 mm. X 120 x 15 x 18 mts.', 'FELTREX', 12667),
  ('6.2', 'Plancha polietileno expandido 1x0,5 mt de 80 mm, 8 unidades', 'ETSA', 16084),
  ('6.3', 'Plancha polietileno expandido de 100 mm', 'ETSA', 3207),
  ('6.4', 'Rollo Papel Fieltro de 40 m2 (10/40)', 'VOLCAN', 4979),
  ('6.5', 'Rollo Papel Fieltro de 16 m2 (10/16)', 'VOLCAN', 7533),
  ('6.6', 'Aislante lana poliester 55 mm. X 0.60 x 10 mts.', 'FIBER BLOCK', 6106),
  ('6.7', 'Espuma de poliuretano de 500 ml', 'REX', 6404),
  ('7.1', 'Tablero OSB de 2,44m x 1,22m x 9,5mm', 'LP', 10955),
  ('7.2', 'Tablero Terciado estructural de 2,44m x 1,22m x 18 mm', 'LP', 23759),
  ('7.3', 'Plancha Yeso-Cartón de 2,4mt x 1,2mt x 8 mm estándar', 'VOLCAN', 11540),
  ('7.4', 'Plancha Yeso-Cartón de 2,4mt x 1,2mt x 10 mm estándar', 'KNAUF', 10513),
  ('7.5', 'Fibrocemento RH de 2,42mt x 1,2mt x 4 mm', 'VOLCAN', 9735),
  ('7.6', 'Tablero Terciado Ranurado de 1,22mt x 2,44mt x 6 mm', 'ARAUCO', 18216),
  ('8.1', 'Sellante elástico poliuretano 11-fc gris poliuretano 300 ml', 'SIKA', 4849),
  ('8.2', 'Silicona vidrios y ventanas 300 ml', 'REX', 6740),
  ('8.3', 'Silicona baño y cocina blanca 300 ml', 'REX', 4189),
  ('8.4', 'Pistola calafatear metálica alta resistencia', 'TRUPER', 3272),
  ('9.1', 'Tineta Pintura alto trafico alquidica o acrilica colores blanca-amarilla-azul', 'PASSOL', 97467),
  ('9.2', 'Esmalte Sintético Varios colores galón', 'PASSOL', 29841),
  ('9.3', 'Esmalte al Agua galón', 'PASSOL', 14610),
  ('9.4', 'Oleo brillante blanco galón', 'PASSOL', 24358),
  ('9.5', 'Barniz Marino galón', 'PASSOL', 23139),
  ('9.6', 'Pasta muro blanca tineta 20 kilos', 'REVOR', 21921),
  ('9.7', 'Aguarrás mineral 5 litros', 'PASSOL - MAX', 17639),
  ('9.8', 'Diluyente sintético 5 litros', 'PASSOL - MAX', 17639),
  ('9.9', 'Brocha 1 1/2"', 'PASSOL', 650),
  ('9.10', 'Brocha 3"', 'PASSOL', 951),
  ('9.11', 'Brocha 4"', 'PASSOL', 3033),
  ('9.12', 'Rodillo de esponja de 23cm', 'H-H', 1633),
  ('9.13', 'Rodillo de chiporro de 23cm', 'H-H', 2725),
  ('9.14', 'Lija madera 80', 'NORTON', 458),
  ('9.15', 'Lija madera 100', 'NORTON', 226),
  ('9.16', 'Lija metal 80', 'NORTON', 983),
  ('9.17', 'Lija metal 100', 'NORTON', 983),
  ('9.18', 'Aceite lubricante de motor 10 W 30 galón', 'MANNOL', 15239),
  ('10.1', 'Plancha de zinc alum de 5v (3,50 mt x 0,895 mt x 0,35 mm)', 'BOLKOW', 11296),
  ('10.2', 'Plancha de zinc alum de ondas (3,66 mt x 0,851 mt x 0,35 mm)', 'BOLKOW', 10808),
  ('11.1', 'Bizcocho 1,8 mt x 25mt, galvanizada', 'RGM', 23761),
  ('11.2', 'Acma de 3,7mm x 1,85 mt x 3mt, galvanizada', 'RGM', 12158),
  ('11.3', 'Acma de 5mt (15X15mm), galvanizada', 'RGM', 12132),
  ('12.1', 'Tubo de hormigón L, (600mm x 1 mt)', 'GRAU', 17839),
  ('13.1', 'Bolsas de basura carga pesada 110 x 120 y 110 x 130 cm.', 'MEDCLEAN', 2051),
  ('13.2', 'Escobas 5 costuras', 'AT', 3238),
  ('13.3', 'Basureros Industrial 240 litros con ruedas', 'MR TOC', 13650),
  ('13.4', 'Contenedores Indsutrial 660 litros con ruedas', 'MTS', 85838),
  ('13.5', 'Barre hojas plasticos 22 o más dientes', 'RAYUN', 2726),
  ('13.6', 'Herbicida Bidon 20 litros', 'AGROSPEC', 55283),
  ('13.7', 'Jabón potasico en bae de 5 litros', 'BOTANICAL', 3965),
  ('13.8', 'Pala con mango con goma', 'SOGA', 1087),
  ('13.9', 'Aspersores de Riego', 'EDR', 907),
  ('13.10', 'Mangueras 1/2 rollos de 100 metros', 'GARDTECH', 13158),
  ('13.11', 'Mangueras 3/4 rollos de 100 metros', 'PARDPRO', 38230),
  ('13.12', 'Conectores de 1/2 plasticos', 'ERGO', 2163),
  ('13.13', 'Conector 3/4 plasticos', 'ERGO', 2382),
  ('13.14', 'Nylon orilladora 2,7 mm rollo 500 m redondo', 'VFORCE', 32762);

-- 1) descripción idéntica (uno a uno: si la lista repite una descripción,
--    4.4 y 4.5, el segundo se crea como producto aparte)
with cand as (
  select l.item, a.id as articulo_id,
         row_number() over (partition by l.item order by a.id) as rn_l,
         row_number() over (partition by a.id order by l.item) as rn_a
  from _lista_precios l
  join articulo a on a.item is null
                 and public._norm_desc(a.descripcion) = public._norm_desc(l.descripcion)
)
update articulo a
set item = l.item, marca = l.marca, precio_neto = l.precio_neto
from cand c join _lista_precios l on l.item = c.item
where a.id = c.articulo_id and c.rn_l = 1 and c.rn_a = 1;

-- 2) una descripción es prefijo de la otra y el calce es único
with pares as (
  select a2.id as articulo_id, min(l.item) as item
  from articulo a2
  join _lista_precios l
    on public._norm_desc(l.descripcion) like public._norm_desc(a2.descripcion) || '%'
    or public._norm_desc(a2.descripcion) like public._norm_desc(l.descripcion) || '%'
  where a2.item is null
    and length(public._norm_desc(a2.descripcion)) >= 8
    and not exists (select 1 from articulo x where x.item = l.item)
  group by a2.id
  having count(distinct l.item) = 1
),
unicos as (
  select articulo_id, item from pares
  where item in (select item from pares group by item having count(*) = 1)
)
update articulo a
set item = l.item, marca = l.marca, precio_neto = l.precio_neto
from unicos u join _lista_precios l on l.item = u.item
where a.id = u.articulo_id;

-- 3) crear los que faltan
drop table if exists _nuevos;
create temp table _nuevos (item text);
with ins as (
  insert into articulo (descripcion, unidad_medida, item, marca, precio_neto)
  select l.descripcion, 'un', l.item, l.marca, l.precio_neto
  from _lista_precios l
  where not exists (select 1 from articulo a where a.item = l.item)
  returning item
)
insert into _nuevos select item from ins;

-- 4) refrescar marca y precio de todos los de la lista (por si cambiaron)
update articulo a
set marca = l.marca, precio_neto = l.precio_neto
from _lista_precios l
where a.item = l.item;

commit;

-- =====================================================================
-- REPORTE (se muestra al correr el script):
--   NUEVO (revisar unidad)  = producto de la lista que no existía y se creó;
--                             pon su unidad de medida en Catálogo.
--   FUERA DE LA LISTA       = producto antiguo que no está en el listado
--                             del contrato; la app ya no lo ofrece.
-- Si el reporte queda vacío, el catálogo es exactamente la lista.
-- =====================================================================
select 'NUEVO (revisar unidad)' as tipo, a.item, a.descripcion, a.unidad_medida
from articulo a join _nuevos n on n.item = a.item
union all
select 'FUERA DE LA LISTA', null, a.descripcion, a.unidad_medida
from articulo a
where a.item is null
order by 1, 2;

-- Resumen: select count(*) filter (where item is not null) as en_la_lista, count(*) as total from articulo;

-- =====================================================================
-- OPCIONAL — eliminar los productos "FUERA DE LA LISTA" que no se usan en
-- ninguna solicitud. Quita los comentarios para usarlo. Si algún otro dato
-- los usa, la base lo rechazará y no se borra nada.
--
-- delete from articulo a
-- where a.item is null
--   and not exists (select 1 from solicitud_detalle d where d.articulo_id = a.id);
-- =====================================================================
