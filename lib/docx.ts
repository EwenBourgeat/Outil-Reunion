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

export interface PhotoDocx {
  data: Uint8Array;
  legende: string;
}

// Champs propres au compte rendu de chantier (bloc titre), saisis dans l'app.
export interface MetaChantier {
  numeroReunion?: string;
  objet?: string;
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

// Supprime les tirets longs (cadratin — / demi-cadratin –), qui font « généré par IA ».
// Filet de sécurité garanti : quoi que renvoie Gemini, aucun cadratin n'atteint le document.
// (Les traits d'union ordinaires « - », ex. codes immeuble EXE-00-000, sont préservés.)
function nettoyerTexte(texte: string): string {
  return String(texte)
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/\s*,\s*,\s*/g, ", ")
    .replace(/[ \t]{2,}/g, " ");
}

function runTexte(doc: any, texte: string): El {
  const t = creer(doc, "w:t", { "xml:space": "preserve" });
  t.appendChild(doc.createTextNode(nettoyerTexte(texte)));
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

// Dimensions d'un JPEG (lecture des marqueurs SOF) — compatible navigateur.
function tailleJpeg(buf: Uint8Array): { w: number; h: number } {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) {
      i++;
      continue;
    }
    const marqueur = buf[i + 1];
    if (marqueur >= 0xc0 && marqueur <= 0xcf && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc) {
      const h = dv.getUint16(i + 5);
      const w = dv.getUint16(i + 7);
      return { w, h };
    }
    i += 2 + dv.getUint16(i + 2);
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

// Force un saut de page AVANT le paragraphe `p` (bannière « PHOTOS ») : la section
// photos démarre toujours en haut d'une page, jamais séparée de sa bannière (fini la
// bannière orpheline en bas d'une page et les photos rejetées sur la suivante).
function forcerSautDePageAvant(doc: any, p: El): void {
  let ppr = enfants(p, "w:pPr")[0];
  if (!ppr) {
    ppr = creer(doc, "w:pPr");
    p.insertBefore(ppr, p.firstChild);
  }
  if (enfants(ppr, "w:pageBreakBefore").length) return;
  // Ordre imposé par le schéma CT_PPr : pageBreakBefore vient juste après
  // pStyle / keepNext / keepLines, avant tout le reste.
  const avant = ["w:pStyle", "w:keepNext", "w:keepLines"];
  let ref: El | null = null;
  for (let i = 0; i < ppr.childNodes.length; i++) {
    const n = ppr.childNodes[i] as El;
    if (n.nodeType === 1 && !avant.includes(n.tagName)) {
      ref = n;
      break;
    }
  }
  const pb = creer(doc, "w:pageBreakBefore");
  if (ref) ppr.insertBefore(pb, ref);
  else ppr.appendChild(pb);
}

function insererPhotos(
  doc: any,
  zip: any,
  photos: PhotoDocx[],
  ajouterMedia: (data: Uint8Array) => string,
): void {
  if (!photos.length) return;
  const ancre = trouver(doc, "photos");
  // Éviter la bannière « PHOTOS » orpheline en bas de page : la section photos
  // démarre en haut d'une nouvelle page (bannière + photos toujours ensemble).
  forcerSautDePageAvant(doc, ancre);
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
        runCap.appendChild(runTexte(doc, `Photo n° ${idx + 1}` + (ph.legende ? ` : ${ph.legende}` : "")));
        pCap.appendChild(runCap);
        tc.appendChild(pCap);
      } else {
        tc.appendChild(creer(doc, "w:p"));
      }
      tr.appendChild(tc);
    }
    tbl.appendChild(tr);
  }
  // Aérer : petit espace entre la bannière « PHOTOS » et la première rangée de photos
  // (sinon les images sont collées au titre). Paragraphe fin, gardé avec la suite.
  const espaceur = creer(doc, "w:p");
  const espPpr = creer(doc, "w:pPr");
  espPpr.appendChild(creer(doc, "w:keepNext"));
  espPpr.appendChild(creer(doc, "w:spacing", { "w:before": "0", "w:after": "120", "w:line": "120", "w:lineRule": "exact" }));
  espaceur.appendChild(espPpr);

  // Bannière + espaceur + tableau, insérés dans l'ordre juste après l'ancre.
  ancre.parentNode!.insertBefore(espaceur, ancre.nextSibling);
  ancre.parentNode!.insertBefore(tbl, espaceur.nextSibling);
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
  forcerBorduresCellules(doc, tbl);
  majusculerCartouche(doc, tbl);
  zip.file(chemin, new XMLSerializer().serializeToString(doc));
}

// Cartouche tout en capitales dans TOUS les lecteurs.
// Le gabarit affiche ses libellés en majuscules via l'attribut de style <w:caps/> (petites
// capitales). Certains lecteurs ignorent <w:caps/> et affichent alors le texte brut, en casse
// d'origine (« Objet et lieu de l'opération » au lieu de « OBJET ET LIEU DE L'OPÉRATION »).
// On grave donc la majuscule dans le texte lui-même : le rendu ne dépend plus d'aucune option
// de mise en forme. Le cartouche est intégralement conçu en capitales, l'opération est donc sûre.
function majusculerCartouche(doc: any, tbl: El): void {
  for (const t of tous(tbl, "w:t")) {
    const texte = t.textContent || "";
    const maj = texte.toUpperCase();
    if (maj === texte) continue;
    while (t.firstChild) t.removeChild(t.firstChild);
    t.appendChild(doc.createTextNode(maj));
    // Conserver les espaces significatifs (ex. « n° CROAIF » précédé d'une espace).
    if (/^\s|\s$/.test(maj) && t.getAttribute("xml:space") !== "preserve") {
      t.setAttribute("xml:space", "preserve");
    }
  }
}

// Grille du cartouche fiable dans TOUS les lecteurs.
// Certains moteurs de rendu (Aperçu / Coup d'œil / Pages sur macOS, quelques export PDF)
// ignorent les bordures posées au niveau du tableau (<w:tblBorders>) et n'affichent QUE
// celles définies cellule par cellule (<w:tcBorders>). Sans elles, le pied de page apparaît
// « sans grille », en vrac. On repose donc des bordures explicites sur chaque cellule.
function forcerBorduresCellules(doc: any, tbl: El): void {
  // Ordre imposé par le schéma CT_TcPr : <w:tcBorders> doit précéder ces éléments.
  const apres = ["w:shd", "w:noWrap", "w:tcMar", "w:textDirection", "w:tcFitText", "w:vAlign", "w:hideMark"];
  for (const tc of tous(tbl, "w:tc")) {
    let tcPr = enfants(tc, "w:tcPr")[0];
    if (!tcPr) {
      tcPr = creer(doc, "w:tcPr");
      tc.insertBefore(tcPr, tc.firstChild);
    }
    enfants(tcPr, "w:tcBorders").forEach((e) => tcPr.removeChild(e));
    const bordures = creer(doc, "w:tcBorders");
    for (const cote of ["w:top", "w:left", "w:bottom", "w:right"]) {
      bordures.appendChild(creer(doc, cote, { "w:val": "single", "w:sz": "8", "w:space": "0", "w:color": "auto" }));
    }
    let ref: El | null = null;
    for (let i = 0; i < tcPr.childNodes.length; i++) {
      const n = tcPr.childNodes[i] as El;
      if (n.nodeType === 1 && apres.includes(n.tagName)) {
        ref = n;
        break;
      }
    }
    if (ref) tcPr.insertBefore(bordures, ref);
    else tcPr.appendChild(bordures);
  }
}

function frDate(iso?: string): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// ---------------------------------------------------------------------------
// Éléments partagés entre les deux documents (visite + chantier)
// ---------------------------------------------------------------------------

// Prépare l'ajout d'images : renvoie une fonction pour embarquer un média (et sa relation)
// et une fonction pour réécrire le fichier de relations dans le zip.
function preparerMedia(zip: any): { ajouterMedia: (d: Uint8Array) => string; ecrireRels: () => void } {
  const relsChemin = "word/_rels/document.xml.rels";
  const relsDoc = new DOMParser().parseFromString(zip.file(relsChemin)!.asText(), "text/xml");
  const relsRoot = tous(relsDoc, "Relationships")[0];
  let maxRid = 0;
  for (const rel of tous(relsDoc, "Relationship")) {
    const m = /^rId(\d+)$/.exec(rel.getAttribute("Id") || "");
    if (m) maxRid = Math.max(maxRid, Number(m[1]));
  }
  let compteurMedia = 0;
  const ajouterMedia = (data: Uint8Array): string => {
    compteurMedia += 1;
    maxRid += 1;
    const rId = `rId${maxRid}`;
    const nom = `image_cr_${compteurMedia}.jpeg`;
    zip.file(`word/media/${nom}`, data);
    relsRoot.appendChild(
      creer(relsDoc, "Relationship", {
        Id: rId,
        Type: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image",
        Target: `media/${nom}`,
      }),
    );
    return rId;
  };
  const ecrireRels = () => zip.file(relsChemin, new XMLSerializer().serializeToString(relsDoc));
  return { ajouterMedia, ecrireRels };
}

// Insère les paragraphes de « généralités » après l'ancre correspondante.
function insererGeneralites(doc: any, ancre: El, generalites: string[]): void {
  for (const para of [...generalites].reverse()) {
    insererApres(doc, ancre, para, { espaceAvant: 4, taille: 10 });
  }
}

// Insère les observations (Constat / Analyse / Préconisation) après l'ancre. La numérotation
// séquentielle (1., 2., 3.…) est imposée par l'outil, quel que soit l'ordre renvoyé par le modèle.
function insererObservations(doc: any, ancre: El, observations: Observation[]): void {
  for (let i = observations.length - 1; i >= 0; i--) {
    const obs = observations[i];
    const titreSansNumero = String(obs.titre || "").replace(/^\s*\d+\s*[.)\-–]\s*/, "").trim();
    const titre = `${i + 1}. ${titreSansNumero}`;
    const blocs: { texte: string; opt: OptInser }[] = [];
    blocs.push({ texte: titre, opt: { gras: true, taille: 11, espaceAvant: 10 } });
    if (obs.constat) blocs.push({ texte: `Constat : ${obs.constat}`, opt: { taille: 10 } });
    if (obs.analyse) blocs.push({ texte: `Analyse : ${obs.analyse}`, opt: { taille: 10 } });
    if (obs.preconisation) blocs.push({ texte: `Préconisation : ${obs.preconisation}`, opt: { taille: 10 } });
    if (obs.photos_liees?.length) {
      const nums = obs.photos_liees.map((n) => `n° ${n}`).join(", ");
      blocs.push({ texte: `(cf. photos ${nums})`, opt: { taille: 9, italique: true } });
    }
    for (const b of blocs.reverse()) insererApres(doc, ancre, b.texte, b.opt);
  }
}

// Prochain frère qui est un paragraphe <w:p> (en sautant les autres nœuds).
function paragrapheSuivant(p: El): El | null {
  let n = p.nextSibling as El | null;
  while (n) {
    if (n.nodeType === 1 && (n as El).tagName === "w:p") return n as El;
    n = n.nextSibling as El | null;
  }
  return null;
}

// Remplace TOUT le texte d'un paragraphe par `texte`, en conservant la mise en forme du
// premier run (police, taille, casse…). Sert à remplir le bloc titre du CR de chantier,
// dont les valeurs (adresse, objet…) sont des exemples à écraser, non des libellés.
function definirTexteParagraphe(doc: any, p: El, texte: string): void {
  const runs = enfants(p, "w:r");
  const premier = runs[0];
  if (!premier) {
    const r = creer(doc, "w:r");
    r.appendChild(runTexte(doc, texte));
    p.appendChild(r);
    return;
  }
  for (let i = runs.length - 1; i >= 1; i--) p.removeChild(runs[i]);
  for (const enfant of Array.from(premier.childNodes) as El[]) {
    if (enfant.nodeType === 1 && enfant.tagName === "w:t") premier.removeChild(enfant);
  }
  premier.appendChild(runTexte(doc, texte));
}

// ---------------------------------------------------------------------------
// Contacts du CR de chantier (tableau MOA / MOE / ENTREPRISES)
// ---------------------------------------------------------------------------

// Le tableau contacts du modèle chantier a des lignes d'en-tête de groupe intercalées.
// Lignes de données : SYNDIC (r2) et CONSEIL SYNDICAL (r3) pour la MOA, GO ARCHITECTURE (r5)
// pour la MOE, ETS (r7) pour les entreprises. On remplit la MOA depuis la fiche (nom + présence,
// clonage si besoin) ; pour la MOE on ne touche qu'à la présence (le bloc agence reste intact).
function remplirContactsChantier(doc: any, contacts: Chantier["contacts"]): void {
  const tbl = tous(doc, "w:tbl")[0];
  if (!tbl) return;
  const rows = enfants(tbl, "w:tr");
  if (rows.length < 6) return;

  const remplirLigne = (
    row: El,
    ct: Chantier["contacts"][number],
    opts: { presenceSeule?: boolean } = {},
  ) => {
    const cells = enfants(row, "w:tc");
    if (cells.length < 6) return;
    if (!opts.presenceSeule) {
      if (ct.organisme) ecrireCellule(doc, cells[0], ct.organisme, { gras: true, taille: 8 });
      if (ct.nom) ecrireCellule(doc, cells[1], ct.nom, { taille: 8 });
      if (ct.telephone) ecrireCellule(doc, cells[2], ct.telephone, { taille: 8 });
      if (ct.email) ecrireCellule(doc, cells[3], ct.email, { taille: 8 });
    }
    ecrireCellule(doc, cells[4], ct.present ? "X" : "", { taille: 8, centre: true });
    ecrireCellule(doc, cells[5], ct.present ? "" : "X", { taille: 8, centre: true });
  };

  const moa = contacts.filter((c) => (c.groupe || "MOA").toUpperCase() === "MOA");
  const moe = contacts.filter((c) => (c.groupe || "").toUpperCase() === "MOE");

  const lignesMoa = [rows[2], rows[3]].filter(Boolean) as El[];
  let ancre = rows[3];
  moa.forEach((c, i) => {
    if (i < lignesMoa.length) {
      remplirLigne(lignesMoa[i], c);
    } else {
      const tr = rows[3].cloneNode(true) as El;
      ancre.parentNode!.insertBefore(tr, ancre.nextSibling);
      ancre = tr;
      remplirLigne(tr, c);
    }
  });

  // MOE : le bloc GO Architecture est déjà dans le modèle ; on ne met à jour que la présence.
  if (moe.length && rows[5]) remplirLigne(rows[5], moe[0], { presenceSeule: true });
}

// ---------------------------------------------------------------------------
// Signature de l'agence — repositionnée en bas de la dernière page.
// Le modèle place le paraphe (image + lignes signataire) AVANT l'ancre « photos ».
// À la génération, les photos s'insèrent après l'ancre : la signature se retrouve
// alors au-dessus des photos. On la déplace donc SOUS les photos, tout en la gardant
// dans le corps (donc au-dessus du pied de page, sans chevauchement).
// ---------------------------------------------------------------------------

function paragrapheVide(p: El): boolean {
  return texteDe(p).trim() === "" && tous(p, "w:drawing").length === 0;
}

function estTexteSignature(p: El): boolean {
  return /vallée|compagnie des architectes|architecte dplg/i.test(texteDe(p));
}

// Paragraphe aligné (left/center/right) avec espace optionnel au-dessus.
// Ordre CT_PPr respecté : <w:spacing> précède <w:jc>.
function pAligne(doc: any, jc: string, espaceAvant = 0): El {
  const p = creer(doc, "w:p");
  const ppr = creer(doc, "w:pPr");
  if (espaceAvant) {
    ppr.appendChild(creer(doc, "w:spacing", { "w:before": String(espaceAvant * 20), "w:after": "0" }));
  }
  ppr.appendChild(creer(doc, "w:jc", { "w:val": jc }));
  p.appendChild(ppr);
  return p;
}

function runFormate(
  doc: any,
  texte: string,
  o: { gras?: boolean; italique?: boolean; taille?: number },
): El {
  const r = creer(doc, "w:r");
  r.appendChild(faireRPr(doc, o));
  r.appendChild(runTexte(doc, texte));
  return r;
}

function deplacerSignatureEnBas(doc: any): void {
  const ancre = trouver(doc, "photos");
  const body = ancre.parentNode as El;
  const paras = enfants(body, "w:p");
  const idxAncre = paras.indexOf(ancre);
  if (idxAncre < 0) return;

  // Paragraphe image de la signature = paragraphe avec <w:drawing> le plus proche
  // AVANT l'ancre (le logo d'en-tête est bien plus haut, il n'est pas retenu).
  let idxImg = -1;
  for (let i = idxAncre - 1; i >= 0; i--) {
    if (tous(paras[i], "w:drawing").length) {
      idxImg = i;
      break;
    }
  }
  if (idxImg < 0) return; // aucune signature dans ce modèle

  const pImg = paras[idxImg];
  const runImg = enfants(pImg, "w:r").find((r) => tous(r, "w:drawing").length);
  if (!runImg) return;
  const runImgClone = runImg.cloneNode(true) as El;

  // Retirer l'ancien bloc : image + éventuelles lignes signataire + espaces adjacents,
  // sans jamais toucher au contenu réel qui précède (Conclusion / Observations…).
  const aRetirer: El[] = [pImg];
  for (let j = idxImg - 1; j >= 0; j--) {
    if (paragrapheVide(paras[j]) || estTexteSignature(paras[j])) aRetirer.push(paras[j]);
    else break;
  }
  for (let k = idxImg + 1; k < idxAncre; k++) {
    if (paragrapheVide(paras[k])) aRetirer.push(paras[k]);
    else break;
  }
  for (const p of aRetirer) p.parentNode && p.parentNode.removeChild(p);

  // Point d'insertion : après le tableau photos s'il existe, sinon après l'ancre.
  // On saute l'éventuel paragraphe espaceur inséré entre la bannière et le tableau.
  let apres: El = ancre;
  let sib = ancre.nextSibling as El | null;
  while (sib) {
    if (sib.nodeType === 1 && (sib as El).tagName === "w:tbl") {
      apres = sib;
      break;
    }
    sib = sib.nextSibling as El | null;
  }

  let cur = apres;
  const ins = (node: El) => {
    apres.parentNode!.insertBefore(node, cur.nextSibling);
    cur = node;
  };

  // Reconstruire le bloc signature, aligné à droite et abaissé (comme les anciens
  // rapports) : un espace généreux au-dessus le pousse vers le bas de la page, sans
  // aller « tout en bas » pour ne pas mordre le pied de page ni créer de page vierge.
  const l1 = pAligne(doc, "right", 48);
  l1.appendChild(runFormate(doc, "Laurent de Vallée,", { gras: true, taille: 11 }));
  l1.appendChild(runFormate(doc, " architecte DPLG", { taille: 11 }));
  ins(l1);

  const l2 = pAligne(doc, "right");
  l2.appendChild(runFormate(doc, "Membre de la Compagnie des architectes de copropriété", { taille: 10 }));
  ins(l2);

  const l3 = pAligne(doc, "right", 4);
  l3.appendChild(runImgClone);
  ins(l3);
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

export function genererDocx(
  template: Uint8Array,
  donnees: DonneesCR,
  chantier: Chantier,
  photos: PhotoDocx[],
): Uint8Array {
  const zip = new PizZip(template);
  const docXml = zip.file("word/document.xml")!.asText();
  const doc = new DOMParser().parseFromString(docXml, "text/xml");
  const { ajouterMedia, ecrireRels } = preparerMedia(zip);

  // --- Page de garde ---
  completer(doc, trouver(doc, "SDC"), chantier.sdc);
  completer(doc, trouver(doc, "VISITE du"), frDate(chantier.date_visite));
  completer(doc, trouver(doc, "Code immeuble"), String(chantier.code_immeuble || ""));

  // --- Contacts ---
  remplirContacts(doc, chantier.contacts);

  // --- Généralités ---
  insererGeneralites(doc, trouver(doc, "generalites"), donnees.generalites || []);

  // --- Observations ---
  insererObservations(doc, trouver(doc, "OBSERVATIONS"), donnees.observations || []);

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

  // --- Signature en bas de la dernière page (après les photos) ---
  essayer(() => deplacerSignatureEnBas(doc));

  // --- Écriture ---
  ecrireRels();
  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  remplirCartouche(zip, chantier);

  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

// ---------------------------------------------------------------------------
// Compte rendu de chantier — remplissage du modèle CR (même pipeline que la visite,
// mais repères propres : bloc titre, contacts MOA/MOE/ENTREPRISES, planning laissé vierge).
// ---------------------------------------------------------------------------

export function genererDocxChantier(
  template: Uint8Array,
  donnees: DonneesCR,
  chantier: Chantier,
  photos: PhotoDocx[],
  meta: MetaChantier = {},
): Uint8Array {
  const zip = new PizZip(template);
  const doc = new DOMParser().parseFromString(zip.file("word/document.xml")!.asText(), "text/xml");
  const { ajouterMedia, ecrireRels } = preparerMedia(zip);

  // --- Bloc titre (valeurs d'exemple à écraser, mise en forme conservée) ---
  const titre = trouver(doc, "CR DE CHANTIER");
  const num = String(meta.numeroReunion || "").trim();
  definirTexteParagraphe(doc, titre, num ? `CR DE CHANTIER N°${num}` : "CR DE CHANTIER");
  const pAdresse = paragrapheSuivant(titre); // ligne adresse (juste sous le titre)
  if (pAdresse) definirTexteParagraphe(doc, pAdresse, (chantier.adresse || "").toUpperCase());
  const pObjet = pAdresse ? paragrapheSuivant(pAdresse) : null; // ligne objet de l'opération
  if (pObjet) definirTexteParagraphe(doc, pObjet, (meta.objet || "").toUpperCase());
  essayer(() => definirTexteParagraphe(doc, trouver(doc, "REUNION du"), `REUNION du ${frDate(chantier.date_visite)}`));

  // --- Code immeuble ---
  essayer(() => completer(doc, trouver(doc, "Code immeuble"), String(chantier.code_immeuble || "")));

  // --- Contacts (MOA / MOE / ENTREPRISES) ---
  remplirContactsChantier(doc, chantier.contacts);

  // --- Généralités ---
  essayer(() => insererGeneralites(doc, trouver(doc, "generalites"), donnees.generalites || []));

  // --- Observations ---
  insererObservations(doc, trouver(doc, "OBSERVATIONS"), donnees.observations || []);

  // --- Photos ---
  insererPhotos(doc, zip, photos, ajouterMedia);

  // --- Signature en bas de la dernière page (après les photos) ---
  essayer(() => deplacerSignatureEnBas(doc));

  // --- Écriture ---
  ecrireRels();
  zip.file("word/document.xml", new XMLSerializer().serializeToString(doc));
  remplirCartouche(zip, chantier);

  return zip.generate({ type: "uint8array", compression: "DEFLATE" });
}

// Exécute une opération de remplissage optionnelle : si un repère est absent du modèle,
// on ignore silencieusement plutôt que de faire échouer toute la génération.
function essayer(fn: () => void): void {
  try {
    fn();
  } catch {
    /* repère absent du modèle : section ignorée */
  }
}
