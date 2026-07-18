// POST /api/login — vérifie les identifiants et pose le cookie de session.
import { NextResponse } from "next/server";
import { verifierMdp, comparerConstante } from "@/lib/password";
import { signerSession, COOKIE, DUREE_SESSION } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const form = await req.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const mdp = String(form.get("mdp") ?? "");

  const emailOk = comparerConstante(email, (process.env.AUTH_EMAIL ?? "").trim().toLowerCase());
  const mdpOk = verifierMdp(mdp, process.env.AUTH_PASSWORD_HASH ?? "");

  // On évalue toujours les deux (pas de court-circuit) pour ne pas révéler
  // par le temps de réponse lequel est faux, + délai anti-force-brute.
  if (!(emailOk && mdpOk)) {
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json({ detail: "E-mail ou mot de passe incorrect." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await signerSession(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: DUREE_SESSION,
  });
  return res;
}
