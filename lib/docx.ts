/**
 * docx.ts — Génération du compte rendu Word en JavaScript pur.
 *
 * Port fidèle de cr_engine.generer() (python-docx) : le template de l'agence
 * (assets/DIAG_MODEL_SDC.docx) n'est JAMAIS reconstruit — il est ouvert, rempli,
 * enregistré. On manipule directement l'OOXML (word/document.xml + word/footer1.xml)
 * via pizzip + @xmldom/xmldom, en reproduisant les mêmes repères et le même style.
 */
import PizZip from "pizzip";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Chantier, DonneesCR, Observation } from "./types";

const EMU_PAR_CM = 360000;
const LARGEUR_PHOTO_CM = 8.3;
const PHOTOS_PAR_LIGNE = 2;

// Couleurs de priorité (identiques au moteur d'origine).
const COULEUR_PRIORITE: Record<string, string> = {
  URGENT: "C00000",
  "COURT TERME": "BF6200",
  "MOYEN TERME": "404040",
};

export interface PhotoDocx {
  data: Buffer;
  legende: string;
}

type El = any;

// ---------------------------------------------------------------------------
// Petits utilitaires DOM
// ---------------------------------------------------------------------------

function enfants(el: El, tag: string): El[] {
  const out: El[] = [];
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i] as unknown as El;
    if (n.nodeType === 1 && (n as El).tagName === tag) out.push(n);
  }
  return out;
}

function tous(doc: any, tag: string): El[] {
  const liste = (doc as Document).getElementsByTagName
    ? (doc as Document).getElementsByTagName(tag)
    : (doc as unknown as Element).getElementsByTagName(tag);
  const out: El[] = [];
  for (let i = 0; i < liste.length; i++) out.push(liste[i] as unknown as El);
  return out;
}

function texteDe(p: El): string {
  return tous(p, "w:t")
    .map((t) => t.textContent || "")
    .join("")
    .replace(/ /g, " ");
}

function creer(doc: any, tag: string, attrs?: Record<string, string>): El {
  const el = doc.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function runTexte(doc: any, texte: string): El {
  const t = creer(doc, "w:t", { "xml:space": "preserve" });
  t.appendChild(doc.createTextNode(texte));
  return t;
}

// Construit un <w:rPr> selon les options de formatage.
function faireRPr(
  doc: any,
  o: { gras?: boolean; italique?: boolean; taille?: number; couleur?: string | null; police?: string },
): El {
  const rpr = creer(doc, "w:rPr");
  rpr.appendChild(creer(doc, "w:rFonts", { "w:ascii": o.police || "Arial", "w:hAnsi": o.police || "Arial" }));
  if (o.gras) rpr.appendChild(creer(doc, "w:b"));
  if (o.italique) rpr.appendChild(creer(doc, "w:i"));
  if (o.taille) rpr.appendChild(creer(doc, "w:sz", { "w:val": String(o.taille * 2) }));
  if (o.couleur) rpr.appendChild(creer(doc, "w:color", { "w:val": o.couleur }));
  return rpr;
}

// ---------------------------------------------------------------------------
// Repères et insertions (miroir de _trouver / _completer / _inserer_apres)
// ---------------------------------------------------------------------------

function trouver(doc: any, debut: string): El {
  const cible = debut.trim().toLowerCase();
  for (const p of tous(doc, "w:p")) {
    if (texteDe(p).trim().toLowerCase().startsWith(cible)) return p;
  }
  throw new Error(`Repère introuvable dans le template : ${debut}`);
}

// Ajoute du texte à la fin d'un paragraphe en reprenant le format du dernier run.
function completer(doc: any, par: El, texte: string): void {
  const runs = enfants(par, "w:r");
  const run = creer(doc, "w:r");
  const src = runs[runs.length - 1];
  if (src) {
    const rpr = enfants(src, "w:rPr")[0];
    if (rpr) run.appendChild(rpr.cloneNode(true) as El);
  }
  run.appendChild(runTexte(doc, texte));
  par.appendChild(run);
}

interface OptInser {
  style?: string;
  gras?: boolean;
  italique?: boolean;
  taille?: number;
  couleur?: string | null;
  espaceAvant?: number;
}

// Insère un nouveau paragraphe juste après `par`, en clonant sa mise en forme.
function insererApres(doc: any, par: El, texte = "", opt: OptInser = {}): El {
  const np = par.cloneNode(true) as El;
  // Retirer runs / hyperliens / bookmarks du clone
  for (const enfant of Array.from(np.childNodes) as El[]) {
    if (enfant.nodeType === 1 && ["w:r", "w:hyperlink", "w:bookmarkStart", "w:bookmarkEnd"].includes(enfant.tagName)) {
      np.removeChild(enfant);
    }
  }
  // pPr : forcer le style + espacement
  let ppr = enfants(np, "w:pPr")[0];
  if (!ppr) {
    ppr = creer(doc, "w:pPr");
    np.insertBefore(ppr, np.firstChild);
  }
  for (const t of ["w:pStyle", "w:spacing"]) enfants(ppr, t).forEach((e) => ppr.removeChild(e));
  ppr.insertBefore(creer(doc, "w:pStyle", { "w:val": opt.style || "Normal" }), ppr.firstChild);
  ppr.appendChild(
    creer(doc, "w:spacing", { "w:before": String((opt.espaceAvant || 0) * 20), "w:after": "40" }),
  );

  if (texte) {
    const run = creer(doc, "w:r");
    run.appendChild(faireRPr(doc, opt));
    run.appendChild(runTexte(doc, texte));
    np.appendChild(run);
  }
  par.parentNode!.insertBefore(np, par.nextSibling);
  return np;
}

// Écrit dans une cellule de tableau (multi-lignes), police Arial.
function ecrireCellule(
  doc: any,
  cell: El,
  texte: string,
  o: { gras?: boolean; taille?: number; centre?: boolean } = {},
): void {
  const taille = o.taille ?? 9;
  const paras = enfants(cell, "w:p");
  // Garder le premier paragraphe (pour son pPr), vider ses runs ; retirer les autres.
  const gabarit = paras[0] || creer(doc, "w:p");
  if (!paras[0]) cell.appendChild(gabarit);
  for (let i = 1; i < paras.length; i++) cell.removeChild(paras[i]);
  // Vider le paragraphe de TOUT sauf son <w:pPr> (runs, hyperliens, bookmarks…),
  // sinon un e-mail présent en lien hypertexte dans le template resterait.
  for (const enfant of Array.from(gabarit.childNodes) as El[]) {
    if (enfant.nodeType === 1 && enfant.tagName !== "w:pPr") gabarit.removeChild(enfant);
  }

  const lignes = String(texte).split("\n");
  lignes.forEach((ligne, i) => {
    const p = i === 0 ? gabarit : (gabarit.cloneNode(false) as El);
    if (o.centre) {
      let ppr = enfants(p, "w:pPr")[0];
      if (!ppr) {
        ppr = creer(doc, "w:pPr");
        p.insertBefore(ppr, p.firstChild);
      }
      enfants(ppr, "w:jc").forEach((e) => ppr.removeChild(e));
      ppr.appendChild(creer(doc, "w:jc", { "w:val": "center" }));
    }
    const run = creer(doc, "w:r");
    run.appendChild(faireRPr(doc, { gras: o.gras, taille }));
    run.appendChild(runTexte(doc, ligne));
    p.appendChild(run);
    if (i > 0) cell.appendChild(p);
  });
}

// ---------------------------------------------------------------------------
// Contacts (miroir de _remplir_contacts)
// ---------------------------------------------------------------------------

function remplirContacts(doc: any, contacts: Chantier["contacts"]): void {
  const tbl = tous(doc, "w:tbl")[0];
  if (!tbl) return;
  const rows = enfants(tbl, "w:tr");

  const remplir = (row: El, c: Chantier["contacts"][number]) => {
    const cells = enfants(row, "w:tc");
    ecrireCellule(doc, cells[0], c.organisme || c.role || "", { gras: true });
    ecrireCellule(doc, cells[1], c.nom || "");
    ecrireCellule(doc, cells[2], c.telephone || "");
    ecrireCellule(doc, cells[3], c.email || "");
    ecrireCellule(doc, cells[4], c.present ? "X" : "", { centre: true });
    ecrireCellule(doc, cells[5], c.present ? "" : "X", { centre: true });
  };

  const moa = contacts.filter((c) => (c.groupe || "MOA").toUpperCase() === "MOA");
  const moe = contacts.filter((c) => (c.groupe || "").toUpperCase() === "MOE");

  const lignesMoa = [rows[2], rows[3]];
  moa.slice(0, 2).forEach((c, i) => remplir(lignesMoa[i], c));

  // Contacts MOA supplémentaires : cloner la dernière ligne MOA (row 3).
  let ancre = rows[3];
  for (const c of moa.slice(2)) {
    const tr = rows[3].cloneNode(true) as El;
    ancre.parentNode!.insertBefore(tr, ancre.nextSibling);
    ancre = tr;
    remplir(tr, c);
  }

  const dernier = enfants(tbl, "w:tr");
  for (const c of moe) remplir(dernier[dernier.length - 1], c);
}

// ---------------------------------------------------------------------------
// Photos (miroir de _inserer_photos) — embarquement d'images en OOXML
// ---------------------------------------------------------------------------

// Dimensions d'un JPEG (lecture des marqueurs SOF).
function tailleJpeg(buf: Buffer): { w: number; h: number } {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marqueur = buf[i + 1];
    if (marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc) {
      const h = buf.readUInt16BE(i + 5);
      const w = buf.readUInt16BE(i + 7);
      return { w, h };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return { w: 1600, h: 1200 };
}

function drawingXml(rId: string, id: number, cx: number, cy: number): string {
  return (
    `<w:r xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"` +
    ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
    ` xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"` +
    ` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
    ` xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` +
    `<wp:docPr id="${id}" name="Photo ${id}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">` +
    `<pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="Photo ${id}"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>` +
    `</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`
  );
}

function insererPhotos(
  doc: any,
  zip: any,
  photos: PhotoDocx[],
  ajouterMedia: (data: Buffer) => string,
): void {
  if (!photos.length) return;
  const ancre = trouver(doc, "photos");
  const nbLignes = Math.ceil(photos.length / PHOTOS_PAR_LIGNE);

  const tbl = creer(doc, "w:tbl");
  const tblPr = creer(doc, "w:tblPr");
  tblPr.appendChild(creer(doc, "w:tblW", { "w:w": "0", "w:type": "auto" }));
  tblPr.appendChild(creer(doc, "w:jc", { "w:val": "center" }));
  tbl.appendChild(tblPr);
  const grid = creer(doc, "w:tblGrid");
  for (let c = 0; c < PHOTOS_PAR_LIGNE; c++) grid.appendChild(creer(doc, "w:gridCol", { "w:w": "4680" }));
  tbl.appendChild(grid);

  let idImg = 1000;
  for (let ligne = 0; ligne < nbLignes; ligne++) {
    const tr = creer(doc, "w:tr");
    for (let col = 0; col < PHOTOS_PAR_LIGNE; col++) {
      const tc = creer(doc, "w:tc");
      const tcPr = creer(doc, "w:tcPr");
      tcPr.appendChild(creer(doc, "w:tcW", { "w:w": "4680", "w:type": "dxa" }));
      tc.appendChild(tcPr);

      const idx = ligne * PHOTOS_PAR_LIGNE + col;
      const ph = photos[idx];
      if (ph) {
        const { w, h } = tailleJpeg(ph.data);
        let cx: number, cy: number;
        if (h > w) {
          cy = Math.round(LARGEUR_PHOTO_CM * 1.33 * EMU_PAR_CM);
          cx = Math.round(cy * (w / h));
        } else {
          cx = Math.round(LARGEUR_PHOTO_CM * EMU_PAR_CM);
          cy = Math.round(cx * (h / w));
        }
        const rId = ajouterMedia(ph.data);

        const pImg = creer(doc, "w:p");
        const pprImg = creer(doc, "w:pPr");
        pprImg.appendChild(creer(doc, "w:jc", { "w:val": "center" }));
        pImg.appendChild(pprImg);
        const frag = new DOMParser().parseFromString(drawingXml(rId, idImg++, cx, cy), "text/xml");
        pImg.appendChild(doc.importNode(frag.documentElement as unknown as El, true));
        tc.appendChild(pImg);

        const pCap = creer(doc, "w:p");
        const pprCap = creer(doc, "w:pPr");
        pprCap.appendChild(creer(doc, "w:jc", { "w:val": "center" }));
        pCap.appendChild(pprCap);
        const runCap = creer(doc, "w:r");
        runCap.appendChild(faireRPr(doc, { taille: 8, italique: true }));
        runCap.appendChild(runTexte(doc, `Photo n° ${idx + 1}` + (ph.legende ? ` — ${ph.legende}` : "")));
        pCap.appendChild(runCap);
        tc.appendChild(pCap);
      } else {
        tc.appendChild(creer(doc, "w:p"));
      }
      tr.appendChild(tc);
    }
    tbl.appendChild(tr);
  }
  // Déplacer le tableau juste après le titre « photos ».
  ancre.parentNode!.insertBefore(tbl, ancre.nextSibling);
}

// ---------------------------------------------------------------------------
// Pied de page / cartouche (miroir de _remplir_cartouche)
// ---------------------------------------------------------------------------

function remplirCartouche(zip: any, chantier: Chantier): void {
  const chemin = "word/footer1.xml";
  const f = zip.file(chemin);
  if (!f) return;
  const doc = new DOMParser().parseFromString(f.asText(), "text/xml");
  const tbl = tous(doc, "w:tbl")[0];
  if (!tbl) return;
  const rows = enfants(tbl, "w:tr");
  const cell = (r: number, c: number) => enfants(rows[r], "w:tc")[c];
  ecrireCellule(doc, cell(0, 5), frDate(chantier.date_visite), { taille: 8, centre: true });
  ecrireCellule(doc, cell(1, 0), chantier.moa || "", { taille: 8, centre: true });
  ecrireCellule(doc, cell(1, 1), chantier.adresse || "", { taille: 8, centre: true });
  zip.file(chemin, new XMLSerializer().serializeToString(doc));
}

function frDate(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export function genererDocx(
  template: Buffer,
  donnees: DonneesCR,
  chantier: Chantier,
  photos: PhotoDocx[],
): Buffer {
  const zip = new PizZip(template);
  const docXml = zip.file("word/document.xml")!.asText();
  const doc = new DOMParser().parseFromString(docXml, "text/xml");

  // Ajout d'images : media + relations dans document.xml.rels.
  const relsChemin = "word/_rels/document.xml.rels";
  const relsDoc = new DOMParser().parseFromString(zip.file(relsChemin)!.asText(), "text/xml");
  const relsRoot = tous(relsDoc, "Relationships")[0];
  let maxRid = 0;
  for (const rel of tous(relsDoc, "Relationship")) {
    const m = /^rId(\d+)$/.exec(rel.getAttribute("Id") || "");
    if (m) maxRid = Math.max(maxRid, Number(m[1]));
  }
  let compteurMedia = 0;
  const ajouterMedia = (data: Buffer): string => {
    compteurMedia += 1;
    maxRid += 1;
    const rId = `rId${maxRid}`;
    const nom = `image_cr_${compteurMedia}.jpeg`;
    zip.file(`word/media/${nom}`, data);
    const rel = creer(relsDoc, "Relationship", {
      Id: rId,
      Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
      Target: `media/${nom}`,
    });
    relsRoot.appendChild(rel);
    return rId;
  };

  // --- Page de garde ---
  completer(doc, trouver(doc, "SDC"), chantier.sdc);
  completer(doc, trouver(doc, "VISITE du"), frDate(chantier.date_visite));
  completer(doc, trouver(doc, "Code immeuble"), String(chantier.code_immeuble || ""));

  // --- Contacts ---
  remplirContacts(doc, chantier.contacts);

  // --- Généralités ---
  {
    const ancre = trouver(doc, "generalites");
    for (const para of [...(donnees.generalites || [])].reverse()) {
      insererApres(doc, ancre, para, { espaceAvant: 4, taille: 10 });
    }
  }

  // --- Observations ---
  {
    const ancre = trouver(doc, "OBSERVATIONS");
    const observations = donnees.observations || [];
    // Insertion en ordre inverse (chaque bloc s'insère après l'ancre). La numérotation
    // est imposée par l'outil à partir de l'ordre réel : 1., 2., 3.… sans trou ni doublon,
    // quel que soit ce que le modèle a mis (on retire un éventuel numéro en tête de titre).
    for (let i = observations.length - 1; i >= 0; i--) {
      const obs = observations[i];
      const titreSansNumero = String(obs.titre || "").replace(/^\s*\d+\s*[.)\-–]\s*/, "").trim();
      const titre = `${i + 1}. ${titreSansNumero}`;
      const blocs: { texte: string; opt: OptInser }[] = [];
      blocs.push({ texte: titre, opt: { gras: true, taille: 11, espaceAvant: 10 } });
      const prio = (obs.priorite || "").toUpperCase();
      if (prio)
        blocs.push({ texte: `Priorité : ${prio}`, opt: { gras: true, taille: 9, couleur: COULEUR_PRIORITE[prio] || null } });
      if (obs.constat) blocs.push({ texte: `Constat — ${obs.constat}`, opt: { taille: 10 } });
      if (obs.analyse) blocs.push({ texte: `Analyse — ${obs.analyse}`, opt: { taille: 10 } });
      if (obs.preconisation) blocs.push({ texte: `Préconisation — ${obs.preconisation}`, opt: { taille: 10 } });
      if (obs.photos_liees?.length) {
        const nums = obs.photos_liees.map((n) => `n° ${n}`).join(", ");
        blocs.push({ texte: `(cf. photos ${nums})`, opt: { taille: 9, italique: true } });
      }
      for (const b of blocs.reverse()) insererApres(doc, ancre, b.texte, b.opt);
    }
  }

  // --- Conclusion ---
  {
    const ancre = trouver(doc, "Conclusion et recommandations");
    const concl = donnees.conclusion || {};
    const blocs: { texte: string; opt: OptInser }[] = [];
    for (const para of concl.synthese || []) blocs.push({ texte: para, opt: { taille: 10, espaceAvant: 4 } });
    if (concl.energetique?.length) {
      blocs.push({ texte: "Volet énergétique", opt: { gras: true, taille: 10, espaceAvant: 8 } });
      for (const para of concl.energetique) blocs.push({ texte: para, opt: { taille: 10 } });
    }
    for (const b of blocs.reverse()) insererApres(doc, ancre, b.texte, b.opt);
  }

  // --- Photos ---
  insererPhotos(doc, zip, photos, ajouterMedia);

  // --- Écriture ---
  zip.file(relsChemin, new XMLSerializer().serializeToString(relsDoc));
  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  remplirCartouche(zip, chantier);

  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" });
}
