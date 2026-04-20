import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { buildAiCorsHeaders, resolveAiCorsOrigin } from "../../../lib/ai/cors";
import { assertAiRuntimeConfig, type AiSessionTokenPayload, verifyAiSessionToken } from "../../../lib/ai/auth";

export const aiRouteDynamicConfig =
  process.env.NEXT_OUTPUT_MODE === "pages" ? "force-static" : "force-dynamic";

export class AiHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AiHttpError";
    this.status = status;
  }
}

function getBearerToken(req: Request) {
  const authorization = req.headers.get("authorization");

  if (!authorization || !authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authorization.slice("bearer ".length).trim();
}

function authorizeRequest(req: Request): AiSessionTokenPayload {
  const config = assertAiRuntimeConfig();
  const token = getBearerToken(req);

  if (!token) {
    throw new AiHttpError(401, "Missing AI session token.");
  }

  const payload = verifyAiSessionToken(token, config.sessionSecret);

  if (!payload) {
    throw new AiHttpError(401, "Invalid or expired AI session token.");
  }

  return payload;
}

export function buildCorsResponse(req: Request, status = 204) {
  const requestOrigin = req.headers.get("origin");
  const allowedOrigin = resolveAiCorsOrigin(requestOrigin);
  const corsHeaders = buildAiCorsHeaders(allowedOrigin);

  return new NextResponse(null, {
    status,
    headers: corsHeaders,
  });
}

function sendJsonResponse(
  body: unknown,
  status: number,
  headers: Record<string, string>,
) {
  return NextResponse.json(body, {
    status,
    headers: {
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function createAiRoute<TRequest, TResponse>(options: {
  method: "GET" | "POST";
  authRequired?: boolean;
  requestSchema?: z.ZodType<TRequest>;
  responseSchema: z.ZodType<TResponse>;
  handler: (input: {
    body: TRequest;
    auth: AiSessionTokenPayload | null;
  }) => Promise<TResponse>;
}) {
  return async function handler(req: NextRequest) {
    const requestOrigin = req.headers.get("origin");
    const allowedOrigin = resolveAiCorsOrigin(requestOrigin);
    const corsHeaders = buildAiCorsHeaders(allowedOrigin);

    if (req.method !== options.method) {
      return sendJsonResponse({ error: "Method not allowed." }, 405, corsHeaders);
    }

    try {
      const auth = options.authRequired ? authorizeRequest(req) : null;
      
      let body = {} as TRequest;
      if (options.method === "POST" && options.requestSchema) {
        try {
          const rawBody = await req.json();
          body = options.requestSchema.parse(rawBody);
        } catch (error) {
          if (error instanceof z.ZodError) {
            throw new AiHttpError(400, error.issues.map((issue) => issue.message).join("; "));
          }
          throw new AiHttpError(400, "Invalid JSON body.");
        }
      }

      const response = await options.handler({ body, auth });
      return sendJsonResponse(options.responseSchema.parse(response), 200, corsHeaders);
    } catch (error) {
      if (error instanceof AiHttpError) {
        return sendJsonResponse({ error: error.message }, error.status, corsHeaders);
      }

      if (error instanceof z.ZodError) {
        return sendJsonResponse(
          { error: error.issues.map((issue) => issue.message).join("; ") },
          400,
          corsHeaders,
        );
      }

      console.error("[AI API Error]:", error);
      return sendJsonResponse(
        {
          error: error instanceof Error ? error.message : "Unexpected AI backend error.",
        },
        500,
        corsHeaders,
      );
    }
  };
}
