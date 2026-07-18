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
const hash = `scrypt.${N}.${R}.${P}.${sel.toString("base64url")}.${dk.toString("base64url")}`;
console.log("\nAUTH_PASSWORD_HASH=" + hash + "\n");
