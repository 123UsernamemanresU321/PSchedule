"use client";

import { create } from "zustand";

import { fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { generateStudyPlanHorizon } from "@/lib/scheduler/generator";
import {
  deleteFixedEventById,
  deleteSickDayById as deleteSickDayRecordById,
  excludeFixedEventOccurrence,
  exportPlannerData,
  getCurrentWeekKey,
  importPlannerData,
  initializePlannerDatabase,
  loadPlannerSnapshot,
  replacePlanningHorizon,
  deleteCompletionLogsByStudyBlockId,
  saveCompletionLog,
  saveFixedEvent,
  savePreferences,
  saveSickDay as persistSickDay,
  updateStudyBlock,
  updateTopic,
} from "@/lib/storage/planner-repository";
import type {
  CompletionLog,
  FixedEvent,
  PlannerExportPayload,
  Preferences,
  SickDay,
  StudyBlock,
  StudyBlockStatus,
  Topic,
} from "@/lib/types/planner";
import { createId } from "@/lib/utils";

interface PlannerState {
  initialized: boolean;
  loading: boolean;
  error: string | null;
  currentWeekStart: string;
  goals: PlannerExportPayload["goals"];
  subjects: PlannerExportPayload["subjects"];
  topics: PlannerExportPayload["topics"];
  fixedEvents: PlannerExportPayload["fixedEvents"];
  sickDays: PlannerExportPayload["sickDays"];
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
  deleteFixedEvent: (options: {
    id: string;
    scope?: "occurrence" | "series";
    occurrenceDate?: string;
  }) => Promise<void>;
  deleteSickDay: (id: string) => Promise<void>;
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
  updateStudyBlockStatus: (options: {
    blockId: string;
    status: Extract<StudyBlockStatus, "planned" | "done" | "partial" | "missed" | "rescheduled">;
    actualMinutes?: number;
    notes?: string;
    perceivedDifficulty?: CompletionLog["perceivedDifficulty"];
  }) => Promise<void>;
  exportToJson: () => Promise<string>;
  importFromJson: (rawJson: string) => Promise<void>;
  selectStudyBlock: (id: string | null) => void;
}

function deriveTopicStatus(topic: Topic) {
  const completionRatio = topic.completedHours / Math.max(topic.estHours, 0.25);
  if (completionRatio >= 1 && topic.mastery >= 4) {
    return "strong";
  }

  if (completionRatio >= 1) {
    return "reviewed";
  }

  if (completionRatio >= 0.7) {
    return "first_pass_done";
  }

  if (completionRatio > 0) {
    return "learning";
  }

  return "not_started";
}

async function recalculateCurrentWeek(options?: { preservedStudyBlockIds?: string[] }) {
  const snapshot = await loadPlannerSnapshot();
  const planningStartWeek = startOfPlannerWeek(new Date());
  const replanned = generateStudyPlanHorizon({
    startWeek: planningStartWeek,
    goals: snapshot.goals,
    subjects: snapshot.subjects,
    topics: snapshot.topics,
    fixedEvents: snapshot.fixedEvents,
    sickDays: snapshot.sickDays,
    preferences: snapshot.preferences,
    existingStudyBlocks: snapshot.studyBlocks,
    preservedStudyBlockIds: options?.preservedStudyBlockIds,
  });

  await replacePlanningHorizon(
    replanned.studyBlocks,
    replanned.weeklyPlans,
    toDateKey(planningStartWeek),
  );
  return loadPlannerSnapshot();
}

export const usePlannerStore = create<PlannerState>((set, get) => ({
  initialized: false,
  loading: false,
  error: null,
  currentWeekStart: getCurrentWeekKey(),
  goals: [],
  subjects: [],
  topics: [],
  fixedEvents: [],
  sickDays: [],
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
    set({ loading: true, error: null });

    try {
      const snapshot = await recalculateCurrentWeek();
      set({
        ...snapshot,
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
    await saveFixedEvent(event);
    await get().regenerateHorizon();
    get().setCurrentWeekStart(toDateKey(new Date(event.start)));
  },
  saveSickDay: async (sickDay) => {
    await persistSickDay(sickDay);
    await get().regenerateHorizon();
    get().setCurrentWeekStart(sickDay.startDate);
  },
  deleteFixedEvent: async ({ id, scope = "series", occurrenceDate }) => {
    if (scope === "occurrence" && occurrenceDate) {
      await excludeFixedEventOccurrence(id, occurrenceDate);
    } else {
      await deleteFixedEventById(id);
    }
    await get().regenerateHorizon();
  },
  deleteSickDay: async (id) => {
    await deleteSickDayRecordById(id);
    await get().regenerateHorizon();
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
    await get().regenerateHorizon();
  },
  updateStudyBlockStatus: async ({
    blockId,
    status,
    actualMinutes,
    notes = "",
    perceivedDifficulty = 3,
  }) => {
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

    if (status === "planned") {
      await deleteCompletionLogsByStudyBlockId(block.id);
    }

    if (status === "done" || status === "partial" || status === "missed") {
      const completionLog: CompletionLog = {
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

    if (block.topicId) {
      const topic = snapshot.topics.find((candidate) => candidate.id === block.topicId);
      if (topic) {
        const previousActualMinutes = block.actualMinutes ?? block.estimatedMinutes;
        const previousCompletedHoursDelta =
          block.status === "done"
            ? previousActualMinutes / 60
            : block.status === "partial"
              ? previousActualMinutes / 60
              : 0;
        const previousMasteryDelta =
          block.status === "done"
            ? 1
            : block.status === "partial"
              ? 0.5
              : block.status === "missed"
                ? -0.25
                : 0;
        const completedHoursDelta =
          status === "done"
            ? nextActualMinutes / 60
            : status === "partial"
              ? nextActualMinutes / 60
              : 0;
        const nextMastery = clampMastery(
          topic.mastery - previousMasteryDelta +
            (status === "done"
              ? 1
              : status === "partial"
                ? 0.5
                : status === "missed"
                  ? -0.25
                  : 0),
        );
        const nextTopic: Topic = {
          ...topic,
          completedHours: clampCompletedHours(
            topic.completedHours - previousCompletedHoursDelta + completedHoursDelta,
            topic.estHours,
          ),
          mastery: nextMastery,
          lastStudiedAt:
            status === "planned" ? topic.lastStudiedAt : new Date().toISOString(),
        };
        nextTopic.status = deriveTopicStatus(nextTopic);
        await updateTopic(nextTopic);
      }
    }

    const now = new Date();
    const preservedStudyBlockIds = snapshot.studyBlocks
      .filter((candidate) => {
        if (candidate.status !== "planned") {
          return false;
        }

        if (candidate.id === block.id && status !== "planned") {
          return false;
        }

        return new Date(candidate.end) > now;
      })
      .map((candidate) => candidate.id);

    if (status === "planned") {
      preservedStudyBlockIds.push(block.id);
    }

    const nextSnapshot = await recalculateCurrentWeek({
      preservedStudyBlockIds,
    });
    set({
      ...nextSnapshot,
      loading: false,
      error: null,
    });
    get().setCurrentWeekStart(block.weekStart);
  },
  exportToJson: async () => {
    const payload = await exportPlannerData();
    return JSON.stringify(payload, null, 2);
  },
  importFromJson: async (rawJson) => {
    set({ loading: true, error: null });

    try {
      const snapshot = await importPlannerData(rawJson);
      set({
        ...snapshot,
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

function clampMastery(value: number) {
  return Math.min(5, Math.max(0, value));
}

function clampCompletedHours(value: number, estHours: number) {
  return Math.min(estHours, Math.max(0, value));
}
