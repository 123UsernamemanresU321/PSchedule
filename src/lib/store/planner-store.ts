"use client";

import { create } from "zustand";

import { fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { generateStudyPlanHorizon } from "@/lib/scheduler/generator";
import { getAssignableTaskCandidatesForBlock } from "@/lib/scheduler/task-candidates";
import {
  deleteFixedEventById,
  deleteFocusedDayById as deleteFocusedDayRecordById,
  deleteSickDayById as deleteSickDayRecordById,
  excludeFixedEventOccurrence,
  exportPlannerData,
  getCurrentWeekKey,
  importPlannerData,
  initializePlannerDatabase,
  loadPlannerSnapshot,
  purgeInvalidFutureOlympiadAdvancedBlocks,
  replacePlanningHorizon,
  syncOlympiadRoadmapToSeed,
  deleteCompletionLogsByStudyBlockId,
  saveCompletionLog,
  saveFixedEvent,
  saveFocusedDay as persistFocusedDay,
  savePreferences,
  saveSickDay as persistSickDay,
  updateStudyBlock,
  updateTopic,
} from "@/lib/storage/planner-repository";
import type {
  CompletionLog,
  FixedEvent,
  FocusedDay,
  PlannerExportPayload,
  Preferences,
  SickDay,
  StudyBlock,
  StudyBlockStatus,
  Topic,
} from "@/lib/types/planner";
import { deriveTopicStatus } from "@/lib/topics/status";
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
  focusedDays: PlannerExportPayload["focusedDays"];
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
  deleteFixedEvent: (options: {
    id: string;
    scope?: "occurrence" | "series";
    occurrenceDate?: string;
  }) => Promise<void>;
  deleteSickDay: (id: string) => Promise<void>;
  deleteFocusedDay: (id: string) => Promise<void>;
  updatePreferences: (patch: Partial<Preferences>) => Promise<void>;
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
  importFromJson: (rawJson: string) => Promise<void>;
  selectStudyBlock: (id: string | null) => void;
}

async function recalculateCurrentWeek(options?: { preservedStudyBlockIds?: string[] }) {
  const referenceDate = new Date();
  let snapshot = await loadPlannerSnapshot();
  snapshot = await syncOlympiadRoadmapToSeed(snapshot, referenceDate);
  await purgeInvalidFutureOlympiadAdvancedBlocks(referenceDate);
  snapshot = await loadPlannerSnapshot();
  const planningStartWeek = startOfPlannerWeek(referenceDate);
  const replanned = generateStudyPlanHorizon({
    startWeek: planningStartWeek,
    goals: snapshot.goals,
    subjects: snapshot.subjects,
    topics: snapshot.topics,
    fixedEvents: snapshot.fixedEvents,
    sickDays: snapshot.sickDays,
    focusedDays: snapshot.focusedDays,
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
  focusedDays: [],
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
  saveFocusedDay: async (focusedDay) => {
    await persistFocusedDay(focusedDay);
    await get().regenerateHorizon();
    get().setCurrentWeekStart(focusedDay.date);
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
  deleteFocusedDay: async (id) => {
    await deleteFocusedDayRecordById(id);
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
    get().setCurrentWeekStart(toDateKey(startOfPlannerWeek(new Date(block.start))));
  },
  requestMorePractice: async ({ blockId, extraMinutes, notes = "" }) => {
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
        if (candidate.status !== "planned") {
          return false;
        }

        return new Date(candidate.end) > now;
      })
      .map((candidate) => candidate.id);

    const nextSnapshot = await recalculateCurrentWeek({
      preservedStudyBlockIds,
    });
    set({
      ...nextSnapshot,
      loading: false,
      error: null,
    });
    get().setCurrentWeekStart(toDateKey(startOfPlannerWeek(new Date(block.start))));
  },
  reassignStudyBlock: async ({ blockId, topicId, notes }) => {
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

    const nextSnapshot = await recalculateCurrentWeek({
      preservedStudyBlockIds: [block.id],
    });
    set({
      ...nextSnapshot,
      loading: false,
      error: null,
    });
    get().setCurrentWeekStart(toDateKey(startOfPlannerWeek(new Date(block.start))));
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
