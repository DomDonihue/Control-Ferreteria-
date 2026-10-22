// =====================================================================
// Kárdex Ferretería — app mínima conectada a Supabase.
// Sin framework, sin paso de compilación: se sube tal cual a GitHub
// Pages. Toda la seguridad real la hacen las políticas RLS del
// esquema — este archivo solo arma pantallas y hace consultas.
// =====================================================================

// Se lee ANTES de crear el cliente: supabase-js consume y borra el #hash del
// enlace del correo (recuperar clave / invitación) apenas arranca.
const _hashEnlace = location.hash;
let _llegoPorEnlaceClave = /type=(recovery|invite)/.test(_hashEnlace);
const _errorEnlace = /error_code=otp_expired|error=access_denied/.test(_hashEnlace);

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let perfilActual = null; // { id, nombre, rol, unidad_id }

// Anti doble-clic: mientras un guardado está en vuelo, ignora cualquier
// otro. Sin esto, dos clics seguidos en "Guardar" insertan dos guías /
// dos facturas / dos descuentos del convenio.
let _enviando = false;
const _lock = () => (_enviando ? false : (_enviando = true));
const _unlock = () => { _enviando = false; };

const money = (n) => "$" + Number(n || 0).toLocaleString("es-CL");
// Número visible de una solicitud: el correlativo automático (SM-2026-001 / OP-2026-001).
const numSol = (s) => s.correlativo || (s.n_solicitud != null ? String(s.n_solicitud) : "");
// Escapa TODO lo que rompe HTML: se usa tanto para texto dentro de `innerHTML`
// como para valores de atributos. Sin esto, un campo libre (motivo, ubicación,
// descripción…) que un solicitante escribe con `<img onerror=…>` corre como
// script en la sesión de quien abre el expediente (Director, DAF, Alcalde).
const esc = (v) => String(v ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

// ---------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------
async function iniciar() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    await cargarPerfilYArmarApp(session.user);
  } else {
    mostrarLogin();
  }
}

function mostrarLogin() {
  document.getElementById("pantalla-login").classList.remove("oculto");
  document.getElementById("app").classList.add("oculto");
  if (sessionStorage.getItem("cierre_inactividad")) {
    sessionStorage.removeItem("cierre_inactividad");
    const e = document.getElementById("login-error");
    e.textContent = "Se cerró la sesión por inactividad. Vuelve a ingresar.";
    e.classList.remove("oculto");
  } else if (sessionStorage.getItem("clave_nueva_ok")) {
    sessionStorage.removeItem("clave_nueva_ok");
    const e = document.getElementById("login-ok");
    e.textContent = "Tu clave quedó creada. Ingresa con tu correo y la clave nueva.";
    e.classList.remove("oculto");
  } else if (_errorEnlace) {
    const e = document.getElementById("login-error");
    e.textContent = "El enlace del correo venció o ya fue usado. Pide al administrador que te envíe uno nuevo.";
    e.classList.remove("oculto");
  }
}

// ---------------------------------------------------------------------
// Cierre automático por inactividad (seguridad: equipo desatendido)
// ---------------------------------------------------------------------
const MINUTOS_INACTIVIDAD = 20;
let _ultimaActividad = Date.now();
let _timerInactividad = null;
let _avisoInactividad = null;

function _marcarActividad() {
  _ultimaActividad = Date.now();
  if (_avisoInactividad) { _avisoInactividad.remove(); _avisoInactividad = null; }
}

async function _revisarInactividad() {
  const inactivo = Date.now() - _ultimaActividad;
  const limite = MINUTOS_INACTIVIDAD * 60000;
  if (inactivo >= limite) {
    clearInterval(_timerInactividad); _timerInactividad = null;
    sessionStorage.setItem("cierre_inactividad", "1");
    try { await sb.auth.signOut(); } catch (e) {}
    location.reload();
  } else if (inactivo >= limite - 60000 && !_avisoInactividad) {
    _avisoInactividad = document.createElement("div");
    _avisoInactividad.className = "aviso-inactividad";
    _avisoInactividad.textContent =
      "Tu sesión se cerrará por inactividad en 1 minuto. Toca la pantalla o el teclado para seguir conectado.";
    document.body.appendChild(_avisoInactividad);
  }
}

function iniciarControlInactividad() {
  if (_timerInactividad) return; // ya está activo
  // OJO: no incluye "mousemove" a propósito — un movimiento involuntario del
  // cursor mantendría la sesión abierta para siempre. Cuenta como actividad
  // un clic, tecla, scroll o toque real.
  ["pointerdown", "keydown", "wheel", "scroll", "touchstart"]
    .forEach(ev => window.addEventListener(ev, _marcarActividad, { passive: true, capture: true }));
  // Al volver a la pestaña tras un rato, revisa de inmediato (por si el
  // navegador frenó el timer mientras estaba en segundo plano).
  document.addEventListener("visibilitychange", () => { if (!document.hidden) _revisarInactividad(); });

  _timerInactividad = setInterval(_revisarInactividad, 20000);
}

document.getElementById("btn-login").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-clave").value;
  const errorEl = document.getElementById("login-error");
  errorEl.classList.add("oculto");

  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) {
    errorEl.textContent = "No se pudo ingresar: " + error.message;
    errorEl.classList.remove("oculto");
    return;
  }
  await cargarPerfilYArmarApp(data.user);
});

document.getElementById("btn-olvide").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const errorEl = document.getElementById("login-error");
  const okEl = document.getElementById("login-ok");
  errorEl.classList.add("oculto"); okEl.classList.add("oculto");
  if (!email) {
    errorEl.textContent = "Escribe tu correo arriba y vuelve a pulsar «¿Olvidaste tu clave?».";
    errorEl.classList.remove("oculto");
    return;
  }
  const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  if (error) {
    errorEl.textContent = "No se pudo enviar el correo: " + error.message;
    errorEl.classList.remove("oculto");
    return;
  }
  okEl.textContent = "Si el correo está registrado, te enviamos un enlace para crear una clave nueva. Revisa también la carpeta de spam.";
  okEl.classList.remove("oculto");
});

document.getElementById("btn-logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

document.getElementById("notif-badge").addEventListener("click", () => {
  irATab(document.getElementById("notif-badge").dataset.ir);
});

// ---------------------------------------------------------------------
// Aviso "en la app" de lo pendiente para el rol de cada uno (sin correo):
// al Director le avisa cuántas solicitudes esperan su V°B°, al ITO cuántas
// ya están aprobadas y listas para tramitar con la empresa. Se recalcula al
// entrar, cada 90 s, y después de aprobar/rechazar o ingresar una solicitud.
// ---------------------------------------------------------------------
let _timerNotif = null;

function iniciarNotificaciones() {
  actualizarNotificaciones();
  if (_timerNotif) return;
  _timerNotif = setInterval(actualizarNotificaciones, 90000);
}

async function actualizarNotificaciones() {
  const btn = document.getElementById("notif-badge");
  if (!btn || !perfilActual) return;
  const rol = rolEfectivo();
  const partes = [];
  try {
    if (["admin", "lector_operativo"].includes(rol)) {
      // Para el Director: las visadas por el ITO y las pendientes que no son de Obras.
      const { count } = await sb.from("solicitud").select("id", { count: "exact", head: true })
        .or("estado.eq.visada,and(estado.eq.pendiente,tipo.neq.operaciones)");
      if (count) partes.push({ n: count, texto: `${count} solicitud${count === 1 ? "" : "es"} esperando tu V°B°`, ir: "solicitudes" });
    }
    if (["admin", "admin_ito"].includes(rol)) {
      const { count: porRevisar } = await sb.from("solicitud").select("id", { count: "exact", head: true })
        .eq("estado", "pendiente").eq("tipo", "operaciones");
      if (porRevisar) partes.push({ n: porRevisar, texto: `${porRevisar} solicitud${porRevisar === 1 ? "" : "es"} de Obras por revisar`, ir: "solicitudes" });
      const { count: porEmitir } = await sb.from("proceso_cotizacion").select("id", { count: "exact", head: true }).eq("estado", "borrador");
      if (porEmitir) partes.push({ n: porEmitir, texto: `${porEmitir} solicitud${porEmitir === 1 ? "" : "es"} de cotización por emitir`, ir: "procesos" });
    }
    if (["admin", "admin_ito"].includes(rol)) {
      const { count } = await sb.from("solicitud").select("id", { count: "exact", head: true }).eq("estado", "aprobada");
      if (count) partes.push({ n: count, texto: `${count} aprobada${count === 1 ? "" : "s"}, lista${count === 1 ? "" : "s"} para tramitar con la empresa`, ir: "expedientes" });
    }
  } catch {
    return; // sin conexión momentánea: no molesta, se reintenta solo
  }
  if (!partes.length) { btn.classList.add("oculto"); return; }
  btn.textContent = `🔔 ${partes.reduce((a, p) => a + p.n, 0)}`;
  btn.title = partes.map(p => p.texto).join(" · ");
  btn.dataset.ir = partes[0].ir;
  btn.classList.remove("oculto");
}

// Simula el clic en la pestaña del menú (los botones se arman en armarTabs()).
function irATab(id) {
  document.querySelector(`#tabs button[data-tab-id="${id}"]`)?.click();
}

async function cargarPerfilYArmarApp(user) {
  let { data: perfil } = await sb.from("perfiles").select("*").eq("id", user.id).maybeSingle();

  // Primer ingreso: crear un perfil "pendiente" para que aparezca en la
  // pestaña Usuarios y el admin_ito le asigne rol y unidad.
  if (!perfil) {
    const { data: nuevo } = await sb.from("perfiles")
      .insert({ id: user.id, nombre: user.email, rol: "pendiente", debe_cambiar_clave: true })
      .select()
      .single();
    perfil = nuevo;
  }

  if (!perfil) {
    document.getElementById("login-error").textContent =
      "Tu cuenta no tiene un perfil asignado y no se pudo crear uno. Pide al administrador que te agregue en la tabla 'perfiles'.";
    document.getElementById("login-error").classList.remove("oculto");
    mostrarLogin();
    return;
  }
  perfilActual = perfil;
  rolVista = null;
  document.getElementById("pantalla-login").classList.add("oculto");
  document.getElementById("app").classList.remove("oculto");
  document.getElementById("quien-soy").textContent = `${perfil.nombre} · ${etiquetaRol(perfil.rol)}`;
  montarSelectorRolVista();
  _ultimaActividad = Date.now();
  iniciarControlInactividad();
  iniciarNotificaciones();

  // Clave provisoria, o llegó desde el enlace del correo (recuperar clave /
  // invitación): obliga a definir una clave nueva antes de seguir.
  if (perfil.debe_cambiar_clave || _llegoPorEnlaceClave) {
    document.getElementById("tabs").innerHTML = "";
    vistaCambiarClave(true);
  } else {
    armarTabs();
  }
}

// ---------------------------------------------------------------------
// Cambiar contraseña. obligatorio=true bloquea el resto hasta cambiarla.
// ---------------------------------------------------------------------
async function vistaCambiarClave(obligatorio) {
  vista().innerHTML = `
    <div class="card" style="max-width:460px">
      <h3 style="margin-top:0">${obligatorio ? "Crea tu nueva clave" : "Cambiar clave"}</h3>
      ${obligatorio ? `<p class="hint">Define una clave nueva para continuar.</p>` : ""}
      <label>Nueva clave</label>
      <input id="cc-1" type="password" autocomplete="new-password" placeholder="8 o más caracteres, con letras y números">
      <label>Repite la nueva clave</label>
      <input id="cc-2" type="password" autocomplete="new-password">
      <button class="primario" id="cc-guardar">Guardar clave</button>
      <p class="error oculto" id="cc-error"></p>
      <p class="ok-msg oculto" id="cc-ok"></p>
    </div>
  `;
  document.getElementById("cc-guardar").addEventListener("click", async () => {
    const errorEl = document.getElementById("cc-error");
    const okEl = document.getElementById("cc-ok");
    errorEl.classList.add("oculto"); okEl.classList.add("oculto");

    const c1 = document.getElementById("cc-1").value;
    const c2 = document.getElementById("cc-2").value;
    if (!/^[A-Za-z0-9]{8,}$/.test(c1) || !/[A-Za-z]/.test(c1) || !/[0-9]/.test(c1)) {
      errorEl.textContent = "La clave debe tener al menos 8 caracteres, solo letras y números, con al menos una letra y un número.";
      errorEl.classList.remove("oculto"); return;
    }
    if (c1 !== c2) { errorEl.textContent = "Las dos claves no coinciden."; errorEl.classList.remove("oculto"); return; }

    const { error } = await sb.auth.updateUser({ password: c1 });
    if (error) { errorEl.textContent = "No se pudo cambiar: " + error.message; errorEl.classList.remove("oculto"); return; }

    await sb.rpc("marcar_clave_cambiada");        // requiere la función del README
    perfilActual.debe_cambiar_clave = false;
    _llegoPorEnlaceClave = false;
    history.replaceState(null, "", location.pathname);

    okEl.textContent = obligatorio
      ? "Clave actualizada. Te llevamos al ingreso para que entres con tu clave nueva…"
      : "Clave actualizada.";
    okEl.classList.remove("oculto");
    if (obligatorio) {
      sessionStorage.setItem("clave_nueva_ok", "1");
      setTimeout(async () => {
        try { await sb.auth.signOut(); } catch (e) {}
        location.reload();
      }, 1500);
    }
  });
}

// Selector "Ver como…" en el encabezado. Solo para el admin: previsualiza la
// interfaz con los permisos de otro rol, sin tocar la BD (las escrituras
// siguen gobernadas por RLS). Los demás perfiles solo ven sus pantallas.
function montarSelectorRolVista() {
  const previo = document.getElementById("rol-vista");
  if (previo) previo.remove();
  if (perfilActual.rol !== "admin") return;

  const base = perfilActual.rol;
  const sel = document.createElement("select");
  sel.id = "rol-vista";
  sel.className = "rol-vista";
  sel.title = "Previsualizar la interfaz como otro rol";
  sel.innerHTML =
    `<option value="">Ver como… (${etiquetaRol(base)})</option>` +
    Object.entries(ROLES)
      .filter(([v]) => v !== base && v !== "admin" && v !== "pendiente")
      .map(([v, t]) => `<option value="${v}">Ver como: ${t}</option>`)
      .join("");
  sel.addEventListener("change", () => {
    rolVista = sel.value || null;
    const etiqueta = rolVista ? ` · viendo como ${etiquetaRol(rolVista)}` : "";
    document.getElementById("quien-soy").textContent =
      `${perfilActual.nombre} · ${etiquetaRol(perfilActual.rol)}${etiqueta}`;
    armarTabs();
  });

  const cont = document.querySelector("header .usuario");
  cont.insertBefore(sel, cont.firstChild);
}

const ROLES = {
  pendiente: "Pendiente de asignación",
  admin: "Administrador de plataforma",
  admin_ito: "Encargado de Operaciones (ITO)",
  solicitante: "Solicitante",
  solicitante_obras: "Solicitante Dirección de Obras",
  lector_operativo: "Director de Obras",
  lector_pagos: "DAF",
  lector_ejecutivo: "Alcalde",
};

function etiquetaRol(rol) {
  return ROLES[rol] || rol;
}

// Capacidades:
//  - admin      = administrador total (maneja usuarios, catálogo, toda la plataforma).
//  - admin_ito  = operación (crea solicitudes, aprueba/rechaza, genera compras),
//                 pero NO administra usuarios ni catálogo.
//
// rolVista: solo para el admin, previsualiza la interfaz "como si fuera" otro rol.
// No cambia nada en la base de datos ni los permisos RLS reales.
let rolVista = null;
const rolEfectivo  = () => rolVista || (perfilActual && perfilActual.rol);
const esAdminTotal = () => rolEfectivo() === "admin";
const puedeOperar  = () => ["admin", "admin_ito"].includes(rolEfectivo());
const esDirector   = () => ["admin", "lector_operativo"].includes(rolEfectivo());
// Roles de control que pueden auditar la bitácora (no el ITO ni el Alcalde).
const puedeVerBitacora = () => ["admin", "lector_operativo", "lector_pagos"].includes(rolEfectivo());

// IVA Chile
const IVA = 0.19;
const calcIva   = (neto) => Math.round(Number(neto || 0) * IVA);
const calcBruto = (neto) => Number(neto || 0) + calcIva(neto);

// ---------------------------------------------------------------------
// Iconos de línea (SVG) para el menú lateral y las tarjetas del Resumen
// ---------------------------------------------------------------------
const ICONOS = {
  resumen:     `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 10.5 10 4l7 6.5"/><path d="M5 9v7h10V9"/></svg>`,
  nueva:       `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="2.5" width="12" height="15" rx="1.5"/><path d="M7 7h6M7 10h6M10 13.5v3M8.3 15h3.4"/></svg>`,
  especial:    `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="2.5" width="12" height="15" rx="1.5"/><path d="M10 6.5v4M10 13h.01"/></svg>`,
  solicitudes: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 6h12M4 10h12M4 14h8"/></svg>`,
  expedientes: `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M3 6.5h5l1.5 2H17V16H3z"/></svg>`,
  convenio:    `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 3h8l4 4v10H4z"/><path d="M12 3v4h4"/></svg>`,
  catalogo:    `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="14" height="12" rx="1.5"/><path d="M3 8h14"/></svg>`,
  usuarios:    `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7.5" cy="7" r="2.5"/><path d="M2.5 16c0-2.5 2.2-4 5-4s5 1.5 5 4"/><circle cx="14.5" cy="7.5" r="2"/><path d="M17.5 16c0-2-1.5-3.3-3.3-3.8"/></svg>`,
  clave:       `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="10" r="3.5"/><path d="M10 8.7 17 8.7M15 8.7v3M12.5 8.7v2"/></svg>`,
  wallet:      `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2.5" y="5" width="15" height="11" rx="2"/><path d="M2.5 8h15"/><circle cx="14" cy="11.5" r="1"/></svg>`,
  bag:         `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 7h10l1 9H4z"/><path d="M7 7V5.5a3 3 0 0 1 6 0V7"/></svg>`,
  shield:      `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M10 2.5 16.5 5v5c0 4-3 6.7-6.5 7.5C6.5 16.7 3.5 14 3.5 10V5z"/><path d="M7.3 10 9 11.7l3.7-3.9"/></svg>`,
  percent:     `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 5 5 15"/><circle cx="6.5" cy="6.5" r="1.8"/><circle cx="13.5" cy="13.5" r="1.8"/></svg>`,
  bitacora:    `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="10" cy="10" r="7"/><path d="M10 6v4l3 2"/></svg>`,
};

// ---------------------------------------------------------------------
// Tabs — qué ve cada rol. `grupo` agrupa visualmente el menú lateral
// (null = ítem suelto arriba, como "Inicio").
// ---------------------------------------------------------------------
const TABS = [
  { id: "resumen", label: "Inicio", grupo: null, icono: "resumen", roles: ["admin", "admin_ito", "solicitante", "solicitante_obras", "lector_operativo", "lector_pagos", "lector_ejecutivo"], render: vistaResumen },
  { id: "nueva", label: "Nueva solicitud", grupo: "Gestión", icono: "nueva", roles: ["admin", "admin_ito", "solicitante"], render: vistaNuevaSolicitud },
  { id: "nueva-operaciones", label: "Solicitud Obras", grupo: "Gestión", icono: "nueva", roles: ["admin", "admin_ito", "solicitante_obras"], render: vistaNuevaSolicitudOperaciones },
  { id: "procesos", label: "Cotización Obras", grupo: "Gestión", icono: "nueva", roles: ["admin", "admin_ito", "solicitante_obras"], render: vistaProcesosCotizacion },
  { id: "cotizar", label: "Solicitar cotización", grupo: "Gestión", icono: "nueva", roles: ["admin", "admin_ito"], render: vistaCotizacionProveedor },
  { id: "solicitudes", label: "Solicitudes", grupo: "Gestión", icono: "solicitudes", roles: ["admin", "admin_ito", "solicitante", "solicitante_obras", "lector_operativo"], render: vistaSolicitudes },
  { id: "expedientes", label: "Expedientes", grupo: "Gestión", icono: "expedientes", roles: ["admin", "admin_ito", "lector_operativo", "lector_pagos"], render: vistaExpedientes },
  { id: "bitacora", label: "Bitácora", grupo: "Gestión", icono: "bitacora", roles: ["admin", "lector_operativo", "lector_pagos"], render: vistaBitacora },
  { id: "catalogo", label: "Catálogo", grupo: "Inventario", icono: "catalogo", roles: ["admin", "admin_ito"], render: vistaCatalogo },
  { id: "convenio", label: "Convenio / ferretería", grupo: "Administración", icono: "convenio", roles: ["admin"], render: vistaConvenio },
  { id: "usuarios", label: "Usuarios", grupo: "Administración", icono: "usuarios", roles: ["admin"], render: vistaUsuarios },
  { id: "clave", label: "Cambiar clave", grupo: "Mi cuenta", icono: "clave", roles: ["admin", "admin_ito", "solicitante", "solicitante_obras", "lector_operativo", "lector_pagos", "lector_ejecutivo"], render: () => vistaCambiarClave(false) },
];

function armarTabs() {
  const disponibles = TABS.filter(t => t.roles.includes(rolEfectivo()));
  const nav = document.getElementById("tabs");
  nav.innerHTML = "";

  if (!disponibles.length) {
    vista().innerHTML = `<div class="card">
      <h3>Cuenta pendiente</h3>
      <p>Tu cuenta ya está creada pero el administrador todavía no te asigna
      un rol ni una unidad. Vuelve a entrar cuando te avisen.</p>
    </div>`;
    return;
  }

  let grupoActual;
  disponibles.forEach((tab, i) => {
    if (tab.grupo !== grupoActual) {
      grupoActual = tab.grupo;
      if (grupoActual) {
        const h = document.createElement("div");
        h.className = "nav-grupo";
        h.textContent = grupoActual;
        nav.appendChild(h);
      }
    }
    const btn = document.createElement("button");
    btn.className = i === 0 ? "activo" : "";
    btn.dataset.tabId = tab.id;
    btn.innerHTML = `<span class="nav-ico">${ICONOS[tab.icono] || ""}</span><span>${tab.label}</span>`;
    btn.addEventListener("click", () => {
      nav.querySelectorAll("button").forEach(b => b.classList.remove("activo"));
      btn.classList.add("activo");
      tab.render();
    });
    nav.appendChild(btn);
  });
  disponibles[0].render();
}

const vista = () => document.getElementById("vista");

// ---------------------------------------------------------------------
// Resumen del convenio (todos los roles)
// ---------------------------------------------------------------------
async function vistaResumen() {
  vista().innerHTML = "<div class='card'>Cargando…</div>";
  const { data, error } = await sb.from("resumen_convenio").select("*").maybeSingle();
  if (error || !data) {
    vista().innerHTML = `<div class="card error">No se pudo cargar el resumen: ${error ? error.message : "sin convenio vigente"}</div>`;
    return;
  }
  const pct = Number(data.porcentaje_usado) || 0;
  const estadoClase = pct >= 95 ? "critical" : pct >= 80 ? "warn" : "ok";

  // Gráficos: si fallan (falta alguna tabla/permiso) el resumen igual se ve.
  const [{ data: facturas }, { data: solicitudes }] = await Promise.all([
    sb.from("factura").select("monto_bruto, solicitud(unidad(nombre))"),
    sb.from("solicitud").select("creado_en, unidad(nombre)"),
  ]);

  vista().innerHTML = `
    <div class="stat-row">
      <div class="stat"><div class="stat-ico blue">${ICONOS.wallet}</div><div class="label">Tope anual</div><div class="value">${money(data.tope_anual)}</div></div>
      <div class="stat"><div class="stat-ico gold">${ICONOS.bag}</div><div class="label">Comprometido</div><div class="value">${money(data.comprometido)}</div></div>
      <div class="stat ${estadoClase}"><div class="stat-ico green">${ICONOS.shield}</div><div class="label">Saldo disponible</div><div class="value">${money(data.saldo_disponible)}</div></div>
      <div class="stat ${estadoClase}"><div class="stat-ico purple">${ICONOS.percent}</div><div class="label">% usado</div><div class="value">${pct}%</div></div>
    </div>
    <div class="card">
      <strong>Proveedor:</strong> ${esc(data.proveedor)}
    </div>

    <div class="card">
      <h4 style="margin-top:0">Consumo del convenio</h4>
      <div class="charts">
        <div class="donut-wrap">
          ${svgDonut(pct)}
          <div class="legend">
            <span><i style="background:var(--gold)"></i>Comprometido</span>
            <span><i style="background:var(--surface-2);border:1px solid var(--border)"></i>Saldo</span>
          </div>
        </div>
        ${htmlBarrasPorUnidad(facturas || [], solicitudes || [], Number(data.tope_anual) || 0)}
      </div>
    </div>

    <div class="card">
      <h4 style="margin-top:0">Solicitudes por mes</h4>
      ${svgSolicitudesPorMes(solicitudes || [])}
    </div>
  `;

  // El nombre de unidad NO se mete en un onclick inline (rompería con una
  // comilla y era vector de inyección): se pasa por data-* y se engancha aquí.
  vista().querySelectorAll(".bar-click").forEach(el => {
    el.addEventListener("click", () => vistaExpedientes(el.dataset.unidad));
  });
}

// ---------- Gráficos del Resumen (con datos reales de Supabase) ----------
function svgDonut(pct) {
  const r = 54, c = 2 * Math.PI * r;
  const dash = Math.max(0, Math.min(100, pct)) / 100 * c;
  return `
    <div class="donut" title="${pct}% del convenio comprometido">
      <svg width="140" height="140" viewBox="0 0 140 140" aria-label="${pct}% del convenio usado">
        <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="16"/>
        <circle cx="70" cy="70" r="${r}" fill="none" stroke="var(--gold)" stroke-width="16"
                stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${c.toFixed(1)}"/>
      </svg>
      <div class="center"><b>${pct}%</b><small>usado</small></div>
    </div>
  `;
}

function htmlBarrasPorUnidad(facturas, solicitudes, topeAnual) {
  const porUnidad = {};
  const fila = (nombre) => (porUnidad[nombre] = porUnidad[nombre] || { monto: 0, solicitudes: 0 });

  facturas.forEach(f => { fila(f.solicitud?.unidad?.nombre || "Sin unidad").monto += Number(f.monto_bruto || 0); });
  solicitudes.forEach(s => { fila(s.unidad?.nombre || "Sin unidad").solicitudes += 1; });

  const filas = Object.entries(porUnidad).sort((a, b) => b[1].monto - a[1].monto).slice(0, 8);
  if (!filas.length) return `<p class="hint">Todavía no hay solicitudes ni facturas para mostrar por unidad.</p>`;
  const max = Math.max(...filas.map(([, d]) => d.monto), 1);

  return `
    <div>
      <p class="hint" style="margin-top:0">Gasto facturado y solicitudes por unidad — haz clic en una para ver sus expedientes</p>
      <div class="bars">
        ${filas.map(([nombre, d]) => {
          const pct = topeAnual ? (d.monto / topeAnual * 100) : 0;
          const tip = `${nombre}: ${d.solicitudes} solicitud${d.solicitudes === 1 ? "" : "es"} · ${money(d.monto)} facturado` +
                      (topeAnual ? ` · ${pct.toFixed(1)}% del tope anual` : "");
          return `
          <div class="bar bar-click" title="${esc(tip)}" data-unidad="${esc(nombre)}">
            <span class="b-label">${esc(nombre)} <span class="b-count">${d.solicitudes}</span></span>
            <span class="b-track"><span class="b-fill" style="width:${Math.max(4, d.monto / max * 100)}%"></span></span>
            <span class="b-val">${money(d.monto)}${topeAnual ? `<small> · ${pct.toFixed(1)}%</small>` : ""}</span>
          </div>`;
        }).join("")}
      </div>
    </div>
  `;
}

function svgSolicitudesPorMes(solicitudes) {
  const meses = [];
  const hoy = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    meses.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString("es-CL", { month: "short" }), count: 0 });
  }
  solicitudes.forEach(s => {
    const key = (s.creado_en || "").slice(0, 7);
    const m = meses.find(m => m.key === key);
    if (m) m.count++;
  });

  const max = Math.max(1, ...meses.map(m => m.count));
  const W = 640, H = 150, PAD = 10;
  const step = W / (meses.length - 1);
  const yFor = (v) => H - PAD - (v / max) * (H - PAD * 2);
  const pts = meses.map((m, i) => [i * step, yFor(m.count)]);
  const linea = pts.map(p => p.join(",")).join(" L ");
  const area = `M0,${H} L ${linea} L ${W},${H} Z`;

  return `
    <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Solicitudes por mes">
      <line x1="0" y1="${H - PAD}" x2="${W}" y2="${H - PAD}" stroke="var(--grid)"/>
      <line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="var(--grid)"/>
      <path d="${area}" fill="var(--gold-tint)" opacity="0.7"/>
      <path d="M ${linea}" fill="none" stroke="var(--gold-deep)" stroke-width="3"/>
      ${pts.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === pts.length - 1 ? 7 : 5}" fill="var(--gold-deep)"${i === pts.length - 1 ? ' stroke="var(--surface)" stroke-width="2"' : ""}><title>${meses[i].label}: ${meses[i].count} solicitud${meses[i].count === 1 ? "" : "es"}</title></circle>`).join("")}
    </svg>
    <div class="spark-labels">${meses.map(m => `<span>${m.label}</span>`).join("")}</div>
  `;
}

// =====================================================================
// FORMULARIO ÚNICO DE SOLICITUD DE MATERIALES — DOM
// (Anexo A del Manual de Procedimientos). Cubre solicitudes normales y
// las "especiales" (producto fuera de catálogo) vía la casilla de la
// sección 5. Se puede cargar el PDF editable y autocompletar.
// =====================================================================
let lineasSolicitud = [];
let catalogoPorDesc = new Map(); // descripción normalizada → fila de `articulo` (para autocompletar unidad/artículo)

// Buscador del catálogo: filtra mientras se escribe (sin tildes, todas las
// palabras) y deja elegir de la lista. El contrato es solo por catálogo.
function montarBuscadorMaterial(inputId, resId, articulos) {
  const input = document.getElementById(inputId);
  const res = document.getElementById(resId);
  const norm = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const indice = articulos.map(a => ({ a, d: norm(a.descripcion) }));

  const pintar = () => {
    const palabras = norm(input.value).split(/\s+/).filter(Boolean);
    if (!palabras.length) { res.classList.add("oculto"); return; }
    const hits = indice.filter(x => palabras.every(p => x.d.includes(p))).slice(0, 10);
    res.innerHTML = hits.length
      ? hits.map((x, i) => `<button type="button" data-i="${i}">${esc(x.a.descripcion)}${x.a.unidad_medida ? ` <span class="hint">· ${esc(x.a.unidad_medida)}</span>` : ""}</button>`).join("")
      : `<div class="vacio">Sin resultados en el catálogo del contrato.</div>`;
    res.classList.remove("oculto");
    res.querySelectorAll("button").forEach(b => b.addEventListener("mousedown", (e) => {
      e.preventDefault();
      input.value = hits[Number(b.dataset.i)].a.descripcion;
      res.classList.add("oculto");
    }));
  };
  input.addEventListener("input", pintar);
  input.addEventListener("focus", pintar);
  input.addEventListener("blur", () => res.classList.add("oculto"));
}

async function vistaNuevaSolicitud() {
  const [{ data: articulos }, { data: unidades }] = await Promise.all([
    sb.from("articulo").select("id, descripcion, unidad_medida").order("descripcion"),
    sb.from("unidad").select("id, nombre").order("nombre"),
  ]);
  lineasSolicitud = [];

  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Formulario Único de Solicitud de Materiales — DOM</h3>
      <p class="hint">Contrato de suministro de ferretería · marco disponible $60.000.000.
        Complétalo en su totalidad; se adjunta como anexo al Memorándum de Solicitud.</p>

      <div style="border:1px dashed var(--border);border-radius:12px;padding:12px 14px;margin:12px 0;background:var(--surface-2)">
        <label style="margin-top:0">¿Ya tienes el Formulario Único en PDF editable? Cárgalo y se autocompleta</label>
        <input id="ns-pdf" type="file" accept="application/pdf">
        <p class="hint" id="ns-pdf-msg">Lee los campos del PDF y llena el formulario de abajo. Igual puedes revisarlo y corregirlo antes de enviar.</p>
      </div>

      <h4>1. Identificación del requerimiento</h4>
      <label>Fecha de solicitud</label>
      <input id="ns-fecha" type="date" value="${hoyISO()}">
      <p class="hint">El N° de solicitud (SM-AAAA-001) se asigna solo al ingresarla.</p>
      <label>Unidad solicitante</label>
      <select id="ns-unidad">
        <option value="">— selecciona —</option>
        ${(unidades || []).map(u => `<option value="${u.id}" ${u.id === perfilActual.unidad_id ? "selected" : ""}>${esc(u.nombre)}</option>`).join("")}
      </select>
      <label>Responsable del requerimiento</label>
      <input id="ns-solicitante" placeholder="Nombre y cargo">
      <label>Teléfono / correo de contacto</label>
      <input id="ns-contacto">
      <label>Responsable de supervisar la ejecución</label>
      <input id="ns-supervisor">
      <label>Ubicación de uso de los materiales</label>
      <textarea id="ns-ubicacion" rows="2" placeholder="Calle, número, sector"></textarea>

      <h4>2. Descripción y justificación técnica</h4>
      <label>Descripción del requerimiento (qué se solicita)</label>
      <textarea id="ns-desc" rows="2"></textarea>
      <label>Fundamento / motivo de la solicitud</label>
      <textarea id="ns-motivo" rows="2"></textarea>
      <label>Situación actual (diagnóstico)</label>
      <textarea id="ns-situacion" rows="2"></textarea>
      <label>Trabajo a ejecutar</label>
      <textarea id="ns-trabajo" rows="2"></textarea>

      <h4>3. Detalle de materiales solicitados</h4>
      <p class="hint">Solo material y cantidad. Los valores llegan después en las guías de despacho.</p>
      <div id="ns-lineas"></div>
      <div class="linea-detalle" style="grid-template-columns:3fr 1fr auto">
        <div class="buscador"><label>Material (buscar en el catálogo)</label><input id="ns-mat" placeholder="Escribe para buscar…" autocomplete="off"><div id="ns-mat-res" class="buscador-res oculto"></div></div>
        <div><label>Cantidad</label><input id="ns-cant" type="number" min="0" step="0.01"></div>
        <div><button class="secundario" id="ns-agregar" style="margin-top:0">+ Agregar</button></div>
      </div>
      <p class="error oculto" id="ns-mat-msg"></p>

      <h4>4. Respaldos adjuntos</h4>

      <label>Memo de solicitud (Memorándum)</label>
      <input id="ns-memo" type="file" accept=".pdf,.doc,.docx,image/*">

      <label class="chk"><input type="checkbox" id="ns-resp-foto"> Respaldo fotográfico</label>
      <div id="ns-foto-extra" class="oculto">
        <label>N° de fotografías: <input id="ns-num-fotos" type="number" min="0" class="chk-inline"></label>
        <input id="ns-foto" type="file" accept=".pdf,image/*">
        <p class="hint">PDF o imagen del daño / situación (máx. 10 MB). Si son varias fotos, únelas en un PDF.</p>
      </div>

      <label class="chk"><input type="checkbox" id="ns-resp-informe"> Informe técnico complementario / cubicación de materiales</label>
      <div id="ns-informe-extra" class="oculto">
        <input id="ns-informe-archivo" type="file" accept=".pdf,.doc,.docx,image/*">
        <p class="hint">Informe técnico / cubicación de materiales (PDF, Word o imagen, máx. 10 MB).</p>
      </div>

      <label class="chk"><input type="checkbox" id="ns-resp-presupuesto"> Presupuesto estimativo / planificación del trabajo</label>
      <div id="ns-presupuesto-extra" class="oculto">
        <input id="ns-presupuesto-archivo" type="file" accept=".pdf,.doc,.docx,image/*">
        <p class="hint">Presupuesto estimativo / planificación del trabajo (PDF, Word o imagen, máx. 10 MB).</p>
      </div>

      <label class="chk"><input type="checkbox" id="ns-resp-otro"> Otro:
        <input id="ns-resp-otro-texto" placeholder="especificar" class="chk-inline" style="width:220px"></label>

      <h4>5. Situaciones especiales</h4>
      <label class="chk"><input type="checkbox" id="ns-cdp-negativo"> Solicitud con CDP negativo (Manual, punto 8)</label>
      <div id="ns-cdp-extra" class="oculto">
        <input id="ns-cdp-archivo" type="file" accept=".pdf,.doc,.docx,image/*">
        <p class="hint" style="color:var(--warn)">Justificación jurídica reforzada del CDP negativo (PDF, Word o imagen, máx. 10 MB).</p>
      </div>
      <label class="chk"><input type="checkbox" id="ns-fuera-catalogo"> El producto NO figura en el catálogo cerrado del contrato (Manual, punto 10)</label>
      <div id="ns-especial-extra" class="oculto">
        <p class="hint" style="color:var(--warn)">Al marcar "fuera de catálogo" la solicitud entra como
          <strong>especial</strong>: la compra se tramita por Mercado Público. Adjunta la justificación
          y en el expediente completa la cotización, el decreto y la orden de compra.</p>
        <label>Adjuntar justificación de la solicitud (fuera de catálogo)</label>
        <input id="ns-just" type="file" accept=".pdf,.doc,.docx,image/*">
      </div>

      <button class="primario" id="ns-guardar">Ingresar solicitud</button>
      <p class="error oculto" id="ns-error"></p>
    </div>
  `;

  // Catálogo por descripción (normalizada). Quien solicita solo elige material
  // y cantidad; la unidad de medida NO se le pide (no tiene por qué saberla) —
  // si el material está en el catálogo, se guarda en silencio la unidad de las
  // bases técnicas para que aparezca después en el expediente y en la hoja
  // que se envía a la empresa.
  catalogoPorDesc = new Map(
    (articulos || []).map(a => [(a.descripcion || "").trim().toLowerCase(), a])
  );

  montarBuscadorMaterial("ns-mat", "ns-mat-res", articulos || []);

  document.getElementById("ns-agregar").addEventListener("click", () => {
    const mat = document.getElementById("ns-mat").value.trim();
    const cant = parseFloat(document.getElementById("ns-cant").value);
    const msg = document.getElementById("ns-mat-msg");
    msg.classList.add("oculto");
    if (!mat || !cant) return;
    const art = catalogoPorDesc.get(mat.toLowerCase());
    if (!art && !document.getElementById("ns-fuera-catalogo").checked) {
      msg.textContent = "Ese producto no está en el catálogo del contrato. Búscalo y elígelo de la lista (o marca \"fuera de catálogo\" en el punto 5).";
      msg.classList.remove("oculto");
      return;
    }
    lineasSolicitud.push({
      descripcion: art ? art.descripcion : mat,
      articulo_id: art ? art.id : null,
      cantidad_solicitada: cant,
      unidad_medida: (art && art.unidad_medida) || "",
    });
    ["ns-mat", "ns-cant"].forEach(id => document.getElementById(id).value = "");
    pintarLineas();
  });

  document.getElementById("ns-fuera-catalogo").addEventListener("change", (e) => {
    document.getElementById("ns-especial-extra").classList.toggle("oculto", !e.target.checked);
  });
  [
    ["ns-resp-foto", "ns-foto-extra"],
    ["ns-resp-informe", "ns-informe-extra"],
    ["ns-resp-presupuesto", "ns-presupuesto-extra"],
    ["ns-cdp-negativo", "ns-cdp-extra"],
  ].forEach(([chkId, extraId]) => {
    document.getElementById(chkId).addEventListener("change", (e) => {
      document.getElementById(extraId).classList.toggle("oculto", !e.target.checked);
    });
  });
  document.getElementById("ns-pdf").addEventListener("change", (e) => {
    if (e.target.files[0]) leerFormularioPDF(e.target.files[0]);
  });
  document.getElementById("ns-guardar").addEventListener("click", guardarSolicitud);
  pintarLineas();
}

function pintarLineas() {
  const cont = document.getElementById("ns-lineas");
  if (!lineasSolicitud.length) {
    cont.innerHTML = "<p style='color:var(--ink-soft);font-size:0.85rem'>Aún no agregas materiales.</p>";
    return;
  }
  cont.innerHTML = `<table>
    <tr><th>Material</th><th class="num">Cantidad</th><th></th></tr>
    ${lineasSolicitud.map((l, i) => `<tr>
        <td>${esc(l.descripcion)}</td>
        <td class="num">${l.cantidad_solicitada}</td>
        <td><button class="secundario" onclick="quitarLinea(${i})">Quitar</button></td>
      </tr>`).join("")}
  </table>`;
}
function quitarLinea(i) { lineasSolicitud.splice(i, 1); pintarLineas(); }

// Lee el PDF editable (campos AcroForm) y autocompleta el formulario.
async function leerFormularioPDF(file) {
  const msg = document.getElementById("ns-pdf-msg");
  if (!window.PDFLib) { msg.textContent = "No se pudo cargar el lector de PDF (revisa la conexión)."; return; }
  msg.textContent = "Leyendo el PDF…";
  try {
    const doc = await PDFLib.PDFDocument.load(await file.arrayBuffer());
    const form = doc.getForm();
    const T = (n) => { try { return (form.getTextField(n).getText() || "").trim(); } catch { return ""; } };
    const C = (n) => { try { return form.getCheckBox(n).isChecked(); } catch { return false; } };
    const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
    const num = (v) => parseFloat(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) || 0;
    const fecha = (v) => { const m = String(v).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/); return m ? `${m[3].padStart(4, "20")}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : ""; };

    set("ns-fecha", fecha(T("fecha_solicitud")));
    set("ns-solicitante", T("responsable_requerimiento"));
    set("ns-contacto", T("contacto"));
    set("ns-supervisor", T("responsable_supervisor"));
    set("ns-ubicacion", T("ubicacion_uso"));
    set("ns-desc", T("desc_requerimiento"));
    set("ns-motivo", T("fundamento"));
    set("ns-situacion", T("situacion_actual"));
    set("ns-trabajo", T("trabajo_ejecutar"));

    // unidad solicitante: intenta calzar por nombre
    const unTxt = T("unidad_solicitante").toLowerCase();
    if (unTxt) {
      const opt = [...document.getElementById("ns-unidad").options].find(o => o.textContent.toLowerCase().includes(unTxt) || unTxt.includes(o.textContent.toLowerCase()));
      if (opt) document.getElementById("ns-unidad").value = opt.value;
    }

    // Los materiales NO se autocompletan: el nombre que trae el PDF puede no
    // calzar con la descripción exacta del catálogo, así que se agregan a
    // mano eligiéndolos del catálogo (evita duplicados o descripciones libres
    // que no encuentran su articulo_id).

    document.getElementById("ns-resp-foto").checked = C("chk_fotografico");
    set("ns-num-fotos", T("num_fotos"));
    document.getElementById("ns-resp-informe").checked = C("chk_informe_tecnico");
    document.getElementById("ns-resp-presupuesto").checked = C("chk_presupuesto");
    document.getElementById("ns-resp-otro").checked = C("chk_otro");
    set("ns-resp-otro-texto", T("otro_texto"));
    document.getElementById("ns-cdp-negativo").checked = C("chk_cdp_negativo");
    [
      ["ns-resp-foto", "ns-foto-extra"],
      ["ns-resp-informe", "ns-informe-extra"],
      ["ns-resp-presupuesto", "ns-presupuesto-extra"],
      ["ns-cdp-negativo", "ns-cdp-extra"],
    ].forEach(([chkId, extraId]) => {
      document.getElementById(extraId).classList.toggle("oculto", !document.getElementById(chkId).checked);
    });
    const fuera = C("chk_no_catalogo");
    document.getElementById("ns-fuera-catalogo").checked = fuera;
    document.getElementById("ns-especial-extra").classList.toggle("oculto", !fuera);

    msg.textContent = "Formulario autocompletado desde el PDF. Revísalo, corrige lo que falte y agrega los materiales manualmente desde el catálogo (punto 3).";
  } catch (e) {
    msg.textContent = "No se pudo leer el PDF: " + e.message + ". Llena el formulario a mano.";
  }
}

async function guardarSolicitud() {
  if (!_lock()) return;
  try {
  const errorEl = document.getElementById("ns-error");
  const mostrarError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove("oculto"); };
  errorEl.classList.add("oculto");

  const val = (id) => document.getElementById(id).value.trim();
  const unidad_id = document.getElementById("ns-unidad").value || perfilActual.unidad_id || null;
  const solicitante = val("ns-solicitante");
  const motivo = val("ns-motivo");
  const ubicacion = val("ns-ubicacion");
  const fuera_catalogo = document.getElementById("ns-fuera-catalogo").checked;

  if (!unidad_id) { mostrarError("Selecciona la unidad solicitante."); return; }
  if (!solicitante) { mostrarError("Indica el responsable del requerimiento."); return; }
  if (!motivo) { mostrarError("Indica el fundamento / motivo de la solicitud."); return; }
  if (!ubicacion) { mostrarError("Indica la ubicación de uso de los materiales."); return; }
  if (!lineasSolicitud.length) { mostrarError("Agrega al menos un material."); return; }

  // Adjuntos → bucket "memos"
  const subeUno = async (id) => {
    const f = document.getElementById(id);
    if (!f || !f.files[0]) return { url: null };
    return subirArchivo("memos", f.files[0]);
  };
  const rMemo = await subeUno("ns-memo");  if (rMemo.error) { mostrarError(rMemo.error); return; }
  const rFoto = await subeUno("ns-foto");  if (rFoto.error) { mostrarError(rFoto.error); return; }
  const rInforme = await subeUno("ns-informe-archivo");     if (rInforme.error) { mostrarError(rInforme.error); return; }
  const rPresupuesto = await subeUno("ns-presupuesto-archivo"); if (rPresupuesto.error) { mostrarError(rPresupuesto.error); return; }
  const rCdp = await subeUno("ns-cdp-archivo");             if (rCdp.error) { mostrarError(rCdp.error); return; }
  const rJust = fuera_catalogo ? await subirArchivo("especiales", (document.getElementById("ns-just") || {}).files?.[0]) : { url: null };
  if (rJust.error) { mostrarError(rJust.error); return; }

  const descripcion_requerimiento = val("ns-desc");
  const situacion_actual = val("ns-situacion");

  const payload = {
    unidad_id, solicitante, motivo, ubicacion,
    fecha_solicitud: document.getElementById("ns-fecha").value || null,
    contacto: val("ns-contacto") || null,
    supervisor: val("ns-supervisor") || null,
    descripcion_requerimiento: descripcion_requerimiento || null,
    situacion_actual: situacion_actual || null,
    trabajo_ejecutar: val("ns-trabajo") || null,
    resp_fotografico: document.getElementById("ns-resp-foto").checked || !!rFoto.url,
    num_fotos: parseInt(document.getElementById("ns-num-fotos").value) || null,
    resp_informe_tecnico: document.getElementById("ns-resp-informe").checked,
    resp_presupuesto: document.getElementById("ns-resp-presupuesto").checked,
    resp_otro: document.getElementById("ns-resp-otro").checked,
    resp_otro_texto: val("ns-resp-otro-texto") || null,
    cdp_negativo: document.getElementById("ns-cdp-negativo").checked,
    tipo: fuera_catalogo ? "especial" : "normal",
  };
  if (rMemo.url) payload.memo_url = rMemo.url;
  if (rFoto.url) payload.resp_fotografico_url = rFoto.url;
  if (rInforme.url) payload.resp_informe_url = rInforme.url;
  if (rPresupuesto.url) payload.resp_presupuesto_url = rPresupuesto.url;
  if (rCdp.url) payload.cdp_negativo_url = rCdp.url;
  if (fuera_catalogo) {
    payload.justificacion_especial = [descripcion_requerimiento, motivo, situacion_actual].filter(Boolean).join(" — ");
    if (rJust.url) payload.just_juridica_url = rJust.url;
  }

  const { data: solicitud, error } = await sb.from("solicitud").insert(payload).select().single();
  if (error) { mostrarError(error.message); return; }

  const detalle = lineasSolicitud.map(l => ({
    solicitud_id: solicitud.id,
    articulo_id: l.articulo_id || null,
    descripcion_libre: l.descripcion,
    unidad_medida_libre: l.unidad_medida || null,
    cantidad_solicitada: l.cantidad_solicitada,
  }));
  const { error: errorDetalle } = await sb.from("solicitud_detalle").insert(detalle);
  if (errorDetalle) { mostrarError(errorDetalle.message); return; }

  actualizarNotificaciones();
  vista().innerHTML = `<div class="card">
    <h3 style="margin-top:0">Solicitud ingresada${fuera_catalogo ? " (especial)" : ""}</h3>
    <p>${numSol(solicitud) ? `N° <strong>${esc(numSol(solicitud))}</strong> · ` : ""}Queda <span class="pill pendiente">pendiente</span> del visto bueno del Director de Obras.
    ${fuera_catalogo
      ? `Al ser <strong>fuera de catálogo</strong>, en su expediente (pestaña <strong>Expedientes</strong>)
         deberás cargar la justificación de la Unidad Jurídica y de la DAF, la cotización y la
         documentación de Mercado Público.`
      : `Una vez aprobada, descarga la hoja desde <strong>Expedientes</strong> para enviarla a la empresa.`}
    </p>
  </div>`;
  } finally { _unlock(); }
}

// ---------------------------------------------------------------------
// Solicitud de operaciones (ITO / Dirección de Obras) — versión corta.
// Mismo flujo y mismas tablas (solicitud, solicitud_detalle) que la
// solicitud normal, pero sin las secciones de descripción técnica,
// respaldos adjuntos y situaciones especiales: al ser un requerimiento
// interno de la propia Dirección de Obras no necesita tanta tramitación.
// Igual queda "pendiente" del V°B° del Director de Obras.
// ---------------------------------------------------------------------
async function vistaNuevaSolicitudOperaciones() {
  const { data: todasUnidades } = await sb.from("unidad").select("id, nombre").order("nombre");
  lineasSolicitud = [];

  // Los usuarios de Obras solo piden a nombre de su dirección (la de su perfil).
  const soloObras = rolEfectivo() === "solicitante_obras";
  const unidades = soloObras ? (todasUnidades || []).filter(u => u.id === perfilActual.unidad_id) : (todasUnidades || []);

  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Solicitud Obras — Dirección de Obras</h3>
      <p class="hint">Formulario corto para requerimientos internos de la Dirección de Obras
        (Operaciones, Aseo y Ornato, Edificios). El N° de solicitud se genera automáticamente.
        ${soloObras
          ? `Al ingresarla queda <span class="pill pendiente">pendiente</span> de la revisión del ITO; con su V°B° pasa al Director de Obras para su aprobación.`
          : `Al ingresarla pasa directo al V°B° del Director de Obras.`}</p>
      ${soloObras && !unidades.length ? `<p class="error">Tu perfil no tiene una dirección asignada. Pide al administrador que te la asigne en Usuarios.</p>` : ""}

      <label>Dirección responsable</label>
      <select id="nso-unidad" ${soloObras ? "disabled" : ""}>
        ${soloObras ? "" : `<option value="">— selecciona —</option>`}
        ${unidades.map(u => `<option value="${u.id}" ${u.id === perfilActual.unidad_id ? "selected" : ""}>${esc(u.nombre)}</option>`).join("")}
      </select>
      <label>Unidad</label>
      <select id="nso-unidad-interna">
        <option value="">— selecciona —</option>
        <option value="Operaciones">Operaciones</option>
        <option value="Aseo y Ornato">Aseo y Ornato</option>
        <option value="Edificios">Edificios</option>
      </select>
      <label>Responsable del requerimiento</label>
      <input id="nso-solicitante" placeholder="Nombre y cargo">
      <label>Ubicación de uso de los materiales</label>
      <textarea id="nso-ubicacion" rows="2" placeholder="Calle, número, sector"></textarea>
      <label>Motivo</label>
      <textarea id="nso-motivo" rows="2" placeholder="Motivo breve de la operación"></textarea>

      <h4>Detalle de materiales</h4>
      <div id="nso-lineas"></div>
      <div class="linea-detalle" style="grid-template-columns:3fr 1fr auto">
        <div class="buscador"><label>Material (buscar en el catálogo)</label><input id="nso-mat" placeholder="Escribe para buscar…" autocomplete="off"><div id="nso-mat-res" class="buscador-res oculto"></div></div>
        <div><label>Cantidad</label><input id="nso-cant" type="number" min="0" step="0.01"></div>
        <div><button class="secundario" id="nso-agregar" style="margin-top:0">+ Agregar</button></div>
      </div>
      <p class="error oculto" id="nso-mat-msg"></p>

      <button class="primario" id="nso-guardar">Ingresar solicitud</button>
      <p class="error oculto" id="nso-error"></p>
    </div>
  `;

  const { data: articulos } = await sb.from("articulo").select("id, descripcion, unidad_medida").order("descripcion");
  catalogoPorDesc = new Map((articulos || []).map(a => [(a.descripcion || "").trim().toLowerCase(), a]));
  montarBuscadorMaterial("nso-mat", "nso-mat-res", articulos || []);

  const pintarLineasNso = () => {
    const cont = document.getElementById("nso-lineas");
    if (!lineasSolicitud.length) {
      cont.innerHTML = "<p style='color:var(--ink-soft);font-size:0.85rem'>Aún no agregas materiales.</p>";
      return;
    }
    cont.innerHTML = `<table>
      <tr><th>Material</th><th class="num">Cantidad</th><th></th></tr>
      ${lineasSolicitud.map((l, i) => `<tr>
          <td>${esc(l.descripcion)}</td>
          <td class="num">${l.cantidad_solicitada}</td>
          <td><button class="secundario" onclick="lineasSolicitud.splice(${i},1);pintarLineasNsoGlobal()">Quitar</button></td>
        </tr>`).join("")}
    </table>`;
  };
  window.pintarLineasNsoGlobal = pintarLineasNso;

  document.getElementById("nso-agregar").addEventListener("click", () => {
    const mat = document.getElementById("nso-mat").value.trim();
    const cant = parseFloat(document.getElementById("nso-cant").value);
    const msg = document.getElementById("nso-mat-msg");
    msg.classList.add("oculto");
    if (!mat || !cant) return;
    const art = catalogoPorDesc.get(mat.toLowerCase());
    if (!art) {
      msg.textContent = "Ese producto no está en el catálogo del contrato. Búscalo y elígelo de la lista.";
      msg.classList.remove("oculto");
      return;
    }
    lineasSolicitud.push({
      descripcion: art.descripcion,
      articulo_id: art.id,
      cantidad_solicitada: cant,
      unidad_medida: art.unidad_medida || "",
    });
    ["nso-mat", "nso-cant"].forEach(id => document.getElementById(id).value = "");
    pintarLineasNso();
  });

  document.getElementById("nso-guardar").addEventListener("click", guardarSolicitudOperaciones);
  pintarLineasNso();
}

async function guardarSolicitudOperaciones() {
  if (!_lock()) return;
  try {
    const errorEl = document.getElementById("nso-error");
    const mostrarError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove("oculto"); };
    errorEl.classList.add("oculto");

    const val = (id) => document.getElementById(id).value.trim();
    const unidad_id = document.getElementById("nso-unidad").value || perfilActual.unidad_id || null;
    const solicitante = val("nso-solicitante");
    const ubicacion = val("nso-ubicacion");
    const motivo = val("nso-motivo") || "Solicitud de operaciones — Dirección de Obras";

    const unidad_interna = document.getElementById("nso-unidad-interna").value;

    if (!unidad_id) { mostrarError("Selecciona la dirección responsable."); return; }
    if (!unidad_interna) { mostrarError("Selecciona la unidad (Operaciones, Aseo y Ornato o Edificios)."); return; }
    if (!solicitante) { mostrarError("Indica el responsable del requerimiento."); return; }
    if (!ubicacion) { mostrarError("Indica la ubicación de uso de los materiales."); return; }
    if (!lineasSolicitud.length) { mostrarError("Agrega al menos un material."); return; }

    // Los usuarios de Obras quedan "pendiente" de la revisión del ITO. Si la
    // crea el propio Encargado (o el admin), no se revisa a sí mismo: entra
    // ya visada y va directo al Director.
    const porRevisar = rolEfectivo() === "solicitante_obras";
    const payload = {
      unidad_id, unidad_interna, solicitante, motivo, ubicacion,
      fecha_solicitud: hoyISO(),
      tipo: "operaciones",
    };
    if (!porRevisar) {
      payload.estado = "visada";
      payload.visado_por = perfilActual.id;
      payload.visado_en = new Date().toISOString();
    }

    const { data: solicitud, error } = await sb.from("solicitud").insert(payload).select().single();
    if (error) { mostrarError(error.message); return; }

    const detalle = lineasSolicitud.map(l => ({
      solicitud_id: solicitud.id,
      articulo_id: l.articulo_id || null,
      descripcion_libre: l.descripcion,
      unidad_medida_libre: l.unidad_medida || null,
      cantidad_solicitada: l.cantidad_solicitada,
    }));
    const { error: errorDetalle } = await sb.from("solicitud_detalle").insert(detalle);
    if (errorDetalle) { mostrarError(errorDetalle.message); return; }

    actualizarNotificaciones();
    vista().innerHTML = `<div class="card">
      <h3 style="margin-top:0">Solicitud de Obras ingresada</h3>
      <p>N° <strong>${esc(numSol(solicitud))}</strong> · ${porRevisar
        ? `Queda <span class="pill pendiente">pendiente</span> de la revisión del ITO; con su V°B° pasará al Director de Obras para su aprobación.`
        : `Queda <span class="pill visada">visada</span> y espera la aprobación del Director de Obras.`}
      Una vez aprobada, el ITO continúa desde <strong>Expedientes</strong> con la hoja, las guías y la factura.</p>
    </div>`;
  } finally { _unlock(); }
}

// ---------------------------------------------------------------------
// Solicitar cotización a un proveedor (solo ITO / admin): genera un PDF para
// pedir precio de productos que NO están en el catálogo del convenio.
// No guarda nada en la base de datos: es solo el documento.
// ---------------------------------------------------------------------
let lineasCotizacion = [];

async function vistaCotizacionProveedor() {
  lineasCotizacion = [];
  // Por defecto se cotiza con el proveedor del convenio vigente (editable).
  const { data: convenio } = await sb.from("contrato").select("proveedor")
    .eq("estado", "vigente").order("creado_en", { ascending: false }).limit(1).maybeSingle();
  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Solicitar cotización a proveedor</h3>
      <p class="hint">Para productos que no están en el catálogo del convenio. Completa los datos y
        descarga el PDF para enviarlo al proveedor. No se guarda en el sistema.</p>

      <label>Proveedor</label>
      <input id="cp-proveedor" value="${esc(convenio?.proveedor)}" placeholder="Razón social o nombre" autocomplete="off">
      ${convenio?.proveedor ? `<p class="hint" style="margin-top:0">Proveedor del convenio vigente. Puedes cambiarlo si cotizas con otro.</p>` : ""}
      <label>Atención a (opcional)</label>
      <input id="cp-atencion" placeholder="Persona de contacto del proveedor" autocomplete="off">

      <h4>Productos a cotizar</h4>
      <div id="cp-lineas"></div>
      <div class="linea-detalle" style="grid-template-columns:3fr 1fr 1fr auto">
        <div><label>Producto y especificaciones</label><input id="cp-desc" placeholder="Ej: marca, medidas, norma" autocomplete="off"></div>
        <div><label>Cantidad</label><input id="cp-cant" type="number" min="0" step="0.01"></div>
        <div><label>Unidad</label><input id="cp-un" placeholder="un, m, kg" autocomplete="off"></div>
        <div><button class="secundario" id="cp-agregar" style="margin-top:0">+ Agregar</button></div>
      </div>

      <h4>Condiciones (opcionales)</h4>
      <label>Lugar de entrega</label>
      <input id="cp-lugar" placeholder="Ej: Bodega municipal, Doñihue" autocomplete="off">
      <label>Plazo de entrega requerido</label>
      <input id="cp-plazo" placeholder="Ej: 5 días hábiles" autocomplete="off">
      <label>Enviar cotización hasta el</label>
      <input id="cp-limite" type="date">
      <label>Teléfono / correo de contacto</label>
      <input id="cp-contacto" autocomplete="off">
      <label>Observaciones</label>
      <textarea id="cp-obs" rows="2"></textarea>

      <button class="primario" id="cp-pdf">Descargar PDF</button>
      <p class="error oculto" id="cp-error"></p>
    </div>
  `;

  const pintar = () => {
    const cont = document.getElementById("cp-lineas");
    if (!lineasCotizacion.length) {
      cont.innerHTML = "<p style='color:var(--ink-soft);font-size:0.85rem'>Aún no agregas productos.</p>";
      return;
    }
    cont.innerHTML = `<table>
      <tr><th>Producto y especificaciones</th><th class="num">Cantidad</th><th>Unidad</th><th></th></tr>
      ${lineasCotizacion.map((l, i) => `<tr>
        <td>${esc(l.descripcion)}</td><td class="num">${l.cantidad}</td><td>${esc(l.unidad) || "—"}</td>
        <td><button class="secundario cp-quitar" data-i="${i}">Quitar</button></td>
      </tr>`).join("")}
    </table>`;
    cont.querySelectorAll(".cp-quitar").forEach(b => b.addEventListener("click", () => {
      lineasCotizacion.splice(Number(b.dataset.i), 1);
      pintar();
    }));
  };
  pintar();

  document.getElementById("cp-agregar").addEventListener("click", () => {
    const descripcion = document.getElementById("cp-desc").value.trim();
    const cantidad = parseFloat(document.getElementById("cp-cant").value);
    if (!descripcion || !cantidad) return;
    lineasCotizacion.push({ descripcion, cantidad, unidad: document.getElementById("cp-un").value.trim() });
    ["cp-desc", "cp-cant", "cp-un"].forEach(id => document.getElementById(id).value = "");
    pintar();
  });

  document.getElementById("cp-pdf").addEventListener("click", () => {
    const errorEl = document.getElementById("cp-error");
    errorEl.classList.add("oculto");
    const val = (id) => document.getElementById(id).value.trim();
    const proveedor = val("cp-proveedor");
    if (!proveedor) { errorEl.textContent = "Indica el proveedor."; errorEl.classList.remove("oculto"); return; }
    if (!lineasCotizacion.length) { errorEl.textContent = "Agrega al menos un producto."; errorEl.classList.remove("oculto"); return; }
    descargarCotizacionPDF({
      proveedor, atencion: val("cp-atencion"), lugar: val("cp-lugar"), plazo: val("cp-plazo"),
      limite: document.getElementById("cp-limite").value, contacto: val("cp-contacto"), obs: val("cp-obs"),
      lineas: lineasCotizacion,
    });
  });
}

function descargarCotizacionPDF(d) {
  if (!window.jspdf || !window.jspdf.jsPDF) { alert("No se pudo cargar el generador de PDF. Revisa la conexión."); return; }
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
  const M = 18;
  let y = M;

  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text("MUNICIPALIDAD DE DOÑIHUE", M, y);
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  y += 6; doc.text("Dirección de Obras — Unidad de Operaciones", M, y);

  y += 12;
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text("SOLICITUD DE COTIZACIÓN", M, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);

  y += 9;
  const fila = (k, v) => {
    doc.setFont("helvetica", "bold"); doc.text(k, M, y);
    doc.setFont("helvetica", "normal");
    const lns = doc.splitTextToSize(String(v), 130);
    doc.text(lns, M + 40, y);
    y += 6 + (lns.length - 1) * 4.5;
  };
  fila("Fecha:", hoyISO());
  fila("Señores:", d.proveedor);
  if (d.atencion) fila("Atención:", d.atencion);

  y += 3;
  const intro = doc.splitTextToSize(
    "Junto con saludar, se solicita cotizar los siguientes productos, indicando precio unitario, " +
    "total, disponibilidad y plazo de entrega.", 174);
  doc.text(intro, M, y); y += intro.length * 5 + 4;

  doc.setFont("helvetica", "bold");
  doc.text("PRODUCTOS A COTIZAR", M, y); y += 3;
  doc.setDrawColor(180); doc.line(M, y, 210 - M, y); y += 6;
  doc.text("N°", M, y); doc.text("Producto y especificaciones", M + 12, y);
  doc.text("Cantidad", 142, y); doc.text("Unidad", 168, y);
  doc.setFont("helvetica", "normal");
  y += 2; doc.line(M, y, 210 - M, y); y += 6;

  d.lineas.forEach((l, i) => {
    const lns = doc.splitTextToSize(l.descripcion, 105);
    if (y + lns.length * 5 > 270) { doc.addPage(); y = M; }
    doc.text(String(i + 1), M, y);
    doc.text(lns, M + 12, y);
    doc.text(String(l.cantidad), 142, y);
    doc.text(l.unidad || "", 168, y);
    y += Math.max(7, lns.length * 5 + 2);
  });

  const cond = [
    d.lugar && ["Lugar de entrega:", d.lugar],
    d.plazo && ["Plazo de entrega:", d.plazo],
    d.limite && ["Enviar cotización hasta:", d.limite],
    d.contacto && ["Contacto:", d.contacto],
    d.obs && ["Observaciones:", d.obs],
  ].filter(Boolean);
  if (cond.length) {
    y += 4;
    if (y > 230) { doc.addPage(); y = M; }
    doc.setFont("helvetica", "bold"); doc.text("CONDICIONES", M, y); y += 3;
    doc.line(M, y, 210 - M, y); y += 6;
    doc.setFont("helvetica", "normal");
    cond.forEach(([k, v]) => {
      if (y > 270) { doc.addPage(); y = M; }
      fila(k, v);
    });
  }

  y += 14;
  if (y > 255) { doc.addPage(); y = M + 10; }
  doc.line(M, y, 90, y); y += 5;
  doc.text(perfilActual.nombre || "Encargado de Operaciones", M, y);
  y += 5; doc.text("Encargado de Operaciones (ITO)", M, y);

  doc.setFontSize(8); doc.setTextColor(120);
  doc.text("Documento generado por Control Ferretería — Municipalidad de Doñihue", M, 288);

  const slug = d.proveedor.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "proveedor";
  doc.save(`cotizacion-${slug}-${hoyISO()}.pdf`);
}

// ---------------------------------------------------------------------
// Solicitudes (listar + aprobar/rechazar si puedes operar: admin_ito o admin)
// ---------------------------------------------------------------------
function pillTipoSolicitud(tipo, s) {
  if (tipo === "especial") return `<span class="pill enviada">especial</span> `;
  if (tipo === "operaciones") {
    return `<span class="pill enviada">Obras</span> ` +
      (s && s.proceso_cotizacion_id ? `<span class="pill comprada">fuera de catálogo</span> ` : "");
  }
  return "";
}

// ---------- Confirmación (reemplaza confirm/prompt del navegador) ----------
// Devuelve true al confirmar, el texto escrito si pide motivo, o null si cancela.
function confirmar({ titulo, texto = "", boton = "Confirmar", motivo = false }) {
  return new Promise(resolver => {
    const d = document.createElement("dialog");
    d.className = "modal-confirmar";
    d.innerHTML = `<h3>${esc(titulo)}</h3>${texto ? `<p>${esc(texto)}</p>` : ""}
      ${motivo ? `<textarea rows="3" maxlength="500" placeholder="Escribe el motivo…"></textarea><p class="error oculto"></p>` : ""}
      <div class="acciones"><button type="button" class="secundario" data-no>Cancelar</button><button type="button" data-ok>${esc(boton)}</button></div>`;
    let listo = false;
    const fin = (v) => { if (listo) return; listo = true; d.close(); d.remove(); resolver(v); };
    const ta = d.querySelector("textarea");
    d.querySelector("[data-no]").onclick = () => fin(null);
    d.addEventListener("cancel", (e) => { e.preventDefault(); fin(null); });
    d.querySelector("[data-ok]").onclick = () => {
      if (!motivo) return fin(true);
      const v = ta.value.trim();
      if (!v) { const er = d.querySelector(".error"); er.textContent = "El motivo es obligatorio."; er.classList.remove("oculto"); ta.focus(); return; }
      fin(v);
    };
    document.body.appendChild(d);
    d.showModal();
    (ta || d.querySelector("[data-ok]")).focus();
  });
}

// ---------- Listas: carga completa, buscador, filtro de estado y paginación ----------
const POR_PAGINA = 25;
const _lista = {};
const _sinTildes = (t) => String(t ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Supabase entrega como máximo 1000 filas por consulta: se pide por tramos.
async function cargarTodas(armar) {
  const todas = [];
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await armar().range(desde, desde + 999);
    if (error) return { error };
    todas.push(...data);
    if (data.length < 1000) return { data: todas };
  }
}

function listaCrear(clave, filas, textoFn, cabecera, filaFn) {
  _lista[clave] = { q: "", estado: "", pag: 1, filas, textoFn, cabecera, filaFn };
}
function listaBarra(clave, estados) {
  return `<div class="barra-lista">
    <input type="search" placeholder="Buscar por N°, motivo, unidad o solicitante…" oninput="listaCambiar('${clave}','q',this.value)">
    <select onchange="listaCambiar('${clave}','estado',this.value)"><option value="">Todos los estados</option>${estados.map(e => `<option value="${e}">${e}</option>`).join("")}</select>
  </div><div id="lista-${clave}"></div>`;
}
function listaCambiar(clave, campo, valor) { _lista[clave][campo] = valor; _lista[clave].pag = 1; listaPintar(clave); }
function listaPagina(clave, p) { _lista[clave].pag = p; listaPintar(clave); }
function listaPintar(clave) {
  const L = _lista[clave], el = document.getElementById("lista-" + clave);
  if (!el) return;
  const q = _sinTildes(L.q).trim();
  const f = L.filas.filter(s => (!L.estado || s.estado === L.estado) && (!q || _sinTildes(L.textoFn(s)).includes(q)));
  const paginas = Math.max(1, Math.ceil(f.length / POR_PAGINA));
  L.pag = Math.min(Math.max(1, L.pag), paginas);
  const ini = (L.pag - 1) * POR_PAGINA;
  el.innerHTML = f.length
    ? `<table>${L.cabecera}${f.slice(ini, ini + POR_PAGINA).map(L.filaFn).join("")}</table>
       <div class="paginador"><button class="secundario" ${L.pag <= 1 ? "disabled" : ""} onclick="listaPagina('${clave}',${L.pag - 1})">‹ Anterior</button>
       <span>Página ${L.pag} de ${paginas} · ${f.length} resultado${f.length === 1 ? "" : "s"}</span>
       <button class="secundario" ${L.pag >= paginas ? "disabled" : ""} onclick="listaPagina('${clave}',${L.pag + 1})">Siguiente ›</button></div>`
    : `<p class="hint">No hay resultados${L.filas.length ? " con ese filtro" : ""}.</p>`;
}
const ESTADOS_SOLICITUD = ["pendiente", "visada", "aprobada", "rechazada", "enviada", "recibida", "facturada", "cerrada"];

async function vistaSolicitudes() {
  vista().innerHTML = "<div class='card'>Cargando…</div>";
  const { data, error } = await cargarTodas(() => sb
    .from("solicitud")
    .select("*, unidad(nombre), obra(nombre), solicitud_detalle(cantidad_solicitada, precio_unitario_neto, articulo(precio_neto))")
    .order("creado_en", { ascending: false }).order("id"));

  if (error) { vista().innerHTML = `<div class="card error">${error.message}</div>`; return; }

  // El monto estimado (según el listado de precios) lo ven quienes aprueban o tramitan.
  const verMonto = esDirector() || puedeOperar();
  const celdaMonto = (s) => {
    const det = s.solicitud_detalle || [];
    if (!det.some(d => valorUnitarioNeto(d) != null)) return "—";
    const t = totalesDetalle(det);
    return `<span title="Neto ${money(t.neto)} + IVA ${money(t.iva)}">${money(t.bruto)}</span>${t.sinValor ? `<div class="hint">${t.sinValor} sin valor</div>` : ""}`;
  };

  vista().innerHTML = `
    <div class="card">
      ${esDirector() ?`<p class="hint">Como Director de Obras apruebas o rechazas las solicitudes pendientes. Las de la Dirección de Obras llegan a ti ya con el V°B° del ITO (estado <span class="pill visada">visada</span>).</p>` : ""}
      ${puedeOperar() ? `<p class="hint">Solicitudes de la Dirección de Obras en estado <span class="pill pendiente">pendiente</span>: revísalas y da tu V°B° para que pasen al Director, o recházalas.</p>` : ""}
      ${listaBarra("sol", ESTADOS_SOLICITUD)}
    </div>
  `;
  listaCrear("sol", data,
    (s) => `${numSol(s)} ${s.motivo} ${s.unidad?.nombre} ${s.obra?.nombre} ${s.solicitante} ${s.ubicacion} ${s.fecha_solicitud}`,
    `<tr><th>N°</th><th>Fecha</th><th>Unidad / solicita</th><th>Motivo</th>${verMonto ? `<th class="num">Monto estimado</th>` : ""}<th>Estado</th><th></th></tr>`,
    (s) => `
          <tr>
            <td class="num">${esc(numSol(s)) || "—"}</td>
            <td>${s.fecha_solicitud || ""}</td>
            <td>${esc(s.unidad?.nombre)}${s.obra ? " · " + esc(s.obra.nombre) : ""}${s.solicitante ? `<div class="hint">${esc(s.solicitante)}</div>` : ""}</td>
            <td>
              ${pillTipoSolicitud(s.tipo, s)}${esc(s.motivo)}${s.memo_url ? ` · ${enlaceArchivo(s.memo_url, `documento`)}` : ""}
              ${s.ubicacion ? `<div class="hint">📍 ${esc(s.ubicacion)}</div>` : ""}
            </td>
            ${verMonto ? `<td class="num">${celdaMonto(s)}</td>` : ""}
            <td><span class="pill ${s.estado}">${s.estado}</span>${s.estado === "rechazada" && s.motivo_rechazo ? `<div class="hint">Motivo: ${esc(s.motivo_rechazo)}</div>` : ""}</td>
            <td>${accionesSolicitud(s)}</td>
          </tr>`);
  listaPintar("sol");
}

// Botones de cada fila según rol y etapa:
//  - tipo "operaciones" y pendiente  -> revisa el ITO (V°B° o rechazo)
//  - visada, o pendiente de otro tipo -> decide el Director (aprobar o rechazar)
function accionesSolicitud(s) {
  const btn = (txt, estado, etapa) =>
    `<button class="secundario" onclick="resolverSolicitud('${s.id}','${estado}'${etapa ? `,'${etapa}'` : ""})">${txt}</button>`;
  const ver = `<button class="secundario" onclick="abrirExpediente('${s.id}')">Ver</button>`;

  if (puedeOperar() && s.tipo === "operaciones" && s.estado === "pendiente") {
    return `${ver} ${btn("Dar V°B°", "visada", "ito")} ${btn("Rechazar", "rechazada", "ito")}`;
  }
  if (esDirector() && (s.estado === "visada" || (s.estado === "pendiente" && s.tipo !== "operaciones"))) {
    return `${ver} ${btn("Aprobar", "aprobada")} ${btn("Rechazar", "rechazada")}`;
  }
  const espera = s.tipo === "operaciones" && s.estado === "pendiente" ? `<div class="hint">En revisión del ITO</div>` : "";
  return `<button class="secundario" onclick="abrirExpediente('${s.id}')">Ver expediente</button>${espera}`;
}

async function resolverSolicitud(id, estado, etapa) {
  const cambios = etapa === "ito"
    ? { estado, visado_por: perfilActual.id, visado_en: new Date().toISOString() }
    : { estado, aprobado_por: perfilActual.id };
  if (estado === "rechazada") {
    const motivo = await confirmar({ titulo: "Rechazar la solicitud", texto: "El motivo es obligatorio y lo verá quien hizo la solicitud.", boton: "Rechazar", motivo: true });
    if (!motivo) return;
    cambios.motivo_rechazo = motivo;
  } else {
    const [titulo, texto] = etapa === "ito"
      ? ["Dar V°B° a la solicitud", "Pasa al Director de Obras para su aprobación."]
      : ["Aprobar la solicitud", "Queda aprobada y el ITO podrá tramitarla con la empresa."];
    if (!await confirmar({ titulo, texto, boton: estado === "visada" ? "Dar V°B°" : "Aprobar" })) return;
  }
  const { error } = await sb.from("solicitud").update(cambios).eq("id", id);
  if (error) { alert("No se pudo actualizar la solicitud: " + error.message); return; }
  actualizarNotificaciones();
  vistaSolicitudes();
}

// =====================================================================
// EXPEDIENTES — respaldo completo por solicitud
//   solicitud → hoja/cotización (PDF) → guías de despacho (varias) → factura (una)
// =====================================================================

async function subirArchivo(bucket, file) {
  if (!file) return { url: null };
  if (file.size > 10 * 1024 * 1024) return { error: "El archivo supera los 10 MB." };
  const ext = (file.name.split(".").pop() || "dat").toLowerCase();
  const ruta = `${perfilActual.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from(bucket).upload(ruta, file, { upsert: false });
  if (error) return { error: `No se pudo subir el archivo (bucket '${bucket}'): ${error.message}` };
  return { url: sb.storage.from(bucket).getPublicUrl(ruta).data.publicUrl };
}

// Los depósitos son privados: el enlace guardado en la base se cambia por uno
// temporal firmado (2 min) justo al hacer clic. Solo se aceptan archivos de
// nuestro propio Supabase; cualquier otra dirección se rechaza.
function _rutaArchivo(url) {
  try {
    const u = new URL(url);
    if (u.origin !== new URL(SUPABASE_URL).origin) return null;
    const m = u.pathname.match(/^\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/);
    return m ? { bucket: m[1], ruta: decodeURIComponent(m[2]) } : null;
  } catch { return null; }
}

async function abrirArchivo(url) {
  const r = _rutaArchivo(url);
  if (!r) { alert("Enlace de archivo no válido."); return; }
  const w = window.open("", "_blank");
  if (w) w.opener = null;
  const { data, error } = await sb.storage.from(r.bucket).createSignedUrl(r.ruta, 120);
  const destino = data?.signedUrl || (error ? null : url);
  if (!destino) { if (w) w.close(); alert("No se pudo abrir el archivo (¿sin permiso?)."); return; }
  if (w) w.location.href = destino; else window.location.href = destino;
}

// Texto: HTML ya escapado por quien llama. La dirección va escapada y validada.
function enlaceArchivo(url, texto) {
  if (!url || !_rutaArchivo(url)) return "—";
  return `<a href="#" data-url="${esc(url)}" onclick="abrirArchivo(this.dataset.url); return false;">${texto}</a>`;
}

// ---------- Listado de expedientes ----------
async function vistaExpedientes(filtroUnidad) {
  vista().innerHTML = "<div class='card'>Cargando…</div>";
  const [{ data: solsTodas, error }, { data: guias }, { data: facturas }] = await Promise.all([
    cargarTodas(() => sb.from("solicitud").select("*, unidad(nombre)").order("creado_en", { ascending: false }).order("id")),
    cargarTodas(() => sb.from("guia_despacho").select("solicitud_id, monto_bruto").order("id")),
    cargarTodas(() => sb.from("factura").select("solicitud_id, monto_bruto").order("id")),
  ]);
  if (error) { vista().innerHTML = `<div class="card error">${error.message}</div>`; return; }

  const sols = filtroUnidad ? (solsTodas || []).filter(s => s.unidad?.nombre === filtroUnidad) : solsTodas;

  const cuenta = (arr, id) => (arr || []).filter(x => x.solicitud_id === id);
  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Expedientes de solicitudes</h3>
      <p class="hint">Cada solicitud reúne su hoja, las guías de despacho y la factura. Haz clic para abrir el expediente.</p>
      ${filtroUnidad ? `<p class="hint">Filtrado por unidad: <strong>${esc(filtroUnidad)}</strong> · <a href="#" onclick="vistaExpedientes();return false;">quitar filtro</a></p>` : ""}
      ${listaBarra("exp", ESTADOS_SOLICITUD)}
    </div>
  `;
  listaCrear("exp", sols || [],
    (s) => `${numSol(s)} ${s.motivo} ${s.unidad?.nombre} ${s.solicitante} ${s.fecha_solicitud}`,
    `<tr><th>N°</th><th>Fecha</th><th>Unidad</th><th>Motivo</th><th>Estado</th><th class="num">Guías</th><th>Factura</th><th class="num">Total bruto</th><th></th></tr>`,
    (s) => {
          const g = cuenta(guias, s.id);
          const f = cuenta(facturas, s.id);
          const totalBruto = f.length ? f.reduce((a, x) => a + Number(x.monto_bruto || 0), 0)
                                      : g.reduce((a, x) => a + Number(x.monto_bruto || 0), 0);
          return `<tr>
            <td class="num">${esc(numSol(s)) || "—"}</td>
            <td>${s.fecha_solicitud || ""}</td>
            <td>${esc(s.unidad?.nombre)}</td>
            <td>${pillTipoSolicitud(s.tipo, s)}${esc(s.motivo)}</td>
            <td><span class="pill ${s.estado}">${s.estado}</span></td>
            <td class="num">${g.length || "—"}</td>
            <td>${f.length ? '<span class="pill facturada">sí</span>' : "—"}</td>
            <td class="num">${totalBruto ? money(totalBruto) : "—"}</td>
            <td><button class="secundario" onclick="abrirExpediente('${s.id}')">Abrir</button></td>
          </tr>`;
    });
  listaPintar("exp");
}

function abrirExpediente(id) { editarFacturaId = null; vistaExpediente(id); }

// Precio unitario neto del artículo (listado de precios del contrato) y total
// de lo solicitado. Los productos sin precio se avisan y no suman.
function valorUnitarioNeto(d) {
  // El precio guardado en la línea al pedir; si es anterior, el vigente del artículo.
  const p = d.precio_unitario_neto ?? d.articulo?.precio_neto;
  return p == null || p === "" ? null : Number(p);
}
function totalesDetalle(detalle) {
  let neto = 0, sinValor = 0;
  (detalle || []).forEach(d => {
    const p = valorUnitarioNeto(d);
    if (p == null) sinValor++; else neto += p * Number(d.cantidad_solicitada || 0);
  });
  const iva = Math.round(neto * 0.19);
  return { neto, iva, bruto: neto + iva, sinValor };
}

// ---------- Detalle de un expediente ----------
let editarFacturaId = null;

async function vistaExpediente(id) {
  vista().innerHTML = "<div class='card'>Cargando expediente…</div>";
  const [{ data: s, error }, { data: detalle }, { data: guias }, { data: facturas }, { data: cotizaciones }, { data: notasCredito }, { data: comprasSol }, { data: bitacoraRows }] = await Promise.all([
    sb.from("solicitud").select("*, unidad(nombre), obra(nombre)").eq("id", id).single(),
    sb.from("solicitud_detalle").select("cantidad_solicitada, descripcion_libre, unidad_medida_libre, precio_unitario_neto, articulo(descripcion, unidad_medida, precio_neto)").eq("solicitud_id", id),
    sb.from("guia_despacho").select("*").eq("solicitud_id", id).order("fecha", { ascending: true }),
    sb.from("factura").select("*").eq("solicitud_id", id).order("fecha", { ascending: true }),
    sb.from("cotizacion").select("*").eq("solicitud_id", id).order("fecha", { ascending: true }),
    sb.from("nota_credito").select("*").eq("solicitud_id", id).order("fecha", { ascending: true }),
    sb.from("compra").select("n_oc").eq("solicitud_id", id),
    puedeVerBitacora()
      ? sb.from("bitacora").select("*").eq("solicitud_id", id).order("id", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);
  if (error || !s) { vista().innerHTML = `<div class="card error">No se pudo abrir el expediente: ${error ? error.message : "no existe"}</div>`; return; }
  const especial = s.tipo === "especial";

  // Si la solicitud nació de una Cotización Obras, trae las 3 cotizaciones que la respaldan.
  let procExp = null, ofertasExp = [];
  if (s.proceso_cotizacion_id) {
    const [{ data: pp }, { data: oo }] = await Promise.all([
      sb.from("proceso_cotizacion").select("*, unidad(nombre)").eq("id", s.proceso_cotizacion_id).single(),
      sb.from("proceso_cotizacion_oferta").select("*").eq("proceso_id", s.proceso_cotizacion_id),
    ]);
    procExp = pp; ofertasExp = oo || [];
  }

  window._expActual = { s, detalle: detalle || [] };
  const opero = puedeOperar();
  const facturasAnuladas = (facturas || []).filter(f => f.anulado);
  const factura = (facturas || []).find(f => !f.anulado) || null;
  const facturaDescontada = factura && (comprasSol || []).some(c => c.n_oc === "FACT " + factura.numero);
  // Los totales de guías ignoran las anuladas (no cuentan para la factura ni el convenio).
  const sumaGuias = (guias || []).filter(g => !g.anulado).reduce((a, g) => ({
    neto: a.neto + Number(g.monto_neto || 0),
    iva: a.iva + Number(g.iva || 0),
    bruto: a.bruto + Number(g.monto_bruto || 0),
  }), { neto: 0, iva: 0, bruto: 0 });

  const aprobada = ["aprobada", "enviada", "recibida", "facturada", "cerrada"].includes(s.estado);

  vista().innerHTML = `
    <button class="exp-volver" onclick="vistaExpedientes()">← Volver a expedientes</button>

    <div class="card">
      <div class="exp-cabecera">
        <div>
          <h3 style="margin:0">Solicitud ${numSol(s) ? "N° " + esc(numSol(s)) : ""}</h3>
          <div class="hint">${s.fecha_solicitud || ""} · ${esc(s.unidad?.nombre)}</div>
        </div>
        <div style="display:flex;gap:.4rem;align-items:center">
          ${especial ? `<span class="pill enviada">especial · Mercado Público</span>` : ""}
          <span class="pill ${s.estado}">${s.estado}</span>
        </div>
      </div>
      <div class="exp-datos">
        <div><div class="d-k">N° de solicitud</div>${esc(numSol(s)) || "—"}</div>
        <div><div class="d-k">Fecha</div>${s.fecha_solicitud || "—"}</div>
        <div><div class="d-k">${s.unidad_interna ? "Dirección responsable" : "Unidad solicitante"}</div>${esc(s.unidad?.nombre) || "—"}</div>
        ${s.unidad_interna ? `<div><div class="d-k">Unidad</div>${esc(s.unidad_interna)}</div>` : ""}
        <div><div class="d-k">Responsable</div>${esc(s.solicitante) || "—"}</div>
        <div><div class="d-k">Contacto</div>${esc(s.contacto) || "—"}</div>
        <div><div class="d-k">Supervisa ejecución</div>${esc(s.supervisor) || "—"}</div>
        <div><div class="d-k">Ubicación de uso</div>${esc(s.ubicacion) || "—"}</div>
        <div><div class="d-k">Memo de solicitud</div>${s.memo_url ? `${enlaceArchivo(s.memo_url, `ver`)}` : "sin adjunto"}</div>
        <div><div class="d-k">Respaldo fotográfico</div>${s.resp_fotografico_url ? `${enlaceArchivo(s.resp_fotografico_url, `ver`)}` : "sin adjunto"}</div>
        ${s.estado === "rechazada" && s.motivo_rechazo ? `<div><div class="d-k">Motivo del rechazo</div>${esc(s.motivo_rechazo)}</div>` : ""}
      </div>

      <div class="exp-seccion" style="margin-top:1.2rem"><h4>Descripción y justificación técnica</h4></div>
      <div class="exp-datos">
        <div><div class="d-k">Qué se solicita</div>${esc(s.descripcion_requerimiento) || "—"}</div>
        <div><div class="d-k">Fundamento / motivo</div>${esc(s.motivo) || "—"}</div>
        <div><div class="d-k">Situación actual</div>${esc(s.situacion_actual) || "—"}</div>
        <div><div class="d-k">Trabajo a ejecutar</div>${esc(s.trabajo_ejecutar) || "—"}</div>
      </div>

      <div class="exp-seccion" style="margin-top:1.2rem"><h4>Materiales solicitados</h4></div>
      ${(() => {
        const conValor = !especial && (detalle || []).some(d => valorUnitarioNeto(d) != null);
        const tot = totalesDetalle(detalle);
        return `<table>
        <tr><th>Material</th><th class="num">Cantidad</th><th>Unidad</th>${conValor ? `<th class="num">Valor unit. neto</th><th class="num">Subtotal neto</th>` : ""}</tr>
        ${(detalle || []).map(d => {
          const p = valorUnitarioNeto(d);
          return `<tr>
          <td>${esc(d.articulo?.descripcion || d.descripcion_libre)}</td>
          <td class="num">${d.cantidad_solicitada}</td>
          <td>${esc(d.unidad_medida_libre || d.articulo?.unidad_medida) || "—"}</td>
          ${conValor ? `<td class="num">${p == null ? "—" : money(p)}</td><td class="num">${p == null ? "—" : money(p * Number(d.cantidad_solicitada || 0))}</td>` : ""}
        </tr>`;
        }).join("")}
        ${conValor ? `
          <tr><td colspan="4" style="text-align:right">Total neto</td><td class="num">${money(tot.neto)}</td></tr>
          <tr><td colspan="4" style="text-align:right">IVA 19%</td><td class="num">${money(tot.iva)}</td></tr>
          <tr><td colspan="4" style="text-align:right;font-weight:700">Total estimado</td><td class="num" style="font-weight:700">${money(tot.bruto)}</td></tr>` : ""}
      </table>
      ${conValor ? `<p class="hint" style="margin-top:.4rem">Valores netos según el listado de precios del contrato. Es un monto estimado: el valor final se verifica con la guía de despacho y la factura.${tot.sinValor ? ` ${tot.sinValor} línea(s) sin valor no están incluidas en el total.` : ""}</p>` : ""}`;
      })()}

      <div class="exp-seccion" style="margin-top:1.2rem"><h4>Respaldos y situaciones especiales</h4></div>
      <p class="hint" style="margin-top:0">
        ${[
          s.resp_fotografico ? `Respaldo fotográfico${s.num_fotos ? ` (${s.num_fotos} fotos)` : ""}` : null,
          s.resp_informe_tecnico ? "Informe técnico / cubicación" : null,
          s.resp_presupuesto ? "Presupuesto estimativo" : null,
          s.resp_otro ? `Otro: ${esc(s.resp_otro_texto)}` : null,
          s.cdp_negativo ? "⚠ CDP negativo" : null,
          especial ? "⚠ Producto fuera de catálogo" : null,
        ].filter(Boolean).join(" · ") || "Sin respaldos marcados."}
      </p>
      <p class="hint" style="margin-top:0.3rem">
        ${[
          s.resp_fotografico_url ? `${enlaceArchivo(s.resp_fotografico_url, `ver fotografías`)}` : null,
          s.resp_informe_url ? `${enlaceArchivo(s.resp_informe_url, `ver informe técnico`)}` : null,
          s.resp_presupuesto_url ? `${enlaceArchivo(s.resp_presupuesto_url, `ver presupuesto`)}` : null,
          s.cdp_negativo_url ? `${enlaceArchivo(s.cdp_negativo_url, `ver justificación CDP negativo`)}` : null,
        ].filter(Boolean).join(" · ")}
      </p>

      <div class="acciones">
        <button class="primario" onclick="descargarHojaPDF()" ${aprobada ? "" : "disabled"}>
          Descargar ${especial ? "solicitud de cotización" : "hoja de solicitud"} (PDF)
        </button>
        ${opero && s.estado === "aprobada" ? `<button class="secundario" onclick="avanzarEstado('${s.id}','enviada')">Marcar como enviada a la empresa</button>` : ""}
        ${opero && ["enviada"].includes(s.estado) ? `<button class="secundario" onclick="avanzarEstado('${s.id}','recibida')">Marcar material recibido</button>` : ""}
        ${opero && ["recibida","facturada"].includes(s.estado) ? `<button class="secundario" onclick="avanzarEstado('${s.id}','cerrada')">Cerrar expediente</button>` : ""}
      </div>
      ${aprobada ? "" : `<p class="hint">La hoja se habilita cuando el Director de Obras aprueba la solicitud.</p>`}
    </div>

    ${procExp ? `
      <div class="card">
        <div class="exp-seccion"><h4>Cotizaciones que respaldan la compra</h4>
          <span class="hint">${esc(procExp.correlativo)} · enviada el ${fechaCL(procExp.fecha_envio)}</span></div>
        ${comparativoHTML(procExp, ofertasExp)}
        <p class="hint">${ofertasExp.filter(o => o.archivo_url).map(o => `${enlaceArchivo(o.archivo_url, `Cotización ${esc(o.proveedor)}`)}`).join(" · ") || "Sin archivos adjuntos."}</p>
      </div>` : ""}

    ${especial ? bloqueCompraEspecial(s, cotizaciones || [], opero) : bloqueOrdenCompra(s, opero)}

    <!-- GUÍAS DE DESPACHO -->
    <div class="card">
      <div class="exp-seccion"><h4>Guías de despacho</h4><span class="hint">${(guias || []).length} registrada(s)</span></div>
      ${(guias || []).length ? `
        <table>
          <tr><th>N°</th><th>Fecha</th><th>Ingreso</th><th class="num">Neto</th><th class="num">IVA</th><th class="num">Bruto</th><th>Adjunto</th><th></th></tr>
          ${guias.map(g => `<tr${g.anulado ? ' class="fila-anulada"' : ''}>
            <td>${esc(g.numero)}${g.anulado ? ' <span class="pill anulada">anulada</span>' : ''}</td>
            <td>${g.fecha || ""}</td>
            <td>${g.fecha_ingreso || ""}</td>
            <td class="num">${money(g.monto_neto)}</td>
            <td class="num">${money(g.iva)}</td>
            <td class="num">${money(g.monto_bruto)}</td>
            <td>${g.archivo_url ? `${enlaceArchivo(g.archivo_url, `ver`)}` : "—"}</td>
            <td>${g.anulado
                  ? `<span class="hint" title="${esc(g.anulado_motivo)}">motivo ⓘ</span>`
                  : (opero ? `<button class="secundario" onclick="anularGuia('${g.id}','${s.id}')">Anular</button>` : "")}</td>
          </tr>`).join("")}
          <tr>
            <td colspan="3" style="text-align:right;font-weight:700">Totales</td>
            <td class="num" style="font-weight:700">${money(sumaGuias.neto)}</td>
            <td class="num" style="font-weight:700">${money(sumaGuias.iva)}</td>
            <td class="num" style="font-weight:700">${money(sumaGuias.bruto)}</td>
            <td></td><td></td>
          </tr>
        </table>
      ` : `<p class="hint">Aún no hay guías de despacho registradas.</p>`}

      ${opero ? `
        <div style="border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem">
          <h4 style="margin-top:0">Registrar guía de despacho</h4>
          <div class="linea-detalle" style="grid-template-columns:1fr 1fr 1fr">
            <div><label>N° guía</label><input id="gd-num" placeholder="Ej: 000123"></div>
            <div><label>Fecha de la guía</label><input id="gd-fecha" type="date"></div>
            <div><label>Fecha de ingreso al sistema</label><input id="gd-ingreso" type="date" value="${hoyISO()}"></div>
          </div>
          <div class="linea-detalle" style="grid-template-columns:1fr 1fr 1fr">
            <div><label>Monto neto</label><input id="gd-neto" type="number" min="0" step="1" oninput="recalcMontos('gd')"></div>
            <div><label>IVA (19%)</label><input id="gd-iva" type="number" min="0" step="1"></div>
            <div><label>Monto bruto</label><input id="gd-bruto" type="number" min="0" step="1"></div>
          </div>
          <label>Adjuntar guía de despacho (PDF o foto)</label>
          <input id="gd-archivo" type="file" accept=".pdf,image/*">
          <label>Observación (opcional)</label>
          <input id="gd-obs" placeholder="Ej: despacho parcial — falta la tubería">
          <button class="primario" onclick="guardarGuia('${s.id}')">Guardar guía</button>
          <p class="error oculto" id="gd-error"></p>
        </div>
      ` : ""}
    </div>

    <!-- FACTURA -->
    <div class="card">
      <div class="exp-seccion"><h4>Factura</h4>${factura ? `<span class="pill facturada">registrada</span>` : `<span class="hint">pendiente</span>`}</div>
      ${facturasAnuladas.length ? `
        <table>
          <tr><th>Factura anulada</th><th>Fecha</th><th class="num">Bruto</th><th>Motivo</th><th>Anuló</th></tr>
          ${facturasAnuladas.map(f => `<tr class="fila-anulada">
            <td>${esc(f.numero)}</td>
            <td>${f.fecha || ""}</td>
            <td class="num">${money(f.monto_bruto)}</td>
            <td>${esc(f.anulado_motivo) || "—"}</td>
            <td>${_fechaHora(f.anulado_en)}</td>
          </tr>`).join("")}
        </table>
      ` : ""}
      ${factura && editarFacturaId !== factura.id ? `
        <div class="exp-datos">
          <div><div class="d-k">N° factura</div>${esc(factura.numero) || "—"}</div>
          <div><div class="d-k">Fecha</div>${factura.fecha || "—"}</div>
          <div><div class="d-k">Neto</div>${money(factura.monto_neto)}</div>
          <div><div class="d-k">IVA</div>${money(factura.iva)}</div>
          <div><div class="d-k">Bruto</div>${money(factura.monto_bruto)}</div>
          <div><div class="d-k">Fecha de pago</div>${factura.fecha_pago || "—"}</div>
          <div><div class="d-k">Adjunto</div>${factura.archivo_url ? `${enlaceArchivo(factura.archivo_url, `ver factura`)}` : "sin adjunto"}</div>
        </div>
        ${!facturaDescontada ? `<p class="hint" style="color:var(--warn)">⚠ Esta factura todavía no se descontó del convenio (el Resumen no la refleja).</p>` : ""}
        ${opero ? `
          <div class="acciones">
            ${!facturaDescontada ? `<button class="secundario" onclick="editarFactura('${factura.id}','${s.id}')">Editar</button>` : ""}
            ${!facturaDescontada ? `<button class="secundario" onclick="reintentarDescuentoFactura('${s.id}','${factura.id}')">Reintentar descuento del convenio</button>` : ""}
            <button class="secundario" onclick="anularFactura('${s.id}','${factura.id}')">Anular${facturaDescontada ? " (revierte el convenio)" : ""}</button>
          </div>
          ${facturaDescontada ? `<p class="hint">Para corregir un monto: anula esta factura (con motivo) y registra la correcta. Queda todo en la bitácora.</p>` : ""}
        ` : ""}
      ` : (opero ? `
        ${factura ? `<p class="hint">Editando la factura N° ${esc(factura.numero)}. <a href="#" onclick="cancelarEdicionFactura('${s.id}');return false;">Cancelar</a></p>` : ""}
        <div class="linea-detalle" style="grid-template-columns:1fr 1fr 1fr">
          <div><label>N° factura</label><input id="fc-num" value="${factura ? esc(factura.numero) : ""}" placeholder="Ej: 45871"></div>
          <div><label>Fecha</label><input id="fc-fecha" type="date" value="${factura ? (factura.fecha || "") : ""}"></div>
          <div><label>Fecha de pago (opcional)</label><input id="fc-pago" type="date" value="${factura ? (factura.fecha_pago || "") : ""}"></div>
        </div>
        <div class="linea-detalle" style="grid-template-columns:1fr 1fr 1fr">
          <div><label>Monto neto</label><input id="fc-neto" type="number" min="0" step="1" value="${factura ? (factura.monto_neto ?? "") : (sumaGuias.neto || "")}" oninput="recalcMontos('fc')"></div>
          <div><label>IVA (19%)</label><input id="fc-iva" type="number" min="0" step="1" value="${factura ? (factura.iva ?? "") : (sumaGuias.iva || "")}"></div>
          <div><label>Monto bruto</label><input id="fc-bruto" type="number" min="0" step="1" value="${factura ? (factura.monto_bruto ?? "") : (sumaGuias.bruto || "")}"></div>
        </div>
        ${!factura && sumaGuias.neto ? `<p class="hint">Montos precargados con el total de las guías de despacho — ajústalos si la factura trae un valor distinto.</p>` : ""}
        <label>Adjuntar factura (PDF)${factura ? " — deja vacío para mantener la actual" : ""}</label>
        <input id="fc-archivo" type="file" accept=".pdf,image/*">
        <button class="primario" onclick="${factura ? `actualizarFactura('${s.id}','${factura.id}')` : `guardarFactura('${s.id}')`}">${factura ? "Guardar cambios" : "Guardar factura"}</button>
        <p class="error oculto" id="fc-error"></p>
      ` : `<p class="hint">Aún no se registra la factura.</p>`)}
    </div>

    ${factura ? bloqueNotasCredito(s, factura, notasCredito || [], opero) : ""}

    ${puedeVerBitacora() ? bloqueBitacora(bitacoraRows || []) : ""}
  `;
}

// ---------- Bitácora (registro inmutable de movimientos) ----------
function _fechaHora(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("es-CL") + " " +
         d.toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" });
}

const _BITACORA_ACCION = {
  crear: "creó", editar: "editó", anular: "anuló",
  cambiar_estado: "cambió estado", descontar_convenio: "descontó del convenio",
  reversar_convenio: "revirtió del convenio",
};

// Muestra qué campos cambiaron en un 'editar' (detalle = {antes, despues}).
function _difBitacora(det) {
  if (!det || !det.antes || !det.despues) return "";
  const a = det.antes, b = det.despues, out = [];
  const omitir = ["anulado", "anulado_por", "anulado_motivo", "anulado_en", "creado_en", "id"];
  for (const k of Object.keys(b)) {
    if (omitir.includes(k)) continue;
    if (JSON.stringify(a[k]) !== JSON.stringify(b[k])) {
      out.push(`${k}: ${a[k] ?? "—"} → ${b[k] ?? "—"}`);
    }
  }
  return out.join(" · ");
}

function _filaBitacora(r) {
  const dif = r.accion === "editar" ? _difBitacora(r.detalle) : "";
  const d = r.detalle || {};
  let cambio = "";
  if (r.accion === "cambiar_estado" && d.de && d.a) cambio = `${d.de} → ${d.a}`;
  else if (r.accion === "crear" && r.entidad === "solicitud") cambio = `ingresó${d.n ? " N° " + d.n : ""}${d.tipo ? " (" + d.tipo + ")" : ""}`;
  const texto = [cambio, r.motivo ? `Motivo: ${r.motivo}` : ""].filter(Boolean).join(" · ");
  return `<tr>
    <td>${_fechaHora(r.ocurrido_en)}</td>
    <td>${esc(r.actor_nombre) || "—"}</td>
    <td>${esc(_BITACORA_ACCION[r.accion] || r.accion)} <span class="hint">${esc(r.entidad)}</span></td>
    <td>${esc(texto) || (dif ? `<span class="b-dif">${esc(dif)}</span>` : "—")}</td>
    <td class="num">${r.monto ? money(r.monto) : ""}</td>
  </tr>`;
}

function bloqueBitacora(rows) {
  return `
    <div class="card">
      <div class="exp-seccion"><h4>Bitácora del expediente</h4><span class="hint">${rows.length} movimiento(s)</span></div>
      <p class="hint" style="margin-top:0">Registro inmutable: quién creó, editó o anuló cada documento, los reversos del convenio y los cambios de estado de la solicitud.</p>
      ${rows.length ? `
        <table class="bitacora-lista">
          <tr><th>Fecha y hora</th><th>Quién</th><th>Acción</th><th>Motivo / cambio</th><th class="num">Monto</th></tr>
          ${rows.map(_filaBitacora).join("")}
        </table>
      ` : `<p class="hint">Todavía no hay movimientos registrados.</p>`}
    </div>`;
}

// ---------- Pestaña Bitácora (global, roles de control) ----------
// Se entra por solicitud, ordenadas por su número; al elegir una se ve la
// bitácora de todo su expediente (solicitud, guías, factura, convenio…).
const _cmpNumero = (a, b) => {
  const x = numSol(a), y = numSol(b);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return x.localeCompare(y, "es", { numeric: true });
};

async function vistaBitacora() {
  vista().innerHTML = "<div class='card'>Cargando…</div>";
  const [{ data: sols, error }, { data: movs, error: errMov }] = await Promise.all([
    cargarTodas(() => sb.from("solicitud").select("id, correlativo, n_solicitud, fecha_solicitud, motivo, estado, solicitante, unidad(nombre)").order("id")),
    cargarTodas(() => sb.from("bitacora").select("id, solicitud_id, ocurrido_en").order("id")),
  ]);
  if (error || errMov) {
    vista().innerHTML = `<div class="card error">No se pudo leer la bitácora: ${esc((error || errMov).message)}
      <br><small>Falta correr <code>Documentacion/anulacion-y-bitacora.sql</code> en Supabase.</small></div>`;
    return;
  }
  const resumen = {};
  (movs || []).forEach(m => {
    const k = m.solicitud_id || "__sin";
    const r = resumen[k] || (resumen[k] = { n: 0, ultimo: null });
    r.n++;
    if (!r.ultimo || m.ocurrido_en > r.ultimo) r.ultimo = m.ocurrido_en;
  });
  const filas = (sols || []).slice().sort(_cmpNumero);
  if (resumen.__sin) filas.push({ id: "__sin", correlativo: "", motivo: "Movimientos sin solicitud (convenio)", estado: "", unidad: null });

  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Bitácora de movimientos</h3>
      <p class="hint">Elige una solicitud para ver todo lo que pasó con su expediente: ingreso, aprobaciones, guías, factura, anulaciones y descuentos del convenio.</p>
      ${listaBarra("bit", ESTADOS_SOLICITUD)}
    </div>`;
  listaCrear("bit", filas,
    (s) => `${numSol(s)} ${s.motivo} ${s.unidad?.nombre} ${s.solicitante} ${s.fecha_solicitud}`,
    `<tr><th>N°</th><th>Fecha</th><th>Unidad</th><th>Motivo</th><th>Estado</th><th class="num">Movimientos</th><th>Último</th><th></th></tr>`,
    (s) => {
      const r = resumen[s.id] || { n: 0, ultimo: null };
      return `<tr>
        <td class="num">${esc(numSol(s)) || "—"}</td>
        <td>${s.fecha_solicitud || ""}</td>
        <td>${esc(s.unidad?.nombre)}</td>
        <td>${esc(s.motivo)}</td>
        <td>${s.estado ? `<span class="pill ${s.estado}">${s.estado}</span>` : "—"}</td>
        <td class="num">${r.n || "—"}</td>
        <td>${r.ultimo ? _fechaHora(r.ultimo) : "—"}</td>
        <td><button class="secundario" onclick="bitacoraSolicitud('${s.id}')">Ver bitácora</button></td>
      </tr>`;
    });
  listaPintar("bit");
}

async function bitacoraSolicitud(id) {
  vista().innerHTML = "<div class='card'>Cargando…</div>";
  const sin = id === "__sin";
  const consulta = sb.from("bitacora").select("*").order("id", { ascending: true });
  const [{ data: s }, { data: rows, error }] = await Promise.all([
    sin ? Promise.resolve({ data: null }) : sb.from("solicitud").select("id, correlativo, n_solicitud, motivo, estado, fecha_solicitud, solicitante, unidad(nombre)").eq("id", id).single(),
    sin ? consulta.is("solicitud_id", null) : consulta.eq("solicitud_id", id),
  ]);
  if (error) { vista().innerHTML = `<div class="card error">${esc(error.message)}</div>`; return; }
  vista().innerHTML = `
    <div class="card">
      <button class="secundario" onclick="vistaBitacora()">‹ Volver a la bitácora</button>
      <h3 style="margin:.8rem 0 .2rem">${s ? `Solicitud ${esc(numSol(s)) || "sin número"}` : "Movimientos sin solicitud"}</h3>
      ${s ? `<p class="hint" style="margin:0">${esc(s.unidad?.nombre)} · ${s.fecha_solicitud || ""} · ${esc(s.motivo)} · <span class="pill ${s.estado}">${s.estado}</span></p>
      <p style="margin:.6rem 0 0"><button class="secundario" onclick="abrirExpediente('${s.id}')">Abrir expediente</button></p>` : ""}
    </div>
    ${bloqueBitacora(rows || [])}`;
}

// ---------- Compra por Mercado Público (solo solicitudes tipo "especial") ----------
function bloqueCompraEspecial(s, cotizaciones, opero) {
  const sumaCot = cotizaciones.reduce((a, c) => a + Number(c.monto_bruto || 0), 0);
  return `
    <div class="card">
      <div class="exp-seccion"><h4>Cotizaciones</h4><span class="hint">${cotizaciones.length} registrada(s)</span></div>
      ${cotizaciones.length ? `
        <table>
          <tr><th>Proveedor</th><th>N°</th><th>Fecha</th><th class="num">Neto</th><th class="num">IVA</th><th class="num">Bruto</th><th>Adjunto</th></tr>
          ${cotizaciones.map(c => `<tr>
            <td>${esc(c.proveedor)}</td>
            <td>${esc(c.numero)}</td>
            <td>${c.fecha || ""}</td>
            <td class="num">${money(c.monto_neto)}</td>
            <td class="num">${money(c.iva)}</td>
            <td class="num">${money(c.monto_bruto)}</td>
            <td>${c.archivo_url ? `${enlaceArchivo(c.archivo_url, `ver`)}` : "—"}</td>
          </tr>`).join("")}
        </table>
      ` : `<p class="hint">Aún no se registra ninguna cotización. Descarga la solicitud de cotización de arriba y envíala a la(s) empresa(s).</p>`}

      ${opero ? `
        <div style="border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem">
          <h4 style="margin-top:0">Registrar cotización recibida</h4>
          <div class="linea-detalle" style="grid-template-columns:2fr 1fr 1fr">
            <div><label>Proveedor cotizado</label><input id="ct-prov" placeholder="Razón social"></div>
            <div><label>N° cotización</label><input id="ct-num"></div>
            <div><label>Fecha</label><input id="ct-fecha" type="date"></div>
          </div>
          <div class="linea-detalle" style="grid-template-columns:1fr 1fr 1fr">
            <div><label>Monto neto</label><input id="ct-neto" type="number" min="0" step="1" oninput="recalcMontos('ct')"></div>
            <div><label>IVA (19%)</label><input id="ct-iva" type="number" min="0" step="1"></div>
            <div><label>Monto bruto</label><input id="ct-bruto" type="number" min="0" step="1"></div>
          </div>
          <label>Adjuntar cotización (PDF)</label>
          <input id="ct-archivo" type="file" accept=".pdf,image/*">
          <button class="primario" onclick="guardarCotizacion('${s.id}')">Guardar cotización</button>
          <p class="error oculto" id="ct-error"></p>
        </div>
      ` : ""}
    </div>

    <div class="card">
      <div class="exp-seccion"><h4>Documentación de compra por Mercado Público</h4></div>
      <p class="hint">Con la cotización en mano, arma la resolución/decreto que autoriza el gasto y
        genera la orden de compra en Mercado Público antes de pedir el despacho.</p>
      <div class="exp-datos">
        <div><div class="d-k">N° decreto</div>${esc(s.n_decreto) || "—"}</div>
        <div><div class="d-k">Fecha decreto</div>${s.fecha_decreto || "—"}</div>
        <div><div class="d-k">Decreto</div>${s.decreto_url ? `${enlaceArchivo(s.decreto_url, `ver documento`)}` : "sin adjunto"}</div>
        <div><div class="d-k">N° orden de compra</div>${esc(s.n_orden_compra) || "—"}</div>
        <div><div class="d-k">Fecha OC</div>${s.fecha_oc || "—"}</div>
        <div><div class="d-k">Orden de compra</div>${s.oc_url ? `${enlaceArchivo(s.oc_url, `ver documento`)}` : "sin adjunto"}</div>
      </div>

      ${opero ? `
        <div style="border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem">
          <h4 style="margin-top:0">${s.n_decreto || s.n_orden_compra ? "Actualizar" : "Registrar"} decreto y orden de compra</h4>
          <div class="linea-detalle" style="grid-template-columns:1fr 1fr">
            <div><label>N° decreto</label><input id="dc-num" value="${esc(s.n_decreto)}" placeholder="Ej: 1234"></div>
            <div><label>Fecha del decreto</label><input id="dc-fecha" type="date" value="${s.fecha_decreto || ""}"></div>
          </div>
          <label>Adjuntar decreto (PDF)</label>
          <input id="dc-archivo" type="file" accept=".pdf">
          <div class="linea-detalle" style="grid-template-columns:1fr 1fr">
            <div><label>N° orden de compra (Mercado Público)</label><input id="oc-num" value="${esc(s.n_orden_compra)}" placeholder="Ej: 2440-15-CM26"></div>
            <div><label>Fecha OC</label><input id="oc-fecha" type="date" value="${s.fecha_oc || ""}"></div>
          </div>
          <label>Adjuntar orden de compra (PDF)</label>
          <input id="oc-archivo" type="file" accept=".pdf">
          <button class="primario" onclick="guardarDocumentacionEspecial('${s.id}')">Guardar documentación</button>
          <p class="error oculto" id="dc-error"></p>
          <p class="ok-msg oculto" id="dc-ok"></p>
        </div>
      ` : ""}
    </div>

    <div class="card">
      <div class="exp-seccion"><h4>Justificaciones obligatorias (fuera de catálogo · Manual, punto 10)</h4></div>
      <div class="exp-datos">
        <div><div class="d-k">Justificación Unidad Jurídica</div>${s.just_juridica_url ? `${enlaceArchivo(s.just_juridica_url, `ver documento`)}` : "sin adjunto"}</div>
        <div><div class="d-k">Justificación DAF</div>${s.just_daf_url ? `${enlaceArchivo(s.just_daf_url, `ver documento`)}` : "sin adjunto"}</div>
      </div>
      ${s.cdp_negativo ? `
        <p class="hint" style="color:var(--warn);margin-top:.8rem">⚠ CDP negativo (Manual, punto 8): además se adjunta CDP negativo,
          justificación reforzada, respaldo fotográfico y pronunciamiento de la Unidad Jurídica.</p>
        <div class="exp-datos">
          <div><div class="d-k">CDP negativo</div>${s.cdp_negativo_url ? `${enlaceArchivo(s.cdp_negativo_url, `ver`)}` : "sin adjunto"}</div>
          <div><div class="d-k">Justificación reforzada</div>${s.just_reforzada_url ? `${enlaceArchivo(s.just_reforzada_url, `ver`)}` : "sin adjunto"}</div>
          <div><div class="d-k">Pronunciamiento Jurídica</div>${s.pronunciamiento_juridica_url ? `${enlaceArchivo(s.pronunciamiento_juridica_url, `ver`)}` : "sin adjunto"}</div>
          <div><div class="d-k">Respaldo fotográfico</div>${s.resp_fotografico_url ? `${enlaceArchivo(s.resp_fotografico_url, `ver`)}` : "sin adjunto"}</div>
        </div>` : ""}

      ${opero ? `
        <div style="border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem">
          <h4 style="margin-top:0">Adjuntar / actualizar justificaciones</h4>
          <label>Justificación de la Unidad Jurídica (PDF)</label>
          <input id="jj-juridica" type="file" accept=".pdf,image/*">
          <label>Justificación de la DAF (PDF)</label>
          <input id="jj-daf" type="file" accept=".pdf,image/*">
          ${s.cdp_negativo ? `
            <label>CDP negativo (PDF)</label><input id="jj-cdp" type="file" accept=".pdf,image/*">
            <label>Justificación reforzada (PDF)</label><input id="jj-reforzada" type="file" accept=".pdf,image/*">
            <label>Pronunciamiento Unidad Jurídica (PDF)</label><input id="jj-pronunciamiento" type="file" accept=".pdf,image/*">
            <label>Respaldo fotográfico (PDF o imagen)</label><input id="jj-foto" type="file" accept=".pdf,image/*">
          ` : ""}
          <button class="primario" onclick="guardarJustificacionesEspecial('${s.id}', ${s.cdp_negativo ? "true" : "false"})">Guardar justificaciones</button>
          <p class="error oculto" id="jj-error"></p>
          <p class="ok-msg oculto" id="jj-ok"></p>
        </div>
      ` : ""}
    </div>
  `;
}

async function guardarJustificacionesEspecial(solicitudId, conCdp) {
  if (!_lock()) return;
  try {
  const errorEl = document.getElementById("jj-error");
  const okEl = document.getElementById("jj-ok");
  errorEl.classList.add("oculto"); okEl.classList.add("oculto");

  const subir = async (id) => {
    const f = document.getElementById(id);
    if (!f || !f.files[0]) return null;
    const { url, error } = await subirArchivo("especiales", f.files[0]);
    if (error) throw new Error(error);
    return url;
  };

  try {
    const payload = {};
    const jur = await subir("jj-juridica"); if (jur) payload.just_juridica_url = jur;
    const daf = await subir("jj-daf");      if (daf) payload.just_daf_url = daf;
    if (conCdp) {
      const cdp = await subir("jj-cdp");             if (cdp) payload.cdp_negativo_url = cdp;
      const ref = await subir("jj-reforzada");       if (ref) payload.just_reforzada_url = ref;
      const pro = await subir("jj-pronunciamiento"); if (pro) payload.pronunciamiento_juridica_url = pro;
      const fot = await subir("jj-foto");            if (fot) payload.resp_fotografico_url = fot;
    }
    if (!Object.keys(payload).length) { errorEl.textContent = "No seleccionaste ningún archivo."; errorEl.classList.remove("oculto"); return; }
    const { error } = await sb.from("solicitud").update(payload).eq("id", solicitudId);
    if (error) { errorEl.textContent = "No se pudo guardar: " + error.message; errorEl.classList.remove("oculto"); return; }
    okEl.textContent = "Justificaciones guardadas."; okEl.classList.remove("oculto");
    vistaExpediente(solicitudId);
  } catch (e) {
    errorEl.textContent = e.message; errorEl.classList.remove("oculto");
  }
  } finally { _unlock(); }
}

async function guardarCotizacion(solicitudId) {
  if (!_lock()) return;
  try {
  const errorEl = document.getElementById("ct-error");
  errorEl.classList.add("oculto");
  const proveedor = document.getElementById("ct-prov").value.trim();
  const fecha = document.getElementById("ct-fecha").value || null;
  const monto_neto = parseFloat(document.getElementById("ct-neto").value) || 0;
  if (!proveedor || !fecha || !monto_neto) { errorEl.textContent = "Proveedor, fecha y monto neto son obligatorios."; errorEl.classList.remove("oculto"); return; }

  const { url, error: upErr } = await subirArchivo("especiales", document.getElementById("ct-archivo").files[0]);
  if (upErr) { errorEl.textContent = upErr; errorEl.classList.remove("oculto"); return; }

  const iva = parseFloat(document.getElementById("ct-iva").value) || calcIva(monto_neto);
  const monto_bruto = parseFloat(document.getElementById("ct-bruto").value) || (monto_neto + iva);
  const { error } = await sb.from("cotizacion").insert({
    solicitud_id: solicitudId,
    proveedor,
    numero: document.getElementById("ct-num").value.trim() || null,
    fecha, monto_neto, iva, monto_bruto,
    archivo_url: url,
    creado_por: perfilActual.id,
  });
  if (error) { errorEl.textContent = "No se pudo guardar: " + error.message; errorEl.classList.remove("oculto"); return; }
  vistaExpediente(solicitudId);
  } finally { _unlock(); }
}

// Orden de compra de las solicitudes normales y de Obras (las especiales la
// registran en su propio bloque). Usa las mismas columnas de `solicitud`.
function bloqueOrdenCompra(s, opero) {
  return `
    <div class="card">
      <div class="exp-seccion"><h4>Orden de compra</h4></div>
      <div class="exp-datos">
        <div><div class="d-k">N° orden de compra</div>${esc(s.n_orden_compra) || "—"}</div>
        <div><div class="d-k">Fecha OC</div>${s.fecha_oc || "—"}</div>
        <div><div class="d-k">Orden de compra</div>${s.oc_url ? enlaceArchivo(s.oc_url, "ver documento") : "sin adjunto"}</div>
      </div>
      ${opero ? `
        <div style="border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem">
          <h4 style="margin-top:0">${s.n_orden_compra || s.oc_url ? "Actualizar" : "Registrar"} orden de compra</h4>
          <div class="linea-detalle" style="grid-template-columns:1fr 1fr">
            <div><label>N° orden de compra</label><input id="oc-num" value="${esc(s.n_orden_compra)}" placeholder="Ej: 2440-15-CM26"></div>
            <div><label>Fecha OC</label><input id="oc-fecha" type="date" value="${s.fecha_oc || ""}"></div>
          </div>
          <label>Adjuntar orden de compra (PDF)</label>
          <input id="oc-archivo" type="file" accept=".pdf,image/*">
          <button class="primario" onclick="guardarOrdenCompra('${s.id}')">Guardar orden de compra</button>
          <p class="error oculto" id="oc-error"></p>
        </div>` : ""}
    </div>`;
}

async function guardarOrdenCompra(solicitudId) {
  if (!_lock()) return;
  try {
    const errorEl = document.getElementById("oc-error");
    errorEl.classList.add("oculto");
    const { url, error: up } = await subirArchivo("memos", document.getElementById("oc-archivo").files[0]);
    if (up) { errorEl.textContent = up; errorEl.classList.remove("oculto"); return; }
    const payload = {
      n_orden_compra: document.getElementById("oc-num").value.trim() || null,
      fecha_oc: document.getElementById("oc-fecha").value || null,
    };
    if (url) payload.oc_url = url;
    const { error } = await sb.from("solicitud").update(payload).eq("id", solicitudId);
    if (error) { errorEl.textContent = "No se pudo guardar: " + error.message; errorEl.classList.remove("oculto"); return; }
    vistaExpediente(solicitudId);
  } finally { _unlock(); }
}

async function guardarDocumentacionEspecial(solicitudId) {
  if (!_lock()) return;
  try {
  const errorEl = document.getElementById("dc-error");
  const okEl = document.getElementById("dc-ok");
  errorEl.classList.add("oculto"); okEl.classList.add("oculto");

  const { url: decretoUrl, error: e1 } = await subirArchivo("especiales", document.getElementById("dc-archivo").files[0]);
  if (e1) { errorEl.textContent = e1; errorEl.classList.remove("oculto"); return; }
  const { url: ocUrl, error: e2 } = await subirArchivo("especiales", document.getElementById("oc-archivo").files[0]);
  if (e2) { errorEl.textContent = e2; errorEl.classList.remove("oculto"); return; }

  const payload = {
    n_decreto: document.getElementById("dc-num").value.trim() || null,
    fecha_decreto: document.getElementById("dc-fecha").value || null,
    n_orden_compra: document.getElementById("oc-num").value.trim() || null,
    fecha_oc: document.getElementById("oc-fecha").value || null,
  };
  if (decretoUrl) payload.decreto_url = decretoUrl;
  if (ocUrl) payload.oc_url = ocUrl;

  const { error } = await sb.from("solicitud").update(payload).eq("id", solicitudId);
  if (error) { errorEl.textContent = "No se pudo guardar: " + error.message; errorEl.classList.remove("oculto"); return; }
  okEl.textContent = "Guardado."; okEl.classList.remove("oculto");
  vistaExpediente(solicitudId);
  } finally { _unlock(); }
}

function hoyISO() { return new Date().toISOString().slice(0, 10); }

function recalcMontos(pref) {
  const neto = parseFloat(document.getElementById(pref + "-neto").value) || 0;
  document.getElementById(pref + "-iva").value = calcIva(neto);
  document.getElementById(pref + "-bruto").value = calcBruto(neto);
}

async function avanzarEstado(id, estado) {
  const paso = {
    enviada: ["Marcar como enviada", "La hoja de solicitud se da por enviada a la empresa."],
    recibida: ["Marcar material recibido", "Confirma que el material llegó. Registra antes las guías de despacho."],
    cerrada: ["Cerrar el expediente", "Una vez cerrado el expediente no se agregan más documentos."],
  }[estado];
  if (paso && !await confirmar({ titulo: paso[0], texto: paso[1], boton: "Confirmar" })) return;
  await sb.from("solicitud").update({ estado }).eq("id", id);
  actualizarNotificaciones();
  vistaExpediente(id);
}

async function guardarGuia(solicitudId) {
  if (!_lock()) return;
  try {
  const errorEl = document.getElementById("gd-error");
  errorEl.classList.add("oculto");
  const numero = document.getElementById("gd-num").value.trim();
  const fecha = document.getElementById("gd-fecha").value || null;
  const monto_neto = parseFloat(document.getElementById("gd-neto").value) || 0;
  if (!numero || !fecha || !monto_neto) { errorEl.textContent = "N° de guía, fecha y monto neto son obligatorios."; errorEl.classList.remove("oculto"); return; }

  const { url, error: upErr } = await subirArchivo("guias", document.getElementById("gd-archivo").files[0]);
  if (upErr) { errorEl.textContent = upErr; errorEl.classList.remove("oculto"); return; }

  const iva = parseFloat(document.getElementById("gd-iva").value) || calcIva(monto_neto);
  const monto_bruto = parseFloat(document.getElementById("gd-bruto").value) || (monto_neto + iva);
  const { error } = await sb.from("guia_despacho").insert({
    solicitud_id: solicitudId, numero, fecha,
    fecha_ingreso: document.getElementById("gd-ingreso").value || hoyISO(),
    monto_neto, iva, monto_bruto,
    archivo_url: url,
    observacion: document.getElementById("gd-obs").value.trim() || null,
    creado_por: perfilActual.id,
  });
  if (error) { errorEl.textContent = "No se pudo guardar: " + error.message; errorEl.classList.remove("oculto"); return; }

  if (["aprobada", "enviada"].includes(window._expActual?.s?.estado)) {
    await sb.from("solicitud").update({ estado: "recibida" }).eq("id", solicitudId);
  }
  vistaExpediente(solicitudId);
  } finally { _unlock(); }
}

async function guardarFactura(solicitudId) {
  if (!_lock()) return;
  try {
  const errorEl = document.getElementById("fc-error");
  errorEl.classList.add("oculto");
  const numero = document.getElementById("fc-num").value.trim();
  const fecha = document.getElementById("fc-fecha").value || null;
  const monto_neto = parseFloat(document.getElementById("fc-neto").value) || 0;
  if (!numero || !fecha || !monto_neto) { errorEl.textContent = "N° de factura, fecha y monto neto son obligatorios."; errorEl.classList.remove("oculto"); return; }

  const { url, error: upErr } = await subirArchivo("facturas", document.getElementById("fc-archivo").files[0]);
  if (upErr) { errorEl.textContent = upErr; errorEl.classList.remove("oculto"); return; }

  const iva = parseFloat(document.getElementById("fc-iva").value) || calcIva(monto_neto);
  const monto_bruto = parseFloat(document.getElementById("fc-bruto").value) || (monto_neto + iva);
  const { data: nueva, error } = await sb.from("factura").insert({
    solicitud_id: solicitudId, numero, fecha,
    monto_neto, iva, monto_bruto,
    fecha_pago: document.getElementById("fc-pago").value || null,
    archivo_url: url,
    creado_por: perfilActual.id,
  }).select("id").single();
  if (error) { errorEl.textContent = "No se pudo guardar: " + error.message; errorEl.classList.remove("oculto"); return; }

  await sb.from("solicitud").update({ estado: "facturada" }).eq("id", solicitudId);
  await descontarDelConvenio(nueva.id);
  vistaExpediente(solicitudId);
  } finally { _unlock(); }
}

// Descuenta del saldo del convenio: registra la factura en `compra` con su
// monto bruto; el trigger trg_compra_movimiento crea el movimiento_saldo.
// Devuelve true si quedó descontada.
// El monto sale de la factura ya registrada, lo calcula la función de la base
// (descontar_factura): el navegador ya no escribe en `compra`.
async function descontarDelConvenio(facturaId) {
  const { data, error } = await sb.rpc("descontar_factura", { p_factura_id: facturaId });
  // Mientras no se haya corrido seguridad-endurecimiento.sql la función no existe:
  // se usa el descuento anterior. Cuando exista, esta vía queda sin uso.
  if (error && (error.code === "PGRST202" || /could not find the function/i.test(error.message || ""))) {
    return descontarDirecto(facturaId);
  }
  if (error) {
    alert("No se pudo descontar del convenio: " + error.message + "\nRevísalo en el Resumen.");
    return false;
  }
  return data?.descontado !== false || /ya estaba/i.test(data?.motivo || "");
}

async function descontarDirecto(facturaId) {
  const { data: f } = await sb.from("factura").select("solicitud_id, numero, monto_bruto").eq("id", facturaId).single();
  const { data: contrato } = await sb.from("contrato").select("id, monto_tope_anual")
    .eq("estado", "vigente").order("creado_en", { ascending: false }).limit(1).maybeSingle();
  if (!f || !contrato || !contrato.monto_tope_anual) {
    alert("No hay un contrato vigente con monto tope anual cargado — no se pudo descontar del convenio. Revísalo en 'Convenio / ferretería'.");
    return false;
  }
  const { error } = await sb.from("compra").insert({
    contrato_id: contrato.id, solicitud_id: f.solicitud_id,
    n_oc: "FACT " + f.numero, monto_total: f.monto_bruto, creado_por: perfilActual.id,
  });
  if (error) { alert("No se pudo descontar del convenio: " + error.message + "\nRevísalo en el Resumen."); return false; }
  return true;
}

async function reintentarDescuentoFactura(solicitudId, facturaId) {
  const ok = await descontarDelConvenio(facturaId);
  if (ok) alert("Listo, se descontó del convenio.");
  vistaExpediente(solicitudId);
}

// El reverso del convenio al anular una factura lo hace la función Postgres
// public.anular_factura() en una sola transacción (ver anularFactura más abajo
// y Documentacion/anulacion-y-bitacora.sql). Ya no se toca el saldo desde el
// navegador: nada de borrar movimientos ni recalcular la cadena a mano.

// Pide un motivo obligatorio. Devuelve el texto, o null si el usuario cancela.
async function _pedirMotivo(titulo, ayuda) {
  return confirmar({ titulo, texto: (ayuda ? ayuda + " " : "") + "El motivo queda en la bitácora.", boton: "Anular", motivo: true });
}

// ---------- Editar / anular factura (correcciones de digitación) ----------
function editarFactura(facturaId, solicitudId) { editarFacturaId = facturaId; vistaExpediente(solicitudId); }
function cancelarEdicionFactura(solicitudId) { editarFacturaId = null; vistaExpediente(solicitudId); }

async function actualizarFactura(solicitudId, facturaId) {
  if (!_lock()) return;
  try {
  const errorEl = document.getElementById("fc-error");
  errorEl.classList.add("oculto");
  const numero = document.getElementById("fc-num").value.trim();
  const fecha = document.getElementById("fc-fecha").value || null;
  const monto_neto = parseFloat(document.getElementById("fc-neto").value) || 0;
  if (!numero || !fecha || !monto_neto) { errorEl.textContent = "N° de factura, fecha y monto neto son obligatorios."; errorEl.classList.remove("oculto"); return; }

  const payload = {
    numero, fecha, monto_neto,
    iva: parseFloat(document.getElementById("fc-iva").value) || calcIva(monto_neto),
    fecha_pago: document.getElementById("fc-pago").value || null,
  };
  payload.monto_bruto = parseFloat(document.getElementById("fc-bruto").value) || (monto_neto + payload.iva);

  const file = document.getElementById("fc-archivo").files[0];
  if (file) {
    const { url, error: upErr } = await subirArchivo("facturas", file);
    if (upErr) { errorEl.textContent = upErr; errorEl.classList.remove("oculto"); return; }
    payload.archivo_url = url;
  }

  // El botón "Editar" solo aparece si la factura AÚN no se descontó del
  // convenio, así que aquí no hay saldo que tocar — solo se corrige la fila.
  const { error } = await sb.from("factura").update(payload).eq("id", facturaId);
  if (error) { errorEl.textContent = "No se pudo guardar: " + error.message; errorEl.classList.remove("oculto"); return; }

  editarFacturaId = null;
  vistaExpediente(solicitudId);
  } finally { _unlock(); }
}

// Anula la factura (no se borra) y, si ya estaba descontada, revierte el
// convenio con un movimiento nuevo. Todo lo hace la función Postgres
// public.anular_factura() en una transacción; acá solo se pide el motivo
// y se repone el estado de la solicitud.
async function anularFactura(solicitudId, facturaId) {
  const motivo = await _pedirMotivo("Anular la factura", "Ej: dígito mal ingresado, monto equivocado. Si ya se descontó, el convenio se revierte.");
  if (!motivo) return;
  if (!_lock()) return;
  try {
    const { error } = await sb.rpc("anular_factura", { p_factura_id: facturaId, p_motivo: motivo });
    if (error) { alert("No se pudo anular: " + error.message); return; }

    const { data: guiasRestantes } = await sb.from("guia_despacho")
      .select("id").eq("solicitud_id", solicitudId).eq("anulado", false);
    await sb.from("solicitud")
      .update({ estado: (guiasRestantes && guiasRestantes.length) ? "recibida" : "aprobada" })
      .eq("id", solicitudId);

    vistaExpediente(solicitudId);
  } finally { _unlock(); }
}

// Anula una guía de despacho mal cargada (no se borra; queda en la bitácora).
// La guía no descuenta del convenio, así que basta con marcarla.
async function anularGuia(id, solicitudId) {
  const motivo = await _pedirMotivo("Anular la guía de despacho", "Ej: N° o monto mal ingresado.");
  if (!motivo) return;
  const { error } = await sb.from("guia_despacho").update({
    anulado: true, anulado_por: perfilActual.id,
    anulado_motivo: motivo, anulado_en: new Date().toISOString(),
  }).eq("id", id);
  if (error) { alert("No se pudo anular: " + error.message); return; }
  vistaExpediente(solicitudId);
}

// ---------- Notas de crédito (corrigen una factura ya emitida) ----------
function bloqueNotasCredito(s, factura, notas, opero) {
  const totalNC = (notas || []).filter(n => !n.anulado).reduce((a, n) => a + Number(n.monto_bruto || 0), 0);
  return `
    <div class="card">
      <div class="exp-seccion"><h4>Notas de crédito</h4><span class="hint">${(notas || []).length} registrada(s)</span></div>
      <p class="hint">Regístralas cuando el proveedor emite una nota de crédito que corrige o anula parte de la factura (no se edita la factura original).</p>
      ${(notas || []).length ? `
        <table>
          <tr><th>N°</th><th>Fecha</th><th>Motivo</th><th class="num">Neto</th><th class="num">IVA</th><th class="num">Bruto</th><th>Adjunto</th><th></th></tr>
          ${notas.map(n => `<tr${n.anulado ? ' class="fila-anulada"' : ''}>
            <td>${esc(n.numero)}${n.anulado ? ' <span class="pill anulada">anulada</span>' : ''}</td>
            <td>${n.fecha || ""}</td>
            <td>${esc(n.motivo)}</td>
            <td class="num">${money(n.monto_neto)}</td>
            <td class="num">${money(n.iva)}</td>
            <td class="num">${money(n.monto_bruto)}</td>
            <td>${n.archivo_url ? `${enlaceArchivo(n.archivo_url, `ver`)}` : "—"}</td>
            <td>${n.anulado
                  ? `<span class="hint" title="${esc(n.anulado_motivo)}">motivo ⓘ</span>`
                  : (opero ? `<button class="secundario" onclick="anularNotaCredito('${n.id}','${s.id}')">Anular</button>` : "")}</td>
          </tr>`).join("")}
        </table>
        <div class="totales">
          <span>Factura: <b>${money(factura.monto_bruto)}</b></span>
          <span>Notas de crédito: <b>-${money(totalNC)}</b></span>
          <span>Total ajustado: <b>${money(Number(factura.monto_bruto || 0) - totalNC)}</b></span>
        </div>
      ` : ""}

      ${opero ? `
        <div style="border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem">
          <h4 style="margin-top:0">Registrar nota de crédito</h4>
          <div class="linea-detalle" style="grid-template-columns:1fr 1fr 2fr">
            <div><label>N° nota de crédito</label><input id="nc-num" placeholder="Ej: 1832"></div>
            <div><label>Fecha</label><input id="nc-fecha" type="date"></div>
            <div><label>Motivo</label><input id="nc-motivo" placeholder="Ej: corrige el monto de la factura"></div>
          </div>
          <div class="linea-detalle" style="grid-template-columns:1fr 1fr 1fr">
            <div><label>Monto neto</label><input id="nc-neto" type="number" min="0" step="1" oninput="recalcMontos('nc')"></div>
            <div><label>IVA (19%)</label><input id="nc-iva" type="number" min="0" step="1"></div>
            <div><label>Monto bruto</label><input id="nc-bruto" type="number" min="0" step="1"></div>
          </div>
          <label>Adjuntar nota de crédito (PDF)</label>
          <input id="nc-archivo" type="file" accept=".pdf,image/*">
          <button class="primario" onclick="guardarNotaCredito('${s.id}','${factura.id}')">Guardar nota de crédito</button>
          <p class="error oculto" id="nc-error"></p>
        </div>
      ` : ""}
    </div>
  `;
}

async function guardarNotaCredito(solicitudId, facturaId) {
  if (!_lock()) return;
  try {
  const errorEl = document.getElementById("nc-error");
  errorEl.classList.add("oculto");
  const fecha = document.getElementById("nc-fecha").value || null;
  const monto_neto = parseFloat(document.getElementById("nc-neto").value) || 0;
  if (!fecha || !monto_neto) { errorEl.textContent = "Fecha y monto neto son obligatorios."; errorEl.classList.remove("oculto"); return; }

  const { url, error: upErr } = await subirArchivo("facturas", document.getElementById("nc-archivo").files[0]);
  if (upErr) { errorEl.textContent = upErr; errorEl.classList.remove("oculto"); return; }

  const iva = parseFloat(document.getElementById("nc-iva").value) || calcIva(monto_neto);
  const monto_bruto = parseFloat(document.getElementById("nc-bruto").value) || (monto_neto + iva);
  const { error } = await sb.from("nota_credito").insert({
    solicitud_id: solicitudId, factura_id: facturaId,
    numero: document.getElementById("nc-num").value.trim() || null,
    fecha, motivo: document.getElementById("nc-motivo").value.trim() || null,
    monto_neto, iva, monto_bruto,
    archivo_url: url,
    creado_por: perfilActual.id,
  });
  if (error) { errorEl.textContent = "No se pudo guardar: " + error.message; errorEl.classList.remove("oculto"); return; }
  vistaExpediente(solicitudId);
  } finally { _unlock(); }
}

async function anularNotaCredito(id, solicitudId) {
  const motivo = await _pedirMotivo("Anular la nota de crédito");
  if (!motivo) return;
  const { error } = await sb.from("nota_credito").update({
    anulado: true, anulado_por: perfilActual.id,
    anulado_motivo: motivo, anulado_en: new Date().toISOString(),
  }).eq("id", id);
  if (error) { alert("No se pudo anular: " + error.message); return; }
  vistaExpediente(solicitudId);
}

// ---------- Hoja de solicitud (PDF, estilo cotización) ----------
async function descargarHojaPDF() {
  const exp = window._expActual;
  if (!exp) return;
  if (!window.jspdf || !window.jspdf.jsPDF) { alert("No se pudo cargar el generador de PDF. Revisa la conexión."); return; }
  const { s, detalle } = exp;
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
  const M = 18;
  let y = M;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text("MUNICIPALIDAD DE DOÑIHUE", M, y);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  y += 6; doc.text("Dirección de Obras — Unidad de Operaciones", M, y);
  y += 5; doc.text("Control Ferretería · Convenio de suministro de materiales", M, y);

  const especial = s.tipo === "especial";
  y += 10;
  doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(`${especial ? "SOLICITUD DE COTIZACIÓN" : "SOLICITUD DE MATERIALES"}${numSol(s) ? "  N° " + numSol(s) : ""}`, M, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);

  y += 9;
  const fila = (k, v) => { doc.setFont("helvetica", "bold"); doc.text(k, M, y); doc.setFont("helvetica", "normal"); const lns = doc.splitTextToSize(String(v || "—"), 130); doc.text(lns, M + 46, y); y += 6 + (lns.length - 1) * 4.5; };
  fila("N° de solicitud:", numSol(s));
  fila("Fecha:", s.fecha_solicitud || hoyISO());
  fila(s.unidad_interna ? "Dirección responsable:" : "Unidad solicitante:", exp.s.unidad?.nombre || "");
  if (s.unidad_interna) fila("Unidad:", s.unidad_interna);
  fila("Responsable:", s.solicitante || "");
  fila("Contacto:", s.contacto || "");
  fila("Supervisa ejecución:", s.supervisor || "");
  fila("Ubicación de uso:", s.ubicacion || "");
  y += 2;
  fila("Descripción:", s.descripcion_requerimiento || "");
  fila("Fundamento / motivo:", s.motivo || "");
  fila("Situación actual:", s.situacion_actual || "");
  fila("Trabajo a ejecutar:", s.trabajo_ejecutar || "");

  y += 4;
  if (y > 250) { doc.addPage(); y = M; }
  doc.setFont("helvetica", "bold");
  doc.text("MATERIALES SOLICITADOS", M, y); y += 3;
  doc.setDrawColor(180); doc.line(M, y, 210 - M, y); y += 6;

  // Con precios (listado del contrato) se agregan Valor unitario y Subtotal por
  // ítem y el total; la solicitud de cotización (fuera de catálogo) no los lleva.
  const conValor = !especial && (detalle || []).some(d => valorUnitarioNeto(d) != null);
  const R = 210 - M; // borde derecho
  const xCant = conValor ? 112 : 140, xUni = conValor ? 123 : 172, anchoMat = conValor ? 78 : 108;
  const derecha = (txt, x) => doc.text(String(txt), x, y, { align: "right" });

  doc.text("N°", M, y);
  doc.text("Material", M + 9, y);
  if (conValor) derecha("Cantidad", xCant + 6); else doc.text("Cantidad", xCant, y);
  doc.text("Unidad", xUni, y);
  if (conValor) { derecha("Valor unit.", 160); derecha("Subtotal", R); }
  doc.setFont("helvetica", "normal");
  y += 2; doc.line(M, y, R, y); y += 6;

  (detalle || []).forEach((d, i) => {
    const lns = doc.splitTextToSize(String(d.articulo?.descripcion || d.descripcion_libre || ""), anchoMat);
    const alto = Math.max(7, lns.length * 4.6 + 2.4);
    if (y + alto > 265) { doc.addPage(); y = M; }
    doc.text(String(i + 1), M, y);
    doc.text(lns, M + 9, y);
    if (conValor) derecha(d.cantidad_solicitada ?? "", xCant + 6); else doc.text(String(d.cantidad_solicitada ?? ""), xCant, y);
    doc.text(String(d.unidad_medida_libre || d.articulo?.unidad_medida || ""), xUni, y);
    if (conValor) {
      const p = valorUnitarioNeto(d);
      derecha(p == null ? "—" : money(p), 160);
      derecha(p == null ? "—" : money(p * Number(d.cantidad_solicitada || 0)), R);
    }
    y += alto;
  });

  if (conValor) {
    const tot = totalesDetalle(detalle);
    if (y > 235) { doc.addPage(); y = M; }
    doc.line(M, y - 3, R, y - 3); y += 3;
    doc.text("Total neto", 160, y, { align: "right" }); derecha(money(tot.neto), R); y += 6;
    doc.text("IVA 19%", 160, y, { align: "right" }); derecha(money(tot.iva), R); y += 6;
    doc.setFont("helvetica", "bold");
    doc.text("TOTAL ESTIMADO", 160, y, { align: "right" }); derecha(money(tot.bruto), R); y += 6;
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(110);
    const nota = "Valores unitarios netos según el listado de precios del contrato. Monto estimado: el valor final se verifica con la guía de despacho y la factura." +
      (tot.sinValor ? ` ${tot.sinValor} línea(s) sin valor no están incluidas en el total.` : "");
    const nl = doc.splitTextToSize(nota, R - M);
    doc.text(nl, M, y); y += nl.length * 3.6;
    doc.setFontSize(10); doc.setTextColor(0);
  }

  // Firmas (PNG del bucket privado "firmas"). La del Director solo va si la
  // solicitud ya está aprobada; si falta alguna imagen queda la línea en blanco.
  const aprobadaPdf = ["aprobada", "enviada", "recibida", "facturada", "cerrada"].includes(s.estado);
  const [firmaIto, firmaDir] = await Promise.all([cargarFirma("ito.png"), aprobadaPdf ? cargarFirma("director.png") : null]);
  const altoFirma = 32, anchoBloque = 70;
  if (y > 225) { doc.addPage(); y = M; }
  const yLinea = y + altoFirma + 12;
  const bloques = [
    { x0: M, firma: firmaIto, texto: "Encargado de Operaciones (ITO)" },
    { x0: 210 - M - anchoBloque, firma: firmaDir, texto: "Director de Obras Municipales" },
  ];
  bloques.forEach(({ x0, firma, texto }) => {
    if (firma) {
      const k = Math.min((anchoBloque - 4) / firma.w, altoFirma / firma.h);
      const w = firma.w * k, h = firma.h * k;
      doc.addImage(firma.dataUrl, firma.formato, x0 + (anchoBloque - w) / 2, yLinea - h - 1, w, h);
    }
    doc.setDrawColor(120); doc.line(x0, yLinea, x0 + anchoBloque, yLinea);
    doc.text(texto, x0 + anchoBloque / 2, yLinea + 5, { align: "center" });
  });
  y = yLinea + 8;

  doc.setFontSize(8); doc.setTextColor(120);
  doc.text("Documento generado por Control Ferretería — Municipalidad de Doñihue", M, 288);

  const nombre = `solicitud-${numSol(s) || s.id.slice(0, 8)}.pdf`;
  doc.save(nombre);
}

// ---------------------------------------------------------------------
// Convenio / ferretería (solo admin): datos del contrato de suministro.
// El tope alimenta la vista resumen_convenio (el Resumen).
// ---------------------------------------------------------------------
async function vistaConvenio() {
  vista().innerHTML = "<div class='card'>Cargando…</div>";
  const { data: contratos, error } = await sb.from("contrato").select("*").order("creado_en", { ascending: false });
  if (error) {
    vista().innerHTML = `<div class="card error">No se pudo leer el convenio: ${error.message}
      <br><small>Falta la política RLS que deja al rol 'admin' editar la tabla 'contrato' (ver README).</small></div>`;
    return;
  }
  const c = (contratos || [])[0] || {};
  const nuevo = !c.id;

  // ¿qué firmas hay cargadas? (bucket privado "firmas", un objeto fijo por firma)
  const firmasHoy = {};
  for (const f of FIRMAS) {
    const { data } = await sb.storage.from("firmas").createSignedUrl(f.archivo, 300);
    firmasHoy[f.archivo] = data?.signedUrl || null;
  }

  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">${nuevo ? "Registrar convenio de suministro" : "Datos del convenio de suministro"}</h3>
      <p class="hint">Proveedor, N° de licitación, tope anual y vigencia. El <strong>monto tope anual</strong> es el que se ve en el Resumen y contra el que se descuentan las facturas.</p>

      <label>Proveedor</label>
      <input id="cv-prov" value="${esc(c.proveedor)}" placeholder="Razón social del proveedor">

      <label>N° de licitación / contrato</label>
      <input id="cv-lic" value="${esc(c.n_licitacion)}" placeholder="Ej: 2440-15-LP26">

      <label>Monto tope anual</label>
      <input id="cv-tope" type="number" min="0" step="1" value="${c.monto_tope_anual ?? ""}">

      <div class="linea-detalle" style="grid-template-columns:1fr 1fr">
        <div><label>Fecha de inicio</label><input id="cv-ini" type="date" value="${c.fecha_inicio || ""}"></div>
        <div><label>Fecha de término</label><input id="cv-fin" type="date" value="${c.fecha_termino || ""}"></div>
      </div>

      <label>Estado</label>
      <select id="cv-estado">
        ${["vigente", "suspendido", "cerrado"].map(e => `<option value="${e}" ${c.estado === e ? "selected" : ""}>${e}</option>`).join("")}
      </select>

      <button class="primario" id="cv-guardar">${nuevo ? "Registrar convenio" : "Guardar cambios"}</button>
      <p class="error oculto" id="cv-error"></p>
      <p class="ok-msg oculto" id="cv-ok"></p>
    </div>

    ${FIRMAS.map(f => tarjetaFirma(f, firmasHoy[f.archivo])).join("")}

    ${(contratos || []).length > 1 ? `
      <div class="card">
        <h4 style="margin-top:0">Convenios anteriores</h4>
        <table>
          <tr><th>Proveedor</th><th>N° lic.</th><th class="num">Tope</th><th>Vigencia</th><th>Estado</th></tr>
          ${contratos.slice(1).map(x => `<tr>
            <td>${esc(x.proveedor)}</td>
            <td>${esc(x.n_licitacion)}</td>
            <td class="num">${money(x.monto_tope_anual)}</td>
            <td>${x.fecha_inicio || "?"} → ${x.fecha_termino || "?"}</td>
            <td><span class="pill ${x.estado === "vigente" ? "aprobada" : "anulada"}">${x.estado}</span></td>
          </tr>`).join("")}
        </table>
      </div>` : ""}
  `;

  document.getElementById("cv-guardar").addEventListener("click", async () => {
    const errorEl = document.getElementById("cv-error");
    const okEl = document.getElementById("cv-ok");
    errorEl.classList.add("oculto"); okEl.classList.add("oculto");

    const payload = {
      proveedor: document.getElementById("cv-prov").value.trim(),
      n_licitacion: document.getElementById("cv-lic").value.trim() || null,
      monto_tope_anual: parseFloat(document.getElementById("cv-tope").value) || 0,
      fecha_inicio: document.getElementById("cv-ini").value || null,
      fecha_termino: document.getElementById("cv-fin").value || null,
      estado: document.getElementById("cv-estado").value,
    };
    if (!payload.proveedor || !payload.monto_tope_anual) {
      errorEl.textContent = "El proveedor y el monto tope anual son obligatorios.";
      errorEl.classList.remove("oculto");
      return;
    }

    const res = nuevo
      ? await sb.from("contrato").insert(payload).select().single()
      : await sb.from("contrato").update(payload).eq("id", c.id);
    if (res.error) { errorEl.textContent = "No se pudo guardar: " + res.error.message; errorEl.classList.remove("oculto"); return; }

    // Al crear un contrato nuevo, siembra su movimiento de "apertura" con el
    // tope como saldo de partida — sin esto, la primera factura no se puede
    // descontar (el trigger no tiene de dónde partir el cálculo del saldo).
    if (nuevo && res.data) {
      await sb.from("movimiento_saldo").insert({
        contrato_id: res.data.id, tipo: "apertura",
        monto: payload.monto_tope_anual, saldo_resultante: payload.monto_tope_anual,
      });
    }

    okEl.textContent = "Guardado. El Resumen se actualiza al recargar.";
    okEl.classList.remove("oculto");
    if (nuevo) setTimeout(vistaConvenio, 800);
  });

  vista().querySelectorAll(".firma-card").forEach(card => {
    const archivo = card.dataset.firma;
    const errorEl = card.querySelector(".firma-error");
    const okEl = card.querySelector(".firma-ok");
    const btnSubir = card.querySelector(".firma-subir");

    btnSubir.addEventListener("click", async () => {
      errorEl.classList.add("oculto"); okEl.classList.add("oculto");
      const file = card.querySelector(".firma-archivo").files[0];
      if (!file) { errorEl.textContent = "Elige una imagen primero."; errorEl.classList.remove("oculto"); return; }
      if (file.size > 8 * 1024 * 1024) { errorEl.textContent = "La imagen supera los 8 MB."; errorEl.classList.remove("oculto"); return; }
      btnSubir.disabled = true;
      try {
        const blob = await comprimirFirma(file);
        const { error } = await sb.storage.from("firmas").upload(archivo, blob, { upsert: true, contentType: "image/png" });
        if (error) throw error;
        okEl.textContent = "Firma guardada."; okEl.classList.remove("oculto");
        setTimeout(vistaConvenio, 700);
      } catch (e) {
        errorEl.textContent = "No se pudo guardar: " + e.message; errorEl.classList.remove("oculto");
      }
      btnSubir.disabled = false;
    });

    const btnQuitar = card.querySelector(".firma-quitar");
    if (btnQuitar) btnQuitar.addEventListener("click", async () => {
      if (!await confirmar({ titulo: "¿Eliminar esta firma?", texto: "La hoja de solicitud dejará de estamparla.", boton: "Eliminar" })) return;
      const { error } = await sb.storage.from("firmas").remove([archivo]);
      if (error) { alert("No se pudo eliminar: " + error.message); return; }
      vistaConvenio();
    });
  });
}

// ---------------------------------------------------------------------
// Firmas que se estampan en la hoja de solicitud (PNG en el bucket privado
// "firmas"; solo el Administrador las carga, desde "Convenio / ferretería").
// ---------------------------------------------------------------------
const FIRMAS = [
  { archivo: "director.png", titulo: "Firma y timbre del Director", subtitulo: "Aparecerá en la parte inferior de cada solicitud impresa, una vez aprobada" },
  { archivo: "ito.png", titulo: "Firma del Encargado de Operaciones (ITO)", subtitulo: "Aparecerá en la parte inferior de cada solicitud impresa" },
];

function tarjetaFirma(f, url) {
  return `<div class="card firma-card" data-firma="${f.archivo}">
    <div class="firma-head"><h4>✍ ${esc(f.titulo)}</h4><p>${esc(f.subtitulo)}</p></div>
    <div class="firma-cuerpo">
      <div>
        <label style="margin-top:0">Vista previa actual</label>
        <div class="firma-preview">${url ? `<img src="${esc(url)}" alt="Firma cargada">` : `<span class="hint">Aún no hay firma cargada.</span>`}</div>
      </div>
      <div>
        <label style="margin-top:0">Cargar nueva firma</label>
        <p class="hint" style="margin-top:0">PNG o JPG con fondo blanco o transparente. Se comprimirá automáticamente.</p>
        <input type="file" class="firma-archivo" accept="image/png,image/jpeg">
        <button class="primario firma-subir">Guardar firma</button>
        ${url ? `<button class="secundario firma-quitar" style="margin-top:.5rem">Eliminar firma</button>` : ""}
        <p class="error oculto firma-error"></p>
        <p class="ok-msg oculto firma-ok"></p>
      </div>
    </div>
  </div>`;
}

// Reduce la imagen (máx. 900 px de ancho) y la guarda como PNG, conservando la transparencia.
function comprimirFirma(file, anchoMax = 900) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, anchoMax / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * k);
      c.height = Math.round(img.naturalHeight * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => b ? resolve(b) : reject(new Error("No se pudo procesar la imagen.")), "image/png");
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("El archivo no es una imagen válida.")); };
    img.src = url;
  });
}

// ---------------------------------------------------------------------
// COTIZACIÓN OBRAS — solo Dirección de Obras (las demás direcciones siguen igual).
//   1. Obras (o el ITO) prepara la solicitud de cotización: productos con cantidad y unidad.
//   2. El ITO la emite: PDF con su firma y fecha de envío.
//   3. Se registran a mano las 3 cotizaciones (proveedor del contrato + 2 externas)
//      con el precio de cada producto.
//   4. Con las 3 se crea la solicitud especial, que sigue el recorrido de una
//      solicitud de Obras (V°B° del ITO, Director, hoja, guías y factura).
// ---------------------------------------------------------------------
const LUGAR_ENTREGA = "Avenida Estación 344, Doñihue";
const PROVEEDOR_CONTRATO = "Importadora Hevia SpA";
const SLOTS_COTIZACION = [
  { slot: 1, titulo: "Proveedor del contrato" },
  { slot: 2, titulo: "Cotización externa 1" },
  { slot: 3, titulo: "Cotización externa 2" },
];
const ESTADO_PROCESO = {
  borrador: { texto: "por emitir", clase: "pendiente" },
  emitida: { texto: "cotizando", clase: "emitida" },
  solicitud_creada: { texto: "solicitud creada", clase: "aprobada" },
};
const pillProceso = (e) => { const x = ESTADO_PROCESO[e] || { texto: e, clase: "" }; return `<span class="pill ${x.clase}">${x.texto}</span>`; };
const fechaCL = (iso) => { const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : (iso || ""); };

// Total de una cotización; null si le falta el precio de algún producto.
function totalOferta(items, oferta) {
  if (!oferta) return null;
  let neto = 0;
  for (const it of items) {
    const p = Number((oferta.precios || {})[it.id]);
    if (!(p > 0)) return null;
    neto += p * Number(it.cantidad || 0);
  }
  const iva = Math.round(neto * 0.19);
  return { neto, iva, bruto: neto + iva };
}

// Cuadro comparativo producto por producto de las cotizaciones registradas.
function comparativoHTML(proceso, ofertas) {
  const items = proceso.items || [];
  const por = {};
  (ofertas || []).forEach(o => { por[o.slot] = o; });
  const cols = SLOTS_COTIZACION.map(s => ({ ...s, o: por[s.slot], t: totalOferta(items, por[s.slot]) }));
  const completas = cols.filter(c => c.t);
  const minNeto = completas.length > 1 ? Math.min(...completas.map(c => c.t.neto)) : null;
  const marca = (c) => (c.t && minNeto != null && c.t.neto === minNeto) ? ' style="background:var(--ok-tint)"' : "";

  let concl = "";
  const hevia = cols[0], ext = cols.slice(1).filter(c => c.t);
  if (hevia.t && ext.length) {
    const mejor = Math.min(...ext.map(c => c.t.neto));
    const dif = (hevia.t.neto - mejor) / mejor * 100;
    const txt = Math.abs(dif) < 0.05 ? "igual que" : (dif < 0 ? `${Math.abs(dif).toFixed(1)}% más barato que` : `${dif.toFixed(1)}% más caro que`);
    concl += `<p><strong>${esc(hevia.o.proveedor)}</strong> (contrato) está ${txt} la mejor cotización externa.</p>`;
  }
  if (completas.length === 3) {
    const g = completas.reduce((a, b) => (b.t.neto < a.t.neto ? b : a));
    concl += `<p>Cotización más conveniente: <strong>${esc(g.o.proveedor)}</strong> (${money(g.t.neto)} neto).</p>`;
  }
  return `<div style="overflow-x:auto"><table>
    <tr><th>Producto</th><th class="num">Cant.</th><th>Unidad</th>${cols.map(c => `<th class="num">${c.titulo}<div class="hint">${c.o ? esc(c.o.proveedor) : "sin registrar"}</div></th>`).join("")}</tr>
    ${items.map(it => `<tr><td>${esc(it.producto)}</td><td class="num">${esc(it.cantidad)}</td><td>${esc(it.unidad)}</td>${cols.map(c => { const p = c.o ? Number((c.o.precios || {})[it.id]) : 0; return `<td class="num">${p > 0 ? money(p) : "—"}</td>`; }).join("")}</tr>`).join("")}
    <tr><td colspan="3" style="text-align:right">Total neto</td>${cols.map(c => `<td class="num"${marca(c)}>${c.t ? money(c.t.neto) : (c.o ? "incompleta" : "—")}</td>`).join("")}</tr>
    <tr><td colspan="3" style="text-align:right">IVA 19%</td>${cols.map(c => `<td class="num">${c.t ? money(c.t.iva) : "—"}</td>`).join("")}</tr>
    <tr><td colspan="3" style="text-align:right;font-weight:700">Total con IVA</td>${cols.map(c => `<td class="num" style="font-weight:700">${c.t ? money(c.t.bruto) : "—"}</td>`).join("")}</tr>
  </table></div>${concl}`;
}

// ---------- Listado ----------
async function vistaProcesosCotizacion() {
  vista().innerHTML = "<div class='card'>Cargando…</div>";
  const { data, error } = await sb.from("proceso_cotizacion")
    .select("*, unidad(nombre), proceso_cotizacion_oferta(slot)")
    .order("creado_en", { ascending: false });
  if (error) {
    vista().innerHTML = `<div class="card error">${esc(error.message)}<br><small>Falta correr <code>Documentacion/cotizaciones-obras.sql</code> en Supabase.</small></div>`;
    return;
  }
  vista().innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap">
        <h3 style="margin:0">Cotización Obras</h3>
        <button class="primario" style="margin-top:0" onclick="vistaNuevoProceso()">+ Nueva solicitud de cotización</button>
      </div>
      <p class="hint">Para productos que no están en el catálogo del contrato: se piden 3 cotizaciones (proveedor del contrato y 2 externas) y con ellas se crea la solicitud especial.</p>
      <table>
        <tr><th>N°</th><th>Envío</th><th>Unidad</th><th class="num">Productos</th><th class="num">Cotizaciones</th><th>Estado</th><th></th></tr>
        ${(data || []).map(p => `<tr>
          <td class="num">${esc(p.correlativo) || "—"}</td>
          <td>${p.fecha_envio ? fechaCL(p.fecha_envio) : "—"}</td>
          <td>${esc(p.unidad?.nombre)}${p.unidad_interna ? `<div class="hint">${esc(p.unidad_interna)}</div>` : ""}<div class="hint">${esc(p.solicitante)}</div></td>
          <td class="num">${(p.items || []).length}</td>
          <td class="num">${(p.proceso_cotizacion_oferta || []).length} de 3</td>
          <td>${pillProceso(p.estado)}</td>
          <td><button class="secundario" onclick="vistaProceso('${p.id}')">Abrir</button></td>
        </tr>`).join("") || `<tr><td colspan="7" class="hint">Aún no hay solicitudes de cotización.</td></tr>`}
      </table>
    </div>`;
}

// ---------- Crear / editar el borrador ----------
// El usuario de Obras sube el Formulario Único completado (el sistema lee los
// productos, cantidades y unidades) y registra las 2 cotizaciones externas con su PDF
// y el precio de cada producto. Con eso le llega al ITO, que emite el PDF para Hevia.
let procesoItems = [];
let procesoIdEnEdicion = null;
const ofertaVacia = () => ({ proveedor: "", numero: "", fecha: "", archivo_url: null, file: null, precios: [] });
let procesoExt = { 2: ofertaVacia(), 3: ofertaVacia() };

function quitarItemProceso(i) {
  procesoItems.splice(i, 1);
  [2, 3].forEach(s => procesoExt[s].precios.splice(i, 1));
  pintarItemsProceso();
}

function pintarItemsProceso() {
  const cont = document.getElementById("np-items");
  if (!cont) return;
  cont.innerHTML = !procesoItems.length
    ? "<p style='color:var(--ink-soft);font-size:0.85rem'>Aún no agregas productos.</p>"
    : `<table>
    <tr><th>Producto</th><th class="num">Cantidad</th><th>Unidad</th><th></th></tr>
    ${procesoItems.map((it, i) => `<tr><td>${esc(it.producto)}</td><td class="num">${esc(it.cantidad)}</td><td>${esc(it.unidad)}</td>
      <td><button class="secundario" onclick="quitarItemProceso(${i})">Quitar</button></td></tr>`).join("")}
  </table>`;
  pintarOfertasExt();
}

// Tarjetas de las 2 cotizaciones externas (proveedor, datos, precio por producto y PDF).
function pintarOfertasExt() {
  const cont = document.getElementById("np-ofertas");
  if (!cont) return;
  cont.innerHTML = [2, 3].map(slot => {
    const o = procesoExt[slot];
    return `<div class="card" style="margin-top:.8rem" data-slot="${slot}">
      <div class="exp-seccion"><h4>${SLOTS_COTIZACION[slot - 1].titulo}</h4></div>
      <div class="linea-detalle" style="grid-template-columns:2fr 1fr 1fr">
        <div><label>Proveedor</label><input class="ne-prov" value="${esc(o.proveedor)}" placeholder="Ferretería o empresa" autocomplete="off"></div>
        <div><label>N° de cotización</label><input class="ne-num" value="${esc(o.numero)}"></div>
        <div><label>Fecha</label><input class="ne-fecha" type="date" value="${esc(o.fecha)}"></div>
      </div>
      ${procesoItems.length ? `<table>
        <tr><th>Producto</th><th class="num">Cant.</th><th>Unidad</th><th class="num">Precio unitario neto</th></tr>
        ${procesoItems.map((it, i) => `<tr><td>${esc(it.producto)}</td><td class="num">${esc(it.cantidad)}</td><td>${esc(it.unidad)}</td>
          <td class="num"><input class="ne-precio" data-i="${i}" type="number" min="0" step="1" value="${esc(o.precios[i] ?? "")}" style="width:7rem;text-align:right"></td></tr>`).join("")}
      </table>` : `<p class="hint">Agrega los productos para anotar los precios.</p>`}
      <label>PDF de la cotización ${o.archivo_url ? `· ${enlaceArchivo(o.archivo_url, `ver adjunto actual`)}` : ""}</label>
      <input class="ne-file" type="file" accept=".pdf,.doc,.docx,image/*">
      <p class="hint ne-file-msg">${o.file ? "Archivo elegido: " + esc(o.file.name) : (o.archivo_url ? "Ya hay un archivo adjunto; elige otro solo si quieres reemplazarlo." : "Adjunta la cotización recibida del proveedor.")}</p>
      ${procesoItems.length ? `<label>…o carga los precios desde el formulario que completó el proveedor</label>
      <input class="ne-form" type="file" accept="application/pdf">
      <p class="hint ne-form-msg">${esc(o.msgForm || "Lee el valor neto de cada producto del formulario de cotización que te devolvió el proveedor.")}</p>` : ""}
    </div>`;
  }).join("");
  cont.querySelectorAll("[data-slot]").forEach(card => {
    const o = procesoExt[Number(card.dataset.slot)];
    card.querySelector(".ne-prov").addEventListener("input", e => { o.proveedor = e.target.value; });
    card.querySelector(".ne-num").addEventListener("input", e => { o.numero = e.target.value; });
    card.querySelector(".ne-fecha").addEventListener("input", e => { o.fecha = e.target.value; });
    card.querySelectorAll(".ne-precio").forEach(inp => inp.addEventListener("input", e => { o.precios[Number(e.target.dataset.i)] = e.target.value; }));
    card.querySelector(".ne-file").addEventListener("change", e => {
      o.file = e.target.files[0] || null;
      card.querySelector(".ne-file-msg").textContent = o.file ? "Archivo elegido: " + o.file.name : "Adjunta la cotización recibida del proveedor.";
    });
    const inpForm = card.querySelector(".ne-form");
    if (inpForm) inpForm.addEventListener("change", async e => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        const r = await preciosDesdeFormulario(f, procesoItems);
        if (r.leidos) o.precios = r.precios;
        o.msgForm = mensajePreciosFormulario(r);
      } catch (err) { o.msgForm = "No se pudo leer el PDF: " + err.message; }
      pintarOfertasExt();
    });
  });
}

// Lee el Formulario Único (PDF editable) ya completado: datos y productos (producto, cantidad, unidad).
async function extraerFormularioPDF(file) {
  const doc = await PDFLib.PDFDocument.load(await file.arrayBuffer());
  const form = doc.getForm();
  const T = (n) => { try { return (form.getTextField(n).getText() || "").trim(); } catch { return ""; } };
  const D = (n) => { try { return (form.getDropdown(n).getSelected()[0] || "").trim(); } catch { return T(n); } };
  const num = (v) => parseFloat(String(v).replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".")) || 0;
  const items = [];
  // Formulario de cotización (producto_N, cantidad_N, unidad_N)…
  for (let r = 1; r <= 20; r++) {
    const producto = T(`producto_${r}`);
    const cantidad = num(T(`cantidad_${r}`));
    if (producto && cantidad > 0) items.push({ producto, cantidad, unidad: T(`unidad_${r}`), precio: num(T(`valor_neto_${r}`)) });
  }
  // …o, si no es ese, el Formulario Único anterior (mat_rN_cK).
  if (!items.length) {
    for (let r = 0; r < 12; r++) {
      const producto = T(`mat_r${r}_c0`);
      const cantidad = num(T(`mat_r${r}_c1`));
      if (producto && cantidad > 0) items.push({ producto, cantidad, unidad: T(`mat_r${r}_c2`) });
    }
  }
  return {
    unidad: D("unidad_interna") || T("unidad_solicitante"),
    responsable: T("responsable") || T("responsable_requerimiento"),
    ubicacion: T("ubicacion") || T("ubicacion_uso"),
    motivo: T("motivo") || T("fundamento") || T("desc_requerimiento"),
    items,
  };
}

// Lee los valores netos de un formulario que completó un proveedor y los alinea con los
// productos de la solicitud (primero por nombre; si no calza, por posición).
async function preciosDesdeFormulario(file, items) {
  if (!window.PDFLib) throw new Error("no se cargó el lector de PDF (revisa la conexión)");
  const d = await extraerFormularioPDF(file);
  const norm = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const precios = items.map(() => "");
  let leidos = 0, sinCalzar = 0;
  d.items.forEach((it, i) => {
    if (!(it.precio > 0)) return;
    let idx = items.findIndex(x => norm(x.producto) === norm(it.producto));
    if (idx < 0 && items[i]) { idx = i; sinCalzar++; }
    if (idx >= 0) { precios[idx] = it.precio; leidos++; }
  });
  return { precios, leidos, sinCalzar, sinPrecio: items.length - leidos };
}

function mensajePreciosFormulario(r) {
  if (!r.leidos) return "No se encontraron valores netos en ese PDF. ¿El proveedor lo completó y lo guardó con el botón de descarga (no con «Imprimir a PDF»)?";
  return `Se leyeron ${r.leidos} precio(s).` +
    (r.sinCalzar ? ` ${r.sinCalzar} se asignaron por posición porque el nombre del producto no coincide: revísalos.` : "") +
    (r.sinPrecio ? ` Faltan ${r.sinPrecio} producto(s) sin valor neto.` : "");
}

async function leerFormularioProceso(file) {
  const msg = document.getElementById("np-pdf-msg");
  if (!window.PDFLib) { msg.textContent = "No se pudo cargar el lector de PDF (revisa la conexión)."; return; }
  msg.textContent = "Leyendo el PDF…";
  try {
    const d = await extraerFormularioPDF(file);
    const set = (id, v) => { const el = document.getElementById(id); if (el && v) el.value = v; };
    set("np-resp", d.responsable); set("np-ubic", d.ubicacion); set("np-motivo", d.motivo);

    const norm = (t) => (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const uTxt = norm(d.unidad);
    if (uTxt) {
      const calza = (sel, texto) => [...sel.options].find(o => o.value && (norm(texto(o)).includes(uTxt) || uTxt.includes(norm(texto(o)))));
      const interna = calza(document.getElementById("np-interna"), o => o.value);
      if (interna) document.getElementById("np-interna").value = interna.value;
      const dir = document.getElementById("np-unidad");
      if (!dir.disabled) { const o2 = calza(dir, o => o.textContent); if (o2) dir.value = o2.value; }
    }
    if (d.items.length) {
      procesoItems = d.items.map(it => ({ producto: it.producto, cantidad: it.cantidad, unidad: it.unidad || "un" }));
      [2, 3].forEach(s => { procesoExt[s].precios = []; });
      pintarItemsProceso();
    }
    const sinUnidad = d.items.filter(it => !it.unidad).length;
    msg.textContent = d.items.length
      ? `Se leyeron ${d.items.length} producto(s) del formulario.${sinUnidad ? ` ${sinUnidad} venía(n) sin unidad de medida: quedó "un", corrígela si es otra.` : ""} Revisa los datos y anota los precios de las cotizaciones.`
      : "No se encontraron productos en el formulario. Agrégalos a mano.";
  } catch (e) {
    msg.textContent = "No se pudo leer el PDF: " + e.message + ". Llena el formulario a mano.";
  }
}

async function vistaNuevoProceso(id) {
  procesoItems = [];
  procesoIdEnEdicion = id || null;
  procesoExt = { 2: ofertaVacia(), 3: ofertaVacia() };
  let p = null;
  if (id) {
    const [{ data, error }, { data: ofs }] = await Promise.all([
      sb.from("proceso_cotizacion").select("*").eq("id", id).single(),
      sb.from("proceso_cotizacion_oferta").select("*").eq("proceso_id", id),
    ]);
    if (error || !data) { vista().innerHTML = `<div class="card error">No se pudo abrir la cotización${error ? ": " + esc(error.message) : ""}</div>`; return; }
    if (data.estado !== "borrador") { vistaProceso(id); return; }
    p = data;
    procesoItems = (p.items || []).map(it => ({ producto: it.producto, cantidad: it.cantidad, unidad: it.unidad }));
    (ofs || []).filter(o => o.slot === 2 || o.slot === 3).forEach(o => {
      procesoExt[o.slot] = {
        proveedor: o.proveedor || "", numero: o.numero || "", fecha: o.fecha || "", archivo_url: o.archivo_url || null, file: null,
        precios: procesoItems.map((_, i) => (o.precios || {})["i" + (i + 1)] ?? ""),
      };
    });
  }
  const { data: todas } = await sb.from("unidad").select("id, nombre").order("nombre");
  const soloObras = rolEfectivo() === "solicitante_obras";
  const unidades = soloObras ? (todas || []).filter(u => u.id === perfilActual.unidad_id) : (todas || []);
  const unidadSel = p ? p.unidad_id : perfilActual.unidad_id;

  vista().innerHTML = `
    <button class="exp-volver" onclick="vistaProcesosCotizacion()">← Volver a Cotización Obras</button>
    <div class="card">
      <h3 style="margin-top:0">${p ? "Editar" : "Nueva"} solicitud de cotización${p ? " " + esc(p.correlativo) : ""}</h3>
      <p class="hint">Para productos que no están en el catálogo. Sube el formulario con los productos, adjunta las cotizaciones de los 2 proveedores externos y envíalo al ITO: él pide la cotización a Hevia (proveedor del contrato) con el PDF firmado.</p>
      ${soloObras && !unidades.length ? `<p class="error">Tu perfil no tiene una dirección asignada. Pide al administrador que te la asigne en Usuarios.</p>` : ""}

      <div style="border:1px dashed var(--border);border-radius:12px;padding:12px 14px;margin:12px 0;background:var(--surface-2)">
        <label style="margin-top:0">¿Ya completaste el formulario de cotización en PDF? Súbelo y se leen los productos</label>
        <input id="np-pdf" type="file" accept="application/pdf">
        <p class="hint" id="np-pdf-msg">Toma de ahí los productos, cantidades y unidades de medida (también la unidad, el responsable, la ubicación y el motivo). Después puedes corregir lo que haga falta.
          ¿Aún no lo tienes? <a href="Documentacion/Formulario-Cotizacion-Obras.pdf" target="_blank" rel="noopener">Descargar el formulario en blanco</a>.</p>
      </div>

      <label>Dirección responsable</label>
      <select id="np-unidad" ${soloObras ? "disabled" : ""}>
        ${soloObras ? "" : `<option value="">— selecciona —</option>`}
        ${unidades.map(u => `<option value="${u.id}" ${u.id === unidadSel ? "selected" : ""}>${esc(u.nombre)}</option>`).join("")}
      </select>
      <label>Unidad</label>
      <select id="np-interna">
        <option value="">— selecciona —</option>
        ${["Operaciones", "Aseo y Ornato", "Edificios"].map(n => `<option value="${n}" ${p && p.unidad_interna === n ? "selected" : ""}>${n}</option>`).join("")}
      </select>
      <label>Responsable del requerimiento</label>
      <input id="np-resp" value="${esc(p ? p.solicitante : "")}" placeholder="Nombre y cargo">
      <label>Ubicación de uso de los materiales</label>
      <textarea id="np-ubic" rows="2" placeholder="Calle, número, sector">${esc(p ? p.ubicacion : "")}</textarea>
      <label>Motivo / para qué se necesitan</label>
      <textarea id="np-motivo" rows="2" placeholder="Motivo breve">${esc(p ? p.motivo : "")}</textarea>
      <label>Lugar de entrega</label>
      <input value="${esc(LUGAR_ENTREGA)}" disabled>

      <h4>Productos a cotizar</h4>
      <div id="np-items"></div>
      <div class="linea-detalle" style="grid-template-columns:3fr 1fr 1fr auto">
        <div><label>Producto (con sus especificaciones)</label><input id="np-prod" placeholder="Ej: Manguera reforzada 3/4&quot; rollo 50 m" autocomplete="off"></div>
        <div><label>Cantidad</label><input id="np-cant" type="number" min="0" step="0.01"></div>
        <div><label>Unidad de medida</label><input id="np-um" placeholder="un, m, kg, rollo…" autocomplete="off"></div>
        <div><button class="secundario" id="np-agregar" style="margin-top:0">+ Agregar</button></div>
      </div>
      <p class="error oculto" id="np-msg"></p>

      <h4>Cotizaciones de los 2 proveedores externos</h4>
      <p class="hint" style="margin-top:0">Ferretería local o cadena. Anota el precio unitario neto de cada producto y adjunta su PDF. La cotización del proveedor del contrato la sube el ITO cuando Hevia responda.</p>
      <div id="np-ofertas"></div>

      <button class="primario" id="np-guardar">${p ? "Guardar cambios" : "Guardar y enviar al ITO"}</button>
      <p class="error oculto" id="np-error"></p>
    </div>`;
  pintarItemsProceso();

  document.getElementById("np-pdf").addEventListener("change", (e) => { if (e.target.files[0]) leerFormularioProceso(e.target.files[0]); });
  document.getElementById("np-agregar").addEventListener("click", () => {
    const producto = document.getElementById("np-prod").value.trim();
    const cantidad = parseFloat(document.getElementById("np-cant").value);
    const unidad = document.getElementById("np-um").value.trim();
    const msg = document.getElementById("np-msg");
    msg.classList.add("oculto");
    if (!producto || !(cantidad > 0) || !unidad) { msg.textContent = "Completa producto, cantidad y unidad de medida."; msg.classList.remove("oculto"); return; }
    procesoItems.push({ producto, cantidad, unidad });
    ["np-prod", "np-cant", "np-um"].forEach(i => document.getElementById(i).value = "");
    pintarItemsProceso();
  });
  document.getElementById("np-guardar").addEventListener("click", guardarProceso);
}

async function guardarProceso() {
  if (!_lock()) return;
  try {
    const errorEl = document.getElementById("np-error");
    const mostrar = (m) => { errorEl.textContent = m; errorEl.classList.remove("oculto"); };
    errorEl.classList.add("oculto");
    const val = (i) => document.getElementById(i).value.trim();
    const unidad_id = document.getElementById("np-unidad").value || perfilActual.unidad_id || null;
    const unidad_interna = document.getElementById("np-interna").value;
    if (!unidad_id) { mostrar("Selecciona la dirección responsable."); return; }
    if (!unidad_interna) { mostrar("Selecciona la unidad (Operaciones, Aseo y Ornato o Edificios)."); return; }
    if (!val("np-resp")) { mostrar("Indica el responsable del requerimiento."); return; }
    if (!val("np-ubic")) { mostrar("Indica la ubicación de uso de los materiales."); return; }
    if (!procesoItems.length) { mostrar("Agrega al menos un producto."); return; }
    for (const slot of [2, 3]) {
      const o = procesoExt[slot];
      const hayAlgo = o.proveedor.trim() || o.numero.trim() || o.fecha || o.file || o.archivo_url || o.precios.some(v => parseFloat(v) > 0);
      if (hayAlgo && !o.proveedor.trim()) { mostrar(`Indica el proveedor de la ${SLOTS_COTIZACION[slot - 1].titulo.toLowerCase()}.`); return; }
    }

    const datos = {
      unidad_id, unidad_interna, solicitante: val("np-resp"), ubicacion: val("np-ubic"), motivo: val("np-motivo") || null,
      items: procesoItems.map((it, i) => ({ id: "i" + (i + 1), producto: it.producto, cantidad: it.cantidad, unidad: it.unidad })),
    };
    const res = procesoIdEnEdicion
      ? await sb.from("proceso_cotizacion").update(datos).eq("id", procesoIdEnEdicion).select("id").single()
      : await sb.from("proceso_cotizacion").insert(datos).select("id").single();
    if (res.error) { mostrar("No se pudo guardar: " + res.error.message); return; }
    procesoIdEnEdicion = res.data.id;

    for (const slot of [2, 3]) {
      const o = procesoExt[slot];
      const hayAlgo = o.proveedor.trim() || o.numero.trim() || o.fecha || o.file || o.archivo_url || o.precios.some(v => parseFloat(v) > 0);
      if (!hayAlgo) continue;
      let archivo_url = o.archivo_url;
      if (o.file) {
        const r = await subirArchivo("memos", o.file);
        if (r.error) { mostrar(r.error + " La solicitud ya quedó guardada: vuelve a pulsar Guardar."); return; }
        archivo_url = r.url; o.archivo_url = r.url; o.file = null;
      }
      const precios = {};
      procesoItems.forEach((_, i) => { const v = parseFloat(o.precios[i]); if (v > 0) precios["i" + (i + 1)] = v; });
      const { error } = await sb.from("proceso_cotizacion_oferta").upsert({
        proceso_id: procesoIdEnEdicion, slot, proveedor: o.proveedor.trim(), numero: o.numero.trim() || null,
        fecha: o.fecha || null, precios, archivo_url,
      }, { onConflict: "proceso_id,slot" });
      if (error) { mostrar("La solicitud quedó guardada, pero falló una cotización: " + error.message); return; }
    }
    actualizarNotificaciones();
    vistaProceso(procesoIdEnEdicion);
  } finally { _unlock(); }
}

// ---------- Detalle: emitir, registrar las 3 cotizaciones, comparar, crear la solicitud ----------
async function vistaProceso(id) {
  vista().innerHTML = "<div class='card'>Cargando…</div>";
  const [{ data: p, error }, { data: ofertas }, { data: sols }, { data: conv }] = await Promise.all([
    sb.from("proceso_cotizacion").select("*, unidad(nombre)").eq("id", id).single(),
    sb.from("proceso_cotizacion_oferta").select("*").eq("proceso_id", id),
    sb.from("solicitud").select("id, correlativo, n_solicitud, estado").eq("proceso_cotizacion_id", id),
    sb.from("contrato").select("proveedor").eq("estado", "vigente").order("creado_en", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error || !p) { vista().innerHTML = `<div class="card error">No se pudo abrir la cotización${error ? ": " + esc(error.message) : ""}</div>`; return; }
  window._procActual = { p, ofertas: ofertas || [] };

  const esITO = puedeOperar();
  const proveedorContrato = (conv && conv.proveedor) || PROVEEDOR_CONTRATO;
  const items = p.items || [];
  const por = {};
  (ofertas || []).forEach(o => { por[o.slot] = o; });
  const completas = SLOTS_COTIZACION.filter(s => totalOferta(items, por[s.slot])).length;
  const editable = p.estado === "emitida";
  const externasCompletas = [2, 3].every(s => totalOferta(items, por[s]));

  const tarjetaOferta = (s) => {
    const o = por[s.slot];
    const t = totalOferta(items, o);
    return `<div class="card" id="oferta-${s.slot}" data-archivo="${esc(o ? o.archivo_url || "" : "")}" style="margin-top:.8rem">
      <div class="exp-seccion"><h4>${s.titulo}</h4>${t ? `<span class="pill aprobada">completa · ${money(t.neto)} neto</span>` : (o ? `<span class="pill pendiente">incompleta</span>` : `<span class="hint">sin registrar</span>`)}</div>
      <div class="linea-detalle" style="grid-template-columns:2fr 1fr 1fr">
        <div><label>Proveedor</label><input class="of-prov" value="${esc(o ? o.proveedor : (s.slot === 1 ? proveedorContrato : ""))}" ${editable ? "" : "disabled"} placeholder="Nombre del proveedor"></div>
        <div><label>N° de cotización</label><input class="of-num" value="${esc(o ? o.numero : "")}" ${editable ? "" : "disabled"}></div>
        <div><label>Fecha</label><input class="of-fecha" type="date" value="${o && o.fecha ? o.fecha : ""}" ${editable ? "" : "disabled"}></div>
      </div>
      <table>
        <tr><th>Producto</th><th class="num">Cant.</th><th>Unidad</th><th class="num">Precio unitario neto</th></tr>
        ${items.map(it => `<tr><td>${esc(it.producto)}</td><td class="num">${esc(it.cantidad)}</td><td>${esc(it.unidad)}</td>
          <td class="num"><input class="of-precio" data-item="${it.id}" type="number" min="0" step="1" value="${o && (o.precios || {})[it.id] ? o.precios[it.id] : ""}" ${editable ? "" : "disabled"} style="width:7rem;text-align:right"></td></tr>`).join("")}
      </table>
      <label>PDF de la cotización ${o && o.archivo_url ? `· ${enlaceArchivo(o.archivo_url, `ver adjunto actual`)}` : `<span class="hint">(recomendado: queda como respaldo)</span>`}</label>
      ${editable ? `<input class="of-file" type="file" accept=".pdf,.doc,.docx,image/*">
        <label>…o carga los precios desde el formulario que completó el proveedor</label>
        <input class="of-form" type="file" accept="application/pdf" onchange="cargarPreciosEnTarjeta(${s.slot}, this)">
        <p class="hint of-form-msg">Lee el valor neto de cada producto del formulario de cotización que te devolvió el proveedor. Después pulsa «Guardar esta cotización».</p>
        <button class="primario" onclick="guardarOferta('${p.id}', ${s.slot})">Guardar esta cotización</button>
        <p class="error oculto of-error"></p>` : ""}
    </div>`;
  };

  vista().innerHTML = `
    <button class="exp-volver" onclick="vistaProcesosCotizacion()">← Volver a Cotización Obras</button>
    <div class="card">
      <div class="exp-cabecera">
        <div><h3 style="margin:0">Solicitud de cotización ${esc(p.correlativo) || ""}</h3>
          <div class="hint">${esc(p.unidad?.nombre)}${p.unidad_interna ? " · " + esc(p.unidad_interna) : ""} · ${esc(p.solicitante)}</div></div>
        <div>${pillProceso(p.estado)}</div>
      </div>
      <div class="exp-datos">
        <div><div class="d-k">Fecha de envío</div>${p.fecha_envio ? fechaCL(p.fecha_envio) : "— (la pone el sistema al emitir)"}</div>
        <div><div class="d-k">Lugar de entrega</div>${esc(p.lugar_entrega)}</div>
        <div><div class="d-k">Ubicación de uso</div>${esc(p.ubicacion) || "—"}</div>
        <div><div class="d-k">Motivo</div>${esc(p.motivo) || "—"}</div>
      </div>
      <table style="margin-top:1rem">
        <tr><th>Producto</th><th class="num">Cantidad</th><th>Unidad</th></tr>
        ${items.map(it => `<tr><td>${esc(it.producto)}</td><td class="num">${esc(it.cantidad)}</td><td>${esc(it.unidad)}</td></tr>`).join("")}
      </table>

      ${p.estado === "borrador" ? `
        <div class="acciones">
          <button class="secundario" onclick="vistaNuevoProceso('${p.id}')">Editar productos y cotizaciones</button>
        </div>
        ${esITO ? `
          <div style="border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem">
            <h4 style="margin-top:0">Emitir (PDF con tu firma)</h4>
            ${externasCompletas ? `
              <p class="hint">Genera el PDF de cotización con los productos, cantidades y unidades, firmado por ti, para pedir la cotización al proveedor del contrato. Al emitir queda registrada la <strong>fecha de envío</strong> y los productos ya no se pueden cambiar.</p>
              <label>Proveedor</label>
              <input id="pc-prov" value="${esc(proveedorContrato)}" autocomplete="off">
              <button class="primario" onclick="emitirProceso('${p.id}')">Emitir y descargar PDF</button>`
              : `<p class="hint" style="color:var(--warn)">Para emitir faltan las 2 cotizaciones externas completas (proveedor y precio de todos los productos). Las sube quien hizo la solicitud; puedes corregirlas con "Editar productos y cotizaciones".</p>`}
          </div>` : `<p class="hint">${externasCompletas ? "Enviada al ITO. Él pedirá la cotización a Hevia con el PDF firmado y subirá su respuesta." : "Faltan las 2 cotizaciones externas completas para que el ITO pueda emitirla: edítala y anótalas."}</p>`}` : `
        <div style="border-top:1px solid var(--border);margin-top:1rem;padding-top:1rem">
          <h4 style="margin-top:0">PDF para enviar a un proveedor</h4>
          <p class="hint">El mismo formato para los 3 proveedores: cambia solo el nombre.</p>
          <label>Proveedor</label>
          <input id="pc-prov" value="${esc(proveedorContrato)}" autocomplete="off">
          <button class="secundario" onclick="descargarCopiaProceso()">Descargar PDF</button>
        </div>`}
    </div>

    ${p.estado === "borrador" ? `
      <div class="card">
        <h4 style="margin-top:0">Cotizaciones externas recibidas (${[2, 3].filter(s => totalOferta(items, por[s])).length} de 2 completas)</h4>
        ${(ofertas || []).length ? comparativoHTML(p, ofertas) : `<p class="hint">Aún no hay cotizaciones externas registradas.</p>`}
        <p class="hint">${(ofertas || []).filter(o => o.archivo_url).map(o => `${enlaceArchivo(o.archivo_url, `Cotización ${esc(o.proveedor)}`)}`).join(" · ")}</p>
      </div>` : ""}

    ${p.estado !== "borrador" ? `
      <h4 style="margin:1.2rem 0 .2rem">Cotizaciones recibidas (${completas} de 3 completas)</h4>
      ${SLOTS_COTIZACION.map(tarjetaOferta).join("")}

      <div class="card">
        <h4 style="margin-top:0">Comparación</h4>
        ${(ofertas || []).length ? comparativoHTML(p, ofertas) : `<p class="hint">Registra las cotizaciones para compararlas.</p>`}
      </div>

      <div class="card">
        ${p.estado === "solicitud_creada" ? `
          <h4 style="margin-top:0">Solicitud especial creada</h4>
          ${(sols || []).length ? `<p>Solicitud <strong>${esc(numSol(sols[0]))}</strong> · <span class="pill ${sols[0].estado}">${sols[0].estado}</span>
            <button class="secundario" onclick="abrirExpediente('${sols[0].id}')">Ver expediente</button></p>` : `<p class="hint">Ya se creó la solicitud.</p>`}` : `
          <h4 style="margin-top:0">Crear la solicitud especial</h4>
          ${completas === 3
            ? `<p class="hint">Ya están las 3 cotizaciones. Se crea una solicitud de Obras con estos productos y los precios del proveedor del contrato; sigue el recorrido normal y se descuenta del convenio al facturar.</p>
               <button class="primario" onclick="crearSolicitudDesdeProceso('${p.id}')">Crear solicitud especial</button>`
            : `<p class="hint">Faltan ${3 - completas} cotización(es) completa(s) para poder crear la solicitud. Cada una necesita proveedor y el precio de todos los productos.</p>`}
          <p class="error oculto" id="pc-error"></p>`}
      </div>` : ""}`;
}

async function emitirProceso(id) {
  if (!_lock()) return;
  try {
    const prov = (document.getElementById("pc-prov").value || "").trim();
    if (!prov) { alert("Indica el proveedor al que se envía este PDF."); return; }
    if (!await confirmar({ titulo: "Emitir la solicitud de cotización", texto: `Se genera el PDF firmado para ${prov} y los productos ya no se podrán modificar.`, boton: "Emitir y descargar" })) return;
    const { data, error } = await sb.from("proceso_cotizacion").update({ estado: "emitida" }).eq("id", id).select("*, unidad(nombre)").single();
    if (error) { alert("No se pudo emitir: " + error.message); return; }
    await descargarPdfCotizacion(data, prov);
    actualizarNotificaciones();
    vistaProceso(id);
  } finally { _unlock(); }
}

async function descargarCopiaProceso() {
  const prov = (document.getElementById("pc-prov").value || "").trim();
  if (!prov) { alert("Indica el proveedor al que se envía este PDF."); return; }
  await descargarPdfCotizacion(window._procActual.p, prov);
}

// Formato único de solicitud de cotización (firma solo del ITO).
async function descargarPdfCotizacion(p, proveedor) {
  if (!window.jspdf || !window.jspdf.jsPDF) { alert("No se pudo cargar el generador de PDF. Revisa la conexión."); return; }
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
  const M = 18, R = 210 - M;
  let y = M;
  doc.setFont("helvetica", "bold"); doc.setFontSize(15);
  doc.text("MUNICIPALIDAD DE DOÑIHUE", M, y);
  doc.setFontSize(10); doc.setFont("helvetica", "normal");
  y += 6; doc.text("Dirección de Obras — Unidad de Operaciones", M, y);
  y += 10; doc.setFont("helvetica", "bold"); doc.setFontSize(13);
  doc.text(`SOLICITUD DE COTIZACIÓN${p.correlativo ? "  N° " + p.correlativo : ""}`, M, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);

  y += 9;
  const fila = (k, v) => { doc.setFont("helvetica", "bold"); doc.text(k, M, y); doc.setFont("helvetica", "normal"); const l = doc.splitTextToSize(String(v || "—"), 125); doc.text(l, M + 48, y); y += 6 + (l.length - 1) * 4.5; };
  fila("Señores:", proveedor);
  fila("Fecha de envío:", fechaCL(p.fecha_envio) || fechaCL(hoyISO()));
  fila("Dirección solicitante:", p.unidad?.nombre || "");
  if (p.unidad_interna) fila("Unidad:", p.unidad_interna);
  fila("Responsable:", p.solicitante);
  fila("Lugar de entrega:", p.lugar_entrega || LUGAR_ENTREGA);
  if (p.ubicacion) fila("Ubicación de uso:", p.ubicacion);

  y += 3;
  const intro = doc.splitTextToSize("Se solicita cotizar los productos que se detallan, indicando el precio unitario neto de cada uno, el plazo de entrega y la validez de la oferta.", R - M);
  doc.text(intro, M, y); y += intro.length * 4.6 + 4;

  if (y > 250) { doc.addPage(); y = M; }
  doc.setFont("helvetica", "bold");
  doc.text("PRODUCTOS A COTIZAR", M, y); y += 3;
  doc.setDrawColor(180); doc.line(M, y, R, y); y += 6;
  doc.text("N°", M, y); doc.text("Producto", M + 9, y); doc.text("Cantidad", 150, y, { align: "right" }); doc.text("Unidad", 156, y);
  doc.setFont("helvetica", "normal");
  y += 2; doc.line(M, y, R, y); y += 6;
  (p.items || []).forEach((it, i) => {
    const l = doc.splitTextToSize(String(it.producto || ""), 105);
    const alto = Math.max(7, l.length * 4.6 + 2.4);
    if (y + alto > 255) { doc.addPage(); y = M; }
    doc.text(String(i + 1), M, y); doc.text(l, M + 9, y);
    doc.text(String(it.cantidad ?? ""), 150, y, { align: "right" });
    doc.text(String(it.unidad || ""), 156, y);
    y += alto;
  });

  // Firma del ITO (PNG del bucket privado "firmas"); si falta, queda la línea en blanco.
  const firma = await cargarFirma("ito.png");
  const altoFirma = 32, anchoBloque = 70;
  if (y > 225) { doc.addPage(); y = M; }
  const yLinea = y + altoFirma + 14;
  if (firma) {
    const k = Math.min((anchoBloque - 4) / firma.w, altoFirma / firma.h);
    const w = firma.w * k, h = firma.h * k;
    doc.addImage(firma.dataUrl, firma.formato, M + (anchoBloque - w) / 2, yLinea - h - 1, w, h);
  }
  doc.setDrawColor(120); doc.line(M, yLinea, M + anchoBloque, yLinea);
  doc.text("Encargado de Operaciones (ITO)", M + anchoBloque / 2, yLinea + 5, { align: "center" });

  doc.setFontSize(8); doc.setTextColor(120);
  doc.text("Documento generado por Control Ferretería — Municipalidad de Doñihue", M, 288);
  doc.save(`cotizacion-${p.correlativo || p.id.slice(0, 8)}.pdf`);
}

// Rellena los precios de una tarjeta con los del formulario que devolvió el proveedor (sin guardar todavía).
async function cargarPreciosEnTarjeta(slot, input) {
  const f = input.files[0];
  if (!f) return;
  const card = document.getElementById("oferta-" + slot);
  const msg = card.querySelector(".of-form-msg");
  try {
    const items = (window._procActual && window._procActual.p.items) || [];
    const r = await preciosDesdeFormulario(f, items);
    if (r.leidos) {
      card.querySelectorAll(".of-precio").forEach(inp => {
        const i = items.findIndex(it => it.id === inp.dataset.item);
        if (i >= 0 && r.precios[i] !== "") inp.value = r.precios[i];
      });
    }
    msg.textContent = mensajePreciosFormulario(r) + (r.leidos ? " Pulsa «Guardar esta cotización» para registrarlos." : "");
  } catch (err) { msg.textContent = "No se pudo leer el PDF: " + err.message; }
}

async function guardarOferta(procesoId, slot) {
  if (!_lock()) return;
  try {
    const card = document.getElementById("oferta-" + slot);
    const err = card.querySelector(".of-error");
    const mostrar = (m) => { err.textContent = m; err.classList.remove("oculto"); };
    err.classList.add("oculto");
    const proveedor = card.querySelector(".of-prov").value.trim();
    if (!proveedor) { mostrar("Indica el proveedor."); return; }
    const precios = {};
    card.querySelectorAll(".of-precio").forEach(inp => { const v = parseFloat(inp.value); if (v > 0) precios[inp.dataset.item] = v; });
    let archivo_url = card.dataset.archivo || null;
    const file = card.querySelector(".of-file").files[0];
    if (file) {
      const r = await subirArchivo("memos", file);
      if (r.error) { mostrar(r.error); return; }
      archivo_url = r.url;
    }
    const { error } = await sb.from("proceso_cotizacion_oferta").upsert({
      proceso_id: procesoId, slot, proveedor,
      numero: card.querySelector(".of-num").value.trim() || null,
      fecha: card.querySelector(".of-fecha").value || null,
      precios, archivo_url,
    }, { onConflict: "proceso_id,slot" });
    if (error) { mostrar("No se pudo guardar: " + error.message); return; }
    vistaProceso(procesoId);
  } finally { _unlock(); }
}

// Con las 3 cotizaciones completas: crea la solicitud especial (recorrido de Obras)
// con los precios del proveedor del contrato.
async function crearSolicitudDesdeProceso(id) {
  if (!_lock()) return;
  try {
    const errorEl = document.getElementById("pc-error");
    const mostrar = (m) => { errorEl.textContent = m; errorEl.classList.remove("oculto"); };
    errorEl.classList.add("oculto");
    const { p, ofertas } = window._procActual || {};
    if (!p || p.id !== id) { mostrar("Vuelve a abrir la cotización."); return; }
    const items = p.items || [];
    const por = {};
    (ofertas || []).forEach(o => { por[o.slot] = o; });
    if (!SLOTS_COTIZACION.every(s => totalOferta(items, por[s.slot]))) { mostrar("Faltan cotizaciones completas."); return; }
    if (!await confirmar({ titulo: "Crear la solicitud especial", texto: "Se crea una solicitud con los productos y los precios del proveedor del contrato, y sigue el recorrido normal de aprobación.", boton: "Crear solicitud" })) return;

    const porRevisar = rolEfectivo() === "solicitante_obras";
    const payload = {
      unidad_id: p.unidad_id, unidad_interna: p.unidad_interna, solicitante: p.solicitante,
      motivo: p.motivo || `Compra fuera de catálogo según cotización ${p.correlativo}`,
      ubicacion: p.ubicacion, fecha_solicitud: hoyISO(), tipo: "operaciones", proceso_cotizacion_id: p.id,
    };
    if (!porRevisar) {
      payload.estado = "visada";
      payload.visado_por = perfilActual.id;
      payload.visado_en = new Date().toISOString();
    }
    const { data: sol, error } = await sb.from("solicitud").insert(payload).select().single();
    if (error) { mostrar("No se pudo crear la solicitud: " + error.message); return; }

    const hevia = por[1];
    const detalle = items.map(it => ({
      solicitud_id: sol.id, articulo_id: null,
      descripcion_libre: it.producto, unidad_medida_libre: it.unidad,
      cantidad_solicitada: it.cantidad, precio_unitario_neto: Number(hevia.precios[it.id]),
    }));
    const { error: errDet } = await sb.from("solicitud_detalle").insert(detalle);
    if (errDet) { mostrar("Se creó la solicitud pero fallaron sus productos: " + errDet.message); return; }

    const { error: errEst } = await sb.from("proceso_cotizacion").update({ estado: "solicitud_creada" }).eq("id", id);
    if (errEst) { mostrar("La solicitud se creó pero no se pudo cerrar la cotización: " + errEst.message); return; }
    actualizarNotificaciones();
    vistaProceso(id);
  } finally { _unlock(); }
}

// Descarga una firma del bucket privado para estamparla en el PDF; null si no hay.
async function cargarFirma(nombre) {
  try {
    const { data: blob, error } = await sb.storage.from("firmas").download(nombre);
    if (error || !blob) return null;
    const dataUrl = await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob);
    });
    const dim = await new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight }); im.onerror = rej; im.src = dataUrl;
    });
    return { dataUrl, formato: dataUrl.startsWith("data:image/jpeg") ? "JPEG" : "PNG", ...dim };
  } catch { return null; }
}

// ---------------------------------------------------------------------
// Catálogo (solo admin): alta y edición de artículos de la tabla `articulo`.
// ---------------------------------------------------------------------
async function vistaCatalogo() {
  vista().innerHTML = "<div class='card'>Cargando…</div>";

  const { data: articulos, error } = await sb
    .from("articulo")
    .select("id, descripcion, unidad_medida, precio_neto")
    .order("descripcion");

  if (error) {
    vista().innerHTML = `<div class="card error">No se pudo leer el catálogo: ${error.message}
      <br><small>Falta la política RLS que deja al rol 'admin' escribir en la tabla 'articulo' (ver README).</small></div>`;
    return;
  }

  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Agregar artículo al catálogo</h3>
      <div class="linea-detalle" style="grid-template-columns:2fr 1fr auto">
        <div><label>Descripción</label><input id="ca-desc" placeholder="Ej: Cemento portland 25 kg"></div>
        <div><label>Unidad de medida</label><input id="ca-um" placeholder="saco, unidad, m, kg…"></div>
        <div><button class="primario" id="ca-agregar" style="margin-top:0">+ Agregar</button></div>
      </div>
      <p class="error oculto" id="ca-error"></p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Artículos (${(articulos || []).length})</h3>
      <table>
        <thead><tr><th>Descripción</th><th>U. medida</th><th class="num">Precio unitario neto</th><th></th></tr></thead>
        <tbody>
          ${(articulos || []).map(a => `
            <tr data-id="${a.id}">
              <td><input class="ca-r-desc" value="${esc(a.descripcion)}"></td>
              <td><input class="ca-r-um" value="${esc(a.unidad_medida)}"></td>
              <td class="num">${esAdminTotal()
                ? `<input class="ca-r-precio" type="number" min="0" step="1" value="${a.precio_neto ?? ""}" style="width:7rem;text-align:right">`
                : (a.precio_neto == null ? "—" : money(a.precio_neto))}</td>
              <td><button class="secundario ca-guardar">Guardar</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p class="error oculto" id="ca-error2"></p>
      <p class="hint oculto" id="ca-ok" style="color:var(--ok)"></p>
    </div>
  `;

  document.getElementById("ca-agregar").addEventListener("click", async () => {
    const descripcion = document.getElementById("ca-desc").value.trim();
    const unidad_medida = document.getElementById("ca-um").value.trim();
    const errorEl = document.getElementById("ca-error");
    errorEl.classList.add("oculto");
    if (!descripcion || !unidad_medida) {
      errorEl.textContent = "Completa descripción y unidad de medida.";
      errorEl.classList.remove("oculto");
      return;
    }
    const { error: errIns } = await sb.from("articulo").insert({ descripcion, unidad_medida });
    if (errIns) { errorEl.textContent = "No se pudo agregar: " + errIns.message; errorEl.classList.remove("oculto"); return; }
    vistaCatalogo();
  });

  vista().querySelectorAll(".ca-guardar").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tr = btn.closest("tr");
      const id = tr.dataset.id;
      const descripcion = tr.querySelector(".ca-r-desc").value.trim();
      const unidad_medida = tr.querySelector(".ca-r-um").value.trim();
      const errorEl = document.getElementById("ca-error2");
      const okEl = document.getElementById("ca-ok");
      errorEl.classList.add("oculto"); okEl.classList.add("oculto");
      btn.disabled = true;
      const cambios = { descripcion, unidad_medida };
      const inpPrecio = tr.querySelector(".ca-r-precio");
      if (inpPrecio) cambios.precio_neto = inpPrecio.value === "" ? null : Number(inpPrecio.value);
      const { error: errUpd } = await sb.from("articulo").update(cambios).eq("id", id);
      btn.disabled = false;
      if (errUpd) { errorEl.textContent = "No se pudo guardar: " + errUpd.message; errorEl.classList.remove("oculto"); return; }
      okEl.textContent = "Guardado."; okEl.classList.remove("oculto");
    });
  });
}

// ---------------------------------------------------------------------
// Usuarios (solo admin): asignar rol y unidad a cada perfil.
// No hay tabla nueva: se edita directamente la tabla `perfiles`.
// ---------------------------------------------------------------------
async function vistaUsuarios() {
  vista().innerHTML = "<div class='card'>Cargando…</div>";

  const [{ data: perfiles, error }, { data: unidades }] = await Promise.all([
    sb.from("perfiles").select("id, nombre, rol, unidad_id, debe_cambiar_clave").order("nombre"),
    sb.from("unidad").select("id, nombre").order("nombre"),
  ]);

  if (error) {
    vista().innerHTML = `<div class="card error">No se pudieron leer los perfiles: ${error.message}
      <br><small>Falta la política RLS que deja al rol 'admin' ver y editar la tabla 'perfiles' (ver README).</small></div>`;
    return;
  }

  const opcionesRol = (sel) => Object.entries(ROLES)
    .map(([v, t]) => `<option value="${v}" ${v === sel ? "selected" : ""}>${t}</option>`).join("");
  const opcionesUnidad = (sel) => `<option value="">— sin unidad —</option>` +
    (unidades || []).map(u => `<option value="${u.id}" ${u.id === sel ? "selected" : ""}>${esc(u.nombre)}</option>`).join("");

  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Usuarios y permisos</h3>
      <p class="hint">Las cuentas se crean en Supabase (Authentication → Users). Cada persona
        aparece aquí después de su primer ingreso: asígnale su nombre, rol y unidad. El rol
        define qué pestañas ve; la unidad es obligatoria para quienes crean solicitudes
        (rol Solicitante). Los cambios se guardan en la tabla <code>perfiles</code>.</p>
      <table>
        <thead><tr><th>Nombre</th><th>Rol</th><th>Unidad</th><th>Clave</th><th></th></tr></thead>
        <tbody>
          ${(perfiles || []).map(p => `
            <tr data-id="${p.id}">
              <td><input class="u-nombre" value="${esc(p.nombre)}" placeholder="Nombre completo">${p.id === perfilActual.id ? " <span class='hint'>(tú)</span>" : ""}</td>
              <td><select class="u-rol">${opcionesRol(p.rol)}</select></td>
              <td><select class="u-unidad">${opcionesUnidad(p.unidad_id)}</select></td>
              <td>${p.debe_cambiar_clave
                    ? `<span class="pill pendiente">debe cambiarla</span>`
                    : `<button class="secundario u-pedir-clave">Pedir cambio</button>`}</td>
              <td><button class="secundario u-guardar">Guardar</button></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      <p class="hint">"Pedir cambio" marca la clave como provisoria: la próxima vez que
        esa persona entre, el sistema la obliga a definir una nueva.</p>
      <p class="error oculto" id="us-error"></p>
      <p class="hint oculto" id="us-ok" style="color:var(--ok)"></p>
    </div>
  `;

  vista().querySelectorAll(".u-guardar").forEach(btn => {
    btn.addEventListener("click", async () => {
      const tr = btn.closest("tr");
      const id = tr.dataset.id;
      const rol = tr.querySelector(".u-rol").value;
      const unidad_id = tr.querySelector(".u-unidad").value || null;
      const nombre = tr.querySelector(".u-nombre").value.trim();
      const errorEl = document.getElementById("us-error");
      const okEl = document.getElementById("us-ok");
      errorEl.classList.add("oculto");
      okEl.classList.add("oculto");
      btn.disabled = true;

      if (!nombre) { btn.disabled = false; errorEl.textContent = "El nombre no puede quedar vacío."; errorEl.classList.remove("oculto"); return; }
      const { error: errUpd } = await sb.from("perfiles").update({ nombre, rol, unidad_id }).eq("id", id);
      btn.disabled = false;

      if (errUpd) {
        errorEl.textContent = "No se pudo guardar: " + errUpd.message;
        errorEl.classList.remove("oculto");
        return;
      }
      okEl.textContent = "Guardado.";
      okEl.classList.remove("oculto");
      if (id === perfilActual.id) {
        perfilActual.nombre = nombre; perfilActual.rol = rol; perfilActual.unidad_id = unidad_id;
        document.getElementById("quien-soy").textContent = `${nombre} · ${etiquetaRol(rol)}`;
        armarTabs();
      }
    });
  });

  vista().querySelectorAll(".u-pedir-clave").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.closest("tr").dataset.id;
      btn.disabled = true;
      const { error: e } = await sb.from("perfiles").update({ debe_cambiar_clave: true }).eq("id", id);
      if (e) { alert("No se pudo marcar: " + e.message); btn.disabled = false; return; }
      vistaUsuarios();
    });
  });
}

iniciar();
