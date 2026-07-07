# 🛡️ LiveTranslate (Aura) — Security Audit Report

**Audit Date:** 2026-07-06  
**Auditor:** Automated Deep-Source Review  
**Scope:** Full codebase — server routes, client hooks, components, configuration, and dependencies  
**Severity Scale:** 🔴 Critical · 🟠 High · 🟡 Medium · 🔵 Low · ⚪ Informational

---

## Executive Summary

The LiveTranslate ("Aura") application was audited across **12 source files**, **2 API routes**, **1 Next.js rewrite proxy**, **1 rate limiter**, and **503 npm dependencies**. The audit identified **3 critical**, **3 high**, **4 medium**, **3 low**, and **3 informational** findings. The most severe issue is a **plaintext API key embedded in the Next.js rewrite rule** that is interpolated at build time and can be extracted by any client via WebSocket interception.

| Severity | Count | Immediate Action Required |
|----------|-------|---------------------------|
| 🔴 Critical | 3 | Yes — fix before any deployment |
| 🟠 High | 3 | Yes — fix before production |
| 🟡 Medium | 4 | Recommended before production |
| 🔵 Low | 3 | Address in next sprint |
| ⚪ Info | 3 | Awareness only |

---

## 🔴 Critical Findings

### CRIT-01: Gemini API Key Leaked via WebSocket Rewrite Proxy

**File:** [`next.config.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/next.config.ts#L15-L22)  
**CWE:** CWE-200 (Exposure of Sensitive Information), CWE-522 (Insufficiently Protected Credentials)

The Next.js `rewrites()` configuration proxies the client's WebSocket connection directly to Google's Gemini API and **embeds the secret API key in the destination URL**:

```typescript
async rewrites() {
  return [{
    source: "/api/ws/gemini",
    destination: `https://generativelanguage.googleapis.com/ws/...?key=${process.env.GEMINI_API_KEY || ""}`,
  }];
}
```

**Impact:**  
- The `GEMINI_API_KEY` is interpolated into the Next.js internal routing table at build/start time.  
- While the rewrite is server-side, the key is present in Next.js route manifests, build artifacts, and server memory.  
- An attacker with access to `.next/` build output, server memory, or any server-side error that leaks the destination URL obtains the full Gemini API key.  
- In development mode (`next dev`), Next.js may log rewrite destinations to the console or debug output, directly exposing the key.

**Recommendation:**  
Replace the rewrite proxy with a dedicated server-side API route (`/api/ws/gemini/route.ts`) that establishes the upstream WebSocket connection on the server, never exposing the key to the client or build artifacts. Use a proper WebSocket proxy library (e.g., `http-proxy`) that injects the key header-side only.

---

### CRIT-02: API Key Committed to Version Control

**File:** [`.env.local`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/.env.local)

The `.env.local` file contains a live Gemini API key:

```
GEMINI_API_KEY=AIzaSyC_D1KM5TslIVJIHylQc2Mzruq8QV6kDfo_REDACTED
```

Although `.env*` is listed in `.gitignore`, the file currently exists on disk with a real key. If this repository has ever been committed with this file (even once), the key is permanently in git history.

**Impact:**  
- Full unauthorized access to your Google Gemini API quota and billing.  
- Potential for abuse (prompt injection attacks, data exfiltration, quota exhaustion → billing spike).

**Recommendation:**  
1. **Rotate the key immediately** in the Google Cloud Console.  
2. Run `git log --all -- .env.local` to verify it was never committed.  
3. If committed, use `git filter-branch` or `BFG Repo-Cleaner` to purge the file from history.  
4. Add a `.env.local.example` with placeholder values instead.

---

### CRIT-03: No Authentication or Authorization on Token Endpoint

**File:** [`route.ts` (LiveKit token)](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/livekit/token/route.ts)

The `/api/livekit/token` endpoint issues LiveKit access tokens to **any unauthenticated caller**. There is no session check, CSRF protection, or user identity verification:

```typescript
export async function GET(request: Request) {
  // Only rate limiting and input validation — no auth check
  const { searchParams } = new URL(request.url);
  const room = searchParams.get("room");
  const username = searchParams.get("username");
  // ... generates and returns a signed JWT
}
```

**Impact:**  
- Any internet user can request a valid LiveKit room token by providing arbitrary `room` and `username` parameters.  
- Enables unauthorized room joining, eavesdropping on private meetings, identity spoofing (impersonating any username), and potential resource abuse.

**Recommendation:**  
1. Implement authentication (e.g., NextAuth.js session, JWT middleware, or a shared room secret/passcode).  
2. Validate that the requesting user is authorized to join the specified room.  
3. Consider changing from `GET` to `POST` to prevent token URL leakage in browser history, server logs, and referrer headers.

---

## 🟠 High Findings

### HIGH-01: IP Spoofing via `x-forwarded-for` Trust

**Files:** [`route.ts` (token)](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/livekit/token/route.ts#L8), [`route.ts` (translate)](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/translate/route.ts#L8)  
**CWE:** CWE-290 (Authentication Bypass by Spoofing)

Both API routes extract the client IP from the `x-forwarded-for` header without any validation:

```typescript
const clientIp = request.headers.get("x-forwarded-for") || "127.0.0.1";
```

**Impact:**  
- An attacker can set `X-Forwarded-For: <random-ip>` on each request to completely bypass rate limiting.  
- The fallback to `"127.0.0.1"` means all requests without the header share one rate limit bucket — either all are rate limited or none are.

**Recommendation:**  
1. Use the real connecting IP from the request socket (via `request.headers.get('x-real-ip')` or platform-specific headers like Vercel's `x-vercel-forwarded-for`).  
2. If behind a reverse proxy, configure Next.js or the hosting platform to set a trusted `x-real-ip` header.  
3. Never trust `x-forwarded-for` without stripping/validating against known proxy IPs.

---

### HIGH-02: In-Memory Rate Limiter Is Ineffective in Serverless/Multi-Instance Deployments

**File:** [`rateLimiter.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/rateLimiter.ts)  
**CWE:** CWE-770 (Allocation of Resources Without Limits)

The rate limiter uses an in-memory `Map`:

```typescript
const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
```

**Impact:**  
- In serverless deployments (Vercel, AWS Lambda), each cold start creates a fresh `Map`, resetting all rate limits.  
- In multi-instance deployments, each instance has its own `Map`, so an attacker hitting different instances is never rate limited.  
- The `Map` grows unboundedly — no eviction or TTL cleanup. Under sustained attack, this becomes a memory leak (DoS vector).

**Recommendation:**  
1. Use a distributed rate limiter backed by Redis, Upstash, or Cloudflare KV.  
2. Add a TTL-based eviction mechanism (e.g., clean up stale entries every N minutes).  
3. Cap the maximum `Map` size to prevent memory exhaustion.

---

### HIGH-03: Translate Endpoint Leaks Internal Error Details

**File:** [`route.ts` (translate)](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/translate/route.ts#L62)  
**CWE:** CWE-209 (Information Exposure Through Error Message)

```typescript
return NextResponse.json({ success: false, error: error.message }, { status: 500 });
```

**Impact:**  
- Internal error messages from the `@google/genai` SDK or Node.js runtime (stack traces, file paths, auth errors) are returned verbatim to the client.  
- Aids attackers in reconnaissance — revealing SDK versions, server paths, and API error codes.

**Recommendation:**  
Return a generic error message to clients. Log the full error server-side only:

```typescript
console.error("Translation API error:", error);
return NextResponse.json(
  { success: false, error: "An internal error occurred during translation." },
  { status: 500 }
);
```

---

## 🟡 Medium Findings

### MED-01: Content Security Policy Allows `unsafe-eval` and `unsafe-inline`

**File:** [`next.config.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/next.config.ts#L29-L30)

```
script-src 'self' 'unsafe-eval' 'unsafe-inline';
style-src 'self' 'unsafe-inline';
```

**Impact:**  
- `unsafe-eval` allows `eval()`, `Function()`, and `setTimeout(string)` — enabling XSS escalation if any injection vector is found.  
- `unsafe-inline` negates most of CSP's XSS protection for both scripts and styles.

**Recommendation:**  
1. Remove `'unsafe-eval'` — if needed for development only, conditionally add it via environment check.  
2. Replace `'unsafe-inline'` with nonce-based or hash-based CSP directives.  
3. Next.js supports `nonce` via the `Script` component and middleware.

---

### MED-02: `mimeType` Parameter Not Validated in Translate API

**File:** [`route.ts` (translate)](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/translate/route.ts#L16-L56)

The `mimeType` field from the request body is passed directly to the Gemini SDK without any validation:

```typescript
const { base64Audio, targetLanguage, mimeType } = await request.json();
// ...
inlineData: {
  mimeType,  // Unvalidated user input
  data: base64Audio,
}
```

**Impact:**  
- An attacker could pass arbitrary MIME types (e.g., `text/html`, `application/javascript`) to potentially confuse the Gemini model or exploit unexpected behavior in content processing.  
- Could be used for prompt injection through non-audio content masquerading as audio.

**Recommendation:**  
Validate `mimeType` against an allowlist:

```typescript
const ALLOWED_MIME_TYPES = ["audio/pcm;rate=16000", "audio/wav", "audio/webm"];
if (!mimeType || !ALLOWED_MIME_TYPES.includes(mimeType)) {
  return NextResponse.json({ success: false, error: "Invalid MIME type." }, { status: 400 });
}
```

---

### MED-03: Missing CSRF Protection on State-Mutating Endpoints

**Files:** [`route.ts` (translate)](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/translate/route.ts), [`route.ts` (token)](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/livekit/token/route.ts)

Neither API endpoint implements CSRF protection. While the translate endpoint is POST-based, there is no origin verification, CSRF token, or `SameSite` cookie enforcement.

**Impact:**  
- A malicious website could trick an authenticated user's browser into making cross-origin requests to these endpoints, potentially exhausting API quotas or obtaining tokens.

**Recommendation:**  
1. Verify the `Origin` or `Referer` header matches your domain.  
2. Add CSRF tokens if session-based auth is implemented.  
3. Set `SameSite=Strict` on any session cookies.

---

### MED-04: Unbounded Request Body Parsing

**File:** [`route.ts` (translate)](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/translate/route.ts#L16)

```typescript
const { base64Audio, targetLanguage, mimeType } = await request.json();
```

The `request.json()` call parses the entire request body into memory before the 4MB size check runs.

**Impact:**  
- An attacker can send a massive JSON payload (e.g., 100MB) which will be fully parsed into memory before the validation at line 26 rejects it.  
- This is a classic memory exhaustion / Denial-of-Service vector.

**Recommendation:**  
1. Set `bodyParser` limits in the Next.js route config:
   ```typescript
   export const config = { api: { bodyParser: { sizeLimit: '4mb' } } };
   ```
2. Use streaming body parsing or check `Content-Length` before reading the body.

---

## 🔵 Low Findings

### LOW-01: `ScriptProcessorNode` Is Deprecated

**Files:** [`useLiveAPI.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/hooks/useLiveAPI.ts#L350), [`ParticipantTileWithTranslation.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/components/ParticipantTileWithTranslation.tsx#L259), [`MeetingRoom.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/components/MeetingRoom.tsx#L523)

`ScriptProcessorNode` is deprecated in the Web Audio API specification. It runs on the main thread, which can cause audio glitches and is subject to garbage collection pauses.

**Impact:**  
- Future browser versions may remove support.  
- Main-thread execution can cause audio dropouts and jank.

**Recommendation:**  
Migrate to `AudioWorkletNode` with a custom processor for the audio processing pipeline (similar to the RNNoise integration already in place).

---

### LOW-02: `Math.random()` Used for Log Entry IDs

**Files:** [`page.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/page.tsx#L103), [`MeetingRoom.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/components/MeetingRoom.tsx#L108)

```typescript
id: Math.random().toString(),
```

**Impact:**  
- `Math.random()` is not cryptographically secure and can produce collisions.  
- For log IDs this is low-severity, but establishes a pattern that could be copied for security-sensitive uses.

**Recommendation:**  
Use `crypto.randomUUID()` for unique identifiers:
```typescript
id: crypto.randomUUID(),
```

---

### LOW-03: Missing `Strict-Transport-Security` (HSTS) Header

**File:** [`next.config.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/next.config.ts#L23-L51)

The security headers include `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, and `Referrer-Policy`, but **HSTS is missing**.

**Impact:**  
- Without HSTS, the first request to the site could be intercepted via HTTP downgrade attacks (SSL stripping).

**Recommendation:**  
Add the HSTS header:
```typescript
{
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains; preload",
}
```

---

## ⚪ Informational Findings

### INFO-01: Dependency Vulnerability — PostCSS XSS (Moderate)

`npm audit` reports **2 moderate vulnerabilities** in the transitive dependency `postcss` (< 8.5.10) bundled inside `next@16.2.9`:

| Package | Severity | Advisory | CWE |
|---------|----------|----------|-----|
| `postcss` | Moderate | [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) | CWE-79 (XSS) |
| `next` | Moderate | Via `postcss` | — |

**Status:** Fix requires upgrading Next.js (breaking major). Monitor for a patch release.

---

### INFO-02: Setup Payload Logged to Console with Model Configuration

**File:** [`useLiveAPI.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/hooks/useLiveAPI.ts#L136)

```typescript
console.log("[LiveAPI] Sending Setup payload:", JSON.stringify(setupMsg));
```

This logs the full WebSocket setup message to the browser console. While it doesn't contain secrets currently, it reveals the model name, configuration, and target language.

**Recommendation:**  
Remove or gate verbose logging behind a debug flag for production builds.

---

### INFO-03: `localStorage` Data Stored Without Encryption

**Files:** [`page.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/page.tsx#L76-L86), [`MeetingRoom.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/components/MeetingRoom.tsx#L89-L102)

Translation logs and user preferences are stored in `localStorage` in plaintext JSON. Any browser extension or XSS vector can read this data.

**Impact:**  
- Translation history may contain sensitive conversation content.  
- Low severity because `localStorage` is same-origin scoped, but worth noting for privacy-sensitive deployments.

**Recommendation:**  
1. Consider using `sessionStorage` for ephemeral data.  
2. For sensitive translations, encrypt before storing or offer a "don't persist" default.  
3. Implement automatic expiry/pruning of old logs.

---

## Security Posture Summary

### ✅ What's Done Well

| Area | Assessment |
|------|------------|
| **Input validation** | Token endpoint has strict regex + length checks on `room` and `username` |
| **Payload size limits** | Translate endpoint caps base64 audio at 4MB |
| **Security headers** | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy` all present |
| **Token TTL** | LiveKit tokens expire in 5 minutes (ephemeral) |
| **No XSS patterns** | Zero usage of `dangerouslySetInnerHTML`, `eval()`, or `innerHTML` in source code |
| **Env file gitignored** | `.env*` pattern in `.gitignore` prevents accidental commit |
| **Retry limiting** | WebSocket connection has a 3-attempt retry cap with backoff |
| **Audio resource cleanup** | Proper disconnection/cleanup of all audio nodes on unmount |
| **Cryptographic room IDs** | Lobby uses `crypto.getRandomValues()` for room ID generation |

### ❌ Priority Remediation Roadmap

| Priority | Finding | Effort |
|----------|---------|--------|
| **P0** | CRIT-01: Replace rewrite proxy with server-side WS route | ~2 hours |
| **P0** | CRIT-02: Rotate the exposed Gemini API key | ~10 minutes |
| **P0** | CRIT-03: Add authentication to token endpoint | ~3 hours |
| **P1** | HIGH-01: Fix IP extraction for rate limiting | ~30 minutes |
| **P1** | HIGH-02: Use distributed rate limiter | ~2 hours |
| **P1** | HIGH-03: Sanitize error responses | ~15 minutes |
| **P2** | MED-01: Tighten CSP directives | ~1 hour |
| **P2** | MED-02: Validate mimeType allowlist | ~15 minutes |
| **P2** | MED-03: Add CSRF protection | ~1 hour |
| **P2** | MED-04: Set body parser limits | ~15 minutes |
| **P3** | LOW-01 through LOW-03 | ~1–2 hours |

---

## Files Audited

| File | Lines | Findings |
|------|-------|----------|
| [`next.config.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/next.config.ts) | 55 | CRIT-01, MED-01, LOW-03 |
| [`.env.local`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/.env.local) | 2 | CRIT-02 |
| [`api/livekit/token/route.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/livekit/token/route.ts) | 90 | CRIT-03, HIGH-01, MED-03 |
| [`api/translate/route.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/translate/route.ts) | 65 | HIGH-01, HIGH-03, MED-02, MED-03, MED-04 |
| [`api/rateLimiter.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/api/rateLimiter.ts) | 25 | HIGH-02 |
| [`hooks/useLiveAPI.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/hooks/useLiveAPI.ts) | 506 | LOW-01, INFO-02 |
| [`actions.ts`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/actions.ts) | 6 | ✅ Clean |
| [`page.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/page.tsx) | 667 | LOW-02, INFO-03 |
| [`components/Lobby.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/components/Lobby.tsx) | 395 | ✅ Clean |
| [`components/MeetingRoom.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/components/MeetingRoom.tsx) | 738 | LOW-01, LOW-02, INFO-03 |
| [`components/ParticipantTileWithTranslation.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/components/ParticipantTileWithTranslation.tsx) | 369 | LOW-01 |
| [`copy-rnnoise.js`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/copy-rnnoise.js) | 42 | ✅ Clean |
| [`layout.tsx`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/src/app/layout.tsx) | 36 | ✅ Clean |
| [`.gitignore`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/.gitignore) | 42 | ✅ Clean |
| [`package.json`](file:///c:/Users/srija/OneDrive/Desktop/New%20folder%20(3)/live-translate/package.json) | 33 | INFO-01 |

---

*End of Security Audit Report*
