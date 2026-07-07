import { NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { checkRateLimit, getClientIp } from "../../rateLimiter";

/**
 * LiveKit Token Endpoint — POST /api/livekit/token
 *
 * Security changes from original:
 * - Changed from GET to POST so credentials (room/username) are not
 *   logged in browser history, server access logs, or Referer headers (CRIT-03)
 * - Uses getClientIp() for reliable IP extraction (HIGH-01)
 * - Origin validation handled by src/proxy.ts (MED-03)
 *
 * NOTE: This endpoint currently has no user authentication. For production,
 * add session validation (e.g. NextAuth.js) or a room-level passcode before
 * issuing tokens. The rate limiter and input validation provide baseline
 * abuse prevention only.
 */
export async function POST(request: Request) {
  try {
    // 1. Rate Limit Check (20 requests per minute per IP)
    const clientIp = getClientIp(request);
    if (checkRateLimit(clientIp, 20, 60000)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // 2. Parse and validate request body (POST body, not query params)
    let body: { room?: string; username?: string };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid request body." },
        { status: 400 }
      );
    }

    const { room, username } = body;

    if (!room || typeof room !== "string" || room.trim() === "") {
      return NextResponse.json(
        { error: "Field 'room' is required and must be a valid string." },
        { status: 400 }
      );
    }
    if (!username || typeof username !== "string" || username.trim() === "") {
      return NextResponse.json(
        { error: "Field 'username' is required and must be a valid string." },
        { status: 400 }
      );
    }

    const sanitizedRoom = room.trim();
    const sanitizedUsername = username.trim();

    // 3. Strict alphanumeric, dash, and underscore validation with length constraint
    const safeStringRegex = /^[a-zA-Z0-9_-]+$/;
    if (!safeStringRegex.test(sanitizedRoom) || sanitizedRoom.length > 64) {
      return NextResponse.json(
        { error: "Invalid 'room' format. Max 64 alphanumeric characters, dashes, or underscores allowed." },
        { status: 400 }
      );
    }
    if (!safeStringRegex.test(sanitizedUsername) || sanitizedUsername.length > 64) {
      return NextResponse.json(
        { error: "Invalid 'username' format. Max 64 alphanumeric characters, dashes, or underscores allowed." },
        { status: 400 }
      );
    }

    // 4. Validate environment credentials
    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;

    if (!apiKey || !apiSecret) {
      console.error("[LiveKit Token API] Missing LIVEKIT_API_KEY or LIVEKIT_API_SECRET environment variables.");
      return NextResponse.json(
        { error: "An unexpected server-side error occurred while generating the room token." },
        { status: 500 }
      );
    }

    // 5. Construct Access Token with ephemeral expiry (5 minutes / 300 seconds)
    const at = new AccessToken(apiKey, apiSecret, {
      identity: sanitizedUsername,
      ttl: 300, // Ephemeral limit to mitigate replay attacks
    });

    // 6. Attach grants
    at.addGrant({
      roomJoin: true,
      room: sanitizedRoom,
      canPublish: true,
      canSubscribe: true,
    });

    // 7. Generate token (async)
    const token = await at.toJwt();

    return NextResponse.json({ token });
  } catch (error: any) {
    console.error("[LiveKit Token API Error]:", error);
    // Generic error — never expose internal details to the client
    return NextResponse.json(
      { error: "An unexpected server-side error occurred while generating the room token." },
      { status: 500 }
    );
  }
}
