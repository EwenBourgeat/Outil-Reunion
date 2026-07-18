// session.ts — Jetons de session signés (JWT HS256 via jose).
// Compatible Edge ET Node : utilisé par le middleware (edge) et les routes (node).
// N'importe AUCUN module Node natif, pour rester compatible edge.

import { SignJWT, jwtVerify } from "jose";

export const COOKIE = "cr_session";
export const DUREE_SESSION = 7 * 24 * 3600; // 7 jours

function cle(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET manquant");
  return new TextEncoder().encode(secret);
}

export async function signerSession(): Promise<string> {
  return new SignJWT({ ok: true })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${DUREE_SESSION}s`)
    .sign(cle());
}

export async function sessionValide(jeton?: string): Promise<boolean> {
  if (!jeton) return false;
  try {
    await jwtVerify(jeton, cle());
    return true;
  } catch {
    return false;
  }
}
