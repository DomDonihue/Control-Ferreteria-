-- =====================================================================
-- Control Ferretería — Firma de V°B° del Director de Obras
-- =====================================================================
--
-- Bucket PRIVADO "firmas" con un solo objeto fijo: director.png
-- (se sube y se reemplaza desde la pestaña "Convenio / ferretería", solo
-- admin). El PDF oficial de una solicitud YA APROBADA la descarga con una
-- URL firmada de 60 segundos y la estampa junto a "V°B° Director de Obras".
--
-- OJO: la imagen NUNCA se sube al repositorio de GitHub (es público) — vive
-- solo acá, en Supabase Storage, con lectura restringida a usuarios
-- autenticados de este sistema.
--
-- Correr UNA vez en el SQL Editor.
-- =====================================================================

begin;

insert into storage.buckets (id, name, public)
values ('firmas', 'firmas', false)
on conflict (id) do update set public = false;

drop policy if exists "firmas admin sube"         on storage.objects;
drop policy if exists "firmas admin actualiza"    on storage.objects;
drop policy if exists "firmas admin borra"        on storage.objects;
drop policy if exists "firmas lectura autenticada" on storage.objects;

create policy "firmas admin sube" on storage.objects for insert
  with check (bucket_id = 'firmas' and public.rol_actual() = 'admin');

create policy "firmas admin actualiza" on storage.objects for update
  using (bucket_id = 'firmas' and public.rol_actual() = 'admin')
  with check (bucket_id = 'firmas' and public.rol_actual() = 'admin');

create policy "firmas admin borra" on storage.objects for delete
  using (bucket_id = 'firmas' and public.rol_actual() = 'admin');

-- Lectura autenticada: necesaria para que createSignedUrl() funcione al
-- generar el PDF (lo hace cualquier usuario logueado, no solo admin).
create policy "firmas lectura autenticada" on storage.objects for select
  using (bucket_id = 'firmas' and auth.role() = 'authenticated');

commit;

-- =====================================================================
-- PRUEBA
--   1. Entra como admin -> Convenio / ferretería -> sube una imagen en
--      "Firma de V°B° — Director de Obras".
--   2. Abre un expediente con una solicitud APROBADA y descarga
--      "Generar solicitud de materiales (PDF)": debe salir la imagen
--      estampada arriba de la línea "V°B° Director de Obras".
--   3. Una solicitud pendiente (no aprobada) no debe llevar la imagen
--      (el botón de descarga además está deshabilitado hasta la aprobación).
-- =====================================================================
