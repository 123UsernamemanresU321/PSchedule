export const subjectIds = [
  "physics-hl",
  "maths-aa-hl",
  "chemistry-hl",
  "olympiad",
  "cpp-book",
  "english-a-sl",
  "french-b-sl",
  "geography-transition",
] as const;

export const mainSubjectIds = [
  "physics-hl",
  "maths-aa-hl",
  "chemistry-hl",
  "olympiad",
  "cpp-book",
] as const;

export const topicStatusValues = [
  "not_started",
  "learning",
  "first_pass_done",
  "reviewed",
  "strong",
] as const;

export const topicStatusLabels: Record<(typeof topicStatusValues)[number], string> = {
  not_started: "Not started",
  learning: "Learning",
  first_pass_done: "First pass done",
  reviewed: "Reviewed",
  strong: "Strong",
};

export const studyBlockStatusValues = [
  "planned",
  "done",
  "partial",
  "missed",
  "rescheduled",
] as const;

export const studyBlockStatusLabels: Record<
  (typeof studyBlockStatusValues)[number],
  string
> = {
  planned: "Planned",
  done: "Done",
  partial: "Partial",
  missed: "Missed",
  rescheduled: "Rescheduled",
};

export const fixedEventCategoryValues = [
  "school",
  "activity",
  "lesson",
  "family",
  "assessment",
  "recovery",
  "admin",
] as const;

export const fixedEventFlexibilityValues = ["fixed", "movable", "optional"] as const;
export const fixedEventRecurrenceValues = ["none", "weekly"] as const;

export const blockTypeValues = [
  "deep_work",
  "standard_focus",
  "drill",
  "review",
  "recovery",
] as const;

export const blockTypeLabels: Record<(typeof blockTypeValues)[number], string> = {
  deep_work: "Deep Work 120",
  standard_focus: "Standard Focus 90",
  drill: "Drill 60",
  review: "Review 45",
  recovery: "Recovery 30",
};

export const blockIntensityValues = ["heavy", "moderate", "light"] as const;
export const energyLevelValues = ["prime", "steady", "low"] as const;
export const riskFlagValues = ["low", "medium", "high"] as const;

export const resourceTypeValues = [
  "textbook",
  "video",
  "worksheet",
  "past_paper",
  "notes",
] as const;

export const blockPresets = {
  deep_work: {
    label: "Deep Work 120",
    shortLabel: "Deep Work",
    intensity: "heavy",
    targetMinutes: 120,
    minMinutes: 110,
    maxMinutes: 120,
  },
  standard_focus: {
    label: "Standard Focus 90",
    shortLabel: "Focus",
    intensity: "heavy",
    targetMinutes: 90,
    minMinutes: 75,
    maxMinutes: 90,
  },
  drill: {
    label: "Drill 60",
    shortLabel: "Drill",
    intensity: "moderate",
    targetMinutes: 60,
    minMinutes: 50,
    maxMinutes: 60,
  },
  review: {
    label: "Review 45",
    shortLabel: "Review",
    intensity: "light",
    targetMinutes: 45,
    minMinutes: 40,
    maxMinutes: 45,
  },
  recovery: {
    label: "Recovery 30",
    shortLabel: "Recovery",
    intensity: "light",
    targetMinutes: 30,
    minMinutes: 20,
    maxMinutes: 30,
  },
} as const;

export const subjectPrioritySeed: Record<string, number> = {
  "maths-aa-hl": 1,
  "physics-hl": 1,
  "chemistry-hl": 0.9,
  olympiad: 0.85,
  "cpp-book": 0.45,
  "english-a-sl": 0,
  "french-b-sl": 0.15,
  "geography-transition": 0.4,
};

export const navigationItems = [
  {
    href: "/dashboard",
    label: "Dashboard",
    match: "/dashboard",
  },
  {
    href: "/calendar",
    label: "Calendar",
    match: "/calendar",
  },
  {
    href: "/subjects",
    label: "Subjects",
    match: "/subjects",
  },
  {
    href: "/weekly-review",
    label: "Weekly Review",
    match: "/weekly-review",
  },
  {
    href: "/settings",
    label: "Settings",
    match: "/settings",
  },
] as const;
