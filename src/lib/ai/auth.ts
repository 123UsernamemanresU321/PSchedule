import { createHmac, timingSafeEqual } from "node:crypto";

const AI_SESSION_TTL_MS = 1000 * 60 * 60 * 12;

export interface AiRuntimeConfig {
  apiKey: string;
  accessPassword: string;
  sessionSecret: string;
  allowedOrigin: string;
  fastModel: string;
  reviewModel: string;
}

export interface AiSessionTokenPayload {
  scope: "planner-ai";
  iat: number;
  exp: number;
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function readEnv() {
  return {
    apiKey: (process.env.DEEPSEEK_API_KEY ?? "").trim(),
    accessPassword: (process.env.AI_ACCESS_PASSWORD ?? "").trim(),
    sessionSecret: (process.env.AI_SESSION_SECRET ?? "").trim(),
    allowedOrigin: (process.env.AI_ALLOWED_ORIGIN ?? "").trim(),
    fastModel: (process.env.DEEPSEEK_MODEL_FAST ?? "deepseek-chat").trim(),
    reviewModel: (process.env.DEEPSEEK_MODEL_REVIEW ?? "deepseek-reasoner").trim(),
  };
}

export function getAiRuntimeConfigState() {
  const env = readEnv();

  return {
    configured:
      !!env.apiKey &&
      !!env.accessPassword &&
      !!env.sessionSecret &&
      !!env.allowedOrigin,
    fastModel: env.fastModel,
    reviewModel: env.reviewModel,
    allowedOrigin: env.allowedOrigin || null,
  };
}

export function assertAiRuntimeConfig(): AiRuntimeConfig {
  const env = readEnv();

  if (!env.apiKey) {
    throw new Error("DEEPSEEK_API_KEY is not configured.");
  }

  if (!env.accessPassword) {
    throw new Error("AI_ACCESS_PASSWORD is not configured.");
  }

  if (!env.sessionSecret) {
    throw new Error("AI_SESSION_SECRET is not configured.");
  }

  if (!env.allowedOrigin) {
    throw new Error("AI_ALLOWED_ORIGIN is not configured.");
  }

  return {
    apiKey: env.apiKey,
    accessPassword: env.accessPassword,
    sessionSecret: env.sessionSecret,
    allowedOrigin: env.allowedOrigin,
    fastModel: env.fastModel,
    reviewModel: env.reviewModel,
  };
}

export function passwordMatches(value: string) {
  const config = assertAiRuntimeConfig();
  const received = Buffer.from(value, "utf8");
  const expected = Buffer.from(config.accessPassword, "utf8");

  if (received.length !== expected.length) {
    return false;
  }

  return timingSafeEqual(received, expected);
}

export function issueAiSessionToken(secret: string, ttlMs = AI_SESSION_TTL_MS) {
  const now = Date.now();
  const payload: AiSessionTokenPayload = {
    scope: "planner-ai",
    iat: now,
    exp: now + ttlMs,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = sign(encodedPayload, secret);

  return {
    token: `v1.${encodedPayload}.${signature}`,
    expiresAt: new Date(payload.exp).toISOString(),
  };
}

export function verifyAiSessionToken(token: string, secret: string): AiSessionTokenPayload | null {
  const [version, encodedPayload, signature] = token.split(".");

  if (version !== "v1" || !encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload, secret);
  const expected = Buffer.from(expectedSignature, "utf8");
  const received = Buffer.from(signature, "utf8");

  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as AiSessionTokenPayload;
    if (payload.scope !== "planner-ai" || payload.exp <= Date.now()) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
