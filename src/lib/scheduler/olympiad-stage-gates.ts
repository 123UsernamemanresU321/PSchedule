import type { StudyBlock, Topic } from "@/lib/types/planner";

const OLYMPIAD_NUMBER_THEORY_GROUP = "olympiad-nt";

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
  void _options;
  return {
    frontierTopicId: null as string | null,
    remainingMinutes: 0,
    blocked: false,
    availableAt: null as Date | null,
  };
}

export function getOlympiadNumberTheoryEligibilityStatus(options: {
  topic: Topic | null | undefined;
  topics: Iterable<Topic>;
  blocks: StudyBlock[];
  cutoff?: Date;
}) {
  return {
    blocked: false,
    availableAt: null as Date | null,
    frontierTopicId: isOlympiadNumberTheoryTopic(options.topic) ? options.topic?.id ?? null : null,
    remainingMinutes: 0,
  };
}

export function getOlympiadStageGateStatus(_options: {
  topic: Topic | null | undefined;
  topics: Iterable<Topic>;
  blocks: StudyBlock[];
  cutoff?: Date;
}) {
  void _options;
  return {
    blocked: false,
    availableAt: null as Date | null,
    foundationTopicIds: [] as string[],
    missingTopicIds: [] as string[],
  };
}

export function collectInvalidFutureOlympiadBlockIds(_options: {
  topics: Iterable<Topic>;
  blocks: StudyBlock[];
  referenceDate: Date;
}) {
  void _options;
  return [] as string[];
}
