import { NextResponse } from "next/server";
import { hayDB, ensure, leerTodo } from "../../../lib/db.js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!hayDB) {
    return NextResponse.json({
      modo: "local",
      motivo: "No hay DATABASE_URL configurada. Los datos quedan en este navegador.",
    });
  }
  try {
    await ensure();
    const data = await leerTodo();
    return NextResponse.json({ modo: "db", ...data });
  } catch (e) {
    return NextResponse.json(
      { modo: "local", motivo: "Error de base de datos: " + (e?.message || e) },
      { status: 200 }
    );
  }
}
