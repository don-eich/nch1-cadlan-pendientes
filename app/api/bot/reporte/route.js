import { NextResponse } from "next/server";
import { hayDB, ensure, leerTodo } from "../../../../lib/db.js";
import { autorizado, compacta } from "../../../../lib/bot.js";
import { calcular, situacion } from "../../../../lib/informe.js";
import { refDe } from "../../../../lib/comun.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* GET /api/bot/reporte?dias=7  (o ?desde=YYYY-MM-DD&hasta=YYYY-MM-DD)
   Números crudos del período; la redacción la hace el agente. Es el mismo
   cálculo que usa el PDF, así que los dos cuentan lo mismo. */
export async function GET(req) {
  if (!hayDB) return NextResponse.json({ error: "La app no tiene base de datos conectada." }, { status: 503 });
  const a = autorizado(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });

  try {
    await ensure();
    const { tareas, bloqueos } = await leerTodo();
    const u = new URL(req.url);
    const inf = calcular(tareas, bloqueos, {
      dias: u.searchParams.get("dias"),
      desde: u.searchParams.get("desde"),
      hasta: u.searchParams.get("hasta"),
    });
    const c = (t) => compacta(t, inf.hoy, { tareas, bloqueos });

    return NextResponse.json({
      periodo: inf.periodo,
      generado: new Date().toISOString(),
      situacion_sugerida: situacion(inf),
      titular: inf.titular,
      cerrados_en_periodo: inf.cerrados.map(c),
      altas_en_periodo: inf.altas.map(c),
      abiertos_por_estado: inf.abiertos_por_estado,
      abiertos_por_area: inf.abiertos_por_area,
      abiertos_por_responsable: inf.abiertos_por_responsable,
      urgencia1_sin_cerrar: inf.urgencia1.map(c),
      vencidas: inf.vencidas.map(c),
      vencen_en_7_dias: inf.vencen7.map(c),
      bloqueadas: inf.bloqueadas.map((b) => ({
        ...c(b.tarea),
        tipo_bloqueo: b.externo && b.interno ? "externo e interno" : b.externo ? "externo" : "interno",
      })),
      cuellos_de_botella: inf.cuellos.slice(0, 5).map((x) => ({ ...c(x.tarea), frena: x.frena.map(refDe) })),
      por_tercero: inf.terceros.map((x) => ({ tercero: x.nombre, refs: x.tareas.map(refDe), dias: x.dias })),
      mas_viejos: inf.viejos.slice(0, 8).map(c),
      externos_sin_plantear: inf.externos_sin_plantear.map(c),
      sin_responsable: inf.sin_responsable.map(c),
      informe_pdf: "/api/reporte/pdf?dias=7 — acepta dias, resumen, decisiones (separadas por |) y autor",
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
