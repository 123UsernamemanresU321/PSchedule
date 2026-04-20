import type { IncomingMessage, ServerResponse } from "node:http";

export const config = {
  runtime: "nodejs",
};

const LOCAL_DEV_ORIGINS = new Set(["http://localhost:3000", "http://127.0.0.1:3000"]);

function getHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }

  return value ?? "";
}

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

function resolveAllowedOrigin(requestOrigin: string | null) {
  const normalizedRequestOrigin = normalizeOrigin(requestOrigin);

  if (!normalizedRequestOrigin) {
    return null;
  }

  if (LOCAL_DEV_ORIGINS.has(normalizedRequestOrigin)) {
    return normalizedRequestOrigin;
  }

  const configuredOrigins = (process.env.AI_ALLOWED_ORIGIN ?? "")
    .split(/[\s,]+/)
    .map((value) => normalizeOrigin(value))
    .filter((value): value is string => !!value);

  return configuredOrigins.includes(normalizedRequestOrigin) ? normalizedRequestOrigin : null;
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  body: unknown,
  allowedOrigin: string | null,
) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");

  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
  }

  res.end(JSON.stringify(body));
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const requestOrigin = getHeaderValue(req.headers.origin) || null;
  const allowedOrigin = resolveAllowedOrigin(requestOrigin);

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
    res.setHeader("Access-Control-Max-Age", "86400");
    res.setHeader("Vary", "Origin");
    if (allowedOrigin) {
      res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    }
    res.end();
    return;
  }

  if (requestOrigin && !allowedOrigin) {
    sendJson(res, 403, { error: "Origin not allowed." }, null);
    return;
  }

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed." }, allowedOrigin);
    return;
  }

  sendJson(
    res,
    200,
    {
      ok: true,
      configured:
        !!(process.env.DEEPSEEK_API_KEY ?? "").trim() &&
        !!(process.env.AI_ACCESS_PASSWORD ?? "").trim() &&
        !!(process.env.AI_SESSION_SECRET ?? "").trim() &&
        !!(process.env.AI_ALLOWED_ORIGIN ?? "").trim(),
      provider: "deepseek",
      backendUrl: null,
      fastModel: (process.env.DEEPSEEK_MODEL_FAST ?? "deepseek-chat").trim(),
      reviewModel: (process.env.DEEPSEEK_MODEL_REVIEW ?? "deepseek-reasoner").trim(),
    },
    allowedOrigin,
  );
}
