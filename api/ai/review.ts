import { createAiRoute } from "./_shared";

import { assertAiRuntimeConfig } from "../../src/lib/ai/auth";
import { aiReviewRequestSchema, aiReviewResponseSchema } from "../../src/lib/ai/contracts";
import { callDeepSeekJson } from "../../src/lib/ai/deepseek";
import { buildReviewPrompt } from "../../src/lib/ai/prompts";

export default createAiRoute({
  method: "POST",
  authRequired: true,
  requestSchema: aiReviewRequestSchema,
  responseSchema: aiReviewResponseSchema,
  handler: async ({ body }) => {
    const config = assertAiRuntimeConfig();
    const prompt = buildReviewPrompt(body.context);

    return callDeepSeekJson({
      model: config.reviewModel,
      schema: aiReviewResponseSchema,
      system: prompt.system,
      user: prompt.user,
      temperature: 0.2,
    });
  },
});
