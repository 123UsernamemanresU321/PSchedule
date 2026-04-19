import { z } from "zod";
import { createAiRoute } from "./_shared";
import { getAiRuntimeConfigState } from "../../src/lib/ai/auth";

const aiStatusResponseSchema = z.object({
  ok: z.boolean(),
  configured: z.boolean(),
  provider: z.literal("deepseek"),
  backendUrl: z.string().nullable(),
  fastModel: z.string(),
  reviewModel: z.string(),
});

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