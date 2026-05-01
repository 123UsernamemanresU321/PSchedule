import { addDays } from "date-fns";

import { startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { buildSeedDataset } from "@/lib/seed";
import {
  generateIncrementalStudyPlanTail,
  generateStudyPlanHorizon,
} from "@/lib/scheduler/generator";
import { replanStudyPlan } from "@/lib/scheduler/replanner";

function nowMs() {
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }

  return Date.now();
}

function measure<T>(label: string, run: () => T) {
  const startedAt = nowMs();
  const result = run();
  const elapsedMs = Number((nowMs() - startedAt).toFixed(1));
  return { label, elapsedMs, result };
}

const referenceDate = new Date(process.argv[2] ?? "2026-04-20T08:00:00.000Z");
const dataset = buildSeedDataset(referenceDate);
const weekStart = startOfPlannerWeek(referenceDate);

const fullHorizon = measure("full_horizon", () =>
  generateStudyPlanHorizon({
    startWeek: weekStart,
    referenceDate,
    goals: dataset.goals,
    subjects: dataset.subjects,
    topics: dataset.topics,
    completionLogs: [],
    fixedEvents: dataset.fixedEvents,
    sickDays: dataset.sickDays,
    focusedDays: dataset.focusedDays,
    focusedWeeks: dataset.focusedWeeks,
    preferences: dataset.preferences,
  }),
);

const affectedTailWeek = addDays(weekStart, 28);
const currentWeekKey = toDateKey(weekStart);
const tailWeekKey = toDateKey(affectedTailWeek);

const weekLocal = measure("week_local", () =>
  replanStudyPlan({
    weekStart,
    goals: dataset.goals,
    subjects: dataset.subjects,
    topics: dataset.topics,
    completionLogs: [],
    fixedEvents: dataset.fixedEvents,
    sickDays: dataset.sickDays,
    focusedDays: dataset.focusedDays,
    focusedWeeks: dataset.focusedWeeks,
    studyBlocks: fullHorizon.result.studyBlocks.filter((block) => block.weekStart === currentWeekKey),
    preferences: dataset.preferences,
  }),
);

const tailFromWeek = measure("tail_from_week", () =>
  generateStudyPlanHorizon({
    startWeek: affectedTailWeek,
    referenceDate,
    goals: dataset.goals,
    subjects: dataset.subjects,
    topics: dataset.topics,
    completionLogs: [],
    fixedEvents: dataset.fixedEvents,
    sickDays: dataset.sickDays,
    focusedDays: dataset.focusedDays,
    focusedWeeks: dataset.focusedWeeks,
    preferences: dataset.preferences,
    existingStudyBlocks: fullHorizon.result.studyBlocks.filter(
      (block) => block.weekStart < tailWeekKey || block.status === "done" || block.status === "partial",
    ),
    preserveFlexibleFutureBlocks: false,
  }),
);

const tailIncrementalNoop = measure("tail_incremental_noop", () =>
  generateIncrementalStudyPlanTail({
    startWeek: affectedTailWeek,
    referenceDate,
    goals: dataset.goals,
    subjects: dataset.subjects,
    topics: dataset.topics,
    completionLogs: [],
    fixedEvents: dataset.fixedEvents,
    sickDays: dataset.sickDays,
    focusedDays: dataset.focusedDays,
    focusedWeeks: dataset.focusedWeeks,
    preferences: dataset.preferences,
    existingStudyBlocks: fullHorizon.result.studyBlocks,
    existingWeeklyPlans: fullHorizon.result.weeklyPlans,
    preserveFlexibleFutureBlocks: false,
  }),
);

const editedTailBlocks = fullHorizon.result.studyBlocks.map((block) =>
  block.weekStart === tailWeekKey && block.subjectId && block.topicId
    ? {
        ...block,
        notes: `${block.notes} benchmark-edit`.trim(),
      }
    : block,
);

const tailIncrementalChanged = measure("tail_incremental_changed", () =>
  generateIncrementalStudyPlanTail({
    startWeek: affectedTailWeek,
    referenceDate,
    goals: dataset.goals,
    subjects: dataset.subjects,
    topics: dataset.topics,
    completionLogs: [],
    fixedEvents: dataset.fixedEvents,
    sickDays: dataset.sickDays,
    focusedDays: dataset.focusedDays,
    focusedWeeks: dataset.focusedWeeks,
    preferences: dataset.preferences,
    existingStudyBlocks: editedTailBlocks,
    existingWeeklyPlans: fullHorizon.result.weeklyPlans,
    preserveFlexibleFutureBlocks: false,
  }),
);

function buildExtraRecurringFixedEvents(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `benchmark-extra-fixed-${index}`,
    title: `Benchmark fixed event ${index + 1}`,
    start: "2026-05-04T06:00:00.000Z",
    end: "2026-05-04T06:15:00.000Z",
    isAllDay: false,
    recurrence: "weekly" as const,
    daysOfWeek: [1],
    repeatUntil: "2027-06-30",
    flexibility: "fixed" as const,
    category: "activity" as const,
    notes: "",
  }));
}

const fixedEventStress = [50, 200, 500].map((extraFixedEventCount) =>
  measure(`full_horizon_${extraFixedEventCount}_extra_fixed_events`, () =>
    generateStudyPlanHorizon({
      startWeek: weekStart,
      referenceDate,
      goals: dataset.goals,
      subjects: dataset.subjects,
      topics: dataset.topics,
      completionLogs: [],
      fixedEvents: [
        ...dataset.fixedEvents,
        ...buildExtraRecurringFixedEvents(extraFixedEventCount),
      ],
      sickDays: dataset.sickDays,
      focusedDays: dataset.focusedDays,
      focusedWeeks: dataset.focusedWeeks,
      preferences: dataset.preferences,
    }),
  ),
);

const summary = [
  fullHorizon,
  weekLocal,
  tailFromWeek,
  tailIncrementalNoop,
  tailIncrementalChanged,
  ...fixedEventStress,
].map((entry) => {
  const maybeChangedWeekStarts =
    "changedWeekStarts" in entry.result
      ? (entry.result as { changedWeekStarts: string[] }).changedWeekStarts
      : null;

  return {
    scope: entry.label,
    elapsedMs: entry.elapsedMs,
    studyBlocks:
      "studyBlocks" in entry.result ? entry.result.studyBlocks.length : 0,
    weeklyPlans:
      "weeklyPlans" in entry.result
        ? entry.result.weeklyPlans.length
        : entry.label === "week_local"
        ? 1
        : 0,
    changedWeeks: maybeChangedWeekStarts?.length,
  };
});

console.table(summary);
