// Génère l'empreinte scrypt d'un mot de passe pour AUTH_PASSWORD_HASH.
// Usage :  npm run hash -- "mon-mot-de-passe"
import { scryptSync, randomBytes } from "node:crypto";

const mdp = process.argv[2];
if (!mdp) {
  console.error('Usage : npm run hash -- "mot-de-passe"');
  process.exit(1);
}
const N = 16384, R = 8, P = 1, KEYLEN = 32;
const sel = randomBytes(16);
const dk = scryptSync(mdp, sel, KEYLEN, { N, r: R, p: P });
// Empreinte 100% hexadécimale (32 + 64 caractères), sans caractère spécial.
const hash = sel.toString("hex") + dk.toString("hex");
console.log("\nAUTH_PASSWORD_HASH=" + hash + "\n");
