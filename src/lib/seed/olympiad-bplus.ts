import type { BlockType, TopicResource } from "@/lib/types/planner";

type OlympiadSeedTopicBlueprint = {
  id: string;
  subjectId: "olympiad";
  unitId: string;
  unitTitle: string;
  title: string;
  subtopics: string[];
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
};

type PhaseId = 1 | 2 | 3 | 4 | 5 | 6;
type StrandKey =
  | "geometry"
  | "algebra"
  | "number-theory"
  | "combinatorics"
  | "contest"
  | "assignment";

type ModulePlan = {
  title: string;
  subtopics: string[];
  primaryLabel: string;
  primaryDetails: string;
  problemTarget: string;
  resolveTarget: string;
  benchmark: string;
  protocol: string;
  difficulty?: 4 | 5;
};

type OlympiadPhase = {
  id: PhaseId;
  label: string;
  start: string;
  end: string;
};

const OLYMPIAD_PHASES: OlympiadPhase[] = [
  { id: 1, label: "Phase 1 - Reset and foundations", start: "2026-04-06", end: "2026-05-31" },
  { id: 2, label: "Phase 2 - Half-mock build", start: "2026-06-01", end: "2026-07-26" },
  { id: 3, label: "Phase 3 - Coverage and SAMO conversion", start: "2026-07-27", end: "2026-09-27" },
  { id: 4, label: "Phase 4 - Day-1 reliability", start: "2026-09-28", end: "2026-11-29" },
  { id: 5, label: "Phase 5 - Camp and assignment season", start: "2026-11-30", end: "2027-02-28" },
  { id: 6, label: "Phase 6 - Selection peak", start: "2027-03-01", end: "2027-04-06" },
];

const geometryPlansByPhase: Record<PhaseId, ModulePlan[]> = {
  1: [
    {
      title: "EGMO preliminaries and angle-chasing reset",
      subtopics: ["Directed angles", "Cyclicity", "Similarity spotting", "Proof layout discipline"],
      primaryLabel: "G1 - EGMO",
      primaryDetails:
        "Preliminaries; Angle Chasing; Circles. Use the geometry spine to reset notation, directed angles, and clean synthetic proof style.",
      problemTarget: "Attempt 8-10 geometry problems from the early EGMO angle/circle chapters.",
      resolveTarget: "Re-solve 2 complete angle-chasing proofs from memory without notes.",
      benchmark: "Benchmark problem: one clean circle/angle proof at IMO Shortlist G1/G2 warm-up level.",
      protocol: "Write one full synthetic solution cleanly, then rewrite it the next day with all hidden lemmas made explicit.",
    },
    {
      title: "EGMO circles, power, and lengths/ratios",
      subtopics: ["Power of a point", "Chord and tangent facts", "Lengths and ratios", "Configuration control"],
      primaryLabel: "G1 + G2",
      primaryDetails:
        "EGMO Circles; Lengths and Ratios, with G2 Chapters 1-2 (Power of a Point; Radical Axes) as a lemma amplifier.",
      problemTarget: "Attempt 8 geometry problems emphasizing power, ratios, and radical-axis setups.",
      resolveTarget: "Re-solve 2 ratio/power proofs and extract the reusable lemma statements.",
      benchmark: "Benchmark problem: one power-of-a-point configuration proof with an auxiliary point.",
      protocol: "Add every reusable circle lemma to the notebook before checking any full solution.",
    },
    {
      title: "G2 Ceva/Menelaus and triangle-center fundamentals",
      subtopics: ["Ceva", "Menelaus", "Concurrency", "Triangle centers"],
      primaryLabel: "G2 - Lemmas in Olympiad Geometry",
      primaryDetails:
        "G2 Chapters 3-4 (Ceva variants; Menelaus), with EGMO assorted configurations as the problem source.",
      problemTarget: "Attempt 8 concurrency/collinearity problems using Ceva/Menelaus and center geometry.",
      resolveTarget: "Re-solve 2 concurrency proofs and annotate where the main lemma first appears.",
      benchmark: "Benchmark problem: one triangle-center or Ceva/Menelaus proof solved cleanly from scratch.",
      protocol: "Force yourself to state the intended ratio chase before doing algebra or length computation.",
    },
    {
      title: "Early-geometry consolidation and directed-angle conversion",
      subtopics: ["Directed angles", "Power of a point", "Ratios", "Center configurations"],
      primaryLabel: "G1/G2 mixed set",
      primaryDetails:
        "Consolidate G1 Preliminaries, Angle Chasing, Circles, Lengths and Ratios, and G2 Chapters 1-4.",
      problemTarget: "Attempt 6 mixed shortlist/national geometry problems and fully finish 2.",
      resolveTarget: "Re-solve 2 earlier geometry problems using a cleaner synthetic route.",
      benchmark: "Benchmark problem: one mixed geometry set solved with a full competition-style write-up.",
      protocol: "Keep geometry on paper only: no coordinates unless the synthetic route is clearly inferior.",
      difficulty: 5,
    },
  ],
  2: [
    {
      title: "EGMO computational geometry and coordinate triage",
      subtopics: ["Coordinate bashing triage", "Vectors", "When to go analytic", "Contain the algebra"],
      primaryLabel: "G1 - EGMO",
      primaryDetails:
        "EGMO Computational Geometry. Treat coordinates and vectors as controlled simplifiers, not defaults.",
      problemTarget: "Attempt 6 analytic-geometry problems and compare one synthetic versus coordinate solution.",
      resolveTarget: "Re-solve 1 geometry problem using a lower-complexity coordinate system.",
      benchmark: "Benchmark problem: one geometry problem where coordinates clearly beat synthetic chasing.",
      protocol: "Decide the method in 10 minutes or less; if the setup explodes, restart with a simpler model.",
    },
    {
      title: "EGMO complex numbers and barycentric groundwork",
      subtopics: ["Complex plane setup", "Unit circle normalization", "Barycentric coordinates", "Method selection"],
      primaryLabel: "G1 - EGMO",
      primaryDetails:
        "EGMO Complex Numbers; Barycentric Coordinates. Use them as advanced tools only when they materially shorten the proof.",
      problemTarget: "Attempt 5-6 geometry problems that reward complex or barycentric setup decisions.",
      resolveTarget: "Re-solve 1 complex-number geometry proof and summarize why the method was worth it.",
      benchmark: "Benchmark problem: one advanced geometry problem rewritten in a clean analytic style.",
      protocol: "Record not just the solution, but the moment where the analytic method became better than synthetic work.",
      difficulty: 5,
    },
    {
      title: "G2 isogonal, pedal, Simson, and symmedian toolkit",
      subtopics: ["Isogonal conjugates", "Pedal triangles", "Simson line", "Symmedians and harmonic bundles"],
      primaryLabel: "G2 - Lemmas in Olympiad Geometry",
      primaryDetails:
        "G2 Chapters 7-10 (Isogonal/Pedal; Simson/Steiner; Symmedians; Harmonic).",
      problemTarget: "Attempt 6 geometry lemma-driven problems from the G2 middle chapters.",
      resolveTarget: "Re-solve 2 problems where the right named lemma shortened the proof materially.",
      benchmark: "Benchmark problem: one symmedian or Simson configuration written with no missing lemma steps.",
      protocol: "Never cite a named lemma without writing the exact configuration that allows it.",
      difficulty: 5,
    },
  ],
  3: [
    {
      title: "Geometry transformations and mixed EGMO/G2 repair",
      subtopics: ["Transformations", "Method switching", "Complex versus synthetic", "Mixed shortlist geometry"],
      primaryLabel: "G1/G2 mixed continuation",
      primaryDetails:
        "Continue EGMO Computational Geometry, Complex Numbers, and Barycentric Coordinates while consolidating G2 Chapters 7-10.",
      problemTarget: "Attempt 6 mixed geometry problems from shortlist and camp-style sets.",
      resolveTarget: "Re-solve 2 old geometry misses using a different method family.",
      benchmark: "Benchmark problem: one shortlist geometry problem solved in a method you previously avoided.",
      protocol: "For every solved problem, write one sentence on why the chosen method won.",
      difficulty: 5,
    },
    {
      title: "G3 transformations and inversive bridge",
      subtopics: ["Transformations", "Inversive geometry", "Projective taste", "Bridging methods"],
      primaryLabel: "G3 - Geometry Revisited",
      primaryDetails:
        "G3 Chapters 4-5 (Transformations; Inversive Geometry). Use this as the bridge into the higher-ceiling geometry phase.",
      problemTarget: "Attempt 5-6 transformation and inversion problems after reading the chapter bridge.",
      resolveTarget: "Re-solve 1 geometry problem with a transformation-first approach.",
      benchmark: "Benchmark problem: one inversion or transformation proof completed with a fully justified map choice.",
      protocol: "State the map and what it preserves before doing any calculation.",
      difficulty: 5,
    },
  ],
  4: [
    {
      title: "EGMO inversion and projective geometry",
      subtopics: ["Inversion", "Projective geometry", "Cross-ratio awareness", "Method ceiling tools"],
      primaryLabel: "G1 - EGMO",
      primaryDetails:
        "EGMO Inversion; Projective Geometry; Complete Quadrilaterals; Personal Favorites + Appendix A.",
      problemTarget: "Attempt 5 inversion/projective geometry problems and fully finish 2.",
      resolveTarget: "Re-solve 1 inversion problem and one projective setup without notes.",
      benchmark: "Benchmark problem: one inversion or projective shortlist problem solved with a clean lemma chain.",
      protocol: "Use these tools only when they genuinely collapse the proof; otherwise revert to simpler synthetic structure.",
      difficulty: 5,
    },
    {
      title: "G2 homothety, inversion, mixtilinear, and Ptolemy/Casey",
      subtopics: ["Homothety", "Inversion", "Mixtilinear incircles", "Ptolemy/Casey"],
      primaryLabel: "G2 - Lemmas in Olympiad Geometry",
      primaryDetails:
        "G2 Chapters 14-15 (Homothety; Inversion) and 17-18 (Mixtilinear; Ptolemy/Casey).",
      problemTarget: "Attempt 5 advanced geometry problems from the G2 stretch chapters.",
      resolveTarget: "Re-solve 2 advanced geometry lemmas until the statement and trigger are automatic.",
      benchmark: "Benchmark problem: one advanced circle lemma problem solved in competition format.",
      protocol: "Distill each new lemma to trigger, exact statement, and one canonical diagram.",
      difficulty: 5,
    },
  ],
  5: [
    {
      title: "G3 transformations, inversive, and projective consolidation",
      subtopics: ["Transformations", "Inversive geometry", "Projective geometry", "Camp-style geometry mix"],
      primaryLabel: "G3 - Geometry Revisited",
      primaryDetails:
        "G3 Chapters 4-6 (Transformations; Inversive; Projective) with geometry hints used only after a full solo attempt.",
      problemTarget: "Attempt 5 geometry problems and finish 2 complete camp-style write-ups.",
      resolveTarget: "Re-solve 2 geometry misses from mock or shortlist work.",
      benchmark: "Benchmark problem: one camp-style geometry problem repaired into a full solution.",
      protocol: "Use G3 as a method bridge, then test the method immediately on a shortlist problem.",
      difficulty: 5,
    },
    {
      title: "Advanced geometry lemma and shortlist conversion",
      subtopics: ["Lemma notebook", "Camp shortlist", "Mock-to-lemma conversion", "Weak-point repair"],
      primaryLabel: "Geometry conversion set",
      primaryDetails:
        "Use G2 advanced lemmas plus recent shortlist geometry to convert camp-style attempts into full proofs.",
      problemTarget: "Attempt 4-5 shortlist or camp problems and fully rewrite 2 from the error log.",
      resolveTarget: "Re-solve 2 older geometry problems with no diagram annotations from the official solution.",
      benchmark: "Benchmark problem: one geometry problem converted from partial idea to full proof in under 90 minutes.",
      protocol: "Start from your own failed attempt, not from a fresh untouched solution path.",
      difficulty: 5,
    },
  ],
  6: [
    {
      title: "Selection-peak geometry repair and stability set",
      subtopics: ["Final geometry gaps", "Method stability", "Shortlist compression", "Clean proof endings"],
      primaryLabel: "G3 + shortlist repair",
      primaryDetails:
        "Use G3 Chapters 4-6 and your shortlist error log to stabilize the geometry methods that still break under time.",
      problemTarget: "Attempt 4 geometry problems under time and rewrite 2 fully after a gap.",
      resolveTarget: "Re-solve 2 geometry errors from the latest mock cycle within one sitting.",
      benchmark: "Benchmark problem: one full geometry solution from a recent selection-style paper.",
      protocol: "Treat geometry as a stability exercise now: fewer new tricks, more reliable conversion.",
      difficulty: 5,
    },
  ],
};

const algebraPlansByPhase: Record<PhaseId, ModulePlan[]> = {
  1: [
    {
      title: "Proof-writing reset and inequality foundations",
      subtopics: ["Notes on proofs", "Equality-case-first", "Normalization", "Homogenization"],
      primaryLabel: "A1 - OTIS Excerpts",
      primaryDetails:
        "Chapter 1 (Notes on Proofs) and Chapter 2 (Fundamentals of Inequalities) through 'Philosophy of inequalities'.",
      problemTarget: "Attempt 8-10 algebra/inequality problems with at least 2 full clean write-ups.",
      resolveTarget: "Re-solve 2 inequality proofs from memory and annotate the equality cases.",
      benchmark: "Benchmark problem: one inequality proof finished cleanly with explicit normalization choices.",
      protocol: "Do not move on from a proof until the write-up reads like a contest submission, not scratch work.",
    },
    {
      title: "Inequality philosophy and proof conversion",
      subtopics: ["AM-GM and Cauchy", "Normalization", "Symmetric versus cyclic", "Proof compression"],
      primaryLabel: "A1/A2 inequality bridge",
      primaryDetails:
        "Continue A1 Chapter 2 and start technique drills from Problem-Solving Strategies / Engel-style inequality chapters.",
      problemTarget: "Attempt 8 inequality drills and fully finish 2 medium proofs.",
      resolveTarget: "Re-solve 2 inequality problems without consulting the original algebraic manipulations.",
      benchmark: "Benchmark problem: one medium inequality converted into a clean 7-point style write-up.",
      protocol: "Write the intended inequality chain before executing calculations.",
    },
  ],
  2: [
    {
      title: "Functional equations core patterns and forcing moves",
      subtopics: ["Special values", "Injective/surjective forcing", "Iteration", "Fixed points"],
      primaryLabel: "A1 - OTIS Excerpts",
      primaryDetails:
        "Chapters 3-4 (Functional Equations + Monstrous FEs): definitions, techniques, walkthroughs, and problems.",
      problemTarget: "Attempt 6 FE problems with full drafts before checking any solution.",
      resolveTarget: "Re-solve 2 FE problems and identify the forcing move that unlocked the proof.",
      benchmark: "Benchmark problem: one FE problem solved with a full case structure and no logical gaps.",
      protocol: "Do not read a solution until you have a complete draft, even if the draft is wrong.",
      difficulty: 5,
    },
    {
      title: "Sequences, polynomials, and algebraic structure drills",
      subtopics: ["Sequences", "Recurrences", "Polynomial identities", "Auxiliary construction"],
      primaryLabel: "A2 - Problem-Solving Strategies / Engel technique set",
      primaryDetails:
        "Use the sequences, induction, and polynomial technique chapters as algebra support while FE work ramps.",
      problemTarget: "Attempt 6-8 algebra problems spanning sequences, recurrences, and polynomial identities.",
      resolveTarget: "Re-solve 2 algebra problems and record the structural trigger that made them manageable.",
      benchmark: "Benchmark problem: one sequence or polynomial proof completed under time.",
      protocol: "Extract one general algebra pattern from every solved problem before moving on.",
      difficulty: 5,
    },
  ],
  3: [
    {
      title: "Core algebra techniques: inequalities, induction, and sequences",
      subtopics: ["Inequalities", "Induction", "Sequences", "Recurrences"],
      primaryLabel: "A2 - Problem-Solving Strategies / Engel technique set",
      primaryDetails:
        "Chapters: Number Theory; Inequalities; Induction; Sequences, used here for algebraic technique drilling and proof conversion.",
      problemTarget: "Attempt 6-8 mixed algebra problems and fully finish 2 under timed conditions.",
      resolveTarget: "Re-solve 2 older sequence/induction misses from the notebook.",
      benchmark: "Benchmark problem: one algebra problem solved within a half-mock setting.",
      protocol: "Keep one session each week for pure rewrite quality, not just idea generation.",
      difficulty: 5,
    },
    {
      title: "Polynomials and FE conversion set",
      subtopics: ["Polynomials", "Vieta", "Enough roots", "Functional-equation conversion"],
      primaryLabel: "A2 + A1 mixed set",
      primaryDetails:
        "Continue polynomial technique chapters while using OTIS FE chapters for hard conversion practice.",
      problemTarget: "Attempt 5-6 algebra shortlist problems and rewrite 2 fully.",
      resolveTarget: "Re-solve 2 FE/polynomial problems from memory with a cleaner solution route.",
      benchmark: "Benchmark problem: one shortlist algebra problem converted to a polished proof.",
      protocol: "Pair every hard FE or polynomial with a written postmortem: what should you have seen sooner?",
      difficulty: 5,
    },
  ],
  4: [
    {
      title: "Advanced polynomials, FE, and contest conversion",
      subtopics: ["Polynomials", "Functional equations", "Inequalities under time", "Mixed shortlist algebra"],
      primaryLabel: "A2 - late algebra chapters",
      primaryDetails:
        "Chapters: Polynomials; Functional Equations; Geometry; Games, with the algebra/FE sections treated as the main contest-conversion spine.",
      problemTarget: "Attempt 5-6 shortlist algebra problems and finish 2 as full contest scripts.",
      resolveTarget: "Re-solve 2 algebra problems from the mock error log within one sitting.",
      benchmark: "Benchmark problem: one 4.5h-paper algebra problem converted to a full proof.",
      protocol: "Start with route selection: what technique family should solve this in contest time?",
      difficulty: 5,
    },
  ],
  5: [
    {
      title: "Camp-style algebra repair and FE stability",
      subtopics: ["Polynomials", "FE stability", "Inequality repair", "Games/strategy crossover"],
      primaryLabel: "A2 advanced repair",
      primaryDetails:
        "Continue the late A2 chapters for repair work; prioritize FE, polynomials, and the algebraic ideas that keep reappearing in camp tests.",
      problemTarget: "Attempt 4-5 hard algebra problems and fully repair 2 from the error log.",
      resolveTarget: "Re-solve 2 algebra misses without reading the original official solution.",
      benchmark: "Benchmark problem: one camp-style algebra proof finished cleanly under time.",
      protocol: "Treat this as stability work: the goal is not novelty but reliable conversion.",
      difficulty: 5,
    },
  ],
  6: [
    {
      title: "Selection-peak algebra/FE repair set",
      subtopics: ["High-value FE repair", "Polynomial cleanup", "Time-stable inequalities", "Final rewrite polish"],
      primaryLabel: "A1/A2 mixed repair",
      primaryDetails:
        "Use the FE, polynomial, and inequality chapters only as targeted repair references before the final mock cycle.",
      problemTarget: "Attempt 4 algebra/FE problems under time and fully rewrite 2.",
      resolveTarget: "Re-solve 2 algebra/FE errors from the latest full mock.",
      benchmark: "Benchmark problem: one full algebra proof from a recent selection-style set.",
      protocol: "At this stage, every algebra block must either fix a recurring error or preserve a reliable technique.",
      difficulty: 5,
    },
  ],
};

const numberTheoryPlansByPhase: Record<PhaseId, ModulePlan[]> = {
  1: [
    {
      title: "Foundations of number theory: divisibility and gcd structure",
      subtopics: ["Divisibility", "gcd/lcm", "Euclidean algorithm", "Prime-factor structure"],
      primaryLabel: "N1 - 104 Number Theory Problems",
      primaryDetails:
        "\"Foundations of Number Theory\" (entire), with divisibility, gcd/lcm, and prime-factor arguments as the first pass.",
      problemTarget: "Attempt 6-8 foundation number-theory problems before looking at any solution.",
      resolveTarget: "Re-solve 2 divisibility/gcd proofs from memory.",
      benchmark: "Benchmark problem: one clean divisibility or gcd proof completed without modular overkill.",
      protocol: "Write the invariant or obstruction before doing calculations.",
    },
    {
      title: "Congruence, orders, and modular arithmetic control",
      subtopics: ["Congruence", "Orders", "Residues", "Exponent patterns"],
      primaryLabel: "N1 + N2",
      primaryDetails:
        "Continue N1 Foundations and begin OTIS number-theory chapters on orders and exponent lifting as support.",
      problemTarget: "Attempt 6 modular/number-theory problems and finish 2 completely.",
      resolveTarget: "Re-solve 2 modular arithmetic proofs without notes.",
      benchmark: "Benchmark problem: one order/residue problem solved with a clean modular structure.",
      protocol: "Name the modulus and what it is supposed to kill before you compute anything.",
      difficulty: 5,
    },
  ],
  2: [
    {
      title: "N1 intro problems and OTIS NT support",
      subtopics: ["Intro problems", "Orders", "Exponent lifting", "Valuation warm-up"],
      primaryLabel: "N1 + N2",
      primaryDetails:
        "N1 intro problems, with OTIS number-theory chapters 12-15 (orders; exponent lifting; advanced techniques; constructions) as support.",
      problemTarget: "Attempt 6-8 intro/early-advanced number-theory problems.",
      resolveTarget: "Re-solve 2 intro problems as full solutions after a gap.",
      benchmark: "Benchmark problem: one intro or middle-layer NT problem solved fully under time.",
      protocol: "After every solve, classify whether the main move was modular, valuation, or construction-based.",
      difficulty: 5,
    },
  ],
  3: [
    {
      title: "Advanced number theory problems and full-solution repair",
      subtopics: ["Advanced problems", "Valuations", "Constructive NT", "Diophantine structure"],
      primaryLabel: "N1 + N2 advanced set",
      primaryDetails:
        "Attempt N1 advanced problems and OTIS advanced number-theory techniques, then compare with official solutions only after a full draft.",
      problemTarget: "Attempt 5-6 advanced number-theory problems and fully write 2 solutions.",
      resolveTarget: "Re-solve 2 advanced number-theory proofs without checking the official write-up first.",
      benchmark: "Benchmark problem: one advanced NT problem converted into a polished full proof.",
      protocol: "Keep number theory strand-local: advance this sequence, but do not let it suppress geometry or algebra continuity.",
      difficulty: 5,
    },
  ],
  4: [
    {
      title: "Shortlist number theory conversion and repair",
      subtopics: ["Advanced techniques", "Residues under time", "Valuation repair", "Shortlist N-sets"],
      primaryLabel: "N1/N2 shortlist conversion",
      primaryDetails:
        "Use the completed N1 and OTIS NT chapters as reference while converting shortlist and camp-style NT problems.",
      problemTarget: "Attempt 4-5 shortlist or camp NT problems and finish 2 full proofs.",
      resolveTarget: "Re-solve 2 number-theory misses from the mock error log.",
      benchmark: "Benchmark problem: one 4.5h-paper NT problem solved in full contest format.",
      protocol: "Choose the NT technique family in the first 10 minutes or restart with a new viewpoint.",
      difficulty: 5,
    },
  ],
  5: [
    {
      title: "Camp-style NT shortlist and assignment repair",
      subtopics: ["Camp NT", "Assignment-grade proofs", "Residue/valuation repair", "Stability under fatigue"],
      primaryLabel: "N1/N2 camp repair",
      primaryDetails:
        "Use N1 advanced problems and OTIS NT support as repair references during camp-style mock and assignment season.",
      problemTarget: "Attempt 4 number-theory problems and fully repair 2 in assignment-grade detail.",
      resolveTarget: "Re-solve 2 hard NT problems from the previous month.",
      benchmark: "Benchmark problem: one camp-style number-theory proof completed cleanly under fatigue.",
      protocol: "Treat number theory as a conversion subject now: fewer new ideas, more stable execution.",
      difficulty: 5,
    },
  ],
  6: [
    {
      title: "Selection-peak number theory repair set",
      subtopics: ["Final NT gaps", "Under-time residues", "Stable valuations", "Proof tightening"],
      primaryLabel: "N1/N2 final repair",
      primaryDetails:
        "Use only the high-value N1/N2 sections that still correspond to recurring errors in the latest mock cycle.",
      problemTarget: "Attempt 4 timed NT problems and fully rewrite 2.",
      resolveTarget: "Re-solve 2 NT errors from the most recent full mock.",
      benchmark: "Benchmark problem: one full NT solution from a selection-style set.",
      protocol: "No more broad reading here: every NT session must fix a real failure mode.",
      difficulty: 5,
    },
  ],
};

const combinatoricsPlansByPhase: Record<PhaseId, ModulePlan[]> = {
  1: [
    {
      title: "Invariance, coloring, extremal, and box-principle foundations",
      subtopics: ["Invariance", "Coloring", "Extremal principle", "Box principle"],
      primaryLabel: "C2 - Engel technique chapters",
      primaryDetails:
        "Engel technique chapters: invariance, coloring, extremal principle, and box principle.",
      problemTarget: "Attempt 6-8 combinatorics problems focused on invariants, extremal moves, and pigeonhole structure.",
      resolveTarget: "Re-solve 2 invariants/extremal proofs without notes.",
      benchmark: "Benchmark problem: one process/invariant proof written cleanly from start to finish.",
      protocol: "State what is being optimized or preserved before making the first move.",
    },
    {
      title: "Enumerative combinatorics and structured counting",
      subtopics: ["Enumerative methods", "Counting frameworks", "Double counting", "Case control"],
      primaryLabel: "C2 - Engel technique chapters",
      primaryDetails:
        "Continue the Engel combinatorics technique chapters with explicit enumerative counting and structured casework.",
      problemTarget: "Attempt 6 counting/combinatorics problems and fully finish 2.",
      resolveTarget: "Re-solve 2 counting proofs from memory.",
      benchmark: "Benchmark problem: one counting or enumerative proof completed in contest style.",
      protocol: "Write the counting plan before summing anything.",
    },
  ],
  2: [
    {
      title: "OTIS combinatorics global/local and rigid/free",
      subtopics: ["Graph terminology", "Global/local", "Rigid/free", "Meta-reasoning"],
      primaryLabel: "C1 - OTIS combinatorics chapters",
      primaryDetails:
        "OTIS combinatorics chapters 5-11 (graph terminology; two-part; global/local; rigid/free; anti-problems).",
      problemTarget: "Attempt 6-8 OTIS combinatorics problems and fully finish 2.",
      resolveTarget: "Re-solve 2 combinatorics proofs from the weekly notebook.",
      benchmark: "Benchmark problem: one OTIS-style combinatorics problem solved with explicit global/local reasoning.",
      protocol: "After each problem, label whether the key move was global/local, rigid/free, extremal, or invariant.",
      difficulty: 5,
    },
  ],
  3: [
    {
      title: "Mixed combinatorics: graph tools, extremal, and enumerative conversion",
      subtopics: ["Graph methods", "Extremal principle", "Enumerative repair", "Global/local transfers"],
      primaryLabel: "C1/C2 mixed set",
      primaryDetails:
        "Continue OTIS combinatorics chapters 5-11 and Engel combinatorics techniques in mixed shortlist-style sets.",
      problemTarget: "Attempt 5-6 combinatorics problems and fully finish 2.",
      resolveTarget: "Re-solve 2 earlier combinatorics misses from memory.",
      benchmark: "Benchmark problem: one shortlist combinatorics proof converted cleanly.",
      protocol: "Every combinatorics block should finish with a short note on the main principle family used.",
      difficulty: 5,
    },
  ],
  4: [
    {
      title: "Shortlist combinatorics conversion and graph optimization",
      subtopics: ["Graph recasting", "Extremal repair", "Enumerative stability", "Camp-style combinatorics"],
      primaryLabel: "C1/C2 conversion set",
      primaryDetails:
        "Use OTIS combinatorics chapters 5-11 and Engel technique chapters as repair references while converting shortlist combinatorics.",
      problemTarget: "Attempt 4-5 combinatorics problems and fully repair 2.",
      resolveTarget: "Re-solve 2 combinatorics misses from the mock cycle.",
      benchmark: "Benchmark problem: one 4.5h-paper combinatorics problem solved in full contest style.",
      protocol: "Avoid vague 'count better' thinking; name the principle you are using before proceeding.",
      difficulty: 5,
    },
  ],
  5: [
    {
      title: "Camp-style combinatorics and assignment repair",
      subtopics: ["Camp combinatorics", "Graph and invariant repair", "Assignment proof clarity", "Stability under time"],
      primaryLabel: "C1/C2 camp repair",
      primaryDetails:
        "Use the completed OTIS and Engel combinatorics material as a conversion base during camp and assignment season.",
      problemTarget: "Attempt 4 combinatorics problems and fully repair 2 in assignment-grade detail.",
      resolveTarget: "Re-solve 2 combinatorics errors from the previous month.",
      benchmark: "Benchmark problem: one camp-style combinatorics proof completed under time.",
      protocol: "When a proof uses a standard principle, state why that principle is the right one here.",
      difficulty: 5,
    },
  ],
  6: [
    {
      title: "Selection-peak combinatorics repair set",
      subtopics: ["Final combinatorics gaps", "Graph optimization", "Invariant repair", "Proof tightening"],
      primaryLabel: "C1/C2 final repair",
      primaryDetails:
        "Use only the combinatorics references that correspond to recurring errors in the latest mock set.",
      problemTarget: "Attempt 4 timed combinatorics problems and fully rewrite 2.",
      resolveTarget: "Re-solve 2 combinatorics errors from the most recent full mock.",
      benchmark: "Benchmark problem: one full combinatorics solution from a selection-style set.",
      protocol: "At this stage, every combinatorics block is a repair block or a stability block, not broad exploration.",
      difficulty: 5,
    },
  ],
};

const contestPlansByPhase: Record<PhaseId, ModulePlan[]> = {
  1: [
    {
      title: "Proof conversion and clean write-up routine",
      subtopics: ["Clean write-ups", "Lemma extraction", "Error taxonomy", "Re-solve queue"],
      primaryLabel: "Contest systems",
      primaryDetails:
        "Use weekly conversion blocks to turn partial drafts into full scripts, maintain the error log, and manage the re-solve queue.",
      problemTarget: "Rewrite 2 full solutions and classify 3 recurring proof failures.",
      resolveTarget: "Re-solve 1 old problem from memory and defend every lemma step aloud.",
      benchmark: "Benchmark artifact: one fully polished proof and one revised error-log entry.",
      protocol: "Contest-system work is real study, not admin: it must change future proof quality.",
    },
    {
      title: "Mini-test postmortem and proof repair",
      subtopics: ["Mini-test debrief", "Proof gaps", "Route selection", "Time discipline"],
      primaryLabel: "Mock review protocol",
      primaryDetails:
        "Use the weekly timed mini-test to identify one idea gap and one write-up gap, then repair both in the conversion block.",
      problemTarget: "Rewrite the strongest mini-test solution and repair the most valuable failed attempt.",
      resolveTarget: "Re-solve 1 mini-test problem after a short gap with a cleaner script.",
      benchmark: "Benchmark artifact: one mini-test problem turned into a full contest-ready proof.",
      protocol: "Do the postmortem immediately after the timed block while the false starts are still visible.",
      difficulty: 5,
    },
  ],
  2: [
    {
      title: "Half-mock debrief, lemma notebook, and rewrite discipline",
      subtopics: ["Half-mock postmortem", "Lemma notebook", "Rewrite discipline", "Error-log repair"],
      primaryLabel: "Half-mock systems",
      primaryDetails:
        "Use the weekly half-mock to sharpen route selection, then consolidate reusable lemmas and proof templates.",
      problemTarget: "Repair 2 half-mock solutions and log 3 repeatable lemma patterns.",
      resolveTarget: "Re-solve 1 half-mock problem after 48 hours with no notes.",
      benchmark: "Benchmark artifact: one repaired half-mock script that reads like a final submission.",
      protocol: "The half-mock only counts if the postmortem changes the notebook and the next week's execution.",
      difficulty: 5,
    },
  ],
  3: [
    {
      title: "SAMO/half-mock conversion and shortlist integration",
      subtopics: ["SAMO pacing", "Shortlist-to-mock transfer", "Write-up compression", "Mixed-set repair"],
      primaryLabel: "Contest systems",
      primaryDetails:
        "Alternate SAMO-style longer blocks and half-mocks, then convert the best and worst attempts into reusable proof routines.",
      problemTarget: "Repair 2 timed-set problems and promote 1 error-log item into a solved re-solve.",
      resolveTarget: "Re-solve 1 earlier timed problem using the revised route map.",
      benchmark: "Benchmark artifact: one mixed-set solution rewritten with full contest pacing notes.",
      protocol: "This block exists to connect topic work to mock work, not to add random extra problems.",
      difficulty: 5,
    },
  ],
  4: [
    {
      title: "4.5h paper debrief and Day-1 reliability repair",
      subtopics: ["4.5h postmortem", "Day-1 reliability", "Partial-credit engineering", "Time triage"],
      primaryLabel: "Contest systems",
      primaryDetails:
        "Use the weekly 4.5-hour paper as the main signal source, then repair route choice, pacing, and proof finish quality.",
      problemTarget: "Repair 2 paper problems and classify every major time sink from the sitting.",
      resolveTarget: "Re-solve 1 paper problem within 90 minutes after the debrief.",
      benchmark: "Benchmark artifact: one Day-1 style proof rewritten to a full 7-point standard.",
      protocol: "The question after every paper is: what would have changed the score in the first 45 minutes?",
      difficulty: 5,
    },
  ],
  5: [
    {
      title: "Camp and assignment conversion block",
      subtopics: ["Camp-test postmortem", "Assignment proof polish", "Mock stability", "Selection prep"],
      primaryLabel: "Contest systems",
      primaryDetails:
        "During the December-camp and assignment season, every systems block should turn timed attempts into assignment-grade scripts.",
      problemTarget: "Repair 2 camp/mock solutions and polish 1 proof to assignment grade.",
      resolveTarget: "Re-solve 1 camp-style miss with no notes after a short delay.",
      benchmark: "Benchmark artifact: one proof polished to a correspondence-assignment standard.",
      protocol: "Selection-season systems work must be publishable-quality mathematics, not rough notes.",
      difficulty: 5,
    },
  ],
  6: [
    {
      title: "Selection-peak stability audit and rewrite block",
      subtopics: ["Stability audit", "Final rewrite", "Route discipline", "Confidence preservation"],
      primaryLabel: "Contest systems",
      primaryDetails:
        "Use the final weeks to preserve conversion quality, stabilize pacing, and stop repeating the same proof-ending mistakes.",
      problemTarget: "Repair 2 final-mock solutions and fully rewrite 1 key solution from memory.",
      resolveTarget: "Re-solve 1 selection-style problem under a strict time cap.",
      benchmark: "Benchmark artifact: one full solution rewritten perfectly from memory.",
      protocol: "No broad re-reading here: this block exists to make the next mock cleaner.",
      difficulty: 5,
    },
  ],
};

const MOCK_ARCHIVE_LABEL = "IMO/Shortlist archive";

function resource(type: TopicResource["type"], label: string, details: string): TopicResource {
  return { type, label, details };
}

const notes = (label: string, details: string) => resource("notes", label, details);
const textbook = (label: string, details: string) => resource("textbook", label, details);
const worksheet = (label: string, details: string) => resource("worksheet", label, details);
const pastPaper = (label: string, details: string) => resource("past_paper", label, details);

function compareDateKeys(left: string, right: string) {
  return left.localeCompare(right);
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDaysToDateKey(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00`);
  date.setDate(date.getDate() + days);
  return toDateKey(date);
}

function buildWeeklyDateKeys(start: string, end: string) {
  const keys: string[] = [];
  const cursor = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);

  while (cursor.getTime() <= endDate.getTime()) {
    keys.push(toDateKey(cursor));
    cursor.setDate(cursor.getDate() + 7);
  }

  return keys;
}

function getOlympiadPhase(weekStart: string) {
  return OLYMPIAD_PHASES.find(
    (phase) => compareDateKeys(phase.start, weekStart) <= 0 && compareDateKeys(weekStart, phase.end) <= 0,
  );
}

function isLateFoundationPhase(phaseId: PhaseId) {
  return phaseId <= 2;
}

function getPlanForPhase(plansByPhase: Record<PhaseId, ModulePlan[]>, phaseId: PhaseId, index: number) {
  const plans = plansByPhase[phaseId];
  return plans[index % plans.length];
}

function createExecutionBundle(plan: ModulePlan) {
  return [
    textbook(plan.primaryLabel, plan.primaryDetails),
    worksheet("Problem-set target", plan.problemTarget),
    notes("Re-solve target", plan.resolveTarget),
    pastPaper("Benchmark problem", plan.benchmark),
    notes("Protocol", plan.protocol),
  ];
}

function getMockSpecification(phaseId: PhaseId, localWeekIndex: number) {
  switch (phaseId) {
    case 1:
      return {
        label: localWeekIndex % 2 === 0 ? "90-minute mini-test" : "120-minute mini-test",
        minutes: localWeekIndex % 2 === 0 ? 90 : 120,
        problemCount: localWeekIndex % 2 === 0 ? 2 : 2,
        goal: "Build proof discipline and stop wandering in timed work.",
      };
    case 2:
      return {
        label: "120-minute half-mock",
        minutes: 120,
        problemCount: 3,
        goal: "Convert mid-level problems and build SAMO-style pacing.",
      };
    case 3:
      return localWeekIndex % 2 === 0
        ? {
            label: "240-minute SAMO-style sitting",
            minutes: 240,
            problemCount: 4,
            goal: "Build endurance and pacing for longer national-level timed work.",
          }
        : {
            label: "120-minute half-mock",
            minutes: 120,
            problemCount: 3,
            goal: "Keep conversion sharp between longer timed sessions.",
          };
    case 4:
      return {
        label: "270-minute IMO-style paper",
        minutes: 270,
        problemCount: 3,
        goal: "Become reliable on Day-1 style mixed sets.",
      };
    case 5:
      return {
        label: "270-minute IMO-style paper",
        minutes: 270,
        problemCount: 3,
        goal: "Sustain weekly full-paper realism during camp and assignment season.",
      };
    case 6:
      return localWeekIndex % 2 === 0
        ? {
            label: "270-minute selection-peak paper",
            minutes: 270,
            problemCount: 3,
            goal: "Keep one-day paper sharp between two-day mocks.",
          }
        : null;
    default:
      return null;
  }
}

function isFirstWeekOfMonth(weekStart: string) {
  return Number(weekStart.slice(8, 10)) <= 7;
}

export function buildOlympiadBPlusBlueprints(): OlympiadSeedTopicBlueprint[] {
  const weekStarts = buildWeeklyDateKeys("2026-04-06", "2027-04-05");
  const phaseWeekCounters = new Map<PhaseId, number>();
  const previousStrandTopicIds: Partial<Record<StrandKey, string>> = {};
  const blueprints: OlympiadSeedTopicBlueprint[] = [];

  weekStarts.forEach((weekStart, globalWeekIndex) => {
    const phase = getOlympiadPhase(weekStart);

    if (!phase) {
      return;
    }

    const localWeekIndex = phaseWeekCounters.get(phase.id) ?? 0;
    phaseWeekCounters.set(phase.id, localWeekIndex + 1);
    const weekNumber = globalWeekIndex + 1;
    const paddedWeekNumber = String(weekNumber).padStart(2, "0");
    const unitId = `olympiad-phase-${phase.id}-week-${paddedWeekNumber}`;
    const unitTitle = `Olympiad B+ ${phase.label} - Week ${weekNumber}`;
    const sequenceStage = isLateFoundationPhase(phase.id) ? "foundation" : "advanced";

    const strandBuilders: Array<{
      key: Exclude<StrandKey, "contest" | "assignment">;
      offset: number;
      estHours: number;
      blockTypes: BlockType[];
      plansByPhase:
        | typeof geometryPlansByPhase
        | typeof algebraPlansByPhase
        | typeof numberTheoryPlansByPhase
        | typeof combinatoricsPlansByPhase;
      difficulty?: 4 | 5;
      titlePrefix: string;
      sequenceGroup: string;
    }> = [
      {
        key: "geometry",
        offset: 0,
        estHours: 2,
        blockTypes: ["deep_work", "standard_focus"],
        plansByPhase: geometryPlansByPhase,
        titlePrefix: "Geometry",
        sequenceGroup: "olympiad-geo",
      },
      {
        key: "algebra",
        offset: 1,
        estHours: 2,
        blockTypes: ["deep_work", "standard_focus"],
        plansByPhase: algebraPlansByPhase,
        titlePrefix: "Algebra / FE",
        sequenceGroup: "olympiad-alg",
      },
      {
        key: "number-theory",
        offset: 2,
        estHours: 1.5,
        blockTypes: ["standard_focus", "deep_work"],
        plansByPhase: numberTheoryPlansByPhase,
        titlePrefix: "Number Theory",
        sequenceGroup: "olympiad-nt",
      },
      {
        key: "combinatorics",
        offset: 3,
        estHours: 1.5,
        blockTypes: ["standard_focus", "deep_work"],
        plansByPhase: combinatoricsPlansByPhase,
        titlePrefix: "Combinatorics",
        sequenceGroup: "olympiad-combi",
      },
    ];

    strandBuilders.forEach((builder) => {
      const plan = getPlanForPhase(builder.plansByPhase as Record<PhaseId, ModulePlan[]>, phase.id, localWeekIndex);
      const topicId = `olympiad-bplus-${builder.key}-${paddedWeekNumber}`;
      blueprints.push({
        id: topicId,
        subjectId: "olympiad",
        unitId,
        unitTitle,
        title: `${builder.titlePrefix}: ${plan.title}`,
        subtopics: plan.subtopics,
        availableFrom: addDaysToDateKey(weekStart, builder.offset),
        dependsOnTopicId: previousStrandTopicIds[builder.key] ?? null,
        sequenceGroup: builder.sequenceGroup,
        sequenceStage,
        estHours: builder.estHours,
        difficulty: plan.difficulty ?? 4,
        preferredBlockTypes: builder.blockTypes,
        sourceMaterials: createExecutionBundle(plan),
      });
      previousStrandTopicIds[builder.key] = topicId;
    });

    const contestPlan = getPlanForPhase(contestPlansByPhase, phase.id, localWeekIndex);
    const contestTopicId = `olympiad-bplus-contest-${paddedWeekNumber}`;
    blueprints.push({
      id: contestTopicId,
      subjectId: "olympiad",
      unitId,
      unitTitle,
      title: `Contest systems: ${contestPlan.title}`,
      subtopics: contestPlan.subtopics,
      availableFrom: addDaysToDateKey(weekStart, 4),
      dependsOnTopicId: previousStrandTopicIds.contest ?? null,
      sequenceGroup: "olympiad-contest",
      sequenceStage,
      estHours: 1.5,
      difficulty: contestPlan.difficulty ?? 5,
      preferredBlockTypes: ["standard_focus", "review"],
      sourceMaterials: createExecutionBundle(contestPlan),
    });
    previousStrandTopicIds.contest = contestTopicId;

    const mockSpec = getMockSpecification(phase.id, localWeekIndex);
    const mockTopicIds: string[] = [];

    if (mockSpec) {
      const mockTopicId = `olympiad-bplus-mock-${paddedWeekNumber}`;
      blueprints.push({
        id: mockTopicId,
        subjectId: "olympiad",
        unitId,
        unitTitle,
        title: `${mockSpec.label} - week ${weekNumber}`,
        subtopics: [
          `Run ${mockSpec.problemCount} problems in one continuous sitting.`,
          "Use full contest conditions: no notes, no external help, full write-ups.",
          mockSpec.goal,
        ],
        availableFrom: addDaysToDateKey(weekStart, 5),
        sessionMode: "exam",
        exactSessionMinutes: mockSpec.minutes,
        estHours: mockSpec.minutes / 60,
        difficulty: 5,
        preferredBlockTypes: ["deep_work"],
        sourceMaterials: [
          pastPaper(MOCK_ARCHIVE_LABEL, `${mockSpec.label}; one continuous timed sitting.`),
          worksheet("Mock goal", mockSpec.goal),
          notes("Review protocol", "Mark immediately, classify the errors, then feed the best and worst problems into the conversion block."),
          notes("Re-solve target", "Re-solve at least one problem from this sitting within the next 72 hours."),
          pastPaper("Benchmark format", "Use official IMO or shortlist sets whenever possible; the session must feel exam-real."),
        ],
      });
      mockTopicIds.push(mockTopicId);
    }

    if (phase.id === 5 && isFirstWeekOfMonth(weekStart)) {
      const monthlyMockDayOneId = `olympiad-bplus-monthly-mock-${paddedWeekNumber}-day-1`;
      const monthlyMockDayTwoId = `olympiad-bplus-monthly-mock-${paddedWeekNumber}-day-2`;
      blueprints.push(
        {
          id: monthlyMockDayOneId,
          subjectId: "olympiad",
          unitId: `${unitId}-monthly-mock`,
          unitTitle: `${unitTitle} - Monthly full two-day mock`,
          title: `Monthly full two-day mock - Day 1 (${weekStart})`,
          subtopics: [
            "Run three problems in one uninterrupted 4.5-hour sitting.",
            "No notes or external help.",
            "Treat it as a selection-level paper, not a training drill.",
          ],
          availableFrom: addDaysToDateKey(weekStart, 5),
          sessionMode: "exam",
          exactSessionMinutes: 270,
          estHours: 4.5,
          difficulty: 5,
          preferredBlockTypes: ["deep_work"],
          sourceMaterials: [
            pastPaper(MOCK_ARCHIVE_LABEL, "Monthly full two-day mock, Day 1."),
            worksheet("Monthly mock goal", "Simulate selection/camp intensity with full contest conditions."),
            notes("Re-solve target", "Carry the hardest unsolved problem into the next two conversion blocks."),
            pastPaper("Benchmark format", "Use an official IMO paper or a shortlist set built to full-paper difficulty."),
            notes("Protocol", "Do not split the sitting or use shortened timing."),
          ],
        },
        {
          id: monthlyMockDayTwoId,
          subjectId: "olympiad",
          unitId: `${unitId}-monthly-mock`,
          unitTitle: `${unitTitle} - Monthly full two-day mock`,
          title: `Monthly full two-day mock - Day 2 (${addDaysToDateKey(weekStart, 6)})`,
          subtopics: [
            "Run the second three-problem set in one uninterrupted 4.5-hour sitting.",
            "Keep the same contest conditions as Day 1.",
            "Finish with a short performance note before the full postmortem.",
          ],
          availableFrom: addDaysToDateKey(weekStart, 6),
          dependsOnTopicId: monthlyMockDayOneId,
          minDaysAfterDependency: 1,
          maxDaysAfterDependency: 2,
          sessionMode: "exam",
          exactSessionMinutes: 270,
          estHours: 4.5,
          difficulty: 5,
          preferredBlockTypes: ["deep_work"],
          sourceMaterials: [
            pastPaper(MOCK_ARCHIVE_LABEL, "Monthly full two-day mock, Day 2."),
            worksheet("Monthly mock goal", "Complete the full two-day simulation and compare Day 1 versus Day 2 performance."),
            notes("Re-solve target", "Re-solve one full problem from the two-day mock before the next monthly cycle."),
            pastPaper("Benchmark format", "Keep Day 2 at the same realism level as Day 1."),
            notes("Protocol", "Treat the two days as one combined benchmark, not two unrelated papers."),
          ],
        },
      );
      mockTopicIds.push(monthlyMockDayTwoId);
    }

    if (phase.id === 6 && localWeekIndex % 2 === 1) {
      const peakMockDayOneId = `olympiad-bplus-selection-mock-${paddedWeekNumber}-day-1`;
      const peakMockDayTwoId = `olympiad-bplus-selection-mock-${paddedWeekNumber}-day-2`;
      blueprints.push(
        {
          id: peakMockDayOneId,
          subjectId: "olympiad",
          unitId: `${unitId}-selection-mock`,
          unitTitle: `${unitTitle} - Selection-peak full two-day mock`,
          title: `Selection-peak full mock - Day 1`,
          subtopics: [
            "Run a full 4.5-hour Day 1 paper.",
            "Hold full selection conditions.",
            "Record the first 45-minute decision points immediately after finishing.",
          ],
          availableFrom: addDaysToDateKey(weekStart, 5),
          sessionMode: "exam",
          exactSessionMinutes: 270,
          estHours: 4.5,
          difficulty: 5,
          preferredBlockTypes: ["deep_work"],
          sourceMaterials: [
            pastPaper(MOCK_ARCHIVE_LABEL, "Selection-peak full two-day mock, Day 1."),
            worksheet("Selection-peak goal", "Stability, speed, and confidence under full-paper conditions."),
            notes("Re-solve target", "Carry the best unsolved problem into the next conversion block."),
            pastPaper("Benchmark format", "Use an official IMO paper or equivalent shortlist-built mock."),
            notes("Protocol", "This is a benchmark sitting, not a casual long practice block."),
          ],
        },
        {
          id: peakMockDayTwoId,
          subjectId: "olympiad",
          unitId: `${unitId}-selection-mock`,
          unitTitle: `${unitTitle} - Selection-peak full two-day mock`,
          title: `Selection-peak full mock - Day 2`,
          subtopics: [
            "Run a full 4.5-hour Day 2 paper.",
            "Keep exactly the same contest conditions as Day 1.",
            "Compare pacing, confidence, and finish quality between the two days.",
          ],
          availableFrom: addDaysToDateKey(weekStart, 6),
          dependsOnTopicId: peakMockDayOneId,
          minDaysAfterDependency: 1,
          maxDaysAfterDependency: 2,
          sessionMode: "exam",
          exactSessionMinutes: 270,
          estHours: 4.5,
          difficulty: 5,
          preferredBlockTypes: ["deep_work"],
          sourceMaterials: [
            pastPaper(MOCK_ARCHIVE_LABEL, "Selection-peak full two-day mock, Day 2."),
            worksheet("Selection-peak goal", "Finish the full two-day benchmark before the final April-camp push."),
            notes("Re-solve target", "Re-solve one full problem from the two-day mock before the next paper."),
            pastPaper("Benchmark format", "Treat this as the closest simulation to the final selection environment."),
            notes("Protocol", "Do not shorten or split the sitting."),
          ],
        },
      );
      mockTopicIds.push(peakMockDayTwoId);
    }

    const pairReviewDependencyId = mockTopicIds[mockTopicIds.length - 1];
    if (pairReviewDependencyId) {
      blueprints.push({
        id: `olympiad-bplus-pair-review-${paddedWeekNumber}`,
        subjectId: "olympiad",
        unitId: `${unitId}-pair-review`,
        unitTitle: `${unitTitle} - Pair review`,
        title: `Pair review and proof exchange - week ${weekNumber}`,
        subtopics: [
          "Bring one problem attempted alone before meeting.",
          "Exchange only after both full drafts exist.",
          "Reviewers may flag logic gaps and unclear steps, but may not inject new key ideas.",
        ],
        availableFrom: addDaysToDateKey(weekStart, 6),
        dependsOnTopicId: pairReviewDependencyId,
        minDaysAfterDependency: 1,
        maxDaysAfterDependency: 4,
        sequenceGroup: "olympiad-contest",
        sequenceStage,
        estHours: 1.5,
        difficulty: 4,
        preferredBlockTypes: ["review", "standard_focus"],
        sourceMaterials: [
          notes("Peer-work protocol", "Pair review happens only after the week's solo timed attempt has a full draft."),
          worksheet("Pair-review target", "Exchange one full draft each and mark only logical gaps, unclear claims, or missing justifications."),
          notes("Re-solve target", "Repair the reviewed proof alone after the session and record what changed."),
          pastPaper("Benchmark source", "Use the current week's mock or shortlist problem as the review source."),
          notes("Protocol", "The session exists to sharpen proof quality, not to outsource ideas."),
        ],
      });

      if (weekNumber % 2 === 0) {
        blueprints.push({
          id: `olympiad-bplus-group-critique-${paddedWeekNumber}`,
          subjectId: "olympiad",
          unitId: `${unitId}-group-critique`,
          unitTitle: `${unitTitle} - Group critique`,
          title: `Biweekly group proof critique - week ${weekNumber}`,
          subtopics: [
            "Choose one topic focus for the session.",
            "Each person presents one independently attempted solution.",
            "The group critiques clarity, structure, and missing steps only.",
          ],
          availableFrom: addDaysToDateKey(weekStart, 6),
          dependsOnTopicId: `olympiad-bplus-pair-review-${paddedWeekNumber}`,
          minDaysAfterDependency: 0,
          maxDaysAfterDependency: 7,
          sequenceGroup: "olympiad-contest",
          sequenceStage,
          estHours: 2,
          difficulty: 4,
          preferredBlockTypes: ["review", "standard_focus"],
          sourceMaterials: [
            notes("Group protocol", "One topic per session; every participant presents an independently attempted solution."),
            worksheet("Group-review target", "Critique proof clarity and omitted steps without supplying fresh key ideas."),
            notes("Re-solve target", "After the session, rewrite the weakest presented proof alone."),
            pastPaper("Benchmark source", "Use an inversion, FE, NT, or combinatorics problem already attempted solo."),
            notes("Protocol", "The goal is proof quality and communication, not collaborative idea generation."),
          ],
        });
      }
    }

    const month = weekStart.slice(0, 7);
    if (["2027-01", "2027-02", "2027-03"].includes(month) && isFirstWeekOfMonth(weekStart)) {
      const assignmentTopicId = `olympiad-bplus-assignment-${month}`;
      blueprints.push({
        id: assignmentTopicId,
        subjectId: "olympiad",
        unitId: `olympiad-assignment-${month}`,
        unitTitle: `Olympiad monthly assignment sprint - ${month}`,
        title: `Monthly assignment sprint - ${month}`,
        subtopics: [
          "Treat the assignment as selection-relevant work.",
          "Draft at least one full solution to assignment quality.",
          "Finish with a short correction and polish pass.",
        ],
        availableFrom: addDaysToDateKey(weekStart, 4),
        dependsOnTopicId: previousStrandTopicIds.assignment ?? null,
        sequenceGroup: "olympiad-contest",
        sequenceStage: "advanced",
        estHours: 2,
        difficulty: 5,
        preferredBlockTypes: ["deep_work", "standard_focus"],
        sourceMaterials: [
          notes("SAMF assignment pipeline", "From January through March, monthly assignments are treated as selection-relevant work."),
          worksheet("Assignment target", "Finish one assignment-grade proof and one partial-to-full repair."),
          notes("Re-solve target", "Re-solve the hardest assignment problem from memory before the next monthly sprint."),
          pastPaper("Benchmark source", "Use the month's assignment or the closest selection-style shortlist set."),
          notes("Protocol", "Assignment work must be polished enough to submit, not just sketched."),
        ],
      });
      previousStrandTopicIds.assignment = assignmentTopicId;
    }
  });

  return blueprints;
}
