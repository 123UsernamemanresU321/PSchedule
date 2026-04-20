import { NextRequest } from "next/server";
import { createAiRoute, buildCorsResponse } from "../_shared";

import { assertAiRuntimeConfig } from "../../../../lib/ai/auth";
import { aiParseEventRequestSchema, aiParseEventResponseSchema } from "../../../../lib/ai/contracts";
import { callDeepSeekJson } from "../../../../lib/ai/deepseek";
import { buildParseEventPrompt } from "../../../../lib/ai/prompts";

export const dynamic = process.env.NEXT_OUTPUT_MODE === "pages" ? "force-static" : "force-dynamic";

const handler = createAiRoute({
  method: "POST",
  authRequired: true,
  requestSchema: aiParseEventRequestSchema,
  responseSchema: aiParseEventResponseSchema,
  handler: async ({ body }) => {
    const config = assertAiRuntimeConfig();
    const prompt = buildParseEventPrompt({
      text: body.text,
      context: body.context,
    });

    return callDeepSeekJson({
      model: config.fastModel,
      schema: aiParseEventResponseSchema,
      system: prompt.system,
      user: prompt.user,
      temperature: 0.1,
    });
  },
});

export const POST = handler;

export async function OPTIONS(req: NextRequest) {
  return buildCorsResponse(req);
}
