import { addDays } from "date-fns";

import { toDateKey } from "@/lib/dates/helpers";
import { isCoreHlSyllabusTopic } from "@/lib/scheduler/school-term-template";
import type { StudyBlock, SubjectId, Topic } from "@/lib/types/planner";

export const CORE_HL_PACING_TARGET_DATE_KEY = "2026-10-24";

export interface CoreSyllabusPacingPlan {
  startDateKey: string;
  targetDateKey: string;
  capacityMinutesByDate: Record<string, number>;
  remainingCapacityMinutesByDate: Record<string, number>;
  totalMinutesBySubject: Record<string, number>;
  targetMinutesByDate: Record<string, Record<string, number>>;
}

export type CoreSyllabusAssignedMinutesByDate = Record<
  string,
  Record<string, number>
>;

export interface CoreSyllabusCreditLedger {
  assignedMinutesByDate: CoreSyllabusAssignedMinutesByDate;
  creditedMinutesByTopic: Record<string, number>;
}

export interface CorePacingCandidatePriority {
  id: string;
  pacingDeficitMinutes: number;
  lastSubjectStudyTimestamp: number | null;
  aheadOfPacePriorityTier: number;
  score: number;
}

function getCoreSyllabusTopicPacingMinutes(topic: Topic) {
  const remainingMinutes = Math.max(
    0,
    Math.round((topic.estHours - topic.completedHours) * 60),
  );

  return remainingMinutes > 0
    ? Math.ceil(remainingMinutes / 30) * 30
    : 0;
}

export function buildCoreSyllabusPacingPlan(options: {
  startDate: Date;
  topics: Topic[];
  capacityMinutesByDate: Record<string, number>;
  targetDateKey?: string;
}): CoreSyllabusPacingPlan {
  const startDateKey = toDateKey(options.startDate);
  const targetDateKey = options.targetDateKey ?? CORE_HL_PACING_TARGET_DATE_KEY;
  const totalMinutesBySubject: Record<string, number> = {};

  for (const topic of options.topics) {
    if (!isCoreHlSyllabusTopic(topic)) {
      continue;
    }

    const remainingMinutes = getCoreSyllabusTopicPacingMinutes(topic);
    totalMinutesBySubject[topic.subjectId] =
      (totalMinutesBySubject[topic.subjectId] ?? 0) + remainingMinutes;
  }

  const dateKeys: string[] = [];
  let currentDate = new Date(
    options.startDate.getFullYear(),
    options.startDate.getMonth(),
    options.startDate.getDate(),
  );

  while (toDateKey(currentDate) <= targetDateKey) {
    dateKeys.push(toDateKey(currentDate));
    currentDate = addDays(currentDate, 1);
  }

  const totalCapacity = dateKeys.reduce(
    (total, dateKey) => total + Math.max(0, options.capacityMinutesByDate[dateKey] ?? 0),
    0,
  );
  const remainingCapacityMinutesByDate: Record<string, number> = {};
  let remainingCapacity = 0;
  for (let index = dateKeys.length - 1; index >= 0; index -= 1) {
    const dateKey = dateKeys[index];
    remainingCapacity += Math.max(0, options.capacityMinutesByDate[dateKey] ?? 0);
    remainingCapacityMinutesByDate[dateKey] = remainingCapacity;
  }
  const targetMinutesByDate: Record<string, Record<string, number>> = {};
  let cumulativeCapacity = 0;
  const previousTargetBySubject: Record<string, number> = {};

  for (const dateKey of dateKeys) {
    const capacity = Math.max(0, options.capacityMinutesByDate[dateKey] ?? 0);
    cumulativeCapacity += capacity;
    const targetBySubject: Record<string, number> = {};

    for (const [subjectId, totalMinutes] of Object.entries(totalMinutesBySubject)) {
      const previousTarget = previousTargetBySubject[subjectId] ?? 0;
      let targetMinutes = previousTarget;

      if (capacity > 0) {
        const cumulativeShare = totalCapacity > 0 ? cumulativeCapacity / totalCapacity : 1;
        const roundedTarget = Math.min(
          totalMinutes,
          Math.round((totalMinutes * cumulativeShare) / 15) * 15,
        );
        targetMinutes = roundedTarget;
      }

      if (dateKey === targetDateKey) {
        targetMinutes = totalMinutes;
      }

      targetBySubject[subjectId] = targetMinutes;
      previousTargetBySubject[subjectId] = targetMinutes;
    }

    targetMinutesByDate[dateKey] = targetBySubject;
  }

  return {
    startDateKey,
    targetDateKey,
    capacityMinutesByDate: { ...options.capacityMinutesByDate },
    remainingCapacityMinutesByDate,
    totalMinutesBySubject,
    targetMinutesByDate,
  };
}

export function getCoreSyllabusPacingTargetMinutes(
  plan: CoreSyllabusPacingPlan | null | undefined,
  subjectId: SubjectId,
  dateKey: string,
): number {
  return plan?.targetMinutesByDate[dateKey]?.[subjectId] ?? 0;
}

export function getCoreSyllabusPacingDeficitMinutes(
  plan: CoreSyllabusPacingPlan | null | undefined,
  subjectId: SubjectId,
  dateKey: string,
  assignedMinutes: number,
): number {
  return Math.max(
    0,
    getCoreSyllabusPacingTargetMinutes(plan, subjectId, dateKey) - assignedMinutes,
  );
}

export function buildCoreSyllabusCreditLedger(options: {
  plan: CoreSyllabusPacingPlan;
  topics: Topic[];
  blocks: StudyBlock[];
}): CoreSyllabusCreditLedger {
  const topicById = new Map(options.topics.map((topic) => [topic.id, topic]));
  const uniqueBlocks = Array.from(
    new Map(options.blocks.map((block) => [block.id, block])).values(),
  ).sort(
    (left, right) =>
      new Date(left.start).getTime() - new Date(right.start).getTime() ||
      left.id.localeCompare(right.id),
  );
  const assignedMinutesByDate: CoreSyllabusAssignedMinutesByDate = {};
  const creditedMinutesByTopic: Record<string, number> = {};

  for (const block of uniqueBlocks) {
    if (
      block.date < options.plan.startDateKey ||
      (block.status !== "planned" && block.status !== "rescheduled")
    ) {
      continue;
    }

    const topic = block.topicId ? topicById.get(block.topicId) : null;
    if (!topic || !isCoreHlSyllabusTopic(topic)) {
      continue;
    }

    const topicRemainingMinutes = getCoreSyllabusTopicPacingMinutes(topic);
    const creditedMinutes = Math.min(
      block.estimatedMinutes,
      Math.max(
        0,
        topicRemainingMinutes - (creditedMinutesByTopic[topic.id] ?? 0),
      ),
    );
    if (creditedMinutes <= 0) {
      continue;
    }

    assignedMinutesByDate[block.date] = {
      ...(assignedMinutesByDate[block.date] ?? {}),
      [topic.subjectId]:
        (assignedMinutesByDate[block.date]?.[topic.subjectId] ?? 0) +
        creditedMinutes,
    };
    creditedMinutesByTopic[topic.id] =
      (creditedMinutesByTopic[topic.id] ?? 0) + creditedMinutes;
  }

  return { assignedMinutesByDate, creditedMinutesByTopic };
}

export function buildCoreSyllabusAssignedMinutesByDate(options: {
  plan: CoreSyllabusPacingPlan;
  topics: Topic[];
  blocks: StudyBlock[];
}): CoreSyllabusAssignedMinutesByDate {
  return buildCoreSyllabusCreditLedger(options).assignedMinutesByDate;
}

export function getCumulativeCoreSyllabusAssignedMinutes(
  assignedMinutesByDate: CoreSyllabusAssignedMinutesByDate,
  subjectId: SubjectId,
  dateKey: string,
): number {
  return Object.entries(assignedMinutesByDate).reduce(
    (total, [assignedDateKey, assignedMinutesBySubject]) =>
      assignedDateKey <= dateKey
        ? total + (assignedMinutesBySubject[subjectId] ?? 0)
        : total,
    0,
  );
}

export function getAheadOfPaceCandidatePriorityTier(options: {
  isRealOlympiadOrCpp: boolean;
  isCoreSyllabus: boolean;
}): number {
  if (options.isRealOlympiadOrCpp) {
    return 0;
  }

  return options.isCoreSyllabus ? 2 : 1;
}

export function compareCorePacingCandidatePriority(
  left: CorePacingCandidatePriority,
  right: CorePacingCandidatePriority,
): number {
  const leftIsUnderPace = left.pacingDeficitMinutes > 0;
  const rightIsUnderPace = right.pacingDeficitMinutes > 0;

  if (leftIsUnderPace !== rightIsUnderPace) {
    return leftIsUnderPace ? -1 : 1;
  }

  if (leftIsUnderPace && rightIsUnderPace) {
    const deficitGap = right.pacingDeficitMinutes - left.pacingDeficitMinutes;
    if (deficitGap !== 0) {
      return deficitGap;
    }

    const recentStudyGap =
      (left.lastSubjectStudyTimestamp ?? Number.NEGATIVE_INFINITY) -
      (right.lastSubjectStudyTimestamp ?? Number.NEGATIVE_INFINITY);
    if (recentStudyGap !== 0) {
      return recentStudyGap;
    }
  }

  const tierGap = left.aheadOfPacePriorityTier - right.aheadOfPacePriorityTier;
  if (tierGap !== 0) {
    return tierGap;
  }

  const scoreGap = right.score - left.score;
  return scoreGap !== 0 ? scoreGap : left.id.localeCompare(right.id);
}
