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

export function resolveAiCorsOrigin(origin: string | null | undefined) {
  const normalizedRequestOrigin = normalizeOrigin(origin);

  if (!normalizedRequestOrigin) {
    return null;
  }

  const localOriginSet = new Set(LOCAL_DEV_ORIGINS.map((value) => normalizeOrigin(value) ?? value));
  if (localOriginSet.has(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  return normalizedRequestOrigin;
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
