"use client";

import FullCalendar from "@fullcalendar/react";
import interactionPlugin from "@fullcalendar/interaction";
import timeGridPlugin from "@fullcalendar/timegrid";
import { BedDouble, BookOpen, CheckCircle2, Coffee, Lock, Music4, RefreshCw, Sparkles, TriangleAlert } from "lucide-react";
import { addDays, differenceInMinutes, format } from "date-fns";

import { SubjectBadge, getSubjectAccentStyles } from "@/components/planner/subject-badge";
import { Badge } from "@/components/ui/badge";
import { studyBlockStatusLabels } from "@/lib/constants/planner";
import { toDateKey } from "@/lib/dates/helpers";
import {
  expandPlannerFixedEventsForWeek,
  expandLockedRecoveryWindowsForWeek,
  expandReservedCommitmentWindowsForWeek,
} from "@/lib/scheduler/free-slots";
import { getActiveSickDaySeverity } from "@/lib/scheduler/schedule-regime";
import { fromDateKey } from "@/lib/dates/helpers";
import type { FixedEvent, Preferences, SickDay, StudyBlock, Subject } from "@/lib/types/planner";

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

function getStudyBlockStatusVariant(status: StudyBlock["status"]) {
  switch (status) {
    case "done":
      return "success" as const;
    case "partial":
      return "warning" as const;
    case "missed":
      return "danger" as const;
    case "rescheduled":
      return "default" as const;
    default:
      return "muted" as const;
  }
}

function getStudyBlockStatusIcon(status: StudyBlock["status"]) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="h-3 w-3" />;
    case "partial":
    case "missed":
      return <TriangleAlert className="h-3 w-3" />;
    case "rescheduled":
      return <RefreshCw className="h-3 w-3" />;
    default:
      return <Sparkles className="h-3 w-3" />;
  }
}

interface PlannerCalendarProps {
  weekStart: string;
  fixedEvents: FixedEvent[];
  sickDays: SickDay[];
  preferences: Preferences;
  studyBlocks: StudyBlock[];
  subjects: Subject[];
  onCreateEvent: (selection: { start: string; end: string; allDay: boolean }) => void;
  onEditFixedEvent: (options: {
    event: FixedEvent;
    occurrenceStart: string;
    occurrenceEnd: string;
  }) => void;
  onSelectStudyBlock: (id: string) => void;
  onManagePianoDate: (dateKey: string) => void;
}

export function PlannerCalendar({
  weekStart,
  fixedEvents,
  sickDays,
  preferences,
  studyBlocks,
  subjects,
  onCreateEvent,
  onEditFixedEvent,
  onSelectStudyBlock,
  onManagePianoDate,
}: PlannerCalendarProps) {
  const subjectMap = new Map(subjects.map((subject) => [subject.id, subject]));
  const visibleWeekStart = fromDateKey(weekStart);
  const visibleWeekEnd = addDays(visibleWeekStart, 7);
  const expandedFixedEvents = expandPlannerFixedEventsForWeek(visibleWeekStart, fixedEvents, preferences);
  const recoveryWindows = expandLockedRecoveryWindowsForWeek(
    visibleWeekStart,
    preferences,
    fixedEvents,
    sickDays,
    studyBlocks.filter((block) => block.weekStart === weekStart),
  );
  const visibleRecoveryWindows = recoveryWindows.filter((window) => {
    if (window.label !== "Lunch break") {
      return true;
    }

    const lunchStart = new Date(window.start);
    const lunchEnd = new Date(window.end);

    return !expandedFixedEvents.some((event) => {
      if (event.category !== "school") {
        return false;
      }

      const eventStart = new Date(event.start);
      const eventEnd = new Date(event.end);
      return lunchStart < eventEnd && lunchEnd > eventStart;
    });
  });
  const reservedCommitments = expandReservedCommitmentWindowsForWeek(
    visibleWeekStart,
    preferences,
    fixedEvents,
    sickDays,
  );
  const sickDayEvents = Array.from({ length: 7 }, (_, index) => addDays(visibleWeekStart, index)).flatMap((day) => {
    const severity = getActiveSickDaySeverity(day, sickDays);
    if (!severity) {
      return [];
    }

    return [
      {
        id: `sick-day:${toDateKey(day)}`,
        title: `Sick day · ${severity.charAt(0).toUpperCase()}${severity.slice(1)}`,
        start: day,
        end: addDays(day, 1),
        allDay: true,
        extendedProps: {
          kind: "sick-day" as const,
          severity,
        },
      },
    ];
  });
  const blockedIntervals = [
    ...recoveryWindows.map((window) => ({
      start: new Date(window.start),
      end: new Date(window.end),
    })),
    ...reservedCommitments.map((window) => ({
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
    ...visibleRecoveryWindows.map((window) => ({
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
    ...sickDayEvents,
    ...reservedCommitments.map((commitment) => ({
      id: `reserved:${commitment.id}`,
      title: commitment.title,
      start: new Date(commitment.start),
      end: new Date(commitment.end),
      allDay: false,
      extendedProps: {
        kind: "reserved-commitment" as const,
        commitment,
      },
    })),
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
    <div
      className="overflow-hidden rounded-md border border-white/6 bg-[#0d1324]/90 p-4 shadow-panel"
      data-testid="planner-calendar"
    >
      <FullCalendar
        key={weekStart}
        plugins={[timeGridPlugin, interactionPlugin]}
        initialView="timeGridWeek"
        firstDay={1}
        allDaySlot
        selectable
        editable={false}
        nowIndicator
        slotEventOverlap={false}
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
        dayCellClassNames={(arg) => {
          const severity = getActiveSickDaySeverity(arg.date, sickDays);
          return severity ? [`planner-sick-day-${severity}`] : [];
        }}
        select={(selection) =>
          onCreateEvent({
            start: selection.startStr,
            end: selection.endStr,
            allDay: selection.allDay,
          })
        }
        eventClick={(clickInfo) => {
          const kind = clickInfo.event.extendedProps.kind as
            | "fixed"
            | "study"
            | "recovery-window"
            | "reserved-commitment"
            | "break"
            | "sick-day";
          if (
            kind === "recovery-window" ||
            kind === "break" ||
            kind === "sick-day"
          ) {
            return;
          }
          if (kind === "reserved-commitment") {
            const commitment = clickInfo.event.extendedProps.commitment as {
              ruleId: string;
              dateKey: string;
            };

            if (commitment.ruleId === "piano-practice") {
              onManagePianoDate(commitment.dateKey);
            }
            return;
          }
          if (kind === "fixed") {
            if (clickInfo.event.extendedProps.readOnly) {
              return;
            }
            const occurrenceStart = clickInfo.event.extendedProps.occurrenceStart as string;
            const occurrenceEnd = clickInfo.event.extendedProps.occurrenceEnd as string;
            onEditFixedEvent({
              event: clickInfo.event.extendedProps.event as FixedEvent,
              occurrenceStart,
              occurrenceEnd,
            });
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
          const kind = eventInfo.event.extendedProps.kind as
            | "fixed"
            | "study"
            | "recovery-window"
            | "reserved-commitment"
            | "break"
            | "sick-day";
          const eventStart = eventInfo.event.start ?? new Date();
          const eventEnd = eventInfo.event.end ?? eventStart;
          const durationMinutes = differenceInMinutes(eventEnd, eventStart);
          const showCompactTitleOnly = !eventInfo.event.allDay && durationMinutes <= 50;

          if (kind === "sick-day") {
            const severity = eventInfo.event.extendedProps.severity as SickDay["severity"];
            const severityStyle =
              severity === "severe"
                ? "border-rose-400/30 bg-rose-400/12 text-rose-50"
                : severity === "moderate"
                  ? "border-amber-300/35 bg-amber-300/10 text-amber-50"
                  : "border-sky-300/30 bg-sky-300/10 text-sky-50";

            return (
              <div
                className={`h-full overflow-hidden rounded-lg border px-3 py-2 text-sm shadow-panel ${severityStyle}`}
                data-testid="calendar-sick-day"
                data-event-title={eventInfo.event.title}
              >
                <p className="truncate font-medium">{eventInfo.event.title}</p>
              </div>
            );
          }

          if (kind === "recovery-window") {
            const window = eventInfo.event.extendedProps.window as {
              label: string;
              start: string;
              end: string;
              movable?: boolean;
            };

            if (showCompactTitleOnly) {
              return (
                <div
                  className="h-full overflow-hidden rounded-lg border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100"
                  data-testid="calendar-recovery-window"
                  data-event-title={window.label}
                >
                  <p className="truncate font-medium">{window.label}</p>
                </div>
              );
            }

            return (
              <div className="h-full overflow-hidden rounded-sm border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-sm text-emerald-100">
                <div
                  data-testid="calendar-recovery-window"
                  data-event-title={window.label}
                  className="contents"
                />
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

          if (kind === "reserved-commitment") {
            const commitment = eventInfo.event.extendedProps.commitment as {
              label: string;
              start: string;
              end: string;
            };
            const icon =
              commitment.label.toLowerCase().includes("piano") ? (
                <Music4 className="h-3.5 w-3.5" />
              ) : (
                <BookOpen className="h-3.5 w-3.5" />
              );

            if (showCompactTitleOnly) {
              return (
                <div
                  className="h-full overflow-hidden rounded-lg border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-50"
                  data-testid="calendar-reserved-commitment"
                  data-event-title={commitment.label}
                >
                  <p className="truncate font-medium">{commitment.label}</p>
                </div>
              );
            }

            return (
              <div
                className="h-full overflow-hidden rounded-sm border border-amber-300/30 bg-amber-300/10 px-3 py-2 text-sm text-amber-50"
                data-testid="calendar-reserved-commitment"
                data-event-title={commitment.label}
              >
                <div className="flex items-center gap-2">
                  {icon}
                  <span className="truncate font-medium">{commitment.label}</span>
                </div>
                <p className="mt-1 text-xs text-amber-100/80">
                  {format(new Date(commitment.start), "HH:mm")} - {format(new Date(commitment.end), "HH:mm")}
                </p>
              </div>
            );
          }

          if (kind === "break") {
            const gapMinutes = eventInfo.event.extendedProps.gapMinutes as number;

            if (showCompactTitleOnly) {
              return (
                <div
                  className="h-full overflow-hidden rounded-lg border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-sm text-amber-100"
                  data-testid="calendar-break"
                  data-event-title="Break"
                >
                  <p className="truncate font-medium">Break</p>
                </div>
              );
            }

            return (
              <div
                className="h-full overflow-hidden rounded-sm border border-amber-400/20 bg-amber-400/8 px-3 py-2 text-sm text-amber-100"
                data-testid="calendar-break"
                data-event-title="Break"
              >
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
                <div
                  className="h-full overflow-hidden rounded-lg border border-white/8 bg-white/[0.08] px-3 py-2 text-sm text-foreground shadow-panel"
                  data-testid="calendar-fixed-event"
                  data-event-title={event.title}
                >
                  <p className="truncate font-medium">{event.title}</p>
                </div>
              );
            }

            return (
              <div
                className="h-full overflow-hidden rounded-lg border border-white/8 bg-white/[0.08] px-3 py-2 text-sm text-foreground shadow-panel"
                data-testid="calendar-fixed-event"
                data-event-title={event.title}
              >
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
          const statusBadge = (
            <Badge
              variant={getStudyBlockStatusVariant(block.status)}
              className="gap-1 border-white/10 px-2 py-0.5 text-[10px] leading-none"
            >
              {getStudyBlockStatusIcon(block.status)}
              {studyBlockStatusLabels[block.status]}
            </Badge>
          );
          const studyBlockCardStyle = {
            ...getSubjectAccentStyles(block.subjectId),
            backgroundColor:
              block.status === "done"
                ? subject
                  ? `hsl(var(--${subject.colorToken}) / 0.16)`
                  : "rgba(34,197,94,0.12)"
                : subject
                  ? `hsl(var(--${subject.colorToken}) / 0.08)`
                  : "rgba(255,255,255,0.06)",
            opacity: block.status === "missed" ? 0.72 : 1,
          };

          if (showCompactTitleOnly) {
            return (
              <div
                className="flex h-full min-h-0 flex-col justify-center gap-1 overflow-hidden rounded-lg border px-3 py-2 text-sm shadow-panel"
                data-testid="calendar-study-block"
                data-event-title={block.title}
                data-paper-code={block.paperCode ?? ""}
                data-block-status={block.status}
                style={studyBlockCardStyle}
              >
                <div className="flex items-start justify-between gap-2">
                  {block.paperCode ? (
                    <p className="truncate font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                      {block.paperCode}
                    </p>
                  ) : (
                    <span />
                  )}
                  {block.status !== "planned" ? statusBadge : null}
                </div>
                {block.paperCode ? (
                  null
                ) : null}
                <p className="truncate font-medium text-foreground">
                  {block.title}
                </p>
              </div>
            );
          }

          return (
            <div
              className="flex h-full min-h-0 flex-col gap-2 overflow-hidden rounded-lg border px-3 py-2 text-sm shadow-panel"
              data-testid="calendar-study-block"
              data-event-title={block.title}
              data-paper-code={block.paperCode ?? ""}
              data-block-status={block.status}
              style={studyBlockCardStyle}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  {subject ? (
                    <SubjectBadge subjectId={subject.id} label={subject.shortName} className="border-none px-0 py-0 text-[11px]" />
                  ) : (
                    <SubjectBadge subjectId={null} label="Recovery" className="border-none px-0 py-0 text-[11px]" />
                  )}
                  {block.paperCode ? (
                    <span className="truncate rounded-full border border-white/10 bg-white/6 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-foreground/85">
                      {block.paperCode}
                    </span>
                  ) : null}
                </div>
                {statusBadge}
              </div>
              <div className="min-h-0 space-y-1 overflow-hidden">
                <p className="calendar-event-title font-medium text-foreground">{block.title}</p>
                {block.sessionSummary ? (
                  <p className="calendar-event-description text-[11px] text-foreground/78">
                    {block.sessionSummary}
                  </p>
                ) : null}
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
