import { addDays } from "date-fns";

import { endOfPlannerWeek, fromDateKey } from "@/lib/dates/helpers";
import type { StudyBlock, TaskCandidate, Topic } from "@/lib/types/planner";

const MIN_ALLOCATABLE_MINUTES = 30;

function inferIntensity(topic: Topic): TaskCandidate["intensity"] {
  if (
    topic.preferredBlockTypes.includes("deep_work") ||
    topic.preferredBlockTypes.includes("standard_focus")
  ) {
    return topic.difficulty >= 4 ? "heavy" : "moderate";
  }

  return topic.preferredBlockTypes.includes("drill") ? "moderate" : "light";
}

function createReviewCandidate(topic: Topic): TaskCandidate {
  return {
    id: `${topic.id}-review`,
    subjectId: topic.subjectId,
    topicId: topic.id,
    title: `${topic.title} review`,
    unitTitle: topic.unitTitle,
    sourceMaterials: topic.sourceMaterials,
    remainingMinutes: 45,
    difficulty: Math.max(1, topic.difficulty - 1) as Topic["difficulty"],
    mastery: topic.mastery,
    order: topic.order,
    blockedByEarlierTopics: 0,
    reviewDue: topic.reviewDue,
    deadline: topic.reviewDue ?? topic.lastStudiedAt ?? new Date().toISOString(),
    lastStudiedAt: topic.lastStudiedAt,
    preferredBlockTypes: ["review", "recovery"],
    intensity: "light",
    kind: "review",
  };
}

export function buildTaskCandidates(options: {
  topics: Topic[];
  existingPlannedBlocks?: StudyBlock[];
  referenceDate?: Date;
  subjectDeadlinesById?: Record<string, string>;
}) {
  const {
    topics,
    existingPlannedBlocks = [],
    referenceDate = new Date(),
    subjectDeadlinesById = {},
  } = options;
  const planningWeekEnd = endOfPlannerWeek(referenceDate);
  const weekEnd = addDays(endOfPlannerWeek(referenceDate), 3);
  const activeTopicsBySubject = topics.reduce<Record<string, Topic[]>>((accumulator, topic) => {
    if (topic.availableFrom && fromDateKey(topic.availableFrom) > planningWeekEnd) {
      return accumulator;
    }

    const remainingMinutes = Math.max(
      Math.round((topic.estHours - topic.completedHours) * 60),
      0,
    );

    if (remainingMinutes < MIN_ALLOCATABLE_MINUTES || topic.status === "strong") {
      return accumulator;
    }

    const current = accumulator[topic.subjectId] ?? [];
    current.push(topic);
    accumulator[topic.subjectId] = current.sort((left, right) => left.order - right.order);
    return accumulator;
  }, {});

  const plannedMinutesByTopic = existingPlannedBlocks.reduce<Record<string, number>>(
    (accumulator, block) => {
      if (!block.topicId || !["planned", "rescheduled"].includes(block.status)) {
        return accumulator;
      }

      accumulator[block.topicId] = (accumulator[block.topicId] ?? 0) + block.estimatedMinutes;
      return accumulator;
    },
    {},
  );

  const blockedByEarlierTopicsById = Object.values(activeTopicsBySubject).reduce<Record<string, number>>(
    (accumulator, subjectTopics) => {
      subjectTopics.forEach((topic, index) => {
        const unmetEarlierTopics = subjectTopics.slice(0, index).filter((earlierTopic) => {
          const plannedHours = (plannedMinutesByTopic[earlierTopic.id] ?? 0) / 60;
          const coveredRatio =
            Math.min(earlierTopic.completedHours + plannedHours, earlierTopic.estHours) /
            Math.max(earlierTopic.estHours, 0.25);
          return coveredRatio < 0.7;
        });

        accumulator[topic.id] = unmetEarlierTopics.length;
      });
      return accumulator;
    },
    {},
  );

  return topics.flatMap<TaskCandidate>((topic) => {
    if (topic.availableFrom && fromDateKey(topic.availableFrom) > planningWeekEnd) {
      return [];
    }

    const plannedMinutes = plannedMinutesByTopic[topic.id] ?? 0;
    const rawRemainingMinutes = Math.max(
      Math.round((topic.estHours - topic.completedHours) * 60) - plannedMinutes,
      0,
    );
    const shouldSpawnReview =
      !!topic.reviewDue &&
      new Date(topic.reviewDue) <= weekEnd &&
      (topic.status === "reviewed" || topic.status === "strong" || rawRemainingMinutes < 30);

    const candidates: TaskCandidate[] = [];

    if (rawRemainingMinutes > 0 && topic.status !== "strong") {
      candidates.push({
        id: topic.id,
        subjectId: topic.subjectId,
        topicId: topic.id,
        title: topic.title,
        unitTitle: topic.unitTitle,
        sourceMaterials: topic.sourceMaterials,
        remainingMinutes: Math.max(rawRemainingMinutes, MIN_ALLOCATABLE_MINUTES),
        difficulty: topic.difficulty,
        mastery: topic.mastery,
        order: topic.order,
        blockedByEarlierTopics: blockedByEarlierTopicsById[topic.id] ?? 0,
        reviewDue: topic.reviewDue,
        deadline:
          topic.reviewDue ??
          subjectDeadlinesById[topic.subjectId] ??
          new Date(referenceDate).toISOString().slice(0, 10),
        lastStudiedAt: topic.lastStudiedAt,
        preferredBlockTypes: topic.preferredBlockTypes,
        intensity: inferIntensity(topic),
        kind: "topic",
      });
    }

    if (shouldSpawnReview) {
      candidates.push(createReviewCandidate(topic));
    }

    return candidates;
  });
}
