# Daily Pacing, Subject Interleaving, and Planned Breaks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pace Maths AA HL, Physics HL, and Chemistry HL syllabus coverage through October 24, interleave eligible subjects instead of clustering them, and create real 15-minute calendar breaks after each 90 minutes of continuous study when breaks are enabled.

**Architecture:** Add two focused pure scheduler modules: one computes capacity-weighted cumulative core-syllabus targets, and one owns study-continuity and persisted break semantics. The existing generator receives a single pacing plan per horizon run, uses pacing deficits and recent-subject context during candidate filtering, and allocates subjectless `Break` blocks as real capacity. Weekly plans persist only derived diagnostics; topics, goals, dependencies, local-first storage, and planner mutations remain unchanged.

**Tech Stack:** TypeScript, Next.js 16, date-fns, Dexie, FullCalendar, Zod, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-18-daily-pacing-interleaving-breaks-design.md`

## Global Constraints

- The first syllabus milestones remain October 31, 2026; pacing targets October 24, 2026 as the one-week safety buffer.
- Weekly workload remains diagnostic and must not stop daily allocation.
- Maths AA HL remains strict SL then HL; Physics, Chemistry, and Olympiad dependency order remains hard.
- No reinforcement may appear while any visible core subject has positive real unscheduled minutes.
- Exact exam sessions remain uninterrupted.
- Breaks remain disabled by default; when enabled, the effective minimum is 15 minutes.
- A hard boundary or natural pause of at least the effective break duration resets continuous study.
- No new user settings, top-level planner entities, or import/export shape changes.
- Full-horizon regeneration remains explicit/manual; the model-version bump marks existing output stale without rebuilding on refresh.

---

### Task 1: Capacity-Weighted Core Syllabus Pacing Ledger

**Files:**
- Create: `src/lib/scheduler/core-syllabus-pacing.ts`
- Modify: `tests/planner-regressions.test.ts`

**Interfaces:**
- Consumes: `Topic[]`, `StudyBlock[]`, a planning start date, and `capacityMinutesByDate: Record<string, number>`.
- Produces: `CORE_HL_PACING_TARGET_DATE_KEY`, `CoreSyllabusPacingPlan`, `buildCoreSyllabusPacingPlan(...)`, `getCoreSyllabusPacingTargetMinutes(...)`, and `getCoreSyllabusPacingDeficitMinutes(...)`.

- [ ] **Step 1: Write failing pure pacing tests**

Add imports and tests that prove blocked dates receive no artificial target and that targets follow capacity rather than raw date count:

```ts
import {
  buildCoreSyllabusPacingPlan,
  getCoreSyllabusPacingDeficitMinutes,
} from "@/lib/scheduler/core-syllabus-pacing";

test("core syllabus pacing weights cumulative targets by real study capacity", () => {
  const dataset = buildSeedDataset(new Date("2026-10-20T08:00:00"));
  const baseTopic = dataset.topics.find(
    (topic) => topic.subjectId === "physics-hl" && !topic.unitId.includes("past-papers"),
  );
  assert.ok(baseTopic);
  const topics = [
    {
      ...baseTopic,
      id: "physics-paced",
      subjectId: "physics-hl" as const,
      unitId: "physics-syllabus",
      estHours: 4,
      completedHours: 0,
    },
  ];
  const plan = buildCoreSyllabusPacingPlan({
    startDate: new Date("2026-10-20T08:00:00"),
    topics,
    capacityMinutesByDate: {
      "2026-10-20": 60,
      "2026-10-21": 0,
      "2026-10-22": 180,
    },
    targetDateKey: "2026-10-22",
  });

  assert.equal(plan.targetMinutesByDate["2026-10-20"]?.["physics-hl"], 60);
  assert.equal(plan.targetMinutesByDate["2026-10-21"]?.["physics-hl"], 60);
  assert.equal(plan.targetMinutesByDate["2026-10-22"]?.["physics-hl"], 240);
  assert.equal(
    getCoreSyllabusPacingDeficitMinutes(plan, "physics-hl", "2026-10-20", 30),
    30,
  );
});
```

- [ ] **Step 2: Run the pacing test and verify failure**

Run:

```bash
node --experimental-strip-types --import ./scripts/register-ts-loader.mjs --test --test-name-pattern="core syllabus pacing weights" tests/planner-regressions.test.ts
```

Expected: FAIL because `core-syllabus-pacing.ts` does not exist.

- [ ] **Step 3: Implement the pure pacing ledger**

Create these exact public types and functions:

```ts
export const CORE_HL_PACING_TARGET_DATE_KEY = "2026-10-24";

export interface CoreSyllabusPacingPlan {
  startDateKey: string;
  targetDateKey: string;
  capacityMinutesByDate: Record<string, number>;
  totalMinutesBySubject: Record<string, number>;
  targetMinutesByDate: Record<string, Record<string, number>>;
}

export function buildCoreSyllabusPacingPlan(options: {
  startDate: Date;
  topics: Topic[];
  capacityMinutesByDate: Record<string, number>;
  targetDateKey?: string;
}): CoreSyllabusPacingPlan;

export function getCoreSyllabusPacingTargetMinutes(
  plan: CoreSyllabusPacingPlan | null | undefined,
  subjectId: SubjectId,
  dateKey: string,
): number;

export function getCoreSyllabusPacingDeficitMinutes(
  plan: CoreSyllabusPacingPlan | null | undefined,
  subjectId: SubjectId,
  dateKey: string,
  assignedMinutes: number,
): number;
```

Implementation rules:

```ts
const remainingMinutes = Math.max(
  0,
  Math.round((topic.estHours - topic.completedHours) * 60),
);
const cumulativeShare = totalCapacity > 0 ? cumulativeCapacity / totalCapacity : 1;
const roundedTarget = Math.min(
  totalMinutes,
  Math.round((totalMinutes * cumulativeShare) / 15) * 15,
);
```

Use `isCoreHlSyllabusTopic(topic)` as the only content classifier. Carry the previous cumulative target across zero-capacity dates and force the final target date to the exact subject total.

- [ ] **Step 4: Run the focused pacing test**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit the pacing ledger**

```bash
git add src/lib/scheduler/core-syllabus-pacing.ts tests/planner-regressions.test.ts
git commit -m "feat: add capacity weighted core pacing"
```

---

### Task 2: Planned Break and Continuity Primitives

**Files:**
- Create: `src/lib/scheduler/study-breaks.ts`
- Modify: `tests/planner-regressions.test.ts`

**Interfaces:**
- Consumes: preferences, study blocks on one date, a cursor timestamp, and slot duration.
- Produces: `STUDY_BREAK_TRIGGER_MINUTES`, `getEffectiveStudyBreakMinutes(...)`, `getEffectiveStudyCapacityMinutes(...)`, `isPlannedStudyBreakBlock(...)`, `getStudyContinuityContext(...)`, and `buildPlannedStudyBreakBlock(...)`.

- [ ] **Step 1: Write failing break-primitive tests**

Add tests for capacity accounting, continuity reset, and the persisted block shape:

```ts
test("enabled breaks reserve 15 minutes after each usable 90-minute run", () => {
  assert.equal(getEffectiveStudyCapacityMinutes(90, 15), 90);
  assert.equal(getEffectiveStudyCapacityMinutes(105, 15), 90);
  assert.equal(getEffectiveStudyCapacityMinutes(150, 15), 135);
  assert.equal(getEffectiveStudyCapacityMinutes(210, 15), 180);
});

test("a persisted planned break resets continuous study", () => {
  const breakBlock = buildPlannedStudyBreakBlock({
    weekStart: "2026-08-17",
    dateKey: "2026-08-18",
    start: new Date("2026-08-18T10:30:00.000Z"),
    durationMinutes: 15,
    slotEnergy: "steady",
  });
  const context = getStudyContinuityContext({
    blocks: [
      createStudyBlock({ start: "2026-08-18T09:00:00.000Z", end: "2026-08-18T10:30:00.000Z", estimatedMinutes: 90 }),
      breakBlock,
    ],
    dateKey: "2026-08-18",
    cursor: new Date("2026-08-18T10:45:00.000Z"),
    resetMinutes: 15,
  });

  assert.equal(isPlannedStudyBreakBlock(breakBlock), true);
  assert.equal(context.continuousStudyMinutes, 0);
  assert.equal(context.followsPlannedBreak, true);
});
```

- [ ] **Step 2: Run the break-primitive tests and verify failure**

Run:

```bash
node --experimental-strip-types --import ./scripts/register-ts-loader.mjs --test --test-name-pattern="enabled breaks reserve|persisted planned break resets" tests/planner-regressions.test.ts
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Implement break primitives**

Use these exact signatures:

```ts
export const STUDY_BREAK_TRIGGER_MINUTES = 90;

export interface StudyContinuityContext {
  continuousStudyMinutes: number;
  sameSubjectRunMinutes: number;
  previousSubjectId: SubjectId | null;
  followsPlannedBreak: boolean;
}

export function getEffectiveStudyBreakMinutes(preferences: Preferences): number;
export function getEffectiveStudyCapacityMinutes(slotMinutes: number, breakMinutes: number): number;
export function isPlannedStudyBreakBlock(block: Pick<StudyBlock, "subjectId" | "topicId" | "title" | "blockType" | "isAutoGenerated">): boolean;
export function getStudyContinuityContext(options: {
  blocks: StudyBlock[];
  dateKey: string;
  cursor: Date;
  resetMinutes: number;
}): StudyContinuityContext;
export function buildPlannedStudyBreakBlock(options: {
  weekStart: string;
  dateKey: string;
  start: Date;
  durationMinutes: number;
  slotEnergy: EnergyLevel;
}): StudyBlock;
```

The generated block must be subjectless, topicless, `blockType: "recovery"`, `intensity: "light"`, `title: "Break"`, `creationSource: "planner"`, and have zeroed score fields. Continuity walks backward through same-day subject blocks, stops at a persisted break or a gap `>= resetMinutes`, and reports only the final same-subject run separately from total continuous study.

- [ ] **Step 4: Run the focused break tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit break primitives**

```bash
git add src/lib/scheduler/study-breaks.ts tests/planner-regressions.test.ts
git commit -m "feat: add planned study break primitives"
```

---

### Task 3: Integrate Daily Pacing and Subject Interleaving Into Allocation

**Files:**
- Modify: `src/lib/scheduler/generator.ts`
- Modify: `src/lib/scheduler/school-term-template.ts`
- Modify: `tests/planner-regressions.test.ts`

**Interfaces:**
- Consumes: `CoreSyllabusPacingPlan` from Task 1 and study continuity from Task 2.
- Produces: optional `coreSyllabusPacingPlan` input on `generateStudyPlanForWeek(...)`; deterministic candidate filtering/ranking that respects pacing and 90-minute subject runs.

- [ ] **Step 1: Write failing allocator interleaving tests**

Add one normal-capacity fixture with open independent Maths, Physics, and Chemistry topics. Assert:

```ts
function getLongestContiguousSubjectRunMinutes(blocks: StudyBlock[]) {
  let longest = 0;
  let currentSubjectId: StudyBlock["subjectId"] = null;
  let currentEnd = 0;
  let currentMinutes = 0;

  [...blocks]
    .filter((block) => block.subjectId)
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime())
    .forEach((block) => {
      const start = new Date(block.start).getTime();
      if (block.subjectId === currentSubjectId && start === currentEnd) {
        currentMinutes += block.estimatedMinutes;
      } else {
        currentSubjectId = block.subjectId;
        currentMinutes = block.estimatedMinutes;
      }
      currentEnd = new Date(block.end).getTime();
      longest = Math.max(longest, currentMinutes);
    });

  return longest;
}

assert.ok(distinctDateKeysBySubject["maths-aa-hl"].size >= 3);
assert.ok(distinctDateKeysBySubject["physics-hl"].size >= 3);
assert.ok(distinctDateKeysBySubject["chemistry-hl"].size >= 3);
assert.ok(getLongestContiguousSubjectRunMinutes(result.studyBlocks) <= 90);
```

Also assert a dependency fixture with only one eligible subject still schedules work rather than leaving the slot empty.

- [ ] **Step 2: Run the interleaving tests and verify failure**

Run:

```bash
node --experimental-strip-types --import ./scripts/register-ts-loader.mjs --test --test-name-pattern="paces all three core subjects across distinct days|dependency-only capacity remains schedulable" tests/planner-regressions.test.ts
```

Expected: the current global core filter clusters subjects and fails the spread/run assertion.

- [ ] **Step 3: Replace the global core filter with pacing-aware eligibility**

In `allocateTasksToSlots(...)`:

```ts
coreSyllabusPacingPlan?: CoreSyllabusPacingPlan;
```

Initialize cumulative core assigned minutes from unique `priorPlannedBlocks` and `lockedBlocks` that start on or after `plan.startDateKey` and whose topics satisfy `isCoreHlSyllabusTopic`. Increment this ledger whenever a core syllabus block is placed.

Replace `hasEligibleCoreHlSyllabusTask(...)` with:

```ts
function getUnderPaceCoreSubjectIds(slotStart: Date, dateKey: string) {
  return IB_ANCHOR_SUBJECT_IDS.filter((subjectId) =>
    hasEligibleTaskForSubject(subjectId, slotStart) &&
    getCoreSyllabusPacingDeficitMinutes(
      options.coreSyllabusPacingPlan,
      subjectId,
      dateKey,
      corePacingAssignedMinutesBySubject[subjectId] ?? 0,
    ) > 0
  );
}
```

When this set is non-empty, normal candidate selection admits only core syllabus tasks from those subjects. Explicit focused-day requirements and the two Olympiad continuity template requirements retain their existing override path. When the set is empty, normal real Olympiad and C++ candidates remain eligible before ahead-of-pace core work.

- [ ] **Step 4: Add deterministic interleaving filters and bonuses**

Build the eligible task array before mapping to block options. If continuity reports `sameSubjectRunMinutes >= 90` and at least one differently-subjected eligible task exists, remove the previous subject. After a planned break, apply the same different-subject preference. Add a large deterministic spread adjustment for an unfinished core subject that has appeared on fewer than three distinct dates this week and has not yet appeared on the current date:

```ts
const spreadAdjustment =
  isCoreHlSyllabusTask(task) &&
  coreStudyDateKeysBySubject[task.subjectId!].size < 3 &&
  !coreStudyDateKeysBySubject[task.subjectId!].has(dateKey)
    ? 700
    : 0;
```

Rank under-pace core subjects by pacing deficit first, then least-recent study timestamp, then the existing score. Remove the positive same-subject `CONTINUITY_BONUS` when an alternative due subject exists.

- [ ] **Step 5: Make school-term minima respect the pacing ledger**

Keep the existing weekday anchor requirements, but have `getUnmetTemplateRequirements(dateKey)` ignore a core requirement after that subject reaches its cumulative pacing target for that date. Do not suppress explicit paper, focused-day, or Olympiad continuity requirements.

- [ ] **Step 6: Run interleaving and ordering regressions**

Run:

```bash
node --experimental-strip-types --import ./scripts/register-ts-loader.mjs --test --test-name-pattern="paces all three core subjects|dependency-only|Maths.*SL|Olympiad.*gate|Chemistry.*order" tests/planner-regressions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit allocator pacing/interleaving**

```bash
git add src/lib/scheduler/generator.ts src/lib/scheduler/school-term-template.ts tests/planner-regressions.test.ts
git commit -m "feat: pace and interleave core syllabus work"
```

---

### Task 4: Allocate Real 90/15 Break Blocks in Coverage and Reinforcement Phases

**Files:**
- Modify: `src/lib/scheduler/generator.ts`
- Modify: `tests/planner-regressions.test.ts`

**Interfaces:**
- Consumes: break helpers from Task 2.
- Produces: real subjectless `Break` blocks in both real-coverage allocation and post-coverage reinforcement fill.

- [ ] **Step 1: Write failing generated-break tests**

Add configured fixtures proving:

```ts
test("enabled breaks persist a 15-minute break before study continues past 90 minutes", () => {
  const result = generateStudyPlanForWeek(/* one 150+ minute free slot */);
  const breakBlock = result.studyBlocks.find(isPlannedStudyBreakBlock);
  assert.ok(breakBlock);
  assert.equal(breakBlock?.estimatedMinutes, 15);
  assert.equal(new Date(breakBlock!.end).getTime() - new Date(breakBlock!.start).getTime(), 15 * 60_000);
  const ordered = [...result.studyBlocks].sort(
    (left, right) => new Date(left.start).getTime() - new Date(right.start).getTime(),
  );
  assert.ok(
    ordered.every(
      (block, index) =>
        !ordered[index + 1] ||
        new Date(block.end).getTime() <= new Date(ordered[index + 1].start).getTime(),
    ),
  );
});
```

Add cases for breaks disabled, a natural 15-minute fixed-event pause, and a 120-minute exact exam followed by another study candidate.

- [ ] **Step 2: Run generated-break tests and verify failure**

Run:

```bash
node --experimental-strip-types --import ./scripts/register-ts-loader.mjs --test --test-name-pattern="enabled breaks persist|natural 15-minute pause|exact exam.*break|disabled breaks remain tight" tests/planner-regressions.test.ts
```

Expected: FAIL because current non-exam allocation never creates a break block.

- [ ] **Step 3: Allocate breaks inside `allocateTasksToSlots(...)`**

Use `getEffectiveStudyBreakMinutes(preferences)`; do not allow fallback pass `minBreakMinutes` values to reduce the configured duration. Before each candidate selection:

```ts
const continuity = getStudyContinuityContext({
  blocks: [...options.lockedBlocks, ...scheduledBlocks],
  dateKey: slot.dateKey,
  cursor,
  resetMinutes: effectiveBreakMinutes,
});
const breakDue = breaksEnabled &&
  continuity.continuousStudyMinutes >= STUDY_BREAK_TRIGGER_MINUTES;
```

If a break is due and `remainingSlotMinutes >= effectiveBreakMinutes + MIN_ALLOCATABLE_MINUTES`, append `buildPlannedStudyBreakBlock(...)`, advance `cursor`, reduce remaining capacity, and continue. If no further study can fit, stop the slot without creating an end-of-day break.

For flexible non-exam tasks, cap the candidate slot to `90 - continuousStudyMinutes`. Exact exam candidates continue using the original slot duration. Never extend a flexible block beyond the 90-minute boundary in trailing-gap saturation or micro-gap absorption when breaks are enabled.

- [ ] **Step 4: Preserve planned breaks across allocation passes**

Replace capacity-blocking filters such as:

```ts
scheduledBlocks.filter((block) => block.subjectId)
```

with a helper that retains subject study blocks and `isPlannedStudyBreakBlock(block)`. Forced-coverage passes may reclaim generic `Recovery / buffer` blocks, but must not reclaim a planned `Break`. Candidate coverage calculations still receive subject blocks only.

- [ ] **Step 5: Add breaks to reinforcement fill**

In `fillReinforcementForWeek(...)`, allocate at most 90 continuous reinforcement minutes, insert a persisted break when another 30-minute block can follow, then choose the next reinforcement subject using the existing least-used daily/weekly ordering. Break blocks do not increment reinforcement counts or subject minutes.

- [ ] **Step 6: Run break and zero-coverage regressions**

Run:

```bash
node --experimental-strip-types --import ./scripts/register-ts-loader.mjs --test --test-name-pattern="enabled breaks persist|natural 15-minute pause|exact exam.*break|disabled breaks remain tight|zero.*unscheduled|real core work is scheduled before any reinforcement" tests/planner-regressions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit real break allocation**

```bash
git add src/lib/scheduler/generator.ts tests/planner-regressions.test.ts
git commit -m "fix: allocate real study breaks"
```

---

### Task 5: Build One Pacing Plan per Horizon and Persist Derived Diagnostics

**Files:**
- Modify: `src/lib/scheduler/generator.ts`
- Modify: `src/lib/scheduler/feasibility.ts`
- Modify: `src/lib/types/planner.ts`
- Modify: `src/lib/types/schemas.ts`
- Modify: `src/lib/storage/planner-repository.ts`
- Modify: `tests/planner-regressions.test.ts`

**Interfaces:**
- Consumes: pacing and break helpers from Tasks 1-2.
- Produces: a cached horizon pacing plan and optional weekly diagnostic fields.

- [ ] **Step 1: Write failing horizon-pacing and diagnostic tests**

Extend the seeded horizon test to calculate the latest non-paper core syllabus block by subject. Require each to finish during `2026-10-18` through `2026-10-24` unless its remaining minutes were already zero at the reference date. Assert the week containing October 24 exposes non-empty pacing targets, distinct-day counts, max-run data, and planned-break totals when enabled.

- [ ] **Step 2: Run the focused horizon test and verify failure**

Run:

```bash
node --experimental-strip-types --import ./scripts/register-ts-loader.mjs --test --test-name-pattern="all three core HL syllabi finish in the October safety-buffer week|weekly plans expose pacing and break diagnostics" tests/planner-regressions.test.ts
```

Expected: current scheduling finishes subjects too early and has no new diagnostics.

- [ ] **Step 3: Precompute effective capacity once per horizon**

Add an internal generator helper that loops from `referenceDate` through October 24 by planner week, calls `calculateFreeSlots(...)` with no generated study blocks and the shared `SchedulingRunContext`, then records per-date effective study capacity:

```ts
capacityMinutesByDate[slot.dateKey] =
  (capacityMinutesByDate[slot.dateKey] ?? 0) +
  getEffectiveStudyCapacityMinutes(slot.durationMinutes, effectiveBreakMinutes);
```

Build one `CoreSyllabusPacingPlan` in `generateStudyPlanHorizon(...)` and one in `generateIncrementalStudyPlanTail(...)`; pass it into every weekly generation call. `generateStudyPlanForWeek(...)` builds a fallback plan only when called directly without one.

- [ ] **Step 4: Add weekly derived fields**

Add optional fields to `WeeklyPlan`, `weeklyPlanSchema`, and normalization:

```ts
corePacingTargetMinutesByDate?: Record<string, Record<string, number>>;
corePacingAssignedMinutesBySubject?: Record<string, number>;
coreDistinctStudyDaysBySubject?: Record<string, number>;
maxConsecutiveStudyMinutesBySubject?: Record<string, number>;
plannedBreakCount?: number;
plannedBreakMinutes?: number;
pacingRescueReasonBySubject?: Record<string, string>;
```

Extend `buildWeeklyPlan(...)` options with the same derived inputs. Defaults are empty records/zero so legacy exports remain valid. Compute break totals only from `isPlannedStudyBreakBlock`, and do not include them in subject assigned hours.

- [ ] **Step 5: Bump the model version without automatic regeneration**

Change:

```ts
const PLANNING_MODEL_VERSION = "2026-08-18-daily-pacing-breaks-v67";
```

Keep the existing startup behavior: the mismatch marks the horizon stale and prompts for explicit regeneration; it does not regenerate on refresh.

- [ ] **Step 6: Run focused horizon and persistence tests**

Run:

```bash
node --experimental-strip-types --import ./scripts/register-ts-loader.mjs --test --test-name-pattern="October safety-buffer week|pacing and break diagnostics|stale model version on startup|hard refresh" tests/planner-regressions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit horizon pacing integration**

```bash
git add src/lib/scheduler/generator.ts src/lib/scheduler/feasibility.ts src/lib/types/planner.ts src/lib/types/schemas.ts src/lib/storage/planner-repository.ts tests/planner-regressions.test.ts
git commit -m "feat: integrate horizon pacing diagnostics"
```

---

### Task 6: Render Persisted Breaks Without Calendar Duplication

**Files:**
- Modify: `src/components/calendar/planner-calendar.tsx`
- Modify: `tests/planner-regressions.test.ts`

**Interfaces:**
- Consumes: `isPlannedStudyBreakBlock(...)` from Task 2.
- Produces: one read-only calendar event per persisted break; legacy inferred gaps remain only when no persisted break overlaps them.

- [ ] **Step 1: Write failing calendar rendering tests**

Add a persisted break between two study blocks and assert:

```ts
const events = buildVisibleBreakEvents({
  studyBlocks: [firstStudy, persistedBreak, secondStudy],
  weekStart: "2026-08-17",
  minBreakMinutes: 15,
  blockedIntervals: [],
});

assert.equal(events.length, 1);
assert.equal(events[0]?.id, `break:${persistedBreak.id}`);
assert.equal(events[0]?.extendedProps.gapMinutes, 15);
```

Retain the existing zero-duration and overlap tests.

- [ ] **Step 2: Run the calendar-break tests and verify failure**

Run:

```bash
node --experimental-strip-types --import ./scripts/register-ts-loader.mjs --test --test-name-pattern="persisted calendar break renders exactly once|visible calendar breaks" tests/planner-regressions.test.ts
```

Expected: current code treats the persisted break as a study event and does not return it from `buildVisibleBreakEvents`.

- [ ] **Step 3: Render persisted breaks and suppress duplicates**

In `buildVisibleBreakEvents(...)`, first map persisted planned break blocks to `kind: "break"` events. Infer a legacy gap only when it does not overlap a persisted break. In `calendarEvents`, filter planned break blocks out of the generic `kind: "study"` mapping.

- [ ] **Step 4: Run calendar tests**

Run the Step 2 command. Expected: PASS.

- [ ] **Step 5: Commit calendar break rendering**

```bash
git add src/components/calendar/planner-calendar.tsx tests/planner-regressions.test.ts
git commit -m "fix: render persisted study breaks once"
```

---

### Task 7: Full Regression, Performance, and Production Verification

**Files:**
- Modify only if verification finds a defect in files already listed above.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: verified deterministic schedule and production-compatible builds.

- [ ] **Step 1: Run the complete planner test suite**

```bash
npm test
```

Expected: all tests pass, including zero raw unscheduled minutes, dependency order, no overlap, paper timing, French tune-up cap, and manual-only regeneration.

- [ ] **Step 2: Run static checks**

```bash
npm run typecheck
npm run lint
```

Expected: both commands exit 0 with no new warnings.

- [ ] **Step 3: Run the replan benchmark**

```bash
npm run benchmark:replan
```

Expected: the report completes; full-horizon generation remains in the same order of magnitude as the pre-change baseline because pacing capacity is built once per run, not once per generated week.

- [ ] **Step 4: Build both deployment modes**

```bash
npm run build
npm run build:pages
```

Expected: Vercel and GitHub Pages builds compile successfully and the Pages script restores `src/app/api` after completion.

- [ ] **Step 5: Inspect generated horizon invariants**

Use the seeded regression output to verify:

```text
Maths AA HL real unscheduled minutes: 0
Physics HL real unscheduled minutes: 0
Chemistry HL real unscheduled minutes: 0
Olympiad real unscheduled minutes: 0
C++ real unscheduled minutes: 0
Core syllabus completion window: 2026-10-18 through 2026-10-24
Maximum avoidable same-subject continuous run: 90 minutes
Enabled break cadence: 15 minutes after each continuing 90-minute run
Overlap validation errors: 0
```

- [ ] **Step 6: Review the final diff for scope and dead code**

```bash
git diff --check HEAD~6..HEAD
git status --short
```

Expected: no whitespace errors, no unrelated files, no untracked generated artifacts.

- [ ] **Step 7: Commit any verification-only correction**

Only if Step 1-6 required a correction:

```bash
git add src/lib/scheduler/core-syllabus-pacing.ts src/lib/scheduler/study-breaks.ts src/lib/scheduler/generator.ts src/lib/scheduler/school-term-template.ts src/lib/scheduler/feasibility.ts src/lib/types/planner.ts src/lib/types/schemas.ts src/lib/storage/planner-repository.ts src/components/calendar/planner-calendar.tsx tests/planner-regressions.test.ts
git commit -m "fix: close pacing and break regressions"
```
