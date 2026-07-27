// monday.ts — Connexion au board monday.com « Projets Immobiliers ».
// Interroge l'API GraphQL de monday et convertit chaque élément (immeuble)
// en Chantier utilisable par l'outil de comptes rendus.
import type { Chantier, Contact } from "./types";

const API = "https://api.monday.com/v2";

// Colonnes de l'immeuble (surchargeables par variables d'environnement).
// Valeurs par défaut = board « Projets Immobiliers - Test ».
const COL_ADRESSE = process.env.MONDAY_COL_ADRESSE ?? "text_mm5mffps";
const COL_PERSONNES = process.env.MONDAY_COL_PERSONNES ?? "text_mm5mjtb9";
const COL_TELS = process.env.MONDAY_COL_TELS ?? "text_mm5m9af5"; // « Téléphones » (alignés par /)
const COL_EMAILS = process.env.MONDAY_COL_EMAILS ?? "text_mm5mvz1n"; // « Emails » (alignés par /)

// Colonnes des sous-éléments (une personne par sous-élément).
const SUB_ROLE = process.env.MONDAY_SUB_ROLE ?? "text_mm5mj7c8";
const SUB_TEL = process.env.MONDAY_SUB_TEL ?? "phone_mm5m8hs4";
const SUB_EMAIL = process.env.MONDAY_SUB_EMAIL ?? "email_mm5mw3dw";
const SUB_PRESENT = process.env.MONDAY_SUB_PRESENT ?? "boolean_mm5m79t";

/**
 * Convertit « M. Éric Lemarchand (syndic), Mme Claire Dubosc (gestionnaire) »
 * en liste de contacts. Le libellé entre parenthèses devient le rôle/organisme
 * (affiché en gras), le reste devient le nom.
 */
export function parsePersonnes(raw?: string | null): Contact[] {
  if (!raw) return [];
  return raw
    .split(/[,;\n](?![^(]*\))/) // séparateurs hors parenthèses
    .map((s) => s.trim())
    .filter(Boolean)
    .map((part) => {
      const m = part.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      if (m) {
        const role = m[2].trim();
        return { nom: m[1].trim(), organisme: role, role, present: true };
      }
      return { nom: part, present: true } as Contact;
    });
}

// Maître d'œuvre : l'agence elle-même, présente sur chaque réunion.
// Coordonnées lues depuis l'environnement (MOE_*) pour ne figer aucune donnée de
// contact dans le code (dépôt public). À défaut, seul le nom de l'agence apparaît.
const CONTACT_MOE: Contact = {
  groupe: "MOE",
  organisme: process.env.MOE_ORGANISME ?? "GO ARCHITECTURE",
  nom: process.env.MOE_NOM ?? "",
  telephone: process.env.MOE_TEL ?? "",
  email: process.env.MOE_EMAIL ?? "",
  present: true,
};

interface MondayColVal {
  id: string;
  text: string | null;
}
interface MondaySubitem {
  id: string;
  name: string;
  column_values: MondayColVal[];
}
interface MondayItem {
  id: string;
  name: string;
  column_values: MondayColVal[];
  subitems?: MondaySubitem[] | null;
}

/** Découpe une liste alignée « a / b / c » en tableau nettoyé. */
function splitSlash(raw: string): string[] {
  return raw.split("/").map((s) => s.trim());
}

/** Contacts issus des sous-éléments (source structurée, une personne par ligne). */
function contactsDepuisSubitems(subs: MondaySubitem[]): Contact[] {
  return subs.map((s): Contact => {
    const col = (id: string) => s.column_values.find((c) => c.id === id)?.text ?? "";
    const role = col(SUB_ROLE);
    const presentTxt = col(SUB_PRESENT).toLowerCase();
    return {
      nom: s.name,
      organisme: role || undefined,
      role: role || undefined,
      telephone: col(SUB_TEL) || undefined,
      email: col(SUB_EMAIL) || undefined,
      // Case « Présent » de monday cochée = "v". Vide/absente = présent par défaut.
      present: presentTxt === "" ? true : presentTxt === "v",
    };
  });
}

/** Contacts issus des colonnes texte alignées (repli si pas de sous-éléments). */
function contactsDepuisColonnes(personnes: string, tels: string, emails: string): Contact[] {
  const base = parsePersonnes(personnes);
  const lTels = splitSlash(tels);
  const lEmails = splitSlash(emails);
  return base.map((c, i) => ({
    ...c,
    telephone: lTels[i] || undefined,
    email: lEmails[i] || undefined,
  }));
}

/** Récupère tous les immeubles du board monday et les mappe en Chantier[]. */
export async function fetchImmeublesMonday(): Promise<Chantier[]> {
  const token = process.env.MONDAY_API_KEY;
  const boardId = process.env.MONDAY_BOARD_ID;
  if (!token) throw new Error("MONDAY_API_KEY manquante dans l'environnement.");
  if (!boardId) throw new Error("MONDAY_BOARD_ID manquant dans l'environnement.");

  const query = `query ($board: [ID!]) {
    boards(ids: $board) {
      items_page(limit: 100) {
        items {
          id name
          column_values { id text }
          subitems { id name column_values { id text } }
        }
      }
    }
  }`;

  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token,
      "API-Version": "2024-10",
    },
    body: JSON.stringify({ query, variables: { board: [boardId] } }),
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`monday.com a répondu ${res.status} (${res.statusText}).`);
  }
  const json = (await res.json()) as {
    data?: { boards?: { items_page?: { items?: MondayItem[] } }[] };
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    throw new Error(`Erreur monday : ${json.errors.map((e) => e.message).join(" ; ")}`);
  }

  const items = json.data?.boards?.[0]?.items_page?.items ?? [];
  return items.map((it): Chantier => {
    const col = (id: string) => it.column_values.find((c) => c.id === id)?.text ?? "";
    const subs = it.subitems ?? [];
    // Sous-éléments prioritaires (structurés) ; sinon colonnes texte alignées.
    const personnes =
      subs.length > 0
        ? contactsDepuisSubitems(subs)
        : contactsDepuisColonnes(col(COL_PERSONNES), col(COL_TELS), col(COL_EMAILS));
    return {
      sdc: it.name,
      adresse: col(COL_ADRESSE),
      code_immeuble: it.id, // référence de l'élément monday
      contacts: [...personnes, { ...CONTACT_MOE }],
    };
  });
}
