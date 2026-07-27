// GET /api/immeubles — liste des immeubles synchronisés depuis monday.com.
// Protégé par le middleware d'authentification (session requise).
import { NextResponse } from "next/server";
import { fetchImmeublesMonday } from "@/lib/monday";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const chantiers = await fetchImmeublesMonday();
    return NextResponse.json({ chantiers });
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Erreur inconnue.";
    return NextResponse.json({ detail }, { status: 500 });
  }
}
