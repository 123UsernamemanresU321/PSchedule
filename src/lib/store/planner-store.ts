"use client";

import { create } from "zustand";

import { fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { calculateFreeSlots, expandFixedEventsForWeek } from "@/lib/scheduler/free-slots";
import {
  generateStudyPlanHorizon,
  shouldAlwaysPreserveStudyBlockOnRegeneration,
} from "@/lib/scheduler/generator";
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
  getCurrentWeekKey,
  importPlannerData,
  initializePlannerDatabase,
  loadPlannerSnapshot,
  getCollapsedCoverageRepairState,
  repairCollapsedCoveragePlanningState,
  replacePlanningHorizon,
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
  importFromJson: (rawJson: string) => Promise<void>;
  selectStudyBlock: (id: string | null) => void;
}

async function recalculateCurrentWeek(options?: {
  preservedStudyBlockIds?: string[];
  preserveFlexibleFutureBlocks?: boolean;
  aggressiveFutureReset?: boolean;
}) {
  const referenceDate = new Date();
  const planningStartWeek = startOfPlannerWeek(referenceDate);
  const buildAndReplaceHorizon = async (snapshot: Awaited<ReturnType<typeof loadPlannerSnapshot>>) => {
    const repairState = getCollapsedCoverageRepairState(snapshot, referenceDate);
    const preservedStudyBlockIds = Array.from(
      new Set([
        ...(options?.preservedStudyBlockIds ?? []),
        ...snapshot.studyBlocks
          .filter(
            (block) =>
              ["planned", "rescheduled"].includes(block.status) &&
              isStudyBlockActiveAt(block, referenceDate),
          )
          .map((block) => block.id),
      ]),
    );
    const shouldAggressivelyResetFuture =
      repairState.hasCollapsedCoverage || options?.aggressiveFutureReset === true;
    const preserveFlexibleFutureBlocks = repairState.hasCollapsedCoverage
      ? false
      : options?.preserveFlexibleFutureBlocks;
    const replanned = generateStudyPlanHorizon({
      startWeek: planningStartWeek,
      goals: snapshot.goals,
      subjects: snapshot.subjects,
      topics: snapshot.topics,
      completionLogs: snapshot.completionLogs,
      fixedEvents: snapshot.fixedEvents,
      sickDays: snapshot.sickDays,
      focusedDays: snapshot.focusedDays,
      focusedWeeks: snapshot.focusedWeeks,
      preferences: snapshot.preferences,
      existingStudyBlocks: options?.aggressiveFutureReset
        ? buildHardConstraintFutureResetBaselineStudyBlocks(
            snapshot.studyBlocks,
            referenceDate,
            preservedStudyBlockIds,
          )
        : repairState.hasCollapsedCoverage
        ? buildCollapsedCoverageRepairBaselineStudyBlocks(
            snapshot.studyBlocks,
            referenceDate,
            preservedStudyBlockIds,
            repairState.invalidOverlapBlockIds,
          )
        : snapshot.studyBlocks,
      preservedStudyBlockIds,
      preserveFlexibleFutureBlocks,
    });

    await replacePlanningHorizon(
      replanned.studyBlocks,
      replanned.weeklyPlans,
      toDateKey(planningStartWeek),
      {
        preservedStudyBlockIds,
        preserveFlexibleFutureBlocks,
        aggressiveFutureReset: shouldAggressivelyResetFuture,
      },
    );
  };

  const snapshot = await repairCollapsedCoveragePlanningState(referenceDate);
  await buildAndReplaceHorizon(snapshot);

  let nextSnapshot = await loadPlannerSnapshot();
  if (!getCollapsedCoverageRepairState(nextSnapshot, referenceDate).hasCollapsedCoverage) {
    return nextSnapshot;
  }

  nextSnapshot = await repairCollapsedCoveragePlanningState(referenceDate);
  await buildAndReplaceHorizon(nextSnapshot);
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
      const snapshot = await recalculateCurrentWeek({
        preserveFlexibleFutureBlocks: false,
      });
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
        loading: false,
        error: null,
      });
      return;
    }

    const snapshot = await recalculateCurrentWeek({
      preserveFlexibleFutureBlocks: false,
      aggressiveFutureReset: true,
    });
    set({
      ...snapshot,
      loading: false,
      error: null,
    });
    get().setCurrentWeekStart(toDateKey(new Date(event.start)));
  },
  saveSickDay: async (sickDay) => {
    await persistSickDay(sickDay);
    const snapshot = await recalculateCurrentWeek({
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      loading: false,
      error: null,
    });
    get().setCurrentWeekStart(sickDay.startDate);
  },
  saveFocusedDay: async (focusedDay) => {
    await persistFocusedDay(focusedDay);
    const snapshot = await recalculateCurrentWeek({
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      loading: false,
      error: null,
    });
    get().setCurrentWeekStart(focusedDay.date);
  },
  saveFocusedWeek: async (focusedWeek) => {
    await persistFocusedWeek(focusedWeek);
    const snapshot = await recalculateCurrentWeek({
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
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
    const snapshot = await recalculateCurrentWeek({
      preserveFlexibleFutureBlocks: false,
      aggressiveFutureReset: true,
    });
    set({
      ...snapshot,
      loading: false,
      error: null,
    });
  },
  deleteSickDay: async (id) => {
    await deleteSickDayRecordById(id);
    const snapshot = await recalculateCurrentWeek({
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      loading: false,
      error: null,
    });
  },
  deleteFocusedDay: async (id) => {
    await deleteFocusedDayRecordById(id);
    const snapshot = await recalculateCurrentWeek({
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      loading: false,
      error: null,
    });
  },
  deleteFocusedWeek: async (id) => {
    await deleteFocusedWeekRecordById(id);
    const snapshot = await recalculateCurrentWeek({
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
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
    const snapshot = await recalculateCurrentWeek({
      preserveFlexibleFutureBlocks: false,
    });
    set({
      ...snapshot,
      loading: false,
      error: null,
    });
  },
  saveManualStudyBlock: async ({ start, end, topicId, notes, status, actualMinutes }) => {
    set({ loading: true, error: null });

    try {
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

      const nextSnapshot = await recalculateCurrentWeek({
        preservedStudyBlockIds: [nextBlock.id],
        preserveFlexibleFutureBlocks: false,
      });
      set({
        ...nextSnapshot,
        loading: false,
        error: null,
      });
      get().setCurrentWeekStart(toDateKey(startOfPlannerWeek(new Date(start))));
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
    set({ loading: true, error: null });

    try {
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

      const nextSnapshot = await recalculateCurrentWeek({
        preservedStudyBlockIds: [existingBlock.id],
        preserveFlexibleFutureBlocks: false,
      });
      set({
        ...nextSnapshot,
        loading: false,
        error: null,
      });
      get().setCurrentWeekStart(toDateKey(startOfPlannerWeek(new Date(start))));
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
          loading: false,
          error: null,
        });
        return;
      }

      const nextSnapshot = await recalculateCurrentWeek({
        preserveFlexibleFutureBlocks: false,
      });
      set({
        ...nextSnapshot,
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

    if (block.topicId) {
      await applyTopicProgressForStudyBlockUpdate({
        snapshot,
        previousBlock: block,
        nextBlock: updatedBlock,
      });
    }

    if (
      isSeriousOlympiadAttempt &&
      status === "done" &&
      completionLog &&
      shouldDoneStatusBypassReplan({
        previousBlock: block,
        nextBlock: updatedBlock,
      })
    ) {
      await maybeInsertImmediateOlympiadRewriteFollowUp({
        snapshot,
        sourceBlock: updatedBlock,
        completionLog,
      });
    }

    const referenceDate = new Date();
    const nextSnapshot = shouldRunStatusUpdateReplan({
      previousBlock: block,
      nextBlock: updatedBlock,
      studyBlocks: snapshot.studyBlocks,
      referenceDate,
      hasCollapsedCoverage: getCollapsedCoverageRepairState(snapshot, referenceDate).hasCollapsedCoverage,
    })
      ? await recalculateCurrentWeek({
          preserveFlexibleFutureBlocks: false,
          preservedStudyBlockIds: getStatusUpdatePreservedStudyBlockIds({
            studyBlocks: snapshot.studyBlocks,
            updatedBlockId: block.id,
            nextStatus: status,
            referenceDate,
          }),
        })
      : await loadPlannerSnapshot();
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
        if (!["planned", "rescheduled"].includes(candidate.status)) {
          return false;
        }

        return isStudyBlockActiveAt(candidate, now);
      })
      .map((candidate) => candidate.id);

    const nextSnapshot = await recalculateCurrentWeek({
      preservedStudyBlockIds,
      preserveFlexibleFutureBlocks: false,
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
      preserveFlexibleFutureBlocks: false,
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
}) {
  if (!options.nextBlock.topicId) {
    return;
  }

  const topic = options.snapshot.topics.find((candidate) => candidate.id === options.nextBlock.topicId);
  if (!topic) {
    return;
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
}) {
  const existingRewriteIds = getPendingOlympiadRewriteStudyBlockIdsForSource(
    options.snapshot.studyBlocks,
    options.sourceBlock.id,
  );

  if (existingRewriteIds.length > 0) {
    return false;
  }

  const obligation = getOlympiadRewriteObligations({
    topics: options.snapshot.topics,
    studyBlocks: [...options.snapshot.studyBlocks, options.sourceBlock],
    completionLogs: [...options.snapshot.completionLogs, options.completionLog],
  }).find((candidate) => candidate.sourceStudyBlockId === options.sourceBlock.id);

  if (!obligation || obligation.scheduledBlock) {
    return false;
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

      await updateStudyBlock(
        buildOlympiadRewriteFollowUpBlock({
          sourceBlock: options.sourceBlock,
          start,
          durationMinutes: obligation.durationMinutes,
          slotEnergy: slot.energy,
          dueAt: obligation.dueAt,
        }),
      );
      return true;
    }
  }

  return false;
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
