import { differenceInCalendarDays, min as minDate } from "date-fns";

import { mainSubjectIds, subjectIds } from "@/lib/constants/planner";
import {
  endOfPlannerWeek,
  getAcademicDeadline,
  hoursFromMinutes,
  toDateKey,
} from "@/lib/dates/helpers";
import { clamp, roundToTenth, sum } from "@/lib/utils";
import type {
  CalendarSlot,
  Goal,
  RiskFlag,
  StudyBlock,
  Subject,
  Topic,
  WeeklyPlan,
} from "@/lib/types/planner";

function computePlannedMinutesByTopic(studyBlocks: StudyBlock[] = []) {
  return studyBlocks.reduce<Record<string, number>>((accumulator, block) => {
    if (!block.topicId || !["planned", "rescheduled"].includes(block.status)) {
      return accumulator;
    }

    accumulator[block.topicId] = (accumulator[block.topicId] ?? 0) + block.estimatedMinutes;
    return accumulator;
  }, {});
}

export function computeRemainingHoursBySubject(topics: Topic[]) {
  return topics.reduce<Record<string, number>>((accumulator, topic) => {
    const remaining = Math.max(topic.estHours - topic.completedHours, 0);
    accumulator[topic.subjectId] = (accumulator[topic.subjectId] ?? 0) + remaining;
    return accumulator;
  }, {});
}

function computeTopicHoursBySubject(topics: Topic[]) {
  return topics.reduce<Record<string, { total: number; completed: number }>>((accumulator, topic) => {
    const current = accumulator[topic.subjectId] ?? { total: 0, completed: 0 };
    current.total += topic.estHours;
    current.completed += Math.min(topic.completedHours, topic.estHours);
    accumulator[topic.subjectId] = current;
    return accumulator;
  }, {});
}

function getSubjectGoal(subject: Subject, goals: Goal[], completionRatio: number) {
  const subjectGoals = goals
    .filter((candidate) => candidate.subjectId === subject.id)
    .sort((left, right) => new Date(left.deadline).getTime() - new Date(right.deadline).getTime());

  return (
    subjectGoals.find((goal) => goal.targetCompletion > completionRatio + 0.001) ??
    subjectGoals[subjectGoals.length - 1]
  );
}

function computeScheduledHoursBySubjectToGoal(options: {
  subjects: Subject[];
  goals: Goal[];
  topics: Topic[];
  plannedMinutesByTopic: Record<string, number>;
}) {
  const topicHoursBySubject = computeTopicHoursBySubject(options.topics);

  return options.subjects.reduce<Record<string, number>>((accumulator, subject) => {
    const subjectTopics = options.topics.filter((topic) => topic.subjectId === subject.id);
    const progress = topicHoursBySubject[subject.id] ?? { total: 0, completed: 0 };
    const completionRatio = progress.total > 0 ? progress.completed / progress.total : 1;
    const activeGoal = getSubjectGoal(subject, options.goals, completionRatio);
    const targetHours = progress.total * (activeGoal?.targetCompletion ?? 1);
    const plannedTowardTargetHours = subjectTopics.reduce((total, topic) => {
      const plannedHours = (options.plannedMinutesByTopic[topic.id] ?? 0) / 60;
      const cappedPlannedHours = Math.min(
        plannedHours,
        Math.max(topic.estHours - topic.completedHours, 0),
      );
      return total + cappedPlannedHours;
    }, 0);

    accumulator[subject.id] = roundToTenth(
      Math.min(targetHours, progress.completed + plannedTowardTargetHours),
    );
    return accumulator;
  }, {});
}

export function computeSubjectDeadlineTracks(options: {
  subjects: Subject[];
  goals: Goal[];
  topics: Topic[];
  referenceDate: Date;
  horizonStartDate?: Date;
  weekStartDate?: Date;
  weekEndDate?: Date;
  priorPlannedBlocks?: StudyBlock[];
}) {
  const remainingHoursBySubject = computeRemainingHoursBySubject(options.topics);
  const topicHoursBySubject = computeTopicHoursBySubject(options.topics);
  const plannedMinutesByTopic = computePlannedMinutesByTopic(options.priorPlannedBlocks);
  const horizonStartDate = options.horizonStartDate ?? options.referenceDate;
  const weekStartDate = options.weekStartDate ?? options.referenceDate;
  const weekEndDate = options.weekEndDate ?? endOfPlannerWeek(options.referenceDate);

  return options.subjects.reduce<
    Record<
      string,
      {
        remainingHours: number;
        targetRemainingHours: number;
        targetHours: number;
        scheduledToGoalHours: number;
        uncoveredGoalHours: number;
        cumulativeTargetHoursByWeekEnd: number;
        weeksRemaining: number;
        deadline: string;
        baselineWeeklyHours: number;
        recommendedWeeklyHours: number;
      }
    >
  >((accumulator, subject) => {
    const remainingHours = roundToTenth(remainingHoursBySubject[subject.id] ?? 0);
    const subjectTopics = options.topics.filter((topic) => topic.subjectId === subject.id);
    const progress = topicHoursBySubject[subject.id] ?? { total: 0, completed: 0 };
    const completionRatio = progress.total > 0 ? progress.completed / progress.total : 1;
    const activeGoal = getSubjectGoal(subject, options.goals, completionRatio);
    const deadline = new Date(activeGoal?.deadline ?? subject.deadline);
    const daysRemaining = Math.max(differenceInCalendarDays(deadline, options.referenceDate), 7);
    const weeksRemaining = Math.max(Math.ceil(daysRemaining / 7), 1);
    const targetHours = progress.total * (activeGoal?.targetCompletion ?? 1);
    const plannedTowardTargetHours = subjectTopics.reduce((total, topic) => {
      const plannedHours = (plannedMinutesByTopic[topic.id] ?? 0) / 60;
      const cappedPlannedHours = Math.min(
        plannedHours,
        Math.max(topic.estHours - topic.completedHours, 0),
      );
      return total + cappedPlannedHours;
    }, 0);
    const totalRemainingTargetHours = Math.max(targetHours - progress.completed, 0);
    const scheduledToGoalHours = Math.min(targetHours, progress.completed + plannedTowardTargetHours);
    const targetRemainingHours = roundToTenth(Math.max(targetHours - scheduledToGoalHours, 0));
    const totalPlanningDays = Math.max(differenceInCalendarDays(deadline, horizonStartDate) + 1, 1);
    const cumulativeWindowEnd = minDate([deadline, weekEndDate]);
    const effectiveWeekStart =
      weekStartDate > horizonStartDate ? weekStartDate : horizonStartDate;
    const coveredPlanningDays =
      cumulativeWindowEnd < horizonStartDate
        ? 0
        : clamp(
            differenceInCalendarDays(cumulativeWindowEnd, horizonStartDate) + 1,
            0,
            totalPlanningDays,
          );
    const remainingPlanningDaysFromWeek =
      deadline < effectiveWeekStart
        ? 0
        : Math.max(differenceInCalendarDays(deadline, effectiveWeekStart) + 1, 1);
    const weekPlanningDays =
      cumulativeWindowEnd < effectiveWeekStart
        ? 0
        : Math.max(differenceInCalendarDays(cumulativeWindowEnd, effectiveWeekStart) + 1, 0);
    const cumulativeTargetHoursByWeekEnd =
      totalRemainingTargetHours > 0
        ? roundToTenth((totalRemainingTargetHours * coveredPlanningDays) / totalPlanningDays)
        : 0;
    const baselineWeeklyHours =
      totalRemainingTargetHours > 0 ? totalRemainingTargetHours / weeksRemaining : 0;
    const hasExplicitGoal = Boolean(activeGoal);
    const minimumGuidanceHours =
      hasExplicitGoal && subject.examMode !== "maintenance" ? 0 : subject.weeklyMinimumHours;
    const cumulativeGapHours = Math.max(cumulativeTargetHoursByWeekEnd - plannedTowardTargetHours, 0);
    const evenWeekShareHours =
      targetRemainingHours > 0 && remainingPlanningDaysFromWeek > 0
        ? roundToTenth((targetRemainingHours * weekPlanningDays) / remainingPlanningDaysFromWeek)
        : 0;
    const recommendedWeeklyHours =
      totalRemainingTargetHours <= 0
        ? 0
        : Math.min(
            targetRemainingHours,
            Math.max(
              evenWeekShareHours,
              cumulativeGapHours,
              minimumGuidanceHours > 0
                ? Math.min(minimumGuidanceHours, targetRemainingHours)
                : 0,
            ),
          );

    accumulator[subject.id] = {
      remainingHours,
      targetRemainingHours,
      targetHours: roundToTenth(targetHours),
      scheduledToGoalHours: roundToTenth(scheduledToGoalHours),
      uncoveredGoalHours: roundToTenth(Math.max(targetHours - scheduledToGoalHours, 0)),
      cumulativeTargetHoursByWeekEnd,
      weeksRemaining,
      deadline: toDateKey(deadline),
      baselineWeeklyHours: roundToTenth(baselineWeeklyHours),
      recommendedWeeklyHours: roundToTenth(recommendedWeeklyHours),
    };
    return accumulator;
  }, {});
}

export function computeWeeklyRequiredHours(options: {
  subjects: Subject[];
  goals: Goal[];
  topics: Topic[];
  referenceDate: Date;
  horizonStartDate?: Date;
  weekEndDate?: Date;
  priorPlannedBlocks?: StudyBlock[];
}) {
  const deadlineTracks = computeSubjectDeadlineTracks(options);

  return options.subjects.reduce<Record<string, number>>((accumulator, subject) => {
    accumulator[subject.id] = deadlineTracks[subject.id]?.recommendedWeeklyHours ?? 0;
    return accumulator;
  }, {});
}

export function buildWeeklyPlan(options: {
  weekStart: string;
  subjects: Subject[];
  studyBlocks: StudyBlock[];
  topics: Topic[];
  goals: Goal[];
  freeSlots: CalendarSlot[];
  referenceDate: Date;
  horizonStartDate?: Date;
  requiredHoursBySubject?: Record<string, number>;
  deadlinePaceHoursBySubject?: Record<string, number>;
  forcedCoverageMinutes?: number;
  usedSundayMinutes?: number;
  unscheduledTasks?: Array<{ subjectId: string | null; remainingMinutes: number }>;
  priorPlannedBlocks?: StudyBlock[];
  cumulativePlannedBlocks?: StudyBlock[];
}) {
  const emptyBySubject = subjectIds.reduce<Record<string, number>>((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {});
  const weekEndDate = endOfPlannerWeek(new Date(`${options.weekStart}T00:00:00`));
  const deadlineTracks = computeSubjectDeadlineTracks({
    subjects: options.subjects,
    goals: options.goals,
    topics: options.topics,
    referenceDate: options.referenceDate,
    horizonStartDate: options.horizonStartDate,
    weekStartDate: new Date(`${options.weekStart}T00:00:00`),
    weekEndDate,
    priorPlannedBlocks: options.cumulativePlannedBlocks ?? options.priorPlannedBlocks,
  });
  const requiredHoursBySubject = {
    ...emptyBySubject,
    ...(options.requiredHoursBySubject ??
      Object.fromEntries(
        options.subjects.map((subject) => [
          subject.id,
          deadlineTracks[subject.id]?.recommendedWeeklyHours ?? 0,
        ]),
      )),
  };
  const deadlinePaceHoursBySubject = {
    ...emptyBySubject,
    ...(options.deadlinePaceHoursBySubject ??
      Object.fromEntries(
        options.subjects.map((subject) => [
          subject.id,
          deadlineTracks[subject.id]?.baselineWeeklyHours ?? 0,
        ]),
      )),
  };
  const remainingHoursBySubject = Object.fromEntries(
    options.subjects.map((subject) => [
      subject.id,
      deadlineTracks[subject.id]?.remainingHours ?? 0,
    ]),
  );
  const scheduledToGoalHoursBySubject = {
    ...emptyBySubject,
    ...Object.fromEntries(
      options.subjects.map((subject) => [
        subject.id,
        deadlineTracks[subject.id]?.scheduledToGoalHours ?? 0,
      ]),
    ),
  };
  const horizonEndDate = toDateKey(getAcademicDeadline(options.referenceDate));
  const weeksRemainingToDeadline = Math.max(
    Math.ceil(differenceInCalendarDays(getAcademicDeadline(options.referenceDate), options.referenceDate) / 7),
    1,
  );

  const assignedMinutesBySubject = subjectIds.reduce<Record<string, number>>((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {});

  const completedMinutesBySubject = subjectIds.reduce<Record<string, number>>((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {});

  options.studyBlocks.forEach((block) => {
    if (!block.subjectId) {
      return;
    }

    assignedMinutesBySubject[block.subjectId] += block.estimatedMinutes;

    if (block.status === "done" || block.status === "partial") {
      completedMinutesBySubject[block.subjectId] += block.actualMinutes ?? block.estimatedMinutes;
    }
  });

  const studyCapacityMinutes = Math.round(
    sum(options.freeSlots.map((slot) => slot.durationMinutes)),
  );
  const assignedMinutes = sum(Object.values(assignedMinutesBySubject));
  const requiredMinutes = sum(Object.values(requiredHoursBySubject).map((hours) => hours * 60));
  const slackMinutes = Math.max(studyCapacityMinutes - assignedMinutes, 0);
  const assignedStudyMinutesByDay = options.studyBlocks.reduce<Record<string, number>>((accumulator, block) => {
    if (!block.subjectId) {
      return accumulator;
    }

    accumulator[block.date] = (accumulator[block.date] ?? 0) + block.estimatedMinutes;
    return accumulator;
  }, {});
  const baseDayCapByDate = options.freeSlots.reduce<Record<string, number>>((accumulator, slot) => {
    accumulator[slot.dateKey] = Math.max(accumulator[slot.dateKey] ?? 0, slot.dayStudyCapMinutes);
    return accumulator;
  }, {});
  const overloadMinutes = Object.entries(assignedStudyMinutesByDay).reduce((total, [dateKey, minutes]) => {
    return total + Math.max(0, minutes - (baseDayCapByDate[dateKey] ?? 0));
  }, 0);
  const usedSundayMinutes =
    options.usedSundayMinutes ??
    options.studyBlocks
      .filter((block) => block.subjectId && new Date(block.start).getDay() === 0)
      .reduce((total, block) => total + block.estimatedMinutes, 0);
  const unscheduledMinutesBySubject = (options.unscheduledTasks ?? []).reduce<Record<string, number>>(
    (accumulator, task) => {
      if (!task.subjectId) {
        return accumulator;
      }

      accumulator[task.subjectId] = (accumulator[task.subjectId] ?? 0) + task.remainingMinutes;
      return accumulator;
    },
    {},
  );

  const warnings: string[] = [];
  const underplannedSubjectIds: string[] = [];
  const coverageGapHoursBySubject = { ...emptyBySubject };

  if (requiredMinutes > studyCapacityMinutes) {
    warnings.push(
      `Required weekly hours exceed realistic free-slot capacity by ${hoursFromMinutes(requiredMinutes - studyCapacityMinutes).toFixed(1)}h.`,
    );
  }

  mainSubjectIds.forEach((subjectId) => {
    const subjectAssigned = assignedMinutesBySubject[subjectId] ?? 0;
    const subjectRequired = (requiredHoursBySubject[subjectId] ?? 0) * 60;
    const deficit = subjectRequired - subjectAssigned;
    coverageGapHoursBySubject[subjectId] = roundToTenth(Math.max(deficit, 0) / 60);

    if (deficit > 60) {
      underplannedSubjectIds.push(subjectId);
      const subject = options.subjects.find((candidate) => candidate.id === subjectId);
      warnings.push(
        `${subject?.name ?? subjectId} is short by ${hoursFromMinutes(deficit).toFixed(1)}h this week.`,
      );
    }

    if ((unscheduledMinutesBySubject[subjectId] ?? 0) > 0 && deficit > 0) {
      const subject = options.subjects.find((candidate) => candidate.id === subjectId);
      warnings.push(
        `${subject?.name ?? subjectId} still has ${hoursFromMinutes(unscheduledMinutesBySubject[subjectId] ?? 0).toFixed(1)}h unscheduled after this week's caps and constraints.`,
      );
    }
  });

  const coverageComplete = underplannedSubjectIds.length === 0;
  const forcedCoverageMinutes = options.forcedCoverageMinutes ?? 0;

  if (!coverageComplete && slackMinutes === 0 && overloadMinutes > 0) {
    warnings.push(
      "Calendar constraints are exhausted for this week. Remaining coverage will only finish if later weeks absorb the deficit.",
    );
  }

  let riskFlag: RiskFlag = "low";
  if (
    warnings.length >= 3 ||
    requiredMinutes > studyCapacityMinutes * 1.1 ||
    underplannedSubjectIds.length >= 2
  ) {
    riskFlag = "high";
  } else if (warnings.length > 0 || requiredMinutes > studyCapacityMinutes * 0.95) {
    riskFlag = "medium";
  }

  const feasibilityScore = Math.max(
    20,
    Math.round(
      100 -
        Math.max(0, requiredMinutes - assignedMinutes) / 20 -
        Math.max(0, requiredMinutes - studyCapacityMinutes) / 15,
    ),
  );

  return {
    weekStart: options.weekStart,
    requiredHoursBySubject,
    deadlinePaceHoursBySubject,
    assignedHoursBySubject: Object.fromEntries(
      Object.entries(assignedMinutesBySubject).map(([key, value]) => [key, roundToTenth(value / 60)]),
    ),
    completedHoursBySubject: Object.fromEntries(
      Object.entries(completedMinutesBySubject).map(([key, value]) => [key, roundToTenth(value / 60)]),
    ),
    remainingHoursBySubject,
    underplannedSubjectIds,
    slackMinutes,
    carryOverBlockIds: options.studyBlocks
      .filter((block) => block.status === "missed" || block.status === "rescheduled")
      .map((block) => block.id),
    feasibilityScore,
    riskFlag,
    feasibilityWarnings: warnings,
    coverageGapHoursBySubject,
    scheduledToGoalHoursBySubject,
    forcedCoverageMinutes,
    usedSundayMinutes,
    overloadMinutes,
    coverageComplete,
    weeksRemainingToDeadline,
    horizonEndDate,
    generatedAt: new Date().toISOString(),
  } satisfies WeeklyPlan;
}

export function buildUnconfiguredWeeklyPlan(options: {
  weekStart: string;
  subjects: Subject[];
  studyBlocks: StudyBlock[];
  topics: Topic[];
  goals: Goal[];
  referenceDate: Date;
}) {
  const requiredHoursBySubject = computeWeeklyRequiredHours({
    subjects: options.subjects,
    goals: options.goals,
    topics: options.topics,
    referenceDate: options.referenceDate,
  });
  const deadlineTracks = computeSubjectDeadlineTracks({
    subjects: options.subjects,
    goals: options.goals,
    topics: options.topics,
    referenceDate: options.referenceDate,
  });

  const assignedHoursBySubject = subjectIds.reduce<Record<string, number>>((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {});

  const completedHoursBySubject = subjectIds.reduce<Record<string, number>>((accumulator, key) => {
    accumulator[key] = 0;
    return accumulator;
  }, {});

  options.studyBlocks.forEach((block) => {
    if (!block.subjectId) {
      return;
    }

    assignedHoursBySubject[block.subjectId] += roundToTenth(block.estimatedMinutes / 60);

    if (block.status === "done" || block.status === "partial") {
      completedHoursBySubject[block.subjectId] += roundToTenth(
        (block.actualMinutes ?? block.estimatedMinutes) / 60,
      );
    }
  });

  return {
    weekStart: options.weekStart,
    requiredHoursBySubject,
    deadlinePaceHoursBySubject: Object.fromEntries(
      subjectIds.map((subjectId) => [subjectId, deadlineTracks[subjectId]?.baselineWeeklyHours ?? 0]),
    ),
    assignedHoursBySubject,
    completedHoursBySubject,
    remainingHoursBySubject: Object.fromEntries(
      subjectIds.map((subjectId) => [subjectId, deadlineTracks[subjectId]?.remainingHours ?? 0]),
    ),
    coverageGapHoursBySubject: Object.fromEntries(
      subjectIds.map((subjectId) => [subjectId, requiredHoursBySubject[subjectId] ?? 0]),
    ),
    scheduledToGoalHoursBySubject: computeScheduledHoursBySubjectToGoal({
      subjects: options.subjects,
      goals: options.goals,
      topics: options.topics,
      plannedMinutesByTopic: {},
    }),
    underplannedSubjectIds: mainSubjectIds.filter(
      (subjectId) => (requiredHoursBySubject[subjectId] ?? 0) > 0,
    ),
    slackMinutes: 0,
    carryOverBlockIds: options.studyBlocks
      .filter((block) => block.status === "missed" || block.status === "rescheduled")
      .map((block) => block.id),
    feasibilityScore: 35,
    riskFlag: "medium" as const,
    feasibilityWarnings: [
      "Add your fixed commitments first. The planner will not assume your personal timetable.",
    ],
    forcedCoverageMinutes: 0,
    usedSundayMinutes: 0,
    overloadMinutes: 0,
    coverageComplete: false,
    weeksRemainingToDeadline: Math.max(
      Math.ceil(differenceInCalendarDays(getAcademicDeadline(options.referenceDate), options.referenceDate) / 7),
      1,
    ),
    horizonEndDate: toDateKey(getAcademicDeadline(options.referenceDate)),
    generatedAt: new Date().toISOString(),
  } satisfies WeeklyPlan;
}

export function projectSubjectCompletion(options: {
  subject: Subject;
  weeklyPlan?: WeeklyPlan;
  topics: Topic[];
  referenceDate: Date;
}) {
  const remainingHours = options.topics
    .filter((topic) => topic.subjectId === options.subject.id)
    .reduce((total, topic) => total + Math.max(topic.estHours - topic.completedHours, 0), 0);
  const assignedPerWeek = Math.max(
    options.weeklyPlan?.assignedHoursBySubject[options.subject.id] ??
      options.weeklyPlan?.requiredHoursBySubject[options.subject.id] ??
      options.subject.weeklyMinimumHours,
    0.5,
  );
  const weeksNeeded = remainingHours / assignedPerWeek;

  return {
    remainingHours: roundToTenth(remainingHours),
    weeksNeeded: roundToTenth(weeksNeeded),
    projectedDate: new Date(
      options.referenceDate.getTime() + Math.ceil(weeksNeeded * 7) * 24 * 60 * 60 * 1000,
    ),
  };
}
