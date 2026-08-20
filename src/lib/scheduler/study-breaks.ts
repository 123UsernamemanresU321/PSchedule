import { createId } from "@/lib/utils";
import type {
  CalendarSlot,
  EnergyLevel,
  Preferences,
  StudyBlock,
  SubjectId,
} from "@/lib/types/planner";

export const STUDY_BREAK_TRIGGER_MINUTES = 90;
export const MIN_ALLOCATABLE_STUDY_MINUTES = 30;

export interface StudyContinuityContext {
  continuousStudyMinutes: number;
  sameSubjectRunMinutes: number;
  previousSubjectId: SubjectId | null;
  previousStudyWasExactExam: boolean;
  followsPlannedBreak: boolean;
}

export function getEffectiveStudyBreakMinutes(preferences: Preferences): number {
  if (!preferences.breaksEnabled) {
    return 0;
  }

  const configuredMinutes = Number.isFinite(preferences.minBreakMinutes)
    ? Math.round(preferences.minBreakMinutes)
    : 0;
  return Math.max(15, configuredMinutes);
}

export function isSchedulableStudyBlockStatus(status: StudyBlock["status"]) {
  return (
    status === "planned" ||
    status === "rescheduled" ||
    status === "done" ||
    status === "partial"
  );
}

interface StudyCapacityState {
  continuousStudyMinutes: number;
  lastStudyEndTime: number | null;
  previousStudyWasExactExam: boolean;
}

type StudyCapacitySlot = Pick<
  CalendarSlot,
  "dateKey" | "start" | "end" | "durationMinutes"
>;

function getRequiredResetMinutesAfterStudy(
  previousStudyWasExactExam: boolean,
  breakMinutes: number,
) {
  return previousStudyWasExactExam
    ? Math.max(30, breakMinutes)
    : Math.max(0, breakMinutes);
}

function resetCapacityStateForNaturalPause(
  state: StudyCapacityState,
  nextStartTime: number,
  breakMinutes: number,
) {
  if (state.lastStudyEndTime == null) {
    return;
  }

  const requiredResetMinutes = getRequiredResetMinutesAfterStudy(
    state.previousStudyWasExactExam,
    breakMinutes,
  );
  const gapMinutes = Math.max(
    0,
    (nextStartTime - state.lastStudyEndTime) / 60000,
  );

  if (requiredResetMinutes > 0 && gapMinutes >= requiredResetMinutes) {
    state.continuousStudyMinutes = 0;
    state.previousStudyWasExactExam = false;
  }
}

function consumeFreeStudyCapacity(options: {
  state: StudyCapacityState;
  startTime: number;
  endTime: number;
  breakMinutes: number;
}) {
  const { state } = options;
  const breakMinutes = Math.max(0, options.breakMinutes);
  let cursorTime = options.startTime;
  let remainingMinutes = Math.max(
    0,
    Math.floor((options.endTime - options.startTime) / 60000),
  );
  let studyCapacityMinutes = 0;

  resetCapacityStateForNaturalPause(state, cursorTime, breakMinutes);

  while (remainingMinutes >= MIN_ALLOCATABLE_STUDY_MINUTES) {
    const requiredBreakMinutes = getRequiredResetMinutesAfterStudy(
      state.previousStudyWasExactExam,
      breakMinutes,
    );
    const breakDue =
      state.previousStudyWasExactExam ||
      (breakMinutes > 0 &&
        state.continuousStudyMinutes >= STUDY_BREAK_TRIGGER_MINUTES);

    if (breakDue) {
      if (
        remainingMinutes <
        requiredBreakMinutes + MIN_ALLOCATABLE_STUDY_MINUTES
      ) {
        break;
      }

      cursorTime += requiredBreakMinutes * 60000;
      remainingMinutes -= requiredBreakMinutes;
      state.continuousStudyMinutes = 0;
      state.previousStudyWasExactExam = false;
      state.lastStudyEndTime = null;
      continue;
    }

    const flexibleStudyCapacityMinutes =
      breakMinutes > 0
        ? Math.max(
            0,
            STUDY_BREAK_TRIGGER_MINUTES - state.continuousStudyMinutes,
          )
        : Number.POSITIVE_INFINITY;
    const nextStudyMinutes = Math.min(
      remainingMinutes,
      flexibleStudyCapacityMinutes,
    );

    if (nextStudyMinutes < MIN_ALLOCATABLE_STUDY_MINUTES) {
      break;
    }

    studyCapacityMinutes += nextStudyMinutes;
    state.continuousStudyMinutes += nextStudyMinutes;
    cursorTime += nextStudyMinutes * 60000;
    remainingMinutes -= nextStudyMinutes;
    state.lastStudyEndTime = cursorTime;
  }

  return studyCapacityMinutes;
}

export function getEffectiveStudyCapacityMinutes(
  slotMinutes: number,
  breakMinutes: number,
): number {
  const availableMinutes = Math.max(0, Math.floor(slotMinutes));
  return consumeFreeStudyCapacity({
    state: {
      continuousStudyMinutes: 0,
      lastStudyEndTime: null,
      previousStudyWasExactExam: false,
    },
    startTime: 0,
    endTime: availableMinutes * 60000,
    breakMinutes,
  });
}

function subtractBlockedIntervals(
  slot: StudyCapacitySlot,
  blockedStudyBlocks: StudyBlock[],
) {
  const slotStartTime = slot.start.getTime();
  const slotEndTime = slot.end.getTime();
  let segments = [{ startTime: slotStartTime, endTime: slotEndTime }];

  blockedStudyBlocks.forEach((block) => {
    const blockStartTime = new Date(block.start).getTime();
    const blockEndTime = new Date(block.end).getTime();

    segments = segments.flatMap((segment) => {
      if (
        blockEndTime <= segment.startTime ||
        blockStartTime >= segment.endTime
      ) {
        return [segment];
      }

      const remainingSegments: typeof segments = [];
      if (blockStartTime > segment.startTime) {
        remainingSegments.push({
          startTime: segment.startTime,
          endTime: Math.min(blockStartTime, segment.endTime),
        });
      }
      if (blockEndTime < segment.endTime) {
        remainingSegments.push({
          startTime: Math.max(blockEndTime, segment.startTime),
          endTime: segment.endTime,
        });
      }
      return remainingSegments;
    });
  });

  return segments.filter(
    (segment) => segment.endTime > segment.startTime,
  );
}

export function buildEffectiveStudyCapacityMinutesByDate(options: {
  availableSlots: StudyCapacitySlot[];
  preservedStudyBlocks: StudyBlock[];
  breakMinutes: number;
}) {
  const capacityMinutesByDate: Record<string, number> = {};
  const slotsByDate = new Map<string, StudyCapacitySlot[]>();
  const preservedBlocksByDate = new Map<string, StudyBlock[]>();

  options.availableSlots.forEach((slot) => {
    slotsByDate.set(slot.dateKey, [
      ...(slotsByDate.get(slot.dateKey) ?? []),
      slot,
    ]);
  });
  options.preservedStudyBlocks
    .filter((block) => isSchedulableStudyBlockStatus(block.status))
    .forEach((block) => {
      preservedBlocksByDate.set(block.date, [
        ...(preservedBlocksByDate.get(block.date) ?? []),
        block,
      ]);
    });

  slotsByDate.forEach((dateSlots, dateKey) => {
    const preservedBlocks = preservedBlocksByDate.get(dateKey) ?? [];
    const events = [
      ...dateSlots.flatMap((slot) =>
        subtractBlockedIntervals(slot, preservedBlocks).map((segment) => ({
          kind: "free" as const,
          ...segment,
        })),
      ),
      ...preservedBlocks
        .filter((block) => block.subjectId !== null)
        .map((block) => ({
          kind: "study" as const,
          block,
          startTime: new Date(block.start).getTime(),
          endTime: new Date(block.end).getTime(),
        })),
    ].sort(
      (left, right) =>
        left.startTime - right.startTime ||
        (left.kind === right.kind ? 0 : left.kind === "study" ? -1 : 1),
    );
    const state: StudyCapacityState = {
      continuousStudyMinutes: 0,
      lastStudyEndTime: null,
      previousStudyWasExactExam: false,
    };
    let dateCapacityMinutes = 0;

    events.forEach((event) => {
      if (event.kind === "free") {
        dateCapacityMinutes += consumeFreeStudyCapacity({
          state,
          startTime: event.startTime,
          endTime: event.endTime,
          breakMinutes: options.breakMinutes,
        });
        return;
      }

      resetCapacityStateForNaturalPause(
        state,
        event.startTime,
        options.breakMinutes,
      );
      state.continuousStudyMinutes += Math.max(
        0,
        event.block.estimatedMinutes,
      );
      state.lastStudyEndTime = event.endTime;
      state.previousStudyWasExactExam =
        state.previousStudyWasExactExam ||
        event.block.studyLayer === "exam_sim";
    });

    capacityMinutesByDate[dateKey] = dateCapacityMinutes;
  });

  return capacityMinutesByDate;
}

export function isPlannedStudyBreakBlock(
  block: Pick<
    StudyBlock,
    "subjectId" | "topicId" | "title" | "blockType" | "isAutoGenerated"
  >,
): boolean {
  return (
    block.subjectId === null &&
    block.topicId === null &&
    block.title === "Break" &&
    block.blockType === "recovery" &&
    block.isAutoGenerated
  );
}

function getBlockDurationMinutes(block: StudyBlock): number {
  return Math.max(0, block.estimatedMinutes);
}

export function getStudyContinuityContext(options: {
  blocks: StudyBlock[];
  dateKey: string;
  cursor: Date;
  resetMinutes: number;
}): StudyContinuityContext {
  const cursorTime = options.cursor.getTime();
  const relevantBlocks = options.blocks
    .filter((block) => {
      const startTime = new Date(block.start).getTime();
      const endTime = new Date(block.end).getTime();
      return (
        isSchedulableStudyBlockStatus(block.status) &&
        block.date === options.dateKey &&
        startTime < cursorTime &&
        endTime <= cursorTime
      );
    })
    .sort(
      (left, right) =>
        new Date(left.start).getTime() - new Date(right.start).getTime() ||
        new Date(left.end).getTime() - new Date(right.end).getTime(),
    );

  const previousSubjectId =
    [...relevantBlocks]
      .reverse()
      .find((block) => block.subjectId !== null)?.subjectId ?? null;
  const latestBlock = relevantBlocks.at(-1);
  const followsPlannedBreak = latestBlock
    ? isPlannedStudyBreakBlock(latestBlock)
    : false;

  let continuousStudyMinutes = 0;
  let sameSubjectRunMinutes = 0;
  let currentRunSubjectId: SubjectId | null = null;
  let previousStudyWasExactExam = false;
  let previousStudyEndTime: number | null = null;
  const resetMinutes = Math.max(0, options.resetMinutes);
  const relevantStudyBlocks = relevantBlocks.filter(
    (block) => block.subjectId !== null,
  );

  function applyNaturalPause(nextStartTime: number) {
    if (previousStudyEndTime == null) {
      return;
    }

    const gapMinutes = Math.max(
      0,
      (nextStartTime - previousStudyEndTime) / 60000,
    );
    const requiredResetMinutes = getRequiredResetMinutesAfterStudy(
      previousStudyWasExactExam,
      resetMinutes,
    );
    if (requiredResetMinutes <= 0 || gapMinutes < requiredResetMinutes) {
      return;
    }

    continuousStudyMinutes = 0;
    sameSubjectRunMinutes = 0;
    currentRunSubjectId = null;
    previousStudyWasExactExam = false;
  }

  relevantStudyBlocks.forEach((block) => {
    const blockStartTime = new Date(block.start).getTime();
    const blockEndTime = new Date(block.end).getTime();
    applyNaturalPause(blockStartTime);

    const durationMinutes = getBlockDurationMinutes(block);
    continuousStudyMinutes += durationMinutes;
    if (currentRunSubjectId === block.subjectId) {
      sameSubjectRunMinutes += durationMinutes;
    } else {
      currentRunSubjectId = block.subjectId;
      sameSubjectRunMinutes = durationMinutes;
    }
    previousStudyWasExactExam =
      previousStudyWasExactExam || block.studyLayer === "exam_sim";
    previousStudyEndTime = Math.max(
      previousStudyEndTime ?? Number.NEGATIVE_INFINITY,
      blockEndTime,
    );
  });

  applyNaturalPause(cursorTime);

  return {
    continuousStudyMinutes,
    sameSubjectRunMinutes,
    previousSubjectId,
    previousStudyWasExactExam,
    followsPlannedBreak,
  };
}

export function buildStudyOutputDiagnostics(
  studyBlocks: StudyBlock[],
  resetMinutes: number,
) {
  const maxConsecutiveStudyMinutesBySubject: Record<string, number> = {};
  let currentSubjectId: SubjectId | null = null;
  let currentDateKey: string | null = null;
  let currentEndTime: number | null = null;
  let currentRunMinutes = 0;
  let exactExamRecoveryDue = false;

  [...studyBlocks]
    .filter(
      (block) =>
        block.subjectId !== null &&
        isSchedulableStudyBlockStatus(block.status),
    )
    .sort(
      (left, right) =>
        new Date(left.start).getTime() - new Date(right.start).getTime() ||
        new Date(left.end).getTime() - new Date(right.end).getTime(),
    )
    .forEach((block) => {
      const blockStartTime = new Date(block.start).getTime();
      const blockEndTime = new Date(block.end).getTime();
      const gapMinutes =
        currentEndTime == null
          ? Number.POSITIVE_INFINITY
          : Math.max(0, (blockStartTime - currentEndTime) / 60000);
      const requiredResetMinutes = getRequiredResetMinutesAfterStudy(
        exactExamRecoveryDue,
        Math.max(0, resetMinutes),
      );
      const pauseKeepsContinuity =
        requiredResetMinutes > 0
          ? gapMinutes < requiredResetMinutes
          : gapMinutes === 0;

      if (!pauseKeepsContinuity) {
        exactExamRecoveryDue = false;
      }

      if (
        block.subjectId === currentSubjectId &&
        block.date === currentDateKey &&
        pauseKeepsContinuity
      ) {
        currentRunMinutes += getBlockDurationMinutes(block);
      } else {
        currentSubjectId = block.subjectId;
        currentDateKey = block.date;
        currentRunMinutes = getBlockDurationMinutes(block);
      }

      currentEndTime = blockEndTime;
      exactExamRecoveryDue =
        exactExamRecoveryDue || block.studyLayer === "exam_sim";
      maxConsecutiveStudyMinutesBySubject[block.subjectId!] = Math.max(
        maxConsecutiveStudyMinutesBySubject[block.subjectId!] ?? 0,
        currentRunMinutes,
      );
    });

  const plannedBreaks = studyBlocks.filter(
    (block) =>
      isSchedulableStudyBlockStatus(block.status) &&
      isPlannedStudyBreakBlock(block),
  );
  return {
    maxConsecutiveStudyMinutesBySubject,
    plannedBreakCount: plannedBreaks.length,
    plannedBreakMinutes: plannedBreaks.reduce(
      (total, block) => total + block.estimatedMinutes,
      0,
    ),
  };
}

export function shouldPreferDifferentStudySubject(
  continuity: StudyContinuityContext,
  eligibleSubjectIds: SubjectId[],
): boolean {
  if (
    !continuity.previousSubjectId ||
    (continuity.sameSubjectRunMinutes < STUDY_BREAK_TRIGGER_MINUTES &&
      !continuity.followsPlannedBreak)
  ) {
    return false;
  }

  return eligibleSubjectIds.some(
    (subjectId) => subjectId !== continuity.previousSubjectId,
  );
}

export function buildPlannedStudyBreakBlock(options: {
  weekStart: string;
  dateKey: string;
  start: Date;
  durationMinutes: number;
  slotEnergy: EnergyLevel;
}): StudyBlock {
  const durationMinutes = Math.max(0, Math.round(options.durationMinutes));
  const end = new Date(options.start.getTime() + durationMinutes * 60000);

  return {
    id: createId("block"),
    weekStart: options.weekStart,
    date: options.dateKey,
    start: options.start.toISOString(),
    end: end.toISOString(),
    subjectId: null,
    topicId: null,
    title: "Break",
    sessionSummary: "Take a short break before the next study session.",
    paperCode: null,
    unitTitle: null,
    blockType: "recovery",
    intensity: "light",
    generatedReason: "The planner inserted a planned break after continuous study.",
    scoreBreakdown: {
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
      coreSyllabusBonus: 0,
      orderPenalty: 0,
      total: 0,
    },
    status: "planned",
    isAutoGenerated: true,
    creationSource: "planner",
    sourceMaterials: [],
    slotEnergy: options.slotEnergy,
    estimatedMinutes: durationMinutes,
    actualMinutes: null,
    notes: "",
    rescheduleCount: 0,
    assignmentLocked: false,
    assignmentEditedAt: null,
  };
}
