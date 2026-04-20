const LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function getConfiguredAllowedOrigins() {
  return (process.env.AI_ALLOWED_ORIGIN ?? "")
    .split(/[\s,]+/)
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => !!value);
}

export function resolveAiCorsOrigin(origin: string | null | undefined) {
  const normalizedRequestOrigin = normalizeOrigin(origin);

  if (!normalizedRequestOrigin) {
    return null;
  }

  const allowedOrigins = new Set(LOCAL_DEV_ORIGINS.map((value) => normalizeOrigin(value) ?? value));

  for (const configuredOrigin of getConfiguredAllowedOrigins()) {
    allowedOrigins.add(configuredOrigin);
  }

  return allowedOrigins.has(normalizedRequestOrigin) ? normalizedRequestOrigin : null;
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
