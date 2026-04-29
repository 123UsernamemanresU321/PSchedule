import type { StudyBlock, Topic } from "@/lib/types/planner";

const OLYMPIAD_NUMBER_THEORY_GROUP = "olympiad-nt";
const EPSILON_MINUTES = 1;

function isCoverageBlock(block: StudyBlock) {
  return (
    block.status === "planned" ||
    block.status === "rescheduled" ||
    block.status === "done" ||
    block.status === "partial"
  );
}

function coveredMinutesForTopic(topic: Topic, blocks: StudyBlock[], cutoff?: Date) {
  const cutoffTime = cutoff?.getTime() ?? null;
  const scheduledMinutes = blocks
    .filter((block) => block.topicId === topic.id && isCoverageBlock(block))
    .filter((block) => cutoffTime == null || new Date(block.end).getTime() <= cutoffTime)
    .reduce((total, block) => total + block.estimatedMinutes, 0);

  return Math.round((topic.completedHours ?? 0) * 60) + scheduledMinutes;
}

function requiredMinutesForTopic(topic: Topic) {
  return Math.max(Math.round(topic.estHours * 60), 0);
}

function latestCoverageEndForTopic(topic: Topic, blocks: StudyBlock[]) {
  return blocks
    .filter((block) => block.topicId === topic.id && isCoverageBlock(block))
    .map((block) => new Date(block.end))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
}

export function inferOlympiadSequenceGroup(topic: Topic | null | undefined) {
  if (!topic || topic.subjectId !== "olympiad") {
    return null;
  }

  if (topic.sequenceGroup) {
    return topic.sequenceGroup;
  }

  if (topic.id.includes("number-theory") || topic.unitId.includes("number-theory")) {
    return "olympiad-nt";
  }

  if (topic.id.includes("geometry") || topic.unitId.includes("geometry")) {
    return "olympiad-geo";
  }

  if (topic.id.includes("algebra") || topic.unitId.includes("algebra")) {
    return "olympiad-alg";
  }

  if (topic.id.includes("combinatorics") || topic.unitId.includes("combinatorics")) {
    return "olympiad-combi";
  }

  if (topic.id.includes("contest") || topic.unitId.includes("contest")) {
    return "olympiad-contest";
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

  const searchableText = `${topic.id} ${topic.unitId} ${topic.unitTitle} ${topic.title}`.toLowerCase();
  if (searchableText.includes("foundation")) {
    return "foundation";
  }

  if (topic.id.includes("phase-1") || topic.id.includes("phase-2")) {
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

export function isOlympiadNumberTheoryTopic(topic: Topic | null | undefined) {
  return (
    !!topic &&
    topic.subjectId === "olympiad" &&
    inferOlympiadSequenceGroup(topic) === OLYMPIAD_NUMBER_THEORY_GROUP
  );
}

export function isOlympiadNumberTheoryFoundationTopic(topic: Topic | null | undefined) {
  return isOlympiadFoundationTopic(topic) && isOlympiadNumberTheoryTopic(topic);
}

export function getOlympiadNumberTheoryFrontierStatus(_options: {
  topics: Iterable<Topic>;
  blocks: StudyBlock[];
  cutoff?: Date;
}) {
  const foundationTopics = [..._options.topics]
    .filter(isOlympiadNumberTheoryFoundationTopic)
    .sort((left, right) => left.order - right.order);
  const frontier = foundationTopics.find(
    (topic) =>
      coveredMinutesForTopic(topic, _options.blocks, _options.cutoff) <
      requiredMinutesForTopic(topic) - EPSILON_MINUTES,
  );

  if (!frontier) {
    const latestFoundationEnd = foundationTopics
      .map((topic) => latestCoverageEndForTopic(topic, _options.blocks))
      .filter((date): date is Date => !!date)
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

    return {
      frontierTopicId: null as string | null,
      remainingMinutes: 0,
      blocked: false,
      availableAt: latestFoundationEnd,
    };
  }

  return {
    frontierTopicId: frontier.id,
    remainingMinutes: Math.max(
      requiredMinutesForTopic(frontier) -
        coveredMinutesForTopic(frontier, _options.blocks, _options.cutoff),
      0,
    ),
    blocked: true,
    availableAt: latestCoverageEndForTopic(frontier, _options.blocks),
  };
}

export function getOlympiadNumberTheoryEligibilityStatus(options: {
  topic: Topic | null | undefined;
  topics: Iterable<Topic>;
  blocks: StudyBlock[];
  cutoff?: Date;
}) {
  const group = inferOlympiadSequenceGroup(options.topic);
  if (!options.topic || group !== OLYMPIAD_NUMBER_THEORY_GROUP) {
    return {
      blocked: false,
      availableAt: null as Date | null,
      frontierTopicId: null as string | null,
      remainingMinutes: 0,
    };
  }

  if (!options.cutoff && options.topic.dependsOnTopicId) {
    return {
      blocked: false,
      availableAt: null as Date | null,
      frontierTopicId: options.topic.id,
      remainingMinutes: 0,
    };
  }

  const frontierStatus = getOlympiadNumberTheoryFrontierStatus({
    topics: options.topics,
    blocks: options.blocks,
    cutoff: options.cutoff,
  });
  const isCurrentFrontier = frontierStatus.frontierTopicId === options.topic.id;
  const topicStage = inferOlympiadSequenceStage(options.topic);

  if (frontierStatus.frontierTopicId && !isCurrentFrontier) {
    return {
      blocked: true,
      availableAt: frontierStatus.availableAt,
      frontierTopicId: frontierStatus.frontierTopicId,
      remainingMinutes: frontierStatus.remainingMinutes,
    };
  }

  if (topicStage !== "foundation" && frontierStatus.frontierTopicId) {
    return {
      blocked: true,
      availableAt: frontierStatus.availableAt,
      frontierTopicId: frontierStatus.frontierTopicId,
      remainingMinutes: frontierStatus.remainingMinutes,
    };
  }

  return {
    blocked: false,
    availableAt: isCurrentFrontier ? null : frontierStatus.availableAt,
    frontierTopicId: frontierStatus.frontierTopicId ?? options.topic.id,
    remainingMinutes: isCurrentFrontier ? frontierStatus.remainingMinutes : 0,
  };
}

export function getOlympiadStageGateStatus(options: {
  topic: Topic | null | undefined;
  topics: Iterable<Topic>;
  blocks: StudyBlock[];
  cutoff?: Date;
}) {
  const topicGroup = inferOlympiadSequenceGroup(options.topic);
  const topicStage = inferOlympiadSequenceStage(options.topic);

  if (!options.topic || !topicGroup || topicStage === "foundation") {
    return {
      blocked: false,
      availableAt: null as Date | null,
      foundationTopicIds: [] as string[],
      missingTopicIds: [] as string[],
    };
  }

  if (!options.cutoff && options.topic.dependsOnTopicId) {
    return {
      blocked: false,
      availableAt: null as Date | null,
      foundationTopicIds: [] as string[],
      missingTopicIds: [] as string[],
    };
  }

  const foundationTopics = [...options.topics]
    .filter(
      (topic) =>
        topic.subjectId === "olympiad" &&
        inferOlympiadSequenceGroup(topic) === topicGroup &&
        inferOlympiadSequenceStage(topic) === "foundation",
    )
    .sort((left, right) => left.order - right.order);
  const missingTopicIds = foundationTopics
    .filter(
      (topic) =>
        coveredMinutesForTopic(topic, options.blocks, options.cutoff) <
        requiredMinutesForTopic(topic) - EPSILON_MINUTES,
    )
    .map((topic) => topic.id);
  const latestFoundationEnd = foundationTopics
    .map((topic) => latestCoverageEndForTopic(topic, options.blocks))
    .filter((date): date is Date => !!date)
    .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;

  return {
    blocked: missingTopicIds.length > 0,
    availableAt: missingTopicIds.length > 0 ? null : latestFoundationEnd,
    foundationTopicIds: foundationTopics.map((topic) => topic.id),
    missingTopicIds,
  };
}

export function collectInvalidFutureOlympiadBlockIds(options: {
  topics: Iterable<Topic>;
  blocks: StudyBlock[];
  referenceDate: Date;
}) {
  const topics = [...options.topics];
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));

  return options.blocks
    .filter((block) => new Date(block.start).getTime() >= options.referenceDate.getTime())
    .filter((block) => {
      const topic = block.topicId ? topicById.get(block.topicId) : null;
      if (!topic) {
        return (
          block.subjectId === "olympiad" &&
          !(block.topicId ?? "").toLowerCase().includes("divisibility")
        );
      }

      if (topic.subjectId !== "olympiad") {
        return false;
      }

      const cutoff = new Date(block.start);
      const stageGateStatus = getOlympiadStageGateStatus({
        topic,
        topics,
        blocks: options.blocks,
        cutoff,
      });
      const ntFrontierStatus = getOlympiadNumberTheoryEligibilityStatus({
        topic,
        topics,
        blocks: options.blocks,
        cutoff,
      });

      return stageGateStatus.blocked || ntFrontierStatus.blocked;
    })
    .map((block) => block.id);
}
