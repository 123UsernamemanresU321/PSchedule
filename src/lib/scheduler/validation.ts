import { differenceInCalendarDays } from "date-fns";

import { getOlympiadStageGateStatus } from "@/lib/scheduler/olympiad-stage-gates";
import type { StudyBlock, Topic, WeeklyPlan } from "@/lib/types/planner";

export interface PlannerValidationIssue {
  code:
    | "overlap"
    | "dependency-coverage-order-violation"
    | "missing-review-dependency"
    | "review-window-violation"
    | "unused-capacity-with-gap";
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
}) {
  const issues: PlannerValidationIssue[] = [];
  const topicById = new Map(options.topics.map((topic) => [topic.id, topic]));
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
        message: `Block ${block.id} starts before the ${topic?.sequenceGroup} foundations are fully covered earlier on the calendar.`,
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

  return issues;
}
