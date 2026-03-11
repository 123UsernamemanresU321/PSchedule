import { differenceInCalendarDays } from "date-fns";

import { clamp } from "@/lib/utils";
import type {
  Preferences,
  ScoreBreakdown,
  Subject,
  TaskCandidate,
} from "@/lib/types/planner";
import type { BlockOption } from "@/lib/scheduler/slot-classifier";
import type { CalendarSlot } from "@/lib/types/planner";

export interface ScoringContext {
  subjectMap: Map<string, Subject>;
  preferences: Preferences;
  requiredMinutesBySubject: Record<string, number>;
  assignedMinutesBySubject: Record<string, number>;
  referenceDate: Date;
}

export function scoreTaskCandidate(
  task: TaskCandidate,
  slot: CalendarSlot,
  blockOption: BlockOption,
  context: ScoringContext,
) {
  if (!task.subjectId) {
    return {
      priorityWeight: 0,
      deadlineUrgency: 0,
      remainingWorkloadPressure: 0,
      lowMasteryBonus: 0,
      reviewDueBonus: 0,
      neglectedSubjectBonus: 0,
      olympiadSlotBonus: 0,
      badSlotFitPenalty: 0,
      fragmentationPenalty: 0,
      total: 0,
    } satisfies ScoreBreakdown;
  }

  const subject = context.subjectMap.get(task.subjectId);
  const subjectWeight =
    context.preferences.subjectWeightOverrides[task.subjectId] ??
    subject?.defaultPriority ??
    0.5;
  const daysUntilDeadline = differenceInCalendarDays(new Date(task.deadline), slot.start);
  const daysSinceStudy = task.lastStudiedAt
    ? differenceInCalendarDays(slot.start, new Date(task.lastStudiedAt))
    : 10;
  const requiredMinutes = context.requiredMinutesBySubject[task.subjectId] ?? 0;
  const assignedMinutes = context.assignedMinutesBySubject[task.subjectId] ?? 0;

  const priorityWeight = subjectWeight * 24;
  const deadlineUrgency = clamp(1 - daysUntilDeadline / 115, 0, 1) * 18;
  const remainingWorkloadPressure =
    clamp((requiredMinutes - assignedMinutes) / 60, 0, 5) * 4 +
    clamp(task.remainingMinutes / 60, 0, 4) * 1.5;
  const lowMasteryBonus = (5 - task.mastery) * 2.6;
  const reviewDueBonus =
    !task.reviewDue
      ? 0
      : new Date(task.reviewDue) <= slot.start
        ? 11
        : differenceInCalendarDays(new Date(task.reviewDue), slot.start) <= 2
          ? 7
          : 3;
  const neglectedSubjectBonus = clamp(daysSinceStudy, 0, 8) * 1.1;
  const olympiadSlotBonus =
    task.subjectId === "olympiad"
      ? slot.energy === "prime"
        ? 8
        : slot.energy === "steady"
          ? 2
          : -7
      : 0;
  const sequencePenalty =
    task.kind === "topic"
      ? clamp(task.blockedByEarlierTopics, 0, 5) * 9
      : 0;
  const badSlotFitPenalty = blockOption.slotFitPenalty;
  const fragmentationPenalty = blockOption.fragmentationPenalty;

  const total =
    priorityWeight +
    deadlineUrgency +
    remainingWorkloadPressure +
    lowMasteryBonus +
    reviewDueBonus +
    neglectedSubjectBonus +
    olympiadSlotBonus -
    sequencePenalty -
    badSlotFitPenalty -
    fragmentationPenalty;

  return {
    priorityWeight,
    deadlineUrgency,
    remainingWorkloadPressure,
    lowMasteryBonus,
    reviewDueBonus,
    neglectedSubjectBonus,
    olympiadSlotBonus,
    badSlotFitPenalty,
    fragmentationPenalty,
    total: Math.round(total * 10) / 10,
  } satisfies ScoreBreakdown;
}

export function buildGeneratedReason(
  task: TaskCandidate,
  slot: CalendarSlot,
  scoreBreakdown: ScoreBreakdown,
) {
  const reasons = [
    {
      label: "subject priority is high",
      value: scoreBreakdown.priorityWeight,
    },
    {
      label: `remaining workload pressure is still ${Math.round(scoreBreakdown.remainingWorkloadPressure)}`,
      value: scoreBreakdown.remainingWorkloadPressure,
    },
    {
      label: `mastery is ${task.mastery}/5`,
      value: scoreBreakdown.lowMasteryBonus,
    },
    {
      label: "review is due soon",
      value: scoreBreakdown.reviewDueBonus,
    },
    {
      label: "the subject has been neglected recently",
      value: scoreBreakdown.neglectedSubjectBonus,
    },
  ]
    .filter((reason) => reason.value > 0)
    .sort((left, right) => right.value - left.value)
    .slice(0, 3)
    .map((reason) => reason.label);

  const slotDescriptor =
    slot.energy === "prime"
      ? "a prime high-energy slot"
      : slot.energy === "steady"
        ? "a steady mid-energy slot"
        : "a lighter low-energy slot";

  return `${reasons.join(", ")}, and ${slotDescriptor} suits ${task.title.toLowerCase()}.`;
}
