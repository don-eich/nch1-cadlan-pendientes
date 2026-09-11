"use client";

import { SEED_TAREAS, SEED_CATALOGO } from "./seed.js";

const LS_KEY = "nch1_cadlan_v2";

let modo = "local";
export const getModo = () => modo;

function leerLocal() {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    /* sin storage disponible */
  }
  return null;
}

function guardarLocal(state) {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(state));
    return true;
  } catch (e) {
    return false;
  }
}

const semilla = () => ({
  tareas: SEED_TAREAS.map((t) => ({ ...t })),
  catalogo: SEED_CATALOGO.map((c) => ({ ...c })),
  bloqueos: [],
});

export async function cargar() {
  try {
    const r = await fetch("/api/state", { cache: "no-store" });
    const j = await r.json();
    if (j.modo === "db") {
      modo = "db";
      return { tareas: j.tareas, catalogo: j.catalogo, bloqueos: j.bloqueos || [], aviso: "" };
    }
    modo = "local";
    return { bloqueos: [], ...(leerLocal() || semilla()), aviso: j.motivo || "" };
  } catch (e) {
    modo = "local";
    return { bloqueos: [], ...(leerLocal() || semilla()), aviso: "Sin conexión con el servidor." };
  }
}

/** next: estado completo ya calculado. ops: cambios puntuales a persistir. */
export async function aplicar(next, ops) {
  if (modo === "db") {
    try {
      const r = await fetch("/api/ops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops }),
        keepalive: true,
      });
      const j = await r.json();
      if (j.ok) return "Guardado";
      return j.avisos?.length ? j.avisos[0] : "No se pudo guardar";
    } catch (e) {
      return "No se pudo guardar";
    }
  }
  return guardarLocal({ tareas: next.tareas, catalogo: next.catalogo, bloqueos: next.bloqueos || [] })
    ? "Guardado en este navegador"
    : "No se pudo guardar";
}
