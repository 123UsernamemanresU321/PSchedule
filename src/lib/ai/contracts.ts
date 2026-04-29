import { z } from "zod";

export const aiConfidenceSchema = z.enum(["low", "medium", "high"]);
export const aiPrioritySchema = z.enum(["high", "medium", "low"]);

export const aiContextSchema = z.record(z.string(), z.unknown());

const aiSubjectIdSchema = z.enum([
  "physics-hl",
  "maths-aa-hl",
  "chemistry-hl",
  "olympiad",
  "cpp-book",
  "english-a-sl",
  "french-b-sl",
  "geography-transition",
]);

const aiFixedEventRecurrenceSchema = z.enum(["none", "weekly"]);
const aiFixedEventFlexibilitySchema = z.enum(["fixed", "movable", "optional"]);
const aiFixedEventCategorySchema = z.enum([
  "school",
  "activity",
  "lesson",
  "family",
  "assessment",
  "recovery",
  "admin",
]);

export const fixedEventDraftSchema = z.object({
  title: z.string(),
  start: z.string(),
  end: z.string(),
  isAllDay: z.boolean().optional().default(false),
  recurrence: aiFixedEventRecurrenceSchema,
  daysOfWeek: z.array(z.number().min(0).max(6)).optional(),
  repeatUntil: z.string().optional(),
  excludedDates: z.array(z.string()).optional(),
  flexibility: aiFixedEventFlexibilitySchema,
  category: aiFixedEventCategorySchema,
  notes: z.string().optional().default(""),
});

export const focusedDayDraftSchema = z.object({
  date: z.string(),
  subjectIds: z.array(aiSubjectIdSchema).min(1),
  notes: z.string().optional().default(""),
});

export const focusedWeekDraftSchema = z.object({
  weekStart: z.string(),
  subjectIds: z.array(aiSubjectIdSchema).min(1),
  notes: z.string().optional().default(""),
});

export const aiPlannerActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixed_event"),
    event: fixedEventDraftSchema,
  }),
  z.object({
    kind: z.literal("focused_day"),
    focusedDay: focusedDayDraftSchema,
  }),
  z.object({
    kind: z.literal("focused_week"),
    focusedWeek: focusedWeekDraftSchema,
  }),
]);

export const aiWhatIfChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("fixed_event_add"),
    event: fixedEventDraftSchema,
  }),
  z.object({
    kind: z.literal("focused_day_add"),
    focusedDay: focusedDayDraftSchema,
  }),
  z.object({
    kind: z.literal("focused_week_add"),
    focusedWeek: focusedWeekDraftSchema,
  }),
  z.object({
    kind: z.literal("reserved_commitment_rule_patch"),
    ruleId: z.string(),
    durationMinutes: z.number().min(0).optional(),
    preferredStart: z.string().optional(),
    days: z.array(z.number().min(0).max(6)).optional(),
  }),
  z.object({
    kind: z.literal("subject_weight_override"),
    subjectId: z.string(),
    weight: z.number().min(0),
  }),
  z.object({
    kind: z.literal("sick_day_add"),
    sickDay: z.object({
      startDate: z.string(),
      endDate: z.string(),
      severity: z.enum(["light", "moderate", "severe"]),
      notes: z.string().optional().default(""),
    }),
  }),
]);

export const aiStatusResponseSchema = z.object({
  ok: z.boolean(),
  configured: z.boolean(),
  provider: z.literal("deepseek"),
  backendUrl: z.string().nullable(),
  fastModel: z.string(),
  reviewModel: z.string(),
});

export const aiSessionRequestSchema = z.object({
  password: z.string().min(1),
});

export const aiSessionResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.string(),
});

export const aiReviewRequestSchema = z.object({
  context: aiContextSchema,
});

export const aiReviewResponseSchema = z.object({
  summary: z.string(),
  topPriorities: z.array(z.string()).max(3),
  biggestRisk: z.string(),
  smallestCorrectiveAction: z.string(),
  confidence: aiConfidenceSchema,
});

export const aiDiagnosisRequestSchema = z.object({
  context: aiContextSchema,
});

export const aiDiagnosisResponseSchema = z.object({
  summary: z.string(),
  rootCauses: z.array(z.string()).max(5),
  recommendedActions: z.array(z.string()).max(5),
  warnings: z.array(z.string()).max(5),
  confidence: aiConfidenceSchema,
});

export const aiParseEventRequestSchema = z.object({
  text: z.string().min(1),
  context: aiContextSchema,
});

export const aiParseEventResponseSchema = z.object({
  summary: z.string(),
  canApply: z.boolean(),
  confidence: aiConfidenceSchema,
  clarifyingQuestion: z.string().nullable().default(null),
  actions: z.array(aiPlannerActionSchema).max(4),
});

export const aiBlockBriefRequestSchema = z.object({
  context: aiContextSchema,
});

export const aiBlockBriefResponseSchema = z.object({
  goal: z.string(),
  likelyMistakePattern: z.string(),
  successCheck: z.string(),
  postBlockReflectionPrompt: z.string(),
});

export const aiBlockPlanRequestSchema = z.object({
  context: aiContextSchema,
});

export const aiBlockPlanStepSchema = z.object({
  title: z.string(),
  minutes: z.number().min(0),
  instructions: z.string(),
  successCheck: z.string(),
});

export const aiBlockPlanTimeBudgetItemSchema = z.object({
  label: z.string(),
  minutes: z.number().min(0),
  purpose: z.string(),
});

export const aiBlockPlanResponseSchema = z.object({
  lessonGoal: z.string(),
  minimumProgressTarget: z.string(),
  stretchProgressTarget: z.string(),
  timeBudget: z.array(aiBlockPlanTimeBudgetItemSchema).max(8),
  stepByStepPlan: z.array(aiBlockPlanStepSchema).max(10),
  guideFocus: z.array(z.string()).max(8),
  beforeAfterContextUsed: z.array(z.string()).max(8),
  successEvidence: z.array(z.string()).max(8),
  ifStuckFallback: z.string(),
  warnings: z.array(z.string()).max(6),
  confidence: aiConfidenceSchema,
});

export const aiProposalSchema = z.object({
  id: z.string(),
  label: z.string(),
  rationale: z.string(),
  priority: aiPrioritySchema,
  action: aiPlannerActionSchema,
});

export const aiProposeActionsRequestSchema = z.object({
  context: aiContextSchema,
});

export const aiProposeActionsResponseSchema = z.object({
  summary: z.string(),
  proposals: z.array(aiProposalSchema).max(4),
  warnings: z.array(z.string()).max(5),
});

export const aiWhatIfRequestSchema = z.object({
  scenario: z.string().min(1),
  snapshot: z.unknown(),
  currentWeekStart: z.string().optional(),
});

export const aiWhatIfImpactSchema = z.object({
  subjectId: z.string(),
  subjectLabel: z.string(),
  beforeStatus: z.string(),
  afterStatus: z.string(),
  beforeCompletionDate: z.string().nullable(),
  afterCompletionDate: z.string().nullable(),
  beforeUnscheduledHours: z.number(),
  afterUnscheduledHours: z.number(),
  beforeUnscheduledMinutes: z.number(),
  afterUnscheduledMinutes: z.number(),
});

export const aiWhatIfResponseSchema = z.object({
  summary: z.string(),
  supported: z.boolean(),
  parsedChanges: z.array(z.string()),
  deterministicNotes: z.array(z.string()),
  recommendedTradeoffs: z.array(z.string()).max(5),
  impacts: z.array(aiWhatIfImpactSchema),
  coverage: z.object({
    beforeFillableGap: z.boolean(),
    afterFillableGap: z.boolean(),
    beforeHardCoverageFailures: z.array(z.string()),
    afterHardCoverageFailures: z.array(z.string()),
  }),
});

export type AiPlannerAction = z.infer<typeof aiPlannerActionSchema>;
export type AiStatusResponse = z.infer<typeof aiStatusResponseSchema>;
export type AiSessionRequest = z.infer<typeof aiSessionRequestSchema>;
export type AiSessionResponse = z.infer<typeof aiSessionResponseSchema>;
export type AiReviewRequest = z.infer<typeof aiReviewRequestSchema>;
export type AiReviewResponse = z.infer<typeof aiReviewResponseSchema>;
export type AiDiagnosisRequest = z.infer<typeof aiDiagnosisRequestSchema>;
export type AiDiagnosisResponse = z.infer<typeof aiDiagnosisResponseSchema>;
export type AiParseEventRequest = z.infer<typeof aiParseEventRequestSchema>;
export type AiParseEventResponse = z.infer<typeof aiParseEventResponseSchema>;
export type AiBlockBriefRequest = z.infer<typeof aiBlockBriefRequestSchema>;
export type AiBlockBriefResponse = z.infer<typeof aiBlockBriefResponseSchema>;
export type AiBlockPlanRequest = z.infer<typeof aiBlockPlanRequestSchema>;
export type AiBlockPlanResponse = z.infer<typeof aiBlockPlanResponseSchema>;
export type AiProposeActionsRequest = z.infer<typeof aiProposeActionsRequestSchema>;
export type AiProposeActionsResponse = z.infer<typeof aiProposeActionsResponseSchema>;
export type AiWhatIfRequest = z.infer<typeof aiWhatIfRequestSchema>;
export type AiWhatIfResponse = z.infer<typeof aiWhatIfResponseSchema>;
export type AiWhatIfChange = z.infer<typeof aiWhatIfChangeSchema>;
