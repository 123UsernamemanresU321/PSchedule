import { addDays } from "date-fns";

import { endOfPlannerWeek, fromDateKey } from "@/lib/dates/helpers";
import {
  getOlympiadNumberTheoryEligibilityStatus,
  getOlympiadStageGateStatus,
} from "@/lib/scheduler/olympiad-stage-gates";
import {
  buildOlympiadRewriteTitle,
  getOlympiadRewriteObligations,
  getOlympiadStrandForTopic,
} from "@/lib/scheduler/olympiad-performance";
import type { CompletionLog, StudyBlock, TaskCandidate, Topic } from "@/lib/types/planner";

const MIN_ALLOCATABLE_MINUTES = 30;

const PAPER_CODE_SUBJECT_PREFIXES: Record<string, string> = {
  "physics-hl": "PHY",
  "maths-aa-hl": "MAA",
  "chemistry-hl": "CHE",
};

function derivePaperCode(topic: Topic) {
  const sourceId = topic.dependsOnTopicId ?? topic.id;
  const subjectPrefix = PAPER_CODE_SUBJECT_PREFIXES[topic.subjectId];

  if (!subjectPrefix) {
    return null;
  }

  const match = sourceId.match(/-week-(\d+)-(paper-(?:1ab|1|2|3))(?:-review)?$/);

  if (!match) {
    return null;
  }

  const [, weekNumber, paperId] = match;
  const paperSuffix = (() => {
    switch (paperId) {
      case "paper-1ab":
        return "P1AB";
      case "paper-1":
        return "P1";
      case "paper-2":
        return "P2";
      case "paper-3":
        return "P3";
      default:
        return null;
    }
  })();

  if (!paperSuffix) {
    return null;
  }

  return `${subjectPrefix}-W${weekNumber.padStart(2, "0")}-${paperSuffix}`;
}

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

function isDedicatedReviewTopic(topic: Topic) {
  return topic.id.endsWith("-review");
}

function createReviewCandidate(
  topic: Topic,
  timingWindow: {
    availableAt: Date | null;
    latestAt: string | null;
    reviewDue: string | null;
  },
): TaskCandidate {
  return {
    id: `${topic.id}-review`,
    subjectId: topic.subjectId,
    topicId: topic.id,
    title: `${topic.title} review`,
    sessionSummary:
      topic.subtopics.length > 0
        ? `Review ${topic.subtopics.slice(0, 2).join(" • ")}`
        : "Review the last attempt, error log, and weakest solution steps.",
    paperCode: derivePaperCode(topic),
    unitTitle: topic.unitTitle,
    sourceMaterials: topic.sourceMaterials,
    remainingMinutes: 45,
    sessionMode: "flexible",
    exactSessionMinutes: null,
    availableAt: timingWindow.availableAt ? timingWindow.availableAt.toISOString() : null,
    latestAt: timingWindow.latestAt,
    difficulty: Math.max(1, topic.difficulty - 1) as Topic["difficulty"],
    mastery: topic.mastery,
    order: topic.order,
    blockedByEarlierTopics: 0,
    reviewDue: timingWindow.reviewDue,
    deadline:
      timingWindow.reviewDue ??
      (timingWindow.availableAt ? timingWindow.availableAt.toISOString() : null) ??
      topic.lastStudiedAt ??
      new Date().toISOString(),
    lastStudiedAt: topic.lastStudiedAt,
    preferredBlockTypes: ["review", "recovery"],
    intensity: "light",
    kind: "review",
    olympiadStrand: getOlympiadStrandForTopic(topic),
    followUpKind: null,
    followUpSourceStudyBlockId: null,
    followUpDueAt: null,
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
  existingPlannedBlocks: StudyBlock[],
  plannedMinutesByTopic: Record<string, number>,
  topics: Topic[],
  topicById: Map<string, Topic>,
  options?: { allowAvailabilityPullForward?: boolean },
) {
  const roadmapAvailableAt = topic.availableFrom ? fromDateKey(topic.availableFrom) : null;
  let availableAt: Date | null = roadmapAvailableAt;
  let reviewDue = topic.reviewDue;

  const stageGateStatus = getOlympiadStageGateStatus({
    topic,
    topics,
    blocks: existingPlannedBlocks,
  });

  if (stageGateStatus.blocked) {
    return {
      blocked: true,
      availableAt: null,
      latestAt: null,
      reviewDue,
    };
  }

  if (stageGateStatus.availableAt) {
    const stageGateAvailableAt = stageGateStatus.availableAt;

    if (!availableAt || stageGateAvailableAt.getTime() > availableAt.getTime()) {
      availableAt = stageGateAvailableAt;
    }
  }

  const ntFrontierStatus = getOlympiadNumberTheoryEligibilityStatus({
    topic,
    topics,
    blocks: existingPlannedBlocks,
  });

  if (ntFrontierStatus.blocked) {
    return {
      blocked: true,
      availableAt: null,
      latestAt: null,
      reviewDue,
    };
  }

  if (ntFrontierStatus.availableAt) {
    if (!availableAt || ntFrontierStatus.availableAt.getTime() > availableAt.getTime()) {
      availableAt = ntFrontierStatus.availableAt;
    }
  }

  if (topic.dependsOnTopicId) {
    const dependencyTopic = topicById.get(topic.dependsOnTopicId);
    const requiresDependencyCompletion =
      topic.minDaysAfterDependency == null && topic.maxDaysAfterDependency == null;
    const dependencyBlock = latestScheduledBlockByTopic[topic.dependsOnTopicId];
    const dependencyCompleteFromProgress =
      requiresDependencyCompletion &&
      !!dependencyTopic &&
      dependencyTopic.completedHours >= dependencyTopic.estHours - 0.001;

    if (!dependencyBlock && !dependencyCompleteFromProgress) {
      return {
        blocked: true,
        availableAt: null,
        latestAt: null,
        reviewDue,
      };
    }

    const coveredDependencyMinutes =
      Math.round((dependencyTopic?.completedHours ?? 0) * 60) +
      (plannedMinutesByTopic[topic.dependsOnTopicId] ?? 0);

    if (
      requiresDependencyCompletion &&
      dependencyTopic &&
      coveredDependencyMinutes < Math.round(dependencyTopic.estHours * 60)
    ) {
      return {
        blocked: true,
        availableAt: null,
        latestAt: null,
        reviewDue,
      };
    }

    if (!dependencyBlock) {
      return {
        blocked: false,
        availableAt,
        latestAt: reviewDue ? reviewDue : null,
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

  if (
    options?.allowAvailabilityPullForward &&
    roadmapAvailableAt &&
    availableAt &&
    availableAt.getTime() === roadmapAvailableAt.getTime()
  ) {
    availableAt = null;
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
  completionLogs?: CompletionLog[];
  referenceDate?: Date;
  subjectDeadlinesById?: Record<string, string>;
  availabilityOverrideSubjectIds?: string[];
}) {
  const {
    topics,
    existingPlannedBlocks = [],
    completionLogs = [],
    referenceDate = new Date(),
    subjectDeadlinesById = {},
    availabilityOverrideSubjectIds = [],
  } = options;
  const planningWeekEnd = endOfPlannerWeek(referenceDate);
  const weekEnd = addDays(endOfPlannerWeek(referenceDate), 3);
  const latestScheduledBlockByTopic = getLatestScheduledBlockByTopic(existingPlannedBlocks);
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const plannedMinutesByTopic = existingPlannedBlocks.reduce<Record<string, number>>(
    (accumulator, block) => {
      if (!block.topicId || !["planned", "rescheduled", "done", "partial"].includes(block.status)) {
        return accumulator;
      }

      accumulator[block.topicId] = (accumulator[block.topicId] ?? 0) + block.estimatedMinutes;
      return accumulator;
    },
    {},
  );
  const existingReviewMinutesByTopic = existingPlannedBlocks.reduce<Record<string, number>>(
    (accumulator, block) => {
      if (
        !block.topicId ||
        !["planned", "rescheduled", "done", "partial"].includes(block.status) ||
        block.blockType !== "review"
      ) {
        return accumulator;
      }

      accumulator[block.topicId] = (accumulator[block.topicId] ?? 0) + block.estimatedMinutes;
      return accumulator;
    },
    {},
  );
  const activeTopicsBySubject = topics.reduce<Record<string, Topic[]>>((accumulator, topic) => {
    const timingWindow = resolveTopicTimingWindow(
      topic,
      latestScheduledBlockByTopic,
      existingPlannedBlocks,
      plannedMinutesByTopic,
      topics,
      topicById,
      {
        allowAvailabilityPullForward: availabilityOverrideSubjectIds.includes(topic.subjectId),
      },
    );

    if (timingWindow.blocked || (timingWindow.availableAt && timingWindow.availableAt > planningWeekEnd)) {
      return accumulator;
    }

    const remainingMinutes = Math.max(
      Math.round((topic.estHours - topic.completedHours) * 60),
      0,
    );

    if (remainingMinutes < MIN_ALLOCATABLE_MINUTES) {
      return accumulator;
    }

    const current = accumulator[topic.subjectId] ?? [];
    current.push(topic);
    accumulator[topic.subjectId] = current.sort((left, right) => left.order - right.order);
    return accumulator;
  }, {});

  const blockedByEarlierTopicsById = Object.values(activeTopicsBySubject).reduce<Record<string, number>>(
    (accumulator, subjectTopics) => {
      subjectTopics.forEach((topic, index) => {
        const unmetEarlierTopics = subjectTopics.slice(0, index).filter((earlierTopic) => {
          const plannedHours = (plannedMinutesByTopic[earlierTopic.id] ?? 0) / 60;
          const coveredRatio =
            Math.min(earlierTopic.completedHours + plannedHours, earlierTopic.estHours) /
            Math.max(earlierTopic.estHours, 0.25);
          return coveredRatio < 0.5;
        });

        accumulator[topic.id] = unmetEarlierTopics.length;
      });
      return accumulator;
    },
    {},
  );

  const topicCandidates = topics.flatMap<TaskCandidate>((topic) => {
    const timingWindow = resolveTopicTimingWindow(
      topic,
      latestScheduledBlockByTopic,
      existingPlannedBlocks,
      plannedMinutesByTopic,
      topics,
      topicById,
      {
        allowAvailabilityPullForward: availabilityOverrideSubjectIds.includes(topic.subjectId),
      },
    );

    if (timingWindow.blocked || (timingWindow.availableAt && timingWindow.availableAt > planningWeekEnd)) {
      return [];
    }

    const plannedMinutes = plannedMinutesByTopic[topic.id] ?? 0;
    const rawRemainingMinutes = Math.max(
      Math.round((topic.estHours - topic.completedHours) * 60) - plannedMinutes,
      0,
    );
    const shouldSpawnReview =
      !isDedicatedReviewTopic(topic) &&
      (existingReviewMinutesByTopic[topic.id] ?? 0) < 45 &&
      !!timingWindow.reviewDue &&
      new Date(timingWindow.reviewDue) <= weekEnd &&
      (topic.status === "reviewed" || topic.status === "strong" || rawRemainingMinutes < 30);

    const candidates: TaskCandidate[] = [];

    if (rawRemainingMinutes > 0) {
      const sessionMode = topic.sessionMode ?? "flexible";
      const exactSessionMinutes = topic.exactSessionMinutes ?? null;
      candidates.push({
        id: topic.id,
        subjectId: topic.subjectId,
        topicId: topic.id,
        title: topic.title,
        sessionSummary: buildSessionSummary(topic),
        paperCode: topic.paperCode ?? derivePaperCode(topic),
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
        olympiadStrand: getOlympiadStrandForTopic(topic),
        followUpKind: null,
        followUpSourceStudyBlockId: null,
        followUpDueAt: null,
      });
    }

    if (shouldSpawnReview) {
      candidates.push(createReviewCandidate(topic, timingWindow));
    }

    return candidates;
  });

  const rewriteCandidates = getOlympiadRewriteObligations({
    topics,
    studyBlocks: existingPlannedBlocks,
    completionLogs,
  })
    .filter((obligation) => !obligation.scheduledBlock)
    .map<TaskCandidate>((obligation) => ({
      id: `olympiad-rewrite-${obligation.sourceStudyBlockId}`,
      subjectId: "olympiad",
      topicId: null,
      title: buildOlympiadRewriteTitle(obligation.sourceTitle),
      sessionSummary:
        "Write one final clean proof version, fix logical gaps, and compress the argument to contest quality within 48 hours.",
      paperCode: obligation.sourcePaperCode,
      unitTitle: obligation.sourceUnitTitle,
      sourceMaterials: obligation.sourceMaterials,
      remainingMinutes: obligation.durationMinutes,
      sessionMode: "flexible",
      exactSessionMinutes: null,
      availableAt: obligation.availableAt,
      latestAt:
        new Date(obligation.dueAt).getTime() > referenceDate.getTime()
          ? obligation.dueAt
          : null,
      difficulty: 4,
      mastery: 2,
      order: Number.MAX_SAFE_INTEGER,
      blockedByEarlierTopics: 0,
      reviewDue: obligation.dueAt,
      deadline: obligation.dueAt,
      lastStudiedAt: obligation.availableAt,
      preferredBlockTypes:
        obligation.durationMinutes > 45 ? ["drill", "review"] : ["review", "drill"],
      intensity: obligation.durationMinutes > 45 ? "moderate" : "light",
      kind: "review",
      olympiadStrand: obligation.strand,
      followUpKind: "olympiad-rewrite",
      followUpSourceStudyBlockId: obligation.sourceStudyBlockId,
      followUpDueAt: obligation.dueAt,
    }));

  return [...topicCandidates, ...rewriteCandidates];
}

export function getAssignableTaskCandidatesForBlock(options: {
  block: StudyBlock;
  topics: Topic[];
  existingPlannedBlocks?: StudyBlock[];
  subjectDeadlinesById?: Record<string, string>;
  allowCompletedTopics?: boolean;
}) {
  const existingPlannedBlocks = options.existingPlannedBlocks ?? [];
  const blockStart = new Date(options.block.start);
  const blockDurationMinutes = options.block.estimatedMinutes;
  const latestScheduledBlockByTopic = getLatestScheduledBlockByTopic(existingPlannedBlocks);
  const topicById = new Map(options.topics.map((topic) => [topic.id, topic]));
  const plannedMinutesByTopic = existingPlannedBlocks.reduce<Record<string, number>>(
    (accumulator, block) => {
      if (!block.topicId || !["planned", "rescheduled", "done", "partial"].includes(block.status)) {
        return accumulator;
      }

      accumulator[block.topicId] = (accumulator[block.topicId] ?? 0) + block.estimatedMinutes;
      return accumulator;
    },
    {},
  );

  return options.topics.flatMap<TaskCandidate>((topic) => {
    const timingWindow = resolveTopicTimingWindow(
      topic,
      latestScheduledBlockByTopic,
      existingPlannedBlocks,
      plannedMinutesByTopic,
      options.topics,
      topicById,
    );

    if (timingWindow.blocked) {
      return [];
    }

    const totalRemainingMinutes = Math.max(
      Math.round((topic.estHours - topic.completedHours) * 60),
      0,
    );

    if (!options.allowCompletedTopics && totalRemainingMinutes < MIN_ALLOCATABLE_MINUTES) {
      return [];
    }

    if (timingWindow.availableAt && new Date(timingWindow.availableAt).getTime() > blockStart.getTime()) {
      return [];
    }

    if (timingWindow.latestAt && new Date(timingWindow.latestAt).getTime() < blockStart.getTime()) {
      return [];
    }

    const sessionMode = topic.sessionMode ?? "flexible";
    const exactSessionMinutes = topic.exactSessionMinutes ?? null;

    if (
      sessionMode === "exam" &&
      exactSessionMinutes != null &&
      exactSessionMinutes !== blockDurationMinutes
    ) {
      return [];
    }

    return [
      {
        id: topic.id,
        subjectId: topic.subjectId,
        topicId: topic.id,
        title: topic.title,
        sessionSummary: buildSessionSummary(topic),
        paperCode: topic.paperCode ?? derivePaperCode(topic),
        unitTitle: topic.unitTitle,
        sourceMaterials: topic.sourceMaterials,
        remainingMinutes:
          sessionMode === "exam"
            ? exactSessionMinutes ?? totalRemainingMinutes
            : Math.max(totalRemainingMinutes, blockDurationMinutes, MIN_ALLOCATABLE_MINUTES),
        sessionMode,
        exactSessionMinutes,
        availableAt: timingWindow.availableAt ? timingWindow.availableAt.toISOString() : null,
        latestAt: timingWindow.latestAt,
        difficulty: topic.difficulty,
        mastery: topic.mastery,
        order: topic.order,
        blockedByEarlierTopics: 0,
        reviewDue: timingWindow.reviewDue,
        deadline:
          timingWindow.reviewDue ??
          options.subjectDeadlinesById?.[topic.subjectId] ??
          blockStart.toISOString().slice(0, 10),
        lastStudiedAt: topic.lastStudiedAt,
        preferredBlockTypes: topic.preferredBlockTypes,
        intensity: inferIntensity(topic),
        kind: "topic",
      },
    ];
  });
}
