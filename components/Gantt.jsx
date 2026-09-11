"use client";

import React, { useMemo, useState } from "react";
import { Ban } from "lucide-react";
import { partirResp, refDe, bloqueantesActivas } from "../lib/comun.js";

/* Vista Gantt de pendientes. Cada barra va desde la fecha de alta hasta la
   fecha límite; si no hay fecha límite, hasta hoy con el extremo abierto.
   Lo vencido se pinta en rojo desde el vencimiento hasta hoy. */

const ESTADOS = {
  pendiente: { label: "Pendiente", color: "#C0353B" },
  curso: { label: "En curso", color: "#1C7CA3" },
  probar: { label: "A probar", color: "#A96C08" },
  resuelto: { label: "Resuelto", color: "#2E7D53" },
};
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "set", "oct", "nov", "dic"];
const DIA = 86400000;

const d0 = (iso) => new Date(iso + "T00:00:00");
function hoyISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const addDias = (date, n) => new Date(date.getTime() + n * DIA);
const fmt = (date) => `${date.getDate()} ${MESES[date.getMonth()]}`;

export default function Gantt({ tareas, bloqueos, areas, onIr }) {
  const [lista, setLista] = useState("");
  const [soloU1, setSoloU1] = useState(false);
  const [conResueltos, setConResueltos] = useState(false);

  const hoy = d0(hoyISO());

  const filas = useMemo(() => {
    let t = tareas.filter((x) => x.fecha);
    if (lista) t = t.filter((x) => x.lista === lista);
    if (soloU1) t = t.filter((x) => x.urg === 1);
    if (!conResueltos) t = t.filter((x) => x.estado !== "resuelto");
    else t = t.filter((x) => x.estado !== "resuelto" || (x.resuelto_at && (hoy - new Date(x.resuelto_at)) / DIA <= 14));
    return t.sort((a, b) => a.orden - b.orden);
  }, [tareas, lista, soloU1, conResueltos, hoy]);

  // ventana temporal: desde la alta más vieja (tope 60 días) hasta el vencimiento más lejano + 7 días
  const { ini, fin, dias } = useMemo(() => {
    let ini = addDias(hoy, -7), fin = addDias(hoy, 14);
    for (const t of filas) {
      const a = d0(t.fecha);
      if (a < ini) ini = a;
      if (t.vence) { const v = d0(t.vence); if (v > fin) fin = v; }
    }
    if ((hoy - ini) / DIA > 60) ini = addDias(hoy, -60);
    ini = addDias(ini, -2);
    fin = addDias(fin, 7);
    return { ini, fin, dias: Math.round((fin - ini) / DIA) + 1 };
  }, [filas, hoy]);

  const pct = (date) => Math.max(0, Math.min(100, ((date - ini) / DIA / dias) * 100));

  // columnas de semana (lunes)
  const semanas = useMemo(() => {
    const out = [];
    let d = new Date(ini);
    while (d.getDay() !== 1) d = addDias(d, 1);
    for (; d <= fin; d = addDias(d, 7)) out.push(d);
    return out;
  }, [ini, fin]);

  const grupos = useMemo(() => {
    const m = new Map();
    filas.forEach((t) => { const k = t.area || "Sin asignar"; if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
    const rank = new Map(areas.map((a, n) => [a.nombre, n]));
    return [...m.entries()].sort((a, b) => (rank.get(a[0]) ?? 999) - (rank.get(b[0]) ?? 999));
  }, [filas, areas]);

  const porId = useMemo(() => new Map(tareas.map((t) => [t.id, t])), [tareas]);

  return (
    <div className="gantt">
      <div className="bar">
        <select className="sel" value={lista} onChange={(e) => setLista(e.target.value)}>
          <option value="">Internos y externos</option>
          <option value="internos">Solo internos</option>
          <option value="externos">Solo externos</option>
        </select>
        <button className={"btn" + (soloU1 ? " on" : "")} onClick={() => setSoloU1(!soloU1)}>Urgencia 1</button>
        <button className={"btn" + (conResueltos ? " on" : "")} onClick={() => setConResueltos(!conResueltos)}>Resueltos últimos 14 días</button>
        <span className="gl">
          {Object.entries(ESTADOS).map(([k, e]) => <span key={k}><i style={{ background: e.color }} />{e.label}</span>)}
          <span><i className="venc" />Fuera de fecha</span>
          <span><i className="sinf" />Sin fecha límite</span>
        </span>
      </div>

      <div className="g-wrap">
        <div className="g-head">
          <div className="g-label" />
          <div className="g-time">
            {semanas.map((s) => (
              <div key={+s} className="g-week" style={{ left: pct(s) + "%" }}>{fmt(s)}</div>
            ))}
            <div className="g-week hoy" style={{ left: pct(hoy) + "%" }}>hoy</div>
          </div>
        </div>

        {grupos.map(([area, list]) => (
          <div key={area}>
            <div className="g-area">{area} <span>{list.length}</span></div>
            {list.map((t) => {
              const est = ESTADOS[t.estado] || ESTADOS.pendiente;
              const a = d0(t.fecha);
              const v = t.vence ? d0(t.vence) : null;
              const abierto = t.estado !== "resuelto";
              const finBarra = v ? (abierto && v < hoy ? v : v) : hoy;
              const vencida = abierto && v && v < hoy;
              const esperando = bloqueantesActivas(t, tareas, bloqueos);
              const ext = esperando.some((x) => x.lista === "externos");
              const x1 = pct(a), x2 = pct(finBarra);
              return (
                <div key={t.id} className="g-row">
                  <button className="g-label" onClick={() => onIr(t.id)} title={t.desc}>
                    <span className="mono g-ref">{refDe(t)}</span>
                    <span className="g-desc">{t.desc}</span>
                    <span className="g-who">{partirResp(t.resp).join("/") || "sin asignar"}</span>
                  </button>
                  <div className="g-time">
                    {semanas.map((s) => <i key={+s} className="g-grid" style={{ left: pct(s) + "%" }} />)}
                    <i className="g-hoy" style={{ left: pct(hoy) + "%" }} />
                    <div className={"g-bar" + (v ? "" : " abierta") + (abierto ? "" : " done")}
                      style={{ left: x1 + "%", width: Math.max(0.6, x2 - x1) + "%", background: est.color }}
                      title={`${refDe(t)} ${t.desc}\nAlta ${t.fecha}${t.vence ? " · vence " + t.vence : " · sin fecha límite"}\n${est.label}${t.resp ? " · " + t.resp : ""}`}>
                      {t.urg === 1 && <b>1</b>}
                    </div>
                    {vencida && (
                      <div className="g-venc" style={{ left: pct(v) + "%", width: Math.max(0.4, pct(hoy) - pct(v)) + "%" }}
                        title={`Vencida hace ${Math.round((hoy - v) / DIA)} días`} />
                    )}
                    {v && <i className="g-hito" style={{ left: pct(v) + "%", borderColor: vencida ? "#C0353B" : est.color }} title={"Fecha límite " + t.vence} />}
                    {esperando.length > 0 && (
                      <span className={"g-blk " + (ext ? "ext" : "int")} style={{ left: `calc(${x2}% + 8px)` }}
                        title={esperando.map((x) => refDe(x) + " " + x.desc).join("\n")}>
                        <Ban size={9} /> {ext ? "ext" : "int"} · {esperando.map(refDe).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {filas.length === 0 && <div className="empty">Nada que mostrar con estos filtros.</div>}
      <p className="note">Cada barra va desde la fecha de alta hasta la fecha límite. Sin fecha límite, la barra llega hasta hoy con el extremo abierto. El «1» marca urgencia 1. La etiqueta al final indica que espera por otro pendiente (bloqueo interno o externo).</p>
    </div>
  );
}
