/* Cálculo del informe de pendientes para un período.
   Lo usan la ruta del bot (números crudos para que el agente redacte) y el
   generador de PDF, para que los dos cuenten exactamente lo mismo. */

import { partirResp, refDe, bloqueantesDe, bloqueadasPor, estaBloqueada } from "./comun.js";

const DIA = 86400000;
const d0 = (iso) => new Date(String(iso).slice(0, 10) + "T00:00:00");

export const hoyISO = () => new Date().toISOString().slice(0, 10);

export function diasParaVencer(vence, hoy) {
  if (!vence) return null;
  return Math.round((d0(vence) - d0(hoy)) / DIA);
}

export function diasAbierto(fecha, hoy) {
  if (!fecha) return null;
  return Math.max(0, Math.round((d0(hoy) - d0(fecha)) / DIA));
}

export function fmtDia(iso) {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  return s.slice(8, 10) + "/" + s.slice(5, 7);
}

/* Ventana del período: por defecto los últimos `dias` hasta hoy. */
export function ventana({ dias, desde, hasta } = {}) {
  const hoy = hoyISO();
  const n = Math.min(Math.max(Number(dias) || 7, 1), 90);
  const fin = hasta || hoy;
  const ini = desde || new Date(d0(fin).getTime() - n * DIA).toISOString().slice(0, 10);
  return { desde: ini, hasta: fin, dias: Math.round((d0(fin) - d0(ini)) / DIA) };
}

export function calcular(tareas, bloqueos, opciones = {}) {
  const hoy = hoyISO();
  const per = ventana(opciones);
  const ini = d0(per.desde).getTime();
  const fin = d0(per.hasta).getTime() + DIA - 1;
  const enPeriodo = (iso) => {
    if (!iso) return false;
    const t = new Date(iso).getTime();
    return t >= ini && t <= fin;
  };

  const porId = new Map(tareas.map((t) => [t.id, t]));
  const abiertos = tareas.filter((t) => t.estado !== "resuelto");
  const sinResolver = (id) => porId.get(id) && porId.get(id).estado !== "resuelto";

  const cerrados = tareas.filter((t) => enPeriodo(t.resuelto_at));
  const altas = tareas.filter((t) => enPeriodo(t.creado_at));

  const vencidas = abiertos.filter((t) => (diasParaVencer(t.vence, hoy) ?? 1) < 0);
  const vencen7 = abiertos.filter((t) => {
    const d = diasParaVencer(t.vence, hoy);
    return d !== null && d >= 0 && d <= 7;
  });
  const urg1 = abiertos.filter((t) => t.urg === 1);
  const viejos = abiertos.filter((t) => (diasAbierto(t.fecha, hoy) ?? 0) > 30);

  /* Bloqueos: qué espera por qué, separando si la bloqueante es de un tercero. */
  const bloqueadas = abiertos
    .filter((t) => estaBloqueada(t, tareas, bloqueos))
    .map((t) => {
      const espera = bloqueantesDe(t.id, bloqueos).map((id) => porId.get(id)).filter((x) => x && x.estado !== "resuelto");
      return {
        tarea: t,
        espera,
        externo: espera.some((x) => x.lista === "externos"),
        interno: espera.some((x) => x.lista === "internos"),
      };
    });

  /* Las que más frenan: abiertas que bloquean a otras abiertas. */
  const cuellos = abiertos
    .map((t) => ({ tarea: t, frena: bloqueadasPor(t.id, bloqueos).filter(sinResolver).map((id) => porId.get(id)) }))
    .filter((x) => x.frena.length > 0)
    .sort((a, b) => b.frena.length - a.frena.length);

  /* Externos agrupados por tercero (un pendiente puede tener varios). */
  const mapaTerceros = new Map();
  abiertos.filter((t) => t.lista === "externos").forEach((t) => {
    const rs = partirResp(t.resp);
    for (const r of rs.length ? rs : ["sin asignar"]) {
      if (!mapaTerceros.has(r)) mapaTerceros.set(r, []);
      mapaTerceros.get(r).push(t);
    }
  });
  const terceros = [...mapaTerceros.entries()]
    .map(([nombre, list]) => ({
      nombre,
      tareas: list,
      dias: Math.max(...list.map((t) => diasAbierto(t.fecha, hoy) ?? 0)),
    }))
    .sort((a, b) => b.tareas.length - a.tareas.length || b.dias - a.dias);

  const porResponsable = abiertos
    .filter((t) => t.lista === "internos")
    .reduce((m, t) => {
      const rs = partirResp(t.resp);
      for (const r of rs.length ? rs : ["sin asignar"]) m[r] = (m[r] || 0) + 1;
      return m;
    }, {});

  const cuenta = (arr, key) =>
    arr.reduce((m, t) => {
      const k = key(t) || "sin asignar";
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {});

  const porLista = (arr, l) => arr.filter((t) => t.lista === l).length;

  return {
    hoy,
    periodo: per,
    abiertos,
    titular: {
      abiertos_total: abiertos.length,
      abiertos_internos: porLista(abiertos, "internos"),
      abiertos_externos: porLista(abiertos, "externos"),
      pendiente: abiertos.filter((t) => t.estado === "pendiente").length,
      curso: abiertos.filter((t) => t.estado === "curso").length,
      probar: abiertos.filter((t) => t.estado === "probar").length,
      cerrados_en_periodo: cerrados.length,
      cerrados_internos: porLista(cerrados, "internos"),
      cerrados_externos: porLista(cerrados, "externos"),
      altas_en_periodo: altas.length,
      altas_internas: porLista(altas, "internos"),
      altas_externas: porLista(altas, "externos"),
      urgencia1_sin_cerrar: urg1.length,
      urgencia1_internos: porLista(urg1, "internos"),
      urgencia1_externos: porLista(urg1, "externos"),
      bloqueadas: bloqueadas.length,
      bloqueadas_por_externo: bloqueadas.filter((b) => b.externo).length,
      vencidas: vencidas.length,
      vencen_en_7_dias: vencen7.length,
      sin_fecha_limite: abiertos.filter((t) => !t.vence).length,
    },
    cerrados,
    altas,
    vencidas: [...vencidas].sort((a, b) => diasParaVencer(a.vence, hoy) - diasParaVencer(b.vence, hoy)),
    vencen7: [...vencen7].sort((a, b) => diasParaVencer(a.vence, hoy) - diasParaVencer(b.vence, hoy)),
    urgencia1: urg1,
    bloqueadas,
    cuellos,
    terceros,
    viejos: [...viejos].sort((a, b) => (diasAbierto(b.fecha, hoy) ?? 0) - (diasAbierto(a.fecha, hoy) ?? 0)),
    externos_sin_plantear: abiertos.filter((t) => t.lista === "externos" && !t.planteado),
    sin_responsable: abiertos.filter((t) => !t.resp),
    abiertos_por_area: cuenta(abiertos, (t) => t.area),
    abiertos_por_estado: cuenta(abiertos, (t) => t.estado),
    abiertos_por_responsable: porResponsable,
  };
}

/* Párrafo de situación armado con los números, sin adjetivos. El bot puede
   mandar el suyo; esto es lo que sale cuando nadie lo escribe. */
export function situacion(inf) {
  const t = inf.titular;
  const p = [];
  p.push(
    `Al cierre del período hay ${t.abiertos_total} pendientes abiertos, ` +
      `${t.abiertos_internos} internos y ${t.abiertos_externos} en manos de terceros ` +
      `(${t.pendiente} sin empezar, ${t.curso} en curso${t.probar ? ", " + t.probar + " a probar" : ""}).`
  );
  p.push(
    t.cerrados_en_periodo === 0
      ? "No se registraron cierres en el período."
      : `Se cerraron ${t.cerrados_en_periodo} y entraron ${t.altas_en_periodo}.`
  );
  if (t.vencidas > 0) {
    const r = inf.vencidas.slice(0, 3).map(refDe).join(", ");
    p.push(`${t.vencidas} ${t.vencidas === 1 ? "pendiente está" : "pendientes están"} fuera de fecha (${r}).`);
  }
  if (t.bloqueadas > 0) {
    p.push(
      `${t.bloqueadas} ${t.bloqueadas === 1 ? "no puede avanzar" : "no pueden avanzar"} porque esperan por otro pendiente` +
        (t.bloqueadas_por_externo > 0 ? `, ${t.bloqueadas_por_externo} de ellos por un tercero.` : ".")
    );
  }
  if (inf.cuellos.length > 0) {
    const c = inf.cuellos[0];
    p.push(`Lo que más frena es ${refDe(c.tarea)} (${c.tarea.desc}), que detiene a ${c.frena.length}.`);
  }
  p.push(`${t.urgencia1_sin_cerrar} de los abiertos están marcados con urgencia 1.`);
  return p.join(" ");
}
