import { addDays, addMinutes, getISOWeek, isAfter } from "date-fns";

import {
  IB_REINFORCEMENT_MIN_SESSIONS_PER_WEEK,
  IB_REINFORCEMENT_MIN_SUBJECT_IDS,
  realCoverageSubjectIds,
  reinforcementSubjectIds,
  softMaintenanceSubjectIds,
  subjectIds,
  zeroUnscheduledCoverageSubjectIds,
} from "@/lib/constants/planner";
import {
  buildUnconfiguredWeeklyPlan,
  buildWeeklyPlan,
  computeSubjectDeadlineTracks,
} from "@/lib/scheduler/feasibility";
import {
  calculateFreeSlots,
  createSchedulingRunContext,
  expandReservedCommitmentWindowsForWeek,
  type SchedulingRunContext,
} from "@/lib/scheduler/free-slots";
import {
  getOlympiadNumberTheoryEligibilityStatus,
  getOlympiadStageGateStatus,
} from "@/lib/scheduler/olympiad-stage-gates";
import {
  getOlympiadWeekLoadProfile,
  getOlympiadWeaknessProfile,
} from "@/lib/scheduler/olympiad-performance";
import {
  buildSchoolTermWeekTemplate,
  IB_ANCHOR_SUBJECT_IDS,
} from "@/lib/scheduler/school-term-template";
import { scoreTaskCandidate, buildGeneratedReason } from "@/lib/scheduler/scoring";
import type { BlockSelectionPolicy } from "@/lib/scheduler/slot-classifier";
import { selectBlockOption } from "@/lib/scheduler/slot-classifier";
import { buildTaskCandidates } from "@/lib/scheduler/task-candidates";
import {
  formatHoursFromMinutes,
  getPlannerHorizonEndDate,
  getPlannerReferenceDate,
  startOfPlannerWeek,
  toDateKey,
} from "@/lib/dates/helpers";
import { clamp, createId, recordFromKeys, sum } from "@/lib/utils";
import type {
  CalendarSlot,
  FocusedDay,
  FocusedWeek,
  Goal,
  EffectiveReservedCommitmentDuration,
  SickDay,
  CompletionLog,
  Preferences,
  SchedulerResult,
  StudyBlock,
  StudyLayer,
  Subject,
  TaskCandidate,
  Topic,
  WeeklyPlan,
} from "@/lib/types/planner";

const MIN_ALLOCATABLE_MINUTES = 30;
const FOCUSED_DAY_RESERVED_SHARE = 0.7;
const FOCUS_STRICT_TOLERANCE_MINUTES = 10;
const MAX_HORIZON_EXTENSION_WEEKS = 104;
const CONTINUITY_BONUS = 5.5;
const SOFT_COMMITMENT_REDUCTION_STEP_MINUTES = 30;
const SOFT_COMMITMENT_REDUCTION_RULE_ORDER = ["piano-practice", "term-homework"] as const;
const DAILY_FILL_SUBJECT_ORDER: Subject["id"][] = [
  "maths-aa-hl",
  "physics-hl",
  "chemistry-hl",
  "olympiad",
  "cpp-book",
  "french-b-sl",
  "english-a-sl",
  "geography-transition",
];
const CORE_IB_FILL_SUBJECT_ORDER: Subject["id"][] = [
  "maths-aa-hl",
  "physics-hl",
  "chemistry-hl",
];
const REAL_COVERAGE_SUBJECT_ID_SET = new Set<Subject["id"]>([...realCoverageSubjectIds]);
const REINFORCEMENT_SUBJECT_ID_SET = new Set<Subject["id"]>([...reinforcementSubjectIds]);
const IB_REINFORCEMENT_MIN_SUBJECT_ID_SET = new Set<Subject["id"]>(
  IB_REINFORCEMENT_MIN_SUBJECT_IDS as readonly Subject["id"][],
);

const HARD_SCOPE_PRIORITY_BY_SUBJECT = Object.fromEntries(
  zeroUnscheduledCoverageSubjectIds.map((subjectId, index) => [
    subjectId,
    zeroUnscheduledCoverageSubjectIds.length - index,
  ]),
) as Record<string, number>;

function getSoftCommitmentFallbackTier(ruleId: string) {
  switch (ruleId) {
    case "piano-practice":
      return 2;
    case "term-homework":
      return 3;
    default:
      return 0;
  }
}

function getMaximumPlanningHorizonEndWeek(referenceDate: Date) {
  void referenceDate;
  return startOfPlannerWeek(getPlannerHorizonEndDate());
}

function clampPlanningHorizonEndWeek(endWeek: Date, referenceDate: Date) {
  const maximumEndWeek = getMaximumPlanningHorizonEndWeek(referenceDate);
  return endWeek.getTime() > maximumEndWeek.getTime() ? maximumEndWeek : endWeek;
}

function getHorizonEndDateKey(finalWeek: Date, referenceDate: Date) {
  const maximumEndWeek = getMaximumPlanningHorizonEndWeek(referenceDate);
  return finalWeek.getTime() >= maximumEndWeek.getTime()
    ? toDateKey(getPlannerHorizonEndDate())
    : toDateKey(finalWeek);
}

function getExtendedPlanningHorizonEndWeek(
  effectiveEndWeek: Date,
  referenceDate: Date,
) {
  return clampPlanningHorizonEndWeek(addDays(effectiveEndWeek, 7), referenceDate);
}

function canExtendPlanningHorizon(options: {
  effectiveEndWeek: Date;
  referenceDate: Date;
  extensionWeeksUsed: number;
}) {
  return (
    options.extensionWeeksUsed < MAX_HORIZON_EXTENSION_WEEKS &&
    options.effectiveEndWeek.getTime() <
      getMaximumPlanningHorizonEndWeek(options.referenceDate).getTime()
  );
}

function isMicroGapExtendableBlock(block: StudyBlock | undefined) {
  if (!block?.subjectId) {
    return false;
  }

  if (block.assignmentLocked || block.creationSource === "manual") {
    return false;
  }

  return block.studyLayer !== "exam_sim";
}

function getMicroGapAbsorptionPriority(block: StudyBlock | undefined) {
  if (!block?.subjectId) {
    return -1;
  }

  return HARD_SCOPE_PRIORITY_BY_SUBJECT[block.subjectId] ?? 0;
}

export function absorbStudyMicroGaps(options: {
  weekStart: Date;
  studyBlocks: StudyBlock[];
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  preferences: Preferences;
  sickDays?: SickDay[];
  planningStart?: Date;
  schedulingContext?: SchedulingRunContext;
}) {
  const weekStart = startOfPlannerWeek(options.weekStart);
  const clonedBlocks = options.studyBlocks.map((block) => ({ ...block }));
  const absorbedGapDateKeys = new Set<string>();

  for (let pass = 0; pass < 4; pass += 1) {
    const microGaps = calculateFreeSlots({
      weekStart,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays ?? [],
      preferences: options.preferences,
      blockedStudyBlocks: clonedBlocks,
      planningStart: options.planningStart,
      minimumDurationMinutes: 1,
      schedulingContext: options.schedulingContext,
    }).filter(
      (slot) => slot.durationMinutes > 0 && slot.durationMinutes < MIN_ALLOCATABLE_MINUTES,
    );
    let absorbedOnPass = false;

    microGaps.forEach((slot) => {
      const sameDayBlocks = clonedBlocks
        .filter((block) => block.date === slot.dateKey)
        .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
      const previousBlock = [...sameDayBlocks]
        .reverse()
        .find((block) => new Date(block.end).getTime() === slot.start.getTime());
      const nextBlock = sameDayBlocks.find(
        (block) => new Date(block.start).getTime() === slot.end.getTime(),
      );
      const previousEligible = isMicroGapExtendableBlock(previousBlock);
      const nextEligible = isMicroGapExtendableBlock(nextBlock);

      if (!previousEligible && !nextEligible) {
        return;
      }

      const gapMinutes = slot.durationMinutes;
      if (previousEligible && !nextEligible) {
        previousBlock!.end = addMinutes(new Date(previousBlock!.end), gapMinutes).toISOString();
      } else if (!previousEligible && nextEligible) {
        nextBlock!.start = addMinutes(new Date(nextBlock!.start), -gapMinutes).toISOString();
      } else {
        const previousPriority = getMicroGapAbsorptionPriority(previousBlock);
        const nextPriority = getMicroGapAbsorptionPriority(nextBlock);
        if (previousPriority >= nextPriority) {
          previousBlock!.end = addMinutes(new Date(previousBlock!.end), gapMinutes).toISOString();
        } else {
          nextBlock!.start = addMinutes(new Date(nextBlock!.start), -gapMinutes).toISOString();
        }
      }

      const adjustedBlock =
        previousEligible && (!nextEligible || getMicroGapAbsorptionPriority(previousBlock) >= getMicroGapAbsorptionPriority(nextBlock))
          ? previousBlock
          : nextBlock;
      if (adjustedBlock) {
        adjustedBlock.estimatedMinutes += gapMinutes;
      }
      absorbedGapDateKeys.add(slot.dateKey);
      absorbedOnPass = true;
    });

    if (!absorbedOnPass) {
      break;
    }
  }

  return {
    studyBlocks: clonedBlocks.sort(
      (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
    ),
    absorbedGapDateKeys: Array.from(absorbedGapDateKeys).sort((left, right) =>
      left.localeCompare(right),
    ),
  };
}

function isAutoGeneratedStudyFragment(block: StudyBlock) {
  return (
    !!block.subjectId &&
    !!block.topicId &&
    block.isAutoGenerated &&
    block.creationSource !== "manual" &&
    !block.assignmentLocked &&
    block.studyLayer !== "exam_sim"
  );
}

function isSchedulableStudyBlockStatus(status: StudyBlock["status"]) {
  return (
    status === "planned" ||
    status === "rescheduled" ||
    status === "done" ||
    status === "partial"
  );
}

function isFrenchGrammarTuneUpTopic(topic: Pick<Topic, "subjectId" | "title"> | null | undefined) {
  return topic?.subjectId === "french-b-sl" && topic.title.toLowerCase().includes("grammar tune-up");
}

function haveCompatibleStudyMetadata(left: StudyBlock, right: StudyBlock) {
  return (
    left.date === right.date &&
    left.subjectId === right.subjectId &&
    left.topicId === right.topicId &&
    (left.studyLayer ?? null) === (right.studyLayer ?? null) &&
    left.title === right.title &&
    (left.unitTitle ?? null) === (right.unitTitle ?? null) &&
    (left.paperCode ?? null) === (right.paperCode ?? null) &&
    (left.followUpKind ?? null) === (right.followUpKind ?? null) &&
    (left.followUpSourceStudyBlockId ?? null) === (right.followUpSourceStudyBlockId ?? null) &&
    JSON.stringify(left.sourceMaterials) === JSON.stringify(right.sourceMaterials)
  );
}

function areContiguousStudyFragments(left: StudyBlock, right: StudyBlock) {
  return (
    isAutoGeneratedStudyFragment(left) &&
    isAutoGeneratedStudyFragment(right) &&
    left.end === right.start &&
    haveCompatibleStudyMetadata(left, right)
  );
}

function getCompactedBlockType(blocks: StudyBlock[]) {
  const totalMinutes = blocks.reduce((total, block) => total + block.estimatedMinutes, 0);
  const shouldStayModerate =
    blocks.some((block) => block.slotEnergy === "low" || block.blockType === "recovery") ||
    totalMinutes <= 60;

  return shouldStayModerate ? "drill" : "standard_focus";
}

export function compactAdjacentStudyBlocks(studyBlocks: StudyBlock[]) {
  const sortedBlocks = [...studyBlocks].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  );
  const compactedBlocks: StudyBlock[] = [];
  let index = 0;

  while (index < sortedBlocks.length) {
    const run = [sortedBlocks[index]];
    let cursor = index + 1;

    while (
      cursor < sortedBlocks.length &&
      areContiguousStudyFragments(run[run.length - 1], sortedBlocks[cursor])
    ) {
      run.push(sortedBlocks[cursor]);
      cursor += 1;
    }

    if (run.length >= 2 && run.every((block) => block.estimatedMinutes <= MIN_ALLOCATABLE_MINUTES)) {
      const totalMinutes = run.reduce((total, block) => total + block.estimatedMinutes, 0);
      const blockType = getCompactedBlockType(run);
      compactedBlocks.push({
        ...run[0],
        end: run[run.length - 1].end,
        estimatedMinutes: totalMinutes,
        blockType,
        intensity: blockType === "drill" ? "moderate" : "heavy",
        generatedReason: `${run[0].generatedReason} Adjacent 30-minute fragments were compacted into one continuous ${totalMinutes}-minute session.`,
      });
    } else {
      compactedBlocks.push(...run.map((block) => ({ ...block })));
    }

    index = cursor;
  }

  return compactedBlocks.sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  );
}

function getAllowedBlockTypesForSlot(slot: CalendarSlot) {
  switch (slot.sickDaySeverity) {
    case "moderate":
      return new Set(["standard_focus", "drill", "review", "recovery"]);
    case "severe":
      return new Set(["drill", "review", "recovery"]);
    default:
      return null;
  }
}

export function getInlineBreakMinutes(
  remainingSlotMinutes: number,
  blockDurationMinutes: number,
  requestedBreakMinutes: number,
) {
  const remainingAfterBlock = remainingSlotMinutes - blockDurationMinutes;

  if (remainingAfterBlock < requestedBreakMinutes + MIN_ALLOCATABLE_MINUTES) {
    return 0;
  }

  return requestedBreakMinutes;
}

function buildRecoveryBlock(slot: CalendarSlot, weekStart: string): StudyBlock {
  return {
    id: createId("block"),
    weekStart,
    date: slot.dateKey,
    start: slot.start.toISOString(),
    end: slot.end.toISOString(),
    subjectId: null,
    topicId: null,
    title: "Recovery / buffer",
    sessionSummary: "Step away, reset mentally, and come back fresh for the next serious session.",
    paperCode: null,
    unitTitle: null,
    blockType: "recovery",
    intensity: "light",
    generatedReason:
      "The planner preserved this slot as explicit low-friction recovery so the week stays realistic after fixed commitments.",
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
      total: 0,
    },
    status: "planned",
    isAutoGenerated: true,
    creationSource: "planner",
    sourceMaterials: [],
    slotEnergy: slot.energy,
    estimatedMinutes: slot.durationMinutes,
    actualMinutes: null,
    notes: "",
    rescheduleCount: 0,
    assignmentLocked: false,
    assignmentEditedAt: null,
  };
}

function buildOverflowPracticeBlock(options: {
  slot: CalendarSlot;
  weekStart: string;
  subjectId: Subject["id"];
  start: Date;
  durationMinutes: number;
}): StudyBlock {
  if (!REINFORCEMENT_SUBJECT_ID_SET.has(options.subjectId)) {
    throw new Error(`Overflow reinforcement is disabled for ${options.subjectId}`);
  }

  const subjectLabelById: Record<string, { title: string; summary: string }> = {
    "physics-hl": {
      title: "Physics HL reinforcement",
      summary: "Extra mixed problem practice and concept checks on recently covered physics material.",
    },
    "maths-aa-hl": {
      title: "Maths AA HL reinforcement",
      summary: "Extra fluency work, short proofs, and problem drilling on recent maths material.",
    },
    "chemistry-hl": {
      title: "Chemistry HL reinforcement",
      summary: "Extra recall, mechanism review, and mixed chemistry problem reinforcement.",
    },
    olympiad: {
      title: "Olympiad reinforcement",
      summary: "Extra olympiad-style method rehearsal, proof cleanup, and mixed-problem reinforcement.",
    },
    "cpp-book": {
      title: "C++ reinforcement",
      summary: "Extra implementation practice and concept reinforcement on recent C++ material.",
    },
  };
  const subjectLabel = subjectLabelById[options.subjectId] ?? {
    title: "Reinforcement session",
    summary: "Extra reinforcement practice in leftover free time.",
  };
  const lightSlot = options.slot.energy === "low";

  return {
    id: createId("block"),
    weekStart: options.weekStart,
    date: options.slot.dateKey,
    start: options.start.toISOString(),
    end: addMinutes(options.start, options.durationMinutes).toISOString(),
    subjectId: options.subjectId,
    topicId: null,
    title: subjectLabel.title,
    sessionSummary: subjectLabel.summary,
    paperCode: null,
    unitTitle: null,
    blockType: lightSlot ? "drill" : "standard_focus",
    intensity: lightSlot ? "moderate" : "heavy",
    generatedReason:
      "The planner used leftover free time for extra reinforcement because deadline-critical work for this point in the horizon was already placed.",
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
      total: 0,
    },
    status: "planned",
    isAutoGenerated: true,
    creationSource: "planner",
    sourceMaterials: [],
    slotEnergy: options.slot.energy,
    estimatedMinutes: options.durationMinutes,
    actualMinutes: null,
    notes: "",
    rescheduleCount: 0,
    assignmentLocked: false,
    assignmentEditedAt: null,
  };
}

function isOverflowReinforcementBlock(block: StudyBlock) {
  return (
    !!block.subjectId &&
    REINFORCEMENT_SUBJECT_ID_SET.has(block.subjectId) &&
    !block.topicId &&
    block.title.includes("reinforcement")
  );
}

function countReinforcementSessionsBySubject(blocks: StudyBlock[]) {
  return blocks.reduce<Record<string, number>>((counts, block) => {
    if (!block.subjectId || !isOverflowReinforcementBlock(block)) {
      return counts;
    }

    counts[block.subjectId] = (counts[block.subjectId] ?? 0) + 1;
    return counts;
  }, {});
}

function fillReinforcementForWeek(options: {
  weekStart: Date;
  weeklyPlan: WeeklyPlan;
  realStudyBlocks: StudyBlock[];
  priorReinforcementBlocks: StudyBlock[];
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  preferences: Preferences;
  referenceDate: Date;
  horizonStartDate: Date;
  schedulingContext?: SchedulingRunContext;
}) {
  const weekStartKey = toDateKey(options.weekStart);
  const subjectMap = new Map(options.subjects.map((subject) => [subject.id, subject]));
  const finalDeadlineBySubject = buildFinalDeadlineBySubject(options.subjects, options.goals);
  const reinforcementBlocks: StudyBlock[] = [];
  const reinforcementMinutesByDate: Record<string, Record<string, number>> = {};
  const reinforcementMinutesBySubject = recordFromKeys(subjectIds, () => 0);
  const reinforcementSessionCountBySubject = {
    ...recordFromKeys(subjectIds, () => 0),
    ...countReinforcementSessionsBySubject(options.realStudyBlocks),
  };
  const fillOrder = ([
    "olympiad",
    ...DAILY_FILL_SUBJECT_ORDER.filter((subjectId) => subjectId !== "olympiad"),
  ] satisfies Subject["id"][]).filter((subjectId) => REINFORCEMENT_SUBJECT_ID_SET.has(subjectId));

  function isBeforeFinalDeadline(subjectId: Subject["id"], slotStart: Date) {
    const finalDeadline = finalDeadlineBySubject[subjectId];
    return !finalDeadline || slotStart.getTime() <= new Date(`${finalDeadline}T23:59:59`).getTime();
  }

  function getUnderMinimumIbReinforcementSubjectId(dateKey: string, slotStart: Date) {
    return ([...IB_REINFORCEMENT_MIN_SUBJECT_IDS] as Subject["id"][])
      .filter((subjectId) => {
        if (!subjectMap.has(subjectId) || !REINFORCEMENT_SUBJECT_ID_SET.has(subjectId)) {
          return false;
        }

        if (!isBeforeFinalDeadline(subjectId, slotStart)) {
          return false;
        }

        return (
          (reinforcementSessionCountBySubject[subjectId] ?? 0) <
          IB_REINFORCEMENT_MIN_SESSIONS_PER_WEEK
        );
      })
      .sort((left, right) => {
        const leftCount = reinforcementSessionCountBySubject[left] ?? 0;
        const rightCount = reinforcementSessionCountBySubject[right] ?? 0;

        if (leftCount !== rightCount) {
          return leftCount - rightCount;
        }

        const leftDateMinutes = reinforcementMinutesByDate[dateKey]?.[left] ?? 0;
        const rightDateMinutes = reinforcementMinutesByDate[dateKey]?.[right] ?? 0;

        if (leftDateMinutes !== rightDateMinutes) {
          return leftDateMinutes - rightDateMinutes;
        }

        const leftTotalMinutes = reinforcementMinutesBySubject[left] ?? 0;
        const rightTotalMinutes = reinforcementMinutesBySubject[right] ?? 0;

        if (leftTotalMinutes !== rightTotalMinutes) {
          return leftTotalMinutes - rightTotalMinutes;
        }

        return DAILY_FILL_SUBJECT_ORDER.indexOf(left) - DAILY_FILL_SUBJECT_ORDER.indexOf(right);
      })[0] ?? null;
  }

  function getReinforcementSubjectId(dateKey: string, slotStart: Date) {
    const underMinimumSubjectId = getUnderMinimumIbReinforcementSubjectId(dateKey, slotStart);

    if (underMinimumSubjectId) {
      return underMinimumSubjectId;
    }

    return fillOrder
      .filter((subjectId) => {
        if (!subjectMap.has(subjectId)) {
          return false;
        }

        return isBeforeFinalDeadline(subjectId, slotStart);
      })
      .sort((left, right) => {
        const leftDateMinutes = reinforcementMinutesByDate[dateKey]?.[left] ?? 0;
        const rightDateMinutes = reinforcementMinutesByDate[dateKey]?.[right] ?? 0;

        if (leftDateMinutes !== rightDateMinutes) {
          return leftDateMinutes - rightDateMinutes;
        }

        const leftTotalMinutes = reinforcementMinutesBySubject[left] ?? 0;
        const rightTotalMinutes = reinforcementMinutesBySubject[right] ?? 0;

        if (leftTotalMinutes !== rightTotalMinutes) {
          return leftTotalMinutes - rightTotalMinutes;
        }

        return fillOrder.indexOf(left) - fillOrder.indexOf(right);
      })[0] ?? null;
  }

  const initialFreeSlots = calculateFreeSlots({
    weekStart: options.weekStart,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays ?? [],
    preferences: options.preferences,
    blockedStudyBlocks: options.realStudyBlocks,
    planningStart: options.referenceDate,
    effectiveReservedCommitmentDurations: options.weeklyPlan.effectiveReservedCommitmentDurations,
    excludedReservedCommitmentRuleIds: options.weeklyPlan.excludedReservedCommitmentRuleIds,
    schedulingContext: options.schedulingContext,
  });

  initialFreeSlots.forEach((slot) => {
    let cursor = slot.start;
    let remainingSlotMinutes = slot.durationMinutes;

    while (remainingSlotMinutes >= MIN_ALLOCATABLE_MINUTES) {
      const subjectId = getReinforcementSubjectId(slot.dateKey, cursor);

      if (!subjectId) {
        break;
      }

      const durationMinutes = Math.min(
        remainingSlotMinutes,
        slot.energy === "low" ? 60 : 90,
      );
      const slotSlice = {
        ...slot,
        start: cursor,
        end: addMinutes(cursor, durationMinutes),
        durationMinutes,
      };
      const block = buildOverflowPracticeBlock({
        slot: slotSlice,
        weekStart: weekStartKey,
        subjectId,
        start: cursor,
        durationMinutes,
      });

      reinforcementBlocks.push(block);
      reinforcementMinutesByDate[slot.dateKey] = {
        ...(reinforcementMinutesByDate[slot.dateKey] ?? {}),
        [subjectId]: (reinforcementMinutesByDate[slot.dateKey]?.[subjectId] ?? 0) + durationMinutes,
      };
      reinforcementMinutesBySubject[subjectId] += durationMinutes;
      reinforcementSessionCountBySubject[subjectId] =
        (reinforcementSessionCountBySubject[subjectId] ?? 0) + 1;
      cursor = addMinutes(cursor, durationMinutes);
      remainingSlotMinutes = Math.max(0, remainingSlotMinutes - durationMinutes);
    }
  });

  const studyBlocks = [...options.realStudyBlocks, ...reinforcementBlocks].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  );
  const assignedHoursBySubject = {
    ...options.weeklyPlan.assignedHoursBySubject,
  };
  Object.entries(reinforcementMinutesBySubject).forEach(([subjectId, minutes]) => {
    if (minutes <= 0) {
      return;
    }

    assignedHoursBySubject[subjectId] =
      Math.round(((assignedHoursBySubject[subjectId] ?? 0) + minutes / 60) * 10) / 10;
  });

  return {
    studyBlocks,
    weeklyPlan: {
      ...options.weeklyPlan,
      assignedHoursBySubject,
      fillableGapDateKeys: [],
      weekHasOpenCapacity: false,
      slackMinutes: 0,
    },
  };
}

function cloneTasks(tasks: TaskCandidate[]) {
  return tasks.map((task) => ({ ...task }));
}

interface DayCapacityEntry {
  capacity: number;
  dayIndex: number;
  scheduleRegime: CalendarSlot["scheduleRegime"];
}

function buildDayCapacityByDate(freeSlots: CalendarSlot[]) {
  return freeSlots.reduce<Record<string, DayCapacityEntry>>((accumulator, slot) => {
    const current = accumulator[slot.dateKey] ?? {
      capacity: 0,
      dayIndex: slot.dayIndex,
      scheduleRegime: slot.scheduleRegime,
    };
    // Accumulate the full slot duration. The daily cap is enforced later by
    // the allocation loop's dailyBudget check, so hard-capping here would
    // silently strand small free slots that exceed the cap.
    current.capacity = current.capacity + slot.durationMinutes;
    current.dayIndex = slot.dayIndex;
    current.scheduleRegime = slot.scheduleRegime;
    accumulator[slot.dateKey] = current;
    return accumulator;
  }, {});
}

function buildLastSlotEndByDate(freeSlots: CalendarSlot[]) {
  return freeSlots.reduce<Record<string, number>>((accumulator, slot) => {
    accumulator[slot.dateKey] = Math.max(
      accumulator[slot.dateKey] ?? 0,
      slot.end.getTime(),
    );
    return accumulator;
  }, {});
}

function getReservedTargetMinutesForDay(options: {
  dayEntry: DayCapacityEntry;
  preferences: Preferences;
  fillAvailableStudyDays: boolean;
}) {
  const { dayEntry, preferences, fillAvailableStudyDays } = options;

  if (fillAvailableStudyDays) {
    if (dayEntry.scheduleRegime === "holiday" || dayEntry.dayIndex === 6) {
      return dayEntry.capacity;
    }

    if (dayEntry.dayIndex === 0 && preferences.sundayStudy.enabled) {
      return Math.min(
        dayEntry.capacity,
        Math.max(
          45,
          Math.floor((dayEntry.capacity * preferences.sundayStudy.workloadIntensity) / 15) * 15,
        ),
      );
    }

    return 0;
  }

  if (dayEntry.dayIndex === 6) {
    return Math.min(
      dayEntry.capacity,
      Math.max(240, Math.floor((dayEntry.capacity * 0.55) / 15) * 15),
    );
  }

  if (dayEntry.dayIndex === 0 && preferences.sundayStudy.enabled) {
    return Math.min(dayEntry.capacity, 60);
  }

  return 0;
}

function buildDailyTargetMinutes(options: {
  dayCapacityByDate: Record<string, DayCapacityEntry>;
  effectiveCapacityMinutes: number;
  preferences: Preferences;
  fillAvailableStudyDays: boolean;
  focusedSubjectsByDate?: Record<string, string[]>;
}) {
  const dayKeys = Object.keys(options.dayCapacityByDate).sort();
  const totalDayCapacity = sum(Object.values(options.dayCapacityByDate).map((entry) => entry.capacity));

  if (!dayKeys.length || totalDayCapacity <= 0 || options.effectiveCapacityMinutes <= 0) {
    return {} as Record<string, number>;
  }

  const targets = dayKeys.reduce<Record<string, number>>((accumulator, dayKey) => {
    accumulator[dayKey] = getReservedTargetMinutesForDay({
      dayEntry: options.dayCapacityByDate[dayKey],
      preferences: options.preferences,
      fillAvailableStudyDays: options.fillAvailableStudyDays,
    });
    return accumulator;
  }, {});

  dayKeys.forEach((dayKey) => {
    const focusedSubjectCount = options.focusedSubjectsByDate?.[dayKey]?.length ?? 0;
    if (focusedSubjectCount <= 0) {
      return;
    }

    const minimumFocusedTarget = Math.min(
      options.dayCapacityByDate[dayKey].capacity,
      Math.max(60, Math.min(focusedSubjectCount * 60, 180)),
    );

    targets[dayKey] = Math.max(targets[dayKey], minimumFocusedTarget);
  });

  const reservedTargetMinutes = sum(Object.values(targets));
  const cappedEffectiveCapacityMinutes = clamp(
    Math.max(options.effectiveCapacityMinutes, reservedTargetMinutes),
    0,
    totalDayCapacity,
  );
  let assignedTargetMinutes = reservedTargetMinutes;
  let remainingTargetMinutes = Math.max(0, cappedEffectiveCapacityMinutes - assignedTargetMinutes);

  if (remainingTargetMinutes > 0) {
    dayKeys.forEach((dayKey) => {
      const remainingCapacity = Math.max(
        options.dayCapacityByDate[dayKey].capacity - targets[dayKey],
        0,
      );

      if (remainingCapacity < 15) {
        return;
      }

      const rawShare = (remainingTargetMinutes * remainingCapacity) / Math.max(
        15,
        totalDayCapacity - reservedTargetMinutes,
      );
      const roundedShare = Math.min(
        remainingCapacity,
        Math.max(0, Math.floor(rawShare / 15) * 15),
      );
      targets[dayKey] += roundedShare;
      assignedTargetMinutes += roundedShare;
    });

    remainingTargetMinutes = Math.max(
      0,
      cappedEffectiveCapacityMinutes - assignedTargetMinutes,
    );
  }

  while (remainingTargetMinutes >= 15) {
    const nextDay = dayKeys
      .filter(
        (dayKey) => targets[dayKey] + 15 <= options.dayCapacityByDate[dayKey].capacity,
      )
      .sort((left, right) => {
        const leftRemaining = options.dayCapacityByDate[left].capacity - targets[left];
        const rightRemaining = options.dayCapacityByDate[right].capacity - targets[right];
        return rightRemaining - leftRemaining;
      })[0];

    if (!nextDay) {
      break;
    }

    targets[nextDay] += 15;
    remainingTargetMinutes -= 15;
    assignedTargetMinutes += 15;
  }

  return targets;
}

function buildFocusedSubjectsByDate(options: {
  weekStart: Date;
  focusedDays?: FocusedDay[];
  focusedWeeks?: FocusedWeek[];
}) {
  const focusedSubjectsByDate: Record<string, string[]> = {};
  const weekStartKey = toDateKey(options.weekStart);
  const visibleDateKeys = Array.from({ length: 7 }, (_, index) =>
    toDateKey(addDays(options.weekStart, index)),
  );

  (options.focusedWeeks ?? []).forEach((focusedWeek) => {
    if (focusedWeek.weekStart !== weekStartKey || !focusedWeek.subjectIds.length) {
      return;
    }

    visibleDateKeys.forEach((dateKey) => {
      focusedSubjectsByDate[dateKey] = focusedWeek.subjectIds;
    });
  });

  (options.focusedDays ?? []).forEach((focusedDay) => {
    if (!focusedDay.subjectIds.length || !visibleDateKeys.includes(focusedDay.date)) {
      return;
    }

    focusedSubjectsByDate[focusedDay.date] = focusedDay.subjectIds;
  });

  return focusedSubjectsByDate;
}

function buildFocusedTargetMinutesByDate(options: {
  focusedSubjectsByDate: Record<string, string[]>;
  dayCapacityByDate: Record<string, DayCapacityEntry>;
}) {
  return Object.keys(options.focusedSubjectsByDate).reduce<Record<string, number>>(
    (accumulator, dateKey) => {
      const dayCapacityMinutes = options.dayCapacityByDate[dateKey]?.capacity ?? 0;

      if (dayCapacityMinutes < MIN_ALLOCATABLE_MINUTES) {
        accumulator[dateKey] = 0;
        return accumulator;
      }

      const reservedMinutes = Math.min(
        dayCapacityMinutes,
        Math.max(
          60,
          Math.round((dayCapacityMinutes * FOCUSED_DAY_RESERVED_SHARE) / 15) * 15,
        ),
      );

      accumulator[dateKey] = reservedMinutes;
      return accumulator;
    },
    {},
  );
}

function buildFocusedSubjectTargetMinutesByDate(options: {
  focusedSubjectsByDate: Record<string, string[]>;
  focusedTargetMinutesByDate: Record<string, number>;
  requiredMinutesBySubject: Record<string, number>;
}) {
  return Object.entries(options.focusedSubjectsByDate).reduce<Record<string, Record<string, number>>>(
    (accumulator, [dateKey, subjectIds]) => {
      const totalFocusedTargetMinutes = options.focusedTargetMinutesByDate[dateKey] ?? 0;

      if (totalFocusedTargetMinutes < MIN_ALLOCATABLE_MINUTES || !subjectIds.length) {
        accumulator[dateKey] = {};
        return accumulator;
      }

      const subjectWeights = subjectIds.map((subjectId) => ({
        subjectId,
        weight: Math.max(options.requiredMinutesBySubject[subjectId] ?? 0, 60),
      }));
      const totalWeight = sum(subjectWeights.map((entry) => entry.weight));
      const subjectTargets = recordFromKeys(subjectIds, () => 0);
      let assignedTargetMinutes = 0;

      subjectWeights.forEach(({ subjectId, weight }) => {
        const rawShare = (totalFocusedTargetMinutes * weight) / Math.max(totalWeight, 1);
        const roundedShare = Math.max(
          subjectWeights.length === 1 ? MIN_ALLOCATABLE_MINUTES : 0,
          Math.floor(rawShare / 15) * 15,
        );
        subjectTargets[subjectId] = roundedShare;
        assignedTargetMinutes += roundedShare;
      });

      while (assignedTargetMinutes + 15 <= totalFocusedTargetMinutes) {
        const nextSubject = [...subjectWeights]
          .sort((left, right) => {
            const leftProgress = subjectTargets[left.subjectId] / Math.max(left.weight, 1);
            const rightProgress = subjectTargets[right.subjectId] / Math.max(right.weight, 1);
            return leftProgress - rightProgress;
          })[0];

        if (!nextSubject) {
          break;
        }

        subjectTargets[nextSubject.subjectId] += 15;
        assignedTargetMinutes += 15;
      }

      accumulator[dateKey] = subjectTargets;
      return accumulator;
    },
    {},
  );
}

function buildRequiredHoursFromTracks(subjects: Subject[], tracks: Record<string, { recommendedWeeklyHours: number }>) {
  return Object.fromEntries(
    subjects.map((subject) => {
      const recommendedHours = tracks[subject.id]?.recommendedWeeklyHours ?? 0;
      return [
        subject.id,
        recommendedHours > 0
          ? Math.max(0.5, Math.ceil(recommendedHours / 0.5) * 0.5)
          : 0,
      ];
    }),
  );
}

function buildDeadlinePaceHoursFromTracks(subjects: Subject[], tracks: Record<string, { baselineWeeklyHours: number }>) {
  return Object.fromEntries(
    subjects.map((subject) => [subject.id, tracks[subject.id]?.baselineWeeklyHours ?? 0]),
  );
}

function buildRequiredHoursFromTasks(tasks: TaskCandidate[]) {
  return tasks.reduce<Record<string, number>>((accumulator, task) => {
    if (!task.subjectId) {
      return accumulator;
    }

    accumulator[task.subjectId] = (accumulator[task.subjectId] ?? 0) + task.remainingMinutes / 60;
    return accumulator;
  }, {});
}

function buildFullCoverageHoursBySubject(subjects: Subject[], tasks: TaskCandidate[]) {
  const requiredHoursBySubject = recordFromKeys(
    subjects.map((subject) => subject.id),
    () => 0,
  );

  Object.entries(buildRequiredHoursFromTasks(tasks)).forEach(([subjectId, requiredHours]) => {
    if (subjectId in requiredHoursBySubject) {
      requiredHoursBySubject[subjectId as keyof typeof requiredHoursBySubject] = requiredHours;
    }
  });

  return requiredHoursBySubject;
}

function buildFinalDeadlineBySubject(subjects: Subject[], goals: Goal[]) {
  const deadlineBySubject = Object.fromEntries(
    subjects.map((subject) => [subject.id, subject.deadline]),
  ) as Record<string, string>;

  goals.forEach((goal) => {
    const current = deadlineBySubject[goal.subjectId];
    if (!current || new Date(goal.deadline).getTime() > new Date(current).getTime()) {
      deadlineBySubject[goal.subjectId] = goal.deadline;
    }
  });

  return deadlineBySubject;
}

function getRealCoverageUnscheduledMinutesBySubject(options: {
  subjects: Subject[];
  topics: Topic[];
  studyBlocks: StudyBlock[];
  referenceDate: Date;
}) {
  const referenceTime = options.referenceDate.getTime();
  const topicById = new Map(options.topics.map((topic) => [topic.id, topic]));
  const uncappedPlannedMinutesByTopic = options.studyBlocks.reduce<Record<string, number>>(
    (accumulator, block) => {
      const topic = block.topicId ? topicById.get(block.topicId) : null;
      const isSyntheticReviewFollowUp =
        !!topic &&
        !topic.id.endsWith("-review") &&
        block.blockType === "review" &&
        block.title === `${topic.title} review`;

      if (
        !topic ||
        !REAL_COVERAGE_SUBJECT_ID_SET.has(topic.subjectId) ||
        (block.status !== "planned" && block.status !== "rescheduled") ||
        new Date(block.end).getTime() <= referenceTime ||
        isSyntheticReviewFollowUp
      ) {
        return accumulator;
      }

      accumulator[topic.id] = (accumulator[topic.id] ?? 0) + block.estimatedMinutes;
      return accumulator;
    },
    {},
  );

  return Object.fromEntries(
    options.subjects
      .filter((subject) => REAL_COVERAGE_SUBJECT_ID_SET.has(subject.id))
      .map((subject) => {
        const unscheduledMinutes = options.topics
          .filter((topic) => topic.subjectId === subject.id)
          .reduce((total, topic) => {
            const remainingMinutes = Math.max(
              Math.round((topic.estHours - topic.completedHours) * 60),
              0,
            );
            const plannedMinutes = Math.min(
              uncappedPlannedMinutesByTopic[topic.id] ?? 0,
              remainingMinutes,
            );

            return total + Math.max(remainingMinutes - plannedMinutes, 0);
          }, 0);

        return [subject.id, unscheduledMinutes];
      }),
  ) as Record<string, number>;
}

function hasCompleteRealCoverage(options: {
  subjects: Subject[];
  topics: Topic[];
  studyBlocks: StudyBlock[];
  referenceDate: Date;
}) {
  return Object.values(getRealCoverageUnscheduledMinutesBySubject(options)).every(
    (minutes) => minutes === 0,
  );
}

function roundUpToAllocatableMinutes(minutes: number) {
  if (minutes <= 0) {
    return 0;
  }

  return Math.ceil(minutes / MIN_ALLOCATABLE_MINUTES) * MIN_ALLOCATABLE_MINUTES;
}

function sumFreeSlotMinutes(slots: CalendarSlot[]) {
  return Math.round(sum(slots.map((slot) => slot.durationMinutes)));
}

function sortEffectiveReservedCommitmentDurations(
  durations: EffectiveReservedCommitmentDuration[],
) {
  return [...durations].sort(
    (left, right) =>
      left.dateKey.localeCompare(right.dateKey) ||
      left.ruleId.localeCompare(right.ruleId),
  );
}

function summarizeEffectiveReservedCommitmentDurations(
  windows: Array<{
    dateKey: string;
    ruleId: string;
    start: string;
    end: string;
  }>,
) {
  const durationsByKey = new Map<string, EffectiveReservedCommitmentDuration>();

  windows.forEach((window) => {
    const durationMinutes = Math.max(
      0,
      Math.round((new Date(window.end).getTime() - new Date(window.start).getTime()) / 60000),
    );

    if (durationMinutes <= 0) {
      return;
    }

    const key = `${window.dateKey}:${window.ruleId}`;
    const current = durationsByKey.get(key);

    if (current) {
      current.durationMinutes += durationMinutes;
      return;
    }

    durationsByKey.set(key, {
      dateKey: window.dateKey,
      ruleId: window.ruleId,
      durationMinutes,
    });
  });

  return sortEffectiveReservedCommitmentDurations(Array.from(durationsByKey.values()));
}

function deriveExcludedReservedCommitmentRuleIds(options: {
  baseDurations: EffectiveReservedCommitmentDuration[];
  effectiveDurations: EffectiveReservedCommitmentDuration[];
}) {
  const baseMinutesByRule = new Map<string, number>();
  const effectiveMinutesByRule = new Map<string, number>();

  options.baseDurations.forEach((entry) => {
    baseMinutesByRule.set(entry.ruleId, (baseMinutesByRule.get(entry.ruleId) ?? 0) + entry.durationMinutes);
  });
  options.effectiveDurations.forEach((entry) => {
    effectiveMinutesByRule.set(
      entry.ruleId,
      (effectiveMinutesByRule.get(entry.ruleId) ?? 0) + entry.durationMinutes,
    );
  });

  return Array.from(baseMinutesByRule.entries())
    .filter(([, baseMinutes]) => baseMinutes > 0)
    .filter(([ruleId]) => (effectiveMinutesByRule.get(ruleId) ?? 0) <= 0)
    .map(([ruleId]) => ruleId)
    .sort((left, right) => left.localeCompare(right));
}

function buildBaseReservedCommitmentDurationsForWeek(options: {
  weekStart: Date;
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  preferences: Preferences;
  planningStart: Date;
  schedulingContext?: SchedulingRunContext;
}) {
  return summarizeEffectiveReservedCommitmentDurations(
    expandReservedCommitmentWindowsForWeek(
      options.weekStart,
      options.preferences,
      options.fixedEvents,
      options.sickDays ?? [],
      [],
      [],
      options.planningStart,
      options.schedulingContext,
    ),
  );
}

function buildReducedReservedCommitmentDurations(
  durations: EffectiveReservedCommitmentDuration[],
  target: EffectiveReservedCommitmentDuration,
) {
  return sortEffectiveReservedCommitmentDurations(
    durations.map((entry) =>
      entry.dateKey === target.dateKey && entry.ruleId === target.ruleId
        ? {
            ...entry,
            durationMinutes: Math.max(0, entry.durationMinutes - SOFT_COMMITMENT_REDUCTION_STEP_MINUTES),
          }
        : entry,
    ),
  );
}

function calculateFreeSlotCapacityForWeek(options: {
  weekStart: Date;
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  preferences: Preferences;
  blockedStudyBlocks: StudyBlock[];
  planningStart: Date;
  effectiveReservedCommitmentDurations: EffectiveReservedCommitmentDuration[];
  schedulingContext?: SchedulingRunContext;
}) {
  return sumFreeSlotMinutes(
    calculateFreeSlots({
      weekStart: options.weekStart,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays ?? [],
      preferences: options.preferences,
      blockedStudyBlocks: options.blockedStudyBlocks,
      planningStart: options.planningStart,
      effectiveReservedCommitmentDurations: options.effectiveReservedCommitmentDurations,
      schedulingContext: options.schedulingContext,
    }),
  );
}

function chooseBestSoftCommitmentReduction(options: {
  ruleId: (typeof SOFT_COMMITMENT_REDUCTION_RULE_ORDER)[number];
  currentDurations: EffectiveReservedCommitmentDuration[];
  weekStart: Date;
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  preferences: Preferences;
  blockedStudyBlocks: StudyBlock[];
  planningStart: Date;
  schedulingContext?: SchedulingRunContext;
}):
  | {
      reducedDurations: EffectiveReservedCommitmentDuration[];
      capacityMinutes: number;
      dateKey: string;
    }
  | null {
  const reducibleDurations = options.currentDurations.filter(
    (entry) => entry.ruleId === options.ruleId && entry.durationMinutes >= SOFT_COMMITMENT_REDUCTION_STEP_MINUTES,
  );

  if (!reducibleDurations.length) {
    return null;
  }

  let bestCandidate: {
    reducedDurations: EffectiveReservedCommitmentDuration[];
    capacityMinutes: number;
    dateKey: string;
  } | null = null;

  reducibleDurations.forEach((entry) => {
    const reducedDurations = buildReducedReservedCommitmentDurations(options.currentDurations, entry);
    const capacityMinutes = calculateFreeSlotCapacityForWeek({
      weekStart: options.weekStart,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays,
      preferences: options.preferences,
      blockedStudyBlocks: options.blockedStudyBlocks,
      planningStart: options.planningStart,
      effectiveReservedCommitmentDurations: reducedDurations,
      schedulingContext: options.schedulingContext,
    });

    if (
      !bestCandidate ||
      capacityMinutes > bestCandidate.capacityMinutes ||
      (capacityMinutes === bestCandidate.capacityMinutes &&
        entry.dateKey.localeCompare(bestCandidate.dateKey) > 0)
    ) {
      bestCandidate = {
        reducedDurations,
        capacityMinutes,
        dateKey: entry.dateKey,
      };
    }
  });

  return bestCandidate;
}

function getTaskConstraintDeadlineTime(task: TaskCandidate) {
  return [
    task.followUpDueAt,
    task.latestAt,
    task.reviewDue,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .map((value) => new Date(value).getTime())
    .filter((value) => !Number.isNaN(value))
    .sort((left, right) => left - right)[0] ?? null;
}

function calculateHardInWeekDemandMinutes(options: {
  remainingTasks: TaskCandidate[];
  weekEnd: Date;
}) {
  const weekEndTime = options.weekEnd.getTime();

  return roundUpToAllocatableMinutes(
    sum(
      options.remainingTasks
        .filter((task) => {
          const availableAtTime = task.availableAt ? new Date(task.availableAt).getTime() : null;
          if (availableAtTime != null && availableAtTime > weekEndTime) {
            return false;
          }

          const constraintDeadlineTime = getTaskConstraintDeadlineTime(task);
          if (constraintDeadlineTime == null || constraintDeadlineTime > weekEndTime) {
            return false;
          }

          return task.followUpKind === "olympiad-rewrite" || task.sessionMode === "exam";
        })
        .map((task) => task.remainingMinutes),
    ),
  );
}

function calculateSoftCommitmentTargetCapacityMinutes(options: {
  currentWeek: Date;
  referenceDate: Date;
  coverageReferenceDate?: Date;
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  preferences: Preferences;
  blockedStudyBlocks: StudyBlock[];
  remainingTasks: TaskCandidate[];
  remainingTaskMinutes: number;
  weeklyRequiredMinutes: number;
  baseDurations: EffectiveReservedCommitmentDuration[];
  schedulingContext?: SchedulingRunContext;
}) {
  const weekEnd = addDays(options.currentWeek, 6);
  const hardInWeekDemandMinutes = calculateHardInWeekDemandMinutes({
    remainingTasks: options.remainingTasks,
    weekEnd,
  });
  const isPartialCurrentWeek = toDateKey(options.referenceDate) !== toDateKey(options.currentWeek);

  if (!isPartialCurrentWeek) {
    return Math.min(
      options.remainingTaskMinutes,
      Math.max(options.weeklyRequiredMinutes, hardInWeekDemandMinutes),
    );
  }

  const fullWeekBaseDurations = buildBaseReservedCommitmentDurationsForWeek({
    weekStart: options.currentWeek,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
    preferences: options.preferences,
    planningStart: options.currentWeek,
    schedulingContext: options.schedulingContext,
  });
  const fullWeekCapacityMinutes = calculateFreeSlotCapacityForWeek({
    weekStart: options.currentWeek,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
    preferences: options.preferences,
    blockedStudyBlocks: options.blockedStudyBlocks,
    planningStart: options.currentWeek,
    effectiveReservedCommitmentDurations: fullWeekBaseDurations,
    schedulingContext: options.schedulingContext,
  });
  const remainingWeekCapacityMinutes = calculateFreeSlotCapacityForWeek({
    weekStart: options.currentWeek,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
    preferences: options.preferences,
    blockedStudyBlocks: options.blockedStudyBlocks,
    planningStart: options.referenceDate,
    effectiveReservedCommitmentDurations: options.baseDurations,
    schedulingContext: options.schedulingContext,
  });
  const remainingWeekDemandMinutes =
    fullWeekCapacityMinutes > 0
      ? roundUpToAllocatableMinutes(
          (options.weeklyRequiredMinutes * remainingWeekCapacityMinutes) / fullWeekCapacityMinutes,
        )
      : 0;

  return Math.min(
    options.remainingTaskMinutes,
    Math.max(remainingWeekDemandMinutes, hardInWeekDemandMinutes),
  );
}

function getDailyAnchorSubjectId(dateKey: string) {
  const day = new Date(`${dateKey}T12:00:00`);
  const dayIndex = day.getDay();

  switch (dayIndex) {
    case 1:
      return "maths-aa-hl" as const;
    case 2:
      return "physics-hl" as const;
    case 3:
      return "chemistry-hl" as const;
    case 4:
      return "maths-aa-hl" as const;
    case 5:
      return getISOWeek(day) % 2 === 1 ? ("physics-hl" as const) : ("chemistry-hl" as const);
    default:
      return null;
  }
}

function buildDailyFillSubjectOrder(options: {
  dateKey: string;
  requiredMinutesBySubject: Record<string, number>;
}) {
  const anchorSubjectId = getDailyAnchorSubjectId(options.dateKey);
  const anchorCandidates = anchorSubjectId ? [anchorSubjectId] : [];
  const otherCoreSubjects = CORE_IB_FILL_SUBJECT_ORDER.filter(
    (subjectId) => subjectId !== anchorSubjectId,
  ).sort((left, right) => {
    const rightRequiredMinutes = options.requiredMinutesBySubject[right] ?? 0;
    const leftRequiredMinutes = options.requiredMinutesBySubject[left] ?? 0;

    if (rightRequiredMinutes !== leftRequiredMinutes) {
      return rightRequiredMinutes - leftRequiredMinutes;
    }

    return DAILY_FILL_SUBJECT_ORDER.indexOf(left) - DAILY_FILL_SUBJECT_ORDER.indexOf(right);
  });

  return [
    ...anchorCandidates,
    ...otherCoreSubjects,
    "olympiad",
    "french-b-sl",
    "cpp-book",
    "english-a-sl",
    "geography-transition",
  ] satisfies Subject["id"][];
}

export function selectEffectiveReservedCommitmentPlanForWeek(options: {
  currentWeek: Date;
  endWeek: Date;
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  completionLogs?: CompletionLog[];
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  focusedDays?: FocusedDay[];
  focusedWeeks?: FocusedWeek[];
  preferences: Preferences;
  existingPlannedBlocks: StudyBlock[];
  lockedBlocks?: StudyBlock[];
  horizonStartDate: Date;
  subjectDeadlinesById: Record<string, string>;
  availabilityOverrideSubjectIds?: Subject["id"][];
  schedulingContext?: SchedulingRunContext;
}) {
  const referenceDate = getPlannerReferenceDate(options.currentWeek, options.horizonStartDate);
  const baseDurations = buildBaseReservedCommitmentDurationsForWeek({
    weekStart: options.currentWeek,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
    preferences: options.preferences,
    planningStart: referenceDate,
    schedulingContext: options.schedulingContext,
  });
  const remainingTasks = buildTaskCandidates({
    topics: options.topics,
    existingPlannedBlocks: options.existingPlannedBlocks,
    completionLogs: options.completionLogs,
    referenceDate,
    coverageReferenceDate: options.horizonStartDate,
    subjectDeadlinesById: options.subjectDeadlinesById,
    availabilityOverrideSubjectIds: options.availabilityOverrideSubjectIds,
  });
  const remainingTaskMinutes = Math.round(
    sum(remainingTasks.map((task) => task.remainingMinutes)),
  );

  if (!baseDurations.length || remainingTaskMinutes <= 0) {
    return {
      effectiveReservedCommitmentDurations: baseDurations,
      excludedReservedCommitmentRuleIds: deriveExcludedReservedCommitmentRuleIds({
        baseDurations,
        effectiveDurations: baseDurations,
      }),
      fallbackTierUsed: 0,
      reducedRuleIds: [] as string[],
    };
  }

  const deadlineTracks = computeSubjectDeadlineTracks({
    subjects: options.subjects,
    goals: options.goals,
    topics: options.topics,
    completionLogs: options.completionLogs,
    referenceDate,
    horizonStartDate: options.horizonStartDate,
    weekStartDate: options.currentWeek,
    weekEndDate: addDays(options.currentWeek, 6),
    priorPlannedBlocks: options.existingPlannedBlocks,
    preferences: options.preferences,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
  });
  const weeklyRequiredMinutes = Math.round(
    sum(
      Object.values(buildRequiredHoursFromTracks(options.subjects, deadlineTracks)).map(
        (hours) => hours * 60,
      ),
    ),
  );
  const blockedStudyBlocks = options.lockedBlocks ?? [];
  const targetCapacityMinutes = calculateSoftCommitmentTargetCapacityMinutes({
    currentWeek: options.currentWeek,
    referenceDate,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
    preferences: options.preferences,
    blockedStudyBlocks,
    remainingTasks,
    remainingTaskMinutes,
    weeklyRequiredMinutes,
    baseDurations,
    schedulingContext: options.schedulingContext,
  });
  let currentDurations = baseDurations;
  const reducedRuleIds = new Set<string>();
  let fallbackTierUsed = 0;
  let capacityMinutes = calculateFreeSlotCapacityForWeek({
    weekStart: options.currentWeek,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
    preferences: options.preferences,
    blockedStudyBlocks,
    planningStart: referenceDate,
    effectiveReservedCommitmentDurations: currentDurations,
    schedulingContext: options.schedulingContext,
  });

  while (capacityMinutes + MIN_ALLOCATABLE_MINUTES < targetCapacityMinutes) {
    let reduced = false;

    for (const ruleId of SOFT_COMMITMENT_REDUCTION_RULE_ORDER) {
      const candidate = chooseBestSoftCommitmentReduction({
        ruleId,
        currentDurations,
        weekStart: options.currentWeek,
        fixedEvents: options.fixedEvents,
        sickDays: options.sickDays,
        preferences: options.preferences,
        blockedStudyBlocks,
        planningStart: referenceDate,
        schedulingContext: options.schedulingContext,
      });

      if (!candidate) {
        continue;
      }

      currentDurations = candidate.reducedDurations;
      capacityMinutes = candidate.capacityMinutes;
      reducedRuleIds.add(ruleId);
      fallbackTierUsed = Math.max(fallbackTierUsed, getSoftCommitmentFallbackTier(ruleId));
      reduced = true;
      break;
    }

    if (!reduced) {
      break;
    }
  }

  return {
    effectiveReservedCommitmentDurations: currentDurations,
    excludedReservedCommitmentRuleIds: deriveExcludedReservedCommitmentRuleIds({
      baseDurations,
      effectiveDurations: currentDurations,
    }),
    fallbackTierUsed,
    reducedRuleIds: Array.from(reducedRuleIds).sort((left, right) => left.localeCompare(right)),
  };
}

function buildFutureFocusedReserveMinutesBySubject(options: {
  currentWeek: Date;
  endWeek: Date;
  topics: Topic[];
  completionLogs?: CompletionLog[];
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  focusedDays?: FocusedDay[];
  focusedWeeks?: FocusedWeek[];
  preferences: Preferences;
  subjectDeadlinesById: Record<string, string>;
  existingPlannedBlocks: StudyBlock[];
  horizonStartDate: Date;
  availabilityOverrideSubjectIds?: Subject["id"][];
  effectiveReservedCommitmentDurations?: EffectiveReservedCommitmentDuration[];
  excludedReservedCommitmentRuleIds?: string[];
  schedulingContext?: SchedulingRunContext;
  getEffectiveReservedCommitmentPlanForWeek?: (weekStart: Date) => {
    effectiveReservedCommitmentDurations: EffectiveReservedCommitmentDuration[];
    excludedReservedCommitmentRuleIds: string[];
  };
}) {
  const futureFocusedSubjectIds = new Set<string>();

  for (
    let futureWeek = addDays(options.currentWeek, 7);
    futureWeek.getTime() <= options.endWeek.getTime();
    futureWeek = addDays(futureWeek, 7)
  ) {
    const focusedSubjectsByDate = buildFocusedSubjectsByDate({
      weekStart: futureWeek,
      focusedDays: options.focusedDays,
      focusedWeeks: options.focusedWeeks,
    });

    Object.values(focusedSubjectsByDate).forEach((subjectIds) => {
      subjectIds.forEach((subjectId) => futureFocusedSubjectIds.add(subjectId));
    });
  }

  const reserveMinutesBySubject = recordFromKeys(subjectIds, () => 0);

  if (futureFocusedSubjectIds.size === 0) {
    return reserveMinutesBySubject;
  }

  const remainingTasks = buildTaskCandidates({
    topics: options.topics,
    existingPlannedBlocks: options.existingPlannedBlocks,
    completionLogs: options.completionLogs,
    referenceDate: getPlannerReferenceDate(options.currentWeek, options.horizonStartDate),
    coverageReferenceDate: options.horizonStartDate,
    subjectDeadlinesById: options.subjectDeadlinesById,
    availabilityOverrideSubjectIds: Array.from(
      new Set([
        ...futureFocusedSubjectIds,
        ...(options.availabilityOverrideSubjectIds ?? []),
      ]),
    ),
  });
  const remainingRequiredMinutesBySubject = recordFromKeys(subjectIds, () => 0);

  remainingTasks.forEach((task) => {
    if (!task.subjectId) {
      return;
    }

    remainingRequiredMinutesBySubject[task.subjectId] += task.remainingMinutes;
  });

  for (
    let futureWeek = addDays(options.currentWeek, 7);
    futureWeek.getTime() <= options.endWeek.getTime();
    futureWeek = addDays(futureWeek, 7)
  ) {
    const focusedSubjectsByDate = buildFocusedSubjectsByDate({
      weekStart: futureWeek,
      focusedDays: options.focusedDays,
      focusedWeeks: options.focusedWeeks,
    });

    if (!Object.keys(focusedSubjectsByDate).length) {
      continue;
    }

    const futureWeekSlots = calculateFreeSlots({
      weekStart: futureWeek,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays ?? [],
      preferences: options.preferences,
      blockedStudyBlocks: [],
      planningStart: futureWeek,
      effectiveReservedCommitmentDurations:
        options.getEffectiveReservedCommitmentPlanForWeek?.(futureWeek)
          ?.effectiveReservedCommitmentDurations ??
        options.effectiveReservedCommitmentDurations,
      excludedReservedCommitmentRuleIds:
        options.getEffectiveReservedCommitmentPlanForWeek?.(futureWeek)
          ?.excludedReservedCommitmentRuleIds ??
        options.excludedReservedCommitmentRuleIds,
      schedulingContext: options.schedulingContext,
    });
    const dayCapacityByDate = buildDayCapacityByDate(futureWeekSlots);
    const focusedTargetMinutesByDate = buildFocusedTargetMinutesByDate({
      focusedSubjectsByDate,
      dayCapacityByDate,
    });
    const focusedSubjectTargetMinutesByDate = buildFocusedSubjectTargetMinutesByDate({
      focusedSubjectsByDate,
      focusedTargetMinutesByDate,
      requiredMinutesBySubject: remainingRequiredMinutesBySubject,
    });

    Object.values(focusedSubjectTargetMinutesByDate).forEach((subjectTargetMinutes) => {
      Object.entries(subjectTargetMinutes).forEach(([subjectId, minutes]) => {
        if (subjectId in reserveMinutesBySubject) {
          reserveMinutesBySubject[subjectId as keyof typeof reserveMinutesBySubject] += minutes;
        }
      });
    });
  }

  Object.keys(reserveMinutesBySubject).forEach((subjectId) => {
    const typedSubjectId = subjectId as keyof typeof reserveMinutesBySubject;
    reserveMinutesBySubject[typedSubjectId] = Math.min(
      reserveMinutesBySubject[typedSubjectId],
      remainingRequiredMinutesBySubject[typedSubjectId],
    );
  });

  return reserveMinutesBySubject;
}

interface AllocationPassPolicy {
  allowLowEnergyHeavy?: boolean;
  allowLateNightDeepWork?: boolean;
  preferLongerBlocks?: boolean;
  protectRecovery?: boolean;
  skipMovableRecovery?: boolean;
  heavySessionBoost?: number;
  dailyCapBoostMinutes?: number;
  minBreakMinutes?: number;
  countAsForcedCoverage?: boolean;
  blockSelectionPolicy?: BlockSelectionPolicy;
}

function createStudyBlockFromTask(options: {
  task: TaskCandidate;
  weekStart: string;
  slot: CalendarSlot;
  start: Date;
  durationMinutes: number;
  generatedReason: string;
  scoreBreakdown: StudyBlock["scoreBreakdown"];
  blockType: StudyBlock["blockType"];
  intensity: StudyBlock["intensity"];
}) {
  return {
    id: createId("block"),
    weekStart: options.weekStart,
    date: options.slot.dateKey,
    start: options.start.toISOString(),
    end: addMinutes(options.start, options.durationMinutes).toISOString(),
    subjectId: options.task.subjectId,
    topicId: options.task.topicId,
    title: options.task.title,
    sessionSummary: options.task.sessionSummary,
    paperCode: options.task.paperCode,
    unitTitle: options.task.unitTitle,
    blockType: options.blockType,
    intensity: options.intensity,
    generatedReason: options.generatedReason,
    scoreBreakdown: options.scoreBreakdown,
    status: "planned",
    isAutoGenerated: true,
    creationSource: "planner",
    sourceMaterials: options.task.sourceMaterials,
    slotEnergy: options.slot.energy,
    estimatedMinutes: options.durationMinutes,
    actualMinutes: null,
    notes: "",
    rescheduleCount: 0,
    assignmentLocked: false,
    assignmentEditedAt: null,
    studyLayer: options.task.studyLayer ?? null,
    followUpKind: options.task.followUpKind ?? null,
    followUpSourceStudyBlockId: options.task.followUpSourceStudyBlockId ?? null,
    followUpDueAt: options.task.followUpDueAt ?? null,
  } satisfies StudyBlock;
}

function allocateTasksToSlots(options: {
  weekStart: Date;
  referenceDate: Date;
  coverageReferenceDate?: Date;
  freeSlots: CalendarSlot[];
  tasks: TaskCandidate[];
  subjects: Subject[];
  goals: Goal[];
  topics: Topic[];
  completionLogs?: CompletionLog[];
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  preferences: Preferences;
  lockedBlocks: StudyBlock[];
  priorPlannedBlocks?: StudyBlock[];
  requiredHoursBySubject?: Record<string, number>;
  futureFocusedReserveMinutesBySubject?: Record<string, number>;
  dailyCapBoostMinutes?: number;
  heavySessionBoost?: number;
  minBreakMinutes?: number;
  protectRecovery?: boolean;
  blockSelectionPolicy?: BlockSelectionPolicy;
  fillAvailableStudyDays?: boolean;
  focusedSubjectsByDate?: Record<string, string[]>;
  allowLargeGapAbsorption?: boolean;
  availabilityOverrideSubjectIds?: Subject["id"][];
  olympiadLoadMultiplier?: number;
  olympiadWeaknessStrand?: "geometry" | "algebra" | "number-theory" | "combinatorics" | null;
  isFinalPass?: boolean;
  allowReinforcement?: boolean;
  dayStudyCapOverrideMinutesByDate?: Record<string, number>;
  schoolTermTemplate?: ReturnType<typeof buildSchoolTermWeekTemplate>;
  schedulingContext?: SchedulingRunContext;
}) {
  const weekStartKey = toDateKey(options.weekStart);
  const subjectMap = new Map(options.subjects.map((subject) => [subject.id, subject]));
  const topicMap = new Map(options.topics.map((topic) => [topic.id, topic]));
  const examTopicIds = new Set(
    options.topics
      .filter((topic) => (topic.sessionMode ?? "flexible") === "exam")
      .map((topic) => topic.id),
  );
  const requiredHoursBySubject =
    options.requiredHoursBySubject ??
    Object.fromEntries(
      options.subjects.map((subject) => [subject.id, 0]),
    );
  const requiredMinutesBySubject = Object.fromEntries(
    Object.entries(requiredHoursBySubject).map(([key, value]) => [key, Math.round(value * 60)]),
  );
  const subjectDeadlinesById = Object.fromEntries(
    options.subjects.map((subject) => [subject.id, subject.deadline]),
  );
  const finalDeadlineBySubject = buildFinalDeadlineBySubject(options.subjects, options.goals);
  const assignedMinutesBySubject = recordFromKeys(subjectIds, () => 0);
  const dailyMinutes: Record<string, number> = {};
  const heavyBlocksPerDay: Record<string, number> = {};
  const subjectMinutesByDate: Record<string, Record<string, number>> = {};
  const subjectMinutesByWeekStart: Record<string, Record<string, number>> = {};

  function getWeekKeyForDate(dateKey: string) {
    return toDateKey(startOfPlannerWeek(new Date(`${dateKey}T12:00:00`)));
  }

  function hasPendingTaskForSubject(subjectId: Subject["id"]) {
    return workingTasks.some(
      (task) =>
        task.subjectId === subjectId &&
        task.remainingMinutes >= MIN_ALLOCATABLE_MINUTES,
    );
  }

  function hasEligibleTaskForSubject(subjectId: Subject["id"], slotStart: Date) {
    return workingTasks.some(
      (task) =>
        task.subjectId === subjectId &&
        task.remainingMinutes >= MIN_ALLOCATABLE_MINUTES &&
        (!task.availableAt || new Date(task.availableAt) <= slotStart) &&
        isTaskDependencySatisfied(task, slotStart),
    );
  }

  function hasOpenRealCoverageTask() {
    return workingTasks.some(
      (task) =>
        !!task.subjectId &&
        REAL_COVERAGE_SUBJECT_ID_SET.has(task.subjectId) &&
        task.remainingMinutes > 0,
    );
  }

  function hasOpenRealCoverageWork() {
    if (hasOpenRealCoverageTask()) {
      return true;
    }

    const unscheduledBySubject = getRealCoverageUnscheduledMinutesBySubject({
      subjects: options.subjects,
      topics: options.topics,
      studyBlocks: [
        ...(options.priorPlannedBlocks ?? []),
        ...options.lockedBlocks,
        ...scheduledBlocks,
      ],
      referenceDate: options.coverageReferenceDate ?? options.referenceDate,
    });

    return Object.values(unscheduledBySubject).some((minutes) => minutes > 0);
  }

  function canUseOverflowPracticeSubject(subjectId: Subject["id"], dateKey: string, slotStart: Date) {
    if (!options.allowReinforcement) {
      return false;
    }

    if (!subjectMap.has(subjectId)) {
      return false;
    }

    if (!REINFORCEMENT_SUBJECT_ID_SET.has(subjectId)) {
      return false;
    }

    if (hasOpenRealCoverageWork()) {
      return false;
    }

    const finalDeadline = finalDeadlineBySubject[subjectId];
    if (finalDeadline && slotStart.getTime() > new Date(`${finalDeadline}T23:59:59`).getTime()) {
      return false;
    }

    if (hasPendingTaskForSubject(subjectId) && !hasEligibleTaskForSubject(subjectId, slotStart)) {
      return false;
    }

    void dateKey;
    return true;
  }

  function hasReachedWeeklyTarget(task: TaskCandidate, dateKey?: string) {
    if (options.fillAvailableStudyDays) {
      return false;
    }

    if (!task.subjectId) {
      return false;
    }

    if (dateKey) {
      const focusedSubjectTargetMinutes =
        focusedSubjectTargetMinutesByDate[dateKey]?.[task.subjectId] ?? 0;
      const focusedSubjectAssignedMinutes =
        subjectMinutesByDate[dateKey]?.[task.subjectId] ?? 0;

      if (focusedSubjectTargetMinutes > focusedSubjectAssignedMinutes + 14) {
        return false;
      }
    }

    const requiredMinutes = requiredMinutesBySubject[task.subjectId] ?? 0;
    const assignedMinutes = assignedMinutesBySubject[task.subjectId] ?? 0;
    const rawFutureFocusedReserveMinutes =
      options.futureFocusedReserveMinutesBySubject?.[task.subjectId] ?? 0;
    // Ensure the current week always retains at least 1 hour of allocatable
    // capacity for subjects with required hours, even when future focused days
    // have reserved minutes. Without this guard, a large future reserve can
    // zero-out the current week and leave the subject unplanned.
    const futureFocusedReserveMinutes = Math.min(
      rawFutureFocusedReserveMinutes,
      Math.max(0, requiredMinutes - MIN_ALLOCATABLE_MINUTES * 2),
    );
    const allocatableMinutesBeforeFutureFocus = Math.max(
      requiredMinutes - futureFocusedReserveMinutes,
      0,
    );

    if (task.kind === "review") {
      return assignedMinutes >= allocatableMinutesBeforeFutureFocus + 45;
    }

    return (
      requiredMinutes > 0 &&
      assignedMinutes >= allocatableMinutesBeforeFutureFocus
    );
  }

  function allWeeklyTargetsSatisfied() {
    if (options.fillAvailableStudyDays) {
      return workingTasks.every((task) => task.remainingMinutes < MIN_ALLOCATABLE_MINUTES);
    }

    return Object.entries(requiredMinutesBySubject)
      .filter(([, requiredMinutes]) => requiredMinutes > 0)
      .every(
        ([subjectId, requiredMinutes]) =>
          (assignedMinutesBySubject[subjectId as keyof typeof assignedMinutesBySubject] ?? 0) >=
          requiredMinutes,
      );
  }

  function canInsertRecoveryBlock(slot: CalendarSlot, usedToday: number, dailyBudget: number) {
    if (!breaksEnabled) {
      return false;
    }

    if (slot.durationMinutes < MIN_ALLOCATABLE_MINUTES) {
      return false;
    }

    if (scheduledBlocks.some((block) => block.date === slot.dateKey && block.blockType === "recovery")) {
      return false;
    }

    return usedToday <= dailyBudget - 30;
  }

  function getLastScheduledExamBlock(dateKey: string) {
    return [...options.lockedBlocks, ...scheduledBlocks]
      .filter((block) => block.date === dateKey)
      .filter((block) => block.topicId && examTopicIds.has(block.topicId))
      .sort((left, right) => new Date(right.end).getTime() - new Date(left.end).getTime())[0];
  }

  function isTaskDependencySatisfied(task: TaskCandidate, slotStart: Date) {
    if (!task.topicId) {
      return true;
    }

    const topic = topicMap.get(task.topicId);

    const stageGateStatus = getOlympiadStageGateStatus({
      topic,
      topics: options.topics,
      blocks: [
        ...(options.priorPlannedBlocks ?? []),
        ...options.lockedBlocks,
        ...scheduledBlocks,
      ],
      cutoff: slotStart,
    });

    if (stageGateStatus.blocked) {
      return false;
    }

    const ntFrontierStatus = getOlympiadNumberTheoryEligibilityStatus({
      topic,
      topics: options.topics,
      blocks: [
        ...(options.priorPlannedBlocks ?? []),
        ...options.lockedBlocks,
        ...scheduledBlocks,
      ],
      cutoff: slotStart,
    });

    if (ntFrontierStatus.blocked) {
      return false;
    }

    if (ntFrontierStatus.availableAt && slotStart.getTime() < ntFrontierStatus.availableAt.getTime()) {
      return false;
    }

    if (!topic?.dependsOnTopicId) {
      return true;
    }

    const dependencyBlocks = [
      ...(options.priorPlannedBlocks ?? []),
      ...options.lockedBlocks,
      ...scheduledBlocks,
    ]
      .filter((block) => block.topicId === topic.dependsOnTopicId)
      .filter((block) => block.status !== "missed");
    const eligibleDependencyBlocks = dependencyBlocks.filter(
      (block) => new Date(block.end).getTime() <= slotStart.getTime(),
    );
    const dependencyBlock = eligibleDependencyBlocks
      .sort((left, right) => new Date(right.end).getTime() - new Date(left.end).getTime())[0];

    const dependencyTopic = topicMap.get(topic.dependsOnTopicId);
    const requiresDependencyCompletion =
      topic.minDaysAfterDependency == null && topic.maxDaysAfterDependency == null;
    const dependencyCompleteFromProgress =
      requiresDependencyCompletion &&
      !!dependencyTopic &&
      dependencyTopic.completedHours >= dependencyTopic.estHours - 0.001;

    if (!dependencyBlock) {
      return dependencyCompleteFromProgress;
    }

    const coveredDependencyMinutes =
      Math.round((dependencyTopic?.completedHours ?? 0) * 60) +
      eligibleDependencyBlocks.reduce((total, block) => total + block.estimatedMinutes, 0);

    if (
      requiresDependencyCompletion &&
      dependencyTopic &&
      coveredDependencyMinutes < Math.round(dependencyTopic.estHours * 60)
    ) {
      return false;
    }

    const dependencyEnd = new Date(dependencyBlock.end);
    const earliestAllowed = addDays(dependencyEnd, topic.minDaysAfterDependency ?? 0);

    if (slotStart < earliestAllowed) {
      return false;
    }

    return true;
  }

  function isFrenchGrammarTuneUpTask(task: TaskCandidate) {
    return !!task.topicId && isFrenchGrammarTuneUpTopic(topicMap.get(task.topicId));
  }

  function getScheduledFrenchGrammarTuneUpSessionCount() {
    return [...options.lockedBlocks, ...scheduledBlocks].filter(
      (block) =>
        !!block.topicId &&
        isSchedulableStudyBlockStatus(block.status) &&
        isFrenchGrammarTuneUpTopic(topicMap.get(block.topicId)),
    ).length;
  }

  options.lockedBlocks.forEach((block) => {
    const dateKey = block.date;
    const weekKey = getWeekKeyForDate(dateKey);
    dailyMinutes[dateKey] = (dailyMinutes[dateKey] ?? 0) + block.estimatedMinutes;
    if (block.intensity === "heavy") {
      heavyBlocksPerDay[dateKey] = (heavyBlocksPerDay[dateKey] ?? 0) + 1;
    }

    if (block.subjectId) {
      assignedMinutesBySubject[block.subjectId] += block.estimatedMinutes;
      subjectMinutesByDate[dateKey] = {
        ...(subjectMinutesByDate[dateKey] ?? {}),
        [block.subjectId]:
          (subjectMinutesByDate[dateKey]?.[block.subjectId] ?? 0) + block.estimatedMinutes,
      };
      subjectMinutesByWeekStart[weekKey] = {
        ...(subjectMinutesByWeekStart[weekKey] ?? {}),
        [block.subjectId]:
          (subjectMinutesByWeekStart[weekKey]?.[block.subjectId] ?? 0) + block.estimatedMinutes,
      };
    }
  });

  const totalFreeSlotMinutes = Math.round(sum(options.freeSlots.map((slot) => slot.durationMinutes)));
  const bufferedCapacityMinutes = Math.round(
    totalFreeSlotMinutes * (1 - options.preferences.weeklyBufferRatio),
  );
  const requiredMinutes = sum(Object.values(requiredMinutesBySubject));
  const needsIntensityRamp = requiredMinutes > bufferedCapacityMinutes;
  const dayCapacityByDate = buildDayCapacityByDate(options.freeSlots);
  const lastSlotEndByDate = buildLastSlotEndByDate(options.freeSlots);
  const effectiveCapacityMinutes = clamp(
    options.fillAvailableStudyDays
      ? totalFreeSlotMinutes
      : needsIntensityRamp
        ? Math.min(totalFreeSlotMinutes, requiredMinutes)
        : bufferedCapacityMinutes,
    0,
    totalFreeSlotMinutes,
  );
  const maxHeavySessionsPerDay =
    options.preferences.maxHeavySessionsPerDay +
    (needsIntensityRamp ? 1 : 0) +
    (options.heavySessionBoost ?? 0);
  const breaksEnabled = options.preferences.breaksEnabled ?? false;
  const minBreakMinutes = breaksEnabled
    ? (options.minBreakMinutes ?? options.preferences.minBreakMinutes)
    : 0;
  const focusedSubjectsByDate = options.focusedSubjectsByDate ?? {};
  const schoolTermTemplate = options.schoolTermTemplate;
  const dailyTargetMinutes = buildDailyTargetMinutes({
    dayCapacityByDate,
    effectiveCapacityMinutes,
    preferences: options.preferences,
    fillAvailableStudyDays: options.fillAvailableStudyDays ?? false,
    focusedSubjectsByDate,
  });
  const focusedTargetMinutesByDate = buildFocusedTargetMinutesByDate({
    focusedSubjectsByDate,
    dayCapacityByDate,
  });
  const focusedSubjectTargetMinutesByDate = buildFocusedSubjectTargetMinutesByDate({
    focusedSubjectsByDate,
    focusedTargetMinutesByDate,
    requiredMinutesBySubject,
  });
  let consumedStudyMinutes = 0;
  let workingTasks = cloneTasks(options.tasks);
  const scheduledBlocks: StudyBlock[] = [];
  let usedSundayMinutes = 0;

  function blockMatchesTemplateRequirement(
    block: Pick<StudyBlock, "date" | "subjectId" | "topicId" | "estimatedMinutes" | "studyLayer">,
    requirement: NonNullable<ReturnType<typeof buildSchoolTermWeekTemplate>>["requirements"][number],
  ) {
    if (!requirement.allowedDateKeys.includes(block.date)) {
      return false;
    }

    if (block.subjectId !== requirement.subjectId) {
      return false;
    }

    if (requirement.exactTopicId && block.topicId !== requirement.exactTopicId) {
      return false;
    }

    return !!block.studyLayer && requirement.studyLayers.includes(block.studyLayer);
  }

  function getTemplateAssignedMinutes(
    requirement: NonNullable<ReturnType<typeof buildSchoolTermWeekTemplate>>["requirements"][number],
  ) {
    return [...options.lockedBlocks, ...scheduledBlocks].reduce((total, block) => {
      if (!blockMatchesTemplateRequirement(block, requirement)) {
        return total;
      }

      return total + block.estimatedMinutes;
    }, 0);
  }

  function getUnmetTemplateRequirements(dateKey: string) {
    if (!schoolTermTemplate?.active) {
      return [];
    }

    return schoolTermTemplate.requirements.filter(
      (requirement) =>
        requirement.allowedDateKeys.includes(dateKey) &&
        getTemplateAssignedMinutes(requirement) + 14 < requirement.minimumMinutes,
    );
  }

  function syncWorkingTasks(restrictedSubjectIds?: string[]) {
    const topics = restrictedSubjectIds?.length
      ? options.topics.filter((topic) => restrictedSubjectIds.includes(topic.subjectId))
      : options.topics;
    const refreshedTasks = buildTaskCandidates({
      topics,
      existingPlannedBlocks: [
        ...(options.priorPlannedBlocks ?? []),
        ...options.lockedBlocks,
        ...scheduledBlocks,
      ],
      completionLogs: options.completionLogs,
      referenceDate: options.referenceDate,
      coverageReferenceDate: options.coverageReferenceDate ?? options.referenceDate,
      subjectDeadlinesById,
      availabilityOverrideSubjectIds: options.availabilityOverrideSubjectIds,
    });

    if (!restrictedSubjectIds?.length) {
      workingTasks = refreshedTasks;
      return;
    }

    workingTasks = [
      ...workingTasks.filter(
        (task) => !task.subjectId || !restrictedSubjectIds.includes(task.subjectId),
      ),
      ...refreshedTasks,
    ];
  }

  function applyScheduledTaskCoverage(task: TaskCandidate, durationMinutes: number) {
    if (!task.topicId) {
      task.remainingMinutes = Math.max(0, task.remainingMinutes - durationMinutes);
      return task.remainingMinutes < MIN_ALLOCATABLE_MINUTES;
    }

    let topicStillOpen = false;

    workingTasks.forEach((candidate) => {
      if (candidate.topicId !== task.topicId) {
        return;
      }

      candidate.remainingMinutes = Math.max(0, candidate.remainingMinutes - durationMinutes);
      if (candidate.remainingMinutes >= MIN_ALLOCATABLE_MINUTES) {
        topicStillOpen = true;
      }
    });

    return !topicStillOpen;
  }

  function getFocusedAssignedMinutes(dateKey: string) {
    const focusedSubjectIds = focusedSubjectsByDate[dateKey] ?? [];
    return focusedSubjectIds.reduce(
      (total, subjectId) => total + (subjectMinutesByDate[dateKey]?.[subjectId] ?? 0),
      0,
    );
  }

  function getFocusedSubjectAssignedMinutes(dateKey: string, subjectId: string) {
    return subjectMinutesByDate[dateKey]?.[subjectId] ?? 0;
  }

  function getDailyFillHierarchyAdjustment(task: TaskCandidate, dateKey: string) {
    if (!task.subjectId) {
      return 0;
    }

    const fillOrder = buildDailyFillSubjectOrder({
      dateKey,
      requiredMinutesBySubject,
    });
    const rank = fillOrder.indexOf(task.subjectId);
    const requiredMinutes = requiredMinutesBySubject[task.subjectId] ?? 0;
    const assignedMinutesForSubject = assignedMinutesBySubject[task.subjectId] ?? 0;
    const dailyAssignedMinutes = subjectMinutesByDate[dateKey]?.[task.subjectId] ?? 0;
    const backlogHours = clamp((requiredMinutes - assignedMinutesForSubject) / 60, 0, 6);
    const day = new Date(`${dateKey}T12:00:00`);

    let adjustment =
      rank >= 0
        ? Math.max(0, 18 - rank * 3.5)
        : -8;

    adjustment += backlogHours * 1.5;

    if (softMaintenanceSubjectIds.includes(task.subjectId as (typeof softMaintenanceSubjectIds)[number])) {
      adjustment -= 4;
    }

    if (
      !softMaintenanceSubjectIds.includes(
        task.subjectId as (typeof softMaintenanceSubjectIds)[number],
      ) &&
      dailyAssignedMinutes < 60
    ) {
      adjustment += 3;
    }

    if (day.getDay() === 0) {
      if (task.studyLayer === "correction") {
        adjustment += 8;
      } else if (task.studyLayer === "application") {
        adjustment += 5;
      } else if (task.studyLayer === "exam_sim") {
        adjustment += 3;
      } else if (task.studyLayer === "learning") {
        adjustment -= 4;
      }
    }

    return adjustment;
  }

  function getContinuationAdjustment(subjectId: Subject["id"], slotStart: Date, dateKey: string) {
    const previousSubjectBlock = [...options.lockedBlocks, ...scheduledBlocks]
      .filter((block) => block.date === dateKey && block.subjectId)
      .filter((block) => new Date(block.end).getTime() <= slotStart.getTime())
      .sort((left, right) => new Date(right.end).getTime() - new Date(left.end).getTime())[0];

    if (!previousSubjectBlock?.subjectId) {
      return 0;
    }

    const gapMinutes =
      (slotStart.getTime() - new Date(previousSubjectBlock.end).getTime()) / (60 * 1000);

    if (gapMinutes > Math.max(minBreakMinutes, 20)) {
      return 0;
    }

    return previousSubjectBlock.subjectId === subjectId ? CONTINUITY_BONUS : 0;
  }

  function isFocusedSubjectUnderTarget(dateKey: string, subjectId: string) {
    const subjectTargetMinutes = focusedSubjectTargetMinutesByDate[dateKey]?.[subjectId] ?? 0;
    return subjectTargetMinutes > getFocusedSubjectAssignedMinutes(dateKey, subjectId) + 14;
  }

  function getUnmetFocusedSubjectIds(dateKey: string) {
    const focusedSubjectIds = focusedSubjectsByDate[dateKey] ?? [];
    if (!focusedSubjectIds.length) {
      return [];
    }

    return focusedSubjectIds.filter((subjectId) => {
      if (!isFocusedSubjectUnderTarget(dateKey, subjectId)) {
        return false;
      }

      return workingTasks.some(
        (task) =>
          task.subjectId === subjectId &&
        task.remainingMinutes >= MIN_ALLOCATABLE_MINUTES,
      );
    });
  }

  function getRemainingFocusedTargetMinutes(dateKey: string) {
    return Math.max(
      0,
      (focusedTargetMinutesByDate[dateKey] ?? 0) - getFocusedAssignedMinutes(dateKey),
    );
  }

  function shouldForceFocusedOnlyForSlot(
    dateKey: string,
    focusOptions: Array<{
      blockOption: NonNullable<ReturnType<typeof selectBlockOption>>;
    }>,
  ) {
    if (!focusOptions.length) {
      return false;
    }

    const remainingFocusedTargetMinutes = getRemainingFocusedTargetMinutes(dateKey);
    if (remainingFocusedTargetMinutes < MIN_ALLOCATABLE_MINUTES) {
      return false;
    }

    const shortestFocusedOptionMinutes = Math.min(
      ...focusOptions.map((option) => option.blockOption.durationMinutes),
    );

    return (
      remainingFocusedTargetMinutes + FOCUS_STRICT_TOLERANCE_MINUTES >=
      shortestFocusedOptionMinutes
    );
  }

  function getOverflowPracticeSubjectId(dateKey: string, slotStart: Date) {
    const underMinimumIbSubjectId = getUnderMinimumIbOverflowSubjectId(dateKey, slotStart);

    if (underMinimumIbSubjectId) {
      return underMinimumIbSubjectId;
    }

    const dailyFillOrder = buildDailyFillSubjectOrder({
      dateKey,
      requiredMinutesBySubject,
    });
    const fillOrder = [
      "olympiad",
      ...dailyFillOrder.filter((subjectId) => subjectId !== "olympiad"),
    ] satisfies Subject["id"][];

    return [...fillOrder]
      .filter((subjectId) => canUseOverflowPracticeSubject(subjectId, dateKey, slotStart))
      .sort((left, right) => {
        const leftMinutes = subjectMinutesByDate[dateKey]?.[left] ?? 0;
        const rightMinutes = subjectMinutesByDate[dateKey]?.[right] ?? 0;

        if (leftMinutes !== rightMinutes) {
          return leftMinutes - rightMinutes;
        }

        const leftBacklog = requiredMinutesBySubject[left] ?? 0;
        const rightBacklog = requiredMinutesBySubject[right] ?? 0;

        if (leftBacklog !== rightBacklog) {
          return rightBacklog - leftBacklog;
        }

        const leftRank = fillOrder.indexOf(left);
        const rightRank = fillOrder.indexOf(right);

        if (leftRank !== rightRank) {
          return leftRank - rightRank;
        }

        return (
          (assignedMinutesBySubject[left] ?? 0) -
          (assignedMinutesBySubject[right] ?? 0)
        );
      })[0] ?? null;
  }

  function getFocusedOverflowPracticeSubjectId(dateKey: string): Subject["id"] | null {
    const focusedSubjectIds = focusedSubjectsByDate[dateKey] ?? [];

    if (!focusedSubjectIds.length) {
      return null;
    }

    const sortedSubjectIds = [...focusedSubjectIds] as Subject["id"][];

    return sortedSubjectIds.sort((left, right) => {
      const leftUnderTarget =
        (focusedSubjectTargetMinutesByDate[dateKey]?.[left] ?? 0) -
        getFocusedSubjectAssignedMinutes(dateKey, left);
      const rightUnderTarget =
        (focusedSubjectTargetMinutesByDate[dateKey]?.[right] ?? 0) -
        getFocusedSubjectAssignedMinutes(dateKey, right);

      if (leftUnderTarget !== rightUnderTarget) {
        return rightUnderTarget - leftUnderTarget;
      }

      const leftMinutes = subjectMinutesByDate[dateKey]?.[left] ?? 0;
      const rightMinutes = subjectMinutesByDate[dateKey]?.[right] ?? 0;

      if (leftMinutes !== rightMinutes) {
        return leftMinutes - rightMinutes;
      }

      return left.localeCompare(right);
    })[0] ?? null;
  }

  function getReinforcementSessionCountForSubject(subjectId: Subject["id"]) {
    return [...options.lockedBlocks, ...scheduledBlocks].filter(
      (block) => block.subjectId === subjectId && isOverflowReinforcementBlock(block),
    ).length;
  }

  function getUnderMinimumIbOverflowSubjectId(dateKey: string, slotStart: Date) {
    return ([...IB_REINFORCEMENT_MIN_SUBJECT_IDS] as Subject["id"][])
      .filter((subjectId) => {
        if (!IB_REINFORCEMENT_MIN_SUBJECT_ID_SET.has(subjectId)) {
          return false;
        }

        if (getReinforcementSessionCountForSubject(subjectId) >= IB_REINFORCEMENT_MIN_SESSIONS_PER_WEEK) {
          return false;
        }

        return canUseOverflowPracticeSubject(subjectId, dateKey, slotStart);
      })
      .sort((left, right) => {
        const leftCount = getReinforcementSessionCountForSubject(left);
        const rightCount = getReinforcementSessionCountForSubject(right);

        if (leftCount !== rightCount) {
          return leftCount - rightCount;
        }

        const leftMinutes = subjectMinutesByDate[dateKey]?.[left] ?? 0;
        const rightMinutes = subjectMinutesByDate[dateKey]?.[right] ?? 0;

        if (leftMinutes !== rightMinutes) {
          return leftMinutes - rightMinutes;
        }

        return DAILY_FILL_SUBJECT_ORDER.indexOf(left) - DAILY_FILL_SUBJECT_ORDER.indexOf(right);
      })[0] ?? null;
  }

  function extendScheduledStudyBlock(block: StudyBlock, extraMinutes: number) {
    if (!block.subjectId || extraMinutes <= 0) {
      return;
    }

    block.end = addMinutes(new Date(block.end), extraMinutes).toISOString();
    block.estimatedMinutes += extraMinutes;
    dailyMinutes[block.date] = (dailyMinutes[block.date] ?? 0) + extraMinutes;
    assignedMinutesBySubject[block.subjectId] += extraMinutes;
    subjectMinutesByDate[block.date] = {
      ...(subjectMinutesByDate[block.date] ?? {}),
      [block.subjectId]:
        (subjectMinutesByDate[block.date]?.[block.subjectId] ?? 0) + extraMinutes,
    };
    const weekKey = getWeekKeyForDate(block.date);
    subjectMinutesByWeekStart[weekKey] = {
      ...(subjectMinutesByWeekStart[weekKey] ?? {}),
      [block.subjectId]:
        (subjectMinutesByWeekStart[weekKey]?.[block.subjectId] ?? 0) + extraMinutes,
    };
    consumedStudyMinutes += extraMinutes;

    if (new Date(block.start).getDay() === 0) {
      usedSundayMinutes += extraMinutes;
    }
  }

  function extendScheduledStudyBlockBackward(block: StudyBlock, extraMinutes: number) {
    if (!block.subjectId || extraMinutes <= 0) {
      return;
    }

    block.start = addMinutes(new Date(block.start), -extraMinutes).toISOString();
    block.estimatedMinutes += extraMinutes;
    dailyMinutes[block.date] = (dailyMinutes[block.date] ?? 0) + extraMinutes;
    assignedMinutesBySubject[block.subjectId] += extraMinutes;
    subjectMinutesByDate[block.date] = {
      ...(subjectMinutesByDate[block.date] ?? {}),
      [block.subjectId]:
        (subjectMinutesByDate[block.date]?.[block.subjectId] ?? 0) + extraMinutes,
    };
    const weekKey = getWeekKeyForDate(block.date);
    subjectMinutesByWeekStart[weekKey] = {
      ...(subjectMinutesByWeekStart[weekKey] ?? {}),
      [block.subjectId]:
        (subjectMinutesByWeekStart[weekKey]?.[block.subjectId] ?? 0) + extraMinutes,
    };
    consumedStudyMinutes += extraMinutes;

    if (new Date(block.start).getDay() === 0) {
      usedSundayMinutes += extraMinutes;
    }
  }

  function isExtendableFlexibleStudyBlock(block: StudyBlock | undefined) {
    if (!block?.subjectId) {
      return false;
    }

    if (block.assignmentLocked || block.creationSource === "manual") {
      return false;
    }

    if (block.topicId && examTopicIds.has(block.topicId)) {
      return false;
    }

    return true;
  }

  function getGapAbsorptionPriority(block: StudyBlock | undefined) {
    if (!block?.subjectId) {
      return -1;
    }

    return HARD_SCOPE_PRIORITY_BY_SUBJECT[block.subjectId] ?? 0;
  }

  function absorbMicroGapIntoAdjacentFlexibleBlock(
    dateKey: string,
    gapStart: Date,
    gapEnd: Date,
  ) {
    const gapMinutes = Math.round((gapEnd.getTime() - gapStart.getTime()) / 60000);

    if (gapMinutes <= 0 || gapMinutes >= MIN_ALLOCATABLE_MINUTES) {
      return false;
    }

    if (options.dayStudyCapOverrideMinutesByDate?.[dateKey] != null) {
      return false;
    }

    const sameDayBlocks = [...options.lockedBlocks, ...scheduledBlocks]
      .filter((block) => block.date === dateKey)
      .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
    const previousBlock = [...sameDayBlocks]
      .reverse()
      .find((block) => new Date(block.end).getTime() === gapStart.getTime());
    const nextBlock = sameDayBlocks.find(
      (block) => new Date(block.start).getTime() === gapEnd.getTime(),
    );
    const previousEligible = isExtendableFlexibleStudyBlock(previousBlock);
    const nextEligible = isExtendableFlexibleStudyBlock(nextBlock);

    if (!previousEligible && !nextEligible) {
      return false;
    }

    if (previousEligible && !nextEligible) {
      extendScheduledStudyBlock(previousBlock!, gapMinutes);
      return true;
    }

    if (!previousEligible && nextEligible) {
      extendScheduledStudyBlockBackward(nextBlock!, gapMinutes);
      return true;
    }

    const previousPriority = getGapAbsorptionPriority(previousBlock);
    const nextPriority = getGapAbsorptionPriority(nextBlock);

    if (previousPriority >= nextPriority) {
      extendScheduledStudyBlock(previousBlock!, gapMinutes);
      return true;
    }

    extendScheduledStudyBlockBackward(nextBlock!, gapMinutes);
    return true;
  }

  function absorbTrailingGapIntoPreviousBlock(
    dateKey: string,
    extensionStart: Date,
    remainingMinutes: number,
  ) {
    if (remainingMinutes <= 0 || remainingMinutes >= MIN_ALLOCATABLE_MINUTES) {
      return false;
    }

    if (options.dayStudyCapOverrideMinutesByDate?.[dateKey] != null) {
      return false;
    }

    const previousBlock = scheduledBlocks[scheduledBlocks.length - 1];
    if (!previousBlock || previousBlock.date !== dateKey || !isExtendableFlexibleStudyBlock(previousBlock)) {
      return false;
    }

    if (new Date(previousBlock.end).getTime() !== extensionStart.getTime()) {
      return false;
    }

    if (topicMap.get(previousBlock.topicId ?? "")?.sessionMode === "exam") {
      return false;
    }

    extendScheduledStudyBlock(previousBlock, remainingMinutes);

    return true;
  }

  function compactDailyMicroGaps() {
    const absorbedDateKeys = new Set<string>();

    for (let pass = 0; pass < 4; pass += 1) {
      const microGaps = calculateFreeSlots({
        weekStart: options.weekStart,
        fixedEvents: options.fixedEvents,
        sickDays: options.sickDays ?? [],
        preferences: options.preferences,
        blockedStudyBlocks: [...options.lockedBlocks, ...scheduledBlocks],
        planningStart: options.referenceDate,
        skipMovableRecovery: false,
        minimumDurationMinutes: 1,
        schedulingContext: options.schedulingContext,
      }).filter(
        (slot) =>
          slot.durationMinutes > 0 &&
          slot.durationMinutes < MIN_ALLOCATABLE_MINUTES,
      );

      let absorbedOnPass = false;

      microGaps.forEach((slot) => {
        if (absorbMicroGapIntoAdjacentFlexibleBlock(slot.dateKey, slot.start, slot.end)) {
          absorbedOnPass = true;
          absorbedDateKeys.add(slot.dateKey);
        }
      });

      if (!absorbedOnPass) {
        break;
      }
    }

    return Array.from(absorbedDateKeys).sort((left, right) => left.localeCompare(right));
  }

  function shouldHoldCapacityForLaterDays(dateKey: string) {
    if (options.fillAvailableStudyDays) {
      return false;
    }

    const targetForToday = dailyTargetMinutes[dateKey] ?? 0;
    const usedToday = dailyMinutes[dateKey] ?? 0;

    if (targetForToday <= 0 || usedToday < targetForToday) {
      return false;
    }

    return Object.entries(dailyTargetMinutes).some(
      ([candidateDateKey, candidateTarget]) =>
        candidateDateKey > dateKey &&
        (dailyMinutes[candidateDateKey] ?? 0) + 15 <= candidateTarget,
    );
  }

  function isWeekendPaperCycleTask(task: TaskCandidate, slotDateKey: string) {
    if (!schoolTermTemplate?.active || !task.topicId || !task.subjectId) {
      return false;
    }

    if (!IB_ANCHOR_SUBJECT_IDS.includes(task.subjectId as (typeof IB_ANCHOR_SUBJECT_IDS)[number])) {
      return false;
    }

    const topic = topicMap.get(task.topicId);
    if (!topic?.unitId.includes("past-papers-week-")) {
      return false;
    }

    const slotDay = new Date(`${slotDateKey}T12:00:00`).getDay();
    const isWeekendDate = slotDay === 0 || slotDay === 6;

    return !isWeekendDate && (task.studyLayer === "exam_sim" || task.studyLayer === "correction");
  }

  function buildScoredOptionsForSlot(config: {
    slot: CalendarSlot;
    allowWeeklyTargetOverride?: boolean;
    restrictedSubjectIds?: string[];
    restrictedTopicIds?: string[];
    requiredStudyLayers?: StudyLayer[];
    disallowedStudyLayers?: StudyLayer[];
    mustFillEndOfDaySlot?: boolean;
    strongFocusDemand?: boolean;
  }) {
    const {
      slot,
      allowWeeklyTargetOverride = false,
      restrictedSubjectIds,
      restrictedTopicIds,
      requiredStudyLayers,
      disallowedStudyLayers,
      mustFillEndOfDaySlot = false,
      strongFocusDemand = false,
    } = config;
    const allowedBlockTypes = getAllowedBlockTypesForSlot(slot);
    return workingTasks
      .filter((task) => task.remainingMinutes >= MIN_ALLOCATABLE_MINUTES)
      .filter((task) => !restrictedSubjectIds || (!!task.subjectId && restrictedSubjectIds.includes(task.subjectId)))
      .filter((task) => !restrictedTopicIds || (!!task.topicId && restrictedTopicIds.includes(task.topicId)))
      .filter((task) => !requiredStudyLayers || (!!task.studyLayer && requiredStudyLayers.includes(task.studyLayer)))
      .filter((task) => !disallowedStudyLayers || !task.studyLayer || !disallowedStudyLayers.includes(task.studyLayer))
      .filter((task) => !isWeekendPaperCycleTask(task, slot.dateKey))
      .filter((task) => !task.availableAt || new Date(task.availableAt) <= slot.start)
      .filter((task) => !isFrenchGrammarTuneUpTask(task) || getScheduledFrenchGrammarTuneUpSessionCount() < 2)
      .filter((task) => isTaskDependencySatisfied(task, slot.start))
      .filter((task) => allowWeeklyTargetOverride || !hasReachedWeeklyTarget(task, slot.dateKey))
      .map((task) => {
        const blockOption = selectBlockOption(
          task,
          slot,
          options.preferences,
          allowWeeklyTargetOverride || mustFillEndOfDaySlot
            ? {
                ...options.blockSelectionPolicy,
                preferLongerBlocks: true,
                allowLowEnergyHeavy: true,
                allowLateNightDeepWork: true,
              }
            : options.blockSelectionPolicy,
        );

        if (!blockOption) {
          return null;
        }

        if (allowedBlockTypes && !allowedBlockTypes.has(blockOption.blockType)) {
          return null;
        }

        if (task.sessionMode === "exam") {
          const lastExamBlock = getLastScheduledExamBlock(slot.dateKey);
          if (
            lastExamBlock &&
            new Date(lastExamBlock.end).getTime() > slot.start.getTime() - 30 * 60 * 1000
          ) {
            return null;
          }
        }

        if (
          blockOption.intensity === "heavy" &&
          !options.fillAvailableStudyDays &&
          !(
            allowWeeklyTargetOverride &&
            task.subjectId &&
            isFocusedSubjectUnderTarget(slot.dateKey, task.subjectId)
          ) &&
          (heavyBlocksPerDay[slot.dateKey] ?? 0) >= Math.min(maxHeavySessionsPerDay, slot.maxHeavySessionsPerDay)
        ) {
          return null;
        }

        const scoreBreakdown = scoreTaskCandidate(task, slot, blockOption, {
          subjectMap,
          preferences: options.preferences,
          requiredMinutesBySubject,
          assignedMinutesBySubject,
          focusedSubjectIdsByDate: focusedSubjectsByDate,
          focusedTargetMinutesByDate,
          focusedSubjectTargetMinutesByDate,
          subjectMinutesByDate,
          hasFocusDemandByDate: {
            [slot.dateKey]: strongFocusDemand,
          },
          olympiadLoadMultiplier: options.olympiadLoadMultiplier,
          olympiadWeaknessStrand: options.olympiadWeaknessStrand,
          referenceDate: options.referenceDate,
        });
        const dailyFillHierarchyAdjustment = getDailyFillHierarchyAdjustment(
          task,
          slot.dateKey,
        );
        const continuityAdjustment = task.subjectId
          ? getContinuationAdjustment(task.subjectId, slot.start, slot.dateKey)
          : 0;
        const adjustedScoreBreakdown = {
          ...scoreBreakdown,
          total: Math.round((scoreBreakdown.total + dailyFillHierarchyAdjustment + continuityAdjustment) * 10) / 10,
        };

        return {
          task,
          blockOption,
          scoreBreakdown: adjustedScoreBreakdown,
        };
      })
      .filter(Boolean)
      .sort(
        (left, right) =>
          (right?.scoreBreakdown.total ?? 0) - (left?.scoreBreakdown.total ?? 0),
      ) as Array<{
      task: TaskCandidate;
      blockOption: NonNullable<ReturnType<typeof selectBlockOption>>;
      scoreBreakdown: StudyBlock["scoreBreakdown"];
    }>;
  }

  options.freeSlots.forEach((slot) => {
    const mustFillEndOfDaySlot =
      slot.durationMinutes >= MIN_ALLOCATABLE_MINUTES &&
      lastSlotEndByDate[slot.dateKey] === slot.end.getTime() &&
      slot.end.getHours() === 22 &&
      slot.end.getMinutes() === 30 &&
      workingTasks.some((task) => task.remainingMinutes >= MIN_ALLOCATABLE_MINUTES);

    if (consumedStudyMinutes >= effectiveCapacityMinutes && !mustFillEndOfDaySlot) {
      return;
    }

    if (!mustFillEndOfDaySlot && shouldHoldCapacityForLaterDays(slot.dateKey)) {
      if (options.allowLargeGapAbsorption !== false) {
        absorbTrailingGapIntoPreviousBlock(slot.dateKey, slot.start, slot.durationMinutes);
      }
      return;
    }

    let cursor = slot.start;
    let remainingSlotMinutes = slot.durationMinutes;

    while (
      remainingSlotMinutes >= MIN_ALLOCATABLE_MINUTES &&
      (consumedStudyMinutes < effectiveCapacityMinutes || mustFillEndOfDaySlot)
    ) {
      const usedToday = dailyMinutes[slot.dateKey] ?? 0;
      const unmetTemplateRequirements = getUnmetTemplateRequirements(slot.dateKey);
      const activeTemplateRequirement = unmetTemplateRequirements[0] ?? null;
      const templateAllowsOverflowDayCap = activeTemplateRequirement?.allowOverflowDayCap ?? false;
      const hasHardDayCap = options.dayStudyCapOverrideMinutesByDate?.[slot.dateKey] != null;
      const dayStudyCapMinutes =
        options.dayStudyCapOverrideMinutesByDate?.[slot.dateKey] ?? slot.dayStudyCapMinutes;
      const dailyBudget = hasHardDayCap
        ? dayStudyCapMinutes
        : dayStudyCapMinutes + (options.dailyCapBoostMinutes ?? 0);
      const availableToday =
        templateAllowsOverflowDayCap
          ? remainingSlotMinutes
          : hasHardDayCap
            ? dailyBudget - usedToday
          : mustFillEndOfDaySlot || options.fillAvailableStudyDays
            ? remainingSlotMinutes
          : dailyBudget - usedToday;
      const templateRemainingMinutes = activeTemplateRequirement
        ? Math.max(
            MIN_ALLOCATABLE_MINUTES,
            activeTemplateRequirement.minimumMinutes -
              getTemplateAssignedMinutes(activeTemplateRequirement),
          )
        : null;

      if (availableToday < MIN_ALLOCATABLE_MINUTES) {
        if (
          options.allowLargeGapAbsorption !== false &&
          absorbTrailingGapIntoPreviousBlock(slot.dateKey, cursor, remainingSlotMinutes)
        ) {
          remainingSlotMinutes = 0;
        }
        break;
      }

      if (!mustFillEndOfDaySlot && shouldHoldCapacityForLaterDays(slot.dateKey)) {
        if (
          options.allowLargeGapAbsorption !== false &&
          absorbTrailingGapIntoPreviousBlock(slot.dateKey, cursor, remainingSlotMinutes)
        ) {
          remainingSlotMinutes = 0;
        }
        break;
      }

      const slotSlice: CalendarSlot = {
        ...slot,
        start: cursor,
        end: addMinutes(
          cursor,
          Math.min(
            remainingSlotMinutes,
            availableToday,
            templateRemainingMinutes ?? Number.POSITIVE_INFINITY,
          ),
        ),
        durationMinutes: Math.min(
          remainingSlotMinutes,
          availableToday,
          templateRemainingMinutes ?? Number.POSITIVE_INFINITY,
        ),
      };
      const lightReviewOnlyDay =
        schoolTermTemplate?.lightReviewOnlyDateKeys.includes(slot.dateKey) ?? false;
      let templateOnlyOptions = activeTemplateRequirement
        ? buildScoredOptionsForSlot({
            slot: slotSlice,
            allowWeeklyTargetOverride: true,
            restrictedSubjectIds: [activeTemplateRequirement.subjectId],
            restrictedTopicIds: activeTemplateRequirement.exactTopicId
              ? [activeTemplateRequirement.exactTopicId]
              : undefined,
            requiredStudyLayers: activeTemplateRequirement.studyLayers,
            mustFillEndOfDaySlot,
            strongFocusDemand: true,
          })
        : [];
      const unmetFocusedSubjectIds = getUnmetFocusedSubjectIds(slot.dateKey);
      let focusedOnlyOptions = unmetFocusedSubjectIds.length > 0
        ? buildScoredOptionsForSlot({
            slot: slotSlice,
            allowWeeklyTargetOverride: true,
            restrictedSubjectIds: unmetFocusedSubjectIds,
            mustFillEndOfDaySlot,
            strongFocusDemand: true,
          })
        : [];

      if (unmetFocusedSubjectIds.length > 0 && focusedOnlyOptions.length === 0) {
        syncWorkingTasks(unmetFocusedSubjectIds);
        focusedOnlyOptions = buildScoredOptionsForSlot({
          slot: slotSlice,
          allowWeeklyTargetOverride: true,
          restrictedSubjectIds: unmetFocusedSubjectIds,
          mustFillEndOfDaySlot,
          strongFocusDemand: true,
        });
      }

      if (templateOnlyOptions.length === 0 && activeTemplateRequirement?.exactTopicId) {
        syncWorkingTasks([activeTemplateRequirement.subjectId]);
        templateOnlyOptions = buildScoredOptionsForSlot({
          slot: slotSlice,
          allowWeeklyTargetOverride: true,
          restrictedSubjectIds: [activeTemplateRequirement.subjectId],
          restrictedTopicIds: [activeTemplateRequirement.exactTopicId],
          requiredStudyLayers: activeTemplateRequirement.studyLayers,
          mustFillEndOfDaySlot,
          strongFocusDemand: true,
        });
      }

      const focusedDemandStillOpen =
        unmetFocusedSubjectIds.length > 0 &&
        shouldForceFocusedOnlyForSlot(slot.dateKey, focusedOnlyOptions);

      if (!focusedDemandStillOpen) {
        focusedOnlyOptions = [];
      }

      const focusedOverflowSubjectId =
        focusedOnlyOptions.length === 0 && focusedDemandStillOpen
          ? getFocusedOverflowPracticeSubjectId(slot.dateKey)
          : null;

      if (
        focusedOverflowSubjectId &&
        options.fillAvailableStudyDays &&
        canUseOverflowPracticeSubject(focusedOverflowSubjectId, slot.dateKey, cursor) &&
        !lightReviewOnlyDay &&
        remainingSlotMinutes >= MIN_ALLOCATABLE_MINUTES &&
        (options.isFinalPass ?? true)
      ) {
        const overflowDuration = Math.min(
          remainingSlotMinutes,
          slotSlice.energy === "low" ? 60 : 90,
        );
        const overflowBlock = buildOverflowPracticeBlock({
          slot: slotSlice,
          weekStart: weekStartKey,
          subjectId: focusedOverflowSubjectId,
          start: cursor,
          durationMinutes: overflowDuration,
        });
        scheduledBlocks.push(overflowBlock);
        dailyMinutes[slot.dateKey] = (dailyMinutes[slot.dateKey] ?? 0) + overflowDuration;
        assignedMinutesBySubject[focusedOverflowSubjectId] += overflowDuration;
        subjectMinutesByDate[slot.dateKey] = {
          ...(subjectMinutesByDate[slot.dateKey] ?? {}),
          [focusedOverflowSubjectId]:
            (subjectMinutesByDate[slot.dateKey]?.[focusedOverflowSubjectId] ?? 0) +
            overflowDuration,
        };
        const overflowWeekKey = getWeekKeyForDate(slot.dateKey);
        subjectMinutesByWeekStart[overflowWeekKey] = {
          ...(subjectMinutesByWeekStart[overflowWeekKey] ?? {}),
          [focusedOverflowSubjectId]:
            (subjectMinutesByWeekStart[overflowWeekKey]?.[focusedOverflowSubjectId] ?? 0) +
            overflowDuration,
        };
        consumedStudyMinutes += overflowDuration;
        cursor = addMinutes(cursor, overflowDuration);
        remainingSlotMinutes = Math.max(0, remainingSlotMinutes - overflowDuration);
        continue;
      }

      const scoredOptions =
        templateOnlyOptions.length > 0
          ? templateOnlyOptions
          : focusedOnlyOptions.length > 0
          ? focusedOnlyOptions
          : buildScoredOptionsForSlot({
              slot: slotSlice,
              disallowedStudyLayers:
                schoolTermTemplate?.lightReviewOnlyDateKeys.includes(slot.dateKey) &&
                !activeTemplateRequirement
                  ? ["learning", "exam_sim"]
                  : undefined,
              mustFillEndOfDaySlot,
              strongFocusDemand: focusedDemandStillOpen,
            });
      const winner = scoredOptions[0];
      const allTargetsMet = allWeeklyTargetsSatisfied();
      const shouldProtectRecovery =
        mustFillEndOfDaySlot
          ? false
          : options.fillAvailableStudyDays
            ? false
          : options.protectRecovery ?? (!needsIntensityRamp || allTargetsMet);

      if (!winner) {
        if (
          options.fillAvailableStudyDays &&
          !lightReviewOnlyDay &&
          remainingSlotMinutes >= MIN_ALLOCATABLE_MINUTES &&
          (options.isFinalPass ?? true)
        ) {
          const overflowSubjectId = getOverflowPracticeSubjectId(slot.dateKey, cursor);
          if (!overflowSubjectId) {
            if (
              options.allowLargeGapAbsorption !== false &&
              absorbTrailingGapIntoPreviousBlock(slot.dateKey, cursor, remainingSlotMinutes)
            ) {
              remainingSlotMinutes = 0;
              break;
            }

            remainingSlotMinutes = 0;
            break;
          }
          const overflowDuration = Math.min(
            remainingSlotMinutes,
            slotSlice.energy === "low" ? 60 : 90,
          );
          const overflowBlock = buildOverflowPracticeBlock({
            slot: slotSlice,
            weekStart: weekStartKey,
            subjectId: overflowSubjectId,
            start: cursor,
            durationMinutes: overflowDuration,
          });
          scheduledBlocks.push(overflowBlock);
          dailyMinutes[slot.dateKey] =
            (dailyMinutes[slot.dateKey] ?? 0) + overflowDuration;
          assignedMinutesBySubject[overflowSubjectId] += overflowDuration;
          subjectMinutesByDate[slot.dateKey] = {
            ...(subjectMinutesByDate[slot.dateKey] ?? {}),
            [overflowSubjectId]:
              (subjectMinutesByDate[slot.dateKey]?.[overflowSubjectId] ?? 0) +
              overflowDuration,
          };
          const overflowWeekKey = getWeekKeyForDate(slot.dateKey);
          subjectMinutesByWeekStart[overflowWeekKey] = {
            ...(subjectMinutesByWeekStart[overflowWeekKey] ?? {}),
            [overflowSubjectId]:
              (subjectMinutesByWeekStart[overflowWeekKey]?.[overflowSubjectId] ?? 0) +
              overflowDuration,
          };
          consumedStudyMinutes += overflowDuration;
          cursor = addMinutes(cursor, overflowDuration);
          remainingSlotMinutes = Math.max(0, remainingSlotMinutes - overflowDuration);
          continue;
        }

        if (
          options.allowLargeGapAbsorption !== false &&
          absorbTrailingGapIntoPreviousBlock(slot.dateKey, cursor, remainingSlotMinutes)
        ) {
          remainingSlotMinutes = 0;
          break;
        }

        if (
          shouldProtectRecovery &&
          canInsertRecoveryBlock(slotSlice, usedToday, dailyBudget) &&
          (slotSlice.energy === "low" || allTargetsMet)
        ) {
          const recoveryDuration = clamp(
            Math.min(30, remainingSlotMinutes),
            MIN_ALLOCATABLE_MINUTES,
            30,
          );
          const recoverySlot = {
            ...slotSlice,
            end: addMinutes(cursor, recoveryDuration),
            durationMinutes: recoveryDuration,
          };
          const recoveryBlock = buildRecoveryBlock(recoverySlot, weekStartKey);
          scheduledBlocks.push(recoveryBlock);
          dailyMinutes[slot.dateKey] = (dailyMinutes[slot.dateKey] ?? 0) + recoveryDuration;
          const breakAfterRecovery = getInlineBreakMinutes(
            remainingSlotMinutes,
            recoveryDuration,
            minBreakMinutes,
          );
          cursor = addMinutes(cursor, recoveryDuration + breakAfterRecovery);
          remainingSlotMinutes = Math.max(
            0,
            remainingSlotMinutes - recoveryDuration - breakAfterRecovery,
          );
          continue;
        }

        break;
      }

      if (
        winner.scoreBreakdown.total < 8 &&
        !options.fillAvailableStudyDays &&
        shouldProtectRecovery &&
        (slotSlice.energy === "low" || allTargetsMet)
      ) {
        if (
          options.allowLargeGapAbsorption !== false &&
          absorbTrailingGapIntoPreviousBlock(slot.dateKey, cursor, remainingSlotMinutes)
        ) {
          remainingSlotMinutes = 0;
          break;
        }

        if (canInsertRecoveryBlock(slotSlice, usedToday, dailyBudget)) {
          const recoveryDuration = clamp(
            Math.min(30, remainingSlotMinutes),
            MIN_ALLOCATABLE_MINUTES,
            30,
          );
          const recoverySlot = {
            ...slotSlice,
            end: addMinutes(cursor, recoveryDuration),
            durationMinutes: recoveryDuration,
          };
          const recoveryBlock = buildRecoveryBlock(recoverySlot, weekStartKey);
          scheduledBlocks.push(recoveryBlock);
          dailyMinutes[slot.dateKey] = (dailyMinutes[slot.dateKey] ?? 0) + recoveryDuration;
          const breakAfterRecovery = getInlineBreakMinutes(
            remainingSlotMinutes,
            recoveryDuration,
            minBreakMinutes,
          );
          cursor = addMinutes(cursor, recoveryDuration + breakAfterRecovery);
          remainingSlotMinutes = Math.max(
            0,
            remainingSlotMinutes - recoveryDuration - breakAfterRecovery,
          );
          continue;
        }

        break;
      }

      const block = createStudyBlockFromTask({
        task: winner.task,
        weekStart: weekStartKey,
        slot: slotSlice,
        start: cursor,
        durationMinutes: winner.blockOption.durationMinutes,
        generatedReason: buildGeneratedReason(winner.task, slotSlice, winner.scoreBreakdown),
        scoreBreakdown: winner.scoreBreakdown,
        blockType: winner.blockOption.blockType,
        intensity: winner.blockOption.intensity,
      });

      scheduledBlocks.push(block);
      const topicCompletedByPlacement = applyScheduledTaskCoverage(
        winner.task,
        winner.blockOption.durationMinutes,
      );
      dailyMinutes[slot.dateKey] =
        (dailyMinutes[slot.dateKey] ?? 0) + winner.blockOption.durationMinutes;
      if (winner.blockOption.intensity === "heavy") {
        heavyBlocksPerDay[slot.dateKey] = (heavyBlocksPerDay[slot.dateKey] ?? 0) + 1;
      }
      if (winner.task.subjectId) {
        assignedMinutesBySubject[winner.task.subjectId] += winner.blockOption.durationMinutes;
        subjectMinutesByDate[slot.dateKey] = {
          ...(subjectMinutesByDate[slot.dateKey] ?? {}),
          [winner.task.subjectId]:
            (subjectMinutesByDate[slot.dateKey]?.[winner.task.subjectId] ?? 0) +
            winner.blockOption.durationMinutes,
        };
        const weekKey = getWeekKeyForDate(slot.dateKey);
        subjectMinutesByWeekStart[weekKey] = {
          ...(subjectMinutesByWeekStart[weekKey] ?? {}),
          [winner.task.subjectId]:
            (subjectMinutesByWeekStart[weekKey]?.[winner.task.subjectId] ?? 0) +
            winner.blockOption.durationMinutes,
        };
      }
      if (slot.dayIndex === 0) {
        usedSundayMinutes += winner.blockOption.durationMinutes;
      }
      consumedStudyMinutes += winner.blockOption.durationMinutes;
      const requiredBreakMinutes =
        breaksEnabled && winner.task.sessionMode === "exam"
          ? Math.max(minBreakMinutes, 30)
          : 0;
      const breakAfterBlock = getInlineBreakMinutes(
        remainingSlotMinutes,
        winner.blockOption.durationMinutes,
        requiredBreakMinutes,
      );
      const trailingTailMinutes =
        remainingSlotMinutes -
        winner.blockOption.durationMinutes -
        breakAfterBlock;

      if (
        winner.task.sessionMode !== "exam" &&
        breakAfterBlock === 0 &&
        trailingTailMinutes > 0 &&
        trailingTailMinutes < MIN_ALLOCATABLE_MINUTES
      ) {
        extendScheduledStudyBlock(block, trailingTailMinutes);
        applyScheduledTaskCoverage(winner.task, trailingTailMinutes);
        if (topicCompletedByPlacement && winner.task.subjectId) {
          syncWorkingTasks([winner.task.subjectId]);
        }
        cursor = addMinutes(
          cursor,
          winner.blockOption.durationMinutes + trailingTailMinutes,
        );
        remainingSlotMinutes = 0;
        continue;
      }

      cursor = addMinutes(
        cursor,
        winner.blockOption.durationMinutes + breakAfterBlock,
      );
      remainingSlotMinutes = Math.max(
        0,
        remainingSlotMinutes -
          winner.blockOption.durationMinutes -
          breakAfterBlock,
      );

      if (topicCompletedByPlacement && winner.task.subjectId) {
        syncWorkingTasks([winner.task.subjectId]);
      }
    }
  });

  const absorbedMicroGapDateKeys =
    options.allowLargeGapAbsorption !== false ? compactDailyMicroGaps() : [];

  return {
    scheduledBlocks,
    unscheduledTasks: workingTasks.filter((task) => task.remainingMinutes >= MIN_ALLOCATABLE_MINUTES),
    usedSundayMinutes,
    scheduledStudyMinutes: consumedStudyMinutes,
    absorbedMicroGapDateKeys,
  };
}

function buildAutomaticDailyCapBoost(options: {
  freeSlots: CalendarSlot[];
  requiredMinutes: number;
  preferences: Preferences;
}) {
  const totalFreeSlotMinutes = sum(options.freeSlots.map((slot) => slot.durationMinutes));
  const bufferedCapacityMinutes =
    totalFreeSlotMinutes * (1 - options.preferences.weeklyBufferRatio);
  const activeDayCount = new Set(options.freeSlots.map((slot) => slot.dateKey)).size;

  return activeDayCount > 0
    ? clamp(
        Math.ceil(Math.max(0, options.requiredMinutes - bufferedCapacityMinutes) / activeDayCount / 15) * 15,
        0,
        120,
      )
    : 0;
}

function buildAllocationPasses(baseDailyCapBoostMinutes: number) {
  const passes: AllocationPassPolicy[] = [
    {
      protectRecovery: true,
      skipMovableRecovery: false,
      dailyCapBoostMinutes: baseDailyCapBoostMinutes,
      minBreakMinutes: undefined,
      countAsForcedCoverage: false,
    },
    {
      protectRecovery: false,
      skipMovableRecovery: true,
      dailyCapBoostMinutes: baseDailyCapBoostMinutes,
      minBreakMinutes: undefined,
      countAsForcedCoverage: true,
    },
    {
      protectRecovery: false,
      skipMovableRecovery: true,
      dailyCapBoostMinutes: baseDailyCapBoostMinutes + 240,
      heavySessionBoost: 1,
      minBreakMinutes: 10,
      blockSelectionPolicy: {
        preferLongerBlocks: true,
      },
      countAsForcedCoverage: true,
    },
    {
      protectRecovery: false,
      skipMovableRecovery: true,
      dailyCapBoostMinutes: baseDailyCapBoostMinutes + 600,
      heavySessionBoost: 2,
      minBreakMinutes: 5,
      blockSelectionPolicy: {
        preferLongerBlocks: true,
        allowLowEnergyHeavy: true,
        allowLateNightDeepWork: true,
      },
      countAsForcedCoverage: true,
    },
  ];
  return passes;
}

export function generateStudyPlanForWeek(options: {
  weekStart?: Date;
  referenceDate?: Date;
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  completionLogs?: CompletionLog[];
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  focusedDays?: FocusedDay[];
  focusedWeeks?: FocusedWeek[];
  preferences: Preferences;
  lockedBlocks?: StudyBlock[];
  existingPlannedBlocks?: StudyBlock[];
  futureFocusedReserveMinutesBySubject?: Record<string, number>;
  dailyCapBoostMinutes?: number;
  horizonStartDate?: Date;
  availabilityOverrideSubjectIds?: Subject["id"][];
  effectiveReservedCommitmentDurations?: EffectiveReservedCommitmentDuration[];
  excludedReservedCommitmentRuleIds?: string[];
  reservedCommitmentFallbackTierUsed?: number;
  allowReinforcement?: boolean;
  schedulingContext?: SchedulingRunContext;
}): SchedulerResult {
  const weekStart = startOfPlannerWeek(options.weekStart ?? new Date());
  const referenceDate = getPlannerReferenceDate(weekStart, options.referenceDate);
  const horizonStartDate = options.horizonStartDate ?? getPlannerReferenceDate(startOfPlannerWeek(new Date()));
  const lockedBlocks = options.lockedBlocks ?? [];
  const sickDays = options.sickDays ?? [];
  const focusedDays = options.focusedDays ?? [];
  const focusedWeeks = options.focusedWeeks ?? [];
  const existingPlannedBlocks = options.existingPlannedBlocks ?? lockedBlocks;
  const focusedSubjectsByDate = buildFocusedSubjectsByDate({
    weekStart,
    focusedDays,
    focusedWeeks,
  });
  const existingRealCoverageUnscheduledBySubject = getRealCoverageUnscheduledMinutesBySubject({
    subjects: options.subjects,
    topics: options.topics,
    studyBlocks: existingPlannedBlocks,
    referenceDate,
  });
  const coverageRescueSubjectIds =
    options.allowReinforcement && (existingRealCoverageUnscheduledBySubject.olympiad ?? 0) > 0
      ? (["olympiad"] satisfies Subject["id"][])
      : [];
  const availabilityOverrideSubjectIds = Array.from(
    new Set([
      ...Object.values(focusedSubjectsByDate).flat(),
      ...coverageRescueSubjectIds,
      ...(options.availabilityOverrideSubjectIds ?? []),
    ]),
  ) as Subject["id"][];
  const weekStartKey = toDateKey(weekStart);
  const schoolTermTemplate = buildSchoolTermWeekTemplate({
    weekStart,
    topics: options.topics,
    preferences: options.preferences,
    existingPlannedBlocks,
  });
  const deadlineTracks = computeSubjectDeadlineTracks({
    subjects: options.subjects,
    goals: options.goals,
    topics: options.topics,
    completionLogs: options.completionLogs,
    referenceDate,
    horizonStartDate,
    weekStartDate: weekStart,
    weekEndDate: addDays(weekStart, 6),
    priorPlannedBlocks: existingPlannedBlocks,
    preferences: options.preferences,
    fixedEvents: options.fixedEvents,
    sickDays,
  });
  const requiredHoursBySubject = buildRequiredHoursFromTracks(options.subjects, deadlineTracks);
  const deadlinePaceHoursBySubject = buildDeadlinePaceHoursFromTracks(options.subjects, deadlineTracks);
  const subjectDeadlinesById = Object.fromEntries(
    options.subjects.map((subject) => [
      subject.id,
      deadlineTracks[subject.id]?.deadline ?? subject.deadline,
    ]),
  );
  const hasAvailabilityConstraints =
    options.fixedEvents.length > 0 ||
    options.preferences.schoolSchedule.enabled ||
    options.preferences.holidaySchedule.enabled;

  if (!hasAvailabilityConstraints) {
    const studyBlocks = [...lockedBlocks].sort(
      (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
    );

    return {
      studyBlocks,
      weeklyPlan: buildUnconfiguredWeeklyPlan({
        weekStart: weekStartKey,
        subjects: options.subjects,
        studyBlocks,
        topics: options.topics,
        goals: options.goals,
        referenceDate,
        effectiveReservedCommitmentDurations: options.effectiveReservedCommitmentDurations,
        excludedReservedCommitmentRuleIds: options.excludedReservedCommitmentRuleIds,
        preferences: options.preferences,
      }),
      freeSlots: [],
      unscheduledTasks: buildTaskCandidates({
        topics: options.topics,
        existingPlannedBlocks,
        completionLogs: options.completionLogs,
        referenceDate,
        coverageReferenceDate: horizonStartDate,
        subjectDeadlinesById,
        availabilityOverrideSubjectIds,
      }),
    };
  }

  const initialFreeSlots = calculateFreeSlots({
    weekStart,
    fixedEvents: options.fixedEvents,
    sickDays,
    preferences: options.preferences,
    blockedStudyBlocks: lockedBlocks,
    planningStart: referenceDate,
    effectiveReservedCommitmentDurations: options.effectiveReservedCommitmentDurations,
    excludedReservedCommitmentRuleIds: options.excludedReservedCommitmentRuleIds,
    schedulingContext: options.schedulingContext,
  });
  const capacityFreeSlots = calculateFreeSlots({
    weekStart,
    fixedEvents: options.fixedEvents,
    sickDays,
    preferences: options.preferences,
    blockedStudyBlocks: lockedBlocks,
    planningStart: referenceDate,
    skipMovableRecovery: true,
    effectiveReservedCommitmentDurations: options.effectiveReservedCommitmentDurations,
    excludedReservedCommitmentRuleIds: options.excludedReservedCommitmentRuleIds,
    schedulingContext: options.schedulingContext,
  });
  const shouldFillAvailableStudyDays = true;
  const fullCoverageTasks = buildTaskCandidates({
    topics: options.topics,
    existingPlannedBlocks,
    completionLogs: options.completionLogs,
    referenceDate,
    coverageReferenceDate: horizonStartDate,
    subjectDeadlinesById,
    availabilityOverrideSubjectIds,
  });
  const olympiadWeekLoadProfile = getOlympiadWeekLoadProfile({
    weekStart,
    fixedEvents: options.fixedEvents,
    preferences: options.preferences,
    sickDays,
  });
  const olympiadWeaknessProfile = getOlympiadWeaknessProfile({
    topics: options.topics,
    studyBlocks: existingPlannedBlocks,
    completionLogs: options.completionLogs,
    referenceDate,
  });
  const allocationRequiredHoursBySubject = buildFullCoverageHoursBySubject(
    options.subjects,
    fullCoverageTasks,
  );
  const requiredMinutes = sum(
    Object.values(allocationRequiredHoursBySubject).map((value) => value * 60),
  );
  const automaticDailyCapBoostMinutes = buildAutomaticDailyCapBoost({
    freeSlots: initialFreeSlots,
    requiredMinutes,
    preferences: options.preferences,
  });
  const passPolicies = buildAllocationPasses(
    Math.max(options.dailyCapBoostMinutes ?? 0, automaticDailyCapBoostMinutes),
  );
  const scheduledBlocks: StudyBlock[] = [];
  let usedSundayMinutes = 0;
  let forcedCoverageMinutes = 0;
  let fallbackTierUsed = options.reservedCommitmentFallbackTierUsed ?? 0;
  const absorbedMicroGapDateKeys = new Set<string>();

  for (const passPolicy of passPolicies) {
    if (passPolicy.countAsForcedCoverage && scheduledBlocks.some((block) => !block.subjectId)) {
      const reclaimedRecoveryIds = new Set(
        scheduledBlocks.filter((block) => !block.subjectId).map((block) => block.id),
      );
      const preservedBlocks = scheduledBlocks.filter((block) => !reclaimedRecoveryIds.has(block.id));
      scheduledBlocks.length = 0;
      scheduledBlocks.push(...preservedBlocks);
    }

    const tasks = buildTaskCandidates({
      topics: options.topics,
      existingPlannedBlocks: [...existingPlannedBlocks, ...scheduledBlocks.filter((block) => block.subjectId)],
      completionLogs: options.completionLogs,
      referenceDate,
      coverageReferenceDate: horizonStartDate,
      subjectDeadlinesById,
      availabilityOverrideSubjectIds,
    });
    const passRequiredHoursBySubject = {
      ...recordFromKeys(subjectIds, () => 0),
      ...buildFullCoverageHoursBySubject(options.subjects, tasks),
    };
    const remainingRequiredMinutes = Math.round(
      sum(Object.values(passRequiredHoursBySubject).map((hours) => hours * 60)),
    );

    if (remainingRequiredMinutes <= 0) {
      break;
    }

    const freeSlots = calculateFreeSlots({
      weekStart,
      fixedEvents: options.fixedEvents,
      sickDays,
      preferences: options.preferences,
      blockedStudyBlocks: [...lockedBlocks, ...scheduledBlocks.filter((block) => block.subjectId)],
      planningStart: referenceDate,
      skipMovableRecovery: passPolicy.skipMovableRecovery,
      effectiveReservedCommitmentDurations: options.effectiveReservedCommitmentDurations,
      excludedReservedCommitmentRuleIds: options.excludedReservedCommitmentRuleIds,
      schedulingContext: options.schedulingContext,
    });

    if (!freeSlots.length) {
      continue;
    }

    const result = allocateTasksToSlots({
      weekStart,
      referenceDate,
      coverageReferenceDate: horizonStartDate,
      freeSlots,
      tasks,
      subjects: options.subjects,
      goals: options.goals,
      topics: options.topics,
      completionLogs: options.completionLogs,
      fixedEvents: options.fixedEvents,
      sickDays,
      preferences: options.preferences,
      lockedBlocks: [...lockedBlocks, ...scheduledBlocks.filter((block) => block.subjectId)],
      priorPlannedBlocks: existingPlannedBlocks,
      requiredHoursBySubject: passRequiredHoursBySubject,
      dailyCapBoostMinutes: passPolicy.dailyCapBoostMinutes,
      heavySessionBoost: passPolicy.heavySessionBoost,
      minBreakMinutes: passPolicy.minBreakMinutes,
      protectRecovery: passPolicy.protectRecovery,
      blockSelectionPolicy: passPolicy.blockSelectionPolicy,
      fillAvailableStudyDays: shouldFillAvailableStudyDays,
      focusedSubjectsByDate,
      futureFocusedReserveMinutesBySubject: options.futureFocusedReserveMinutesBySubject,
      availabilityOverrideSubjectIds,
      olympiadLoadMultiplier: olympiadWeekLoadProfile.multiplier,
      olympiadWeaknessStrand: olympiadWeaknessProfile.activeStrand,
      isFinalPass: passPolicy === passPolicies[passPolicies.length - 1],
      allowReinforcement: options.allowReinforcement ?? false,
      dayStudyCapOverrideMinutesByDate: schoolTermTemplate.dayStudyCapOverrideMinutesByDate,
      schoolTermTemplate,
    });

    if (!result.scheduledBlocks.length) {
      continue;
    }

    scheduledBlocks.push(...result.scheduledBlocks);
    usedSundayMinutes += result.usedSundayMinutes;
    result.absorbedMicroGapDateKeys.forEach((dateKey) => absorbedMicroGapDateKeys.add(dateKey));
    if (result.absorbedMicroGapDateKeys.length > 0) {
      fallbackTierUsed = Math.max(fallbackTierUsed, 1);
    }
    if (passPolicy.skipMovableRecovery) {
      fallbackTierUsed = Math.max(fallbackTierUsed, 4);
    }
    if (
      passPolicy.heavySessionBoost ||
      passPolicy.blockSelectionPolicy?.allowLowEnergyHeavy ||
      passPolicy.blockSelectionPolicy?.allowLateNightDeepWork ||
      (passPolicy.dailyCapBoostMinutes ?? 0) >
        Math.max(options.dailyCapBoostMinutes ?? 0, automaticDailyCapBoostMinutes)
    ) {
      fallbackTierUsed = Math.max(fallbackTierUsed, 5);
    }
    if (passPolicy.countAsForcedCoverage) {
      forcedCoverageMinutes += result.scheduledStudyMinutes;
    }
  }

  let finalFreeSlots = calculateFreeSlots({
    weekStart,
    fixedEvents: options.fixedEvents,
    sickDays,
    preferences: options.preferences,
    blockedStudyBlocks: [...lockedBlocks, ...scheduledBlocks.filter((block) => block.subjectId)],
    planningStart: referenceDate,
    effectiveReservedCommitmentDurations: options.effectiveReservedCommitmentDurations,
    excludedReservedCommitmentRuleIds: options.excludedReservedCommitmentRuleIds,
    schedulingContext: options.schedulingContext,
  });
  let finalTasks = buildTaskCandidates({
    topics: options.topics,
    existingPlannedBlocks: [...existingPlannedBlocks, ...scheduledBlocks.filter((block) => block.subjectId)],
    completionLogs: options.completionLogs,
    referenceDate,
    coverageReferenceDate: horizonStartDate,
    subjectDeadlinesById,
    availabilityOverrideSubjectIds,
  });

  if (shouldFillAvailableStudyDays) {
    for (let cleanupPass = 0; cleanupPass < 8; cleanupPass += 1) {
      const hasFillableGap = finalFreeSlots.some((slot) => slot.durationMinutes >= MIN_ALLOCATABLE_MINUTES);

      if (!hasFillableGap) {
        break;
      }

      const cleanupRequiredHoursBySubject = {
        ...recordFromKeys(subjectIds, () => 0),
        ...buildFullCoverageHoursBySubject(options.subjects, finalTasks),
      };
      const cleanupResult = allocateTasksToSlots({
        weekStart,
        referenceDate,
        coverageReferenceDate: horizonStartDate,
        freeSlots: finalFreeSlots,
        tasks: finalTasks,
        subjects: options.subjects,
        goals: options.goals,
        topics: options.topics,
        completionLogs: options.completionLogs,
        fixedEvents: options.fixedEvents,
        sickDays,
        preferences: options.preferences,
        lockedBlocks: [...lockedBlocks, ...scheduledBlocks.filter((block) => block.subjectId)],
        priorPlannedBlocks: existingPlannedBlocks,
        requiredHoursBySubject: cleanupRequiredHoursBySubject,
        dailyCapBoostMinutes: Math.max(options.dailyCapBoostMinutes ?? 0, automaticDailyCapBoostMinutes),
        heavySessionBoost: 1,
        minBreakMinutes: 0,
        protectRecovery: false,
        blockSelectionPolicy: {
          preferLongerBlocks: true,
          allowLowEnergyHeavy: true,
          allowLateNightDeepWork: true,
        },
        fillAvailableStudyDays: true,
        focusedSubjectsByDate,
        futureFocusedReserveMinutesBySubject: options.futureFocusedReserveMinutesBySubject,
        availabilityOverrideSubjectIds,
        olympiadLoadMultiplier: olympiadWeekLoadProfile.multiplier,
        olympiadWeaknessStrand: olympiadWeaknessProfile.activeStrand,
        isFinalPass: true,
        allowReinforcement: options.allowReinforcement ?? false,
        dayStudyCapOverrideMinutesByDate: schoolTermTemplate.dayStudyCapOverrideMinutesByDate,
        schoolTermTemplate,
        allowLargeGapAbsorption: true,
      });

      if (!cleanupResult.scheduledBlocks.length) {
        break;
      }

      scheduledBlocks.push(...cleanupResult.scheduledBlocks);
      usedSundayMinutes += cleanupResult.usedSundayMinutes;
      cleanupResult.absorbedMicroGapDateKeys.forEach((dateKey) =>
        absorbedMicroGapDateKeys.add(dateKey),
      );
      if (cleanupResult.absorbedMicroGapDateKeys.length > 0) {
        fallbackTierUsed = Math.max(fallbackTierUsed, 1);
      }
      fallbackTierUsed = Math.max(fallbackTierUsed, 5);

      finalFreeSlots = calculateFreeSlots({
        weekStart,
        fixedEvents: options.fixedEvents,
        sickDays,
        preferences: options.preferences,
        blockedStudyBlocks: [...lockedBlocks, ...scheduledBlocks.filter((block) => block.subjectId)],
        planningStart: referenceDate,
        effectiveReservedCommitmentDurations: options.effectiveReservedCommitmentDurations,
        excludedReservedCommitmentRuleIds: options.excludedReservedCommitmentRuleIds,
        schedulingContext: options.schedulingContext,
      });
      finalTasks = buildTaskCandidates({
        topics: options.topics,
        existingPlannedBlocks: [...existingPlannedBlocks, ...scheduledBlocks.filter((block) => block.subjectId)],
        completionLogs: options.completionLogs,
        referenceDate,
        coverageReferenceDate: horizonStartDate,
        subjectDeadlinesById,
        availabilityOverrideSubjectIds,
      });
    }
  }

  const compactedScheduledBlocks = compactAdjacentStudyBlocks(scheduledBlocks);
  scheduledBlocks.length = 0;
  scheduledBlocks.push(...compactedScheduledBlocks);

  const fillableGapDateKeys =
    finalTasks.some(
      (task) =>
        !!task.subjectId &&
        zeroUnscheduledCoverageSubjectIds.includes(
          task.subjectId as (typeof zeroUnscheduledCoverageSubjectIds)[number],
        ) &&
        task.remainingMinutes > 0,
    )
      ? Array.from(new Set(finalFreeSlots.map((slot) => slot.dateKey))).sort((left, right) =>
          left.localeCompare(right),
        )
      : [];
  const coverageRescueBlockedReasonBySubject = Object.fromEntries(
    coverageRescueSubjectIds
      .filter((subjectId) =>
        finalTasks.some(
          (task) => task.subjectId === subjectId && task.remainingMinutes > 0,
        ),
      )
      .map((subjectId) => [
        subjectId,
        finalFreeSlots.some((slot) => slot.durationMinutes >= MIN_ALLOCATABLE_MINUTES)
          ? "dependency_gate_or_exact_session_fit"
          : "capacity",
      ]),
  );
  const studyBlocks = [...lockedBlocks, ...scheduledBlocks].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  );
  const weeklyPlan = buildWeeklyPlan({
    weekStart: weekStartKey,
    subjects: options.subjects,
    studyBlocks,
    topics: options.topics,
    goals: options.goals,
    freeSlots: finalFreeSlots,
    capacityFreeSlots,
    referenceDate,
    horizonStartDate,
    fixedEvents: options.fixedEvents,
    sickDays,
    requiredHoursBySubject,
    deadlinePaceHoursBySubject,
    forcedCoverageMinutes,
    usedSundayMinutes,
    fallbackTierUsed,
    fillableGapDateKeys,
    coverageRescueSubjectIds,
    coverageRescueBlockedReasonBySubject,
    unscheduledTasks: finalTasks,
    priorPlannedBlocks: existingPlannedBlocks,
    cumulativePlannedBlocks: [...existingPlannedBlocks, ...scheduledBlocks.filter((block) => block.subjectId)],
    effectiveReservedCommitmentDurations: options.effectiveReservedCommitmentDurations,
    excludedReservedCommitmentRuleIds: options.excludedReservedCommitmentRuleIds,
    preferences: options.preferences,
  });

  return {
    studyBlocks,
    weeklyPlan,
    freeSlots: finalFreeSlots,
    unscheduledTasks: finalTasks,
  };
}

export function getPlanningHorizonEndWeek(goals: Goal[], subjects: Subject[], referenceDate: Date) {
  void referenceDate;
  const maximumHorizonEndDate = getPlannerHorizonEndDate();
  const latestConfiguredDeadline = [...goals.map((goal) => goal.deadline), ...subjects.map((subject) => subject.deadline)]
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .reduce(
      (latest, candidate) => (isAfter(candidate, latest) ? candidate : latest),
      maximumHorizonEndDate,
    );

  return startOfPlannerWeek(
    isAfter(latestConfiguredDeadline, maximumHorizonEndDate)
      ? maximumHorizonEndDate
      : latestConfiguredDeadline,
  );
}

export function shouldAlwaysPreserveStudyBlockOnRegeneration(block: StudyBlock) {
  if (block.assignmentLocked) {
    return true;
  }

  if (!block.isAutoGenerated) {
    return true;
  }

  return block.status === "done" || block.status === "partial";
}

export function shouldPreserveStudyBlockOnRegeneration(
  block: StudyBlock,
  options?: { preserveFlexibleFutureBlocks?: boolean },
) {
  if (shouldAlwaysPreserveStudyBlockOnRegeneration(block)) {
    return true;
  }

  if (block.assignmentEditedAt && block.status !== "done" && block.status !== "partial") {
    return false;
  }

  if (options?.preserveFlexibleFutureBlocks === false) {
    return false;
  }

  if (block.status === "rescheduled") {
    return true;
  }

  if (block.rescheduleCount > 0) {
    return true;
  }

  return block.notes.trim().length > 0;
}

export function generateStudyPlanHorizon(options: {
  startWeek?: Date;
  endWeek?: Date;
  referenceDate?: Date;
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  completionLogs?: CompletionLog[];
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  focusedDays?: FocusedDay[];
  focusedWeeks?: FocusedWeek[];
  preferences: Preferences;
  existingStudyBlocks?: StudyBlock[];
  preservedStudyBlockIds?: string[];
  preserveFlexibleFutureBlocks?: boolean;
  availabilityOverrideSubjectIds?: Subject["id"][];
  allowReinforcement?: boolean;
}) {
  const startWeek = startOfPlannerWeek(options.startWeek ?? new Date());
  const referenceDate = options.referenceDate ?? new Date();
  const schedulingContext = createSchedulingRunContext();
  const horizonStartDate = referenceDate;
  const configuredEndWeek = clampPlanningHorizonEndWeek(
    options.endWeek
      ? startOfPlannerWeek(options.endWeek)
      : getPlanningHorizonEndWeek(options.goals, options.subjects, referenceDate),
    referenceDate,
  );
  const existingStudyBlocks = options.existingStudyBlocks ?? [];
  const extraPreservedIds = new Set(options.preservedStudyBlockIds ?? []);
  const preservedLockedBlocks = existingStudyBlocks.filter(
    (block) =>
      shouldPreserveStudyBlockOnRegeneration(block, {
        preserveFlexibleFutureBlocks: options.preserveFlexibleFutureBlocks,
      }) || extraPreservedIds.has(block.id),
  );
  const subjectDeadlinesById = Object.fromEntries(
    options.subjects.map((subject) => [subject.id, subject.deadline]),
  );

  const countRemainingAllocatableTasks = (tasks: TaskCandidate[]) =>
    tasks.filter((task) => {
      if (!task.subjectId) {
        return task.remainingMinutes >= MIN_ALLOCATABLE_MINUTES;
      }

      if (
        zeroUnscheduledCoverageSubjectIds.includes(
          task.subjectId as (typeof zeroUnscheduledCoverageSubjectIds)[number],
        )
      ) {
        return task.remainingMinutes > 0;
      }

      return task.remainingMinutes >= MIN_ALLOCATABLE_MINUTES;
    }).length;
  const horizonStudyBlocks: StudyBlock[] = [];
  const weeklyPlans: WeeklyPlan[] = [];
  const accumulatedBlocks: StudyBlock[] = [];
  let effectiveEndWeek = configuredEndWeek;
  let extensionWeeksUsed = 0;
  let finalWeek = configuredEndWeek;
  let remainingTaskCount = 0;

  for (
    let currentWeek = startWeek;
    currentWeek.getTime() <= effectiveEndWeek.getTime();
    currentWeek = addDays(currentWeek, 7)
  ) {
    finalWeek = currentWeek;
    const weekKey = toDateKey(currentWeek);
    const lockedBlocks = preservedLockedBlocks.filter((block) => {
      if (block.weekStart === weekKey) {
        return true;
      }

      return toDateKey(startOfPlannerWeek(new Date(block.start))) === weekKey;
    });
    const existingPlannedBlocks = [...accumulatedBlocks, ...lockedBlocks];
    const effectiveReservedCommitmentPlan = selectEffectiveReservedCommitmentPlanForWeek({
      currentWeek,
      endWeek: effectiveEndWeek,
      goals: options.goals,
      subjects: options.subjects,
      topics: options.topics,
      completionLogs: options.completionLogs,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays,
      focusedDays: options.focusedDays,
      focusedWeeks: options.focusedWeeks,
      preferences: options.preferences,
      existingPlannedBlocks,
      lockedBlocks,
      horizonStartDate,
      subjectDeadlinesById,
      availabilityOverrideSubjectIds: options.availabilityOverrideSubjectIds,
      schedulingContext,
    });
    const futureFocusedReserveMinutesBySubject = buildFutureFocusedReserveMinutesBySubject({
      currentWeek,
      endWeek: effectiveEndWeek,
      topics: options.topics,
      completionLogs: options.completionLogs,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays,
      focusedDays: options.focusedDays,
      focusedWeeks: options.focusedWeeks,
      preferences: options.preferences,
      subjectDeadlinesById,
      existingPlannedBlocks,
      horizonStartDate,
      availabilityOverrideSubjectIds: options.availabilityOverrideSubjectIds,
      getEffectiveReservedCommitmentPlanForWeek: (candidateWeek) =>
        selectEffectiveReservedCommitmentPlanForWeek({
          currentWeek: candidateWeek,
          endWeek: effectiveEndWeek,
          goals: options.goals,
          subjects: options.subjects,
          topics: options.topics,
          completionLogs: options.completionLogs,
          fixedEvents: options.fixedEvents,
          sickDays: options.sickDays,
          focusedDays: options.focusedDays,
          focusedWeeks: options.focusedWeeks,
          preferences: options.preferences,
          existingPlannedBlocks,
          horizonStartDate,
          subjectDeadlinesById,
          availabilityOverrideSubjectIds: options.availabilityOverrideSubjectIds,
          schedulingContext,
        }),
      schedulingContext,
    });
    const result = generateStudyPlanForWeek({
      weekStart: currentWeek,
      referenceDate,
      goals: options.goals,
      subjects: options.subjects,
      topics: options.topics,
      completionLogs: options.completionLogs,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays,
      focusedDays: options.focusedDays,
      focusedWeeks: options.focusedWeeks,
      preferences: options.preferences,
      lockedBlocks,
      existingPlannedBlocks,
      futureFocusedReserveMinutesBySubject,
      horizonStartDate,
      availabilityOverrideSubjectIds: options.availabilityOverrideSubjectIds,
      effectiveReservedCommitmentDurations:
        effectiveReservedCommitmentPlan.effectiveReservedCommitmentDurations,
      excludedReservedCommitmentRuleIds:
        effectiveReservedCommitmentPlan.excludedReservedCommitmentRuleIds,
      reservedCommitmentFallbackTierUsed:
        effectiveReservedCommitmentPlan.fallbackTierUsed,
      allowReinforcement: options.allowReinforcement ?? true,
      schedulingContext,
    });

    horizonStudyBlocks.push(...result.studyBlocks);
    weeklyPlans.push(result.weeklyPlan);
    accumulatedBlocks.push(...result.studyBlocks);

    remainingTaskCount = countRemainingAllocatableTasks(result.unscheduledTasks);
    if (
      currentWeek.getTime() >= effectiveEndWeek.getTime() &&
      remainingTaskCount > 0 &&
      canExtendPlanningHorizon({
        effectiveEndWeek,
        referenceDate,
        extensionWeeksUsed,
      })
    ) {
      effectiveEndWeek = getExtendedPlanningHorizonEndWeek(effectiveEndWeek, referenceDate);
      extensionWeeksUsed += 1;
    }
  }

  const horizonEndDate = getHorizonEndDateKey(finalWeek, referenceDate);
  const realCoverageUnscheduledBySubject = getRealCoverageUnscheduledMinutesBySubject({
    subjects: options.subjects,
    topics: options.topics,
    studyBlocks: horizonStudyBlocks,
    referenceDate,
  });

  if (
    (realCoverageUnscheduledBySubject.olympiad ?? 0) > 0 &&
    !(options.availabilityOverrideSubjectIds ?? []).includes("olympiad")
  ) {
    return generateStudyPlanHorizon({
      ...options,
      availabilityOverrideSubjectIds: [
        ...(options.availabilityOverrideSubjectIds ?? []),
        "olympiad",
      ],
    });
  }

  let finalStudyBlocks = horizonStudyBlocks;
  let finalWeeklyPlans = weeklyPlans;

  if (
    hasCompleteRealCoverage({
      subjects: options.subjects,
      topics: options.topics,
      studyBlocks: horizonStudyBlocks,
      referenceDate,
    })
  ) {
    const reinforcedStudyBlocks: StudyBlock[] = [];
    const reinforcedWeeklyPlans: WeeklyPlan[] = [];

    weeklyPlans.forEach((weeklyPlan) => {
      const currentWeek = startOfPlannerWeek(new Date(`${weeklyPlan.weekStart}T12:00:00`));
      const realStudyBlocks = horizonStudyBlocks.filter((block) => {
        const blockWeekStart = block.weekStart || toDateKey(startOfPlannerWeek(new Date(block.start)));
        return blockWeekStart === weeklyPlan.weekStart;
      });
      const result = fillReinforcementForWeek({
        weekStart: currentWeek,
        weeklyPlan,
        realStudyBlocks,
        priorReinforcementBlocks: reinforcedStudyBlocks,
        referenceDate,
        horizonStartDate,
        goals: options.goals,
        subjects: options.subjects,
        topics: options.topics,
        fixedEvents: options.fixedEvents,
        sickDays: options.sickDays,
        preferences: options.preferences,
        schedulingContext,
      });

      reinforcedStudyBlocks.push(...result.studyBlocks);
      reinforcedWeeklyPlans.push(result.weeklyPlan);
    });

    finalStudyBlocks = reinforcedStudyBlocks;
    finalWeeklyPlans = reinforcedWeeklyPlans;
  }

  return {
    studyBlocks: finalStudyBlocks.sort(
      (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
    ),
    weeklyPlans: finalWeeklyPlans.map((plan) => ({
      ...plan,
      horizonEndDate,
    })),
  };
}

function buildComparableStudyBlock(block: StudyBlock) {
  return {
    date: block.date,
    start: block.start,
    end: block.end,
    subjectId: block.subjectId,
    topicId: block.topicId,
    title: block.title,
    sessionSummary: block.sessionSummary,
    paperCode: block.paperCode,
    unitTitle: block.unitTitle,
    blockType: block.blockType,
    intensity: block.intensity,
    status: block.status,
    creationSource: block.creationSource,
    sourceMaterials: block.sourceMaterials,
    slotEnergy: block.slotEnergy,
    estimatedMinutes: block.estimatedMinutes,
    actualMinutes: block.actualMinutes,
    notes: block.notes,
    rescheduleCount: block.rescheduleCount,
    assignmentLocked: block.assignmentLocked,
    studyLayer: block.studyLayer ?? null,
    followUpKind: block.followUpKind ?? null,
    followUpSourceStudyBlockId: block.followUpSourceStudyBlockId ?? null,
    followUpDueAt: block.followUpDueAt ?? null,
  };
}

function isReinforcementStudyBlock(block: StudyBlock) {
  return isOverflowReinforcementBlock(block);
}

function areStudyBlockListsEquivalent(left: StudyBlock[], right: StudyBlock[]) {
  const realLeft = left.filter((block) => !isReinforcementStudyBlock(block));
  const realRight = right.filter((block) => !isReinforcementStudyBlock(block));

  if (realLeft.length !== realRight.length) {
    return false;
  }

  const comparableLeft = [...realLeft]
    .map(buildComparableStudyBlock)
    .sort((a, b) =>
      a.start.localeCompare(b.start) ||
      a.end.localeCompare(b.end) ||
      (a.topicId ?? "").localeCompare(b.topicId ?? "") ||
      (a.followUpSourceStudyBlockId ?? "").localeCompare(b.followUpSourceStudyBlockId ?? "") ||
      a.title.localeCompare(b.title),
    );
  const comparableRight = [...realRight]
    .map(buildComparableStudyBlock)
    .sort((a, b) =>
      a.start.localeCompare(b.start) ||
      a.end.localeCompare(b.end) ||
      (a.topicId ?? "").localeCompare(b.topicId ?? "") ||
      (a.followUpSourceStudyBlockId ?? "").localeCompare(b.followUpSourceStudyBlockId ?? "") ||
      a.title.localeCompare(b.title),
    );

  return JSON.stringify(comparableLeft) === JSON.stringify(comparableRight);
}

function buildComparableWeeklyPlan(weeklyPlan: WeeklyPlan | null | undefined) {
  if (!weeklyPlan) {
    return null;
  }

  return {
    weekStart: weeklyPlan.weekStart,
    requiredHoursBySubject: weeklyPlan.requiredHoursBySubject,
    deadlinePaceHoursBySubject: weeklyPlan.deadlinePaceHoursBySubject,
    completedHoursBySubject: weeklyPlan.completedHoursBySubject,
    remainingHoursBySubject: weeklyPlan.remainingHoursBySubject,
    remainingAfterWeekMinutesBySubject: weeklyPlan.remainingAfterWeekMinutesBySubject,
    weekPacingGapMinutesBySubject: weeklyPlan.weekPacingGapMinutesBySubject,
    scheduledToGoalHoursBySubject: weeklyPlan.scheduledToGoalHoursBySubject,
    weekCarryForwardSubjectIds: weeklyPlan.weekCarryForwardSubjectIds,
    carryOverBlockIds: weeklyPlan.carryOverBlockIds,
    feasibilityScore: weeklyPlan.feasibilityScore,
    riskFlag: weeklyPlan.riskFlag,
    feasibilityWarnings: weeklyPlan.feasibilityWarnings,
    fallbackTierUsed: weeklyPlan.fallbackTierUsed,
    forcedCoverageMinutes: weeklyPlan.forcedCoverageMinutes,
    usedSundayMinutes: weeklyPlan.usedSundayMinutes,
    weekOverloadMinutes: weeklyPlan.weekOverloadMinutes,
    overscheduledMinutes: weeklyPlan.overscheduledMinutes,
    effectiveReservedCommitmentDurations: weeklyPlan.effectiveReservedCommitmentDurations,
    excludedReservedCommitmentRuleIds: weeklyPlan.excludedReservedCommitmentRuleIds,
    weeksRemainingToDeadline: weeklyPlan.weeksRemainingToDeadline,
  };
}

function areWeeklyPlansEquivalent(left: WeeklyPlan | null | undefined, right: WeeklyPlan | null | undefined) {
  return JSON.stringify(buildComparableWeeklyPlan(left)) === JSON.stringify(buildComparableWeeklyPlan(right));
}

function buildCarryForwardPlanningSignature(studyBlocks: StudyBlock[]) {
  const topicStateById = new Map<
    string,
    {
      plannedMinutes: number;
      reviewMinutes: number;
      latestEnd: string | null;
      hasStudyHistory: boolean;
    }
  >();
  const followUpStates: Array<{
    followUpKind: string | null;
    followUpSourceStudyBlockId: string | null;
    followUpDueAt: string | null;
    end: string;
    estimatedMinutes: number;
    status: StudyBlock["status"];
  }> = [];

  studyBlocks.forEach((block) => {
    if (block.status === "missed") {
      return;
    }

    if (block.topicId) {
      const current = topicStateById.get(block.topicId) ?? {
        plannedMinutes: 0,
        reviewMinutes: 0,
        latestEnd: null,
        hasStudyHistory: false,
      };

      if (["planned", "rescheduled", "done", "partial"].includes(block.status)) {
        current.plannedMinutes += block.estimatedMinutes;
      }

      if (
        block.blockType === "review" &&
        ["planned", "rescheduled", "done", "partial"].includes(block.status)
      ) {
        current.reviewMinutes += block.estimatedMinutes;
      }

      if (!current.latestEnd || block.end > current.latestEnd) {
        current.latestEnd = block.end;
      }

      if (block.status === "done" || block.status === "partial") {
        current.hasStudyHistory = true;
      }

      topicStateById.set(block.topicId, current);
    }

    if (block.followUpKind) {
      followUpStates.push({
        followUpKind: block.followUpKind,
        followUpSourceStudyBlockId: block.followUpSourceStudyBlockId ?? null,
        followUpDueAt: block.followUpDueAt ?? null,
        end: block.end,
        estimatedMinutes: block.estimatedMinutes,
        status: block.status,
      });
    }
  });

  return JSON.stringify({
    topicStates: Array.from(topicStateById.entries())
      .map(([topicId, state]) => ({ topicId, ...state }))
      .sort((left, right) => left.topicId.localeCompare(right.topicId)),
    followUpStates: followUpStates.sort(
      (left, right) =>
        (left.followUpKind ?? "").localeCompare(right.followUpKind ?? "") ||
        (left.followUpSourceStudyBlockId ?? "").localeCompare(right.followUpSourceStudyBlockId ?? "") ||
        left.end.localeCompare(right.end),
    ),
  });
}

export function generateIncrementalStudyPlanTail(options: {
  startWeek?: Date;
  endWeek?: Date;
  referenceDate?: Date;
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  completionLogs?: CompletionLog[];
  fixedEvents: import("@/lib/types/planner").FixedEvent[];
  sickDays?: SickDay[];
  focusedDays?: FocusedDay[];
  focusedWeeks?: FocusedWeek[];
  preferences: Preferences;
  existingStudyBlocks: StudyBlock[];
  existingWeeklyPlans: WeeklyPlan[];
  preservedStudyBlockIds?: string[];
  preserveFlexibleFutureBlocks?: boolean;
  availabilityOverrideSubjectIds?: Subject["id"][];
}) {
  const startWeek = startOfPlannerWeek(options.startWeek ?? new Date());
  const referenceDate = options.referenceDate ?? new Date();
  const schedulingContext = createSchedulingRunContext();
  const horizonStartDate = referenceDate;
  const configuredEndWeek = clampPlanningHorizonEndWeek(
    options.endWeek
      ? startOfPlannerWeek(options.endWeek)
      : getPlanningHorizonEndWeek(options.goals, options.subjects, referenceDate),
    referenceDate,
  );
  const extraPreservedIds = new Set(options.preservedStudyBlockIds ?? []);
  const preservedLockedBlocks = options.existingStudyBlocks.filter(
    (block) =>
      shouldPreserveStudyBlockOnRegeneration(block, {
        preserveFlexibleFutureBlocks: options.preserveFlexibleFutureBlocks,
      }) || extraPreservedIds.has(block.id),
  );
  const subjectDeadlinesById = Object.fromEntries(
    options.subjects.map((subject) => [subject.id, subject.deadline]),
  );
  const existingWeeklyPlanByWeek = new Map(
    options.existingWeeklyPlans.map((weeklyPlan) => [weeklyPlan.weekStart, weeklyPlan]),
  );
  const existingStudyBlocksByWeek = options.existingStudyBlocks.reduce<Record<string, StudyBlock[]>>(
    (accumulator, block) => {
      const weekStartKey = block.weekStart || toDateKey(startOfPlannerWeek(new Date(block.start)));
      const current = accumulator[weekStartKey] ?? [];
      current.push(block);
      accumulator[weekStartKey] = current;
      return accumulator;
    },
    {},
  );
  const existingPrefixBlocks = options.existingStudyBlocks.filter(
    (block) =>
      toDateKey(startOfPlannerWeek(new Date(block.start))) < toDateKey(startWeek),
  );
  const countRemainingAllocatableTasks = (tasks: TaskCandidate[]) =>
    tasks.filter((task) => {
      if (!task.subjectId) {
        return task.remainingMinutes >= MIN_ALLOCATABLE_MINUTES;
      }

      if (
        zeroUnscheduledCoverageSubjectIds.includes(
          task.subjectId as (typeof zeroUnscheduledCoverageSubjectIds)[number],
        )
      ) {
        return task.remainingMinutes > 0;
      }

      return task.remainingMinutes >= MIN_ALLOCATABLE_MINUTES;
    }).length;
  const rebuiltWeeklyPlans: WeeklyPlan[] = [];
  const rebuiltStudyBlocks: StudyBlock[] = [];
  const rebuiltAccumulatedBlocks: StudyBlock[] = [...existingPrefixBlocks];
  const persistedAccumulatedBlocks: StudyBlock[] = [...existingPrefixBlocks];
  const changedWeekStarts = new Set<string>();
  const existingHorizonEndDate =
    options.existingWeeklyPlans.at(-1)?.horizonEndDate ?? toDateKey(configuredEndWeek);
  let effectiveEndWeek = configuredEndWeek;
  let extensionWeeksUsed = 0;
  let finalWeek = configuredEndWeek;

  for (
    let currentWeek = startWeek;
    currentWeek.getTime() <= effectiveEndWeek.getTime();
    currentWeek = addDays(currentWeek, 7)
  ) {
    finalWeek = currentWeek;
    const weekKey = toDateKey(currentWeek);
    const lockedBlocks = preservedLockedBlocks.filter((block) => {
      if (block.weekStart === weekKey) {
        return true;
      }

      return toDateKey(startOfPlannerWeek(new Date(block.start))) === weekKey;
    });
    const existingPlannedBlocks = [...rebuiltAccumulatedBlocks, ...lockedBlocks];
    const effectiveReservedCommitmentPlan = selectEffectiveReservedCommitmentPlanForWeek({
      currentWeek,
      endWeek: effectiveEndWeek,
      goals: options.goals,
      subjects: options.subjects,
      topics: options.topics,
      completionLogs: options.completionLogs,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays,
      focusedDays: options.focusedDays,
      focusedWeeks: options.focusedWeeks,
      preferences: options.preferences,
      existingPlannedBlocks,
      lockedBlocks,
      horizonStartDate,
      subjectDeadlinesById,
      availabilityOverrideSubjectIds: options.availabilityOverrideSubjectIds,
      schedulingContext,
    });
    const futureFocusedReserveMinutesBySubject = buildFutureFocusedReserveMinutesBySubject({
      currentWeek,
      endWeek: effectiveEndWeek,
      topics: options.topics,
      completionLogs: options.completionLogs,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays,
      focusedDays: options.focusedDays,
      focusedWeeks: options.focusedWeeks,
      preferences: options.preferences,
      subjectDeadlinesById,
      existingPlannedBlocks,
      horizonStartDate,
      availabilityOverrideSubjectIds: options.availabilityOverrideSubjectIds,
      getEffectiveReservedCommitmentPlanForWeek: (candidateWeek) =>
        selectEffectiveReservedCommitmentPlanForWeek({
          currentWeek: candidateWeek,
          endWeek: effectiveEndWeek,
          goals: options.goals,
          subjects: options.subjects,
          topics: options.topics,
          completionLogs: options.completionLogs,
          fixedEvents: options.fixedEvents,
          sickDays: options.sickDays,
          focusedDays: options.focusedDays,
          focusedWeeks: options.focusedWeeks,
          preferences: options.preferences,
          existingPlannedBlocks,
          horizonStartDate,
          subjectDeadlinesById,
          availabilityOverrideSubjectIds: options.availabilityOverrideSubjectIds,
          schedulingContext,
        }),
      schedulingContext,
    });
    const result = generateStudyPlanForWeek({
      weekStart: currentWeek,
      referenceDate,
      goals: options.goals,
      subjects: options.subjects,
      topics: options.topics,
      completionLogs: options.completionLogs,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays,
      focusedDays: options.focusedDays,
      focusedWeeks: options.focusedWeeks,
      preferences: options.preferences,
      lockedBlocks,
      existingPlannedBlocks,
      futureFocusedReserveMinutesBySubject,
      horizonStartDate,
      availabilityOverrideSubjectIds: options.availabilityOverrideSubjectIds,
      effectiveReservedCommitmentDurations:
        effectiveReservedCommitmentPlan.effectiveReservedCommitmentDurations,
      excludedReservedCommitmentRuleIds:
        effectiveReservedCommitmentPlan.excludedReservedCommitmentRuleIds,
      reservedCommitmentFallbackTierUsed:
        effectiveReservedCommitmentPlan.fallbackTierUsed,
      schedulingContext,
    });

    rebuiltWeeklyPlans.push(result.weeklyPlan);
    rebuiltStudyBlocks.push(...result.studyBlocks);
    rebuiltAccumulatedBlocks.push(...result.studyBlocks);

    const persistedWeekBlocks = [...(existingStudyBlocksByWeek[weekKey] ?? [])].sort(
      (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
    );
    persistedAccumulatedBlocks.push(...persistedWeekBlocks);

    const weekBlocksEqual = areStudyBlockListsEquivalent(result.studyBlocks, persistedWeekBlocks);
    const weekPlanEqual = areWeeklyPlansEquivalent(
      result.weeklyPlan,
      existingWeeklyPlanByWeek.get(weekKey),
    );
    const carryStateEqual =
      buildCarryForwardPlanningSignature(rebuiltAccumulatedBlocks) ===
      buildCarryForwardPlanningSignature(persistedAccumulatedBlocks);

    if (!weekBlocksEqual || !weekPlanEqual) {
      changedWeekStarts.add(weekKey);
    }

    const remainingTaskCount = countRemainingAllocatableTasks(result.unscheduledTasks);
    if (
      currentWeek.getTime() >= effectiveEndWeek.getTime() &&
      remainingTaskCount > 0 &&
      canExtendPlanningHorizon({
        effectiveEndWeek,
        referenceDate,
        extensionWeeksUsed,
      })
    ) {
      effectiveEndWeek = getExtendedPlanningHorizonEndWeek(effectiveEndWeek, referenceDate);
      extensionWeeksUsed += 1;
      continue;
    }

    if (weekBlocksEqual && weekPlanEqual && carryStateEqual) {
      break;
    }
  }

  const horizonEndDate =
    changedWeekStarts.size === 0 || finalWeek.getTime() < configuredEndWeek.getTime()
      ? existingHorizonEndDate
      : getHorizonEndDateKey(finalWeek, referenceDate);
  const changedWeekStartList = Array.from(changedWeekStarts).sort((left, right) =>
    left.localeCompare(right),
  );

  return {
    studyBlocks: rebuiltStudyBlocks
      .filter((block) => changedWeekStarts.has(block.weekStart))
      .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime()),
    weeklyPlans: rebuiltWeeklyPlans
      .filter((weeklyPlan) => changedWeekStarts.has(weeklyPlan.weekStart))
      .map((weeklyPlan) => ({
        ...weeklyPlan,
        horizonEndDate,
      })),
    changedWeekStarts: changedWeekStartList,
    horizonEndDate,
  };
}

export function getStudyPlanSummary(result: SchedulerResult) {
  return {
    assignedHours: formatHoursFromMinutes(
      result.studyBlocks.reduce((total, block) => total + block.estimatedMinutes, 0),
    ),
    unscheduledHours: formatHoursFromMinutes(
      result.unscheduledTasks.reduce((total, task) => total + task.remainingMinutes, 0),
    ),
  };
}
