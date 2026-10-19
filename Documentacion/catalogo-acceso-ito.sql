-- =====================================================================
-- Control Ferretería — El ITO puede editar el Catálogo (tabla articulo)
-- =====================================================================
--
-- Hasta ahora solo 'admin' podía insertar/editar artículos. Esto agrega
-- 'admin_ito' (Encargado de Operaciones) a esa política. La lectura sigue
-- abierta a todos los usuarios autenticados.
--
-- Es idempotente. Correr UNA vez en el SQL Editor de Supabase.
-- =====================================================================

begin;

drop policy if exists "articulo admin" on articulo;
create policy "articulo admin" on articulo for all
  using (public.rol_actual() in ('admin', 'admin_ito'))
  with check (public.rol_actual() in ('admin', 'admin_ito'));

commit;
