import { NextRequest } from "next/server";
import { createAiRoute, buildCorsResponse } from "../_shared";

import { aiWhatIfRequestSchema, aiWhatIfResponseSchema } from "../../../../lib/ai/contracts";
import { aiRouteDynamicConfig } from "../_shared";

export const dynamic = aiRouteDynamicConfig;

const handler = createAiRoute({
  method: "POST",
  authRequired: true,
  requestSchema: aiWhatIfRequestSchema,
  responseSchema: aiWhatIfResponseSchema,
  handler: async () => {
    return {
      summary:
        "Deterministic what-if simulation is temporarily unavailable on the Vercel backend while the planner engine is being repackaged for serverless execution.",
      supported: false,
      parsedChanges: [],
      deterministicNotes: [
        "The frontend AI layer remains available for review, diagnosis, event parsing, block briefs, and proposed actions.",
      ],
      recommendedTradeoffs: [],
      impacts: [],
      coverage: {
        beforeFillableGap: false,
        afterFillableGap: false,
        beforeHardCoverageFailures: [],
        afterHardCoverageFailures: [],
      },
    };
  },
});

export const POST = handler;

export async function OPTIONS(req: NextRequest) {
  return buildCorsResponse(req);
}
