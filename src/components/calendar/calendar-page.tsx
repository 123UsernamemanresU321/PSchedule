"use client";

import { useState } from "react";
import { addDays, subDays } from "date-fns";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";

import {
  EventEditorDialog,
  type EventEditorDraft,
} from "@/components/calendar/event-editor-dialog";
import { HorizonRoadmap } from "@/components/planner/horizon-roadmap";
import { PlannerCalendar } from "@/components/calendar/planner-calendar";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getHorizonRoadmapSummary } from "@/lib/analytics/metrics";
import { formatWeekRangeLabel, fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { usePlannerStore } from "@/lib/store/planner-store";

export function CalendarPage() {
  const currentWeekStart = usePlannerStore((state) => state.currentWeekStart);
  const fixedEvents = usePlannerStore((state) => state.fixedEvents);
  const preferences = usePlannerStore((state) => state.preferences);
  const studyBlocks = usePlannerStore((state) => state.studyBlocks);
  const topics = usePlannerStore((state) => state.topics);
  const weeklyPlans = usePlannerStore((state) => state.weeklyPlans);
  const subjects = usePlannerStore((state) => state.subjects);
  const regenerateHorizon = usePlannerStore((state) => state.regenerateHorizon);
  const setCurrentWeekStart = usePlannerStore((state) => state.setCurrentWeekStart);
  const savePlannerFixedEvent = usePlannerStore((state) => state.saveFixedEvent);
  const deleteFixedEvent = usePlannerStore((state) => state.deleteFixedEvent);
  const selectStudyBlock = usePlannerStore((state) => state.selectStudyBlock);
  const [editorDraft, setEditorDraft] = useState<EventEditorDraft>(null);
  const hasConfiguredConstraints =
    !!fixedEvents.length || !!preferences?.schoolSchedule.enabled || !!preferences?.holidaySchedule.enabled;
  const roadmapSummary = getHorizonRoadmapSummary(weeklyPlans, topics, currentWeekStart);

  const visibleWeekStart = startOfPlannerWeek(fromDateKey(currentWeekStart));
  const defaultCreateStart = new Date(addDays(visibleWeekStart, 1));
  defaultCreateStart.setHours(16, 0, 0, 0);
  const defaultCreateEnd = new Date(addDays(visibleWeekStart, 1));
  defaultCreateEnd.setHours(17, 0, 0, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Calendar"
        description="Fixed events define the constraints. The planner then fills the remaining horizon from now to July 31 with ordered study blocks, breaks, and recovery."
        actions={
          <>
            <div className="flex items-center gap-1 rounded-full border border-white/8 bg-white/4 p-1">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => setCurrentWeekStart(toDateKey(subDays(visibleWeekStart, 7)))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 text-sm text-muted-foreground">{formatWeekRangeLabel(visibleWeekStart)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => setCurrentWeekStart(toDateKey(addDays(visibleWeekStart, 7)))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={() =>
                setEditorDraft({
                  mode: "create",
                  start: defaultCreateStart.toISOString(),
                  end: defaultCreateEnd.toISOString(),
                  allDay: false,
                })
              }
            >
              <Plus className="h-4 w-4" />
              Add event
            </Button>
            <Button onClick={() => void regenerateHorizon()}>
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
          preferences={preferences}
          studyBlocks={studyBlocks}
          subjects={subjects}
          onCreateEvent={({ start, end, allDay }) =>
            setEditorDraft({
              mode: "create",
              start,
              end,
              allDay,
            })
          }
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
    </div>
  );
}
