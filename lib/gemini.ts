// gemini.ts — Extraction structurée via Google Gemini (port de cr_engine.extraire).
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Chantier, DonneesCR } from "./types";

const MODELE = "gemini-2.5-flash"; // basculer sur "gemini-2.5-pro" pour plus de finesse

export async function extraire(
  transcription: string,
  chantier: Chantier,
  photos: string[],
): Promise<DonneesCR> {
  const md = await fs.readFile(path.join(process.cwd(), "prompt_diagnostic.md"), "utf-8");
  const system = md.split("## SYSTEM")[1].split("## USER")[0].trim();

  const nom = (c: Chantier["contacts"][number]) => c.nom || c.role || c.organisme || "";
  const presents = chantier.contacts.filter((c) => c.present).map(nom).filter(Boolean).join(", ");
  const absents = chantier.contacts.filter((c) => !c.present).map(nom).filter(Boolean).join(", ");
  const listePhotos = photos.length ? photos.map((p, i) => `${i + 1}. ${p}`).join("\n") : "(aucune)";

  const user = `FICHE CHANTIER
- SDC / immeuble : ${chantier.sdc}
- Adresse : ${chantier.adresse ?? ""}
- Code immeuble : ${chantier.code_immeuble ?? ""}
- N° d'affaire : ${chantier.n_affaire ?? ""}
- MOA / syndic : ${chantier.moa ?? ""}
- Date de la visite : ${chantier.date_visite ?? ""}
- Présents : ${presents}
- Absents : ${absents}

FICHIERS PHOTOS (ordre chronologique)
${listePhotos}

TRANSCRIPTION DE LA NOTE VOCALE
"""
${transcription}
"""`;

  const cle = process.env.GEMINI_API_KEY;
  if (!cle) throw new Error("La clé Gemini (GEMINI_API_KEY) n'est pas configurée.");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELE}:generateContent?key=${cle}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature: 0.4,
        maxOutputTokens: 16384,
        // Désactive le « raisonnement » de Gemini 2.5 : réponses ~5-10 s au lieu de 20-70 s
        // (évite les timeouts Vercel 60 s) et limite le remplissage inventif.
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`Gemini a renvoyé une erreur ${r.status} : ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];
  let txt = parts.map((p: { text?: string }) => p.text ?? "").join("").trim();
  txt = txt.replace(/^```json/, "").replace(/^```/, "").replace(/```$/, "").trim();
  return JSON.parse(txt) as DonneesCR;
}
