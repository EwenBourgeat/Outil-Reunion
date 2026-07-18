// Types partagés — miroir des structures de l'app Python d'origine.

export interface Contact {
  groupe?: string;
  organisme?: string;
  role?: string;
  nom?: string;
  telephone?: string;
  email?: string;
  present?: boolean;
}

export interface Chantier {
  sdc: string;
  adresse?: string;
  code_immeuble?: string;
  n_affaire?: string;
  moa?: string;
  date_visite?: string;
  contacts: Contact[];
}

export interface Observation {
  titre: string;
  constat?: string;
  analyse?: string;
  preconisation?: string;
  priorite?: string;
  photos_liees?: number[];
}

export interface Conclusion {
  synthese?: string[];
  energetique?: string[];
}

export interface PhotoMeta {
  fichier: string;
  legende: string;
}

export interface DonneesCR {
  generalites?: string[];
  observations?: Observation[];
  conclusion?: Conclusion;
  photos?: PhotoMeta[];
  points_a_completer?: string[];
}

// Photo transmise par le client à /api/generate (image compressée en base64).
export interface PhotoEntree {
  nom: string;
  legende: string;
  dataUrl: string; // "data:image/jpeg;base64,...."
}
