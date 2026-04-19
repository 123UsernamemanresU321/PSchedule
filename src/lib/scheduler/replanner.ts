import { startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { studyBlockOverlapsFixedEvent } from "@/lib/scheduler/free-slots";
import { generateStudyPlanForWeek } from "@/lib/scheduler/generator";
import type {
  CompletionLog,
  FixedEvent,
  FocusedDay,
  FocusedWeek,
  Goal,
  Preferences,
  SchedulerResult,
  SickDay,
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
  completionLogs?: CompletionLog[];
  fixedEvents: FixedEvent[];
  sickDays?: SickDay[];
  focusedDays?: FocusedDay[];
  focusedWeeks?: FocusedWeek[];
  studyBlocks: StudyBlock[];
  preferences: Preferences;
}): SchedulerResult {
  const weekStart = startOfPlannerWeek(options.weekStart ?? new Date());
  const now = new Date();
  const preservedBlocks = options.studyBlocks.filter(
    (block) => block.status === "done" || block.status === "partial",
  );

  const incompleteBlocks = options.studyBlocks.filter((block) => {
    if (preservedBlocks.some((candidate) => candidate.id === block.id)) {
      return false;
    }

    return !studyBlockOverlapsFixedEvent(block, options.fixedEvents, weekStart, options.preferences);
  });
  const activeInProgressBlocks = incompleteBlocks.filter(
    (block) =>
      ["planned", "rescheduled"].includes(block.status) &&
      new Date(block.start).getTime() <= now.getTime() &&
      new Date(block.end).getTime() > now.getTime(),
  );
  const baselineLockedBlocks = incompleteBlocks.filter(
    (block) =>
      ["planned", "rescheduled"].includes(block.status) &&
      new Date(block.start).getTime() > now.getTime(),
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
      ...activeInProgressBlocks,
      ...baselineLockedBlocks.filter((block) => !scenario.releaseBlocks(block)),
    ].sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());

    const result = generateStudyPlanForWeek({
      weekStart,
      goals: options.goals,
      subjects: options.subjects,
      topics: options.topics,
      completionLogs: options.completionLogs,
      fixedEvents: options.fixedEvents,
      sickDays: options.sickDays,
      focusedDays: options.focusedDays,
      focusedWeeks: options.focusedWeeks,
      preferences: options.preferences,
      lockedBlocks,
      existingPlannedBlocks: options.studyBlocks,
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
    completionLogs: options.completionLogs,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays,
    focusedDays: options.focusedDays,
    focusedWeeks: options.focusedWeeks,
    preferences: options.preferences,
    lockedBlocks: [...preservedBlocks, ...activeInProgressBlocks],
    existingPlannedBlocks: options.studyBlocks,
    dailyCapBoostMinutes: 45,
  });
}
