import { NextResponse } from "next/server";
import { hayDB, ensure, leerTodo } from "../../../../lib/db.js";
import { autorizado } from "../../../../lib/bot.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/* Valores válidos de área, sub-área y responsable, para que el agente no invente. */
export async function GET(req) {
  if (!hayDB) return NextResponse.json({ error: "La app no tiene base de datos conectada." }, { status: 503 });
  const a = autorizado(req);
  if (!a.ok) return NextResponse.json({ error: a.error }, { status: a.status });
  try {
    await ensure();
    const { catalogo } = await leerTodo();
    const de = (tipo) => catalogo.filter((c) => c.tipo === tipo).sort((x, y) => x.orden - y.orden);
    return NextResponse.json({
      areas: de("area").map((a2) => ({
        nombre: a2.nombre,
        subareas: de("subarea").filter((s) => s.padre === a2.nombre).map((s) => s.nombre),
      })),
      responsables_internos: de("resp_int").map((r) => r.nombre),
      responsables_externos: de("resp_ext").map((r) => r.nombre),
      estados: ["pendiente", "curso", "probar", "resuelto"],
      nota_responsables: "Un pendiente puede tener varios responsables: pasalos separados por coma o barra (MM, GZ).",
      nota_dependencias: "Para decir que A bloquea a D: actualizá D con bloqueada_por = referencia de A (I12, E3), o A con bloquea = referencia de D.",
      urgencias: { 1: "bloquea avance", 2: "importante", 3: "puede esperar" },
    });
  } catch (e) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 });
  }
}
