import { neon, neonConfig } from "@neondatabase/serverless";

/* Solo para desarrollo/pruebas: permite apuntar el driver HTTP de Neon a un
   endpoint local. En Vercel no está definido y no cambia nada. */
if (process.env.NEON_FETCH_ENDPOINT) neonConfig.fetchEndpoint = process.env.NEON_FETCH_ENDPOINT;
import { SEED_TAREAS, SEED_CATALOGO } from "./seed.js";
import { creaCiclo } from "./comun.js";

const CONN =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_PRISMA_URL ||
  "";

export const hayDB = Boolean(CONN);

/* Conexión por request, sin memoizar, y cada consulta sale con un cuerpo
   distinto (comentario con nonce) y `cache: no-store`. Así ninguna capa de
   caché de fetch —la de Next o la de Vercel Data Cache— puede devolver una
   respuesta vieja para una consulta repetida. */
function sql() {
  const base = neon(CONN, {
    fetchOptions: { cache: "no-store" },
  });
  return (strings, ...vals) => {
    let texto = "";
    for (let i = 0; i < strings.length; i++) {
      texto += strings[i];
      if (i < vals.length) texto += "$" + (i + 1);
    }
    const nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    texto += ` /* ${nonce} */`;
    return base(texto, vals);
  };
}

let inicializado = false;

export async function ensure() {
  if (inicializado) return;
  const q = sql();

  await q`
    CREATE TABLE IF NOT EXISTS tareas (
      id         text PRIMARY KEY,
      lista      text NOT NULL,
      item       integer,
      orden      double precision NOT NULL DEFAULT 0,
      fecha      text,
      area       text DEFAULT '',
      subarea    text DEFAULT '',
      equipo     text DEFAULT '',
      descripcion text DEFAULT '',
      doc        text DEFAULT '',
      urg        integer DEFAULT 2,
      resp       text DEFAULT '',
      estado     text DEFAULT 'pendiente',
      planteado  boolean DEFAULT false,
      via        text DEFAULT '',
      nota       text DEFAULT '',
      updated_at timestamptz DEFAULT now()
    )`;

  await q`
    CREATE TABLE IF NOT EXISTS catalogo (
      id     text PRIMARY KEY,
      tipo   text NOT NULL,
      nombre text NOT NULL,
      padre  text DEFAULT '',
      orden  double precision NOT NULL DEFAULT 0
    )`;

  await q`ALTER TABLE tareas ADD COLUMN IF NOT EXISTS vence text`;
  await q`ALTER TABLE tareas ADD COLUMN IF NOT EXISTS creado_at timestamptz`;
  await q`ALTER TABLE tareas ADD COLUMN IF NOT EXISTS resuelto_at timestamptz`;

  /* Dependencias entre pendientes: la fila (A, D) significa "A bloquea a D".
     Una tarea puede tener varias bloqueantes y bloquear a varias. */
  await q`
    CREATE TABLE IF NOT EXISTS bloqueos (
      bloqueante text NOT NULL,
      bloqueada  text NOT NULL,
      creado_at  timestamptz DEFAULT now(),
      PRIMARY KEY (bloqueante, bloqueada)
    )`;

  const [{ n }] = await q`SELECT count(*)::int AS n FROM tareas`;
  if (n === 0) {
    for (const t of SEED_TAREAS) await upsertTarea(t);
  }
  const [{ m }] = await q`SELECT count(*)::int AS m FROM catalogo`;
  if (m === 0) {
    for (const c of SEED_CATALOGO) await upsertCat(c);
  }

  /* Migraciones que corren una sola vez, registradas por clave. */
  await q`CREATE TABLE IF NOT EXISTS migraciones (clave text PRIMARY KEY, aplicada timestamptz DEFAULT now())`;
  const hechas = new Set((await q`SELECT clave FROM migraciones`).map((r) => r.clave));
  if (!hechas.has("2026-09-09-resp-multiple")) {
    // El responsable combinado "MM/GZ" deja de ser una entrada del catálogo:
    // ahora un pendiente lleva varios responsables y "MM/GZ" en `resp` ya
    // se lee como MM y GZ. Se suma CadLan como responsable interno.
    await q`DELETE FROM catalogo WHERE tipo = 'resp_int' AND nombre = 'MM/GZ'`;
    await q`
      INSERT INTO catalogo (id, tipo, nombre, padre, orden)
      SELECT 'r-cadlan', 'resp_int', 'CadLan', '', 400
      WHERE NOT EXISTS (SELECT 1 FROM catalogo WHERE tipo = 'resp_int' AND lower(nombre) = 'cadlan')`;
    await q`INSERT INTO migraciones (clave) VALUES ('2026-09-09-resp-multiple') ON CONFLICT DO NOTHING`;
  }


  inicializado = true;
}

export async function upsertTarea(t) {
  const q = sql();
  await q`
    INSERT INTO tareas (id, lista, item, orden, fecha, vence, area, subarea, equipo, descripcion, doc, urg, resp, estado, planteado, via, nota, updated_at, creado_at, resuelto_at)
    VALUES (${t.id}, ${t.lista}, ${t.item ?? null}, ${t.orden ?? 0}, ${t.fecha ?? ""}, ${t.vence ?? ""},
            ${t.area ?? ""}, ${t.subarea ?? ""}, ${t.equipo ?? ""}, ${t.desc ?? ""}, ${t.doc ?? ""},
            ${t.urg ?? 2}, ${t.resp ?? ""}, ${t.estado ?? "pendiente"},
            ${Boolean(t.planteado)}, ${t.via ?? ""}, ${t.nota ?? ""}, now(),
            COALESCE(NULLIF(${t.fecha ?? ""}, '')::timestamptz, now()), NULL)
    ON CONFLICT (id) DO UPDATE SET
      lista = EXCLUDED.lista, item = EXCLUDED.item, orden = EXCLUDED.orden, fecha = EXCLUDED.fecha,
      vence = EXCLUDED.vence,
      area = EXCLUDED.area, subarea = EXCLUDED.subarea, equipo = EXCLUDED.equipo,
      descripcion = EXCLUDED.descripcion, doc = EXCLUDED.doc, urg = EXCLUDED.urg,
      resp = EXCLUDED.resp, estado = EXCLUDED.estado, planteado = EXCLUDED.planteado,
      via = EXCLUDED.via, nota = EXCLUDED.nota, updated_at = now(),
      resuelto_at = CASE
        WHEN EXCLUDED.estado = 'resuelto' AND tareas.estado <> 'resuelto' THEN now()
        WHEN EXCLUDED.estado <> 'resuelto' THEN NULL
        ELSE tareas.resuelto_at END`;
}

export async function deleteTarea(id) {
  const q = sql();
  await q`DELETE FROM bloqueos WHERE bloqueante = ${id} OR bloqueada = ${id}`;
  await q`DELETE FROM tareas WHERE id = ${id}`;
}

/* Alta de un bloqueo con validación: existen las dos tareas, no es la misma,
   y no cierra un ciclo. Devuelve { ok } o { ok: false, error }. */
export async function agregarBloqueo(bloqueante, bloqueada) {
  const q = sql();
  if (!bloqueante || !bloqueada) return { ok: false, error: "Faltan los dos pendientes del bloqueo." };
  if (bloqueante === bloqueada) return { ok: false, error: "Un pendiente no puede bloquearse a sí mismo." };
  const existen = await q`SELECT id FROM tareas WHERE id = ${bloqueante} OR id = ${bloqueada}`;
  if (existen.length < 2) return { ok: false, error: "Alguno de los dos pendientes no existe." };
  const actuales = await q`SELECT bloqueante, bloqueada FROM bloqueos`;
  if (creaCiclo(actuales, bloqueante, bloqueada)) {
    return { ok: false, error: "Ese bloqueo cerraría un ciclo: la otra tarea ya depende, directa o indirectamente, de esta." };
  }
  await q`INSERT INTO bloqueos (bloqueante, bloqueada) VALUES (${bloqueante}, ${bloqueada}) ON CONFLICT DO NOTHING`;
  return { ok: true };
}

export async function quitarBloqueo(bloqueante, bloqueada) {
  await sql()`DELETE FROM bloqueos WHERE bloqueante = ${bloqueante} AND bloqueada = ${bloqueada}`;
}

export async function upsertCat(c) {
  const q = sql();
  await q`
    INSERT INTO catalogo (id, tipo, nombre, padre, orden)
    VALUES (${c.id}, ${c.tipo}, ${c.nombre}, ${c.padre ?? ""}, ${c.orden ?? 0})
    ON CONFLICT (id) DO UPDATE SET
      tipo = EXCLUDED.tipo, nombre = EXCLUDED.nombre, padre = EXCLUDED.padre, orden = EXCLUDED.orden`;
}

export async function deleteCat(id) {
  await sql()`DELETE FROM catalogo WHERE id = ${id}`;
}

export async function leerTodo() {
  const q = sql();
  const tareas = await q`SELECT * FROM tareas ORDER BY lista, orden`;
  const catalogo = await q`SELECT * FROM catalogo ORDER BY tipo, orden`;
  const bloqueos = await q`SELECT bloqueante, bloqueada FROM bloqueos ORDER BY creado_at`;
  return {
    bloqueos: bloqueos.map((r) => ({ bloqueante: r.bloqueante, bloqueada: r.bloqueada })),
    tareas: tareas.map((r) => ({
      id: r.id,
      lista: r.lista,
      item: r.item,
      orden: Number(r.orden),
      fecha: r.fecha || "",
      vence: r.vence || "",
      area: r.area || "",
      subarea: r.subarea || "",
      equipo: r.equipo || "",
      desc: r.descripcion || "",
      doc: r.doc || "",
      urg: r.urg ?? 2,
      resp: r.resp || "",
      estado: r.estado || "pendiente",
      planteado: Boolean(r.planteado),
      via: r.via || "",
      nota: r.nota || "",
      creado_at: r.creado_at ? new Date(r.creado_at).toISOString() : null,
      resuelto_at: r.resuelto_at ? new Date(r.resuelto_at).toISOString() : null,
    })),
    catalogo: catalogo.map((r) => ({
      id: r.id,
      tipo: r.tipo,
      nombre: r.nombre,
      padre: r.padre || "",
      orden: Number(r.orden),
    })),
  };
}

export async function crearTarea(campos) {
  const q = sql();
  const lista = campos.lista === "externos" ? "externos" : "internos";
  const [{ maxitem, maxorden }] = await q`
    SELECT COALESCE(MAX(item), 0)::int AS maxitem, COALESCE(MAX(orden), 0)::float AS maxorden
    FROM tareas WHERE lista = ${lista}`;
  const hoy = new Date().toISOString().slice(0, 10);
  const fila = {
    id: "b" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    lista,
    item: Number(maxitem) + 1,
    orden: Number(maxorden) + 100,
    fecha: campos.fecha || hoy,
    vence: campos.vence || "",
    area: campos.area || "Sin asignar",
    subarea: campos.subarea || "",
    equipo: campos.equipo || "",
    desc: campos.desc || "",
    doc: campos.doc || "",
    urg: [1, 2, 3].includes(Number(campos.urg)) ? Number(campos.urg) : 2,
    resp: campos.resp || "",
    estado: "pendiente",
    planteado: Boolean(campos.planteado),
    via: campos.via || "",
    nota: campos.nota || "",
  };
  await upsertTarea(fila);
  return fila;
}
