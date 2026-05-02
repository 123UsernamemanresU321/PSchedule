import { buildSeedPreferences } from "./src/lib/seed/preferences";
import { buildSeedSubjects, buildSeedGoals } from "./src/lib/seed/subjects";
import { buildSeedTopics } from "./src/lib/seed/topics";
import { generateStudyPlanHorizon } from "./src/lib/scheduler/generator";
import { toDateKey, startOfPlannerWeek } from "./src/lib/dates/helpers";
import { addDays } from "date-fns";

const referenceDate = new Date("2026-05-02T12:00:00");
const subjects = buildSeedSubjects(referenceDate);
const goals = buildSeedGoals(referenceDate);
const topics = buildSeedTopics();
const preferences = buildSeedPreferences();

// Get fixed events from seed if available
let fixedEvents: any[] = [];
try {
  const { buildSeedFixedEvents } = require("./src/lib/seed/fixed-events");
  fixedEvents = buildSeedFixedEvents?.(referenceDate) ?? [];
} catch {
  fixedEvents = [];
}

console.log("=== SCHEDULING DIAGNOSTIC ===");
console.log(`Reference date: ${referenceDate.toISOString()}`);
console.log(`Subjects: ${subjects.map(s => s.id).join(", ")}`);

// Count olympiad topics and their remaining hours
const olympiadTopics = topics.filter(t => t.subjectId === "olympiad");
const totalOlympiadHours = olympiadTopics.reduce((sum, t) => sum + t.estHours, 0);
const completedOlympiadHours = olympiadTopics.reduce((sum, t) => sum + Math.min(t.completedHours, t.estHours), 0);
const remainingOlympiadHours = olympiadTopics.reduce((sum, t) => sum + Math.max(t.estHours - t.completedHours, 0), 0);

console.log(`\nOlympiad Topics: ${olympiadTopics.length}`);
console.log(`Total olympiad hours: ${totalOlympiadHours.toFixed(1)}`);
console.log(`Completed olympiad hours: ${completedOlympiadHours.toFixed(1)}`);
console.log(`Remaining olympiad hours: ${remainingOlympiadHours.toFixed(1)}`);
console.log(`Remaining olympiad minutes: ${Math.round(remainingOlympiadHours * 60)}`);

// Count topics with dependencies
const topicsWithDeps = olympiadTopics.filter(t => t.dependsOnTopicId);
console.log(`\nOlympiad topics with dependencies: ${topicsWithDeps.length}`);
console.log(`Olympiad topics without dependencies: ${olympiadTopics.length - topicsWithDeps.length}`);

// Check sequence groups and stages
const groupCounts: Record<string, number> = {};
const stageCounts: Record<string, number> = {};
olympiadTopics.forEach(t => {
  const group = t.sequenceGroup ?? "none";
  const stage = t.sequenceStage ?? "none";
  groupCounts[group] = (groupCounts[group] ?? 0) + 1;
  stageCounts[stage] = (stageCounts[stage] ?? 0) + 1;
});
console.log(`\nSequence groups: ${JSON.stringify(groupCounts)}`);
console.log(`Sequence stages: ${JSON.stringify(stageCounts)}`);

console.log("\n=== RUNNING HORIZON GENERATION ===");
console.log("fillAvailableStudyDays: true");

const startTime = Date.now();
const result = generateStudyPlanHorizon({
  startWeek: startOfPlannerWeek(referenceDate),
  referenceDate,
  goals,
  subjects,
  topics,
  fixedEvents,
  preferences,
  fillAvailableStudyDays: true,
  allowReinforcement: true,
});
const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`Generation completed in ${elapsed}s`);

// Analyze results
const allBlocks = result.studyBlocks;
const olympiadBlocks = allBlocks.filter(b => b.subjectId === "olympiad");
const olympiadMinutes = olympiadBlocks.reduce((sum, b) => sum + b.estimatedMinutes, 0);
const totalBlocks = allBlocks.filter(b => b.subjectId);
const totalMinutes = totalBlocks.reduce((sum, b) => sum + b.estimatedMinutes, 0);

console.log(`\n=== RESULTS ===`);
console.log(`Total study blocks: ${totalBlocks.length}`);
console.log(`Total study minutes: ${totalMinutes} (${(totalMinutes / 60).toFixed(1)}h)`);
console.log(`Olympiad blocks: ${olympiadBlocks.length}`);
console.log(`Olympiad minutes: ${olympiadMinutes} (${(olympiadMinutes / 60).toFixed(1)}h)`);
console.log(`Olympiad remaining unscheduled: ${Math.round(remainingOlympiadHours * 60) - olympiadMinutes} min`);
console.log(`  = ${((Math.round(remainingOlympiadHours * 60) - olympiadMinutes) / 60).toFixed(1)} hours`);

// Per-subject breakdown
const minutesBySubject: Record<string, number> = {};
allBlocks.forEach(b => {
  if (b.subjectId) {
    minutesBySubject[b.subjectId] = (minutesBySubject[b.subjectId] ?? 0) + b.estimatedMinutes;
  }
});
console.log(`\nMinutes by subject:`);
Object.entries(minutesBySubject).sort((a, b) => b[1] - a[1]).forEach(([id, min]) => {
  console.log(`  ${id}: ${min} min (${(min / 60).toFixed(1)}h)`);
});

// Unscheduled tasks from the final week
const lastWeekPlan = result.weeklyPlans[result.weeklyPlans.length - 1];
console.log(`\nWeekly plans: ${result.weeklyPlans.length}`);
console.log(`First week: ${result.weeklyPlans[0]?.weekStart}`);
console.log(`Last week: ${lastWeekPlan?.weekStart}`);

// Check weeks around November 2026
const novemberWeeks = result.weeklyPlans.filter(
  wp => wp.weekStart >= "2026-10-26" && wp.weekStart <= "2026-12-07"
);
console.log(`\n=== NOVEMBER 2026 WEEKS ===`);
novemberWeeks.forEach(wp => {
  const weekBlocks = allBlocks.filter(b => b.weekStart === wp.weekStart && b.subjectId);
  const weekMinutes = weekBlocks.reduce((sum, b) => sum + b.estimatedMinutes, 0);
  const weekOlympiad = weekBlocks.filter(b => b.subjectId === "olympiad");
  const weekOlympiadMin = weekOlympiad.reduce((sum, b) => sum + b.estimatedMinutes, 0);
  console.log(`  ${wp.weekStart}: ${weekBlocks.length} blocks, ${weekMinutes} min total, ${weekOlympiadMin} min olympiad, slack=${wp.slackMinutes} min, fillableGaps=${wp.fillableGapDateKeys.length}`);
});

// Check reinforcement blocks
const reinforcementBlocks = allBlocks.filter(b => b.title?.includes("reinforcement"));
console.log(`\nReinforcement blocks: ${reinforcementBlocks.length}`);
const reinforcementMinutes = reinforcementBlocks.reduce((sum, b) => sum + b.estimatedMinutes, 0);
console.log(`Reinforcement minutes: ${reinforcementMinutes} (${(reinforcementMinutes / 60).toFixed(1)}h)`);

// Count free slots in final result
const totalFreeSlotMinutes = result.weeklyPlans.reduce(
  (sum, wp) => sum + wp.slackMinutes,
  0
);
console.log(`\nTotal slack across all weeks: ${totalFreeSlotMinutes} min (${(totalFreeSlotMinutes / 60).toFixed(1)}h)`);

// Check for weeks with both fillable gaps and unscheduled olympiad
const gapWeeks = result.weeklyPlans.filter(wp => wp.fillableGapDateKeys.length > 0);
console.log(`\nWeeks with fillable gaps: ${gapWeeks.length}`);
gapWeeks.slice(0, 10).forEach(wp => {
  console.log(`  ${wp.weekStart}: gaps on ${wp.fillableGapDateKeys.join(", ")}`);
});
