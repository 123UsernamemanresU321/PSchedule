import { getAcademicDeadline, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import {
  generateStudyPlanHorizon,
  getPlanningHorizonEndWeek,
  shouldAlwaysPreserveStudyBlockOnRegeneration,
  shouldPreserveStudyBlockOnRegeneration,
} from "@/lib/scheduler/generator";
import { buildSeedDataset } from "@/lib/seed";
import { buildSeedPreferences } from "@/lib/seed/preferences";
import { validateGeneratedHorizon } from "@/lib/scheduler/validation";
import {
  hasLegacySeedFixedEvents,
  stripLegacySeedFixedEvents,
} from "@/lib/seed/fixed-events";
import { hasLegacySeedTopics } from "@/lib/seed/topic-catalog";
import { db } from "@/lib/storage/db";
import { parsePlannerJson } from "@/lib/storage/json-transfer";
import { normalizeTopicProgress } from "@/lib/topics/status";
import { subjectIds, zeroUnscheduledCoverageSubjectIds } from "@/lib/constants/planner";
import { detectFutureFillableGap, getSubjectProgress } from "@/lib/analytics/metrics";
import { createId } from "@/lib/utils";
import type {
  CompletionLog,
  FocusedDay,
  FocusedWeek,
  PlannerExportPayload,
  PlannerReplanScope,
  Preferences,
  SeedDataset,
  SickDay,
  StudyBlock,
  SubjectId,
  WeeklyPlan,
} from "@/lib/types/planner";

const PLANNING_MODEL_VERSION = "2026-04-30-olympiad-french-maths-v57";
const CPP_BOOK_SUBJECT_ID = "cpp-book";
const OLYMPIAD_SUBJECT_ID = "olympiad";
const OLYMPIAD_ROADMAP_VERSION = "2026-04-30-olympiad-final-june-v12";
const PREFERENCE_DEFAULTS_VERSION = "2026-04-29-tight-packing-no-breaks-v3";
const EXTENDED_GOALS_VERSION = "2026-04-30-paper-frontiers-v9";
const LANGUAGE_MAINTENANCE_VERSION = "2026-04-30-french-grammar-cap-v3";
const SEED_TOPIC_ORDERING_VERSION = "2026-04-30-paper-frontiers-v6";
const LEGACY_OLYMPIAD_DEFAULT_PRIORITY = 0.85;
const LEGACY_CPP_BOOK_DEFAULT_PRIORITY = 0.45;
const MIN_HEALTHY_SCHEDULED_COVERAGE_RATIO = 0.999;
const PLANNING_SYNC_SUBJECT_IDS: SubjectId[] = [
  "physics-hl",
  "maths-aa-hl",
  "chemistry-hl",
  "olympiad",
  "cpp-book",
  "french-b-sl",
  "geography-transition",
];

function normalizeLockedRecoveryWindows(
  preferences: Partial<Preferences> | null | undefined,
  seedPreferences: Preferences,
) {
  const rawLockedRecoveryWindows = Array.isArray(preferences?.lockedRecoveryWindows)
    ? preferences.lockedRecoveryWindows
    : [];
  const mergedWindows = new Map(
    seedPreferences.lockedRecoveryWindows.map((window) => [window.label, window]),
  );

  rawLockedRecoveryWindows.forEach((window) => {
    if (!window || typeof window !== "object" || typeof window.label !== "string") {
      return;
    }

    mergedWindows.set(window.label, {
      ...(mergedWindows.get(window.label) ?? {}),
      ...window,
    });
  });

  return Array.from(mergedWindows.entries()).map(([label, window]) => {
    const seedWindow =
      seedPreferences.lockedRecoveryWindows.find((candidate) => candidate.label === label) ?? window;
    const normalizedDays = normalizeDays(window.days, seedWindow.days);
    const normalizedTimeOverrides = Object.fromEntries(
      Object.entries(window.timeOverrides ?? {})
        .filter(
          ([dateKey, override]) =>
            typeof dateKey === "string" &&
            !!override &&
            typeof override.start === "string" &&
            typeof override.end === "string" &&
            override.start.length > 0 &&
            override.end.length > 0,
        )
        .sort(([left], [right]) => left.localeCompare(right)),
    );

    if (
      window.label === "Lunch break" &&
      window.start === "12:00" &&
      window.end === "13:30"
    ) {
      return {
        ...window,
        days: [0, 1, 2, 3, 4, 5, 6],
        movable: false,
        timeOverrides: normalizedTimeOverrides,
      };
    }

    if (
      window.label === "Dinner reset" &&
      window.start === "19:15" &&
      window.end === "20:00"
    ) {
      return {
        ...window,
        days: [0, 1, 2, 3, 4, 5, 6],
        movable: true,
        timeOverrides: normalizedTimeOverrides,
      };
    }

    if (
      window.label === "Sunday recovery" &&
      (window.start === "18:00" || window.start === "20:00") &&
      window.end === "22:00" &&
      normalizedDays.length === 1 &&
      normalizedDays[0] === 0
    ) {
      return {
        ...window,
        start: "21:30",
        end: "22:30",
        days: normalizedDays,
        timeOverrides: normalizedTimeOverrides,
      };
    }

    return {
      ...window,
      days: normalizedDays,
      timeOverrides: normalizedTimeOverrides,
    };
  });
}

function normalizeReservedCommitmentRules(
  preferences: Partial<Preferences> | null | undefined,
  seedPreferences: Preferences,
) {
  const rawReservedCommitmentRules = Array.isArray(preferences?.reservedCommitmentRules)
    ? preferences.reservedCommitmentRules
    : [];

  if (!rawReservedCommitmentRules.length) {
    return seedPreferences.reservedCommitmentRules;
  }

  const mergedRules = new Map(
    seedPreferences.reservedCommitmentRules.map((rule) => [rule.id, rule]),
  );

  rawReservedCommitmentRules.forEach((rule) => {
    if (!rule || typeof rule !== "object" || typeof rule.id !== "string") {
      return;
    }

    mergedRules.set(rule.id, {
      ...(mergedRules.get(rule.id) ?? {}),
      ...rule,
    });
  });

  return Array.from(mergedRules.entries()).map(([ruleId, rule]) => {
    const seedRule =
      seedPreferences.reservedCommitmentRules.find((candidate) => candidate.id === ruleId) ?? rule;

    const normalizedRule = {
      ...rule,
      days: normalizeDays(rule.days, seedRule.days),
      additionalDates: Array.isArray(rule.additionalDates)
        ? Array.from(new Set(rule.additionalDates)).sort((left, right) =>
            left.localeCompare(right),
          )
        : [],
      excludedDates: Array.isArray(rule.excludedDates)
        ? Array.from(new Set(rule.excludedDates)).sort((left, right) =>
            left.localeCompare(right),
          )
        : [],
      durationOverrides: Object.fromEntries(
        Object.entries(rule.durationOverrides ?? {})
          .filter(([, minutes]) => Number.isFinite(minutes) && minutes >= 0)
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
      timeOverrides: Object.fromEntries(
        Object.entries(rule.timeOverrides ?? {})
          .filter(
            ([dateKey, override]) =>
              typeof dateKey === "string" &&
              !!override &&
              typeof override.start === "string" &&
              override.start.length > 0,
          )
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    };

    if (ruleId === "term-homework") {
      const recurringHomeworkDays = Array.from(
        new Set([0, ...normalizeDays(
          preferences?.schoolSchedule?.weekdays,
          seedPreferences.schoolSchedule.weekdays,
        )]),
      ).sort((left, right) => left - right);

      return {
        ...normalizedRule,
        label: seedRule.label,
        durationMinutes: seedRule.durationMinutes,
        days: recurringHomeworkDays,
        appliesDuring: seedRule.appliesDuring,
      };
    }

    return normalizedRule;
  });
}

function normalizeFixedEvent(event: PlannerExportPayload["fixedEvents"][number]) {
  return {
    ...event,
    isAllDay: event.isAllDay ?? false,
    excludedDates: event.excludedDates?.length
      ? Array.from(new Set(event.excludedDates)).sort((left, right) => left.localeCompare(right))
      : undefined,
  };
}

export function normalizeStudyBlock(block: StudyBlock) {
  const start = new Date(block.start);
  const isLegacyManualReassignment = block.generatedReason.startsWith(
    "Manually reassigned in the study-block drawer",
  );
  const isLegacyManualEditorBlock =
    block.generatedReason.startsWith("Manually edited in the study-block editor") ||
    block.generatedReason.startsWith("Manually added in the study-block editor");
  const creationSource =
    block.creationSource ??
    (isLegacyManualReassignment || isLegacyManualEditorBlock ? "manual" : "planner");
  const normalizedGeneratedReason = isLegacyManualReassignment
    ? block.generatedReason.replace(
        "The rest of the horizon was rebuilt around this locked block.",
        "The horizon was rebuilt around this change, but future regenerations can still move or retarget the block.",
      )
    : block.generatedReason;
  const assignmentLocked = isLegacyManualReassignment ? false : block.assignmentLocked ?? false;
  const followUpKind = block.followUpKind ?? null;
  const followUpSourceStudyBlockId = block.followUpSourceStudyBlockId ?? null;
  const followUpDueAt = block.followUpDueAt ?? null;
  const studyLayer = block.studyLayer ?? null;
  const isFlexiblePlanningBlock =
    !followUpKind &&
    !assignmentLocked &&
    block.status !== "done" &&
    block.status !== "partial";

  return {
    ...block,
    date: toDateKey(start),
    weekStart: toDateKey(startOfPlannerWeek(start)),
    generatedReason: normalizedGeneratedReason,
    assignmentLocked,
    assignmentEditedAt: block.assignmentEditedAt ?? null,
    studyLayer,
    followUpKind,
    followUpSourceStudyBlockId,
    followUpDueAt,
    creationSource,
    isAutoGenerated:
      isFlexiblePlanningBlock ? true : block.isAutoGenerated,
  } satisfies StudyBlock;
}

function isStudyBlockActiveAt(block: Pick<StudyBlock, "start" | "end">, referenceDate: Date) {
  const blockStart = new Date(block.start).getTime();
  const blockEnd = new Date(block.end).getTime();
  const now = referenceDate.getTime();
  return blockStart <= now && now < blockEnd;
}

function collectActiveStudyBlockIds(studyBlocks: StudyBlock[], referenceDate: Date) {
  return studyBlocks
    .filter(
      (block) =>
        ["planned", "rescheduled"].includes(block.status) &&
        isStudyBlockActiveAt(block, referenceDate),
    )
    .map((block) => block.id);
}

async function autoMarkExpiredUncompletedStudyBlocks(referenceDate = new Date()) {
  const expiredBlocks = (await db.studyBlocks.toArray())
    .map(normalizeStudyBlock)
    .filter(
      (block) =>
        !!block.subjectId &&
        (!!block.topicId || !!block.followUpKind) &&
        ["planned", "rescheduled"].includes(block.status) &&
        new Date(block.end).getTime() <= referenceDate.getTime() &&
        !isStudyBlockActiveAt(block, referenceDate),
    );

  if (!expiredBlocks.length) {
    return false;
  }

  const existingLogs = await db.completionLogs.toArray();
  const loggedStudyBlockIds = new Set(existingLogs.map((log) => log.studyBlockId));
  const nextBlocks = expiredBlocks.map((block) =>
    normalizeStudyBlock({
      ...block,
      status: "missed",
      actualMinutes: 0,
    }),
  );
  const missingLogs = expiredBlocks
    .filter((block) => !loggedStudyBlockIds.has(block.id))
    .map(
      (block) =>
        ({
          id: createId("log"),
          studyBlockId: block.id,
          outcome: "missed",
          actualMinutes: 0,
          perceivedDifficulty: 3,
          notes: "Auto-marked missed after the block ended without completion being recorded.",
          recordedAt: referenceDate.toISOString(),
        }) satisfies CompletionLog,
    );

  await db.transaction("rw", [db.studyBlocks, db.completionLogs], async () => {
    await db.studyBlocks.bulkPut(nextBlocks);
    if (missingLogs.length) {
      await db.completionLogs.bulkPut(missingLogs);
    }
  });

  return true;
}

function normalizeSickDay(sickDay: SickDay) {
  const [startDate, endDate] = [sickDay.startDate, sickDay.endDate].sort((left, right) =>
    left.localeCompare(right),
  );

  return {
    ...sickDay,
    startDate,
    endDate,
  } satisfies SickDay;
}

function normalizeFocusedDay(focusedDay: FocusedDay) {
  return {
    ...focusedDay,
    date: focusedDay.date,
    subjectIds: Array.from(
      new Set(
        focusedDay.subjectIds.filter((subjectId): subjectId is SubjectId =>
          subjectIds.includes(subjectId as SubjectId),
        ),
      ),
    ).sort((left, right) => left.localeCompare(right)) as SubjectId[],
  } satisfies FocusedDay;
}

function normalizeFocusedWeek(focusedWeek: FocusedWeek) {
  return {
    ...focusedWeek,
    weekStart: toDateKey(startOfPlannerWeek(new Date(`${focusedWeek.weekStart}T00:00:00`))),
    subjectIds: Array.from(
      new Set(
        focusedWeek.subjectIds.filter((subjectId): subjectId is SubjectId =>
          subjectIds.includes(subjectId as SubjectId),
        ),
      ),
    ).sort((left, right) => left.localeCompare(right)) as SubjectId[],
  } satisfies FocusedWeek;
}

function normalizeDays(days: unknown, fallbackDays: number[]) {
  if (!Array.isArray(days)) {
    return fallbackDays;
  }

  const normalizedDays = Array.from(
    new Set(
      days.filter(
        (day): day is number =>
          Number.isInteger(day) && day >= 0 && day <= 6,
      ),
    ),
  ).sort((left, right) => left - right);

  return normalizedDays.length ? normalizedDays : fallbackDays;
}

function normalizeNoSchoolDays(
  value: unknown,
): Preferences["schoolSchedule"]["noSchoolDays"] {
  if (!Array.isArray(value)) {
    return [];
  }

  const byDate = new Map<string, Preferences["schoolSchedule"]["noSchoolDays"][number]>();

  value.forEach((entry) => {
    if (!entry || typeof entry !== "object") {
      return;
    }

    const candidate = entry as Partial<Preferences["schoolSchedule"]["noSchoolDays"][number]>;
    if (typeof candidate.date !== "string" || !candidate.date.trim()) {
      return;
    }

    byDate.set(candidate.date, {
      id: typeof candidate.id === "string" && candidate.id ? candidate.id : createId("no-school"),
      date: candidate.date,
      label:
        typeof candidate.label === "string" && candidate.label.trim()
          ? candidate.label.trim()
          : "No School",
      notes:
        typeof candidate.notes === "string" && candidate.notes.trim()
          ? candidate.notes.trim()
          : undefined,
    });
  });

  return Array.from(byDate.values()).sort((left, right) => left.date.localeCompare(right.date));
}

function normalizeTimeWindows<T extends Preferences["preferredDeepWorkWindows"][number]>(
  timeWindows: unknown,
  seedTimeWindows: T[],
) {
  if (!Array.isArray(timeWindows) || !timeWindows.length) {
    return seedTimeWindows;
  }

  return timeWindows.map((timeWindow, index) => {
    const seedTimeWindow = seedTimeWindows[index % seedTimeWindows.length];
    const timeWindowPatch =
      timeWindow && typeof timeWindow === "object"
        ? (timeWindow as Partial<T> & { days?: unknown })
        : ({} as Partial<T> & { days?: unknown });
    return {
      ...seedTimeWindow,
      ...timeWindowPatch,
      days: normalizeDays(timeWindowPatch.days, seedTimeWindow.days),
    };
  });
}

export function normalizePreferences(preferences?: Partial<Preferences> | null): Preferences {
  const seedPreferences = buildSeedPreferences();
  const schoolSchedule: Partial<Preferences["schoolSchedule"]> =
    preferences?.schoolSchedule && typeof preferences.schoolSchedule === "object"
      ? preferences.schoolSchedule
      : {};
  const holidaySchedule: Partial<Preferences["holidaySchedule"]> =
    preferences?.holidaySchedule && typeof preferences.holidaySchedule === "object"
      ? preferences.holidaySchedule
      : {};
  const sundayStudy: Partial<Preferences["sundayStudy"]> =
    preferences?.sundayStudy && typeof preferences.sundayStudy === "object"
      ? preferences.sundayStudy
      : {};
  const subjectWeightOverrides = {
    ...seedPreferences.subjectWeightOverrides,
    ...(preferences?.subjectWeightOverrides ?? {}),
  };

  if (subjectWeightOverrides.olympiad === LEGACY_OLYMPIAD_DEFAULT_PRIORITY) {
    subjectWeightOverrides.olympiad = seedPreferences.subjectWeightOverrides.olympiad;
  }

  if (subjectWeightOverrides[CPP_BOOK_SUBJECT_ID] === LEGACY_CPP_BOOK_DEFAULT_PRIORITY) {
    subjectWeightOverrides[CPP_BOOK_SUBJECT_ID] =
      seedPreferences.subjectWeightOverrides[CPP_BOOK_SUBJECT_ID];
  }

  return {
    ...seedPreferences,
    ...preferences,
    breaksEnabled: preferences?.breaksEnabled ?? seedPreferences.breaksEnabled,
    dailyStudyWindow: {
      ...seedPreferences.dailyStudyWindow,
      ...(preferences?.dailyStudyWindow ?? {}),
    },
    subjectWeightOverrides,
    preferredDeepWorkWindows: normalizeTimeWindows(
      preferences?.preferredDeepWorkWindows,
      seedPreferences.preferredDeepWorkWindows,
    ),
    lockedRecoveryWindows: normalizeLockedRecoveryWindows(
      preferences,
      seedPreferences,
    ),
    reservedCommitmentRules: normalizeReservedCommitmentRules(
      preferences,
      seedPreferences,
    ),
    schoolSchedule: {
      ...seedPreferences.schoolSchedule,
      ...schoolSchedule,
      weekdays: normalizeDays(
        schoolSchedule.weekdays,
        seedPreferences.schoolSchedule.weekdays,
      ),
      terms:
        Array.isArray(schoolSchedule.terms) && schoolSchedule.terms.length
          ? schoolSchedule.terms.map((term, index) => ({
              ...seedPreferences.schoolSchedule.terms[index % seedPreferences.schoolSchedule.terms.length],
              ...(term ?? {}),
            }))
          : seedPreferences.schoolSchedule.terms,
      noSchoolDays: normalizeNoSchoolDays(schoolSchedule.noSchoolDays),
    },
    holidaySchedule: {
      ...seedPreferences.holidaySchedule,
      ...holidaySchedule,
      dailyStudyWindow: {
        ...seedPreferences.holidaySchedule.dailyStudyWindow,
        ...(holidaySchedule.dailyStudyWindow ?? {}),
      },
      preferredDeepWorkWindows: normalizeTimeWindows(
        holidaySchedule.preferredDeepWorkWindows,
        seedPreferences.holidaySchedule.preferredDeepWorkWindows,
      ),
    },
    sundayStudy: {
      ...seedPreferences.sundayStudy,
      ...sundayStudy,
      workloadIntensity:
        sundayStudy.workloadIntensity ?? seedPreferences.sundayStudy.workloadIntensity,
    },
  };
}

async function migrateLegacyPreferenceDefaults(snapshot: PlannerSnapshot) {
  const defaultsVersion = await db.meta.get("preferences-defaults-version");
  if (defaultsVersion?.value === PREFERENCE_DEFAULTS_VERSION) {
    return snapshot;
  }

  const normalizedPreferences = {
    ...normalizePreferences(snapshot.preferences),
    breaksEnabled: false,
    minBreakMinutes: 0,
  };

  await db.transaction("rw", [db.preferences, db.meta], async () => {
    await db.preferences.put(normalizedPreferences);
    await db.meta.put({
      key: "preferences-defaults-version",
      value: PREFERENCE_DEFAULTS_VERSION,
    });
  });

  return loadPlannerSnapshot();
}

function normalizeWeeklyPlan(
  weeklyPlan: PlannerExportPayload["weeklyPlans"][number],
  referenceDate: Date,
) {
  const emptyBySubject = subjectIds.reduce<Record<string, number>>((accumulator, subjectId) => {
    accumulator[subjectId] = 0;
    return accumulator;
  }, {});
  const horizonEndDate = toDateKey(getAcademicDeadline(referenceDate));

  return {
    ...weeklyPlan,
    deadlinePaceHoursBySubject: {
      ...emptyBySubject,
      ...weeklyPlan.requiredHoursBySubject,
      ...weeklyPlan.deadlinePaceHoursBySubject,
    },
    assignedHoursBySubject: {
      ...emptyBySubject,
      ...weeklyPlan.assignedHoursBySubject,
    },
    completedHoursBySubject: {
      ...emptyBySubject,
      ...weeklyPlan.completedHoursBySubject,
    },
    remainingHoursBySubject: {
      ...emptyBySubject,
      ...weeklyPlan.remainingHoursBySubject,
    },
    remainingAfterWeekMinutesBySubject: {
      ...emptyBySubject,
      ...weeklyPlan.remainingAfterWeekMinutesBySubject,
    },
    weekPacingGapMinutesBySubject: {
      ...emptyBySubject,
      ...weeklyPlan.weekPacingGapMinutesBySubject,
    },
    scheduledToGoalHoursBySubject: {
      ...emptyBySubject,
      ...weeklyPlan.scheduledToGoalHoursBySubject,
    },
    weekCarryForwardSubjectIds: weeklyPlan.weekCarryForwardSubjectIds ?? [],
    fallbackTierUsed: weeklyPlan.fallbackTierUsed ?? 0,
    forcedCoverageMinutes: weeklyPlan.forcedCoverageMinutes ?? 0,
    usedSundayMinutes: weeklyPlan.usedSundayMinutes ?? 0,
    weekHasOpenCapacity: weeklyPlan.weekHasOpenCapacity ?? (weeklyPlan.slackMinutes ?? 0) > 0,
    weekOverloadMinutes: weeklyPlan.weekOverloadMinutes ?? weeklyPlan.overscheduledMinutes ?? 0,
    overscheduledMinutes: weeklyPlan.overscheduledMinutes ?? 0,
    fillableGapDateKeys: Array.from(new Set(weeklyPlan.fillableGapDateKeys ?? [])).sort((left, right) =>
      left.localeCompare(right),
    ),
    effectiveReservedCommitmentDurations: Array.from(
      new Map(
        (weeklyPlan.effectiveReservedCommitmentDurations ?? []).map((entry) => [
          `${entry.dateKey}:${entry.ruleId}`,
          {
            dateKey: entry.dateKey,
            ruleId: entry.ruleId,
            durationMinutes: Math.max(0, entry.durationMinutes),
          },
        ]),
      ).values(),
    ).sort(
      (left, right) =>
        left.dateKey.localeCompare(right.dateKey) ||
        left.ruleId.localeCompare(right.ruleId),
    ),
    excludedReservedCommitmentRuleIds: Array.from(
      new Set(weeklyPlan.excludedReservedCommitmentRuleIds ?? []),
    ).sort((left, right) => left.localeCompare(right)),
    replanDiagnostics: weeklyPlan.replanDiagnostics
      ? {
          scope: weeklyPlan.replanDiagnostics.scope,
          escalationPath: Array.from(new Set(weeklyPlan.replanDiagnostics.escalationPath)),
          totalGenerationMs: Math.max(0, weeklyPlan.replanDiagnostics.totalGenerationMs),
          scopeTimingsMs: Object.fromEntries(
            Object.entries(weeklyPlan.replanDiagnostics.scopeTimingsMs ?? {}).filter(
              ([, value]) => typeof value === "number" && Number.isFinite(value) && value >= 0,
            ),
          ),
          repairTriggered: weeklyPlan.replanDiagnostics.repairTriggered ?? false,
          hardCoverageEscalationForced:
            weeklyPlan.replanDiagnostics.hardCoverageEscalationForced ?? false,
          localApplyMs:
            typeof weeklyPlan.replanDiagnostics.localApplyMs === "number" &&
            Number.isFinite(weeklyPlan.replanDiagnostics.localApplyMs) &&
            weeklyPlan.replanDiagnostics.localApplyMs >= 0
              ? weeklyPlan.replanDiagnostics.localApplyMs
              : null,
          precheckMs:
            typeof weeklyPlan.replanDiagnostics.precheckMs === "number" &&
            Number.isFinite(weeklyPlan.replanDiagnostics.precheckMs) &&
            weeklyPlan.replanDiagnostics.precheckMs >= 0
              ? weeklyPlan.replanDiagnostics.precheckMs
              : null,
          writeMs:
            typeof weeklyPlan.replanDiagnostics.writeMs === "number" &&
            Number.isFinite(weeklyPlan.replanDiagnostics.writeMs) &&
            weeklyPlan.replanDiagnostics.writeMs >= 0
              ? weeklyPlan.replanDiagnostics.writeMs
              : null,
          snapshotLoadMs:
            typeof weeklyPlan.replanDiagnostics.snapshotLoadMs === "number" &&
            Number.isFinite(weeklyPlan.replanDiagnostics.snapshotLoadMs) &&
            weeklyPlan.replanDiagnostics.snapshotLoadMs >= 0
              ? weeklyPlan.replanDiagnostics.snapshotLoadMs
              : null,
          repairMs:
            typeof weeklyPlan.replanDiagnostics.repairMs === "number" &&
            Number.isFinite(weeklyPlan.replanDiagnostics.repairMs) &&
            weeklyPlan.replanDiagnostics.repairMs >= 0
              ? weeklyPlan.replanDiagnostics.repairMs
              : null,
          backgroundValidationMs:
            typeof weeklyPlan.replanDiagnostics.backgroundValidationMs === "number" &&
            Number.isFinite(weeklyPlan.replanDiagnostics.backgroundValidationMs) &&
            weeklyPlan.replanDiagnostics.backgroundValidationMs >= 0
              ? weeklyPlan.replanDiagnostics.backgroundValidationMs
              : null,
          escalationReason:
            weeklyPlan.replanDiagnostics.escalationReason ?? null,
        }
      : null,
    weeksRemainingToDeadline: weeklyPlan.weeksRemainingToDeadline ?? 1,
    horizonEndDate: weeklyPlan.horizonEndDate ?? horizonEndDate,
  };
}

export interface PlannerSnapshot {
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
  preferences: Preferences;
}

function getScopedWeekStarts(
  snapshot: PlannerSnapshot,
  scope: PlannerReplanScope,
  affectedWeekStart: Date,
) {
  const affectedWeekKey = toDateKey(startOfPlannerWeek(affectedWeekStart));

  if (scope === "week_local") {
    return [affectedWeekKey];
  }

  return snapshot.weeklyPlans
    .map((weeklyPlan) => weeklyPlan.weekStart)
    .filter((weekStart) => weekStart >= affectedWeekKey)
    .sort((left, right) => left.localeCompare(right));
}

export function getScopedReplanPrecheckState(options: {
  snapshot: PlannerSnapshot;
  scope: PlannerReplanScope;
  affectedWeekStart: Date;
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const affectedWeekKey = toDateKey(startOfPlannerWeek(options.affectedWeekStart));
  const relevantWeekStarts = getScopedWeekStarts(
    options.snapshot,
    options.scope,
    options.affectedWeekStart,
  );
  const relevantWeekStartSet = new Set(relevantWeekStarts);
  const relevantWeeklyPlans = options.snapshot.weeklyPlans.filter((weeklyPlan) =>
    relevantWeekStartSet.has(weeklyPlan.weekStart),
  );
  const relevantStudyBlocks = options.snapshot.studyBlocks.filter((block) => {
    const weekStart = block.weekStart || toDateKey(startOfPlannerWeek(new Date(block.start)));
    return relevantWeekStartSet.has(weekStart);
  });
  const invalidOverlapIssues = validateGeneratedHorizon({
    studyBlocks: relevantStudyBlocks,
    topics: options.snapshot.topics,
    weeklyPlans: relevantWeeklyPlans,
    fixedEvents: options.snapshot.fixedEvents,
    preferences: options.snapshot.preferences,
    sickDays: options.snapshot.sickDays,
    referenceDate,
  }).filter((issue) => issue.severity === "error" && issue.code === "overlap");
  const hasFutureFillableGap = relevantWeeklyPlans.some((weeklyPlan) => {
    if (weeklyPlan.fillableGapDateKeys.length === 0) {
      return false;
    }

    return zeroUnscheduledCoverageSubjectIds.some(
      (subjectId) => (weeklyPlan.remainingAfterWeekMinutesBySubject[subjectId] ?? 0) > 0,
    );
  });
  const hardConstraintSubjectIds = options.snapshot.subjects
    .filter((subject) =>
      zeroUnscheduledCoverageSubjectIds.includes(
        subject.id as (typeof zeroUnscheduledCoverageSubjectIds)[number],
      ),
    )
    .map((subject) => ({
      subjectId: subject.id,
      progress: getSubjectProgress(subject, options.snapshot.topics, options.snapshot.studyBlocks, referenceDate),
    }))
    .filter(({ progress }) => progress.remainingMinutes > 0 && progress.unscheduledMinutes > 0)
    .map(({ subjectId }) => subjectId);
  const missingScopedWeeks =
    options.scope !== "week_local" &&
    relevantWeekStarts.length === 0 &&
    options.snapshot.weeklyPlans.every((weeklyPlan) => weeklyPlan.weekStart < affectedWeekKey);
  const escalationReason = hardConstraintSubjectIds.length
    ? "hard_coverage"
    : hasFutureFillableGap
    ? "fillable_gap"
    : invalidOverlapIssues.length > 0
    ? "overlap"
    : missingScopedWeeks
    ? "collapsed_coverage"
    : null;

  return {
    relevantWeekStarts,
    invalidOverlapIssues,
    hasFutureFillableGap,
    hardConstraintSubjectIds,
    missingScopedWeeks,
    hasPotentialIssue:
      hardConstraintSubjectIds.length > 0 ||
      hasFutureFillableGap ||
      invalidOverlapIssues.length > 0 ||
      missingScopedWeeks,
    escalationReason,
  };
}

export function getCollapsedCoverageRepairState(
  snapshot: PlannerSnapshot,
  referenceDate = new Date(),
) {
  const invalidOverlapIssues = validateGeneratedHorizon({
    studyBlocks: snapshot.studyBlocks,
    topics: snapshot.topics,
    weeklyPlans: snapshot.weeklyPlans,
    fixedEvents: snapshot.fixedEvents,
    preferences: snapshot.preferences,
    sickDays: snapshot.sickDays,
    referenceDate,
  }).filter((issue) => issue.severity === "error" && issue.code === "overlap");
  const invalidOverlapBlockIds = Array.from(
    new Set(
      invalidOverlapIssues
        .map((issue) => issue.blockId)
        .filter((blockId): blockId is string => typeof blockId === "string" && blockId.length > 0),
    ),
  );
  const states = snapshot.subjects
    .map((subject) => {
      const progress = getSubjectProgress(subject, snapshot.topics, snapshot.studyBlocks, referenceDate);
      const futureBlocks = snapshot.studyBlocks.filter(
        (block) =>
          block.subjectId === subject.id &&
          ["planned", "rescheduled"].includes(block.status) &&
          new Date(block.end).getTime() > referenceDate.getTime(),
      );
      const futureTopicBlocks = futureBlocks.filter((block) => !!block.topicId);
      const scheduledCoverageRatio =
        progress.scheduledFutureMinutes / Math.max(progress.remainingMinutes, 1);
      const futureTopicHours =
        futureTopicBlocks.reduce((total, block) => total + block.estimatedMinutes, 0);
      const topicCoverageRatio = futureTopicHours / Math.max(progress.remainingMinutes, 1);
      const isCoreCoverageSubject = zeroUnscheduledCoverageSubjectIds.includes(
        subject.id as (typeof zeroUnscheduledCoverageSubjectIds)[number],
      );
      const hasMeaningfulUnscheduledWork =
        progress.remainingMinutes > 0 && progress.unscheduledMinutes > 0;
      const hasStrictIncompleteCoverage =
        isCoreCoverageSubject &&
        progress.unscheduledMinutes > 0;
      const hasNearZeroCoverage =
        progress.remainingMinutes > 60 &&
        progress.unscheduledMinutes > Math.max(60, progress.remainingMinutes - 60) &&
        (progress.scheduledFutureMinutes < 30 || futureTopicBlocks.length === 0);
      const hasCollapsedPartialCoverage =
        progress.remainingMinutes > 120 &&
        progress.unscheduledMinutes > 0 &&
        (
          scheduledCoverageRatio < MIN_HEALTHY_SCHEDULED_COVERAGE_RATIO ||
          topicCoverageRatio < MIN_HEALTHY_SCHEDULED_COVERAGE_RATIO
        );

      return {
        subjectId: subject.id,
        progress,
        futureBlocks,
        futureTopicBlocks,
        scheduledCoverageRatio,
        topicCoverageRatio,
        hasStrictIncompleteCoverage,
        isCollapsed:
          isCoreCoverageSubject &&
          (
            hasStrictIncompleteCoverage ||
            (hasMeaningfulUnscheduledWork &&
              (hasNearZeroCoverage || hasCollapsedPartialCoverage))
          ),
      };
    });
  const collapsedSubjectIds = states
    .filter((state) => state.isCollapsed)
    .map((state) => state.subjectId);
  const hardConstraintSubjectIds = states
    .filter((state) => state.hasStrictIncompleteCoverage)
    .map((state) => state.subjectId);
  const futureFillableGap = detectFutureFillableGap({
    subjects: snapshot.subjects,
    topics: snapshot.topics,
    studyBlocks: snapshot.studyBlocks,
    weeklyPlans: snapshot.weeklyPlans,
    fixedEvents: snapshot.fixedEvents,
    sickDays: snapshot.sickDays,
    completionLogs: snapshot.completionLogs,
    preferences: snapshot.preferences,
    referenceDate,
    subjectIds: [...zeroUnscheduledCoverageSubjectIds],
  });

  return {
    states,
    collapsedSubjectIds,
    hardConstraintSubjectIds,
    futureFillableGap,
    invalidOverlapIssues,
    invalidOverlapBlockIds,
    hasHardConstraintCoverageFailure: hardConstraintSubjectIds.length > 0 || futureFillableGap.hasGap,
    hasCollapsedCoverage:
      collapsedSubjectIds.length > 0 ||
      invalidOverlapIssues.length > 0 ||
      futureFillableGap.hasGap,
  };
}

export function buildCollapsedCoverageRepairBaselineStudyBlocks(
  studyBlocks: StudyBlock[],
  referenceDate = new Date(),
  preservedStudyBlockIds: string[] = [],
  invalidOverlapBlockIds: string[] = [],
) {
  const preservedIds = new Set(preservedStudyBlockIds);
  const invalidFutureOverlapIds = new Set(invalidOverlapBlockIds);

  return studyBlocks.filter((block) => {
    if (preservedIds.has(block.id)) {
      return true;
    }

    if (new Date(block.end).getTime() <= referenceDate.getTime()) {
      return true;
    }

    if (invalidFutureOverlapIds.has(block.id)) {
      return false;
    }

    return shouldAlwaysPreserveStudyBlockOnRegeneration(block);
  });
}

export function buildHardConstraintFutureResetBaselineStudyBlocks(
  studyBlocks: StudyBlock[],
  referenceDate = new Date(),
  preservedStudyBlockIds: string[] = [],
) {
  const preservedIds = new Set(preservedStudyBlockIds);

  return studyBlocks.filter((block) => {
    if (preservedIds.has(block.id)) {
      return true;
    }

    return new Date(block.end).getTime() <= referenceDate.getTime();
  });
}

export async function repairCollapsedCoveragePlanningState(referenceDate = new Date()) {
  await autoMarkExpiredUncompletedStudyBlocks(referenceDate);
  const snapshot = await loadPlannerSnapshot();
  const repairState = getCollapsedCoverageRepairState(snapshot, referenceDate);

  if (!repairState.hasCollapsedCoverage) {
    return snapshot;
  }

  return syncPlanningSubjectsToCurrentSeed(snapshot, referenceDate);
}

async function ensureCurrentWeekPlan(snapshot: PlannerSnapshot, referenceDate: Date) {
  const weekStart = startOfPlannerWeek(referenceDate);
  const weekStartKey = toDateKey(weekStart);
  const horizonEndWeekKey = toDateKey(
    getPlanningHorizonEndWeek(snapshot.goals, snapshot.subjects, referenceDate),
  );
  let workingSnapshot = snapshot;
  const preservedStudyBlockIds = collectActiveStudyBlockIds(workingSnapshot.studyBlocks, referenceDate);
  let repairState = getCollapsedCoverageRepairState(workingSnapshot, referenceDate);

  if (
    !repairState.hasCollapsedCoverage &&
    workingSnapshot.weeklyPlans.some((plan) => plan.weekStart === weekStartKey) &&
    workingSnapshot.weeklyPlans.some((plan) => plan.weekStart === horizonEndWeekKey) &&
    !workingSnapshot.weeklyPlans.some((plan) => plan.weekStart > horizonEndWeekKey)
  ) {
    return workingSnapshot;
  }

  if (repairState.hasCollapsedCoverage) {
    workingSnapshot = await syncPlanningSubjectsToCurrentSeed(workingSnapshot, referenceDate);
    repairState = getCollapsedCoverageRepairState(workingSnapshot, referenceDate);
  }

  const existingStudyBlocks = repairState.hasCollapsedCoverage
    ? repairState.hasHardConstraintCoverageFailure
      ? buildHardConstraintFutureResetBaselineStudyBlocks(
          workingSnapshot.studyBlocks,
          referenceDate,
          preservedStudyBlockIds,
        )
      : buildCollapsedCoverageRepairBaselineStudyBlocks(
          workingSnapshot.studyBlocks,
          referenceDate,
          preservedStudyBlockIds,
          repairState.invalidOverlapBlockIds,
        )
    : workingSnapshot.studyBlocks;

  const replanned = generateStudyPlanHorizon({
    startWeek: weekStart,
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
    existingStudyBlocks,
    preservedStudyBlockIds,
    preserveFlexibleFutureBlocks: repairState.hasCollapsedCoverage ? false : undefined,
  });

  await replacePlanningHorizon(replanned.studyBlocks, replanned.weeklyPlans, weekStartKey, {
    preservedStudyBlockIds,
    preserveFlexibleFutureBlocks: repairState.hasCollapsedCoverage ? false : undefined,
    aggressiveFutureReset: repairState.hasCollapsedCoverage,
  });
  let nextSnapshot = await loadPlannerSnapshot();
  if (!getCollapsedCoverageRepairState(nextSnapshot, referenceDate).hasCollapsedCoverage) {
    return nextSnapshot;
  }

  nextSnapshot = await syncPlanningSubjectsToCurrentSeed(nextSnapshot, referenceDate);
  const repaired = generateStudyPlanHorizon({
    startWeek: weekStart,
    referenceDate,
    goals: nextSnapshot.goals,
    subjects: nextSnapshot.subjects,
    topics: nextSnapshot.topics,
    completionLogs: nextSnapshot.completionLogs,
    fixedEvents: nextSnapshot.fixedEvents,
    sickDays: nextSnapshot.sickDays,
    focusedDays: nextSnapshot.focusedDays,
    focusedWeeks: nextSnapshot.focusedWeeks,
    preferences: nextSnapshot.preferences,
    existingStudyBlocks: getCollapsedCoverageRepairState(nextSnapshot, referenceDate)
      .hasHardConstraintCoverageFailure
      ? buildHardConstraintFutureResetBaselineStudyBlocks(
          nextSnapshot.studyBlocks,
          referenceDate,
          preservedStudyBlockIds,
        )
      : buildCollapsedCoverageRepairBaselineStudyBlocks(
          nextSnapshot.studyBlocks,
          referenceDate,
          preservedStudyBlockIds,
          getCollapsedCoverageRepairState(nextSnapshot, referenceDate).invalidOverlapBlockIds,
        ),
    preservedStudyBlockIds,
    preserveFlexibleFutureBlocks: false,
  });

  await replacePlanningHorizon(repaired.studyBlocks, repaired.weeklyPlans, weekStartKey, {
    preservedStudyBlockIds,
    preserveFlexibleFutureBlocks: false,
    aggressiveFutureReset: true,
  });
  return loadPlannerSnapshot();
}

async function refreshPlanningModel(snapshot: PlannerSnapshot, referenceDate: Date) {
  const weekStart = startOfPlannerWeek(referenceDate);
  const weekStartKey = toDateKey(weekStart);
  const syncedSnapshot = await syncPlanningSubjectsToCurrentSeed(snapshot, referenceDate);
  const preservedStudyBlockIds = collectActiveStudyBlockIds(syncedSnapshot.studyBlocks, referenceDate);
  const repairState = getCollapsedCoverageRepairState(syncedSnapshot, referenceDate);
  const replanned = generateStudyPlanHorizon({
    startWeek: weekStart,
    referenceDate,
    goals: syncedSnapshot.goals,
    subjects: syncedSnapshot.subjects,
    topics: syncedSnapshot.topics,
    completionLogs: syncedSnapshot.completionLogs,
    fixedEvents: syncedSnapshot.fixedEvents,
    sickDays: syncedSnapshot.sickDays,
    focusedDays: syncedSnapshot.focusedDays,
    focusedWeeks: syncedSnapshot.focusedWeeks,
    preferences: syncedSnapshot.preferences,
    existingStudyBlocks: repairState.hasCollapsedCoverage
      ? repairState.hasHardConstraintCoverageFailure
        ? buildHardConstraintFutureResetBaselineStudyBlocks(
            syncedSnapshot.studyBlocks,
            referenceDate,
            preservedStudyBlockIds,
          )
        : buildCollapsedCoverageRepairBaselineStudyBlocks(
            syncedSnapshot.studyBlocks,
            referenceDate,
            preservedStudyBlockIds,
            repairState.invalidOverlapBlockIds,
          )
      : syncedSnapshot.studyBlocks,
    preservedStudyBlockIds,
    preserveFlexibleFutureBlocks: false,
  });

  await replacePlanningHorizon(replanned.studyBlocks, replanned.weeklyPlans, weekStartKey, {
    preservedStudyBlockIds,
    preserveFlexibleFutureBlocks: false,
    aggressiveFutureReset: true,
  });
  await db.meta.put({ key: "planning-model-version", value: PLANNING_MODEL_VERSION });
  return loadPlannerSnapshot();
}

async function migrateLegacySeededFixedEvents(snapshot: PlannerSnapshot, referenceDate: Date) {
  if (!hasLegacySeedFixedEvents(snapshot.fixedEvents)) {
    return snapshot;
  }

  const cleanedFixedEvents = stripLegacySeedFixedEvents(snapshot.fixedEvents);
  const removableStudyBlockIds = snapshot.studyBlocks
    .filter((block) => block.isAutoGenerated && !["done", "partial"].includes(block.status))
    .map((block) => block.id);

  await db.transaction("rw", [db.fixedEvents, db.studyBlocks, db.weeklyPlans], async () => {
    await db.fixedEvents.clear();

    if (cleanedFixedEvents.length) {
      await db.fixedEvents.bulkPut(cleanedFixedEvents);
    }

    await db.weeklyPlans.clear();

    if (!snapshot.completionLogs.length) {
      await db.studyBlocks.clear();
      return;
    }

    if (removableStudyBlockIds.length) {
      await db.studyBlocks.bulkDelete(removableStudyBlockIds);
    }
  });

  const migratedSnapshot = await loadPlannerSnapshot();
  return ensureCurrentWeekPlan(migratedSnapshot, referenceDate);
}

async function migrateLegacySeededSyllabus(snapshot: PlannerSnapshot, referenceDate: Date) {
  if (!hasLegacySeedTopics(snapshot.topics) || snapshot.completionLogs.length > 0) {
    return snapshot;
  }

  const seedDataset = buildSeedDataset(referenceDate);

  await db.transaction(
    "rw",
    [db.goals, db.subjects, db.topics, db.studyBlocks, db.weeklyPlans, db.meta],
    async () => {
      await Promise.all([
        db.goals.clear(),
        db.subjects.clear(),
        db.topics.clear(),
        db.studyBlocks.clear(),
        db.weeklyPlans.clear(),
      ]);

      await db.goals.bulkPut(seedDataset.goals);
      await db.subjects.bulkPut(seedDataset.subjects);
      await db.topics.bulkPut(seedDataset.topics);
      await db.meta.put({ key: "seed-syllabus-version", value: "2026-07-31" });
    },
  );

  const migratedSnapshot = await loadPlannerSnapshot();
  return ensureCurrentWeekPlan(migratedSnapshot, referenceDate);
}

async function migrateCppBookGoal(snapshot: PlannerSnapshot, referenceDate: Date) {
  const seedDataset = buildSeedDataset(referenceDate);
  const seededSubject = seedDataset.subjects.find((subject) => subject.id === CPP_BOOK_SUBJECT_ID);
  const seededGoals = seedDataset.goals.filter((goal) => goal.subjectId === CPP_BOOK_SUBJECT_ID);
  const seededTopics = seedDataset.topics.filter((topic) => topic.subjectId === CPP_BOOK_SUBJECT_ID);

  if (!seededSubject || !seededGoals.length || !seededTopics.length) {
    return snapshot;
  }

  const hasSubject = snapshot.subjects.some((subject) => subject.id === CPP_BOOK_SUBJECT_ID);
  const missingGoals = seededGoals.filter(
    (goal) => !snapshot.goals.some((candidate) => candidate.id === goal.id),
  );
  const missingTopics = seededTopics.filter(
    (topic) => !snapshot.topics.some((candidate) => candidate.id === topic.id),
  );

  if (hasSubject && !missingGoals.length && !missingTopics.length) {
    return snapshot;
  }

  await db.transaction(
    "rw",
    [db.subjects, db.goals, db.topics, db.preferences],
    async () => {
      if (!hasSubject) {
        await db.subjects.put(seededSubject);
      }

      if (missingGoals.length) {
        await db.goals.bulkPut(missingGoals);
      }

      if (missingTopics.length) {
        await db.topics.bulkPut(missingTopics);
      }

      await db.preferences.put(normalizePreferences(snapshot.preferences));
    },
  );

  const migratedSnapshot = await loadPlannerSnapshot();
  return refreshPlanningModel(migratedSnapshot, referenceDate);
}

function mergeSeedTopicProgress<T extends PlannerSnapshot["topics"][number]>(
  seededTopic: T,
  existingTopic?: T,
) {
  if (!existingTopic) {
    return normalizeTopicProgress(seededTopic);
  }

  return normalizeTopicProgress({
    ...seededTopic,
    completedHours: existingTopic.completedHours,
    mastery: existingTopic.mastery,
    reviewDue: existingTopic.reviewDue,
    lastStudiedAt: existingTopic.lastStudiedAt,
    notes: existingTopic.notes ?? seededTopic.notes,
  });
}

const MATHS_PROGRESS_CARRY_RULES: Array<{
  sourceId: string;
  targetIds: string[];
}> = [
  {
    sourceId: "maths-topic1-exponents-logs",
    targetIds: ["maths-topic1-exponents-logs", "maths-topic1-aa-logarithms"],
  },
  {
    sourceId: "maths-topic1-sequences-series",
    targetIds: ["maths-topic1-sequences-series", "maths-topic1-aa-sequences-series"],
  },
  {
    sourceId: "maths-topic2-functions-core",
    targetIds: ["maths-topic2-functions-core", "maths-topic2-aa-functions"],
  },
  {
    sourceId: "maths-topic3-trigonometry",
    targetIds: [
      "maths-topic3-trigonometry",
      "maths-topic3-aa-trigonometry",
      "maths-topic3-hl-trigonometry-extension",
    ],
  },
  {
    sourceId: "maths-topic4-statistics",
    targetIds: ["maths-topic4-statistics", "maths-topic4-aa-statistics"],
  },
  {
    sourceId: "maths-topic5-differentiation-core",
    targetIds: ["maths-topic5-differentiation-core", "maths-topic5-aa-differentiation"],
  },
  {
    sourceId: "maths-topic5-integration-core",
    targetIds: ["maths-topic5-integration-core", "maths-topic5-aa-integration"],
  },
  {
    sourceId: "maths-topic1-proof",
    targetIds: ["maths-topic1-proof", "maths-topic1-hl-proof-extension"],
  },
];

function buildMigratedMathsTopics(options: {
  seededTopics: PlannerSnapshot["topics"];
  existingTopics: PlannerSnapshot["topics"];
}) {
  const seededTopicsById = new Map(options.seededTopics.map((topic) => [topic.id, topic]));
  const existingTopicsById = new Map(options.existingTopics.map((topic) => [topic.id, topic]));
  const assignedCompletedHours = new Map<string, number>();
  const assignedMastery = new Map<string, number>();
  const assignedReviewDue = new Map<string, string | null>();
  const assignedLastStudiedAt = new Map<string, string | null>();
  const assignedNotes = new Map<string, string | undefined>();
  const coveredSourceIds = new Set<string>();

  MATHS_PROGRESS_CARRY_RULES.forEach((rule) => {
    const sourceTopic = existingTopicsById.get(rule.sourceId);
    const hasMaterializedSplitTargets = rule.targetIds
      .slice(1)
      .some((targetId) => existingTopicsById.has(targetId));

    if (!sourceTopic || hasMaterializedSplitTargets) {
      return;
    }

    coveredSourceIds.add(rule.sourceId);
    let remainingCompletedHours = Math.max(sourceTopic.completedHours, 0);

    rule.targetIds.forEach((targetId, index) => {
      const seededTopic = seededTopicsById.get(targetId);
      if (!seededTopic) {
        return;
      }

      const allocatedHours = Math.min(seededTopic.estHours, remainingCompletedHours);
      remainingCompletedHours = Math.max(0, remainingCompletedHours - allocatedHours);
      assignedCompletedHours.set(targetId, allocatedHours);
      assignedMastery.set(
        targetId,
        allocatedHours >= seededTopic.estHours - 0.001
          ? Math.max(sourceTopic.mastery, 4)
          : allocatedHours > 0
            ? Math.max(sourceTopic.mastery, 3)
            : seededTopic.mastery,
      );
      assignedReviewDue.set(targetId, index === 0 ? sourceTopic.reviewDue : null);
      assignedLastStudiedAt.set(targetId, allocatedHours > 0 ? sourceTopic.lastStudiedAt : null);
      assignedNotes.set(targetId, index === 0 ? sourceTopic.notes ?? seededTopic.notes : seededTopic.notes);
    });
  });

  return options.seededTopics.map((seededTopic) => {
    if (assignedCompletedHours.has(seededTopic.id)) {
      return normalizeTopicProgress({
        ...seededTopic,
        completedHours: assignedCompletedHours.get(seededTopic.id) ?? 0,
        mastery: assignedMastery.get(seededTopic.id) ?? seededTopic.mastery,
        reviewDue: assignedReviewDue.get(seededTopic.id) ?? null,
        lastStudiedAt: assignedLastStudiedAt.get(seededTopic.id) ?? null,
        notes: assignedNotes.get(seededTopic.id) ?? seededTopic.notes,
      });
    }

    const existingTopic = existingTopicsById.get(seededTopic.id);
    if (existingTopic && !coveredSourceIds.has(existingTopic.id)) {
      return mergeSeedTopicProgress(seededTopic, existingTopic);
    }

    return normalizeTopicProgress(seededTopic);
  });
}

type OlympiadMigrationBucket =
  | "geometry"
  | "algebra"
  | "number-theory"
  | "combinatorics"
  | "contest";

function inferOlympiadMigrationBucket(topic: Pick<
  PlannerSnapshot["topics"][number],
  "id" | "unitId" | "unitTitle" | "title" | "sequenceGroup"
>): OlympiadMigrationBucket {
  const raw = [
    topic.id,
    topic.unitId,
    topic.unitTitle,
    topic.title,
    topic.sequenceGroup ?? "",
  ]
    .join(" ")
    .toLowerCase();

  if (raw.includes("geometry") || raw.includes(" olympiad-geo") || raw.includes("g1") || raw.includes("g2") || raw.includes("g3")) {
    return "geometry";
  }

  if (
    raw.includes("number theory") ||
    raw.includes("number-theory") ||
    raw.includes(" olympiad-nt")
  ) {
    return "number-theory";
  }

  if (
    raw.includes("combinatorics") ||
    raw.includes(" olympiad-combi") ||
    raw.includes("counting") ||
    raw.includes("graph")
  ) {
    return "combinatorics";
  }

  if (
    raw.includes("contest") ||
    raw.includes("mock") ||
    raw.includes("pair review") ||
    raw.includes("group critique") ||
    raw.includes("assignment") ||
    raw.includes("proof conversion") ||
    raw.includes("rewrite")
  ) {
    return "contest";
  }

  return "algebra";
}

function buildMigratedOlympiadTopics(options: {
  seededTopics: PlannerSnapshot["topics"];
  existingTopics: PlannerSnapshot["topics"];
}) {
  const exactTopicsById = new Map(options.existingTopics.map((topic) => [topic.id, topic]));
  const remainingHoursByBucket = options.existingTopics.reduce<
    Record<OlympiadMigrationBucket, number>
  >(
    (accumulator, topic) => {
      const bucket = inferOlympiadMigrationBucket(topic);
      accumulator[bucket] += Math.min(topic.completedHours, topic.estHours);
      return accumulator;
    },
    {
      geometry: 0,
      algebra: 0,
      "number-theory": 0,
      combinatorics: 0,
      contest: 0,
    },
  );

  return options.seededTopics.map((seededTopic) => {
    const exactTopic = exactTopicsById.get(seededTopic.id);

    if (exactTopic) {
      const mergedTopic = mergeSeedTopicProgress(seededTopic, exactTopic);
      const bucket = inferOlympiadMigrationBucket(seededTopic);
      remainingHoursByBucket[bucket] = Math.max(
        0,
        remainingHoursByBucket[bucket] - Math.min(mergedTopic.completedHours, mergedTopic.estHours),
      );
      return mergedTopic;
    }

    const bucket = inferOlympiadMigrationBucket(seededTopic);
    const migratedCompletedHours = Math.min(
      seededTopic.estHours,
      remainingHoursByBucket[bucket] ?? 0,
    );
    remainingHoursByBucket[bucket] = Math.max(
      0,
      (remainingHoursByBucket[bucket] ?? 0) - migratedCompletedHours,
    );

    return normalizeTopicProgress({
      ...seededTopic,
      completedHours: migratedCompletedHours,
      mastery:
        migratedCompletedHours >= seededTopic.estHours - 0.001
          ? 5
          : migratedCompletedHours > 0
            ? 3
            : seededTopic.mastery,
    });
  });
}

async function syncPlanningSubjectsToCurrentSeed(snapshot: PlannerSnapshot, referenceDate: Date) {
  const seedDataset = buildSeedDataset(referenceDate);
  const seededSubjects = seedDataset.subjects.filter((subject) =>
    PLANNING_SYNC_SUBJECT_IDS.includes(subject.id),
  );
  const seededGoals = seedDataset.goals.filter((goal) =>
    PLANNING_SYNC_SUBJECT_IDS.includes(goal.subjectId as SubjectId),
  );
  const seededGoalIds = new Set(seededGoals.map((goal) => goal.id));
  const seededTopics = seedDataset.topics.filter((topic) =>
    PLANNING_SYNC_SUBJECT_IDS.includes(topic.subjectId as SubjectId),
  );
  const seededTopicIds = new Set(seededTopics.map((topic) => topic.id));
  const existingMathsTopics = snapshot.topics.filter((topic) => topic.subjectId === "maths-aa-hl");
  const mergedMathsTopicsById = new Map(
    buildMigratedMathsTopics({
      seededTopics: seededTopics.filter((topic) => topic.subjectId === "maths-aa-hl"),
      existingTopics: existingMathsTopics,
    }).map((topic) => [topic.id, topic]),
  );
  const existingTopicsById = new Map(snapshot.topics.map((topic) => [topic.id, topic]));
  const mergedTopics = seededTopics.map((seededTopic) => {
    if (seededTopic.subjectId === "maths-aa-hl") {
      return mergedMathsTopicsById.get(seededTopic.id) ?? normalizeTopicProgress(seededTopic);
    }

    return mergeSeedTopicProgress(
      seededTopic,
      existingTopicsById.get(seededTopic.id),
    );
  });
  const obsoleteGoalIds = snapshot.goals
    .filter((goal) => PLANNING_SYNC_SUBJECT_IDS.includes(goal.subjectId as SubjectId))
    .filter((goal) => !seededGoalIds.has(goal.id))
    .map((goal) => goal.id);
  const obsoleteTopicIds = snapshot.topics
    .filter((topic) => PLANNING_SYNC_SUBJECT_IDS.includes(topic.subjectId as SubjectId))
    .filter((topic) => !seededTopicIds.has(topic.id))
    .map((topic) => topic.id);

  await db.transaction(
    "rw",
    [db.subjects, db.goals, db.topics, db.studyBlocks],
    async () => {
      if (seededSubjects.length) {
        await db.subjects.bulkPut(seededSubjects);
      }

      if (obsoleteGoalIds.length) {
        await db.goals.bulkDelete(obsoleteGoalIds);
      }

      if (seededGoals.length) {
        await db.goals.bulkPut(seededGoals);
      }

      if (obsoleteTopicIds.length) {
        await db.topics.bulkDelete(obsoleteTopicIds);
        await db.studyBlocks
          .filter(
            (block) =>
              !!block.topicId &&
              obsoleteTopicIds.includes(block.topicId) &&
              !["done", "partial", "missed"].includes(block.status),
          )
          .delete();
      }

      if (mergedTopics.length) {
        await db.topics.bulkPut(mergedTopics);
      }
    },
  );

  return loadPlannerSnapshot();
}

export async function syncOlympiadRoadmapToSeed(snapshot: PlannerSnapshot, referenceDate: Date) {
  const seedDataset = buildSeedDataset(referenceDate);
  const seededSubject = seedDataset.subjects.find((subject) => subject.id === OLYMPIAD_SUBJECT_ID);
  const seededGoals = seedDataset.goals.filter((goal) => goal.subjectId === OLYMPIAD_SUBJECT_ID);
  const seededTopics = seedDataset.topics.filter((topic) => topic.subjectId === OLYMPIAD_SUBJECT_ID);

  if (!seededSubject || !seededGoals.length || !seededTopics.length) {
    return snapshot;
  }

  const existingOlympiadTopics = snapshot.topics.filter((topic) => topic.subjectId === OLYMPIAD_SUBJECT_ID);
  const seededGoalIds = new Set(seededGoals.map((goal) => goal.id));
  const seededTopicIds = new Set(seededTopics.map((topic) => topic.id));
  const mergedTopics = buildMigratedOlympiadTopics({
    seededTopics,
    existingTopics: existingOlympiadTopics,
  });
  const obsoleteGoalIds = snapshot.goals
    .filter((goal) => goal.subjectId === OLYMPIAD_SUBJECT_ID)
    .filter((goal) => !seededGoalIds.has(goal.id))
    .map((goal) => goal.id);
  const obsoleteTopicIds = snapshot.topics
    .filter((topic) => topic.subjectId === OLYMPIAD_SUBJECT_ID)
    .filter((topic) => !seededTopicIds.has(topic.id))
    .map((topic) => topic.id);
  await db.transaction("rw", [db.subjects, db.goals, db.topics, db.studyBlocks, db.meta], async () => {
    await db.subjects.put(seededSubject);
    if (obsoleteGoalIds.length) {
      await db.goals.bulkDelete(obsoleteGoalIds);
    }
    await db.goals.bulkPut(seededGoals);
    await db.topics.bulkPut(mergedTopics);

    if (obsoleteTopicIds.length) {
      await db.topics.bulkDelete(obsoleteTopicIds);
      await db.studyBlocks
        .filter(
          (block) =>
            !!block.topicId &&
            obsoleteTopicIds.includes(block.topicId) &&
            !["done", "partial", "missed"].includes(block.status),
        )
        .delete();
    }
    await db.meta.put({ key: "olympiad-roadmap-version", value: OLYMPIAD_ROADMAP_VERSION });
  });

  return loadPlannerSnapshot();
}

async function migrateOlympiadRoadmap(snapshot: PlannerSnapshot, referenceDate: Date) {
  const roadmapVersion = await db.meta.get("olympiad-roadmap-version");
  if (roadmapVersion?.value === OLYMPIAD_ROADMAP_VERSION) {
    return snapshot;
  }
  const migratedSnapshot = await syncOlympiadRoadmapToSeed(snapshot, referenceDate);
  return refreshPlanningModel(migratedSnapshot, referenceDate);
}

async function syncExtendedGoalSubjects(snapshot: PlannerSnapshot, referenceDate: Date) {
  const syncedVersion = await db.meta.get("extended-goals-version");
  if (syncedVersion?.value === EXTENDED_GOALS_VERSION) {
    return snapshot;
  }

  const seedDataset = buildSeedDataset(referenceDate);
  const syncedSubjectIds: SubjectId[] = [
    "physics-hl",
    "maths-aa-hl",
    "chemistry-hl",
    OLYMPIAD_SUBJECT_ID,
  ];
  const existingTopicsById = new Map(snapshot.topics.map((topic) => [topic.id, topic]));
  const seededSubjects = seedDataset.subjects.filter((subject) => syncedSubjectIds.includes(subject.id));
  const seededGoals = seedDataset.goals.filter((goal) => syncedSubjectIds.includes(goal.subjectId as SubjectId));
  const seededTopicIds = new Set(
    seedDataset.topics
      .filter((topic) => syncedSubjectIds.includes(topic.subjectId as SubjectId))
      .map((topic) => topic.id),
  );
  const mergedTopics = seedDataset.topics
    .filter((topic) => syncedSubjectIds.includes(topic.subjectId as SubjectId))
    .map((seededTopic) =>
      mergeSeedTopicProgress(
        seededTopic,
        existingTopicsById.get(seededTopic.id),
      ),
    );
  const obsoletePastPaperTopicIds = snapshot.topics
    .filter((topic) => syncedSubjectIds.includes(topic.subjectId as SubjectId))
    .filter((topic) => topic.unitId.includes("past-papers"))
    .filter((topic) => !seededTopicIds.has(topic.id))
    .map((topic) => topic.id);

  await db.transaction("rw", [db.subjects, db.goals, db.topics, db.meta], async () => {
    if (seededSubjects.length) {
      await db.subjects.bulkPut(seededSubjects);
    }

    if (seededGoals.length) {
      await db.goals.bulkPut(seededGoals);
    }

    if (mergedTopics.length) {
      await db.topics.bulkPut(mergedTopics);
    }

    if (obsoletePastPaperTopicIds.length) {
      await db.topics.bulkDelete(obsoletePastPaperTopicIds);
    }

    await db.meta.put({ key: "extended-goals-version", value: EXTENDED_GOALS_VERSION });
  });

  const migratedSnapshot = await loadPlannerSnapshot();
  return refreshPlanningModel(migratedSnapshot, referenceDate);
}

async function syncLanguageMaintenanceSubjects(snapshot: PlannerSnapshot, referenceDate: Date) {
  const syncedVersion = await db.meta.get("language-maintenance-version");
  if (syncedVersion?.value === LANGUAGE_MAINTENANCE_VERSION) {
    return snapshot;
  }

  const seedDataset = buildSeedDataset(referenceDate);
  const syncedSubjectIds: SubjectId[] = ["english-a-sl", "french-b-sl"];
  const existingTopicsById = new Map(snapshot.topics.map((topic) => [topic.id, topic]));
  const seededSubjects = seedDataset.subjects.filter((subject) => syncedSubjectIds.includes(subject.id));
  const seededTopicIds = new Set(
    seedDataset.topics
      .filter((topic) => syncedSubjectIds.includes(topic.subjectId as SubjectId))
      .map((topic) => topic.id),
  );
  const mergedTopics = seedDataset.topics
    .filter((topic) => syncedSubjectIds.includes(topic.subjectId as SubjectId))
    .map((seededTopic) =>
      mergeSeedTopicProgress(
        seededTopic,
        existingTopicsById.get(seededTopic.id),
      ),
    );
  const obsoleteTopicIds = snapshot.topics
    .filter((topic) => syncedSubjectIds.includes(topic.subjectId as SubjectId))
    .filter((topic) => !seededTopicIds.has(topic.id))
    .map((topic) => topic.id);

  await db.transaction("rw", [db.subjects, db.topics, db.meta], async () => {
    if (seededSubjects.length) {
      await db.subjects.bulkPut(seededSubjects);
    }

    if (obsoleteTopicIds.length) {
      await db.topics.bulkDelete(obsoleteTopicIds);
    }

    if (mergedTopics.length) {
      await db.topics.bulkPut(mergedTopics);
    }

    await db.meta.put({
      key: "language-maintenance-version",
      value: LANGUAGE_MAINTENANCE_VERSION,
    });
  });

  const migratedSnapshot = await loadPlannerSnapshot();
  return refreshPlanningModel(migratedSnapshot, referenceDate);
}

async function syncSeedOrderedSubjects(snapshot: PlannerSnapshot, referenceDate: Date) {
  const syncedVersion = await db.meta.get("seed-topic-ordering-version");
  if (syncedVersion?.value === SEED_TOPIC_ORDERING_VERSION) {
    return snapshot;
  }

  const seedDataset = buildSeedDataset(referenceDate);
  const syncedSubjectIds: SubjectId[] = [
    "physics-hl",
    "maths-aa-hl",
    "chemistry-hl",
    "olympiad",
    "cpp-book",
    "geography-transition",
    "french-b-sl",
  ];
  const existingTopicsById = new Map(snapshot.topics.map((topic) => [topic.id, topic]));
  const seededTopics = seedDataset.topics.filter((topic) =>
    syncedSubjectIds.includes(topic.subjectId as SubjectId),
  );
  const seededTopicIds = new Set(seededTopics.map((topic) => topic.id));
  const mergedTopics = seededTopics.map((seededTopic) =>
    mergeSeedTopicProgress(
      seededTopic,
      existingTopicsById.get(seededTopic.id),
    ),
  );
  const obsoleteTopicIds = snapshot.topics
    .filter((topic) => syncedSubjectIds.includes(topic.subjectId as SubjectId))
    .filter((topic) => !seededTopicIds.has(topic.id))
    .map((topic) => topic.id);

  await db.transaction("rw", [db.topics, db.meta], async () => {
    if (obsoleteTopicIds.length) {
      await db.topics.bulkDelete(obsoleteTopicIds);
    }

    if (mergedTopics.length) {
      await db.topics.bulkPut(mergedTopics);
    }

    await db.meta.put({
      key: "seed-topic-ordering-version",
      value: SEED_TOPIC_ORDERING_VERSION,
    });
  });

  const migratedSnapshot = await loadPlannerSnapshot();
  return refreshPlanningModel(migratedSnapshot, referenceDate);
}

async function writeSeedDataset(seed: SeedDataset) {
  await db.transaction(
    "rw",
    [
      db.goals,
      db.subjects,
      db.topics,
      db.fixedEvents,
      db.sickDays,
      db.focusedDays,
      db.focusedWeeks,
      db.preferences,
      db.meta,
    ],
    async () => {
      await db.goals.bulkPut(seed.goals);
      await db.subjects.bulkPut(seed.subjects);
      await db.topics.bulkPut(seed.topics);
      await db.fixedEvents.bulkPut(seed.fixedEvents);
      await db.sickDays.clear();
      if (seed.sickDays.length) {
        await db.sickDays.bulkPut(seed.sickDays.map(normalizeSickDay));
      }
      await db.focusedDays.clear();
      if (seed.focusedDays.length) {
        await db.focusedDays.bulkPut(seed.focusedDays.map(normalizeFocusedDay));
      }
      await db.focusedWeeks.clear();
      if (seed.focusedWeeks.length) {
        await db.focusedWeeks.bulkPut(seed.focusedWeeks.map(normalizeFocusedWeek));
      }
      await db.preferences.put(seed.preferences);
      await db.meta.put({ key: "seeded", value: "true" });
      await db.meta.put({ key: "planning-model-version", value: PLANNING_MODEL_VERSION });
      await db.meta.put({
        key: "preferences-defaults-version",
        value: PREFERENCE_DEFAULTS_VERSION,
      });
      await db.meta.put({ key: "olympiad-roadmap-version", value: OLYMPIAD_ROADMAP_VERSION });
      await db.meta.put({ key: "extended-goals-version", value: EXTENDED_GOALS_VERSION });
      await db.meta.put({
        key: "language-maintenance-version",
        value: LANGUAGE_MAINTENANCE_VERSION,
      });
      await db.meta.put({
        key: "seed-topic-ordering-version",
        value: SEED_TOPIC_ORDERING_VERSION,
      });
    },
  );
}

export async function loadPlannerSnapshot(): Promise<PlannerSnapshot> {
  const [
    goals,
    subjects,
    topics,
    fixedEvents,
    sickDays,
    focusedDays,
    focusedWeeks,
    studyBlocks,
    completionLogs,
    weeklyPlans,
    preferences,
  ] =
    await Promise.all([
      db.goals.toArray(),
      db.subjects.toArray(),
      db.topics.toArray(),
      db.fixedEvents.toArray(),
      db.sickDays.toArray(),
      db.focusedDays.toArray(),
      db.focusedWeeks.toArray(),
      db.studyBlocks.toArray(),
      db.completionLogs.toArray(),
      db.weeklyPlans.toArray(),
      db.preferences.get("default"),
    ]);

  if (!preferences) {
    throw new Error("Planner preferences were not found in IndexedDB.");
  }

  return {
    goals,
    subjects,
    topics: topics.map((topic) => normalizeTopicProgress(topic)),
    fixedEvents: fixedEvents.map(normalizeFixedEvent),
    sickDays: sickDays.map(normalizeSickDay),
    focusedDays: focusedDays.map(normalizeFocusedDay),
    focusedWeeks: focusedWeeks.map(normalizeFocusedWeek),
    studyBlocks: studyBlocks.map(normalizeStudyBlock),
    completionLogs,
    weeklyPlans: weeklyPlans.map((weeklyPlan) => normalizeWeeklyPlan(weeklyPlan, new Date())),
    preferences: normalizePreferences(preferences),
  };
}

export async function initializePlannerDatabase(referenceDate = new Date()) {
  const seeded = await db.meta.get("seeded");
  if (!seeded) {
    const seedDataset = buildSeedDataset(referenceDate);
    await writeSeedDataset(seedDataset);

    const initialPlan = generateStudyPlanHorizon({
      startWeek: startOfPlannerWeek(referenceDate),
      referenceDate,
      goals: seedDataset.goals,
      subjects: seedDataset.subjects,
      topics: seedDataset.topics,
      completionLogs: [],
      fixedEvents: seedDataset.fixedEvents,
      sickDays: seedDataset.sickDays,
      focusedDays: seedDataset.focusedDays,
      focusedWeeks: seedDataset.focusedWeeks,
      preferences: seedDataset.preferences,
    });

    await replacePlanningHorizon(
      initialPlan.studyBlocks,
      initialPlan.weeklyPlans,
      toDateKey(startOfPlannerWeek(referenceDate)),
    );
  }

  let snapshot = await loadPlannerSnapshot();
  snapshot = await migrateLegacyPreferenceDefaults(snapshot);
  snapshot = await migrateLegacySeededFixedEvents(snapshot, referenceDate);
  snapshot = await migrateLegacySeededSyllabus(snapshot, referenceDate);
  snapshot = await migrateCppBookGoal(snapshot, referenceDate);
  snapshot = await migrateOlympiadRoadmap(snapshot, referenceDate);
  snapshot = await syncExtendedGoalSubjects(snapshot, referenceDate);
  snapshot = await syncLanguageMaintenanceSubjects(snapshot, referenceDate);
  snapshot = await syncSeedOrderedSubjects(snapshot, referenceDate);
  const planningModelVersion = await db.meta.get("planning-model-version");
  if (planningModelVersion?.value !== PLANNING_MODEL_VERSION) {
    snapshot = await refreshPlanningModel(snapshot, referenceDate);
  }
  snapshot = await repairCollapsedCoveragePlanningState(referenceDate);
  snapshot = await ensureCurrentWeekPlan(snapshot, referenceDate);
  return snapshot;
}

export async function replaceWeeklyPlan(studyBlocks: StudyBlock[], weeklyPlan: WeeklyPlan) {
  await db.transaction(
    "rw",
    db.studyBlocks,
    db.weeklyPlans,
    async () => {
      await db.studyBlocks.where("weekStart").equals(weeklyPlan.weekStart).delete();
      await db.studyBlocks.bulkPut(studyBlocks);
      await db.weeklyPlans.put(weeklyPlan);
    },
  );
}

export async function replacePlanningWeeks(
  studyBlocks: StudyBlock[],
  weeklyPlans: WeeklyPlan[],
  changedWeekStarts: string[],
) {
  if (changedWeekStarts.length === 0) {
    return;
  }

  const changedWeekStartSet = new Set(changedWeekStarts);
  const normalizedStudyBlocks = studyBlocks.map(normalizeStudyBlock);
  const nextStudyBlocks = normalizedStudyBlocks.filter((block) =>
    changedWeekStartSet.has(block.weekStart),
  );
  const nextWeeklyPlans = weeklyPlans.filter((weeklyPlan) =>
    changedWeekStartSet.has(weeklyPlan.weekStart),
  );

  await db.transaction("rw", db.studyBlocks, db.weeklyPlans, async () => {
    const blockIdsToDelete = (await db.studyBlocks
      .where("weekStart")
      .anyOf(changedWeekStarts)
      .primaryKeys()) as string[];

    if (blockIdsToDelete.length) {
      await db.studyBlocks.bulkDelete(blockIdsToDelete);
    }

    await db.weeklyPlans.bulkDelete(changedWeekStarts);

    if (nextStudyBlocks.length) {
      await db.studyBlocks.bulkPut(nextStudyBlocks);
    }

    if (nextWeeklyPlans.length) {
      await db.weeklyPlans.bulkPut(nextWeeklyPlans);
    }
  });
}

export async function replacePlanningHorizon(
  studyBlocks: StudyBlock[],
  weeklyPlans: WeeklyPlan[],
  horizonStartWeek: string,
  options?: {
    preserveFlexibleFutureBlocks?: boolean;
    preservedStudyBlockIds?: string[];
    aggressiveFutureReset?: boolean;
  },
) {
  const horizonStartDate = new Date(`${horizonStartWeek}T00:00:00`);
  const referenceDate = new Date();
  const weekKeys = weeklyPlans.map((plan) => plan.weekStart);
  const preservedIds = new Set(options?.preservedStudyBlockIds ?? []);

  await db.transaction(
    "rw",
    db.studyBlocks,
    db.weeklyPlans,
    async () => {
      await db.studyBlocks
        .filter(
          (block) =>
            new Date(block.start).getTime() >= horizonStartDate.getTime() &&
            new Date(block.end).getTime() > referenceDate.getTime() &&
            !preservedIds.has(block.id) &&
            (
              options?.aggressiveFutureReset
                ? true
                : !shouldPreserveStudyBlockOnRegeneration(normalizeStudyBlock(block), {
                    preserveFlexibleFutureBlocks: options?.preserveFlexibleFutureBlocks,
                  })
            ),
        )
        .delete();
      await db.weeklyPlans
        .where("weekStart")
        .aboveOrEqual(horizonStartWeek)
        .delete();

      if (studyBlocks.length) {
        await db.studyBlocks.bulkPut(studyBlocks.map(normalizeStudyBlock));
      }

      if (weekKeys.length) {
        await db.weeklyPlans.bulkPut(weeklyPlans);
      }
    },
  );
}

export async function saveFixedEvent(event: PlannerSnapshot["fixedEvents"][number]) {
  await db.fixedEvents.put(normalizeFixedEvent(event));
}

export async function saveSickDay(sickDay: SickDay) {
  await db.sickDays.put(normalizeSickDay(sickDay));
}

export async function saveFocusedDay(focusedDay: FocusedDay) {
  const normalizedFocusedDay = normalizeFocusedDay(focusedDay);

  await db.transaction("rw", db.focusedDays, async () => {
    const duplicateIds = (await db.focusedDays.where("date").equals(normalizedFocusedDay.date).toArray())
      .filter((candidate) => candidate.id !== normalizedFocusedDay.id)
      .map((candidate) => candidate.id);

    if (duplicateIds.length) {
      await db.focusedDays.bulkDelete(duplicateIds);
    }

    await db.focusedDays.put(normalizedFocusedDay);
  });
}

export async function saveFocusedWeek(focusedWeek: FocusedWeek) {
  const normalizedFocusedWeek = normalizeFocusedWeek(focusedWeek);

  await db.transaction("rw", db.focusedWeeks, async () => {
    const duplicateIds = (
      await db.focusedWeeks.where("weekStart").equals(normalizedFocusedWeek.weekStart).toArray()
    )
      .filter((candidate) => candidate.id !== normalizedFocusedWeek.id)
      .map((candidate) => candidate.id);

    if (duplicateIds.length) {
      await db.focusedWeeks.bulkDelete(duplicateIds);
    }

    await db.focusedWeeks.put(normalizedFocusedWeek);
  });
}

export async function deleteSickDayById(id: string) {
  await db.sickDays.delete(id);
}

export async function deleteFocusedDayById(id: string) {
  await db.focusedDays.delete(id);
}

export async function deleteFocusedWeekById(id: string) {
  await db.focusedWeeks.delete(id);
}

export async function deleteFixedEventById(id: string) {
  await db.fixedEvents.delete(id);
}

export async function excludeFixedEventOccurrence(id: string, dateKey: string) {
  const event = await db.fixedEvents.get(id);

  if (!event) {
    return;
  }

  if (event.recurrence === "none") {
    await db.fixedEvents.delete(id);
    return;
  }

  const excludedDates = Array.from(
    new Set([...(event.excludedDates ?? []), dateKey]),
  ).sort((left, right) => left.localeCompare(right));

  await db.fixedEvents.put(
    normalizeFixedEvent({
      ...event,
      excludedDates,
    }),
  );
}

export async function updateStudyBlock(block: StudyBlock) {
  await db.studyBlocks.put(normalizeStudyBlock(block));
}

export async function deleteStudyBlocksByIds(ids: string[]) {
  if (!ids.length) {
    return;
  }

  await db.studyBlocks.bulkDelete(ids);
}

export async function saveCompletionLog(log: CompletionLog) {
  await db.completionLogs.put(log);
}

export async function deleteCompletionLogsByStudyBlockId(studyBlockId: string) {
  const completionLogIds = await db.completionLogs
    .where("studyBlockId")
    .equals(studyBlockId)
    .primaryKeys();

  if (!completionLogIds.length) {
    return;
  }

  await db.completionLogs.bulkDelete(completionLogIds);
}

export async function updateTopic(topic: PlannerSnapshot["topics"][number]) {
  await db.topics.put(topic);
}

export async function savePreferences(preferences: Preferences) {
  await db.preferences.put(normalizePreferences(preferences));
}

export async function exportPlannerData(): Promise<PlannerExportPayload> {
  const snapshot = await loadPlannerSnapshot();
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    ...snapshot,
  };
}

export async function importPlannerData(rawJson: string) {
  const payload = parsePlannerJson(rawJson) as PlannerExportPayload;
  const importReferenceDate = new Date();
  const importedStudyBlocks = payload.studyBlocks
    .map(normalizeStudyBlock)
    .filter((block) => {
      const isFutureBlock = new Date(block.end).getTime() > importReferenceDate.getTime();

      if (!isFutureBlock) {
        return true;
      }

      if (block.creationSource === "manual") {
        return true;
      }

      if (!block.isAutoGenerated) {
        return true;
      }

      return block.status === "done" || block.status === "partial";
    });

  await db.transaction(
    "rw",
    [
      db.goals,
      db.subjects,
      db.topics,
      db.fixedEvents,
      db.sickDays,
      db.focusedDays,
      db.focusedWeeks,
      db.studyBlocks,
      db.completionLogs,
      db.weeklyPlans,
      db.preferences,
      db.meta,
    ],
    async () => {
      await Promise.all([
        db.goals.clear(),
        db.subjects.clear(),
        db.topics.clear(),
        db.fixedEvents.clear(),
        db.sickDays.clear(),
        db.focusedDays.clear(),
        db.focusedWeeks.clear(),
        db.studyBlocks.clear(),
        db.completionLogs.clear(),
        db.weeklyPlans.clear(),
        db.preferences.clear(),
        db.meta.clear(),
      ]);

      await db.goals.bulkPut(payload.goals);
      await db.subjects.bulkPut(payload.subjects);
      await db.topics.bulkPut(payload.topics.map((topic) => normalizeTopicProgress(topic)));
      await db.fixedEvents.bulkPut(payload.fixedEvents.map(normalizeFixedEvent));
      await db.sickDays.bulkPut((payload.sickDays ?? []).map(normalizeSickDay));
      await db.focusedDays.bulkPut((payload.focusedDays ?? []).map(normalizeFocusedDay));
      await db.focusedWeeks.bulkPut((payload.focusedWeeks ?? []).map(normalizeFocusedWeek));
      await db.studyBlocks.bulkPut(importedStudyBlocks);
      await db.completionLogs.bulkPut(payload.completionLogs);
      await db.preferences.put(normalizePreferences(payload.preferences));
      await db.meta.put({ key: "seeded", value: "true" });
      await db.meta.put({
        key: "preferences-defaults-version",
        value: PREFERENCE_DEFAULTS_VERSION,
      });
    },
  );

  return initializePlannerDatabase(new Date());
}

export function getCurrentWeekKey(referenceDate = new Date()) {
  return toDateKey(startOfPlannerWeek(referenceDate));
}
