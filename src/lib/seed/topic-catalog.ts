import type {
  BlockType,
  SubjectId,
  SyllabusLevel,
  TopicGuideReference,
  TopicResource,
  TopicSubtopicTag,
} from "@/lib/types/planner";
import { toDateKey } from "@/lib/dates/helpers";
import { buildOlympiadBPlusBlueprints } from "@/lib/seed/olympiad-bplus";

export interface SeedTopicBlueprint {
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
  difficulty: 1 | 2 | 3 | 4 | 5;
  preferredBlockTypes: BlockType[];
  sourceMaterials: TopicResource[];
  notes?: string;
}

function resource(type: TopicResource["type"], label: string, details: string): TopicResource {
  return { type, label, details };
}

const guide = (label: string, details: string) => resource("notes", label, details);
const notes = (label: string, details: string) => resource("notes", label, details);
const textbook = (label: string, details: string) => resource("textbook", label, details);
const pastPaper = (label: string, details: string) => resource("past_paper", label, details);
const video = (label: string, details: string) => resource("video", label, details);
const pppChapter = (details: string) =>
  textbook("Programming: Principles and Practice Using C++ (3e)", details);

const firstPassSelfStudyTargetHours: Partial<Record<SubjectId, number>> = {
  "maths-aa-hl": 150,
  "physics-hl": 110,
  "chemistry-hl": 110,
};

const officialGuideSyllabusHours: Partial<Record<SubjectId, number>> = {
  "maths-aa-hl": 210,
  "physics-hl": 180,
  "chemistry-hl": 180,
};

const subjectGuideLabels: Partial<Record<SubjectId, string>> = {
  "maths-aa-hl": "Mathematics: Analysis and Approaches Guide 2021",
  "physics-hl": "Physics Guide 2025",
  "chemistry-hl": "Chemistry Guide 2025",
};

const firstPassFrontierTopicIds: Partial<Record<SubjectId, string>> = {
  "maths-aa-hl": "maths-topic5-maclaurin-series",
  "physics-hl": "physics-e5-fusion-stars",
  "chemistry-hl": "chem-reactivity-3-4-electron-pair-sharing",
};

// The guides expose broad official teaching-hour totals. For self-study planning,
// keep the seeded section proportions and scale them to the chosen target totals.
const physicsHlOnlyTopicIds = new Set([
  "physics-a4-rigid-body-mechanics",
  "physics-a5-relativity",
  "physics-b4-thermodynamics",
  "physics-d4-induction",
  "physics-e2-quantum-physics",
]);

function roundUpToQuarterHour(hours: number) {
  return Math.ceil(hours * 4 - 1e-9) / 4;
}

function shouldRetuneFirstPassTopic(blueprint: SeedTopicBlueprint) {
  return (
    !!firstPassSelfStudyTargetHours[blueprint.subjectId] &&
    !blueprint.unitId.includes("past-papers") &&
    blueprint.sessionMode !== "exam"
  );
}

function getResourceText(blueprint: SeedTopicBlueprint) {
  return `${blueprint.title} ${blueprint.unitTitle} ${blueprint.sourceMaterials
    .map((material) => `${material.label} ${material.details}`)
    .join(" ")}`;
}

function inferSyllabusLevel(blueprint: SeedTopicBlueprint): SyllabusLevel | null {
  const text = getResourceText(blueprint);

  if (blueprint.subjectId === "maths-aa-hl") {
    if (
      blueprint.sourceMaterials.some((material) => material.label.includes("Hodder AA HL")) ||
      blueprint.unitId.includes("past-papers")
    ) {
      return "hl";
    }

    return "sl";
  }

  if (blueprint.subjectId === "physics-hl") {
    if (physicsHlOnlyTopicIds.has(blueprint.id) || /hl-only/i.test(text)) {
      return "hl";
    }

    if (
      /\bplus HL\b|HL expectations|HL elements|HL treatment|Additional higher level|HL-linked/i.test(
        text,
      )
    ) {
      return "mixed";
    }

    return "sl";
  }

  if (blueprint.subjectId === "chemistry-hl") {
    if (/\bAHL\b/i.test(text)) {
      return "hl";
    }

    if (/Additional higher level|plus HL|HL elements/i.test(text)) {
      return "mixed";
    }

    return "sl";
  }

  return null;
}

function buildSubtopicTags(
  blueprint: SeedTopicBlueprint,
  syllabusLevel: SyllabusLevel | null,
): TopicSubtopicTag[] {
  if (!syllabusLevel) {
    return [];
  }

  return blueprint.subtopics.map((label) => ({
    label,
    syllabusLevel,
    guideRef: subjectGuideLabels[blueprint.subjectId] ?? null,
  }));
}

function buildGuideRefs(
  blueprint: SeedTopicBlueprint,
  syllabusLevel: SyllabusLevel | null,
  officialTeachingHours: number | null,
): TopicGuideReference[] {
  if (!syllabusLevel) {
    return [];
  }

  const guideMaterials = blueprint.sourceMaterials.filter((material) =>
    material.label.toLowerCase().includes("guide"),
  );
  const fallbackGuide = subjectGuideLabels[blueprint.subjectId];
  const materials = guideMaterials.length
    ? guideMaterials
    : fallbackGuide
      ? [guide(fallbackGuide, blueprint.unitTitle)]
      : [];

  return materials.map((material) => ({
    guide: material.label,
    section: material.details,
    syllabusLevel,
    officialTeachingHours,
  }));
}

function buildGuideSummary(
  blueprint: SeedTopicBlueprint,
  syllabusLevel: SyllabusLevel | null,
  officialTeachingHours: number | null,
  selfStudyTargetHours: number | null,
) {
  if (!syllabusLevel) {
    return null;
  }

  const guideDetails =
    blueprint.sourceMaterials.find((material) => material.label.toLowerCase().includes("guide"))
      ?.details ?? blueprint.unitTitle;
  const levelLabel =
    syllabusLevel === "hl" ? "HL/AHL" : syllabusLevel === "mixed" ? "Mixed SL/HL" : "SL/core";
  const hourText = selfStudyTargetHours
    ? ` Self-study target for this planner section is ${selfStudyTargetHours}h.`
    : "";
  const officialText = officialTeachingHours
    ? ` Guide-weighted official teaching estimate is ${officialTeachingHours}h.`
    : "";

  return `${levelLabel} guide context: ${guideDetails}. Focus bullets: ${blueprint.subtopics.join("; ")}.${officialText}${hourText}`;
}

function annotateAndRetuneGuideMetadata(blueprints: SeedTopicBlueprint[]) {
  const firstPassTotals = blueprints.reduce<Partial<Record<SubjectId, number>>>(
    (totals, blueprint) => {
      if (!shouldRetuneFirstPassTopic(blueprint)) {
        return totals;
      }

      totals[blueprint.subjectId] = (totals[blueprint.subjectId] ?? 0) + blueprint.estHours;
      return totals;
    },
    {},
  );

  return blueprints.map((blueprint) => {
    const shouldRetune = shouldRetuneFirstPassTopic(blueprint);
    const currentTotal = firstPassTotals[blueprint.subjectId] ?? 0;
    const targetTotal = firstPassSelfStudyTargetHours[blueprint.subjectId] ?? null;
    const officialTotal = officialGuideSyllabusHours[blueprint.subjectId] ?? null;
    const guideScale = currentTotal > 0 && targetTotal ? targetTotal / currentTotal : 1;
    const officialScale = currentTotal > 0 && officialTotal ? officialTotal / currentTotal : null;
    const nextEstHours = shouldRetune
      ? Math.max(blueprint.estHours, roundUpToQuarterHour(blueprint.estHours * guideScale))
      : blueprint.estHours;
    const syllabusLevel = inferSyllabusLevel(blueprint);
    const officialTeachingHours =
      shouldRetune && officialScale ? roundUpToQuarterHour(blueprint.estHours * officialScale) : null;
    const selfStudyTargetHours = shouldRetune ? nextEstHours : null;

    return {
      ...blueprint,
      estHours: nextEstHours,
      syllabusLevel,
      subtopicTags: buildSubtopicTags(blueprint, syllabusLevel),
      guideRefs: buildGuideRefs(blueprint, syllabusLevel, officialTeachingHours),
      guideSummary: buildGuideSummary(
        blueprint,
        syllabusLevel,
        officialTeachingHours,
        selfStudyTargetHours,
      ),
      officialTeachingHours,
      selfStudyTargetHours,
    };
  });
}
function buildRotatingPaperCycleWeeks(startDate = "2026-08-17") {
  const weeks: Array<{ label: string; availableFrom: string }> = [];
  let cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date("2027-06-28T00:00:00");
  let index = 1;

  while (cursor.getTime() <= end.getTime()) {
    weeks.push({
      label: `Week ${index}`,
      availableFrom: toDateKey(cursor),
    });
    cursor = new Date(cursor.getTime() + 7 * 24 * 60 * 60 * 1000);
    index += 1;
  }

  return weeks;
}

function buildFrenchMaintenanceBlueprints(): SeedTopicBlueprint[] {
  const sessions: SeedTopicBlueprint[] = [];
  let weekCursor = new Date("2026-03-23T00:00:00");
  const end = new Date("2027-06-29T00:00:00");
  let index = 1;

  while (weekCursor.getTime() <= end.getTime()) {
    [
      { dayOffset: 0, isGrammarSession: true },
      { dayOffset: 3, isGrammarSession: false },
    ].forEach(({ dayOffset, isGrammarSession }) => {
      const cursor = new Date(weekCursor.getTime() + dayOffset * 24 * 60 * 60 * 1000);

      if (cursor.getTime() > end.getTime()) {
        return;
      }

      sessions.push({
        id: `french-maintenance-${String(index).padStart(3, "0")}`,
        subjectId: "french-b-sl",
        unitId: "french-maintenance",
        unitTitle: "French maintenance",
        title: isGrammarSession
          ? `French grammar tune-up ${index}`
          : `French vocabulary tune-up ${index}`,
        subtopics: isGrammarSession
          ? [
              "Review one focused grammar point that keeps causing errors.",
              "Write 4-6 clean example sentences using the structure correctly.",
              "Finish with a short correction drill.",
            ]
          : [
              "Review a small high-frequency vocab set from current class material.",
              "Use the new words in short phrases or sentences.",
              "Do a quick recall pass without notes.",
            ],
        availableFrom: toDateKey(cursor),
        estHours: 0.5,
        difficulty: 2,
        preferredBlockTypes: ["drill", "review"],
        sourceMaterials: [
          guide(
            "Language B Guide 2020",
            "Keep French active through light grammar and vocabulary maintenance rather than full theme study.",
          ),
          notes(
            isGrammarSession ? "Grammar tune-up" : "Vocabulary tune-up",
            isGrammarSession
              ? "Use current error patterns from written work to choose the grammar point."
              : "Use current class vocabulary and spaced recall, not broad theme revision.",
          ),
        ],
      });

      index += 1;
    });

    weekCursor = new Date(weekCursor.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  return sessions;
}

function chainTopicSequence(
  blueprints: SeedTopicBlueprint[],
  note: string,
): SeedTopicBlueprint[] {
  let previousTopicId: string | null = null;

  return blueprints.map((blueprint) => {
    const chainedBlueprint =
      previousTopicId && !blueprint.dependsOnTopicId
        ? {
            ...blueprint,
            dependsOnTopicId: previousTopicId,
            notes: blueprint.notes ? `${blueprint.notes} ${note}` : note,
          }
        : blueprint;

    previousTopicId = blueprint.id;
    return chainedBlueprint;
  });
}

function buildRotatingPaperCycleBlueprints(): SeedTopicBlueprint[] {
  const cycle = [
    {
      subjectId: "maths-aa-hl" as const,
      unitIdPrefix: "maths-aa-past-papers",
      unitTitle: "Maths AA HL - Weekly Paper Practice",
      titlePrefix: "Maths AA HL",
      paperIdSuffix: "paper-1",
      paperLabel: "Paper 1",
      durationMinutes: 120,
      reviewDurationMinutes: 90,
      reviewBlockTypes: ["standard_focus", "review"] as BlockType[],
      sourceLabel: "Maths AA HL past paper set",
      reviewSourceLabel: "Maths AA HL past paper review",
      firstAvailableFrom: "2026-08-31",
    },
    {
      subjectId: "physics-hl" as const,
      unitIdPrefix: "physics-past-papers",
      unitTitle: "Physics HL - Weekly Paper Practice",
      titlePrefix: "Physics HL",
      paperIdSuffix: "paper-2",
      paperLabel: "Paper 2",
      durationMinutes: 150,
      reviewDurationMinutes: 120,
      reviewBlockTypes: ["deep_work", "standard_focus"] as BlockType[],
      sourceLabel: "Physics HL past paper set",
      reviewSourceLabel: "Physics HL past paper review",
      firstAvailableFrom: "2026-08-17",
    },
    {
      subjectId: "chemistry-hl" as const,
      unitIdPrefix: "chemistry-past-papers",
      unitTitle: "Chemistry HL - Weekly Paper Practice",
      titlePrefix: "Chemistry HL",
      paperIdSuffix: "paper-2",
      paperLabel: "Paper 2",
      durationMinutes: 150,
      reviewDurationMinutes: 120,
      reviewBlockTypes: ["deep_work", "standard_focus"] as BlockType[],
      sourceLabel: "Chemistry HL past paper set",
      reviewSourceLabel: "Chemistry HL past paper review",
      firstAvailableFrom: "2026-08-17",
    },
  ] as const;

  return cycle.flatMap((cycleEntry) => buildRotatingPaperCycleWeeks(cycleEntry.firstAvailableFrom).flatMap((week, index) => {
    const weekNumber = index + 1;
    const practiceTopicId = `${cycleEntry.unitIdPrefix}-week-${weekNumber}-${cycleEntry.paperIdSuffix}`;

    return [
      {
        id: practiceTopicId,
        subjectId: cycleEntry.subjectId,
        unitId: `${cycleEntry.unitIdPrefix}-week-${weekNumber}`,
        unitTitle: `${cycleEntry.unitTitle} - ${week.label}`,
        title: `${cycleEntry.titlePrefix} ${week.label} - ${cycleEntry.paperLabel}`,
        subtopics: [
          "Run this paper in one uninterrupted exam-condition sitting.",
          "Mark it immediately after completion.",
          "Log the recurring mistakes before the paired correction block.",
        ],
        availableFrom: week.availableFrom,
        dependsOnTopicId: firstPassFrontierTopicIds[cycleEntry.subjectId] ?? null,
        sessionMode: "exam",
        exactSessionMinutes: cycleEntry.durationMinutes,
        estHours: cycleEntry.durationMinutes / 60,
        difficulty: 4,
        preferredBlockTypes: ["deep_work"],
        sourceMaterials: [
          pastPaper(
            cycleEntry.sourceLabel,
            `${week.label} ${cycleEntry.paperLabel} under full timed conditions.`,
          ),
          notes(
            "Paper protocol",
            "Keep full timing, full working, and immediate marking. This is the weekly anchor exam simulation.",
          ),
        ],
      },
      {
        id: `${practiceTopicId}-review`,
        subjectId: cycleEntry.subjectId,
        unitId: `${cycleEntry.unitIdPrefix}-week-${weekNumber}`,
        unitTitle: `${cycleEntry.unitTitle} - ${week.label}`,
        title: `${cycleEntry.titlePrefix} ${week.label} - ${cycleEntry.paperLabel} review`,
        subtopics: [
          `Deep-correct the ${cycleEntry.paperLabel} attempt the same weekend.`,
          "Classify each miss by concept, algebra, timing, or misread.",
          "Rewrite the highest-value corrections cleanly and update the error log.",
        ],
        availableFrom: week.availableFrom,
        dependsOnTopicId: practiceTopicId,
        minDaysAfterDependency: 0,
        maxDaysAfterDependency: 7,
        estHours: cycleEntry.reviewDurationMinutes / 60,
        difficulty: 3,
        preferredBlockTypes: cycleEntry.reviewBlockTypes,
        sourceMaterials: [
          notes(
            "Paper-review protocol",
            "Use this block for deep correction, not a superficial re-mark. Rewrite the decisive fixes the same weekend.",
          ),
          pastPaper(
            cycleEntry.reviewSourceLabel,
            `${week.label} ${cycleEntry.paperLabel} review and correction session.`,
          ),
        ],
      },
    ];
  }));
}

export const legacySeedTopicIds = [
  "phys-measurements",
  "phys-mechanics",
  "phys-waves",
  "phys-thermal",
  "phys-circuits",
  "phys-fields",
  "phys-emi",
  "phys-atomic",
  "math-functions",
  "math-sequences",
  "math-complex",
  "math-vectors",
  "math-diff-applications",
  "math-integral-parts",
  "math-probability",
  "math-differential-equations",
  "chem-stoich",
  "chem-bonding",
  "chem-energetics",
  "chem-kinetics",
  "chem-equilibrium",
  "chem-acids",
  "chem-redox",
  "chem-organic",
  "oly-geometry",
  "oly-number-theory",
  "oly-combinatorics",
  "oly-inequalities",
  "oly-functional",
  "oly-mock-review",
  "eng-maintenance",
  "fr-maintenance",
  "geo-maintenance",
] as const;

export function hasLegacySeedTopics(topics: Array<{ id: string }>) {
  return topics.some((topic) =>
    legacySeedTopicIds.includes(topic.id as (typeof legacySeedTopicIds)[number]),
  );
}

const physicsTopicBlueprints: SeedTopicBlueprint[] = chainTopicSequence([
  {
    id: "physics-a1-kinematics",
    subjectId: "physics-hl",
    unitId: "physics-theme-a",
    unitTitle: "Theme A - Space, time and motion",
    title: "A.1 Kinematics",
    subtopics: ["Displacement and velocity", "Acceleration models", "Motion graphs"],
    estHours: 4,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic A.1 checklist and guiding question."),
      textbook("Pearson Physics HL 2023", "A.1 Kinematics."),
    ],
  },
  {
    id: "physics-a2-forces-momentum",
    subjectId: "physics-hl",
    unitId: "physics-theme-a",
    unitTitle: "Theme A - Space, time and motion",
    title: "A.2 Forces and momentum",
    subtopics: ["Newton's laws", "Momentum and impulse", "Circular motion"],
    estHours: 5,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic A.2 plus HL expectations."),
      textbook("Pearson Physics HL 2023", "A.2 Forces and momentum."),
      pastPaper("IB-style mechanics set", "Target free-body, impulse, and circular motion questions."),
    ],
  },
  {
    id: "physics-a3-work-energy-power",
    subjectId: "physics-hl",
    unitId: "physics-theme-a",
    unitTitle: "Theme A - Space, time and motion",
    title: "A.3 Work, energy and power",
    subtopics: ["Work-energy theorem", "Power and efficiency", "Energy transfer models"],
    estHours: 4,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic A.3 understandings."),
      textbook("Pearson Physics HL 2023", "A.3 Work, energy and power."),
    ],
  },
  {
    id: "physics-a4-rigid-body-mechanics",
    subjectId: "physics-hl",
    unitId: "physics-theme-a",
    unitTitle: "Theme A - Space, time and motion",
    title: "A.4 Rigid body mechanics",
    subtopics: ["Torque", "Angular momentum", "Rotational equilibrium"],
    estHours: 4.5,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Physics Guide 2025", "HL-only topic A.4."),
      textbook("Pearson Physics HL 2023", "A.4 Rigid body mechanics."),
    ],
  },
  {
    id: "physics-a5-relativity",
    subjectId: "physics-hl",
    unitId: "physics-theme-a",
    unitTitle: "Theme A - Space, time and motion",
    title: "A.5 Galilean and special relativity",
    subtopics: ["Frames of reference", "Time dilation", "Length contraction"],
    estHours: 5,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Physics Guide 2025", "HL-only topic A.5."),
      textbook("Pearson Physics HL 2023", "A.5 Galilean and special relativity."),
      video("Relativity concept pass", "Short visualization before doing derivations."),
    ],
  },
  {
    id: "physics-b1-thermal-transfers",
    subjectId: "physics-hl",
    unitId: "physics-theme-b",
    unitTitle: "Theme B - The particulate nature of matter",
    title: "B.1 Thermal energy transfers",
    subtopics: ["Specific heat capacity", "Latent heat", "Conduction, convection, radiation"],
    estHours: 4,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic B.1 core coverage."),
      textbook("Pearson Physics HL 2023", "B.1 Thermal energy transfers."),
    ],
  },
  {
    id: "physics-b2-greenhouse-effect",
    subjectId: "physics-hl",
    unitId: "physics-theme-b",
    unitTitle: "Theme B - The particulate nature of matter",
    title: "B.2 Greenhouse effect",
    subtopics: ["Radiative balance", "Absorption and re-emission", "Climate model reasoning"],
    estHours: 2.5,
    difficulty: 2,
    preferredBlockTypes: ["review", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic B.2 applications."),
      textbook("Pearson Physics HL 2023", "B.2 Greenhouse effect."),
    ],
  },
  {
    id: "physics-b3-gas-laws",
    subjectId: "physics-hl",
    unitId: "physics-theme-b",
    unitTitle: "Theme B - The particulate nature of matter",
    title: "B.3 Gas laws",
    subtopics: ["Ideal gas equation", "Kinetic model", "Pressure-volume-temperature relationships"],
    estHours: 3,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic B.3 checklist."),
      textbook("Pearson Physics HL 2023", "B.3 Gas laws."),
    ],
  },
  {
    id: "physics-b4-thermodynamics",
    subjectId: "physics-hl",
    unitId: "physics-theme-b",
    unitTitle: "Theme B - The particulate nature of matter",
    title: "B.4 Thermodynamics",
    subtopics: ["Internal energy", "First law", "Entropy and engines"],
    estHours: 4.5,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Physics Guide 2025", "HL-only topic B.4."),
      textbook("Pearson Physics HL 2023", "B.4 Thermodynamics."),
    ],
  },
  {
    id: "physics-b5-current-circuits",
    subjectId: "physics-hl",
    unitId: "physics-theme-b",
    unitTitle: "Theme B - The particulate nature of matter",
    title: "B.5 Current and circuits",
    subtopics: ["Charge and current", "Resistance and internal resistance", "Kirchhoff reasoning"],
    estHours: 5,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic B.5 core and HL-linked problem solving."),
      textbook("Pearson Physics HL 2023", "B.5 Current and circuits."),
      pastPaper("Circuit analysis pack", "Mixed Paper 1 and Paper 2 circuit questions."),
    ],
  },
  {
    id: "physics-c1-shm",
    subjectId: "physics-hl",
    unitId: "physics-theme-c",
    unitTitle: "Theme C - Wave behaviour",
    title: "C.1 Simple harmonic motion",
    subtopics: ["Oscillation variables", "Energy in SHM", "Pendulums and springs"],
    estHours: 3.5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic C.1 plus HL treatment."),
      textbook("Pearson Physics HL 2023", "C.1 Simple harmonic motion."),
    ],
  },
  {
    id: "physics-c2-wave-model",
    subjectId: "physics-hl",
    unitId: "physics-theme-c",
    unitTitle: "Theme C - Wave behaviour",
    title: "C.2 Wave model",
    subtopics: ["Wavefronts", "Wave speed relationships", "Superposition basics"],
    estHours: 4,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic C.2 coverage."),
      textbook("Pearson Physics HL 2023", "C.2 Wave model."),
    ],
  },
  {
    id: "physics-c3-wave-phenomena",
    subjectId: "physics-hl",
    unitId: "physics-theme-c",
    unitTitle: "Theme C - Wave behaviour",
    title: "C.3 Wave phenomena",
    subtopics: ["Interference", "Diffraction", "Polarization"],
    estHours: 4.5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic C.3 plus HL elements."),
      textbook("Pearson Physics HL 2023", "C.3 Wave phenomena."),
    ],
  },
  {
    id: "physics-c4-standing-waves",
    subjectId: "physics-hl",
    unitId: "physics-theme-c",
    unitTitle: "Theme C - Wave behaviour",
    title: "C.4 Standing waves and resonance",
    subtopics: ["Nodes and antinodes", "Harmonics", "Resonance conditions"],
    estHours: 3,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic C.4 core content."),
      textbook("Pearson Physics HL 2023", "C.4 Standing waves and resonance."),
    ],
  },
  {
    id: "physics-c5-doppler-effect",
    subjectId: "physics-hl",
    unitId: "physics-theme-c",
    unitTitle: "Theme C - Wave behaviour",
    title: "C.5 Doppler effect",
    subtopics: ["Source-observer motion", "Frequency shifts", "Applications"],
    estHours: 3,
    difficulty: 3,
    preferredBlockTypes: ["review", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic C.5 plus HL extension."),
      textbook("Pearson Physics HL 2023", "C.5 Doppler effect."),
    ],
  },
  {
    id: "physics-d1-gravitational-fields",
    subjectId: "physics-hl",
    unitId: "physics-theme-d",
    unitTitle: "Theme D - Fields",
    title: "D.1 Gravitational fields",
    subtopics: ["Field strength", "Potential", "Orbital motion"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic D.1 plus HL components."),
      textbook("Pearson Physics HL 2023", "D.1 Gravitational fields."),
    ],
  },
  {
    id: "physics-d2-electric-magnetic-fields",
    subjectId: "physics-hl",
    unitId: "physics-theme-d",
    unitTitle: "Theme D - Fields",
    title: "D.2 Electric and magnetic fields",
    subtopics: ["Electric field strength", "Magnetic flux density", "Field mapping"],
    estHours: 5,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic D.2 plus HL content."),
      textbook("Pearson Physics HL 2023", "D.2 Electric and magnetic fields."),
    ],
  },
  {
    id: "physics-d3-motion-em-fields",
    subjectId: "physics-hl",
    unitId: "physics-theme-d",
    unitTitle: "Theme D - Fields",
    title: "D.3 Motion in electromagnetic fields",
    subtopics: ["Charged particles", "Electric acceleration", "Magnetic circular motion"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic D.3 core content."),
      textbook("Pearson Physics HL 2023", "D.3 Motion in electromagnetic fields."),
    ],
  },
  {
    id: "physics-d4-induction",
    subjectId: "physics-hl",
    unitId: "physics-theme-d",
    unitTitle: "Theme D - Fields",
    title: "D.4 Induction",
    subtopics: ["Magnetic flux", "Faraday and Lenz laws", "Generators and transformers"],
    estHours: 4.5,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Physics Guide 2025", "HL-only topic D.4."),
      textbook("Pearson Physics HL 2023", "D.4 Induction."),
    ],
  },
  {
    id: "physics-e1-structure-atom",
    subjectId: "physics-hl",
    unitId: "physics-theme-e",
    unitTitle: "Theme E - Nuclear and quantum physics",
    title: "E.1 Structure of the atom",
    subtopics: ["Atomic models", "Spectra", "Nuclear notation"],
    estHours: 3.5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic E.1 plus HL elements."),
      textbook("Pearson Physics HL 2023", "E.1 Structure of the atom."),
    ],
  },
  {
    id: "physics-e2-quantum-physics",
    subjectId: "physics-hl",
    unitId: "physics-theme-e",
    unitTitle: "Theme E - Nuclear and quantum physics",
    title: "E.2 Quantum physics",
    subtopics: ["Photons", "Wave-particle duality", "Photoelectric effect"],
    estHours: 4.5,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Physics Guide 2025", "HL-only topic E.2."),
      textbook("Pearson Physics HL 2023", "E.2 Quantum physics."),
    ],
  },
  {
    id: "physics-e3-radioactive-decay",
    subjectId: "physics-hl",
    unitId: "physics-theme-e",
    unitTitle: "Theme E - Nuclear and quantum physics",
    title: "E.3 Radioactive decay",
    subtopics: ["Decay modes", "Half-life", "Activity and decay equations"],
    estHours: 3.5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic E.3 plus HL details."),
      textbook("Pearson Physics HL 2023", "E.3 Radioactive decay."),
    ],
  },
  {
    id: "physics-e4-fission",
    subjectId: "physics-hl",
    unitId: "physics-theme-e",
    unitTitle: "Theme E - Nuclear and quantum physics",
    title: "E.4 Fission",
    subtopics: ["Binding energy", "Chain reactions", "Reactor concepts"],
    estHours: 2.5,
    difficulty: 3,
    preferredBlockTypes: ["review", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic E.4 core coverage."),
      textbook("Pearson Physics HL 2023", "E.4 Fission."),
    ],
  },
  {
    id: "physics-e5-fusion-stars",
    subjectId: "physics-hl",
    unitId: "physics-theme-e",
    unitTitle: "Theme E - Nuclear and quantum physics",
    title: "E.5 Fusion and stars",
    subtopics: ["Fusion reactions", "Stellar energy", "Life cycle of stars"],
    estHours: 2.5,
    difficulty: 3,
    preferredBlockTypes: ["review", "drill"],
    sourceMaterials: [
      guide("Physics Guide 2025", "Topic E.5 core coverage."),
      textbook("Pearson Physics HL 2023", "E.5 Fusion and stars."),
    ],
  },
], "Follow the seeded Physics HL syllabus order strictly before moving to the next topic.");

const MATHS_SL_BOOK_FINISH_TOPIC_ID = "maths-topic5-aa-integration";

const mathsSlBookTopicBlueprints: SeedTopicBlueprint[] = chainTopicSequence([
  {
    id: "maths-topic1-exponents-logs",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-1",
    unitTitle: "Topic 1 - Number and algebra",
    title: "Core exponents and logarithms",
    subtopics: ["Laws of exponents", "Scientific notation", "Basic logarithms"],
    estHours: 3,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 1 foundations in number and algebra."),
      textbook("Hodder AA SL 2019", "Ch. 1 Core exponents and logarithms."),
    ],
  },
  {
    id: "maths-topic1-sequences-series",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-1",
    unitTitle: "Topic 1 - Number and algebra",
    title: "Core sequences and series",
    subtopics: ["Arithmetic sequences", "Geometric series", "Sigma notation basics"],
    estHours: 3.5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 1 sequence and series coverage."),
      textbook("Hodder AA SL 2019", "Ch. 2 Core sequences."),
    ],
  },
  {
    id: "maths-topic2-functions-core",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-2",
    unitTitle: "Topic 2 - Functions",
    title: "Core functions and inverse reasoning",
    subtopics: ["Function concept", "Sketching graphs", "Composite and inverse functions"],
    estHours: 5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 2 function notation and behaviour."),
      textbook("Hodder AA SL 2019", "Ch. 3 Core functions."),
    ],
  },
  {
    id: "maths-topic3-coordinate-geometry",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-3",
    unitTitle: "Topic 3 - Geometry and trigonometry",
    title: "Coordinate geometry",
    subtopics: ["Lines in 2D", "Distance and midpoint", "3D coordinate geometry basics"],
    estHours: 5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 3 coordinate geometry."),
      textbook("Hodder AA SL 2019", "Ch. 4 Coordinate geometry."),
    ],
  },
  {
    id: "maths-topic3-trigonometry",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-3",
    unitTitle: "Topic 3 - Geometry and trigonometry",
    title: "Core geometry and trigonometry",
    subtopics: ["Trigonometric ratios", "Identities and equations", "Applications to geometry"],
    estHours: 2.5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 3 trigonometry and geometry."),
      textbook("Hodder AA SL 2019", "Ch. 5 Core geometry and trigonometry."),
    ],
  },
  {
    id: "maths-topic4-statistics",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-4",
    unitTitle: "Topic 4 - Statistics and probability",
    title: "Core statistics and data representation",
    subtopics: ["Sampling", "Summary statistics", "Correlation and regression"],
    estHours: 3,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 4 descriptive statistics."),
      textbook("Hodder AA SL 2019", "Ch. 6 Statistics."),
    ],
  },
  {
    id: "maths-topic4-probability-distributions",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-4",
    unitTitle: "Topic 4 - Statistics and probability",
    title: "Core probability techniques and distributions",
    subtopics: ["Conditional probability", "Discrete random variables", "Binomial and normal distributions"],
    estHours: 6,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 4 probability foundation."),
      textbook("Hodder AA SL 2019", "Ch. 7 Probability; Ch. 8 Probability distributions."),
    ],
  },
  {
    id: "maths-topic5-differentiation-core",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-5",
    unitTitle: "Topic 5 - Calculus",
    title: "Core differentiation",
    subtopics: ["Limits", "Derivative rules", "Tangents and normals"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 5 introductory calculus."),
      textbook("Hodder AA SL 2019", "Ch. 9 Core differentiation."),
    ],
  },
  {
    id: "maths-topic5-integration-core",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-5",
    unitTitle: "Topic 5 - Calculus",
    title: "Core integration",
    subtopics: ["Anti-differentiation", "Definite integrals", "Area under curves"],
    estHours: 3,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 5 integrals and accumulation."),
      textbook("Hodder AA SL 2019", "Ch. 10 Core integration."),
    ],
  },
  {
    id: "maths-topic1-proof",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-1",
    unitTitle: "Topic 1 - Number and algebra",
    title: "Mathematical proof",
    subtopics: ["Structure of proof", "Induction", "Contradiction and counterexample"],
    estHours: 3,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "Proof expectations appear across Topics 1 to 5."),
      textbook("Hodder AA SL 2019", "Ch. 11 Proof."),
    ],
  },
  {
    id: "maths-topic1-aa-logarithms",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-1",
    unitTitle: "Topic 1 - Number and algebra",
    title: "AA logarithms and modelling",
    subtopics: ["Logarithmic laws", "Exponential and logarithmic models", "Parameter effects"],
    estHours: 2,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 1 AA logarithmic modelling."),
      textbook("Hodder AA SL 2019", "Ch. 12 AA logarithms."),
    ],
  },
  {
    id: "maths-topic1-aa-sequences-series",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-1",
    unitTitle: "Topic 1 - Number and algebra",
    title: "AA sequences and series",
    subtopics: ["Sigma notation", "Series expansion patterns", "Proof and recurrence links"],
    estHours: 2.5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 1 AA sequence and series extension."),
      textbook("Hodder AA SL 2019", "Ch. 13 AA sequences and series."),
    ],
  },
  {
    id: "maths-topic2-aa-functions",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-2",
    unitTitle: "Topic 2 - Functions",
    title: "AA functions and inverse models",
    subtopics: ["Domain and range analysis", "Composite functions", "Inverse-function models"],
    estHours: 2,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 2 AA function extension."),
      textbook("Hodder AA SL 2019", "Ch. 14 AA functions."),
    ],
  },
  {
    id: "maths-topic2-graphs-models",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-2",
    unitTitle: "Topic 2 - Functions",
    title: "Graphs, transformations, and equation solving",
    subtopics: ["Transformations", "Rational and exponential models", "Analytical and graphical solutions"],
    estHours: 6,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 2 graphs and equations."),
      textbook("Hodder AA SL 2019", "Ch. 16 Graphs; Ch. 17 Equations."),
    ],
  },
  {
    id: "maths-topic3-aa-trigonometry",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-3",
    unitTitle: "Topic 3 - Geometry and trigonometry",
    title: "AA trigonometric modelling",
    subtopics: ["Further identities", "Circular functions", "Extended equation solving"],
    estHours: 1.5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 3 AA trigonometry extension."),
      textbook("Hodder AA SL 2019", "Ch. 18 AA trigonometry."),
    ],
  },
  {
    id: "maths-topic4-aa-statistics",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-4",
    unitTitle: "Topic 4 - Statistics and probability",
    title: "AA statistics and regression",
    subtopics: ["Regression diagnostics", "Interpreting spread", "Data-model comparison"],
    estHours: 2,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 4 AA statistics extension."),
      textbook("Hodder AA SL 2019", "Ch. 19 AA statistics."),
    ],
  },
  {
    id: "maths-topic5-aa-differentiation",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-5",
    unitTitle: "Topic 5 - Calculus",
    title: "AA differentiation applications",
    subtopics: ["Curve sketching", "Optimization", "Related rates"],
    estHours: 2,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 5 AA differentiation extension."),
      textbook("Hodder AA SL 2019", "Ch. 20 AA differentiation."),
    ],
  },
  {
    id: "maths-topic5-aa-integration",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-5",
    unitTitle: "Topic 5 - Calculus",
    title: "AA integration applications",
    subtopics: ["Area and accumulation", "Differential-model links", "Extended integral applications"],
    estHours: 2,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 5 AA integration extension."),
      textbook("Hodder AA SL 2019", "Ch. 21 AA integration."),
    ],
  },
], "Follow the Hodder AA SL book chapter order strictly before moving to the next chapter.");

const mathsHlBookTopicBlueprints: SeedTopicBlueprint[] = chainTopicSequence([
  {
    id: "maths-topic1-counting-binomial",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-1",
    unitTitle: "Topic 1 - Number and algebra",
    title: "Counting principles and binomial theorem",
    subtopics: ["Permutations and combinations", "Binomial coefficients", "Counting strategies"],
    estHours: 5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "HL Topic 1 extension."),
      textbook("Hodder AA HL 2019", "Ch. 1 Counting principles."),
    ],
  },
  {
    id: "maths-topic1-algebra-partial-fractions",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-1",
    unitTitle: "Topic 1 - Number and algebra",
    title: "Algebra, systems, and partial fractions",
    subtopics: ["Systems of equations", "Partial fractions", "Algebraic manipulation"],
    estHours: 6,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "HL Topic 1 algebraic manipulation."),
      textbook("Hodder AA HL 2019", "Ch. 2 Algebra."),
    ],
  },
  {
    id: "maths-topic3-hl-trigonometry-extension",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-3",
    unitTitle: "Topic 3 - Geometry and trigonometry",
    title: "HL trigonometric extension",
    subtopics: ["Advanced identities", "Further trigonometric equations", "Extended geometric applications"],
    estHours: 2,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "HL Topic 3 trigonometric extension."),
      textbook("Hodder AA HL 2019", "Ch. 3 Trigonometry."),
    ],
  },
  {
    id: "maths-topic1-complex-numbers",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-1",
    unitTitle: "Topic 1 - Number and algebra",
    title: "Complex numbers",
    subtopics: ["Cartesian and polar form", "De Moivre's theorem", "Roots of complex numbers"],
    estHours: 7,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "HL Topic 1 complex-number extension."),
      textbook("Hodder AA HL 2019", "Ch. 4 Complex numbers."),
    ],
  },
  {
    id: "maths-topic1-hl-proof-extension",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-1",
    unitTitle: "Topic 1 - Number and algebra",
    title: "HL proof extension",
    subtopics: ["Refining proof structure", "Formal induction", "Proof under exam conditions"],
    estHours: 2,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "HL proof demands across the AA HL course."),
      textbook("Hodder AA HL 2019", "Ch. 5 Mathematical proof."),
    ],
  },
  {
    id: "maths-topic2-polynomials",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-2",
    unitTitle: "Topic 2 - Functions",
    title: "Polynomials and rational functions",
    subtopics: ["Polynomial graphs", "Factor and remainder theorems", "Root relationships"],
    estHours: 5,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 2 HL polynomial behaviour."),
      textbook("Hodder AA HL 2019", "Ch. 6 Polynomials; Ch. 7 Functions."),
    ],
  },
  {
    id: "maths-topic3-vectors",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-3",
    unitTitle: "Topic 3 - Geometry and trigonometry",
    title: "Vectors and 3D geometry",
    subtopics: ["Vector equations", "Lines and planes", "Angles and intersections"],
    estHours: 8,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 3 HL vector extension."),
      textbook("Hodder AA HL 2019", "Ch. 8 Vectors."),
    ],
  },
  {
    id: "maths-topic4-advanced-probability",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-4",
    unitTitle: "Topic 4 - Statistics and probability",
    title: "Advanced probability models",
    subtopics: ["Bayes' theorem", "Variance of random variables", "Continuous random variables"],
    estHours: 5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 4 HL probability extension."),
      textbook("Hodder AA HL 2019", "Ch. 9 Probability."),
    ],
  },
  {
    id: "maths-topic5-advanced-differentiation",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-5",
    unitTitle: "Topic 5 - Calculus",
    title: "Advanced differentiation and applications",
    subtopics: ["L'Hopital's rule", "Implicit differentiation", "Optimization and related rates"],
    estHours: 9,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 5 HL calculus extension."),
      textbook("Hodder AA HL 2019", "Ch. 10A-10F Further calculus."),
    ],
  },
  {
    id: "maths-topic5-advanced-integration",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-5",
    unitTitle: "Topic 5 - Calculus",
    title: "Advanced integration techniques",
    subtopics: ["Substitution", "Integration by parts", "Further geometric interpretation"],
    estHours: 8,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 5 HL integration methods."),
      textbook("Hodder AA HL 2019", "Ch. 10G-10I Further calculus."),
    ],
  },
  {
    id: "maths-topic5-differential-equations",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-5",
    unitTitle: "Topic 5 - Calculus",
    title: "Differential equations",
    subtopics: ["Euler's method", "Separating variables", "Integrating factors"],
    estHours: 8,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 5 HL differential-equation modelling."),
      textbook("Hodder AA HL 2019", "Ch. 11A-11C Series and differential equations."),
    ],
  },
  {
    id: "maths-topic5-maclaurin-series",
    subjectId: "maths-aa-hl",
    unitId: "maths-topic-5",
    unitTitle: "Topic 5 - Calculus",
    title: "Maclaurin series",
    subtopics: ["Series expansion", "Approximation", "Series-based differential-equation methods"],
    estHours: 6,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("AA Guide 2021", "Topic 5 HL series expansion."),
      textbook("Hodder AA HL 2019", "Ch. 11D-11E Series and differential equations."),
    ],
  },
], "Follow the Hodder AA HL book chapter order strictly after finishing the SL book.");

const mathsTopicBlueprints: SeedTopicBlueprint[] = [
  ...mathsSlBookTopicBlueprints,
  ...mathsHlBookTopicBlueprints.map((blueprint, index) => {
    if (index !== 0) {
      return blueprint;
    }

    const bridgeNote =
      "Finish the full Hodder AA SL book sequence before starting the Hodder AA HL book.";
    return {
      ...blueprint,
      dependsOnTopicId: MATHS_SL_BOOK_FINISH_TOPIC_ID,
      notes: blueprint.notes ? `${blueprint.notes} ${bridgeNote}` : bridgeNote,
    };
  }),
];

const chemistryTopicBlueprints: SeedTopicBlueprint[] = chainTopicSequence([
  {
    id: "chem-structure-1-1-particulate",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-1",
    unitTitle: "Structure 1 - Models of the particulate nature of matter",
    title: "Structure 1.1 - Introduction to the particulate nature of matter",
    subtopics: ["States of matter", "Kinetic molecular theory", "Changes of state"],
    estHours: 3,
    difficulty: 2,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 1.1."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 1.1."),
    ],
  },
  {
    id: "chem-structure-1-2-nuclear-atom",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-1",
    unitTitle: "Structure 1 - Models of the particulate nature of matter",
    title: "Structure 1.2 - The nuclear atom",
    subtopics: ["Subatomic particles", "Isotopes", "Mass spectrometry"],
    estHours: 3.5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 1.2."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 1.2."),
    ],
  },
  {
    id: "chem-structure-1-3-electron-configurations",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-1",
    unitTitle: "Structure 1 - Models of the particulate nature of matter",
    title: "Structure 1.3 - Electron configurations",
    subtopics: ["Emission spectra", "Orbitals and shells", "Ionization-energy links"],
    estHours: 4.5,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 1.3."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 1.3."),
    ],
  },
  {
    id: "chem-structure-1-4-mole",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-1",
    unitTitle: "Structure 1 - Models of the particulate nature of matter",
    title: "Structure 1.4 - Counting particles by mass: The mole",
    subtopics: ["Amount of substance", "Empirical and molecular formulae", "Concentration"],
    estHours: 4,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 1.4."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 1.4."),
    ],
  },
  {
    id: "chem-structure-1-5-ideal-gases",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-1",
    unitTitle: "Structure 1 - Models of the particulate nature of matter",
    title: "Structure 1.5 - Ideal gases",
    subtopics: ["Ideal gas model", "Molar volume", "Ideal gas equation"],
    estHours: 3.5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 1.5."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 1.5."),
    ],
  },
  {
    id: "chem-reactivity-1-1-enthalpy",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-1",
    unitTitle: "Reactivity 1 - What drives chemical reactions?",
    title: "Reactivity 1.1 - Measuring enthalpy changes",
    subtopics: ["Calorimetry", "Standard enthalpy changes", "Combustion and neutralization"],
    estHours: 3.5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Reactivity 1.1."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 1.1."),
    ],
  },
  {
    id: "chem-reactivity-1-2-energy-cycles",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-1",
    unitTitle: "Reactivity 1 - What drives chemical reactions?",
    title: "Reactivity 1.2 - Energy cycles in reactions",
    subtopics: ["Hess's law", "Bond enthalpies", "Lattice and hydration cycles"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Reactivity 1.2."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 1.2."),
    ],
  },
  {
    id: "chem-reactivity-1-3-fuels",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-1",
    unitTitle: "Reactivity 1 - What drives chemical reactions?",
    title: "Reactivity 1.3 - Energy from fuels",
    subtopics: ["Combustion", "Energy density", "Fuel cells and environmental tradeoffs"],
    estHours: 3,
    difficulty: 3,
    preferredBlockTypes: ["review", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Reactivity 1.3."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 1.3."),
    ],
  },
  {
    id: "chem-reactivity-1-4-entropy",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-1",
    unitTitle: "Reactivity 1 - What drives chemical reactions?",
    title: "Reactivity 1.4 - Entropy and spontaneity",
    subtopics: ["Entropy change", "Gibbs energy", "Spontaneous processes"],
    estHours: 4.5,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "AHL Reactivity 1.4."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 1.4."),
    ],
  },
  {
    id: "chem-structure-2-1-ionic",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-2",
    unitTitle: "Structure 2 - Models of bonding and structure",
    title: "Structure 2.1 - The ionic model",
    subtopics: ["Ion formation", "Ionic bonding", "Lattice structures"],
    estHours: 4,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 2.1."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 2.1."),
    ],
  },
  {
    id: "chem-structure-2-2-covalent",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-2",
    unitTitle: "Structure 2 - Models of bonding and structure",
    title: "Structure 2.2 - The covalent model",
    subtopics: ["VSEPR", "Polarity and intermolecular forces", "Hybridization and resonance"],
    estHours: 6,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 2.2."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 2.2."),
    ],
  },
  {
    id: "chem-structure-2-3-metallic",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-2",
    unitTitle: "Structure 2 - Models of bonding and structure",
    title: "Structure 2.3 - The metallic model",
    subtopics: ["Metallic bonding", "Alloys", "Conductivity and structure-property links"],
    estHours: 3,
    difficulty: 3,
    preferredBlockTypes: ["review", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 2.3."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 2.3."),
    ],
  },
  {
    id: "chem-structure-2-4-materials",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-2",
    unitTitle: "Structure 2 - Models of bonding and structure",
    title: "Structure 2.4 - From models to materials",
    subtopics: ["Material properties", "Networks and solids", "Linking models to applications"],
    estHours: 4,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 2.4."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 2.4."),
    ],
  },
  {
    id: "chem-reactivity-2-1-amount-change",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-2",
    unitTitle: "Reactivity 2 - How much, how fast and how far?",
    title: "Reactivity 2.1 - How much? The amount of chemical change",
    subtopics: ["Stoichiometric calculations", "Limiting reagents", "Yield and atom economy"],
    estHours: 4,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Reactivity 2.1."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 2.1."),
    ],
  },
  {
    id: "chem-reactivity-2-2-rate",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-2",
    unitTitle: "Reactivity 2 - How much, how fast and how far?",
    title: "Reactivity 2.2 - How fast? The rate of chemical change",
    subtopics: ["Collision theory", "Rate laws", "Catalysis and activation energy"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Reactivity 2.2."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 2.2."),
    ],
  },
  {
    id: "chem-reactivity-2-3-extent",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-2",
    unitTitle: "Reactivity 2 - How much, how fast and how far?",
    title: "Reactivity 2.3 - How far? The extent of chemical change",
    subtopics: ["Equilibrium constants", "Le Chatelier's principle", "Buffer and equilibrium systems"],
    estHours: 4.5,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Reactivity 2.3."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 2.3."),
    ],
  },
  {
    id: "chem-structure-3-1-periodic-table",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-3",
    unitTitle: "Structure 3 - Classification of matter",
    title: "Structure 3.1 - The periodic table: Classification of elements",
    subtopics: ["Periodic trends", "Ionization-energy patterns", "Classification of elements"],
    estHours: 5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 3.1."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 3.1."),
    ],
  },
  {
    id: "chem-structure-3-2-functional-groups",
    subjectId: "chemistry-hl",
    unitId: "chem-structure-3",
    unitTitle: "Structure 3 - Classification of matter",
    title: "Structure 3.2 - Functional groups: Classification of organic compounds",
    subtopics: ["Nomenclature", "Homologous series", "Structural identification"],
    estHours: 5.5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Structure 3.2."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Structure 3.2."),
    ],
  },
  {
    id: "chem-reactivity-3-1-proton-transfer",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-3",
    unitTitle: "Reactivity 3 - What are the mechanisms of chemical change?",
    title: "Reactivity 3.1 - Proton transfer reactions",
    subtopics: ["Bronsted-Lowry acids and bases", "pH and titrations", "Buffer systems"],
    estHours: 4.5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Reactivity 3.1."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 3.1."),
    ],
  },
  {
    id: "chem-reactivity-3-2-electron-transfer",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-3",
    unitTitle: "Reactivity 3 - What are the mechanisms of chemical change?",
    title: "Reactivity 3.2 - Electron transfer reactions",
    subtopics: ["Oxidation states", "Electrochemistry", "Electrolysis"],
    estHours: 4.5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Reactivity 3.2."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 3.2."),
    ],
  },
  {
    id: "chem-reactivity-3-3-electron-sharing",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-3",
    unitTitle: "Reactivity 3 - What are the mechanisms of chemical change?",
    title: "Reactivity 3.3 - Electron sharing reactions",
    subtopics: ["Addition reactions", "Substitution and elimination", "Organic synthesis pathways"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Reactivity 3.3."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 3.3."),
    ],
  },
  {
    id: "chem-reactivity-3-4-electron-pair-sharing",
    subjectId: "chemistry-hl",
    unitId: "chem-reactivity-3",
    unitTitle: "Reactivity 3 - What are the mechanisms of chemical change?",
    title: "Reactivity 3.4 - Electron-pair sharing reactions",
    subtopics: ["Nucleophiles and electrophiles", "Reaction mechanisms", "Organic mechanism comparison"],
    estHours: 6.5,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [
      guide("Chemistry Guide 2025", "Reactivity 3.4."),
      textbook("Pearson Chemistry HL 2023", "Use the section aligned to Reactivity 3.4."),
    ],
  },
], "Follow the seeded Chemistry HL syllabus order strictly before moving to the next topic.");

const ibSaturdayPaperCycleBlueprints: SeedTopicBlueprint[] = buildRotatingPaperCycleBlueprints();

const olympiadTopicBlueprints: SeedTopicBlueprint[] = buildOlympiadBPlusBlueprints();

const olympiadGoldPhaseBlueprints: SeedTopicBlueprint[] = [];

const englishTopicBlueprints: SeedTopicBlueprint[] = [];

const frenchTopicBlueprints: SeedTopicBlueprint[] = buildFrenchMaintenanceBlueprints();

const geographyTopicBlueprints: SeedTopicBlueprint[] = [];

const programmingTopicBlueprints: SeedTopicBlueprint[] = chainTopicSequence([
  {
    id: "cpp-book-ch0-notes-to-reader",
    subjectId: "cpp-book",
    unitId: "cpp-book-orientation",
    unitTitle: "Orientation - How to work through PPP3",
    title: "Chapter 0 - Notes to the Reader",
    subtopics: ["Book structure", "Learning philosophy", "ISO C++", "PPP support resources"],
    estHours: 1.5,
    difficulty: 1,
    preferredBlockTypes: ["review", "standard_focus"],
    sourceMaterials: [pppChapter("Chapter 0, pp. 1-16.")],
  },
  {
    id: "cpp-book-ch1-hello-world",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-1",
    unitTitle: "Part I - The Basics",
    title: "Chapter 1 - Hello, World!",
    subtopics: ["Programs", "Compilation", "Linking", "Programming environments"],
    estHours: 2.5,
    difficulty: 1,
    preferredBlockTypes: ["review", "drill"],
    sourceMaterials: [pppChapter("Chapter 1, pp. 17-28.")],
  },
  {
    id: "cpp-book-ch2-objects-types-values",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-1",
    unitTitle: "Part I - The Basics",
    title: "Chapter 2 - Objects, Types, and Values",
    subtopics: ["Input and variables", "Type safety", "Conversions", "auto deduction"],
    estHours: 3,
    difficulty: 2,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [pppChapter("Chapter 2, pp. 29-50.")],
  },
  {
    id: "cpp-book-ch3-computation",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-1",
    unitTitle: "Part I - The Basics",
    title: "Chapter 3 - Computation",
    subtopics: ["Expressions", "Statements", "Functions", "vector"],
    estHours: 4,
    difficulty: 2,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [pppChapter("Chapter 3, pp. 51-82.")],
  },
  {
    id: "cpp-book-ch4-errors",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-1",
    unitTitle: "Part I - The Basics",
    title: "Chapter 4 - Errors!",
    subtopics: ["Compile-time errors", "Run-time errors", "Exceptions", "Finding mistakes"],
    estHours: 3.5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [pppChapter("Chapter 4, pp. 83-114.")],
  },
  {
    id: "cpp-book-ch5-writing-program",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-1",
    unitTitle: "Part I - The Basics",
    title: "Chapter 5 - Writing a Program",
    subtopics: ["Problem analysis", "Calculator grammar", "Token streams", "Program structure"],
    estHours: 5,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [pppChapter("Chapter 5, pp. 115-150.")],
  },
  {
    id: "cpp-book-ch6-completing-program",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-1",
    unitTitle: "Part I - The Basics",
    title: "Chapter 6 - Completing a Program",
    subtopics: ["I/O cleanup", "Error handling", "Negative numbers", "Recovering from errors"],
    estHours: 4,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [pppChapter("Chapter 6, pp. 151-178.")],
  },
  {
    id: "cpp-book-ch7-functions-technicalities",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-1",
    unitTitle: "Part I - The Basics",
    title: "Chapter 7 - Technicalities: Functions, etc.",
    subtopics: ["Declarations and definitions", "Scope", "Function calls", "Namespaces and headers"],
    estHours: 3.5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [pppChapter("Chapter 7, pp. 179-220.")],
  },
  {
    id: "cpp-book-ch8-classes-technicalities",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-1",
    unitTitle: "Part I - The Basics",
    title: "Chapter 8 - Technicalities: Classes, etc.",
    subtopics: ["Classes and members", "Date class evolution", "Enumerations", "Operator overloading"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [pppChapter("Chapter 8, pp. 221-250.")],
  },
  {
    id: "cpp-book-ch9-io-streams",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-2",
    unitTitle: "Part II - Input and Output",
    title: "Chapter 9 - Input and Output Streams",
    subtopics: ["Stream model", "Files", "Formatted I/O", "String streams"],
    estHours: 4,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [pppChapter("Chapter 9, pp. 251-288.")],
  },
  {
    id: "cpp-book-ch10-display-model",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-2",
    unitTitle: "Part II - Input and Output",
    title: "Chapter 10 - A Display Model",
    subtopics: ["Why graphics", "Coordinates", "Shapes", "Running the first GUI example"],
    estHours: 3.5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [pppChapter("Chapter 10, pp. 289-314.")],
  },
  {
    id: "cpp-book-ch11-graphics-classes",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-2",
    unitTitle: "Part II - Input and Output",
    title: "Chapter 11 - Graphics Classes",
    subtopics: ["Point and Line", "Color and style", "Closed shapes", "Text and image primitives"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [pppChapter("Chapter 11, pp. 315-354.")],
  },
  {
    id: "cpp-book-ch12-class-design",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-2",
    unitTitle: "Part II - Input and Output",
    title: "Chapter 12 - Class Design",
    subtopics: ["Design principles", "Shape base class", "Inheritance", "Object-oriented benefits"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [pppChapter("Chapter 12, pp. 355-380.")],
  },
  {
    id: "cpp-book-ch13-graphing-functions-data",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-2",
    unitTitle: "Part II - Input and Output",
    title: "Chapter 13 - Graphing Functions and Data",
    subtopics: ["Function graphs", "Axis", "Approximation", "Graphing datasets"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [pppChapter("Chapter 13, pp. 381-408.")],
  },
  {
    id: "cpp-book-ch14-gui",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-2",
    unitTitle: "Part II - Input and Output",
    title: "Chapter 14 - Graphical User Interfaces",
    subtopics: ["Widgets", "Simple windows", "Drawing lines", "Animation and debugging"],
    estHours: 3.5,
    difficulty: 3,
    preferredBlockTypes: ["standard_focus", "review"],
    sourceMaterials: [pppChapter("Chapter 14, pp. 409-434.")],
  },
  {
    id: "cpp-book-ch15-vector-free-store",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-3",
    unitTitle: "Part III - Data and Algorithms",
    title: "Chapter 15 - Vector and Free Store",
    subtopics: ["Memory and addresses", "Pointers", "Destructors", "Lists"],
    estHours: 4.5,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [pppChapter("Chapter 15, pp. 435-462.")],
  },
  {
    id: "cpp-book-ch16-arrays-pointers-references",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-3",
    unitTitle: "Part III - Data and Algorithms",
    title: "Chapter 16 - Arrays, Pointers, and References",
    subtopics: ["Arrays", "Pointers and references", "C-style strings", "Palindrome example"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [pppChapter("Chapter 16, pp. 463-482.")],
  },
  {
    id: "cpp-book-ch17-essential-operations",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-3",
    unitTitle: "Part III - Data and Algorithms",
    title: "Chapter 17 - Essential Operations",
    subtopics: ["Element access", "List initialization", "Copying and moving", "Changing size"],
    estHours: 4,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [pppChapter("Chapter 17, pp. 483-512.")],
  },
  {
    id: "cpp-book-ch18-templates-exceptions",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-3",
    unitTitle: "Part III - Data and Algorithms",
    title: "Chapter 18 - Templates and Exceptions",
    subtopics: ["Templates", "Generalizing Vector", "Range checking", "Resource management"],
    estHours: 4.5,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [pppChapter("Chapter 18, pp. 513-544.")],
  },
  {
    id: "cpp-book-ch19-containers-iterators",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-3",
    unitTitle: "Part III - Data and Algorithms",
    title: "Chapter 19 - Containers and Iterators",
    subtopics: ["Sequences and iterators", "Linked lists", "Text editor example", "vector, list, and string"],
    estHours: 4.5,
    difficulty: 5,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [pppChapter("Chapter 19, pp. 545-576.")],
  },
  {
    id: "cpp-book-ch20-maps-sets",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-3",
    unitTitle: "Part III - Data and Algorithms",
    title: "Chapter 20 - Maps and Sets",
    subtopics: ["map", "unordered_map", "set", "Ranges and iterators"],
    estHours: 3.5,
    difficulty: 4,
    preferredBlockTypes: ["standard_focus", "drill"],
    sourceMaterials: [pppChapter("Chapter 20, pp. 577-602.")],
  },
  {
    id: "cpp-book-ch21-algorithms",
    subjectId: "cpp-book",
    unitId: "cpp-book-part-3",
    unitTitle: "Part III - Data and Algorithms",
    title: "Chapter 21 - Algorithms",
    subtopics: ["Standard-library algorithms", "Function objects", "Numerical algorithms", "Sorting and searching"],
    estHours: 4.5,
    difficulty: 4,
    preferredBlockTypes: ["deep_work", "standard_focus"],
    sourceMaterials: [pppChapter("Chapter 21, pp. 603-624.")],
  },
], "Follow the seeded C++ book chapter order strictly before moving to the next topic.");

export const seedTopicBlueprints: SeedTopicBlueprint[] = annotateAndRetuneGuideMetadata([
  ...physicsTopicBlueprints,
  ...mathsTopicBlueprints,
  ...chemistryTopicBlueprints,
  ...ibSaturdayPaperCycleBlueprints,
  ...olympiadTopicBlueprints,
  ...olympiadGoldPhaseBlueprints,
  ...englishTopicBlueprints,
  ...frenchTopicBlueprints,
  ...geographyTopicBlueprints,
  ...programmingTopicBlueprints,
]);
