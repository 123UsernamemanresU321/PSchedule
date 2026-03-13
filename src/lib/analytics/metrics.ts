import { differenceInCalendarDays, isSameDay } from "date-fns";

import { mainSubjectIds } from "@/lib/constants/planner";
import {
  formatWeekRangeLabel,
  fromDateKey,
  hoursFromMinutes,
  startOfPlannerWeek,
  toDateKey,
} from "@/lib/dates/helpers";
import type {
  Goal,
  HorizonRoadmapSummary,
  StudyBlock,
  Subject,
  Topic,
  WeeklyPlan,
} from "@/lib/types/planner";
import { clamp } from "@/lib/utils";

export function getWeeklyPlan(weeklyPlans: WeeklyPlan[], weekStart: string) {
  return weeklyPlans.find((plan) => plan.weekStart === weekStart);
}

export function getWeekBlocks(studyBlocks: StudyBlock[], weekStart: string) {
  return studyBlocks
    .filter((block) => block.weekStart === weekStart)
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
}

export function getTodayBlocks(studyBlocks: StudyBlock[], referenceDate = new Date()) {
  return studyBlocks
    .filter((block) => isSameDay(new Date(block.start), referenceDate))
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
}

export function getSubjectProgress(subject: Subject, topics: Topic[]) {
  const subjectTopics = topics.filter((topic) => topic.subjectId === subject.id);
  const units = new Set(subjectTopics.map((topic) => topic.unitId));
  const completedUnits = new Set(
    subjectTopics
      .filter((topic) => topic.completedHours >= topic.estHours)
      .map((topic) => topic.unitId),
  );
  const totalHours = subjectTopics.reduce((total, topic) => total + topic.estHours, 0);
  const completedHours = subjectTopics.reduce(
    (total, topic) => total + Math.min(topic.completedHours, topic.estHours),
    0,
  );
  const remainingHours = subjectTopics.reduce(
    (total, topic) => total + Math.max(topic.estHours - topic.completedHours, 0),
    0,
  );
  const atRiskTopics = subjectTopics.filter(
    (topic) => topic.mastery <= 2 || topic.status === "not_started",
  );

  return {
    subject,
    topics: subjectTopics,
    completionPercent: totalHours ? Math.round((completedHours / totalHours) * 100) : 0,
    remainingHours: Number(remainingHours.toFixed(1)),
    totalHours: Number(totalHours.toFixed(1)),
    unitCount: units.size,
    completedUnits: completedUnits.size,
    atRiskTopics,
  };
}

export function getUrgentTopics(topics: Topic[], subjects: Subject[]) {
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));

  return topics
    .map((topic) => {
      const subject = subjectMap.get(topic.subjectId);
      const daysUntilReview = topic.reviewDue
        ? differenceInCalendarDays(new Date(topic.reviewDue), new Date())
        : 21;
      const riskScore =
        (subject?.defaultPriority ?? 0.5) * 15 +
        Math.max(0, 8 - daysUntilReview) * 4 +
        Math.max(0, 5 - topic.mastery) * 3 +
        Math.max(0, topic.estHours - topic.completedHours) * 1.2;

      return {
        topic,
        subject,
        riskScore,
      };
    })
    .sort((left, right) => right.riskScore - left.riskScore)
    .slice(0, 6);
}

export function countTrackStatus(weeklyPlan: WeeklyPlan | undefined) {
  if (!weeklyPlan) {
    return {
      onTrack: 0,
      atRisk: 0,
      behind: 0,
    };
  }

  return mainSubjectIds.reduce(
    (accumulator, subjectId) => {
      const required = weeklyPlan.requiredHoursBySubject[subjectId] ?? 0;
      const gap = weeklyPlan.coverageGapHoursBySubject[subjectId] ?? 0;
      const ratio = required > 0 ? Math.max(0, 1 - gap / Math.max(required, 0.25)) : 1;

      if (gap <= 0.1 || ratio >= 0.95) {
        accumulator.onTrack += 1;
      } else if (ratio >= 0.8) {
        accumulator.atRisk += 1;
      } else {
        accumulator.behind += 1;
      }

      return accumulator;
    },
    {
      onTrack: 0,
      atRisk: 0,
      behind: 0,
    },
  );
}

export function getWeeklyCoverageState(weeklyPlan: WeeklyPlan | undefined) {
  if (!weeklyPlan) {
    return { label: "On target", tone: "success" as const };
  }

  if (!weeklyPlan.coverageComplete && weeklyPlan.slackMinutes === 0) {
    return { label: "Calendar-impossible", tone: "danger" as const };
  }

  if (weeklyPlan.coverageComplete && weeklyPlan.overloadMinutes > 0) {
    return { label: "Overloaded but covered", tone: "warning" as const };
  }

  if (!weeklyPlan.coverageComplete || weeklyPlan.forcedCoverageMinutes > 0) {
    return { label: "Catch-up", tone: "warning" as const };
  }

  return { label: "On target", tone: "success" as const };
}

export function getCarryOverBlocks(studyBlocks: StudyBlock[]) {
  return studyBlocks.filter((block) => block.status === "missed" || block.status === "rescheduled");
}

export function getPlannedMinutesForDay(studyBlocks: StudyBlock[], referenceDate = new Date()) {
  return getTodayBlocks(studyBlocks, referenceDate).reduce(
    (total, block) => total + block.estimatedMinutes,
    0,
  );
}

export function getCompletedMinutesForDay(studyBlocks: StudyBlock[], referenceDate = new Date()) {
  return getTodayBlocks(studyBlocks, referenceDate)
    .filter((block) => block.status === "done" || block.status === "partial")
    .reduce((total, block) => total + (block.actualMinutes ?? block.estimatedMinutes), 0);
}

export function getDashboardMetrics(studyBlocks: StudyBlock[], weeklyPlan: WeeklyPlan | undefined) {
  const plannedTodayMinutes = getPlannedMinutesForDay(studyBlocks);
  const completedTodayMinutes = getCompletedMinutesForDay(studyBlocks);
  const plannedWeekMinutes = weeklyPlan
    ? Object.values(weeklyPlan.assignedHoursBySubject).reduce((total, value) => total + value * 60, 0)
    : 0;
  const completedWeekMinutes = weeklyPlan
    ? Object.values(weeklyPlan.completedHoursBySubject).reduce((total, value) => total + value * 60, 0)
    : 0;

  return {
    plannedTodayHours: hoursFromMinutes(plannedTodayMinutes),
    completedTodayHours: hoursFromMinutes(completedTodayMinutes),
    weeklyProgressPercent:
      plannedWeekMinutes > 0 ? Math.round((completedWeekMinutes / plannedWeekMinutes) * 100) : 0,
    weeklyPlannedHours: hoursFromMinutes(plannedWeekMinutes),
    weeklyCompletedHours: hoursFromMinutes(completedWeekMinutes),
  };
}

export function getActiveWeekRange(studyBlocks: StudyBlock[]) {
  const first = studyBlocks[0];
  return first ? toDateKey(startOfPlannerWeek(new Date(first.start))) : toDateKey(startOfPlannerWeek(new Date()));
}

export function getWeeklyCompletionRatio(weeklyPlan: WeeklyPlan | undefined, subjectId: string) {
  if (!weeklyPlan) {
    return 0;
  }

  const planned = weeklyPlan.assignedHoursBySubject[subjectId] ?? 0;
  const completed = weeklyPlan.completedHoursBySubject[subjectId] ?? 0;
  return planned ? clamp(completed / planned, 0, 1.5) : 0;
}

function getActiveGoalForSubject(subject: Subject, topics: Topic[], goals: Goal[]) {
  const subjectTopics = topics.filter((topic) => topic.subjectId === subject.id);
  const totalHours = subjectTopics.reduce((total, topic) => total + topic.estHours, 0);
  const completedHours = subjectTopics.reduce(
    (total, topic) => total + Math.min(topic.completedHours, topic.estHours),
    0,
  );
  const completionRatio = totalHours > 0 ? completedHours / totalHours : 1;
  const subjectGoals = goals
    .filter((goal) => goal.subjectId === subject.id)
    .sort((left, right) => left.deadline.localeCompare(right.deadline));

  return (
    subjectGoals.find((goal) => goal.targetCompletion > completionRatio + 0.001) ??
    subjectGoals[subjectGoals.length - 1]
  );
}

function getFinalGoalForSubject(subject: Subject, goals: Goal[]) {
  const subjectGoals = goals
    .filter((goal) => goal.subjectId === subject.id)
    .sort((left, right) => left.deadline.localeCompare(right.deadline));

  return subjectGoals[subjectGoals.length - 1] ?? null;
}

export function getCalendarCompletionForecast(options: {
  subject: Subject;
  topics: Topic[];
  goals: Goal[];
  studyBlocks: StudyBlock[];
  referenceDate?: Date;
  currentDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const currentDate = options.currentDate ?? new Date();
  const subjectTopics = options.topics.filter((topic) => topic.subjectId === options.subject.id);
  const totalHours = subjectTopics.reduce((total, topic) => total + topic.estHours, 0);
  const completedHours = subjectTopics.reduce(
    (total, topic) => total + Math.min(topic.completedHours, topic.estHours),
    0,
  );
  const activeGoal = getActiveGoalForSubject(options.subject, options.topics, options.goals);
  const finalGoal = getFinalGoalForSubject(options.subject, options.goals);
  const targetHours = totalHours * (activeGoal?.targetCompletion ?? 1);
  const assumedCompletedHoursBeforeReference = options.studyBlocks
    .filter((block) => block.subjectId === options.subject.id)
    .filter((block) => ["planned", "rescheduled"].includes(block.status))
    .filter((block) => new Date(block.end) >= currentDate && new Date(block.end) < referenceDate)
    .reduce((total, block) => total + block.estimatedMinutes / 60, 0);
  const effectiveCompletedHours = Math.min(
    targetHours,
    completedHours + assumedCompletedHoursBeforeReference,
  );
  const remainingTargetHours = Math.max(targetHours - effectiveCompletedHours, 0);
  const futureBlocks = options.studyBlocks
    .filter((block) => block.subjectId === options.subject.id)
    .filter((block) => !["missed"].includes(block.status))
    .filter((block) => new Date(block.end) >= referenceDate)
    .sort((left, right) => new Date(left.end).getTime() - new Date(right.end).getTime());
  const lastScheduledDate = futureBlocks.length
    ? new Date(futureBlocks[futureBlocks.length - 1].end)
    : null;

  let scheduledHours = 0;
  let completionDate: Date | null = remainingTargetHours <= 0 ? referenceDate : null;

  futureBlocks.forEach((block) => {
    if (completionDate) {
      return;
    }

    scheduledHours += (block.actualMinutes ?? block.estimatedMinutes) / 60;
    if (effectiveCompletedHours + scheduledHours >= targetHours) {
      completionDate = new Date(block.end);
    }
  });

  const scheduledHoursToHorizon = Number(Math.min(scheduledHours, remainingTargetHours).toFixed(1));
  const missingHours = Number(Math.max(remainingTargetHours - scheduledHours, 0).toFixed(1));
  const deadline = finalGoal?.deadline ?? options.subject.deadline;
  const milestoneDeadline = activeGoal?.deadline ?? deadline;
  const isCalendarImpossible = missingHours > 0;

  return {
    subject: options.subject,
    deadline,
    milestoneDeadline,
    activeGoalTitle: activeGoal?.title ?? null,
    finalGoalTitle: finalGoal?.title ?? activeGoal?.title ?? null,
    targetHours: Number(targetHours.toFixed(1)),
    completedHours: Number(effectiveCompletedHours.toFixed(1)),
    remainingTargetHours: Number(remainingTargetHours.toFixed(1)),
    scheduledHoursToHorizon,
    missingHours,
    lastScheduledDate,
    completionDate,
    isCalendarImpossible,
    isFullyScheduled: !!completionDate,
    isOnTrack:
      !!completionDate && completionDate.getTime() <= new Date(deadline).getTime(),
  };
}

export function getHorizonRoadmapSummary(
  weeklyPlans: WeeklyPlan[],
  topics: Topic[],
  currentWeekStart: string,
): HorizonRoadmapSummary {
  const visiblePlans = weeklyPlans
    .filter((plan) => plan.weekStart >= currentWeekStart)
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart));
  const totalRequiredHours = visiblePlans.reduce(
    (total, plan) =>
      total +
      mainSubjectIds.reduce(
        (subjectTotal, subjectId) => subjectTotal + (plan.requiredHoursBySubject[subjectId] ?? 0),
        0,
      ),
    0,
  );
  const totalAssignedHours = visiblePlans.reduce(
    (total, plan) =>
      total +
      mainSubjectIds.reduce(
        (subjectTotal, subjectId) => subjectTotal + (plan.assignedHoursBySubject[subjectId] ?? 0),
        0,
      ),
    0,
  );
  const totalCompletedHours = visiblePlans.reduce(
    (total, plan) =>
      total +
      mainSubjectIds.reduce(
        (subjectTotal, subjectId) => subjectTotal + (plan.completedHoursBySubject[subjectId] ?? 0),
        0,
      ),
    0,
  );
  const remainingCoreHours = topics
    .filter((topic) => mainSubjectIds.includes(topic.subjectId as (typeof mainSubjectIds)[number]))
    .reduce((total, topic) => total + Math.max(topic.estHours - topic.completedHours, 0), 0);

  return {
    startWeek: currentWeekStart,
    endWeek: visiblePlans[visiblePlans.length - 1]?.weekStart ?? currentWeekStart,
    weeksRemaining: visiblePlans.length,
    totalRequiredHours: Number(totalRequiredHours.toFixed(1)),
    totalAssignedHours: Number(totalAssignedHours.toFixed(1)),
    totalCompletedHours: Number(totalCompletedHours.toFixed(1)),
    remainingCoreHours: Number(remainingCoreHours.toFixed(1)),
    riskWeeks: visiblePlans.filter((plan) => plan.riskFlag !== "low").length,
    weeks: visiblePlans.map((plan) => ({
      weekStart: plan.weekStart,
      weekLabel: formatWeekRangeLabel(fromDateKey(plan.weekStart)),
      horizonEndDate: plan.horizonEndDate,
      weeksRemainingToDeadline: plan.weeksRemainingToDeadline,
      requiredHours: Number(
        mainSubjectIds
          .reduce((total, subjectId) => total + (plan.requiredHoursBySubject[subjectId] ?? 0), 0)
          .toFixed(1),
      ),
      assignedHours: Number(
        mainSubjectIds
          .reduce((total, subjectId) => total + (plan.assignedHoursBySubject[subjectId] ?? 0), 0)
          .toFixed(1),
      ),
      completedHours: Number(
        mainSubjectIds
          .reduce((total, subjectId) => total + (plan.completedHoursBySubject[subjectId] ?? 0), 0)
          .toFixed(1),
      ),
      remainingCoreHours: Number(
        mainSubjectIds
          .reduce((total, subjectId) => total + (plan.remainingHoursBySubject[subjectId] ?? 0), 0)
          .toFixed(1),
      ),
      slackMinutes: plan.slackMinutes,
      riskFlag: plan.riskFlag,
      coverageComplete: plan.coverageComplete,
      forcedCoverageMinutes: plan.forcedCoverageMinutes,
      usedSundayMinutes: plan.usedSundayMinutes,
      overloadMinutes: plan.overloadMinutes,
      underplannedSubjectIds: plan.underplannedSubjectIds,
    })),
  };
}
