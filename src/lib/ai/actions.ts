import type { AiPlannerAction } from "@/lib/ai/contracts";
import type { FixedEvent, FocusedDay, FocusedWeek } from "@/lib/types/planner";
import { createId } from "@/lib/utils";

export async function applyAiPlannerActions(options: {
  actions: AiPlannerAction[];
  saveFixedEvent: (event: FixedEvent) => Promise<void>;
  saveFocusedDay: (focusedDay: FocusedDay) => Promise<void>;
  saveFocusedWeek: (focusedWeek: FocusedWeek) => Promise<void>;
}) {
  for (const action of options.actions) {
    switch (action.kind) {
      case "fixed_event":
        await options.saveFixedEvent({
          id: createId("event"),
          ...action.event,
        });
        break;
      case "focused_day":
        await options.saveFocusedDay({
          id: createId("focus-day"),
          ...action.focusedDay,
        });
        break;
      case "focused_week":
        await options.saveFocusedWeek({
          id: createId("focus-week"),
          ...action.focusedWeek,
        });
        break;
      default:
        break;
    }
  }
}
