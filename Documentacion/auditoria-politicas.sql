-- =====================================================================
-- Control Ferretería — Auditoría de seguridad (SOLO LECTURA)
-- =====================================================================
--
-- No cambia nada. Devuelve UNA tabla con los hallazgos de seguridad de la
-- base de datos. Córrela cuando quieras revisar el estado (por ejemplo
-- después de seguridad-endurecimiento.sql) y pégame el resultado para
-- interpretarlo.
--
-- Cómo leerla (columna "categoria"):
--   TABLA SIN RLS                      -> grave: cualquiera con la clave pública
--                                         podría leer o escribir esa tabla.
--   POLITICA ABIERTA                   -> grave: la política deja pasar a todos.
--   DEPOSITO PUBLICO                   -> los archivos se abren con solo
--                                         conocer el enlace.
--   ANON TIENE PRIVILEGIOS             -> el rol sin sesión tiene permisos sobre
--                                         esa tabla (la seguridad depende solo
--                                         de las políticas).
--   FUNCION SIN search_path            -> función con privilegios elevados sin
--                                         fijar su ruta de búsqueda.
--   VISTA SIN security_invoker         -> la vista no respeta la seguridad de las
--                                         tablas que lee (muestra a todos lo mismo).
--   ACCESO A CUALQUIER AUTENTICADO     -> informativo: lecturas abiertas a todo
--                                         usuario con sesión (algunas son a propósito,
--                                         p. ej. el catálogo). Decide si cada una
--                                         corresponde.
--   USUARIOS PENDIENTES                -> cuentas creadas sin rol asignado.
-- =====================================================================

select 'TABLA SIN RLS' as categoria, c.relname::text as objeto,
       'row level security desactivada' as detalle
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity

union all
select 'POLITICA ABIERTA', (tablename || ' · ' || policyname)::text,
       (cmd || ' | using: ' || coalesce(qual, '-') || ' | check: ' || coalesce(with_check, '-'))::text
from pg_policies
where schemaname in ('public', 'storage')
  and (coalesce(qual, '') in ('true', '(true)') or coalesce(with_check, '') in ('true', '(true)'))

union all
select 'DEPOSITO PUBLICO', id::text, 'los archivos se pueden abrir con solo conocer el enlace'
from storage.buckets
where public

union all
select 'ANON TIENE PRIVILEGIOS', table_name::text, string_agg(privilege_type, ', ')
from information_schema.role_table_grants
where grantee = 'anon' and table_schema = 'public'
group by table_name

union all
select 'FUNCION SIN search_path', p.proname::text, 'security definer sin "set search_path"'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) cfg where cfg like 'search_path=%')

union all
select 'VISTA SIN security_invoker', c.relname::text, 'la vista no respeta la seguridad de las tablas de origen'
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'v'
  and not coalesce((select option_value = 'true' from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false)

union all
select 'ACCESO A CUALQUIER AUTENTICADO', (tablename || ' · ' || policyname)::text,
       (cmd || ' | ' || coalesce(qual, with_check, ''))::text
from pg_policies
where schemaname in ('public', 'storage')
  and coalesce(qual, with_check, '') ~* 'authenticated'
  and coalesce(qual, with_check, '') !~* 'rol_actual'

union all
select 'USUARIOS PENDIENTES', count(*)::text, 'cuentas con rol pendiente (sin asignar)'
from public.perfiles
where rol = 'pendiente'

order by 1, 2;

-- =====================================================================
-- OPCIONAL — ver TODAS las políticas para revisarlas una por una:
--
-- select schemaname, tablename, policyname, cmd, roles, qual, with_check
-- from pg_policies
-- where schemaname in ('public', 'storage')
-- order by schemaname, tablename, cmd, policyname;
-- =====================================================================
