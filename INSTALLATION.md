# Installation et utilisation — Compte rendu de diagnostic

Ce guide est écrit pour être suivi **sans aucune connaissance en informatique**.
Vous n'aurez jamais à ouvrir de « terminal » ni à taper de commande.

---

## Ce dont vous avez besoin, une seule fois

### 1. Installer Python (le moteur de l'application)

1. Ouvrez cette page : **https://www.python.org/downloads/**
2. Cliquez sur le gros bouton jaune **« Download Python »**.
3. Ouvrez le fichier téléchargé pour lancer l'installation.
4. **Très important** : sur le premier écran, cochez la case
   **« Add Python to PATH »** (tout en bas), *puis* cliquez sur **Install Now**.
5. Attendez la fin, puis cliquez sur **Close**.

> Si vous oubliez de cocher « Add Python to PATH », l'application vous le dira
> au démarrage : il suffira de réinstaller Python en cochant bien la case.

### 2. Renseigner votre clé Claude

L'application dicte votre note à Claude pour rédiger le compte rendu. Il lui faut
donc votre **clé personnelle**.

> Si le fichier **`config.txt`** n'existe pas encore, double-cliquez une première
> fois sur **`lancer.bat`** : il le crée automatiquement, puis vous demande la clé.

1. Ouvrez le fichier **`config.txt`** (double-clic ; il s'ouvre dans le Bloc-notes).
2. Vous voyez une ligne :

   ```
   ANTHROPIC_API_KEY=
   ```

3. Collez votre clé juste après le `=`, sans espace. Cela donne par exemple :

   ```
   ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxx
   ```

4. **Fichier → Enregistrer**, puis fermez le Bloc-notes.

> Votre clé se trouve sur **https://console.anthropic.com/**, rubrique
> **API Keys**. Elle commence toujours par `sk-ant-`. Gardez-la secrète.

---

## Lancer l'application (à chaque utilisation)

**Double-cliquez sur `lancer.bat`.**

- Une fenêtre noire s'ouvre : c'est normal, **laissez-la ouverte**.
- Au bout de quelques secondes, votre navigateur s'ouvre tout seul sur
  l'application.
- **Le tout premier lancement est plus long** (quelques minutes) : l'application
  télécharge ce dont elle a besoin, dont le moteur de transcription qui
  fonctionnera ensuite **sans internet**. Les fois suivantes, c'est immédiat.

Pour **quitter** : fermez simplement la fenêtre noire.

---

## Faire un compte rendu, en trois gestes

1. **Le chantier** — choisissez l'immeuble dans la liste. S'il n'y est pas encore,
   cliquez sur **« Nouvel immeuble »** et saisissez son identité puis les
   participants (organisme, nom, téléphone, e-mail) ; les boutons **Modifier** et
   **Supprimer** permettent d'entretenir la liste ensuite. Décochez les personnes
   absentes. Vérifiez la date.
2. **La note vocale** — appuyez sur le gros bouton rond pour dicter votre visite,
   ou déposez un fichier audio. Le texte transcrit s'affiche : relisez-le et
   corrigez un mot si besoin.
3. **Les photos** — glissez vos photos. Rangez-les dans l'ordre de votre visite
   en les faisant glisser ; ajoutez une légende si vous le souhaitez.

Puis cliquez sur **« Générer le compte rendu »**. Au bout de moins d'une minute,
le document Word est prêt : cliquez sur **« Ouvrir dans Word »** pour le relire.

> Avant d'ouvrir Word, l'application vous rappelle les **points à vérifier** :
> ce sont les informations qui n'étaient pas dans votre note (nombre de lots,
> dates…). Confirmez-les avant d'envoyer le rapport.

---

## Où sont mes documents ?

Chaque compte rendu est enregistré sur votre PC, dans le dossier **`sortie`**,
rangé par immeuble :

```
sortie\SDC EXEMPLE\CR_DIAG_SDC_29_RUE_RAMEY_20260311.docx
```

Le bouton **« Ouvrir le dossier »** vous y emmène directement.

---

## En cas de souci

L'application affiche toujours un message clair en français vous indiquant quoi
faire. Les cas les plus courants :

| Message | Ce qu'il faut faire |
|---|---|
| « Python n'est pas installé » | Reprenez l'étape 1 ci-dessus. |
| « La clé Claude n'est pas configurée » | Reprenez l'étape 2 (le fichier `config.txt`). |
| « Pas de connexion » | La transcription marche hors ligne, mais la rédaction a besoin d'internet. Vérifiez votre connexion. |
| « L'enregistrement semble vide » | Réenregistrez en parlant un peu plus longtemps (au moins 5 secondes). |

Si vous fermez la page par accident en pleine saisie, **rouvrez simplement
l'application** : votre chantier, votre transcription et vos photos sont
récupérés automatiquement.
