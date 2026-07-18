// photos.ts — Compression des photos côté navigateur (canvas), avant envoi.
// Réduit la largeur à 1600 px et encode en JPEG q80 pour rester sous la limite
// de taille des fonctions serverless. Renvoie une data URL.
//
// Limite connue : les .heic (iPhone) ne se décodent en <canvas> que sur Safari.
// Sur les autres navigateurs, on renvoie le fichier d'origine tel quel.

const LARGEUR_MAX = 1600;
const QUALITE = 0.8;

export function fileVersDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

export async function compresser(file: File): Promise<string> {
  try {
    const bitmap = await createImageBitmap(file);
    const echelle = Math.min(1, LARGEUR_MAX / bitmap.width);
    const w = Math.round(bitmap.width * echelle);
    const h = Math.round(bitmap.height * echelle);
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas indisponible");
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", QUALITE);
  } catch {
    // HEIC hors Safari, ou format non décodable : on renvoie l'original.
    return fileVersDataUrl(file);
  }
}
