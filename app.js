// =====================================================================
// Kárdex Ferretería — app mínima conectada a Supabase.
// Sin framework, sin paso de compilación: se sube tal cual a GitHub
// Pages. Toda la seguridad real la hacen las políticas RLS del
// esquema — este archivo solo arma pantallas y hace consultas.
// =====================================================================

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let perfilActual = null; // { id, nombre, rol, unidad_id }

const money = (n) => "$" + Number(n || 0).toLocaleString("es-CL");
const esc = (v) => String(v ?? "").replace(/"/g, "&quot;");

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

function iniciarControlInactividad() {
  if (_timerInactividad) return; // ya está activo
  ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"]
    .forEach(ev => document.addEventListener(ev, _marcarActividad, { passive: true }));

  _timerInactividad = setInterval(async () => {
    const inactivo = Date.now() - _ultimaActividad;
    const limite = MINUTOS_INACTIVIDAD * 60000;
    if (inactivo >= limite) {
      clearInterval(_timerInactividad); _timerInactividad = null;
      sessionStorage.setItem("cierre_inactividad", "1");
      await sb.auth.signOut();
      location.reload();
    } else if (inactivo >= limite - 60000 && !_avisoInactividad) {
      _avisoInactividad = document.createElement("div");
      _avisoInactividad.className = "aviso-inactividad";
      _avisoInactividad.textContent =
        "Tu sesión se cerrará por inactividad en 1 minuto. Mueve el mouse o toca la pantalla para seguir conectado.";
      document.body.appendChild(_avisoInactividad);
    }
  }, 15000);
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

document.getElementById("btn-logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

async function cargarPerfilYArmarApp(user) {
  let { data: perfil } = await sb.from("perfiles").select("*").eq("id", user.id).maybeSingle();

  // Primer ingreso: crear un perfil "pendiente" para que aparezca en la
  // pestaña Usuarios y el admin_ito le asigne rol y unidad.
  if (!perfil) {
    const { data: nuevo } = await sb.from("perfiles")
      .insert({ id: user.id, nombre: user.email, rol: "pendiente" })
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

  // Clave provisoria: al primer ingreso obliga a cambiarla antes de seguir.
  if (perfil.debe_cambiar_clave) {
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
      <h3 style="margin-top:0">${obligatorio ? "Cambia tu clave provisoria" : "Cambiar clave"}</h3>
      ${obligatorio ? `<p class="hint">Estás usando una clave provisoria. Define una nueva para continuar.</p>` : ""}
      <label>Nueva clave</label>
      <input id="cc-1" type="password" autocomplete="new-password" placeholder="Mínimo 6 caracteres">
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
    if (c1.length < 6) { errorEl.textContent = "La clave debe tener al menos 6 caracteres."; errorEl.classList.remove("oculto"); return; }
    if (c1 !== c2) { errorEl.textContent = "Las dos claves no coinciden."; errorEl.classList.remove("oculto"); return; }

    const { error } = await sb.auth.updateUser({ password: c1 });
    if (error) { errorEl.textContent = "No se pudo cambiar: " + error.message; errorEl.classList.remove("oculto"); return; }

    await sb.rpc("marcar_clave_cambiada");        // requiere la función del README
    perfilActual.debe_cambiar_clave = false;

    okEl.textContent = "Clave actualizada.";
    okEl.classList.remove("oculto");
    if (obligatorio) setTimeout(armarTabs, 700);
  });
}

// Selector "Ver como…" en el encabezado. Para admin y para el ITO:
// previsualiza la interfaz con los permisos de otro rol, sin tocar la BD
// (las escrituras siguen gobernadas por RLS).
function montarSelectorRolVista() {
  const previo = document.getElementById("rol-vista");
  if (previo) previo.remove();
  if (!["admin", "admin_ito"].includes(perfilActual.rol)) return;

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
};

// ---------------------------------------------------------------------
// Tabs — qué ve cada rol. `grupo` agrupa visualmente el menú lateral
// (null = ítem suelto arriba, como "Inicio").
// ---------------------------------------------------------------------
const TABS = [
  { id: "resumen", label: "Inicio", grupo: null, icono: "resumen", roles: ["admin", "admin_ito", "solicitante", "lector_operativo", "lector_pagos", "lector_ejecutivo"], render: vistaResumen },
  { id: "nueva", label: "Nueva solicitud", grupo: "Gestión", icono: "nueva", roles: ["admin", "admin_ito", "solicitante"], render: vistaNuevaSolicitud },
  { id: "solicitudes", label: "Solicitudes", grupo: "Gestión", icono: "solicitudes", roles: ["admin", "admin_ito", "solicitante", "lector_operativo"], render: vistaSolicitudes },
  { id: "expedientes", label: "Expedientes", grupo: "Gestión", icono: "expedientes", roles: ["admin", "admin_ito", "lector_operativo", "lector_pagos"], render: vistaExpedientes },
  { id: "catalogo", label: "Catálogo", grupo: "Inventario", icono: "catalogo", roles: ["admin"], render: vistaCatalogo },
  { id: "convenio", label: "Convenio / ferretería", grupo: "Administración", icono: "convenio", roles: ["admin"], render: vistaConvenio },
  { id: "usuarios", label: "Usuarios", grupo: "Administración", icono: "usuarios", roles: ["admin"], render: vistaUsuarios },
  { id: "clave", label: "Cambiar clave", grupo: "Mi cuenta", icono: "clave", roles: ["admin", "admin_ito", "solicitante", "lector_operativo", "lector_pagos", "lector_ejecutivo"], render: () => vistaCambiarClave(false) },
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
      <strong>Proveedor:</strong> ${data.proveedor}
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
          <div class="bar bar-click" title="${esc(tip)}" onclick="vistaExpedientes('${esc(nombre)}')">
            <span class="b-label">${nombre} <span class="b-count">${d.solicitudes}</span></span>
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

async function vistaNuevaSolicitud() {
  const [{ data: articulos }, { data: unidades }] = await Promise.all([
    sb.from("articulo").select("descripcion, unidad_medida").order("descripcion"),
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
      <div class="linea-detalle" style="grid-template-columns:1fr 1fr">
        <div><label>N° de solicitud / correlativo</label><input id="ns-correlativo" placeholder="Ej: 2026-045"></div>
        <div><label>Fecha de solicitud</label><input id="ns-fecha" type="date" value="${hoyISO()}"></div>
      </div>
      <label>Unidad solicitante</label>
      <select id="ns-unidad">
        <option value="">— selecciona —</option>
        ${(unidades || []).map(u => `<option value="${u.id}" ${u.id === perfilActual.unidad_id ? "selected" : ""}>${u.nombre}</option>`).join("")}
      </select>
      <label>Responsable del requerimiento</label>
      <input id="ns-solicitante" value="${esc(perfilActual.nombre)}" placeholder="Nombre y cargo">
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
      <label>Beneficio público esperado</label>
      <textarea id="ns-beneficio" rows="2"></textarea>

      <h4>3. Detalle de materiales solicitados</h4>
      <div id="ns-lineas"></div>
      <div class="linea-detalle" style="grid-template-columns:2fr 1fr 1fr 1fr auto">
        <div><label>Material</label><input id="ns-mat" list="ns-catalogo" placeholder="Nombre del material"></div>
        <div><label>Cantidad</label><input id="ns-cant" type="number" min="0" step="0.01"></div>
        <div><label>Unidad</label><input id="ns-um" placeholder="un, m, kg, saco…"></div>
        <div><label>Valor ref. ($)</label><input id="ns-valor" type="number" min="0" step="1"></div>
        <div><button class="secundario" id="ns-agregar" style="margin-top:0">+ Agregar</button></div>
      </div>
      <datalist id="ns-catalogo">${(articulos || []).map(a => `<option value="${esc(a.descripcion)}"></option>`).join("")}</datalist>
      <p class="totales">Monto total estimado: <b id="ns-total">$0</b></p>

      <h4>4. Respaldos adjuntos</h4>
      <label class="chk"><input type="checkbox" id="ns-resp-foto"> Respaldo fotográfico &nbsp;·&nbsp; N° de fotografías:
        <input id="ns-num-fotos" type="number" min="0" class="chk-inline"></label>
      <label class="chk"><input type="checkbox" id="ns-resp-informe"> Informe técnico complementario / cubicación de materiales</label>
      <label class="chk"><input type="checkbox" id="ns-resp-presupuesto"> Presupuesto estimativo / planificación del trabajo</label>
      <label class="chk"><input type="checkbox" id="ns-resp-otro"> Otro:
        <input id="ns-resp-otro-texto" placeholder="especificar" class="chk-inline" style="width:220px"></label>

      <label>Adjuntar el Formulario Único firmado / memo (PDF, Word o foto)</label>
      <input id="ns-memo" type="file" accept=".pdf,.doc,.docx,image/*">
      <p class="hint">Es el documento que se anexa al Memorándum de Solicitud (máx. 10 MB).</p>

      <h4>5. Situaciones especiales</h4>
      <label class="chk"><input type="checkbox" id="ns-cdp-negativo"> Solicitud con CDP negativo (Manual, punto 8)</label>
      <label class="chk"><input type="checkbox" id="ns-fuera-catalogo"> El producto NO figura en el catálogo cerrado del contrato (Manual, punto 10)</label>
      <p class="hint oculto" id="ns-aviso-especial">Al marcar "fuera de catálogo" la solicitud entra como
        <strong>especial</strong>: en su expediente deberás adjuntar la justificación de la Unidad Jurídica
        y de la DAF, y la compra se tramita por Mercado Público.</p>

      <button class="primario" id="ns-guardar">Ingresar solicitud</button>
      <p class="error oculto" id="ns-error"></p>
    </div>
  `;

  document.getElementById("ns-agregar").addEventListener("click", () => {
    const mat = document.getElementById("ns-mat").value.trim();
    const cant = parseFloat(document.getElementById("ns-cant").value);
    if (!mat || !cant) return;
    lineasSolicitud.push({
      descripcion: mat,
      cantidad_solicitada: cant,
      unidad_medida: document.getElementById("ns-um").value.trim(),
      valor_referencial: parseFloat(document.getElementById("ns-valor").value) || 0,
    });
    ["ns-mat", "ns-cant", "ns-um", "ns-valor"].forEach(id => document.getElementById(id).value = "");
    pintarLineas();
  });

  document.getElementById("ns-fuera-catalogo").addEventListener("change", (e) => {
    document.getElementById("ns-aviso-especial").classList.toggle("oculto", !e.target.checked);
  });
  document.getElementById("ns-pdf").addEventListener("change", (e) => {
    if (e.target.files[0]) leerFormularioPDF(e.target.files[0]);
  });
  document.getElementById("ns-guardar").addEventListener("click", guardarSolicitud);
  pintarLineas();
}

function pintarLineas() {
  const cont = document.getElementById("ns-lineas");
  const total = lineasSolicitud.reduce((a, l) => a + Number(l.valor_referencial || 0), 0);
  const tEl = document.getElementById("ns-total");
  if (tEl) tEl.textContent = money(total);
  if (!lineasSolicitud.length) {
    cont.innerHTML = "<p style='color:var(--ink-soft);font-size:0.85rem'>Aún no agregas materiales.</p>";
    return;
  }
  cont.innerHTML = `<table>
    <tr><th>Material</th><th class="num">Cantidad</th><th>Unidad</th><th class="num">Valor ref.</th><th></th></tr>
    ${lineasSolicitud.map((l, i) => `<tr>
        <td>${l.descripcion}</td>
        <td class="num">${l.cantidad_solicitada}</td>
        <td>${l.unidad_medida || "—"}</td>
        <td class="num">${money(l.valor_referencial)}</td>
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

    set("ns-correlativo", T("num_solicitud"));
    set("ns-fecha", fecha(T("fecha_solicitud")));
    set("ns-solicitante", T("responsable_requerimiento"));
    set("ns-contacto", T("contacto"));
    set("ns-supervisor", T("responsable_supervisor"));
    set("ns-ubicacion", T("ubicacion_uso"));
    set("ns-desc", T("desc_requerimiento"));
    set("ns-motivo", T("fundamento"));
    set("ns-situacion", T("situacion_actual"));
    set("ns-trabajo", T("trabajo_ejecutar"));
    set("ns-beneficio", T("beneficio_publico"));

    // unidad solicitante: intenta calzar por nombre
    const unTxt = T("unidad_solicitante").toLowerCase();
    if (unTxt) {
      const opt = [...document.getElementById("ns-unidad").options].find(o => o.textContent.toLowerCase().includes(unTxt) || unTxt.includes(o.textContent.toLowerCase()));
      if (opt) document.getElementById("ns-unidad").value = opt.value;
    }

    lineasSolicitud = [];
    for (let r = 0; r < 5; r++) {
      const mat = T(`mat_r${r}_c0`);
      if (!mat) continue;
      lineasSolicitud.push({
        descripcion: mat,
        cantidad_solicitada: num(T(`mat_r${r}_c1`)),
        unidad_medida: T(`mat_r${r}_c2`),
        valor_referencial: num(T(`mat_r${r}_c3`)),
      });
    }
    pintarLineas();

    document.getElementById("ns-resp-foto").checked = C("chk_fotografico");
    set("ns-num-fotos", T("num_fotos"));
    document.getElementById("ns-resp-informe").checked = C("chk_informe_tecnico");
    document.getElementById("ns-resp-presupuesto").checked = C("chk_presupuesto");
    document.getElementById("ns-resp-otro").checked = C("chk_otro");
    set("ns-resp-otro-texto", T("otro_texto"));
    document.getElementById("ns-cdp-negativo").checked = C("chk_cdp_negativo");
    const fuera = C("chk_no_catalogo");
    document.getElementById("ns-fuera-catalogo").checked = fuera;
    document.getElementById("ns-aviso-especial").classList.toggle("oculto", !fuera);

    msg.textContent = "Formulario autocompletado desde el PDF. Revísalo y corrige lo que falte.";
  } catch (e) {
    msg.textContent = "No se pudo leer el PDF: " + e.message + ". Llena el formulario a mano.";
  }
}

async function guardarSolicitud() {
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

  // Adjunto (Formulario Único firmado / memo) → bucket "memos"
  let memo_url = null;
  const file = document.getElementById("ns-memo").files[0];
  if (file) {
    const { url, error: upErr } = await subirArchivo("memos", file);
    if (upErr) { mostrarError(upErr); return; }
    memo_url = url;
  }

  const monto_estimado = lineasSolicitud.reduce((a, l) => a + Number(l.valor_referencial || 0), 0);
  const descripcion_requerimiento = val("ns-desc");
  const situacion_actual = val("ns-situacion");

  const payload = {
    unidad_id, solicitante, motivo, ubicacion,
    correlativo: val("ns-correlativo") || null,
    fecha_solicitud: document.getElementById("ns-fecha").value || null,
    contacto: val("ns-contacto") || null,
    supervisor: val("ns-supervisor") || null,
    descripcion_requerimiento: descripcion_requerimiento || null,
    situacion_actual: situacion_actual || null,
    trabajo_ejecutar: val("ns-trabajo") || null,
    beneficio_publico: val("ns-beneficio") || null,
    monto_estimado,
    resp_fotografico: document.getElementById("ns-resp-foto").checked,
    num_fotos: parseInt(document.getElementById("ns-num-fotos").value) || null,
    resp_informe_tecnico: document.getElementById("ns-resp-informe").checked,
    resp_presupuesto: document.getElementById("ns-resp-presupuesto").checked,
    resp_otro: document.getElementById("ns-resp-otro").checked,
    resp_otro_texto: val("ns-resp-otro-texto") || null,
    cdp_negativo: document.getElementById("ns-cdp-negativo").checked,
    tipo: fuera_catalogo ? "especial" : "normal",
  };
  if (memo_url) payload.memo_url = memo_url;
  if (fuera_catalogo) {
    payload.justificacion_especial = [descripcion_requerimiento, motivo, situacion_actual].filter(Boolean).join(" — ");
  }

  const { data: solicitud, error } = await sb.from("solicitud").insert(payload).select().single();
  if (error) { mostrarError(error.message); return; }

  const detalle = lineasSolicitud.map(l => ({
    solicitud_id: solicitud.id,
    articulo_id: null,
    descripcion_libre: l.descripcion,
    unidad_medida_libre: l.unidad_medida || null,
    cantidad_solicitada: l.cantidad_solicitada,
    valor_referencial: l.valor_referencial || null,
  }));
  const { error: errorDetalle } = await sb.from("solicitud_detalle").insert(detalle);
  if (errorDetalle) { mostrarError(errorDetalle.message); return; }

  vista().innerHTML = `<div class="card">
    <h3 style="margin-top:0">Solicitud ingresada${fuera_catalogo ? " (especial)" : ""}</h3>
    <p>Queda <span class="pill pendiente">pendiente</span> del visto bueno del Director de Obras.
    ${fuera_catalogo
      ? `Al ser <strong>fuera de catálogo</strong>, en su expediente (pestaña <strong>Expedientes</strong>)
         deberás cargar la justificación de la Unidad Jurídica y de la DAF, la cotización y la
         documentación de Mercado Público.`
      : `Una vez aprobada, descarga la hoja desde <strong>Expedientes</strong> para enviarla a la empresa.`}
    </p>
  </div>`;
}

// ---------------------------------------------------------------------
// Solicitud especial: material que NO está en el catálogo. Requiere
// justificación, cotización de la empresa y trámite de compra por
// Mercado Público (decreto + orden de compra) antes de poder despacharse.
// ---------------------------------------------------------------------
let lineasEspecial = [];

async function vistaSolicitudEspecial() {
  lineasEspecial = [];
  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Solicitud especial (material fuera de catálogo)</h3>
      <p class="hint">Úsala cuando el material que necesitas <strong>no está en el catálogo</strong> del
        convenio. Este tipo de solicitud sigue un trámite distinto: se justifica, se pide una
        cotización a la empresa y se arma la documentación de compra por Mercado Público
        (decreto + orden de compra) antes de poder despacharse.</p>

      <label>Quién solicita</label>
      <input id="ne-solicitante" type="text" value="${esc(perfilActual.nombre)}" placeholder="Nombre y cargo de quien pide">

      <label>Motivo de la solicitud</label>
      <textarea id="ne-motivo" rows="2" placeholder="Ej: reparación de bomba de pozo profundo"></textarea>

      <label>Dirección de la obra o problemática</label>
      <textarea id="ne-ubicacion" rows="2" placeholder="Calle, número, sector o descripción del punto a intervenir"></textarea>

      <label>Justificación (por qué se requiere y por qué no está en el catálogo)</label>
      <textarea id="ne-justificacion" rows="3" placeholder="Ej: repuesto específico de la marca de la bomba, no lo maneja el proveedor del convenio"></textarea>

      <label>Adjuntar solicitud, memo o documento que acredite lo solicitado</label>
      <input id="ne-memo" type="file" accept=".pdf,.doc,.docx,image/*">
      <p class="hint">PDF, Word o foto (máx. 10 MB).</p>

      <h4>Materiales solicitados</h4>
      <p class="hint">Como no están en el catálogo, descríbelos en texto libre.</p>
      <div id="ne-lineas"></div>
      <div class="linea-detalle">
        <div><label>Descripción del material</label><input id="ne-desc" placeholder="Ej: Repuesto sello mecánico bomba Pedrollo 2CP32"></div>
        <div><label>Cantidad</label><input id="ne-cantidad" type="number" min="0" step="0.01"></div>
        <div><button class="secundario" id="ne-agregar">+ Agregar</button></div>
      </div>

      <button class="primario" id="ne-guardar">Ingresar solicitud especial</button>
      <p class="error oculto" id="ne-error"></p>
    </div>
  `;

  document.getElementById("ne-agregar").addEventListener("click", () => {
    const desc = document.getElementById("ne-desc").value.trim();
    const cantidad = parseFloat(document.getElementById("ne-cantidad").value);
    if (!desc || !cantidad) return;
    lineasEspecial.push({ descripcion_libre: desc, cantidad_solicitada: cantidad });
    document.getElementById("ne-desc").value = "";
    document.getElementById("ne-cantidad").value = "";
    pintarLineasEspecial();
  });

  document.getElementById("ne-guardar").addEventListener("click", guardarSolicitudEspecial);
  pintarLineasEspecial();
}

function pintarLineasEspecial() {
  const cont = document.getElementById("ne-lineas");
  if (!lineasEspecial.length) {
    cont.innerHTML = "<p style='color:var(--ink-soft);font-size:0.85rem'>Aún no agregas materiales.</p>";
    return;
  }
  cont.innerHTML = `<table><tr><th>Descripción</th><th class="num">Cantidad</th><th></th></tr>
    ${lineasEspecial.map((l, i) => `<tr>
        <td>${l.descripcion_libre}</td><td class="num">${l.cantidad_solicitada}</td>
        <td><button class="secundario" onclick="quitarLineaEspecial(${i})">Quitar</button></td>
      </tr>`).join("")}
  </table>`;
}
function quitarLineaEspecial(i) { lineasEspecial.splice(i, 1); pintarLineasEspecial(); }

async function guardarSolicitudEspecial() {
  const errorEl = document.getElementById("ne-error");
  const mostrarError = (msg) => { errorEl.textContent = msg; errorEl.classList.remove("oculto"); };

  const solicitante = document.getElementById("ne-solicitante").value.trim();
  const motivo = document.getElementById("ne-motivo").value.trim();
  const ubicacion = document.getElementById("ne-ubicacion").value.trim();
  const justificacion_especial = document.getElementById("ne-justificacion").value.trim();

  if (!solicitante) { mostrarError("Indica quién solicita."); return; }
  if (!motivo) { mostrarError("Indica el motivo de la solicitud."); return; }
  if (!ubicacion) { mostrarError("Indica la dirección de la obra o la problemática."); return; }
  if (!justificacion_especial) { mostrarError("La justificación es obligatoria en una solicitud especial."); return; }
  if (!lineasEspecial.length) { mostrarError("Agrega al menos un material."); return; }

  const unidad_id = perfilActual.unidad_id;
  if (!unidad_id) { mostrarError("Tu perfil no tiene una unidad asignada — pide al administrador que la agregue."); return; }

  let memo_url = null;
  const file = document.getElementById("ne-memo").files[0];
  if (file) {
    const { url, error: upErr } = await subirArchivo("memos", file);
    if (upErr) { mostrarError(upErr); return; }
    memo_url = url;
  }

  const { data: solicitud, error } = await sb.from("solicitud").insert({
    unidad_id, solicitante, motivo, ubicacion,
    tipo: "especial",              // requiere columna solicitud.tipo
    justificacion_especial,        // requiere columna solicitud.justificacion_especial
    ...(memo_url ? { memo_url } : {}),
  }).select().single();

  if (error) { mostrarError(error.message); return; }

  const detalle = lineasEspecial.map(l => ({
    solicitud_id: solicitud.id,
    descripcion_libre: l.descripcion_libre,   // requiere columna solicitud_detalle.descripcion_libre
    cantidad_solicitada: l.cantidad_solicitada,
  }));
  const { error: errorDetalle } = await sb.from("solicitud_detalle").insert(detalle);
  if (errorDetalle) { mostrarError(errorDetalle.message); return; }

  vista().innerHTML = `<div class="card">
    <h3 style="margin-top:0">Solicitud especial ingresada</h3>
    <p>Queda <span class="pill pendiente">pendiente</span> del visto bueno del Director de Obras.
    Una vez aprobada, entra a su expediente (pestaña <strong>Expedientes</strong>) para pedir la
    cotización y armar la documentación de compra por Mercado Público.</p>
  </div>`;
}

// ---------------------------------------------------------------------
// Solicitudes (listar + aprobar/rechazar si puedes operar: admin_ito o admin)
// ---------------------------------------------------------------------
async function vistaSolicitudes() {
  vista().innerHTML = "<div class='card'>Cargando…</div>";
  const { data, error } = await sb
    .from("solicitud")
    .select("*, unidad(nombre), obra(nombre)")
    .order("creado_en", { ascending: false });

  if (error) { vista().innerHTML = `<div class="card error">${error.message}</div>`; return; }

  const puedeVB = esDirector(); // visto bueno del Director de Obras (o admin)
  vista().innerHTML = `
    <div class="card">
      ${puedeVB ? `<p class="hint">Como Director de Obras das el visto bueno: aprueba o rechaza las solicitudes pendientes.</p>` : ""}
      <table>
        <tr><th>Fecha</th><th>Unidad / solicita</th><th>Motivo</th><th>Estado</th><th></th></tr>
        ${data.map(s => `
          <tr>
            <td>${s.fecha_solicitud || ""}</td>
            <td>${s.unidad?.nombre || ""}${s.obra ? " · " + s.obra.nombre : ""}${s.solicitante ? `<div class="hint">${s.solicitante}</div>` : ""}</td>
            <td>
              ${s.tipo === "especial" ? `<span class="pill enviada">especial</span> ` : ""}${s.motivo || ""}${s.memo_url ? ` · <a href="${s.memo_url}" target="_blank" rel="noopener">documento</a>` : ""}
              ${s.ubicacion ? `<div class="hint">📍 ${s.ubicacion}</div>` : ""}
            </td>
            <td><span class="pill ${s.estado}">${s.estado}</span></td>
            <td>
              ${puedeVB && s.estado === "pendiente" ? `
                <button class="secundario" onclick="resolverSolicitud('${s.id}','aprobada')">Aprobar</button>
                <button class="secundario" onclick="resolverSolicitud('${s.id}','rechazada')">Rechazar</button>
              ` : `<button class="secundario" onclick="abrirExpediente('${s.id}')">Ver expediente</button>`}
            </td>
          </tr>
        `).join("")}
      </table>
    </div>
  `;
}

async function resolverSolicitud(id, estado) {
  await sb.from("solicitud").update({ estado, aprobado_por: perfilActual.id }).eq("id", id);
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

// ---------- Listado de expedientes ----------
async function vistaExpedientes(filtroUnidad) {
  vista().innerHTML = "<div class='card'>Cargando…</div>";
  const [{ data: solsTodas, error }, { data: guias }, { data: facturas }] = await Promise.all([
    sb.from("solicitud").select("*, unidad(nombre)").order("creado_en", { ascending: false }),
    sb.from("guia_despacho").select("solicitud_id, monto_bruto"),
    sb.from("factura").select("solicitud_id, monto_bruto"),
  ]);
  if (error) { vista().innerHTML = `<div class="card error">${error.message}</div>`; return; }

  const sols = filtroUnidad ? (solsTodas || []).filter(s => s.unidad?.nombre === filtroUnidad) : solsTodas;

  const cuenta = (arr, id) => (arr || []).filter(x => x.solicitud_id === id);
  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Expedientes de solicitudes</h3>
      <p class="hint">Cada solicitud reúne su hoja, las guías de despacho y la factura. Haz clic para abrir el expediente.</p>
      ${filtroUnidad ? `<p class="hint">Filtrado por unidad: <strong>${filtroUnidad}</strong> · <a href="#" onclick="vistaExpedientes();return false;">quitar filtro</a></p>` : ""}
      <table>
        <tr><th>Fecha</th><th>Unidad</th><th>Motivo</th><th>Estado</th><th class="num">Guías</th><th>Factura</th><th class="num">Total bruto</th><th></th></tr>
        ${(sols || []).map(s => {
          const g = cuenta(guias, s.id);
          const f = cuenta(facturas, s.id);
          const totalBruto = f.length ? f.reduce((a, x) => a + Number(x.monto_bruto || 0), 0)
                                      : g.reduce((a, x) => a + Number(x.monto_bruto || 0), 0);
          return `<tr>
            <td>${s.fecha_solicitud || ""}</td>
            <td>${s.unidad?.nombre || ""}</td>
            <td>${s.tipo === "especial" ? `<span class="pill enviada">especial</span> ` : ""}${s.motivo || ""}</td>
            <td><span class="pill ${s.estado}">${s.estado}</span></td>
            <td class="num">${g.length || "—"}</td>
            <td>${f.length ? '<span class="pill facturada">sí</span>' : "—"}</td>
            <td class="num">${totalBruto ? money(totalBruto) : "—"}</td>
            <td><button class="secundario" onclick="abrirExpediente('${s.id}')">Abrir</button></td>
          </tr>`;
        }).join("")}
      </table>
    </div>
  `;
}

function abrirExpediente(id) { editarFacturaId = null; vistaExpediente(id); }

// ---------- Detalle de un expediente ----------
let editarFacturaId = null;

async function vistaExpediente(id) {
  vista().innerHTML = "<div class='card'>Cargando expediente…</div>";
  const [{ data: s, error }, { data: detalle }, { data: guias }, { data: facturas }, { data: cotizaciones }, { data: notasCredito }, { data: comprasSol }] = await Promise.all([
    sb.from("solicitud").select("*, unidad(nombre), obra(nombre)").eq("id", id).single(),
    sb.from("solicitud_detalle").select("cantidad_solicitada, descripcion_libre, articulo(descripcion, unidad_medida)").eq("solicitud_id", id),
    sb.from("guia_despacho").select("*").eq("solicitud_id", id).order("fecha", { ascending: true }),
    sb.from("factura").select("*").eq("solicitud_id", id).order("fecha", { ascending: true }),
    sb.from("cotizacion").select("*").eq("solicitud_id", id).order("fecha", { ascending: true }),
    sb.from("nota_credito").select("*").eq("solicitud_id", id).order("fecha", { ascending: true }),
    sb.from("compra").select("n_oc").eq("solicitud_id", id),
  ]);
  if (error || !s) { vista().innerHTML = `<div class="card error">No se pudo abrir el expediente: ${error ? error.message : "no existe"}</div>`; return; }
  const especial = s.tipo === "especial";

  window._expActual = { s, detalle: detalle || [] };
  const opero = puedeOperar();
  const factura = (facturas || [])[0] || null;
  const facturaDescontada = factura && (comprasSol || []).some(c => c.n_oc === "FACT " + factura.numero);
  const sumaGuias = (guias || []).reduce((a, g) => ({
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
          <h3 style="margin:0">Solicitud ${s.n_solicitud ? "N° " + s.n_solicitud : ""}</h3>
          <div class="hint">${s.fecha_solicitud || ""} · ${s.unidad?.nombre || ""}</div>
        </div>
        <div style="display:flex;gap:.4rem;align-items:center">
          ${especial ? `<span class="pill enviada">especial · Mercado Público</span>` : ""}
          <span class="pill ${s.estado}">${s.estado}</span>
        </div>
      </div>
      <div class="exp-datos">
        <div><div class="d-k">Correlativo</div>${s.correlativo || (s.n_solicitud ? "N° " + s.n_solicitud : "—")}</div>
        <div><div class="d-k">Fecha</div>${s.fecha_solicitud || "—"}</div>
        <div><div class="d-k">Unidad solicitante</div>${s.unidad?.nombre || "—"}</div>
        <div><div class="d-k">Responsable</div>${s.solicitante || "—"}</div>
        <div><div class="d-k">Contacto</div>${s.contacto || "—"}</div>
        <div><div class="d-k">Supervisa ejecución</div>${s.supervisor || "—"}</div>
        <div><div class="d-k">Ubicación de uso</div>${s.ubicacion || "—"}</div>
        <div><div class="d-k">Formulario / memo</div>${s.memo_url ? `<a href="${s.memo_url}" target="_blank" rel="noopener">ver documento</a>` : "sin adjunto"}</div>
      </div>

      <div class="exp-seccion" style="margin-top:1.2rem"><h4>Descripción y justificación técnica</h4></div>
      <div class="exp-datos">
        <div><div class="d-k">Qué se solicita</div>${s.descripcion_requerimiento || "—"}</div>
        <div><div class="d-k">Fundamento / motivo</div>${s.motivo || "—"}</div>
        <div><div class="d-k">Situación actual</div>${s.situacion_actual || "—"}</div>
        <div><div class="d-k">Trabajo a ejecutar</div>${s.trabajo_ejecutar || "—"}</div>
        <div><div class="d-k">Beneficio público</div>${s.beneficio_publico || "—"}</div>
      </div>

      <div class="exp-seccion" style="margin-top:1.2rem"><h4>Materiales solicitados</h4></div>
      <table>
        <tr><th>Material</th><th class="num">Cantidad</th><th>Unidad</th><th class="num">Valor ref.</th></tr>
        ${(detalle || []).map(d => `<tr>
          <td>${d.articulo?.descripcion || d.descripcion_libre || ""}</td>
          <td class="num">${d.cantidad_solicitada}</td>
          <td>${d.unidad_medida_libre || d.articulo?.unidad_medida || "—"}</td>
          <td class="num">${d.valor_referencial ? money(d.valor_referencial) : "—"}</td>
        </tr>`).join("")}
        <tr><td colspan="3" style="text-align:right;font-weight:700">Monto total estimado</td>
            <td class="num" style="font-weight:700">${money(s.monto_estimado)}</td></tr>
      </table>

      <div class="exp-seccion" style="margin-top:1.2rem"><h4>Respaldos y situaciones especiales</h4></div>
      <p class="hint" style="margin-top:0">
        ${[
          s.resp_fotografico ? `Respaldo fotográfico${s.num_fotos ? ` (${s.num_fotos} fotos)` : ""}` : null,
          s.resp_informe_tecnico ? "Informe técnico / cubicación" : null,
          s.resp_presupuesto ? "Presupuesto estimativo" : null,
          s.resp_otro ? `Otro: ${s.resp_otro_texto || ""}` : null,
          s.cdp_negativo ? "⚠ CDP negativo" : null,
          especial ? "⚠ Producto fuera de catálogo" : null,
        ].filter(Boolean).join(" · ") || "Sin respaldos marcados."}
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

    ${especial ? bloqueCompraEspecial(s, cotizaciones || [], opero) : ""}

    <!-- GUÍAS DE DESPACHO -->
    <div class="card">
      <div class="exp-seccion"><h4>Guías de despacho</h4><span class="hint">${(guias || []).length} registrada(s)</span></div>
      ${(guias || []).length ? `
        <table>
          <tr><th>N°</th><th>Fecha</th><th>Ingreso</th><th class="num">Neto</th><th class="num">IVA</th><th class="num">Bruto</th><th>Adjunto</th><th></th></tr>
          ${guias.map(g => `<tr>
            <td>${g.numero || ""}</td>
            <td>${g.fecha || ""}</td>
            <td>${g.fecha_ingreso || ""}</td>
            <td class="num">${money(g.monto_neto)}</td>
            <td class="num">${money(g.iva)}</td>
            <td class="num">${money(g.monto_bruto)}</td>
            <td>${g.archivo_url ? `<a href="${g.archivo_url}" target="_blank" rel="noopener">ver</a>` : "—"}</td>
            <td>${esAdminTotal() ? `<button class="secundario" onclick="eliminarGuia('${g.id}','${s.id}')">Eliminar</button>` : ""}</td>
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
      ${factura && editarFacturaId !== factura.id ? `
        <div class="exp-datos">
          <div><div class="d-k">N° factura</div>${factura.numero || "—"}</div>
          <div><div class="d-k">Fecha</div>${factura.fecha || "—"}</div>
          <div><div class="d-k">Neto</div>${money(factura.monto_neto)}</div>
          <div><div class="d-k">IVA</div>${money(factura.iva)}</div>
          <div><div class="d-k">Bruto</div>${money(factura.monto_bruto)}</div>
          <div><div class="d-k">Fecha de pago</div>${factura.fecha_pago || "—"}</div>
          <div><div class="d-k">Adjunto</div>${factura.archivo_url ? `<a href="${factura.archivo_url}" target="_blank" rel="noopener">ver factura</a>` : "sin adjunto"}</div>
        </div>
        ${!facturaDescontada ? `<p class="hint" style="color:var(--warn)">⚠ Esta factura todavía no se descontó del convenio (el Resumen no la refleja).</p>` : ""}
        ${opero ? `
          <div class="acciones">
            <button class="secundario" onclick="editarFactura('${factura.id}','${s.id}')">Editar</button>
            ${!facturaDescontada ? `<button class="secundario" onclick="reintentarDescuentoFactura('${s.id}','${factura.id}')">Reintentar descuento del convenio</button>` : ""}
            ${esAdminTotal() ? `<button class="secundario" onclick="eliminarFactura('${s.id}','${factura.id}','${esc(factura.numero)}')">Eliminar</button>` : ""}
          </div>
        ` : ""}
      ` : (opero ? `
        ${factura ? `<p class="hint">Editando la factura N° ${factura.numero || ""}. <a href="#" onclick="cancelarEdicionFactura('${s.id}');return false;">Cancelar</a></p>` : ""}
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
  `;
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
            <td>${c.proveedor || ""}</td>
            <td>${c.numero || ""}</td>
            <td>${c.fecha || ""}</td>
            <td class="num">${money(c.monto_neto)}</td>
            <td class="num">${money(c.iva)}</td>
            <td class="num">${money(c.monto_bruto)}</td>
            <td>${c.archivo_url ? `<a href="${c.archivo_url}" target="_blank" rel="noopener">ver</a>` : "—"}</td>
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
        <div><div class="d-k">N° decreto</div>${s.n_decreto || "—"}</div>
        <div><div class="d-k">Fecha decreto</div>${s.fecha_decreto || "—"}</div>
        <div><div class="d-k">Decreto</div>${s.decreto_url ? `<a href="${s.decreto_url}" target="_blank" rel="noopener">ver documento</a>` : "sin adjunto"}</div>
        <div><div class="d-k">N° orden de compra</div>${s.n_orden_compra || "—"}</div>
        <div><div class="d-k">Fecha OC</div>${s.fecha_oc || "—"}</div>
        <div><div class="d-k">Orden de compra</div>${s.oc_url ? `<a href="${s.oc_url}" target="_blank" rel="noopener">ver documento</a>` : "sin adjunto"}</div>
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
        <div><div class="d-k">Justificación Unidad Jurídica</div>${s.just_juridica_url ? `<a href="${s.just_juridica_url}" target="_blank" rel="noopener">ver documento</a>` : "sin adjunto"}</div>
        <div><div class="d-k">Justificación DAF</div>${s.just_daf_url ? `<a href="${s.just_daf_url}" target="_blank" rel="noopener">ver documento</a>` : "sin adjunto"}</div>
      </div>
      ${s.cdp_negativo ? `
        <p class="hint" style="color:var(--warn);margin-top:.8rem">⚠ CDP negativo (Manual, punto 8): además se adjunta CDP negativo,
          justificación reforzada, respaldo fotográfico y pronunciamiento de la Unidad Jurídica.</p>
        <div class="exp-datos">
          <div><div class="d-k">CDP negativo</div>${s.cdp_negativo_url ? `<a href="${s.cdp_negativo_url}" target="_blank" rel="noopener">ver</a>` : "sin adjunto"}</div>
          <div><div class="d-k">Justificación reforzada</div>${s.just_reforzada_url ? `<a href="${s.just_reforzada_url}" target="_blank" rel="noopener">ver</a>` : "sin adjunto"}</div>
          <div><div class="d-k">Pronunciamiento Jurídica</div>${s.pronunciamiento_juridica_url ? `<a href="${s.pronunciamiento_juridica_url}" target="_blank" rel="noopener">ver</a>` : "sin adjunto"}</div>
          <div><div class="d-k">Respaldo fotográfico</div>${s.resp_fotografico_url ? `<a href="${s.resp_fotografico_url}" target="_blank" rel="noopener">ver</a>` : "sin adjunto"}</div>
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
}

async function guardarCotizacion(solicitudId) {
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
}

async function guardarDocumentacionEspecial(solicitudId) {
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
}

function hoyISO() { return new Date().toISOString().slice(0, 10); }

function recalcMontos(pref) {
  const neto = parseFloat(document.getElementById(pref + "-neto").value) || 0;
  document.getElementById(pref + "-iva").value = calcIva(neto);
  document.getElementById(pref + "-bruto").value = calcBruto(neto);
}

async function avanzarEstado(id, estado) {
  await sb.from("solicitud").update({ estado }).eq("id", id);
  vistaExpediente(id);
}

async function guardarGuia(solicitudId) {
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
}

async function guardarFactura(solicitudId) {
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
  const { error } = await sb.from("factura").insert({
    solicitud_id: solicitudId, numero, fecha,
    monto_neto, iva, monto_bruto,
    fecha_pago: document.getElementById("fc-pago").value || null,
    archivo_url: url,
    creado_por: perfilActual.id,
  });
  if (error) { errorEl.textContent = "No se pudo guardar: " + error.message; errorEl.classList.remove("oculto"); return; }

  await sb.from("solicitud").update({ estado: "facturada" }).eq("id", solicitudId);
  await descontarDelConvenio(solicitudId, numero, monto_bruto);
  vistaExpediente(solicitudId);
}

// Descuenta del saldo del convenio: registra la factura en `compra` con su
// monto bruto; el trigger trg_compra_movimiento crea el movimiento_saldo.
// Devuelve true si quedó descontada.
async function descontarDelConvenio(solicitudId, numero, monto_bruto) {
  const { data: contrato } = await sb.from("contrato").select("id, monto_tope_anual")
    .eq("estado", "vigente").order("creado_en", { ascending: false }).limit(1).maybeSingle();
  if (!contrato || !contrato.monto_tope_anual) {
    alert("No hay un contrato vigente con monto tope anual cargado — no se pudo descontar del convenio. Revísalo en 'Convenio / ferretería'.");
    return false;
  }
  const { error: errCompra } = await sb.from("compra").insert({
    contrato_id: contrato.id,
    solicitud_id: solicitudId,
    n_oc: "FACT " + numero,
    monto_total: monto_bruto,
    creado_por: perfilActual.id,
  });
  if (errCompra) {
    alert("No se pudo descontar del convenio: " + errCompra.message + "\nRevísalo en el Resumen.");
    return false;
  }
  return true;
}

async function reintentarDescuentoFactura(solicitudId, facturaId) {
  const { data: factura, error } = await sb.from("factura").select("numero, monto_bruto").eq("id", facturaId).single();
  if (error || !factura) { alert("No se pudo leer la factura: " + (error ? error.message : "no existe")); return; }
  const ok = await descontarDelConvenio(solicitudId, factura.numero, factura.monto_bruto);
  if (ok) alert("Listo, se descontó del convenio.");
  vistaExpediente(solicitudId);
}

// Borra del convenio lo que había quedado registrado por una factura (la
// fila de `compra` con n_oc = "FACT <numero>" y su(s) movimiento_saldo),
// y recalcula el saldo encadenado del contrato para que quede consistente.
async function revertirDescuentoFactura(solicitudId, numero) {
  const { data: compras } = await sb.from("compra").select("id, contrato_id")
    .eq("solicitud_id", solicitudId).eq("n_oc", "FACT " + numero);
  if (!compras || !compras.length) return;

  const compraIds = compras.map(c => c.id);
  const contratoIds = [...new Set(compras.map(c => c.contrato_id))];

  const { error: errMov } = await sb.from("movimiento_saldo").delete().in("compra_id", compraIds);
  if (errMov) alert("No se pudo borrar el movimiento anterior del convenio: " + errMov.message);

  const { error: errComp } = await sb.from("compra").delete().in("id", compraIds);
  if (errComp) alert("No se pudo borrar el registro de compra anterior: " + errComp.message);

  for (const cid of contratoIds) await recalcularSaldoContrato(cid);
}

// Recorre los movimientos de un contrato en orden y recalcula saldo_resultante
// en cadena (por si se borró/editó uno que no era el último).
async function recalcularSaldoContrato(contratoId) {
  const { data: movs } = await sb.from("movimiento_saldo").select("id, tipo, monto")
    .eq("contrato_id", contratoId).order("fecha", { ascending: true });
  if (!movs || !movs.length) return;
  let saldo = 0;
  for (const m of movs) {
    saldo = m.tipo === "apertura" ? Number(m.monto) : saldo + Number(m.monto);
    await sb.from("movimiento_saldo").update({ saldo_resultante: saldo }).eq("id", m.id);
  }
}

// ---------- Editar / eliminar factura (correcciones de digitación) ----------
function editarFactura(facturaId, solicitudId) { editarFacturaId = facturaId; vistaExpediente(solicitudId); }
function cancelarEdicionFactura(solicitudId) { editarFacturaId = null; vistaExpediente(solicitudId); }

async function actualizarFactura(solicitudId, facturaId) {
  const errorEl = document.getElementById("fc-error");
  errorEl.classList.add("oculto");
  const numero = document.getElementById("fc-num").value.trim();
  const fecha = document.getElementById("fc-fecha").value || null;
  const monto_neto = parseFloat(document.getElementById("fc-neto").value) || 0;
  if (!numero || !fecha || !monto_neto) { errorEl.textContent = "N° de factura, fecha y monto neto son obligatorios."; errorEl.classList.remove("oculto"); return; }

  const { data: facturaAnterior } = await sb.from("factura").select("numero").eq("id", facturaId).single();

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

  const { error } = await sb.from("factura").update(payload).eq("id", facturaId);
  if (error) { errorEl.textContent = "No se pudo guardar: " + error.message; errorEl.classList.remove("oculto"); return; }

  // Borra el descuento viejo del convenio (con el N° anterior) y carga el nuevo
  // monto — así no queda el valor viejo sumado junto con el nuevo.
  if (facturaAnterior) await revertirDescuentoFactura(solicitudId, facturaAnterior.numero);
  await descontarDelConvenio(solicitudId, numero, payload.monto_bruto);

  editarFacturaId = null;
  vistaExpediente(solicitudId);
}

// Solo admin: elimina la factura y revierte por completo su efecto en el
// convenio (borra la fila de `compra` y el `movimiento_saldo` que generó).
async function eliminarFactura(solicitudId, facturaId, numero) {
  if (!confirm("¿Eliminar esta factura? También se borrará su descuento del convenio. Esta acción no se puede deshacer.")) return;

  await revertirDescuentoFactura(solicitudId, numero);

  const { error } = await sb.from("factura").delete().eq("id", facturaId);
  if (error) { alert("No se pudo eliminar la factura: " + error.message); return; }

  const { data: guiasRestantes } = await sb.from("guia_despacho").select("id").eq("solicitud_id", solicitudId);
  await sb.from("solicitud").update({ estado: (guiasRestantes && guiasRestantes.length) ? "recibida" : "aprobada" }).eq("id", solicitudId);

  vistaExpediente(solicitudId);
}

// Solo admin: elimina una guía de despacho mal cargada.
async function eliminarGuia(id, solicitudId) {
  if (!confirm("¿Eliminar esta guía de despacho?")) return;
  const { error } = await sb.from("guia_despacho").delete().eq("id", id);
  if (error) { alert("No se pudo eliminar: " + error.message); return; }
  vistaExpediente(solicitudId);
}

// ---------- Notas de crédito (corrigen una factura ya emitida) ----------
function bloqueNotasCredito(s, factura, notas, opero) {
  const totalNC = (notas || []).reduce((a, n) => a + Number(n.monto_bruto || 0), 0);
  return `
    <div class="card">
      <div class="exp-seccion"><h4>Notas de crédito</h4><span class="hint">${(notas || []).length} registrada(s)</span></div>
      <p class="hint">Regístralas cuando el proveedor emite una nota de crédito que corrige o anula parte de la factura (no se edita la factura original).</p>
      ${(notas || []).length ? `
        <table>
          <tr><th>N°</th><th>Fecha</th><th>Motivo</th><th class="num">Neto</th><th class="num">IVA</th><th class="num">Bruto</th><th>Adjunto</th><th></th></tr>
          ${notas.map(n => `<tr>
            <td>${n.numero || ""}</td>
            <td>${n.fecha || ""}</td>
            <td>${n.motivo || ""}</td>
            <td class="num">${money(n.monto_neto)}</td>
            <td class="num">${money(n.iva)}</td>
            <td class="num">${money(n.monto_bruto)}</td>
            <td>${n.archivo_url ? `<a href="${n.archivo_url}" target="_blank" rel="noopener">ver</a>` : "—"}</td>
            <td>${esAdminTotal() ? `<button class="secundario" onclick="eliminarNotaCredito('${n.id}','${s.id}')">Eliminar</button>` : ""}</td>
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
}

async function eliminarNotaCredito(id, solicitudId) {
  if (!confirm("¿Eliminar esta nota de crédito?")) return;
  const { error } = await sb.from("nota_credito").delete().eq("id", id);
  if (error) { alert("No se pudo eliminar: " + error.message); return; }
  vistaExpediente(solicitudId);
}

// ---------- Hoja de solicitud (PDF, estilo cotización) ----------
function descargarHojaPDF() {
  const exp = window._expActual;
  if (!exp) return;
  if (!window.jspdf || !window.jspdf.jsPDF) { alert("No se pudo cargar el generador de PDF. Revisa la conexión."); return; }
  const { s, detalle } = exp;
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" });
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
  doc.text(`${especial ? "SOLICITUD DE COTIZACIÓN" : "SOLICITUD DE MATERIALES"}${s.n_solicitud ? "  N° " + s.n_solicitud : ""}`, M, y);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);

  y += 9;
  const fila = (k, v) => { doc.setFont("helvetica", "bold"); doc.text(k, M, y); doc.setFont("helvetica", "normal"); const lns = doc.splitTextToSize(String(v || "—"), 130); doc.text(lns, M + 46, y); y += 6 + (lns.length - 1) * 4.5; };
  fila("Correlativo:", s.correlativo || (s.n_solicitud ? "N° " + s.n_solicitud : ""));
  fila("Fecha:", s.fecha_solicitud || hoyISO());
  fila("Unidad solicitante:", exp.s.unidad?.nombre || "");
  fila("Responsable:", s.solicitante || "");
  fila("Contacto:", s.contacto || "");
  fila("Supervisa ejecución:", s.supervisor || "");
  fila("Ubicación de uso:", s.ubicacion || "");
  y += 2;
  fila("Descripción:", s.descripcion_requerimiento || "");
  fila("Fundamento / motivo:", s.motivo || "");
  fila("Situación actual:", s.situacion_actual || "");
  fila("Trabajo a ejecutar:", s.trabajo_ejecutar || "");
  fila("Beneficio público:", s.beneficio_publico || "");

  y += 4;
  if (y > 250) { doc.addPage(); y = M; }
  doc.setFont("helvetica", "bold");
  doc.text("MATERIALES SOLICITADOS", M, y); y += 3;
  doc.setDrawColor(180); doc.line(M, y, 210 - M, y); y += 6;

  doc.text("N°", M, y);
  doc.text("Material", M + 12, y);
  doc.text("Cant.", 120, y);
  doc.text("Unidad", 140, y);
  doc.text("Valor ref. $", 168, y);
  doc.setFont("helvetica", "normal");
  y += 2; doc.line(M, y, 210 - M, y); y += 6;

  (detalle || []).forEach((d, i) => {
    if (y > 265) { doc.addPage(); y = M; }
    doc.text(String(i + 1), M, y);
    doc.text(doc.splitTextToSize(String(d.articulo?.descripcion || d.descripcion_libre || ""), 100), M + 12, y);
    doc.text(String(d.cantidad_solicitada ?? ""), 120, y);
    doc.text(String(d.unidad_medida_libre || d.articulo?.unidad_medida || ""), 140, y);
    doc.text(d.valor_referencial ? Number(d.valor_referencial).toLocaleString("es-CL") : "", 168, y);
    y += 7;
  });
  doc.line(M, y - 3, 210 - M, y - 3);
  doc.setFont("helvetica", "bold");
  doc.text("MONTO TOTAL ESTIMADO", M + 12, y);
  doc.text("$ " + Number(s.monto_estimado || 0).toLocaleString("es-CL"), 168, y);
  doc.setFont("helvetica", "normal");
  y += 8;

  y += 10;
  doc.line(M, y, 90, y); y += 5;
  doc.text("Encargado de Operaciones (ITO)", M, y);
  y += 16;
  doc.line(M, y, 90, y); y += 5;
  doc.text("V°B° Director de Obras", M, y);

  doc.setFontSize(8); doc.setTextColor(120);
  doc.text("Documento generado por Control Ferretería — Municipalidad de Doñihue", M, 288);

  const nombre = `solicitud-${s.n_solicitud || s.id.slice(0, 8)}.pdf`;
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

    ${(contratos || []).length > 1 ? `
      <div class="card">
        <h4 style="margin-top:0">Convenios anteriores</h4>
        <table>
          <tr><th>Proveedor</th><th>N° lic.</th><th class="num">Tope</th><th>Vigencia</th><th>Estado</th></tr>
          ${contratos.slice(1).map(x => `<tr>
            <td>${x.proveedor || ""}</td>
            <td>${x.n_licitacion || ""}</td>
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
}

// ---------------------------------------------------------------------
// Catálogo (solo admin): alta y edición de artículos de la tabla `articulo`.
// ---------------------------------------------------------------------
async function vistaCatalogo() {
  vista().innerHTML = "<div class='card'>Cargando…</div>";

  const { data: articulos, error } = await sb
    .from("articulo")
    .select("id, descripcion, unidad_medida")
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
        <thead><tr><th>Descripción</th><th>U. medida</th><th></th></tr></thead>
        <tbody>
          ${(articulos || []).map(a => `
            <tr data-id="${a.id}">
              <td><input class="ca-r-desc" value="${(a.descripcion || "").replace(/"/g, "&quot;")}"></td>
              <td><input class="ca-r-um" value="${(a.unidad_medida || "").replace(/"/g, "&quot;")}"></td>
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
      const { error: errUpd } = await sb.from("articulo").update({ descripcion, unidad_medida }).eq("id", id);
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
    (unidades || []).map(u => `<option value="${u.id}" ${u.id === sel ? "selected" : ""}>${u.nombre}</option>`).join("");

  vista().innerHTML = `
    <div class="card">
      <h3 style="margin-top:0">Usuarios y permisos</h3>
      <p class="hint">El rol define qué pestañas ve cada persona. La unidad es obligatoria
        para quienes crean solicitudes (rol Solicitante). Los cambios se guardan en la
        tabla <code>perfiles</code> de la base de datos.</p>
      <table>
        <thead><tr><th>Nombre</th><th>Rol</th><th>Unidad</th><th>Clave</th><th></th></tr></thead>
        <tbody>
          ${(perfiles || []).map(p => `
            <tr data-id="${p.id}">
              <td>${p.nombre || "(sin nombre)"}${p.id === perfilActual.id ? " <span class='hint'>(tú)</span>" : ""}</td>
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
      const errorEl = document.getElementById("us-error");
      const okEl = document.getElementById("us-ok");
      errorEl.classList.add("oculto");
      okEl.classList.add("oculto");
      btn.disabled = true;

      const { error: errUpd } = await sb.from("perfiles").update({ rol, unidad_id }).eq("id", id);
      btn.disabled = false;

      if (errUpd) {
        errorEl.textContent = "No se pudo guardar: " + errUpd.message;
        errorEl.classList.remove("oculto");
        return;
      }
      okEl.textContent = "Guardado.";
      okEl.classList.remove("oculto");
      if (id === perfilActual.id) { perfilActual.rol = rol; perfilActual.unidad_id = unidad_id; armarTabs(); }
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
