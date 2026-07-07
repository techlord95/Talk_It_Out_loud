import { NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import { checkRateLimit, getClientIp } from "../rateLimiter";

/**
 * Translate Endpoint — POST /api/translate
 *
 * Security changes from original:
 * - Uses getClientIp() for reliable IP extraction (HIGH-01)
 * - Returns generic error messages, never internal details (HIGH-03)
 * - Validates mimeType against an allowlist (MED-02)
 * - Checks Content-Length before parsing to prevent memory exhaustion (MED-04)
 * - Origin validation handled by src/proxy.ts (MED-03)
 */

const ALLOWED_MIME_TYPES = [
  "audio/pcm;rate=16000",
  "audio/pcm;rate=24000",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/mp3",
  "audio/mpeg",
];

export async function POST(request: Request) {
  try {
    // 1. Rate Limit Check (40 requests per minute per IP)
    const clientIp = getClientIp(request);
    if (checkRateLimit(clientIp, 40, 60000)) {
      return NextResponse.json(
        { success: false, error: "Too many requests. Please try again later." },
        { status: 429 }
      );
    }

    // 2. Check Content-Length header BEFORE parsing the body into memory (MED-04)
    //    This prevents an attacker from sending a 100 MB+ payload that would
    //    be fully buffered in memory before the base64 size check rejects it.
    const contentLength = request.headers.get("content-length");
    if (contentLength && parseInt(contentLength, 10) > 5 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "Request payload too large." },
        { status: 413 }
      );
    }

    const { base64Audio, targetLanguage, mimeType } = await request.json();

    // 3. Validate input format and payload size constraints
    if (!base64Audio || typeof base64Audio !== "string") {
      return NextResponse.json(
        { success: false, error: "Invalid or missing 'base64Audio' payload." },
        { status: 400 }
      );
    }
    // Limit max base64 size to 4MB (~3MB raw audio data) to prevent server/resource exhaustion
    if (base64Audio.length > 4 * 1024 * 1024) {
      return NextResponse.json(
        { success: false, error: "Audio payload size exceeds maximum limit of 3MB." },
        { status: 400 }
      );
    }

    if (!targetLanguage || typeof targetLanguage !== "string" || targetLanguage.length > 10) {
      return NextResponse.json(
        { success: false, error: "Invalid target language code." },
        { status: 400 }
      );
    }

    // 4. Validate mimeType against an allowlist (MED-02)
    //    Prevents attackers from passing arbitrary MIME types (e.g. text/html)
    //    that could confuse the Gemini model or exploit content processing.
    if (!mimeType || typeof mimeType !== "string" || !ALLOWED_MIME_TYPES.includes(mimeType)) {
      return NextResponse.json(
        { success: false, error: "Invalid or unsupported audio MIME type." },
        { status: 400 }
      );
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { success: false, error: "Translation service is not configured." },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          inlineData: {
            mimeType,
            data: base64Audio,
          },
        },
        `Translate the speech in this audio to ${targetLanguage}. Output ONLY the translated text. If there is no speech or only noise, return an empty string.`,
      ],
    });

    return NextResponse.json({ success: true, text: response.text || "" });
  } catch (error: any) {
    // Log the full error server-side for debugging
    console.error("Translation API error:", error);
    // Return a generic error message — never expose internal details (HIGH-03)
    return NextResponse.json(
      { success: false, error: "An internal error occurred during translation." },
      { status: 500 }
    );
  }
}
