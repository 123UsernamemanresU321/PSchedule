import { z } from "zod";

import { createAiRoute } from "./_shared";

import { assertAiRuntimeConfig } from "../../src/lib/ai/auth";
import { aiWhatIfChangeSchema, aiWhatIfRequestSchema, aiWhatIfResponseSchema } from "../../src/lib/ai/contracts";
import { callDeepSeekJson } from "../../src/lib/ai/deepseek";
import { buildWhatIfContext } from "../../src/lib/ai/context";
import { buildWhatIfInterpreterPrompt, buildWhatIfSummaryPrompt } from "../../src/lib/ai/prompts";
import { simulateWhatIf } from "../../src/lib/ai/what-if";
import type { PlannerExportPayload } from "../../src/lib/types/planner";

const parsedWhatIfChangesSchema = z.object({
  supported: z.boolean(),
  notes: z.array(z.string()).default([]),
  changes: z.array(aiWhatIfChangeSchema).default([]),
});

const whatIfSummarySchema = z.object({
  summary: z.string(),
  recommendedTradeoffs: z.array(z.string()).max(5).default([]),
  deterministicNotes: z.array(z.string()).max(5).default([]),
});

export default createAiRoute({
  method: "POST",
  authRequired: true,
  requestSchema: aiWhatIfRequestSchema,
  responseSchema: aiWhatIfResponseSchema,
  handler: async ({ body }) => {
    const config = assertAiRuntimeConfig();
    const snapshot = body.snapshot as PlannerExportPayload;
    const interpretationPrompt = buildWhatIfInterpreterPrompt({
      scenario: body.scenario,
      context: buildWhatIfContext({
        scenario: body.scenario,
        snapshot,
        currentWeekStart: body.currentWeekStart,
      }),
    });
    const parsedScenario = await callDeepSeekJson({
      model: config.fastModel,
      schema: parsedWhatIfChangesSchema,
      system: interpretationPrompt.system,
      user: interpretationPrompt.user,
      temperature: 0.1,
    });

    if (!parsedScenario.supported || parsedScenario.changes.length === 0) {
      return {
        summary: "This scenario could not be converted into a supported deterministic simulation yet.",
        supported: false,
        parsedChanges: [],
        deterministicNotes: parsedScenario.notes,
        recommendedTradeoffs: [],
        impacts: [],
        coverage: {
          beforeFillableGap: false,
          afterFillableGap: false,
          beforeHardCoverageFailures: [],
          afterHardCoverageFailures: [],
        },
      };
    }

    const simulation = simulateWhatIf({
      snapshot,
      changes: parsedScenario.changes,
      currentWeekStart: body.currentWeekStart,
    });
    const fallbackSummary = {
      summary: `Simulated ${parsedScenario.changes.length} hypothetical change(s) against a copied planner snapshot.`,
      recommendedTradeoffs: [],
      deterministicNotes: parsedScenario.notes,
    };

    const summaryPrompt = buildWhatIfSummaryPrompt({
      scenario: body.scenario,
      parsedChanges: simulation.parsedChanges,
      impacts: simulation.impacts,
      coverage: {
        beforeFillableGap: simulation.beforeGap.hasGap,
        afterFillableGap: simulation.afterGap.hasGap,
        beforeHardCoverageFailures: simulation.beforeHardCoverageFailures,
        afterHardCoverageFailures: simulation.afterHardCoverageFailures,
      },
    });

    const summarized = await callDeepSeekJson({
      model: config.reviewModel,
      schema: whatIfSummarySchema,
      system: summaryPrompt.system,
      user: summaryPrompt.user,
      temperature: 0.2,
    }).catch(() => fallbackSummary);

    return {
      summary: summarized.summary,
      supported: true,
      parsedChanges: simulation.parsedChanges,
      deterministicNotes: Array.from(
        new Set([...parsedScenario.notes, ...summarized.deterministicNotes]),
      ),
      recommendedTradeoffs: summarized.recommendedTradeoffs,
      impacts: simulation.impacts,
      coverage: {
        beforeFillableGap: simulation.beforeGap.hasGap,
        afterFillableGap: simulation.afterGap.hasGap,
        beforeHardCoverageFailures: simulation.beforeHardCoverageFailures,
        afterHardCoverageFailures: simulation.afterHardCoverageFailures,
      },
    };
  },
});
