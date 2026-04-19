import { createAiRoute } from "./_shared";

import { assertAiRuntimeConfig } from "../../src/lib/ai/auth";
import { aiDiagnosisRequestSchema, aiDiagnosisResponseSchema } from "../../src/lib/ai/contracts";
import { callDeepSeekJson } from "../../src/lib/ai/deepseek";
import { buildDiagnosisPrompt } from "../../src/lib/ai/prompts";

export default createAiRoute({
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
