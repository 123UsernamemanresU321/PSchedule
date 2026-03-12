import { isWithinInterval } from "date-fns";

import { fromDateKey } from "@/lib/dates/helpers";
import type { Preferences, TimeWindow } from "@/lib/types/planner";

export type ScheduleRegime = "school-term" | "holiday" | "default";

export interface DailyScheduleProfile {
  regime: ScheduleRegime;
  isStudyEnabled: boolean;
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
  const isSunday = day.getDay() === 0;
  const defaultRegime: ScheduleRegime = inSchoolTerm ? "school-term" : "default";

  const baseProfile =
    !inSchoolTerm && preferences.holidaySchedule.enabled
      ? {
          regime: "holiday" as const,
          dailyStudyWindow: preferences.holidaySchedule.dailyStudyWindow,
          preferredDeepWorkWindows: preferences.holidaySchedule.preferredDeepWorkWindows,
          maxStudyHoursPerDay:
            preferences.holidaySchedule.maxStudyHoursPerDay ?? preferences.maxStudyHoursPerDay,
        }
      : {
          regime: defaultRegime,
          dailyStudyWindow: preferences.dailyStudyWindow,
          preferredDeepWorkWindows: preferences.preferredDeepWorkWindows,
          maxStudyHoursPerDay: preferences.maxStudyHoursPerDay,
        };

  if (isSunday && !preferences.sundayStudy.enabled) {
    return {
      ...baseProfile,
      isStudyEnabled: false,
      maxStudyHoursPerDay: 0,
    };
  }

  if (isSunday) {
    return {
      ...baseProfile,
      isStudyEnabled: true,
      maxStudyHoursPerDay: Math.max(
        0.5,
        Math.round(baseProfile.maxStudyHoursPerDay * preferences.sundayStudy.workloadIntensity * 10) /
          10,
      ),
    };
  }

  return {
    ...baseProfile,
    isStudyEnabled: true,
  };
}
