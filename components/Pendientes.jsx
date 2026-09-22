"use client";

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Search, Plus, ChevronRight, ChevronUp, ChevronDown, X, Download,
  Trash2, SlidersHorizontal, RefreshCw, CalendarClock, Ban, Link2, FileText, GripVertical,
} from "lucide-react";
import { cargar, aplicar, getModo } from "../lib/store.js";
import {
  partirResp, unirResp, tieneResp, refDe, bloqueantesDe, bloqueadasPor,
  bloqueantesActivas, estaBloqueada, creaCiclo,
} from "../lib/comun.js";
import Catalogo from "./Catalogo.jsx";
import Gantt from "./Gantt.jsx";
import Malla from "./Malla.jsx";

/* ─────────────────────────── config ─────────────────────────── */

const ESTADOS = {
  pendiente: { label: "Pendiente", color: "#C0353B" },
  curso: { label: "En curso", color: "#1C7CA3" },
  probar: { label: "A probar", color: "#A96C08" },
  resuelto: { label: "Resuelto", color: "#2E7D53" },
};
const ORDEN_ESTADO = ["pendiente", "curso", "probar", "resuelto"];

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];

function fmtFecha(iso) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  if (!m) return iso;
  return `${d} ${MESES[m - 1]}`;
}
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function diasAbierto(iso) {
  if (!iso) return null;
  const d = new Date(iso + "T00:00:00");
  const hoy = new Date(hoyISO() + "T00:00:00");
  return Math.max(0, Math.round((hoy - d) / 86400000));
}
/* Fecha límite: se muestra siempre, pero solo grita cuando falta poco o ya pasó.
   No participa del ordenamiento — el orden lo siguen fijando las flechas. */
function venceInfo(vence, estado) {
  if (!vence || estado === "resuelto") return null;
  const d = Math.round((new Date(vence + "T00:00:00") - new Date(hoyISO() + "T00:00:00")) / 86400000);
  if (d < 0) return { t: `vencida hace ${-d} d`, c: "old" };
  if (d === 0) return { t: "vence hoy", c: "old" };
  if (d === 1) return { t: "vence mañana", c: "due" };
  if (d <= 7) return { t: `vence en ${d} d`, c: "due" };
  return { t: "vence " + fmtFecha(vence), c: "" };
}
function estaVencida(t) {
  if (!t.vence || t.estado === "resuelto") return false;
  return new Date(t.vence + "T00:00:00") < new Date(hoyISO() + "T00:00:00");
}
function uid() {
  return "x" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* ─────────────────────────── componente ─────────────────────────── */

export default function Pendientes() {
  const [tab, setTab] = useState("internos");
  const [data, setData] = useState(null);
  const [aviso, setAviso] = useState("");
  const [flash, setFlash] = useState("");
  const [open, setOpen] = useState(null);
  const [q, setQ] = useState("");
  const [fArea, setFArea] = useState("");
  const [fResp, setFResp] = useState("");
  /* Arranca sin filtro de estado: se ven todos, resueltos incluidos. */
  const [fEstado, setFEstado] = useState("");
  const [adding, setAdding] = useState(false);
  const [mgr, setMgr] = useState(false);
  const [soloVencidas, setSoloVencidas] = useState(false);
  const [soloBloqueadas, setSoloBloqueadas] = useState(false);
  const [refrescando, setRefrescando] = useState(false);

  const ocupado = useRef(false);
  ocupado.current = Boolean(open || adding || mgr);

  const avisar = (m) => {
    setFlash(m);
    setTimeout(() => setFlash(""), 1600);
  };

  useEffect(() => {
    (async () => {
      const s = await cargar();
      setData({ tareas: s.tareas, catalogo: s.catalogo, bloqueos: s.bloqueos || [] });
      setAviso(s.aviso || "");
    })();
  }, []);

  /* Cola de guardado: los campos de texto se persisten con un pequeño retraso
     (una sola escritura por ráfaga de tecleo) y las escrituras de una misma
     tarea salen en orden, así la última nunca llega antes que una anterior. */
  const cola = useRef(new Map()); // id -> { row, next, timer }
  const enCurso = useRef(new Map()); // id -> promesa de la última escritura
  const enVuelo = useRef(0);

  const flush = useCallback((id) => {
    const e = cola.current.get(id);
    if (!e) return Promise.resolve();
    cola.current.delete(id);
    if (e.timer) clearTimeout(e.timer);
    const anterior = enCurso.current.get(id) || Promise.resolve();
    const p = anterior.then(async () => {
      enVuelo.current++;
      try {
        avisar(await aplicar(e.next, [{ tipo: "tarea", accion: "upsert", row: e.row }]));
      } finally {
        enVuelo.current--;
      }
    });
    enCurso.current.set(id, p);
    return p;
  }, []);

  const flushTodo = useCallback(
    () => Promise.all([...cola.current.keys()].map((id) => flush(id))),
    [flush]
  );

  const encolar = (id, row, next, delay) => {
    const e = cola.current.get(id);
    if (e?.timer) clearTimeout(e.timer);
    const entrada = { row, next, timer: null };
    entrada.timer = setTimeout(() => flush(id), delay);
    cola.current.set(id, entrada);
  };

  useEffect(() => {
    const h = () => flushTodo();
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [flushTodo]);

  const refrescar = useCallback(async () => {
    setRefrescando(true);
    // Primero vaciar lo que falte guardar, y esperar lo que esté en vuelo:
    // si no, la recarga pisaría una edición que todavía no llegó al servidor.
    await flushTodo();
    await Promise.all([...enCurso.current.values()]);
    const s = await cargar();
    setData({ tareas: s.tareas, catalogo: s.catalogo, bloqueos: s.bloqueos || [] });
    setAviso(s.aviso || "");
    setRefrescando(false);
  }, [flushTodo]);

  // En modo base compartida, refresca solo si nadie está editando.
  useEffect(() => {
    if (!data || getModo() !== "db") return;
    const t = setInterval(() => {
      if (!ocupado.current && cola.current.size === 0 && enVuelo.current === 0) refrescar();
    }, 30000);
    return () => clearInterval(t);
  }, [data, refrescar]);

  const commit = async (next, ops) => {
    setData(next);
    // Las filas que van en estos ops ya incluyen cualquier texto pendiente
    // (el estado local se actualiza al instante), así que lo encolado para
    // esos ids queda superado: se cancela, y se espera lo que esté en vuelo
    // de esos mismos ids para que la escritura salga en orden.
    const ids = ops.filter((o) => o.tipo === "tarea").map((o) => o.id || o.row?.id);
    for (const id of ids) {
      const e = cola.current.get(id);
      if (e) {
        if (e.timer) clearTimeout(e.timer);
        cola.current.delete(id);
      }
    }
    const previas = ids.map((id) => enCurso.current.get(id)).filter(Boolean);
    enVuelo.current++;
    try {
      if (previas.length) await Promise.all(previas);
      avisar(await aplicar(next, ops));
    } finally {
      enVuelo.current--;
    }
  };

  const lista = tab === "externos" ? "externos" : "internos";
  const vista = tab === "gantt" || tab === "malla" ? tab : "lista";
  const irA = (id) => {
    const t = todas.find((x) => x.id === id);
    if (!t) return;
    setTab(t.lista); setFArea(""); setFResp(""); setFEstado(""); setSoloVencidas(false); setSoloBloqueadas(false); setQ(""); setOpen(id);
  };
  const todas = data ? data.tareas : [];
  const cat = data ? data.catalogo : [];
  const bloqueos = data ? data.bloqueos || [] : [];
  const items = useMemo(() => todas.filter((t) => t.lista === lista), [todas, lista]);

  /* catálogo */
  const areas = useMemo(
    () => cat.filter((c) => c.tipo === "area").sort((a, b) => a.orden - b.orden),
    [cat]
  );
  const subareasDe = useCallback(
    (area) => cat.filter((c) => c.tipo === "subarea" && c.padre === area).sort((a, b) => a.orden - b.orden),
    [cat]
  );
  const tipoResp = lista === "externos" ? "resp_ext" : "resp_int";
  const resps = useMemo(
    () => cat.filter((c) => c.tipo === tipoResp).sort((a, b) => a.orden - b.orden),
    [cat, tipoResp]
  );

  /* ── mutaciones de tareas ── */

  const CAMPOS_TEXTO = ["desc", "nota", "equipo", "doc", "via"];

  const update = (id, patch) => {
    // Si hay una escritura pendiente de esta tarea, partimos de esa fila:
    // así ningún cambio se pierde aunque el estado de React vaya un paso atrás.
    const prev = cola.current.get(id)?.row || todas.find((t) => t.id === id);
    if (!prev) return;
    const row = { ...prev, ...patch };
    const next = { ...data, tareas: todas.map((t) => (t.id === id ? row : t)) };
    setData(next);
    const soloTexto = Object.keys(patch).every((k) => CAMPOS_TEXTO.includes(k));
    encolar(id, row, next, soloTexto && getModo() === "db" ? 600 : 0);
  };

  const remove = (id) =>
    commit(
      {
        ...data,
        tareas: todas.filter((t) => t.id !== id),
        bloqueos: bloqueos.filter((b) => b.bloqueante !== id && b.bloqueada !== id),
      },
      [{ tipo: "tarea", accion: "delete", id }]
    );

  /* ── dependencias ── */

  const vincular = (bloqueante, bloqueada) => {
    if (creaCiclo(bloqueos, bloqueante, bloqueada)) {
      avisar("No se puede: cerraría un ciclo de dependencias");
      return;
    }
    if (bloqueos.some((b) => b.bloqueante === bloqueante && b.bloqueada === bloqueada)) return;
    const row = { bloqueante, bloqueada };
    commit({ ...data, bloqueos: [...bloqueos, row] }, [{ tipo: "bloqueo", accion: "upsert", row }]);
  };

  const desvincular = (bloqueante, bloqueada) => {
    const row = { bloqueante, bloqueada };
    commit(
      { ...data, bloqueos: bloqueos.filter((b) => !(b.bloqueante === bloqueante && b.bloqueada === bloqueada)) },
      [{ tipo: "bloqueo", accion: "delete", row }]
    );
  };

  const addItem = (draft) => {
    const maxItem = items.reduce((m, i) => Math.max(m, i.item || 0), 0);
    const maxOrden = items.reduce((m, i) => Math.max(m, i.orden || 0), 0);
    const row = {
      id: uid(),
      lista,
      item: maxItem + 1,
      orden: maxOrden + 100,
      fecha: hoyISO(),
      vence: draft.vence || "",
      area: draft.area || "Sin asignar",
      subarea: draft.subarea || "",
      equipo: draft.equipo || "",
      desc: draft.desc,
      doc: "",
      urg: Number(draft.urg) || 2,
      resp: unirResp(draft.resps || []),
      estado: "pendiente",
      planteado: false,
      via: "",
      nota: "",
    };
    commit({ ...data, tareas: [...todas, row] }, [{ tipo: "tarea", accion: "upsert", row }]);
    setAdding(false);
    setOpen(row.id);
  };

  /* ── reordenar ──────────────────────────────────────────────────────
     El orden vive en el campo `orden` y solo lo tocan estas funciones.
     Se trabaja sobre el grupo COMPLETO del área, pero la referencia la dan
     las filas que el usuario tiene a la vista: con filtros puestos, la fila
     cae donde la ve caer.

     Los `orden` son globales dentro de la lista, no por área: las filas de
     un área están salpicadas entre las de las otras. Por eso el grupo se
     reordena REUSANDO los mismos valores de `orden` que ya ocupaba, en vez
     de renumerarlos de a 100. Así el área conserva sus lugares en el orden
     global y no pisa a ninguna otra; lo único que cambia es quién ocupa
     cada lugar. */
  const colocar = (id, refId, antes) => {
    const t = todas.find((x) => x.id === id);
    if (!t || id === refId) return;
    const area = t.area || "";
    const grupo = items
      .filter((x) => (x.area || "") === area)
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || (a.item ?? 0) - (b.item ?? 0));
    const sin = grupo.filter((x) => x.id !== id);
    const k = sin.findIndex((x) => x.id === refId);
    if (k < 0) return;
    const pos = antes ? k : k + 1;
    const nuevo = [...sin.slice(0, pos), t, ...sin.slice(pos)];

    /* Los lugares que el grupo ya ocupaba, de menor a mayor. Si venían
       empatados (quedaron ceros de la carga vieja), se separan de a 1, que
       entra de sobra entre dos lugares reales. */
    const huecos = grupo.map((x) => x.orden ?? 0).sort((a, b) => a - b);
    for (let n = 1; n < huecos.length; n++) {
      if (huecos[n] <= huecos[n - 1]) huecos[n] = huecos[n - 1] + 1;
    }

    const mapa = {};
    const ops = [];
    nuevo.forEach((x, n) => {
      const orden = huecos[n];
      if (x.orden === orden) return;
      const row = { ...x, orden };
      mapa[x.id] = row;
      ops.push({ tipo: "tarea", accion: "upsert", row });
    });
    if (!ops.length) return;
    commit({ ...data, tareas: todas.map((x) => mapa[x.id] || x) }, ops);
  };

  /* Las flechas mueven un lugar respecto de lo que se ve, no de la lista
     completa: si un filtro esconde la fila de al lado, «subir» la saltea.
     Es lo que espera cualquiera que esté mirando la pantalla. */
  const mover = (id, dir) => {
    const t = todas.find((x) => x.id === id);
    if (!t) return;
    const vis = visibles.filter((x) => (x.area || "") === (t.area || ""));
    const i = vis.findIndex((x) => x.id === id);
    if (i < 0) return;
    const j = dir === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= vis.length) return;
    colocar(id, vis[j].id, dir === "up");
  };

  /* Arrastrar para reordenar. Va con pointer events y no con la API de
     drag & drop del navegador, que en el celular directamente no existe.
     El arrastre arranca solo desde la manija, así el dedo sigue pudiendo
     scrollear la lista en cualquier otro lado de la fila. */
  const [arrastre, setArrastre] = useState(null);
  const arrRef = useRef(null);
  const flotaRef = useRef(null);

  const dragInicio = (e, it) => {
    e.preventDefault();
    e.stopPropagation();
    document.body.style.userSelect = "none";
    /* La caja de la fila al momento de agarrarla: con eso la copia flotante
       arranca exactamente encima del original, y `agarre` guarda a qué altura
       de la fila la agarró el dedo, para que no salte al empezar. */
    const fila = e.currentTarget.closest("[data-fila='1']");
    const r = fila ? fila.getBoundingClientRect() : null;
    arrRef.current = {
      id: it.id,
      area: it.area || "",
      sobre: null,
      antes: false,
      caja: r ? { top: r.top, left: r.left, width: r.width } : null,
      agarre: r ? e.clientY - r.top : 0,
    };
    setArrastre(arrRef.current);
    window.addEventListener("pointermove", onMoveWin);
    window.addEventListener("pointerup", onUpWin);
    window.addEventListener("pointercancel", onUpWin);
  };

  /* Dónde caería la fila si soltara acá. Se mide con offsetTop y no con
     getBoundingClientRect porque las filas están animándose mientras tanto:
     el rect devuelve la posición a mitad de animación y el destino saltaría
     solo. offsetTop es la posición de layout, que no se mueve. */
  const dragMueve = (e) => {
    const d = arrRef.current;
    if (!d) return;
    /* La copia flotante sigue al dedo en cada movimiento. Se mueve tocando el
       style directo y no el estado de React: son decenas de eventos por
       segundo y no hace falta volver a dibujar la lista entera por cada uno.
       El estado solo cambia cuando cambia el lugar de destino. */
    if (flotaRef.current && d.caja) {
      flotaRef.current.style.transform = `translateY(${e.clientY - d.agarre - d.caja.top}px)`;
    }
    const todasFilas = document.querySelectorAll("[data-fila='1']");
    const otras = [];
    todasFilas.forEach((el) => {
      if (el.getAttribute("data-area") !== d.area) return;
      if (el.getAttribute("data-tid") === d.id) return;
      otras.push(el);
    });
    if (!otras.length) return;
    const cont = otras[0].offsetParent;
    if (!cont) return;
    const y = e.clientY - cont.getBoundingClientRect().top;

    let sobre = null;
    let antes = false;
    for (const el of otras) {
      if (y < el.offsetTop + el.offsetHeight / 2) {
        sobre = el.getAttribute("data-tid");
        antes = true;
        break;
      }
    }
    if (!sobre) {
      sobre = otras[otras.length - 1].getAttribute("data-tid");
      antes = false;
    }
    if (d.sobre === sobre && d.antes === antes) return;
    arrRef.current = { ...d, sobre, antes };
    setArrastre(arrRef.current);
  };

  const dragFin = () => {
    const d = arrRef.current;
    if (!d) return;
    arrRef.current = null;
    setArrastre(null);
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", onMoveWin);
    window.removeEventListener("pointerup", onUpWin);
    window.removeEventListener("pointercancel", onUpWin);
    if (d.sobre) colocar(d.id, d.sobre, d.antes);
  };

  /* Los listeners van en window y no en la manija. Al reordenar la lista en
     vivo, React mueve el nodo de la fila dentro del DOM, y mover un nodo
     cancela el pointer capture sin avisar: el arrastre se moría en el primer
     salto y el soltar nunca llegaba. Atado a window sobrevive a cualquier
     reordenamiento. Los refs mantienen una identidad estable para poder
     desengancharlos, apuntando siempre a la versión más nueva. */
  const vivos = useRef({});
  vivos.current.mueve = dragMueve;
  vivos.current.fin = dragFin;
  const onMoveWin = useRef((e) => vivos.current.mueve(e)).current;
  const onUpWin = useRef(() => vivos.current.fin()).current;

  useEffect(() => () => {
    window.removeEventListener("pointermove", onMoveWin);
    window.removeEventListener("pointerup", onUpWin);
    window.removeEventListener("pointercancel", onUpWin);
  }, [onMoveWin, onUpWin]);

  /* ── mutaciones del catálogo ── */

  const catCommit = (nuevosCat, tareasTocadas, opsExtra = []) => {
    const mapa = Object.fromEntries(tareasTocadas.map((t) => [t.id, t]));
    const next = {
      catalogo: nuevosCat,
      tareas: todas.map((t) => mapa[t.id] || t),
    };
    commit(next, [
      ...opsExtra,
      ...tareasTocadas.map((row) => ({ tipo: "tarea", accion: "upsert", row })),
    ]);
  };

  const catAdd = (tipo, nombre, padre = "") => {
    const nombreLimpio = nombre.trim();
    if (!nombreLimpio) return;
    const hermanos = cat.filter((c) => c.tipo === tipo && c.padre === padre);
    if (hermanos.some((c) => c.nombre.toLowerCase() === nombreLimpio.toLowerCase())) return;
    const row = {
      id: uid(),
      tipo,
      nombre: nombreLimpio,
      padre,
      orden: hermanos.reduce((m, c) => Math.max(m, c.orden), 0) + 100,
    };
    catCommit([...cat, row], [], [{ tipo: "cat", accion: "upsert", row }]);
  };

  const catRename = (id, nombre) => {
    const c = cat.find((x) => x.id === id);
    const nuevo = nombre.trim();
    if (!c || !nuevo || nuevo === c.nombre) return;

    const row = { ...c, nombre: nuevo };
    let nuevosCat = cat.map((x) => (x.id === id ? row : x));
    const ops = [{ tipo: "cat", accion: "upsert", row }];
    let tocadas = [];

    if (c.tipo === "area") {
      const hijos = cat.filter((x) => x.tipo === "subarea" && x.padre === c.nombre);
      hijos.forEach((h) => {
        const hr = { ...h, padre: nuevo };
        nuevosCat = nuevosCat.map((x) => (x.id === h.id ? hr : x));
        ops.push({ tipo: "cat", accion: "upsert", row: hr });
      });
      tocadas = todas.filter((t) => t.area === c.nombre).map((t) => ({ ...t, area: nuevo }));
    } else if (c.tipo === "subarea") {
      tocadas = todas
        .filter((t) => t.area === c.padre && t.subarea === c.nombre)
        .map((t) => ({ ...t, subarea: nuevo }));
    } else {
      const L = c.tipo === "resp_ext" ? "externos" : "internos";
      tocadas = todas
        .filter((t) => t.lista === L && tieneResp(t, c.nombre))
        .map((t) => ({ ...t, resp: unirResp(partirResp(t.resp).map((r) => (r === c.nombre ? nuevo : r))) }));
    }
    catCommit(nuevosCat, tocadas, ops);
  };

  const catDelete = (id) => {
    const c = cat.find((x) => x.id === id);
    if (!c) return;

    let usadas = [];
    if (c.tipo === "area") usadas = todas.filter((t) => t.area === c.nombre);
    else if (c.tipo === "subarea") usadas = todas.filter((t) => t.area === c.padre && t.subarea === c.nombre);
    else {
      const L = c.tipo === "resp_ext" ? "externos" : "internos";
      usadas = todas.filter((t) => t.lista === L && tieneResp(t, c.nombre));
    }

    const detalle =
      usadas.length > 0
        ? `\n\n${usadas.length} pendiente(s) usan «${c.nombre}». No se borran: quedan ${
            c.tipo === "area" ? 'en "Sin asignar"' : "sin ese valor"
          }.`
        : "";
    if (!window.confirm(`¿Eliminar «${c.nombre}» del catálogo?${detalle}`)) return;

    const aBorrar = [c.id];
    if (c.tipo === "area") {
      cat.filter((x) => x.tipo === "subarea" && x.padre === c.nombre).forEach((x) => aBorrar.push(x.id));
    }
    const nuevosCat = cat.filter((x) => !aBorrar.includes(x.id));
    const ops = aBorrar.map((i) => ({ tipo: "cat", accion: "delete", id: i }));

    const tocadas = usadas.map((t) =>
      c.tipo === "area"
        ? { ...t, area: "Sin asignar", subarea: "" }
        : c.tipo === "subarea"
        ? { ...t, subarea: "" }
        : { ...t, resp: unirResp(partirResp(t.resp).filter((r) => r !== c.nombre)) }
    );
    catCommit(nuevosCat, tocadas, ops);
  };

  /* ── derivados ── */

  const conteos = useMemo(() => {
    const c = { pendiente: 0, curso: 0, probar: 0, resuelto: 0, u1: 0, vencidas: 0, bloqueadas: 0 };
    items.forEach((i) => {
      c[i.estado] = (c[i.estado] || 0) + 1;
      if (i.urg === 1 && i.estado !== "resuelto") c.u1++;
      if (estaVencida(i)) c.vencidas++;
      if (estaBloqueada(i, todas, bloqueos)) c.bloqueadas++;
    });
    return c;
  }, [items, todas, bloqueos]);

  const abiertosInt = todas.filter((i) => i.lista === "internos" && i.estado !== "resuelto").length;
  const abiertosExt = todas.filter((i) => i.lista === "externos" && i.estado !== "resuelto").length;

  /* EL ORDEN NO DEPENDE DEL ESTADO. Solo del campo `orden`, que únicamente
     cambian las flechas de mover. Cambiar estado, urgencia o responsable
     deja la fila exactamente donde estaba. */
  const visibles = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items
      .filter((i) => {
        if (fEstado === "abiertos" && i.estado === "resuelto") return false;
        if (fEstado !== "abiertos" && fEstado !== "" && i.estado !== fEstado) return false;
        if (fArea && i.area !== fArea) return false;
        if (fResp && !tieneResp(i, fResp)) return false;
        if (soloVencidas && !estaVencida(i)) return false;
        if (soloBloqueadas && !estaBloqueada(i, todas, bloqueos)) return false;
        if (t) {
          const hay = [i.desc, i.area, i.subarea, i.equipo, i.resp, i.doc, i.nota, "#" + i.item]
            .join(" ")
            .toLowerCase();
          if (!hay.includes(t)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0) || (a.item ?? 0) - (b.item ?? 0));
  }, [items, q, fArea, fResp, fEstado, soloVencidas, soloBloqueadas, todas, bloqueos]);

  const grupos = useMemo(() => {
    const m = new Map();
    visibles.forEach((i) => {
      const k = i.area || "Sin asignar";
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(i);
    });
    const rank = new Map(areas.map((a, n) => [a.nombre, n]));
    return [...m.entries()].sort(
      (a, b) => (rank.has(a[0]) ? rank.get(a[0]) : 999) - (rank.has(b[0]) ? rank.get(b[0]) : 999) ||
        a[0].localeCompare(b[0])
    );
  }, [visibles, areas]);

  /* Mientras se arrastra, la lista se muestra YA reordenada: la fila viaja
     con el cursor y las demás se corren para hacerle lugar. Es una vista
     previa, no toca los datos; recién al soltar se escribe. */
  const gruposVista = useMemo(() => {
    if (!arrastre || !arrastre.sobre) return grupos;
    return grupos.map(([area, arr]) => {
      const t = arr.find((x) => x.id === arrastre.id);
      if (!t) return [area, arr];
      const sin = arr.filter((x) => x.id !== arrastre.id);
      const k = sin.findIndex((x) => x.id === arrastre.sobre);
      if (k < 0) return [area, arr];
      const pos = arrastre.antes ? k : k + 1;
      return [area, [...sin.slice(0, pos), t, ...sin.slice(pos)]];
    });
  }, [grupos, arrastre]);

  /* FLIP: se anota dónde estaba cada fila, y cuando cambian de lugar se las
     anima desde la posición vieja a la nueva. Sin esto las filas saltan de
     golpe y el arrastre se siente duro. Solo corre mientras hay arrastre. */
  const posRef = useRef(null);
  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    if (!arrastre) { posRef.current = null; return; }
    const filas = document.querySelectorAll("[data-fila='1']");
    const ahora = new Map();
    filas.forEach((el) => ahora.set(el.getAttribute("data-tid"), el.getBoundingClientRect().top));
    const antes = posRef.current;
    posRef.current = ahora;
    if (!antes) return;
    filas.forEach((el) => {
      const id = el.getAttribute("data-tid");
      const y0 = antes.get(id);
      const y1 = ahora.get(id);
      if (y0 === undefined || Math.abs(y0 - y1) < 1) return;
      if (typeof el.animate !== "function") return;
      el.animate(
        [{ transform: `translateY(${y0 - y1}px)` }, { transform: "translateY(0)" }],
        { duration: 130, easing: "cubic-bezier(.2,.8,.3,1)" }
      );
    });
  }, [gruposVista, arrastre]);

  const filaArrastrada = useMemo(
    () => (arrastre ? todas.find((x) => x.id === arrastre.id) : null),
    [arrastre, todas]
  );

  const bordes = useMemo(() => {
    /* primero/último de cada área ENTRE LAS FILAS VISIBLES: la flecha se
       apaga según lo que hay en pantalla, no según la lista completa. */
    const m = {};
    grupos.forEach(([, arr]) => {
      arr.forEach((i, n) => {
        m[i.id] = { primero: n === 0, ultimo: n === arr.length - 1 };
      });
    });
    return m;
  }, [grupos]);

  const exportar = () => {
    const cab = ["Lista", "Item", "Orden", "Fecha", "Fecha limite", "Area", "Sub-area", "Equipo", "Descripcion", "Documento", "Urgencia", "Responsables", "Estado", "Bloqueada por", "Bloquea a", "Planteado", "Via", "Notas"];
    const porId = new Map(todas.map((t) => [t.id, t]));
    const refs = (ids) => ids.map((id) => refDe(porId.get(id))).join(" ");
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const filas = [...todas]
      .sort((a, b) => a.lista.localeCompare(b.lista) || a.orden - b.orden)
      .map((i) =>
        [i.lista, i.item, i.orden, i.fecha, i.vence || "", i.area, i.subarea, i.equipo, i.desc, i.doc, i.urg, i.resp,
         (ESTADOS[i.estado] || {}).label || i.estado,
         refs(bloqueantesDe(i.id, bloqueos)), refs(bloqueadasPor(i.id, bloqueos)),
         i.lista === "externos" ? (i.planteado ? "Si" : "No") : "",
         i.via, i.nota].map(esc).join(",")
      );
    const csv = "\uFEFF" + [cab.map(esc).join(","), ...filas].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "NCH1-Cadlan-pendientes.csv";
    a.click();
    URL.revokeObjectURL(url);
  };


  if (!data) {
    return (
      <div className="nch">
        <div className="wrap" style={{ paddingTop: 40, color: "#5F717B" }}>Cargando pendientes…</div>
      </div>
    );
  }

  const modo = getModo();

  return (
    <div className="nch">
      <header className="hd">
        <div className="hd-in">
          <div className="hd-top">
            <div>
              <div className="proj">NCH1 <span>·</span> Cadlan <span>· pendientes BMS</span></div>
              <div className="sub">
                {abiertosInt + abiertosExt} pendientes abiertos{" "}
                <span className={"badge " + (modo === "db" ? "db" : "local")} style={{ marginLeft: 8 }}>
                  {modo === "db" ? "base compartida" : "solo este navegador"}
                </span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn" onClick={() => setMgr(!mgr)} title="Áreas, sub-áreas y responsables">
                <SlidersHorizontal size={13} /> Catálogo
              </button>
              <button className="btn" onClick={refrescar} title="Traer los últimos cambios">
                <RefreshCw size={13} className={refrescando ? "spin" : ""} />
              </button>
              <button className="btn" onClick={exportar}><Download size={13} /> CSV</button>
              <button className="btn pri" onClick={() => window.open("/api/reporte/pdf?dias=7", "_blank")}
                title="Informe semanal en PDF, con los datos de los últimos 7 días">
                <FileText size={13} /> Informe PDF
              </button>
            </div>
          </div>
          <nav className="tabs">
            <button className={"tab" + (tab === "internos" ? " on" : "")} onClick={() => { setTab("internos"); setOpen(null); setFArea(""); setFResp(""); }}>
              Internos <b>{abiertosInt}</b>
            </button>
            <button className={"tab" + (tab === "externos" ? " on" : "")} onClick={() => { setTab("externos"); setOpen(null); setFArea(""); setFResp(""); }}>
              Externos <b>{abiertosExt}</b>
            </button>
            <button className={"tab" + (tab === "gantt" ? " on" : "")} onClick={() => { setTab("gantt"); setOpen(null); }}>
              Gantt
            </button>
            <button className={"tab" + (tab === "malla" ? " on" : "")} onClick={() => { setTab("malla"); setOpen(null); }}>
              Malla <b>{bloqueos.length}</b>
            </button>
          </nav>
        </div>
      </header>

      <div className="wrap">
        {aviso && (
          <p className="note" style={{ marginTop: 14, color: "#8A5D07" }}>
            {aviso} Conectá una base Postgres (Neon) al proyecto en Vercel para que MM, GZ y JM vean lo mismo.
          </p>
        )}

        {vista === "gantt" && <Gantt tareas={todas} bloqueos={bloqueos} areas={areas} onIr={irA} />}
        {vista === "malla" && <Malla tareas={todas} bloqueos={bloqueos} onIr={irA} />}

        {vista === "lista" && (<>
        <div className="board">
          <div className="cell"><div className="n" style={{ color: ESTADOS.pendiente.color }}>{conteos.pendiente}</div><div className="l">Pendientes</div></div>
          <div className="cell"><div className="n" style={{ color: ESTADOS.curso.color }}>{conteos.curso}</div><div className="l">En curso</div></div>
          <div className="cell"><div className="n" style={{ color: ESTADOS.probar.color }}>{conteos.probar}</div><div className="l">A probar</div></div>
          <div className="cell"><div className="n" style={{ color: ESTADOS.resuelto.color }}>{conteos.resuelto}</div><div className="l">Resueltos</div></div>
          <div className="cell"><div className="n">{conteos.u1}</div><div className="l">Urgencia 1 sin cerrar</div></div>
          <div className="cell"><div className="n" style={{ color: conteos.vencidas > 0 ? "#C0353B" : undefined }}>{conteos.vencidas}</div><div className="l">Fuera de fecha</div></div>
          <div className="cell"><div className="n" style={{ color: conteos.bloqueadas > 0 ? "#7A4FA8" : undefined }}>{conteos.bloqueadas}</div><div className="l">Bloqueadas</div></div>
        </div>

        {mgr && (
          <Catalogo
            cat={cat}
            tareas={todas}
            lista={lista}
            onAdd={catAdd}
            onRename={catRename}
            onDelete={catDelete}
            onClose={() => setMgr(false)}
          />
        )}

        <div className="bar">
          <div className="find">
            <Search size={14} />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en descripción, equipo, documento…" />
          </div>
          <select className="sel" value={fEstado} onChange={(e) => setFEstado(e.target.value)}>
            <option value="">Todos los estados</option>
            <option value="abiertos">Sin cerrar</option>
            {ORDEN_ESTADO.map((k) => <option key={k} value={k}>{ESTADOS[k].label}</option>)}
          </select>
          <select className="sel" value={fArea} onChange={(e) => setFArea(e.target.value)}>
            <option value="">Todas las áreas</option>
            {areas.map((a) => <option key={a.id} value={a.nombre}>{a.nombre}</option>)}
          </select>
          <select className="sel" value={fResp} onChange={(e) => setFResp(e.target.value)}>
            <option value="">Todos los responsables</option>
            {resps.map((r) => <option key={r.id} value={r.nombre}>{r.nombre}</option>)}
          </select>
          <button className={"btn" + (soloVencidas ? " on" : "")} onClick={() => setSoloVencidas(!soloVencidas)}
            title="Mostrar solo las que pasaron su fecha límite">
            <CalendarClock size={13} /> Vencidas
          </button>
          <button className={"btn" + (soloBloqueadas ? " on" : "")} onClick={() => setSoloBloqueadas(!soloBloqueadas)}
            title="Mostrar solo las que esperan por otro pendiente">
            <Ban size={13} /> Bloqueadas
          </button>
          <button className="btn pri" onClick={() => setAdding(true)}><Plus size={13} /> Agregar</button>
        </div>

        {adding && (
          <AddForm
            onCancel={() => setAdding(false)}
            onSave={addItem}
            areas={areas}
            subareasDe={subareasDe}
            resps={resps}
            externo={lista === "externos"}
          />
        )}

        {visibles.length === 0 ? (
          <div className="empty">
            Ningún pendiente coincide con estos filtros.<br />
            <button className="btn" style={{ marginTop: 12 }} onClick={() => { setQ(""); setFArea(""); setFResp(""); setFEstado(""); setSoloVencidas(false); setSoloBloqueadas(false); }}>Limpiar filtros</button>
          </div>
        ) : (
          gruposVista.map(([area, list]) => (
            <section className="grp" key={area}>
              <div className="grp-hd">
                <h3>{area}</h3>
                <span className="c">{list.filter((i) => i.estado !== "resuelto").length} sin cerrar de {list.length}</span>
              </div>
              <div className="rows">
                {list.map((it) => (
                  <Item
                    key={it.id}
                    it={it}
                    externo={lista === "externos"}
                    open={open === it.id}
                    borde={bordes[it.id] || {}}
                    areas={areas}
                    subareas={subareasDe(it.area)}
                    resps={resps}
                    todas={todas}
                    bloqueos={bloqueos}
                    onOpen={() => setOpen(open === it.id ? null : it.id)}
                    onChange={(p) => update(it.id, p)}
                    onDelete={() => remove(it.id)}
                    onMover={(d) => mover(it.id, d)}
                    arrastrando={!!arrastre && arrastre.id === it.id}
                    onDragInicio={(e) => dragInicio(e, it)}
                    onVincular={vincular}
                    onDesvincular={desvincular}
                    onIr={irA}
                  />
                ))}
              </div>
            </section>
          ))
        )}

        {/* La fila que se está moviendo, despegada de la lista y pegada al
            dedo. En la lista queda el hueco gris marcando dónde va a caer. */}
        {arrastre && arrastre.caja && filaArrastrada && (
          <div className="flotante" ref={flotaRef}
            style={{ top: arrastre.caja.top, left: arrastre.caja.left, width: arrastre.caja.width }}>
            <div className="rows">
              <Item
                fantasma
                it={filaArrastrada}
                externo={lista === "externos"}
                open={false}
                borde={{}}
                areas={areas}
                subareas={subareasDe(filaArrastrada.area)}
                resps={resps}
                todas={todas}
                bloqueos={bloqueos}
                onOpen={() => {}}
                onChange={() => {}}
                onDelete={() => {}}
                onMover={() => {}}
                onDragInicio={() => {}}
                onVincular={() => {}}
                onDesvincular={() => {}}
                onIr={() => {}}
              />
            </div>
          </div>
        )}

        <p className="note">
          {lista === "internos"
            ? "Trabajo del equipo propio. El orden se cambia arrastrando una fila desde la manija de la derecha, o con las flechas de a un lugar; siempre dentro de la misma área. Cambiar estado, urgencia o responsable no mueve nada de lugar. Una tarea «bloqueada» espera a que se resuelva otra; se vincula desde el detalle."
            : "Dependencias de terceros. «Planteado» indica si ya se le pasó formalmente al responsable externo; los días abiertos cuentan desde la fecha en que se detectó."}
        </p>
        </>)}
      </div>

      {flash && <div className="saving">{flash}</div>}
    </div>
  );
}

/* ─────────────────────────── fila ─────────────────────────── */

function Selector({ value, opciones, onChange, vacio = "—" }) {
  const nombres = opciones.map((o) => o.nombre);
  const extra = value && !nombres.includes(value) ? [value] : [];
  return (
    <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
      <option value="">{vacio}</option>
      {opciones.map((o) => <option key={o.id} value={o.nombre}>{o.nombre}</option>)}
      {extra.map((v) => <option key={"extra-" + v} value={v}>{v} (fuera del catálogo)</option>)}
    </select>
  );
}

/* Varios responsables: cada nombre del catálogo es un botón que se prende o
   apaga. Un valor fuera del catálogo se muestra igual, con su cruz. */
function Responsables({ value, opciones, onChange, vacio = "Sin asignar" }) {
  const sel = partirResp(value);
  const nombres = opciones.map((o) => o.nombre);
  const extra = sel.filter((v) => !nombres.includes(v));
  const toggle = (n) => onChange(unirResp(sel.includes(n) ? sel.filter((x) => x !== n) : [...sel, n]));
  return (
    <div className="chips">
      {opciones.map((o) => (
        <button key={o.id} type="button" className={"chip" + (sel.includes(o.nombre) ? " on" : "")}
          onClick={() => toggle(o.nombre)} aria-pressed={sel.includes(o.nombre)}>
          {o.nombre}
        </button>
      ))}
      {extra.map((v) => (
        <button key={"x-" + v} type="button" className="chip on ext" onClick={() => toggle(v)} title="Fuera del catálogo; clic para quitar">
          {v} <X size={10} />
        </button>
      ))}
      {sel.length === 0 && <span className="chip-vacio">{vacio}</span>}
    </div>
  );
}

function DepFila({ t, onQuitar, onIr }) {
  const e = ESTADOS[t.estado] || ESTADOS.pendiente;
  const ext = t.lista === "externos";
  return (
    <div className="dep">
      <button type="button" className="dep-ref mono" onClick={() => onIr(t.id)} title="Ir a este pendiente">{refDe(t)}</button>
      <span className={"dep-tipo " + (ext ? "ext" : "int")} title={ext ? "Depende de un tercero: " + (t.resp || "sin responsable") : "Pendiente del equipo propio"}>
        {ext ? "externo" + (t.resp ? " · " + partirResp(t.resp)[0] : "") : "interno"}
      </span>
      <span className={"dep-desc" + (t.estado === "resuelto" ? " done" : "")}>{t.desc}</span>
      <span className="pill" style={{ color: e.color, borderColor: e.color + "55" }}>{e.label}</span>
      <button type="button" className="mini" onClick={onQuitar} title="Quitar vínculo"><X size={12} /></button>
    </div>
  );
}

function DepBuscador({ valor, setValor, lista, placeholder, onElegir }) {
  return (
    <div className="dep-add">
      <input value={valor} onChange={(e) => setValor(e.target.value)} placeholder={placeholder} />
      {valor.trim() && (
        <div className="dep-sug">
          {lista.length === 0 && <div className="dep-nada">Sin coincidencias (o el vínculo cerraría un ciclo).</div>}
          {lista.map((x) => (
            <button type="button" key={x.id} className="dep-opt" onClick={() => { onElegir(x.id); setValor(""); }}>
              <span className="mono">{refDe(x)}</span> {x.desc}
              <span className="dep-est" style={{ color: (ESTADOS[x.estado] || ESTADOS.pendiente).color }}>{(ESTADOS[x.estado] || ESTADOS.pendiente).label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* Editor de dependencias: lista de tareas vinculadas con su estado, y un
   buscador para agregar otra (de cualquiera de las dos listas). */
function Dependencias({ it, todas, bloqueos, onVincular, onDesvincular, onIr }) {
  const [qB, setQB] = useState("");
  const [qA, setQA] = useState("");
  const porId = useMemo(() => new Map(todas.map((t) => [t.id, t])), [todas]);
  const bloqueantes = bloqueantesDe(it.id, bloqueos).map((id) => porId.get(id)).filter(Boolean);
  const bloqueadas = bloqueadasPor(it.id, bloqueos).map((id) => porId.get(id)).filter(Boolean);

  const candidatos = (texto, excluir, direccion) => {
    const t = texto.trim().toLowerCase();
    if (!t) return [];
    return todas
      .filter((x) => x.id !== it.id && !excluir.includes(x.id))
      .filter((x) => {
        const hay = [refDe(x), "#" + x.item, x.desc, x.equipo, x.area, x.subarea].join(" ").toLowerCase();
        return hay.includes(t);
      })
      .filter((x) => (direccion === "bloqueante" ? !creaCiclo(bloqueos, x.id, it.id) : !creaCiclo(bloqueos, it.id, x.id)))
      .sort((a, b) => (a.estado === "resuelto") - (b.estado === "resuelto") || a.lista.localeCompare(b.lista) || a.item - b.item)
      .slice(0, 12);
  };

  const activas = bloqueantesActivas(it, todas, bloqueos).length;

  return (
    <div className="deps">
      <div className="dep-col">
        <h4>
          Bloqueada por
          {activas > 0 && <span className="dep-warn"> · esperando {activas} {activas === 1 ? "pendiente" : "pendientes"}</span>}
        </h4>
        <p className="hint">Hay que terminar estas antes de poder avanzar con esta.</p>
        {bloqueantes.map((t) => <DepFila key={t.id} t={t} onIr={onIr} onQuitar={() => onDesvincular(t.id, it.id)} />)}
        <DepBuscador valor={qB} setValor={setQB} lista={candidatos(qB, bloqueantes.map((t) => t.id), "bloqueante")}
          placeholder="Agregar: número (I12, E3) o texto…" onElegir={(id) => onVincular(id, it.id)} />
      </div>
      <div className="dep-col">
        <h4>Bloquea a</h4>
        <p className="hint">Estas no pueden avanzar hasta que esta se resuelva.</p>
        {bloqueadas.map((t) => <DepFila key={t.id} t={t} onIr={onIr} onQuitar={() => onDesvincular(it.id, t.id)} />)}
        <DepBuscador valor={qA} setValor={setQA} lista={candidatos(qA, bloqueadas.map((t) => t.id), "bloqueada")}
          placeholder="Agregar: número (I12, E3) o texto…" onElegir={(id) => onVincular(it.id, id)} />
      </div>
    </div>
  );
}

function Item({ it, open, onOpen, onChange, onDelete, onMover, externo, borde, areas, subareas, resps, todas, bloqueos, onVincular, onDesvincular, onIr, arrastrando, onDragInicio, fantasma }) {
  const est = ESTADOS[it.estado] || ESTADOS.pendiente;
  const dias = diasAbierto(it.fecha);
  const viejo = it.estado !== "resuelto" && dias !== null && dias > 21;
  const venc = venceInfo(it.vence, it.estado);
  const porId = new Map(todas.map((t) => [t.id, t]));
  const esperando = bloqueantesActivas(it, todas, bloqueos);
  const bloqueaA = bloqueadasPor(it.id, bloqueos).map((id) => porId.get(id)).filter((t) => t && t.estado !== "resuelto");

  return (
    <div
      data-tid={fantasma ? undefined : it.id}
      data-area={fantasma ? undefined : it.area || ""}
      data-fila={fantasma ? undefined : "1"}
      className={"fila" + (arrastrando ? " hueco" : "")}
    >
      <div className="rowwrap">
        <button className="row" onClick={onOpen} aria-expanded={open}>
          <div className="edge" style={{ background: est.color }} />
          <div className="rowbody">
            <div className={"urg u" + it.urg} title={"Urgencia " + it.urg}>{it.urg}</div>
            <div className="main">
              <div className={"desc" + (it.estado === "resuelto" ? " done" : "")}>{it.desc}</div>
              <div className="meta">
                <span className="mono">#{it.item}</span>
                {it.subarea && <span>{it.subarea}</span>}
                {it.equipo && <span>{it.equipo}</span>}
                {it.resp && <span className="who">{partirResp(it.resp).join(" · ")}</span>}
                <span>{fmtFecha(it.fecha)}</span>
                {venc && <span className={venc.c}>{venc.t}</span>}
                {viejo && <span className="old">{dias} días abierto</span>}
                {externo && !it.planteado && <span className="old">sin plantear</span>}
                {esperando.filter((t) => t.lista === "internos").length > 0 && (
                  <span className="blk int" title={esperando.filter((t) => t.lista === "internos").map((t) => refDe(t) + " " + t.desc).join("\n")}>
                    <Ban size={10} /> bloqueo interno · {esperando.filter((t) => t.lista === "internos").map(refDe).join(", ")}
                  </span>
                )}
                {esperando.filter((t) => t.lista === "externos").length > 0 && (
                  <span className="blk ext" title={esperando.filter((t) => t.lista === "externos").map((t) => refDe(t) + " " + t.desc + " (" + (t.resp || "sin responsable") + ")").join("\n")}>
                    <Ban size={10} /> bloqueo externo · {esperando.filter((t) => t.lista === "externos").map((t) => refDe(t) + (t.resp ? " " + partirResp(t.resp)[0] : "")).join(", ")}
                  </span>
                )}
                {bloqueaA.length > 0 && it.estado !== "resuelto" && (
                  <span className="lnk" title={bloqueaA.map((t) => refDe(t) + " " + t.desc).join("\n")}>
                    <Link2 size={10} /> bloquea {bloqueaA.map(refDe).join(", ")}
                  </span>
                )}
              </div>
            </div>
            <div className="right">
              {esperando.length > 0 && (
                <span className={"pill blkpill" + (esperando.some((t) => t.lista === "externos") ? " ext" : "")}>
                  {esperando.some((t) => t.lista === "externos") ? "Bloqueo externo" : "Bloqueo interno"}
                </span>
              )}
              <span className="pill" style={{ color: est.color, borderColor: est.color + "55" }}>{est.label}</span>
              <ChevronRight size={15} className={"chev" + (open ? " open" : "")} />
            </div>
          </div>
        </button>
        <div className="ordcol">
          <button
            className="ordbtn manija"
            title="Arrastrar para cambiar el orden dentro del área"
            aria-label="Arrastrar para reordenar"
            onPointerDown={onDragInicio}
            onClick={(e) => e.stopPropagation()}
          >
            <GripVertical size={14} />
          </button>
          <button className="ordbtn" onClick={() => onMover("up")} disabled={borde.primero} title="Subir un lugar">
            <ChevronUp size={14} />
          </button>
          <button className="ordbtn" onClick={() => onMover("down")} disabled={borde.ultimo} title="Bajar un lugar">
            <ChevronDown size={14} />
          </button>
        </div>
      </div>

      {open && (
        <div className="det">
          <h4>Estado</h4>
          <div className="states">
            {ORDEN_ESTADO.map((k) => (
              <button key={k} className="st" onClick={() => onChange({ estado: k })}
                style={it.estado === k ? { background: ESTADOS[k].color + "22", borderColor: ESTADOS[k].color, color: ESTADOS[k].color } : undefined}>
                {ESTADOS[k].label}
              </button>
            ))}
          </div>

          {it.doc && <div className="docref">Referencia: {it.doc}</div>}

          <div className="fields">
            <div className="f" style={{ gridColumn: "1 / -1" }}>
              <label>Responsables (puede ser más de uno)</label>
              <Responsables value={it.resp} opciones={resps} onChange={(v) => onChange({ resp: v })} />
            </div>
            <div className="f">
              <label>Urgencia</label>
              <select value={it.urg} onChange={(e) => onChange({ urg: Number(e.target.value) })}>
                <option value={1}>1 – bloquea avance</option>
                <option value={2}>2 – importante</option>
                <option value={3}>3 – puede esperar</option>
              </select>
            </div>
            <div className="f">
              <label>Área</label>
              <Selector value={it.area} opciones={areas} onChange={(v) => onChange({ area: v, subarea: "" })} vacio="Sin asignar" />
            </div>
            <div className="f">
              <label>Sub-área</label>
              <Selector value={it.subarea} opciones={subareas} onChange={(v) => onChange({ subarea: v })} />
            </div>
            <div className="f">
              <label>Equipo</label>
              <input value={it.equipo} onChange={(e) => onChange({ equipo: e.target.value })} />
            </div>
            <div className="f">
              <label>Fecha de alta</label>
              <input type="date" value={it.fecha} onChange={(e) => onChange({ fecha: e.target.value })} />
            </div>
            <div className="f">
              <label>Fecha límite de entrega</label>
              <input type="date" value={it.vence || ""} onChange={(e) => onChange({ vence: e.target.value })} />
            </div>
            <div className="f">
              <label>Documento de referencia</label>
              <input value={it.doc} onChange={(e) => onChange({ doc: e.target.value })} />
            </div>
            {externo && (
              <>
                <div className="f">
                  <label>Planteado al tercero</label>
                  <select value={it.planteado ? "si" : "no"} onChange={(e) => onChange({ planteado: e.target.value === "si" })}>
                    <option value="si">Sí</option>
                    <option value="no">No</option>
                  </select>
                </div>
                <div className="f">
                  <label>Vía</label>
                  <input value={it.via || ""} onChange={(e) => onChange({ via: e.target.value })} placeholder="RFI, interno, mail…" />
                </div>
              </>
            )}
          </div>

          <div className="f" style={{ marginBottom: 14 }}>
            <label>Descripción</label>
            <textarea value={it.desc} onChange={(e) => onChange({ desc: e.target.value })} style={{ minHeight: 46 }} />
          </div>

          <div className="f" style={{ marginBottom: 14 }}>
            <label>Notas y seguimiento</label>
            <textarea value={it.nota} onChange={(e) => onChange({ nota: e.target.value })}
              placeholder="Qué se hizo, qué falta, con quién hay que hablar." />
          </div>

          <Dependencias it={it} todas={todas} bloqueos={bloqueos}
            onVincular={onVincular} onDesvincular={onDesvincular} onIr={onIr} />

          <button className="del" onClick={() => { if (window.confirm("¿Eliminar este pendiente?")) onDelete(); }}>
            <Trash2 size={12} /> Eliminar
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────── alta ─────────────────────────── */

function AddForm({ onCancel, onSave, areas, subareasDe, resps, externo }) {
  const [d, setD] = useState({ desc: "", area: "", subarea: "", equipo: "", resps: [], urg: 2, vence: "" });
  const set = (k) => (e) => setD({ ...d, [k]: e.target.value });
  const subs = d.area ? subareasDe(d.area) : [];

  return (
    <div style={{ background: "#F7FAFB", border: "1px solid #C7D2D8", borderRadius: 6, padding: 14, marginBottom: 18 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: 12.5, color: "#5F717B" }}>
          Nuevo pendiente {externo ? "externo" : "interno"}
        </h4>
        <button onClick={onCancel} style={{ color: "#8B9AA2" }}><X size={15} /></button>
      </div>
      <div className="f" style={{ marginBottom: 12 }}>
        <label>Descripción</label>
        <input autoFocus value={d.desc} onChange={set("desc")} placeholder="Qué hay que resolver" />
      </div>
      <div className="fields">
        <div className="f">
          <label>Área</label>
          <select value={d.area} onChange={(e) => setD({ ...d, area: e.target.value, subarea: "" })}>
            <option value="">Sin asignar</option>
            {areas.map((a) => <option key={a.id} value={a.nombre}>{a.nombre}</option>)}
          </select>
        </div>
        <div className="f">
          <label>Sub-área</label>
          <select value={d.subarea} onChange={set("subarea")} disabled={subs.length === 0}>
            <option value="">—</option>
            {subs.map((s) => <option key={s.id} value={s.nombre}>{s.nombre}</option>)}
          </select>
        </div>
        <div className="f"><label>Equipo</label><input value={d.equipo} onChange={set("equipo")} /></div>
        <div className="f" style={{ gridColumn: "1 / -1" }}>
          <label>Responsables (puede ser más de uno)</label>
          <Responsables value={unirResp(d.resps)} opciones={resps} onChange={(v) => setD({ ...d, resps: partirResp(v) })} />
        </div>
        <div className="f">
          <label>Urgencia</label>
          <select value={d.urg} onChange={set("urg")}>
            <option value={1}>1 – bloquea avance</option>
            <option value={2}>2 – importante</option>
            <option value={3}>3 – puede esperar</option>
          </select>
        </div>
        <div className="f">
          <label>Fecha límite de entrega</label>
          <input type="date" value={d.vence} onChange={set("vence")} />
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn pri" disabled={!d.desc.trim()} onClick={() => d.desc.trim() && onSave(d)}
          style={!d.desc.trim() ? { opacity: 0.45, cursor: "not-allowed" } : undefined}>
          Agregar pendiente
        </button>
        <button className="btn" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
