// middleware.ts — Garde d'authentification sur toute l'application (runtime edge).
import { NextResponse, type NextRequest } from "next/server";
import { COOKIE, sessionValide } from "@/lib/session";

const PUBLICS = new Set(["/login", "/api/login", "/api/logout"]);

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (PUBLICS.has(pathname)) return NextResponse.next();

  const jeton = req.cookies.get(COOKIE)?.value;
  if (await sessionValide(jeton)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ detail: "Session expirée. Reconnectez-vous." }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  return NextResponse.redirect(url);
}

// On protège tout sauf les ressources statiques de Next (nécessaires à /login).
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
