"use client";

import { useState } from "react";
import { addDays, format, subDays } from "date-fns";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { FixedEvent } from "@/lib/types/planner";
import { createId } from "@/lib/utils";

interface EventEditorDialogProps {
  open: boolean;
  draft: EventEditorDraft;
  onClose: () => void;
  onSave: (event: FixedEvent) => Promise<void>;
  onDelete?: (options: {
    event: FixedEvent;
    scope: "occurrence" | "series";
    occurrenceDate?: string;
  }) => Promise<void>;
}

export type EventEditorDraft =
  | {
      mode: "create";
      start: string;
      end: string;
      allDay?: boolean;
    }
  | {
      mode: "edit";
      event: FixedEvent;
      occurrenceStart?: string;
      occurrenceEnd?: string;
    }
  | null;

const weekdayOptions = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

function toDateTimeInputValue(value: string) {
  return format(new Date(value), "yyyy-MM-dd'T'HH:mm");
}

function toDateInputValue(value: string) {
  return format(new Date(value), "yyyy-MM-dd");
}

function getRecurringDays(event: FixedEvent) {
  if (event.daysOfWeek?.length) {
    return [...event.daysOfWeek].sort((left, right) => left - right);
  }

  return [new Date(event.start).getDay()];
}

function getRepeatUntil(event: FixedEvent) {
  if (event.repeatUntil) {
    return event.repeatUntil;
  }

  if (event.recurrence !== "weekly") {
    return "";
  }

  return toDateInputValue(event.start);
}

function toAllDayEndInputValue(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(end);
  const inclusiveEnd = endDate > startDate ? subDays(endDate, 1) : startDate;
  return format(inclusiveEnd, "yyyy-MM-dd");
}

function normalizeRecurringEnd(startValue: string, endValue: string) {
  const startDate = new Date(startValue);
  const endDate = new Date(endValue);
  const normalizedEnd = new Date(startDate);

  normalizedEnd.setHours(
    endDate.getHours(),
    endDate.getMinutes(),
    endDate.getSeconds(),
    endDate.getMilliseconds(),
  );

  if (normalizedEnd <= startDate) {
    normalizedEnd.setDate(normalizedEnd.getDate() + 1);
  }

  return normalizedEnd.toISOString();
}

function fromDateInputValue(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0);
}

function normalizeAllDayRange(startValue: string, endValue: string) {
  const startDate = fromDateInputValue(startValue);
  const inclusiveEndDate = fromDateInputValue(endValue);
  const exclusiveEndDate = addDays(inclusiveEndDate, 1);

  return {
    start: startDate.toISOString(),
    end: exclusiveEndDate.toISOString(),
  };
}

function getInputDayOfWeek(value: string) {
  return value.includes("T") ? new Date(value).getDay() : fromDateInputValue(value).getDay();
}

export function EventEditorDialog({
  open,
  draft,
  onClose,
  onSave,
  onDelete,
}: EventEditorDialogProps) {
  if (!open || !draft) {
    return null;
  }

  return (
    <EventEditorDialogPanel
      draft={draft}
      onClose={onClose}
      onSave={onSave}
      onDelete={onDelete}
    />
  );
}

function EventEditorDialogPanel({
  draft,
  onClose,
  onSave,
  onDelete,
}: Omit<EventEditorDialogProps, "open"> & {
  draft: Exclude<EventEditorDraft, null>;
}) {
  const [title, setTitle] = useState(draft.mode === "create" ? "" : draft.event.title);
  const [isAllDay, setIsAllDay] = useState(
    draft.mode === "create" ? draft.allDay ?? false : draft.event.isAllDay ?? false,
  );
  const [start, setStart] = useState(
    draft.mode === "create"
      ? draft.allDay
        ? toDateInputValue(draft.start)
        : toDateTimeInputValue(draft.start)
      : draft.event.isAllDay
        ? toDateInputValue(draft.event.start)
        : toDateTimeInputValue(draft.event.start),
  );
  const [end, setEnd] = useState(
    draft.mode === "create"
      ? draft.allDay
        ? toAllDayEndInputValue(draft.start, draft.end)
        : toDateTimeInputValue(draft.end)
      : draft.event.isAllDay
        ? toAllDayEndInputValue(draft.event.start, draft.event.end)
        : toDateTimeInputValue(draft.event.end),
  );
  const [category, setCategory] = useState<FixedEvent["category"]>(
    draft.mode === "create" ? "activity" : draft.event.category,
  );
  const [flexibility, setFlexibility] = useState<FixedEvent["flexibility"]>(
    draft.mode === "create" ? "fixed" : draft.event.flexibility,
  );
  const [recurrence, setRecurrence] = useState<FixedEvent["recurrence"]>(
    draft.mode === "create" ? "none" : draft.event.recurrence,
  );
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    draft.mode === "create" ? [getInputDayOfWeek(draft.start)] : getRecurringDays(draft.event),
  );
  const [repeatUntil, setRepeatUntil] = useState(
    draft.mode === "create" ? toDateInputValue(draft.start) : getRepeatUntil(draft.event),
  );
  const [notes, setNotes] = useState(
    draft.mode === "create" ? "" : draft.event.notes ?? "",
  );
  const [showDeleteOptions, setShowDeleteOptions] = useState(false);
  const eventId = draft.mode === "edit" ? draft.event.id : createId("event");
  const normalizedDaysOfWeek =
    recurrence === "weekly"
      ? (daysOfWeek.length ? daysOfWeek : [getInputDayOfWeek(start)]).sort((left, right) => left - right)
      : undefined;
  const selectedOccurrenceDate =
    draft.mode === "edit" && draft.occurrenceStart
      ? draft.occurrenceStart.slice(0, 10)
      : draft.mode === "edit"
        ? draft.event.start.slice(0, 10)
        : undefined;
  const canChooseDeleteScope =
    draft.mode === "edit" &&
    draft.event.recurrence === "weekly" &&
    Boolean(selectedOccurrenceDate);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto overscroll-contain">
        <Card data-testid="event-editor-dialog">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>{draft.mode === "edit" ? "Edit fixed event" : "Add fixed event"}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Fixed events immediately trigger replanning and feasibility recalculation.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="h-10 w-10 rounded-full p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Title</label>
                <Input
                  data-testid="event-title-input"
                  aria-label="Event title"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="School, gym, lesson..."
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <div className="flex items-center justify-between rounded-sm border border-white/6 bg-white/4 px-4 py-3">
                  <div>
                    <p className="font-medium text-foreground">All-day event</p>
                    <p className="text-sm text-muted-foreground">
                      Show this in the all-day row and block the full study window for that day.
                    </p>
                  </div>
                  <Switch
                    data-testid="event-all-day-switch"
                    aria-label="All-day event"
                    checked={isAllDay}
                    onCheckedChange={(checked) => {
                      setIsAllDay(checked);
                      if (checked) {
                        setStart(start.slice(0, 10));
                        setEnd(end.slice(0, 10));
                        if (recurrence === "weekly" && !repeatUntil) {
                          setRepeatUntil(start.slice(0, 10));
                        }
                        return;
                      }

                      setStart(`${start.slice(0, 10)}T08:00`);
                      setEnd(`${end.slice(0, 10)}T09:00`);
                    }}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Start</label>
                <Input
                  data-testid="event-start-input"
                  aria-label="Event start"
                  type={isAllDay ? "date" : "datetime-local"}
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">End</label>
                <Input
                  data-testid="event-end-input"
                  aria-label="Event end"
                  type={isAllDay ? "date" : "datetime-local"}
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Category</label>
                <Select
                  data-testid="event-category-select"
                  aria-label="Event category"
                  value={category}
                  onChange={(event) => setCategory(event.target.value as FixedEvent["category"])}
                >
                  <option value="school">School</option>
                  <option value="activity">Activity</option>
                  <option value="lesson">Lesson</option>
                  <option value="family">Family</option>
                  <option value="assessment">Assessment</option>
                  <option value="recovery">Recovery</option>
                  <option value="admin">Admin</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Flexibility</label>
                <Select
                  data-testid="event-flexibility-select"
                  aria-label="Event flexibility"
                  value={flexibility}
                  onChange={(event) => setFlexibility(event.target.value as FixedEvent["flexibility"])}
                >
                  <option value="fixed">Fixed</option>
                  <option value="movable">Movable</option>
                  <option value="optional">Optional</option>
                </Select>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recurrence</label>
                <Select
                  data-testid="event-recurrence-select"
                  aria-label="Event recurrence"
                  value={recurrence}
                  onChange={(event) => {
                    const nextValue = event.target.value as FixedEvent["recurrence"];
                    setRecurrence(nextValue);
                    if (nextValue === "weekly" && !daysOfWeek.length) {
                      setDaysOfWeek([getInputDayOfWeek(start)]);
                    }
                    if (nextValue === "weekly" && !repeatUntil) {
                      setRepeatUntil(start.slice(0, 10));
                    }
                  }}
                >
                  <option value="none">One-off</option>
                  <option value="weekly">Weekly</option>
                </Select>
              </div>
              {recurrence === "weekly" ? (
                <div className="space-y-3 md:col-span-2">
                  <div className="flex items-center justify-between gap-3">
                    <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Repeat on</label>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-full border border-white/8 px-3"
                        data-testid="event-weekdays-button"
                        onClick={() => setDaysOfWeek([1, 2, 3, 4, 5])}
                      >
                        Weekdays
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-full border border-white/8 px-3"
                        data-testid="event-every-day-button"
                        onClick={() => setDaysOfWeek([1, 2, 3, 4, 5, 6, 0])}
                      >
                        Every day
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="rounded-full border border-white/8 px-3"
                        data-testid="event-clear-days-button"
                        onClick={() => setDaysOfWeek([])}
                      >
                        Clear
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {weekdayOptions.map((option) => {
                      const active = daysOfWeek.includes(option.value);

                      return (
                        <Button
                          key={option.value}
                          type="button"
                          variant={active ? "default" : "ghost"}
                          size="sm"
                          className="min-w-12 rounded-full"
                          data-testid={`event-weekday-${option.label.toLowerCase()}`}
                          onClick={() =>
                            setDaysOfWeek((current) =>
                              current.includes(option.value)
                                ? current.filter((day) => day !== option.value)
                                : [...current, option.value].sort((left, right) => left - right),
                            )
                          }
                        >
                          {option.label}
                        </Button>
                      );
                    })}
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Use one recurring event for any same-time pattern such as school Monday to Friday.
                    If gym is Tuesday and Thursday with different durations, create two weekly events.
                  </p>
                  <div className="grid gap-2 md:max-w-xs">
                    <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                      Repeat until
                    </label>
                    <Input
                      data-testid="event-repeat-until-input"
                      aria-label="Repeat until"
                      type="date"
                      value={repeatUntil}
                      min={start.slice(0, 10)}
                      onChange={(event) => setRepeatUntil(event.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      The event repeats on the selected weekdays up to and including this date.
                    </p>
                  </div>
                </div>
              ) : null}
              <div className="space-y-2 md:col-span-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Notes</label>
                <Textarea
                  data-testid="event-notes-input"
                  aria-label="Event notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Context, travel time, or why this is protected..."
                />
              </div>
            </div>

            <div className="flex flex-wrap justify-between gap-3 pt-2">
              <div>
                {draft.mode === "edit" && onDelete ? (
                  <>
                    <Button
                      data-testid="event-delete-button"
                      variant="danger"
                      onClick={() => {
                        if (canChooseDeleteScope) {
                          setShowDeleteOptions((current) => !current);
                          return;
                        }

                        void onDelete({
                          event: draft.event,
                          scope: "series",
                          occurrenceDate: selectedOccurrenceDate,
                        });
                      }}
                    >
                      Delete event
                    </Button>
                    {showDeleteOptions ? (
                      <div className="mt-3 w-full max-w-sm rounded-sm border border-white/8 bg-white/4 p-3">
                        <p className="text-sm font-medium text-foreground">Delete recurring event</p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Choose whether to remove only the selected day or the whole recurring series.
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <Button
                            data-testid="event-delete-occurrence"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void onDelete({
                                event: draft.event,
                                scope: "occurrence",
                                occurrenceDate: selectedOccurrenceDate,
                              })
                            }
                          >
                            Delete this day
                          </Button>
                          <Button
                            data-testid="event-delete-series"
                            variant="danger"
                            size="sm"
                            onClick={() =>
                              void onDelete({
                                event: draft.event,
                                scope: "series",
                                occurrenceDate: selectedOccurrenceDate,
                              })
                            }
                          >
                            Delete entire event
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowDeleteOptions(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  data-testid="event-save-button"
                  onClick={() => {
                    const normalizedRange = isAllDay
                      ? normalizeAllDayRange(start, end)
                      : {
                          start: new Date(start).toISOString(),
                          end:
                            recurrence === "weekly"
                              ? normalizeRecurringEnd(start, end)
                              : new Date(end).toISOString(),
                        };

                    void onSave({
                      id: eventId,
                      title,
                      start: normalizedRange.start,
                      end: normalizedRange.end,
                      isAllDay,
                      category,
                      flexibility,
                      recurrence,
                      daysOfWeek: normalizedDaysOfWeek,
                      repeatUntil:
                        recurrence === "weekly"
                          ? repeatUntil || start.slice(0, 10)
                          : undefined,
                      excludedDates:
                        draft.mode === "edit" ? draft.event.excludedDates : undefined,
                      notes,
                    });
                  }}
                >
                  Save event
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
