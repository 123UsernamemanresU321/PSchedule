import { buildSeedFixedEvents } from "@/lib/seed/fixed-events";
import { buildSeedPreferences } from "@/lib/seed/preferences";
import { buildSeedGoals, buildSeedSubjects } from "@/lib/seed/subjects";
import { buildSeedTopics } from "@/lib/seed/topics";
import type { SeedDataset } from "@/lib/types/planner";

export function buildSeedDataset(referenceDate = new Date()): SeedDataset {
  return {
    goals: buildSeedGoals(referenceDate),
    subjects: buildSeedSubjects(referenceDate),
    topics: buildSeedTopics(),
    fixedEvents: buildSeedFixedEvents(),
    sickDays: [],
    focusedDays: [],
    focusedWeeks: [],
    preferences: buildSeedPreferences(),
  };
}
