const LOCAL_DEV_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"];

function normalizeOrigin(value: string | null | undefined) {
  const trimmed = (value ?? "").trim().replace(/^['"]|['"]$/g, "");

  if (!trimmed) {
    return null;
  }

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, "");
  }
}

function splitConfiguredOrigins(value: string | null | undefined) {
  return (value ?? "")
    .split(/[\s,]+/)
    .map((entry) => normalizeOrigin(entry))
    .filter((entry): entry is string => !!entry);
}

function getAllowedOriginSet() {
  return new Set([
    ...LOCAL_DEV_ORIGINS.map((value) => normalizeOrigin(value) ?? value),
    ...splitConfiguredOrigins(process.env.AI_ALLOWED_ORIGIN),
    ...splitConfiguredOrigins(process.env.AI_ALLOWED_ORIGINS),
  ]);
}

export function resolveAiCorsOrigin(origin: string | null | undefined) {
  const normalizedRequestOrigin = normalizeOrigin(origin);

  if (!normalizedRequestOrigin) {
    return null;
  }

  if (getAllowedOriginSet().has(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  return null;
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
