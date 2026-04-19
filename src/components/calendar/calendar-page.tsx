"use client";

import { useState } from "react";
import { addDays, subDays } from "date-fns";
import {
  BookOpen,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Music4,
  Plus,
  RefreshCw,
  Sparkles,
  UtensilsCrossed,
} from "lucide-react";

import { AiEventAssistantDialog } from "@/components/ai/ai-event-assistant-dialog";
import {
  EventEditorDialog,
  type EventEditorDraft,
} from "@/components/calendar/event-editor-dialog";
import { CommitmentOverrideDialog } from "@/components/calendar/commitment-override-dialog";
import { FocusDayDialog } from "@/components/calendar/focus-day-dialog";
import { FocusWeekDialog } from "@/components/calendar/focus-week-dialog";
import { RecoveryWindowOverrideDialog } from "@/components/calendar/recovery-window-override-dialog";
import { HorizonRoadmap } from "@/components/planner/horizon-roadmap";
import {
  StudyBlockEditorDialog,
  type StudyBlockEditorDraft,
} from "@/components/planner/study-block-editor-dialog";
import { PlannerCalendar } from "@/components/calendar/planner-calendar";
import { PageHeader } from "@/components/layout/page-header";
import { ActionMenu } from "@/components/ui/action-menu";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { buildEventParseContext } from "@/lib/ai/context";
import { getHorizonRoadmapSummary } from "@/lib/analytics/metrics";
import { formatWeekRangeLabel, fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { usePlannerStore } from "@/lib/store/planner-store";
import { createId } from "@/lib/utils";

export function CalendarPage() {
  const currentWeekStart = usePlannerStore((state) => state.currentWeekStart);
  const fixedEvents = usePlannerStore((state) => state.fixedEvents);
  const sickDays = usePlannerStore((state) => state.sickDays);
  const focusedDays = usePlannerStore((state) => state.focusedDays);
  const focusedWeeks = usePlannerStore((state) => state.focusedWeeks);
  const preferences = usePlannerStore((state) => state.preferences);
  const studyBlocks = usePlannerStore((state) => state.studyBlocks);
  const topics = usePlannerStore((state) => state.topics);
  const weeklyPlans = usePlannerStore((state) => state.weeklyPlans);
  const subjects = usePlannerStore((state) => state.subjects);
  const regenerateHorizon = usePlannerStore((state) => state.regenerateHorizon);
  const setCurrentWeekStart = usePlannerStore((state) => state.setCurrentWeekStart);
  const savePlannerFixedEvent = usePlannerStore((state) => state.saveFixedEvent);
  const saveFocusedDay = usePlannerStore((state) => state.saveFocusedDay);
  const saveFocusedWeek = usePlannerStore((state) => state.saveFocusedWeek);
  const saveManualStudyBlock = usePlannerStore((state) => state.saveManualStudyBlock);
  const deleteFixedEvent = usePlannerStore((state) => state.deleteFixedEvent);
  const deleteFocusedDay = usePlannerStore((state) => state.deleteFocusedDay);
  const deleteFocusedWeek = usePlannerStore((state) => state.deleteFocusedWeek);
  const updatePreferences = usePlannerStore((state) => state.updatePreferences);
  const selectStudyBlock = usePlannerStore((state) => state.selectStudyBlock);
  const [editorDraft, setEditorDraft] = useState<EventEditorDraft>(null);
  const [studyBlockEditorDraft, setStudyBlockEditorDraft] = useState<StudyBlockEditorDraft>(null);
  const [commitmentOverrideDraft, setCommitmentOverrideDraft] = useState<{
    ruleId: "piano-practice" | "term-homework";
    date: string;
    mode: "add" | "remove";
  } | null>(null);
  const [recoveryOverrideDraft, setRecoveryOverrideDraft] = useState<{
    label: "Lunch break" | "Dinner reset";
    date: string;
  } | null>(null);
  const [focusDayDraftDate, setFocusDayDraftDate] = useState<string | null>(null);
  const [focusWeekDraftWeekStart, setFocusWeekDraftWeekStart] = useState<string | null>(null);
  const [aiEventAssistantOpen, setAiEventAssistantOpen] = useState(false);
  const hasConfiguredConstraints =
    !!fixedEvents.length || !!preferences?.schoolSchedule.enabled || !!preferences?.holidaySchedule.enabled;
  const roadmapSummary = getHorizonRoadmapSummary(weeklyPlans, topics, currentWeekStart);
  const visibleWeekPlan = weeklyPlans.find((plan) => plan.weekStart === currentWeekStart) ?? null;

  const visibleWeekStart = startOfPlannerWeek(fromDateKey(currentWeekStart));
  const visibleWeekEnd = addDays(visibleWeekStart, 6);
  const todayWeekStart = toDateKey(startOfPlannerWeek(new Date()));
  const isViewingCurrentWeek = currentWeekStart === todayWeekStart;
  const todayKey = toDateKey(new Date());
  const defaultOverrideDate =
    fromDateKey(todayKey) >= visibleWeekStart && fromDateKey(todayKey) <= visibleWeekEnd
      ? todayKey
      : currentWeekStart;
  const defaultCreateStart = new Date(addDays(visibleWeekStart, 1));
  defaultCreateStart.setHours(16, 0, 0, 0);
  const defaultCreateEnd = new Date(addDays(visibleWeekStart, 1));
  defaultCreateEnd.setHours(17, 30, 0, 0);
  const aiEventParseContext = buildEventParseContext({
    currentWeekStart,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    subjects,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Fixed events define the constraints. The planner then fills the remaining goal horizon with ordered study blocks, breaks, and recovery."
        actions={
          <>
            <div className="flex items-center gap-1 rounded-full border border-white/8 bg-white/4 p-1">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                data-testid="calendar-prev-week"
                onClick={() => setCurrentWeekStart(toDateKey(subDays(visibleWeekStart, 7)))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 text-sm text-muted-foreground" data-testid="calendar-week-range">
                {formatWeekRangeLabel(visibleWeekStart)}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                data-testid="calendar-next-week"
                onClick={() => setCurrentWeekStart(toDateKey(addDays(visibleWeekStart, 7)))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              data-testid="calendar-jump-today"
              disabled={isViewingCurrentWeek}
              onClick={() => setCurrentWeekStart(todayWeekStart)}
            >
              Today
            </Button>
            <ActionMenu
              label="Add"
              icon={<Plus className="h-4 w-4" />}
              testId="calendar-add-menu"
              items={[
                {
                  id: "add-with-ai",
                  label: "Add with AI",
                  icon: <Sparkles className="h-4 w-4" />,
                  testId: "calendar-add-with-ai",
                  onSelect: () => setAiEventAssistantOpen(true),
                },
                {
                  id: "add-study-block",
                  label: "Add study block",
                  icon: <BookOpen className="h-4 w-4" />,
                  testId: "calendar-add-study-block",
                  onSelect: () =>
                    setStudyBlockEditorDraft({
                      mode: "create",
                      start: defaultCreateStart.toISOString(),
                      end: defaultCreateEnd.toISOString(),
                    }),
                },
                {
                  id: "add-event",
                  label: "Add event",
                  icon: <Plus className="h-4 w-4" />,
                  testId: "calendar-add-event",
                  onSelect: () =>
                    setEditorDraft({
                      mode: "create",
                      start: defaultCreateStart.toISOString(),
                      end: defaultCreateEnd.toISOString(),
                      allDay: false,
                    }),
                },
                {
                  id: "set-day-focus",
                  label: "Set day focus",
                  icon: <Crosshair className="h-4 w-4" />,
                  testId: "calendar-set-focus",
                  onSelect: () => setFocusDayDraftDate(defaultOverrideDate),
                },
                {
                  id: "set-week-focus",
                  label: "Set week focus",
                  icon: <Crosshair className="h-4 w-4" />,
                  testId: "calendar-set-week-focus",
                  onSelect: () => setFocusWeekDraftWeekStart(currentWeekStart),
                },
              ]}
            />
            <ActionMenu
              label="Adjust"
              icon={<RefreshCw className="h-4 w-4" />}
              testId="calendar-adjust-menu"
              items={[
                {
                  id: "adjust-lunch",
                  label: "Adjust lunch",
                  icon: <UtensilsCrossed className="h-4 w-4" />,
                  testId: "calendar-adjust-lunch",
                  onSelect: () =>
                    setRecoveryOverrideDraft({
                      label: "Lunch break",
                      date: defaultOverrideDate,
                    }),
                },
                {
                  id: "adjust-dinner",
                  label: "Adjust dinner",
                  icon: <UtensilsCrossed className="h-4 w-4" />,
                  testId: "calendar-adjust-dinner",
                  onSelect: () =>
                    setRecoveryOverrideDraft({
                      label: "Dinner reset",
                      date: defaultOverrideDate,
                    }),
                },
                {
                  id: "adjust-piano",
                  label: "Adjust piano",
                  icon: <Music4 className="h-4 w-4" />,
                  testId: "calendar-adjust-piano",
                  onSelect: () =>
                    setCommitmentOverrideDraft({
                      ruleId: "piano-practice",
                      date: defaultOverrideDate,
                      mode: "add",
                    }),
                },
                {
                  id: "adjust-homework",
                  label: "Adjust homework",
                  icon: <BookOpen className="h-4 w-4" />,
                  testId: "calendar-adjust-homework",
                  onSelect: () =>
                    setCommitmentOverrideDraft({
                      ruleId: "term-homework",
                      date: defaultOverrideDate,
                      mode: "add",
                    }),
                },
              ]}
            />
            <Button data-testid="calendar-regenerate-horizon" onClick={() => void regenerateHorizon()}>
              <RefreshCw className="h-4 w-4" />
              Regenerate horizon
            </Button>
          </>
        }
      />

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 pt-5 text-sm text-muted-foreground">
          <Badge variant="success">Recovery</Badge>
          <Badge variant="warning">Break</Badge>
          <Badge variant="muted">Locked / fixed</Badge>
          <Badge variant="subject">Flexible / personal</Badge>
          <Badge variant="default">Planner-generated</Badge>
          <span>Adding or removing any fixed event immediately triggers replanning in the order defined in the spec.</span>
        </CardContent>
      </Card>

      {!hasConfiguredConstraints ? (
        <Card className="border-primary/20 bg-primary/8">
          <CardContent className="flex items-start gap-3 pt-5">
            <div className="rounded-sm border border-primary/25 bg-primary/10 p-2 text-primary">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">No fixed commitments are assumed.</p>
              <p className="text-sm text-muted-foreground">
                Add your real school, commute, lessons, sleep protection, and recovery windows first.
                The planner only schedules around the time you explicitly provide.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <HorizonRoadmap
        summary={roadmapSummary}
        subjects={subjects}
        compact
        title="Forward pace"
        description="Browsing weeks does not regenerate the plan. This roadmap shows what is already allocated from the selected week onward."
      />

      {preferences ? (
        <PlannerCalendar
          weekStart={currentWeekStart}
          fixedEvents={fixedEvents}
          sickDays={sickDays}
          focusedDays={focusedDays}
          focusedWeeks={focusedWeeks}
          effectiveReservedCommitmentDurations={
            visibleWeekPlan?.effectiveReservedCommitmentDurations ?? []
          }
          excludedReservedCommitmentRuleIds={
            visibleWeekPlan?.excludedReservedCommitmentRuleIds ?? []
          }
          preferences={preferences}
          studyBlocks={studyBlocks}
          subjects={subjects}
          onManageReservedCommitmentDate={({ dateKey, ruleId }) =>
            setCommitmentOverrideDraft({
              ruleId,
              date: dateKey,
              mode: "add",
            })
          }
          onManageRecoveryWindowDate={({ dateKey, label }) =>
            setRecoveryOverrideDraft({
              label,
              date: dateKey,
            })
          }
          onCreateEvent={({ start, end, allDay }) =>
            setEditorDraft({
              mode: "create",
              start,
              end,
              allDay,
            })
          }
          onManageFocusDay={(dateKey) => setFocusDayDraftDate(dateKey)}
          onManageFocusWeek={(weekStartKey) => setFocusWeekDraftWeekStart(weekStartKey)}
          onEditFixedEvent={({ event, occurrenceStart, occurrenceEnd }) =>
            setEditorDraft({
              mode: "edit",
              event,
              occurrenceStart,
              occurrenceEnd,
            })
          }
          onSelectStudyBlock={selectStudyBlock}
        />
      ) : null}

      <EventEditorDialog
        key={
          editorDraft
            ? editorDraft.mode === "edit"
              ? editorDraft.event.id
              : `${editorDraft.start}-${editorDraft.end}`
            : "event-editor"
        }
        open={!!editorDraft}
        draft={editorDraft}
        onClose={() => setEditorDraft(null)}
        onSave={async (event) => {
          await savePlannerFixedEvent(event);
          setEditorDraft(null);
        }}
        onDelete={async ({ event, scope, occurrenceDate }) => {
          await deleteFixedEvent({
            id: event.id,
            scope,
            occurrenceDate,
          });
          setEditorDraft(null);
        }}
      />

      <CommitmentOverrideDialog
        open={!!commitmentOverrideDraft}
        ruleId={commitmentOverrideDraft?.ruleId ?? null}
        defaultDate={commitmentOverrideDraft?.date ?? null}
        defaultMode={commitmentOverrideDraft?.mode}
        preferences={preferences}
        onClose={() => setCommitmentOverrideDraft(null)}
        onSave={async (nextPreferences) => {
          await updatePreferences(nextPreferences);
          setCommitmentOverrideDraft(null);
        }}
      />

      <RecoveryWindowOverrideDialog
        open={!!recoveryOverrideDraft}
        label={recoveryOverrideDraft?.label ?? null}
        defaultDate={recoveryOverrideDraft?.date ?? null}
        preferences={preferences}
        onClose={() => setRecoveryOverrideDraft(null)}
        onSave={async (nextPreferences) => {
          await updatePreferences(nextPreferences);
          setRecoveryOverrideDraft(null);
        }}
      />

      <FocusDayDialog
        key={focusDayDraftDate ?? "focus-day-dialog"}
        open={!!focusDayDraftDate}
        defaultDate={focusDayDraftDate}
        existingFocusedDay={
          focusDayDraftDate
            ? focusedDays.find((focusedDay) => focusedDay.date === focusDayDraftDate) ?? null
            : null
        }
        subjects={subjects}
        onClose={() => setFocusDayDraftDate(null)}
        onDelete={async (id) => {
          await deleteFocusedDay(id);
          setFocusDayDraftDate(null);
        }}
        onSave={async (focusedDay) => {
          await saveFocusedDay({
            ...focusedDay,
            id: focusedDay.id || createId("focused-day"),
          });
          setFocusDayDraftDate(null);
        }}
      />

      <FocusWeekDialog
        key={focusWeekDraftWeekStart ?? "focus-week-dialog"}
        open={!!focusWeekDraftWeekStart}
        weekStart={focusWeekDraftWeekStart}
        existingFocusedWeek={
          focusWeekDraftWeekStart
            ? focusedWeeks.find((focusedWeek) => focusedWeek.weekStart === focusWeekDraftWeekStart) ??
              null
            : null
        }
        subjects={subjects}
        onClose={() => setFocusWeekDraftWeekStart(null)}
        onDelete={async (id) => {
          await deleteFocusedWeek(id);
          setFocusWeekDraftWeekStart(null);
        }}
        onSave={async (focusedWeek) => {
          await saveFocusedWeek({
            ...focusedWeek,
            id: focusedWeek.id || createId("focused-week"),
          });
          setFocusWeekDraftWeekStart(null);
        }}
      />

      <StudyBlockEditorDialog
        key={
          studyBlockEditorDraft
            ? studyBlockEditorDraft.mode === "edit"
              ? studyBlockEditorDraft.block.id
              : `${studyBlockEditorDraft.start}-${studyBlockEditorDraft.end}`
            : "study-block-editor"
        }
        open={!!studyBlockEditorDraft}
        draft={studyBlockEditorDraft}
        subjects={subjects}
        topics={topics}
        studyBlocks={studyBlocks}
        onClose={() => setStudyBlockEditorDraft(null)}
        onSave={async (options) => {
          await saveManualStudyBlock(options);
          setStudyBlockEditorDraft(null);
        }}
      />
      <AiEventAssistantDialog
        open={aiEventAssistantOpen}
        context={aiEventParseContext}
        onClose={() => setAiEventAssistantOpen(false)}
        saveFixedEvent={savePlannerFixedEvent}
        saveFocusedDay={saveFocusedDay}
        saveFocusedWeek={saveFocusedWeek}
      />
    </div>
  );
}
