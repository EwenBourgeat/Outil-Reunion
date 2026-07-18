"use client";

import { useState } from "react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [mdp, setMdp] = useState("");
  const [erreur, setErreur] = useState("");
  const [charge, setCharge] = useState(false);

  async function soumettre(e: React.FormEvent) {
    e.preventDefault();
    setErreur("");
    if (!email.trim() || !mdp) {
      setErreur("Renseignez votre e-mail et votre mot de passe.");
      return;
    }
    setCharge(true);
    const fd = new FormData();
    fd.append("email", email.trim());
    fd.append("mdp", mdp);
    try {
      const r = await fetch("/api/login", { method: "POST", body: fd });
      if (r.ok) {
        window.location.href = "/";
        return;
      }
      const d = await r.json().catch(() => ({}));
      setErreur(d.detail || "Connexion impossible.");
    } catch {
      setErreur("Le serveur ne répond pas. Vérifiez qu'il est bien démarré.");
    } finally {
      setCharge(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-5">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center text-center mb-7">
          <div className="w-11 h-11 rounded-xl bg-ink text-paper flex items-center justify-center mb-3">
            <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 21h18" /><path d="M5 21V7l8-4v18" /><path d="M19 21V11l-6-4" />
              <path d="M9 9v.01" /><path d="M9 12v.01" /><path d="M9 15v.01" />
            </svg>
          </div>
          <div className="kicker text-accent">GO Architecture · Copropriété</div>
          <h1 className="font-display text-[22px] font-semibold mt-1">Compte rendu de diagnostic</h1>
          <p className="text-[13.5px] text-muted mt-1">Connectez-vous pour accéder à l&apos;outil.</p>
        </div>

        <div className="bg-surface border border-line rounded-2xl p-6 shadow-[0_1px_3px_rgba(14,36,61,.05)]">
          {erreur && (
            <div className="mb-4 rounded-lg border border-urgent/25 bg-[#FBEDEC] text-urgent px-3.5 py-2.5 text-[13.5px] leading-snug">
              {erreur}
            </div>
          )}
          <form onSubmit={soumettre} noValidate>
            <label className="block kicker text-muted mb-1.5" htmlFor="email">Adresse e-mail</label>
            <input
              id="email" type="email" autoComplete="username" value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="champ w-full h-12 mb-4" placeholder="vous@exemple.com"
            />
            <label className="block kicker text-muted mb-1.5" htmlFor="mdp">Mot de passe</label>
            <input
              id="mdp" type="password" autoComplete="current-password" value={mdp}
              onChange={(e) => setMdp(e.target.value)}
              className="champ w-full h-12 mb-5" placeholder="••••••••"
            />
            <button
              type="submit" disabled={charge}
              className="btn-primaire w-full h-12 text-[15px] flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {charge ? "Connexion…" : "Se connecter"}
              {charge && (
                <svg className="w-4 h-4 spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                </svg>
              )}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
