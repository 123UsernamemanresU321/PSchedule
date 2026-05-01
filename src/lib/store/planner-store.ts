"use client";

import { create } from "zustand";

import { fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { calculateFreeSlots, expandFixedEventsForWeek } from "@/lib/scheduler/free-slots";
import {
  generateIncrementalStudyPlanTail,
  generateStudyPlanHorizon,
  shouldAlwaysPreserveStudyBlockOnRegeneration,
} from "@/lib/scheduler/generator";
import { replanStudyPlan } from "@/lib/scheduler/replanner";
import { createSlotSlice, selectBlockOption } from "@/lib/scheduler/slot-classifier";
import { getAssignableTaskCandidatesForBlock } from "@/lib/scheduler/task-candidates";
import {
  buildCollapsedCoverageRepairBaselineStudyBlocks,
  buildHardConstraintFutureResetBaselineStudyBlocks,
  deleteStudyBlocksByIds,
  deleteFixedEventById,
  deleteFocusedDayById as deleteFocusedDayRecordById,
  deleteFocusedWeekById as deleteFocusedWeekRecordById,
  deleteSickDayById as deleteSickDayRecordById,
  excludeFixedEventOccurrence,
  exportPlannerData,
  exportPlannerUserData,
  getCurrentWeekKey,
  importPlannerData,
  initializePlannerDatabase,
  loadPlannerSnapshot,
  markPlanningHorizonReady,
  markPlanningHorizonStale,
  regeneratePlanningHorizon,
  getCollapsedCoverageRepairState,
  getScopedReplanPrecheckState,
  repairCollapsedCoveragePlanningState,
  replacePlanningWeeks,
  replacePlanningHorizon,
  replaceWeeklyPlan,
  deleteCompletionLogsByStudyBlockId,
  saveCompletionLog,
  saveFixedEvent,
  saveFocusedDay as persistFocusedDay,
  saveFocusedWeek as persistFocusedWeek,
  savePreferences,
  saveSickDay as persistSickDay,
  updateStudyBlock,
  updateTopic,
} from "@/lib/storage/planner-repository";
import {
  buildOlympiadRewriteTitle,
  getOlympiadRewriteObligations,
  isOlympiadRewriteFollowUpBlock,
  isSeriousOlympiadAttemptBlock,
} from "@/lib/scheduler/olympiad-performance";
import type {
  CompletionLog,
  FixedEvent,
  FocusedDay,
  FocusedWeek,
  PlannerExportPayload,
  BackgroundReplanStatus,
  PlannerHorizonStatus,
  Preferences,
  PlannerReplanScope,
  ReplanDiagnostics,
  SickDay,
  StudyBlock,
  StudyBlockStatus,
  Topic,
  WeeklyPlan,
} from "@/lib/types/planner";
import { deriveTopicStatus } from "@/lib/topics/status";
import { createId } from "@/lib/utils";

interface PlannerState {
  initialized: boolean;
  loading: boolean;
  error: string | null;
  backgroundReplanStatus: BackgroundReplanStatus;
  backgroundReplanScope: PlannerReplanScope | null;
  backgroundReplanDiagnostics: ReplanDiagnostics | null;
  horizonStatus: PlannerHorizonStatus;
  horizonStatusMessage: string;
  lastHorizonGeneratedAt: string | null;
  currentWeekStart: string;
  goals: PlannerExportPayload["goals"];
  subjects: PlannerExportPayload["subjects"];
  topics: PlannerExportPayload["topics"];
  fixedEvents: PlannerExportPayload["fixedEvents"];
  sickDays: PlannerExportPayload["sickDays"];
  focusedDays: PlannerExportPayload["focusedDays"];
  focusedWeeks: PlannerExportPayload["focusedWeeks"];
  studyBlocks: PlannerExportPayload["studyBlocks"];
  completionLogs: PlannerExportPayload["completionLogs"];
  weeklyPlans: PlannerExportPayload["weeklyPlans"];
  preferences: Preferences | null;
  selectedStudyBlockId: string | null;
  initialize: () => Promise<void>;
  refresh: () => Promise<void>;
  setCurrentWeekStart: (weekStart: string) => void;
  regenerateHorizon: () => Promise<void>;
  saveFixedEvent: (event: FixedEvent) => Promise<void>;
  saveSickDay: (sickDay: SickDay) => Promise<void>;
  saveFocusedDay: (focusedDay: FocusedDay) => Promise<void>;
  saveFocusedWeek: (focusedWeek: FocusedWeek) => Promise<void>;
  deleteFixedEvent: (options: {
    id: string;
    scope?: "occurrence" | "series";
    occurrenceDate?: string;
  }) => Promise<void>;
  deleteSickDay: (id: string) => Promise<void>;
  deleteFocusedDay: (id: string) => Promise<void>;
  deleteFocusedWeek: (id: string) => Promise<void>;
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
  saveManualStudyBlock: (options: {
    start: string;
    end: string;
    topicId: string;
    notes?: string;
    status?: Extract<StudyBlockStatus, "done" | "partial">;
    actualMinutes?: number;
  }) => Promise<void>;
  editStudyBlockSchedule: (options: {
    blockId: string;
    start: string;
    end: string;
    topicId: string;
    notes?: string;
  }) => Promise<void>;
  updateTopicCompletedHours: (options: {
    topicId: string;
    completedHours: number;
  }) => Promise<void>;
  updateTopicCompletedHoursBatch: (
    updates: Array<{
      topicId: string;
      completedHours: number;
    }>,
  ) => Promise<void>;
  updateStudyBlockStatus: (options: {
    blockId: string;
    status: Extract<StudyBlockStatus, "planned" | "done" | "partial" | "missed" | "rescheduled">;
    actualMinutes?: number;
    notes?: string;
    perceivedDifficulty?: CompletionLog["perceivedDifficulty"];
  }) => Promise<void>;
  requestMorePractice: (options: {
    blockId: string;
    extraMinutes?: number;
    notes?: string;
  }) => Promise<void>;
  reassignStudyBlock: (options: {
    blockId: string;
    topicId: string;
    notes?: string;
  }) => Promise<void>;
  exportToJson: () => Promise<string>;
  exportUserDataToJson: () => Promise<string>;
  importFromJson: (rawJson: string) => Promise<void>;
  selectStudyBlock: (id: string | null) => void;
}

type PlannerReplanMutation =
  | "status_update"
  | "edit_study_block"
  | "reassign_study_block"
  | "request_more_practice"
  | "manual_block_current_week"
  | "manual_block_tail"
  | "topic_progress"
  | "focused_day"
  | "focused_week"
  | "sick_day"
  | "fixed_event"
  | "preferences"
  | "import"
  | "regenerate_horizon"
  | "collapsed_coverage_repair";

let backgroundReplanRequestId = 0;
let plannerMutationRevision = 0;

function bumpPlannerMutationRevision() {
  plannerMutationRevision += 1;
  return plannerMutationRevision;
}

function getPlannerMutationRevision() {
  return plannerMutationRevision;
}

export function getPlannerReplanScopeForMutation(
  mutation: PlannerReplanMutation,
): PlannerReplanScope {
  switch (mutation) {
    case "status_update":
    case "edit_study_block":
    case "reassign_study_block":
    case "request_more_practice":
    case "manual_block_current_week":
      return "week_local";
    case "topic_progress":
    case "focused_day":
    case "focused_week":
    case "sick_day":
    case "manual_block_tail":
      return "tail_from_week";
    case "fixed_event":
    case "preferences":
    case "import":
    case "regenerate_horizon":
    case "collapsed_coverage_repair":
      return "full_horizon";
    default:
      return "full_horizon";
  }
}

export function getEscalatedPlannerReplanScope(
  scope: PlannerReplanScope,
): PlannerReplanScope | null {
  switch (scope) {
    case "week_local":
      return "tail_from_week";
    case "tail_from_week":
      return "full_horizon";
    case "full_horizon":
      return null;
    default:
      return null;
  }
}

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function buildReplanDiagnostics(options: {
  scope: PlannerReplanScope;
  escalationPath: PlannerReplanScope[];
  replanStartedAtMs: number;
  scopeTimingsMs: Partial<Record<PlannerReplanScope, number>>;
  repairTriggered: boolean;
  hardCoverageEscalationForced: boolean;
  localApplyMs?: number | null;
  precheckMs?: number | null;
  writeMs?: number | null;
  snapshotLoadMs?: number | null;
  repairMs?: number | null;
  backgroundValidationMs?: number | null;
  escalationReason?: ReplanDiagnostics["escalationReason"];
}): ReplanDiagnostics {
  return {
    scope: options.scope,
    escalationPath: options.escalationPath,
    totalGenerationMs: Number((nowMs() - options.replanStartedAtMs).toFixed(1)),
    scopeTimingsMs: Object.fromEntries(
      Object.entries(options.scopeTimingsMs).map(([scope, value]) => [
        scope,
        Number((value ?? 0).toFixed(1)),
      ]),
    ) as ReplanDiagnostics["scopeTimingsMs"],
    repairTriggered: options.repairTriggered,
    hardCoverageEscalationForced: options.hardCoverageEscalationForced,
    localApplyMs: options.localApplyMs ?? null,
    precheckMs: options.precheckMs ?? null,
    writeMs: options.writeMs ?? null,
    snapshotLoadMs: options.snapshotLoadMs ?? null,
    repairMs: options.repairMs ?? null,
    backgroundValidationMs: options.backgroundValidationMs ?? null,
    escalationReason: options.escalationReason ?? null,
  };
}

function applyReplanDiagnostics(
  weeklyPlans: WeeklyPlan[],
  diagnostics: ReplanDiagnostics,
): WeeklyPlan[] {
  return weeklyPlans.map((weeklyPlan) => ({
    ...weeklyPlan,
    replanDiagnostics: diagnostics,
  }));
}

function collectScopedPreservedStudyBlockIds(options: {
  studyBlocks: StudyBlock[];
  referenceDate: Date;
  preservedStudyBlockIds?: string[];
}) {
  return Array.from(
    new Set([
      ...(options.preservedStudyBlockIds ?? []),
      ...options.studyBlocks
        .filter(
          (block) =>
            ["planned", "rescheduled"].includes(block.status) &&
            isStudyBlockActiveAt(block, options.referenceDate),
        )
        .map((block) => block.id),
    ]),
  );
}

function shouldUseWeekLocalReplan(blockStart: Date, referenceDate: Date) {
  return (
    toDateKey(startOfPlannerWeek(blockStart)) ===
    toDateKey(startOfPlannerWeek(referenceDate))
  );
}

async function replanPlannerState(options: {
  mutation: PlannerReplanMutation;
  scope?: PlannerReplanScope;
  affectedWeekStart?: Date;
  preservedStudyBlockIds?: string[];
  preserveFlexibleFutureBlocks?: boolean;
  aggressiveFutureReset?: boolean;
  replanStartedAtMs?: number;
  escalationPath?: PlannerReplanScope[];
  scopeTimingsMs?: Partial<Record<PlannerReplanScope, number>>;
  hardCoverageEscalationForced?: boolean;
  repairTriggered?: boolean;
  localApplyMs?: number | null;
  backgroundValidationMs?: number | null;
  expectedRevision?: number | null;
}) {
  const referenceDate = new Date();
  const shouldAbortForRevision = () =>
    options.expectedRevision != null && options.expectedRevision !== getPlannerMutationRevision();
  let snapshotLoadMs = 0;
  let precheckMs = 0;
  let repairMs = 0;
  let writeMs = 0;
  let escalationReason: ReplanDiagnostics["escalationReason"] = null;
  const snapshotLoadStartedAtMs = nowMs();
  let snapshot = await loadPlannerSnapshot();
  snapshotLoadMs += nowMs() - snapshotLoadStartedAtMs;
  const initialScope = options.scope ?? getPlannerReplanScopeForMutation(options.mutation);
  if (initialScope === "full_horizon") {
    const repairStartedAtMs = nowMs();
    snapshot = await repairCollapsedCoveragePlanningState(referenceDate);
    repairMs += nowMs() - repairStartedAtMs;
  } else {
    const precheckStartedAtMs = nowMs();
    const precheckState = getScopedReplanPrecheckState({
      snapshot,
      scope: initialScope,
      affectedWeekStart: startOfPlannerWeek(options.affectedWeekStart ?? referenceDate),
      referenceDate,
    });
    precheckMs += nowMs() - precheckStartedAtMs;
    escalationReason = precheckState.escalationReason as ReplanDiagnostics["escalationReason"];

    if (precheckState.hasPotentialIssue) {
      const repairStartedAtMs = nowMs();
      snapshot = await repairCollapsedCoveragePlanningState(referenceDate);
      repairMs += nowMs() - repairStartedAtMs;
    }
  }

  const initialRepairState = getCollapsedCoverageRepairState(snapshot, referenceDate);
  const scope = initialRepairState.hasCollapsedCoverage
    ? "full_horizon"
    : initialScope;
  const escalationPath = options.escalationPath ?? [scope];
  const scopeTimingsMs = { ...(options.scopeTimingsMs ?? {}) };
  const replanStartedAtMs = options.replanStartedAtMs ?? nowMs();
  const repairTriggered = (options.repairTriggered ?? false) || initialRepairState.hasCollapsedCoverage;
  const hardCoverageEscalationForced =
    (options.hardCoverageEscalationForced ?? false) || initialRepairState.hasHardConstraintCoverageFailure;
  const affectedWeekStart = startOfPlannerWeek(options.affectedWeekStart ?? referenceDate);
  const planningStartWeek = startOfPlannerWeek(referenceDate);

  if (initialRepairState.hasCollapsedCoverage && !escalationReason) {
    escalationReason = initialRepairState.hasHardConstraintCoverageFailure
      ? "hard_coverage"
      : initialRepairState.futureFillableGap.hasGap
      ? "fillable_gap"
      : initialRepairState.invalidOverlapIssues.length > 0
      ? "overlap"
      : "collapsed_coverage";
  }

  if (scope === "week_local") {
    const scopeStartedAtMs = nowMs();
    const result = replanStudyPlan({
      weekStart: affectedWeekStart,
      goals: snapshot.goals,
      subjects: snapshot.subjects,
      topics: snapshot.topics,
      completionLogs: snapshot.completionLogs,
      fixedEvents: snapshot.fixedEvents,
      sickDays: snapshot.sickDays,
      focusedDays: snapshot.focusedDays,
      focusedWeeks: snapshot.focusedWeeks,
      studyBlocks: snapshot.studyBlocks.filter(
        (block) => block.weekStart === toDateKey(affectedWeekStart),
      ),
      preferences: snapshot.preferences,
    });
    scopeTimingsMs.week_local = (scopeTimingsMs.week_local ?? 0) + (nowMs() - scopeStartedAtMs);
    const diagnostics = buildReplanDiagnostics({
      scope,
      escalationPath,
      replanStartedAtMs,
      scopeTimingsMs,
      repairTriggered,
      hardCoverageEscalationForced,
      localApplyMs: options.localApplyMs,
      precheckMs,
      writeMs,
      snapshotLoadMs,
      repairMs,
      backgroundValidationMs: options.backgroundValidationMs,
      escalationReason,
    });
    const [weeklyPlan] = applyReplanDiagnostics([result.weeklyPlan], diagnostics);
    if (shouldAbortForRevision()) {
      return loadPlannerSnapshot();
    }
    const writeStartedAtMs = nowMs();
    await replaceWeeklyPlan(result.studyBlocks, weeklyPlan);
    writeMs += nowMs() - writeStartedAtMs;

    const nextSnapshotLoadStartedAtMs = nowMs();
    const nextSnapshot = await loadPlannerSnapshot();
    snapshotLoadMs += nowMs() - nextSnapshotLoadStartedAtMs;
    const nextRepairState = getCollapsedCoverageRepairState(nextSnapshot, referenceDate);
    if (!nextRepairState.hasCollapsedCoverage) {
      return nextSnapshot;
    }

    const nextScope = getEscalatedPlannerReplanScope(scope);
    if (!nextScope) {
      return nextSnapshot;
    }

    return replanPlannerState({
      ...options,
      scope: nextScope,
      affectedWeekStart,
      replanStartedAtMs,
      scopeTimingsMs,
      escalationPath: [...escalationPath, nextScope],
      repairTriggered: true,
      hardCoverageEscalationForced:
        hardCoverageEscalationForced || nextRepairState.hasHardConstraintCoverageFailure,
      localApplyMs: options.localApplyMs,
      backgroundValidationMs: options.backgroundValidationMs,
      expectedRevision: options.expectedRevision,
    });
  }

  if (scope === "tail_from_week") {
    const scopeStartedAtMs = nowMs();
    const preservedStudyBlockIds = collectScopedPreservedStudyBlockIds({
      studyBlocks: snapshot.studyBlocks,
      referenceDate,
      preservedStudyBlockIds: options.preservedStudyBlockIds,
    });
    const replanned = generateIncrementalStudyPlanTail({
      startWeek: affectedWeekStart,
      referenceDate,
      goals: snapshot.goals,
      subjects: snapshot.subjects,
      topics: snapshot.topics,
      completionLogs: snapshot.completionLogs,
      fixedEvents: snapshot.fixedEvents,
      sickDays: snapshot.sickDays,
      focusedDays: snapshot.focusedDays,
      focusedWeeks: snapshot.focusedWeeks,
      preferences: snapshot.preferences,
      existingStudyBlocks: snapshot.studyBlocks,
      existingWeeklyPlans: snapshot.weeklyPlans,
      preservedStudyBlockIds,
      preserveFlexibleFutureBlocks: false,
    });
    scopeTimingsMs.tail_from_week =
      (scopeTimingsMs.tail_from_week ?? 0) + (nowMs() - scopeStartedAtMs);
    const diagnostics = buildReplanDiagnostics({
      scope,
      escalationPath,
      replanStartedAtMs,
      scopeTimingsMs,
      repairTriggered,
      hardCoverageEscalationForced,
      localApplyMs: options.localApplyMs,
      precheckMs,
      writeMs,
      snapshotLoadMs,
      repairMs,
      backgroundValidationMs: options.backgroundValidationMs,
      escalationReason,
    });
    if (shouldAbortForRevision()) {
      return loadPlannerSnapshot();
    }
    const writeStartedAtMs = nowMs();
    await replacePlanningWeeks(
      replanned.studyBlocks,
      applyReplanDiagnostics(replanned.weeklyPlans, diagnostics),
      replanned.changedWeekStarts,
    );
    writeMs += nowMs() - writeStartedAtMs;

    const nextSnapshotLoadStartedAtMs = nowMs();
    const nextSnapshot = await loadPlannerSnapshot();
    snapshotLoadMs += nowMs() - nextSnapshotLoadStartedAtMs;
    const nextRepairState = getCollapsedCoverageRepairState(nextSnapshot, referenceDate);
    if (!nextRepairState.hasCollapsedCoverage) {
      return nextSnapshot;
    }

    return replanPlannerState({
      ...options,
      mutation: "collapsed_coverage_repair",
      scope: "full_horizon",
      affectedWeekStart: planningStartWeek,
      replanStartedAtMs,
      scopeTimingsMs,
      escalationPath: [...escalationPath, "full_horizon"],
      repairTriggered: true,
      hardCoverageEscalationForced:
        hardCoverageEscalationForced || nextRepairState.hasHardConstraintCoverageFailure,
      aggressiveFutureReset: true,
      localApplyMs: options.localApplyMs,
      backgroundValidationMs: options.backgroundValidationMs,
      expectedRevision: options.expectedRevision,
    });
  }

  const buildAndReplaceHorizon = async (workingSnapshot: Awaited<ReturnType<typeof loadPlannerSnapshot>>) => {
    const scopeStartedAtMs = nowMs();
    const repairState = getCollapsedCoverageRepairState(workingSnapshot, referenceDate);
    const preservedStudyBlockIds = collectScopedPreservedStudyBlockIds({
      studyBlocks: workingSnapshot.studyBlocks,
      referenceDate,
      preservedStudyBlockIds: options.preservedStudyBlockIds,
    });
    const shouldAggressivelyResetFuture =
      repairState.hasCollapsedCoverage || options.aggressiveFutureReset === true;
    const preserveFlexibleFutureBlocks = repairState.hasCollapsedCoverage
      ? false
      : options.preserveFlexibleFutureBlocks;
    const replanned = generateStudyPlanHorizon({
      startWeek: planningStartWeek,
      referenceDate,
      goals: workingSnapshot.goals,
      subjects: workingSnapshot.subjects,
      topics: workingSnapshot.topics,
      completionLogs: workingSnapshot.completionLogs,
      fixedEvents: workingSnapshot.fixedEvents,
      sickDays: workingSnapshot.sickDays,
      focusedDays: workingSnapshot.focusedDays,
      focusedWeeks: workingSnapshot.focusedWeeks,
      preferences: workingSnapshot.preferences,
      existingStudyBlocks: options.aggressiveFutureReset
        ? buildHardConstraintFutureResetBaselineStudyBlocks(
            workingSnapshot.studyBlocks,
            referenceDate,
            preservedStudyBlockIds,
          )
        : repairState.hasCollapsedCoverage
        ? buildCollapsedCoverageRepairBaselineStudyBlocks(
            workingSnapshot.studyBlocks,
            referenceDate,
            preservedStudyBlockIds,
            repairState.invalidOverlapBlockIds,
          )
        : workingSnapshot.studyBlocks,
      preservedStudyBlockIds,
      preserveFlexibleFutureBlocks,
    });
    scopeTimingsMs.full_horizon =
      (scopeTimingsMs.full_horizon ?? 0) + (nowMs() - scopeStartedAtMs);
    const diagnostics = buildReplanDiagnostics({
      scope,
      escalationPath,
      replanStartedAtMs,
      scopeTimingsMs,
      repairTriggered,
      hardCoverageEscalationForced,
      localApplyMs: options.localApplyMs,
      precheckMs,
      writeMs,
      snapshotLoadMs,
      repairMs,
      backgroundValidationMs: options.backgroundValidationMs,
      escalationReason,
    });

    if (shouldAbortForRevision()) {
      return;
    }
    const writeStartedAtMs = nowMs();
    await replacePlanningHorizon(
      replanned.studyBlocks,
      applyReplanDiagnostics(replanned.weeklyPlans, diagnostics),
      toDateKey(planningStartWeek),
      {
        preservedStudyBlockIds,
        preserveFlexibleFutureBlocks,
        aggressiveFutureReset: shouldAggressivelyResetFuture,
      },
    );
    writeMs += nowMs() - writeStartedAtMs;
  };

  await buildAndReplaceHorizon(snapshot);
  if (shouldAbortForRevision()) {
    return loadPlannerSnapshot();
  }

  let nextSnapshotLoadStartedAtMs = nowMs();
  let nextSnapshot = await loadPlannerSnapshot();
  snapshotLoadMs += nowMs() - nextSnapshotLoadStartedAtMs;
  if (!getCollapsedCoverageRepairState(nextSnapshot, referenceDate).hasCollapsedCoverage) {
    await markPlanningHorizonReady(referenceDate);
    return loadPlannerSnapshot();
  }

  const repairStartedAtMs = nowMs();
  nextSnapshot = await repairCollapsedCoveragePlanningState(referenceDate);
  repairMs += nowMs() - repairStartedAtMs;
  await buildAndReplaceHorizon(nextSnapshot);
  nextSnapshotLoadStartedAtMs = nowMs();
  const finalSnapshot = await loadPlannerSnapshot();
  snapshotLoadMs += nowMs() - nextSnapshotLoadStartedAtMs;
  if (!getCollapsedCoverageRepairState(finalSnapshot, referenceDate).hasCollapsedCoverage) {
    await markPlanningHorizonReady(referenceDate);
    return loadPlannerSnapshot();
  }

  await markPlanningHorizonStale(
    "Regeneration could not produce a valid complete horizon. Check planner diagnostics and try again.",
  );
  return loadPlannerSnapshot();
}

function studyBlockOverlapsExpandedFixedEvent(block: StudyBlock, expandedEvent: FixedEvent) {
  const blockStart = new Date(block.start).getTime();
  const blockEnd = new Date(block.end).getTime();
  const eventStart = new Date(expandedEvent.start).getTime();
  const eventEnd = new Date(expandedEvent.end).getTime();
  return blockStart < eventEnd && blockEnd > eventStart;
}

function getActiveStudyBlocksOverlappingFixedEvent(
  snapshot: Awaited<ReturnType<typeof loadPlannerSnapshot>>,
  event: FixedEvent,
  referenceDate: Date,
) {
  return snapshot.studyBlocks.filter((block) => {
    if (!block.subjectId) {
      return false;
    }

    if (!["planned", "rescheduled"].includes(block.status)) {
      return false;
    }

    if (!isStudyBlockActiveAt(block, referenceDate)) {
      return false;
    }

    const weekStart = startOfPlannerWeek(new Date(block.start));
    const expandedEvents = expandFixedEventsForWeek(weekStart, [event]);
    return expandedEvents.some((expandedEvent) =>
      studyBlockOverlapsExpandedFixedEvent(block, expandedEvent),
    );
  });
}

export const usePlannerStore = create<PlannerState>((set, get) => ({
  initialized: false,
  loading: false,
  error: null,
  backgroundReplanStatus: "idle",
  backgroundReplanScope: null,
  backgroundReplanDiagnostics: null,
  horizonStatus: "missing",
  horizonStatusMessage: "Plan needs regeneration. Click Regenerate horizon.",
  lastHorizonGeneratedAt: null,
  currentWeekStart: getCurrentWeekKey(),
  goals: [],
  subjects: [],
  topics: [],
  fixedEvents: [],
  sickDays: [],
  focusedDays: [],
  focusedWeeks: [],
  studyBlocks: [],
  completionLogs: [],
  weeklyPlans: [],
  preferences: null,
  selectedStudyBlockId: null,
  initialize: async () => {
    if (get().loading) {
      return;
    }

    set({ loading: true, error: null });

    try {
      const snapshot = await initializePlannerDatabase();
      set({
        ...snapshot,
        backgroundReplanStatus: "idle",
        backgroundReplanScope: null,
        backgroundReplanDiagnostics: null,
        currentWeekStart: getCurrentWeekKey(),
        initialized: true,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to initialize planner.",
      });
    }
  },
  refresh: async () => {
    set({ loading: true, error: null });

    try {
      const snapshot = await loadPlannerSnapshot();
      set({
        ...snapshot,
        backgroundReplanStatus: "idle",
        backgroundReplanScope: null,
        backgroundReplanDiagnostics: null,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to refresh planner state.",
      });
    }
  },
  setCurrentWeekStart: (weekStart) => {
    set({
      currentWeekStart: toDateKey(startOfPlannerWeek(fromDateKey(weekStart))),
    });
  },
  regenerateHorizon: async () => {
    set({
      loading: true,
      error: null,
      horizonStatus: "regenerating",
      horizonStatusMessage: "Regenerating the full horizon…",
    });

    try {
      bumpPlannerMutationRevision();
      const snapshot = await regeneratePlanningHorizon(new Date());
      set({
        ...snapshot,
        backgroundReplanStatus: "idle",
        backgroundReplanScope: null,
        backgroundReplanDiagnostics: null,
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to regenerate the study plan.",
      });
    }
  },
  saveFixedEvent: async (event) => {
    const referenceDate = new Date();
    const existingSnapshot = await loadPlannerSnapshot();
    const existingEvent = existingSnapshot.fixedEvents.find((e) => e.id === event.id);

    const isOnlyMetadataChanged =
      !!existingEvent &&
      existingEvent.start === event.start &&
      existingEvent.end === event.end &&
      existingEvent.recurrence === event.recurrence &&
      existingEvent.flexibility === event.flexibility &&
      existingEvent.category === event.category &&
      existingEvent.isAllDay === event.isAllDay &&
      JSON.stringify(existingEvent.daysOfWeek) === JSON.stringify(event.daysOfWeek) &&
      existingEvent.repeatUntil === event.repeatUntil &&
      JSON.stringify(existingEvent.excludedDates || []) === JSON.stringify(event.excludedDates || []);

    if (!isOnlyMetadataChanged) {
      const overlappingActiveBlocks = getActiveStudyBlocksOverlappingFixedEvent(
        existingSnapshot,
        event,
        referenceDate,
      );

      if (overlappingActiveBlocks.length) {
        throw new Error(
          "That fixed event overlaps a study block already in progress. Finish or mark that block first, then add the fixed event.",
        );
      }
    }

    await saveFixedEvent(event);

    if (isOnlyMetadataChanged) {
      const snapshot = await loadPlannerSnapshot();
      set({
        ...snapshot,
        backgroundReplanStatus: "idle",
        backgroundReplanScope: null,
        backgroundReplanDiagnostics: null,
        loading: false,
        error: null,
      });
      return;
    }

    bumpPlannerMutationRevision();
    const snapshot = await replanPlannerState({
      mutation: "fixed_event",
      preserveFlexibleFutureBlocks: false,
      aggressiveFutureReset: true,
    });
    set({
      ...snapshot,
      backgroundReplanStatus: "idle",
      backgroundReplanScope: null,
      backgroundReplanDiagnostics: null,
      loading: false,
      error: null,
    });
    get().setCurrentWeekStart(toDateKey(new Date(event.start)));
  },
  saveSickDay: async (sickDay) => {
    await persistSickDay(sickDay);
    bumpPlannerMutationRevision();
    const snapshot = await replanPlannerState({
      mutation: "sick_day",
      affectedWeekStart: fromDateKey(sickDay.startDate),
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      backgroundReplanStatus: "idle",
      backgroundReplanScope: null,
      backgroundReplanDiagnostics: null,
      loading: false,
      error: null,
    });
    get().setCurrentWeekStart(sickDay.startDate);
  },
  saveFocusedDay: async (focusedDay) => {
    await persistFocusedDay(focusedDay);
    bumpPlannerMutationRevision();
    const snapshot = await replanPlannerState({
      mutation: "focused_day",
      affectedWeekStart: fromDateKey(focusedDay.date),
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      backgroundReplanStatus: "idle",
      backgroundReplanScope: null,
      backgroundReplanDiagnostics: null,
      loading: false,
      error: null,
    });
    get().setCurrentWeekStart(focusedDay.date);
  },
  saveFocusedWeek: async (focusedWeek) => {
    await persistFocusedWeek(focusedWeek);
    bumpPlannerMutationRevision();
    const snapshot = await replanPlannerState({
      mutation: "focused_week",
      affectedWeekStart: fromDateKey(focusedWeek.weekStart),
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      backgroundReplanStatus: "idle",
      backgroundReplanScope: null,
      backgroundReplanDiagnostics: null,
      loading: false,
      error: null,
    });
    get().setCurrentWeekStart(focusedWeek.weekStart);
  },
  deleteFixedEvent: async ({ id, scope = "series", occurrenceDate }) => {
    if (scope === "occurrence" && occurrenceDate) {
      await excludeFixedEventOccurrence(id, occurrenceDate);
    } else {
      await deleteFixedEventById(id);
    }
    bumpPlannerMutationRevision();
    const snapshot = await replanPlannerState({
      mutation: "fixed_event",
      preserveFlexibleFutureBlocks: false,
      aggressiveFutureReset: true,
    });
    set({
      ...snapshot,
      backgroundReplanStatus: "idle",
      backgroundReplanScope: null,
      backgroundReplanDiagnostics: null,
      loading: false,
      error: null,
    });
  },
  deleteSickDay: async (id) => {
    await deleteSickDayRecordById(id);
    bumpPlannerMutationRevision();
    const snapshot = await replanPlannerState({
      mutation: "sick_day",
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      backgroundReplanStatus: "idle",
      backgroundReplanScope: null,
      backgroundReplanDiagnostics: null,
      loading: false,
      error: null,
    });
  },
  deleteFocusedDay: async (id) => {
    await deleteFocusedDayRecordById(id);
    bumpPlannerMutationRevision();
    const snapshot = await replanPlannerState({
      mutation: "focused_day",
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      backgroundReplanStatus: "idle",
      backgroundReplanScope: null,
      backgroundReplanDiagnostics: null,
      loading: false,
      error: null,
    });
  },
  deleteFocusedWeek: async (id) => {
    await deleteFocusedWeekRecordById(id);
    bumpPlannerMutationRevision();
    const snapshot = await replanPlannerState({
      mutation: "focused_week",
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      backgroundReplanStatus: "idle",
      backgroundReplanScope: null,
      backgroundReplanDiagnostics: null,
      loading: false,
      error: null,
    });
  },
  updatePreferences: async (patch) => {
    const current = get().preferences;
    if (!current) {
      return;
    }

    const nextPreferences: Preferences = {
      ...current,
      ...patch,
      dailyStudyWindow: {
        ...current.dailyStudyWindow,
        ...patch.dailyStudyWindow,
      },
      subjectWeightOverrides: {
        ...current.subjectWeightOverrides,
        ...patch.subjectWeightOverrides,
      },
      schoolSchedule: {
        ...current.schoolSchedule,
        ...patch.schoolSchedule,
        terms: patch.schoolSchedule?.terms ?? current.schoolSchedule.terms,
        weekdays: patch.schoolSchedule?.weekdays ?? current.schoolSchedule.weekdays,
      },
      holidaySchedule: {
        ...current.holidaySchedule,
        ...patch.holidaySchedule,
        dailyStudyWindow: {
          ...current.holidaySchedule.dailyStudyWindow,
          ...patch.holidaySchedule?.dailyStudyWindow,
        },
        preferredDeepWorkWindows:
          patch.holidaySchedule?.preferredDeepWorkWindows ??
          current.holidaySchedule.preferredDeepWorkWindows,
      },
    };

    await savePreferences(nextPreferences);
    bumpPlannerMutationRevision();
    const snapshot = await replanPlannerState({
      mutation: "preferences",
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      backgroundReplanStatus: "idle",
      backgroundReplanScope: null,
      backgroundReplanDiagnostics: null,
      loading: false,
      error: null,
    });
  },
  saveManualStudyBlock: async ({ start, end, topicId, notes, status, actualMinutes }) => {
    try {
      const mutationStartedAtMs = nowMs();
      const snapshot = await loadPlannerSnapshot();
      const referenceDate = new Date();
      const isHistoricalBlock = new Date(end).getTime() <= referenceDate.getTime();
      const nextBlock = await buildManualStudyBlock({
        snapshot,
        start,
        end,
        topicId,
        allowEndedPast: isHistoricalBlock,
      });
      const savedBlock: StudyBlock = {
        ...nextBlock,
        notes: notes?.trim() ?? "",
        status: isHistoricalBlock ? status ?? "done" : nextBlock.status,
        actualMinutes:
          isHistoricalBlock
            ? Math.min(
                nextBlock.estimatedMinutes,
                Math.max(1, Math.round(actualMinutes ?? nextBlock.estimatedMinutes)),
              )
            : nextBlock.actualMinutes,
      };
      await updateStudyBlock(savedBlock);

      if (isHistoricalBlock) {
        await saveCompletionLog({
          id: createId("log"),
          studyBlockId: savedBlock.id,
          outcome: savedBlock.status as CompletionLog["outcome"],
          actualMinutes: savedBlock.actualMinutes ?? savedBlock.estimatedMinutes,
          perceivedDifficulty: 3,
          notes: savedBlock.notes,
          recordedAt: new Date().toISOString(),
        });

        await applyTopicProgressForStudyBlockUpdate({
          snapshot,
          previousBlock: null,
          nextBlock: savedBlock,
        });
      }

      const affectedWeekStart = startOfPlannerWeek(new Date(start));
      const useWeekLocalReplan =
        !isHistoricalBlock && shouldUseWeekLocalReplan(new Date(start), new Date());
      const localApplyMs = nowMs() - mutationStartedAtMs;
      bumpPlannerMutationRevision();
      await applyRoutineMutationPhaseA({
        mutation: useWeekLocalReplan ? "manual_block_current_week" : "manual_block_tail",
        affectedWeekStart,
        preservedStudyBlockIds: [savedBlock.id],
        preserveFlexibleFutureBlocks: false,
        localApplyMs,
        useWeekLocalReplan,
      });
      queueBackgroundReplan({
        mutation: useWeekLocalReplan ? "manual_block_current_week" : "manual_block_tail",
        affectedWeekStart,
        preservedStudyBlockIds: [savedBlock.id],
        preserveFlexibleFutureBlocks: false,
        localApplyMs,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to save the manual study block.";
      set({
        loading: false,
        error: message,
      });
      throw error;
    }
  },
  editStudyBlockSchedule: async ({ blockId, start, end, topicId, notes }) => {
    try {
      const mutationStartedAtMs = nowMs();
      const snapshot = await loadPlannerSnapshot();
      const existingBlock = snapshot.studyBlocks.find((candidate) => candidate.id === blockId);

      if (!existingBlock) {
        throw new Error("Study block not found.");
      }

      if (!["planned", "rescheduled"].includes(existingBlock.status)) {
        throw new Error("Only future planned study blocks can be edited.");
      }

      const updatedBlock = await buildManualStudyBlock({
        snapshot,
        start,
        end,
        topicId,
        existingBlock,
      });
      await updateStudyBlock({
        ...updatedBlock,
        notes: notes?.trim() ?? existingBlock.notes,
      });

      const affectedWeekStart = startOfPlannerWeek(new Date(start));
      const useWeekLocalReplan = shouldUseWeekLocalReplan(new Date(start), new Date());
      const localApplyMs = nowMs() - mutationStartedAtMs;
      bumpPlannerMutationRevision();
      await applyRoutineMutationPhaseA({
        mutation: useWeekLocalReplan ? "edit_study_block" : "manual_block_tail",
        affectedWeekStart,
        preservedStudyBlockIds: [existingBlock.id],
        preserveFlexibleFutureBlocks: false,
        localApplyMs,
        useWeekLocalReplan,
      });
      queueBackgroundReplan({
        mutation: useWeekLocalReplan ? "edit_study_block" : "manual_block_tail",
        affectedWeekStart,
        preservedStudyBlockIds: [existingBlock.id],
        preserveFlexibleFutureBlocks: false,
        localApplyMs,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to edit the study block.";
      set({
        loading: false,
        error: message,
      });
      throw error;
    }
  },
  updateTopicCompletedHours: async ({ topicId, completedHours }) => {
    await get().updateTopicCompletedHoursBatch([
      {
        topicId,
        completedHours,
      },
    ]);
  },
  updateTopicCompletedHoursBatch: async (updates) => {
    set({ loading: true, error: null });

    try {
      if (updates.length === 0) {
        const nextSnapshot = await loadPlannerSnapshot();
        set({
          ...nextSnapshot,
          loading: false,
          error: null,
        });
        return;
      }

      const snapshot = await loadPlannerSnapshot();
      const topicsById = new Map(snapshot.topics.map((topic) => [topic.id, topic]));
      let changedTopicCount = 0;

      for (const update of updates) {
        const topic = topicsById.get(update.topicId);

        if (!topic) {
          throw new Error("Topic not found.");
        }

        const nextCompletedHours = clampCompletedHours(update.completedHours, topic.estHours);

        if (Math.abs(nextCompletedHours - topic.completedHours) <= 0.001) {
          continue;
        }

        const nextTopic: Topic = {
          ...topic,
          completedHours: nextCompletedHours,
        };
        nextTopic.status = deriveTopicStatus(nextTopic);
        await updateTopic(nextTopic);
        topicsById.set(nextTopic.id, nextTopic);
        changedTopicCount += 1;
      }

      if (changedTopicCount === 0) {
        const nextSnapshot = await loadPlannerSnapshot();
        set({
          ...nextSnapshot,
          backgroundReplanStatus: "idle",
          backgroundReplanScope: null,
          backgroundReplanDiagnostics: null,
          loading: false,
          error: null,
        });
        return;
      }

      bumpPlannerMutationRevision();
      const nextSnapshot = await replanPlannerState({
        mutation: "topic_progress",
        preserveFlexibleFutureBlocks: false,
      });
      set({
        ...nextSnapshot,
        backgroundReplanStatus: "idle",
        backgroundReplanScope: null,
        backgroundReplanDiagnostics: null,
        loading: false,
        error: null,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to update topic progress.",
      });
      throw error;
    }
  },
  updateStudyBlockStatus: async ({
    blockId,
    status,
    actualMinutes,
    notes = "",
    perceivedDifficulty = 3,
  }) => {
    const mutationStartedAtMs = nowMs();
    const snapshot = await loadPlannerSnapshot();
    const block = snapshot.studyBlocks.find((candidate) => candidate.id === blockId);

    if (!block) {
      return;
    }

    const nextActualMinutes = actualMinutes ?? block.estimatedMinutes;
    const updatedBlock: StudyBlock = {
      ...block,
      status,
      actualMinutes: status === "planned" ? null : nextActualMinutes,
      notes,
    };

    await updateStudyBlock(updatedBlock);
    const topicById = new Map(snapshot.topics.map((topic) => [topic.id, topic]));
    const isSeriousOlympiadAttempt = isSeriousOlympiadAttemptBlock({
      block,
      topicById,
    });
    let completionLog: CompletionLog | null = null;
    const bypassReplan = shouldDoneStatusBypassReplan({
      previousBlock: block,
      nextBlock: updatedBlock,
    });

    if (status === "planned") {
      await deleteCompletionLogsByStudyBlockId(block.id);
    }

    if (status === "done" || status === "partial" || status === "missed") {
      completionLog = {
        id: createId("log"),
        studyBlockId: block.id,
        outcome: status,
        actualMinutes: status === "missed" ? 0 : nextActualMinutes,
        perceivedDifficulty,
        notes,
        recordedAt: new Date().toISOString(),
      };
      await saveCompletionLog(completionLog);
    }

    if (isSeriousOlympiadAttempt && status !== "done" && status !== "partial") {
      const pendingRewriteIds = getPendingOlympiadRewriteStudyBlockIdsForSource(
        snapshot.studyBlocks,
        block.id,
      );
      await deleteStudyBlocksByIds(pendingRewriteIds);
    }

    let updatedTopic: Topic | null = null;
    if (block.topicId) {
      updatedTopic = await applyTopicProgressForStudyBlockUpdate({
        snapshot,
        previousBlock: block,
        nextBlock: updatedBlock,
      });
    }

    let insertedStudyBlock: StudyBlock | null = null;
    if (
      isSeriousOlympiadAttempt &&
      status === "done" &&
      completionLog &&
      bypassReplan
    ) {
      insertedStudyBlock = await maybeInsertImmediateOlympiadRewriteFollowUp({
        snapshot,
        sourceBlock: updatedBlock,
        completionLog,
      });
    }

    if (bypassReplan) {
      const affectedWeekStart = startOfPlannerWeek(new Date(block.start));
      const localApplyMs = nowMs() - mutationStartedAtMs;
      bumpPlannerMutationRevision();
      const nextLocalState = applyStatusUpdateWithoutReplan({
        snapshot,
        updatedBlock,
        completionLog,
        updatedTopic,
        insertedStudyBlock,
      });
      set({
        studyBlocks: nextLocalState.studyBlocks,
        completionLogs: nextLocalState.completionLogs,
        topics: nextLocalState.topics,
        loading: false,
        error: null,
      });
      queueBackgroundReplan({
        mutation: "status_update",
        affectedWeekStart,
        preserveFlexibleFutureBlocks: false,
        localApplyMs,
      });
    } else {
      const referenceDate = new Date();
      const affectedWeekStart = startOfPlannerWeek(new Date(block.start));
      const useWeekLocalReplan =
        shouldUseWeekLocalReplan(new Date(block.start), referenceDate) &&
        shouldRunStatusUpdateReplan({
          previousBlock: block,
          nextBlock: updatedBlock,
          studyBlocks: snapshot.studyBlocks,
          referenceDate,
          hasCollapsedCoverage: getCollapsedCoverageRepairState(snapshot, referenceDate).hasCollapsedCoverage,
        });
      const preservedStudyBlockIds = getStatusUpdatePreservedStudyBlockIds({
        studyBlocks: snapshot.studyBlocks,
        updatedBlockId: block.id,
        nextStatus: status,
        referenceDate,
      });
      const localApplyMs = nowMs() - mutationStartedAtMs;
      bumpPlannerMutationRevision();
      await applyRoutineMutationPhaseA({
        mutation: "status_update",
        affectedWeekStart,
        preservedStudyBlockIds,
        preserveFlexibleFutureBlocks: false,
        localApplyMs,
        useWeekLocalReplan,
      });
      queueBackgroundReplan({
        mutation: "status_update",
        affectedWeekStart,
        preservedStudyBlockIds,
        preserveFlexibleFutureBlocks: false,
        localApplyMs,
      });
    }
    get().setCurrentWeekStart(toDateKey(startOfPlannerWeek(new Date(block.start))));
  },
  requestMorePractice: async ({ blockId, extraMinutes, notes = "" }) => {
    const mutationStartedAtMs = nowMs();
    const snapshot = await loadPlannerSnapshot();
    const block = snapshot.studyBlocks.find((candidate) => candidate.id === blockId);

    if (!block?.topicId) {
      return;
    }

    const topic = snapshot.topics.find((candidate) => candidate.id === block.topicId);
    if (!topic) {
      return;
    }

    const additionalPracticeMinutes = resolveAdditionalPracticeMinutes(block, extraMinutes);
    const nextTopic: Topic = {
      ...topic,
      estHours: roundToQuarterHour(topic.estHours + additionalPracticeMinutes / 60),
      mastery: clampMastery(topic.mastery - 0.35),
      notes: appendMorePracticeNote(topic.notes, {
        addedMinutes: additionalPracticeMinutes,
        sourceDate: block.date,
        extraNotes: notes,
      }),
    };
    nextTopic.status = deriveTopicStatus(nextTopic);
    await updateTopic(nextTopic);

    const now = new Date();
    const preservedStudyBlockIds = snapshot.studyBlocks
      .filter((candidate) => {
        if (!["planned", "rescheduled"].includes(candidate.status)) {
          return false;
        }

        return isStudyBlockActiveAt(candidate, now);
      })
      .map((candidate) => candidate.id);

    const affectedWeekStart = startOfPlannerWeek(new Date(block.start));
    const useWeekLocalReplan = shouldUseWeekLocalReplan(new Date(block.start), now);
    const localApplyMs = nowMs() - mutationStartedAtMs;
    bumpPlannerMutationRevision();
    await applyRoutineMutationPhaseA({
      mutation: useWeekLocalReplan ? "request_more_practice" : "manual_block_tail",
      affectedWeekStart,
      preservedStudyBlockIds,
      preserveFlexibleFutureBlocks: false,
      localApplyMs,
      useWeekLocalReplan,
    });
    queueBackgroundReplan({
      mutation: useWeekLocalReplan ? "request_more_practice" : "manual_block_tail",
      affectedWeekStart,
      preservedStudyBlockIds,
      preserveFlexibleFutureBlocks: false,
      localApplyMs,
    });
  },
  reassignStudyBlock: async ({ blockId, topicId, notes }) => {
    const mutationStartedAtMs = nowMs();
    const snapshot = await loadPlannerSnapshot();
    const block = snapshot.studyBlocks.find((candidate) => candidate.id === blockId);

    if (!block || !block.subjectId || !block.topicId) {
      return;
    }

    if (!["planned", "rescheduled"].includes(block.status)) {
      return;
    }

    if (new Date(block.end).getTime() <= Date.now()) {
      return;
    }

    const subjectDeadlinesById = Object.fromEntries(
      snapshot.subjects.map((subject) => [subject.id, subject.deadline]),
    );
    const assignableCandidates = getAssignableTaskCandidatesForBlock({
      block,
      topics: snapshot.topics,
      existingPlannedBlocks: snapshot.studyBlocks.filter((candidate) => candidate.id !== block.id),
      subjectDeadlinesById,
    });
    const nextCandidate = assignableCandidates.find((candidate) => candidate.topicId === topicId);

    if (!nextCandidate?.subjectId || !nextCandidate.topicId) {
      return;
    }

    const updatedBlock: StudyBlock = {
      ...block,
      subjectId: nextCandidate.subjectId,
      topicId: nextCandidate.topicId,
      title: nextCandidate.title,
      sessionSummary: nextCandidate.sessionSummary,
      paperCode: nextCandidate.paperCode,
      unitTitle: nextCandidate.unitTitle,
      sourceMaterials: nextCandidate.sourceMaterials,
      generatedReason: buildManualAssignmentReason(nextCandidate),
      scoreBreakdown: buildManualAssignmentScoreBreakdown(),
      notes: notes ?? block.notes,
      assignmentLocked: false,
      assignmentEditedAt: new Date().toISOString(),
    };

    await updateStudyBlock(updatedBlock);

    const affectedWeekStart = startOfPlannerWeek(new Date(block.start));
    const useWeekLocalReplan = shouldUseWeekLocalReplan(new Date(block.start), new Date());
    const localApplyMs = nowMs() - mutationStartedAtMs;
    bumpPlannerMutationRevision();
    await applyRoutineMutationPhaseA({
      mutation: useWeekLocalReplan ? "reassign_study_block" : "manual_block_tail",
      affectedWeekStart,
      preservedStudyBlockIds: [block.id],
      preserveFlexibleFutureBlocks: false,
      localApplyMs,
      useWeekLocalReplan,
    });
    queueBackgroundReplan({
      mutation: useWeekLocalReplan ? "reassign_study_block" : "manual_block_tail",
      affectedWeekStart,
      preservedStudyBlockIds: [block.id],
      preserveFlexibleFutureBlocks: false,
      localApplyMs,
    });
  },
  exportToJson: async () => {
    const payload = await exportPlannerData();
    return JSON.stringify(payload, null, 2);
  },
  exportUserDataToJson: async () => {
    const payload = await exportPlannerUserData();
    return JSON.stringify(payload, null, 2);
  },
  importFromJson: async (rawJson) => {
    set({ loading: true, error: null });

    try {
      bumpPlannerMutationRevision();
      const snapshot = await importPlannerData(rawJson);
      set({
        ...snapshot,
        backgroundReplanStatus: "idle",
        backgroundReplanScope: null,
        backgroundReplanDiagnostics: null,
        currentWeekStart: getCurrentWeekKey(),
        loading: false,
      });
    } catch (error) {
      set({
        loading: false,
        error: error instanceof Error ? error.message : "Failed to import planner data.",
      });
    }
  },
  selectStudyBlock: (id) => {
    set({ selectedStudyBlockId: id });
  },
}));

function applyPlannerSnapshotToStore(
  snapshot: Awaited<ReturnType<typeof loadPlannerSnapshot>>,
  overrides?: Partial<PlannerState>,
) {
  usePlannerStore.setState({
    ...snapshot,
    loading: false,
    error: null,
    ...(overrides ?? {}),
  });
}

async function applyRoutineMutationPhaseA(options: {
  mutation: PlannerReplanMutation;
  affectedWeekStart: Date;
  preserveFlexibleFutureBlocks?: boolean;
  preservedStudyBlockIds?: string[];
  localApplyMs?: number | null;
  useWeekLocalReplan: boolean;
}) {
  const expectedRevision = getPlannerMutationRevision();
  const nextSnapshot = options.useWeekLocalReplan
    ? await replanPlannerState({
        mutation: options.mutation,
        scope: "week_local",
        affectedWeekStart: options.affectedWeekStart,
        preserveFlexibleFutureBlocks: options.preserveFlexibleFutureBlocks,
        preservedStudyBlockIds: options.preservedStudyBlockIds,
        localApplyMs: options.localApplyMs,
        expectedRevision,
      })
    : await loadPlannerSnapshot();

  if (expectedRevision !== getPlannerMutationRevision()) {
    return;
  }

  applyPlannerSnapshotToStore(nextSnapshot);
  usePlannerStore
    .getState()
    .setCurrentWeekStart(toDateKey(startOfPlannerWeek(options.affectedWeekStart)));
}

function queueBackgroundReplan(options: {
  mutation: PlannerReplanMutation;
  affectedWeekStart: Date;
  preserveFlexibleFutureBlocks?: boolean;
  preservedStudyBlockIds?: string[];
  localApplyMs?: number | null;
}) {
  const requestId = ++backgroundReplanRequestId;
  const expectedRevision = getPlannerMutationRevision();
  const backgroundStartedAtMs = nowMs();
  usePlannerStore.setState({
    backgroundReplanStatus: "running",
    backgroundReplanScope: "tail_from_week",
    backgroundReplanDiagnostics: null,
  });

  void Promise.resolve().then(async () => {
    try {
      const nextSnapshot = await replanPlannerState({
        mutation: options.mutation,
        scope: "tail_from_week",
        affectedWeekStart: options.affectedWeekStart,
        preserveFlexibleFutureBlocks: options.preserveFlexibleFutureBlocks,
        preservedStudyBlockIds: options.preservedStudyBlockIds,
        localApplyMs: options.localApplyMs,
        expectedRevision,
      });

      if (
        requestId !== backgroundReplanRequestId ||
        expectedRevision !== getPlannerMutationRevision()
      ) {
        return;
      }

      const relevantWeekStart = toDateKey(startOfPlannerWeek(options.affectedWeekStart));
      const backgroundDiagnostics =
        nextSnapshot.weeklyPlans.find((weeklyPlan) => weeklyPlan.weekStart === relevantWeekStart)
          ?.replanDiagnostics ??
        nextSnapshot.weeklyPlans.at(-1)?.replanDiagnostics ??
        null;

      applyPlannerSnapshotToStore(nextSnapshot, {
        backgroundReplanStatus: "idle",
        backgroundReplanScope: null,
        backgroundReplanDiagnostics: backgroundDiagnostics
          ? {
              ...backgroundDiagnostics,
              backgroundValidationMs: Number((nowMs() - backgroundStartedAtMs).toFixed(1)),
            }
          : null,
      });
    } catch (error) {
      if (
        requestId !== backgroundReplanRequestId ||
        expectedRevision !== getPlannerMutationRevision()
      ) {
        return;
      }

      usePlannerStore.setState({
        backgroundReplanStatus: "failed",
        backgroundReplanScope: "tail_from_week",
        backgroundReplanDiagnostics: {
          scope: "tail_from_week",
          escalationPath: ["tail_from_week"],
          totalGenerationMs: Number((nowMs() - backgroundStartedAtMs).toFixed(1)),
          scopeTimingsMs: {},
          repairTriggered: false,
          hardCoverageEscalationForced: false,
          backgroundValidationMs: Number((nowMs() - backgroundStartedAtMs).toFixed(1)),
          escalationReason: null,
        },
        error:
          error instanceof Error
            ? error.message
            : "Background planner validation failed.",
      });
    }
  });
}

async function buildManualStudyBlock(options: {
  snapshot: Awaited<ReturnType<typeof loadPlannerSnapshot>>;
  start: string;
  end: string;
  topicId: string;
  existingBlock?: StudyBlock;
  allowEndedPast?: boolean;
}) {
  const startDate = new Date(options.start);
  const endDate = new Date(options.end);

  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate <= startDate) {
    throw new Error("Choose a valid current or future time range for the study block.");
  }

  if (toDateKey(startDate) !== toDateKey(endDate)) {
    throw new Error("Study blocks must start and end on the same day.");
  }

  const durationMinutes = Math.round((endDate.getTime() - startDate.getTime()) / (60 * 1000));
  if (durationMinutes < 30) {
    throw new Error("Study blocks must be at least 30 minutes long.");
  }

  if (!options.allowEndedPast && endDate.getTime() <= Date.now()) {
    throw new Error("Study-block scheduling edits are limited to blocks that have not ended yet.");
  }

  const draftBlock: StudyBlock = {
    id: options.existingBlock?.id ?? createId("block"),
    weekStart: toDateKey(startOfPlannerWeek(startDate)),
    date: toDateKey(startDate),
    start: startDate.toISOString(),
    end: endDate.toISOString(),
    subjectId: options.existingBlock?.subjectId ?? null,
    topicId: options.existingBlock?.topicId ?? null,
    title: options.existingBlock?.title ?? "Manual study block",
    sessionSummary: options.existingBlock?.sessionSummary ?? null,
    paperCode: options.existingBlock?.paperCode ?? null,
    unitTitle: options.existingBlock?.unitTitle ?? null,
    blockType: options.existingBlock?.blockType ?? "standard_focus",
    intensity: options.existingBlock?.intensity ?? "moderate",
    generatedReason: options.existingBlock?.generatedReason ?? "",
    scoreBreakdown: buildManualAssignmentScoreBreakdown(),
    status: options.existingBlock?.status ?? "planned",
    isAutoGenerated: true,
    creationSource: "manual",
    sourceMaterials: options.existingBlock?.sourceMaterials ?? [],
    slotEnergy: options.existingBlock?.slotEnergy ?? "steady",
    estimatedMinutes: durationMinutes,
    actualMinutes: options.existingBlock?.actualMinutes ?? null,
    notes: options.existingBlock?.notes ?? "",
    rescheduleCount: options.existingBlock?.rescheduleCount ?? 0,
    assignmentLocked: false,
    assignmentEditedAt: new Date().toISOString(),
  };
  const subjectDeadlinesById = Object.fromEntries(
    options.snapshot.subjects.map((subject) => [subject.id, subject.deadline]),
  );
  const assignableCandidates = getAssignableTaskCandidatesForBlock({
    block: draftBlock,
    topics: options.snapshot.topics,
    existingPlannedBlocks: options.snapshot.studyBlocks.filter(
      (candidate) => candidate.id !== draftBlock.id,
    ),
    subjectDeadlinesById,
    allowCompletedTopics: options.allowEndedPast,
  });
  const nextCandidate = assignableCandidates.find((candidate) => candidate.topicId === options.topicId);

  if (!nextCandidate?.subjectId || !nextCandidate.topicId) {
    throw new Error(
      "That topic is not valid for this exact time and duration. Check dependencies, focus timing, and exact paper length requirements.",
    );
  }

  const containingFreeSlot = getContainingHardConstraintFreeSlot({
    snapshot: options.snapshot,
    start: startDate,
    end: endDate,
    excludeBlockId: options.existingBlock?.id,
  });

  if (!containingFreeSlot) {
    throw new Error(
      "That time overlaps a fixed event, lunch/dinner, Piano/Homework, or another preserved study block.",
    );
  }

  const manualSlot = createSlotSlice(containingFreeSlot, startDate, durationMinutes);
  const blockOption = selectBlockOption(nextCandidate, manualSlot, options.snapshot.preferences, {
    allowLowEnergyHeavy: true,
    allowLateNightDeepWork: true,
    preferLongerBlocks: true,
  });
  const fallbackBlockType =
    nextCandidate.preferredBlockTypes[0] ??
    (nextCandidate.kind === "review" ? "review" : "standard_focus");

  return {
    ...draftBlock,
    subjectId: nextCandidate.subjectId,
    topicId: nextCandidate.topicId,
    title: nextCandidate.title,
    sessionSummary: nextCandidate.sessionSummary,
    paperCode: nextCandidate.paperCode,
    unitTitle: nextCandidate.unitTitle,
    blockType: blockOption?.blockType ?? fallbackBlockType,
    intensity: blockOption?.intensity ?? nextCandidate.intensity,
    generatedReason: buildManualStudyBlockReason(nextCandidate, !!options.existingBlock),
    sourceMaterials: nextCandidate.sourceMaterials,
    slotEnergy: manualSlot.energy,
    estimatedMinutes: durationMinutes,
  };
}

function getContainingHardConstraintFreeSlot(options: {
  snapshot: Awaited<ReturnType<typeof loadPlannerSnapshot>>;
  start: Date;
  end: Date;
  excludeBlockId?: string;
}) {
  const blockingStudyBlocks = options.snapshot.studyBlocks.filter((block) => {
    if (block.id === options.excludeBlockId) {
      return false;
    }

    return (
      shouldAlwaysPreserveStudyBlockOnRegeneration(block) ||
      (["planned", "rescheduled"].includes(block.status) &&
        isStudyBlockActiveAt(block, new Date()))
    );
  });

  return calculateFreeSlots({
    weekStart: startOfPlannerWeek(options.start),
    fixedEvents: options.snapshot.fixedEvents,
    sickDays: options.snapshot.sickDays,
    preferences: options.snapshot.preferences,
    blockedStudyBlocks: blockingStudyBlocks,
  }).find(
    (slot) =>
      slot.dateKey === toDateKey(options.start) &&
      slot.start.getTime() <= options.start.getTime() &&
      slot.end.getTime() >= options.end.getTime(),
  );
}

function clampMastery(value: number) {
  return Math.min(5, Math.max(0, value));
}

function clampCompletedHours(value: number, estHours: number) {
  return Math.min(estHours, Math.max(0, value));
}

function getProgressDeltaForStudyBlock(block: Pick<StudyBlock, "status" | "estimatedMinutes" | "actualMinutes">) {
  const minutes = block.actualMinutes ?? block.estimatedMinutes;

  switch (block.status) {
    case "done":
      return {
        completedHours: minutes / 60,
        mastery: 1,
      };
    case "partial":
      return {
        completedHours: minutes / 60,
        mastery: 0.5,
      };
    case "missed":
      return {
        completedHours: 0,
        mastery: -0.25,
      };
    default:
      return {
        completedHours: 0,
        mastery: 0,
      };
  }
}

async function applyTopicProgressForStudyBlockUpdate(options: {
  snapshot: Awaited<ReturnType<typeof loadPlannerSnapshot>>;
  previousBlock: Pick<StudyBlock, "topicId" | "status" | "estimatedMinutes" | "actualMinutes"> | null;
  nextBlock: Pick<StudyBlock, "topicId" | "status" | "estimatedMinutes" | "actualMinutes">;
}): Promise<Topic | null> {
  if (!options.nextBlock.topicId) {
    return null;
  }

  const topic = options.snapshot.topics.find((candidate) => candidate.id === options.nextBlock.topicId);
  if (!topic) {
    return null;
  }

  const previousDelta =
    options.previousBlock?.topicId === topic.id
      ? getProgressDeltaForStudyBlock(options.previousBlock)
      : { completedHours: 0, mastery: 0 };
  const nextDelta = getProgressDeltaForStudyBlock(options.nextBlock);
  const nextTopic: Topic = {
    ...topic,
    completedHours: clampCompletedHours(
      topic.completedHours - previousDelta.completedHours + nextDelta.completedHours,
      topic.estHours,
    ),
    mastery: clampMastery(topic.mastery - previousDelta.mastery + nextDelta.mastery),
    lastStudiedAt:
      options.nextBlock.status === "planned" ? topic.lastStudiedAt : new Date().toISOString(),
  };
  nextTopic.status = deriveTopicStatus(nextTopic);
  await updateTopic(nextTopic);
  return nextTopic;
}

function sortStudyBlocksByStart(studyBlocks: StudyBlock[]) {
  return [...studyBlocks].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  );
}

export function applyStatusUpdateWithoutReplan(options: {
  snapshot: Awaited<ReturnType<typeof loadPlannerSnapshot>>;
  updatedBlock: StudyBlock;
  completionLog?: CompletionLog | null;
  updatedTopic?: Topic | null;
  insertedStudyBlock?: StudyBlock | null;
}) {
  const nextStudyBlocks = options.snapshot.studyBlocks.map((candidate) =>
    candidate.id === options.updatedBlock.id ? options.updatedBlock : candidate,
  );

  if (
    options.insertedStudyBlock &&
    !nextStudyBlocks.some((candidate) => candidate.id === options.insertedStudyBlock?.id)
  ) {
    nextStudyBlocks.push(options.insertedStudyBlock);
  }

  return {
    studyBlocks: sortStudyBlocksByStart(nextStudyBlocks),
    completionLogs: options.completionLog
      ? [...options.snapshot.completionLogs, options.completionLog]
      : options.snapshot.completionLogs,
    topics: options.updatedTopic
      ? options.snapshot.topics.map((candidate) =>
          candidate.id === options.updatedTopic?.id ? options.updatedTopic : candidate,
        )
      : options.snapshot.topics,
  };
}

function resolveAdditionalPracticeMinutes(block: StudyBlock, explicitMinutes?: number) {
  const baseMinutes = explicitMinutes ?? block.actualMinutes ?? block.estimatedMinutes;
  return Math.max(30, Math.ceil(Math.max(baseMinutes, 0) / 30) * 30);
}

function roundToQuarterHour(value: number) {
  return Math.round(value * 4) / 4;
}

function appendMorePracticeNote(
  existingNotes: string | undefined,
  options: { addedMinutes: number; sourceDate: string; extraNotes?: string },
) {
  const baseNotes = existingNotes?.trim();
  const morePracticeLine = `More practice requested on ${options.sourceDate}: +${options.addedMinutes} min${options.extraNotes?.trim() ? ` (${options.extraNotes.trim()})` : ""}`;
  return baseNotes ? `${baseNotes}\n${morePracticeLine}` : morePracticeLine;
}

function buildManualAssignmentScoreBreakdown(): StudyBlock["scoreBreakdown"] {
  return {
    priorityWeight: 0,
    deadlineUrgency: 0,
    remainingWorkloadPressure: 0,
    lowMasteryBonus: 0,
    reviewDueBonus: 0,
    neglectedSubjectBonus: 0,
    olympiadSlotBonus: 0,
    focusDayBonus: 0,
    badSlotFitPenalty: 0,
    fragmentationPenalty: 0,
    total: 0,
  };
}

function buildManualAssignmentReason(task: {
  title: string;
  unitTitle: string | null;
  subjectId: string | null;
}) {
  const unitLabel = task.unitTitle ? `${task.unitTitle}` : "the selected topic";
  return `Manually reassigned in the study-block drawer to ${task.title.toLowerCase()} from ${unitLabel}. The horizon was rebuilt around this change, but future regenerations can still move or retarget the block.`;
}

function getPendingOlympiadRewriteStudyBlockIdsForSource(
  studyBlocks: StudyBlock[],
  sourceStudyBlockId: string,
) {
  return studyBlocks
    .filter(
      (block) =>
        isOlympiadRewriteFollowUpBlock(block) &&
        block.followUpSourceStudyBlockId === sourceStudyBlockId &&
        ["planned", "rescheduled"].includes(block.status),
    )
    .map((block) => block.id);
}

function buildOlympiadRewriteFollowUpBlock(options: {
  sourceBlock: StudyBlock;
  start: Date;
  durationMinutes: number;
  slotEnergy: StudyBlock["slotEnergy"];
  dueAt: string;
}) {
  return {
    id: createId("block"),
    weekStart: toDateKey(startOfPlannerWeek(options.start)),
    date: toDateKey(options.start),
    start: options.start.toISOString(),
    end: new Date(options.start.getTime() + options.durationMinutes * 60 * 1000).toISOString(),
    subjectId: "olympiad",
    topicId: null,
    title: buildOlympiadRewriteTitle(options.sourceBlock.title),
    sessionSummary:
      "Produce one final clean proof version, fix all logical gaps, and compress the argument to contest quality within 48 hours.",
    paperCode: options.sourceBlock.paperCode,
    unitTitle: options.sourceBlock.unitTitle,
    blockType: options.durationMinutes > 45 ? "drill" : "review",
    intensity: options.durationMinutes > 45 ? "moderate" : "light",
    generatedReason:
      "A serious Olympiad attempt was completed, so the planner inserted a clean-proof rewrite follow-up within 48 hours.",
    scoreBreakdown: buildManualAssignmentScoreBreakdown(),
    status: "planned",
    isAutoGenerated: false,
    creationSource: "planner",
    sourceMaterials: options.sourceBlock.sourceMaterials,
    slotEnergy: options.slotEnergy,
    estimatedMinutes: options.durationMinutes,
    actualMinutes: null,
    notes: "",
    rescheduleCount: 0,
    assignmentLocked: false,
    assignmentEditedAt: null,
    followUpKind: "olympiad-rewrite",
    followUpSourceStudyBlockId: options.sourceBlock.id,
    followUpDueAt: options.dueAt,
  } satisfies StudyBlock;
}

async function maybeInsertImmediateOlympiadRewriteFollowUp(options: {
  snapshot: Awaited<ReturnType<typeof loadPlannerSnapshot>>;
  sourceBlock: StudyBlock;
  completionLog: CompletionLog;
}): Promise<StudyBlock | null> {
  const existingRewriteIds = getPendingOlympiadRewriteStudyBlockIdsForSource(
    options.snapshot.studyBlocks,
    options.sourceBlock.id,
  );

  if (existingRewriteIds.length > 0) {
    return null;
  }

  const obligation = getOlympiadRewriteObligations({
    topics: options.snapshot.topics,
    studyBlocks: [...options.snapshot.studyBlocks, options.sourceBlock],
    completionLogs: [...options.snapshot.completionLogs, options.completionLog],
  }).find((candidate) => candidate.sourceStudyBlockId === options.sourceBlock.id);

  if (!obligation || obligation.scheduledBlock) {
    return null;
  }

  const availableAt = new Date(obligation.availableAt);
  const dueAt = new Date(obligation.dueAt);
  const candidateWeeks = Array.from(
    new Set([
      toDateKey(startOfPlannerWeek(availableAt)),
      toDateKey(startOfPlannerWeek(dueAt)),
    ]),
  )
    .map((weekStart) => startOfPlannerWeek(new Date(`${weekStart}T00:00:00`)))
    .sort((left, right) => left.getTime() - right.getTime());
  const blockedStudyBlocks = options.snapshot.studyBlocks.filter((block) => {
    if (block.id === options.sourceBlock.id) {
      return false;
    }

    if (!["planned", "rescheduled"].includes(block.status)) {
      return false;
    }

    if (!block.subjectId && block.blockType === "recovery") {
      return false;
    }

    return new Date(block.end).getTime() > availableAt.getTime();
  });

  for (const weekStart of candidateWeeks) {
    const freeSlots = calculateFreeSlots({
      weekStart,
      fixedEvents: options.snapshot.fixedEvents,
      sickDays: options.snapshot.sickDays,
      preferences: options.snapshot.preferences,
      blockedStudyBlocks,
      planningStart: availableAt,
    }).sort((left, right) => left.start.getTime() - right.start.getTime());

    for (const slot of freeSlots) {
      const start = new Date(Math.max(slot.start.getTime(), availableAt.getTime()));
      const end = new Date(Math.min(slot.end.getTime(), dueAt.getTime()));
      const durationMinutes = Math.round((end.getTime() - start.getTime()) / (60 * 1000));

      if (durationMinutes < obligation.durationMinutes) {
        continue;
      }

      const rewriteBlock = buildOlympiadRewriteFollowUpBlock({
        sourceBlock: options.sourceBlock,
        start,
        durationMinutes: obligation.durationMinutes,
        slotEnergy: slot.energy,
        dueAt: obligation.dueAt,
      });
      await updateStudyBlock(rewriteBlock);
      return rewriteBlock;
    }
  }

  return null;
}

function isStudyBlockActiveAt(block: StudyBlock, referenceDate: Date) {
  const blockStart = new Date(block.start).getTime();
  const blockEnd = new Date(block.end).getTime();
  const now = referenceDate.getTime();
  return blockStart <= now && now < blockEnd;
}

function isSubjectStudyBlock(block: StudyBlock) {
  return !!block.subjectId && !!block.topicId;
}

export function shouldDoneStatusBypassReplan(options: {
  previousBlock: StudyBlock;
  nextBlock: StudyBlock;
}) {
  if (
    options.previousBlock.followUpKind === "olympiad-rewrite" &&
    options.nextBlock.status === "done"
  ) {
    return true;
  }

  return isSubjectStudyBlock(options.previousBlock) && options.nextBlock.status === "done";
}

export function shouldStatusUpdateTriggerReplan(options: {
  previousBlock: StudyBlock;
  nextBlock: StudyBlock;
  referenceDate: Date;
}) {
  if (shouldDoneStatusBypassReplan(options)) {
    return false;
  }

  const previousStatus = options.previousBlock.status;
  const nextStatus = options.nextBlock.status;
  const blockEnded = new Date(options.previousBlock.end).getTime() <= options.referenceDate.getTime();
  const actualMinutes = options.nextBlock.actualMinutes ?? options.nextBlock.estimatedMinutes;

  if (
    blockEnded &&
    nextStatus === "done" &&
    ["planned", "rescheduled"].includes(previousStatus) &&
    actualMinutes === options.previousBlock.estimatedMinutes
  ) {
    return false;
  }

  return true;
}

export function shouldRunStatusUpdateReplan(options: {
  previousBlock: StudyBlock;
  nextBlock: StudyBlock;
  studyBlocks: StudyBlock[];
  referenceDate: Date;
  hasCollapsedCoverage: boolean;
}) {
  if (shouldDoneStatusBypassReplan(options)) {
    return false;
  }

  const hasExpiredUncompletedBlocks = options.studyBlocks.some(
    (candidate) =>
      !!candidate.subjectId &&
      (!!candidate.topicId || !!candidate.followUpKind) &&
      ["planned", "rescheduled"].includes(candidate.status) &&
      new Date(candidate.end).getTime() <= options.referenceDate.getTime() &&
      !isStudyBlockActiveAt(candidate, options.referenceDate),
  );

  return (
    shouldStatusUpdateTriggerReplan(options) ||
    hasExpiredUncompletedBlocks ||
    options.hasCollapsedCoverage
  );
}

export function getStatusUpdatePreservedStudyBlockIds(options: {
  studyBlocks: StudyBlock[];
  updatedBlockId: string;
  nextStatus: StudyBlockStatus;
  referenceDate: Date;
}) {
  const ids = options.studyBlocks
    .filter((block) => {
      if (block.id === options.updatedBlockId && options.nextStatus !== "planned") {
        return false;
      }

      const blockEnd = new Date(block.end).getTime();
      if (blockEnd <= options.referenceDate.getTime()) {
        return false;
      }

      const isActiveBlock =
        ["planned", "rescheduled"].includes(block.status) &&
        isStudyBlockActiveAt(block, options.referenceDate);

      if (isActiveBlock) {
        return true;
      }

      return false;
    })
    .map((block) => block.id);

  if (options.nextStatus === "planned" && !ids.includes(options.updatedBlockId)) {
    ids.push(options.updatedBlockId);
  }

  return ids;
}

function buildManualStudyBlockReason(
  task: {
    title: string;
    unitTitle: string | null;
  },
  isEdit: boolean,
) {
  const unitLabel = task.unitTitle ? `${task.unitTitle}` : "the selected section";

  return isEdit
    ? `Manually edited in the study-block editor to ${task.title.toLowerCase()} from ${unitLabel}. The horizon was rebuilt around this change, but future regenerations can still move or retarget the block.`
    : `Manually added in the study-block editor for ${task.title.toLowerCase()} from ${unitLabel}. The horizon was rebuilt around this new block, but future regenerations can still move or retarget it.`;
}
