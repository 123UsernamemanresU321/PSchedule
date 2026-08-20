import type { CoreSyllabusAssignedMinutesByDate } from "@/lib/scheduler/core-syllabus-pacing";
import { isSchedulableStudyBlockStatus } from "@/lib/scheduler/study-breaks";
import type { StudyBlock, SubjectId } from "@/lib/types/planner";

export interface AllocationIndexInstrumentation {
  historyTraversalPasses: number;
  historyBlockTraversals: number;
  assignedDateTraversalPasses: number;
  assignedDateTraversals: number;
  lastStudyTimestampReads: number;
  cumulativeAssignedMinutesReads: number;
}

export function createAllocationIndexInstrumentation(): AllocationIndexInstrumentation {
  return {
    historyTraversalPasses: 0,
    historyBlockTraversals: 0,
    assignedDateTraversalPasses: 0,
    assignedDateTraversals: 0,
    lastStudyTimestampReads: 0,
    cumulativeAssignedMinutesReads: 0,
  };
}

function upperBound<T>(
  values: T[],
  target: T,
  compare: (left: T, right: T) => number,
) {
  let lower = 0;
  let upper = values.length;

  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (compare(values[middle], target) <= 0) {
      lower = middle + 1;
    } else {
      upper = middle;
    }
  }

  return lower;
}

function addFenwickValue(tree: number[], index: number, minutes: number) {
  for (let cursor = index + 1; cursor < tree.length; cursor += cursor & -cursor) {
    tree[cursor] += minutes;
  }
}

function getFenwickPrefix(tree: number[], count: number) {
  let total = 0;
  for (let cursor = count; cursor > 0; cursor -= cursor & -cursor) {
    total += tree[cursor];
  }
  return total;
}

export function buildWeeklyAllocationIndexes(options: {
  studyBlocks: StudyBlock[];
  assignedMinutesByDate: CoreSyllabusAssignedMinutesByDate;
  dateKeys: string[];
  instrumentation?: AllocationIndexInstrumentation;
}) {
  const instrumentation = options.instrumentation;
  const studyEndTimestampsBySubject = new Map<SubjectId, number[]>();
  const indexedStudyBlockById = new Map<
    string,
    { subjectId: SubjectId; endTimestamp: number }
  >();
  const uniqueStudyBlocks = Array.from(
    new Map(options.studyBlocks.map((block) => [block.id, block])).values(),
  );

  if (instrumentation) {
    instrumentation.historyTraversalPasses += 1;
  }
  uniqueStudyBlocks.forEach((block) => {
    if (instrumentation) {
      instrumentation.historyBlockTraversals += 1;
    }
    if (
      !block.subjectId ||
      !isSchedulableStudyBlockStatus(block.status)
    ) {
      return;
    }

    const endTimestamp = new Date(block.end).getTime();
    if (!Number.isFinite(endTimestamp)) {
      return;
    }
    const subjectTimestamps =
      studyEndTimestampsBySubject.get(block.subjectId) ?? [];
    subjectTimestamps.push(endTimestamp);
    studyEndTimestampsBySubject.set(block.subjectId, subjectTimestamps);
    indexedStudyBlockById.set(block.id, {
      subjectId: block.subjectId,
      endTimestamp,
    });
  });
  studyEndTimestampsBySubject.forEach((timestamps) => {
    timestamps.sort((left, right) => left - right);
  });

  const dateKeys = Array.from(
    new Set([
      ...options.dateKeys,
      ...Object.keys(options.assignedMinutesByDate),
    ]),
  ).sort((left, right) => left.localeCompare(right));
  const dateIndexByKey = new Map(
    dateKeys.map((dateKey, index) => [dateKey, index]),
  );
  const assignedMinuteTreesBySubject = new Map<SubjectId, number[]>();

  function getAssignedMinuteTree(subjectId: SubjectId) {
    const existing = assignedMinuteTreesBySubject.get(subjectId);
    if (existing) {
      return existing;
    }

    const created = Array.from({ length: dateKeys.length + 1 }, () => 0);
    assignedMinuteTreesBySubject.set(subjectId, created);
    return created;
  }

  if (instrumentation) {
    instrumentation.assignedDateTraversalPasses += 1;
  }
  Object.entries(options.assignedMinutesByDate).forEach(
    ([dateKey, assignedMinutesBySubject]) => {
      if (instrumentation) {
        instrumentation.assignedDateTraversals += 1;
      }
      const dateIndex = dateIndexByKey.get(dateKey);
      if (dateIndex == null) {
        return;
      }

      Object.entries(assignedMinutesBySubject).forEach(
        ([subjectId, minutes]) => {
          addFenwickValue(
            getAssignedMinuteTree(subjectId as SubjectId),
            dateIndex,
            minutes,
          );
        },
      );
    },
  );

  return {
    getLastStudyTimestamp(subjectId: SubjectId, cutoff: Date) {
      if (instrumentation) {
        instrumentation.lastStudyTimestampReads += 1;
      }
      const timestamps = studyEndTimestampsBySubject.get(subjectId) ?? [];
      const timestampIndex =
        upperBound(timestamps, cutoff.getTime(), (left, right) => left - right) - 1;
      return timestampIndex >= 0 ? timestamps[timestampIndex] : null;
    },
    getCumulativeAssignedMinutes(subjectId: SubjectId, dateKey: string) {
      if (instrumentation) {
        instrumentation.cumulativeAssignedMinutesReads += 1;
      }
      const dateCount = upperBound(
        dateKeys,
        dateKey,
        (left, right) => left.localeCompare(right),
      );
      const tree = assignedMinuteTreesBySubject.get(subjectId);
      return tree ? getFenwickPrefix(tree, dateCount) : 0;
    },
    recordStudyBlock(block: StudyBlock) {
      const previouslyIndexed = indexedStudyBlockById.get(block.id);
      if (previouslyIndexed) {
        const previousTimestamps =
          studyEndTimestampsBySubject.get(previouslyIndexed.subjectId) ?? [];
        const previousIndex =
          upperBound(
            previousTimestamps,
            previouslyIndexed.endTimestamp,
            (left, right) => left - right,
          ) - 1;
        if (
          previousIndex >= 0 &&
          previousTimestamps[previousIndex] === previouslyIndexed.endTimestamp
        ) {
          previousTimestamps.splice(previousIndex, 1);
        }
        indexedStudyBlockById.delete(block.id);
      }

      if (
        !block.subjectId ||
        !isSchedulableStudyBlockStatus(block.status)
      ) {
        return;
      }
      const endTimestamp = new Date(block.end).getTime();
      if (!Number.isFinite(endTimestamp)) {
        return;
      }

      const timestamps = studyEndTimestampsBySubject.get(block.subjectId) ?? [];
      const insertionIndex = upperBound(
        timestamps,
        endTimestamp,
        (left, right) => left - right,
      );
      timestamps.splice(insertionIndex, 0, endTimestamp);
      studyEndTimestampsBySubject.set(block.subjectId, timestamps);
      indexedStudyBlockById.set(block.id, {
        subjectId: block.subjectId,
        endTimestamp,
      });
    },
    recordAssignedMinutes(
      subjectId: SubjectId,
      dateKey: string,
      minutes: number,
    ) {
      const dateIndex = dateIndexByKey.get(dateKey);
      if (dateIndex == null) {
        throw new Error(`Allocation date index is missing ${dateKey}.`);
      }
      addFenwickValue(
        getAssignedMinuteTree(subjectId),
        dateIndex,
        minutes,
      );
    },
  };
}
