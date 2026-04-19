import type { z } from "zod";

import {
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
      ...(options.method === "GET" ? {} : { "Content-Type": "application/json" }),
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.method === "GET" ? undefined : JSON.stringify(options.body ?? {}),
  });

  const rawBody = await response.text();
  const parsedBody = rawBody ? JSON.parse(rawBody) : null;

  if (!response.ok) {
    throw new AiClientError(
      typeof parsedBody?.error === "string" ? parsedBody.error : "AI request failed.",
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

export function fetchAiProposedActions(token: string, body: unknown) {
  return postAiJson({
    path: "/api/ai/propose-actions",
    body,
    token,
    schema: aiProposeActionsResponseSchema,
  });
}
