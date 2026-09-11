/* Utilidades del bot de Telegram: autenticación y matching difuso. */
import { partirResp, refDe, bloqueantesDe, bloqueadasPor } from "./comun.js";

export function autorizado(req) {
  const token = process.env.BOT_API_TOKEN || "";
  if (!token) return { ok: false, status: 503, error: "BOT_API_TOKEN no está configurado en el servidor." };
  const h = req.headers.get("authorization") || "";
  const dado = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (dado !== token) return { ok: false, status: 401, error: "Token inválido." };
  return { ok: true };
}

const STOP = new Set([
  "el","la","los","las","un","una","unos","unas","de","del","al","a","en","y","o","que",
  "con","por","para","se","su","sus","es","esta","este","ya","lo","le","me","mi","the",
  "ok","listo","hecho","termine","terminé","termino","termina","terminado","cerrar",
  "cerra","cerrá","cerrado","complete","completé","completo","completado","hice","quedo",
  "quedó","queda","pendiente","pendientes","tarea","ya","esta","estan","están",
]);

export function normalizar(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s/-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(s) {
  return normalizar(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));
}

/* Coincidencia por prefijo de 4 caracteres, para que "servidor" alcance a
   "servidores" y "servers", que es como habla la gente en obra. */
function coincide(a, b) {
  if (a === b) return true;
  const n = Math.min(4, a.length, b.length);
  if (n < 3) return false;
  return a.slice(0, n) === b.slice(0, n);
}

export function puntuar(consulta, tarea) {
  const q = tokens(consulta);
  if (q.length === 0) return 0;
  const fuerte = tokens([tarea.desc, tarea.equipo].join(" "));
  const debil = tokens([tarea.area, tarea.subarea, tarea.doc, tarea.nota, tarea.resp].join(" "));
  let p = 0;
  for (const t of q) {
    if (fuerte.some((x) => coincide(t, x))) p += 1;
    else if (debil.some((x) => coincide(t, x))) p += 0.4;
  }
  // referencia explícita por número: "#15" o "item 15"
  const num = String(consulta).match(/#\s*(\d+)|(?:item|ítem|numero|número)\s*(\d+)/i);
  if (num && Number(num[1] || num[2]) === tarea.item) p += q.length;
  return p / q.length;
}

/* Nunca devuelve vacío: si nada supera el umbral, igual entrega los mejores
   candidatos marcados como flojos, para que el agente pueda repreguntar en vez
   de contestar "no encontré nada". */
export function buscar(tareas, consulta, { limite = 8, minimo = 0.34 } = {}) {
  const todos = tareas
    .map((t) => ({ ...t, score: Math.round(puntuar(consulta, t) * 100) / 100 }))
    .sort((a, b) => b.score - a.score || (a.estado === "resuelto") - (b.estado === "resuelto"));
  const buenos = todos.filter((t) => t.score >= minimo).slice(0, limite);
  if (buenos.length > 0) return { confianza: "ok", candidatos: buenos };
  return { confianza: "baja", candidatos: todos.filter((t) => t.score > 0).slice(0, 5) };
}

/* Días desde hoy hasta la fecha límite: negativo si ya venció. */
export function diasParaVencer(vence, hoy) {
  if (!vence) return null;
  return Math.round((new Date(vence + "T00:00:00") - new Date(hoy + "T00:00:00")) / 86400000);
}

/* ctx opcional: { tareas, bloqueos } para incluir las dependencias. */
export function compacta(t, hoy, ctx) {
  const dias = t.fecha
    ? Math.max(0, Math.round((new Date(hoy + "T00:00:00") - new Date(t.fecha + "T00:00:00")) / 86400000))
    : null;
  const restan = diasParaVencer(t.vence, hoy);
  let deps = {};
  if (ctx && ctx.tareas && ctx.bloqueos) {
    const porId = new Map(ctx.tareas.map((x) => [x.id, x]));
    const mini = (id) => {
      const x = porId.get(id);
      return x
        ? { ref: refDe(x), id: x.id, desc: x.desc, estado: x.estado, tipo: x.lista === "externos" ? "externo" : "interno", responsable: x.resp }
        : null;
    };
    const bloqueada_por = bloqueantesDe(t.id, ctx.bloqueos).map(mini).filter(Boolean);
    const bloquea = bloqueadasPor(t.id, ctx.bloqueos).map(mini).filter(Boolean);
    deps = {
      bloqueada: t.estado !== "resuelto" && bloqueada_por.some((x) => x.estado !== "resuelto"),
      bloqueada_por,
      bloquea,
    };
  }
  return {
    id: t.id,
    ref: refDe(t),
    lista: t.lista,
    item: t.item,
    desc: t.desc,
    area: t.area,
    subarea: t.subarea,
    equipo: t.equipo,
    estado: t.estado,
    urgencia: t.urg,
    responsable: t.resp,
    responsables: partirResp(t.resp),
    fecha_alta: t.fecha,
    dias_abierto: dias,
    vence: t.vence || null,
    dias_para_vencer: restan,
    vencida: restan !== null && restan < 0 && t.estado !== "resuelto",
    nota: t.nota,
    ...deps,
    ...(t.lista === "externos" ? { planteado: t.planteado, via: t.via } : {}),
    ...(t.score !== undefined ? { score: t.score } : {}),
  };
}
