import { createAiRoute } from "./_shared";

import { getAiRuntimeConfigState } from "../../src/lib/ai/auth";
import { aiStatusResponseSchema } from "../../src/lib/ai/contracts";

export default createAiRoute({
  method: "GET",
  responseSchema: aiStatusResponseSchema,
  handler: async () => {
    const configState = getAiRuntimeConfigState();

    return {
      ok: true,
      configured: configState.configured,
      provider: "deepseek" as const,
      backendUrl: null,
      fastModel: configState.fastModel,
      reviewModel: configState.reviewModel,
    };
  },
});
