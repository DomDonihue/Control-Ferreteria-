# Control Ferretería — Resumen del sistema y manual de uso

Plataforma web de la Dirección de Obras Municipales de Doñihue para pedir, aprobar y controlar los materiales del contrato de suministro de ferretería (marco disponible $60.000.000).
Dirección: https://domdonihue.github.io/Control-Ferreteria-/

---

## 1. Qué hace el sistema

Cada pedido de materiales es una **solicitud** con su **expediente**. El expediente reúne todo el respaldo en un solo lugar:

solicitud → aprobación → hoja de solicitud (PDF) → guías de despacho → factura → cierre

Además:
- Lleva el **consumo del convenio**: tope, comprometido y saldo disponible.
- Numera las solicitudes solas (SM-2026-001 para materiales, OP-2026-001 para las de la Dirección de Obras).
- Avisa con una campana (y por correo) a quien tiene algo pendiente.
- Deja una **bitácora inmutable**: nada se borra, se anula con motivo.
- Solo se pueden pedir productos del **catálogo del contrato** (con buscador).

## 2. Quién ve qué

| Rol | Para quién | Menús que ve |
|---|---|---|
| Administrador | Administración de la plataforma | Todos |
| Encargado de Operaciones (ITO) | Revisa y tramita con la empresa | Inicio, Solicitud Obras, Solicitar cotización, Solicitudes, Expedientes, Catálogo |
| Solicitante Dirección de Obras | Personal de Operaciones, Aseo y Ornato, Edificios | Inicio, Solicitud Obras, Solicitudes |
| Solicitante | Otras direcciones (Dideco, etc.) | Inicio, Nueva solicitud, Solicitudes |
| Director de Obras | Aprueba | Inicio, Solicitudes, Expedientes, Bitácora |
| DAF | Control de pagos | Inicio, Expedientes, Bitácora |
| Alcalde | Solo mira | Inicio |

Todos tienen **Cambiar clave**. Una cuenta nueva queda "pendiente" hasta que el Administrador le asigne rol y unidad.

## 3. Cómo viaja una solicitud

### A. Otras direcciones (formulario normal)
1. El solicitante ingresa la solicitud → **pendiente**.
2. El **Director** la **aprueba** o **rechaza** (con motivo).
3. Aprobada, el **ITO** descarga la hoja PDF y la envía a la empresa → **enviada**.
4. Llega el material: el ITO registra la(s) **guía(s) de despacho** → **recibida**.
5. El ITO registra la **factura**, que se descuenta del convenio → **facturada**.
6. El ITO **cierra el expediente** → **cerrada**.

### B. Dirección de Obras (Solicitud Obras)
1. El usuario de Obras ingresa la solicitud → **pendiente**.
2. El **ITO** la revisa y da su **V°B°** (→ **visada**) o la rechaza con motivo.
3. El **Director** aprueba o rechaza.
4. Desde ahí sigue igual que A (enviada, recibida, facturada, cerrada).

Si la crea el propio ITO, entra directo como **visada**.
El Director no puede aprobar una solicitud de Obras que el ITO no visó.

### C. Producto fuera de catálogo (especial)
Se marca "fuera de catálogo" en el formulario normal. Requiere las justificaciones de la Unidad Jurídica y de la DAF (Manual, punto 10) y en el expediente se registran las cotizaciones, el decreto y la orden de compra. *(Esta vía está en revisión; ver pendientes al final.)*

## 4. Manual paso a paso

### Solicitante de otra dirección — "Nueva solicitud"
1. Si tienes el Formulario Único en PDF editable, cárgalo y se autocompleta (los materiales no).
2. Completa unidad, responsable, ubicación, descripción y fundamento.
3. **Materiales:** escribe en el buscador y elige el producto de la lista; indica la cantidad y pulsa **+ Agregar**. Solo se aceptan productos del catálogo.
4. Marca los respaldos que tengas (fotos, informe técnico, presupuesto) y adjunta los archivos.
5. Pulsa **Ingresar solicitud**. Sigue su estado en **Solicitudes**.

### Usuario de la Dirección de Obras — "Solicitud Obras"
1. La **Dirección responsable** viene fija; elige la **Unidad** (Operaciones, Aseo y Ornato o Edificios).
2. Indica responsable, ubicación de uso y motivo.
3. Agrega los materiales con el buscador y pulsa **Ingresar solicitud**.
4. Si el ITO la rechaza, verás el **motivo** en Solicitudes.

### ITO — revisar y tramitar
- **Revisar:** en **Solicitudes**, las de Obras en *pendiente* tienen **Ver**, **Dar V°B°** y **Rechazar** (el rechazo pide motivo).
- **Expedientes → Abrir** una solicitud aprobada:
  - **Descargar hoja de solicitud (PDF)** y enviarla a la empresa → **Marcar como enviada**. La hoja trae cada producto con su marca, cantidad, **valor unitario neto** y subtotal, y al final el **total neto, IVA y total estimado** según el listado de precios del contrato (Formulario N°5). El valor final se verifica con la guía de despacho y la factura.
  - Al llegar el material: **Registrar guía de despacho** (N°, fechas, neto, IVA, bruto, adjunto). Puede haber varias → **Marcar material recibido**.
  - **Registrar factura** (N°, fecha, montos, fecha de pago, adjunto). Se descuenta del convenio.
  - **Nota de crédito** si corresponde y **Cerrar expediente**.
  - Un documento mal ingresado no se borra: se **anula** con motivo y el convenio se revierte solo.
- **Solicitar cotización:** genera un PDF para pedir precio de productos que no están en el catálogo (no se guarda en el sistema).
- **Catálogo:** agregar y editar artículos. Cada producto muestra su N° del listado, marca y **precio neto** del contrato; el precio solo lo modifica el Administrador.

### Director de Obras
- **Solicitudes:** verás **Aprobar** y **Rechazar** en las pendientes de otras direcciones y en las **visadas** de Obras. Usa **Ver** para revisar el detalle antes. El rechazo exige motivo.
- **Bitácora:** consulta quién hizo qué y cuándo.

### DAF y Alcalde
- DAF: consulta **Expedientes** y **Bitácora**. Alcalde: **Inicio**.

### Administrador
- **Usuarios:** asigna rol y unidad a cada persona.
- **Convenio / ferretería:** registra el convenio vigente (proveedor, tope).
- **Catálogo:** mantiene el listado de productos.

## 5. Pantalla Inicio
Tope anual, comprometido, saldo disponible y % usado; consumo por unidad (haz clic en una barra para ver sus expedientes) y solicitudes por mes.

## 6. Avisos
- La **campana** del encabezado cuenta lo pendiente: el ITO ve las de Obras por revisar y las aprobadas por tramitar; el Director ve las que esperan su V°B°.
- Los **correos** se envían cuando está configurado (ver `notificaciones-email-setup.md`).

## 7. Bitácora
Registra el ingreso y cada cambio de estado de la solicitud (con el motivo del rechazo), y la creación, edición y anulación de guías, facturas y notas de crédito, más los reversos del convenio. La ven Administrador, Director y DAF. No se puede editar ni borrar.

## 8. Reglas a recordar
- Solo productos del catálogo del contrato; lo demás va como "fuera de catálogo".
- Nada se borra: se anula con motivo.
- El ITO registra montos y documentos; el Director solo aprueba.
- La hoja PDF se habilita solo cuando la solicitud está aprobada.

## 9. Problemas frecuentes
- **"Cuenta pendiente":** pide al Administrador que te asigne rol y unidad.
- **No encuentro un producto:** no está en el catálogo; usa "fuera de catálogo" o consulta al ITO.
- **La bitácora aparece vacía:** solo registra desde que se activó; se llena al ingresar solicitudes o documentos.
- **Un botón no hace nada o da error:** actualiza la página (Ctrl+F5) y revisa que el Administrador haya aplicado las últimas actualizaciones de la base de datos.

## Pendientes de definición
- Regla para productos fuera de catálogo (cotización, precio de referencia de mercado y tope del 10%): falta confirmar con las Bases Administrativas.
- Facturas que agrupen guías de varias solicitudes: hoy es una factura por solicitud.
