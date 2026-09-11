import { NextResponse } from "next/server";
import {
  hayDB,
  ensure,
  upsertTarea,
  deleteTarea,
  upsertCat,
  deleteCat,
  agregarBloqueo,
  quitarBloqueo,
} from "../../../lib/db.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req) {
  if (!hayDB) {
    return NextResponse.json({ ok: false, modo: "local" }, { status: 200 });
  }
  try {
    await ensure();
    const body = await req.json();

    const avisos = [];
    for (const op of body.ops || []) {
      if (op.tipo === "tarea") {
        if (op.accion === "delete") await deleteTarea(op.id);
        else await upsertTarea(op.row);
      } else if (op.tipo === "cat") {
        if (op.accion === "delete") await deleteCat(op.id);
        else await upsertCat(op.row);
      } else if (op.tipo === "bloqueo") {
        const { bloqueante, bloqueada } = op.row || {};
        if (op.accion === "delete") await quitarBloqueo(bloqueante, bloqueada);
        else {
          const r = await agregarBloqueo(bloqueante, bloqueada);
          if (!r.ok) avisos.push(r.error);
        }
      }
    }
    return NextResponse.json({ ok: avisos.length === 0, avisos });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
