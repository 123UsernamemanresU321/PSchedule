import { FRENCH_TUNE_UP_RULE_ID, subjectPrioritySeed } from "@/lib/constants/planner";
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
        label: "Lunch break",
        start: "12:00",
        end: "13:30",
        days: [0, 1, 2, 3, 4, 5, 6],
        movable: false,
      },
      {
        label: "Dinner reset",
        start: "19:15",
        end: "20:00",
        days: [0, 1, 2, 3, 4, 5, 6],
        movable: true,
      },
      {
        label: "Sunday recovery",
        start: "21:30",
        end: "22:30",
        days: [0],
        movable: false,
      },
    ],
    reservedCommitmentRules: [
      {
        id: "piano-practice",
        label: "Piano",
        durationMinutes: 60,
        days: [0, 2, 3, 4, 5, 6],
        appliesDuring: "all",
        preferredStart: "18:00",
        timeOverrides: {},
      },
      {
        id: "term-homework",
        label: "Homework",
        durationMinutes: 90,
        days: [0, 1, 2, 3, 4, 5],
        appliesDuring: "school-term",
        preferredStart: "16:00",
        timeOverrides: {},
      },
      {
        id: FRENCH_TUNE_UP_RULE_ID,
        label: "French tune-up",
        durationMinutes: 30,
        days: [1, 4],
        appliesDuring: "all",
        preferredStart: "17:30",
        timeOverrides: {},
      },
    ],
    maxHeavySessionsPerDay: 2,
    maxStudyHoursPerDay: 5,
    breaksEnabled: false,
    minBreakMinutes: 0,
    weeklyBufferRatio: 0.18,
    bufferMinutesBeforeFixedEvent: 15,
    reserveSundayEvening: true,
    autoReduceBeforeExamWeeks: false,
    avoidLateNightHeavy: true,
    lateNightCutoff: "20:15",
    subjectWeightOverrides: {
      ...subjectPrioritySeed,
    },
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
      noSchoolDays: [],
      schoolClubs: [],
      examPeriods: [],
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
      maxStudyHoursPerDay: null,
    },
    sundayStudy: {
      enabled: true,
      workloadIntensity: 0.85,
    },
  };
}
