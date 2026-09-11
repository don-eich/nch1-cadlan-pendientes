/* Utilidades compartidas entre la app (cliente) y las rutas del servidor.
   Sin dependencias: se importa desde los dos lados. */

/* ── responsables: varios por pendiente, guardados en `resp` separados por "/" ── */

export function partirResp(s) {
  return String(s || "")
    .split(/\s*(?:\/|,|;| y | e )\s*/i)
    .map((x) => x.trim())
    .filter(Boolean)
    .filter((x, i, a) => a.indexOf(x) === i);
}

export function unirResp(arr) {
  return (arr || []).map((x) => String(x).trim()).filter(Boolean).join("/");
}

export function tieneResp(t, nombre) {
  return partirResp(t.resp).includes(nombre);
}

/* ── dependencias: `bloqueos` es una lista de { bloqueante, bloqueada } ── */

export function refDe(t) {
  if (!t) return "?";
  return (t.lista === "externos" ? "E" : "I") + (t.item ?? "?");
}

export function bloqueantesDe(id, bloqueos) {
  return (bloqueos || []).filter((b) => b.bloqueada === id).map((b) => b.bloqueante);
}

export function bloqueadasPor(id, bloqueos) {
  return (bloqueos || []).filter((b) => b.bloqueante === id).map((b) => b.bloqueada);
}

/* Una tarea está bloqueada si alguna de sus bloqueantes sigue sin resolver. */
export function bloqueantesActivas(t, tareas, bloqueos) {
  const porId = new Map((tareas || []).map((x) => [x.id, x]));
  return bloqueantesDe(t.id, bloqueos)
    .map((id) => porId.get(id))
    .filter((x) => x && x.estado !== "resuelto");
}

export function estaBloqueada(t, tareas, bloqueos) {
  return t.estado !== "resuelto" && bloqueantesActivas(t, tareas, bloqueos).length > 0;
}

/* ¿Agregar "bloqueante → bloqueada" cerraría un ciclo? Sí, si desde
   `bloqueada` ya se llega a `bloqueante` siguiendo las flechas de bloqueo. */
export function creaCiclo(bloqueos, bloqueante, bloqueada) {
  if (bloqueante === bloqueada) return true;
  const sig = new Map();
  for (const b of bloqueos || []) {
    if (!sig.has(b.bloqueante)) sig.set(b.bloqueante, []);
    sig.get(b.bloqueante).push(b.bloqueada);
  }
  const visto = new Set();
  const pila = [bloqueada];
  while (pila.length) {
    const x = pila.pop();
    if (x === bloqueante) return true;
    if (visto.has(x)) continue;
    visto.add(x);
    for (const y of sig.get(x) || []) pila.push(y);
  }
  return false;
}

/* Resuelve una referencia escrita por una persona ("I12", "E3", "#12", "12",
   o un id interno) a una tarea. `listaPorDefecto` se usa cuando no viene letra. */
export function resolverRef(texto, tareas, listaPorDefecto = "internos") {
  const s = String(texto || "").trim();
  if (!s) return null;
  const porId = tareas.find((t) => t.id === s);
  if (porId) return porId;
  const m = s.match(/^#?\s*([IE])?\s*-?\s*(\d+)$/i);
  if (!m) return null;
  const lista = m[1] ? (m[1].toUpperCase() === "E" ? "externos" : "internos") : listaPorDefecto;
  return tareas.find((t) => t.lista === lista && Number(t.item) === Number(m[2])) || null;
}

export function partirRefs(s) {
  return String(s || "")
    .split(/[,\s;]+/)
    .map((x) => x.trim())
    .filter((x) => x && !/^(y|e|and)$/i.test(x));
}
