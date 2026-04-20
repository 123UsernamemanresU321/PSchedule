import { NextRequest } from "next/server";
import { createAiRoute, buildCorsResponse } from "../_shared";

import { assertAiRuntimeConfig } from "../../../../lib/ai/auth";
import { aiBlockBriefRequestSchema, aiBlockBriefResponseSchema } from "../../../../lib/ai/contracts";
import { callDeepSeekJson } from "../../../../lib/ai/deepseek";
import { buildBlockBriefPrompt } from "../../../../lib/ai/prompts";

export const dynamic = "force-dynamic";

const handler = createAiRoute({
  method: "POST",
  authRequired: true,
  requestSchema: aiBlockBriefRequestSchema,
  responseSchema: aiBlockBriefResponseSchema,
  handler: async ({ body }) => {
    const config = assertAiRuntimeConfig();
    const prompt = buildBlockBriefPrompt(body.context);

    return callDeepSeekJson({
      model: config.fastModel,
      schema: aiBlockBriefResponseSchema,
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
