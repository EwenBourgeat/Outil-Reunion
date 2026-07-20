// password.ts — Hachage/vérification du mot de passe (scrypt, stdlib Node).
// Node uniquement (module `node:crypto`) : à n'importer que dans des routes runtime="nodejs".

import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

const N = 16384; // coût CPU/mémoire
const R = 8;
const P = 1;
const KEYLEN = 32;

// Empreinte 100 % HEXADÉCIMALE : 32 caractères de sel + 64 caractères de hash.
// Aucun caractère spécial (ni ".", "-", "_", "$") → acceptée partout, y compris
// dans les variables d'environnement Vercel. Les paramètres (N, r, p) sont fixes.
export function hacherMdp(mdp: string): string {
  const sel = randomBytes(16);
  const dk = scryptSync(mdp, sel, KEYLEN, { N, r: R, p: P });
  return sel.toString("hex") + dk.toString("hex");
}

export function verifierMdp(mdp: string, encode: string): boolean {
  try {
    if (!/^[0-9a-fA-F]{96}$/.test(encode)) return false;
    const sel = Buffer.from(encode.slice(0, 32), "hex");
    const attendu = Buffer.from(encode.slice(32), "hex");
    const dk = scryptSync(mdp, sel, attendu.length, { N, r: R, p: P });
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
