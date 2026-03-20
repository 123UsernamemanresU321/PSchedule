import type { StudyBlock, Topic } from "@/lib/types/planner";

function inferOlympiadSequenceGroup(topic: Topic | null | undefined) {
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

function inferOlympiadSequenceStage(topic: Topic | null | undefined) {
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

  if (
    topic.unitId.startsWith("olympiad-number-theory-") ||
    topic.unitId.startsWith("olympiad-geometry-") ||
    topic.unitId.startsWith("olympiad-algebra-") ||
    topic.unitId.startsWith("olympiad-combinatorics-")
  ) {
    return "advanced";
  }

  return null;
}

function isOlympiadAdvancedStageTopic(topic: Topic | null | undefined) {
  return (
    !!topic &&
    topic.subjectId === "olympiad" &&
    inferOlympiadSequenceStage(topic) === "advanced" &&
    !!inferOlympiadSequenceGroup(topic)
  );
}

function getOlympiadFoundationTopics(topic: Topic, topics: Iterable<Topic>) {
  if (!isOlympiadAdvancedStageTopic(topic)) {
    return [];
  }

  return [...topics]
    .filter((candidate) => candidate.subjectId === "olympiad")
    .filter((candidate) => inferOlympiadSequenceGroup(candidate) === inferOlympiadSequenceGroup(topic))
    .filter((candidate) => inferOlympiadSequenceStage(candidate) === "foundation")
    .sort((left, right) => left.order - right.order);
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

  if (!isOlympiadAdvancedStageTopic(topic)) {
    return {
      blocked: false,
      availableAt: null,
      foundationTopicIds: [] as string[],
      missingTopicIds: [] as string[],
    };
  }

  const foundationTopics = getOlympiadFoundationTopics(topic as Topic, options.topics);
  const missingTopicIds: string[] = [];

  foundationTopics.forEach((foundationTopic) => {
    const isFoundationComplete =
      foundationTopic.completedHours >= foundationTopic.estHours - 0.001 &&
      foundationTopic.mastery >= 5;

    if (!isFoundationComplete) {
      missingTopicIds.push(foundationTopic.id);
    }
  });

  return {
    blocked: missingTopicIds.length > 0,
    availableAt: null,
    foundationTopicIds: foundationTopics.map((topic) => topic.id),
    missingTopicIds,
  };
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
      isOlympiadAdvancedStageTopic(topic);

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
