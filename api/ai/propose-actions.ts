import { createAiRoute } from "./_shared";

import { assertAiRuntimeConfig } from "../../src/lib/ai/auth";
import { aiProposeActionsRequestSchema, aiProposeActionsResponseSchema } from "../../src/lib/ai/contracts";
import { callDeepSeekJson } from "../../src/lib/ai/deepseek";
import { buildProposeActionsPrompt } from "../../src/lib/ai/prompts";

export default createAiRoute({
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
