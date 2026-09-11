import { NextResponse } from "next/server";
import { hayDB, ensure, leerTodo } from "../../../../lib/db.js";
import { autorizado, compacta, diasParaVencer } from "../../../../lib/bot.js";
import { partirResp, estaBloqueada } from "../../../../lib/comun.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* GET /api/bot/reporte?dias=7  (o ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD)
   Devuelve los números crudos del período. La redacción la hace el agente. */
export async function GET(req) {
  if (!hayDB) return NextResponse.json({ error: "La app no tiene base de datos conectada." }, { status: 503 });
  const a = autorizado(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });

  try {
    await ensure();
    const { tareas, bloqueos } = await leerTodo();
    const ctx = { tareas, bloqueos };
    const u = new URL(req.url);
    const hoy = new Date().toISOString().slice(0, 10);
    const dias = Math.min(Math.max(Number(u.searchParams.get("dias")) || 7, 1), 90);
    const hasta = u.searchParams.get("hasta") || hoy;
    const desde =
      u.searchParams.get("desde") ||
      new Date(new Date(hasta + "T00:00:00").getTime() - dias * 86400000).toISOString().slice(0, 10);

    const ini = new Date(desde + "T00:00:00").getTime();
    const fin = new Date(hasta + "T23:59:59").getTime();
    const enPeriodo = (iso) => {
      if (!iso) return false;
      const t = new Date(iso).getTime();
      return t >= ini && t <= fin;
    };
    const c = (t) => compacta(t, hoy, ctx);

    const abiertos = tareas.filter((t) => t.estado !== "resuelto");
    const cuenta = (arr, key) =>
      arr.reduce((m, t) => {
        const k = key(t) || "sin asignar";
        m[k] = (m[k] || 0) + 1;
        return m;
      }, {});

    return NextResponse.json({
      periodo: { desde, hasta, dias },
      generado: new Date().toISOString(),
      titular: {
        abiertos_total: abiertos.length,
        abiertos_internos: abiertos.filter((t) => t.lista === "internos").length,
        abiertos_externos: abiertos.filter((t) => t.lista === "externos").length,
        cerrados_en_periodo: tareas.filter((t) => enPeriodo(t.resuelto_at)).length,
        altas_en_periodo: tareas.filter((t) => enPeriodo(t.creado_at)).length,
        urgencia1_sin_cerrar: abiertos.filter((t) => t.urg === 1).length,
        vencidas: abiertos.filter((t) => (diasParaVencer(t.vence, hoy) ?? 1) < 0).length,
        vencen_en_7_dias: abiertos.filter((t) => {
          const d = diasParaVencer(t.vence, hoy);
          return d !== null && d >= 0 && d <= 7;
        }).length,
        sin_fecha_limite: abiertos.filter((t) => !t.vence).length,
        bloqueadas: abiertos.filter((t) => estaBloqueada(t, tareas, bloqueos)).length,
      },
      bloqueadas: abiertos.filter((t) => estaBloqueada(t, tareas, bloqueos)).map(c),
      /* Las que más traban: abiertas que bloquean a otras abiertas, ordenadas por cuántas frenan. */
      cuellos_de_botella: abiertos
        .map((t) => ({
          ...c(t),
          frena: bloqueos.filter((b) => b.bloqueante === t.id).map((b) => tareas.find((x) => x.id === b.bloqueada))
            .filter((x) => x && x.estado !== "resuelto").length,
        }))
        .filter((t) => t.frena > 0)
        .sort((a, b) => b.frena - a.frena)
        .slice(0, 5),
      cerrados_en_periodo: tareas.filter((t) => enPeriodo(t.resuelto_at)).map(c),
      altas_en_periodo: tareas.filter((t) => enPeriodo(t.creado_at)).map(c),
      abiertos_por_estado: cuenta(abiertos, (t) => t.estado),
      abiertos_por_area: cuenta(abiertos, (t) => t.area),
      abiertos_por_responsable: abiertos
        .filter((t) => t.lista === "internos")
        .reduce((m, t) => {
          const rs = partirResp(t.resp);
          for (const r of rs.length ? rs : ["sin asignar"]) m[r] = (m[r] || 0) + 1;
          return m;
        }, {}),
      urgencia1_sin_cerrar: abiertos.filter((t) => t.urg === 1).map(c),
      mas_viejos: [...abiertos]
        .map(c)
        .sort((x, y) => (y.dias_abierto || 0) - (x.dias_abierto || 0))
        .slice(0, 5),
      vencidas: abiertos
        .filter((t) => (diasParaVencer(t.vence, hoy) ?? 1) < 0)
        .map(c)
        .sort((x, y) => x.dias_para_vencer - y.dias_para_vencer),
      vencen_en_7_dias: abiertos
        .filter((t) => {
          const d = diasParaVencer(t.vence, hoy);
          return d !== null && d >= 0 && d <= 7;
        })
        .map(c)
        .sort((x, y) => x.dias_para_vencer - y.dias_para_vencer),
      externos_sin_plantear: abiertos.filter((t) => t.lista === "externos" && !t.planteado).map(c),
      sin_responsable: abiertos.filter((t) => !t.resp).map(c),
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
