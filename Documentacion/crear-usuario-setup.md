# Crear usuarios desde la app (Usuarios → Crear usuario)

El formulario ya está en la pestaña **Usuarios** (solo admin). Permite crear cuentas
con perfil **ITO**, **Director de Obras** o **DAF**. El perfil Administrador no se
crea desde la app: se mantiene como está.

Para que funcione hay que desplegar UNA vez la función del servidor
([crear-usuario-edge-function.ts](crear-usuario-edge-function.ts)). Es necesaria
porque crear cuentas exige la clave privada `service_role`, que nunca debe ir en
el sitio público.

## Pasos (los haces tú, con tu cuenta de Supabase)

1. Instala el CLI y conecta el proyecto (si ya lo hiciste para las notificaciones, salta este paso):
   ```bash
   npm install -g supabase
   supabase login
   supabase init
   supabase link --project-ref ccdzkeqweqrbciqbpdwj
   ```
2. Crea la función y pega el código:
   ```bash
   supabase functions new crear-usuario
   ```
   Reemplaza el contenido de `supabase/functions/crear-usuario/index.ts` por el de
   [crear-usuario-edge-function.ts](crear-usuario-edge-function.ts).
3. Despliega (esta SÍ verifica el login: no uses `--no-verify-jwt`):
   ```bash
   supabase functions deploy crear-usuario
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY` ya las entrega
   Supabase a la función; no hay que configurarlas.

## Prueba
Entra como administrador → **Usuarios** → "Crear usuario": nombre, correo, perfil,
clave provisoria → Crear. La persona entra con ese correo y esa clave y el sistema
le pide definir una nueva.
