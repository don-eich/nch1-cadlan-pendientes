"use client";

import React, { useMemo, useState } from "react";
import { partirResp, refDe } from "../lib/comun.js";

/* Malla de dependencias: un grafo dirigido bloqueante → bloqueada.
   Los nodos se ubican en columnas por nivel (largo del camino más largo desde
   una tarea sin bloqueantes), así lo que traba queda a la izquierda y lo que
   espera a la derecha. */

const ESTADOS = {
  pendiente: { label: "Pendiente", color: "#C0353B" },
  curso: { label: "En curso", color: "#1C7CA3" },
  probar: { label: "A probar", color: "#A96C08" },
  resuelto: { label: "Resuelto", color: "#2E7D53" },
};
const W = 200, H = 52, GX = 70, GY = 14, PAD = 16;

export default function Malla({ tareas, bloqueos, onIr }) {
  const [conResueltas, setConResueltas] = useState(true);
  const [sel, setSel] = useState(null);

  const { nodos, aristas, cols, alto, ancho } = useMemo(() => {
    const porId = new Map(tareas.map((t) => [t.id, t]));
    let ar = bloqueos.filter((b) => porId.has(b.bloqueante) && porId.has(b.bloqueada));
    if (!conResueltas) ar = ar.filter((b) => porId.get(b.bloqueante).estado !== "resuelto" && porId.get(b.bloqueada).estado !== "resuelto");
    const ids = new Set();
    ar.forEach((b) => { ids.add(b.bloqueante); ids.add(b.bloqueada); });

    // nivel = camino más largo desde una fuente (Kahn)
    const entr = new Map([...ids].map((id) => [id, 0]));
    const sig = new Map([...ids].map((id) => [id, []]));
    ar.forEach((b) => { entr.set(b.bloqueada, entr.get(b.bloqueada) + 1); sig.get(b.bloqueante).push(b.bloqueada); });
    const nivel = new Map([...ids].map((id) => [id, 0]));
    const cola = [...ids].filter((id) => entr.get(id) === 0);
    while (cola.length) {
      const x = cola.shift();
      for (const y of sig.get(x)) {
        nivel.set(y, Math.max(nivel.get(y), nivel.get(x) + 1));
        entr.set(y, entr.get(y) - 1);
        if (entr.get(y) === 0) cola.push(y);
      }
    }
    const maxNivel = Math.max(0, ...nivel.values());
    const columnas = Array.from({ length: maxNivel + 1 }, () => []);
    [...ids].forEach((id) => columnas[nivel.get(id)].push(porId.get(id)));
    columnas.forEach((c) => c.sort((a, b) => (a.lista === "externos" ? 0 : 1) - (b.lista === "externos" ? 0 : 1) || (a.area || "").localeCompare(b.area || "") || a.item - b.item));
    // menos cruces: cada columna se reordena por la posición media de sus bloqueantes
    const prev = new Map([...ids].map((id) => [id, []]));
    ar.forEach((b) => prev.get(b.bloqueada).push(b.bloqueante));
    for (let i = 1; i < columnas.length; i++) {
      const idx = new Map(columnas[i - 1].map((t, j) => [t.id, j]));
      const bar = (t) => { const ps = prev.get(t.id).filter((x) => idx.has(x)); return ps.length ? ps.reduce((m, x) => m + idx.get(x), 0) / ps.length : 1e9; };
      columnas[i].sort((a, b) => bar(a) - bar(b) || a.item - b.item);
    }

    const pos = new Map();
    const altoMax = Math.max(1, ...columnas.map((c) => c.length)) * (H + GY) - GY;
    columnas.forEach((c, i) => {
      const altoCol = c.length * (H + GY) - GY;
      const y0 = PAD + (altoMax - altoCol) / 2;
      c.forEach((t, j) => pos.set(t.id, { x: PAD + i * (W + GX), y: y0 + j * (H + GY) }));
    });

    const frena = new Map([...ids].map((id) => [id, porId.get(id).estado === "resuelto" ? 0 : sig.get(id).filter((y) => porId.get(y).estado !== "resuelto").length]));
    const nodos = [...ids].map((id) => ({ t: porId.get(id), ...pos.get(id), frena: frena.get(id) }));
    return {
      nodos,
      aristas: ar.map((b) => ({ ...b, de: pos.get(b.bloqueante), a: pos.get(b.bloqueada), ext: porId.get(b.bloqueante).lista === "externos", res: porId.get(b.bloqueante).estado === "resuelto" })),
      cols: columnas.length,
      alto: altoMax + PAD * 2,
      ancho: PAD * 2 + columnas.length * W + (columnas.length - 1) * GX,
    };
  }, [tareas, bloqueos, conResueltas]);

  const vecinos = useMemo(() => {
    if (!sel) return null;
    const s = new Set([sel]);
    aristas.forEach((a) => { if (a.bloqueante === sel) s.add(a.bloqueada); if (a.bloqueada === sel) s.add(a.bloqueante); });
    return s;
  }, [sel, aristas]);

  if (nodos.length === 0) {
    return <div className="empty">Todavía no hay dependencias cargadas. Se vinculan desde el detalle de cada pendiente («Bloqueada por» / «Bloquea a»).</div>;
  }

  return (
    <div className="malla">
      <div className="bar">
        <button className={"btn" + (conResueltas ? " on" : "")} onClick={() => setConResueltas(!conResueltas)}>Incluir resueltas</button>
        <span className="gl">
          <span><i className="lin ext" />Bloqueo externo</span>
          <span><i className="lin int" />Bloqueo interno</span>
          <span><i className="lin res" />Ya resuelta</span>
          {Object.entries(ESTADOS).map(([k, e]) => <span key={k}><i style={{ background: e.color }} />{e.label}</span>)}
        </span>
        <span className="note" style={{ margin: "0 0 0 auto" }}>{nodos.length} pendientes · {aristas.length} vínculos · {cols} niveles</span>
      </div>
      <div className="m-scroll">
        <svg width={ancho} height={alto} viewBox={`0 0 ${ancho} ${alto}`} style={{ display: "block" }}>
          <defs>
            <marker id="fl-ext" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#B4531B" /></marker>
            <marker id="fl-int" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#7A4FA8" /></marker>
            <marker id="fl-res" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#B9C4CA" /></marker>
          </defs>
          {aristas.map((a, i) => {
            const x1 = a.de.x + W, y1 = a.de.y + H / 2, x2 = a.a.x, y2 = a.a.y + H / 2;
            const c = (x2 - x1) / 2;
            const k = a.res ? "res" : a.ext ? "ext" : "int";
            const col = a.res ? "#B9C4CA" : a.ext ? "#B4531B" : "#7A4FA8";
            const apag = vecinos && !(vecinos.has(a.bloqueante) && vecinos.has(a.bloqueada) && (a.bloqueante === sel || a.bloqueada === sel));
            return (
              <path key={i} d={`M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`} fill="none" stroke={col}
                strokeWidth={a.res ? 1.2 : 1.8} strokeDasharray={a.res ? "4 3" : undefined} markerEnd={`url(#fl-${k})`} opacity={apag ? 0.15 : 1} />
            );
          })}
          {nodos.map(({ t, x, y, frena }) => {
            const e = ESTADOS[t.estado] || ESTADOS.pendiente;
            const ext = t.lista === "externos";
            const apag = vecinos && !vecinos.has(t.id);
            return (
              <g key={t.id} transform={`translate(${x},${y})`} opacity={apag ? 0.25 : 1} style={{ cursor: "pointer" }}
                onClick={() => setSel(sel === t.id ? null : t.id)} onDoubleClick={() => onIr(t.id)}>
                <title>{`${refDe(t)} ${t.desc}\n${e.label}${t.resp ? " · " + t.resp : ""}${frena ? `\nFrena a ${frena} pendiente(s)` : ""}\nDoble clic para abrir`}</title>
                <rect width={W} height={H} rx="5" fill="#fff" stroke={sel === t.id ? "#16222A" : "#C7D2D8"} strokeWidth={sel === t.id ? 2 : 1} />
                <rect width="4" height={H} rx="2" fill={e.color} />
                <text x="12" y="17" fontSize="11" fontWeight="600" fill={ext ? "#B4531B" : "#175E7C"} fontFamily="ui-monospace, Menlo, monospace">{refDe(t)}</text>
                <text x="46" y="17" fontSize="10" fill="#5F717B">{ext ? "externo" : "interno"}{t.resp ? " · " + partirResp(t.resp).join("/") : ""}</text>
                <text x="12" y="34" fontSize="11" fill="#16222A">{t.desc.length > 32 ? t.desc.slice(0, 31) + "…" : t.desc}</text>
                <text x="12" y="46" fontSize="9.5" fill={e.color}>{e.label}{t.vence ? " · vence " + t.vence.slice(8, 10) + "/" + t.vence.slice(5, 7) : ""}</text>
                {frena > 0 && (
                  <g transform={`translate(${W - 22},${H - 18})`}>
                    <rect width="18" height="14" rx="7" fill="#F3EEF9" />
                    <text x="9" y="10.5" fontSize="9" textAnchor="middle" fill="#7A4FA8" fontWeight="600">{frena}</text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <p className="note">Una flecha va de la tarea que traba a la que espera. Naranja: la que traba es externa (depende de un tercero). Violeta: interna. Punteada gris: ya se resolvió y no traba más. El número en la esquina es a cuántas frena. Clic en un pendiente resalta sus vínculos; doble clic lo abre en la lista.</p>
    </div>
  );
}
