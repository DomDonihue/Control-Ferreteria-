# Notificaciones por correo (Director y ITO)

Envía un correo real cuando:
- se ingresa una solicitud → al **Director de Obras** (rol `lector_operativo`)
- el Director la aprueba → al **ITO** (rol `admin_ito`)

El código ya está listo en [notificar-solicitud-edge-function.ts](notificar-solicitud-edge-function.ts).
Estos son los pasos para activarlo (los haces tú, una sola vez):

## 1. Cuenta de Resend (servicio de envío de correos, gratis)
1. Crea una cuenta en https://resend.com
2. En el panel, ve a **API Keys** → crea una y cópiala (la vas a necesitar en el paso 3).
3. (Opcional pero recomendado) Verifica tu dominio (ej. `donihue.cl`) en **Domains** para que el correo salga de una dirección oficial. Mientras no lo verifiques, puedes probar con `onboarding@resend.dev`, pero Resend solo dejará enviar a tu propio correo de la cuenta (modo sandbox).

## 2. Instala el CLI de Supabase y conecta el proyecto
En una terminal, dentro de esta carpeta del proyecto:

```bash
npm install -g supabase
supabase login
supabase init
supabase link --project-ref TU_PROJECT_REF
```

`TU_PROJECT_REF` es el id de tu proyecto (se ve en la URL del panel de Supabase: `https://supabase.com/dashboard/project/<ese-id>`).

## 3. Crea y despliega la función
```bash
supabase functions new notificar-solicitud
```
Esto crea `supabase/functions/notificar-solicitud/index.ts`. Reemplaza su contenido completo por el de [notificar-solicitud-edge-function.ts](notificar-solicitud-edge-function.ts).

Configura los secretos (no se suben a GitHub, quedan solo en Supabase):
```bash
supabase secrets set RESEND_API_KEY=tu_api_key_de_resend
supabase secrets set NOTIF_FROM_EMAIL="Control Ferretería <notificaciones@donihue.cl>"
```

Despliega (sin exigir login de usuario, porque la llama un webhook interno, no una persona):
```bash
supabase functions deploy notificar-solicitud --no-verify-jwt
```

## 4. Crea el Database Webhook
En el panel de Supabase: **Database → Webhooks → Create a new hook**
- Name: `notificar-solicitud`
- Table: `solicitud`
- Events: marca **Insert** y **Update**
- Type: **Supabase Edge Functions**
- Edge Function: `notificar-solicitud`
- Method: `POST`
- Guarda.

## 5. Prueba
1. Ingresa una solicitud nueva → el Director (usuario con rol `lector_operativo`) debe recibir un correo.
2. Apruébala desde la cuenta del Director → el ITO (usuario con rol `admin_ito`) debe recibir el correo de aviso.
3. Si algo no llega, revisa los logs de la función: `supabase functions logs notificar-solicitud`.

## Notas
- Esto es aparte del aviso "en la app" (la campanita 🔔) que ya existe — ambos pueden convivir.
- Si más adelante cambias los roles o agregas más de un Director/ITO, no hay que tocar nada: la función busca a **todos** los usuarios con ese rol en `perfiles`.
- El correo se envía usando el **service role** de Supabase (clave privada), que vive solo en los secretos de la función — nunca en el repositorio público.
