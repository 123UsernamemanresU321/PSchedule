import { NextRequest } from "next/server";
import { createAiRoute, buildCorsResponse } from "../_shared";

import { assertAiRuntimeConfig } from "../../../../lib/ai/auth";
import { aiBlockPlanRequestSchema, aiBlockPlanResponseSchema } from "../../../../lib/ai/contracts";
import { callDeepSeekJson } from "../../../../lib/ai/deepseek";
import { buildBlockPlanPrompt } from "../../../../lib/ai/prompts";

export const dynamic = "force-dynamic";

const handler = createAiRoute({
  method: "POST",
  authRequired: true,
  requestSchema: aiBlockPlanRequestSchema,
  responseSchema: aiBlockPlanResponseSchema,
  handler: async ({ body }) => {
    const config = assertAiRuntimeConfig();
    const prompt = buildBlockPlanPrompt(body.context);

    return callDeepSeekJson({
      model: config.reviewModel,
      schema: aiBlockPlanResponseSchema,
      system: prompt.system,
      user: prompt.user,
      temperature: 0.15,
    });
  },
});

export const POST = handler;

export async function OPTIONS(req: NextRequest) {
  return buildCorsResponse(req);
}
