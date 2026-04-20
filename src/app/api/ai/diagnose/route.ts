import { NextRequest } from "next/server";
import { createAiRoute, buildCorsResponse } from "../_shared";

import { assertAiRuntimeConfig } from "../../../../lib/ai/auth";
import { aiDiagnosisRequestSchema, aiDiagnosisResponseSchema } from "../../../../lib/ai/contracts";
import { callDeepSeekJson } from "../../../../lib/ai/deepseek";
import { buildDiagnosisPrompt } from "../../../../lib/ai/prompts";

export const dynamic = "force-dynamic";

const handler = createAiRoute({
  method: "POST",
  authRequired: true,
  requestSchema: aiDiagnosisRequestSchema,
  responseSchema: aiDiagnosisResponseSchema,
  handler: async ({ body }) => {
    const config = assertAiRuntimeConfig();
    const prompt = buildDiagnosisPrompt(body.context);

    return callDeepSeekJson({
      model: config.reviewModel,
      schema: aiDiagnosisResponseSchema,
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
