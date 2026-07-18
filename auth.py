"""
auth.py — Authentification locale, sans base de données.

Conception (adaptée à une application locale mono-utilisateur, sécurisée) :
  * Un seul compte, stocké HORS du code dans data/auth.json : e-mail + empreinte
    du mot de passe hachée avec PBKDF2-HMAC-SHA256 (sel aléatoire, 260 000 tours).
    Le mot de passe n'est jamais écrit ni comparé en clair.
  * Sessions = cookies signés (HMAC-SHA256) avec une clé secrète aléatoire persistée
    dans data/.secret. Aucun état serveur : les sessions survivent à un redémarrage
    et ne peuvent pas être forgées sans la clé.
  * Comparaisons à temps constant (hmac.compare_digest) pour éviter les fuites de temps.

Tout repose sur la bibliothèque standard : aucune dépendance supplémentaire.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path

RACINE = Path(__file__).resolve().parent
DATA = RACINE / "data"
AUTH_FILE = DATA / "auth.json"
SECRET_FILE = DATA / ".secret"

COOKIE = "cr_session"
DUREE_SESSION = 7 * 24 * 3600          # 7 jours
ITERATIONS = 260_000

# Identifiants créés au tout premier lancement (modifiables ensuite dans auth.json).
_EMAIL_DEFAUT = "test@test.com"
_MDP_DEFAUT = "test"

_SECRET_CACHE: bytes | None = None


# --- Encodage base64 « url-safe » sans padding -----------------------------

def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).decode().rstrip("=")

def _de_b64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# --- Mot de passe (hachage PBKDF2) -----------------------------------------

def hacher_mdp(mdp: str, *, sel: bytes | None = None, iterations: int = ITERATIONS) -> str:
    sel = sel or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", mdp.encode("utf-8"), sel, iterations)
    return f"pbkdf2_sha256${iterations}${_b64(sel)}${_b64(dk)}"

def verifier_mdp(mdp: str, encode: str) -> bool:
    try:
        algo, iters, sel_b64, hash_b64 = encode.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", mdp.encode("utf-8"), _de_b64(sel_b64), int(iters))
        return hmac.compare_digest(dk, _de_b64(hash_b64))
    except Exception:
        return False


# --- Compte (fichier data/auth.json) ---------------------------------------

def _charger_compte() -> dict:
    if not AUTH_FILE.exists():
        DATA.mkdir(parents=True, exist_ok=True)
        compte = {"email": _EMAIL_DEFAUT, "hash": hacher_mdp(_MDP_DEFAUT)}
        AUTH_FILE.write_text(json.dumps(compte, ensure_ascii=False, indent=2), encoding="utf-8")
        try:
            os.chmod(AUTH_FILE, 0o600)
        except Exception:
            pass
        return compte
    return json.loads(AUTH_FILE.read_text(encoding="utf-8"))

def verifier_identifiants(email: str, mdp: str) -> bool:
    compte = _charger_compte()
    email_ok = hmac.compare_digest(
        (email or "").strip().lower(), str(compte.get("email", "")).strip().lower())
    mdp_ok = verifier_mdp(mdp or "", compte.get("hash", ""))
    # On évalue toujours les deux (pas de court-circuit) pour ne pas révéler
    # par le temps de réponse si c'est l'e-mail ou le mot de passe qui est faux.
    return email_ok and mdp_ok


# --- Clé secrète + jetons de session signés --------------------------------

def _secret() -> bytes:
    global _SECRET_CACHE
    if _SECRET_CACHE is not None:
        return _SECRET_CACHE
    if SECRET_FILE.exists():
        _SECRET_CACHE = _de_b64(SECRET_FILE.read_text(encoding="utf-8").strip())
    else:
        DATA.mkdir(parents=True, exist_ok=True)
        s = secrets.token_bytes(32)
        SECRET_FILE.write_text(_b64(s), encoding="utf-8")
        try:
            os.chmod(SECRET_FILE, 0o600)
        except Exception:
            pass
        _SECRET_CACHE = s
    return _SECRET_CACHE

def _signer(donnees: str) -> str:
    return _b64(hmac.new(_secret(), donnees.encode("utf-8"), hashlib.sha256).digest())

def creer_jeton() -> str:
    exp = str(int(time.time()) + DUREE_SESSION)
    return f"{exp}.{_signer(exp)}"

def jeton_valide(jeton: str | None) -> bool:
    if not jeton or "." not in jeton:
        return False
    exp, sig = jeton.rsplit(".", 1)
    if not hmac.compare_digest(sig, _signer(exp)):
        return False
    try:
        return int(exp) > int(time.time())
    except ValueError:
        return False


# --- Pose / retrait du cookie de session -----------------------------------

def poser_cookie(reponse, *, secure: bool) -> None:
    reponse.set_cookie(
        COOKIE, creer_jeton(),
        max_age=DUREE_SESSION, httponly=True, samesite="strict",
        secure=secure, path="/",
    )

def retirer_cookie(reponse) -> None:
    reponse.delete_cookie(COOKIE, path="/")
