"use client";

import FullCalendar from "@fullcalendar/react";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import { BedDouble, Coffee, Lock, Sparkles } from "lucide-react";
import { addDays, differenceInMinutes, format } from "date-fns";

import { SubjectBadge, getSubjectAccentStyles } from "@/components/planner/subject-badge";
import {
  expandPlannerFixedEventsForWeek,
  expandLockedRecoveryWindowsForWeek,
} from "@/lib/scheduler/free-slots";
import { fromDateKey } from "@/lib/dates/helpers";
import type { FixedEvent, Preferences, StudyBlock, Subject } from "@/lib/types/planner";

function buildVisibleBreakEvents(options: {
  studyBlocks: StudyBlock[];
  weekStart: string;
  minBreakMinutes: number;
  blockedIntervals: Array<{ start: Date; end: Date }>;
}) {
  const maxVisibleBreakMinutes = Math.max(options.minBreakMinutes * 2, 45);
  const blocks = options.studyBlocks
    .filter((block) => block.weekStart === options.weekStart)
    .sort((left, right) => new Date(left.start).getTime() - new Date(right.start).getTime());

  return blocks.flatMap((block, index) => {
    const nextBlock = blocks[index + 1];

    if (!nextBlock || block.date !== nextBlock.date || !block.subjectId || !nextBlock.subjectId) {
      return [];
    }

    const breakStart = new Date(block.end);
    const breakEnd = new Date(nextBlock.start);
    const gapMinutes = differenceInMinutes(breakEnd, breakStart);

    if (gapMinutes < options.minBreakMinutes || gapMinutes > maxVisibleBreakMinutes) {
      return [];
    }

    const overlapsBlockedInterval = options.blockedIntervals.some(
      (interval) => breakStart < interval.end && breakEnd > interval.start,
    );

    if (overlapsBlockedInterval) {
      return [];
    }

    return [
      {
        id: `break:${block.id}:${nextBlock.id}`,
        title: "Break",
        start: breakStart,
        end: breakEnd,
        allDay: false,
        extendedProps: {
          kind: "break" as const,
          gapMinutes,
        },
      },
    ];
  });
}

interface PlannerCalendarProps {
  weekStart: string;
  fixedEvents: FixedEvent[];
  preferences: Preferences;
  studyBlocks: StudyBlock[];
  subjects: Subject[];
  onCreateEvent: (selection: { start: string; end: string; allDay: boolean }) => void;
  onEditFixedEvent: (event: FixedEvent) => void;
  onSelectStudyBlock: (id: string) => void;
}

export function PlannerCalendar({
  weekStart,
  fixedEvents,
  preferences,
  studyBlocks,
  subjects,
  onCreateEvent,
  onEditFixedEvent,
  onSelectStudyBlock,
}: PlannerCalendarProps) {
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
  const visibleWeekStart = fromDateKey(weekStart);
  const visibleWeekEnd = addDays(visibleWeekStart, 7);
  const expandedFixedEvents = expandPlannerFixedEventsForWeek(visibleWeekStart, fixedEvents, preferences);
  const recoveryWindows = expandLockedRecoveryWindowsForWeek(
    visibleWeekStart,
    preferences,
    fixedEvents,
    studyBlocks.filter((block) => block.weekStart === weekStart),
  );
  const blockedIntervals = [
    ...recoveryWindows.map((window) => ({
      start: new Date(window.start),
      end: new Date(window.end),
    })),
    ...expandedFixedEvents.map((event) => ({
      start: new Date(event.start),
      end: new Date(event.end),
    })),
  ];
  const breakEvents = buildVisibleBreakEvents({
    studyBlocks,
    weekStart,
    minBreakMinutes: preferences.minBreakMinutes,
    blockedIntervals,
  });
  const calendarEvents = [
    ...recoveryWindows.map((window) => ({
      id: `recovery:${window.id}`,
      title: window.title,
      start: new Date(window.start),
      end: new Date(window.end),
      allDay: false,
      extendedProps: {
        kind: "recovery-window" as const,
        window,
      },
    })),
    ...expandedFixedEvents.map((event) => {
      const baseEvent = fixedEvents.find((candidate) => candidate.id === event.id) ?? event;

      return {
        id: `${event.id}:${event.start}`,
        groupId: event.id,
        title: event.title,
        start: new Date(event.start),
        end: new Date(event.end),
        allDay: event.isAllDay ?? false,
        extendedProps: {
          kind: "fixed" as const,
          event: baseEvent,
          occurrenceStart: event.start,
          occurrenceEnd: event.end,
          readOnly: event.id.startsWith("school-schedule:"),
        },
      };
    }),
    ...breakEvents,
    ...studyBlocks
      .filter((block) => block.weekStart === weekStart)
      .map((block) => ({
        id: block.id,
        title: block.title,
        start: new Date(block.start),
        end: new Date(block.end),
        allDay: false,
        extendedProps: {
          kind: "study" as const,
          block,
        },
      })),
  ];

  return (
    <div className="overflow-hidden rounded-md border border-white/6 bg-[#0d1324]/90 p-4 shadow-panel">
      <FullCalendar
        key={weekStart}
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        firstDay={1}
        allDaySlot
        selectable
        editable={false}
        nowIndicator
        timeZone="local"
        height="auto"
        dayMaxEvents={3}
        weekends
        slotMinTime="06:00:00"
        slotMaxTime="22:30:00"
        expandRows
        initialDate={weekStart}
        visibleRange={{
          start: visibleWeekStart,
          end: visibleWeekEnd,
        }}
        headerToolbar={false}
        events={calendarEvents}
        eventDisplay="block"
        select={(selection) =>
          onCreateEvent({
            start: selection.startStr,
            end: selection.endStr,
            allDay: selection.allDay,
          })
        }
        eventClick={(clickInfo) => {
          const kind = clickInfo.event.extendedProps.kind as "fixed" | "study" | "recovery-window" | "break";
          if (kind === "recovery-window" || kind === "break") {
            return;
          }
          if (kind === "fixed") {
            if (clickInfo.event.extendedProps.readOnly) {
              return;
            }
            onEditFixedEvent(clickInfo.event.extendedProps.event as FixedEvent);
            return;
          }

          const block = clickInfo.event.extendedProps.block as StudyBlock;
          onSelectStudyBlock(block.id);
        }}
        dayHeaderFormat={{
          weekday: "short",
          month: "short",
          day: "numeric",
        }}
        slotLabelFormat={{
          hour: "numeric",
          minute: "2-digit",
          hour12: false,
        }}
        eventContent={(eventInfo) => {
          const kind = eventInfo.event.extendedProps.kind as "fixed" | "study" | "recovery-window" | "break";
          const eventStart = eventInfo.event.start ?? new Date();
          const eventEnd = eventInfo.event.end ?? eventStart;
          const durationMinutes = differenceInMinutes(eventEnd, eventStart);
          const showCompactTitleOnly = !eventInfo.event.allDay && durationMinutes <= 50;

          if (kind === "recovery-window") {
            const window = eventInfo.event.extendedProps.window as {
              label: string;
              start: string;
              end: string;
              movable?: boolean;
            };

            if (showCompactTitleOnly) {
              return (
                <div className="h-full overflow-hidden rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                  <p className="truncate font-medium">{window.label}</p>
                </div>
              );
            }

            return (
              <div className="h-full overflow-hidden rounded-sm border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                <div className="flex items-center gap-2">
                  <BedDouble className="h-3.5 w-3.5" />
                  <span className="truncate font-medium">{window.label}</span>
                </div>
                <p className="mt-1 text-xs text-emerald-100/75">
                  {format(new Date(window.start), "HH:mm")} - {format(new Date(window.end), "HH:mm")}
                </p>
              </div>
            );
          }

          if (kind === "break") {
            const gapMinutes = eventInfo.event.extendedProps.gapMinutes as number;

            if (showCompactTitleOnly) {
              return (
                <div className="h-full overflow-hidden rounded-lg border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-sm text-amber-100">
                  <p className="truncate font-medium">Break</p>
                </div>
              );
            }

            return (
              <div className="h-full overflow-hidden rounded-sm border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-sm text-amber-100">
                <div className="flex items-center gap-2">
                  <Coffee className="h-3.5 w-3.5" />
                  <span className="truncate font-medium">Break</span>
                </div>
                <p className="mt-1 text-xs text-amber-100/75">{gapMinutes} min</p>
              </div>
            );
          }

          if (kind === "fixed") {
            const event = eventInfo.event.extendedProps.event as FixedEvent;
            const occurrenceStart = eventInfo.event.extendedProps.occurrenceStart as string;
            const occurrenceEnd = eventInfo.event.extendedProps.occurrenceEnd as string;

            if (showCompactTitleOnly) {
              return (
                <div className="h-full overflow-hidden rounded-lg border border-white/8 bg-white/[0.08] px-3 py-2 text-sm text-foreground shadow-panel">
                  <p className="truncate font-medium">{event.title}</p>
                </div>
              );
            }

            return (
              <div className="h-full overflow-hidden rounded-lg border border-white/8 bg-white/[0.08] px-3 py-2 text-sm text-foreground shadow-panel">
                <div className="flex items-center gap-2">
                  <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="truncate font-medium">{event.title}</span>
                </div>
                <p className="calendar-event-time mt-1 text-xs text-muted-foreground">
                  {event.isAllDay
                    ? "All day"
                    : `${format(new Date(occurrenceStart), "HH:mm")} - ${format(new Date(occurrenceEnd), "HH:mm")}`}
                </p>
              </div>
            );
          }

          const block = eventInfo.event.extendedProps.block as StudyBlock;
          const subject = block.subjectId ? subjectMap.get(block.subjectId) : null;

          if (showCompactTitleOnly) {
            return (
              <div
                className="flex h-full min-h-0 items-center overflow-hidden rounded-lg border px-3 py-2 text-sm shadow-panel"
                style={{
                  ...getSubjectAccentStyles(block.subjectId),
                  backgroundColor: subject
                    ? `hsl(var(--${subject.colorToken}) / 0.08)`
                    : "rgba(255,255,255,0.06)",
                }}
              >
                <p className="truncate font-medium text-foreground">{block.title}</p>
              </div>
            );
          }

          return (
            <div
              className="flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-lg border px-3 py-2 text-sm shadow-panel"
              style={{
                ...getSubjectAccentStyles(block.subjectId),
                backgroundColor: subject
                  ? `hsl(var(--${subject.colorToken}) / 0.08)`
                  : "rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center justify-between gap-2">
                {subject ? (
                  <SubjectBadge subjectId={subject.id} label={subject.shortName} className="border-none px-0 py-0 text-[11px]" />
                ) : (
                  <SubjectBadge subjectId={null} label="Recovery" className="border-none px-0 py-0 text-[11px]" />
                )}
                <div className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                  <Sparkles className="h-3 w-3" />
                  Auto
                </div>
              </div>
              <div className="min-h-0 space-y-1 overflow-hidden">
                <p className="calendar-event-title font-medium text-foreground">{block.title}</p>
                <p className="calendar-event-time text-xs text-muted-foreground">
                  {format(new Date(block.start), "HH:mm")} - {format(new Date(block.end), "HH:mm")}
                </p>
              </div>
            </div>
          );
        }}
      />
    </div>
  );
}
