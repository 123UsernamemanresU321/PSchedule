import {
  visibleCoreSubjectIds,
  zeroUnscheduledCoverageSubjectIds,
} from "@/lib/constants/planner";
import { formatWeekRangeLabel, fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import {
  detectFutureFillableGap,
  getCalendarCompletionForecast,
  getCarryOverBlocks,
  getHorizonCoverageState,
  getPlanningHierarchyMetrics,
  getWeekPressureState,
  getSubjectProgress,
  getWeekBlocks,
  getWeekFillDiagnostics,
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
    .filter((subject) =>
      visibleCoreSubjectIds.includes(subject.id as (typeof visibleCoreSubjectIds)[number]),
    )
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
        remainingMinutes: progress.remainingMinutes,
        scheduledFutureHours: progress.scheduledFutureHours,
        scheduledFutureMinutes: progress.scheduledFutureMinutes,
        unscheduledHours: progress.unscheduledHours,
        unscheduledMinutes: progress.unscheduledMinutes,
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
      zeroUnscheduledCoverageSubjectIds.includes(
        subject.id as (typeof zeroUnscheduledCoverageSubjectIds)[number],
      ),
    )
    .map((subject) => getSubjectProgress(subject, options.topics, options.studyBlocks, referenceDate))
    .filter((progress) => progress.unscheduledMinutes > 0)
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
    goals: options.goals,
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
  const completionForecasts = options.subjects
    .filter((subject) =>
      visibleCoreSubjectIds.includes(subject.id as (typeof visibleCoreSubjectIds)[number]),
    )
    .map((subject) =>
      getCalendarCompletionForecast({
        subject,
        topics: options.topics,
        goals: options.goals,
        studyBlocks: options.studyBlocks,
        weeklyPlans: options.weeklyPlans,
        referenceDate,
      }),
    );
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
    horizonCoverageState: getHorizonCoverageState(completionForecasts),
    weekPressureState: getWeekPressureState(weeklyPlan),
    weeklyPlan: weeklyPlan
      ? {
          riskFlag: weeklyPlan.riskFlag,
          feasibilityWarnings: weeklyPlan.feasibilityWarnings,
          weekCarryForwardSubjectIds: weeklyPlan.weekCarryForwardSubjectIds,
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
    goals: options.goals,
    subjectIds: [...zeroUnscheduledCoverageSubjectIds],
  });

  return {
    ...buildWeeklyReviewAiContext(options),
    selectedWeekPlan: weeklyPlan
      ? {
          requiredHoursBySubject: weeklyPlan.requiredHoursBySubject,
          assignedHoursBySubject: weeklyPlan.assignedHoursBySubject,
          completedHoursBySubject: weeklyPlan.completedHoursBySubject,
          remainingAfterWeekMinutesBySubject: weeklyPlan.remainingAfterWeekMinutesBySubject,
          weekPacingGapMinutesBySubject: weeklyPlan.weekPacingGapMinutesBySubject,
          weekCarryForwardSubjectIds: weeklyPlan.weekCarryForwardSubjectIds,
          fallbackTierUsed: weeklyPlan.fallbackTierUsed,
          overscheduledMinutes: weeklyPlan.overscheduledMinutes,
          weekOverloadMinutes: weeklyPlan.weekOverloadMinutes,
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
          syllabusLevel: options.topic.syllabusLevel ?? null,
          subtopicTags: options.topic.subtopicTags ?? [],
          guideRefs: options.topic.guideRefs ?? [],
          guideSummary: options.topic.guideSummary ?? null,
          selfStudyTargetHours: options.topic.selfStudyTargetHours ?? null,
          difficulty: options.topic.difficulty,
          mastery: options.topic.mastery,
          subtopics: options.topic.subtopics,
        }
      : null,
    upcomingRelatedBlocks,
  };
}

function compactStudyBlock(
  block: StudyBlock,
  topicsById: Map<string, Topic>,
  completionLogsByBlockId: Map<string, CompletionLog>,
) {
  const topic = block.topicId ? topicsById.get(block.topicId) : null;
  const completionLog = completionLogsByBlockId.get(block.id);

  return {
    id: block.id,
    title: block.title,
    date: block.date,
    start: block.start,
    end: block.end,
    subjectId: block.subjectId,
    topicId: block.topicId,
    topicTitle: topic?.title ?? null,
    unitId: topic?.unitId ?? block.unitTitle ?? null,
    unitTitle: topic?.unitTitle ?? block.unitTitle,
    studyLayer: block.studyLayer ?? null,
    blockType: block.blockType,
    status: block.status,
    estimatedMinutes: block.estimatedMinutes,
    actualMinutes: block.actualMinutes,
    notes: ["done", "partial", "missed"].includes(block.status) ? block.notes : "",
    completionLog: completionLog
      ? {
          outcome: completionLog.outcome,
          actualMinutes: completionLog.actualMinutes,
          perceivedDifficulty: completionLog.perceivedDifficulty,
          notes: completionLog.notes,
          recordedAt: completionLog.recordedAt,
        }
      : null,
  };
}

function minutesBetween(start: string, end: string) {
  return Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
}

export function buildBlockPlanContext(options: {
  block: StudyBlock;
  topic: Topic | null | undefined;
  subject: Subject | null;
  topics: Topic[];
  subjects: Subject[];
  goals: Goal[];
  studyBlocks: StudyBlock[];
  completionLogs: CompletionLog[];
  weeklyPlans: WeeklyPlan[];
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const selectedBlockStart = new Date(options.block.start).getTime();
  const selectedBlockEnd = new Date(options.block.end).getTime();
  const topicsById = new Map(options.topics.map((topic) => [topic.id, topic]));
  const completionLogsByBlockId = new Map(
    options.completionLogs.map((completionLog) => [completionLog.studyBlockId, completionLog]),
  );
  const sameSubjectBlocks = options.studyBlocks
    .filter((block) => block.subjectId && block.subjectId === options.block.subjectId)
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());
  const beforeSameSubjectBlocks = sameSubjectBlocks
    .filter((block) => block.id !== options.block.id && new Date(block.end).getTime() <= selectedBlockStart)
    .map((block) => compactStudyBlock(block, topicsById, completionLogsByBlockId));
  const afterSameSubjectBlocks = sameSubjectBlocks
    .filter((block) => block.id !== options.block.id && new Date(block.start).getTime() >= selectedBlockEnd)
    .map((block) => compactStudyBlock(block, topicsById, completionLogsByBlockId));
  const sameUnitBlocks = sameSubjectBlocks.filter((block) => {
    const topic = block.topicId ? topicsById.get(block.topicId) : null;
    return !!options.topic?.unitId && topic?.unitId === options.topic.unitId;
  });
  const sameTopicBlocks = sameSubjectBlocks.filter(
    (block) => !!options.block.topicId && block.topicId === options.block.topicId,
  );
  const futureSameTopicMinutes = sameTopicBlocks
    .filter((block) => block.id !== options.block.id && new Date(block.start).getTime() >= selectedBlockEnd)
    .reduce((total, block) => total + block.estimatedMinutes, 0);
  const pastSameTopicCompletedMinutes = sameTopicBlocks
    .filter((block) => block.id !== options.block.id && new Date(block.end).getTime() <= selectedBlockStart)
    .reduce((total, block) => {
      if (block.status === "done") {
        return total + (block.actualMinutes ?? block.estimatedMinutes);
      }
      if (block.status === "partial") {
        return total + Math.max(0, block.actualMinutes ?? 0);
      }
      return total;
    }, 0);
  const topicTotalMinutes = options.topic ? Math.round(options.topic.estHours * 60) : null;
  const topicCompletedMinutes = options.topic ? Math.round(options.topic.completedHours * 60) : null;
  const topicRemainingMinutes =
    topicTotalMinutes !== null && topicCompletedMinutes !== null
      ? Math.max(0, topicTotalMinutes - topicCompletedMinutes)
      : null;
  const blockDurationMinutes =
    options.block.estimatedMinutes || minutesBetween(options.block.start, options.block.end);
  const minimumProgressThisBlockMinutes =
    topicRemainingMinutes === null
      ? null
      : Math.min(
          blockDurationMinutes,
          Math.max(0, topicRemainingMinutes - futureSameTopicMinutes),
        );
  const stretchProgressThisBlockMinutes =
    topicRemainingMinutes === null ? null : Math.min(blockDurationMinutes, topicRemainingMinutes);
  const subjectGoal = options.subject
    ? options.goals
        .filter((goal) => goal.subjectId === options.subject?.id)
        .sort((left, right) => new Date(left.deadline).getTime() - new Date(right.deadline).getTime())[0] ?? null
    : null;
  const weeklyPlan = getWeeklyPlan(
    options.weeklyPlans,
    toDateKey(startOfPlannerWeek(new Date(options.block.start))),
  );

  return {
    generatedAt: new Date().toISOString(),
    referenceDate: referenceDate.toISOString(),
    selectedBlock: {
      id: options.block.id,
      title: options.block.title,
      date: options.block.date,
      start: options.block.start,
      end: options.block.end,
      durationMinutes: blockDurationMinutes,
      studyLayer: options.block.studyLayer ?? null,
      blockType: options.block.blockType,
      intensity: options.block.intensity,
      sessionSummary: options.block.sessionSummary,
      generatedReason: options.block.generatedReason,
      sourceMaterials: options.block.sourceMaterials,
    },
    subject: options.subject
      ? {
          id: options.subject.id,
          label: options.subject.shortName,
          name: options.subject.name,
          description: options.subject.description,
          deadline: options.subject.deadline,
        }
      : null,
    topic: options.topic
      ? {
          id: options.topic.id,
          title: options.topic.title,
          unitId: options.topic.unitId,
          unitTitle: options.topic.unitTitle,
          syllabusLevel: options.topic.syllabusLevel ?? null,
          subtopics: options.topic.subtopics,
          subtopicTags: options.topic.subtopicTags ?? [],
          guideRefs: options.topic.guideRefs ?? [],
          guideSummary: options.topic.guideSummary ?? null,
          officialTeachingHours: options.topic.officialTeachingHours ?? null,
          selfStudyTargetHours: options.topic.selfStudyTargetHours ?? null,
          difficulty: options.topic.difficulty,
          mastery: options.topic.mastery,
          estHours: options.topic.estHours,
          completedHours: options.topic.completedHours,
          sourceMaterials: options.topic.sourceMaterials,
          dependsOnTopicId: options.topic.dependsOnTopicId ?? null,
        }
      : null,
    activeDeadline: subjectGoal
      ? {
          title: subjectGoal.title,
          deadline: subjectGoal.deadline,
          targetCompletion: subjectGoal.targetCompletion,
        }
      : null,
    pace: {
      topicTotalMinutes,
      topicCompletedMinutes,
      topicRemainingMinutes,
      pastSameTopicCompletedMinutes,
      futureSameTopicScheduledMinutes: futureSameTopicMinutes,
      minimumProgressThisBlockMinutes,
      stretchProgressThisBlockMinutes,
      remainingAfterMinimumMinutes:
        topicRemainingMinutes === null || minimumProgressThisBlockMinutes === null
          ? null
          : Math.max(0, topicRemainingMinutes - minimumProgressThisBlockMinutes),
      selectedWeekAssignedHours:
        options.block.subjectId && weeklyPlan
          ? weeklyPlan.assignedHoursBySubject[options.block.subjectId] ?? 0
          : null,
      selectedWeekCarryForward:
        options.block.subjectId && weeklyPlan
          ? weeklyPlan.weekCarryForwardSubjectIds.includes(options.block.subjectId)
          : false,
    },
    sameSubjectBlocks: {
      before: beforeSameSubjectBlocks,
      after: afterSameSubjectBlocks,
    },
    sameUnitBlocks: {
      before: sameUnitBlocks
        .filter((block) => block.id !== options.block.id && new Date(block.end).getTime() <= selectedBlockStart)
        .map((block) => compactStudyBlock(block, topicsById, completionLogsByBlockId)),
      after: sameUnitBlocks
        .filter((block) => block.id !== options.block.id && new Date(block.start).getTime() >= selectedBlockEnd)
        .map((block) => compactStudyBlock(block, topicsById, completionLogsByBlockId)),
    },
    sameTopicBlocks: {
      before: sameTopicBlocks
        .filter((block) => block.id !== options.block.id && new Date(block.end).getTime() <= selectedBlockStart)
        .map((block) => compactStudyBlock(block, topicsById, completionLogsByBlockId)),
      after: sameTopicBlocks
        .filter((block) => block.id !== options.block.id && new Date(block.start).getTime() >= selectedBlockEnd)
        .map((block) => compactStudyBlock(block, topicsById, completionLogsByBlockId)),
    },
    priorCompletionLogs: options.completionLogs
      .filter((completionLog) => {
        const block = options.studyBlocks.find((candidate) => candidate.id === completionLog.studyBlockId);
        return (
          !!block &&
          block.subjectId === options.block.subjectId &&
          new Date(block.end).getTime() <= selectedBlockStart
        );
      })
      .map((completionLog) => ({
        outcome: completionLog.outcome,
        actualMinutes: completionLog.actualMinutes,
        perceivedDifficulty: completionLog.perceivedDifficulty,
        notes: completionLog.notes,
        recordedAt: completionLog.recordedAt,
      })),
    guardrails: [
      "Use only this compact planner and guide context.",
      "Do not assign full timed IB papers before the planner has scheduled them.",
      "Do not plan correction/error-log work for content that has no prior learning or attempt evidence.",
      "Do not over-plan material that already has future same-topic blocks.",
      "If guide metadata is missing, state the uncertainty in warnings instead of inventing details.",
    ],
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
