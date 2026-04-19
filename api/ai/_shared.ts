import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import { buildAiCorsHeaders, resolveAiCorsOrigin } from "../../src/lib/ai/cors";
import { assertAiRuntimeConfig, type AiSessionTokenPayload, verifyAiSessionToken } from "../../src/lib/ai/auth";

export class AiHttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AiHttpError";
    this.status = status;
  }
}

function getHeaderValue(header: string | string[] | undefined) {
  if (Array.isArray(header)) {
    return header[0] ?? "";
  }

  return header ?? "";
}

async function readRequestBody(req: IncomingMessage, maxBytes = 200_000) {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxBytes) {
      throw new AiHttpError(413, "Request body is too large.");
    }
    chunks.push(buffer);
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody<T>(req: IncomingMessage, schema: z.ZodType<T>) {
  const raw = await readRequestBody(req);

  if (!raw.trim()) {
    return schema.parse({});
  }

  try {
    return schema.parse(JSON.parse(raw));
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AiHttpError(400, error.issues.map((issue) => issue.message).join("; "));
    }

    throw new AiHttpError(400, "Invalid JSON body.");
  }
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string>,
) {
  res.statusCode = status;
  Object.entries(headers).forEach(([key, value]) => {
    res.setHeader(key, value);
  });
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function getBearerToken(req: IncomingMessage) {
  const authorization = getHeaderValue(req.headers.authorization);

  if (!authorization.toLowerCase().startsWith("bearer ")) {
    return null;
  }

  return authorization.slice("bearer ".length).trim();
}

function authorizeRequest(req: IncomingMessage): AiSessionTokenPayload {
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
  return async function handler(req: IncomingMessage, res: ServerResponse) {
    const requestOrigin = getHeaderValue(req.headers.origin) || null;
    const allowedOrigin = resolveAiCorsOrigin(requestOrigin);
    const corsHeaders = buildAiCorsHeaders(allowedOrigin);

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
      res.end();
      return;
    }

    if (requestOrigin && !allowedOrigin) {
      sendJson(res, 403, { error: "Origin not allowed." }, corsHeaders);
      return;
    }

    if (req.method !== options.method) {
      sendJson(res, 405, { error: "Method not allowed." }, corsHeaders);
      return;
    }

    try {
      const auth = options.authRequired ? authorizeRequest(req) : null;
      const body = options.requestSchema
        ? await readJsonBody(req, options.requestSchema)
        : ({} as TRequest);
      const response = await options.handler({ body, auth });
      sendJson(res, 200, options.responseSchema.parse(response), corsHeaders);
    } catch (error) {
      if (error instanceof AiHttpError) {
        sendJson(res, error.status, { error: error.message }, corsHeaders);
        return;
      }

      if (error instanceof z.ZodError) {
        sendJson(
          res,
          400,
          { error: error.issues.map((issue) => issue.message).join("; ") },
          corsHeaders,
        );
        return;
      }

      sendJson(
        res,
        500,
        {
          error: error instanceof Error ? error.message : "Unexpected AI backend error.",
        },
        corsHeaders,
      );
    }
  };
}
