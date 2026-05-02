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
import { IB_ANCHOR_SUBJECT_IDS } from "@/lib/scheduler/school-term-template";
import type { CompletionLog, StudyBlock, StudyLayer, TaskCandidate, Topic } from "@/lib/types/planner";

const MIN_ALLOCATABLE_MINUTES = 30;
const MATHS_AA_SL_HL_FRONTIER_TOPIC_ID = "maths-topic5-aa-integration";
const DATE_KEY_START_CACHE = new Map<string, Date>();

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

function isIbAnchorSubject(subjectId: Topic["subjectId"]) {
  return IB_ANCHOR_SUBJECT_IDS.includes(subjectId as (typeof IB_ANCHOR_SUBJECT_IDS)[number]);
}

function isStrictMathsAaHlTopic(topic: Topic) {
  return (
    topic.subjectId === "maths-aa-hl" &&
    topic.sourceMaterials.some((material) => material.label === "Hodder AA HL 2019")
  );
}

function getCachedDateKeyStart(dateKey: string) {
  const cached = DATE_KEY_START_CACHE.get(dateKey);
  if (cached) {
    return cached;
  }

  const parsed = fromDateKey(dateKey);
  DATE_KEY_START_CACHE.set(dateKey, parsed);
  return parsed;
}

function isSchedulableCoverageStatus(status: StudyBlock["status"]) {
  return (
    status === "planned" ||
    status === "rescheduled" ||
    status === "done" ||
    status === "partial"
  );
}

function isFrenchMaintenanceTopic(topic: Pick<Topic, "subjectId">) {
  return topic.subjectId === "french-b-sl";
}

function getTaskStudyLayer(options: {
  topic: Topic;
  kind: TaskCandidate["kind"];
  variant?: StudyLayer | null;
}) {
  if (options.variant) {
    return options.variant;
  }

  if ((options.topic.sessionMode ?? "flexible") === "exam") {
    return "exam_sim" as const;
  }

  if (options.kind === "review" || isDedicatedReviewTopic(options.topic)) {
    return "correction" as const;
  }

  return "learning" as const;
}

function buildIbTopicVariantCandidates(options: {
  topic: Topic;
  rawRemainingMinutes: number;
  hasStudyHistory: boolean;
  timingWindow: {
    availableAt: Date | null;
    latestAt: string | null;
    reviewDue: string | null;
  };
  blockedByEarlierTopics: number;
  subjectDeadlinesById: Record<string, string>;
  referenceDate: Date;
}) {
  const baseDeadline =
    options.timingWindow.reviewDue ??
    options.subjectDeadlinesById[options.topic.subjectId] ??
    new Date(options.referenceDate).toISOString().slice(0, 10);
  const availableAt = options.timingWindow.availableAt
    ? options.timingWindow.availableAt.toISOString()
    : null;
  const paperCode = options.topic.paperCode ?? derivePaperCode(options.topic);
  const baseCandidate = {
    subjectId: options.topic.subjectId,
    topicId: options.topic.id,
    paperCode,
    unitTitle: options.topic.unitTitle,
    sourceMaterials: options.topic.sourceMaterials,
    remainingMinutes: Math.max(options.rawRemainingMinutes, MIN_ALLOCATABLE_MINUTES),
    sessionMode: options.topic.sessionMode ?? "flexible",
    exactSessionMinutes: options.topic.exactSessionMinutes ?? null,
    availableAt,
    latestAt: options.timingWindow.latestAt,
    difficulty: options.topic.difficulty,
    mastery: options.topic.mastery,
    order: options.topic.order,
    blockedByEarlierTopics: options.blockedByEarlierTopics,
    reviewDue: options.timingWindow.reviewDue,
    deadline: baseDeadline,
    lastStudiedAt: options.topic.lastStudiedAt,
    olympiadStrand: getOlympiadStrandForTopic(options.topic),
    followUpKind: null,
    followUpSourceStudyBlockId: null,
    followUpDueAt: null,
  } satisfies Omit<
    TaskCandidate,
    "id" | "title" | "sessionSummary" | "preferredBlockTypes" | "intensity" | "kind" | "studyLayer"
  >;

  const candidates: TaskCandidate[] = [
    {
      ...baseCandidate,
      id: options.topic.id,
      title: options.topic.title,
      sessionSummary:
        buildSessionSummary(options.topic) ??
        "Learn the concept, then finish with medium-hard questions in the same sitting.",
      preferredBlockTypes: options.topic.preferredBlockTypes,
      intensity: inferIntensity(options.topic),
      kind: "topic" as const,
      studyLayer: getTaskStudyLayer({
        topic: options.topic,
        kind: "topic",
        variant: "learning",
      }),
    },
    {
      ...baseCandidate,
      id: `${options.topic.id}::application`,
      title: `${options.topic.title} topic-specific past paper questions`,
      sessionSummary:
        "Run a topic-based questionbank or past-paper set on this idea, emphasizing medium-hard questions and pattern recognition.",
      preferredBlockTypes: ["drill", "standard_focus", "review"],
      intensity: "moderate" as const,
      kind: "topic" as const,
      studyLayer: "application" as const,
    },
  ];

  if (options.hasStudyHistory) {
    candidates.push({
      ...baseCandidate,
      id: `${options.topic.id}::correction`,
      title: `Correction and error log: ${options.topic.title}`,
      sessionSummary:
        "Redo mistakes, write the clean method, and update the error log with the underlying pattern.",
      preferredBlockTypes: ["review", "drill"],
      intensity: "light" as const,
      kind: "review" as const,
      studyLayer: "correction" as const,
    });
  }

  return candidates;
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
    studyLayer: getTaskStudyLayer({ topic, kind: "review" }),
    olympiadStrand: getOlympiadStrandForTopic(topic),
    followUpKind: null,
    followUpSourceStudyBlockId: null,
    followUpDueAt: null,
  };
}

function buildExistingBlockCandidateState(
  existingPlannedBlocks: StudyBlock[],
  options: { topicIdByBlockIds?: Set<string> | null; referenceDate?: Date } = {},
) {
  const latestScheduledBlockByTopic: Record<string, StudyBlock> = {};
  const topicIdByBlockIds = options.topicIdByBlockIds;
  const referenceTime = options.referenceDate?.getTime() ?? null;
  const topicIdByBlockId = topicIdByBlockIds?.size ? new Map<string, string>() : null;
  const topicIdsWithCompletedStudyHistory = new Set<string>();
  const plannedMinutesByTopic: Record<string, number> = {};
  const existingReviewMinutesByTopic: Record<string, number> = {};
  let hasCompletedOlympiadAttempt = false;

  existingPlannedBlocks.forEach((block) => {
    if (!block.topicId) {
      return;
    }

    if (topicIdByBlockIds?.has(block.id)) {
      topicIdByBlockId?.set(block.id, block.topicId);
    }

    const isCompletedEvidence = block.status === "done" || block.status === "partial";
    const isStalePlannedCoverage =
      referenceTime != null &&
      !isCompletedEvidence &&
      new Date(block.end).getTime() <= referenceTime;

    if (block.status !== "missed") {
      if (!isStalePlannedCoverage) {
        const current = latestScheduledBlockByTopic[block.topicId];
        if (!current || block.end > current.end) {
          latestScheduledBlockByTopic[block.topicId] = block;
        }
      }
    }

    if (isCompletedEvidence) {
      topicIdsWithCompletedStudyHistory.add(block.topicId);
      if (block.subjectId === "olympiad") {
        hasCompletedOlympiadAttempt = true;
      }
    }

    if (!isSchedulableCoverageStatus(block.status)) {
      return;
    }

    if (isStalePlannedCoverage) {
      return;
    }

    plannedMinutesByTopic[block.topicId] =
      (plannedMinutesByTopic[block.topicId] ?? 0) + block.estimatedMinutes;

    if (block.blockType === "review") {
      existingReviewMinutesByTopic[block.topicId] =
        (existingReviewMinutesByTopic[block.topicId] ?? 0) + block.estimatedMinutes;
    }
  });

  return {
    latestScheduledBlockByTopic,
    topicIdByBlockId: topicIdByBlockId ?? new Map<string, string>(),
    topicIdsWithCompletedStudyHistory,
    plannedMinutesByTopic,
    existingReviewMinutesByTopic,
    hasCompletedOlympiadAttempt,
  };
}

function getTopicIdsWithStudyHistory(
  topics: Topic[],
  topicIdsWithCompletedStudyHistory: Set<string>,
  topicIdByBlockId: Map<string, string>,
  completionLogs: CompletionLog[],
) {
  const topicIdsWithStudyHistory = new Set<string>();

  topics.forEach((topic) => {
    if (
      topic.completedHours > 0.001 ||
      topic.status !== "not_started" ||
      !!topic.lastStudiedAt
    ) {
      topicIdsWithStudyHistory.add(topic.id);
    }
  });

  topicIdsWithCompletedStudyHistory.forEach((topicId) => {
    topicIdsWithStudyHistory.add(topicId);
  });

  completionLogs.forEach((log) => {
    if (log.outcome !== "done" && log.outcome !== "partial") {
      return;
    }

    const topicId = topicIdByBlockId.get(log.studyBlockId);
    if (topicId) {
      topicIdsWithStudyHistory.add(topicId);
    }
  });

  return topicIdsWithStudyHistory;
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
  const roadmapAvailableAt = topic.availableFrom
    ? getCachedDateKeyStart(topic.availableFrom)
    : null;
  let availableAt: Date | null = roadmapAvailableAt;
  let reviewDue = topic.reviewDue;

  if (isStrictMathsAaHlTopic(topic)) {
    const slFrontierTopic = topicById.get(MATHS_AA_SL_HL_FRONTIER_TOPIC_ID);
    const slFrontierBlock = latestScheduledBlockByTopic[MATHS_AA_SL_HL_FRONTIER_TOPIC_ID];
    const slFrontierRequiresCompletion = !!slFrontierTopic;
    const slFrontierCoveredMinutes =
      Math.round((slFrontierTopic?.completedHours ?? 0) * 60) +
      (plannedMinutesByTopic[MATHS_AA_SL_HL_FRONTIER_TOPIC_ID] ?? 0);
    const slFrontierCompleteFromProgress =
      slFrontierRequiresCompletion &&
      !!slFrontierTopic &&
      slFrontierTopic.completedHours >= slFrontierTopic.estHours - 0.001;

    if (!slFrontierBlock && !slFrontierCompleteFromProgress) {
      return {
        blocked: true,
        availableAt: null,
        latestAt: null,
        reviewDue,
      };
    }

    if (
      slFrontierRequiresCompletion &&
      slFrontierTopic &&
      slFrontierCoveredMinutes < Math.round(slFrontierTopic.estHours * 60)
    ) {
      return {
        blocked: true,
        availableAt: null,
        latestAt: null,
        reviewDue,
      };
    }

    if (slFrontierBlock) {
      const slFrontierEnd = new Date(slFrontierBlock.end);
      if (!availableAt || slFrontierEnd.getTime() > availableAt.getTime()) {
        availableAt = slFrontierEnd;
      }
    }
  }

  if (topic.subjectId === "olympiad") {
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
  coverageReferenceDate?: Date;
  subjectDeadlinesById?: Record<string, string>;
  availabilityOverrideSubjectIds?: string[];
}) {
  const {
    topics,
    existingPlannedBlocks = [],
    completionLogs = [],
    referenceDate = new Date(),
    coverageReferenceDate = referenceDate,
    subjectDeadlinesById = {},
    availabilityOverrideSubjectIds = [],
  } = options;
  const planningWeekEnd = endOfPlannerWeek(referenceDate);
  const weekEnd = addDays(endOfPlannerWeek(referenceDate), 3);
  const completionLogStudyBlockIds = completionLogs.length
    ? new Set(
        completionLogs
          .filter((log) => log.outcome === "done" || log.outcome === "partial")
          .map((log) => log.studyBlockId),
      )
    : null;
  const existingBlockState = buildExistingBlockCandidateState(existingPlannedBlocks, {
    topicIdByBlockIds: completionLogStudyBlockIds,
    referenceDate: coverageReferenceDate,
  });
  const {
    latestScheduledBlockByTopic,
    plannedMinutesByTopic,
    existingReviewMinutesByTopic,
    hasCompletedOlympiadAttempt,
  } = existingBlockState;
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  const availabilityOverrideSubjectIdSet = new Set(availabilityOverrideSubjectIds);
  const topicIdsWithStudyHistory = getTopicIdsWithStudyHistory(
    topics,
    existingBlockState.topicIdsWithCompletedStudyHistory,
    existingBlockState.topicIdByBlockId,
    completionLogs,
  );
  const timingWindowByTopicId = new Map<
    string,
    ReturnType<typeof resolveTopicTimingWindow>
  >();
  const activeTopicsBySubject = topics.reduce<Record<string, Topic[]>>((accumulator, topic) => {
    if (isFrenchMaintenanceTopic(topic)) {
      return accumulator;
    }

    const timingWindow = resolveTopicTimingWindow(
      topic,
      latestScheduledBlockByTopic,
      existingPlannedBlocks,
      plannedMinutesByTopic,
      topics,
      topicById,
      {
        allowAvailabilityPullForward: availabilityOverrideSubjectIdSet.has(topic.subjectId),
      },
    );
    timingWindowByTopicId.set(topic.id, timingWindow);

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
    accumulator[topic.subjectId] = current;
    return accumulator;
  }, {});

  Object.values(activeTopicsBySubject).forEach((subjectTopics) => {
    subjectTopics.sort((left, right) => left.order - right.order);
  });

  const blockedByEarlierTopicsById = Object.values(activeTopicsBySubject).reduce<Record<string, number>>(
    (accumulator, subjectTopics) => {
      let unmetEarlierTopicCount = 0;
      subjectTopics.forEach((topic) => {
        accumulator[topic.id] = unmetEarlierTopicCount;
        const plannedHours = (plannedMinutesByTopic[topic.id] ?? 0) / 60;
        const coveredRatio =
          Math.min(topic.completedHours + plannedHours, topic.estHours) /
          Math.max(topic.estHours, 0.25);

        const strictThreshold = topic.subjectId === "maths-aa-hl" ? 0.99 : 0.5;
        if (coveredRatio < strictThreshold) {
          unmetEarlierTopicCount += 1;
        }
      });
      return accumulator;
    },
    {},
  );

  const topicCandidates = topics.flatMap<TaskCandidate>((topic) => {
    if (isFrenchMaintenanceTopic(topic)) {
      return [];
    }

    const timingWindow =
      timingWindowByTopicId.get(topic.id) ??
      resolveTopicTimingWindow(
        topic,
        latestScheduledBlockByTopic,
        existingPlannedBlocks,
        plannedMinutesByTopic,
        topics,
        topicById,
        {
          allowAvailabilityPullForward: availabilityOverrideSubjectIdSet.has(topic.subjectId),
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
    const hasStudyHistory = topicIdsWithStudyHistory.has(topic.id);
    const shouldSpawnReview =
      hasStudyHistory &&
      !isDedicatedReviewTopic(topic) &&
      (existingReviewMinutesByTopic[topic.id] ?? 0) < 45 &&
      !!timingWindow.reviewDue &&
      new Date(timingWindow.reviewDue) <= weekEnd &&
      (topic.status === "reviewed" || topic.status === "strong" || rawRemainingMinutes < 30);

    const candidates: TaskCandidate[] = [];

    if (rawRemainingMinutes > 0) {
      if (isIbAnchorSubject(topic.subjectId) && (topic.sessionMode ?? "flexible") !== "exam" && !isDedicatedReviewTopic(topic)) {
        candidates.push(
          ...buildIbTopicVariantCandidates({
            topic,
            rawRemainingMinutes,
            hasStudyHistory,
            timingWindow,
            blockedByEarlierTopics: blockedByEarlierTopicsById[topic.id] ?? 0,
            subjectDeadlinesById,
            referenceDate,
          }),
        );
      } else {
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
          studyLayer: getTaskStudyLayer({ topic, kind: "topic" }),
          olympiadStrand: getOlympiadStrandForTopic(topic),
          followUpKind: null,
          followUpSourceStudyBlockId: null,
          followUpDueAt: null,
        });
      }
    }

    if (shouldSpawnReview) {
      candidates.push(createReviewCandidate(topic, timingWindow));
    }

    return candidates;
  });

  const rewriteCandidates = hasCompletedOlympiadAttempt
    ? getOlympiadRewriteObligations({
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
          studyLayer: "correction",
          olympiadStrand: obligation.strand,
          followUpKind: "olympiad-rewrite",
          followUpSourceStudyBlockId: obligation.sourceStudyBlockId,
          followUpDueAt: obligation.dueAt,
        }))
    : [];

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
  const {
    latestScheduledBlockByTopic,
    plannedMinutesByTopic,
  } = buildExistingBlockCandidateState(existingPlannedBlocks, { referenceDate: blockStart });
  const topicById = new Map(options.topics.map((topic) => [topic.id, topic]));

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
