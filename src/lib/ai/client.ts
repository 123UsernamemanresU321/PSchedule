import type { z } from "zod";

import {
  aiBlockPlanResponseSchema,
  aiBlockBriefResponseSchema,
  aiDiagnosisResponseSchema,
  aiParseEventResponseSchema,
  aiProposeActionsResponseSchema,
  aiReviewResponseSchema,
  aiSessionResponseSchema,
  aiStatusResponseSchema,
  aiWhatIfResponseSchema,
} from "@/lib/ai/contracts";

export class AiClientError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AiClientError";
    this.status = status;
  }
}

export function getAiBackendBaseUrl() {
  return (process.env.NEXT_PUBLIC_AI_BACKEND_URL ?? "").trim().replace(/\/$/, "");
}

function tryParseJson(rawBody: string) {
  if (!rawBody.trim()) {
    return null;
  }

  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    return null;
  }
}

function looksLikeHtml(rawBody: string, contentType: string | null) {
  if ((contentType ?? "").toLowerCase().includes("text/html")) {
    return true;
  }

  const trimmed = rawBody.trim().toLowerCase();
  return (
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html") ||
    trimmed.startsWith("<head") ||
    trimmed.startsWith("<body") ||
    trimmed.startsWith("<")
  );
}

async function postAiJson<T>(options: {
  path: string;
  body?: unknown;
  token?: string | null;
  schema: z.ZodType<T>;
  method?: "GET" | "POST";
}) {
  const baseUrl = getAiBackendBaseUrl();

  if (!baseUrl) {
    throw new AiClientError(
      "NEXT_PUBLIC_AI_BACKEND_URL is not configured. Add it to the GitHub Pages build environment.",
      500,
    );
  }

  const response = await fetch(`${baseUrl}${options.path}`, {
    method: options.method ?? "POST",
    headers: {
      Accept: "application/json",
      ...(options.method === "GET" ? {} : { "Content-Type": "application/json" }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
  });

  const rawBody = await response.text();
  const contentType = response.headers.get("content-type");
  const parsedBody = tryParseJson(rawBody);

  if (!parsedBody && looksLikeHtml(rawBody, contentType)) {
    throw new AiClientError(
      `AI backend returned HTML instead of JSON. Check NEXT_PUBLIC_AI_BACKEND_URL (${baseUrl}) and make sure it points to the Vercel backend, not GitHub Pages or a normal site route.`,
      response.status || 500,
    );
  }

  if (!parsedBody && rawBody.trim()) {
    throw new AiClientError(
      `AI backend returned a non-JSON response from ${baseUrl}${options.path}. Check the backend deployment and route wiring.`,
      response.status || 500,
    );
  }

  if (!response.ok) {
    throw new AiClientError(
      parsedBody && typeof parsedBody === "object" && "error" in parsedBody && typeof parsedBody.error === "string"
        ? parsedBody.error
        : "AI request failed.",
      response.status,
    );
  }

  return options.schema.parse(parsedBody);
}

export function fetchAiStatus() {
  return postAiJson({
    path: "/api/ai/status",
    method: "GET",
    schema: aiStatusResponseSchema,
  });
}

export function createAiSession(password: string) {
  return postAiJson({
    path: "/api/ai/session",
    body: { password },
    schema: aiSessionResponseSchema,
  });
}

export function fetchAiReview(token: string, body: unknown) {
  return postAiJson({
    path: "/api/ai/review",
    body,
    token,
    schema: aiReviewResponseSchema,
  });
}

export function fetchAiDiagnosis(token: string, body: unknown) {
  return postAiJson({
    path: "/api/ai/diagnose",
    body,
    token,
    schema: aiDiagnosisResponseSchema,
  });
}

export function fetchAiParseEvent(token: string, body: unknown) {
  return postAiJson({
    path: "/api/ai/parse-event",
    body,
    token,
    schema: aiParseEventResponseSchema,
  });
}

export function fetchAiWhatIf(token: string, body: unknown) {
  return postAiJson({
    path: "/api/ai/what-if",
    body,
    token,
    schema: aiWhatIfResponseSchema,
  });
}

export function fetchAiBlockBrief(token: string, body: unknown) {
  return postAiJson({
    path: "/api/ai/block-brief",
    body,
    token,
    schema: aiBlockBriefResponseSchema,
  });
}

export function fetchAiBlockPlan(token: string, body: unknown) {
  return postAiJson({
    path: "/api/ai/block-plan",
    body,
    token,
    schema: aiBlockPlanResponseSchema,
  });
}

export function fetchAiProposedActions(token: string, body: unknown) {
  return postAiJson({
    path: "/api/ai/propose-actions",
    body,
    token,
    schema: aiProposeActionsResponseSchema,
  });
}
