import type {
  blockIntensityValues,
  blockTypeValues,
  energyLevelValues,
  fixedEventCategoryValues,
  fixedEventFlexibilityValues,
  fixedEventRecurrenceValues,
  resourceTypeValues,
  riskFlagValues,
  studyBlockStatusValues,
  subjectIds,
  topicStatusValues,
} from "@/lib/constants/planner";

export type SubjectId = (typeof subjectIds)[number];
export type TopicStatus = (typeof topicStatusValues)[number];
export type StudyBlockStatus = (typeof studyBlockStatusValues)[number];
export type FixedEventCategory = (typeof fixedEventCategoryValues)[number];
export type FixedEventFlexibility = (typeof fixedEventFlexibilityValues)[number];
export type FixedEventRecurrence = (typeof fixedEventRecurrenceValues)[number];
export type BlockType = (typeof blockTypeValues)[number];
export type BlockIntensity = (typeof blockIntensityValues)[number];
export type EnergyLevel = (typeof energyLevelValues)[number];
export type RiskFlag = (typeof riskFlagValues)[number];
export type ResourceType = (typeof resourceTypeValues)[number];
export type StudyLayer = "learning" | "application" | "exam_sim" | "correction";
export type SyllabusLevel = "sl" | "hl" | "mixed";
export type SickDaySeverity = "light" | "moderate" | "severe";
export type StudyBlockCreationSource = "planner" | "manual";
export type PlannerReplanScope = "week_local" | "tail_from_week" | "full_horizon";
export type BackgroundReplanStatus = "idle" | "running" | "failed";
export type PlannerHorizonStatus = "ready" | "stale" | "missing" | "regenerating";
export type SubjectCategory =
  | "physics"
  | "maths"
  | "chemistry"
  | "olympiad"
  | "programming"
  | "english"
  | "french"
  | "geography";

export interface TopicResource {
  type: ResourceType;
  label: string;
  details: string;
}

export interface TopicSubtopicTag {
  label: string;
  syllabusLevel: SyllabusLevel;
  guideRef?: string | null;
}

export interface TopicGuideReference {
  guide: string;
  section: string;
  syllabusLevel: SyllabusLevel;
  officialTeachingHours?: number | null;
}

export interface Goal {
  id: string;
  title: string;
  subjectId: SubjectId;
  deadline: string;
  targetCompletion: number;
  priorityWeight: number;
  topicIds?: string[];
}

export interface Subject {
  id: SubjectId;
  name: string;
  shortName: string;
  category: SubjectCategory;
  description: string;
  defaultPriority: number;
  weeklyMinimumHours: number;
  examMode: "syllabus" | "maintenance" | "olympiad";
  colorToken: string;
  gradientClassName: string;
  deadline: string;
}

export interface Topic {
  id: string;
  subjectId: SubjectId;
  unitId: string;
  unitTitle: string;
  title: string;
  subtopics: string[];
  syllabusLevel?: SyllabusLevel | null;
  subtopicTags?: TopicSubtopicTag[];
  guideRefs?: TopicGuideReference[];
  guideSummary?: string | null;
  officialTeachingHours?: number | null;
  selfStudyTargetHours?: number | null;
  availableFrom?: string | null;
  dependsOnTopicId?: string | null;
  sequenceGroup?: string | null;
  sequenceStage?: "foundation" | "advanced" | null;
  minDaysAfterDependency?: number | null;
  maxDaysAfterDependency?: number | null;
  sessionMode?: "flexible" | "exam";
  exactSessionMinutes?: number | null;
  estHours: number;
  completedHours: number;
  difficulty: 1 | 2 | 3 | 4 | 5;
  status: TopicStatus;
  mastery: number;
  reviewDue: string | null;
  lastStudiedAt: string | null;
  sourceMaterials: TopicResource[];
  preferredBlockTypes: BlockType[];
  order: number;
  paperCode?: string | null;
  notes?: string;
}

export interface FixedEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  isAllDay?: boolean;
  recurrence: FixedEventRecurrence;
  daysOfWeek?: number[];
  repeatUntil?: string;
  excludedDates?: string[];
  flexibility: FixedEventFlexibility;
  category: FixedEventCategory;
  notes?: string;
}

export interface SickDay {
  id: string;
  startDate: string;
  endDate: string;
  severity: SickDaySeverity;
  notes?: string;
}

export interface FocusedDay {
  id: string;
  date: string;
  subjectIds: SubjectId[];
  notes?: string;
}

export interface NoSchoolDay {
  id: string;
  date: string;
  label: string;
  notes?: string;
}

export interface FocusedWeek {
  id: string;
  weekStart: string;
  subjectIds: SubjectId[];
  notes?: string;
}

export interface ScoreBreakdown {
  priorityWeight: number;
  deadlineUrgency: number;
  remainingWorkloadPressure: number;
  lowMasteryBonus: number;
  reviewDueBonus: number;
  neglectedSubjectBonus: number;
  olympiadSlotBonus: number;
  focusDayBonus: number;
  badSlotFitPenalty: number;
  fragmentationPenalty: number;
  total: number;
}

export interface StudyBlock {
  id: string;
  weekStart: string;
  date: string;
  start: string;
  end: string;
  subjectId: SubjectId | null;
  topicId: string | null;
  title: string;
  sessionSummary: string | null;
  paperCode: string | null;
  unitTitle: string | null;
  blockType: BlockType;
  intensity: BlockIntensity;
  generatedReason: string;
  scoreBreakdown: ScoreBreakdown;
  status: StudyBlockStatus;
  isAutoGenerated: boolean;
  creationSource: StudyBlockCreationSource;
  sourceMaterials: TopicResource[];
  slotEnergy: EnergyLevel;
  estimatedMinutes: number;
  actualMinutes: number | null;
  notes: string;
  rescheduleCount: number;
  assignmentLocked: boolean;
  assignmentEditedAt: string | null;
  studyLayer?: StudyLayer | null;
  followUpKind?: "olympiad-rewrite" | null;
  followUpSourceStudyBlockId?: string | null;
  followUpDueAt?: string | null;
}

export interface CompletionLog {
  id: string;
  studyBlockId: string;
  outcome: Exclude<StudyBlockStatus, "planned" | "rescheduled">;
  actualMinutes: number;
  perceivedDifficulty: 1 | 2 | 3 | 4 | 5;
  notes: string;
  recordedAt: string;
}

export interface WeeklyPlan {
  weekStart: string;
  requiredHoursBySubject: Record<string, number>;
  deadlinePaceHoursBySubject: Record<string, number>;
  assignedHoursBySubject: Record<string, number>;
  completedHoursBySubject: Record<string, number>;
  remainingHoursBySubject: Record<string, number>;
  remainingAfterWeekMinutesBySubject: Record<string, number>;
  weekPacingGapMinutesBySubject: Record<string, number>;
  scheduledToGoalHoursBySubject: Record<string, number>;
  weekCarryForwardSubjectIds: string[];
  slackMinutes: number;
  weekHasOpenCapacity: boolean;
  carryOverBlockIds: string[];
  feasibilityScore: number;
  riskFlag: RiskFlag;
  feasibilityWarnings: string[];
  fallbackTierUsed: number;
  forcedCoverageMinutes: number;
  usedSundayMinutes: number;
  weekOverloadMinutes: number;
  overscheduledMinutes: number;
  fillableGapDateKeys: string[];
  effectiveReservedCommitmentDurations: EffectiveReservedCommitmentDuration[];
  excludedReservedCommitmentRuleIds: string[];
  replanDiagnostics?: ReplanDiagnostics | null;
  weeksRemainingToDeadline: number;
  horizonEndDate: string;
  generatedAt: string;
}

export interface ReplanDiagnostics {
  scope: PlannerReplanScope;
  escalationPath: PlannerReplanScope[];
  totalGenerationMs: number;
  scopeTimingsMs: Partial<Record<PlannerReplanScope, number>>;
  repairTriggered: boolean;
  hardCoverageEscalationForced: boolean;
  localApplyMs?: number | null;
  precheckMs?: number | null;
  writeMs?: number | null;
  snapshotLoadMs?: number | null;
  repairMs?: number | null;
  backgroundValidationMs?: number | null;
  escalationReason?: "collapsed_coverage" | "hard_coverage" | "fillable_gap" | "overlap" | null;
}

export interface EffectiveReservedCommitmentDuration {
  dateKey: string;
  ruleId: string;
  durationMinutes: number;
}

export interface TimeWindow {
  label: string;
  start: string;
  end: string;
  days: number[];
  movable?: boolean;
  timeOverrides?: Record<string, { start: string; end: string }>;
}

export interface SchoolTerm {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
}

export interface SchoolClub {
  id: string;
  label: string;
  days: number[];
  start: string;
  end: string;
  activeTermIds?: string[];
  notes?: string;
}

export interface SchoolExam {
  id: string;
  title: string;
  date: string;
  start: string;
  end: string;
  notes?: string;
}

export interface SchoolExamPeriod {
  id: string;
  label: string;
  termId: string;
  startDate: string;
  endDate: string;
  exams: SchoolExam[];
}

export interface SchoolSchedule {
  enabled: boolean;
  weekdays: number[];
  start: string;
  end: string;
  terms: SchoolTerm[];
  noSchoolDays: NoSchoolDay[];
  schoolClubs: SchoolClub[];
  examPeriods: SchoolExamPeriod[];
}

export interface ReservedCommitmentRule {
  id: string;
  label: string;
  durationMinutes: number;
  days: number[];
  appliesDuring: "all" | "school-term" | "holiday";
  preferredStart: string;
  additionalDates?: string[];
  excludedDates?: string[];
  durationOverrides?: Record<string, number>;
  timeOverrides?: Record<string, { start: string }>;
}

export interface HolidaySchedule {
  enabled: boolean;
  dailyStudyWindow: {
    start: string;
    end: string;
  };
  preferredDeepWorkWindows: TimeWindow[];
  maxStudyHoursPerDay: number | null;
}

export interface SickDayEffectProfile {
  severity: SickDaySeverity;
  studyCapacityMultiplier: number;
  maxHeavySessionsPerDay: number;
  allowedBlockTypes?: BlockType[];
  pianoMinutesOverride: number | null;
  label: string;
  description: string;
}

export interface SundayStudySettings {
  enabled: boolean;
  workloadIntensity: number;
}

export interface Preferences {
  id: string;
  dailyStudyWindow: {
    start: string;
    end: string;
  };
  preferredDeepWorkWindows: TimeWindow[];
  lockedRecoveryWindows: TimeWindow[];
  reservedCommitmentRules: ReservedCommitmentRule[];
  maxHeavySessionsPerDay: number;
  maxStudyHoursPerDay: number;
  breaksEnabled: boolean;
  minBreakMinutes: number;
  weeklyBufferRatio: number;
  bufferMinutesBeforeFixedEvent: number;
  reserveSundayEvening: boolean;
  autoReduceBeforeExamWeeks: boolean;
  avoidLateNightHeavy: boolean;
  lateNightCutoff: string;
  subjectWeightOverrides: Record<string, number>;
  schoolSchedule: SchoolSchedule;
  holidaySchedule: HolidaySchedule;
  sundayStudy: SundayStudySettings;
}

export interface PlannerExportPayload {
  version: number;
  exportKind?: "full" | "user-data";
  exportedAt: string;
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  fixedEvents: FixedEvent[];
  sickDays: SickDay[];
  focusedDays: FocusedDay[];
  focusedWeeks: FocusedWeek[];
  studyBlocks: StudyBlock[];
  completionLogs: CompletionLog[];
  weeklyPlans: WeeklyPlan[];
  preferences: Preferences;
}

export interface TimeInterval {
  start: Date;
  end: Date;
}

export interface CalendarSlot {
  id: string;
  start: Date;
  end: Date;
  dateKey: string;
  durationMinutes: number;
  energy: EnergyLevel;
  dayIndex: number;
  scheduleRegime: "school-term" | "holiday" | "default";
  dayStudyCapMinutes: number;
  maxHeavySessionsPerDay: number;
  sickDaySeverity: SickDaySeverity | null;
  sickDayDescription: string | null;
}

export interface TaskCandidate {
  id: string;
  subjectId: SubjectId | null;
  topicId: string | null;
  title: string;
  sessionSummary: string | null;
  paperCode: string | null;
  unitTitle: string | null;
  sourceMaterials: TopicResource[];
  remainingMinutes: number;
  sessionMode: "flexible" | "exam";
  exactSessionMinutes: number | null;
  availableAt: string | null;
  latestAt: string | null;
  difficulty: 1 | 2 | 3 | 4 | 5;
  mastery: number;
  order: number;
  blockedByEarlierTopics: number;
  reviewDue: string | null;
  deadline: string;
  lastStudiedAt: string | null;
  preferredBlockTypes: BlockType[];
  intensity: BlockIntensity;
  kind: "topic" | "review" | "carry_over" | "recovery";
  studyLayer?: StudyLayer | null;
  olympiadStrand?: "geometry" | "algebra" | "number-theory" | "combinatorics" | null;
  followUpKind?: "olympiad-rewrite" | null;
  followUpSourceStudyBlockId?: string | null;
  followUpDueAt?: string | null;
}

export interface SchedulerResult {
  studyBlocks: StudyBlock[];
  weeklyPlan: WeeklyPlan;
  freeSlots: CalendarSlot[];
  unscheduledTasks: TaskCandidate[];
}

export interface SeedDataset {
  goals: Goal[];
  subjects: Subject[];
  topics: Topic[];
  fixedEvents: FixedEvent[];
  sickDays: SickDay[];
  focusedDays: FocusedDay[];
  focusedWeeks: FocusedWeek[];
  preferences: Preferences;
}

export interface HorizonRoadmapWeek {
  weekStart: string;
  weekLabel: string;
  horizonEndDate: string;
  weeksRemainingToDeadline: number;
  requiredHours: number;
  assignedHours: number;
  completedHours: number;
  remainingCoreHours: number;
  slackMinutes: number;
  weekHasOpenCapacity: boolean;
  riskFlag: RiskFlag;
  forcedCoverageMinutes: number;
  usedSundayMinutes: number;
  weekOverloadMinutes: number;
  weekCarryForwardSubjectIds: string[];
}

export interface HorizonRoadmapSummary {
  startWeek: string;
  endWeek: string;
  weeksRemaining: number;
  totalRequiredHours: number;
  totalAssignedHours: number;
  totalCompletedHours: number;
  remainingCoreHours: number;
  riskWeeks: number;
  weeks: HorizonRoadmapWeek[];
}
