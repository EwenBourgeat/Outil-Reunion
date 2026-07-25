# PROMPT CLAUDE CODE — Interface « Compte rendu de diagnostic »

> Colle ce fichier entier comme premier message dans Claude Code, à la racine du dossier
> `outil_cr_diag/`. Ne le résume pas : il est calibré pour être lu en entier.

---

## 0. Ce que tu construis

Une **application de bureau locale** qui permet à un architecte de copropriété, seul dans son
cabinet, de produire son compte rendu de visite de diagnostic en trois gestes :

1. il dépose (ou enregistre) sa note vocale,
2. il dépose ses photos,
3. il clique sur un bouton et récupère un `.docx` prêt à relire dans Word.

Aujourd'hui il dicte dans ChatGPT, recopie la réponse dans son template Word, insère les
photos une par une. Il fait plusieurs visites par semaine. Chaque compte rendu lui coûte
environ une heure. L'objectif est de descendre sous les cinq minutes, relecture comprise.

**L'utilisateur n'est pas développeur.** Il travaille sur Windows, ses dossiers sont en local
sur son PC, il n'ouvrira jamais un terminal de son plein gré. L'application doit se lancer
d'un double-clic et s'ouvrir dans son navigateur.

---

## 1. Ce qui existe déjà (à lire avant d'écrire une ligne)

Le dossier contient un moteur qui **fonctionne déjà** et qui a été validé :

| Fichier | Rôle |
|---|---|
| `cr_engine.py` | `extraire()` : note vocale + fiche chantier → JSON structuré (appel Claude). `generer()` : JSON + template + photos → `.docx`. |
| `prompt_diagnostic.md` | Le prompt métier : ton, structure Constat / Analyse / Préconisation, prudence juridique, volet énergétique. |
| `template/DIAG_MODEL_SDC.docx` | Le template de l'agence. Logo, cartouche de pied de page, styles. **Ne le modifie jamais.** |
| `run.py` | CLI actuel, à conserver. |
| `exemples/` | Une fiche chantier, une note vocale, un JSON extrait. Sert de jeu de test. |

**Contraintes absolues :**

- Tu **réutilises** `cr_engine.py` tel quel. Tu ne réécris pas la logique de remplissage du
  `.docx`, tu ne remplaces pas python-docx par autre chose, tu ne « modernises » rien. Ce
  code a été testé contre le vrai template : toute réécriture est une régression.
- Si tu dois modifier `cr_engine.py`, tu ajoutes des fonctions, tu n'en changes pas les
  signatures existantes.
- Le fichier `prompt_diagnostic.md` est le seul endroit où vit la logique métier. L'interface
  ne doit contenir aucune règle de rédaction en dur.

---

## 2. Stack imposée

Pas de discussion là-dessus : ce projet sera maintenu par une seule personne, à temps partiel.

- **Backend** : Python + FastAPI + Uvicorn. Il sert l'API *et* le front.
- **Front** : **un seul fichier** `web/index.html`, HTML + JavaScript vanilla + Tailwind via
  CDN. **Aucun build step**, pas de npm, pas de React, pas de bundler, pas de TypeScript.
- **Transcription audio** : `faster-whisper` en local (modèle `small`, `compute_type="int8"`).
  Aucune clé API supplémentaire, aucun envoi de l'audio sur internet, ça tourne offline sur
  son PC. Prévois un premier lancement qui télécharge le modèle avec un message clair.
- **Rédaction** : Claude via `cr_engine.extraire()` (clé `ANTHROPIC_API_KEY`).
- **Lancement** : un `lancer.bat` que l'utilisateur double-clique. Il démarre le serveur et
  ouvre `http://127.0.0.1:8000` dans le navigateur par défaut. Il affiche une erreur lisible
  en français si Python manque ou si la clé API n'est pas configurée.
- **Persistance** : un simple fichier `data/chantiers.json` (liste des immeubles + contacts).
  Pas de base de données. Chaque génération archive son `cr_extrait.json` à côté du `.docx`
  (il servira d'état antérieur pour les futurs comptes rendus de suivi).

---

## 3. Le parcours utilisateur, écran par écran

**Un seul écran, trois zones, une progression verticale.** Pas d'onglets, pas de menu, pas de
routeur. Il doit comprendre quoi faire sans qu'on le lui explique.

### Zone 1 — Le chantier
- Un `<select>` des immeubles connus, chargé depuis `data/chantiers.json`. Affiche nom de
  l'immeuble + adresse + code immeuble.
- Une fois l'immeuble choisi : la liste de ses contacts s'affiche, chacun avec une case à
  cocher **Présent**. C'est le seul geste de saisie de l'écran. Par défaut, tout le monde est
  présent, il décoche les absents. (Le client a confirmé : les intervenants ne changent
  quasiment jamais d'une réunion à l'autre.)
- Un champ date, prérempli à aujourd'hui.
- Un bouton discret « + Nouvel immeuble » qui ouvre un petit formulaire (nom, adresse, code
  immeuble, n° d'affaire, syndic, contacts) et l'écrit dans `chantiers.json`.

### Zone 2 — La note vocale
Deux moyens, au choix, sur la même carte :
- **Enregistrer directement** dans le navigateur (MediaRecorder). Un gros bouton rond rouge,
  un chronomètre, une forme d'onde animée pendant l'enregistrement, un bouton Stop, puis un
  lecteur audio pour se réécouter et un bouton « Refaire ». C'est le geste qu'il fera le plus
  souvent, sur son téléphone comme sur son PC : soigne-le.
- **Déposer un fichier** (`.m4a`, `.mp3`, `.wav`, `.ogg`) par glisser-déposer.

Après transcription, **affiche le texte transcrit dans une zone éditable**. Il doit pouvoir
corriger un mot avant l'analyse. La transcription se déclenche dès que l'audio est là, sans
attendre le clic de génération.

### Zone 3 — Les photos
- Glisser-déposer multiple, ou clic pour parcourir. Vignettes en grille.
- **Réorganisables par glisser-déposer.** L'ordre des vignettes = l'ordre dans le document.
  C'est important : il prend ses photos dans l'ordre de sa visite.
- Chaque vignette a un champ légende facultatif (placeholder : « légende facultative »), une
  croix pour supprimer, et affiche son numéro (Photo n° 1, n° 2…).
- Conversion `.heic` → `.jpg` côté serveur via `pillow-heif` (ses photos viennent d'un
  iPhone : sans ça, Word n'affiche rien).
- Compression : redimensionne à 1600 px de large max, qualité 85. Un rapport avec 30 photos
  brutes d'iPhone pèserait 200 Mo.

### Le bouton
Un seul bouton primaire, large, en bas : **« Générer le compte rendu »**. Désactivé tant
qu'un immeuble et une note vocale ne sont pas présents.

### Pendant la génération
Une progression en quatre étapes explicites, chacune passant de *en cours* à *fait* :
`Transcription de la note vocale` → `Analyse et rédaction` → `Mise en page dans le template`
→ `Compte rendu prêt`. Jamais de spinner anonyme : il doit savoir où on en est, ça peut
prendre 30 à 60 secondes.

### Après la génération
- Un rappel visible des **`points_a_completer`** renvoyés par Claude, sous forme de liste à
  cocher (« Nombre de lots à confirmer », « Date du dernier ravalement à confirmer »…). C'est
  le garde-fou contre l'invention, et donc contre sa mise en cause professionnelle. Ne
  l'enterre pas en bas de page.
- Trois boutons : **Ouvrir dans Word** (ouvre le `.docx` avec l'application par défaut via
  `os.startfile`), **Ouvrir le dossier**, **Nouveau compte rendu**.
- Le fichier est écrit dans `sortie/<nom immeuble>/CR_DIAG_<IMMEUBLE>_<AAAAMMJJ>.docx`, avec
  le `cr_extrait.json` à côté.

---

## 4. Design read

**Lis-le ainsi : outil métier interne, mono-utilisateur, pour un architecte de terrain qui
n'aime pas les logiciels. Langage : sobre, dense en information utile, franc, un peu
« chantier ». Rassurant plutôt que joli.**

Dials : `DESIGN_VARIANCE: 4` · `MOTION_INTENSITY: 3` · `VISUAL_DENSITY: 3`.

- **Palette** : fond blanc cassé (`#FAFAF8`), texte quasi-noir (`#1A1A1A`), une seule couleur
  d'accent, un orange de sécurité chantier (`#D65A1F`), réservée au bouton primaire, aux
  états actifs et à l'enregistrement. Gris de structure pour les bordures.
- **Typographie** : une grotesque neutre et lisible (Inter Tight ou Söhne si dispo, sinon
  system-ui). Corps à 16 px minimum. Il a plus de cinquante ans, il lira ça sur un écran de
  PC portable mal réglé.
- **Cibles tactiles** : 44 × 44 px minimum. Il utilisera peut-être l'outil sur tablette
  depuis la voiture.
- **Mouvement** : transitions de 150 à 200 ms sur les états, et c'est tout. Une seule
  exception, la forme d'onde pendant l'enregistrement, qui doit vivre. Respecte
  `prefers-reduced-motion`.

**Anti-défauts, interdits explicites** : dégradé violet/indigo, hero centré sur mesh sombre,
glassmorphisme, trois cartes de features, emoji en guise d'icônes, ombres portées molles
partout, `Inter + slate-900` par réflexe, animation en boucle infinie. Ce n'est pas une
landing page SaaS, c'est un outil qu'il ouvrira deux fois par semaine pendant cinq ans.

Utilise des icônes SVG inline (jeu Lucide, copié dans le HTML), pas de librairie d'icônes.

---

## 5. Gestion des erreurs (elle compte autant que le reste)

Il sera seul face à l'écran, sans toi. Chaque erreur doit dire **ce qui s'est passé et quoi
faire**, en français, sans jargon technique, sans stack trace :

- clé API absente ou invalide → « La clé Claude n'est pas configurée. Ouvrez le fichier
  `config.txt` et collez votre clé. »
- pas de connexion internet → « Pas de connexion. La transcription fonctionne hors ligne,
  mais la rédaction du compte rendu nécessite internet. »
- micro refusé par le navigateur → explique comment autoriser le micro.
- audio vide ou de moins de 5 secondes → « L'enregistrement semble vide. »
- Claude renvoie un JSON invalide → **réessaie une fois automatiquement**, puis affiche
  « L'analyse a échoué. Votre transcription est conservée, vous pouvez relancer. » et ne perd
  jamais la transcription ni les photos. Rien de ce qu'il a saisi ne doit disparaître à cause
  d'une erreur.

Le travail en cours (chantier, transcription, photos) est sauvegardé dans `localStorage` à
chaque changement, et restauré s'il ferme l'onglet par accident.

---

## 6. Méthode de travail attendue

Procède par étapes et **arrête-toi à chaque palier pour me montrer le résultat**. Ne fais pas
tout d'un coup.

1. **Lecture.** Lis `cr_engine.py`, `run.py`, `prompt_diagnostic.md`, `exemples/`. Résume-moi
   en dix lignes ce que fait déjà le moteur et ce que tu vas devoir ajouter. Ne code rien
   avant que j'aie validé ce résumé.
2. **Backend.** `app.py` (FastAPI) avec les routes : `GET /api/chantiers`,
   `POST /api/chantiers`, `POST /api/transcrire` (audio → texte), `POST /api/generer`
   (transcription + chantier + photos → docx), `POST /api/ouvrir` (ouvre un fichier ou un
   dossier). Teste chaque route au curl avec les fichiers d'`exemples/` avant de passer à la
   suite.
3. **Front.** `web/index.html`. Une seule page. Montre-moi une capture avant d'aller plus loin.
4. **Lanceur.** `lancer.bat` + `config.txt` + un `INSTALLATION.md` en français, écrit pour
   quelqu'un qui n'a jamais installé Python.
5. **Test de bout en bout.** Avec `exemples/note_vocale.txt` converti en audio, ou un vrai
   fichier audio si j'en fournis un. Le `.docx` produit doit être identique en structure à
   celui que produit déjà `run.py`.

À chaque palier, dis-moi ce que tu as choisi et pourquoi, en une phrase. Si un choix
d'architecture me coûte cher plus tard, préviens-moi avant de le faire, pas après.

---

## 7. Critères d'acceptation

- [ ] Double-clic sur `lancer.bat` → l'application s'ouvre dans le navigateur, sans terminal.
- [ ] Un compte rendu complet se produit en moins de 5 clics et moins de 90 secondes.
- [ ] Le `.docx` généré est ouvrable dans Word sans avertissement de réparation, conserve le
      logo, le cartouche de pied de page et la pagination du template d'origine.
- [ ] Les photos apparaissent 2 par ligne, dans l'ordre choisi par l'utilisateur, avec leurs
      légendes s'il en a saisi.
- [ ] Fermer l'onglet en cours de saisie et le rouvrir ne perd rien.
- [ ] Aucune règle de rédaction métier n'est écrite ailleurs que dans `prompt_diagnostic.md`.
- [ ] Aucun texte visible par l'utilisateur n'est en anglais.
- [ ] Le code total du front tient dans un seul fichier lisible, commenté en français.

---

## 8. Ce que tu ne fais pas

- Pas d'authentification, pas de comptes, pas de multi-utilisateur. Il est seul.
- Pas de déploiement cloud. Ses fichiers restent sur son PC.
- Pas de base de données.
- Pas de connexion Monday à ce stade : `chantiers.json` fait le travail. On branchera l'API
  Monday quand l'interface sera adoptée, et la structure du JSON est justement faite pour ça.
- Pas d'envoi d'e-mail automatique. Il veut relire avant d'envoyer, et il a raison.
- Pas de reconnaissance automatique du contenu des photos. Peu fiable, et une erreur de
  légende dans un rapport signé engage sa responsabilité.

---

## 9. Le contexte humain, en une ligne

Cet homme perd une heure par compte rendu à faire du copier-coller. Si l'interface le fait
douter une seule fois, il retournera à ChatGPT et à Word. Elle doit être ennuyeuse, prévisible
et rapide.
