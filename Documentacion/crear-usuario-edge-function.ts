// =====================================================================
// Control Ferretería — Crear usuario desde la pestaña "Usuarios" (admin)
// =====================================================================
//
// La app (navegador) no puede crear cuentas de Supabase Auth: eso exige la
// clave privada service_role, que NUNCA debe estar en el sitio público.
// Esta función corre en el servidor de Supabase, comprueba que quien la
// llama sea 'admin' y recién ahí crea la cuenta + su fila en `perfiles`.
//
// Despliegue: ver Documentacion/crear-usuario-setup.md
// =====================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Solo estos roles se pueden crear desde la app. 'admin' no.
const ROLES_PERMITIDOS = ["admin_ito", "lector_operativo", "lector_pagos"];

const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const authHeader = req.headers.get("Authorization") || "";

    // 1) ¿Quién llama? (con su propio token)
    const quien = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: u } = await quien.auth.getUser();
    if (!u?.user) return json({ error: "No autenticado" }, 401);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // 2) ¿Es administrador?
    const { data: yo } = await admin.from("perfiles").select("rol").eq("id", u.user.id).maybeSingle();
    if (yo?.rol !== "admin") return json({ error: "Solo el administrador puede crear usuarios" }, 403);

    // 3) Validar datos
    const { nombre, email, rol, unidad_id, clave } = await req.json();
    const correo = String(email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) return json({ error: "Correo inválido" }, 400);
    if (!String(nombre || "").trim()) return json({ error: "Falta el nombre" }, 400);
    if (!ROLES_PERMITIDOS.includes(rol)) return json({ error: "Rol no permitido" }, 400);
    if (String(clave || "").length < 8) return json({ error: "La clave provisoria debe tener al menos 8 caracteres" }, 400);

    // 4) Crear la cuenta (queda confirmada: no depende de un correo de verificación)
    const { data: nuevo, error: errCrear } = await admin.auth.admin.createUser({
      email: correo,
      password: clave,
      email_confirm: true,
    });
    if (errCrear || !nuevo?.user) return json({ error: errCrear?.message || "No se pudo crear la cuenta" }, 400);

    // 5) Su perfil, con clave provisoria (la app obliga a cambiarla al entrar)
    const { error: errPerfil } = await admin.from("perfiles").upsert({
      id: nuevo.user.id,
      nombre: String(nombre).trim(),
      rol,
      unidad_id: unidad_id || null,
      debe_cambiar_clave: true,
    });
    if (errPerfil) return json({ error: "Cuenta creada, pero falló el perfil: " + errPerfil.message }, 500);

    return json({ ok: true, id: nuevo.user.id });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
