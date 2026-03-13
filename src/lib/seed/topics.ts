import type { Topic } from "@/lib/types/planner";
import { seedTopicBlueprints } from "@/lib/seed/topic-catalog";

function topicFactory() {
  let order = 0;

  return function createTopic(blueprint: {
    id: string;
    subjectId: Topic["subjectId"];
    unitId: string;
    unitTitle: string;
    title: string;
    subtopics: string[];
    availableFrom?: string | null;
    sessionMode?: Topic["sessionMode"];
    exactSessionMinutes?: number | null;
    estHours: number;
    difficulty: Topic["difficulty"];
    preferredBlockTypes: Topic["preferredBlockTypes"];
    sourceMaterials: Topic["sourceMaterials"];
    notes?: string;
  }): Topic {
    order += 1;
    return {
      id: blueprint.id,
      subjectId: blueprint.subjectId,
      unitId: blueprint.unitId,
      unitTitle: blueprint.unitTitle,
      title: blueprint.title,
      subtopics: blueprint.subtopics,
      availableFrom: blueprint.availableFrom ?? null,
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
