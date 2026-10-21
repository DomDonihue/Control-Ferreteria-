// Genera "Formulario-Cotizacion-Obras.pdf": PDF editable (campos rellenables) con solo lo
// necesario para pedir una cotización desde la Dirección de Obras. La app lo lee en
// Cotización Obras -> Nueva solicitud de cotización (extraerFormularioPDF en app.js).
//
// Campos: unidad_interna (lista), responsable, ubicacion, motivo,
//         producto_N, cantidad_N, unidad_N  (N = 1 a 15)
//
// Uso (desde esta carpeta):   npm i pdf-lib   y luego   node _generar_formulario_cotizacion.js
const fs = require("fs");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

const FILAS = 15;
const UNIDADES = ["Operaciones", "Aseo y Ornato", "Edificios"];
const LUGAR = "Avenida Estación 344, Doñihue";

(async () => {
  const doc = await PDFDocument.create();
  doc.setTitle("Formulario de cotización — Dirección de Obras");
  const page = doc.addPage([595.28, 841.89]);
  const fuente = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const cursiva = await doc.embedFont(StandardFonts.HelveticaOblique);
  const form = doc.getForm();

  const M = 40, W = 595.28 - 2 * M;
  const azul = rgb(0.11, 0.21, 0.41), dorado = rgb(0.72, 0.5, 0.1), gris = rgb(0.36, 0.42, 0.52), tinta = rgb(0.09, 0.14, 0.23);
  const relleno = rgb(0.8, 0.84, 1), borde = rgb(0.62, 0.65, 0.74);

  const texto = (t, x, y, o = {}) => page.drawText(t, { x, y, size: o.size || 9, font: o.font || fuente, color: o.color || tinta, maxWidth: o.maxWidth, lineHeight: o.lineHeight });
  const linea = (y) => page.drawLine({ start: { x: M, y }, end: { x: M + W, y }, thickness: 1.2, color: azul });
  const estilo = (x, y, w, h) => ({ x, y, width: w, height: h, backgroundColor: relleno, borderColor: borde, borderWidth: 0.8, textColor: tinta, font: fuente });
  const campo = (nombre, x, y, w, h, multi = false) => {
    const f = form.createTextField(nombre);
    if (multi) f.enableMultiline();
    f.addToPage(page, estilo(x, y, w, h));
    f.setFontSize(multi ? 9 : 0);
    return f;
  };

  // Encabezado
  texto("SOLICITUD DE COTIZACIÓN", M, 800, { size: 20, font: negrita, color: azul });
  texto("Dirección de Obras Municipales — productos fuera del catálogo del contrato", M, 782, { size: 10, font: cursiva, color: dorado });
  texto("Complete los campos y suba este PDF en Control Ferretería (Cotización Obras): el sistema toma de aquí la unidad, el responsable, la ubicación y los productos con su cantidad y unidad de medida.",
    M, 762, { size: 8.5, color: gris, maxWidth: W, lineHeight: 11 });
  linea(738);

  // 1. Identificación
  texto("1. Identificación", M, 720, { size: 13, font: negrita, color: azul });
  const mitad = W / 2 - 8;
  texto("Unidad", M, 702, { size: 8, font: negrita });
  texto("Responsable del requerimiento", M + W / 2 + 8, 702, { size: 8, font: negrita });
  const lista = form.createDropdown("unidad_interna");
  lista.addOptions(UNIDADES);
  lista.addToPage(page, estilo(M, 678, mitad, 20));
  lista.setFontSize(10);
  campo("responsable", M + W / 2 + 8, 678, mitad, 20);
  texto("Ubicación de uso de los materiales", M, 662, { size: 8, font: negrita });
  campo("ubicacion", M, 638, W, 20);
  texto("Motivo / para qué se necesitan", M, 622, { size: 8, font: negrita });
  campo("motivo", M, 584, W, 34, true);
  texto("Lugar de entrega:", M, 566, { size: 9, font: negrita });
  texto(LUGAR, M + 85, 566, { size: 9 });
  linea(550);

  // 2. Productos
  texto("2. Productos a cotizar", M, 532, { size: 13, font: negrita, color: azul });
  const xProd = M + 34, wProd = 300, wCant = 66, xCant = xProd + wProd + 4, xUni = xCant + wCant + 4, wUni = M + W - xUni;
  texto("N°", M + 6, 514, { size: 8, font: negrita });
  texto("Producto (con sus especificaciones)", xProd, 514, { size: 8, font: negrita });
  texto("Cantidad", xCant, 514, { size: 8, font: negrita });
  texto("Unidad de medida", xUni, 514, { size: 8, font: negrita });
  for (let i = 0; i < FILAS; i++) {
    const y = 488 - i * 26;
    texto(String(i + 1), M + 8, y + 7, { size: 9, color: gris });
    campo(`producto_${i + 1}`, xProd, y, wProd, 22);
    campo(`cantidad_${i + 1}`, xCant, y, wCant, 22);
    campo(`unidad_${i + 1}`, xUni, y, wUni, 22);
  }

  page.drawLine({ start: { x: M, y: 70 }, end: { x: M + W, y: 70 }, thickness: 0.6, color: borde });
  texto("Formulario de cotización · Dirección de Obras Municipales · Municipalidad de Doñihue", M, 56, { size: 8, color: gris });

  form.updateFieldAppearances(fuente);
  fs.writeFileSync("Formulario-Cotizacion-Obras.pdf", await doc.save());
  console.log("Generado Formulario-Cotizacion-Obras.pdf con", form.getFields().length, "campos");
})();
