import { createAiRoute } from "./_shared";

import { assertAiRuntimeConfig } from "../../src/lib/ai/auth";
import { aiParseEventRequestSchema, aiParseEventResponseSchema } from "../../src/lib/ai/contracts";
import { callDeepSeekJson } from "../../src/lib/ai/deepseek";
import { buildParseEventPrompt } from "../../src/lib/ai/prompts";

export default createAiRoute({
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
