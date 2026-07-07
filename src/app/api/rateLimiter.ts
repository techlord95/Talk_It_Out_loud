/**
 * In-memory rate limiter with TTL-based eviction and bounded size.
 *
 * Improvements over original:
 * - Periodic TTL cleanup prevents unbounded memory growth (HIGH-02)
 * - Hard cap on entries prevents OOM under sustained attack (HIGH-02)
 * - getClientIp() uses x-real-ip over spoofable x-forwarded-for (HIGH-01)
 *
 * NOTE: For production multi-instance or serverless deployments, replace
 * this with a distributed store (Redis / Upstash / Cloudflare KV).
 */

const MAX_ENTRIES = 10_000;
const CLEANUP_INTERVAL_MS = 60_000; // Run cleanup at most once per minute

const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
let lastCleanup = Date.now();

/**
 * Evicts stale entries whose window has long expired.
 * Called lazily on each rate-limit check, throttled to once per minute.
 */
function cleanup(windowMs: number): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, record] of rateLimitMap) {
    // Evict entries whose window expired more than 2× ago
    if (now - record.lastReset > windowMs * 2) {
      rateLimitMap.delete(key);
    }
  }
}

/**
 * Checks if a given identifier (e.g. IP address) exceeds the allowed rate limit.
 * @param id    Unique identifier (IP address)
 * @param limit Maximum allowed requests within the time window
 * @param windowMs Time window in milliseconds
 * @returns true if rate limited, false otherwise
 */
export function checkRateLimit(id: string, limit: number, windowMs: number): boolean {
  cleanup(windowMs);

  // Hard cap: if the map is full and this is a new ID, deny by default
  // to prevent memory exhaustion under sustained distributed attack.
  if (rateLimitMap.size >= MAX_ENTRIES && !rateLimitMap.has(id)) {
    return true;
  }

  const now = Date.now();
  const record = rateLimitMap.get(id) || { count: 0, lastReset: now };

  if (now - record.lastReset > windowMs) {
    record.count = 1;
    record.lastReset = now;
    rateLimitMap.set(id, record);
    return false;
  }

  record.count++;
  rateLimitMap.set(id, record);
  return record.count > limit;
}

/**
 * Extracts the most trustworthy client IP from request headers.
 *
 * Priority:
 * 1. x-real-ip — typically set by a trusted reverse proxy (Nginx, Vercel, Cloudflare)
 * 2. x-forwarded-for — first (leftmost) entry only; the rest can be spoofed
 * 3. Fallback to a shared bucket ("0.0.0.0") if no header is present
 *
 * IMPORTANT: In production behind a known proxy, configure the platform to
 * set x-real-ip from the TCP socket address, then use only that header.
 */
export function getClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();

  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const firstIp = forwardedFor.split(",")[0]?.trim();
    if (firstIp) return firstIp;
  }

  return "0.0.0.0";
}
