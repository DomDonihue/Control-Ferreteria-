-- =====================================================================
-- Control Ferretería — Catálogo con precios (Formulario N°5, oferta económica)
-- =====================================================================
--
-- Carga la lista de precios unitarios NETOS del contrato (111 productos,
-- 13 categorías) en la tabla `articulo`, para que la hoja de solicitud y el
-- expediente muestren valor unitario, subtotal y total.
--
-- Qué hace:
--   1. Agrega a `articulo`: item (N° del formulario, ej. 1.1), marca y
--      precio_neto. Agrega a `solicitud_detalle`: precio_unitario_neto
--      (el precio vigente al momento de pedir, para que no cambie después).
--   2. Calza cada producto de la lista con el que YA existe en el catálogo:
--      primero por descripción idéntica (sin tildes ni signos) y luego por
--      descripción que sea prefijo de la otra, solo si el calce es único.
--   3. NO crea ni borra productos. Al final muestra un reporte con lo que
--      quedó sin calzar para revisarlo (ver abajo).
--
-- Es idempotente: se puede correr de nuevo si cambian los precios.
-- Correr UNA vez en el SQL Editor de Supabase, ANTES de usar la versión
-- nueva de la app (la app lee estas columnas).
-- =====================================================================

begin;

alter table articulo add column if not exists item text;
alter table articulo add column if not exists marca text;
alter table articulo add column if not exists precio_neto numeric;

alter table solicitud_detalle add column if not exists precio_unitario_neto numeric;

create or replace function public._norm_desc(t text)
returns text language sql immutable as $$
  select regexp_replace(
           translate(lower(coalesce(t, '')), 'áéíóúüñ', 'aeiouun'),
           '[^a-z0-9]+', '', 'g')
$$;

create temp table _lista_precios (
  item text, categoria int, descripcion text, marca text, precio_neto numeric
);
insert into _lista_precios (item, categoria, descripcion, marca, precio_neto) values
  ('1.1', 1, 'Tubo PVC 20mm de 6 mt', 'HOFFENS', 2824),
  ('1.2', 1, 'Tubo PVC 25mm de 6 mt', 'HOFFENS', 3853),
  ('1.3', 1, 'Tubo PVC 32mm de 6 mt', 'HOFFENS', 4290),
  ('1.4', 1, 'Tubo PVC Sanitario Gris 75mm de 3mt', 'HOFFENS', 7206),
  ('1.5', 1, 'Tubo PVC Sanitario Gris 75mm de 6mt', 'HOFFENS', 11365),
  ('1.6', 1, 'Tubo PVC Sanitario Gris 110mm de 3mt', 'HOFFENS', 10344),
  ('1.7', 1, 'Tubo PVC Sanitario Gris 110mm de 6mt', 'HOFFENS', 12173),
  ('1.8', 1, 'Codo 87,5º PVC Sanitario Gris de 75mm', 'HOFFENS', 2163),
  ('1.9', 1, 'Codo 87,5º PVC Sanitario Gris de 110mm', 'HOFFENS', 3037),
  ('1.10', 1, 'Cañería de cobre agua 1/2" 3mt', 'HOFFENS', 17759),
  ('1.11', 1, 'Cañería de cobre agua 1/2" 6mt', 'HOFFENS', 31912),
  ('1.12', 1, 'Cañería de cobre agua 3/4" 3mt', 'HOFFENS', 31425),
  ('1.13', 1, 'Cañería de cobre agua 3/4" 6mt', 'HOFFENS', 52383),
  ('1.14', 1, 'Llave de jardín HE 1/2" x 1/2"plg', 'HOFFENS', 1947),
  ('1.15', 1, 'Adhesivo en pote para PVC 240cc', 'HOFFENS', 3516),
  ('1.16', 1, 'Adhesivo en pomo para PVC 60cc', 'HOFFENS', 2818),
  ('1.17', 1, 'Sifón lavamanos', 'HOFFENS', 2677),
  ('1.18', 1, 'Sifón lavaplatos', 'HOFFENS', 3680),
  ('1.19', 1, 'Flexible de agua 25 cm', 'HOFFENS', 1793),
  ('2.1', 2, 'Luminarias Publicas solares de 150 wts.', 'LOGIC', 16326),
  ('2.2', 2, 'Interruptor Automático 1x25A', 'SCHNEIDER', 3058),
  ('2.3', 2, 'Cable de cobre tipo eva 1,5 mm rojo, blanco y verde / 100 mt', 'COCESA', 13328),
  ('2.4', 2, 'Cable de cobre tipo eva 2,5 mm rojo, blanco y verde / 100 mt', 'COCESA', 21470),
  ('2.5', 2, 'Alambre NYA 1,5 mm rojo, blanco y verde /100 mt', 'COCESA', 12291),
  ('2.6', 2, 'Alambre NYA 2,5 mm rojo, blanco y verde /100 mt', 'COCESA', 21168),
  ('2.7', 2, 'Tuberia PVC CONDUIT 20 mm x 3 mt', 'HOFFENS', 1485),
  ('2.8', 2, 'Caja Distribución PVC Rectangular negra de embutir', 'SCHNEIDER', 1404),
  ('2.9', 2, 'Caja Distribución PVC Rectangular Naranja de embutir', 'SCHNEIDER', 1092),
  ('2.10', 2, 'Caja Chuqui plástica PVC Rectangular', 'SCHNEIDER', 1290),
  ('2.11', 2, 'Tapa Ciega PVC Rectangular', 'SCHNEIDER', 130),
  ('2.12', 2, 'Placa Armada PVC Enchufe Sencillo', 'SCHNEIDER', 2304),
  ('2.13', 2, 'Placa Armada PVC Enchufe Doble', 'SCHNEIDER', 835),
  ('2.14', 2, 'Placa Armada PVC Enchufe Triple', 'SCHNEIDER', 1406),
  ('2.15', 2, 'Enchufe PVC Enchufe Sencillo blanco', 'SCHNEIDER', 2499),
  ('2.16', 2, 'Enchufe PVC Enchufe doble blanco', 'SCHNEIDER', 881),
  ('2.17', 2, 'Enchufe PVC Enchufe Triple blanco', 'SCHNEIDER', 2347),
  ('2.18', 2, 'Interruptor PVC Sencillo 9/12 10 A Blanco', 'SCHNEIDER', 1945),
  ('3.1', 3, 'Asfalto en Frío en bolsas de 20 kilos', 'MARVEL', 9208),
  ('3.2', 3, 'Yeso 25 kg', 'ROMERAL', 8330),
  ('3.3', 3, 'Yeso espuma 25 kg', 'ROMERAL', 7913),
  ('3.4', 3, 'Cemento 25 kg', 'POLPAICO', 8281),
  ('3.5', 3, 'Mortero piso 25 kilos', 'TOPEX', 3996),
  ('4.1', 4, 'Clavo corriente acero 2", 1 kg', 'INCHALAM', 3835),
  ('4.2', 4, 'Clavo corriente acero 3", 1kg', 'INCHALAM', 2688),
  ('4.3', 4, 'Clavo corriente acero 4", 1kg', 'INCHALAM', 2688),
  ('4.4', 4, 'Tornillo volcanita 2 1/2" en 6mm, 100 unidades', 'MAMUT', 6630),
  ('4.5', 4, 'Tornillo volcanita 2 1/2" en 6mm, 100 unidades', 'MAMUT', 6630),
  ('4.6', 4, 'Tornillo techo 1 1/2" con sello en 12mm, 100 unidades', 'MAMUT', 5321),
  ('4.7', 4, 'Tornillo techo 2 1/2" con sello en 12mm, 100 unidades', 'MAMUT', 8427),
  ('4.8', 4, 'Perno de anclaje 1/4 x 2 1/4", 100 unidades', 'MAMUT', 10432),
  ('5.1', 5, 'Perfil cuadrado 100x100 mm en 5mm, tira de 6 mt', 'KUPFER', 111701),
  ('5.2', 5, 'Perfil cuadrado 50x50 mm en 5mm, tira de 6 mt', 'KUPFER', 47300),
  ('5.3', 5, 'Perfil cuadrado 40x40 mm en 5mm, tira de 6 mt', 'KUPFER', 38640),
  ('5.4', 5, 'Perfil cuadrado 25x25 mm en 1,5mm, tira de 6 mt', 'KUPFER', 10400),
  ('5.5', 5, 'Perfil cuadrado 20x20 mm en 1,5mm, tira de 6 mt', 'KUPFER', 8948),
  ('5.6', 5, 'Soldadura 6011 3/32", 1 Kg', 'MYH', 4328),
  ('6.1', 6, 'Aislante Fisiterm estándar 55 mm. X 120 x 15 x 18 mts.', 'FELTREX', 12667),
  ('6.2', 6, 'Plancha polietileno expandido 1x0,5 mt de 80 mm, 8 unidades', 'ETSA', 16084),
  ('6.3', 6, 'Plancha polietileno expandido de 100 mm', 'ETSA', 3207),
  ('6.4', 6, 'Rollo Papel Fieltro de 40 m2 (10/40)', 'VOLCAN', 4979),
  ('6.5', 6, 'Rollo Papel Fieltro de 16 m2 (10/16)', 'VOLCAN', 7533),
  ('6.6', 6, 'Aislante lana poliester 55 mm. X 0.60 x 10 mts.', 'FIBER BLOCK', 6106),
  ('6.7', 6, 'Espuma de poliuretano de 500 ml', 'REX', 6404),
  ('7.1', 7, 'Tablero OSB de 2,44m x 1,22m x 9,5mm', 'LP', 10955),
  ('7.2', 7, 'Tablero Terciado estructural de 2,44m x 1,22m x 18 mm', 'LP', 23759),
  ('7.3', 7, 'Plancha Yeso-Cartón de 2,4mt x 1,2mt x 8 mm estándar', 'VOLCAN', 11540),
  ('7.4', 7, 'Plancha Yeso-Cartón de 2,4mt x 1,2mt x 10 mm estándar', 'KNAUF', 10513),
  ('7.5', 7, 'Fibrocemento RH de 2,42mt x 1,2mt x 4 mm', 'VOLCAN', 9735),
  ('7.6', 7, 'Tablero Terciado Ranurado de 1,22mt x 2,44mt x 6 mm', 'ARAUCO', 18216),
  ('8.1', 8, 'Sellante elástico poliuretano 11-fc gris poliuretano 300 ml', 'SIKA', 4849),
  ('8.2', 8, 'Silicona vidrios y ventanas 300 ml', 'REX', 6740),
  ('8.3', 8, 'Silicona baño y cocina blanca 300 ml', 'REX', 4189),
  ('8.4', 8, 'Pistola calafatear metálica alta resistencia', 'TRUPER', 3272),
  ('9.1', 9, 'Tineta Pintura alto trafico alquidica o acrilica colores blanca-amarilla-azul', 'PASSOL', 97467),
  ('9.2', 9, 'Esmalte Sintético Varios colores galón', 'PASSOL', 29841),
  ('9.3', 9, 'Esmalte al Agua galón', 'PASSOL', 14610),
  ('9.4', 9, 'Oleo brillante blanco galón', 'PASSOL', 24358),
  ('9.5', 9, 'Barniz Marino galón', 'PASSOL', 23139),
  ('9.6', 9, 'Pasta muro blanca tineta 20 kilos', 'REVOR', 21921),
  ('9.7', 9, 'Aguarrás mineral 5 litros', 'PASSOL - MAX', 17639),
  ('9.8', 9, 'Diluyente sintético 5 litros', 'PASSOL - MAX', 17639),
  ('9.9', 9, 'Brocha 1 1/2"', 'PASSOL', 650),
  ('9.10', 9, 'Brocha 3"', 'PASSOL', 951),
  ('9.11', 9, 'Brocha 4"', 'PASSOL', 3033),
  ('9.12', 9, 'Rodillo de esponja de 23cm', 'H-H', 1633),
  ('9.13', 9, 'Rodillo de chiporro de 23cm', 'H-H', 2725),
  ('9.14', 9, 'Lija madera 80', 'NORTON', 458),
  ('9.15', 9, 'Lija madera 100', 'NORTON', 226),
  ('9.16', 9, 'Lija metal 80', 'NORTON', 983),
  ('9.17', 9, 'Lija metal 100', 'NORTON', 983),
  ('9.18', 9, 'Aceite lubricante de motor 10 W 30 galón', 'MANNOL', 15239),
  ('10.1', 10, 'Plancha de zinc alum de 5v (3,50 mt x 0,895 mt x 0,35 mm)', 'BOLKOW', 11296),
  ('10.2', 10, 'Plancha de zinc alum de ondas (3,66 mt x 0,851 mt x 0,35 mm)', 'BOLKOW', 10808),
  ('11.1', 11, 'Bizcocho 1,8 mt x 25mt, galvanizada', 'RGM', 23761),
  ('11.2', 11, 'Acma de 3,7mm x 1,85 mt x 3mt, galvanizada', 'RGM', 12158),
  ('11.3', 11, 'Acma de 5mt (15X15mm), galvanizada', 'RGM', 12132),
  ('12.1', 12, 'Tubo de hormigón L, (600mm x 1 mt)', 'GRAU', 17839),
  ('13.1', 13, 'Bolsas de basura carga pesada 110 x 120 y 110 x 130 cm.', 'MEDCLEAN', 2051),
  ('13.2', 13, 'Escobas 5 costuras', 'AT', 3238),
  ('13.3', 13, 'Basureros Industrial 240 litros con ruedas', 'MR TOC', 13650),
  ('13.4', 13, 'Contenedores Indsutrial 660 litros con ruedas', 'MTS', 85838),
  ('13.5', 13, 'Barre hojas plasticos 22 o más dientes', 'RAYUN', 2726),
  ('13.6', 13, 'Herbicida Bidon 20 litros', 'AGROSPEC', 55283),
  ('13.7', 13, 'Jabón potasico en bae de 5 litros', 'BOTANICAL', 3965),
  ('13.8', 13, 'Pala con mango con goma', 'SOGA', 1087),
  ('13.9', 13, 'Aspersores de Riego', 'EDR', 907),
  ('13.10', 13, 'Mangueras 1/2 rollos de 100 metros', 'GARDTECH', 13158),
  ('13.11', 13, 'Mangueras 3/4 rollos de 100 metros', 'PARDPRO', 38230),
  ('13.12', 13, 'Conectores de 1/2 plasticos', 'ERGO', 2163),
  ('13.13', 13, 'Conector 3/4 plasticos', 'ERGO', 2382),
  ('13.14', 13, 'Nylon orilladora 2,7 mm rollo 500 m redondo', 'VFORCE', 32762);

-- 1) descripción idéntica (si la lista repite una descripción, 4.4 y 4.5, queda la primera)
update articulo a
set item = l.item, marca = l.marca, precio_neto = l.precio_neto
from (
  select distinct on (public._norm_desc(descripcion)) *
  from _lista_precios
  order by public._norm_desc(descripcion), item
) l
where public._norm_desc(a.descripcion) = public._norm_desc(l.descripcion);

-- 2) lo que falta: una descripción es prefijo de la otra y el calce es único
update articulo a
set item = c.item, marca = c.marca, precio_neto = c.precio_neto
from (
  select a2.id as articulo_id, min(l.item) as item, min(l.marca) as marca, min(l.precio_neto) as precio_neto
  from articulo a2
  join _lista_precios l
    on public._norm_desc(l.descripcion) like public._norm_desc(a2.descripcion) || '%'
    or public._norm_desc(a2.descripcion) like public._norm_desc(l.descripcion) || '%'
  where a2.precio_neto is null and length(public._norm_desc(a2.descripcion)) >= 8
  group by a2.id
  having count(distinct l.item) = 1
) c
where a.id = c.articulo_id;

commit;

-- =====================================================================
-- REPORTE (se muestra al correr el script). Revísalo:
--   LISTA SIN CALZAR   = producto de la lista de precios que no encontró su
--                        producto en el catálogo (o el nombre es distinto).
--   ARTICULO SIN PRECIO = producto del catálogo que quedó sin precio.
-- Si ambas listas están vacías, quedó todo cargado.
-- Para corregir uno a mano: Catálogo > editar el artículo y poner su precio,
-- o ajustar la descripción del artículo para que coincida con la lista.
-- =====================================================================
select 'LISTA SIN CALZAR' as tipo, l.item, l.descripcion, l.precio_neto
from _lista_precios l
where not exists (select 1 from articulo a where a.item = l.item)
union all
select 'ARTICULO SIN PRECIO', a.item, a.descripcion, null
from articulo a
where a.precio_neto is null
order by 1, 2;

-- Resumen: cuántos productos quedaron con precio
-- select count(*) filter (where precio_neto is not null) as con_precio, count(*) as total from articulo;

-- =====================================================================
-- OPCIONAL — crear los productos de la lista que NO existan en el catálogo.
-- Solo si el reporte mostró "LISTA SIN CALZAR" y de verdad faltan.
-- (La unidad de medida no viene en el formulario: se deja 'un'; corrígela
--  después en Catálogo.) Quita los comentarios para usarlo:
--
-- insert into articulo (descripcion, unidad_medida, item, marca, precio_neto)
-- select l.descripcion, 'un', l.item, l.marca, l.precio_neto
-- from _lista_precios l
-- where not exists (select 1 from articulo a where a.item = l.item);
-- =====================================================================
