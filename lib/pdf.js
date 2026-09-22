/* Informe semanal de pendientes en PDF.
   Se arma con pdf-lib (JavaScript puro, sin navegador headless) para que
   funcione en una función serverless de Vercel sin binarios extra. */

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { LOGO_PNG_B64 } from "./logo.js";
import { partirResp, refDe } from "./comun.js";
import { calcular, situacion, diasParaVencer, diasAbierto, fmtDia } from "./informe.js";

const A4 = [595.28, 841.89];
const M = 42;                       // margen (15 mm)
const ANCHO = A4[0] - M * 2;
const NEGRO = rgb(0, 0, 0);
const GRIS = rgb(0.93, 0.93, 0.93);
const LINEA = rgb(0, 0, 0);

/* Las fuentes estándar del PDF usan WinAnsi: cubre castellano, comillas y
   guiones largos. Cualquier otra cosa (emoji, símbolos raros) se reemplaza
   para que nunca reviente la generación por un carácter suelto. */
const WIN_EXTRA = new Set([0x20ac, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021, 0x02c6, 0x2030,
  0x0160, 0x2039, 0x0152, 0x017d, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0x017e, 0x0178]);
function limpio(v) {
  let s = String(v ?? "").replace(/\s+/g, " ").trim();
  let out = "";
  for (const ch of s) {
    const c = ch.codePointAt(0);
    out += c < 256 || WIN_EXTRA.has(c) ? ch : "";
  }
  return out;
}

class Hoja {
  constructor(doc, fuentes, logo, meta) {
    this.doc = doc;
    this.f = fuentes.normal;
    this.b = fuentes.negrita;
    this.logo = logo;
    this.meta = meta;
    this.pagina = null;
    this.paginas = [];
    this.y = 0;
    this.nueva();
  }

  nueva() {
    this.pagina = this.doc.addPage(A4);
    this.paginas.push(this.pagina);
    this.y = A4[1] - M;
    this.cabecera();
  }

  /* Deja lugar para `alto`; si no entra, pasa de página. */
  sitio(alto) {
    if (this.y - alto < M + 26) this.nueva();
  }

  texto(t, x, y, { size = 8.5, bold = false, color = NEGRO } = {}) {
    this.pagina.drawText(limpio(t), { x, y, size, font: bold ? this.b : this.f, color });
  }

  ancho(t, size = 8.5, bold = false) {
    return (bold ? this.b : this.f).widthOfTextAtSize(limpio(t), size);
  }

  caja(x, y, w, h, relleno) {
    if (relleno) this.pagina.drawRectangle({ x, y, width: w, height: h, color: relleno });
    this.pagina.drawRectangle({ x, y, width: w, height: h, borderColor: LINEA, borderWidth: 0.6 });
  }

  /* Corta un texto en líneas que entren en `w`. */
  cortar(t, w, size = 8.5, bold = false) {
    const palabras = limpio(t).split(" ").filter(Boolean);
    if (palabras.length === 0) return [""];
    const out = [];
    let linea = "";
    for (const p of palabras) {
      const prueba = linea ? linea + " " + p : p;
      if (this.ancho(prueba, size, bold) <= w) linea = prueba;
      else {
        if (linea) out.push(linea);
        linea = p;
        while (this.ancho(linea, size, bold) > w) {           // palabra sola más ancha que la celda
          let corte = linea.length - 1;
          while (corte > 1 && this.ancho(linea.slice(0, corte), size, bold) > w) corte--;
          out.push(linea.slice(0, corte));
          linea = linea.slice(corte);
        }
      }
    }
    if (linea) out.push(linea);
    return out;
  }

  cabecera() {
    const alto = 56;
    const y = this.y - alto;
    const izq = ANCHO * 0.5;
    this.caja(M, y, izq, alto);
    const esc = this.logo.scale(86 / this.logo.width);
    this.pagina.drawImage(this.logo, { x: M + 9, y: y + alto - 8 - esc.height, width: esc.width, height: esc.height });
    this.texto("INFORME SEMANAL DE PENDIENTES", M + 9, y + 17, { size: 10, bold: true });
    this.texto("Proyecto NCH1 · Cadlan · BMS y controles", M + 9, y + 6.5, { size: 7.5 });

    const filas = [
      ["Semana", this.meta.semana],
      ["Fecha de corte", this.meta.corte],
      ["Preparó", this.meta.autor],
    ];
    const hf = alto / 3;
    const wk = 74;
    filas.forEach(([k, v], i) => {
      const fy = y + alto - hf * (i + 1);
      this.caja(M + izq, fy, wk, hf, GRIS);
      this.caja(M + izq + wk, fy, ANCHO - izq - wk, hf);
      this.texto(k, M + izq + 5, fy + hf / 2 - 3, { size: 7.5, bold: true });
      this.texto(v, M + izq + wk + 5, fy + hf / 2 - 3, { size: 8 });
    });
    this.y = y - 14;
  }

  titulo(t) {
    this.sitio(24);
    this.texto(t.toUpperCase(), M, this.y - 9, { size: 9, bold: true });
    this.y -= 15;
  }

  parrafo(t, { size = 8.5 } = {}) {
    const lineas = this.cortar(t, ANCHO, size);
    this.sitio(lineas.length * (size + 3) + 4);
    for (const l of lineas) {
      this.texto(l, M, this.y - size, { size });
      this.y -= size + 3;
    }
    this.y -= 4;
  }

  /* cols: [{ w, align, bold, wrap }] con w en proporción del ancho total. */
  tabla({ cols, head, rows, size = 8.5, x = M, ancho = ANCHO }) {
    const total = cols.reduce((s, c) => s + c.w, 0);
    const anchos = cols.map((c) => (c.w / total) * ancho);
    const pad = 4;

    const dibujarFila = (celdas, { fondo, negrita } = {}) => {
      const partes = celdas.map((c, i) =>
        cols[i].wrap === false ? [limpio(c)] : this.cortar(c, anchos[i] - pad * 2, size, negrita || cols[i].bold)
      );
      const alto = Math.max(...partes.map((p) => p.length)) * (size + 2.6) + 5;
      this.sitio(alto);
      const y = this.y - alto;
      let cx = x;
      partes.forEach((p, i) => {
        this.caja(cx, y, anchos[i], alto, fondo);
        p.forEach((l, j) => {
          const bold = negrita || cols[i].bold;
          const w = this.ancho(l, size, bold);
          const tx =
            cols[i].align === "c" ? cx + anchos[i] / 2 - w / 2 :
            cols[i].align === "r" ? cx + anchos[i] - pad - w : cx + pad;
          this.texto(l, tx, y + alto - 4 - size - j * (size + 2.6), { size, bold });
        });
        cx += anchos[i];
      });
      this.y = y;
    };

    if (head) dibujarFila(head, { fondo: GRIS, negrita: true });
    for (const r of rows) dibujarFila(r);
    this.y -= 8;
  }

  nota(t) {
    const size = 7.5;
    const lineas = this.cortar(t, ANCHO, size);
    this.sitio(lineas.length * (size + 2.4) + 6);
    this.y -= 2;
    for (const l of lineas) {
      this.texto(l, M, this.y - size, { size });
      this.y -= size + 2.4;
    }
    this.y -= 6;
  }

  pies() {
    this.paginas.forEach((p, i) => {
      p.drawLine({ start: { x: M, y: M + 16 }, end: { x: M + ANCHO, y: M + 16 }, thickness: 0.6, color: LINEA });
      p.drawText(limpio(`NCH1 Cadlan, informe semanal de pendientes, ${this.meta.semana}`),
        { x: M, y: M + 6, size: 7, font: this.f });
      const t = `Página ${i + 1} de ${this.paginas.length}`;
      p.drawText(t, { x: M + ANCHO - this.f.widthOfTextAtSize(t, 7), y: M + 6, size: 7, font: this.f });
    });
  }
}

const resp = (t) => partirResp(t.resp).join(" / ") || "sin asignar";
const corta = (s, n) => (limpio(s).length > n ? limpio(s).slice(0, n - 1) + "..." : limpio(s));

export async function generarInforme({ tareas, bloqueos, dias = 7, resumen = "", decisiones = [], autor = "" }) {
  const inf = calcular(tareas, bloqueos, { dias });
  const doc = await PDFDocument.create();
  const normal = await doc.embedFont(StandardFonts.Helvetica);
  const negrita = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await doc.embedPng(Buffer.from(LOGO_PNG_B64, "base64"));

  doc.setTitle("NCH1 Cadlan - Informe semanal de pendientes");
  doc.setAuthor(autor || "CadLan");
  doc.setSubject("Seguimiento de pendientes BMS del proyecto NCH1");

  const h = new Hoja(doc, { normal, negrita }, logo, {
    semana: `${fmtDia(inf.periodo.desde)} al ${fmtDia(inf.periodo.hasta)}/${inf.periodo.hasta.slice(0, 4)}`,
    corte: fmtDia(inf.hoy) + "/" + inf.hoy.slice(0, 4),
    autor: autor || "-",
  });
  const t = inf.titular;
  /* El informe se pide casi siempre a 7 días, y ahí «en la semana» se lee
     mejor que «en el período». Si alguien lo pide a otro plazo, el rótulo lo
     dice, para que nadie lea una semana donde hay quince días. */
  const cuando = inf.periodo.dias === 7 ? "en la semana" : `en los últimos ${inf.periodo.dias} días`;
  let n = 0;
  const sec = (txt) => h.titulo(`${++n}. ${txt}`);

  /* 1. Resumen */
  sec("Resumen");
  h.tabla({
    cols: [{ w: 30 }, { w: 9, align: "c" }, { w: 10, align: "c" }, { w: 10, align: "c" }, { w: 41 }],
    head: ["Indicador", "Total", "Internos", "Externos", "Observación"],
    rows: [
      ["Pendientes abiertos", t.abiertos_total, t.abiertos_internos, t.abiertos_externos,
        `${t.pendiente} sin empezar, ${t.curso} en curso${t.probar ? ", " + t.probar + " a probar" : ""}`],
      [`Cerrados ${cuando}`, t.cerrados_en_periodo, t.cerrados_internos, t.cerrados_externos,
        t.cerrados_en_periodo ? "Ver punto 2" : "Sin cierres registrados"],
      [`Altas ${cuando}`, t.altas_en_periodo, t.altas_internas, t.altas_externas,
        t.altas_en_periodo ? "Ver punto 7" : "-"],
      ["Urgencia 1 sin cerrar", t.urgencia1_sin_cerrar, t.urgencia1_internos, t.urgencia1_externos,
        inf.urgencia1.slice(0, 5).map(refDe).join(", ") || "-"],
      ["Bloqueados por otro pendiente", t.bloqueadas, "", "",
        t.bloqueadas ? `${t.bloqueadas_por_externo} con bloqueo externo, ver punto 4` : "Ninguno"],
      ["Fuera de fecha", t.vencidas, "", "",
        inf.vencidas.slice(0, 4).map((x) => refDe(x)).join(", ") || "Ninguno"],
    ].map((r) => r.map(String)),
  });
  h.parrafo(resumen || situacion(inf));

  /* 2. Cerrados */
  sec(`Cerrados ${cuando}`);
  if (inf.cerrados.length === 0) h.nota(`No hay cierres registrados ${cuando}.`);
  else h.tabla({
    cols: [{ w: 7, bold: true }, { w: 58 }, { w: 23 }, { w: 12, align: "c" }],
    head: ["Ref", "Descripción", "Responsable", "Cierre"],
    rows: inf.cerrados.map((x) => [refDe(x), x.desc, resp(x), fmtDia(x.resuelto_at)]),
  });

  /* 3. Plazos */
  sec("Plazos");
  const plazos = [...inf.vencidas, ...inf.vencen7];
  if (plazos.length === 0) h.nota("Nada vencido ni por vencer en los próximos siete días.");
  else h.tabla({
    cols: [{ w: 7, bold: true }, { w: 53 }, { w: 22 }, { w: 18, align: "c" }],
    head: ["Ref", "Descripción", "Responsable", "Fecha límite"],
    rows: plazos.map((x) => {
      const d = diasParaVencer(x.vence, inf.hoy);
      return [refDe(x), x.desc, resp(x), `${fmtDia(x.vence)} ${d < 0 ? "vencido" : d === 0 ? "vence hoy" : "en " + d + " d"}`];
    }),
  });
  h.nota(`De los ${t.abiertos_total} abiertos, ${t.sin_fecha_limite} no tienen fecha límite cargada.`);

  /* 4. Bloqueos */
  sec("Bloqueos entre pendientes");
  if (inf.bloqueadas.length === 0) h.nota("Ningún pendiente está esperando por otro.");
  else {
    h.tabla({
      cols: [{ w: 7, bold: true }, { w: 30 }, { w: 16 }, { w: 33 }, { w: 14, align: "c" }],
      head: ["Ref", "Pendiente bloqueado", "Responsable", "Espera por", "Tipo"],
      rows: inf.bloqueadas.map((b) => [
        refDe(b.tarea),
        b.tarea.desc,
        resp(b.tarea),
        b.espera.map((x) => `${refDe(x)} ${corta(x.desc, 34)}${x.lista === "externos" ? " (" + resp(x) + ")" : ""}`).join("; "),
        b.externo && b.interno ? "Externo e interno" : b.externo ? "Externo" : "Interno",
      ]),
    });
    h.nota(
      "Bloqueo externo: depende de un tercero y el equipo no lo puede destrabar solo. Bloqueo interno: se resuelve dentro del equipo." +
        (inf.cuellos.length
          ? ` Lo que más frena es ${refDe(inf.cuellos[0].tarea)}, que detiene a ${inf.cuellos[0].frena.length}.`
          : "")
    );
  }

  /* 5. Terceros */
  sec("Pendientes en manos de terceros");
  if (inf.terceros.length === 0) h.nota("No hay pendientes abiertos a cargo de terceros.");
  else {
    h.tabla({
      cols: [{ w: 20 }, { w: 68 }, { w: 12, align: "r" }],
      head: ["Tercero", "Pendientes", "Días"],
      rows: inf.terceros.map((x) => [
        x.nombre,
        x.tareas.map((y) => `${refDe(y)} ${corta(y.desc, 46)}`).join("; "),
        String(x.dias),
      ]),
    });
    if (inf.externos_sin_plantear.length)
      h.nota(`Sin plantear formalmente al tercero: ${inf.externos_sin_plantear.map(refDe).join(", ")}.`);
  }

  /* 6. Antiguedad */
  sec("Abiertos hace más de 30 días");
  if (inf.viejos.length === 0) h.nota("Nada lleva más de 30 días abierto.");
  else h.tabla({
    cols: [{ w: 7, bold: true }, { w: 55 }, { w: 22 }, { w: 8, align: "r" }, { w: 8, align: "c" }],
    head: ["Ref", "Descripción", "Responsable", "Días", "Urg."],
    rows: inf.viejos.map((x) => [refDe(x), x.desc, resp(x), String(diasAbierto(x.fecha, inf.hoy)), String(x.urg)]),
  });

  /* 7. Altas */
  sec(`Altas ${cuando}`);
  if (inf.altas.length === 0) h.nota("No entraron pendientes nuevos en el período.");
  else h.tabla({
    cols: [{ w: 7, bold: true }, { w: 58 }, { w: 23 }, { w: 12, align: "c" }],
    head: ["Ref", "Descripción", "Responsable", "Alta"],
    rows: inf.altas.map((x) => [refDe(x), x.desc, resp(x), fmtDia(x.creado_at)]),
  });

  /* 8. Decisiones: solo si alguien las escribio. No se inventan. */
  const dec = (Array.isArray(decisiones) ? decisiones : String(decisiones).split("|"))
    .map((s) => limpio(s)).filter(Boolean);
  if (dec.length) {
    sec("Temas que requieren gestión de la dirección");
    dec.forEach((d, i) => {
      const lineas = h.cortar(d, ANCHO - 16, 8.5);
      h.sitio(lineas.length * 11.5 + 6);
      h.texto(`${i + 1}.`, M, h.y - 8.5, { size: 8.5, bold: true });
      lineas.forEach((l, j) => h.texto(l, M + 16, h.y - 8.5 - j * 11.5, { size: 8.5 }));
      h.y -= lineas.length * 11.5 + 3;
    });
  }

  h.nota(
    "Las fechas de cierre se registran desde el 7/09/2026, por lo que los cierres anteriores a esa fecha no cuentan en ningún período. " +
      "Las fechas límite se empezaron a cargar la misma semana."
  );

  h.pies();
  return Buffer.from(await doc.save());
}
