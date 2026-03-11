import Dexie, { type Table } from "dexie";

import type {
  CompletionLog,
  FixedEvent,
  Goal,
  Preferences,
  StudyBlock,
  Subject,
  Topic,
  WeeklyPlan,
} from "@/lib/types/planner";

interface MetaRecord {
  key: string;
  value: string;
}

class PlannerDatabase extends Dexie {
  goals!: Table<Goal, string>;
  subjects!: Table<Subject, string>;
  topics!: Table<Topic, string>;
  fixedEvents!: Table<FixedEvent, string>;
  studyBlocks!: Table<StudyBlock, string>;
  completionLogs!: Table<CompletionLog, string>;
  weeklyPlans!: Table<WeeklyPlan, string>;
  preferences!: Table<Preferences, string>;
  meta!: Table<MetaRecord, string>;

  constructor() {
    super("adaptive-ib-olympiad-planner");

    this.version(1).stores({
      goals: "id, subjectId, deadline",
      subjects: "id, category",
      topics: "id, subjectId, unitId, status, reviewDue",
      fixedEvents: "id, start, end, recurrence, category",
      studyBlocks: "id, weekStart, date, subjectId, status",
      completionLogs: "id, studyBlockId, recordedAt",
      weeklyPlans: "weekStart, riskFlag",
      preferences: "id",
      meta: "key",
    });
  }
}

export const db = new PlannerDatabase();
