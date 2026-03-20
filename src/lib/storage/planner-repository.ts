import { getAcademicDeadline, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import {
  generateStudyPlanHorizon,
  getPlanningHorizonEndWeek,
  shouldPreserveStudyBlockOnRegeneration,
} from "@/lib/scheduler/generator";
import { buildSeedDataset } from "@/lib/seed";
import { buildSeedPreferences } from "@/lib/seed/preferences";
import {
  hasLegacySeedFixedEvents,
  stripLegacySeedFixedEvents,
} from "@/lib/seed/fixed-events";
import { hasLegacySeedTopics } from "@/lib/seed/topic-catalog";
import { db } from "@/lib/storage/db";
import { parsePlannerJson } from "@/lib/storage/json-transfer";
import { subjectIds } from "@/lib/constants/planner";
import type {
  CompletionLog,
  FocusedDay,
  PlannerExportPayload,
  Preferences,
  SeedDataset,
  SickDay,
  StudyBlock,
  SubjectId,
  WeeklyPlan,
} from "@/lib/types/planner";

const PLANNING_MODEL_VERSION = "2026-03-19-focused-days-v21";
const CPP_BOOK_SUBJECT_ID = "cpp-book";
const OLYMPIAD_SUBJECT_ID = "olympiad";
const OLYMPIAD_ROADMAP_VERSION = "2026-03-20-april-camp-roadmap-v3";
const EXTENDED_GOALS_VERSION = "2026-03-19-post-syllabus-papers-v8";
const LANGUAGE_MAINTENANCE_VERSION = "2026-03-19-languages-v1";
const SEED_TOPIC_ORDERING_VERSION = "2026-03-19-seed-ordering-v3";

function normalizeLockedRecoveryWindows(preferences: Preferences, seedPreferences: Preferences) {
  const mergedWindows = new Map(
    seedPreferences.lockedRecoveryWindows.map((window) => [window.label, window]),
  );

  (preferences.lockedRecoveryWindows ?? []).forEach((window) => {
    mergedWindows.set(window.label, {
      ...(mergedWindows.get(window.label) ?? {}),
      ...window,
    });
  });

  return Array.from(mergedWindows.values()).map((window) => {
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
        timeOverrides: normalizedTimeOverrides,
      };
    }

    if (
      window.label === "Sunday recovery" &&
      window.start === "18:00" &&
      window.end === "22:00" &&
      window.days.length === 1 &&
      window.days[0] === 0
    ) {
      return {
        ...window,
        start: "20:00",
        timeOverrides: normalizedTimeOverrides,
      };
    }

    return {
      ...window,
      timeOverrides: normalizedTimeOverrides,
    };
  });
}

function normalizeReservedCommitmentRules(preferences: Preferences, seedPreferences: Preferences) {
  if (!preferences.reservedCommitmentRules?.length) {
    return seedPreferences.reservedCommitmentRules;
  }

  const mergedRules = new Map(
    seedPreferences.reservedCommitmentRules.map((rule) => [rule.id, rule]),
  );

  preferences.reservedCommitmentRules.forEach((rule) => {
    mergedRules.set(rule.id, {
      ...(mergedRules.get(rule.id) ?? {}),
      ...rule,
    });
  });

  return Array.from(mergedRules.values()).map((rule) => ({
    ...rule,
    additionalDates: Array.from(new Set(rule.additionalDates ?? [])).sort((left, right) =>
      left.localeCompare(right),
    ),
    excludedDates: Array.from(new Set(rule.excludedDates ?? [])).sort((left, right) =>
      left.localeCompare(right),
    ),
    durationOverrides: Object.fromEntries(
      Object.entries(rule.durationOverrides ?? {})
        .filter(([, minutes]) => Number.isFinite(minutes) && minutes >= 0)
        .sort(([left], [right]) => left.localeCompare(right)),
    ),
  }));
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

function normalizePreferences(preferences: Preferences): Preferences {
  const seedPreferences = buildSeedPreferences();

  return {
    ...seedPreferences,
    ...preferences,
    dailyStudyWindow: {
      ...seedPreferences.dailyStudyWindow,
      ...preferences.dailyStudyWindow,
    },
    subjectWeightOverrides: {
      ...seedPreferences.subjectWeightOverrides,
      ...preferences.subjectWeightOverrides,
    },
    lockedRecoveryWindows: normalizeLockedRecoveryWindows(preferences, seedPreferences),
    reservedCommitmentRules: normalizeReservedCommitmentRules(preferences, seedPreferences),
    schoolSchedule: {
      ...seedPreferences.schoolSchedule,
      ...preferences.schoolSchedule,
      weekdays: preferences.schoolSchedule?.weekdays?.length
        ? preferences.schoolSchedule.weekdays
        : seedPreferences.schoolSchedule.weekdays,
      terms:
        preferences.schoolSchedule?.terms?.length
          ? preferences.schoolSchedule.terms.map((term, index) => ({
              ...seedPreferences.schoolSchedule.terms[index % seedPreferences.schoolSchedule.terms.length],
              ...term,
            }))
          : seedPreferences.schoolSchedule.terms,
    },
    holidaySchedule: {
      ...seedPreferences.holidaySchedule,
      ...preferences.holidaySchedule,
      dailyStudyWindow: {
        ...seedPreferences.holidaySchedule.dailyStudyWindow,
        ...preferences.holidaySchedule?.dailyStudyWindow,
      },
      preferredDeepWorkWindows:
        preferences.holidaySchedule?.preferredDeepWorkWindows?.length
          ? preferences.holidaySchedule.preferredDeepWorkWindows
          : seedPreferences.holidaySchedule.preferredDeepWorkWindows,
    },
    sundayStudy: {
      ...seedPreferences.sundayStudy,
      ...preferences.sundayStudy,
      workloadIntensity:
        preferences.sundayStudy?.workloadIntensity ?? seedPreferences.sundayStudy.workloadIntensity,
    },
  };
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
    coverageGapHoursBySubject: {
      ...emptyBySubject,
      ...weeklyPlan.coverageGapHoursBySubject,
    },
    scheduledToGoalHoursBySubject: {
      ...emptyBySubject,
      ...weeklyPlan.scheduledToGoalHoursBySubject,
    },
    underplannedSubjectIds: weeklyPlan.underplannedSubjectIds ?? [],
    forcedCoverageMinutes: weeklyPlan.forcedCoverageMinutes ?? 0,
    usedSundayMinutes: weeklyPlan.usedSundayMinutes ?? 0,
    overloadMinutes: weeklyPlan.overloadMinutes ?? 0,
    coverageComplete: weeklyPlan.coverageComplete ?? false,
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
  studyBlocks: PlannerExportPayload["studyBlocks"];
  completionLogs: PlannerExportPayload["completionLogs"];
  weeklyPlans: PlannerExportPayload["weeklyPlans"];
  preferences: Preferences;
}

async function ensureCurrentWeekPlan(snapshot: PlannerSnapshot, referenceDate: Date) {
  const weekStart = startOfPlannerWeek(referenceDate);
  const weekStartKey = toDateKey(weekStart);
  const horizonEndWeekKey = toDateKey(
    getPlanningHorizonEndWeek(snapshot.goals, snapshot.subjects, referenceDate),
  );

  if (
    snapshot.weeklyPlans.some((plan) => plan.weekStart === weekStartKey) &&
    snapshot.weeklyPlans.some((plan) => plan.weekStart === horizonEndWeekKey) &&
    !snapshot.weeklyPlans.some((plan) => plan.weekStart > horizonEndWeekKey)
  ) {
    return snapshot;
  }

  const replanned = generateStudyPlanHorizon({
    startWeek: weekStart,
    goals: snapshot.goals,
    subjects: snapshot.subjects,
    topics: snapshot.topics,
    fixedEvents: snapshot.fixedEvents,
    sickDays: snapshot.sickDays,
    focusedDays: snapshot.focusedDays,
    preferences: snapshot.preferences,
    existingStudyBlocks: snapshot.studyBlocks,
  });

  await replacePlanningHorizon(replanned.studyBlocks, replanned.weeklyPlans, weekStartKey);
  return loadPlannerSnapshot();
}

async function refreshPlanningModel(snapshot: PlannerSnapshot, referenceDate: Date) {
  const weekStart = startOfPlannerWeek(referenceDate);
  const replanned = generateStudyPlanHorizon({
    startWeek: weekStart,
    goals: snapshot.goals,
    subjects: snapshot.subjects,
    topics: snapshot.topics,
    fixedEvents: snapshot.fixedEvents,
    sickDays: snapshot.sickDays,
    focusedDays: snapshot.focusedDays,
    preferences: snapshot.preferences,
    existingStudyBlocks: snapshot.studyBlocks,
  });

  await replacePlanningHorizon(replanned.studyBlocks, replanned.weeklyPlans, toDateKey(weekStart));
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
    return seededTopic;
  }

  return {
    ...seededTopic,
    completedHours: existingTopic.completedHours,
    status: existingTopic.status,
    mastery: existingTopic.mastery,
    reviewDue: existingTopic.reviewDue,
    lastStudiedAt: existingTopic.lastStudiedAt,
    notes: existingTopic.notes ?? seededTopic.notes,
  };
}

async function migrateOlympiadRoadmap(snapshot: PlannerSnapshot, referenceDate: Date) {
  const roadmapVersion = await db.meta.get("olympiad-roadmap-version");
  if (roadmapVersion?.value === OLYMPIAD_ROADMAP_VERSION) {
    return snapshot;
  }

  const seedDataset = buildSeedDataset(referenceDate);
  const seededSubject = seedDataset.subjects.find((subject) => subject.id === OLYMPIAD_SUBJECT_ID);
  const seededGoals = seedDataset.goals.filter((goal) => goal.subjectId === OLYMPIAD_SUBJECT_ID);
  const seededTopics = seedDataset.topics.filter((topic) => topic.subjectId === OLYMPIAD_SUBJECT_ID);

  if (!seededSubject || !seededGoals.length || !seededTopics.length) {
    return snapshot;
  }

  const existingTopicsById = new Map(
    snapshot.topics
      .filter((topic) => topic.subjectId === OLYMPIAD_SUBJECT_ID)
      .map((topic) => [topic.id, topic]),
  );

  const mergedTopics = seededTopics.map((seededTopic) =>
    mergeSeedTopicProgress(
      seededTopic,
      existingTopicsById.get(seededTopic.id),
    ),
  );

  const currentWeekStartKey = toDateKey(startOfPlannerWeek(referenceDate));

  await db.transaction("rw", [db.subjects, db.goals, db.topics, db.studyBlocks, db.meta], async () => {
    await db.subjects.put(seededSubject);
    await db.goals.bulkPut(seededGoals);
    await db.topics.bulkPut(mergedTopics);
    await db.studyBlocks
      .filter(
        (block) =>
          block.subjectId === OLYMPIAD_SUBJECT_ID &&
          block.weekStart >= currentWeekStartKey &&
          !["done", "partial", "missed"].includes(block.status),
      )
      .delete();
    await db.meta.put({ key: "olympiad-roadmap-version", value: OLYMPIAD_ROADMAP_VERSION });
  });

  const migratedSnapshot = await loadPlannerSnapshot();
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
      await db.preferences.put(seed.preferences);
      await db.meta.put({ key: "seeded", value: "true" });
      await db.meta.put({ key: "planning-model-version", value: PLANNING_MODEL_VERSION });
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
    topics,
    fixedEvents: fixedEvents.map(normalizeFixedEvent),
    sickDays: sickDays.map(normalizeSickDay),
    focusedDays: focusedDays.map(normalizeFocusedDay),
    studyBlocks,
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
      goals: seedDataset.goals,
      subjects: seedDataset.subjects,
      topics: seedDataset.topics,
      fixedEvents: seedDataset.fixedEvents,
      sickDays: seedDataset.sickDays,
      focusedDays: seedDataset.focusedDays,
      preferences: seedDataset.preferences,
    });

    await replacePlanningHorizon(
      initialPlan.studyBlocks,
      initialPlan.weeklyPlans,
      toDateKey(startOfPlannerWeek(referenceDate)),
    );
  }

  let snapshot = await loadPlannerSnapshot();
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

export async function replacePlanningHorizon(
  studyBlocks: StudyBlock[],
  weeklyPlans: WeeklyPlan[],
  horizonStartWeek: string,
) {
  const weekKeys = weeklyPlans.map((plan) => plan.weekStart);

  await db.transaction(
    "rw",
    db.studyBlocks,
    db.weeklyPlans,
    async () => {
      await db.studyBlocks
        .filter(
          (block) =>
            block.weekStart >= horizonStartWeek &&
            !shouldPreserveStudyBlockOnRegeneration(block),
        )
        .delete();
      await db.weeklyPlans
        .where("weekStart")
        .aboveOrEqual(horizonStartWeek)
        .delete();

      if (studyBlocks.length) {
        await db.studyBlocks.bulkPut(studyBlocks);
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

export async function deleteSickDayById(id: string) {
  await db.sickDays.delete(id);
}

export async function deleteFocusedDayById(id: string) {
  await db.focusedDays.delete(id);
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
  await db.studyBlocks.put(block);
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

  await db.transaction(
    "rw",
    [
      db.goals,
      db.subjects,
      db.topics,
      db.fixedEvents,
      db.sickDays,
      db.focusedDays,
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
        db.studyBlocks.clear(),
        db.completionLogs.clear(),
        db.weeklyPlans.clear(),
        db.preferences.clear(),
      ]);

      await db.goals.bulkPut(payload.goals);
      await db.subjects.bulkPut(payload.subjects);
      await db.topics.bulkPut(payload.topics);
      await db.fixedEvents.bulkPut(payload.fixedEvents.map(normalizeFixedEvent));
      await db.sickDays.bulkPut((payload.sickDays ?? []).map(normalizeSickDay));
      await db.focusedDays.bulkPut((payload.focusedDays ?? []).map(normalizeFocusedDay));
      await db.studyBlocks.bulkPut(payload.studyBlocks);
      await db.completionLogs.bulkPut(payload.completionLogs);
      await db.weeklyPlans.bulkPut(payload.weeklyPlans);
      await db.preferences.put(normalizePreferences(payload.preferences));
      await db.meta.put({ key: "seeded", value: "true" });
      await db.meta.put({ key: "planning-model-version", value: PLANNING_MODEL_VERSION });
    },
  );

  const snapshot = await loadPlannerSnapshot();
  return refreshPlanningModel(snapshot, new Date());
}

export function getCurrentWeekKey(referenceDate = new Date()) {
  return toDateKey(startOfPlannerWeek(referenceDate));
}
