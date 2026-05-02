import { buildSeedPreferences } from "./src/lib/seed/preferences";
import { calculateFreeSlots } from "./src/lib/scheduler/free-slots";
import { addDays } from "date-fns";

const preferences = buildSeedPreferences();
const weekStart = new Date("2026-11-09T00:00:00"); // A Monday

const slots = calculateFreeSlots({
  weekStart,
  fixedEvents: [],
  sickDays: [],
  preferences,
  blockedStudyBlocks: [],
  planningStart: weekStart,
  skipMovableRecovery: false,
});

console.log("Slots for Monday:");
slots.filter(s => s.dateKey === "2026-11-09").forEach(s => {
  console.log(`${s.start.toISOString()} - ${s.end.toISOString()} (${s.durationMinutes} mins) [${s.energy}]`);
});

console.log("\nSlots for Tuesday (has Piano):");
slots.filter(s => s.dateKey === "2026-11-10").forEach(s => {
  console.log(`${s.start.toISOString()} - ${s.end.toISOString()} (${s.durationMinutes} mins) [${s.energy}]`);
});
