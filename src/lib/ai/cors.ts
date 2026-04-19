import { assertAiRuntimeConfig } from "@/lib/ai/auth";

const LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

export function resolveAiCorsOrigin(origin: string | null | undefined) {
  if (!origin) {
    return null;
  }

  const allowedOrigins = new Set(LOCAL_DEV_ORIGINS);

  try {
    const config = assertAiRuntimeConfig();
    allowedOrigins.add(config.allowedOrigin);
  } catch {
    // Ignore missing config here so status/session failures can still return a structured error.
  }

  return allowedOrigins.has(origin) ? origin : null;
}

export function buildAiCorsHeaders(origin: string | null | undefined) {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };

  if (origin) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}
