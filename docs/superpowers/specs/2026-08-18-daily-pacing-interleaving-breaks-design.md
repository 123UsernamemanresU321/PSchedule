# Daily Pacing, Subject Interleaving, and Planned Breaks Design

## Goal

Spread Maths AA HL, Physics HL, and Chemistry HL syllabus work steadily through October 2026, prevent long single-subject clusters, and reserve real healthy breaks whenever breaks are enabled.

## Scope

This changes deterministic scheduling policy only. Existing planner entities, dependencies, fixed-event handling, local-first storage, import/export, and explicit manual regeneration remain unchanged.

## Core Syllabus Pacing

- The pacing target for the first Maths AA HL, Physics HL, and Chemistry HL syllabus milestones is October 24, 2026, providing a one-week safety buffer before the October 31 milestone.
- At the start of each generated week, compute each subject's raw remaining syllabus minutes. Exclude post-syllabus papers, paper reviews, and synthetic reinforcement.
- Divide remaining syllabus minutes across the remaining study-eligible capacity through October 24. Weight each date by its free study minutes after fixed events, school commitments, homework, piano, recovery, clubs, exam rules, and unavailable windows are subtracted; do not give a fully blocked date an artificial target. Recalculate after every generated week so missed work automatically carries forward.
- Derive cumulative per-day targets rather than a weekly stopping cap. Earlier under-delivery increases subsequent daily targets; earlier over-delivery reduces them.
- While a subject is at or ahead of its cumulative target, prefer another under-target core subject. Once all core targets for that date are met, fill remaining capacity with real Olympiad work, then real C++ work, then other eligible work.
- If projected capacity becomes insufficient, deadline rescue overrides pacing and allocates additional core work. The zero-unscheduled invariant and dependency ordering remain stricter than smooth pacing.
- Do not generate reinforcement while any visible core subject still has real unscheduled work.

## Subject Interleaving

- No subject may occupy more than 90 consecutive study minutes when another eligible subject has due work.
- After a planned break, prefer a different subject from the one studied immediately before the break.
- While their syllabi remain open, Maths AA HL, Physics HL, and Chemistry HL should each appear on at least three distinct days per full planner week when capacity permits. Partial current weeks, exam-heavy weeks, and weeks with fewer than three eligible study days report the shortfall but do not violate hard calendar constraints.
- Daily selection first favors the most behind cumulative core subject, then the least recently studied eligible subject, then the existing deterministic score.
- If no alternative eligible task exists because of dependencies, exact-session fit, or availability, continuing the same subject is allowed rather than leaving capacity blank.
- Maths AA HL remains strict SL then HL in seeded order. Physics and Chemistry retain seeded dependency order. Olympiad retains B+ strand and stage gates.

## Planned Breaks

- Breaks remain off by default. When enabled, the effective break duration is at least the configured minimum, with 15 minutes as the legacy/default enabled value.
- Track continuous study minutes independently for each day.
- After exactly 90 accumulated continuous study minutes, insert a real auto-generated subjectless recovery block titled `Break` before scheduling more study. Flexible non-exam work must be split at the 90-minute boundary when necessary; an exact uninterrupted exam session may run longer and then requires a break before any further study.
- The break consumes free-slot capacity and moves the allocation cursor; it is not merely inferred by the calendar UI.
- A fixed event, reserved commitment, locked recovery window, or natural free-slot separation of at least the effective break duration resets the continuous-study counter.
- Do not insert a break when a hard boundary or natural pause of at least the effective break duration occurs immediately after the session, when there is insufficient room for the break before that boundary, or at the end of the study day.
- Never create consecutive breaks. Exam sessions use the same rule unless an existing longer required recovery rule applies.
- The calendar may render persisted planned breaks, but must not infer duplicate break events around them.

## Data Flow

1. Feasibility supplies remaining minutes and deadline pressure.
2. The generator builds daily cumulative core targets for the current week from raw remaining syllabus minutes and the October 24 pacing target.
3. Candidate selection filters/ranks tasks using target deficit, recent-subject history, and the 90-minute continuity limit.
4. Allocation inserts real break blocks and advances the slot cursor.
5. Weekly metrics remain diagnostic and do not stop daily allocation.
6. Horizon validation checks dependencies, overlaps, exact core coverage, core subject spread, and break overlap safety.

## Diagnostics

Add derived diagnostics only:

- cumulative core pacing target and assigned minutes by subject/date
- distinct study days by core subject/week
- maximum consecutive study minutes by subject
- planned break count and minutes by week
- pacing-rescue reason when smooth pacing is overridden

No new user-authored settings or persisted top-level entities are required.

## Tests

- A clean seeded horizon finishes all three HL syllabi during October 18-24, 2026, rather than finishing them months early, unless imported completion history already places a subject ahead of pace.
- Increasing the milestone window spreads syllabus work rather than reducing scheduled coverage.
- Each unfinished core subject appears on at least three days in a normal-capacity week.
- No eligible subject exceeds 90 consecutive minutes when another due subject can fit.
- Dependency-gated weeks may continue one subject instead of leaving blank time.
- Enabled breaks split flexible study at the 90-minute boundary and create real 15-minute subjectless blocks before further study.
- A 120-minute exact exam remains uninterrupted, but a break is required before subsequent study when capacity permits.
- Natural 15-minute-or-longer pauses reset the counter and do not receive duplicate breaks.
- Breaks never overlap fixed events, homework, piano, recovery, or study.
- Disabled breaks preserve tightly packed study behavior.
- Core subjects retain zero raw unscheduled minutes, Maths SL-to-HL order, Chemistry/Physics order, Olympiad B+ gates, and post-syllabus paper timing.

## Success Criteria

- Core syllabus completion occurs during the week ending October 24, 2026, unless existing completed progress already places a subject ahead of that schedule.
- Normal weeks visibly interleave Maths, Physics, Chemistry, and continuity work instead of producing long subject-only calendar segments.
- Enabling breaks results in a healthy, deterministic ratio of one break per 90 continuous study minutes without calendar clutter or lost coverage.
