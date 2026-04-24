"use client";

import { CalendarX2, X } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { NoSchoolDay } from "@/lib/types/planner";

interface NoSchoolDayDialogProps {
  open: boolean;
  defaultDate: string | null;
  existingNoSchoolDay: NoSchoolDay | null;
  onClose: () => void;
  onSave: (noSchoolDay: NoSchoolDay) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function NoSchoolDayDialog({
  open,
  defaultDate,
  existingNoSchoolDay,
  onClose,
  onSave,
  onDelete,
}: NoSchoolDayDialogProps) {
  const [dateKey, setDateKey] = useState(existingNoSchoolDay?.date ?? defaultDate ?? "");
  const [label, setLabel] = useState(existingNoSchoolDay?.label ?? "No School");
  const [notes, setNotes] = useState(existingNoSchoolDay?.notes ?? "");

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/55 p-4 backdrop-blur-sm">
      <div className="flex h-full items-center justify-center">
        <div className="w-full max-w-xl">
          <Card
            data-testid="no-school-day-dialog"
            className="flex max-h-[calc(100vh-2rem)] min-h-0 flex-col overflow-hidden"
          >
            <CardHeader className="flex-row items-start justify-between">
              <div>
                <CardTitle>Mark no school</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  This date is treated like a holiday/weekend study day inside the school term.
                </p>
              </div>
              <Button variant="ghost" size="sm" className="h-10 w-10 rounded-full p-0" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent className="min-h-0 space-y-5 overflow-y-auto overscroll-y-contain">
              <div className="grid gap-4 md:grid-cols-[180px_1fr]">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Date</label>
                  <Input
                    data-testid="no-school-day-date"
                    type="date"
                    value={dateKey}
                    onChange={(event) => setDateKey(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Label</label>
                  <Input
                    data-testid="no-school-day-label"
                    value={label}
                    onChange={(event) => setLabel(event.target.value)}
                    placeholder="No School"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Notes</label>
                <Textarea
                  data-testid="no-school-day-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Protest, long weekend, school closure..."
                />
              </div>

              <div className="rounded-sm border border-warning/25 bg-warning/10 px-4 py-3">
                <div className="flex gap-3 text-sm text-warning">
                  <CalendarX2 className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    The planner will skip generated school hours and school-term weekday templates on this date.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-between gap-2">
                <div>
                  {existingNoSchoolDay && existingNoSchoolDay.date === dateKey ? (
                    <Button
                      variant="outline"
                      data-testid="no-school-day-delete"
                      onClick={() => void onDelete(existingNoSchoolDay.id)}
                    >
                      Clear no school
                    </Button>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    data-testid="no-school-day-save"
                    disabled={!dateKey}
                    onClick={() =>
                      void onSave({
                        id: existingNoSchoolDay?.id ?? "",
                        date: dateKey,
                        label: label.trim() || "No School",
                        notes: notes.trim() || undefined,
                      })
                    }
                  >
                    Save no school
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
