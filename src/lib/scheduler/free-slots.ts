import { addDays, addMinutes, differenceInCalendarDays, startOfDay } from "date-fns";

import { classifySlotEnergy } from "@/lib/scheduler/slot-classifier";
import {
  FRENCH_TUNE_UP_RULE_ID,
  FRENCH_TUNE_UP_WEEKLY_SESSION_COUNT,
} from "@/lib/constants/planner";
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
  EffectiveReservedCommitmentDuration,
  FixedEvent,
  Preferences,
  SchoolTerm,
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

export interface SchedulingRunContext {
  expandedPlannerFixedEventsByWeek: Map<string, FixedEvent[]>;
  fixedEventIntervalsByWeek: Map<string, Map<string, TimeInterval[]>>;
  reservedCommitmentWindowsByKey: Map<string, ReservedCommitmentOccurrence[]>;
}

export function createSchedulingRunContext(): SchedulingRunContext {
  return {
    expandedPlannerFixedEventsByWeek: new Map(),
    fixedEventIntervalsByWeek: new Map(),
    reservedCommitmentWindowsByKey: new Map(),
  };
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
      !isDateInActiveSchoolTerm(day, preferences) ||
      getExamDayEarliestStudyStart(day, preferences)
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

function dateRangesOverlap(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string) {
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

export function getSchoolClubActiveWindowForTerm(
  term: SchoolTerm,
  examPeriods: Preferences["schoolSchedule"]["examPeriods"],
) {
  const termStartWeek = startOfPlannerWeek(fromDateKey(term.startDate));
  const termEndWeek = startOfPlannerWeek(fromDateKey(term.endDate));
  const firstClubWeek = addDays(termStartWeek, 7);
  const firstExamWeek = examPeriods
    .filter((period) =>
      (period.termId && period.termId === term.id) ||
      dateRangesOverlap(period.startDate, period.endDate, term.startDate, term.endDate),
    )
    .map((period) => startOfPlannerWeek(fromDateKey(period.startDate)))
    .sort((left, right) => left.getTime() - right.getTime())[0];
  const exclusiveEndWeek =
    firstExamWeek && firstExamWeek < termEndWeek ? firstExamWeek : termEndWeek;

  return {
    firstClubWeek,
    exclusiveEndWeek,
  };
}

function getActiveTermForClubDate(
  day: Date,
  club: Preferences["schoolSchedule"]["schoolClubs"][number],
  preferences: Preferences,
) {
  const dayKey = toDateKey(day);

  return preferences.schoolSchedule.terms.find((term) => {
    if (!term.startDate || !term.endDate || dayKey < term.startDate || dayKey > term.endDate) {
      return false;
    }

    if (club.activeTermIds?.length && !club.activeTermIds.includes(term.id)) {
      return false;
    }

    const weekStart = startOfPlannerWeek(day);
    const activeWindow = getSchoolClubActiveWindowForTerm(
      term,
      preferences.schoolSchedule.examPeriods,
    );

    return (
      weekStart.getTime() >= activeWindow.firstClubWeek.getTime() &&
      weekStart.getTime() < activeWindow.exclusiveEndWeek.getTime()
    );
  });
}

export function expandSchoolClubsForWeek(weekStart: Date, preferences: Preferences) {
  if (!preferences.schoolSchedule.enabled) {
    return [];
  }

  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).flatMap((day) => {
    if (!isDateInActiveSchoolTerm(day, preferences)) {
      return [];
    }

    return preferences.schoolSchedule.schoolClubs.flatMap((club) => {
      if (!club.days.includes(day.getDay())) {
        return [];
      }

      if (!getActiveTermForClubDate(day, club, preferences)) {
        return [];
      }

      const start = createDateAtTime(day, club.start);
      const end = createDateAtTime(day, club.end);

      if (end <= start) {
        return [];
      }

      const dateKey = toDateKey(day);

      return [
        {
          id: `school-club:${club.id}:${dateKey}`,
          title: club.label,
          start: start.toISOString(),
          end: end.toISOString(),
          isAllDay: false,
          recurrence: "none" as const,
          flexibility: "fixed" as const,
          category: "activity" as const,
          notes: club.notes
            ? `Generated from School club settings. ${club.notes}`
            : "Generated from School club settings",
        },
      ];
    });
  });
}

export function expandSchoolExamsForWeek(weekStart: Date, preferences: Preferences) {
  return preferences.schoolSchedule.examPeriods.flatMap((period) =>
    period.exams.flatMap((exam) => {
      const examDay = fromDateKey(exam.date);
      const weekEnd = addDays(startOfPlannerWeek(weekStart), 7);

      if (examDay < weekStart || examDay >= weekEnd) {
        return [];
      }

      if (exam.date < period.startDate || exam.date > period.endDate) {
        return [];
      }

      const start = createDateAtTime(examDay, exam.start);
      const end = createDateAtTime(examDay, exam.end);

      if (end <= start) {
        return [];
      }

      return [
        {
          id: `school-exam:${period.id}:${exam.id}`,
          title: exam.title,
          start: start.toISOString(),
          end: end.toISOString(),
          isAllDay: false,
          recurrence: "none" as const,
          flexibility: "fixed" as const,
          category: "assessment" as const,
          notes: exam.notes
            ? `Generated from ${period.label}. ${exam.notes}`
            : `Generated from ${period.label}`,
        },
      ];
    }),
  );
}

export function getExamDayEarliestStudyStart(day: Date, preferences: Preferences) {
  const dateKey = toDateKey(day);
  const examEndTimes = preferences.schoolSchedule.examPeriods
    .filter((period) => dateKey >= period.startDate && dateKey <= period.endDate)
    .flatMap((period) => period.exams)
    .filter((exam) => exam.date === dateKey)
    .map((exam) => createDateAtTime(day, exam.end))
    .filter((end) => !Number.isNaN(end.getTime()))
    .sort((left, right) => right.getTime() - left.getTime());

  return examEndTimes[0] ? addMinutes(examEndTimes[0], 30) : null;
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
  schedulingContext?: SchedulingRunContext,
) {
  const weekStartKey = toDateKey(startOfPlannerWeek(weekStart));
  const cached = schedulingContext?.expandedPlannerFixedEventsByWeek.get(weekStartKey);
  if (cached) {
    return cached;
  }

  const expanded = [
    ...expandSchoolScheduleForWeek(weekStart, preferences),
    ...expandSchoolClubsForWeek(weekStart, preferences),
    ...expandSchoolExamsForWeek(weekStart, preferences),
    ...expandFixedEventsForWeek(weekStart, fixedEvents),
  ];
  schedulingContext?.expandedPlannerFixedEventsByWeek.set(weekStartKey, expanded);
  return expanded;
}

function buildSickDayCacheKey(sickDays: SickDay[] = []) {
  if (!sickDays.length) {
    return "none";
  }

  return sickDays
    .map((sickDay) => `${sickDay.id}:${sickDay.startDate}:${sickDay.endDate}:${sickDay.severity}`)
    .sort()
    .join("|");
}

function normalizeRuleDays(days: number[], fallbackDays: number[]) {
  const normalizedDays = Array.from(
    new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)),
  ).sort((left, right) => left - right);

  return normalizedDays.length ? normalizedDays : fallbackDays;
}

function getFixedEventIntervalsByDateForWeek(options: {
  weekStart: Date;
  fixedEvents: FixedEvent[];
  preferences: Preferences;
  sickDays?: SickDay[];
  schedulingContext?: SchedulingRunContext;
}) {
  const weekStartKey = toDateKey(startOfPlannerWeek(options.weekStart));
  const cacheKey = `${weekStartKey}:${buildSickDayCacheKey(options.sickDays ?? [])}`;
  const cached = options.schedulingContext?.fixedEventIntervalsByWeek.get(cacheKey);
  if (cached) {
    return cached;
  }

  const intervalsByDate = new Map<string, TimeInterval[]>();
  Array.from({ length: 7 }, (_, index) => addDays(options.weekStart, index)).forEach((day) => {
    intervalsByDate.set(
      toDateKey(day),
      buildEventIntervals(day, options.fixedEvents, options.preferences, options.sickDays ?? []),
    );
  });

  options.schedulingContext?.fixedEventIntervalsByWeek.set(cacheKey, intervalsByDate);
  return intervalsByDate;
}

function buildStudyBlockIntervals(day: Date, studyBlocks: StudyBlock[]) {
  return studyBlocks
    .filter((block) => toDateKey(new Date(block.start)) === toDateKey(day))
    .map((block) => createInterval(new Date(block.start), new Date(block.end)));
}

function buildReservedCommitmentIntervals(day: Date, commitments: ReservedCommitmentOccurrence[]) {
  return commitments
    .filter((commitment) => commitment.dateKey === toDateKey(day))
    .map((commitment) => createInterval(new Date(commitment.start), new Date(commitment.end)));
}

function compactMovableRecoveryGapBeforeInterval(options: {
  day: Date;
  interval: TimeInterval;
  durationMinutes: number;
  busyIntervals: TimeInterval[];
  preferences: Preferences;
  sickDays?: SickDay[];
}) {
  const mergedBusyIntervals = mergeIntervals(options.busyIntervals);
  const previousBusyInterval = [...mergedBusyIntervals]
    .reverse()
    .find((interval) => interval.end <= options.interval.start);

  if (!previousBusyInterval) {
    return options.interval;
  }

  const gapMinutes = minutesBetween(previousBusyInterval.end, options.interval.start);
  if (gapMinutes <= 0 || gapMinutes >= MIN_ALLOCATABLE_MINUTES) {
    return options.interval;
  }

  const scheduleProfile = resolveDailyScheduleProfile(
    options.day,
    options.preferences,
    options.sickDays,
  );
  const dayWindowStart = createDateAtTime(options.day, scheduleProfile.dailyStudyWindow.start);
  const absoluteLatestEnd = createDateAtTime(options.day, "23:00");
  const candidateStart = new Date(previousBusyInterval.end);
  const candidateEnd = addMinutes(candidateStart, options.durationMinutes);

  if (candidateStart < dayWindowStart || candidateEnd > absoluteLatestEnd) {
    return options.interval;
  }

  const overlapsBusyInterval = mergedBusyIntervals.some(
    (busyInterval) => candidateStart < busyInterval.end && candidateEnd > busyInterval.start,
  );

  if (overlapsBusyInterval) {
    return options.interval;
  }

  return createInterval(candidateStart, candidateEnd);
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
  const compactedBeforePreferredTime = compactMovableRecoveryGapBeforeInterval({
    day: options.day,
    interval: options.interval,
    durationMinutes,
    busyIntervals: mergedBusyIntervals,
    preferences: options.preferences,
    sickDays: options.sickDays,
  });

  if (
    compactedBeforePreferredTime.start.getTime() !== options.interval.start.getTime() ||
    compactedBeforePreferredTime.end.getTime() !== options.interval.end.getTime()
  ) {
    return compactedBeforePreferredTime;
  }

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
    return compactMovableRecoveryGapBeforeInterval({
      day: options.day,
      interval: createInterval(candidateStart, candidateEnd),
      durationMinutes,
      busyIntervals: mergedBusyIntervals,
      preferences: options.preferences,
      sickDays: options.sickDays,
    });
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
  blockedReservedCommitments?: ReservedCommitmentOccurrence[];
  skipMovableRecovery?: boolean;
  eventIntervals?: TimeInterval[];
}) {
  const resolvedIntervals: Array<TimeInterval & { label: string; movable: boolean }> = [];
  const eventIntervals =
    options.eventIntervals ?? buildEventIntervals(options.day, options.fixedEvents, options.preferences);
  const studyBlockIntervals = buildStudyBlockIntervals(options.day, options.blockedStudyBlocks ?? []);
  const reservedCommitmentIntervals = buildReservedCommitmentIntervals(
    options.day,
    options.blockedReservedCommitments ?? [],
  );

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
          ...reservedCommitmentIntervals,
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
  priorCommitmentIntervals: Array<TimeInterval & { ruleId: string }>;
  hardBusyIntervals: TimeInterval[];
}) {
  const dateKey = toDateKey(options.day);
  const overriddenStart = options.rule.timeOverrides?.[dateKey]?.start;
  const preferredStart = createDateAtTime(options.day, options.rule.preferredStart);

  if (overriddenStart) {
    return createDateAtTime(options.day, overriddenStart);
  }

  if (
    options.rule.id === "term-homework" &&
    options.inSchoolTerm &&
    options.preferences.schoolSchedule.weekdays.includes(options.day.getDay())
  ) {
    return createDateAtTime(options.day, options.preferences.schoolSchedule.end);
  }

  if (options.rule.id === "piano-practice") {
    const latestHomeworkEnd = options.priorCommitmentIntervals
      .filter((interval) => interval.ruleId === "term-homework")
      .filter((interval) => interval.end <= preferredStart)
      .sort((left, right) => right.end.getTime() - left.end.getTime())[0]?.end;

    if (latestHomeworkEnd) {
      const hardBoundaryBetweenHomeworkAndPiano = options.hardBusyIntervals.some(
        (interval) => latestHomeworkEnd < interval.end && preferredStart > interval.start,
      );

      if (!hardBoundaryBetweenHomeworkAndPiano) {
        return latestHomeworkEnd;
      }
    }
  }

  return preferredStart;
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

function buildEffectiveReservedCommitmentDurationMap(
  overrides: EffectiveReservedCommitmentDuration[] = [],
) {
  return new Map(
    overrides.map((override) => [
      `${override.dateKey}:${override.ruleId}`,
      Math.max(0, override.durationMinutes),
    ]),
  );
}

function buildReservedCommitmentCacheKey(options: {
  weekStart: Date;
  sickDays: SickDay[];
  excludedRuleIds: string[];
  effectiveReservedCommitmentDurations: EffectiveReservedCommitmentDuration[];
  planningStart?: Date;
}) {
  const excludedKey = [...options.excludedRuleIds].sort().join(",");
  const durationKey = [...options.effectiveReservedCommitmentDurations]
    .sort((left, right) =>
      `${left.dateKey}:${left.ruleId}`.localeCompare(`${right.dateKey}:${right.ruleId}`),
    )
    .map((override) => `${override.dateKey}:${override.ruleId}:${override.durationMinutes}`)
    .join(",");
  return [
    toDateKey(startOfPlannerWeek(options.weekStart)),
    options.planningStart?.toISOString() ?? "none",
    buildSickDayCacheKey(options.sickDays),
    excludedKey,
    durationKey,
  ].join("::");
}

function getWeeklyCommitmentDayOrder(weekStart: Date, preferredDays: number[]) {
  const days = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const preferredDaySet = new Set(preferredDays);
  return [
    ...days.filter((day) => preferredDaySet.has(day.getDay())),
    ...days.filter((day) => !preferredDaySet.has(day.getDay())),
  ];
}

function getUninterruptedPlacementCandidates(options: {
  day: Date;
  durationMinutes: number;
  preferredStart: string;
  busyIntervals: TimeInterval[];
  preferences: Preferences;
  sickDays: SickDay[];
  planningStart?: Date;
}) {
  const scheduleProfile = resolveDailyScheduleProfile(
    options.day,
    options.preferences,
    options.sickDays,
  );

  if (!scheduleProfile.isStudyEnabled) {
    return [];
  }

  const plannerWindow = createInterval(
    createDateAtTime(options.day, scheduleProfile.dailyStudyWindow.start),
    createDateAtTime(options.day, scheduleProfile.dailyStudyWindow.end),
  );

  if (options.planningStart && plannerWindow.end <= options.planningStart) {
    return [];
  }

  if (
    options.planningStart &&
    plannerWindow.start < options.planningStart &&
    plannerWindow.end > options.planningStart
  ) {
    plannerWindow.start = options.planningStart;
  }

  const preferredStart = createDateAtTime(options.day, options.preferredStart);
  return subtractIntervals(plannerWindow, mergeIntervals(options.busyIntervals))
    .filter((segment) => minutesBetween(segment.start, segment.end) >= options.durationMinutes)
    .map((segment) => {
      const latestStart = addMinutes(segment.end, -options.durationMinutes);
      const start =
        preferredStart < segment.start
          ? segment.start
          : preferredStart > latestStart
            ? latestStart
            : preferredStart;
      const end = addMinutes(start, options.durationMinutes);

      return {
        start,
        end,
        distanceFromPreferredMinutes: Math.abs(minutesBetween(preferredStart, start)),
      };
    });
}

function placeFrenchTuneUpCommitmentsForWeek(options: {
  weekStart: Date;
  rule: Preferences["reservedCommitmentRules"][number];
  fixedEvents: FixedEvent[];
  preferences: Preferences;
  sickDays: SickDay[];
  ordinaryCommitments: ReservedCommitmentOccurrence[];
  planningStart?: Date;
  fixedEventIntervalsByDate: Map<string, TimeInterval[]>;
}) {
  const placed: ReservedCommitmentOccurrence[] = [];
  const preferredDays = normalizeRuleDays(options.rule.days, [1, 4]);
  const days = getWeeklyCommitmentDayOrder(options.weekStart, preferredDays);

  for (let sessionIndex = 0; sessionIndex < FRENCH_TUNE_UP_WEEKLY_SESSION_COUNT; sessionIndex += 1) {
    const usedDateKeys = new Set(placed.map((commitment) => commitment.dateKey));
    const candidates = days.flatMap((day, dayOrder) => {
      const dateKey = toDateKey(day);
      const activeSickDaySeverity = getActiveSickDaySeverity(day, options.sickDays);
      const durationMinutes = getReservedCommitmentDurationForDate(
        options.rule,
        dateKey,
        activeSickDaySeverity ? getSickDayEffectProfile(activeSickDaySeverity) : null,
      );

      if (durationMinutes <= 0) {
        return [];
      }

      const eventIntervals = options.fixedEventIntervalsByDate.get(dateKey) ?? [];
      const ordinaryCommitmentIntervals = buildReservedCommitmentIntervals(
        day,
        options.ordinaryCommitments,
      );
      const placedIntervals = buildReservedCommitmentIntervals(day, placed);
      const recoveryIntervals = resolveRecoveryWindowsForDay({
        day,
        fixedEvents: options.fixedEvents,
        preferences: options.preferences,
        sickDays: options.sickDays,
        blockedReservedCommitments: [
          ...options.ordinaryCommitments,
          ...placed,
        ],
        skipMovableRecovery: false,
        eventIntervals,
      }).map((window) => createInterval(window.start, window.end));
      const dateOverrideStart = options.rule.timeOverrides?.[dateKey]?.start;
      const preferredStart = dateOverrideStart ?? options.rule.preferredStart;

      return getUninterruptedPlacementCandidates({
        day,
        durationMinutes,
        preferredStart,
        busyIntervals: [
          ...eventIntervals,
          ...ordinaryCommitmentIntervals,
          ...placedIntervals,
          ...recoveryIntervals,
        ],
        preferences: options.preferences,
        sickDays: options.sickDays,
        planningStart: options.planningStart,
      }).map((candidate) => ({
        ...candidate,
        dateKey,
        durationMinutes,
        dayOrder,
        repeatedDatePenalty: usedDateKeys.has(dateKey) ? 10000 : 0,
      }));
    });

    const bestCandidate = candidates.sort(
      (left, right) =>
        left.repeatedDatePenalty - right.repeatedDatePenalty ||
        left.dayOrder - right.dayOrder ||
        left.distanceFromPreferredMinutes - right.distanceFromPreferredMinutes ||
        left.start.getTime() - right.start.getTime(),
    )[0];

    if (!bestCandidate) {
      break;
    }

    placed.push({
      id: `${options.rule.id}:${bestCandidate.dateKey}:${sessionIndex + 1}`,
      ruleId: options.rule.id,
      dateKey: bestCandidate.dateKey,
      title: options.rule.label,
      start: bestCandidate.start.toISOString(),
      end: bestCandidate.end.toISOString(),
      label: options.rule.label,
    });
  }

  return placed;
}

export function expandReservedCommitmentWindowsForWeek(
  weekStart: Date,
  preferences: Preferences,
  fixedEvents: FixedEvent[] = [],
  sickDays: SickDay[] = [],
  excludedRuleIds: string[] = [],
  effectiveReservedCommitmentDurations: EffectiveReservedCommitmentDuration[] = [],
  planningStart?: Date,
  schedulingContext?: SchedulingRunContext,
): ReservedCommitmentOccurrence[] {
  const expandedFixedEvents = expandPlannerFixedEventsForWeek(
    weekStart,
    fixedEvents,
    preferences,
    schedulingContext,
  );
  const cacheKey = buildReservedCommitmentCacheKey({
    weekStart,
    sickDays,
    excludedRuleIds,
    effectiveReservedCommitmentDurations,
    planningStart,
  });
  const cached = schedulingContext?.reservedCommitmentWindowsByKey.get(cacheKey);
  if (cached) {
    return cached;
  }

  const excludedRuleIdSet = new Set(excludedRuleIds);
  const frenchTuneUpRule = preferences.reservedCommitmentRules.find(
    (rule) => rule.id === FRENCH_TUNE_UP_RULE_ID && !excludedRuleIdSet.has(rule.id),
  );
  const effectiveDurationByKey = buildEffectiveReservedCommitmentDurationMap(
    effectiveReservedCommitmentDurations,
  );
  const fixedEventIntervalsByDate = getFixedEventIntervalsByDateForWeek({
    weekStart,
    fixedEvents: expandedFixedEvents,
    preferences,
    schedulingContext,
  });

  const ordinaryOccurrences = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).flatMap((day) => {
    const inSchoolTerm = isDateInActiveSchoolTerm(day, preferences);
    const dayFixedEventIntervals = fixedEventIntervalsByDate.get(toDateKey(day)) ?? [];
    const dayRecoveryIntervals = resolveRecoveryWindowsForDay({
      day,
      fixedEvents: expandedFixedEvents,
      preferences,
      sickDays,
      blockedStudyBlocks: [],
      skipMovableRecovery: false,
      eventIntervals: dayFixedEventIntervals,
    }).map((window) => createInterval(window.start, window.end));
    const resolvedIntervals: Array<TimeInterval & { ruleId: string }> = [];
    const prioritizedRules = preferences.reservedCommitmentRules
      .filter((rule) => rule.id !== FRENCH_TUNE_UP_RULE_ID)
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
      const dateKey = toDateKey(day);
      const baseDurationMinutes = getReservedCommitmentDurationForDate(
        rule,
        dateKey,
        activeSickDaySeverity ? getSickDayEffectProfile(activeSickDaySeverity) : null,
      );
      const durationOverride = effectiveDurationByKey.get(`${dateKey}:${rule.id}`);
      const durationMinutes =
        durationOverride == null
          ? baseDurationMinutes
          : Math.min(baseDurationMinutes, durationOverride);

      if (durationMinutes <= 0) {
        return [];
      }

      const hardBusyIntervals = [...dayFixedEventIntervals, ...dayRecoveryIntervals];
      const start = resolveReservedCommitmentStart({
        day,
        preferences,
        rule,
        inSchoolTerm,
        priorCommitmentIntervals: resolvedIntervals,
        hardBusyIntervals,
      });
      const commitmentSegments = placeReservedCommitmentIntervals({
        day,
        start,
        durationMinutes,
        busyIntervals: [...hardBusyIntervals, ...resolvedIntervals],
      });

      if (!commitmentSegments.length) {
        return [];
      }

      resolvedIntervals.push(
        ...commitmentSegments.map((segment) => ({
          ...segment,
          ruleId: rule.id,
        })),
      );

      const validSegments = planningStart
        ? commitmentSegments.filter((segment) => segment.end.getTime() > planningStart.getTime())
        : commitmentSegments;

      return validSegments.map((segment, segmentIndex) => ({
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
  const frenchTuneUpOccurrences = frenchTuneUpRule
    ? placeFrenchTuneUpCommitmentsForWeek({
        weekStart,
        rule: frenchTuneUpRule,
        fixedEvents: expandedFixedEvents,
        preferences,
        sickDays,
        ordinaryCommitments: ordinaryOccurrences,
        planningStart,
        fixedEventIntervalsByDate,
      })
    : [];
  const occurrences = [...ordinaryOccurrences, ...frenchTuneUpOccurrences].sort(
    (left, right) => left.start.localeCompare(right.start),
  );

  schedulingContext?.reservedCommitmentWindowsByKey.set(cacheKey, occurrences);
  return occurrences;
}

export function expandLockedRecoveryWindowsForWeek(
  weekStart: Date,
  preferences: Preferences,
  fixedEvents: FixedEvent[] = [],
  sickDays: SickDay[] = [],
  blockedStudyBlocks: StudyBlock[] = [],
  skipMovableRecovery = false,
  planningStart?: Date,
  blockedReservedCommitments: ReservedCommitmentOccurrence[] = [],
  schedulingContext?: SchedulingRunContext,
): RecoveryWindowOccurrence[] {
  const expandedFixedEvents = expandPlannerFixedEventsForWeek(
    weekStart,
    fixedEvents,
    preferences,
    schedulingContext,
  );
  const fixedEventIntervalsByDate = getFixedEventIntervalsByDateForWeek({
    weekStart,
    fixedEvents: expandedFixedEvents,
    preferences,
    schedulingContext,
  });

  return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).flatMap((day) =>
    resolveRecoveryWindowsForDay({
      day,
      fixedEvents: expandedFixedEvents,
      preferences,
      sickDays,
      blockedStudyBlocks,
      blockedReservedCommitments,
      skipMovableRecovery,
      eventIntervals: fixedEventIntervalsByDate.get(toDateKey(day)) ?? [],
    }).map((window) => ({
      id: `${window.label}-${toDateKey(day)}`,
      dateKey: toDateKey(day),
      title: window.label,
      start: window.start.toISOString(),
      end: window.end.toISOString(),
      label: window.label,
      movable: window.movable,
    }))
    .filter((window) => !planningStart || new Date(window.end).getTime() > planningStart.getTime()),
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
  effectiveReservedCommitmentDurations?: EffectiveReservedCommitmentDuration[];
  minimumDurationMinutes?: number;
  schedulingContext?: SchedulingRunContext;
}) {
  const { weekStart, preferences, planningStart } = options;
  const sickDays = options.sickDays ?? [];
  const minimumDurationMinutes = options.minimumDurationMinutes ?? MIN_ALLOCATABLE_MINUTES;
  const fixedEvents = expandPlannerFixedEventsForWeek(
    weekStart,
    options.fixedEvents,
    preferences,
    options.schedulingContext,
  );
  const reservedCommitments = expandReservedCommitmentWindowsForWeek(
    weekStart,
    preferences,
    options.fixedEvents,
    sickDays,
    options.excludedReservedCommitmentRuleIds ?? [],
    options.effectiveReservedCommitmentDurations ?? [],
    planningStart,
    options.schedulingContext,
  );
  const blockedStudyBlocks = options.blockedStudyBlocks ?? [];
  const recoveryWindows = expandLockedRecoveryWindowsForWeek(
    weekStart,
    preferences,
    options.fixedEvents,
    sickDays,
    blockedStudyBlocks,
    options.skipMovableRecovery ?? false,
    planningStart,
    reservedCommitments,
    options.schedulingContext,
  );
  const fixedEventIntervalsByDate = getFixedEventIntervalsByDateForWeek({
    weekStart,
    fixedEvents,
    preferences,
    sickDays,
    schedulingContext: options.schedulingContext,
  });

  const slots: CalendarSlot[] = [];

  Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)).forEach((day) => {
    const dateKey = toDateKey(day);
    const scheduleProfile = resolveDailyScheduleProfile(day, preferences, sickDays);
    if (!scheduleProfile.isStudyEnabled) {
      return;
    }
    const plannerWindow = createInterval(
      createDateAtTime(day, scheduleProfile.dailyStudyWindow.start),
      createDateAtTime(day, scheduleProfile.dailyStudyWindow.end),
    );
    const examDayEarliestStudyStart = getExamDayEarliestStudyStart(day, preferences);

    if (planningStart && plannerWindow.end <= planningStart) {
      return;
    }

    if (planningStart && plannerWindow.start < planningStart && plannerWindow.end > planningStart) {
      plannerWindow.start = planningStart;
    }

    if (
      examDayEarliestStudyStart &&
      plannerWindow.start < examDayEarliestStudyStart &&
      plannerWindow.end > examDayEarliestStudyStart
    ) {
      plannerWindow.start = examDayEarliestStudyStart;
    }

    if (examDayEarliestStudyStart && plannerWindow.end <= examDayEarliestStudyStart) {
      return;
    }

    const busyIntervals = mergeIntervals([
      ...recoveryWindows
        .filter((window) => toDateKey(new Date(window.start)) === toDateKey(day))
        .map((window) => createInterval(new Date(window.start), new Date(window.end))),
      ...reservedCommitments
        .filter((window) => toDateKey(new Date(window.start)) === dateKey)
        .map((window) => createInterval(new Date(window.start), new Date(window.end))),
      ...(fixedEventIntervalsByDate.get(dateKey) ?? []),
      ...buildStudyBlockIntervals(day, blockedStudyBlocks),
    ]);

    subtractIntervals(plannerWindow, busyIntervals)
      .filter((interval) => minutesBetween(interval.start, interval.end) >= minimumDurationMinutes)
      .forEach((interval, slotIndex) => {
        const slot: CalendarSlot = {
          id: `${toDateKey(day)}-slot-${slotIndex + 1}`,
          start: interval.start,
          end: interval.end,
          dateKey,
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
  schedulingContext?: SchedulingRunContext,
) {
  const blockStart = new Date(block.start);
  const blockEnd = new Date(block.end);

  return expandPlannerFixedEventsForWeek(weekStart, fixedEvents, preferences, schedulingContext).some((event) => {
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);
    return blockStart < eventEnd && blockEnd > eventStart;
  });
}
