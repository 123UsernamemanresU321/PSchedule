import { addDays } from "date-fns";

import { startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { buildSeedDataset } from "@/lib/seed";
import { generateStudyPlanHorizon } from "@/lib/scheduler/generator";
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

const summary = [fullHorizon, weekLocal, tailFromWeek].map((entry) => ({
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
}));

console.table(summary);
