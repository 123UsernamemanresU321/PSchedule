import {
  addDays,
  addMinutes,
  differenceInCalendarDays,
  differenceInMinutes,
  endOfWeek,
  format,
  isSameMonth,
  set,
  startOfWeek,
} from "date-fns";

export function startOfPlannerWeek(referenceDate: Date) {
  return startOfWeek(referenceDate, { weekStartsOn: 1 });
}

export function getPlannerReferenceDate(weekStart: Date, referenceDate = new Date()) {
  return toDateKey(startOfPlannerWeek(referenceDate)) === toDateKey(weekStart)
    ? referenceDate
    : weekStart;
}

export function endOfPlannerWeek(referenceDate: Date) {
  return endOfWeek(referenceDate, { weekStartsOn: 1 });
}

export function getAcademicDeadline(referenceDate = new Date()) {
  const year = referenceDate.getMonth() > 6 ? referenceDate.getFullYear() + 1 : referenceDate.getFullYear();
  return new Date(year, 6, 31, 23, 59, 59, 999);
}

export function toDateKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

export function fromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

export function toDateTimeString(date: Date) {
  return date.toISOString();
}

export function formatDayLabel(date: Date) {
  return format(date, "EEE d MMM");
}

export function formatWeekRangeLabel(weekStart: Date) {
  const weekEnd = addDays(weekStart, 6);
  const left = format(weekStart, "MMM d");
  const right = isSameMonth(weekStart, weekEnd)
    ? format(weekEnd, "d, yyyy")
    : format(weekEnd, "MMM d, yyyy");
  return `${left} - ${right}`;
}

export function createDateAtTime(day: Date, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return set(day, {
    hours,
    minutes,
    seconds: 0,
    milliseconds: 0,
  });
}

export function minutesBetween(start: Date, end: Date) {
  return Math.max(0, differenceInMinutes(end, start));
}

export function addMinutesToDate(date: Date, minutes: number) {
  return addMinutes(date, minutes);
}

export function hoursFromMinutes(minutes: number) {
  return Math.round((minutes / 60) * 10) / 10;
}

export function formatHoursFromMinutes(minutes: number) {
  const hours = hoursFromMinutes(minutes);
  return `${hours.toFixed(hours % 1 === 0 ? 0 : 1)}h`;
}

export function formatMinutesRange(start: Date, end: Date) {
  return `${format(start, "HH:mm")}-${format(end, "HH:mm")}`;
}

export function formatDateTimeLabel(value: string) {
  return format(new Date(value), "EEE, d MMM • HH:mm");
}

export function daysUntil(target: string, referenceDate: Date) {
  return differenceInCalendarDays(new Date(target), referenceDate);
}

export function dayIndexFromDateKey(dateKey: string) {
  return new Date(dateKey).getDay();
}
