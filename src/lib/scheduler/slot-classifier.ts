import { addMinutes } from "date-fns";

import { blockPresets, blockTypeValues } from "@/lib/constants/planner";
import { createDateAtTime, minutesBetween } from "@/lib/dates/helpers";
import { resolveDailyScheduleProfile } from "@/lib/scheduler/schedule-regime";
import type {
  BlockIntensity,
  BlockType,
  CalendarSlot,
  EnergyLevel,
  Preferences,
  TaskCandidate,
  TimeWindow,
} from "@/lib/types/planner";

export interface BlockOption {
  blockType: BlockType;
  durationMinutes: number;
  intensity: BlockIntensity;
  slotFitPenalty: number;
  fragmentationPenalty: number;
}

export interface BlockSelectionPolicy {
  allowLowEnergyHeavy?: boolean;
  allowLateNightDeepWork?: boolean;
  preferLongerBlocks?: boolean;
}

function overlapsWindow(slot: CalendarSlot, window: TimeWindow) {
  if (!window.days.includes(slot.start.getDay())) {
    return false;
  }

  const windowStart = createDateAtTime(slot.start, window.start);
  const windowEnd = createDateAtTime(slot.start, window.end);
  return slot.start < windowEnd && slot.end > windowStart;
}

export function classifySlotEnergy(slot: CalendarSlot, preferences: Preferences): EnergyLevel {
  const scheduleProfile = resolveDailyScheduleProfile(slot.start, preferences);

  if (scheduleProfile.preferredDeepWorkWindows.some((window) => overlapsWindow(slot, window))) {
    return "prime";
  }

  const lateNightCutoff = createDateAtTime(slot.start, preferences.lateNightCutoff);
  if (slot.start >= lateNightCutoff || slot.start.getHours() < 8) {
    return "low";
  }

  return "steady";
}

function expandCandidateBlockTypes(task: TaskCandidate): BlockType[] {
  const fallbacks: BlockType[] =
    task.kind === "review" || task.kind === "recovery"
      ? ["review", "recovery"]
      : ["drill", "review", "recovery"];

  return Array.from(new Set([...task.preferredBlockTypes, ...fallbacks])).filter((value) =>
    blockTypeValues.includes(value),
  );
}

function getEnergyPenalty(
  blockType: BlockType,
  slot: CalendarSlot,
  preferences: Preferences,
  policy?: BlockSelectionPolicy,
) {
  const slotEnergy = slot.energy;
  const slotEndsLate = slot.end >= createDateAtTime(slot.start, preferences.lateNightCutoff);

  if ((blockType === "deep_work" || blockType === "standard_focus") && slotEnergy === "low") {
    return policy?.allowLowEnergyHeavy ? 8 : Number.POSITIVE_INFINITY;
  }

  if (preferences.avoidLateNightHeavy && slotEndsLate && blockType === "deep_work") {
    return policy?.allowLateNightDeepWork ? 6 : Number.POSITIVE_INFINITY;
  }

  if (slotEnergy === "prime") {
    return 0;
  }

  if (slotEnergy === "steady") {
    return blockType === "deep_work" ? 4 : blockType === "standard_focus" ? 2 : 0;
  }

  if (blockType === "drill") {
    return 3;
  }

  return 0;
}

export function selectBlockOption(
  task: TaskCandidate,
  slot: CalendarSlot,
  preferences: Preferences,
  policy?: BlockSelectionPolicy,
): BlockOption | null {
  const candidates = expandCandidateBlockTypes(task);
  const viableOptions = candidates
    .map((blockType) => {
      const preset = blockPresets[blockType];
      const slotFitPenalty = getEnergyPenalty(blockType, slot, preferences, policy);

      if (slotFitPenalty === Number.POSITIVE_INFINITY) {
        return null;
      }

      const maxDuration = Math.min(
        preset.maxMinutes,
        preset.targetMinutes,
        task.remainingMinutes,
        slot.durationMinutes,
      );

      if (maxDuration < preset.minMinutes) {
        return null;
      }

      const fragmentationPenalty = Math.max(
        0,
        Math.round((preset.targetMinutes - maxDuration) / 10),
      );

      return {
        blockType,
        durationMinutes: maxDuration,
        intensity: preset.intensity,
        slotFitPenalty,
        fragmentationPenalty,
      } satisfies BlockOption;
    })
    .filter(Boolean) as BlockOption[];

  if (!viableOptions.length) {
    return null;
  }

  return viableOptions.sort((left, right) => {
    const leftPenalty =
      left.slotFitPenalty +
      left.fragmentationPenalty -
      (policy?.preferLongerBlocks ? left.durationMinutes / 60 : 0);
    const rightPenalty =
      right.slotFitPenalty +
      right.fragmentationPenalty -
      (policy?.preferLongerBlocks ? right.durationMinutes / 60 : 0);
    const penaltyGap = leftPenalty - rightPenalty;

    if (penaltyGap !== 0) {
      return penaltyGap;
    }

    return right.durationMinutes - left.durationMinutes;
  })[0];
}

export function createSlotSlice(
  slot: CalendarSlot,
  start: Date,
  durationMinutes: number,
): CalendarSlot {
  return {
    ...slot,
    start,
    end: addMinutes(start, durationMinutes),
    durationMinutes: minutesBetween(start, addMinutes(start, durationMinutes)),
  };
}
