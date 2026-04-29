import { zeroUnscheduledCoverageSubjectIds } from "@/lib/constants/planner";
import { fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import {
  detectFutureFillableGap,
  getCalendarCompletionForecast,
  getSubjectProgress,
} from "@/lib/analytics/metrics";
import { generateStudyPlanHorizon } from "@/lib/scheduler/generator";
import type { PlannerExportPayload, ReservedCommitmentRule } from "@/lib/types/planner";
import { createId } from "@/lib/utils";

import type { AiWhatIfChange } from "@/lib/ai/contracts";

function cloneSnapshot(snapshot: PlannerExportPayload) {
  return JSON.parse(JSON.stringify(snapshot)) as PlannerExportPayload;
}

function getForecastStatus(forecast: ReturnType<typeof getCalendarCompletionForecast>) {
  if (forecast.isCalendarImpossible) {
    return "calendar-impossible";
  }

  if (forecast.isOnTrack) {
    return "on-track";
  }

  if (forecast.isFullyScheduled) {
    return "past-deadline";
  }

  return "needs-more-blocks";
}

function applyReservedCommitmentRulePatch(
  rules: ReservedCommitmentRule[],
  change: Extract<AiWhatIfChange, { kind: "reserved_commitment_rule_patch" }>,
) {
  return rules.map((rule) =>
    rule.id === change.ruleId
      ? {
          ...rule,
          durationMinutes: change.durationMinutes ?? rule.durationMinutes,
          preferredStart: change.preferredStart ?? rule.preferredStart,
          days: change.days ?? rule.days,
        }
      : rule,
  );
}

function applyChanges(snapshot: PlannerExportPayload, changes: AiWhatIfChange[]) {
  const nextSnapshot = cloneSnapshot(snapshot);
  const parsedChanges: string[] = [];

  changes.forEach((change) => {
    switch (change.kind) {
      case "fixed_event_add":
        nextSnapshot.fixedEvents.push({
          id: createId("event"),
          ...change.event,
        });
        parsedChanges.push(`Add fixed event: ${change.event.title}`);
        break;
      case "focused_day_add":
        nextSnapshot.focusedDays.push({
          id: createId("focus-day"),
          ...change.focusedDay,
        });
        parsedChanges.push(`Focus day on ${change.focusedDay.date}`);
        break;
      case "focused_week_add":
        nextSnapshot.focusedWeeks.push({
          id: createId("focus-week"),
          ...change.focusedWeek,
        });
        parsedChanges.push(`Focus week starting ${change.focusedWeek.weekStart}`);
        break;
      case "reserved_commitment_rule_patch":
        nextSnapshot.preferences = {
          ...nextSnapshot.preferences,
          reservedCommitmentRules: applyReservedCommitmentRulePatch(
            nextSnapshot.preferences.reservedCommitmentRules,
            change,
          ),
        };
        parsedChanges.push(`Adjust commitment rule: ${change.ruleId}`);
        break;
      case "subject_weight_override":
        nextSnapshot.preferences = {
          ...nextSnapshot.preferences,
          subjectWeightOverrides: {
            ...nextSnapshot.preferences.subjectWeightOverrides,
            [change.subjectId]: change.weight,
          },
        };
        parsedChanges.push(`Override subject weight: ${change.subjectId}`);
        break;
      case "sick_day_add":
        nextSnapshot.sickDays.push({
          id: createId("sick"),
          ...change.sickDay,
        });
        parsedChanges.push(`Add sick day from ${change.sickDay.startDate} to ${change.sickDay.endDate}`);
        break;
      default:
        break;
    }
  });

  return {
    snapshot: nextSnapshot,
    parsedChanges,
  };
}

function getHardCoverageFailures(snapshot: PlannerExportPayload, referenceDate: Date) {
  return snapshot.subjects
    .filter((subject) =>
      zeroUnscheduledCoverageSubjectIds.includes(
        subject.id as (typeof zeroUnscheduledCoverageSubjectIds)[number],
      ),
    )
    .map((subject) => getSubjectProgress(subject, snapshot.topics, snapshot.studyBlocks, referenceDate))
    .filter((progress) => progress.unscheduledMinutes > 0)
    .map((progress) => progress.subject.shortName);
}

function buildImpacts(options: {
  before: PlannerExportPayload;
  after: PlannerExportPayload;
  referenceDate: Date;
}) {
  return options.before.subjects
    .filter((subject) =>
      zeroUnscheduledCoverageSubjectIds.includes(
        subject.id as (typeof zeroUnscheduledCoverageSubjectIds)[number],
      ),
    )
    .map((subject) => {
      const beforeProgress = getSubjectProgress(
        subject,
        options.before.topics,
        options.before.studyBlocks,
        options.referenceDate,
      );
      const afterProgress = getSubjectProgress(
        subject,
        options.after.topics,
        options.after.studyBlocks,
        options.referenceDate,
      );
      const beforeForecast = getCalendarCompletionForecast({
        subject,
        topics: options.before.topics,
        goals: options.before.goals,
        studyBlocks: options.before.studyBlocks,
        weeklyPlans: options.before.weeklyPlans,
        referenceDate: options.referenceDate,
      });
      const afterForecast = getCalendarCompletionForecast({
        subject,
        topics: options.after.topics,
        goals: options.after.goals,
        studyBlocks: options.after.studyBlocks,
        weeklyPlans: options.after.weeklyPlans,
        referenceDate: options.referenceDate,
      });

      return {
        subjectId: subject.id,
        subjectLabel: subject.shortName,
        beforeStatus: getForecastStatus(beforeForecast),
        afterStatus: getForecastStatus(afterForecast),
        beforeCompletionDate:
          beforeForecast.completionDate?.toISOString() ??
          beforeForecast.horizonCompletionDate?.toISOString() ??
          null,
        afterCompletionDate:
          afterForecast.completionDate?.toISOString() ??
          afterForecast.horizonCompletionDate?.toISOString() ??
          null,
        beforeUnscheduledHours: beforeProgress.unscheduledHours,
        afterUnscheduledHours: afterProgress.unscheduledHours,
        beforeUnscheduledMinutes: beforeProgress.unscheduledMinutes,
        afterUnscheduledMinutes: afterProgress.unscheduledMinutes,
      };
    });
}

export function simulateWhatIf(options: {
  snapshot: PlannerExportPayload;
  changes: AiWhatIfChange[];
  currentWeekStart?: string;
  referenceDate?: Date;
}) {
  const referenceDate = options.referenceDate ?? new Date();
  const currentWeekStart =
    options.currentWeekStart ?? toDateKey(startOfPlannerWeek(referenceDate));
  const beforeGap = detectFutureFillableGap({
    subjects: options.snapshot.subjects,
    topics: options.snapshot.topics,
    studyBlocks: options.snapshot.studyBlocks,
    weeklyPlans: options.snapshot.weeklyPlans,
    fixedEvents: options.snapshot.fixedEvents,
    sickDays: options.snapshot.sickDays,
    completionLogs: options.snapshot.completionLogs,
    preferences: options.snapshot.preferences,
    referenceDate,
    subjectIds: [...zeroUnscheduledCoverageSubjectIds],
  });
  const { snapshot: adjustedSnapshot, parsedChanges } = applyChanges(options.snapshot, options.changes);
  const regenerated = generateStudyPlanHorizon({
    startWeek: startOfPlannerWeek(fromDateKey(currentWeekStart)),
    referenceDate,
    goals: adjustedSnapshot.goals,
    subjects: adjustedSnapshot.subjects,
    topics: adjustedSnapshot.topics,
    completionLogs: adjustedSnapshot.completionLogs,
    fixedEvents: adjustedSnapshot.fixedEvents,
    sickDays: adjustedSnapshot.sickDays,
    focusedDays: adjustedSnapshot.focusedDays,
    focusedWeeks: adjustedSnapshot.focusedWeeks,
    preferences: adjustedSnapshot.preferences,
    existingStudyBlocks: adjustedSnapshot.studyBlocks,
    preserveFlexibleFutureBlocks: false,
  });

  const afterSnapshot: PlannerExportPayload = {
    ...adjustedSnapshot,
    studyBlocks: regenerated.studyBlocks,
    weeklyPlans: regenerated.weeklyPlans,
  };
  const afterGap = detectFutureFillableGap({
    subjects: afterSnapshot.subjects,
    topics: afterSnapshot.topics,
    studyBlocks: afterSnapshot.studyBlocks,
    weeklyPlans: afterSnapshot.weeklyPlans,
    fixedEvents: afterSnapshot.fixedEvents,
    sickDays: afterSnapshot.sickDays,
    completionLogs: afterSnapshot.completionLogs,
    preferences: afterSnapshot.preferences,
    referenceDate,
    subjectIds: [...zeroUnscheduledCoverageSubjectIds],
  });

  return {
    parsedChanges,
    beforeGap,
    afterGap,
    beforeHardCoverageFailures: getHardCoverageFailures(options.snapshot, referenceDate),
    afterHardCoverageFailures: getHardCoverageFailures(afterSnapshot, referenceDate),
    impacts: buildImpacts({
      before: options.snapshot,
      after: afterSnapshot,
      referenceDate,
    }),
    afterSnapshot,
  };
}
