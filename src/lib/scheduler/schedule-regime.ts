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

function timeStringToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map((part) => Number(part));
  return hours * 60 + minutes;
}

function getWindowDurationHours(window: { start: string; end: string }) {
  const startMinutes = timeStringToMinutes(window.start);
  let endMinutes = timeStringToMinutes(window.end);

  if (endMinutes <= startMinutes) {
    endMinutes += 24 * 60;
  }

  return (endMinutes - startMinutes) / 60;
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
  const isSaturday = day.getDay() === 6;
  const defaultRegime: ScheduleRegime = inSchoolTerm ? "school-term" : "default";
  const holidayLikeProfile = {
    regime: "holiday" as const,
    dailyStudyWindow: preferences.holidaySchedule.dailyStudyWindow,
    preferredDeepWorkWindows: preferences.holidaySchedule.preferredDeepWorkWindows,
    maxStudyHoursPerDay: getWindowDurationHours(preferences.holidaySchedule.dailyStudyWindow),
  };

  const baseProfile =
    isSaturday || (!inSchoolTerm && preferences.holidaySchedule.enabled)
      ? holidayLikeProfile
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
