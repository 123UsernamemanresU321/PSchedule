import { startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { studyBlockOverlapsFixedEvent } from "@/lib/scheduler/free-slots";
import { generateStudyPlanForWeek } from "@/lib/scheduler/generator";
import type {
  FixedEvent,
  Goal,
  Preferences,
  SchedulerResult,
  StudyBlock,
  Subject,
  Topic,
} from "@/lib/types/planner";

function isLowPriorityLightBlock(block: StudyBlock, subjects: Subject[]) {
  if (block.intensity !== "light" || !block.subjectId) {
    return false;
  }

  const subject = subjects.find((candidate) => candidate.id === block.subjectId);
  return (subject?.defaultPriority ?? 1) < 0.9;
}

function isSplittableMediumBlock(block: StudyBlock) {
  return ["standard_focus", "drill"].includes(block.blockType) && block.subjectId !== "olympiad";
}

function isLowerPressureBlock(block: StudyBlock, subjects: Subject[]) {
  if (!block.subjectId) {
    return true;
  }

  const subject = subjects.find((candidate) => candidate.id === block.subjectId);
  return (subject?.defaultPriority ?? 1) <= 0.85 || block.scoreBreakdown.total < 55;
}

export function replanStudyPlan(options: {
  weekStart?: Date;
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  fixedEvents: FixedEvent[];
  studyBlocks: StudyBlock[];
  preferences: Preferences;
}): SchedulerResult {
  const weekStart = startOfPlannerWeek(options.weekStart ?? new Date());
  const now = new Date();
  const preservedBlocks = options.studyBlocks.filter((block) => {
    return block.status === "done";
  });

  const incompleteBlocks = options.studyBlocks.filter((block) => {
    if (preservedBlocks.some((candidate) => candidate.id === block.id)) {
      return false;
    }

    return !studyBlockOverlapsFixedEvent(block, options.fixedEvents, weekStart, options.preferences);
  });
  const baselineLockedBlocks = incompleteBlocks.filter(
    (block) => block.status === "planned" && new Date(block.start) > now,
  );

  const scenarios: Array<{
    releaseBlocks: (block: StudyBlock) => boolean;
    dailyCapBoostMinutes?: number;
  }> = [
    {
      releaseBlocks: () => false,
    },
    {
      releaseBlocks: (block) => isLowPriorityLightBlock(block, options.subjects),
    },
    {
      releaseBlocks: (block) => isSplittableMediumBlock(block),
    },
    {
      releaseBlocks: (block) => isLowerPressureBlock(block, options.subjects),
    },
    {
      releaseBlocks: () => true,
      dailyCapBoostMinutes: 30,
    },
  ];

  for (const scenario of scenarios) {
    const lockedBlocks = [
      ...preservedBlocks,
      ...baselineLockedBlocks.filter((block) => !scenario.releaseBlocks(block)),
    ].sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());

    const result = generateStudyPlanForWeek({
      weekStart,
      goals: options.goals,
      subjects: options.subjects,
      topics: options.topics,
      fixedEvents: options.fixedEvents,
      preferences: options.preferences,
      lockedBlocks,
      dailyCapBoostMinutes: scenario.dailyCapBoostMinutes,
    });

    if (!result.unscheduledTasks.length || toDateKey(weekStart) !== result.weeklyPlan.weekStart) {
      return result;
    }
  }

  return generateStudyPlanForWeek({
    weekStart,
    goals: options.goals,
    subjects: options.subjects,
    topics: options.topics,
    fixedEvents: options.fixedEvents,
    preferences: options.preferences,
    lockedBlocks: preservedBlocks,
    dailyCapBoostMinutes: 45,
  });
}
