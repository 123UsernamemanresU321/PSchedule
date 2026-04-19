import { createAiRoute, AiHttpError } from "./_shared";

import { assertAiRuntimeConfig, issueAiSessionToken, passwordMatches } from "../../src/lib/ai/auth";
import { aiSessionRequestSchema, aiSessionResponseSchema } from "../../src/lib/ai/contracts";

export default createAiRoute({
  method: "POST",
  requestSchema: aiSessionRequestSchema,
  responseSchema: aiSessionResponseSchema,
  handler: async ({ body }) => {
    if (!passwordMatches(body.password)) {
      throw new AiHttpError(401, "Incorrect AI access password.");
    }

    const config = assertAiRuntimeConfig();
    return issueAiSessionToken(config.sessionSecret);
  },
});
