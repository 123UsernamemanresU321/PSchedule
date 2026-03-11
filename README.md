# Adaptive IB + Olympiad Study Planner

Local-first V1 study planner built with Next.js, TypeScript, Tailwind, Zustand, Dexie, FullCalendar, date-fns, Recharts, and Zod.

## What it does

- Treats the planner engine as the core product, not the calendar.
- Seeds IB HL Physics, Maths AA HL, Chemistry HL, Olympiad, and maintenance subjects.
- Computes free slots from fixed events plus locked recovery windows.
- Scores candidate tasks using subject weight, deadline pressure, remaining workload, mastery, review due, neglect, slot fit, and fragmentation.
- Generates deterministic study blocks with `generatedReason` on every block.
- Replans when fixed events are added or removed, while preserving realism through buffer rules and daily caps.
- Stores everything locally in IndexedDB and supports JSON export/import.

## Run locally

```bash
npm install
npm run dev
```

Build verification:

```bash
npm run typecheck
npm run build
```

GitHub Pages export verification:

```bash
npm run build:pages
```

## Deploy to GitHub Pages

- The repo now includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml`.
- On every push to `main`, the workflow runs lint, typecheck, exports a static build, and deploys it to GitHub Pages.
- For project pages, the workflow automatically uses `/<repo-name>` as the base path.
- For user or organization pages in a repository named `<owner>.github.io`, it deploys at the root path.

GitHub-side setup:

1. Open repository `Settings` -> `Pages`.
2. Set `Source` to `GitHub Actions`.
3. Push to `main` or run the workflow manually from the `Actions` tab.

## Major files

- `src/app/layout.tsx`
  Wraps the entire app, loads global styles, and bootstraps the planner store once.
- `src/app/globals.css`
  Central color tokens, font variables, FullCalendar overrides, and the shared dark academic visual system.
- `src/components/shell/app-shell.tsx`
  The single reusable application shell used across all pages.
- `src/components/dashboard/dashboard-page.tsx`
  Dashboard UI for today’s plan, weekly hours, subject risk, and urgent topics.
- `src/components/calendar/calendar-page.tsx`
  Calendar page orchestration, week navigation, event editing, and regeneration controls.
- `src/components/calendar/planner-calendar.tsx`
  FullCalendar integration that renders fixed events and planner-generated study blocks.
- `src/components/calendar/event-editor-dialog.tsx`
  Add/edit/delete dialog for fixed events.
- `src/components/subjects/subjects-page.tsx`
  Subject coverage page with progress cards and unit/topic breakdowns.
- `src/components/review/weekly-review-page.tsx`
  Weekly review analytics, carry-over tracking, and feasibility projections.
- `src/components/settings/settings-page.tsx`
  Planner rules editor plus JSON import/export actions.
- `src/components/planner/study-block-drawer.tsx`
  Shared side drawer for block detail, generated reason, source materials, and mark status actions.
- `src/lib/types/planner.ts`
  Domain model for goals, subjects, topics, fixed events, study blocks, weekly plans, and preferences.
- `src/lib/types/schemas.ts`
  Zod schemas for validated local import/export payloads.
- `src/lib/storage/db.ts`
  Dexie schema for IndexedDB persistence.
- `src/lib/storage/planner-repository.ts`
  Local-first repository that seeds the app, loads snapshots, replaces weekly plans, and handles export/import.
- `src/lib/store/planner-store.ts`
  Zustand store that coordinates persistence, status changes, replanning, and page state.
- `src/lib/seed/index.ts`
  Seed entry point that assembles the initial subjects, topics, fixed events, goals, and preferences.
- `src/lib/seed/topics.ts`
  Seeded syllabus and Olympiad topic data with hours, mastery, status, and source materials.
- `src/lib/scheduler/free-slots.ts`
  Free-slot calculation from fixed events, recovery windows, and preserved study blocks.
- `src/lib/scheduler/task-candidates.ts`
  Converts remaining syllabus work into concrete candidate tasks.
- `src/lib/scheduler/slot-classifier.ts`
  Classifies slot energy and picks compatible block types.
- `src/lib/scheduler/scoring.ts`
  Deterministic task scoring and human-readable `generatedReason` generation.
- `src/lib/scheduler/generator.ts`
  Assigns study blocks into compatible slots while respecting daily caps and weekly buffer capacity.
- `src/lib/scheduler/replanner.ts`
  Replanning strategy that uses open buffer first, then progressively frees lighter work before compression.
- `src/lib/scheduler/feasibility.ts`
  Weekly required-hours calculation, feasibility scoring, warnings, and subject completion projection.
- `src/lib/analytics/metrics.ts`
  Shared derived metrics for dashboard, subjects, and weekly review pages.

## Notes on the planner engine

- The weekly plan is generated for the active week stored in Zustand and persisted in Dexie.
- Completed or partially completed blocks are preserved during replans.
- Future planned blocks are preserved until the replanner needs to release lighter or lower-pressure work.
- Recovery blocks are inserted explicitly when low-energy time is better protected than overfilled.

## Data portability

- Export creates a versioned JSON payload from all IndexedDB tables.
- Import validates the payload with Zod before replacing local data.
