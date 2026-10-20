-- =====================================================================
-- Control Ferretería — Cargar el precio unitario NETO a cada artículo
-- =====================================================================
--
-- Agrega la columna `precio_neto` a `articulo` y le pone el valor del
-- Formulario N°5 (oferta económica) a los productos que YA existen en el
-- catálogo. Con eso, la hoja de solicitud y el expediente muestran valor
-- unitario, subtotal por ítem y total.
--
-- Solo ACTUALIZA el precio. NO crea, NO borra y NO cambia nada más.
--
-- Cómo calza: cada producto del listado se busca por sus DOS nombres oficiales
-- (el del Formulario N°5 y el de la Ficha Técnica, que comparten el N° de ítem),
-- comparando sin tildes, mayúsculas ni signos. Primero nombre idéntico y luego,
-- si falta, nombre que sea el comienzo del otro (solo si el calce es único).
-- Lo que no calce NO se toca: el reporte final lo muestra y el precio se
-- completa a mano en Catálogo (el Administrador edita el precio del artículo).
--
-- Se puede correr de nuevo si cambian los precios (vuelve a escribir los
-- precios de los productos que calzan).
-- Correr UNA vez en el SQL Editor de Supabase, ANTES de usar la versión
-- nueva de la app (la app lee esta columna).
-- (Si Supabase pregunta por RLS al correrlo, elige "Run without RLS": solo
--  crea tablas temporales que desaparecen al terminar.)
-- =====================================================================

begin;

alter table articulo add column if not exists precio_neto numeric;

create or replace function public._norm_desc(t text)
returns text language sql immutable as $$
  select regexp_replace(
           lower(translate(coalesce(t, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
           '[^a-z0-9]+', '', 'g')
$$;

drop table if exists _lista_precios;
create temp table _lista_precios (item text, descripcion text, ficha text, precio_neto numeric);
insert into _lista_precios (item, descripcion, ficha, precio_neto) values
  ('1.1', 'Tubo PVC 20mm de 6 mt', 'Tubo PVC 20 mm', 2824),
  ('1.2', 'Tubo PVC 25mm de 6 mt', 'Tubo PVC 25 mm', 3853),
  ('1.3', 'Tubo PVC 32mm de 6 mt', 'Tubo PVC 32 mm', 4290),
  ('1.4', 'Tubo PVC Sanitario Gris 75mm de 3mt', 'Tubo PVC Sanitario Gris 75 mm (3 mt)', 7206),
  ('1.5', 'Tubo PVC Sanitario Gris 75mm de 6mt', 'Tubo PVC Sanitario Gris 75 mm (6 mt)', 11365),
  ('1.6', 'Tubo PVC Sanitario Gris 110mm de 3mt', 'Tubo PVC Sanitario Gris 110 mm (3 mt)', 10344),
  ('1.7', 'Tubo PVC Sanitario Gris 110mm de 6mt', 'Tubo PVC Sanitario Gris 110 mm (6 mt)', 12173),
  ('1.8', 'Codo 87,5º PVC Sanitario Gris de 75mm', 'Codo 87,5° PVC Sanitario Gris 75 mm', 2163),
  ('1.9', 'Codo 87,5º PVC Sanitario Gris de 110mm', 'Codo 87,5° PVC Sanitario Gris 110 mm', 3037),
  ('1.10', 'Cañería de cobre agua 1/2" 3mt', 'Cañería de cobre 1/2" (3 mt)', 17759),
  ('1.11', 'Cañería de cobre agua 1/2" 6mt', 'Cañería de cobre 1/2" (6 mt)', 31912),
  ('1.12', 'Cañería de cobre agua 3/4" 3mt', 'Cañería de cobre 3/4" (3 mt)', 31425),
  ('1.13', 'Cañería de cobre agua 3/4" 6mt', 'Cañería de cobre 3/4" (6 mt)', 52383),
  ('1.14', 'Llave de jardín HE 1/2" x 1/2"plg', 'Llave de jardín HE 1/2"', 1947),
  ('1.15', 'Adhesivo en pote para PVC 240cc', 'Adhesivo para PVC en pote 240 cc', 3516),
  ('1.16', 'Adhesivo en pomo para PVC 60cc', 'Adhesivo para PVC en pomo 60 cc', 2818),
  ('1.17', 'Sifón lavamanos', 'Sifón lavamanos', 2677),
  ('1.18', 'Sifón lavaplatos', 'Sifón lavaplatos', 3680),
  ('1.19', 'Flexible de agua 25 cm', 'Flexible de agua 25 cm', 1793),
  ('2.1', 'Luminarias Publicas solares de 150 wts.', 'Luminaria pública solar 150 W', 16326),
  ('2.2', 'Interruptor Automático 1x25A', 'Interruptor automático 1x25 A', 3058),
  ('2.3', 'Cable de cobre tipo eva 1,5 mm rojo, blanco y verde / 100 mt', 'Cable de cobre tipo eva 1,5 mm rojo, blanco y verde / 100 mt', 13328),
  ('2.4', 'Cable de cobre tipo eva 2,5 mm rojo, blanco y verde / 100 mt', 'Cable de cobre tipo eva 2,5 mm rojo, blanco y verde / 100 mt', 21470),
  ('2.5', 'Alambre NYA 1,5 mm rojo, blanco y verde /100 mt', 'Alambre NYA 1,5 mm rojo, blanco y verde /100 mt', 12291),
  ('2.6', 'Alambre NYA 2,5 mm rojo, blanco y verde /100 mt', 'Alambre NYA 2,5 mm rojo, blanco y verde /100 mt', 21168),
  ('2.7', 'Tuberia PVC CONDUIT 20 mm x 3 mt', 'Tubería PVC CONDUIT 20 mm', 1485),
  ('2.8', 'Caja Distribución PVC Rectangular negra de embutir', 'Caja distribución PVC rectangular negra', 1404),
  ('2.9', 'Caja Distribución PVC Rectangular Naranja de embutir', 'Caja distribución PVC rectangular naranja', 1092),
  ('2.10', 'Caja Chuqui plástica PVC Rectangular', 'Caja chuqui plástica PVC rectangular', 1290),
  ('2.11', 'Tapa Ciega PVC Rectangular', 'Tapa ciega PVC rectangular', 130),
  ('2.12', 'Placa Armada PVC Enchufe Sencillo', 'Placa armada PVC enchufe sencillo', 2304),
  ('2.13', 'Placa Armada PVC Enchufe Doble', 'Placa armada PVC enchufe doble', 835),
  ('2.14', 'Placa Armada PVC Enchufe Triple', 'Placa armada PVC enchufe triple', 1406),
  ('2.15', 'Enchufe PVC Enchufe Sencillo blanco', 'Enchufe PVC sencillo blanco', 2499),
  ('2.16', 'Enchufe PVC Enchufe doble blanco', 'Enchufe PVC doble blanco', 881),
  ('2.17', 'Enchufe PVC Enchufe Triple blanco', 'Enchufe PVC triple blanco', 2347),
  ('2.18', 'Interruptor PVC Sencillo 9/12 10 A Blanco', 'Interruptor PVC sencillo 9/12 10 A', 1945),
  ('3.1', 'Asfalto en Frío en bolsas de 20 kilos', 'Asfalto en frío', 9208),
  ('3.2', 'Yeso 25 kg', 'Yeso', 8330),
  ('3.3', 'Yeso espuma 25 kg', 'Yeso espuma', 7913),
  ('3.4', 'Cemento 25 kg', 'Cemento', 8281),
  ('3.5', 'Mortero piso 25 kilos', 'Mortero piso', 3996),
  ('4.1', 'Clavo corriente acero 2", 1 kg', 'Clavo corriente acero 2"', 3835),
  ('4.2', 'Clavo corriente acero 3", 1kg', 'Clavo corriente acero 3"', 2688),
  ('4.3', 'Clavo corriente acero 4", 1kg', 'Clavo corriente acero 4"', 2688),
  ('4.4', 'Tornillo volcanita 2 1/2" en 6mm, 100 unidades', 'Tornillo volcanita 2 1/2" en 6mm, 100 unidades', 6630),
  ('4.5', 'Tornillo volcanita 2 1/2" en 6mm, 100 unidades', 'Tornillo volcanita 2 1/2" en 6mm, 100 unidades', 6630),
  ('4.6', 'Tornillo techo 1 1/2" con sello en 12mm, 100 unidades', 'Tornillo techo 1 1/2" con sello en 12mm, 100 unidades', 5321),
  ('4.7', 'Tornillo techo 2 1/2" con sello en 12mm, 100 unidades', 'Tornillo techo 2 1/2" con sello en 12mm, 100 unidades', 8427),
  ('4.8', 'Perno de anclaje 1/4 x 2 1/4", 100 unidades', 'Perno de anclaje 1/4 x 2 1/4"', 10432),
  ('5.1', 'Perfil cuadrado 100x100 mm en 5mm, tira de 6 mt', 'Perfil cuadrado 100x100 mm en 5mm, tira de 6 mt', 111701),
  ('5.2', 'Perfil cuadrado 50x50 mm en 5mm, tira de 6 mt', 'Perfil cuadrado 50x50 mm en 5mm, tira de 6 mt', 47300),
  ('5.3', 'Perfil cuadrado 40x40 mm en 5mm, tira de 6 mt', 'Perfil cuadrado 40x40 mm en 5mm, tira de 6 mt', 38640),
  ('5.4', 'Perfil cuadrado 25x25 mm en 1,5mm, tira de 6 mt', 'Perfil cuadrado 25x25 mm en 1,5mm, tira de 6 mt', 10400),
  ('5.5', 'Perfil cuadrado 20x20 mm en 1,5mm, tira de 6 mt', 'Perfil cuadrado 20x20 mm en 1,5mm, tira de 6 mt', 8948),
  ('5.6', 'Soldadura 6011 3/32", 1 Kg', 'Soldadura 6011 3/32", 1 Kg', 4328),
  ('6.1', 'Aislante Fisiterm estándar 55 mm. X 120 x 15 x 18 mts.', 'Aislante Fisiterm estándar', 12667),
  ('6.2', 'Plancha polietileno expandido 1x0,5 mt de 80 mm, 8 unidades', 'Plancha polietileno expandido 1x0,5 mt de 80 mm, 8 unidades', 16084),
  ('6.3', 'Plancha polietileno expandido de 100 mm', 'Plancha polietileno expandido 100 mm', 3207),
  ('6.4', 'Rollo Papel Fieltro de 40 m2 (10/40)', 'Rollo Papel Fieltro de 40 m2 (10/40)', 4979),
  ('6.5', 'Rollo Papel Fieltro de 16 m2 (10/16)', 'Rollo Papel Fieltro de 16 m2 (10/16)', 7533),
  ('6.6', 'Aislante lana poliester 55 mm. X 0.60 x 10 mts.', 'Aislante lana poliester 55 mm. X 0.60 x 10 mts.', 6106),
  ('6.7', 'Espuma de poliuretano de 500 ml', 'Espuma de poliuretano de 500 ml', 6404),
  ('7.1', 'Tablero OSB de 2,44m x 1,22m x 9,5mm', 'Tablero OSB de 2,44m x 1,22m x 9,5mm', 10955),
  ('7.2', 'Tablero Terciado estructural de 2,44m x 1,22m x 18 mm', 'Tablero Terciado estructural de 2,44m x 1,22m x 18 mm', 23759),
  ('7.3', 'Plancha Yeso-Cartón de 2,4mt x 1,2mt x 8 mm estándar', 'Plancha Yeso-Cartón de 2,4mt x 1,2mt x 8 mm estándar', 11540),
  ('7.4', 'Plancha Yeso-Cartón de 2,4mt x 1,2mt x 10 mm estándar', 'Plancha Yeso-Cartón de 2,4mt x 1,2mt x 10 mm estándar', 10513),
  ('7.5', 'Fibrocemento RH de 2,42mt x 1,2mt x 4 mm', 'Fibrocemento RH de 2,42mt x 1,2mt x 4 mm', 9735),
  ('7.6', 'Tablero Terciado Ranurado de 1,22mt x 2,44mt x 6 mm', 'Tablero Terciado Ranurado de 1,22mt x 2,44mt x 6 mm', 18216),
  ('8.1', 'Sellante elástico poliuretano 11-fc gris poliuretano 300 ml', 'Sellante elástico poliuretano 11-FC', 4849),
  ('8.2', 'Silicona vidrios y ventanas 300 ml', 'Silicona vidrios y ventanas 300 ml', 6740),
  ('8.3', 'Silicona baño y cocina blanca 300 ml', 'Silicona baño y cocina blanca 300 ml', 4189),
  ('8.4', 'Pistola calafatear metálica alta resistencia', 'Pistola calafatear metálica', 3272),
  ('9.1', 'Tineta Pintura alto trafico alquidica o acrilica colores blanca-amarilla-azul', 'Tineta Pintura alto trafico alquidica o acrilica colores blanca-amarilla-azul', 97467),
  ('9.2', 'Esmalte Sintético Varios colores galón', 'Esmalte Sintético Varios colores', 29841),
  ('9.3', 'Esmalte al Agua galón', 'Esmalte al agua', 14610),
  ('9.4', 'Oleo brillante blanco galón', 'Óleo brillante blanco', 24358),
  ('9.5', 'Barniz Marino galón', 'Barniz marino', 23139),
  ('9.6', 'Pasta muro blanca tineta 20 kilos', 'Pasta muro blanca', 21921),
  ('9.7', 'Aguarrás mineral 5 litros', 'Aguarrás mineral', 17639),
  ('9.8', 'Diluyente sintético 5 litros', 'Diluyente sintético', 17639),
  ('9.9', 'Brocha 1 1/2"', 'Brocha 1 1/2"', 650),
  ('9.10', 'Brocha 3"', 'Brocha 3"', 951),
  ('9.11', 'Brocha 4"', 'Brocha 4"', 3033),
  ('9.12', 'Rodillo de esponja de 23cm', 'Rodillo de esponja 23 cm', 1633),
  ('9.13', 'Rodillo de chiporro de 23cm', 'Rodillo de chiporro 23 cm', 2725),
  ('9.14', 'Lija madera 80', 'Lija madera grano 80', 458),
  ('9.15', 'Lija madera 100', 'Lija madera grano 100', 226),
  ('9.16', 'Lija metal 80', 'Lija metal grano 80', 983),
  ('9.17', 'Lija metal 100', 'Lija metal grano 100', 983),
  ('9.18', 'Aceite lubricante de motor 10 W 30 galón', 'Aceite lubricante 10W30', 15239),
  ('10.1', 'Plancha de zinc alum de 5v (3,50 mt x 0,895 mt x 0,35 mm)', 'Plancha zinc alum 5V', 11296),
  ('10.2', 'Plancha de zinc alum de ondas (3,66 mt x 0,851 mt x 0,35 mm)', 'Plancha zinc alum ondas', 10808),
  ('11.1', 'Bizcocho 1,8 mt x 25mt, galvanizada', 'Malla bizcocho galvanizada', 23761),
  ('11.2', 'Acma de 3,7mm x 1,85 mt x 3mt, galvanizada', 'Malla Acma galvanizada 3,7 mm', 12158),
  ('11.3', 'Acma de 5mt (15X15mm), galvanizada', 'Malla Acma galvanizada 15x15 mm', 12132),
  ('12.1', 'Tubo de hormigón L, (600mm x 1 mt)', 'Tubo de hormigón tipo L', 17839),
  ('13.1', 'Bolsas de basura carga pesada 110 x 120 y 110 x 130 cm.', 'Bolsas de basura carga pesada', 2051),
  ('13.2', 'Escobas 5 costuras', 'Escoba 5 costuras', 3238),
  ('13.3', 'Basureros Industrial 240 litros con ruedas', 'Basureros Industrial 240 litros con ruedas', 13650),
  ('13.4', 'Contenedores Indsutrial 660 litros con ruedas', 'Contenedor industrial 660 litros', 85838),
  ('13.5', 'Barre hojas plasticos 22 o más dientes', 'Barre hojas plástico', 2726),
  ('13.6', 'Herbicida Bidon 20 litros', 'Herbicida sistémico', 55283),
  ('13.7', 'Jabón potasico en bae de 5 litros', 'Jabón potásico', 3965),
  ('13.8', 'Pala con mango con goma', 'Pala con mango con goma', 1087),
  ('13.9', 'Aspersores de Riego', 'Aspersor de riego', 907),
  ('13.10', 'Mangueras 1/2 rollos de 100 metros', 'Manguera 1/2" 100 m', 13158),
  ('13.11', 'Mangueras 3/4 rollos de 100 metros', 'Manguera 3/4" 100 m', 38230),
  ('13.12', 'Conectores de 1/2 plasticos', 'Conector 1/2" plástico', 2163),
  ('13.13', 'Conector 3/4 plasticos', 'Conector 3/4" plástico', 2382),
  ('13.14', 'Nylon orilladora 2,7 mm rollo 500 m redondo', 'Nylon orilladora 2,7 mm', 32762);

drop table if exists _usados;
create temp table _usados (item text);

-- 1) nombre idéntico (a cualquiera de los dos nombres del ítem). Si un artículo
--    calzara con ítems de precios distintos, se deja sin tocar.
with pares as (
  select a.id as articulo_id, min(l.item) as item, min(l.precio_neto) as precio,
         count(distinct l.precio_neto) as n_precios
  from articulo a
  join _lista_precios l
    on public._norm_desc(a.descripcion) in (public._norm_desc(l.descripcion), public._norm_desc(l.ficha))
  group by a.id
),
upd as (
  update articulo a
  set precio_neto = p.precio
  from pares p
  where a.id = p.articulo_id and p.n_precios = 1
  returning p.item
)
insert into _usados select item from upd;

insert into _usados
select distinct l.item
from _lista_precios l
join articulo a
  on public._norm_desc(a.descripcion) in (public._norm_desc(l.descripcion), public._norm_desc(l.ficha));

-- 2) lo que falta: un nombre es el comienzo del otro y el precio no es ambiguo
with pares as (
  select a2.id as articulo_id, min(l.item) as item, min(l.precio_neto) as precio
  from articulo a2
  join _lista_precios l
    on public._norm_desc(l.descripcion) like public._norm_desc(a2.descripcion) || '%'
    or public._norm_desc(a2.descripcion) like public._norm_desc(l.descripcion) || '%'
    or public._norm_desc(l.ficha) like public._norm_desc(a2.descripcion) || '%'
    or public._norm_desc(a2.descripcion) like public._norm_desc(l.ficha) || '%'
  where a2.precio_neto is null
    and length(public._norm_desc(a2.descripcion)) >= 8
  group by a2.id
  having count(distinct l.precio_neto) = 1
),
upd as (
  update articulo a
  set precio_neto = p.precio
  from pares p
  where a.id = p.articulo_id
  returning p.item
)
insert into _usados select item from upd;

drop function if exists public._norm_desc(text);

commit;

-- =====================================================================
-- REPORTE (se muestra al correr el script):
--   LISTA SIN CALZAR    = producto del listado de precios que no encontró su
--                         producto en el catálogo (nombre distinto o no existe).
--   ARTICULO SIN PRECIO = producto del catálogo que quedó sin precio.
-- Completa los que falten en Catálogo (editar el artículo y poner su precio).
-- =====================================================================
select 'LISTA SIN CALZAR' as tipo, l.item, l.descripcion, l.precio_neto
from _lista_precios l
where l.item not in (select item from _usados)
union all
select 'ARTICULO SIN PRECIO', null, a.descripcion, null
from articulo a
where a.precio_neto is null
order by 1, 2;

-- Resumen: select count(*) filter (where precio_neto is not null) as con_precio, count(*) as total from articulo;
