import type { StudyBlock, Topic } from "@/lib/types/planner";

function isOlympiadAdvancedStageTopic(topic: Topic | null | undefined) {
  return (
    !!topic &&
    topic.subjectId === "olympiad" &&
    topic.sequenceStage === "advanced" &&
    !!topic.sequenceGroup
  );
}

function getOlympiadFoundationTopics(topic: Topic, topics: Iterable<Topic>) {
  if (!isOlympiadAdvancedStageTopic(topic)) {
    return [];
  }

  return [...topics]
    .filter((candidate) => candidate.subjectId === "olympiad")
    .filter((candidate) => candidate.sequenceGroup === topic.sequenceGroup)
    .filter((candidate) => candidate.sequenceStage === "foundation")
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
  let availableAt: Date | null = null;
  const missingTopicIds: string[] = [];

  foundationTopics.forEach((foundationTopic) => {
    const requiredMinutes = Math.round(foundationTopic.estHours * 60);
    let remainingMinutes = requiredMinutes - Math.min(
      Math.round(foundationTopic.completedHours * 60),
      requiredMinutes,
    );

    if (remainingMinutes <= 0) {
      return;
    }

    const relevantBlocks = options.blocks
      .filter((block) => block.topicId === foundationTopic.id)
      .filter((block) => block.status !== "missed")
      .filter((block) => !options.cutoff || new Date(block.end).getTime() <= options.cutoff.getTime())
      .sort((left, right) => new Date(left.end).getTime() - new Date(right.end).getTime());

    let completionAt: Date | null = null;

    for (const block of relevantBlocks) {
      remainingMinutes -= block.estimatedMinutes;
      completionAt = new Date(block.end);

      if (remainingMinutes <= 0) {
        break;
      }
    }

    if (remainingMinutes > 0) {
      missingTopicIds.push(foundationTopic.id);
      return;
    }

    if (completionAt && (!availableAt || completionAt.getTime() > availableAt.getTime())) {
      availableAt = completionAt;
    }
  });

  return {
    blocked: missingTopicIds.length > 0,
    availableAt,
    foundationTopicIds: foundationTopics.map((topic) => topic.id),
    missingTopicIds,
  };
}
