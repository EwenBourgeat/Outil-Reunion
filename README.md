# Outil de génération automatique des CR de DIAGNOSTIC (GO Architecture)

## Ce que fait l'outil

```
Note vocale (2 min)  ──┐
Fiche chantier Monday ─┼──►  Claude (prompt_diagnostic.md)  ──►  cr_extrait.json
Photos (Drive/local) ──┘                                              │
                                                                      ▼
                                          template/DIAG_MODEL_SDC.docx (intact)
                                                                      │
                                                                      ▼
                                     sortie/CR_DIAG_<IMMEUBLE>_<DATE>.docx
                                        (page de garde + contacts + généralités
                                         + observations + conclusion + photos)
                                                                      │
                                                                      ▼
                                              Relecture dans Word → envoi
```

Le template de l'agence n'est **jamais reconstruit** : il est ouvert, rempli, enregistré
sous un autre nom. Logo, styles, cartouche de pied de page, pagination : identiques.

## Installation (Windows)

```bat
python -m pip install python-docx pillow anthropic
setx ANTHROPIC_API_KEY sk-ant-...
```

## Utilisation

```bat
python run.py --chantier exemples/chantier.json --note note.txt --photos photos --sortie sortie
```

Mode relecture / démo (repart d'un JSON déjà extrait, aucun appel API) :

```bat
python run.py --chantier exemples/chantier.json --json exemples/cr_extrait.json --photos photos --sortie sortie
```

Le script imprime en fin d'exécution la liste `[A COMPLETER]` : les informations que
l'architecte n'a pas dictées et qu'il doit vérifier avant envoi.

## Les 3 fichiers qui comptent

| Fichier | Rôle |
|---|---|
| `prompt_diagnostic.md` | **Le cerveau.** Ton, structure Constat/Analyse/Préconisation, ordre des ouvrages, prudence juridique, volet énergétique. **C'est ici qu'on itère** avec l'architecte : chaque remarque de sa part = une règle ajoutée ici. |
| `cr_engine.py` | Extraction (appel Claude) + remplissage du .docx + insertion des photos. |
| `template/DIAG_MODEL_SDC.docx` | Le gabarit de l'agence. Ne pas le modifier sans re-tester. |

## Calibrage actuel de la section OBSERVATIONS

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

## Étapes suivantes (dans l'ordre)

1. **Calibrage** — l'architecte lance 3 ou 4 vraies notes vocales, annote le résultat.
   Chaque correction est traduite en règle dans `prompt_diagnostic.md`. C'est la seule
   phase qui demande du temps de sa part, et elle est décisive.
2. **Transcription automatique** — aujourd'hui il dicte dans ChatGPT. Brancher Whisper
   (`whisper-1`) en amont pour partir directement d'un fichier `.m4a`.
3. **Connexion Monday** — remplacer `exemples/chantier.json` par un appel à l'API Monday
   (GraphQL) sur le code immeuble → suppression de toute saisie manuelle.
4. **Déclencheur** — dépôt de la note vocale + du dossier photos dans un dossier Google
   Drive nommé au code immeuble ; l'outil surveille le dossier et génère le CR.
5. **Classement + e-mail** — copie automatique dans `…/copropriété/<nom immeuble>/` sur le
   PC, et génération d'un brouillon Gmail (entreprises + BET, syndic/MOA en copie),
   à activer seulement quand la relecture ne révèle plus de correction.
6. **Réunions de suivi** (2ᵉ type) — même moteur, autre template, avec reprise automatique
   des points du CR précédent (le `cr_extrait.json` archivé sert d'état antérieur : c'est
   pour cela que le JSON est conservé à chaque génération).

## Limites connues

- Les photos ne sont **pas** légendées automatiquement, sauf si l'architecte annonce le
  numéro de photo dans sa note vocale. Sans convention orale, elles restent juxtaposées
  en fin de rapport, comme aujourd'hui. La reconnaissance visuelle automatique des
  désordres est possible techniquement, mais peu fiable — à ne pas promettre.
- Les fichiers `.heic` (iPhone) doivent être convertis en `.jpg` en amont
  (`pillow-heif`), sinon Word ne les affichera pas.
