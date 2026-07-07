import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Security Middleware
 *
 * 1. Validates the Origin header on all /api/* requests to prevent
 *    Cross-Site Request Forgery (CSRF) and Cross-Site WebSocket
 *    Hijacking (CSWSH).
 *
 * 2. Rewrites /api/ws/gemini to the upstream Gemini Live API at
 *    REQUEST TIME (not build time), so the API key is never written
 *    to .next/ build artifacts or route manifests.
 */
export function proxy(request: NextRequest) {
  // ── Origin Validation ──────────────────────────────────────────
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");

  if (origin) {
    try {
      const originUrl = new URL(origin);
      if (originUrl.host !== host) {
        console.warn(
          `[Security] Blocked cross-origin API request from ${origin} to ${host}${request.nextUrl.pathname}`
        );
        return new NextResponse(
          JSON.stringify({ error: "Cross-origin request denied." }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        );
      }
    } catch {
      return new NextResponse(
        JSON.stringify({ error: "Invalid origin." }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }
  }

  // ── Runtime WebSocket Proxy Rewrite (CRIT-01 fix) ──────────────
  // The API key is read from the process environment at request time,
  // never interpolated into static config files or build output.
  if (request.nextUrl.pathname === "/api/ws/gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return new NextResponse(
        JSON.stringify({ error: "Translation service is not configured." }),
        { status: 503, headers: { "Content-Type": "application/json" } }
      );
    }

    const geminiUrl = new URL(
      "https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent"
    );
    geminiUrl.searchParams.set("key", apiKey);

    return NextResponse.rewrite(geminiUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
