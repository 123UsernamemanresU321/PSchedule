import { isWithinInterval } from "date-fns";

import { fromDateKey, toDateKey } from "@/lib/dates/helpers";
import type {
  BlockType,
  Preferences,
  ReservedCommitmentRule,
  SickDay,
  SickDayEffectProfile,
  SickDaySeverity,
  TimeWindow,
} from "@/lib/types/planner";

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
  maxHeavySessionsPerDay: number;
  allowedBlockTypes: BlockType[] | null;
  reservedCommitmentMinutes: number;
  sickDaySeverity: SickDaySeverity | null;
  sickDayDescription: string | null;
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

function getConfiguredSchoolTerms(preferences: Preferences) {
  return preferences.schoolSchedule.terms.filter(
    (term) => isValidScheduleDate(term.startDate) && isValidScheduleDate(term.endDate),
  );
}

export function isTermHomeworkIntensifiedDate(dateKey: string, preferences: Preferences) {
  const term3 = preferences.schoolSchedule.terms.find((term) => {
    const normalizedLabel = term.label.trim().toLowerCase();
    return term.id === "term-3" || normalizedLabel === "term 3";
  });

  return !!term3?.endDate && term3.endDate.startsWith("2026-") && dateKey > term3.endDate;
}

export function getNoSchoolDay(day: Date, preferences: Preferences) {
  const dateKey = toDateKey(day);
  return preferences.schoolSchedule.noSchoolDays.find((entry) => entry.date === dateKey) ?? null;
}

export function isDateInActiveSchoolTerm(day: Date, preferences: Preferences) {
  if (getNoSchoolDay(day, preferences)) {
    return false;
  }

  const configuredTerms = getConfiguredSchoolTerms(preferences);
  if (!configuredTerms.length) {
    return false;
  }

  return configuredTerms.some((term) => {
    // Extend the end boundary to the very end of the last day of term so
    // that queries at any time during that day (e.g. 3 PM) still count as
    // being inside the term, not just before midnight.
    const termEnd = fromDateKey(term.endDate);
    termEnd.setHours(23, 59, 59, 999);
    return isWithinInterval(day, {
      start: fromDateKey(term.startDate),
      end: termEnd,
    });
  });
}

function getReservedCommitmentMinutes(
  day: Date,
  preferences: Preferences,
  inSchoolTerm: boolean,
  sickDayEffect: SickDayEffectProfile | null,
) {
  const dateKey = toDateKey(day);
  return preferences.reservedCommitmentRules.reduce((total, rule) => {
    if (!isReservedCommitmentRuleActiveOnDate(rule, day, inSchoolTerm, preferences)) {
      return total;
    }

    return total + getReservedCommitmentDurationForDate(rule, dateKey, sickDayEffect, preferences);
  }, 0);
}

function doesReservedCommitmentRuleMatchRegime(
  rule: ReservedCommitmentRule,
  inSchoolTerm: boolean,
) {
  return (
    rule.appliesDuring === "all" ||
    (rule.appliesDuring === "school-term" && inSchoolTerm) ||
    (rule.appliesDuring === "holiday" && !inSchoolTerm)
  );
}

export function isReservedCommitmentRuleActiveOnDate(
  rule: ReservedCommitmentRule,
  day: Date,
  inSchoolTerm: boolean,
  preferences?: Preferences,
) {
  const dateKey = toDateKey(day);
  if (rule.excludedDates?.includes(dateKey)) {
    return false;
  }

  if (rule.additionalDates?.includes(dateKey)) {
    return true;
  }

  const appliesToRegime = doesReservedCommitmentRuleMatchRegime(rule, inSchoolTerm);
  if (!appliesToRegime) {
    return false;
  }

  if (rule.id === "term-homework" && inSchoolTerm && preferences) {
    // Respect user-configured rule.days if set; fall back to school weekdays.
    const activeDays = new Set(
      rule.days.length > 0 ? rule.days : preferences.schoolSchedule.weekdays,
    );

    if (isTermHomeworkIntensifiedDate(dateKey, preferences)) {
      preferences.schoolSchedule.weekdays.forEach((weekday) => activeDays.add(weekday));
      activeDays.add(0);
      activeDays.add(6);
    }

    return activeDays.has(day.getDay());
  }

  return rule.days.includes(day.getDay());
}

export function getReservedCommitmentDurationForDate(
  rule: ReservedCommitmentRule,
  dateKey: string,
  sickDayEffect: SickDayEffectProfile | null = null,
  preferences?: Preferences,
) {
  const overriddenDuration = rule.durationOverrides?.[dateKey];

  if (rule.id === "piano-practice" && sickDayEffect) {
    return sickDayEffect.pianoMinutesOverride ?? 0;
  }

  if (rule.id === "term-homework" && preferences && isTermHomeworkIntensifiedDate(dateKey, preferences)) {
    return overriddenDuration ?? Math.max(rule.durationMinutes, 150);
  }

  return overriddenDuration ?? rule.durationMinutes;
}

const SICK_DAY_SEVERITY_ORDER: SickDaySeverity[] = ["light", "moderate", "severe"];

export function getSickDayEffectProfile(severity: SickDaySeverity): SickDayEffectProfile {
  switch (severity) {
    case "light":
      return {
        severity,
        studyCapacityMultiplier: 0.7,
        maxHeavySessionsPerDay: 1,
        pianoMinutesOverride: 30,
        label: "Light sick day",
        description: "Mild cold. Keep work lighter than normal and avoid stacking intense sessions.",
      };
    case "moderate":
      return {
        severity,
        studyCapacityMultiplier: 0.45,
        maxHeavySessionsPerDay: 0,
        allowedBlockTypes: ["standard_focus", "drill", "review", "recovery"],
        pianoMinutesOverride: 0,
        label: "Moderate sick day",
        description: "Tired or foggy. Only essential work, no deep work, and no piano practice.",
      };
    case "severe":
      return {
        severity,
        studyCapacityMultiplier: 0.2,
        maxHeavySessionsPerDay: 0,
        allowedBlockTypes: ["drill", "review", "recovery"],
        pianoMinutesOverride: 0,
        label: "Severe sick day",
        description: "Recovery-first day. Only minimal light maintenance if unavoidable.",
      };
    default:
      return {
        severity: "light",
        studyCapacityMultiplier: 0.7,
        maxHeavySessionsPerDay: 1,
        pianoMinutesOverride: 30,
        label: "Light sick day",
        description: "Mild cold. Keep work lighter than normal and avoid stacking intense sessions.",
      };
  }
}

export function getActiveSickDaySeverity(day: Date, sickDays: SickDay[]) {
  const dayKey = [
    day.getFullYear(),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0"),
  ].join("-");

  const activeSeverities = sickDays
    .filter((sickDay) => dayKey >= sickDay.startDate && dayKey <= sickDay.endDate)
    .map((sickDay) => sickDay.severity)
    .sort(
      (left, right) =>
        SICK_DAY_SEVERITY_ORDER.indexOf(right) - SICK_DAY_SEVERITY_ORDER.indexOf(left),
    );

  return activeSeverities[0] ?? null;
}

export function resolveDailyScheduleProfile(
  day: Date,
  preferences: Preferences,
  sickDays: SickDay[] = [],
): DailyScheduleProfile {
  const inSchoolTerm = isDateInActiveSchoolTerm(day, preferences);
  const isSunday = day.getDay() === 0;
  const isSaturday = day.getDay() === 6;
  const isWeekend = isSaturday || isSunday;
  const defaultRegime: ScheduleRegime = inSchoolTerm ? "school-term" : "default";
  const sickDaySeverity = getActiveSickDaySeverity(day, sickDays);
  const sickDayEffect = sickDaySeverity ? getSickDayEffectProfile(sickDaySeverity) : null;
  const reservedCommitmentMinutes = getReservedCommitmentMinutes(
    day,
    preferences,
    inSchoolTerm,
    sickDayEffect,
  );
  const holidayLikeProfile = {
    regime: "holiday" as const,
    dailyStudyWindow: preferences.holidaySchedule.dailyStudyWindow,
    preferredDeepWorkWindows: preferences.holidaySchedule.preferredDeepWorkWindows,
    maxStudyHoursPerDay: getWindowDurationHours(preferences.holidaySchedule.dailyStudyWindow),
    maxHeavySessionsPerDay: preferences.maxHeavySessionsPerDay,
    allowedBlockTypes: null,
    reservedCommitmentMinutes,
    sickDaySeverity,
    sickDayDescription: sickDayEffect?.description ?? null,
  };

  const baseProfile =
    (isWeekend && preferences.holidaySchedule.enabled) ||
    (!inSchoolTerm && preferences.holidaySchedule.enabled)
      ? holidayLikeProfile
      : {
          regime: defaultRegime,
          dailyStudyWindow: preferences.dailyStudyWindow,
          preferredDeepWorkWindows: preferences.preferredDeepWorkWindows,
          maxStudyHoursPerDay: preferences.maxStudyHoursPerDay,
          maxHeavySessionsPerDay: preferences.maxHeavySessionsPerDay,
          allowedBlockTypes: null,
          reservedCommitmentMinutes,
          sickDaySeverity,
          sickDayDescription: sickDayEffect?.description ?? null,
        };

  const sickAdjustedProfile = sickDayEffect
    ? {
        ...baseProfile,
        maxStudyHoursPerDay: Math.round(
          baseProfile.maxStudyHoursPerDay * sickDayEffect.studyCapacityMultiplier * 10,
        ) / 10,
        maxHeavySessionsPerDay: Math.min(
          baseProfile.maxHeavySessionsPerDay,
          sickDayEffect.maxHeavySessionsPerDay,
        ),
        allowedBlockTypes: sickDayEffect.allowedBlockTypes ?? null,
      }
    : baseProfile;

  if (isSunday && !preferences.sundayStudy.enabled) {
    return {
      ...sickAdjustedProfile,
      isStudyEnabled: false,
      maxStudyHoursPerDay: 0,
    };
  }

  if (isSunday) {
    return {
      ...sickAdjustedProfile,
      isStudyEnabled: true,
      maxStudyHoursPerDay: Math.max(
        0,
        Math.round(sickAdjustedProfile.maxStudyHoursPerDay * preferences.sundayStudy.workloadIntensity * 10) /
          10,
      ),
    };
  }

  return {
    ...sickAdjustedProfile,
    isStudyEnabled: true,
  };
}
