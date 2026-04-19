const LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

function getConfiguredAllowedOrigin() {
  return (process.env.AI_ALLOWED_ORIGIN ?? "").trim();
}

export function resolveAiCorsOrigin(origin: string | null | undefined) {
  if (!origin) {
    return null;
  }

  const allowedOrigins = new Set(LOCAL_DEV_ORIGINS);
  const configuredOrigin = getConfiguredAllowedOrigin();

  if (configuredOrigin) {
    allowedOrigins.add(configuredOrigin);
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