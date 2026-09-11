"use client";

import React, { useState } from "react";
import { X, Trash2, Plus } from "lucide-react";
import { tieneResp } from "../lib/comun.js";

function FilaEditable({ item, cuenta, sub, onRename, onDelete }) {
  const [v, setV] = useState(item.nombre);
  React.useEffect(() => setV(item.nombre), [item.nombre]);

  return (
    <div className={"catrow" + (sub ? " sub" : "")}>
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => (v.trim() && v !== item.nombre ? onRename(item.id, v) : setV(item.nombre))}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") { setV(item.nombre); e.currentTarget.blur(); }
        }}
        aria-label={"Nombre de " + item.nombre}
      />
      {cuenta > 0 && <span className="cnt">{cuenta}</span>}
      <button className="mini" onClick={() => onDelete(item.id)} title="Eliminar" aria-label={"Eliminar " + item.nombre}>
        <Trash2 size={12} />
      </button>
    </div>
  );
}

function Agregar({ placeholder, onAdd }) {
  const [v, setV] = useState("");
  const enviar = () => {
    if (!v.trim()) return;
    onAdd(v);
    setV("");
  };
  return (
    <div className="addrow">
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && enviar()}
        placeholder={placeholder}
      />
      <button className="btn" onClick={enviar} disabled={!v.trim()} style={!v.trim() ? { opacity: 0.45 } : undefined}>
        <Plus size={12} /> Agregar
      </button>
    </div>
  );
}

export default function Catalogo({ cat, tareas, onAdd, onRename, onDelete, onClose }) {
  const areas = cat.filter((c) => c.tipo === "area").sort((a, b) => a.orden - b.orden);
  const subs = (area) => cat.filter((c) => c.tipo === "subarea" && c.padre === area).sort((a, b) => a.orden - b.orden);
  const respsDe = (tipo) => cat.filter((c) => c.tipo === tipo).sort((a, b) => a.orden - b.orden);

  const cuentaArea = (n) => tareas.filter((t) => t.area === n).length;
  const cuentaSub = (padre, n) => tareas.filter((t) => t.area === padre && t.subarea === n).length;
  const cuentaResp = (tipo, n) =>
    tareas.filter((t) => t.lista === (tipo === "resp_ext" ? "externos" : "internos") && tieneResp(t, n)).length;

  return (
    <div className="mgr">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h4>Catálogo</h4>
          <p className="hint">
            Editá un nombre y salí del campo para guardarlo: el cambio se propaga a todos los pendientes que lo usan.
            Al eliminar, los pendientes no se borran — el área pasa a &laquo;Sin asignar&raquo; y la sub-área o el responsable quedan vacíos.
            El número a la derecha es cuántos pendientes lo están usando.
          </p>
        </div>
        <button onClick={onClose} style={{ color: "#8B9AA2" }} aria-label="Cerrar catálogo"><X size={15} /></button>
      </div>

      <div className="mgr-cols">
        <div className="mgr-sec">
          <h5>Áreas y sub-áreas</h5>
          {areas.map((a) => (
            <div key={a.id} style={{ marginBottom: 10 }}>
              <div className="catlist">
                <FilaEditable item={a} cuenta={cuentaArea(a.nombre)} onRename={onRename} onDelete={onDelete} />
                {subs(a.nombre).map((s) => (
                  <FilaEditable key={s.id} item={s} sub cuenta={cuentaSub(a.nombre, s.nombre)} onRename={onRename} onDelete={onDelete} />
                ))}
              </div>
              <Agregar placeholder={`Nueva sub-área de ${a.nombre}`} onAdd={(n) => onAdd("subarea", n, a.nombre)} />
            </div>
          ))}
          <Agregar placeholder="Nueva área" onAdd={(n) => onAdd("area", n)} />
        </div>

        <div className="mgr-sec">
          <h5>Responsables internos</h5>
          <div className="catlist">
            {respsDe("resp_int").map((r) => (
              <FilaEditable key={r.id} item={r} cuenta={cuentaResp("resp_int", r.nombre)} onRename={onRename} onDelete={onDelete} />
            ))}
          </div>
          <Agregar placeholder="Nuevo responsable (MM, GZ, JM…)" onAdd={(n) => onAdd("resp_int", n)} />

          <h5 style={{ marginTop: 18 }}>Responsables externos</h5>
          <div className="catlist">
            {respsDe("resp_ext").map((r) => (
              <FilaEditable key={r.id} item={r} cuenta={cuentaResp("resp_ext", r.nombre)} onRename={onRename} onDelete={onDelete} />
            ))}
          </div>
          <Agregar placeholder="Nuevo tercero (Cadlan, Saceem…)" onAdd={(n) => onAdd("resp_ext", n)} />
        </div>
      </div>
    </div>
  );
}
