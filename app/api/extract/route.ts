// POST /api/extract — analyse + rédaction (Gemini). Ne reçoit et ne renvoie que du
// TEXTE (transcription → JSON structuré) : payload minuscule, jamais de photos.
// La mise en page du .docx est faite ensuite dans le navigateur (lib/docx.ts).
import { NextResponse } from "next/server";
import { extraire } from "@/lib/gemini";
import type { Chantier } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const chantier = body.chantier as Chantier;
    const transcription = String(body.transcription || "");
    const photoNames = (body.photoNames || []) as string[];

    if (!transcription.trim()) {
      return NextResponse.json({ detail: "La transcription est vide." }, { status: 422 });
    }

    const donnees = await extraire(transcription, chantier, photoNames);
    return NextResponse.json({ donnees });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erreur inconnue";
    return NextResponse.json({ detail: `L'analyse a échoué : ${msg}` }, { status: 502 });
  }
}
