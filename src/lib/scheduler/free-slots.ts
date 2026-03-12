import { addDays, addMinutes, differenceInCalendarDays, startOfDay } from "date-fns";

import { classifySlotEnergy } from "@/lib/scheduler/slot-classifier";
import {
  isDateInActiveSchoolTerm,
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
  StudyBlock,
  TimeInterval,
} from "@/lib/types/planner";

export interface RecoveryWindowOccurrence {
  id: string;
  title: string;
  start: string;
  end: string;
  label: string;
  movable: boolean;
}

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

function getRecurringDurationMinutes(start: Date, end: Date) {
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

        if (occurrenceDate < firstOccurrenceDate) {
          return false;
        }

        if (lastOccurrenceDate && occurrenceDate > lastOccurrenceDate) {
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
}) {
  if (!options.movable) {
    return options.interval;
  }

  const durationMinutes = minutesBetween(options.interval.start, options.interval.end);
  const mergedBusyIntervals = mergeIntervals(options.busyIntervals);
  const scheduleProfile = resolveDailyScheduleProfile(options.day, options.preferences);
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

function resolveRecoveryWindowsForDay(options: {
  day: Date;
  fixedEvents: FixedEvent[];
  preferences: Preferences;
  blockedStudyBlocks?: StudyBlock[];
  skipMovableRecovery?: boolean;
}) {
  const resolvedIntervals: Array<TimeInterval & { label: string; movable: boolean }> = [];
  const eventIntervals = buildEventIntervals(options.day, options.fixedEvents, options.preferences);
  const studyBlockIntervals = buildStudyBlockIntervals(options.day, options.blockedStudyBlocks ?? []);

  options.preferences.lockedRecoveryWindows
    .filter((window) => window.days.includes(options.day.getDay()))
    .filter((window) => !(options.skipMovableRecovery && window.movable))
    .filter(
      (window) =>
        !(window.label === "Sunday recovery" && options.day.getDay() === 0 && !options.preferences.reserveSundayEvening),
    )
    .forEach((window) => {
      const baseInterval = createInterval(
        createDateAtTime(options.day, window.start),
        createDateAtTime(options.day, window.end),
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
      });

      resolvedIntervals.push({
        ...shiftedInterval,
        label: window.label,
        movable: window.movable ?? false,
      });
    });

  return resolvedIntervals;
}

export function expandLockedRecoveryWindowsForWeek(
  weekStart: Date,
  preferences: Preferences,
  fixedEvents: FixedEvent[] = [],
  blockedStudyBlocks: StudyBlock[] = [],
  skipMovableRecovery = false,
): RecoveryWindowOccurrence[] {
  const expandedFixedEvents = expandPlannerFixedEventsForWeek(weekStart, fixedEvents, preferences);

  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).flatMap((day) =>
    resolveRecoveryWindowsForDay({
      day,
      fixedEvents: expandedFixedEvents,
      preferences,
      blockedStudyBlocks,
      skipMovableRecovery,
    }).map((window) => ({
      id: `${window.label}-${toDateKey(day)}`,
      title: window.label,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      label: window.label,
      movable: window.movable,
    })),
  );
}

function buildEventIntervals(day: Date, fixedEvents: FixedEvent[], preferences: Preferences) {
  const dayStart = startOfDay(day);
  const nextDay = addDays(dayStart, 1);
  const scheduleProfile = resolveDailyScheduleProfile(day, preferences);
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
      const bufferedStart =
        event.category === "recovery"
          ? clippedStart
          : addMinutes(clippedStart, -preferences.bufferMinutesBeforeFixedEvent);

      return createInterval(bufferedStart, clippedEnd);
    });
}

export function calculateFreeSlots(options: {
  weekStart: Date;
  fixedEvents: FixedEvent[];
  preferences: Preferences;
  blockedStudyBlocks?: StudyBlock[];
  planningStart?: Date;
  skipMovableRecovery?: boolean;
}) {
  const { weekStart, preferences, planningStart } = options;
  const fixedEvents = expandPlannerFixedEventsForWeek(weekStart, options.fixedEvents, preferences);
  const blockedStudyBlocks = options.blockedStudyBlocks ?? [];
  const recoveryWindows = expandLockedRecoveryWindowsForWeek(
    weekStart,
    preferences,
    options.fixedEvents,
    blockedStudyBlocks,
    options.skipMovableRecovery ?? false,
  );

  const slots: CalendarSlot[] = [];

  Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).forEach((day) => {
    const scheduleProfile = resolveDailyScheduleProfile(day, preferences);
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
      ...buildEventIntervals(day, fixedEvents, preferences),
      ...buildStudyBlockIntervals(day, blockedStudyBlocks),
    ]);

    subtractIntervals(plannerWindow, busyIntervals)
      .filter((interval) => minutesBetween(interval.start, interval.end) >= 20)
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
