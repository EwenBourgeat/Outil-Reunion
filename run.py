"""
run.py — Chaîne complète : note vocale -> compte rendu Word.

Usage courant (avec appel Claude) :
    set ANTHROPIC_API_KEY=sk-...
    python run.py --chantier exemples/chantier.json ^
                  --note exemples/note_vocale.txt ^
                  --photos photos ^
                  --sortie sortie

Mode démo / relecture (on repart d'un JSON déjà extrait, sans appeler l'API) :
    python run.py --chantier exemples/chantier.json ^
                  --json exemples/cr_extrait.json ^
                  --photos photos --sortie sortie
"""

import argparse
import json
import re
from datetime import datetime
from pathlib import Path

from cr_engine import EXT_PHOTOS, extraire, generer


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--chantier", required=True, help="fiche chantier JSON (export Monday)")
    ap.add_argument("--note", help="transcription de la note vocale (.txt)")
    ap.add_argument("--json", help="JSON déjà extrait (court-circuite l'appel à Claude)")
    ap.add_argument("--photos", default=None, help="dossier des photos de la visite")
    ap.add_argument("--template", default="template/DIAG_MODEL_SDC.docx")
    ap.add_argument("--sortie", default="sortie")
    args = ap.parse_args()

    chantier = json.loads(Path(args.chantier).read_text(encoding="utf-8"))

    photos = []
    if args.photos:
        photos = [f.name for f in sorted(Path(args.photos).iterdir())
                  if f.suffix.lower() in EXT_PHOTOS]

    if args.json:
        donnees = json.loads(Path(args.json).read_text(encoding="utf-8"))
    else:
        if not args.note:
            ap.error("--note ou --json est requis")
        transcription = Path(args.note).read_text(encoding="utf-8")
        donnees = extraire(transcription, chantier, photos)
        Path(args.sortie).mkdir(parents=True, exist_ok=True)
        (Path(args.sortie) / "cr_extrait.json").write_text(
            json.dumps(donnees, ensure_ascii=False, indent=2), encoding="utf-8")

    slug = re.sub(r"[^A-Za-z0-9]+", "_", chantier["sdc"]).strip("_").upper()
    date = datetime.fromisoformat(chantier["date_visite"]).strftime("%Y%m%d")
    nom = f"CR_DIAG_{slug}_{date}.docx"
    chemin = generer(donnees, chantier, args.template, str(Path(args.sortie) / nom), args.photos)

    print(f"OK -> {chemin}")
    for pt in donnees.get("points_a_completer", []):
        print(f"  [A COMPLETER] {pt}")


if __name__ == "__main__":
    main()
