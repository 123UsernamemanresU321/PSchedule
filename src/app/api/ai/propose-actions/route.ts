import { NextRequest } from "next/server";
import { createAiRoute, buildCorsResponse } from "../_shared";

import { assertAiRuntimeConfig } from "../../../../lib/ai/auth";
import { aiProposeActionsRequestSchema, aiProposeActionsResponseSchema } from "../../../../lib/ai/contracts";
import { callDeepSeekJson } from "../../../../lib/ai/deepseek";
import { buildProposeActionsPrompt } from "../../../../lib/ai/prompts";
import { aiRouteDynamicConfig } from "../_shared";

export const dynamic = aiRouteDynamicConfig;

const handler = createAiRoute({
  method: "POST",
  authRequired: true,
  requestSchema: aiProposeActionsRequestSchema,
  responseSchema: aiProposeActionsResponseSchema,
  handler: async ({ body }) => {
    const config = assertAiRuntimeConfig();
    const prompt = buildProposeActionsPrompt(body.context);

    return callDeepSeekJson({
      model: config.fastModel,
      schema: aiProposeActionsResponseSchema,
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
    });
  },
});

export const POST = handler;

export async function OPTIONS(req: NextRequest) {
  return buildCorsResponse(req);
}
