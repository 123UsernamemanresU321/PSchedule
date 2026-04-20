import { NextRequest } from "next/server";
import { createAiRoute, buildCorsResponse } from "../_shared";

import { assertAiRuntimeConfig, issueAiSessionToken, passwordMatches } from "../../../../lib/ai/auth";
import { aiSessionRequestSchema, aiSessionResponseSchema } from "../../../../lib/ai/contracts";
import { AiHttpError, aiRouteDynamicConfig } from "../_shared";

export const dynamic = aiRouteDynamicConfig;

const handler = createAiRoute({
  method: "POST",
  requestSchema: aiSessionRequestSchema,
  responseSchema: aiSessionResponseSchema,
  handler: async ({ body }) => {
    if (!passwordMatches(body.password)) {
      throw new AiHttpError(401, "Incorrect AI access password.");
    }

    const config = assertAiRuntimeConfig();
    return issueAiSessionToken(config.sessionSecret);
  },
});

export const POST = handler;

export async function OPTIONS(req: NextRequest) {
  return buildCorsResponse(req);
}
