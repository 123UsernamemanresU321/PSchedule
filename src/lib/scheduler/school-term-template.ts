import { addDays, getISOWeek } from "date-fns";

import { startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { isDateInActiveSchoolTerm } from "@/lib/scheduler/schedule-regime";
import type { Preferences, StudyBlock, StudyLayer, SubjectId, Topic } from "@/lib/types/planner";

export const IB_ANCHOR_SUBJECT_IDS = [
  "maths-aa-hl",
  "physics-hl",
  "chemistry-hl",
] as const satisfies SubjectId[];

export interface SchoolTermTemplateRequirement {
  id: string;
  allowedDateKeys: string[];
  subjectId: SubjectId;
  studyLayers: StudyLayer[];
  minimumMinutes: number;
  exactTopicId?: string | null;
  allowOverflowDayCap?: boolean;
}

export interface SchoolTermWeekTemplate {
  active: boolean;
  requirements: SchoolTermTemplateRequirement[];
  dayStudyCapOverrideMinutesByDate: Record<string, number>;
  lightReviewOnlyDateKeys: string[];
}

function isIbAnchorSubject(subjectId: SubjectId | null | undefined): subjectId is (typeof IB_ANCHOR_SUBJECT_IDS)[number] {
  return !!subjectId && IB_ANCHOR_SUBJECT_IDS.includes(subjectId as (typeof IB_ANCHOR_SUBJECT_IDS)[number]);
}

export function getWeekdayAnchorSubject(day: Date) {
  switch (day.getDay()) {
    case 1:
      return "maths-aa-hl" as const;
    case 2:
      return "physics-hl" as const;
    case 3:
      return "chemistry-hl" as const;
    case 4:
      return "maths-aa-hl" as const;
    case 5:
      return getISOWeek(day) % 2 === 1 ? ("physics-hl" as const) : ("chemistry-hl" as const);
    default:
      return null;
  }
}

function isPastPaperTopic(topic: Pick<Topic, "unitId" | "sessionMode">) {
  return topic.unitId.includes("past-papers") && (topic.sessionMode ?? "flexible") === "exam";
}

function isTopicAlreadyCovered(topic: Topic, blocks: StudyBlock[]) {
  if (topic.completedHours >= topic.estHours - 0.001) {
    return true;
  }

  return blocks.some(
    (block) =>
      block.topicId === topic.id &&
      block.status !== "missed",
  );
}

function findOldestPendingPaperTopic(options: {
  weekStart: Date;
  topics: Topic[];
  existingPlannedBlocks: StudyBlock[];
}) {
  const weekStartKey = toDateKey(startOfPlannerWeek(options.weekStart));

  return options.topics
    .filter((topic) => isIbAnchorSubject(topic.subjectId))
    .filter((topic) => isPastPaperTopic(topic))
    .filter((topic) => (topic.availableFrom ?? weekStartKey) <= weekStartKey)
    .filter((topic) => !isTopicAlreadyCovered(topic, options.existingPlannedBlocks))
    .sort(
      (left, right) =>
        (left.availableFrom ?? "").localeCompare(right.availableFrom ?? "") ||
        left.order - right.order,
    )[0] ?? null;
}

export function buildSchoolTermWeekTemplate(options: {
  weekStart: Date;
  topics: Topic[];
  preferences: Preferences;
  existingPlannedBlocks: StudyBlock[];
}): SchoolTermWeekTemplate {
  const weekStart = startOfPlannerWeek(options.weekStart);
  const days = Array.from({ length: 7 }, (_, offset) => addDays(weekStart, offset));
  const inTermDays = days.filter((day) => isDateInActiveSchoolTerm(day, options.preferences));

  if (!inTermDays.length) {
    return {
      active: false,
      requirements: [],
      dayStudyCapOverrideMinutesByDate: {},
      lightReviewOnlyDateKeys: [] as string[],
    };
  }

  const requirements: SchoolTermTemplateRequirement[] = [];

  days.forEach((day) => {
    if (!isDateInActiveSchoolTerm(day, options.preferences)) {
      return;
    }

    const dateKey = toDateKey(day);
    const dayIndex = day.getDay();

    if (options.preferences.schoolSchedule.weekdays.includes(dayIndex)) {
      const anchorSubject = getWeekdayAnchorSubject(day);

      if (!anchorSubject) {
        return;
      }

      requirements.push(
        {
          id: `${dateKey}-learning`,
          allowedDateKeys: [dateKey],
          subjectId: anchorSubject,
          studyLayers: ["learning"],
          minimumMinutes: 60,
        },
        {
          id: `${dateKey}-application`,
          allowedDateKeys: [dateKey],
          subjectId: anchorSubject,
          studyLayers: ["application"],
          minimumMinutes: 45,
        },
        {
          id: `${dateKey}-olympiad-depth`,
          allowedDateKeys: [dateKey],
          subjectId: "olympiad",
          studyLayers: ["learning"],
          minimumMinutes: 45,
        },
        {
          id: `${dateKey}-correction`,
          allowedDateKeys: [dateKey],
          subjectId: anchorSubject,
          studyLayers: ["correction"],
          minimumMinutes: 30,
        },
      );
      return;
    }

    if (dayIndex === 6) {
      return;
    }

  });

  const saturday = days.find((day) => day.getDay() === 6);
  const sunday = days.find((day) => day.getDay() === 0);
  const pendingPaperTopic =
    saturday && sunday
      ? findOldestPendingPaperTopic({
          weekStart,
          topics: options.topics,
          existingPlannedBlocks: options.existingPlannedBlocks,
        })
      : null;

  if (pendingPaperTopic && saturday && sunday) {
    const saturdayKey = toDateKey(saturday);
    const sundayKey = toDateKey(sunday);
    const reviewTopic =
      options.topics.find((topic) => topic.dependsOnTopicId === pendingPaperTopic.id) ?? null;

    requirements.push({
      id: `${saturdayKey}-paper-cycle-exam`,
      allowedDateKeys: [saturdayKey, sundayKey],
      subjectId: pendingPaperTopic.subjectId,
      studyLayers: ["exam_sim"],
      minimumMinutes: pendingPaperTopic.exactSessionMinutes ?? 120,
      exactTopicId: pendingPaperTopic.id,
      allowOverflowDayCap: true,
    });

    if (reviewTopic) {
      requirements.push({
        id: `${saturdayKey}-paper-cycle-correction`,
        allowedDateKeys: [saturdayKey, sundayKey],
        subjectId: reviewTopic.subjectId,
        studyLayers: ["correction"],
        minimumMinutes: Math.round(reviewTopic.estHours * 60),
        exactTopicId: reviewTopic.id,
        allowOverflowDayCap: true,
      });
    }
  }

  return {
    active: true,
    requirements,
    dayStudyCapOverrideMinutesByDate: {},
    lightReviewOnlyDateKeys: [],
  };
}
