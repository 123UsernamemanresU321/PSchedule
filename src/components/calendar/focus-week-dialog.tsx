"use client";

import { useMemo, useState } from "react";
import { Crosshair, X } from "lucide-react";

import { getSubjectAccentStyles } from "@/components/planner/subject-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatWeekRangeLabel, fromDateKey } from "@/lib/dates/helpers";
import type { FocusedWeek, Subject } from "@/lib/types/planner";

interface FocusWeekDialogProps {
  open: boolean;
  weekStart: string | null;
  existingFocusedWeek: FocusedWeek | null;
  subjects: Subject[];
  onClose: () => void;
  onSave: (focusedWeek: FocusedWeek) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

function sortSubjectIds(subjectIds: string[]) {
  return Array.from(new Set(subjectIds)).sort((left, right) => left.localeCompare(right));
}

export function FocusWeekDialog({
  open,
  weekStart,
  existingFocusedWeek,
  subjects,
  onClose,
  onSave,
  onDelete,
}: FocusWeekDialogProps) {
  const effectiveWeekStart = existingFocusedWeek?.weekStart ?? weekStart ?? "";
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(
    existingFocusedWeek?.subjectIds ?? [],
  );
  const [notes, setNotes] = useState(existingFocusedWeek?.notes ?? "");

  const selectedSubjectNames = useMemo(
    () =>
      subjects
        .filter((subject) => selectedSubjectIds.includes(subject.id))
        .map((subject) => subject.shortName),
    [selectedSubjectIds, subjects],
  );

  if (!open || !effectiveWeekStart) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/55 p-4 backdrop-blur-sm">
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-2xl">
          <Card
            data-testid="focus-week-dialog"
            className="flex max-h-[calc(100vh-2rem)] min-h-0 flex-col overflow-hidden"
          >
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle>Set subject focus for one week</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  The selected subjects will get the majority share of planner-generated study time
                  across this visible Monday to Sunday week, unless a specific day overrides it.
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-10 w-10 rounded-full p-0"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 space-y-5 overflow-y-auto overscroll-y-contain">
              <div className="grid gap-4 md:grid-cols-[240px_1fr]">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Week
                  </label>
                  <div className="rounded-sm border border-white/6 bg-white/4 px-4 py-3 text-sm text-foreground">
                    {formatWeekRangeLabel(fromDateKey(effectiveWeekStart))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Selected subjects
                  </label>
                  <div className="rounded-sm border border-white/6 bg-white/4 px-4 py-3 text-sm text-foreground">
                    {selectedSubjectNames.length
                      ? selectedSubjectNames.join(", ")
                      : "No focus subjects selected yet."}
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Subjects
                </label>
                <div className="grid gap-3 md:grid-cols-2">
                  {subjects.map((subject) => {
                    const isSelected = selectedSubjectIds.includes(subject.id);
                    return (
                      <button
                        key={subject.id}
                        type="button"
                        data-testid={`focus-week-subject-${subject.id}`}
                        className="flex items-start justify-between rounded-sm border px-4 py-3 text-left transition hover:bg-white/6"
                        style={
                          isSelected
                            ? getSubjectAccentStyles(subject.id)
                            : {
                                backgroundColor: "rgba(255, 255, 255, 0.04)",
                                borderColor: "rgba(255, 255, 255, 0.08)",
                                color: "rgba(226, 232, 240, 0.92)",
                              }
                        }
                        onClick={() =>
                          setSelectedSubjectIds((current) =>
                            current.includes(subject.id)
                              ? current.filter((subjectId) => subjectId !== subject.id)
                              : sortSubjectIds([...current, subject.id]),
                          )
                        }
                      >
                        <div className="space-y-1">
                          <p className="font-medium">{subject.name}</p>
                          <p className="text-sm opacity-80">{subject.description}</p>
                        </div>
                        <Crosshair
                          className={`mt-0.5 h-4 w-4 ${isSelected ? "opacity-100" : "opacity-30"}`}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Optional note
                </label>
                <Textarea
                  data-testid="focus-week-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Optional reminder for why this week is focused."
                />
              </div>

              <div className="rounded-sm border border-primary/20 bg-primary/8 px-4 py-3">
                <p className="text-sm text-foreground">
                  Daily focus still wins on a specific date. Weekly focus fills the rest of the
                  visible week with the same majority-share focus rule.
                </p>
              </div>

              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  {existingFocusedWeek ? (
                    <Button
                      variant="outline"
                      data-testid="focus-week-delete"
                      onClick={() => void onDelete(existingFocusedWeek.id)}
                    >
                      Clear week focus
                    </Button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    data-testid="focus-week-save"
                    disabled={selectedSubjectIds.length === 0}
                    onClick={() =>
                      void onSave({
                        id: existingFocusedWeek?.id ?? "",
                        weekStart: effectiveWeekStart,
                        subjectIds: selectedSubjectIds as FocusedWeek["subjectIds"],
                        notes: notes.trim() || undefined,
                      })
                    }
                  >
                    Save week focus
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
