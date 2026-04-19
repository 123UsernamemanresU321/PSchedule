import { hardScopeSubjectIds, mainSubjectIds } from "@/lib/constants/planner";
import { formatWeekRangeLabel, fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import {
  detectFutureFillableGap,
  getCalendarCompletionForecast,
  getCarryOverBlocks,
  getPlanningHierarchyMetrics,
  getSubjectProgress,
  getWeekBlocks,
  getWeekFillDiagnostics,
  getWeeklyCoverageState,
  getWeeklyPlan,
} from "@/lib/analytics/metrics";
import type {
  CompletionLog,
  FixedEvent,
  FocusedDay,
  FocusedWeek,
  Goal,
  PlannerExportPayload,
  Preferences,
  SickDay,
  StudyBlock,
  Subject,
  Topic,
  WeeklyPlan,
} from "@/lib/types/planner";

export function buildPlannerSnapshot(options: {
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  fixedEvents: FixedEvent[];
  sickDays: SickDay[];
  focusedDays: FocusedDay[];
  focusedWeeks: FocusedWeek[];
  studyBlocks: StudyBlock[];
  completionLogs: CompletionLog[];
  weeklyPlans: WeeklyPlan[];
  preferences: Preferences;
}): PlannerExportPayload {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    goals: options.goals,
    subjects: options.subjects,
    topics: options.topics,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
    focusedDays: options.focusedDays,
    focusedWeeks: options.focusedWeeks,
    studyBlocks: options.studyBlocks,
    completionLogs: options.completionLogs,
    weeklyPlans: options.weeklyPlans,
    preferences: options.preferences,
  };
}

function buildTrackedProgress(options: {
  subjects: Subject[];
  topics: Topic[];
  studyBlocks: StudyBlock[];
  weeklyPlans: WeeklyPlan[];
  goals: Goal[];
  referenceDate: Date;
}) {
  return options.subjects
    .filter((subject) => mainSubjectIds.includes(subject.id as (typeof mainSubjectIds)[number]))
    .map((subject) => {
      const progress = getSubjectProgress(subject, options.topics, options.studyBlocks, options.referenceDate);
      const forecast = getCalendarCompletionForecast({
        subject,
        topics: options.topics,
        goals: options.goals,
        studyBlocks: options.studyBlocks,
        weeklyPlans: options.weeklyPlans,
        referenceDate: options.referenceDate,
      });

      return {
        subjectId: subject.id,
        subjectLabel: subject.shortName,
        remainingHours: progress.remainingHours,
        scheduledFutureHours: progress.scheduledFutureHours,
        unscheduledHours: progress.unscheduledHours,
        completionPercent: progress.completionPercent,
        milestoneDeadline: forecast.milestoneDeadline,
        finalDeadline: forecast.deadline,
        projectedCompletionDate:
          forecast.completionDate?.toISOString() ??
          forecast.horizonCompletionDate?.toISOString() ??
          null,
        isOnTrack: forecast.isOnTrack,
        isCalendarImpossible: forecast.isCalendarImpossible,
      };
    });
}

export function getHardCoverageFailures(options: {
  subjects: Subject[];
  topics: Topic[];
  studyBlocks: StudyBlock[];
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();

  return options.subjects
    .filter((subject) =>
      hardScopeSubjectIds.includes(subject.id as (typeof hardScopeSubjectIds)[number]),
    )
    .map((subject) => getSubjectProgress(subject, options.topics, options.studyBlocks, referenceDate))
    .filter((progress) => progress.unscheduledHours > 0.1)
    .map((progress) => progress.subject.shortName);
}

export function buildWeeklyReviewAiContext(options: {
  currentWeekStart: string;
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  studyBlocks: StudyBlock[];
  weeklyPlans: WeeklyPlan[];
  fixedEvents: FixedEvent[];
  sickDays: SickDay[];
  completionLogs: CompletionLog[];
  preferences: Preferences;
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const visibleWeekStart = startOfPlannerWeek(fromDateKey(options.currentWeekStart));
  const weeklyPlan = getWeeklyPlan(options.weeklyPlans, options.currentWeekStart);
  const fillDiagnostics = getWeekFillDiagnostics({
    weekStart: options.currentWeekStart,
    subjects: options.subjects,
    topics: options.topics,
    studyBlocks: options.studyBlocks,
    weeklyPlans: options.weeklyPlans,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
    completionLogs: options.completionLogs,
    preferences: options.preferences,
    referenceDate,
  });
  const hierarchyMetrics = getPlanningHierarchyMetrics({
    subjects: options.subjects,
    topics: options.topics,
    goals: options.goals,
    studyBlocks: options.studyBlocks,
    weeklyPlans: options.weeklyPlans,
    referenceDate,
  });
  const carryOverBlocks = getCarryOverBlocks(
    getWeekBlocks(options.studyBlocks, options.currentWeekStart),
  ).map((block) => ({
    title: block.title,
    subjectId: block.subjectId,
    status: block.status,
    minutes: block.estimatedMinutes,
  }));

  return {
    generatedAt: new Date().toISOString(),
    referenceDate: referenceDate.toISOString(),
    weekStart: options.currentWeekStart,
    weekLabel: formatWeekRangeLabel(visibleWeekStart),
    hierarchyMetrics,
    trackedSubjects: buildTrackedProgress({
      subjects: options.subjects,
      topics: options.topics,
      studyBlocks: options.studyBlocks,
      weeklyPlans: options.weeklyPlans,
      goals: options.goals,
      referenceDate,
    }),
    weeklyCoverageState: getWeeklyCoverageState(weeklyPlan),
    weeklyPlan: weeklyPlan
      ? {
          riskFlag: weeklyPlan.riskFlag,
          feasibilityWarnings: weeklyPlan.feasibilityWarnings,
          underplannedSubjectIds: weeklyPlan.underplannedSubjectIds,
          fillableGapDateKeys: weeklyPlan.fillableGapDateKeys,
          replanDiagnostics: weeklyPlan.replanDiagnostics ?? null,
        }
      : null,
    fillDiagnostics: fillDiagnostics.map((entry) => ({
      dateKey: entry.dateKey,
      plannedHours: entry.plannedHours,
      completedHours: entry.completedHours,
      openHours: entry.openHours,
      blankReason: entry.blankReason,
      fillableGapDetected: entry.fillableGapDetected,
    })),
    carryOverBlocks,
    hardCoverageFailures: getHardCoverageFailures({
      subjects: options.subjects,
      topics: options.topics,
      studyBlocks: options.studyBlocks,
      referenceDate,
    }),
  };
}

export function buildDiagnosisAiContext(options: {
  currentWeekStart: string;
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  studyBlocks: StudyBlock[];
  weeklyPlans: WeeklyPlan[];
  fixedEvents: FixedEvent[];
  sickDays: SickDay[];
  completionLogs: CompletionLog[];
  preferences: Preferences;
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const weeklyPlan = getWeeklyPlan(options.weeklyPlans, options.currentWeekStart);
  const futureGap = detectFutureFillableGap({
    subjects: options.subjects,
    topics: options.topics,
    studyBlocks: options.studyBlocks,
    weeklyPlans: options.weeklyPlans,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
    completionLogs: options.completionLogs,
    preferences: options.preferences,
    referenceDate,
  });

  return {
    ...buildWeeklyReviewAiContext(options),
    selectedWeekPlan: weeklyPlan
      ? {
          requiredHoursBySubject: weeklyPlan.requiredHoursBySubject,
          assignedHoursBySubject: weeklyPlan.assignedHoursBySubject,
          completedHoursBySubject: weeklyPlan.completedHoursBySubject,
          hardCoverageSatisfiedBySubject: weeklyPlan.hardCoverageSatisfiedBySubject,
          fallbackTierUsed: weeklyPlan.fallbackTierUsed,
          overscheduledMinutes: weeklyPlan.overscheduledMinutes,
          overloadMinutes: weeklyPlan.overloadMinutes,
        }
      : null,
    futureGap,
  };
}

export function buildEventParseContext(options: {
  currentWeekStart: string;
  timezone: string;
  subjects: Subject[];
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();

  return {
    referenceDate: referenceDate.toISOString(),
    currentWeekStart: options.currentWeekStart,
    currentWeekLabel: formatWeekRangeLabel(startOfPlannerWeek(fromDateKey(options.currentWeekStart))),
    timezone: options.timezone,
    subjects: options.subjects.map((subject) => ({
      id: subject.id,
      label: subject.shortName,
    })),
  };
}

export function buildBlockBriefContext(options: {
  block: StudyBlock;
  topic: Topic | null | undefined;
  subject: Subject | null;
  studyBlocks: StudyBlock[];
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const upcomingRelatedBlocks = options.studyBlocks
    .filter((block) => block.topicId && block.topicId === options.block.topicId)
    .filter((block) => new Date(block.start).getTime() >= referenceDate.getTime())
    .slice(0, 3)
    .map((block) => ({
      title: block.title,
      start: block.start,
      status: block.status,
      estimatedMinutes: block.estimatedMinutes,
    }));

  return {
    referenceDate: referenceDate.toISOString(),
    block: {
      title: options.block.title,
      sessionSummary: options.block.sessionSummary,
      studyLayer: options.block.studyLayer ?? null,
      blockType: options.block.blockType,
      estimatedMinutes: options.block.estimatedMinutes,
      generatedReason: options.block.generatedReason,
      sourceMaterials: options.block.sourceMaterials,
    },
    subject: options.subject
      ? {
          id: options.subject.id,
          label: options.subject.shortName,
          description: options.subject.description,
        }
      : null,
    topic: options.topic
      ? {
          title: options.topic.title,
          unitTitle: options.topic.unitTitle,
          difficulty: options.topic.difficulty,
          mastery: options.topic.mastery,
          subtopics: options.topic.subtopics,
        }
      : null,
    upcomingRelatedBlocks,
  };
}

export function buildWhatIfContext(options: {
  scenario: string;
  snapshot: PlannerExportPayload;
  currentWeekStart?: string;
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();

  return {
    scenario: options.scenario,
    referenceDate: referenceDate.toISOString(),
    currentWeekStart:
      options.currentWeekStart ?? toDateKey(startOfPlannerWeek(referenceDate)),
    trackedSubjects: buildTrackedProgress({
      subjects: options.snapshot.subjects,
      topics: options.snapshot.topics,
      studyBlocks: options.snapshot.studyBlocks,
      weeklyPlans: options.snapshot.weeklyPlans,
      goals: options.snapshot.goals,
      referenceDate,
    }),
    reservedCommitmentRules: options.snapshot.preferences.reservedCommitmentRules.map((rule) => ({
      id: rule.id,
      label: rule.label,
      durationMinutes: rule.durationMinutes,
      preferredStart: rule.preferredStart,
      days: rule.days,
      appliesDuring: rule.appliesDuring,
    })),
  };
}
