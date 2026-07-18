// POST /api/transcribe — proxy vers Groq Whisper (la clé reste côté serveur).
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

const ENDPOINT = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function POST(req: Request) {
  if (!process.env.GROQ_API_KEY) {
    return NextResponse.json(
      { detail: "La clé de transcription (Groq) n'est pas configurée." },
      { status: 400 },
    );
  }

  const form = await req.formData();
  const audio = form.get("audio");
  if (!(audio instanceof File) || audio.size < 2000) {
    return NextResponse.json({ detail: "L'enregistrement semble vide." }, { status: 422 });
  }

  const gform = new FormData();
  gform.append("file", audio, audio.name || "note.webm");
  gform.append("model", "whisper-large-v3-turbo");
  gform.append("language", "fr");
  gform.append("response_format", "verbose_json");

  const r = await fetch(ENDPOINT, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: gform,
  });

  if (!r.ok) {
    const t = await r.text().catch(() => "");
    return NextResponse.json(
      { detail: "La transcription a échoué côté service. Réessayez." + (t ? ` (${r.status})` : "") },
      { status: 502 },
    );
  }

  const data = (await r.json()) as { text?: string; duration?: number };
  const texte = (data.text ?? "").trim();
  if (!texte) {
    return NextResponse.json(
      { detail: "Aucune parole n'a été détectée dans l'enregistrement." },
      { status: 422 },
    );
  }
  return NextResponse.json({ transcription: texte, duree: Math.round(data.duration ?? 0) });
}
