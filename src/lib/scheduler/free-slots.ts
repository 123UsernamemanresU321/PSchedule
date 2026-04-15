import { addDays, addMinutes, differenceInCalendarDays, startOfDay } from "date-fns";

import { classifySlotEnergy } from "@/lib/scheduler/slot-classifier";
import {
  getActiveSickDaySeverity,
  getReservedCommitmentDurationForDate,
  getSickDayEffectProfile,
  isDateInActiveSchoolTerm,
  isReservedCommitmentRuleActiveOnDate,
  resolveDailyScheduleProfile,
} from "@/lib/scheduler/schedule-regime";
import {
  createDateAtTime,
  fromDateKey,
  minutesBetween,
  startOfPlannerWeek,
  toDateKey,
} from "@/lib/dates/helpers";
import type {
  CalendarSlot,
  FixedEvent,
  Preferences,
  SickDay,
  StudyBlock,
  TimeInterval,
} from "@/lib/types/planner";

export interface RecoveryWindowOccurrence {
  id: string;
  dateKey: string;
  title: string;
  start: string;
  end: string;
  label: string;
  movable: boolean;
}

export interface ReservedCommitmentOccurrence {
  id: string;
  ruleId: string;
  dateKey: string;
  title: string;
  start: string;
  end: string;
  label: string;
}

const MIN_ALLOCATABLE_MINUTES = 30;

function mergeIntervals(intervals: TimeInterval[]) {
  if (!intervals.length) {
    return [];
  }

  const sorted = [...intervals].sort((left, right) => left.start.getTime() - right.start.getTime());
  const merged: TimeInterval[] = [sorted[0]];

  sorted.slice(1).forEach((interval) => {
    const current = merged[merged.length - 1];

    if (interval.start <= current.end) {
      current.end = new Date(Math.max(current.end.getTime(), interval.end.getTime()));
      return;
    }

    merged.push({ ...interval });
  });

  return merged;
}

function subtractIntervals(base: TimeInterval, busyIntervals: TimeInterval[]) {
  return busyIntervals.reduce<TimeInterval[]>((segments, busy) => {
    return segments.flatMap((segment) => {
      if (busy.end <= segment.start || busy.start >= segment.end) {
        return [segment];
      }

      const results: TimeInterval[] = [];

      if (busy.start > segment.start) {
        results.push({ start: segment.start, end: busy.start });
      }

      if (busy.end < segment.end) {
        results.push({ start: busy.end, end: segment.end });
      }

      return results;
    });
  }, [base]);
}

function createInterval(start: Date, end: Date): TimeInterval {
  return { start, end };
}

function toLocalTimeString(date: Date) {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function getRecoveryWindowTimingForDate(
  window: Preferences["lockedRecoveryWindows"][number],
  dateKey: string,
) {
  const override = window.timeOverrides?.[dateKey];
  return {
    start: override?.start ?? window.start,
    end: override?.end ?? window.end,
  };
}

function getRecurringDurationMinutes(start: Date, end: Date) {
  // Use the actual full duration between start and end to correctly handle
  // multi-day recurring events (e.g. a weekend trip from Fri 08:00 to Sun 12:00).
  const directMinutes = minutesBetween(start, end);
  if (directMinutes > 0) {
    return directMinutes;
  }

  // Fallback for edge cases where end time-of-day wraps past midnight.
  const normalizedEnd = new Date(start);
  normalizedEnd.setHours(end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds());

  if (normalizedEnd <= start) {
    normalizedEnd.setDate(normalizedEnd.getDate() + 1);
  }

  return minutesBetween(start, normalizedEnd);
}

function getRecurringDurationDays(start: Date, end: Date) {
  return Math.max(differenceInCalendarDays(end, start), 1);
}

function expandSchoolScheduleForWeek(weekStart: Date, preferences: Preferences) {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).flatMap((day) => {
    if (
      !preferences.schoolSchedule.weekdays.includes(day.getDay()) ||
      !isDateInActiveSchoolTerm(day, preferences)
    ) {
      return [];
    }

    const start = createDateAtTime(day, preferences.schoolSchedule.start);
    const end = createDateAtTime(day, preferences.schoolSchedule.end);

    if (end <= start) {
      return [];
    }

    return [
      {
        id: `school-schedule:${toDateKey(day)}`,
        title: "School",
        start: start.toISOString(),
        end: end.toISOString(),
        isAllDay: false,
        recurrence: "none" as const,
        flexibility: "fixed" as const,
        category: "school" as const,
        notes: "Generated from School settings",
      },
    ];
  });
}

export function expandFixedEventsForWeek(weekStart: Date, fixedEvents: FixedEvent[]) {
  return fixedEvents
    .flatMap((event) => {
      const originalStart = new Date(event.start);
      const originalEnd = new Date(event.end);
      const excludedDates = new Set(event.excludedDates ?? []);

      if (event.recurrence === "none") {
        return [event];
      }

      const durationMinutes = getRecurringDurationMinutes(originalStart, originalEnd);
      const durationDays = getRecurringDurationDays(originalStart, originalEnd);
      const recurrenceDays = event.daysOfWeek?.length
        ? event.daysOfWeek
        : [originalStart.getDay()];
      const repeatUntil =
        event.repeatUntil ??
        (!event.isAllDay && toDateKey(originalEnd) !== toDateKey(originalStart)
          ? toDateKey(originalEnd)
          : undefined);
      const firstOccurrenceDate = fromDateKey(toDateKey(originalStart));
      const lastOccurrenceDate = repeatUntil ? fromDateKey(repeatUntil) : null;

      return recurrenceDays.map((dayOfWeek) => {
        const targetDay = addDays(weekStart, (dayOfWeek + 6) % 7);
        const occurrenceStart = event.isAllDay
          ? startOfDay(targetDay)
          : createDateAtTime(
              targetDay,
              toLocalTimeString(originalStart),
            );
        const occurrenceEnd = event.isAllDay
          ? addDays(occurrenceStart, durationDays)
          : addMinutes(occurrenceStart, durationMinutes);

        return {
          ...event,
          start: occurrenceStart.toISOString(),
          end: occurrenceEnd.toISOString(),
          repeatUntil,
        };
      }).filter((occurrence) => {
        const occurrenceDate = fromDateKey(toDateKey(new Date(occurrence.start)));
        const occurrenceDateKey = toDateKey(new Date(occurrence.start));

        if (occurrenceDate < firstOccurrenceDate) {
          return false;
        }

        if (lastOccurrenceDate && occurrenceDate > lastOccurrenceDate) {
          return false;
        }

        if (excludedDates.has(occurrenceDateKey)) {
          return false;
        }

        return true;
      });
    })
    .filter((event) => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      return (
        eventEnd >= weekStart &&
        eventStart < addDays(startOfPlannerWeek(weekStart), 7)
      );
    });
}

export function expandPlannerFixedEventsForWeek(
  weekStart: Date,
  fixedEvents: FixedEvent[],
  preferences: Preferences,
) {
  return [
    ...expandSchoolScheduleForWeek(weekStart, preferences),
    ...expandFixedEventsForWeek(weekStart, fixedEvents),
  ];
}

function buildStudyBlockIntervals(day: Date, studyBlocks: StudyBlock[]) {
  return studyBlocks
    .filter((block) => toDateKey(new Date(block.start)) === toDateKey(day))
    .map((block) => createInterval(new Date(block.start), new Date(block.end)));
}

function shiftRecoveryInterval(options: {
  day: Date;
  interval: TimeInterval;
  movable: boolean;
  busyIntervals: TimeInterval[];
  preferences: Preferences;
  sickDays?: SickDay[];
}) {
  if (!options.movable) {
    return options.interval;
  }

  const durationMinutes = minutesBetween(options.interval.start, options.interval.end);
  const mergedBusyIntervals = mergeIntervals(options.busyIntervals);
  const scheduleProfile = resolveDailyScheduleProfile(
    options.day,
    options.preferences,
    options.sickDays,
  );
  const preferredWindowEnd = createDateAtTime(options.day, scheduleProfile.dailyStudyWindow.end);
  const absoluteLatestEnd = createDateAtTime(options.day, "23:00");
  let candidateStart = options.interval.start;
  let candidateEnd = options.interval.end;

  mergedBusyIntervals.forEach((busyInterval) => {
    if (candidateEnd <= busyInterval.start || candidateStart >= busyInterval.end) {
      return;
    }

    candidateStart = new Date(Math.max(candidateStart.getTime(), busyInterval.end.getTime()));
    candidateEnd = addMinutes(candidateStart, durationMinutes);
  });

  if (candidateEnd <= preferredWindowEnd || candidateEnd <= absoluteLatestEnd) {
    return createInterval(candidateStart, candidateEnd);
  }

  return options.interval;
}

function resolveRecoveryWindowAgainstDinner(options: {
  day: Date;
  interval: TimeInterval;
  dinnerIntervals: Array<TimeInterval & { label: string; movable: boolean }>;
  preferences: Preferences;
  sickDays?: SickDay[];
}) {
  const overlappingDinner = options.dinnerIntervals.find(
    (dinnerInterval) =>
      options.interval.start < dinnerInterval.end && options.interval.end > dinnerInterval.start,
  );

  if (!overlappingDinner) {
    return options.interval;
  }

  const durationMinutes = minutesBetween(options.interval.start, options.interval.end);
  const scheduleProfile = resolveDailyScheduleProfile(
    options.day,
    options.preferences,
    options.sickDays,
  );
  const dayWindowStart = createDateAtTime(options.day, scheduleProfile.dailyStudyWindow.start);
  const dayWindowEnd = createDateAtTime(options.day, scheduleProfile.dailyStudyWindow.end);

  const shiftedAfterDinnerStart = new Date(overlappingDinner.end);
  const shiftedAfterDinnerEnd = addMinutes(shiftedAfterDinnerStart, durationMinutes);

  if (shiftedAfterDinnerEnd <= dayWindowEnd) {
    return createInterval(shiftedAfterDinnerStart, shiftedAfterDinnerEnd);
  }

  const shiftedBeforeDinnerEnd = new Date(overlappingDinner.start);
  const shiftedBeforeDinnerStart = addMinutes(shiftedBeforeDinnerEnd, -durationMinutes);

  if (shiftedBeforeDinnerStart >= dayWindowStart) {
    return createInterval(shiftedBeforeDinnerStart, shiftedBeforeDinnerEnd);
  }

  const trimmedAfterDinnerStart = new Date(
    Math.max(options.interval.start.getTime(), overlappingDinner.end.getTime()),
  );
  if (trimmedAfterDinnerStart < options.interval.end) {
    return createInterval(trimmedAfterDinnerStart, options.interval.end);
  }

  const trimmedBeforeDinnerEnd = new Date(
    Math.min(options.interval.end.getTime(), overlappingDinner.start.getTime()),
  );
  if (options.interval.start < trimmedBeforeDinnerEnd) {
    return createInterval(options.interval.start, trimmedBeforeDinnerEnd);
  }

  return null;
}

function resolveRecoveryWindowsForDay(options: {
  day: Date;
  fixedEvents: FixedEvent[];
  preferences: Preferences;
  sickDays?: SickDay[];
  blockedStudyBlocks?: StudyBlock[];
  skipMovableRecovery?: boolean;
}) {
  const resolvedIntervals: Array<TimeInterval & { label: string; movable: boolean }> = [];
  const eventIntervals = buildEventIntervals(options.day, options.fixedEvents, options.preferences);
  const studyBlockIntervals = buildStudyBlockIntervals(options.day, options.blockedStudyBlocks ?? []);

  options.preferences.lockedRecoveryWindows
    .filter((window) => window.days.includes(options.day.getDay()))
    .filter(
      (window) =>
        !(options.skipMovableRecovery && window.movable && window.label !== "Dinner reset"),
    )
    .filter(
      (window) =>
        !(window.label === "Sunday recovery" && options.day.getDay() === 0 && !options.preferences.reserveSundayEvening),
    )
    .forEach((window) => {
      const dateKey = toDateKey(options.day);
      const timing = getRecoveryWindowTimingForDate(window, dateKey);
      const baseInterval = createInterval(
        createDateAtTime(options.day, timing.start),
        createDateAtTime(options.day, timing.end),
      );
      const shiftedInterval = shiftRecoveryInterval({
        day: options.day,
        interval: baseInterval,
        movable: window.movable ?? false,
        busyIntervals: [
          ...eventIntervals,
          ...studyBlockIntervals,
          ...resolvedIntervals,
        ],
        preferences: options.preferences,
        sickDays: options.sickDays,
      });
      const dinnerSafeInterval =
        window.label === "Dinner reset"
          ? shiftedInterval
          : resolveRecoveryWindowAgainstDinner({
              day: options.day,
              interval: shiftedInterval,
              dinnerIntervals: resolvedIntervals.filter(
                (resolvedInterval) => resolvedInterval.label === "Dinner reset",
              ),
              preferences: options.preferences,
              sickDays: options.sickDays,
            });

      if (!dinnerSafeInterval) {
        return;
      }

      resolvedIntervals.push({
        ...dinnerSafeInterval,
        label: window.label,
        movable: window.movable ?? false,
      });
    });

  return resolvedIntervals;
}

function resolveReservedCommitmentStart(options: {
  day: Date;
  preferences: Preferences;
  rule: Preferences["reservedCommitmentRules"][number];
  inSchoolTerm: boolean;
}) {
  const dateKey = toDateKey(options.day);
  const overriddenStart = options.rule.timeOverrides?.[dateKey]?.start;

  if (overriddenStart) {
    return createDateAtTime(options.day, overriddenStart);
  }

  if (
    options.rule.id === "term-homework" &&
    options.inSchoolTerm &&
    options.preferences.schoolSchedule.weekdays.includes(options.day.getDay())
  ) {
    return addMinutes(createDateAtTime(options.day, options.preferences.schoolSchedule.end), 30);
  }

  return createDateAtTime(options.day, options.rule.preferredStart);
}

function placeReservedCommitmentIntervals(options: {
  day: Date;
  start: Date;
  durationMinutes: number;
  busyIntervals: TimeInterval[];
}) {
  const mergedBusyIntervals = mergeIntervals(
    options.busyIntervals.filter((interval) => interval.end > options.start),
  );
  const absoluteLatestEnd = createDateAtTime(options.day, "23:00");
  const segments: TimeInterval[] = [];
  let cursor = options.start;
  let remainingMinutes = options.durationMinutes;

  for (const busyInterval of mergedBusyIntervals) {
    if (remainingMinutes <= 0 || cursor >= absoluteLatestEnd) {
      break;
    }

    if (busyInterval.end <= cursor) {
      continue;
    }

    if (busyInterval.start > cursor) {
      const freeEnd = busyInterval.start < absoluteLatestEnd ? busyInterval.start : absoluteLatestEnd;
      const freeMinutes = minutesBetween(cursor, freeEnd);

      if (freeMinutes > 0) {
        const minutesToUse = Math.min(freeMinutes, remainingMinutes);
        const segmentEnd = addMinutes(cursor, minutesToUse);
        segments.push(createInterval(cursor, segmentEnd));
        remainingMinutes -= minutesToUse;
        cursor = segmentEnd;

        if (remainingMinutes <= 0) {
          break;
        }
      }
    }

    if (busyInterval.end > cursor) {
      cursor = busyInterval.end;
    }
  }

  if (remainingMinutes > 0 && cursor < absoluteLatestEnd) {
    const freeMinutes = minutesBetween(cursor, absoluteLatestEnd);
    const minutesToUse = Math.min(freeMinutes, remainingMinutes);

    if (minutesToUse > 0) {
      segments.push(createInterval(cursor, addMinutes(cursor, minutesToUse)));
      remainingMinutes -= minutesToUse;
    }
  }

  return remainingMinutes <= 0 ? segments : [];
}

export function expandReservedCommitmentWindowsForWeek(
  weekStart: Date,
  preferences: Preferences,
  fixedEvents: FixedEvent[] = [],
  sickDays: SickDay[] = [],
  excludedRuleIds: string[] = [],
): ReservedCommitmentOccurrence[] {
  const expandedFixedEvents = expandPlannerFixedEventsForWeek(weekStart, fixedEvents, preferences);
  const excludedRuleIdSet = new Set(excludedRuleIds);

  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).flatMap((day) => {
    const inSchoolTerm = isDateInActiveSchoolTerm(day, preferences);
    const dayFixedEventIntervals = buildEventIntervals(day, expandedFixedEvents, preferences);
    const dayRecoveryIntervals = resolveRecoveryWindowsForDay({
      day,
      fixedEvents: expandedFixedEvents,
      preferences,
      sickDays,
      blockedStudyBlocks: [],
      skipMovableRecovery: false,
    }).map((window) => createInterval(window.start, window.end));
    const resolvedIntervals: TimeInterval[] = [];
    const prioritizedRules = preferences.reservedCommitmentRules
      .map((rule, index) => ({
        rule,
        index,
        priority:
          rule.id === "term-homework" &&
          inSchoolTerm &&
          preferences.schoolSchedule.weekdays.includes(day.getDay())
            ? 0
            : rule.id === "piano-practice"
              ? 1
              : 2,
      }))
      .sort((left, right) => left.priority - right.priority || left.index - right.index)
      .map((entry) => entry.rule);

    return prioritizedRules.flatMap((rule) => {
      if (excludedRuleIdSet.has(rule.id)) {
        return [];
      }

      if (!isReservedCommitmentRuleActiveOnDate(rule, day, inSchoolTerm, preferences)) {
        return [];
      }

      const activeSickDaySeverity = getActiveSickDaySeverity(day, sickDays);
      const durationMinutes = getReservedCommitmentDurationForDate(
        rule,
        toDateKey(day),
        activeSickDaySeverity ? getSickDayEffectProfile(activeSickDaySeverity) : null,
      );

      if (durationMinutes <= 0) {
        return [];
      }

      const start = resolveReservedCommitmentStart({
        day,
        preferences,
        rule,
        inSchoolTerm,
      });
      const commitmentSegments = placeReservedCommitmentIntervals({
        day,
        start,
        durationMinutes,
        busyIntervals: [...dayFixedEventIntervals, ...dayRecoveryIntervals, ...resolvedIntervals],
      });

      if (!commitmentSegments.length) {
        return [];
      }

      resolvedIntervals.push(...commitmentSegments);

      return commitmentSegments.map((segment, segmentIndex) => ({
        id: `${rule.id}:${toDateKey(day)}:${segmentIndex + 1}`,
        ruleId: rule.id,
        dateKey: toDateKey(day),
        title: rule.label,
        start: segment.start.toISOString(),
        end: segment.end.toISOString(),
        label: rule.label,
      }));
    });
  });
}

export function expandLockedRecoveryWindowsForWeek(
  weekStart: Date,
  preferences: Preferences,
  fixedEvents: FixedEvent[] = [],
  sickDays: SickDay[] = [],
  blockedStudyBlocks: StudyBlock[] = [],
  skipMovableRecovery = false,
): RecoveryWindowOccurrence[] {
  const expandedFixedEvents = expandPlannerFixedEventsForWeek(weekStart, fixedEvents, preferences);

  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).flatMap((day) =>
    resolveRecoveryWindowsForDay({
      day,
      fixedEvents: expandedFixedEvents,
      preferences,
      sickDays,
      blockedStudyBlocks,
      skipMovableRecovery,
    }).map((window) => ({
      id: `${window.label}-${toDateKey(day)}`,
      dateKey: toDateKey(day),
      title: window.label,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      label: window.label,
      movable: window.movable,
    })),
  );
}

function buildEventIntervals(day: Date, fixedEvents: FixedEvent[], preferences: Preferences, sickDays: SickDay[] = []) {
  const dayStart = startOfDay(day);
  const nextDay = addDays(dayStart, 1);
  const scheduleProfile = resolveDailyScheduleProfile(day, preferences, sickDays);
  const plannerWindowStart = createDateAtTime(day, scheduleProfile.dailyStudyWindow.start);
  const plannerWindowEnd = createDateAtTime(day, scheduleProfile.dailyStudyWindow.end);

  return fixedEvents
    .filter((event) => {
      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      return eventEnd > dayStart && eventStart < nextDay;
    })
    .map((event) => {
      const start = new Date(event.start);
      const end = new Date(event.end);

      if (event.isAllDay) {
        return createInterval(plannerWindowStart, plannerWindowEnd);
      }

      const clippedStart = start < dayStart ? dayStart : start;
      const clippedEnd = end > nextDay ? nextDay : end;
      // User-entered fixed-event times already include any preparation or travel padding.
      // Keep study slots flush against the fixed boundary instead of carving out extra buffer.
      return createInterval(clippedStart, clippedEnd);
    });
}

export function calculateFreeSlots(options: {
  weekStart: Date;
  fixedEvents: FixedEvent[];
  sickDays?: SickDay[];
  preferences: Preferences;
  blockedStudyBlocks?: StudyBlock[];
  planningStart?: Date;
  skipMovableRecovery?: boolean;
  excludedReservedCommitmentRuleIds?: string[];
}) {
  const { weekStart, preferences, planningStart } = options;
  const sickDays = options.sickDays ?? [];
  const fixedEvents = expandPlannerFixedEventsForWeek(weekStart, options.fixedEvents, preferences);
  const reservedCommitments = expandReservedCommitmentWindowsForWeek(
    weekStart,
    preferences,
    options.fixedEvents,
    sickDays,
    options.excludedReservedCommitmentRuleIds ?? [],
  );
  const blockedStudyBlocks = options.blockedStudyBlocks ?? [];
  const recoveryWindows = expandLockedRecoveryWindowsForWeek(
    weekStart,
    preferences,
    options.fixedEvents,
    sickDays,
    blockedStudyBlocks,
    options.skipMovableRecovery ?? false,
  );

  const slots: CalendarSlot[] = [];

  Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).forEach((day) => {
    const scheduleProfile = resolveDailyScheduleProfile(day, preferences, sickDays);
    if (!scheduleProfile.isStudyEnabled) {
      return;
    }
    const plannerWindow = createInterval(
      createDateAtTime(day, scheduleProfile.dailyStudyWindow.start),
      createDateAtTime(day, scheduleProfile.dailyStudyWindow.end),
    );

    if (planningStart && plannerWindow.end <= planningStart) {
      return;
    }

    if (planningStart && plannerWindow.start < planningStart && plannerWindow.end > planningStart) {
      plannerWindow.start = planningStart;
    }

    const busyIntervals = mergeIntervals([
      ...recoveryWindows
        .filter((window) => toDateKey(new Date(window.start)) === toDateKey(day))
        .map((window) => createInterval(new Date(window.start), new Date(window.end))),
      ...reservedCommitments
        .filter((window) => toDateKey(new Date(window.start)) === toDateKey(day))
        .map((window) => createInterval(new Date(window.start), new Date(window.end))),
      ...buildEventIntervals(day, fixedEvents, preferences, sickDays),
      ...buildStudyBlockIntervals(day, blockedStudyBlocks),
    ]);

    subtractIntervals(plannerWindow, busyIntervals)
      .filter((interval) => minutesBetween(interval.start, interval.end) >= MIN_ALLOCATABLE_MINUTES)
      .forEach((interval, slotIndex) => {
        const slot: CalendarSlot = {
          id: `${toDateKey(day)}-slot-${slotIndex + 1}`,
          start: interval.start,
          end: interval.end,
          dateKey: toDateKey(day),
          durationMinutes: minutesBetween(interval.start, interval.end),
          energy: "steady",
          dayIndex: day.getDay(),
          scheduleRegime: scheduleProfile.regime,
          dayStudyCapMinutes: scheduleProfile.maxStudyHoursPerDay * 60,
          maxHeavySessionsPerDay: scheduleProfile.maxHeavySessionsPerDay,
          sickDaySeverity: scheduleProfile.sickDaySeverity,
          sickDayDescription: scheduleProfile.sickDayDescription,
        };

        slot.energy = classifySlotEnergy(slot, preferences);
        slots.push(slot);
      });
  });

  return slots;
}

export function studyBlockOverlapsFixedEvent(
  block: StudyBlock,
  fixedEvents: FixedEvent[],
  weekStart: Date,
  preferences: Preferences,
) {
  const blockStart = new Date(block.start);
  const blockEnd = new Date(block.end);

  return expandPlannerFixedEventsForWeek(weekStart, fixedEvents, preferences).some((event) => {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);
    return blockStart < eventEnd && blockEnd > eventStart;
  });
}
