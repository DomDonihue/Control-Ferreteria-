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
-- Cómo calza: compara la descripción sin tildes ni signos; primero idéntica y
-- luego si una es el comienzo de la otra (solo si el calce es único). Lo que
-- no calce NO se toca: el reporte final lo muestra y el precio se completa a
-- mano en Catálogo (el Administrador puede editar el precio de cada artículo).
--
-- Se puede correr de nuevo si cambian los precios (vuelve a escribir los
-- precios de los productos que calzan).
-- Correr UNA vez en el SQL Editor de Supabase, ANTES de usar la versión
-- nueva de la app (la app lee esta columna).
-- =====================================================================

begin;

alter table articulo add column if not exists precio_neto numeric;

create or replace function public._norm_desc(t text)
returns text language sql immutable as $$
  select regexp_replace(
           translate(lower(coalesce(t, '')), 'áéíóúüñ', 'aeiouun'),
           '[^a-z0-9]+', '', 'g')
$$;

drop table if exists _lista_precios;
create temp table _lista_precios (item text, descripcion text, precio_neto numeric);
insert into _lista_precios (item, descripcion, precio_neto) values
  ('1.1', 'Tubo PVC 20mm de 6 mt', 2824),
  ('1.2', 'Tubo PVC 25mm de 6 mt', 3853),
  ('1.3', 'Tubo PVC 32mm de 6 mt', 4290),
  ('1.4', 'Tubo PVC Sanitario Gris 75mm de 3mt', 7206),
  ('1.5', 'Tubo PVC Sanitario Gris 75mm de 6mt', 11365),
  ('1.6', 'Tubo PVC Sanitario Gris 110mm de 3mt', 10344),
  ('1.7', 'Tubo PVC Sanitario Gris 110mm de 6mt', 12173),
  ('1.8', 'Codo 87,5º PVC Sanitario Gris de 75mm', 2163),
  ('1.9', 'Codo 87,5º PVC Sanitario Gris de 110mm', 3037),
  ('1.10', 'Cañería de cobre agua 1/2" 3mt', 17759),
  ('1.11', 'Cañería de cobre agua 1/2" 6mt', 31912),
  ('1.12', 'Cañería de cobre agua 3/4" 3mt', 31425),
  ('1.13', 'Cañería de cobre agua 3/4" 6mt', 52383),
  ('1.14', 'Llave de jardín HE 1/2" x 1/2"plg', 1947),
  ('1.15', 'Adhesivo en pote para PVC 240cc', 3516),
  ('1.16', 'Adhesivo en pomo para PVC 60cc', 2818),
  ('1.17', 'Sifón lavamanos', 2677),
  ('1.18', 'Sifón lavaplatos', 3680),
  ('1.19', 'Flexible de agua 25 cm', 1793),
  ('2.1', 'Luminarias Publicas solares de 150 wts.', 16326),
  ('2.2', 'Interruptor Automático 1x25A', 3058),
  ('2.3', 'Cable de cobre tipo eva 1,5 mm rojo, blanco y verde / 100 mt', 13328),
  ('2.4', 'Cable de cobre tipo eva 2,5 mm rojo, blanco y verde / 100 mt', 21470),
  ('2.5', 'Alambre NYA 1,5 mm rojo, blanco y verde /100 mt', 12291),
  ('2.6', 'Alambre NYA 2,5 mm rojo, blanco y verde /100 mt', 21168),
  ('2.7', 'Tuberia PVC CONDUIT 20 mm x 3 mt', 1485),
  ('2.8', 'Caja Distribución PVC Rectangular negra de embutir', 1404),
  ('2.9', 'Caja Distribución PVC Rectangular Naranja de embutir', 1092),
  ('2.10', 'Caja Chuqui plástica PVC Rectangular', 1290),
  ('2.11', 'Tapa Ciega PVC Rectangular', 130),
  ('2.12', 'Placa Armada PVC Enchufe Sencillo', 2304),
  ('2.13', 'Placa Armada PVC Enchufe Doble', 835),
  ('2.14', 'Placa Armada PVC Enchufe Triple', 1406),
  ('2.15', 'Enchufe PVC Enchufe Sencillo blanco', 2499),
  ('2.16', 'Enchufe PVC Enchufe doble blanco', 881),
  ('2.17', 'Enchufe PVC Enchufe Triple blanco', 2347),
  ('2.18', 'Interruptor PVC Sencillo 9/12 10 A Blanco', 1945),
  ('3.1', 'Asfalto en Frío en bolsas de 20 kilos', 9208),
  ('3.2', 'Yeso 25 kg', 8330),
  ('3.3', 'Yeso espuma 25 kg', 7913),
  ('3.4', 'Cemento 25 kg', 8281),
  ('3.5', 'Mortero piso 25 kilos', 3996),
  ('4.1', 'Clavo corriente acero 2", 1 kg', 3835),
  ('4.2', 'Clavo corriente acero 3", 1kg', 2688),
  ('4.3', 'Clavo corriente acero 4", 1kg', 2688),
  ('4.4', 'Tornillo volcanita 2 1/2" en 6mm, 100 unidades', 6630),
  ('4.5', 'Tornillo volcanita 2 1/2" en 6mm, 100 unidades', 6630),
  ('4.6', 'Tornillo techo 1 1/2" con sello en 12mm, 100 unidades', 5321),
  ('4.7', 'Tornillo techo 2 1/2" con sello en 12mm, 100 unidades', 8427),
  ('4.8', 'Perno de anclaje 1/4 x 2 1/4", 100 unidades', 10432),
  ('5.1', 'Perfil cuadrado 100x100 mm en 5mm, tira de 6 mt', 111701),
  ('5.2', 'Perfil cuadrado 50x50 mm en 5mm, tira de 6 mt', 47300),
  ('5.3', 'Perfil cuadrado 40x40 mm en 5mm, tira de 6 mt', 38640),
  ('5.4', 'Perfil cuadrado 25x25 mm en 1,5mm, tira de 6 mt', 10400),
  ('5.5', 'Perfil cuadrado 20x20 mm en 1,5mm, tira de 6 mt', 8948),
  ('5.6', 'Soldadura 6011 3/32", 1 Kg', 4328),
  ('6.1', 'Aislante Fisiterm estándar 55 mm. X 120 x 15 x 18 mts.', 12667),
  ('6.2', 'Plancha polietileno expandido 1x0,5 mt de 80 mm, 8 unidades', 16084),
  ('6.3', 'Plancha polietileno expandido de 100 mm', 3207),
  ('6.4', 'Rollo Papel Fieltro de 40 m2 (10/40)', 4979),
  ('6.5', 'Rollo Papel Fieltro de 16 m2 (10/16)', 7533),
  ('6.6', 'Aislante lana poliester 55 mm. X 0.60 x 10 mts.', 6106),
  ('6.7', 'Espuma de poliuretano de 500 ml', 6404),
  ('7.1', 'Tablero OSB de 2,44m x 1,22m x 9,5mm', 10955),
  ('7.2', 'Tablero Terciado estructural de 2,44m x 1,22m x 18 mm', 23759),
  ('7.3', 'Plancha Yeso-Cartón de 2,4mt x 1,2mt x 8 mm estándar', 11540),
  ('7.4', 'Plancha Yeso-Cartón de 2,4mt x 1,2mt x 10 mm estándar', 10513),
  ('7.5', 'Fibrocemento RH de 2,42mt x 1,2mt x 4 mm', 9735),
  ('7.6', 'Tablero Terciado Ranurado de 1,22mt x 2,44mt x 6 mm', 18216),
  ('8.1', 'Sellante elástico poliuretano 11-fc gris poliuretano 300 ml', 4849),
  ('8.2', 'Silicona vidrios y ventanas 300 ml', 6740),
  ('8.3', 'Silicona baño y cocina blanca 300 ml', 4189),
  ('8.4', 'Pistola calafatear metálica alta resistencia', 3272),
  ('9.1', 'Tineta Pintura alto trafico alquidica o acrilica colores blanca-amarilla-azul', 97467),
  ('9.2', 'Esmalte Sintético Varios colores galón', 29841),
  ('9.3', 'Esmalte al Agua galón', 14610),
  ('9.4', 'Oleo brillante blanco galón', 24358),
  ('9.5', 'Barniz Marino galón', 23139),
  ('9.6', 'Pasta muro blanca tineta 20 kilos', 21921),
  ('9.7', 'Aguarrás mineral 5 litros', 17639),
  ('9.8', 'Diluyente sintético 5 litros', 17639),
  ('9.9', 'Brocha 1 1/2"', 650),
  ('9.10', 'Brocha 3"', 951),
  ('9.11', 'Brocha 4"', 3033),
  ('9.12', 'Rodillo de esponja de 23cm', 1633),
  ('9.13', 'Rodillo de chiporro de 23cm', 2725),
  ('9.14', 'Lija madera 80', 458),
  ('9.15', 'Lija madera 100', 226),
  ('9.16', 'Lija metal 80', 983),
  ('9.17', 'Lija metal 100', 983),
  ('9.18', 'Aceite lubricante de motor 10 W 30 galón', 15239),
  ('10.1', 'Plancha de zinc alum de 5v (3,50 mt x 0,895 mt x 0,35 mm)', 11296),
  ('10.2', 'Plancha de zinc alum de ondas (3,66 mt x 0,851 mt x 0,35 mm)', 10808),
  ('11.1', 'Bizcocho 1,8 mt x 25mt, galvanizada', 23761),
  ('11.2', 'Acma de 3,7mm x 1,85 mt x 3mt, galvanizada', 12158),
  ('11.3', 'Acma de 5mt (15X15mm), galvanizada', 12132),
  ('12.1', 'Tubo de hormigón L, (600mm x 1 mt)', 17839),
  ('13.1', 'Bolsas de basura carga pesada 110 x 120 y 110 x 130 cm.', 2051),
  ('13.2', 'Escobas 5 costuras', 3238),
  ('13.3', 'Basureros Industrial 240 litros con ruedas', 13650),
  ('13.4', 'Contenedores Indsutrial 660 litros con ruedas', 85838),
  ('13.5', 'Barre hojas plasticos 22 o más dientes', 2726),
  ('13.6', 'Herbicida Bidon 20 litros', 55283),
  ('13.7', 'Jabón potasico en bae de 5 litros', 3965),
  ('13.8', 'Pala con mango con goma', 1087),
  ('13.9', 'Aspersores de Riego', 907),
  ('13.10', 'Mangueras 1/2 rollos de 100 metros', 13158),
  ('13.11', 'Mangueras 3/4 rollos de 100 metros', 38230),
  ('13.12', 'Conectores de 1/2 plasticos', 2163),
  ('13.13', 'Conector 3/4 plasticos', 2382),
  ('13.14', 'Nylon orilladora 2,7 mm rollo 500 m redondo', 32762);

drop table if exists _usados;
create temp table _usados (item text);

-- 1) descripción idéntica (si la lista repite una descripción, 4.4 y 4.5, vale
--    el mismo precio)
update articulo a
set precio_neto = l.precio_neto
from (
  select distinct on (public._norm_desc(descripcion)) *
  from _lista_precios
  order by public._norm_desc(descripcion), item
) l
where public._norm_desc(a.descripcion) = public._norm_desc(l.descripcion);

insert into _usados
select distinct l.item
from _lista_precios l
join articulo a on public._norm_desc(a.descripcion) = public._norm_desc(l.descripcion);

-- 2) una descripción es el comienzo de la otra y el calce es único
with pares as (
  select a2.id as articulo_id, min(l.item) as item
  from articulo a2
  join _lista_precios l
    on public._norm_desc(l.descripcion) like public._norm_desc(a2.descripcion) || '%'
    or public._norm_desc(a2.descripcion) like public._norm_desc(l.descripcion) || '%'
  where a2.precio_neto is null
    and length(public._norm_desc(a2.descripcion)) >= 8
  group by a2.id
  having count(distinct l.item) = 1
),
upd as (
  update articulo a
  set precio_neto = l.precio_neto
  from pares p join _lista_precios l on l.item = p.item
  where a.id = p.articulo_id
  returning l.item
)
insert into _usados select item from upd;

drop function if exists public._norm_desc(text);

commit;

-- =====================================================================
-- REPORTE (se muestra al correr el script):
--   LISTA SIN CALZAR    = producto de la lista de precios que no encontró su
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
