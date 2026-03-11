import { isWithinInterval } from "date-fns";

import { fromDateKey } from "@/lib/dates/helpers";
import type { Preferences, TimeWindow } from "@/lib/types/planner";

export type ScheduleRegime = "school-term" | "holiday" | "default";

export interface DailyScheduleProfile {
  regime: ScheduleRegime;
  dailyStudyWindow: {
    start: string;
    end: string;
  };
  preferredDeepWorkWindows: TimeWindow[];
  maxStudyHoursPerDay: number;
}

function isValidScheduleDate(value: string) {
  if (!value) {
    return false;
  }

  const parsed = fromDateKey(value);
  return !Number.isNaN(parsed.getTime());
}

export function isDateInActiveSchoolTerm(day: Date, preferences: Preferences) {
  if (!preferences.schoolSchedule.enabled) {
    return false;
  }

  return preferences.schoolSchedule.terms.some((term) => {
    if (!isValidScheduleDate(term.startDate) || !isValidScheduleDate(term.endDate)) {
      return false;
    }

    return isWithinInterval(day, {
      start: fromDateKey(term.startDate),
      end: fromDateKey(term.endDate),
    });
  });
}

export function resolveDailyScheduleProfile(day: Date, preferences: Preferences): DailyScheduleProfile {
  const inSchoolTerm = isDateInActiveSchoolTerm(day, preferences);

  if (!inSchoolTerm && preferences.holidaySchedule.enabled) {
    return {
      regime: "holiday",
      dailyStudyWindow: preferences.holidaySchedule.dailyStudyWindow,
      preferredDeepWorkWindows: preferences.holidaySchedule.preferredDeepWorkWindows,
      maxStudyHoursPerDay:
        preferences.holidaySchedule.maxStudyHoursPerDay ?? preferences.maxStudyHoursPerDay,
    };
  }

  return {
    regime: inSchoolTerm ? "school-term" : "default",
    dailyStudyWindow: preferences.dailyStudyWindow,
    preferredDeepWorkWindows: preferences.preferredDeepWorkWindows,
    maxStudyHoursPerDay: preferences.maxStudyHoursPerDay,
  };
}
