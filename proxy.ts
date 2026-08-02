import { NextRequest, NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";

const PROTECTED_PAGES = ["/dashboard.html", "/new-automation.html"];
const PROTECTED_API_PREFIXES = [
  "/api/automations",
  "/api/config",
  "/api/media",
  "/api/stats",
  "/api/events",
  "/api/oauth/start",
];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isProtectedPage = PROTECTED_PAGES.includes(pathname);
  const isProtectedApi = PROTECTED_API_PREFIXES.some((p) => pathname.startsWith(p));

  if (!isProtectedPage && !isProtectedApi) return NextResponse.next();

  const token = req.cookies.get("session")?.value;
  const valid = verifySession(token);

  if (!valid) {
    if (isProtectedApi) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login.html";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/dashboard.html",
    "/new-automation.html",
    "/api/automations/:path*",
    "/api/config",
    "/api/media",
    "/api/stats",
    "/api/events",
    "/api/oauth/start",
  ],
};
