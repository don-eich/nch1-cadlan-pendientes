import { NextResponse } from "next/server";
import { hayDB, ensure, leerTodo, crearTarea, upsertTarea, agregarBloqueo, quitarBloqueo } from "../../../../lib/db.js";
import { autorizado, buscar, compacta } from "../../../../lib/bot.js";
import { partirResp, unirResp, tieneResp, resolverRef, partirRefs, estaBloqueada, refDe } from "../../../../lib/comun.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const hoyISO = () => new Date().toISOString().slice(0, 10);

function guard(req) {
  if (!hayDB) return NextResponse.json({ error: "La app no tiene base de datos conectada." }, { status: 503 });
  const a = autorizado(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  return null;
}

/* GET /api/bot/pendientes
   ?q=texto libre        busca candidatos (matching difuso)
   ?lista=internos|externos
   ?area=SSNR
   ?estado=pendiente|curso|probar|resuelto|abiertos   (default: abiertos)
   ?resp=MM              solo las que tienen a ese responsable (entre otros)
   ?bloqueadas=1         solo las que esperan por otro pendiente sin resolver
   ?limite=8                                                                */
export async function GET(req) {
  const no = guard(req);
  if (no) return no;
  try {
    await ensure();
    const { tareas, bloqueos } = await leerTodo();
    const ctx = { tareas, bloqueos };
    const u = new URL(req.url);
    const q = (u.searchParams.get("q") || "").trim();
    const lista = u.searchParams.get("lista");
    const area = u.searchParams.get("area");
    const resp = (u.searchParams.get("resp") || "").trim();
    const soloBloq = ["1", "true", "si", "sí"].includes(String(u.searchParams.get("bloqueadas") || "").toLowerCase());
    const estado = u.searchParams.get("estado") || "abiertos";
    const limite = Math.min(Number(u.searchParams.get("limite")) || 8, 60);
    const hoy = hoyISO();

    let base = tareas;
    if (lista) base = base.filter((t) => t.lista === lista);
    if (area) base = base.filter((t) => t.area === area);
    if (resp) base = base.filter((t) => tieneResp(t, resp));
    if (soloBloq) base = base.filter((t) => estaBloqueada(t, tareas, bloqueos));
    if (estado === "abiertos") base = base.filter((t) => t.estado !== "resuelto");
    else if (estado !== "todos") base = base.filter((t) => t.estado === estado);

    if (!q) {
      return NextResponse.json({
        confianza: "listado",
        total: base.length,
        candidatos: base.slice(0, limite).map((t) => compacta(t, hoy, ctx)),
      });
    }
    // al buscar por texto no se filtra por estado: el usuario puede nombrar algo ya cerrado
    let paraBuscar = tareas;
    if (lista) paraBuscar = paraBuscar.filter((t) => t.lista === lista);
    if (area) paraBuscar = paraBuscar.filter((t) => t.area === area);
    const r = buscar(paraBuscar, q, { limite });
    return NextResponse.json({
      confianza: r.confianza,
      consulta: q,
      candidatos: r.candidatos.map((t) => compacta(t, hoy, ctx)),
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

/* POST /api/bot/pendientes  — alta. El servidor asigna número, orden y fecha. */
export async function POST(req) {
  const no = guard(req);
  if (no) return no;
  try {
    await ensure();
    const body = await req.json();
    if (!body.desc || !String(body.desc).trim()) {
      return NextResponse.json({ error: "Falta la descripción del pendiente." }, { status: 400 });
    }
    const { catalogo, tareas } = await leerTodo();
    const nombres = (tipo, padre) =>
      catalogo.filter((c) => c.tipo === tipo && (padre === undefined || c.padre === padre)).map((c) => c.nombre);

    const avisos = [];
    const listaDest = body.lista === "externos" ? "externos" : "internos";
    if (body.vence && !/^\d{4}-\d{2}-\d{2}$/.test(String(body.vence).trim())) {
      avisos.push(`La fecha límite «${body.vence}» no tiene formato AAAA-MM-DD. Se guardó sin fecha límite.`);
      body.vence = "";
    }
    if (body.area && !nombres("area").includes(body.area)) {
      avisos.push(`El área «${body.area}» no está en el catálogo. Áreas válidas: ${nombres("area").join(", ")}.`);
      body.area = "Sin asignar";
      body.subarea = "";
    }
    if (body.subarea && !nombres("subarea", body.area).includes(body.subarea)) {
      avisos.push(`«${body.subarea}» no es sub-área de ${body.area}. Se guardó sin sub-área.`);
      body.subarea = "";
    }
    const tipoResp = body.lista === "externos" ? "resp_ext" : "resp_int";
    if (body.resp) {
      const validos = nombres(tipoResp);
      const pedidos = partirResp(Array.isArray(body.resp) ? body.resp.join("/") : body.resp);
      const malos = pedidos.filter((r) => !validos.includes(r));
      if (malos.length) {
        avisos.push(`Responsable(s) fuera del catálogo: ${malos.join(", ")}. Válidos: ${validos.join(", ")}.`);
      }
      body.resp = unirResp(pedidos.filter((r) => validos.includes(r)));
    }

    const fila = await crearTarea(body);

    // Dependencias al crear: "bloqueada_por" y "bloquea" aceptan referencias (I12, E3) separadas por coma.
    const vincular = async (texto, direccion) => {
      for (const ref of partirRefs(texto)) {
        const otra = resolverRef(ref, tareas, listaDest);
        if (!otra) { avisos.push(`No encontré el pendiente «${ref}» para vincular.`); continue; }
        const r = direccion === "bloqueada_por" ? await agregarBloqueo(otra.id, fila.id) : await agregarBloqueo(fila.id, otra.id);
        if (!r.ok) avisos.push(`${refDe(otra)}: ${r.error}`);
      }
    };
    if (body.bloqueada_por) await vincular(body.bloqueada_por, "bloqueada_por");
    if (body.bloquea) await vincular(body.bloquea, "bloquea");

    const fresco = await leerTodo();
    const creada = fresco.tareas.find((t) => t.id === fila.id) || fila;
    return NextResponse.json({ ok: true, avisos, pendiente: compacta(creada, hoyISO(), fresco) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}

const ESTADOS = ["pendiente", "curso", "probar", "resuelto"];

/* PATCH /api/bot/pendientes  con { id, estado, nota, autor, ... } en el body.
   El id va en el body y no en la URL porque las herramientas HTTP de un agente
   n8n no admiten valores dinámicos en la URL.
   Los campos ausentes o vacíos no se tocan: un string vacío nunca borra un valor. */
export async function PATCH(req) {
  const no = guard(req);
  if (no) return no;
  try {
    await ensure();
    const body = await req.json();
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ error: "Falta el id del pendiente." }, { status: 400 });

    const { tareas, catalogo } = await leerTodo();
    const prev = tareas.find((t) => t.id === id);
    if (!prev) {
      return NextResponse.json(
        { error: `No existe el pendiente ${id}. Buscalo primero y usá el campo id del resultado.` },
        { status: 404 }
      );
    }

    const fila = { ...prev };
    const cambios = [];
    const dado = (v) => v !== undefined && v !== null && String(v).trim() !== "";

    if (dado(body.estado)) {
      const estado = String(body.estado).trim();
      if (!ESTADOS.includes(estado)) {
        return NextResponse.json({ error: `Estado inválido. Valores: ${ESTADOS.join(", ")}.` }, { status: 400 });
      }
      if (estado !== prev.estado) cambios.push(`estado ${prev.estado} → ${estado}`);
      fila.estado = estado;
    }
    if (dado(body.vence)) {
      const v = String(body.vence).trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        return NextResponse.json({ error: "La fecha límite tiene que venir como AAAA-MM-DD." }, { status: 400 });
      }
      if (v !== prev.vence) cambios.push(`fecha límite ${prev.vence || "sin fecha"} → ${v}`);
      fila.vence = v;
    }
    if (String(body.vence).trim() === "sin fecha" || body.quitar_vence === true) {
      if (prev.vence) cambios.push(`fecha límite ${prev.vence} → sin fecha`);
      fila.vence = "";
    }
    const avisos = [];
    if (dado(body.resp)) {
      // Reemplaza la lista completa de responsables ("MM y GZ", "MM, GZ", "MM/GZ").
      const tipoResp = prev.lista === "externos" ? "resp_ext" : "resp_int";
      const validos = catalogo.filter((c) => c.tipo === tipoResp).map((c) => c.nombre);
      const pedidos = partirResp(Array.isArray(body.resp) ? body.resp.join("/") : body.resp);
      const malos = pedidos.filter((r) => !validos.includes(r));
      if (malos.length) avisos.push(`Responsable(s) fuera del catálogo: ${malos.join(", ")}. Válidos: ${validos.join(", ")}.`);
      const nuevo = unirResp(pedidos.filter((r) => validos.includes(r)));
      if (nuevo && nuevo !== prev.resp) { cambios.push(`responsables: ${prev.resp || "vacío"} → ${nuevo}`); fila.resp = nuevo; }
    }
    if (dado(body.agregar_resp)) {
      const tipoResp = prev.lista === "externos" ? "resp_ext" : "resp_int";
      const validos = catalogo.filter((c) => c.tipo === tipoResp).map((c) => c.nombre);
      const actuales = partirResp(fila.resp);
      for (const r of partirResp(body.agregar_resp)) {
        if (!validos.includes(r)) { avisos.push(`«${r}» no está en el catálogo de responsables.`); continue; }
        if (!actuales.includes(r)) actuales.push(r);
      }
      const nuevo = unirResp(actuales);
      if (nuevo !== fila.resp) { cambios.push(`responsables: ${prev.resp || "vacío"} → ${nuevo}`); fila.resp = nuevo; }
    }
    if (dado(body.quitar_resp)) {
      const quitar = partirResp(body.quitar_resp);
      const nuevo = unirResp(partirResp(fila.resp).filter((r) => !quitar.includes(r)));
      if (nuevo !== fila.resp) { cambios.push(`responsables: ${fila.resp || "vacío"} → ${nuevo || "vacío"}`); fila.resp = nuevo; }
    }
    for (const k of ["equipo", "area", "subarea", "via", "doc"]) {
      if (dado(body[k]) && String(body[k]) !== prev[k]) {
        fila[k] = String(body[k]).trim();
        cambios.push(`${k}: ${prev[k] || "vacío"} → ${fila[k]}`);
      }
    }
    if (dado(body.urg) && [1, 2, 3].includes(Number(body.urg))) {
      if (Number(body.urg) !== prev.urg) cambios.push(`urgencia ${prev.urg} → ${Number(body.urg)}`);
      fila.urg = Number(body.urg);
    }
    if (dado(body.planteado)) {
      const v = ["true", "si", "sí", "1"].includes(String(body.planteado).toLowerCase());
      if (v !== prev.planteado) cambios.push(`planteado: ${v ? "sí" : "no"}`);
      fila.planteado = v;
    }
    if (dado(body.nota)) {
      const marca = new Date().toISOString().slice(0, 10);
      const quien = dado(body.autor) ? ` (${String(body.autor).trim()})` : "";
      fila.nota = [prev.nota, `${marca}${quien}: ${String(body.nota).trim()}`].filter(Boolean).join("\n");
      cambios.push("nota agregada");
    }

    if (cambios.length > 0) await upsertTarea(fila);

    /* Dependencias: bloqueada_por / bloquea agregan vínculos; quitar_bloqueada_por /
       quitar_bloquea los sacan. Todos aceptan referencias (I12, E3) separadas por coma. */
    const vinc = async (texto, modo) => {
      for (const ref of partirRefs(texto)) {
        const otra = resolverRef(ref, tareas, prev.lista);
        if (!otra) { avisos.push(`No encontré el pendiente «${ref}».`); continue; }
        if (otra.id === prev.id) { avisos.push("Un pendiente no puede bloquearse a sí mismo."); continue; }
        if (modo === "bloqueada_por") {
          const r = await agregarBloqueo(otra.id, prev.id);
          r.ok ? cambios.push(`ahora está bloqueada por ${refDe(otra)}`) : avisos.push(`${refDe(otra)}: ${r.error}`);
        } else if (modo === "bloquea") {
          const r = await agregarBloqueo(prev.id, otra.id);
          r.ok ? cambios.push(`ahora bloquea a ${refDe(otra)}`) : avisos.push(`${refDe(otra)}: ${r.error}`);
        } else if (modo === "quitar_bloqueada_por") {
          await quitarBloqueo(otra.id, prev.id); cambios.push(`ya no está bloqueada por ${refDe(otra)}`);
        } else if (modo === "quitar_bloquea") {
          await quitarBloqueo(prev.id, otra.id); cambios.push(`ya no bloquea a ${refDe(otra)}`);
        }
      }
    };
    for (const k of ["bloqueada_por", "bloquea", "quitar_bloqueada_por", "quitar_bloquea"]) {
      if (dado(body[k])) await vinc(body[k], k);
    }

    const fresco = await leerTodo();
    const final = fresco.tareas.find((t) => t.id === prev.id) || fila;
    // Si se resolvió y liberó otras, decirlo: es lo que la gente quiere saber.
    const liberadas = fila.estado === "resuelto" && prev.estado !== "resuelto"
      ? fresco.bloqueos.filter((b) => b.bloqueante === prev.id).map((b) => fresco.tareas.find((t) => t.id === b.bloqueada))
          .filter((t) => t && t.estado !== "resuelto" && !estaBloqueada(t, fresco.tareas, fresco.bloqueos)).map(refDe)
      : [];
    if (liberadas.length) cambios.push(`al resolverse, quedan destrabadas: ${liberadas.join(", ")}`);
    return NextResponse.json({ ok: true, cambios, avisos, pendiente: compacta(final, hoyISO(), fresco) });
  } catch (e) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
