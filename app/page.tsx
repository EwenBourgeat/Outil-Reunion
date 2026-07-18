"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { lireChantiers, ecrireChantiers } from "@/lib/chantiers";
import { compresser } from "@/lib/photos";
import type { Chantier, Contact } from "@/lib/types";

interface PhotoUI {
  id: string;
  nom: string;
  dataUrl: string;
  legende: string;
}
interface ResultatGen {
  filename: string;
  docx: string; // base64
  points_a_completer: string[];
}

const CLE_WIP = "cr_diag_wip";
const aujourdhui = () => new Date().toISOString().slice(0, 10);

// --- Détection du format d'enregistrement (compat iOS / Android / desktop) ---
function typeAudioSupporte(): string {
  if (typeof MediaRecorder === "undefined" || !MediaRecorder.isTypeSupported) return "";
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/aac", "audio/ogg"]) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}
function extensionDepuisType(t: string): string {
  t = (t || "").toLowerCase();
  if (t.includes("mp4") || t.includes("aac") || t.includes("m4a")) return "m4a";
  if (t.includes("ogg")) return "ogg";
  if (t.includes("wav")) return "wav";
  return "webm";
}

export default function OutilPage() {
  const [chantiers, setChantiers] = useState<Chantier[]>([]);
  const [index, setIndex] = useState<string>("");
  const [date, setDate] = useState<string>(aujourdhui());
  const [presents, setPresents] = useState<Record<number, boolean>>({});
  const [transcription, setTranscription] = useState<string>("");
  const [photos, setPhotos] = useState<PhotoUI[]>([]);

  const [erreur, setErreur] = useState<string>("");
  const [enreg, setEnreg] = useState(false);
  const [chrono, setChrono] = useState("00:00");
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [etatTranscription, setEtatTranscription] = useState<string>("");
  const [microBloque, setMicroBloque] = useState(false);

  const [progression, setProgression] = useState<null | Record<string, string>>(null);
  const [resultat, setResultat] = useState<ResultatGen | null>(null);
  const [modaleImmeuble, setModaleImmeuble] = useState(false);
  const [restaure, setRestaure] = useState(false);

  // Refs audio (transitoires)
  const mediaRecorder = useRef<MediaRecorder | null>(null);
  const morceaux = useRef<Blob[]>([]);
  const flux = useRef<MediaStream | null>(null);
  const typeEnreg = useRef<string>("");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const secondes = useRef(0);
  const audioCtx = useRef<AudioContext | null>(null);
  const anim = useRef<number | null>(null);
  const ondeRef = useRef<HTMLDivElement | null>(null);

  // ---- Chargement initial + restauration WIP -------------------------------
  useEffect(() => {
    const cs = lireChantiers();
    setChantiers(cs);
    try {
      const brut = localStorage.getItem(CLE_WIP);
      if (brut) {
        const e = JSON.parse(brut);
        if (e.index !== undefined) setIndex(e.index);
        if (e.date) setDate(e.date);
        if (e.presents) setPresents(e.presents);
        if (e.transcription) setTranscription(e.transcription);
        if (Array.isArray(e.photos)) setPhotos(e.photos);
      }
    } catch {
      /* ignore */
    }
    const local = ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
    if (!window.isSecureContext && !local) setMicroBloque(true);
    setRestaure(true);
  }, []);

  // ---- Sauvegarde WIP à chaque changement ----------------------------------
  useEffect(() => {
    if (!restaure) return;
    const etat = { index, date, presents, transcription, photos };
    try {
      localStorage.setItem(CLE_WIP, JSON.stringify(etat));
    } catch {
      try {
        localStorage.setItem(
          CLE_WIP,
          JSON.stringify({ index, date, presents, transcription, photos: photos.map((p) => ({ ...p, dataUrl: "" })) }),
        );
      } catch {
        /* ignore */
      }
    }
  }, [index, date, presents, transcription, photos, restaure]);

  const chantierCourant = index !== "" ? chantiers[Number(index)] : undefined;

  useEffect(() => {
    // Coche tout le monde présent par défaut à la sélection d'un immeuble.
    if (!chantierCourant) return;
    setPresents((prev) => {
      const next = { ...prev };
      (chantierCourant.contacts || []).forEach((_, i) => {
        if (next[i] === undefined) next[i] = true;
      });
      return next;
    });
  }, [chantierCourant]);

  const montrerErreur = (msg: string) => {
    setErreur(msg);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ---- Enregistrement ------------------------------------------------------
  async function basculerEnreg() {
    if (mediaRecorder.current && mediaRecorder.current.state === "recording") {
      mediaRecorder.current.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      montrerErreur("Ce navigateur ne permet pas l'enregistrement direct. Utilisez « Déposer un fichier audio ».");
      return;
    }
    try {
      flux.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      montrerErreur(
        "Le micro n'est pas autorisé. Cliquez sur le cadenas à gauche de l'adresse, autorisez le microphone, puis réessayez.",
      );
      return;
    }
    morceaux.current = [];
    typeEnreg.current = typeAudioSupporte();
    try {
      mediaRecorder.current = typeEnreg.current
        ? new MediaRecorder(flux.current, { mimeType: typeEnreg.current })
        : new MediaRecorder(flux.current);
    } catch {
      mediaRecorder.current = new MediaRecorder(flux.current);
    }
    mediaRecorder.current.ondataavailable = (e) => {
      if (e.data && e.data.size) morceaux.current.push(e.data);
    };
    mediaRecorder.current.onstop = finEnreg;
    mediaRecorder.current.start();
    setEnreg(true);
    demarrerTimer();
    demarrerOnde();
  }

  function finEnreg() {
    arreterTimer();
    arreterOnde();
    flux.current?.getTracks().forEach((t) => t.stop());
    setEnreg(false);
    if (secondes.current < 5) {
      montrerErreur("L'enregistrement semble vide (moins de 5 secondes). Réessayez en parlant plus longtemps.");
      return;
    }
    const type = mediaRecorder.current?.mimeType || typeEnreg.current || "audio/webm";
    const blob = new Blob(morceaux.current, { type });
    const nom = "note." + extensionDepuisType(type);
    setAudioUrl(URL.createObjectURL(blob));
    transcrire(blob, nom);
  }

  function demarrerTimer() {
    secondes.current = 0;
    setChrono("00:00");
    timer.current = setInterval(() => {
      secondes.current += 1;
      const m = String(Math.floor(secondes.current / 60)).padStart(2, "0");
      const s = String(secondes.current % 60).padStart(2, "0");
      setChrono(`${m}:${s}`);
    }, 1000);
  }
  function arreterTimer() {
    if (timer.current) clearInterval(timer.current);
  }

  function demarrerOnde() {
    const onde = ondeRef.current;
    if (!onde) return;
    onde.innerHTML = "";
    for (let i = 0; i < 13; i++) onde.appendChild(document.createElement("span"));
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx.current = new AC();
      const analyser = audioCtx.current.createAnalyser();
      analyser.fftSize = 64;
      audioCtx.current.createMediaStreamSource(flux.current!).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);
      const barres = Array.from(onde.children) as HTMLElement[];
      const boucle = () => {
        analyser.getByteFrequencyData(data);
        barres.forEach((b, i) => {
          const v = data[i * 2] || 0;
          b.style.height = Math.max(6, (v / 255) * 30) + "px";
          b.style.animation = "none";
        });
        anim.current = requestAnimationFrame(boucle);
      };
      boucle();
    } catch {
      /* animation CSS par défaut */
    }
  }
  function arreterOnde() {
    if (anim.current) cancelAnimationFrame(anim.current);
    if (audioCtx.current) {
      try {
        audioCtx.current.close();
      } catch {
        /* ignore */
      }
      audioCtx.current = null;
    }
  }

  async function transcrire(blob: Blob, nom: string) {
    setEtatTranscription("Transcription en cours…");
    const fd = new FormData();
    fd.append("audio", blob, nom);
    try {
      const r = await fetch("/api/transcribe", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "Échec de la transcription.");
      setTranscription(data.transcription);
      setEtatTranscription(`Transcrit (${data.duree}s) — relisez et corrigez si besoin.`);
    } catch (e) {
      setEtatTranscription("");
      montrerErreur(e instanceof Error ? e.message : "La transcription a échoué.");
    }
  }

  function surFichierAudio(f: File | undefined) {
    if (!f) return;
    setAudioUrl(URL.createObjectURL(f));
    transcrire(f, f.name);
  }

  // ---- Photos --------------------------------------------------------------
  async function ajouterPhotos(fichiers: FileList | File[]) {
    const nouvelles: PhotoUI[] = [];
    for (const f of Array.from(fichiers)) {
      if (!f.type.startsWith("image/") && !/\.heic$/i.test(f.name)) continue;
      const dataUrl = await compresser(f);
      nouvelles.push({ id: crypto.randomUUID(), nom: f.name, dataUrl, legende: "" });
    }
    setPhotos((p) => [...p, ...nouvelles]);
  }
  function deplacerPhoto(i: number, sens: number) {
    setPhotos((p) => {
      const j = i + sens;
      if (j < 0 || j >= p.length) return p;
      const copie = [...p];
      const [item] = copie.splice(i, 1);
      copie.splice(j, 0, item);
      return copie;
    });
  }
  function supprimerPhoto(id: string) {
    setPhotos((p) => p.filter((x) => x.id !== id));
  }
  function legenderPhoto(id: string, valeur: string) {
    setPhotos((p) => p.map((x) => (x.id === id ? { ...x, legende: valeur } : x)));
  }

  // ---- Génération ----------------------------------------------------------
  const pret = index !== "" && transcription.trim().length > 0;

  async function generer() {
    if (!chantierCourant) return;
    setErreur("");
    const fiche: Chantier = {
      ...chantierCourant,
      date_visite: date || aujourdhui(),
      contacts: (chantierCourant.contacts || []).map((c, i) => ({ ...c, present: !!presents[i] })),
    };
    setProgression({ transcription: "fait", analyse: "cours" });
    try {
      const r = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chantier: fiche,
          transcription,
          photos: photos.map((p) => ({ nom: p.nom, legende: p.legende, dataUrl: p.dataUrl })),
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.detail || "La génération a échoué.");
      setProgression({ transcription: "fait", analyse: "fait", miseenpage: "fait", pret: "fait" });
      await new Promise((res) => setTimeout(res, 350));
      setProgression(null);
      setResultat(data as ResultatGen);
    } catch (e) {
      setProgression(null);
      montrerErreur(e instanceof Error ? e.message : "La génération a échoué.");
    }
  }

  function telecharger() {
    if (!resultat) return;
    const octets = Uint8Array.from(atob(resultat.docx), (c) => c.charCodeAt(0));
    const blob = new Blob([octets], {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = resultat.filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function nouveau() {
    setResultat(null);
    setTranscription("");
    setPhotos([]);
    setAudioUrl("");
    setEtatTranscription("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deconnexion() {
    try {
      await fetch("/api/logout", { method: "POST" });
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  }

  // ---- Nouvel immeuble -----------------------------------------------------
  function enregistrerImmeuble(nouvelImmeuble: Chantier) {
    const cs = [...chantiers, nouvelImmeuble];
    setChantiers(cs);
    ecrireChantiers(cs);
    setIndex(String(cs.length - 1));
    setPresents({});
    setModaleImmeuble(false);
  }

  return (
    <>
      {erreur && (
        <div className="sticky top-0 z-50 border-b border-urgent/25 bg-[#FBEDEC] text-urgent px-4 sm:px-6 py-3 text-[14.5px] flex items-start gap-3">
          <svg className="w-5 h-5 shrink-0 mt-[1px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="flex-1 leading-snug">{erreur}</span>
          <button onClick={() => setErreur("")} className="text-urgent/60 hover:text-urgent" aria-label="Fermer">✕</button>
        </div>
      )}

      <header className="border-b border-line/80 bg-surface/70">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-ink text-paper flex items-center justify-center shrink-0">
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" /><path d="M9 9v.01" /><path d="M9 12v.01" /><path d="M9 15v.01" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="kicker text-accent">GO Architecture · Copropriété</div>
            <div className="font-display font-semibold text-[15.5px] -mt-[1px]">Compte rendu de diagnostic</div>
          </div>
          <button onClick={deconnexion} className="ml-auto btn-fant h-10 px-3 text-[13.5px] flex items-center gap-1.5">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" />
            </svg>
            <span className="hidden sm:inline">Déconnexion</span>
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 sm:px-6 pt-7 pb-28 space-y-5">
        <p className="text-[14.5px] text-muted max-w-xl leading-relaxed">
          Note vocale de visite et photos : l&apos;outil rédige le rapport et le met en page dans le
          template de l&apos;agence, prêt à relire dans Word.
        </p>

        {/* 01 — CHANTIER */}
        <section className="card p-5 sm:p-6">
          <div className="flex items-baseline gap-3 mb-5">
            <span className="kicker text-accent">01</span>
            <h2 className="font-display text-[19px] font-semibold leading-none">Le chantier</h2>
            {chantierCourant && <span className="ml-auto text-[12.5px] text-faint">Sélectionné</span>}
          </div>

          <label className="block kicker text-muted mb-2" htmlFor="select-chantier">Immeuble</label>
          <div className="flex gap-2.5 flex-col sm:flex-row">
            <div className="select-wrap flex-1">
              <select
                id="select-chantier" value={index}
                onChange={(e) => { setIndex(e.target.value); setPresents({}); }}
                className="champ w-full h-12"
              >
                <option value="">Choisir un immeuble</option>
                {chantiers.map((c, i) => (
                  <option key={i} value={i}>
                    {`${c.sdc} — ${c.adresse || ""} ${c.code_immeuble ? "(" + c.code_immeuble + ")" : ""}`.trim()}
                  </option>
                ))}
              </select>
            </div>
            <button onClick={() => setModaleImmeuble(true)} className="btn-fant px-4 h-12 text-[14.5px] flex items-center justify-center gap-2 shrink-0">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
              Nouvel immeuble
            </button>
          </div>

          {chantierCourant && (
            <div className="mt-6 pt-6 border-t border-line">
              <div className="grid sm:grid-cols-2 gap-5">
                <div>
                  <span className="block kicker text-faint mb-1.5">Adresse</span>
                  <p className="text-[15px] font-display">{chantierCourant.adresse || "—"}</p>
                </div>
                <div>
                  <span className="block kicker text-faint mb-1.5">Code immeuble · N° d&apos;affaire</span>
                  <p className="text-[14px] font-mono text-ink/90">{`${chantierCourant.code_immeuble || "—"}  ·  ${chantierCourant.n_affaire || "—"}`}</p>
                </div>
              </div>
              <div className="mt-5 max-w-xs">
                <label className="block kicker text-muted mb-2" htmlFor="date-visite">Date de la visite</label>
                <input id="date-visite" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="champ w-full h-12" />
              </div>
              <div className="mt-5">
                <span className="block kicker text-muted mb-2.5">
                  Personnes présentes <span className="normal-case tracking-normal text-faint font-sans">(décochez les absents)</span>
                </span>
                <ul className="grid sm:grid-cols-2 gap-2">
                  {(chantierCourant.contacts || []).map((ct, i) => (
                    <li key={i}>
                      <label className="flex items-center gap-3 cursor-pointer rounded-xl border border-line px-3 py-2.5 hover:border-line-2 transition">
                        <input
                          type="checkbox" className="chk shrink-0"
                          checked={presents[i] ?? true}
                          onChange={(e) => setPresents((p) => ({ ...p, [i]: e.target.checked }))}
                        />
                        <span className="text-[14px] leading-tight min-w-0">
                          <span className="font-display font-medium block truncate">{ct.organisme || ct.groupe || ""}</span>
                          <span className="text-muted text-[13px] block truncate">{ct.nom || ""}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </section>

        {/* 02 — NOTE VOCALE */}
        <section className="card p-5 sm:p-6">
          <div className="flex items-baseline gap-3 mb-5">
            <span className="kicker text-accent">02</span>
            <h2 className="font-display text-[19px] font-semibold leading-none">La note vocale</h2>
            {transcription.trim() && <span className="ml-auto text-[12.5px] text-faint">{transcription.trim().split(/\s+/).length} mots</span>}
          </div>

          <div className="grid sm:grid-cols-2 gap-3.5">
            <div className="rounded-[11px] border border-line p-5 flex flex-col items-center justify-center text-center bg-[#F8FBFE]">
              <button
                onClick={basculerEnreg} disabled={microBloque}
                className={`rec-btn ${enreg ? "enreg pulse-rec" : ""} ${microBloque ? "opacity-40 cursor-not-allowed" : ""}`}
                aria-label="Démarrer l'enregistrement"
              >
                {enreg ? (
                  <svg className="w-7 h-7" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2.5" /></svg>
                ) : (
                  <svg className="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" />
                  </svg>
                )}
              </button>
              {enreg && <div className="mt-3 font-display font-semibold text-[19px] tabular-nums">{chrono}</div>}
              <div ref={ondeRef} className={`onde mt-2 ${enreg ? "" : "hidden"}`} aria-hidden="true" />
              <p className="mt-3 text-[13.5px] text-muted leading-snug max-w-[220px]">
                {microBloque
                  ? "Enregistrement direct bloqué ici (réseau non sécurisé). Utilisez le dépôt de fichier : le dictaphone du téléphone s'ouvrira."
                  : enreg
                    ? "Enregistrement… appuyez pour arrêter."
                    : "Appuyez pour dicter votre note de visite."}
              </p>
            </div>

            <label className="depot p-5 flex flex-col items-center justify-center text-center cursor-pointer">
              <svg className="w-7 h-7 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              <p className="mt-2.5 text-[14.5px] font-medium">Déposer un fichier audio</p>
              <p className="text-[12.5px] text-faint mt-0.5">.m4a, .mp3, .wav, .ogg — ou appuyez pour choisir</p>
              <input type="file" accept=".m4a,.mp3,.wav,.ogg,audio/*" className="hidden" onChange={(e) => surFichierAudio(e.target.files?.[0])} />
            </label>
          </div>

          {audioUrl && (
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              <audio src={audioUrl} controls className="flex-1 min-w-[200px] h-11" />
            </div>
          )}

          {(transcription || etatTranscription) && (
            <div className="mt-5">
              <div className="flex items-center justify-between mb-2">
                <label className="kicker text-muted" htmlFor="txt">
                  Transcription <span className="normal-case tracking-normal text-faint font-sans">(corrigez si besoin)</span>
                </label>
                <span className="text-[12.5px] text-faint">{etatTranscription}</span>
              </div>
              <textarea
                id="txt" rows={6} value={transcription}
                onChange={(e) => setTranscription(e.target.value)}
                className="champ w-full py-3 text-[15px] leading-relaxed resize-y"
                placeholder="Le texte transcrit apparaîtra ici…"
              />
            </div>
          )}
        </section>

        {/* 03 — PHOTOS */}
        <section className="card p-5 sm:p-6">
          <div className="flex items-baseline gap-3 mb-1.5">
            <span className="kicker text-accent">03</span>
            <h2 className="font-display text-[19px] font-semibold leading-none">Les photos</h2>
            {photos.length > 0 && <span className="ml-auto text-[12.5px] text-faint">{photos.length} photo{photos.length > 1 ? "s" : ""}</span>}
          </div>
          <p className="text-[12.5px] text-faint mb-4">L&apos;ordre des photos est celui du document. Réordonnez avec les flèches.</p>

          <label className="depot p-6 flex flex-col items-center justify-center text-center cursor-pointer">
            <svg className="w-7 h-7 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2.5" /><circle cx="8.5" cy="8.5" r="1.6" /><polyline points="21 15 16 10 5 21" />
            </svg>
            <p className="mt-2.5 text-[14.5px] font-medium">Déposer vos photos</p>
            <p className="text-[12.5px] text-faint mt-0.5">iPhone (.heic) accepté — ou appuyez pour parcourir</p>
            <input type="file" accept="image/*,.heic" multiple className="hidden" onChange={(e) => e.target.files && ajouterPhotos(e.target.files)} />
          </label>

          {photos.length > 0 && (
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {photos.map((ph, i) => (
                <div key={ph.id} className="photo-carte">
                  <div className="relative">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={ph.dataUrl} alt="" className="w-full h-28 object-cover bg-[#E8EFF7]" />
                    <span className="absolute top-1.5 left-1.5 font-display text-[11px] font-medium bg-ink/75 text-paper px-1.5 py-0.5 rounded">N° {i + 1}</span>
                    <button onClick={() => supprimerPhoto(ph.id)} className="absolute top-1.5 right-1.5 w-7 h-7 min-h-0 rounded-full bg-ink/70 text-white flex items-center justify-center hover:bg-urgent transition" aria-label="Supprimer">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                    </button>
                    <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                      <button onClick={() => deplacerPhoto(i, -1)} disabled={i === 0} className="w-7 h-7 min-h-0 rounded-md bg-ink/70 text-white flex items-center justify-center disabled:opacity-30 hover:bg-accent transition" aria-label="Déplacer avant">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
                      </button>
                      <button onClick={() => deplacerPhoto(i, 1)} disabled={i === photos.length - 1} className="w-7 h-7 min-h-0 rounded-md bg-ink/70 text-white flex items-center justify-center disabled:opacity-30 hover:bg-accent transition" aria-label="Déplacer après">
                        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                      </button>
                    </div>
                  </div>
                  <input
                    type="text" value={ph.legende} placeholder="légende facultative"
                    onChange={(e) => legenderPhoto(ph.id, e.target.value)}
                    className="w-full text-[13px] px-2.5 py-2 border-t border-line outline-none focus:bg-accent-soft/40" style={{ minHeight: 40 }}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      {/* BARRE D'ACTION */}
      <div className="barre-action">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          {!pret && (
            <p className="text-[12.5px] text-muted leading-snug sm:flex-1">
              Choisissez un immeuble et enregistrez une note vocale pour activer la génération.
            </p>
          )}
          <button
            onClick={generer} disabled={!pret}
            className="btn-primaire w-full sm:w-auto px-7 h-[52px] text-[15.5px] flex items-center justify-center gap-2.5 shrink-0 sm:ml-auto"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
            </svg>
            Générer le compte rendu
          </button>
        </div>
      </div>

      {/* MODALE PROGRESSION */}
      {progression && (
        <div className="fixed inset-0 z-50 modale-fond flex items-center justify-center p-4">
          <div className="card w-full max-w-md p-6 sm:p-7">
            <h3 className="font-display text-[18px] font-semibold mb-6">Génération en cours</h3>
            <ul className="space-y-4">
              {([["transcription", "Transcription de la note vocale"], ["analyse", "Analyse et rédaction"], ["miseenpage", "Mise en page dans le template"], ["pret", "Compte rendu prêt"]] as const).map(([cle, lib]) => {
                const st = progression[cle] || "attente";
                return (
                  <li key={cle} className={`flex items-center gap-3 ${st === "attente" ? "text-faint" : "text-ink"}`}>
                    <span className="shrink-0 w-6 flex justify-center">
                      {st === "fait" ? (
                        <svg className="w-[22px] h-[22px] text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      ) : st === "cours" ? (
                        <svg className="w-[22px] h-[22px] text-accent spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>
                      ) : (
                        <span className="w-[22px] h-[22px] rounded-full border-2 border-line block" />
                      )}
                    </span>
                    <span className={`text-[15px] ${st === "cours" ? "font-medium" : ""}`}>{lib}</span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      )}

      {/* MODALE RÉSULTAT */}
      {resultat && (
        <div className="fixed inset-0 z-50 modale-fond flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) setResultat(null); }}>
          <div className="card w-full max-w-lg p-6 sm:p-7 max-h-[90vh] overflow-auto">
            <div className="flex items-center gap-2.5 mb-5">
              <svg className="w-7 h-7 text-accent" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
              <h3 className="font-display text-[20px] font-semibold">Compte rendu prêt</h3>
            </div>
            {resultat.points_a_completer?.length > 0 && (
              <div className="mb-5 rounded-xl border border-court/30 bg-[#FBF3E8] p-4">
                <p className="font-display font-semibold text-court mb-1.5 flex items-center gap-2 text-[14.5px]">
                  <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  À vérifier avant d&apos;envoyer
                </p>
                <p className="text-[13px] text-muted mb-3">Ces points n&apos;étaient pas dans votre note. Confirmez-les pendant la relecture.</p>
                <ul className="space-y-2">
                  {resultat.points_a_completer.map((p, i) => (
                    <li key={i}>
                      <label className="flex items-start gap-2.5 cursor-pointer text-[14px] leading-snug">
                        <input type="checkbox" className="chk mt-0.5 shrink-0" /><span>{p}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-2.5">
              <button onClick={telecharger} className="btn-primaire px-4 py-3 text-[14.5px] flex items-center justify-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>
                Télécharger le .docx
              </button>
              <button onClick={nouveau} className="btn-fant px-4 py-3 text-[14.5px] flex items-center justify-center gap-2">
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                Nouveau
              </button>
            </div>
          </div>
        </div>
      )}

      {modaleImmeuble && <ModaleImmeuble onAnnuler={() => setModaleImmeuble(false)} onEnregistrer={enregistrerImmeuble} onErreur={montrerErreur} />}
    </>
  );
}

// ===================================================================
//  Modale « Nouvel immeuble »
// ===================================================================
function ModaleImmeuble({
  onAnnuler,
  onEnregistrer,
  onErreur,
}: {
  onAnnuler: () => void;
  onEnregistrer: (c: Chantier) => void;
  onErreur: (m: string) => void;
}) {
  const [sdc, setSdc] = useState("");
  const [code, setCode] = useState("");
  const [adresse, setAdresse] = useState("");
  const [affaire, setAffaire] = useState("");
  const [moa, setMoa] = useState("");
  const [contacts, setContacts] = useState<Contact[]>([{ groupe: "MOA", organisme: "SYNDIC", nom: "" }]);

  function majContact(i: number, champ: keyof Contact, valeur: string) {
    setContacts((cs) => cs.map((c, j) => (j === i ? { ...c, [champ]: valeur } : c)));
  }

  function enregistrer() {
    if (!sdc.trim()) {
      onErreur("Le nom de l'immeuble est obligatoire.");
      return;
    }
    const nettoyes = contacts
      .map((c) => ({ groupe: c.groupe || "MOA", organisme: c.organisme || "", nom: c.nom || "", telephone: "", email: "" }))
      .filter((c) => c.organisme || c.nom);
    onEnregistrer({
      sdc: sdc.trim(), adresse: adresse.trim(), code_immeuble: code.trim(),
      n_affaire: affaire.trim(), moa: moa.trim(), contacts: nettoyes,
    });
  }

  return (
    <div className="fixed inset-0 z-50 modale-fond flex items-center justify-center p-4" onClick={(e) => { if (e.target === e.currentTarget) onAnnuler(); }}>
      <div className="card w-full max-w-lg p-6 sm:p-7 max-h-[90vh] overflow-auto">
        <h3 className="font-display text-[18px] font-semibold mb-5">Nouvel immeuble</h3>
        <div className="space-y-3.5">
          <div className="grid sm:grid-cols-2 gap-3.5">
            <div className="sm:col-span-2">
              <label className="block kicker text-muted mb-1.5">Nom de l&apos;immeuble *</label>
              <input value={sdc} onChange={(e) => setSdc(e.target.value)} className="champ w-full h-12" placeholder="SDC 12 RUE …" />
            </div>
            <div>
              <label className="block kicker text-muted mb-1.5">Code immeuble</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} className="champ w-full h-12" />
            </div>
            <div>
              <label className="block kicker text-muted mb-1.5">N° d&apos;affaire</label>
              <input value={affaire} onChange={(e) => setAffaire(e.target.value)} className="champ w-full h-12" />
            </div>
            <div className="sm:col-span-2">
              <label className="block kicker text-muted mb-1.5">Adresse</label>
              <input value={adresse} onChange={(e) => setAdresse(e.target.value)} className="champ w-full h-12" />
            </div>
            <div className="sm:col-span-2">
              <label className="block kicker text-muted mb-1.5">Syndic (MOA)</label>
              <input value={moa} onChange={(e) => setMoa(e.target.value)} className="champ w-full h-12" />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="kicker text-muted">Contacts</label>
              <button onClick={() => setContacts((cs) => [...cs, { groupe: "MOA", organisme: "", nom: "" }])} className="text-[13.5px] text-accent hover:text-accent-ink font-medium">+ Ajouter un contact</button>
            </div>
            <div className="space-y-2">
              {contacts.map((c, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-center">
                  <div className="select-wrap col-span-3">
                    <select value={c.groupe} onChange={(e) => majContact(i, "groupe", e.target.value)} className="champ w-full h-11 text-[13.5px]">
                      <option value="MOA">MOA</option><option value="MOE">MOE</option>
                    </select>
                  </div>
                  <input value={c.organisme || ""} onChange={(e) => majContact(i, "organisme", e.target.value)} className="champ col-span-3 h-11 text-[13.5px]" placeholder="Organisme" />
                  <input value={c.nom || ""} onChange={(e) => majContact(i, "nom", e.target.value)} className="champ col-span-5 h-11 text-[13.5px]" placeholder="Nom" />
                  <button onClick={() => setContacts((cs) => cs.filter((_, j) => j !== i))} className="col-span-1 text-muted hover:text-urgent flex justify-center" aria-label="Retirer">
                    <svg className="w-[18px] h-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="flex gap-2.5 justify-end mt-6">
          <button onClick={onAnnuler} className="btn-fant px-4 py-2.5 text-[14.5px]">Annuler</button>
          <button onClick={enregistrer} className="btn-primaire px-5 py-2.5 text-[14.5px]">Enregistrer l&apos;immeuble</button>
        </div>
      </div>
    </div>
  );
}
