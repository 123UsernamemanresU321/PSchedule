import type { Topic } from "@/lib/types/planner";
import { seedTopicBlueprints, type SeedTopicBlueprint } from "@/lib/seed/topic-catalog";

function topicFactory() {
  let order = 0;

  return function createTopic(blueprint: SeedTopicBlueprint): Topic {
    order += 1;
    return {
      id: blueprint.id,
      subjectId: blueprint.subjectId,
      unitId: blueprint.unitId,
      unitTitle: blueprint.unitTitle,
      title: blueprint.title,
      subtopics: blueprint.subtopics,
      syllabusLevel: blueprint.syllabusLevel ?? null,
      subtopicTags: blueprint.subtopicTags ?? [],
      guideRefs: blueprint.guideRefs ?? [],
      guideSummary: blueprint.guideSummary ?? null,
      officialTeachingHours: blueprint.officialTeachingHours ?? null,
      selfStudyTargetHours: blueprint.selfStudyTargetHours ?? null,
      availableFrom: blueprint.availableFrom ?? null,
      dependsOnTopicId: blueprint.dependsOnTopicId ?? null,
      sequenceGroup: blueprint.sequenceGroup ?? null,
      sequenceStage: blueprint.sequenceStage ?? null,
      minDaysAfterDependency: blueprint.minDaysAfterDependency ?? null,
      maxDaysAfterDependency: blueprint.maxDaysAfterDependency ?? null,
      sessionMode: blueprint.sessionMode ?? "flexible",
      exactSessionMinutes: blueprint.exactSessionMinutes ?? null,
      estHours: blueprint.estHours,
      completedHours: 0,
      difficulty: blueprint.difficulty,
      status: "not_started",
      mastery: 1,
      reviewDue: null,
      lastStudiedAt: null,
      sourceMaterials: blueprint.sourceMaterials,
      preferredBlockTypes: blueprint.preferredBlockTypes,
      order,
      notes: blueprint.notes,
    };
  };
}

export function buildSeedTopics(): Topic[] {
  const makeTopic = topicFactory();
  return seedTopicBlueprints.map((blueprint) => makeTopic(blueprint));
}
