import { createAiRoute } from "./_shared";

import { assertAiRuntimeConfig } from "../../src/lib/ai/auth";
import { aiBlockBriefRequestSchema, aiBlockBriefResponseSchema } from "../../src/lib/ai/contracts";
import { callDeepSeekJson } from "../../src/lib/ai/deepseek";
import { buildBlockBriefPrompt } from "../../src/lib/ai/prompts";

export default createAiRoute({
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
