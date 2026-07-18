// password.ts — Hachage/vérification du mot de passe (scrypt, stdlib Node).
// Node uniquement (module `node:crypto`) : à n'importer que dans des routes runtime="nodejs".

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const N = 16384; // coût CPU/mémoire
const R = 8;
const P = 1;
const KEYLEN = 32;

// Séparateur « . » (et non « $ ») : « $ » serait interprété comme une variable
// par les fichiers .env, ce qui corromprait le hash au chargement.
export function hacherMdp(mdp: string): string {
  const sel = randomBytes(16);
  const dk = scryptSync(mdp, sel, KEYLEN, { N, r: R, p: P });
  return `scrypt.${N}.${R}.${P}.${sel.toString("base64url")}.${dk.toString("base64url")}`;
}

export function verifierMdp(mdp: string, encode: string): boolean {
  try {
    const [algo, n, r, p, selB64, hashB64] = encode.split(".");
    if (algo !== "scrypt") return false;
    const sel = Buffer.from(selB64, "base64url");
    const attendu = Buffer.from(hashB64, "base64url");
    const dk = scryptSync(mdp, sel, attendu.length, { N: +n, r: +r, p: +p });
    return dk.length === attendu.length && timingSafeEqual(dk, attendu);
  } catch {
    return false;
  }
}

export function comparerConstante(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
