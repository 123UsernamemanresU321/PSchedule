import { addDays, getISOWeek } from "date-fns";

import { startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { isDateInActiveSchoolTerm } from "@/lib/scheduler/schedule-regime";
import type { Preferences, StudyBlock, StudyLayer, SubjectId, Topic } from "@/lib/types/planner";

export const IB_ANCHOR_SUBJECT_IDS = [
  "maths-aa-hl",
  "physics-hl",
  "chemistry-hl",
] as const satisfies SubjectId[];

export const CORE_HL_SYLLABUS_PRIORITY_END_DATE_KEY = "2026-10-31";

const WEEKLY_PAPER_PRACTICE_SUBJECT_IDS = [
  ...IB_ANCHOR_SUBJECT_IDS,
  "geography-transition",
  "english-a-sl",
  "french-b-sl",
] as const satisfies SubjectId[];

export interface SchoolTermTemplateRequirement {
  id: string;
  allowedDateKeys: string[];
  subjectId: SubjectId;
  studyLayers: StudyLayer[];
  minimumMinutes: number;
  exactTopicId?: string | null;
  allowOverflowDayCap?: boolean;
  taskConstraint?: "olympiad-bplus-content";
}

export interface SchoolTermWeekTemplate {
  active: boolean;
  requirements: SchoolTermTemplateRequirement[];
  dayStudyCapOverrideMinutesByDate: Record<string, number>;
  lightReviewOnlyDateKeys: string[];
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

export function isCoreHlSyllabusTopic(
  topic: Pick<Topic, "id" | "subjectId" | "unitId" | "sessionMode">,
) {
  return (
    IB_ANCHOR_SUBJECT_IDS.includes(
      topic.subjectId as (typeof IB_ANCHOR_SUBJECT_IDS)[number],
    ) &&
    !topic.unitId.includes("past-papers") &&
    (topic.sessionMode ?? "flexible") !== "exam" &&
    !topic.id.endsWith("-review")
  );
}

function hasOpenCoreHlSyllabusWork(topics: Topic[], blocks: StudyBlock[]) {
  const plannedMinutesByTopic = blocks.reduce<Record<string, number>>((accumulator, block) => {
    if (
      !block.topicId ||
      (block.status !== "planned" && block.status !== "rescheduled")
    ) {
      return accumulator;
    }

    accumulator[block.topicId] =
      (accumulator[block.topicId] ?? 0) + block.estimatedMinutes;
    return accumulator;
  }, {});

  return topics.some(
    (topic) =>
      isCoreHlSyllabusTopic(topic) &&
      Math.round(Math.max(topic.estHours - topic.completedHours, 0) * 60) >
        (plannedMinutesByTopic[topic.id] ?? 0),
  );
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

function findOldestPendingPaperTopics(options: {
  weekStart: Date;
  topics: Topic[];
  existingPlannedBlocks: StudyBlock[];
}) {
  const weekStartKey = toDateKey(startOfPlannerWeek(options.weekStart));

  return WEEKLY_PAPER_PRACTICE_SUBJECT_IDS.map(
    (subjectId) =>
      options.topics
        .filter((topic) => topic.subjectId === subjectId)
        .filter((topic) => isPastPaperTopic(topic))
        .filter((topic) => (topic.availableFrom ?? weekStartKey) <= weekStartKey)
        .filter((topic) => !isTopicAlreadyCovered(topic, options.existingPlannedBlocks))
        .sort(
          (left, right) =>
            (left.availableFrom ?? "").localeCompare(right.availableFrom ?? "") ||
            left.order - right.order,
        )[0] ?? null,
  ).filter((topic): topic is Topic => !!topic);
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
  const requirements: SchoolTermTemplateRequirement[] = [];
  const coreHlPriorityActive =
    toDateKey(weekStart) <= CORE_HL_SYLLABUS_PRIORITY_END_DATE_KEY &&
    hasOpenCoreHlSyllabusWork(options.topics, options.existingPlannedBlocks);

  if (coreHlPriorityActive) {
    const continuityDateKeys = days
      .map(toDateKey)
      .filter((dateKey) => dateKey <= CORE_HL_SYLLABUS_PRIORITY_END_DATE_KEY);
    const firstWindowDateKeys = continuityDateKeys.slice(0, 3);
    const secondWindowDateKeys = continuityDateKeys.slice(3);

    [firstWindowDateKeys, secondWindowDateKeys].forEach((allowedDateKeys, index) => {
      if (!allowedDateKeys.length) {
        return;
      }

      requirements.push({
        id: `${toDateKey(weekStart)}-olympiad-continuity-${index + 1}`,
        allowedDateKeys,
        subjectId: "olympiad",
        studyLayers: ["learning"],
        minimumMinutes: 30,
        taskConstraint: "olympiad-bplus-content",
      });
    });
  }

  if (!inTermDays.length) {
    return {
      active: coreHlPriorityActive,
      requirements,
      dayStudyCapOverrideMinutesByDate: {},
      lightReviewOnlyDateKeys: [] as string[],
    };
  }

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
          id: `${dateKey}-correction`,
          allowedDateKeys: [dateKey],
          subjectId: anchorSubject,
          studyLayers: ["correction"],
          minimumMinutes: 30,
        },
      );

      if (!coreHlPriorityActive) {
        requirements.push({
          id: `${dateKey}-olympiad-depth`,
          allowedDateKeys: [dateKey],
          subjectId: "olympiad",
          studyLayers: ["learning", "application", "exam_sim", "correction"],
          minimumMinutes: 60,
        });
      }
      return;
    }

    if (dayIndex === 6) {
      return;
    }

  });
  const saturday = days.find((day) => day.getDay() === 6);
  const sunday = days.find((day) => day.getDay() === 0);
  const pendingPaperTopics =
    saturday && sunday
      ? findOldestPendingPaperTopics({
          weekStart,
          topics: options.topics,
          existingPlannedBlocks: options.existingPlannedBlocks,
        })
      : [];

  if (pendingPaperTopics.length > 0 && saturday && sunday) {
    const saturdayKey = toDateKey(saturday);
    const sundayKey = toDateKey(sunday);

    pendingPaperTopics.forEach((pendingPaperTopic) => {
      const reviewTopic =
        options.topics.find((topic) => topic.dependsOnTopicId === pendingPaperTopic.id) ?? null;

      requirements.push({
        id: `${saturdayKey}-${pendingPaperTopic.id}-exam`,
        allowedDateKeys: [saturdayKey, sundayKey],
        subjectId: pendingPaperTopic.subjectId,
        studyLayers: ["exam_sim"],
        minimumMinutes: pendingPaperTopic.exactSessionMinutes ?? 120,
        exactTopicId: pendingPaperTopic.id,
        allowOverflowDayCap: true,
      });

      if (reviewTopic) {
        requirements.push({
          id: `${saturdayKey}-${pendingPaperTopic.id}-correction`,
          allowedDateKeys: [saturdayKey, sundayKey],
          subjectId: reviewTopic.subjectId,
          studyLayers: ["correction"],
          minimumMinutes: Math.round(reviewTopic.estHours * 60),
          exactTopicId: reviewTopic.id,
          allowOverflowDayCap: true,
        });
      }
    });
  }

  return {
    active: true,
    requirements,
    dayStudyCapOverrideMinutesByDate: {},
    lightReviewOnlyDateKeys: [],
  };
}
