import { addDays } from "date-fns";

import { endOfPlannerWeek, fromDateKey } from "@/lib/dates/helpers";
import type { StudyBlock, TaskCandidate, Topic } from "@/lib/types/planner";

const MIN_ALLOCATABLE_MINUTES = 30;

function buildSessionSummary(topic: Topic) {
  if (topic.subtopics.length >= 2) {
    return `${topic.subtopics[0]} • ${topic.subtopics[1]}`;
  }

  if (topic.subtopics.length === 1) {
    return topic.subtopics[0];
  }

  const sourceDetails = topic.sourceMaterials[0]?.details?.trim();
  return sourceDetails ? sourceDetails : null;
}

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
    sessionSummary:
      topic.subtopics.length > 0
        ? `Review ${topic.subtopics.slice(0, 2).join(" • ")}`
        : "Review the last attempt, error log, and weakest solution steps.",
    unitTitle: topic.unitTitle,
    sourceMaterials: topic.sourceMaterials,
    remainingMinutes: 45,
    sessionMode: "flexible",
    exactSessionMinutes: null,
    availableAt: null,
    latestAt: null,
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

function getLatestScheduledBlockByTopic(existingPlannedBlocks: StudyBlock[]) {
  return existingPlannedBlocks.reduce<Record<string, StudyBlock>>((accumulator, block) => {
    if (!block.topicId || block.status === "missed") {
      return accumulator;
    }

    const current = accumulator[block.topicId];
    if (!current || new Date(block.end).getTime() > new Date(current.end).getTime()) {
      accumulator[block.topicId] = block;
    }

    return accumulator;
  }, {});
}

function resolveTopicTimingWindow(
  topic: Topic,
  latestScheduledBlockByTopic: Record<string, StudyBlock>,
) {
  let availableAt = topic.availableFrom ? fromDateKey(topic.availableFrom) : null;
  let reviewDue = topic.reviewDue;

  if (topic.dependsOnTopicId) {
    const dependencyBlock = latestScheduledBlockByTopic[topic.dependsOnTopicId];

    if (!dependencyBlock) {
      return {
        blocked: true,
        availableAt: null,
        latestAt: null,
        reviewDue,
      };
    }

    const dependencyEnd = new Date(dependencyBlock.end);
    const earliestAllowed = addDays(dependencyEnd, topic.minDaysAfterDependency ?? 0);
    const latestAllowed =
      topic.maxDaysAfterDependency != null
        ? addDays(dependencyEnd, topic.maxDaysAfterDependency)
        : null;

    if (!availableAt || earliestAllowed.getTime() > availableAt.getTime()) {
      availableAt = earliestAllowed;
    }

    if (latestAllowed) {
      reviewDue = latestAllowed.toISOString();
    }
  }

  return {
    blocked: false,
    availableAt,
    latestAt: reviewDue ? reviewDue : null,
    reviewDue,
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
  const latestScheduledBlockByTopic = getLatestScheduledBlockByTopic(existingPlannedBlocks);
  const activeTopicsBySubject = topics.reduce<Record<string, Topic[]>>((accumulator, topic) => {
    const timingWindow = resolveTopicTimingWindow(topic, latestScheduledBlockByTopic);

    if (timingWindow.blocked || (timingWindow.availableAt && timingWindow.availableAt > planningWeekEnd)) {
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
    const timingWindow = resolveTopicTimingWindow(topic, latestScheduledBlockByTopic);

    if (timingWindow.blocked || (timingWindow.availableAt && timingWindow.availableAt > planningWeekEnd)) {
      return [];
    }

    const plannedMinutes = plannedMinutesByTopic[topic.id] ?? 0;
    const rawRemainingMinutes = Math.max(
      Math.round((topic.estHours - topic.completedHours) * 60) - plannedMinutes,
      0,
    );
    const shouldSpawnReview =
      !!timingWindow.reviewDue &&
      new Date(timingWindow.reviewDue) <= weekEnd &&
      (topic.status === "reviewed" || topic.status === "strong" || rawRemainingMinutes < 30);

    const candidates: TaskCandidate[] = [];

    if (rawRemainingMinutes > 0 && topic.status !== "strong") {
      const sessionMode = topic.sessionMode ?? "flexible";
      const exactSessionMinutes = topic.exactSessionMinutes ?? null;
      candidates.push({
        id: topic.id,
        subjectId: topic.subjectId,
        topicId: topic.id,
        title: topic.title,
        sessionSummary: buildSessionSummary(topic),
        unitTitle: topic.unitTitle,
        sourceMaterials: topic.sourceMaterials,
        remainingMinutes:
          sessionMode === "exam"
            ? exactSessionMinutes ?? rawRemainingMinutes
            : Math.max(rawRemainingMinutes, MIN_ALLOCATABLE_MINUTES),
        sessionMode,
        exactSessionMinutes,
        availableAt: timingWindow.availableAt ? timingWindow.availableAt.toISOString() : null,
        latestAt: timingWindow.latestAt,
        difficulty: topic.difficulty,
        mastery: topic.mastery,
        order: topic.order,
        blockedByEarlierTopics: blockedByEarlierTopicsById[topic.id] ?? 0,
        reviewDue: timingWindow.reviewDue,
        deadline:
          timingWindow.reviewDue ??
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
