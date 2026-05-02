import { buildSeedPreferences } from "./src/lib/seed/preferences";
import { buildSeedSubjects, buildSeedGoals } from "./src/lib/seed/subjects";
import { buildSeedTopics } from "./src/lib/seed/topics";
import { generateStudyPlanHorizon } from "./src/lib/scheduler/generator";
import { startOfPlannerWeek } from "./src/lib/dates/helpers";
import { validateGeneratedHorizon } from "./src/lib/scheduler/validation";

const referenceDate = new Date("2026-05-02T12:00:00");
const subjects = buildSeedSubjects(referenceDate);
const goals = buildSeedGoals(referenceDate);
const topics = buildSeedTopics();
const preferences = buildSeedPreferences();

console.log("=== RUNNING REPRODUCTION ===");

const result = generateStudyPlanHorizon({
  startWeek: startOfPlannerWeek(referenceDate),
  referenceDate,
  goals,
  subjects,
  topics,
  fixedEvents: [],
  preferences,
  fillAvailableStudyDays: true,
  allowReinforcement: true,
});

const issues = validateGeneratedHorizon({
  studyBlocks: result.studyBlocks,
  topics,
  weeklyPlans: result.weeklyPlans,
  preferences,
  referenceDate,
});

const overlaps = issues.filter(i => i.code === "overlap");
console.log(`\nFound ${overlaps.length} overlap issues.`);

if (overlaps.length > 0) {
  console.log("\nSample Overlaps:");
  overlaps.slice(0, 10).forEach(i => console.log(`  - ${i.message}`));
}

// Check for 210m gaps
const gaps = result.weeklyPlans.flatMap(wp => 
    wp.fillableGapDateKeys.map(dk => ({ week: wp.weekStart, date: dk }))
);
console.log(`\nFound ${gaps.length} fillable gaps.`);
