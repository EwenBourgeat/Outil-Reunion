// chantiers.ts — Bibliothèque d'immeubles côté client (localStorage, sans BDD).
// Amorcée au premier usage depuis data/chantiers.default.json.
import seed from "@/data/chantiers.default.json";
import type { Chantier } from "./types";

const CLE = "cr_diag_chantiers";

export function lireChantiers(): Chantier[] {
  if (typeof window === "undefined") return [];
  const brut = localStorage.getItem(CLE);
  if (brut) {
    try {
      return JSON.parse(brut) as Chantier[];
    } catch {
      /* ignore */
    }
  }
  const init = (seed as { chantiers: Chantier[] }).chantiers ?? [];
  localStorage.setItem(CLE, JSON.stringify(init));
  return init;
}

export function ecrireChantiers(chantiers: Chantier[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(CLE, JSON.stringify(chantiers));
}
