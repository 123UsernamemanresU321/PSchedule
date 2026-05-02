import { buildSeedPreferences } from "./src/lib/seed/preferences";
import { calculateFreeSlots } from "./src/lib/scheduler/free-slots";

const preferences = buildSeedPreferences();
const weekStart = new Date("2026-11-09T00:00:00");

const slots = calculateFreeSlots({
  weekStart,
  fixedEvents: [],
  sickDays: [],
  preferences,
  blockedStudyBlocks: [],
  planningStart: weekStart,
  skipMovableRecovery: false,
});

slots.filter(s => s.dateKey === "2026-11-10").forEach(s => {
  console.log(`Slot: ${s.durationMinutes} mins, dayStudyCapMinutes: ${s.dayStudyCapMinutes}`);
});
