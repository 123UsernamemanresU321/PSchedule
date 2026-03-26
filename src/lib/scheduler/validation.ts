import { differenceInCalendarDays } from "date-fns";

import {
  expandPlannerFixedEventsForWeek,
  expandLockedRecoveryWindowsForWeek,
  expandReservedCommitmentWindowsForWeek,
  studyBlockOverlapsFixedEvent,
} from "@/lib/scheduler/free-slots";
import {
  getOlympiadNumberTheoryEligibilityStatus,
  getOlympiadStageGateStatus,
  isOlympiadNumberTheoryFoundationTopic,
} from "@/lib/scheduler/olympiad-stage-gates";
import { startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import type { FixedEvent, Preferences, SickDay, StudyBlock, Topic, WeeklyPlan } from "@/lib/types/planner";

export interface PlannerValidationIssue {
  code:
    | "overlap"
    | "dependency-coverage-order-violation"
    | "missing-review-dependency"
    | "review-window-violation"
    | "unused-capacity-with-gap"
    | "olympiad-frontier-gap"
    | "olympiad-empty-week";
  message: string;
  severity: "error" | "warning";
  subjectId?: string;
  topicId?: string;
  weekStart?: string;
  blockId?: string;
}

export function validateGeneratedHorizon(options: {
  studyBlocks: StudyBlock[];
  topics: Topic[];
  weeklyPlans: WeeklyPlan[];
  fixedEvents?: FixedEvent[];
  preferences?: Preferences;
  sickDays?: SickDay[];
  referenceDate?: Date;
}) {
  const issues: PlannerValidationIssue[] = [];
  const topicById = new Map(options.topics.map((topic) => [topic.id, topic]));
  const referenceDate = options.referenceDate ?? null;
  const firstPlannedWeekStart = [...options.weeklyPlans]
    .sort((left, right) => left.weekStart.localeCompare(right.weekStart))[0]?.weekStart ?? null;
  const futureHorizonStartMs = firstPlannedWeekStart
    ? new Date(`${firstPlannedWeekStart}T00:00:00`).getTime()
    : Number.NEGATIVE_INFINITY;
  const plannedFutureMinutesByTopic = options.studyBlocks.reduce<Record<string, number>>(
    (accumulator, block) => {
      if (
        !block.topicId ||
        !["planned", "rescheduled"].includes(block.status) ||
        new Date(block.end).getTime() < futureHorizonStartMs
      ) {
        return accumulator;
      }

      accumulator[block.topicId] = (accumulator[block.topicId] ?? 0) + block.estimatedMinutes;
      return accumulator;
    },
    {},
  );
  const blocksByDate = options.studyBlocks.reduce<Record<string, StudyBlock[]>>((accumulator, block) => {
    const current = accumulator[block.date] ?? [];
    current.push(block);
    accumulator[block.date] = current;
    return accumulator;
  }, {});

  Object.values(blocksByDate).forEach((blocks) => {
    const orderedBlocks = [...blocks].sort(
      (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
    );

    orderedBlocks.forEach((block, index) => {
      const nextBlock = orderedBlocks[index + 1];

      if (!nextBlock) {
        return;
      }

      if (new Date(block.end).getTime() > new Date(nextBlock.start).getTime()) {
        issues.push({
          code: "overlap",
          severity: "error",
          blockId: block.id,
          weekStart: block.weekStart,
          message: `Blocks ${block.id} and ${nextBlock.id} overlap on ${block.date}.`,
        });
      }
    });
  });

  if (options.fixedEvents && options.preferences) {
    const relevantWeekStarts = Array.from(
      new Set(
        options.studyBlocks
          .filter((block) => !referenceDate || new Date(block.end).getTime() > referenceDate.getTime())
          .map((block) => block.weekStart || toDateKey(startOfPlannerWeek(new Date(block.start)))),
      ),
    );

    relevantWeekStarts.forEach((weekStartKey) => {
      const weekStart = new Date(`${weekStartKey}T00:00:00`);
      const reservedCommitments = expandReservedCommitmentWindowsForWeek(
        weekStart,
        options.preferences!,
        options.fixedEvents!,
        options.sickDays ?? [],
      );
      const recoveryWindows = expandLockedRecoveryWindowsForWeek(
        weekStart,
        options.preferences!,
        options.fixedEvents!,
        options.sickDays ?? [],
        [],
      );
      const plannerControlledWindows = [
        ...reservedCommitments.map((window) => ({
          id: window.id,
          label: window.label,
          start: new Date(window.start),
          end: new Date(window.end),
        })),
        ...recoveryWindows.map((window) => ({
          id: window.id,
          label: window.label,
          start: new Date(window.start),
          end: new Date(window.end),
        })),
      ].filter((window) => !referenceDate || window.end.getTime() > referenceDate.getTime());
      const fixedEventWindows = expandPlannerFixedEventsForWeek(
        weekStart,
        options.fixedEvents!,
        options.preferences!,
      ).map((event) => ({
        id: event.id,
        label: event.title,
        start: new Date(event.start),
        end: new Date(event.end),
      }));

      const overlapBetween = (
        left: { start: Date; end: Date },
        right: { start: Date; end: Date },
      ) => left.start.getTime() < right.end.getTime() && left.end.getTime() > right.start.getTime();

      plannerControlledWindows
        .sort((left, right) => left.start.getTime() - right.start.getTime())
        .forEach((window, index, windows) => {
          const nextWindow = windows[index + 1];
          if (!nextWindow || !overlapBetween(window, nextWindow)) {
            return;
          }

          issues.push({
            code: "overlap",
            severity: "error",
            weekStart: weekStartKey,
            message: `Planner-controlled windows ${window.label} and ${nextWindow.label} overlap during ${weekStartKey}.`,
          });
        });

      plannerControlledWindows.forEach((window) => {
        const overlappingFixedEvent = fixedEventWindows.find((event) => overlapBetween(window, event));

        if (!overlappingFixedEvent) {
          return;
        }

        issues.push({
          code: "overlap",
          severity: "error",
          weekStart: weekStartKey,
          message: `Planner-controlled window ${window.label} overlaps fixed event ${overlappingFixedEvent.label} during ${weekStartKey}.`,
        });
      });

      options.studyBlocks
        .filter((block) => {
          const blockWeekStart = block.weekStart || toDateKey(startOfPlannerWeek(new Date(block.start)));
          if (blockWeekStart !== weekStartKey) {
            return false;
          }

          return !referenceDate || new Date(block.end).getTime() > referenceDate.getTime();
        })
        .forEach((block) => {
          if (
            studyBlockOverlapsFixedEvent(block, options.fixedEvents!, weekStart, options.preferences!)
          ) {
            issues.push({
              code: "overlap",
              severity: "error",
              blockId: block.id,
              weekStart: weekStartKey,
              subjectId: block.subjectId ?? undefined,
              topicId: block.topicId ?? undefined,
              message: `Block ${block.id} overlaps a fixed or all-day event during ${block.date}.`,
            });
          }

          const blockStart = new Date(block.start);
          const blockEnd = new Date(block.end);
          const overlappingWindow = plannerControlledWindows.find((window) =>
            overlapBetween({ start: blockStart, end: blockEnd }, window),
          );

          if (!overlappingWindow) {
            return;
          }

          issues.push({
            code: "overlap",
            severity: "error",
            blockId: block.id,
            weekStart: weekStartKey,
            subjectId: block.subjectId ?? undefined,
            topicId: block.topicId ?? undefined,
            message: `Block ${block.id} overlaps planner-controlled time (${overlappingWindow.label}) on ${block.date}.`,
          });
        });
    });
  }

  options.studyBlocks.forEach((block) => {
    if (!block.topicId) {
      return;
    }

    const topic = topicById.get(block.topicId);

    const stageGateStatus = getOlympiadStageGateStatus({
      topic,
      topics: options.topics,
      blocks: options.studyBlocks,
      cutoff: new Date(block.start),
    });

    if (stageGateStatus.blocked) {
      issues.push({
        code: "dependency-coverage-order-violation",
        severity: "error",
        blockId: block.id,
        topicId: block.topicId,
        subjectId: block.subjectId ?? undefined,
        message: `Block ${block.id} starts before Olympiad foundations are fully covered earlier on the calendar.`,
      });
      return;
    }

    const ntFrontierStatus = getOlympiadNumberTheoryEligibilityStatus({
      topic,
      topics: options.topics,
      blocks: options.studyBlocks,
      cutoff: new Date(block.start),
    });

    if (
      ntFrontierStatus.blocked ||
      (ntFrontierStatus.availableAt &&
        ntFrontierStatus.availableAt.getTime() > new Date(block.start).getTime())
    ) {
      issues.push({
        code: "dependency-coverage-order-violation",
        severity: "error",
        blockId: block.id,
        topicId: block.topicId,
        subjectId: block.subjectId ?? undefined,
        message: `Block ${block.id} starts before the current Number Theory foundation frontier is fully covered earlier on the calendar.`,
      });
      return;
    }

    if (!topic?.dependsOnTopicId) {
      return;
    }

    const dependencyBlocks = options.studyBlocks
      .filter((candidate) => candidate.topicId === topic.dependsOnTopicId)
      .sort((left, right) => new Date(left.end).getTime() - new Date(right.end).getTime());
    const dependencyBlocksBeforeBlock = dependencyBlocks.filter(
      (candidate) => new Date(candidate.end).getTime() <= new Date(block.start).getTime(),
    );
    const dependencyBlock = dependencyBlocksBeforeBlock[dependencyBlocksBeforeBlock.length - 1] ??
      dependencyBlocks[dependencyBlocks.length - 1];

    if (!dependencyBlock) {
      issues.push({
        code: "missing-review-dependency",
        severity: "error",
        blockId: block.id,
        topicId: block.topicId,
        subjectId: block.subjectId ?? undefined,
        message: `Block ${block.id} is scheduled without its required dependency ${topic.dependsOnTopicId}.`,
      });
      return;
    }

    const requiresDependencyCompletion =
      topic.minDaysAfterDependency == null && topic.maxDaysAfterDependency == null;

    if (requiresDependencyCompletion) {
      const coveredDependencyMinutes = Math.round((topicById.get(topic.dependsOnTopicId)?.completedHours ?? 0) * 60) +
        dependencyBlocksBeforeBlock
          .reduce((total, candidate) => total + candidate.estimatedMinutes, 0);
      const requiredDependencyMinutes = Math.round(
        (topicById.get(topic.dependsOnTopicId)?.estHours ?? 0) * 60,
      );

      if (coveredDependencyMinutes < requiredDependencyMinutes) {
        issues.push({
          code: "dependency-coverage-order-violation",
          severity: "error",
          blockId: block.id,
          topicId: block.topicId,
          subjectId: block.subjectId ?? undefined,
          message: `Block ${block.id} starts before ${topic.dependsOnTopicId} is fully covered earlier on the calendar.`,
        });
        return;
      }
    }

    const daysAfterDependency = differenceInCalendarDays(
      new Date(block.start),
      new Date(dependencyBlock.end),
    );
    const minDays = topic.minDaysAfterDependency ?? 0;
    const maxDays = topic.maxDaysAfterDependency ?? Number.POSITIVE_INFINITY;

    if (daysAfterDependency < minDays || daysAfterDependency > maxDays) {
      issues.push({
        code: "review-window-violation",
        severity: "error",
        blockId: block.id,
        topicId: block.topicId,
        subjectId: block.subjectId ?? undefined,
        message: `Block ${block.id} is ${daysAfterDependency} day(s) after ${topic.dependsOnTopicId}; expected ${minDays}-${maxDays} day(s).`,
      });
    }
  });

  options.weeklyPlans.forEach((plan) => {
    if (plan.slackMinutes <= 0) {
      return;
    }

    Object.entries(plan.coverageGapHoursBySubject).forEach(([subjectId, gapHours]) => {
      if (gapHours <= 0.1) {
        return;
      }

      issues.push({
        code: "unused-capacity-with-gap",
        severity: "warning",
        weekStart: plan.weekStart,
        subjectId,
        message: `${subjectId} still has a ${gapHours.toFixed(1)}h coverage gap during ${plan.weekStart} even though ${plan.slackMinutes} minutes of capacity remain.`,
      });
    });
  });

  const hasFutureOlympiadCapacity = options.weeklyPlans.some(
    (plan) => (plan.remainingHoursBySubject.olympiad ?? 0) > 0.1 && plan.slackMinutes > 0,
  );

  options.topics
    .filter((topic) => isOlympiadNumberTheoryFoundationTopic(topic))
    .forEach((topic) => {
      const remainingHours = Math.max(topic.estHours - topic.completedHours, 0);
      const plannedFutureHours = (plannedFutureMinutesByTopic[topic.id] ?? 0) / 60;

      if (remainingHours <= 0.1 || plannedFutureHours > 0.1 || !hasFutureOlympiadCapacity) {
        return;
      }

      issues.push({
        code: "olympiad-frontier-gap",
        severity: "error",
        subjectId: topic.subjectId,
        topicId: topic.id,
        message: `${topic.id} still has ${remainingHours.toFixed(1)}h remaining but no future planned coverage despite later Olympiad capacity.`,
      });
    });

  const olympiadWeekStarts = new Set(
    options.studyBlocks
      .filter((block) => block.subjectId === "olympiad")
      .map((block) => block.weekStart || toDateKey(startOfPlannerWeek(new Date(block.start)))),
  );

  options.weeklyPlans.forEach((plan) => {
    if ((plan.remainingHoursBySubject.olympiad ?? 0) <= 0.1 || plan.slackMinutes <= 0) {
      return;
    }

    if (olympiadWeekStarts.has(plan.weekStart)) {
      return;
    }

    issues.push({
      code: "olympiad-empty-week",
      severity: "error",
      subjectId: "olympiad",
      weekStart: plan.weekStart,
      message: `Olympiad has remaining work and free capacity during ${plan.weekStart}, but the week contains no Olympiad study blocks.`,
    });
  });

  return issues;
}
