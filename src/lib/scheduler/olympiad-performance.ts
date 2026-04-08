import { addDays, addHours, differenceInCalendarDays } from "date-fns";

import { fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import {
  calculateFreeSlots,
  expandPlannerFixedEventsForWeek,
} from "@/lib/scheduler/free-slots";
import { isDateInActiveSchoolTerm } from "@/lib/scheduler/schedule-regime";
import type {
  CompletionLog,
  FixedEvent,
  Preferences,
  SickDay,
  StudyBlock,
  TaskCandidate,
  Topic,
} from "@/lib/types/planner";

export type OlympiadContentStrand =
  | "geometry"
  | "algebra"
  | "number-theory"
  | "combinatorics";

export type OlympiadWeekLoadState = "heavy" | "normal" | "light";
export type OlympiadFollowUpKind = "olympiad-rewrite";

export interface OlympiadRewriteObligation {
  sourceStudyBlockId: string;
  sourceTopicId: string | null;
  sourceTitle: string;
  sourceUnitTitle: string | null;
  sourcePaperCode: string | null;
  sourceMaterials: StudyBlock["sourceMaterials"];
  strand: OlympiadContentStrand | null;
  availableAt: string;
  dueAt: string;
  durationMinutes: number;
  scheduledBlock: StudyBlock | null;
}

export interface OlympiadWeekLoadProfile {
  state: OlympiadWeekLoadState;
  multiplier: number;
  schoolTermDays: number;
  schoolMinutes: number;
  assessmentMinutes: number;
  freeCapacityMinutes: number;
}

export interface OlympiadWeaknessProfile {
  activeStrand: OlympiadContentStrand | null;
  windowStart: string;
  windowEnd: string;
  scores: Record<OlympiadContentStrand, number>;
}

const OLYMPIAD_SUBJECT_ID = "olympiad";
const BIWEEKLY_ANCHOR = "2026-04-06";
const LOOKBACK_DAYS = 28;
const PERFORMANCE_SYSTEM_START = new Date("2026-04-08T00:00:00.000Z");

function minutesBetween(startIso: string, endIso: string) {
  return Math.max(0, Math.round((new Date(endIso).getTime() - new Date(startIso).getTime()) / (60 * 1000)));
}

function sumFixedEventMinutes(events: FixedEvent[], category: FixedEvent["category"]) {
  return events
    .filter((event) => event.category === category)
    .reduce((total, event) => {
      if (event.isAllDay) {
        return total + 8 * 60;
      }

      return total + minutesBetween(event.start, event.end);
    }, 0);
}

function getLatestSeriousCompletionLog(
  completionLogs: CompletionLog[],
  studyBlockId: string,
) {
  return completionLogs
    .filter(
      (log) =>
        log.studyBlockId === studyBlockId &&
        (log.outcome === "done" || log.outcome === "partial"),
    )
    .sort(
      (left, right) =>
        new Date(right.recordedAt).getTime() - new Date(left.recordedAt).getTime(),
    )[0] ?? null;
}

function getBiweeklyWindow(referenceDate: Date) {
  const anchor = fromDateKey(BIWEEKLY_ANCHOR);
  const normalizedReference = startOfPlannerWeek(referenceDate);
  const daysSinceAnchor = Math.max(0, differenceInCalendarDays(normalizedReference, anchor));
  const windowIndex = Math.floor(daysSinceAnchor / 14);
  const windowStart = addDays(anchor, windowIndex * 14);
  const windowEnd = addDays(windowStart, 13);

  return {
    windowStart,
    windowEnd,
  };
}

export function getOlympiadStrandFromSequenceGroup(sequenceGroup?: string | null): OlympiadContentStrand | null {
  switch (sequenceGroup) {
    case "olympiad-geo":
      return "geometry";
    case "olympiad-alg":
      return "algebra";
    case "olympiad-nt":
      return "number-theory";
    case "olympiad-combi":
      return "combinatorics";
    default:
      return null;
  }
}

export function getOlympiadStrandForTopic(topic?: Pick<Topic, "sequenceGroup" | "subjectId"> | null) {
  if (!topic || topic.subjectId !== OLYMPIAD_SUBJECT_ID) {
    return null;
  }

  return getOlympiadStrandFromSequenceGroup(topic.sequenceGroup);
}

export function isOlympiadRewriteFollowUpBlock(
  block: Pick<StudyBlock, "followUpKind" | "subjectId">,
) {
  return block.subjectId === OLYMPIAD_SUBJECT_ID && block.followUpKind === "olympiad-rewrite";
}

export function isSeriousOlympiadAttemptBlock(options: {
  block: Pick<StudyBlock, "subjectId" | "topicId" | "blockType" | "followUpKind">;
  topicById: Map<string, Topic>;
}) {
  if (options.block.subjectId !== OLYMPIAD_SUBJECT_ID) {
    return false;
  }

  if (options.block.followUpKind === "olympiad-rewrite" || !options.block.topicId) {
    return false;
  }

  const topic = options.topicById.get(options.block.topicId);
  if (!topic) {
    return false;
  }

  if ((topic.sessionMode ?? "flexible") === "exam") {
    return true;
  }

  return !!getOlympiadStrandForTopic(topic) && options.block.blockType !== "review";
}

export function getOlympiadRewriteDurationMinutes(options: {
  block: Pick<StudyBlock, "estimatedMinutes">;
  topic: Topic | null;
}) {
  if ((options.topic?.sessionMode ?? "flexible") === "exam" || options.block.estimatedMinutes >= 180) {
    return 60;
  }

  return 45;
}

export function buildOlympiadRewriteTitle(sourceTitle: string) {
  return `Clean proof rewrite: ${sourceTitle}`;
}

export function getOlympiadRewriteObligations(options: {
  topics: Topic[];
  studyBlocks: StudyBlock[];
  completionLogs?: CompletionLog[];
}) {
  const completionLogs = options.completionLogs ?? [];
  const topicById = new Map(options.topics.map((topic) => [topic.id, topic]));
  const followUpsBySource = options.studyBlocks.reduce<Record<string, StudyBlock[]>>((accumulator, block) => {
    if (!isOlympiadRewriteFollowUpBlock(block) || !block.followUpSourceStudyBlockId) {
      return accumulator;
    }

    accumulator[block.followUpSourceStudyBlockId] = [
      ...(accumulator[block.followUpSourceStudyBlockId] ?? []),
      block,
    ];
    return accumulator;
  }, {});

  return options.studyBlocks
    .filter((block) => block.status === "done" || block.status === "partial")
    .filter((block) => isSeriousOlympiadAttemptBlock({ block, topicById }))
    .flatMap<OlympiadRewriteObligation>((block) => {
      const followUps = followUpsBySource[block.id] ?? [];
      const satisfied = followUps.some((followUp) => followUp.status === "done");

      if (satisfied) {
        return [];
      }

      const latestCompletionLog = getLatestSeriousCompletionLog(completionLogs, block.id);
      const availableAt = latestCompletionLog?.recordedAt ?? block.end;
      if (new Date(availableAt).getTime() < PERFORMANCE_SYSTEM_START.getTime()) {
        return [];
      }
      const dueAt = addHours(new Date(availableAt), 48).toISOString();
      const scheduledBlock =
        followUps
          .filter((followUp) => ["planned", "rescheduled"].includes(followUp.status))
          .sort(
            (left, right) =>
              new Date(left.start).getTime() - new Date(right.start).getTime(),
          )[0] ?? null;
      const topic = block.topicId ? topicById.get(block.topicId) ?? null : null;

      return [
        {
          sourceStudyBlockId: block.id,
          sourceTopicId: block.topicId,
          sourceTitle: block.title,
          sourceUnitTitle: block.unitTitle,
          sourcePaperCode: block.paperCode,
          sourceMaterials: block.sourceMaterials,
          strand: getOlympiadStrandForTopic(topic),
          availableAt,
          dueAt,
          durationMinutes: getOlympiadRewriteDurationMinutes({
            block,
            topic,
          }),
          scheduledBlock,
        },
      ];
    })
    .sort(
      (left, right) =>
        new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime(),
    );
}

export function getPendingOlympiadRewriteObligations(options: {
  topics: Topic[];
  studyBlocks: StudyBlock[];
  completionLogs?: CompletionLog[];
  referenceDate: Date;
}) {
  const deadline = addHours(options.referenceDate, 48).getTime();

  return getOlympiadRewriteObligations(options).filter(
    (obligation) => new Date(obligation.dueAt).getTime() <= deadline,
  );
}

export function getOlympiadWeekLoadProfile(options: {
  weekStart: Date;
  fixedEvents: FixedEvent[];
  preferences: Preferences;
  sickDays?: SickDay[];
}) {
  const schoolTermDays = Array.from({ length: 7 }, (_, offset) => addDays(options.weekStart, offset)).filter(
    (day) => isDateInActiveSchoolTerm(day, options.preferences),
  ).length;
  const expandedEvents = expandPlannerFixedEventsForWeek(
    options.weekStart,
    options.fixedEvents,
    options.preferences,
  );
  const schoolMinutes = sumFixedEventMinutes(expandedEvents, "school");
  const assessmentMinutes = sumFixedEventMinutes(expandedEvents, "assessment");
  const freeCapacityMinutes = calculateFreeSlots({
    weekStart: options.weekStart,
    fixedEvents: options.fixedEvents,
    sickDays: options.sickDays ?? [],
    preferences: options.preferences,
    blockedStudyBlocks: [],
  }).reduce((total, slot) => total + slot.durationMinutes, 0);

  if (schoolTermDays === 0) {
    return {
      state: "light" as const,
      multiplier: 1.2,
      schoolTermDays,
      schoolMinutes,
      assessmentMinutes,
      freeCapacityMinutes,
    };
  }

  if (assessmentMinutes >= 180 || schoolMinutes >= 1800 || freeCapacityMinutes < 720) {
    return {
      state: "heavy" as const,
      multiplier: 0.7,
      schoolTermDays,
      schoolMinutes,
      assessmentMinutes,
      freeCapacityMinutes,
    };
  }

  if (assessmentMinutes === 0 && schoolMinutes <= 1350 && freeCapacityMinutes >= 960) {
    return {
      state: "light" as const,
      multiplier: 1.2,
      schoolTermDays,
      schoolMinutes,
      assessmentMinutes,
      freeCapacityMinutes,
    };
  }

  return {
    state: "normal" as const,
    multiplier: 1,
    schoolTermDays,
    schoolMinutes,
    assessmentMinutes,
    freeCapacityMinutes,
  };
}

export function getOlympiadWeaknessProfile(options: {
  topics: Topic[];
  studyBlocks: StudyBlock[];
  completionLogs?: CompletionLog[];
  referenceDate: Date;
}) {
  const { windowStart, windowEnd } = getBiweeklyWindow(options.referenceDate);
  const lookbackStart = addDays(windowStart, -LOOKBACK_DAYS);
  const topicById = new Map(options.topics.map((topic) => [topic.id, topic]));
  const timedUnderperformanceCount = options.studyBlocks.filter((block) => {
    if (block.subjectId !== OLYMPIAD_SUBJECT_ID || !block.topicId) {
      return false;
    }

    const topic = topicById.get(block.topicId);
    if (!topic || (topic.sessionMode ?? "flexible") !== "exam") {
      return false;
    }

    const blockTime = new Date(block.end).getTime();
    return (
      blockTime >= lookbackStart.getTime() &&
      blockTime <= options.referenceDate.getTime() &&
      (block.status === "partial" || block.status === "missed")
    );
  }).length;

  const scores = {
    geometry: 0,
    algebra: 0,
    "number-theory": 0,
    combinatorics: 0,
  } satisfies Record<OlympiadContentStrand, number>;

  (Object.keys(scores) as OlympiadContentStrand[]).forEach((strand) => {
    const strandTopics = options.topics.filter(
      (topic) =>
        topic.subjectId === OLYMPIAD_SUBJECT_ID &&
        getOlympiadStrandForTopic(topic) === strand &&
        topic.completedHours + 0.001 < topic.estHours,
    );
    const remainingHours = strandTopics.reduce(
      (total, topic) => total + Math.max(topic.estHours - topic.completedHours, 0),
      0,
    );
    const masteryPenalty = strandTopics.reduce(
      (total, topic) =>
        total +
        ((5 - topic.mastery) / 5) *
          Math.max(Math.min(topic.estHours - topic.completedHours, 2), 0),
      0,
    );
    const recentOutcomePenalty = options.studyBlocks
      .filter(
        (block) =>
          (block.status === "partial" || block.status === "missed") &&
          new Date(block.end).getTime() >= lookbackStart.getTime() &&
          new Date(block.end).getTime() <= options.referenceDate.getTime(),
      )
      .filter((block) => {
        if (!block.topicId) {
          return false;
        }

        const topic = topicById.get(block.topicId);
        return getOlympiadStrandForTopic(topic) === strand;
      })
      .reduce((total, block) => total + (block.status === "missed" ? 1.15 : 0.75), 0);
    const recentSuccessCount = options.studyBlocks
      .filter(
        (block) =>
          block.status === "done" &&
          new Date(block.end).getTime() >= lookbackStart.getTime() &&
          new Date(block.end).getTime() <= options.referenceDate.getTime(),
      )
      .filter((block) => {
        if (!block.topicId) {
          return false;
        }

        const topic = topicById.get(block.topicId);
        return getOlympiadStrandForTopic(topic) === strand;
      }).length;
    const timedPenalty =
      timedUnderperformanceCount > 0
        ? timedUnderperformanceCount * Math.max(recentOutcomePenalty - recentSuccessCount * 0.35, 0)
        : 0;

    scores[strand] = Number(
      (
        masteryPenalty * 6.5 +
        remainingHours * 0.9 +
        recentOutcomePenalty * 7.5 +
        timedPenalty * 2.5
      ).toFixed(2),
    );
  });

  const activeStrand =
    (Object.entries(scores)
      .filter(([, score]) => score > 0)
      .sort((left, right) => right[1] - left[1])[0]?.[0] as OlympiadContentStrand | undefined) ??
    null;

  return {
    activeStrand,
    windowStart: toDateKey(windowStart),
    windowEnd: toDateKey(windowEnd),
    scores,
  } satisfies OlympiadWeaknessProfile;
}

export function getOlympiadStrandForTask(task: Pick<TaskCandidate, "olympiadStrand" | "subjectId">) {
  if (task.subjectId !== OLYMPIAD_SUBJECT_ID) {
    return null;
  }

  return task.olympiadStrand ?? null;
}
