import type { FixedEvent } from "@/lib/types/planner";

export const legacySeedFixedEventIds = [
  "school-mon",
  "school-tue",
  "school-wed",
  "school-thu",
  "school-fri",
  "gym-mon",
  "study-group-tue",
  "piano-wed",
  "library-thu",
  "family-fri",
  "olympiad-circle-sat",
  "gym-sat",
  "recovery-sun",
] as const;

function isLegacySeedFixedEventId(id: string) {
  return legacySeedFixedEventIds.includes(id as (typeof legacySeedFixedEventIds)[number]);
}

export function buildSeedFixedEvents(): FixedEvent[] {
  return [];
}

export function hasLegacySeedFixedEvents(fixedEvents: FixedEvent[]) {
  return fixedEvents.some((event) => isLegacySeedFixedEventId(event.id));
}

export function stripLegacySeedFixedEvents(fixedEvents: FixedEvent[]) {
  return fixedEvents.filter((event) => !isLegacySeedFixedEventId(event.id));
}

export function isLegacySeedFixedEventSet(fixedEvents: FixedEvent[]) {
  if (!fixedEvents.length) {
    return false;
  }

  return fixedEvents.every((event) => isLegacySeedFixedEventId(event.id));
}
