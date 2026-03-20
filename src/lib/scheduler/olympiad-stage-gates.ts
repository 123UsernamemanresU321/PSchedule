import type { StudyBlock, Topic } from "@/lib/types/planner";

const FOUNDATION_FRONTIER_BLOCK_STATUSES = new Set(["planned", "rescheduled", "done", "partial"]);

export function inferOlympiadSequenceGroup(topic: Topic | null | undefined) {
  if (!topic || topic.subjectId !== "olympiad") {
    return null;
  }

  if (topic.sequenceGroup) {
    return topic.sequenceGroup;
  }

  if (topic.unitId.startsWith("olympiad-number-theory-")) {
    return "olympiad-nt";
  }

  if (topic.unitId.startsWith("olympiad-geometry-")) {
    return "olympiad-geo";
  }

  if (topic.unitId.startsWith("olympiad-algebra-")) {
    return "olympiad-alg";
  }

  if (topic.unitId.startsWith("olympiad-combinatorics-")) {
    return "olympiad-combi";
  }

  return null;
}

export function inferOlympiadSequenceStage(topic: Topic | null | undefined) {
  if (!topic || topic.subjectId !== "olympiad") {
    return null;
  }

  if (topic.sequenceStage) {
    return topic.sequenceStage;
  }

  if (topic.unitId === "olympiad-number-theory-1") {
    return "foundation";
  }

  if (topic.unitId === "olympiad-geometry-1") {
    return "foundation";
  }

  if (topic.unitId === "olympiad-algebra-1") {
    return "foundation";
  }

  if (topic.unitId === "olympiad-combinatorics-1") {
    return "foundation";
  }

  return "advanced";
}

export function isOlympiadFoundationTopic(topic: Topic | null | undefined) {
  return (
    !!topic &&
    topic.subjectId === "olympiad" &&
    inferOlympiadSequenceStage(topic) === "foundation"
  );
}

function isOlympiadGatedTopic(topic: Topic | null | undefined) {
  return !!topic && topic.subjectId === "olympiad" && !isOlympiadFoundationTopic(topic);
}

function getOlympiadFoundationTopics(topics: Iterable<Topic>) {
  return [...topics]
    .filter((candidate) => isOlympiadFoundationTopic(candidate))
    .sort((left, right) => left.order - right.order);
}

function computeOlympiadFoundationCoverageState(options: {
  topics: Iterable<Topic>;
  blocks: StudyBlock[];
  cutoff?: Date;
}) {
  const foundationTopics = getOlympiadFoundationTopics(options.topics);
  const remainingMinutesByTopicId = Object.fromEntries(
    foundationTopics.map((topic) => [
      topic.id,
      Math.max(Math.round((topic.estHours - topic.completedHours) * 60), 0),
    ]),
  );
  let totalRemainingMinutes = foundationTopics.reduce(
    (total, topic) => total + (remainingMinutesByTopicId[topic.id] ?? 0),
    0,
  );
  let availableAt: Date | null = null;
  const relevantBlocks = options.blocks
    .filter((block) => block.topicId && remainingMinutesByTopicId[block.topicId] != null)
    .filter((block) => FOUNDATION_FRONTIER_BLOCK_STATUSES.has(block.status))
    .filter(
      (block) =>
        !options.cutoff ||
        new Date(block.end).getTime() <= options.cutoff.getTime(),
    )
    .sort((left, right) => new Date(left.end).getTime() - new Date(right.end).getTime());

  for (const block of relevantBlocks) {
    if (!block.topicId) {
      continue;
    }

    const remainingMinutes = remainingMinutesByTopicId[block.topicId] ?? 0;
    if (remainingMinutes <= 0) {
      continue;
    }

    const appliedMinutes = Math.min(
      remainingMinutes,
      block.status === "done" || block.status === "partial"
        ? block.actualMinutes ?? block.estimatedMinutes
        : block.estimatedMinutes,
    );
    remainingMinutesByTopicId[block.topicId] = remainingMinutes - appliedMinutes;
    totalRemainingMinutes = Math.max(0, totalRemainingMinutes - appliedMinutes);

    if (totalRemainingMinutes === 0) {
      availableAt = new Date(block.end);
      break;
    }
  }

  return {
    foundationTopicIds: foundationTopics.map((topic) => topic.id),
    missingTopicIds: foundationTopics
      .filter((topic) => (remainingMinutesByTopicId[topic.id] ?? 0) > 0)
      .map((topic) => topic.id),
    blocked: totalRemainingMinutes > 0,
    availableAt,
  };
}

export function getOlympiadStageGateStatus(options: {
  topic: Topic | null | undefined;
  topics: Iterable<Topic>;
  blocks: StudyBlock[];
  cutoff?: Date;
}): {
  blocked: boolean;
  availableAt: Date | null;
  foundationTopicIds: string[];
  missingTopicIds: string[];
} {
  const topic = options.topic;

  if (!isOlympiadGatedTopic(topic)) {
    return {
      blocked: false,
      availableAt: null,
      foundationTopicIds: [] as string[],
      missingTopicIds: [] as string[],
    };
  }

  const coverageState = computeOlympiadFoundationCoverageState({
    topics: options.topics,
    blocks: options.blocks,
    cutoff: options.cutoff,
  });

  return coverageState;
}

export function collectInvalidFutureOlympiadAdvancedBlockIds(options: {
  topics: Iterable<Topic>;
  blocks: StudyBlock[];
  referenceDate: Date;
}) {
  const topicsById = new Map([...options.topics].map((topic) => [topic.id, topic]));
  const invalidIds: string[] = [];
  const retainedBlocks: StudyBlock[] = options.blocks
    .filter((block) => new Date(block.end).getTime() <= options.referenceDate.getTime())
    .sort((left, right) => new Date(left.end).getTime() - new Date(right.end).getTime());

  const futureBlocks = options.blocks
    .filter((block) => new Date(block.end).getTime() > options.referenceDate.getTime())
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());

  for (const block of futureBlocks) {
    const topic = block.topicId ? topicsById.get(block.topicId) : null;
    const isRemovableFutureOlympiadBlock =
      block.subjectId === "olympiad" &&
      block.status !== "done" &&
      block.status !== "partial" &&
      block.status !== "missed" &&
      isOlympiadGatedTopic(topic);

    if (!isRemovableFutureOlympiadBlock) {
      retainedBlocks.push(block);
      continue;
    }

    const stageGateStatus = getOlympiadStageGateStatus({
      topic,
      topics: topicsById.values(),
      blocks: retainedBlocks,
      cutoff: new Date(block.start),
    });

    if (stageGateStatus.blocked) {
      invalidIds.push(block.id);
      continue;
    }

    retainedBlocks.push(block);
  }

  return invalidIds;
}
