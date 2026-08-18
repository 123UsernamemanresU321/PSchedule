import { addDays } from "date-fns";

import { toDateKey } from "@/lib/dates/helpers";
import { isCoreHlSyllabusTopic } from "@/lib/scheduler/school-term-template";
import type { SubjectId, Topic } from "@/lib/types/planner";

export const CORE_HL_PACING_TARGET_DATE_KEY = "2026-10-24";

export interface CoreSyllabusPacingPlan {
  startDateKey: string;
  targetDateKey: string;
  capacityMinutesByDate: Record<string, number>;
  totalMinutesBySubject: Record<string, number>;
  targetMinutesByDate: Record<string, Record<string, number>>;
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

    const remainingMinutes = Math.max(
      0,
      Math.round((topic.estHours - topic.completedHours) * 60),
    );
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
