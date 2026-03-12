import { getAcademicDeadline, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { generateStudyPlanHorizon, getPlanningHorizonEndWeek } from "@/lib/scheduler/generator";
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
  PlannerExportPayload,
  Preferences,
  SeedDataset,
  StudyBlock,
  WeeklyPlan,
} from "@/lib/types/planner";

const PLANNING_MODEL_VERSION = "2026-03-11-holiday-horizon-v1";
const CPP_BOOK_SUBJECT_ID = "cpp-book";

function normalizeFixedEvent(event: PlannerExportPayload["fixedEvents"][number]) {
  return {
    ...event,
    isAllDay: event.isAllDay ?? false,
  };
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
    underplannedSubjectIds: weeklyPlan.underplannedSubjectIds ?? [],
    weeksRemainingToDeadline: weeklyPlan.weeksRemainingToDeadline ?? 1,
    horizonEndDate: weeklyPlan.horizonEndDate ?? horizonEndDate,
  };
}

export interface PlannerSnapshot {
  goals: PlannerExportPayload["goals"];
  subjects: PlannerExportPayload["subjects"];
  topics: PlannerExportPayload["topics"];
  fixedEvents: PlannerExportPayload["fixedEvents"];
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

async function writeSeedDataset(seed: SeedDataset) {
  await db.transaction(
    "rw",
    [db.goals, db.subjects, db.topics, db.fixedEvents, db.preferences, db.meta],
    async () => {
      await db.goals.bulkPut(seed.goals);
      await db.subjects.bulkPut(seed.subjects);
      await db.topics.bulkPut(seed.topics);
      await db.fixedEvents.bulkPut(seed.fixedEvents);
      await db.preferences.put(seed.preferences);
      await db.meta.put({ key: "seeded", value: "true" });
      await db.meta.put({ key: "planning-model-version", value: PLANNING_MODEL_VERSION });
    },
  );
}

export async function loadPlannerSnapshot(): Promise<PlannerSnapshot> {
  const [goals, subjects, topics, fixedEvents, studyBlocks, completionLogs, weeklyPlans, preferences] =
    await Promise.all([
      db.goals.toArray(),
      db.subjects.toArray(),
      db.topics.toArray(),
      db.fixedEvents.toArray(),
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
        .filter((block) => block.weekStart >= horizonStartWeek && block.status !== "done")
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

export async function deleteFixedEventById(id: string) {
  await db.fixedEvents.delete(id);
}

export async function updateStudyBlock(block: StudyBlock) {
  await db.studyBlocks.put(block);
}

export async function saveCompletionLog(log: CompletionLog) {
  await db.completionLogs.put(log);
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
        db.studyBlocks.clear(),
        db.completionLogs.clear(),
        db.weeklyPlans.clear(),
        db.preferences.clear(),
      ]);

      await db.goals.bulkPut(payload.goals);
      await db.subjects.bulkPut(payload.subjects);
      await db.topics.bulkPut(payload.topics);
      await db.fixedEvents.bulkPut(payload.fixedEvents.map(normalizeFixedEvent));
      await db.studyBlocks.bulkPut(payload.studyBlocks);
      await db.completionLogs.bulkPut(payload.completionLogs);
      await db.weeklyPlans.bulkPut(payload.weeklyPlans);
      await db.preferences.put(normalizePreferences(payload.preferences));
      await db.meta.put({ key: "seeded", value: "true" });
    },
  );

  const snapshot = await loadPlannerSnapshot();
  return refreshPlanningModel(snapshot, new Date());
}

export function getCurrentWeekKey(referenceDate = new Date()) {
  return toDateKey(startOfPlannerWeek(referenceDate));
}
