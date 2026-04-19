import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  endOfMonth,
  isSameDay,
  startOfDay,
  startOfMonth,
} from "date-fns";

import { mainSubjectIds } from "@/lib/constants/planner";
import {
  formatWeekRangeLabel,
  fromDateKey,
  hoursFromMinutes,
  startOfPlannerWeek,
  toDateKey,
} from "@/lib/dates/helpers";
import { calculateFreeSlots } from "@/lib/scheduler/free-slots";
import { selectBlockOption } from "@/lib/scheduler/slot-classifier";
import { buildTaskCandidates } from "@/lib/scheduler/task-candidates";
import type {
  CalendarSlot,
  CompletionLog,
  FixedEvent,
  Goal,
  HorizonRoadmapSummary,
  Preferences,
  SickDay,
  StudyBlock,
  Subject,
  Topic,
  WeeklyPlan,
} from "@/lib/types/planner";
import { clamp } from "@/lib/utils";

function getTopicsForGoal(subjectTopics: Topic[], goal: Goal | null | undefined) {
  if (!goal?.topicIds?.length) {
    return subjectTopics;
  }

  const topicIdSet = new Set(goal.topicIds);
  return subjectTopics.filter((topic) => topicIdSet.has(topic.id));
}

function getGoalProgressState(subjectTopics: Topic[], goal: Goal | null | undefined) {
  const goalTopics = getTopicsForGoal(subjectTopics, goal);
  const totalHours = goalTopics.reduce((total, topic) => total + topic.estHours, 0);
  const completedHours = goalTopics.reduce(
    (total, topic) => total + Math.min(topic.completedHours, topic.estHours),
    0,
  );

  return {
    goalTopics,
    totalHours,
    completedHours,
    completionRatio: totalHours > 0 ? completedHours / totalHours : 1,
    targetHours: totalHours * (goal?.targetCompletion ?? 1),
  };
}

export function getWeeklyPlan(weeklyPlans: WeeklyPlan[] | undefined, weekStart: string) {
  return weeklyPlans?.find((plan) => plan.weekStart === weekStart);
}

export function getWeekBlocks(studyBlocks: StudyBlock[], weekStart: string) {
  return studyBlocks
    .filter(
      (block) =>
        block.weekStart === weekStart ||
        toDateKey(startOfPlannerWeek(new Date(block.start))) === weekStart,
    )
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
}

export function getTodayBlocks(studyBlocks: StudyBlock[], referenceDate = new Date()) {
  return studyBlocks
    .filter((block) => isSameDay(new Date(block.start), referenceDate))
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
}

export function getSubjectProgress(
  subject: Subject,
  topics: Topic[],
  studyBlocks: StudyBlock[] = [],
  referenceDate = new Date(),
) {
  const minAllocatableHours = 0.5;
  const subjectTopics = topics.filter((topic) => topic.subjectId === subject.id);
  const topicById = new Map(subjectTopics.map((topic) => [topic.id, topic]));
  const plannedFutureMinutesByTopic = studyBlocks.reduce<Record<string, number>>((accumulator, block) => {
    const topic = block.topicId ? topicById.get(block.topicId) : null;
    const isSyntheticReviewFollowUp =
      !!topic &&
      !topic.id.endsWith("-review") &&
      block.blockType === "review" &&
      block.title === `${topic.title} review`;

    if (
      block.subjectId !== subject.id ||
      !block.topicId ||
      (block.status !== "planned" && block.status !== "rescheduled") ||
      new Date(block.end) <= referenceDate ||
      isSyntheticReviewFollowUp
    ) {
      return accumulator;
    }

    accumulator[block.topicId] = (accumulator[block.topicId] ?? 0) + block.estimatedMinutes;
    return accumulator;
  }, {});
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
  const scheduledFutureHours = subjectTopics.reduce((total, topic) => {
    const remainingHoursForTopic = Math.max(topic.estHours - topic.completedHours, 0);
    const plannedFutureHours = (plannedFutureMinutesByTopic[topic.id] ?? 0) / 60;
    const rawUnscheduledHours = Math.max(remainingHoursForTopic - plannedFutureHours, 0);
    const normalizedUnscheduledHours =
      rawUnscheduledHours > 0 && rawUnscheduledHours < minAllocatableHours
        ? 0
        : rawUnscheduledHours;
    return total + Math.max(remainingHoursForTopic - normalizedUnscheduledHours, 0);
  }, 0);
  const unscheduledHours = subjectTopics.reduce((total, topic) => {
    const remainingHoursForTopic = Math.max(topic.estHours - topic.completedHours, 0);
    const plannedFutureHours = (plannedFutureMinutesByTopic[topic.id] ?? 0) / 60;
    const rawUnscheduledHours = Math.max(remainingHoursForTopic - plannedFutureHours, 0);
    return total + (rawUnscheduledHours > 0 && rawUnscheduledHours < minAllocatableHours ? 0 : rawUnscheduledHours);
  }, 0);
  const atRiskTopics = subjectTopics.filter(
    (topic) => topic.mastery <= 2 || topic.status === "not_started",
  );

  return {
    subject,
    topics: subjectTopics,
    completionPercent: totalHours ? Math.round((completedHours / totalHours) * 100) : 0,
    remainingHours: Number(remainingHours.toFixed(1)),
    scheduledFutureHours: Number(scheduledFutureHours.toFixed(1)),
    unscheduledHours: Number(unscheduledHours.toFixed(1)),
    plannedFutureHoursByTopic: Object.fromEntries(
      subjectTopics.map((topic) => {
        const plannedFutureHours = (plannedFutureMinutesByTopic[topic.id] ?? 0) / 60;
        const remainingHoursForTopic = Math.max(topic.estHours - topic.completedHours, 0);
        const rawUnscheduledHours = Math.max(remainingHoursForTopic - plannedFutureHours, 0);
        const normalizedUnscheduledHours =
          rawUnscheduledHours > 0 && rawUnscheduledHours < minAllocatableHours
            ? 0
            : rawUnscheduledHours;
        return [
          topic.id,
          Number(Math.max(remainingHoursForTopic - normalizedUnscheduledHours, 0).toFixed(1)),
        ];
      }),
    ),
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

export function getDashboardHorizonMetrics(options: {
  subjects: Subject[];
  topics: Topic[];
  studyBlocks: StudyBlock[];
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const trackedProgress = options.subjects
    .filter((subject) => mainSubjectIds.includes(subject.id as (typeof mainSubjectIds)[number]))
    .map((subject) => getSubjectProgress(subject, options.topics, options.studyBlocks, referenceDate));
  const plannedTodayMinutes = getPlannedMinutesForDay(options.studyBlocks, referenceDate);
  const completedTodayMinutes = getCompletedMinutesForDay(options.studyBlocks, referenceDate);
  const totalTrackedHours = trackedProgress.reduce((total, progress) => total + progress.totalHours, 0);
  const totalCompletedHours = trackedProgress.reduce(
    (total, progress) => total + (progress.totalHours - progress.remainingHours),
    0,
  );
  const totalRemainingHours = trackedProgress.reduce((total, progress) => total + progress.remainingHours, 0);
  const totalScheduledFutureHours = trackedProgress.reduce(
    (total, progress) => total + progress.scheduledFutureHours,
    0,
  );
  const totalUnscheduledHours = trackedProgress.reduce(
    (total, progress) => total + progress.unscheduledHours,
    0,
  );

  return {
    plannedTodayHours: hoursFromMinutes(plannedTodayMinutes),
    completedTodayHours: hoursFromMinutes(completedTodayMinutes),
    horizonProgressPercent:
      totalTrackedHours > 0 ? Math.round((totalCompletedHours / totalTrackedHours) * 100) : 0,
    totalTrackedHours: Number(totalTrackedHours.toFixed(1)),
    totalCompletedHours: Number(totalCompletedHours.toFixed(1)),
    totalRemainingHours: Number(totalRemainingHours.toFixed(1)),
    totalScheduledFutureHours: Number(totalScheduledFutureHours.toFixed(1)),
    totalUnscheduledHours: Number(totalUnscheduledHours.toFixed(1)),
  };
}

function getTrackedDashboardSubjects(subjects: Subject[]) {
  return subjects.filter((subject) =>
    mainSubjectIds.includes(subject.id as (typeof mainSubjectIds)[number]),
  );
}

function countInclusiveDays(start: Date, end: Date) {
  if (end.getTime() < start.getTime()) {
    return 0;
  }

  return differenceInCalendarDays(endOfDay(end), start) + 1;
}

function getTrackedSubjectIdSet(subjects: Subject[]) {
  return new Set(getTrackedDashboardSubjects(subjects).map((subject) => subject.id));
}

function getPlannedHoursInRange(options: {
  studyBlocks: StudyBlock[];
  trackedSubjectIds: Set<string>;
  start: Date;
  end: Date;
}) {
  return options.studyBlocks
    .filter((block) => !!block.subjectId && options.trackedSubjectIds.has(block.subjectId))
    .filter((block) => !["missed"].includes(block.status))
    .filter((block) => {
      const blockStart = new Date(block.start).getTime();
      return blockStart >= options.start.getTime() && blockStart <= options.end.getTime();
    })
    .reduce((total, block) => total + block.estimatedMinutes / 60, 0);
}

function getCompletedHoursInRange(options: {
  studyBlocks: StudyBlock[];
  trackedSubjectIds: Set<string>;
  start: Date;
  end: Date;
}) {
  return options.studyBlocks
    .filter((block) => !!block.subjectId && options.trackedSubjectIds.has(block.subjectId))
    .filter((block) => block.status === "done" || block.status === "partial")
    .filter((block) => {
      const blockStart = new Date(block.start).getTime();
      return blockStart >= options.start.getTime() && blockStart <= options.end.getTime();
    })
    .reduce((total, block) => total + (block.actualMinutes ?? block.estimatedMinutes) / 60, 0);
}

function getPeriodTargetHours(options: {
  forecasts: Array<ReturnType<typeof getCalendarCompletionForecast>>;
  referenceDate: Date;
  periodEnd: Date;
}) {
  return options.forecasts.reduce((total, forecast) => {
    if (forecast.remainingTargetHours <= 0) {
      return total;
    }

    const milestoneDeadline = fromDateKey(forecast.milestoneDeadline);
    const totalDays = countInclusiveDays(options.referenceDate, milestoneDeadline);
    const activePeriodEnd =
      milestoneDeadline.getTime() < options.periodEnd.getTime()
        ? milestoneDeadline
        : options.periodEnd;
    const activeDays = countInclusiveDays(options.referenceDate, activePeriodEnd);

    if (totalDays <= 0 || activeDays <= 0) {
      return total;
    }

    return total + forecast.remainingTargetHours * (activeDays / totalDays);
  }, 0);
}

export function getPlanningHierarchyMetrics(options: {
  subjects: Subject[];
  topics: Topic[];
  goals: Goal[];
  studyBlocks: StudyBlock[];
  weeklyPlans?: WeeklyPlan[];
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const trackedSubjects = getTrackedDashboardSubjects(options.subjects);
  const trackedSubjectIds = getTrackedSubjectIdSet(options.subjects);
  const forecasts = trackedSubjects.map((subject) =>
    getCalendarCompletionForecast({
      subject,
      topics: options.topics,
      goals: options.goals,
      studyBlocks: options.studyBlocks,
      weeklyPlans: options.weeklyPlans,
      referenceDate,
    }),
  );
  const yearTargetHours = forecasts.reduce((total, forecast) => total + forecast.targetHours, 0);
  const yearCompletedHours = forecasts.reduce((total, forecast) => total + forecast.completedHours, 0);
  const monthStart = startOfMonth(referenceDate);
  const monthEnd = endOfMonth(referenceDate);
  const weekStart = startOfPlannerWeek(referenceDate);
  const weekEnd = addDays(startOfPlannerWeek(referenceDate), 6);
  const dayStart = startOfDay(referenceDate);
  const dayEnd = endOfDay(referenceDate);
  const monthForwardTargetHours = getPeriodTargetHours({
    forecasts,
    referenceDate,
    periodEnd: monthEnd,
  });
  const weekForwardTargetHours = getPeriodTargetHours({
    forecasts,
    referenceDate,
    periodEnd: weekEnd,
  });
  const todayForwardTargetHours = getPeriodTargetHours({
    forecasts,
    referenceDate,
    periodEnd: dayEnd,
  });
  const monthPlannedHours = getPlannedHoursInRange({
    studyBlocks: options.studyBlocks,
    trackedSubjectIds,
    start: monthStart,
    end: monthEnd,
  });
  const monthCompletedHours = getCompletedHoursInRange({
    studyBlocks: options.studyBlocks,
    trackedSubjectIds,
    start: monthStart,
    end: monthEnd,
  });
  const weekPlannedHours = getPlannedHoursInRange({
    studyBlocks: options.studyBlocks,
    trackedSubjectIds,
    start: weekStart,
    end: weekEnd,
  });
  const weekCompletedHours = getCompletedHoursInRange({
    studyBlocks: options.studyBlocks,
    trackedSubjectIds,
    start: weekStart,
    end: weekEnd,
  });
  const todayPlannedHours = getPlannedHoursInRange({
    studyBlocks: options.studyBlocks,
    trackedSubjectIds,
    start: dayStart,
    end: dayEnd,
  });
  const todayCompletedHours = getCompletedHoursInRange({
    studyBlocks: options.studyBlocks,
    trackedSubjectIds,
    start: dayStart,
    end: dayEnd,
  });
  const monthTargetHours = monthCompletedHours + monthForwardTargetHours;
  const weekTargetHours = weekCompletedHours + weekForwardTargetHours;
  const todayTargetHours = todayCompletedHours + todayForwardTargetHours;

  return {
    forecasts,
    trackedSubjectCount: trackedSubjects.length,
    year: {
      targetHours: Number(yearTargetHours.toFixed(1)),
      completedHours: Number(yearCompletedHours.toFixed(1)),
      remainingHours: Number(Math.max(yearTargetHours - yearCompletedHours, 0).toFixed(1)),
      progressPercent: yearTargetHours > 0 ? Math.round((yearCompletedHours / yearTargetHours) * 100) : 0,
    },
    month: {
      targetHours: Number(monthTargetHours.toFixed(1)),
      plannedHours: Number(monthPlannedHours.toFixed(1)),
      completedHours: Number(monthCompletedHours.toFixed(1)),
      coveragePercent: monthTargetHours > 0 ? Math.round((monthPlannedHours / monthTargetHours) * 100) : 0,
    },
    week: {
      targetHours: Number(weekTargetHours.toFixed(1)),
      plannedHours: Number(weekPlannedHours.toFixed(1)),
      completedHours: Number(weekCompletedHours.toFixed(1)),
      coveragePercent: weekTargetHours > 0 ? Math.round((weekPlannedHours / weekTargetHours) * 100) : 0,
    },
    today: {
      targetHours: Number(todayTargetHours.toFixed(1)),
      plannedHours: Number(todayPlannedHours.toFixed(1)),
      completedHours: Number(todayCompletedHours.toFixed(1)),
      fillPercent: todayTargetHours > 0 ? Math.round((todayPlannedHours / todayTargetHours) * 100) : 0,
    },
  };
}

function getFuturePlanningBaselineBlocks(studyBlocks: StudyBlock[], planningStart: Date) {
  return studyBlocks.filter((block) => {
    const blockEnd = new Date(block.end).getTime();
    return (
      blockEnd <= planningStart.getTime() ||
      block.status === "done" ||
      block.status === "partial"
    );
  });
}

function taskFitsSlot(
  slot: CalendarSlot,
  task: ReturnType<typeof buildTaskCandidates>[number],
  preferences: Preferences,
) {
  if (task.subjectId === "cpp-book") {
    return false;
  }

  if (task.availableAt && new Date(task.availableAt).getTime() > slot.start.getTime()) {
    return false;
  }

  if (task.latestAt && new Date(task.latestAt).getTime() < slot.start.getTime()) {
    return false;
  }

  if (task.sessionMode === "exam") {
    const requiredMinutes = task.exactSessionMinutes ?? task.remainingMinutes;
    return requiredMinutes <= slot.durationMinutes;
  }

  return !!selectBlockOption(task, slot, preferences);
}

export function detectFutureFillableGap(options: {
  subjects: Subject[];
  topics: Topic[];
  studyBlocks: StudyBlock[];
  weeklyPlans: WeeklyPlan[];
  fixedEvents: FixedEvent[];
  sickDays?: SickDay[];
  completionLogs?: CompletionLog[];
  preferences: Preferences;
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const futurePlans = [...options.weeklyPlans]
    .filter((plan) => plan.weekStart >= toDateKey(startOfPlannerWeek(referenceDate)))
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart));
  const activeBlocks = options.studyBlocks.filter((block) =>
    ["planned", "rescheduled", "done", "partial"].includes(block.status),
  );
  const subjectDeadlinesById = Object.fromEntries(
    options.subjects.map((subject) => [subject.id, subject.deadline]),
  );

  for (const weeklyPlan of futurePlans) {
    const weekStart = fromDateKey(weeklyPlan.weekStart);
    const planningStart =
      weekStart.getTime() < referenceDate.getTime() ? referenceDate : weekStart;
    const freeSlots = calculateFreeSlots({
      weekStart,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays ?? [],
      preferences: options.preferences,
      blockedStudyBlocks: activeBlocks,
      planningStart,
      effectiveReservedCommitmentDurations: weeklyPlan.effectiveReservedCommitmentDurations,
      excludedReservedCommitmentRuleIds: weeklyPlan.excludedReservedCommitmentRuleIds,
    }).filter((slot) => slot.durationMinutes >= 30);

    if (!freeSlots.length) {
      continue;
    }

    const remainingTasks = buildTaskCandidates({
      topics: options.topics,
      existingPlannedBlocks: getFuturePlanningBaselineBlocks(options.studyBlocks, planningStart),
      completionLogs: options.completionLogs,
      referenceDate: planningStart,
      subjectDeadlinesById,
    }).filter((task) => task.remainingMinutes >= 30 && task.subjectId !== "cpp-book");

    if (!remainingTasks.length) {
      continue;
    }

    const fillableSlot = freeSlots.find((slot) =>
      remainingTasks.some((task) => taskFitsSlot(slot, task, options.preferences)),
    );

    if (fillableSlot) {
      return {
        hasGap: true,
        weekStart: weeklyPlan.weekStart,
        dateKey: fillableSlot.dateKey,
        openMinutes: fillableSlot.durationMinutes,
      };
    }
  }

  return {
    hasGap: false,
    weekStart: null,
    dateKey: null,
    openMinutes: 0,
  };
}

export function getWeekFillDiagnostics(options: {
  weekStart: string;
  subjects: Subject[];
  topics: Topic[];
  studyBlocks: StudyBlock[];
  weeklyPlans: WeeklyPlan[];
  fixedEvents: FixedEvent[];
  sickDays?: SickDay[];
  completionLogs?: CompletionLog[];
  preferences: Preferences;
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const weeklyPlan = getWeeklyPlan(options.weeklyPlans, options.weekStart);
  const weekStartDate = fromDateKey(options.weekStart);
  const weekBlocks = options.studyBlocks.filter(
    (block) =>
      ["planned", "rescheduled", "done", "partial"].includes(block.status) &&
      block.weekStart === options.weekStart,
  );
  const activeBlocks = options.studyBlocks.filter((block) =>
    ["planned", "rescheduled", "done", "partial"].includes(block.status),
  );
  const subjectDeadlinesById = Object.fromEntries(
    options.subjects.map((subject) => [subject.id, subject.deadline]),
  );
  const freeSlots = calculateFreeSlots({
    weekStart: weekStartDate,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays ?? [],
    preferences: options.preferences,
    blockedStudyBlocks: activeBlocks,
    planningStart:
      weekStartDate.getTime() < referenceDate.getTime() ? referenceDate : weekStartDate,
    effectiveReservedCommitmentDurations: weeklyPlan?.effectiveReservedCommitmentDurations ?? [],
    excludedReservedCommitmentRuleIds: weeklyPlan?.excludedReservedCommitmentRuleIds ?? [],
  });

  return Array.from({ length: 7 }, (_, index) => {
    const day = addDays(weekStartDate, index);
    const dateKey = toDateKey(day);
    const plannedMinutes = weekBlocks
      .filter((block) => block.date === dateKey && !!block.subjectId)
      .reduce((total, block) => total + block.estimatedMinutes, 0);
    const completedMinutes = weekBlocks
      .filter((block) => block.date === dateKey && (block.status === "done" || block.status === "partial"))
      .reduce((total, block) => total + (block.actualMinutes ?? block.estimatedMinutes), 0);
    const openSlots = freeSlots.filter((slot) => slot.dateKey === dateKey && slot.durationMinutes >= 30);
    const openMinutes = openSlots.reduce((total, slot) => total + slot.durationMinutes, 0);
    const planningStart = day.getTime() < referenceDate.getTime() ? referenceDate : day;
    const remainingTasks = buildTaskCandidates({
      topics: options.topics,
      existingPlannedBlocks: getFuturePlanningBaselineBlocks(options.studyBlocks, planningStart),
      completionLogs: options.completionLogs,
      referenceDate: planningStart,
      subjectDeadlinesById,
    }).filter((task) => task.remainingMinutes >= 30 && task.subjectId !== "cpp-book");
    const fillableGapDetected = openSlots.some((slot) =>
      remainingTasks.some((task) => taskFitsSlot(slot, task, options.preferences)),
    );

    return {
      dateKey,
      plannedHours: Number((plannedMinutes / 60).toFixed(1)),
      completedHours: Number((completedMinutes / 60).toFixed(1)),
      openHours: Number((openMinutes / 60).toFixed(1)),
      blankReason:
        openMinutes >= 30 && !fillableGapDetected
          ? "No eligible tasks left"
          : "Reserved / unavailable time",
      fillableGapDetected,
    };
  });
}

function isForecastOnActiveMilestone(
  forecast: ReturnType<typeof getCalendarCompletionForecast>,
) {
  const activeDeadlineCutoff = endOfDay(fromDateKey(forecast.milestoneDeadline));
  const projectedCompletionDate = forecast.completionDate ?? forecast.horizonCompletionDate;

  return !!projectedCompletionDate && projectedCompletionDate.getTime() <= activeDeadlineCutoff.getTime();
}

export function countHorizonTrackStatus(
  forecasts: Array<ReturnType<typeof getCalendarCompletionForecast>>,
) {
  return forecasts.reduce(
    (accumulator, forecast) => {
      if (isForecastOnActiveMilestone(forecast)) {
        accumulator.onTrack += 1;
      } else if (forecast.isFullyScheduledOnHorizon) {
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

export function getDashboardCoverageState(
  forecasts: Array<ReturnType<typeof getCalendarCompletionForecast>>,
) {
  const calendarImpossibleCount = forecasts.filter((forecast) => forecast.isCalendarImpossible).length;
  const offMilestoneCount = forecasts.filter((forecast) => !isForecastOnActiveMilestone(forecast)).length;

  if (calendarImpossibleCount > 0) {
    return {
      label: "Calendar-impossible",
      tone: "danger" as const,
      detail: `${calendarImpossibleCount} tracked subject${calendarImpossibleCount === 1 ? "" : "s"} still cannot reach the active deadline with the current horizon.`,
    };
  }

  if (offMilestoneCount > 0) {
    return {
      label: "Catch-up",
      tone: "warning" as const,
      detail: `${offMilestoneCount} tracked subject${offMilestoneCount === 1 ? "" : "s"} finish after the active milestone, even though the horizon still covers the work.`,
    };
  }

  return {
    label: "On target",
    tone: "success" as const,
    detail: "All tracked subjects currently finish by their active milestone deadlines.",
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
  const subjectGoals = goals
    .filter((goal) => goal.subjectId === subject.id)
    .sort((left, right) => left.deadline.localeCompare(right.deadline));

  return (
    subjectGoals.find((goal) => {
      const progress = getGoalProgressState(subjectTopics, goal);
      return progress.completedHours + 0.001 < progress.targetHours;
    }) ??
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
  weeklyPlans?: WeeklyPlan[];
  referenceDate?: Date;
  currentDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const currentDate = options.currentDate ?? new Date();
  const subjectTopics = options.topics.filter((topic) => topic.subjectId === options.subject.id);
  const activeGoal = getActiveGoalForSubject(options.subject, options.topics, options.goals);
  const finalGoal = getFinalGoalForSubject(options.subject, options.goals);
  const finalGoalProgress = getGoalProgressState(subjectTopics, finalGoal ?? activeGoal);
  const goalTopicIds = new Set(finalGoalProgress.goalTopics.map((topic) => topic.id));
  const targetHours = finalGoalProgress.targetHours;
  const completedHours = finalGoalProgress.completedHours;
  const assumedCompletedHoursBeforeReference = options.studyBlocks
    .filter(
      (block) =>
        block.subjectId === options.subject.id &&
        (!goalTopicIds.size || (block.topicId ? goalTopicIds.has(block.topicId) : false)),
    )
    .filter((block) => ["planned", "rescheduled"].includes(block.status))
    .filter((block) => new Date(block.end) >= currentDate && new Date(block.end) < referenceDate)
    .reduce((total, block) => total + block.estimatedMinutes / 60, 0);
  const effectiveCompletedHours = Math.min(
    targetHours,
    completedHours + assumedCompletedHoursBeforeReference,
  );
  const remainingTargetHours = Math.max(targetHours - effectiveCompletedHours, 0);
  const deadline = finalGoal?.deadline ?? options.subject.deadline;
  const milestoneDeadline = activeGoal?.deadline ?? deadline;
  const deadlineCutoff = endOfDay(fromDateKey(deadline));
  const futureBlocks = options.studyBlocks
    .filter(
      (block) =>
        block.subjectId === options.subject.id &&
        (!goalTopicIds.size || (block.topicId ? goalTopicIds.has(block.topicId) : false)),
    )
    .filter((block) => !["missed"].includes(block.status))
    .filter((block) => new Date(block.end) >= referenceDate)
    .sort((left, right) => new Date(left.end).getTime() - new Date(right.end).getTime());
  const futureBlocksToDeadline = futureBlocks.filter(
    (block) => new Date(block.end).getTime() <= deadlineCutoff.getTime(),
  );

  const getCoverageSnapshot = (candidateBlocks: StudyBlock[]) => {
    let scheduledHours = 0;
    let completionDate: Date | null = remainingTargetHours <= 0 ? referenceDate : null;

    candidateBlocks.forEach((block) => {
      if (completionDate) {
        return;
      }

      scheduledHours += (block.actualMinutes ?? block.estimatedMinutes) / 60;
      if (effectiveCompletedHours + scheduledHours >= targetHours) {
        completionDate = new Date(block.end);
      }
    });

    return {
      completionDate,
      scheduledHours: Number(Math.min(scheduledHours, remainingTargetHours).toFixed(1)),
      lastScheduledDate: candidateBlocks.length
        ? new Date(candidateBlocks[candidateBlocks.length - 1].end)
        : null,
    };
  };

  const deadlineCoverage = getCoverageSnapshot(futureBlocksToDeadline);
  const horizonCoverage = getCoverageSnapshot(futureBlocks);
  const scheduledHoursToDeadline = deadlineCoverage.scheduledHours;
  const scheduledHoursToHorizon = horizonCoverage.scheduledHours;
  const missingHours = Number(Math.max(remainingTargetHours - scheduledHoursToDeadline, 0).toFixed(1));
  const deadlineWeekStart = toDateKey(startOfPlannerWeek(new Date(deadline)));
  const currentWeekStart = toDateKey(startOfPlannerWeek(referenceDate));
  const relevantWeeklyPlans = (options.weeklyPlans ?? [])
    .filter((plan) => plan.weekStart >= currentWeekStart && plan.weekStart <= deadlineWeekStart)
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart));
  const subjectStillUndercovered = relevantWeeklyPlans.some(
    (plan) => (plan.coverageGapHoursBySubject[options.subject.id] ?? 0) > 0.1,
  );
  const hasUnusedCapacityBeforeDeadline = relevantWeeklyPlans.some((plan) => plan.slackMinutes > 0);
  const isCalendarImpossible =
    missingHours > 0 &&
    relevantWeeklyPlans.length > 0 &&
    subjectStillUndercovered &&
    !hasUnusedCapacityBeforeDeadline;
  const needsMoreBlocks = missingHours > 0 && !isCalendarImpossible;

  return {
    subject: options.subject,
    deadline,
    milestoneDeadline,
    activeGoalTitle: activeGoal?.title ?? null,
    finalGoalTitle: finalGoal?.title ?? activeGoal?.title ?? null,
    targetHours: Number(targetHours.toFixed(1)),
    completedHours: Number(effectiveCompletedHours.toFixed(1)),
    remainingTargetHours: Number(remainingTargetHours.toFixed(1)),
    scheduledHoursToDeadline,
    scheduledHoursToHorizon,
    missingHours,
    lastScheduledDate: deadlineCoverage.lastScheduledDate,
    completionDate: deadlineCoverage.completionDate,
    horizonCompletionDate: horizonCoverage.completionDate,
    isCalendarImpossible,
    needsMoreBlocks,
    hasUnusedCapacityBeforeDeadline,
    isFullyScheduled: !!deadlineCoverage.completionDate,
    isFullyScheduledOnHorizon: !!horizonCoverage.completionDate,
    isOnTrack:
      !!deadlineCoverage.completionDate &&
      deadlineCoverage.completionDate.getTime() <= deadlineCutoff.getTime(),
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
