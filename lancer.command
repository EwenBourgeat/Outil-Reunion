#!/bin/bash
# ==========================================================================
#  lancer.command  —  Double-cliquez sur ce fichier pour ouvrir l'application
#  (équivalent macOS de lancer.bat). Il prépare l'environnement au premier
#  lancement, démarre le serveur local et ouvre votre navigateur.
#  Pour quitter : fermez cette fenêtre du Terminal (ou faites Ctrl-C).
# ==========================================================================

# Se placer dans le dossier de ce fichier, quel que soit l'endroit d'appel.
cd "$(dirname "$0")" || exit 1

echo
echo "  ==============================================="
echo "    COMPTE RENDU DE DIAGNOSTIC"
echo "  ==============================================="
echo

# --- 1. Python 3 est-il installé ? ---------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  echo "  PROBLEME : Python 3 n'est pas installe."
  echo
  echo "  Que faire :"
  echo "    1. Ouvrez  https://www.python.org/downloads/macos/"
  echo "    2. Telechargez Python 3, lancez l'installateur, terminez l'installation."
  echo "    3. Relancez ce fichier « lancer.command »."
  echo
  read -r -p "  Appuyez sur Entree pour fermer."
  exit 1
fi

# --- 2. Premier lancement : environnement + dependances ------------------
if [ ! -x ".venv/bin/python" ]; then
  echo "  Premier lancement : preparation de l'application."
  echo "  Cette etape ne se produit qu'une fois et peut durer quelques minutes"
  echo "  (telechargements). Merci de patienter..."
  echo
  python3 -m venv .venv || { echo "  PROBLEME : creation de l'environnement impossible."; read -r -p "  Entree pour fermer."; exit 1; }
  ".venv/bin/python" -m pip install --upgrade pip
  if ! ".venv/bin/python" -m pip install -r requirements.txt; then
    echo "  PROBLEME : l'installation des composants a echoue."
    echo "  Verifiez votre connexion internet et relancez « lancer.command »."
    read -r -p "  Entree pour fermer."
    exit 1
  fi
  echo
  echo "  Installation terminee."
  echo
fi

# --- 3. Creer config.txt depuis le modele au premier lancement -----------
if [ ! -f "config.txt" ]; then
  cp "config.txt.example" "config.txt"
fi

# --- 4. La cle Claude est-elle renseignee ? ------------------------------
KEY="$(grep -E '^[[:space:]]*ANTHROPIC_API_KEY[[:space:]]*=' config.txt | head -n1 | cut -d= -f2- | tr -d ' \t\r\"'"'"'')"
if [ -z "$KEY" ]; then
  echo "  PROBLEME : la cle Claude n'est pas configuree."
  echo
  echo "  Que faire :"
  echo "    1. Ouvrez le fichier « config.txt » (dans ce meme dossier)."
  echo "    2. Collez votre cle apres  ANTHROPIC_API_KEY="
  echo "    3. Enregistrez le fichier, puis relancez « lancer.command »."
  echo
  # On ouvre config.txt pour l'utilisateur.
  open -e "config.txt" 2>/dev/null
  read -r -p "  Entree pour fermer."
  exit 1
fi

# --- 5. Ouvrir le navigateur (apres un court delai) puis lancer le serveur
echo "  Demarrage... votre navigateur va s'ouvrir automatiquement."
echo "  Laissez cette fenetre OUVERTE tant que vous utilisez l'outil."
echo "  Pour quitter : fermez cette fenetre (ou Ctrl-C)."
echo
( sleep 4; open "http://127.0.0.1:8000" ) &

".venv/bin/python" -m uvicorn app:app --host 127.0.0.1 --port 8000

echo
echo "  Le serveur s'est arrete."
read -r -p "  Entree pour fermer."
