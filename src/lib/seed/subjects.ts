import { format } from "date-fns";

import { getAcademicDeadline } from "@/lib/dates/helpers";
import type { Goal, Subject } from "@/lib/types/planner";

export function buildSeedSubjects(referenceDate = new Date()): Subject[] {
  const deadline = format(getAcademicDeadline(referenceDate), "yyyy-MM-dd");
  const olympiadGoldDeadline = `${referenceDate.getFullYear() + 1}-06-30`;

  return [
    {
      id: "physics-hl",
      name: "Physics HL",
      shortName: "Physics HL",
      category: "physics",
      description: "Guide-backed Physics HL coverage across themes A-E, mapped to the Pearson 2023 text for first assessment 2025.",
      defaultPriority: 1,
      weeklyMinimumHours: 7,
      examMode: "syllabus",
      colorToken: "subject-physics",
      gradientClassName: "from-subject-physics/25 via-subject-physics/10 to-transparent",
      deadline,
    },
    {
      id: "maths-aa-hl",
      name: "Maths AA HL",
      shortName: "Maths AA HL",
      category: "maths",
      description: "Full Analysis and Approaches HL coverage across Topics 1-5 using the Hodder 2019 SL and HL sequence.",
      defaultPriority: 1,
      weeklyMinimumHours: 7,
      examMode: "syllabus",
      colorToken: "subject-maths",
      gradientClassName: "from-subject-maths/25 via-subject-maths/10 to-transparent",
      deadline,
    },
    {
      id: "chemistry-hl",
      name: "Chemistry HL",
      shortName: "Chemistry HL",
      category: "chemistry",
      description: "Guide-backed Chemistry HL structure/reactivity coverage mapped to the Pearson 2023 text for first assessment 2025.",
      defaultPriority: 0.9,
      weeklyMinimumHours: 6,
      examMode: "syllabus",
      colorToken: "subject-chemistry",
      gradientClassName: "from-subject-chemistry/25 via-subject-chemistry/10 to-transparent",
      deadline,
    },
    {
      id: "olympiad",
      name: "Olympiad Prep",
      shortName: "Olympiad",
      category: "olympiad",
      description: "High-quality slots for proof-based maths and advanced problem solving.",
      defaultPriority: 0.85,
      weeklyMinimumHours: 4,
      examMode: "olympiad",
      colorToken: "subject-olympiad",
      gradientClassName: "from-subject-olympiad/25 via-subject-olympiad/10 to-transparent",
      deadline: olympiadGoldDeadline,
    },
    {
      id: "english-a-sl",
      name: "English A SL",
      shortName: "English A",
      category: "english",
      description: "Maintenance work aligned to the three Language A exploration areas in the 2021 guide.",
      defaultPriority: 0.35,
      weeklyMinimumHours: 1,
      examMode: "maintenance",
      colorToken: "subject-english",
      gradientClassName: "from-subject-english/25 via-subject-english/10 to-transparent",
      deadline,
    },
    {
      id: "french-b-sl",
      name: "French B SL",
      shortName: "French B",
      category: "french",
      description: "Low-intensity maintenance across the five prescribed Language B themes from the 2020 guide.",
      defaultPriority: 0.35,
      weeklyMinimumHours: 1,
      examMode: "maintenance",
      colorToken: "subject-french",
      gradientClassName: "from-subject-french/25 via-subject-french/10 to-transparent",
      deadline,
    },
    {
      id: "geography-transition",
      name: "Geography HL/SL Transition",
      shortName: "Geography",
      category: "geography",
      description: "Light transition reading keyed to the 2019 geography core, optional themes, and HL extension.",
      defaultPriority: 0.4,
      weeklyMinimumHours: 1,
      examMode: "maintenance",
      colorToken: "subject-geography",
      gradientClassName: "from-subject-geography/25 via-subject-geography/10 to-transparent",
      deadline,
    },
  ];
}

export function buildSeedGoals(referenceDate = new Date()): Goal[] {
  const deadline = format(getAcademicDeadline(referenceDate), "yyyy-MM-dd");
  const olympiadReadyDeadline = `${referenceDate.getFullYear()}-06-30`;
  const olympiadGoldDeadline = `${referenceDate.getFullYear() + 1}-06-30`;

  return [
    {
      id: "goal-physics-hl",
      title: "Finish all Physics HL guide topics A.1-E.5 by July 31",
      subjectId: "physics-hl",
      deadline,
      targetCompletion: 1,
      priorityWeight: 1,
    },
    {
      id: "goal-maths-aa-hl",
      title: "Finish the full Maths AA HL syllabus, including HL extension, by July 31",
      subjectId: "maths-aa-hl",
      deadline,
      targetCompletion: 1,
      priorityWeight: 1,
    },
    {
      id: "goal-chemistry-hl",
      title: "Finish all Chemistry HL structure and reactivity topics by July 31",
      subjectId: "chemistry-hl",
      deadline,
      targetCompletion: 1,
      priorityWeight: 0.9,
    },
    {
      id: "goal-olympiad-imo-ready",
      title: `Reach IMO-ready Olympiad coverage by ${olympiadReadyDeadline}`,
      subjectId: "olympiad",
      deadline: olympiadReadyDeadline,
      targetCompletion: 0.65,
      priorityWeight: 0.95,
    },
    {
      id: "goal-olympiad-gold",
      title: `Reach IMO gold-standard Olympiad depth by ${olympiadGoldDeadline}`,
      subjectId: "olympiad",
      deadline: olympiadGoldDeadline,
      targetCompletion: 1,
      priorityWeight: 0.9,
    },
  ];
}
