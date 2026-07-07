"use server";

export async function hasGeminiApiKey() {
  return !!process.env.GEMINI_API_KEY;
}
