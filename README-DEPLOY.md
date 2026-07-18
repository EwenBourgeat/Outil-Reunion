# Déploiement sur Vercel — Compte rendu de diagnostic (branche `vercel-nextjs`)

Application **100 % Next.js / JavaScript** (front + API serverless, un seul runtime).
La génération du `.docx` se fait en JS (`lib/docx.ts`, via pizzip + xmldom) : le template
de l'agence est ouvert, rempli, enregistré — rendu Word vérifié identique à l'app d'origine.

## 1. Prérequis
- Un compte **Vercel** (plan **Pro** requis pour un usage commercial — le plan gratuit
  Hobby est réservé au non-commercial).
- Une clé **Google Gemini** (rédaction, gratuite) : https://aistudio.google.com/apikey
- Une clé **Groq** (transcription, gratuite) : https://console.groq.com/keys

## 2. Variables d'environnement (Vercel → Settings → Environment Variables)
| Variable | Rôle |
|---|---|
| `GEMINI_API_KEY` | Rédaction du compte rendu (Google Gemini) |
| `GROQ_API_KEY` | Transcription audio (Whisper) |
| `AUTH_EMAIL` | E-mail autorisé (ex. `test@test.com`) |
| `AUTH_PASSWORD_HASH` | Empreinte du mot de passe — générer avec `npm run hash -- "votre-mdp"` |
| `SESSION_SECRET` | Clé de signature des sessions — `openssl rand -hex 32` |

> Identifiants par défaut livrés : **`test@test.com` / `test`**. Pour les changer,
> régénérez `AUTH_PASSWORD_HASH` et mettez à jour `AUTH_EMAIL`.

## 3. Déployer
```bash
git push origin vercel-nextjs          # pousser la branche
```
Puis, sur vercel.com : **Add New → Project → importer le repo → branche `vercel-nextjs`**.
Framework détecté : **Next.js** (rien à configurer). Renseignez les variables ci-dessus,
puis **Deploy**.

## 4. Développement local
```bash
cp .env.example .env.local     # renseigner les clés + AUTH_PASSWORD_HASH + SESSION_SECRET
npm install
npm run dev                    # http://localhost:3000  — TOUT fonctionne en local
```
> Un seul runtime : `npm run dev` fait tourner l'app entière (auth, UI, transcription **et
> génération du .docx**). Pas besoin de `vercel dev`.

## 5. Différences avec l'app locale d'origine (inhérentes à l'hébergement)
- **« Télécharger le .docx »** remplace « Ouvrir dans Word / le dossier » (pas de Word sur un serveur).
- **Transcription en ligne** (Groq) au lieu de Whisper hors-ligne.
- **Bibliothèque d'immeubles par-navigateur** (localStorage), non partagée entre appareils.

## 6. Notes techniques
- Limite Vercel de 4,5 Mo par requête/réponse : les photos sont **compressées côté
  navigateur** (1600 px / JPEG q80). Pour des rapports à très nombreuses photos (~20+),
  prévoir un passage par un stockage type Vercel Blob.
- La génération `.docx` est en JS pur (`lib/docx.ts`) : ouvre le template de l'agence et le
  remplit sans le reconstruire — logo, cartouche, styles, pagination conservés à l'identique.
