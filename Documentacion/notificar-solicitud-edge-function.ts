// =====================================================================
// Control Ferretería — Notificación por correo
// =====================================================================
//
// Se dispara con un Database Webhook de Supabase sobre la tabla
// `solicitud`:
//   - INSERT pendiente de tipo 'operaciones' -> avisa al ITO (admin_ito)
//     que hay una solicitud de Obras por VISAR (V°B°).
//   - INSERT pendiente (otro tipo), INSERT visada, o UPDATE a 'visada'
//     -> avisa al Director de Obras (rol lector_operativo) que hay una
//     solicitud por APROBAR.
//   - UPDATE a estado='aprobada'     -> avisa al ITO (rol admin_ito)
//     que ya puede tramitarla con la empresa.
//
// El enlace de acceso a la plataforma sale del secreto NOTIF_APP_URL
// (si no existe, usa el de GitHub Pages). Para cambiarlo:
//   supabase secrets set NOTIF_APP_URL="https://tu-enlace/"
//
// Seguridad: la función se despliega sin login (la llama un webhook, no una
// persona). Si defines el secreto NOTIF_WEBHOOK_SECRET, solo atiende las
// llamadas que traigan el encabezado  x-webhook-secret  con ese valor
// (se agrega en el webhook, en "HTTP Headers"). Así nadie más puede
// disparar correos.
//
// Usa Resend (resend.com) para enviar el correo. Ver
// Documentacion/notificaciones-email-setup.md para cómo desplegar esto.
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("NOTIF_FROM_EMAIL") || "Control Ferretería <onboarding@resend.dev>";
const APP_URL = Deno.env.get("NOTIF_APP_URL") || "https://domdonihue.github.io/Control-Ferreteria-/";
const WEBHOOK_SECRET = Deno.env.get("NOTIF_WEBHOOK_SECRET") || "";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function emailsPorRol(rol: string): Promise<string[]> {
  const { data: perfiles } = await supabase.from("perfiles").select("id").eq("rol", rol);
  if (!perfiles?.length) return [];
  const emails: string[] = [];
  for (const p of perfiles) {
    const { data } = await supabase.auth.admin.getUserById(p.id);
    if (data?.user?.email) emails.push(data.user.email);
  }
  return emails;
}

// ---- Envío por Microsoft 365 (Graph) ---------------------------------
// Si están los cuatro secretos MS_*, el correo sale desde el buzón MS_SENDER
// de la Municipalidad. Si no, se usa Resend como antes.
const MS_TENANT_ID = Deno.env.get("MS_TENANT_ID") || "";
const MS_CLIENT_ID = Deno.env.get("MS_CLIENT_ID") || "";
const MS_CLIENT_SECRET = Deno.env.get("MS_CLIENT_SECRET") || "";
const MS_SENDER = Deno.env.get("MS_SENDER") || "";
const USA_GRAPH = !!(MS_TENANT_ID && MS_CLIENT_ID && MS_CLIENT_SECRET && MS_SENDER);

let tokenGraph: { valor: string; vence: number } | null = null;
async function obtenerTokenGraph(): Promise<string> {
  if (tokenGraph && Date.now() < tokenGraph.vence) return tokenGraph.valor;
  const r = await fetch(`https://login.microsoftonline.com/${MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: MS_CLIENT_ID,
      client_secret: MS_CLIENT_SECRET,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error("Token de Microsoft: " + (j.error_description || r.status));
  tokenGraph = { valor: j.access_token, vence: Date.now() + (Number(j.expires_in || 3600) - 120) * 1000 };
  return tokenGraph.valor;
}

async function enviarPorGraph(to: string[], asunto: string, texto: string) {
  const r = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(MS_SENDER)}/sendMail`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${await obtenerTokenGraph()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        subject: asunto,
        body: { contentType: "Text", content: texto },
        toRecipients: to.map((address) => ({ emailAddress: { address } })),
      },
      saveToSentItems: false,
    }),
  });
  if (!r.ok) console.error("Graph respondió", r.status, await r.text());
}

async function enviarCorreo(to: string[], asunto: string, texto: string) {
  if (!to.length) return;
  if (USA_GRAPH) return enviarPorGraph(to, asunto, texto);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject: asunto, text: texto }),
  });
  if (!r.ok) console.error("Resend respondió", r.status, await r.text());
}

// Cuerpo común: qué pasó, de qué solicitud y el enlace para entrar.
function mensaje(saludo: string, accion: string, record: Record<string, unknown>, numero: unknown): string {
  const detalle = [
    `N° de solicitud: ${numero}`,
    record?.solicitante ? `Solicita: ${record.solicitante}` : "",
    record?.motivo ? `Motivo: ${record.motivo}` : "",
  ].filter(Boolean).join("\n");
  return `${saludo}\n\n${accion}\n\n${detalle}\n\nIngresa a la plataforma: ${APP_URL}\n\n— Control Ferretería, Municipalidad de Doñihue (aviso automático, no responder a este correo)`;
}

Deno.serve(async (req) => {
  try {
    if (WEBHOOK_SECRET && req.headers.get("x-webhook-secret") !== WEBHOOK_SECRET) {
      return new Response(JSON.stringify({ error: "no autorizado" }), { status: 401 });
    }
    const payload = await req.json();
    const { type, record, old_record } = payload;

    const numero = record?.correlativo || record?.n_solicitud || record?.id;

    // Solicitud de la Dirección de Obras creada por un usuario de Obras:
    // primero la visa el ITO.
    // (también cuando el usuario la corrige y la reenvía después de una devolución)
    if ((type === "INSERT" && record?.estado === "pendiente" && record?.tipo === "operaciones") ||
        (type === "UPDATE" && old_record?.estado === "devuelta" && record?.estado === "pendiente" && record?.tipo === "operaciones")) {
      await enviarCorreo(
        await emailsPorRol("admin_ito"),
        `Nueva solicitud por visar — N° ${numero}`,
        mensaje("Hola,", "Tienes una nueva solicitud de la Dirección de Obras por visar (V°B°).", record, numero),
      );
    }

    // Las demás solicitudes pendientes van directo al Director; las de Obras
    // le llegan cuando el ITO las visa (o si las crea el propio ITO ya visadas).
    const llegaAlDirector =
      (type === "INSERT" && record?.estado === "pendiente" && record?.tipo !== "operaciones") ||
      (type === "INSERT" && record?.estado === "visada") ||
      (type === "UPDATE" && record?.estado === "visada" && old_record?.estado !== "visada");
    if (llegaAlDirector) {
      await enviarCorreo(
        await emailsPorRol("lector_operativo"),
        `Nueva solicitud por aprobar — N° ${numero}`,
        mensaje("Hola,", "Tienes una nueva solicitud de materiales por aprobar.", record, numero),
      );
    }

    // Devuelta para corregir: avisa a los usuarios de Obras de esa dirección.
    if (type === "UPDATE" && record?.estado === "devuelta" && old_record?.estado !== "devuelta") {
      const { data: perfiles } = await supabase.from("perfiles").select("id")
        .eq("rol", "solicitante_obras").eq("unidad_id", record.unidad_id);
      const emails: string[] = [];
      for (const p of perfiles || []) {
        const { data } = await supabase.auth.admin.getUserById(p.id);
        if (data?.user?.email) emails.push(data.user.email);
      }
      await enviarCorreo(
        emails,
        `Solicitud devuelta para corregir — N° ${numero}`,
        mensaje("Hola,", `Tu solicitud fue devuelta para que la corrijas y la reenvíes. Motivo: ${record?.motivo_devolucion || "—"}`, record, numero),
      );
    }

    if (type === "UPDATE" && record?.estado === "aprobada" && old_record?.estado !== "aprobada") {
      await enviarCorreo(
        await emailsPorRol("admin_ito"),
        `Solicitud aprobada, lista para tramitar — N° ${numero}`,
        mensaje("Hola,", "El Director de Obras aprobó esta solicitud y ya puedes tramitarla con la empresa.", record, numero),
      );
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
