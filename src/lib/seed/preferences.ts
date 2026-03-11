import { subjectPrioritySeed } from "@/lib/constants/planner";
import type { Preferences } from "@/lib/types/planner";

export function buildSeedPreferences(): Preferences {
  return {
    id: "default",
    dailyStudyWindow: {
      start: "06:00",
      end: "22:30",
    },
    preferredDeepWorkWindows: [
      {
        label: "Weekday prime",
        start: "15:30",
        end: "18:30",
        days: [1, 2, 3, 4, 5],
      },
      {
        label: "Weekend morning",
        start: "09:00",
        end: "12:00",
        days: [0, 6],
      },
      {
        label: "Weekend afternoon",
        start: "14:00",
        end: "16:30",
        days: [0, 6],
      },
    ],
    lockedRecoveryWindows: [
      {
        label: "Dinner reset",
        start: "19:15",
        end: "20:00",
        days: [1, 2, 3, 4, 5],
        movable: true,
      },
      {
        label: "Sunday recovery",
        start: "18:00",
        end: "22:00",
        days: [0],
        movable: false,
      },
    ],
    maxHeavySessionsPerDay: 2,
    maxStudyHoursPerDay: 5,
    minBreakMinutes: 15,
    weeklyBufferRatio: 0.18,
    bufferMinutesBeforeFixedEvent: 15,
    reserveSundayEvening: true,
    autoReduceBeforeExamWeeks: false,
    avoidLateNightHeavy: true,
    lateNightCutoff: "20:15",
    subjectWeightOverrides: subjectPrioritySeed,
    schoolSchedule: {
      enabled: false,
      weekdays: [1, 2, 3, 4, 5],
      start: "08:00",
      end: "15:00",
      terms: [
        { id: "term-1", label: "Term 1", startDate: "", endDate: "" },
        { id: "term-2", label: "Term 2", startDate: "", endDate: "" },
        { id: "term-3", label: "Term 3", startDate: "", endDate: "" },
        { id: "term-4", label: "Term 4", startDate: "", endDate: "" },
      ],
    },
    holidaySchedule: {
      enabled: true,
      dailyStudyWindow: {
        start: "08:00",
        end: "22:30",
      },
      preferredDeepWorkWindows: [
        {
          label: "Holiday morning deep work",
          start: "08:00",
          end: "11:30",
          days: [0, 1, 2, 3, 4, 5, 6],
        },
        {
          label: "Holiday afternoon focus",
          start: "14:00",
          end: "17:00",
          days: [0, 1, 2, 3, 4, 5, 6],
        },
      ],
      maxStudyHoursPerDay: 6,
    },
  };
}
