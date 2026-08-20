# Outil de génération automatique des CR de DIAGNOSTIC (GO Architecture)

Application web (Next.js) qui transforme **une note vocale de visite + des photos + la fiche
immeuble Monday** en un **compte rendu Word (.docx) prêt à relire**, à l'identique de la
mise en page de l'agence (logo, cartouche, styles, pagination).

## Ce que fait l'outil

```
Note vocale (micro ou fichier) ──► Groq / Whisper ──► transcription texte
                                                             │
Fiche immeuble (Monday) ─────────────────────────┐          │
Photos (locales, navigateur) ────────┐           ▼          ▼
                                      │     Google Gemini (prompt_diagnostic.md)
                                      │                │
                                      │                ▼  données structurées (JSON)
                                      │     généralités + observations + conclusion
                                      │                │
                                      ▼                ▼
                          public/DIAG_MODEL_SDC.docx (gabarit intact)
                                      │  (assemblage dans le navigateur)
                                      ▼
                     CR_DIAG_<IMMEUBLE>_<DATE>.docx téléchargé
             (page de garde + contacts + généralités + observations
                        + conclusion + photos + signature)
                                      │
                                      ▼
                          Relecture dans Word → envoi
```

Le template de l'agence n'est **jamais reconstruit** : il est ouvert, rempli, ré-enregistré.
Logo, styles, cartouche de pied de page, pagination : identiques.

Deux types de documents sont gérés (sélectionnables dans l'appli) :
- **Compte rendu de diagnostic / visite** — `public/DIAG_MODEL_SDC.docx`
- **Compte rendu de chantier** — `public/CR_CHANTIER_MODEL.docx`

## Confidentialité (par conception)

- **Les photos ne quittent jamais le navigateur.** Le fichier .docx est assemblé côté client
  (`lib/docx.ts`). Aucune image n'est envoyée à un service d'IA.
- Seul **du texte** est transmis à Gemini (transcription + fiche immeuble), jamais de photos.
- L'audio n'est transmis à Groq que pour la transcription, via un proxy serveur.
- Les clés d'API restent **côté serveur**, jamais exposées au navigateur.

## Services externes

| Service | Rôle | Où |
|---|---|---|
| **Monday.com** (GraphQL) | Liste des immeubles + personnes (nom, rôle, téléphone, email, présence) | `lib/monday.ts`, `app/api/immeubles` |
| **Groq — Whisper large-v3-turbo** | Transcription de la note vocale (français) | `app/api/transcribe` |
| **Google Gemini — 2.5 Flash** | Analyse la transcription et rédige le CR structuré | `lib/gemini.ts`, `app/api/extract` |

La mise en page du .docx n'utilise **aucun** service externe (assemblage local avec `pizzip`
+ `@xmldom/xmldom`).

## Installation / lancement en local

Prérequis : Node.js 18+.

```bash
npm install
cp .env.example .env.local   # puis renseigner les clés (voir ci-dessous)
npm run dev                  # http://localhost:3000
```

Scripts utiles :

```bash
npm run build        # build de production
npm run typecheck    # vérification TypeScript
npm run hash -- "mon-mot-de-passe"   # génère l'empreinte du mot de passe
```

## Variables d'environnement (`.env.local`)

Voir `.env.example` pour le gabarit complet. En résumé :

| Variable | Rôle |
|---|---|
| `GEMINI_API_KEY` | Rédaction du compte rendu (Google Gemini) |
| `GROQ_API_KEY` | Transcription audio (Groq Whisper) |
| `MONDAY_API_KEY` | Jeton d'accès personnel Monday |
| `MONDAY_BOARD_ID` | Identifiant du board des immeubles |
| `AUTH_EMAIL` | Email du compte unique autorisé |
| `AUTH_PASSWORD_HASH` | Empreinte scrypt du mot de passe (`npm run hash`) |
| `SESSION_SECRET` | Clé de signature des sessions (`openssl rand -hex 32`) |

`.env.local` est ignoré par git et ne doit **jamais** être commité (il contient des secrets).

## Authentification

- Un seul compte autorisé (`AUTH_EMAIL` + mot de passe).
- Le mot de passe n'est jamais stocké en clair : seule son empreinte **scrypt** est conservée.
- Session signée par cookie sécurisé (`jose`), à durée limitée. Voir `lib/session.ts`,
  `lib/password.ts`, `middleware.ts`.

## Déploiement

Application Next.js déployable sur **Vercel**. Renseigner les mêmes variables dans
Vercel → Project → Settings → Environment Variables. Contrainte à connaître : les fonctions
serveur ont une durée max de ~60 s — c'est pourquoi le « raisonnement » de Gemini est
désactivé (`thinkingBudget: 0`), ce qui accélère et cadre les réponses.

## Les fichiers qui comptent

| Fichier | Rôle |
|---|---|
| `prompt_diagnostic.md` | **Le cerveau.** Ton, structure Constat/Analyse/Préconisation, ordre des ouvrages, prudence juridique, volet énergétique. **C'est ici qu'on itère** avec l'architecte : chaque remarque = une règle ajoutée. |
| `lib/gemini.ts` | Appel Gemini : transcription + fiche → données structurées (JSON). |
| `lib/docx.ts` | Remplissage du gabarit + insertion des photos + signature, dans le navigateur. |
| `lib/monday.ts` | Connexion Monday (immeubles + personnes). |
| `public/DIAG_MODEL_SDC.docx`, `public/CR_CHANTIER_MODEL.docx` | Gabarits de l'agence. Ne pas modifier sans re-tester. |

## Calibrage de la section OBSERVATIONS

Chaque désordre est rendu sous la forme :

```
1. FAÇADE SUR COUR
Constat — ce qui est vu, localisé, sans jugement
Analyse — cause probable, au conditionnel, « sous réserve de sondages »
Préconisation — mise en sécurité / investigation / travaux / BET
(cf. photos n° 1, n° 2)               (seulement si la note vocale le permet)
```

Ordre de présentation des ouvrages : structure → façades → couverture/zinguerie →
étanchéité/humidité → parties communes → menuiseries → réseaux → sous-sol →
sécurité/conformité → divers. Seuls les ouvrages réellement évoqués apparaissent.

Le calibrage est la phase décisive : l'architecte lance quelques vraies notes vocales,
annote le résultat, et chaque correction est traduite en règle dans `prompt_diagnostic.md`.

## Limites connues

- L'IA peut mal transcrire un terme technique ou reformuler imparfaitement : **la relecture
  dans Word reste indispensable** avant envoi. L'outil produit un brouillon fiable, pas un
  document final validé automatiquement.
- Les photos ne sont légendées que si l'architecte annonce le numéro de photo dans sa note
  vocale. La reconnaissance visuelle automatique des désordres est possible techniquement
  mais peu fiable — à ne pas promettre.
- Les fichiers `.heic` (iPhone) doivent être convertis en `.jpg` en amont, sinon Word ne
  les affichera pas.
- Aujourd'hui : un seul compte, et outil lancé en local pour la démo (déployable en ligne).
