// =====================================================================
// Control Ferretería — Notificación por correo
// =====================================================================
//
// Se dispara con un Database Webhook de Supabase sobre la tabla
// `solicitud`:
//   - INSERT pendiente de tipo 'operaciones' -> avisa al ITO (admin_ito)
//     que hay una solicitud de Obras por revisar.
//   - INSERT pendiente (otro tipo), INSERT visada, o UPDATE a 'visada'
//     -> avisa al Director de Obras (rol lector_operativo) que hay una
//     solicitud por su V°B°.
//   - UPDATE a estado='aprobada'     -> avisa al ITO (rol admin_ito)
//     que ya puede tramitarla con la empresa.
//
// Usa Resend (resend.com) para enviar el correo. Ver
// Documentacion/notificaciones-email-setup.md para cómo desplegar esto.
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const FROM_EMAIL = Deno.env.get("NOTIF_FROM_EMAIL") || "Control Ferretería <onboarding@resend.dev>";
const APP_URL = Deno.env.get("NOTIF_APP_URL") || "https://domdonihue.github.io/Control-Ferreteria-/";

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

async function enviarCorreo(to: string[], asunto: string, texto: string) {
  if (!to.length) return;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM_EMAIL, to, subject: asunto, text: texto }),
  });
}

Deno.serve(async (req) => {
  try {
    const payload = await req.json();
    const { type, record, old_record } = payload;

    const numero = record?.correlativo || record?.n_solicitud || record?.id;

    // Solicitud de la Dirección de Obras creada por un usuario de Obras:
    // primero la revisa el ITO.
    if (type === "INSERT" && record?.estado === "pendiente" && record?.tipo === "operaciones") {
      const emails = await emailsPorRol("admin_ito");
      await enviarCorreo(
        emails,
        "Solicitud de la Dirección de Obras por revisar",
        `Hay una nueva solicitud de Obras (N° ${numero}) esperando tu revisión y V°B°.\n\nRevísala en Control Ferretería: ${APP_URL}`,
      );
    }

    // Las demás solicitudes pendientes van directo al Director; las de Obras
    // le llegan cuando el ITO las visa (o si las crea el propio ITO ya visadas).
    const llegaAlDirector =
      (type === "INSERT" && record?.estado === "pendiente" && record?.tipo !== "operaciones") ||
      (type === "INSERT" && record?.estado === "visada") ||
      (type === "UPDATE" && record?.estado === "visada" && old_record?.estado !== "visada");
    if (llegaAlDirector) {
      const emails = await emailsPorRol("lector_operativo");
      await enviarCorreo(
        emails,
        "Nueva solicitud de materiales pendiente de V°B°",
        `Hay una nueva solicitud de materiales (N° ${numero}) esperando tu visto bueno.\n\nRevísala en Control Ferretería: ${APP_URL}`,
      );
    }

    if (type === "UPDATE" && record?.estado === "aprobada" && old_record?.estado !== "aprobada") {
      const emails = await emailsPorRol("admin_ito");
      await enviarCorreo(
        emails,
        "Solicitud aprobada — lista para tramitar",
        `La solicitud N° ${record.correlativo || record.n_solicitud || record.id} fue aprobada por el Director de Obras y ya puedes tramitarla con la empresa.\n\nRevísala en Control Ferretería: ${APP_URL}`,
      );
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
