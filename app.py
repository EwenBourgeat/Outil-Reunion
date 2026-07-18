"""
app.py — Serveur local de l'outil « Compte rendu de diagnostic ».

FastAPI sert à la fois l'API et l'unique page web (web/index.html).
Toute la logique métier reste dans cr_engine.py et prompt_diagnostic.md :
ce fichier ne fait qu'orchestrer (transcription, appel du moteur, fichiers).

Lancement (via lancer.bat) :
    uvicorn app:app --host 127.0.0.1 --port 8000
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import tempfile
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from PIL import Image

import auth
import cr_engine

# --- Chemins de travail (relatifs au dossier du projet) --------------------
RACINE = Path(__file__).resolve().parent
TEMPLATE = RACINE / "template" / "DIAG_MODEL_SDC.docx"
DATA = RACINE / "data" / "chantiers.json"
SORTIE = RACINE / "sortie"
WEB = RACINE / "web" / "index.html"
LOGIN = RACINE / "web" / "login.html"
PROMPT = RACINE / "prompt_diagnostic.md"

LARGEUR_MAX_PX = 1600          # compression : largeur max des photos
QUALITE_JPG = 85

CONFIG = RACINE / "config.txt"


def _charger_config() -> None:
    """Lit config.txt (ANTHROPIC_API_KEY=...) et l'expose comme variable
    d'environnement, pour que l'architecte n'ait qu'un fichier texte à remplir."""
    if os.environ.get("ANTHROPIC_API_KEY") or not CONFIG.exists():
        return
    for ligne in CONFIG.read_text(encoding="utf-8").splitlines():
        ligne = ligne.strip()
        if ligne.startswith("#") or "=" not in ligne:
            continue
        cle, _, valeur = ligne.partition("=")
        valeur = valeur.strip().strip('"').strip("'")
        if cle.strip() == "ANTHROPIC_API_KEY" and valeur:
            os.environ["ANTHROPIC_API_KEY"] = valeur


_charger_config()

app = FastAPI(title="Compte rendu de diagnostic")

# Le modèle de transcription est lourd à charger : on le garde en mémoire
# entre deux appels (chargé paresseusement au premier /api/transcrire).
_whisper = None


# ---------------------------------------------------------------------------
# Authentification : garde d'accès sur toute l'application
# ---------------------------------------------------------------------------
# Seules la page de connexion et ses deux routes sont accessibles sans session.
CHEMINS_PUBLICS = {"/login", "/api/login", "/api/logout"}


@app.middleware("http")
async def garde_authentification(request: Request, call_next):
    chemin = request.url.path
    if chemin in CHEMINS_PUBLICS or auth.jeton_valide(request.cookies.get(auth.COOKIE)):
        return await call_next(request)
    if chemin.startswith("/api/"):
        return JSONResponse({"detail": "Session expirée. Reconnectez-vous."}, status_code=401)
    return RedirectResponse("/login", status_code=303)


@app.get("/login")
def page_login() -> FileResponse:
    return FileResponse(LOGIN)


@app.post("/api/login")
async def connexion(request: Request, email: str = Form(...), mdp: str = Form(...)) -> JSONResponse:
    if not auth.verifier_identifiants(email, mdp):
        await asyncio.sleep(0.5)          # ralentit les tentatives par force brute
        raise HTTPException(401, "E-mail ou mot de passe incorrect.")
    rep = JSONResponse({"ok": True})
    auth.poser_cookie(rep, secure=(request.url.scheme == "https"))
    return rep


@app.post("/api/logout")
async def deconnexion() -> JSONResponse:
    rep = JSONResponse({"ok": True})
    auth.retirer_cookie(rep)
    return rep


# ---------------------------------------------------------------------------
# Pages et fichiers statiques
# ---------------------------------------------------------------------------

@app.get("/")
def accueil() -> FileResponse:
    return FileResponse(WEB)


# ---------------------------------------------------------------------------
# Chantiers (bibliothèque d'immeubles connus)
# ---------------------------------------------------------------------------

def _lire_chantiers() -> list[dict]:
    if not DATA.exists():
        return []
    return json.loads(DATA.read_text(encoding="utf-8")).get("chantiers", [])


def _ecrire_chantiers(chantiers: list[dict]) -> None:
    DATA.parent.mkdir(parents=True, exist_ok=True)
    DATA.write_text(
        json.dumps({"chantiers": chantiers}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


@app.get("/api/chantiers")
def liste_chantiers() -> list[dict]:
    return _lire_chantiers()


@app.post("/api/chantiers")
async def ajouter_chantier(chantier: str = Form(...)) -> dict:
    """Ajoute un nouvel immeuble à la bibliothèque et le renvoie."""
    try:
        nouveau = json.loads(chantier)
    except json.JSONDecodeError:
        raise HTTPException(400, "Fiche chantier illisible.")
    if not nouveau.get("sdc"):
        raise HTTPException(400, "Le nom de l'immeuble est obligatoire.")
    chantiers = _lire_chantiers()
    chantiers.append(nouveau)
    _ecrire_chantiers(chantiers)
    return nouveau


# ---------------------------------------------------------------------------
# Transcription audio (faster-whisper, hors ligne)
# ---------------------------------------------------------------------------

def _charger_whisper():
    global _whisper
    if _whisper is None:
        from faster_whisper import WhisperModel
        # Premier lancement : télécharge le modèle « small » (~500 Mo) une fois.
        print(">> Chargement du modèle de transcription (1re fois : téléchargement)…",
              flush=True)
        _whisper = WhisperModel("small", device="cpu", compute_type="int8")
        print(">> Modèle de transcription prêt.", flush=True)
    return _whisper


@app.post("/api/transcrire")
async def transcrire(audio: UploadFile) -> dict:
    donnees = await audio.read()
    if len(donnees) < 2000:
        raise HTTPException(422, "L'enregistrement semble vide.")

    suffixe = Path(audio.filename or "note.m4a").suffix or ".m4a"
    with tempfile.NamedTemporaryFile(suffix=suffixe, delete=False) as tmp:
        tmp.write(donnees)
        chemin = tmp.name
    try:
        modele = _charger_whisper()
        segments, info = modele.transcribe(chemin, language="fr", vad_filter=True)
        texte = " ".join(s.text.strip() for s in segments).strip()
    finally:
        os.unlink(chemin)

    if not texte:
        raise HTTPException(422, "Aucune parole n'a été détectée dans l'enregistrement.")
    return {"transcription": texte, "duree": round(info.duration or 0)}


# ---------------------------------------------------------------------------
# Génération du compte rendu
# ---------------------------------------------------------------------------

def _preparer_photos(photos: list[UploadFile], dossier: Path) -> list[str]:
    """Convertit (.heic→.jpg), compresse et renomme les photos dans l'ordre reçu.

    L'ordre des vignettes côté interface = l'ordre des fichiers ici. Le moteur
    (cr_engine._inserer_photos) lit le dossier trié : on préfixe donc chaque nom
    par son rang (01, 02…) pour que le tri respecte cet ordre.
    """
    import pillow_heif
    pillow_heif.register_heif_opener()

    noms: list[str] = []
    for i, photo in enumerate(photos, start=1):
        nom = f"{i:02d}.jpg"
        with Image.open(photo.file) as im:
            im = im.convert("RGB")
            if im.width > LARGEUR_MAX_PX:
                h = round(im.height * LARGEUR_MAX_PX / im.width)
                im = im.resize((LARGEUR_MAX_PX, h), Image.LANCZOS)
            im.save(dossier / nom, "JPEG", quality=QUALITE_JPG)
        noms.append(nom)
    return noms


def _extraire_avec_reprise(transcription, chantier, noms_photos) -> dict:
    """Appelle Claude ; en cas de JSON invalide, réessaie une seule fois."""
    try:
        return cr_engine.extraire(transcription, chantier, noms_photos, str(PROMPT))
    except json.JSONDecodeError:
        return cr_engine.extraire(transcription, chantier, noms_photos, str(PROMPT))


@app.post("/api/generer")
async def generer(
    chantier: str = Form(...),
    transcription: str = Form(...),
    legendes: str = Form("[]"),
    photos: list[UploadFile] = [],
) -> JSONResponse:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise HTTPException(400,
            "La clé Claude n'est pas configurée. Ouvrez le fichier config.txt "
            "et collez votre clé.")
    if not transcription.strip():
        raise HTTPException(422, "La transcription est vide.")

    fiche = json.loads(chantier)
    liste_legendes = json.loads(legendes) if legendes else []

    with tempfile.TemporaryDirectory() as tmp:
        dossier_photos = Path(tmp)
        noms = _preparer_photos(photos, dossier_photos) if photos else []

        # 1. Analyse et rédaction (Claude). Erreur réseau -> message clair.
        try:
            donnees = _extraire_avec_reprise(transcription, fiche, noms)
        except json.JSONDecodeError:
            raise HTTPException(502,
                "L'analyse a échoué. Votre transcription est conservée, vous "
                "pouvez relancer.")
        except Exception as e:                       # réseau, clé, quota…
            if _est_erreur_reseau(e):
                raise HTTPException(503,
                    "Pas de connexion. La transcription fonctionne hors ligne, "
                    "mais la rédaction du compte rendu nécessite internet.")
            raise HTTPException(502, f"L'analyse a échoué : {e}")

        # 2. Les légendes saisies dans l'interface priment sur celles devinées
        #    par Claude, et fixent l'ordre des photos dans le document.
        donnees["photos"] = [
            {"fichier": noms[i],
             "legende": liste_legendes[i] if i < len(liste_legendes) else ""}
            for i in range(len(noms))
        ]

        # 3. Mise en page dans le template (moteur inchangé).
        slug = re.sub(r"[^A-Za-z0-9]+", "_", fiche["sdc"]).strip("_").upper()
        date = datetime.fromisoformat(fiche["date_visite"]).strftime("%Y%m%d")
        dossier_sortie = SORTIE / fiche["sdc"]
        dossier_sortie.mkdir(parents=True, exist_ok=True)
        chemin_docx = dossier_sortie / f"CR_DIAG_{slug}_{date}.docx"

        cr_engine.generer(donnees, fiche, str(TEMPLATE), str(chemin_docx),
                          str(dossier_photos) if noms else None)

    # 4. Archive du JSON extrait (état antérieur pour les CR de suivi).
    (dossier_sortie / "cr_extrait.json").write_text(
        json.dumps(donnees, ensure_ascii=False, indent=2), encoding="utf-8")

    return JSONResponse({
        "docx": str(chemin_docx),
        "dossier": str(dossier_sortie),
        "points_a_completer": donnees.get("points_a_completer", []),
    })


def _est_erreur_reseau(e: Exception) -> bool:
    txt = f"{type(e).__name__} {e}".lower()
    return any(m in txt for m in ("connection", "connect", "network", "timeout",
                                   "getaddrinfo", "resolve", "unreachable"))


# ---------------------------------------------------------------------------
# Ouverture d'un fichier ou d'un dossier dans le système
# ---------------------------------------------------------------------------

@app.post("/api/ouvrir")
async def ouvrir(chemin: str = Form(...)) -> dict:
    p = Path(chemin)
    if not p.exists():
        raise HTTPException(404, "Le fichier ou le dossier est introuvable.")
    try:
        if sys.platform.startswith("win"):
            os.startfile(str(p))                     # noqa: S606 (Windows)
        elif sys.platform == "darwin":
            import subprocess
            subprocess.Popen(["open", str(p)])
        else:
            import subprocess
            subprocess.Popen(["xdg-open", str(p)])
    except Exception as e:
        raise HTTPException(500, f"Impossible d'ouvrir : {e}")
    return {"ok": True}
