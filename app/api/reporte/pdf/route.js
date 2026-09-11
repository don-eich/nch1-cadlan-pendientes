import { hayDB, ensure, leerTodo } from "../../../../lib/db.js";
import { generarInforme } from "../../../../lib/pdf.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* GET /api/reporte/pdf
   ?dias=7            período que cubre el informe
   ?resumen=texto     párrafo de situación (si no viene, se arma con los números)
   ?decisiones=a|b|c  temas para la dirección, separados por barra
   ?autor=Erick
   ?ver=1             lo abre en el navegador en vez de descargarlo           */
export async function GET(req) {
  if (!hayDB) {
    return new Response(JSON.stringify({ error: "La app no tiene base de datos conectada." }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  try {
    await ensure();
    const { tareas, bloqueos } = await leerTodo();
    const u = new URL(req.url);
    const pdf = await generarInforme({
      tareas,
      bloqueos,
      dias: u.searchParams.get("dias"),
      resumen: u.searchParams.get("resumen") || "",
      decisiones: u.searchParams.get("decisiones") || "",
      autor: u.searchParams.get("autor") || "",
    });
    const hoy = new Date().toISOString().slice(0, 10);
    const nombre = `NCH1-Cadlan-informe-${hoy}.pdf`;
    const modo = u.searchParams.get("ver") ? "inline" : "attachment";
    return new Response(pdf, {
      status: 200,
      headers: {
        "content-type": "application/pdf",
        "content-disposition": `${modo}; filename="${nombre}"`,
        "cache-control": "no-store",
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e?.message || String(e) }), {
      status: 500,
      headers: { "content-type": "application/json" },
    });
  }
}
