// POST /api/generate — extraction (Gemini) + génération .docx (JS), en un seul runtime Node.
import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { extraire } from "@/lib/gemini";
import { genererDocx, type PhotoDocx } from "@/lib/docx";
import type { Chantier, PhotoEntree } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase();
const dateCompacte = (iso?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[1]}${m[2]}${m[3]}` : "00000000";
};

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const chantier = body.chantier as Chantier;
    const transcription = String(body.transcription || "");
    const photosIn = (body.photos || []) as PhotoEntree[];

    if (!transcription.trim()) {
      return NextResponse.json({ detail: "La transcription est vide." }, { status: 422 });
    }

    // 1. Analyse et rédaction (Gemini).
    const noms = photosIn.map((p) => p.nom);
    const donnees = await extraire(transcription, chantier, noms);

    // 2. Photos : déjà compressées en JPEG côté navigateur → simple décodage base64.
    const photos: PhotoDocx[] = photosIn.map((p) => ({
      data: Buffer.from((p.dataUrl.split(",")[1] || ""), "base64"),
      legende: p.legende || "",
    }));

    // 3. Mise en page dans le template de l'agence.
    const template = await fs.readFile(path.join(process.cwd(), "assets", "DIAG_MODEL_SDC.docx"));
    const buffer = genererDocx(template, donnees, chantier, photos);

    const filename = `CR_DIAG_${slug(chantier.sdc)}_${dateCompacte(chantier.date_visite)}.docx`;
    return NextResponse.json({
      filename,
      docx: buffer.toString("base64"),
      points_a_completer: donnees.points_a_completer || [],
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "erreur inconnue";
    return NextResponse.json({ detail: `La génération a échoué : ${msg}` }, { status: 502 });
  }
}
