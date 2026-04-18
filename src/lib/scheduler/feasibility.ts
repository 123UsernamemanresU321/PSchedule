import { addDays, differenceInCalendarDays, min as minDate } from "date-fns";

import { mainSubjectIds, subjectIds } from "@/lib/constants/planner";
import {
  endOfPlannerWeek,
  getAcademicDeadline,
  hoursFromMinutes,
  toDateKey,
} from "@/lib/dates/helpers";
import { isDateInActiveSchoolTerm } from "@/lib/scheduler/schedule-regime";
import {
  getOlympiadWeekLoadProfile,
  getPendingOlympiadRewriteDemandHours,
} from "@/lib/scheduler/olympiad-performance";
import { clamp, roundToTenth, sum } from "@/lib/utils";
import type {
  CalendarSlot,
  EffectiveReservedCommitmentDuration,
  FixedEvent,
  Goal,
  Preferences,
  RiskFlag,
  SickDay,
  StudyBlock,
  Subject,
  Topic,
  WeeklyPlan,
} from "@/lib/types/planner";

const MIN_ALLOCATABLE_HOURS = 0.5;

function getTopicsForGoal(subjectTopics: Topic[], goal: Goal | null | undefined) {
  if (!goal?.topicIds?.length) {
    return subjectTopics;
  }

  const topicIdSet = new Set(goal.topicIds);
  return subjectTopics.filter((topic) => topicIdSet.has(topic.id));
}

function getGoalProgressState(options: {
  goal: Goal | null | undefined;
  subjectTopics: Topic[];
  plannedMinutesByTopic: Record<string, number>;
}) {
  const goalTopics = getTopicsForGoal(options.subjectTopics, options.goal);
  const totalHours = goalTopics.reduce((total, topic) => total + topic.estHours, 0);
  const completedHours = goalTopics.reduce(
    (total, topic) => total + Math.min(topic.completedHours, topic.estHours),
    0,
  );
  const targetHours = totalHours * (options.goal?.targetCompletion ?? 1);
  const plannedTowardTargetHours = goalTopics.reduce((total, topic) => {
    const plannedHours = (options.plannedMinutesByTopic[topic.id] ?? 0) / 60;
    const cappedPlannedHours = Math.min(
      plannedHours,
      Math.max(topic.estHours - topic.completedHours, 0),
    );
    return total + cappedPlannedHours;
  }, 0);

  return {
    goalTopics,
    totalHours,
    completedHours,
    targetHours,
    completionRatio: totalHours > 0 ? completedHours / totalHours : 1,
    scheduledToGoalHours: Math.min(targetHours, completedHours + plannedTowardTargetHours),
  };
}

function getSortedSubjectGoals(subject: Subject, goals: Goal[]) {
  return goals
    .filter((candidate) => candidate.subjectId === subject.id)
    .sort((left, right) => new Date(left.deadline).getTime() - new Date(right.deadline).getTime());
}

function getLatestPlanningDeadline(goals: Goal[], subjects: Subject[], referenceDate: Date) {
  const academicDeadline = getAcademicDeadline(referenceDate);
  return [...goals.map((goal) => goal.deadline), ...subjects.map((subject) => subject.deadline)]
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()))
    .reduce(
      (latest, candidate) => (candidate.getTime() > latest.getTime() ? candidate : latest),
      academicDeadline,
    );
}

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

function getSubjectGoal(
  subject: Subject,
  goals: Goal[],
  subjectTopics: Topic[],
  plannedMinutesByTopic: Record<string, number>,
) {
  const subjectGoals = getSortedSubjectGoals(subject, goals);

  return (
    subjectGoals.find((goal) => {
      const progressState = getGoalProgressState({
        goal,
        subjectTopics,
        plannedMinutesByTopic,
      });
      return progressState.completedHours + 0.001 < progressState.targetHours;
    }) ??
    subjectGoals[subjectGoals.length - 1]
  );
}

function computeScheduledHoursBySubjectToGoal(options: {
  subjects: Subject[];
  goals: Goal[];
  topics: Topic[];
  plannedMinutesByTopic: Record<string, number>;
}) {
  return options.subjects.reduce<Record<string, number>>((accumulator, subject) => {
    const subjectTopics = options.topics.filter((topic) => topic.subjectId === subject.id);
    const finalGoal = getSortedSubjectGoals(subject, options.goals).at(-1);
    const goalProgress = getGoalProgressState({
      goal: finalGoal,
      subjectTopics,
      plannedMinutesByTopic: options.plannedMinutesByTopic,
    });

    accumulator[subject.id] = roundToTenth(goalProgress.scheduledToGoalHours);
    return accumulator;
  }, {});
}

function isSchoolTermWeek(options: {
  weekStartDate?: Date;
  preferences?: Preferences;
}) {
  if (!options.weekStartDate || !options.preferences) {
    return false;
  }

  return Array.from({ length: 7 }, (_, offset) => addDays(options.weekStartDate!, offset)).some((day) =>
    isDateInActiveSchoolTerm(day, options.preferences!),
  );
}

function getSeasonalSubjectMinimumHours(options: {
  subject: Subject;
  referenceDate: Date;
  weekStartDate?: Date;
  preferences?: Preferences;
  fixedEvents?: FixedEvent[];
  sickDays?: SickDay[];
}) {
  const schoolTermWeek = isSchoolTermWeek(options);

  if (options.subject.id === "olympiad") {
    const latePhaseStart = new Date(`${options.referenceDate.getFullYear()}-09-28T00:00:00`);
    const comparisonDate = options.weekStartDate ?? options.referenceDate;
    const isLatePhase = comparisonDate.getTime() >= latePhaseStart.getTime();
    const loadProfile =
      options.preferences && options.weekStartDate
        ? getOlympiadWeekLoadProfile({
            weekStart: options.weekStartDate,
            fixedEvents: options.fixedEvents ?? [],
            preferences: options.preferences,
            sickDays: options.sickDays ?? [],
          })
        : { multiplier: 1 };
    const baseMinimum = schoolTermWeek
      ? isLatePhase
        ? 12
        : 10
      : isLatePhase
        ? 18
        : 16;

    return roundToTenth(baseMinimum * loadProfile.multiplier);
  }

  if (options.subject.id === "cpp-book") {
    return schoolTermWeek ? 0 : 2;
  }

  return options.subject.weeklyMinimumHours;
}

export function computeSubjectDeadlineTracks(options: {
  subjects: Subject[];
  goals: Goal[];
  topics: Topic[];
  completionLogs?: import("@/lib/types/planner").CompletionLog[];
  referenceDate: Date;
  horizonStartDate?: Date;
  weekStartDate?: Date;
  weekEndDate?: Date;
  priorPlannedBlocks?: StudyBlock[];
  preferences?: Preferences;
  fixedEvents?: FixedEvent[];
  sickDays?: SickDay[];
}) {
  const remainingHoursBySubject = computeRemainingHoursBySubject(options.topics);
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
    const activeGoal = getSubjectGoal(
      subject,
      options.goals,
      subjectTopics,
      plannedMinutesByTopic,
    );
    const subjectGoals = getSortedSubjectGoals(subject, options.goals);
    const finalGoal = subjectGoals[subjectGoals.length - 1] ?? activeGoal;
    const deadline = new Date(activeGoal?.deadline ?? subject.deadline);
    const finalDeadline = new Date(finalGoal?.deadline ?? deadline);
    const daysRemaining = Math.max(differenceInCalendarDays(finalDeadline, options.referenceDate), 7);
    const weeksRemaining = Math.max(Math.ceil(daysRemaining / 7), 1);
    const finalGoalProgress = getGoalProgressState({
      goal: finalGoal,
      subjectTopics,
      plannedMinutesByTopic,
    });
    const targetHours = roundToTenth(finalGoalProgress.targetHours);
    const scheduledToGoalHours = roundToTenth(finalGoalProgress.scheduledToGoalHours);
    const totalRemainingTargetHours = Math.max(targetHours - finalGoalProgress.completedHours, 0);
    const targetRemainingHours = roundToTenth(Math.max(targetHours - scheduledToGoalHours, 0));
    const cumulativeWindowEnd = minDate([finalDeadline, weekEndDate]);
    const effectiveWeekStart =
      weekStartDate > horizonStartDate ? weekStartDate : horizonStartDate;
    const remainingPlanningDaysFromWeek =
      finalDeadline < effectiveWeekStart
        ? 0
        : Math.max(differenceInCalendarDays(finalDeadline, effectiveWeekStart) + 1, 1);
    const weekPlanningDays =
      cumulativeWindowEnd < effectiveWeekStart
        ? 0
        : Math.max(differenceInCalendarDays(cumulativeWindowEnd, effectiveWeekStart) + 1, 0);
    const cumulativeTargetHoursByWeekEnd = roundToTenth(
      subjectGoals.reduce((requiredHoursByWeekEnd, goal) => {
        const goalDeadline = new Date(goal.deadline);
        const goalTargetHours = getGoalProgressState({
          goal,
          subjectTopics,
          plannedMinutesByTopic,
        }).targetHours;
        const goalPlanningDays = Math.max(
          differenceInCalendarDays(goalDeadline, horizonStartDate) + 1,
          1,
        );
        const goalCoveredPlanningDays =
          minDate([goalDeadline, weekEndDate]) < horizonStartDate
            ? 0
            : clamp(
                differenceInCalendarDays(minDate([goalDeadline, weekEndDate]), horizonStartDate) + 1,
                0,
                goalPlanningDays,
              );
        const goalRequiredHours =
          goalTargetHours > 0 ? (goalTargetHours * goalCoveredPlanningDays) / goalPlanningDays : 0;

        return Math.max(requiredHoursByWeekEnd, goalRequiredHours);
      }, 0),
    );
    const baselineWeeklyHours =
      totalRemainingTargetHours > 0 ? totalRemainingTargetHours / weeksRemaining : 0;
    const hasExplicitGoal = Boolean(activeGoal);
    const seasonalMinimumHours = getSeasonalSubjectMinimumHours({
      subject,
      referenceDate: options.referenceDate,
      weekStartDate: options.weekStartDate,
      preferences: options.preferences,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays,
    });
    const minimumGuidanceHours =
      hasExplicitGoal && subject.examMode !== "maintenance" ? 0 : seasonalMinimumHours;
    const cumulativeGapHours = Math.max(cumulativeTargetHoursByWeekEnd - scheduledToGoalHours, 0);
    const evenWeekShareHours =
      targetRemainingHours > 0 && remainingPlanningDaysFromWeek > 0
        ? roundToTenth((targetRemainingHours * weekPlanningDays) / remainingPlanningDaysFromWeek)
        : 0;
    const rawRecommendedWeeklyHours =
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
    let recommendedWeeklyHours =
      rawRecommendedWeeklyHours <= 0 && targetRemainingHours > 0 && weekPlanningDays > 0
        ? Math.min(targetRemainingHours, MIN_ALLOCATABLE_HOURS)
        : rawRecommendedWeeklyHours > 0
          ? Math.min(
              targetRemainingHours,
              Math.max(
                MIN_ALLOCATABLE_HOURS,
                Math.ceil(rawRecommendedWeeklyHours / MIN_ALLOCATABLE_HOURS) *
                  MIN_ALLOCATABLE_HOURS,
              ),
            )
          : 0;

    if (subject.id === "olympiad") {
      const rewriteDemandHours = getPendingOlympiadRewriteDemandHours({
        topics: options.topics,
        studyBlocks: options.priorPlannedBlocks ?? [],
        completionLogs: options.completionLogs,
        weekStart: effectiveWeekStart,
        weekEnd: weekEndDate,
      });
      if (targetRemainingHours > 0 || rewriteDemandHours > 0) {
        recommendedWeeklyHours = Math.min(
          targetRemainingHours + rewriteDemandHours,
          Math.max(recommendedWeeklyHours, seasonalMinimumHours) + rewriteDemandHours,
        );
      }
    }

    if (subject.id === "cpp-book") {
      const schoolTermWeek = isSchoolTermWeek({
        weekStartDate: options.weekStartDate,
        preferences: options.preferences,
      });
      recommendedWeeklyHours = schoolTermWeek
        ? 0
        : Math.min(
            targetRemainingHours,
            Math.max(recommendedWeeklyHours, seasonalMinimumHours),
          );
    }

    accumulator[subject.id] = {
      remainingHours,
      targetRemainingHours,
      targetHours: roundToTenth(targetHours),
      scheduledToGoalHours: roundToTenth(scheduledToGoalHours),
      uncoveredGoalHours: roundToTenth(Math.max(targetHours - scheduledToGoalHours, 0)),
      cumulativeTargetHoursByWeekEnd,
      weeksRemaining,
      deadline: toDateKey(finalDeadline),
      baselineWeeklyHours: roundToTenth(baselineWeeklyHours),
      recommendedWeeklyHours: Number(recommendedWeeklyHours.toFixed(2)),
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
  preferences?: Preferences;
  weekStartDate?: Date;
  fixedEvents?: FixedEvent[];
  sickDays?: SickDay[];
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
  capacityFreeSlots?: CalendarSlot[];
  referenceDate: Date;
  horizonStartDate?: Date;
  fixedEvents?: FixedEvent[];
  sickDays?: SickDay[];
  requiredHoursBySubject?: Record<string, number>;
  deadlinePaceHoursBySubject?: Record<string, number>;
  forcedCoverageMinutes?: number;
  usedSundayMinutes?: number;
  effectiveReservedCommitmentDurations?: EffectiveReservedCommitmentDuration[];
  excludedReservedCommitmentRuleIds?: string[];
  unscheduledTasks?: Array<{ subjectId: string | null; remainingMinutes: number }>;
  priorPlannedBlocks?: StudyBlock[];
  cumulativePlannedBlocks?: StudyBlock[];
  preferences?: Preferences;
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
    preferences: options.preferences,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
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
  const overallPlanningDeadline = getLatestPlanningDeadline(
    options.goals,
    options.subjects,
    options.referenceDate,
  );
  const horizonEndDate = toDateKey(overallPlanningDeadline);
  const weeksRemainingToDeadline = Math.max(
    Math.ceil(differenceInCalendarDays(overallPlanningDeadline, options.referenceDate) / 7),
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

    assignedMinutesBySubject[block.subjectId] = (assignedMinutesBySubject[block.subjectId] ?? 0) + block.estimatedMinutes;

    if (block.status === "done" || block.status === "partial") {
      completedMinutesBySubject[block.subjectId] = (completedMinutesBySubject[block.subjectId] ?? 0) + (block.actualMinutes ?? block.estimatedMinutes);
    }
  });

  const capacitySlots = options.capacityFreeSlots ?? options.freeSlots;
  const studyCapacityMinutes = Math.round(
    sum(capacitySlots.map((slot) => slot.durationMinutes)),
  );
  const assignedMinutes = sum(Object.values(assignedMinutesBySubject));
  const requiredMinutes = sum(Object.values(requiredHoursBySubject).map((hours) => hours * 60));
  const recoveryMinutes = options.studyBlocks
    .filter((block) => !block.subjectId)
    .reduce((total, block) => total + block.estimatedMinutes, 0);
  const slackMinutes = Math.max(studyCapacityMinutes - assignedMinutes - recoveryMinutes, 0);
  const assignedStudyMinutesByDay = options.studyBlocks.reduce<Record<string, number>>((accumulator, block) => {
    if (!block.subjectId) {
      return accumulator;
    }

    accumulator[block.date] = (accumulator[block.date] ?? 0) + block.estimatedMinutes;
    return accumulator;
  }, {});
  const baseDayCapByDate = capacitySlots.reduce<Record<string, number>>((accumulator, slot) => {
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

  if (!coverageComplete && slackMinutes === 0) {
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
    effectiveReservedCommitmentDurations: [...(options.effectiveReservedCommitmentDurations ?? [])].sort(
      (left, right) =>
        left.dateKey.localeCompare(right.dateKey) ||
        left.ruleId.localeCompare(right.ruleId),
    ),
    excludedReservedCommitmentRuleIds: Array.from(
      new Set(options.excludedReservedCommitmentRuleIds ?? []),
    ).sort((left, right) => left.localeCompare(right)),
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
  effectiveReservedCommitmentDurations?: EffectiveReservedCommitmentDuration[];
  excludedReservedCommitmentRuleIds?: string[];
  preferences?: Preferences;
}) {
  const requiredHoursBySubject = computeWeeklyRequiredHours({
    subjects: options.subjects,
    goals: options.goals,
    topics: options.topics,
    referenceDate: options.referenceDate,
    preferences: options.preferences,
    weekStartDate: new Date(`${options.weekStart}T00:00:00`),
  });
  const deadlineTracks = computeSubjectDeadlineTracks({
    subjects: options.subjects,
    goals: options.goals,
    topics: options.topics,
    referenceDate: options.referenceDate,
    preferences: options.preferences,
    weekStartDate: new Date(`${options.weekStart}T00:00:00`),
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

    assignedHoursBySubject[block.subjectId] = (assignedHoursBySubject[block.subjectId] ?? 0) + roundToTenth(block.estimatedMinutes / 60);

    if (block.status === "done" || block.status === "partial") {
      completedHoursBySubject[block.subjectId] = (completedHoursBySubject[block.subjectId] ?? 0) + roundToTenth(
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
    effectiveReservedCommitmentDurations: [...(options.effectiveReservedCommitmentDurations ?? [])].sort(
      (left, right) =>
        left.dateKey.localeCompare(right.dateKey) ||
        left.ruleId.localeCompare(right.ruleId),
    ),
    excludedReservedCommitmentRuleIds: Array.from(
      new Set(options.excludedReservedCommitmentRuleIds ?? []),
    ).sort((left, right) => left.localeCompare(right)),
    weeksRemainingToDeadline: Math.max(
      Math.ceil(
        differenceInCalendarDays(
          getLatestPlanningDeadline(options.goals, options.subjects, options.referenceDate),
          options.referenceDate,
        ) / 7,
      ),
      1,
    ),
    horizonEndDate: toDateKey(
      getLatestPlanningDeadline(options.goals, options.subjects, options.referenceDate),
    ),
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
