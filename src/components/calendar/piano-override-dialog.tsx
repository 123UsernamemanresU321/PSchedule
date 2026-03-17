"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { Music4, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { fromDateKey } from "@/lib/dates/helpers";
import type { Preferences } from "@/lib/types/planner";

interface PianoOverrideDialogProps {
  open: boolean;
  defaultDate: string | null;
  defaultMode?: "add" | "remove";
  preferences: Preferences | null;
  onClose: () => void;
  onSave: (preferences: Preferences) => Promise<void>;
}

function sortDateKeys(values: Set<string>) {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function getPianoRule(preferences: Preferences | null) {
  return preferences?.reservedCommitmentRules.find((rule) => rule.id === "piano-practice") ?? null;
}

function describePianoStatus(dateKey: string, preferences: Preferences | null) {
  const pianoRule = getPianoRule(preferences);
  if (!pianoRule) {
    return "Piano practice rule is not configured.";
  }

  if (pianoRule.additionalDates?.includes(dateKey)) {
    return "Piano is currently added specifically for this date.";
  }

  if (pianoRule.excludedDates?.includes(dateKey)) {
    return "Piano is currently removed for this date.";
  }

  if (pianoRule.days.includes(fromDateKey(dateKey).getDay())) {
    return "Piano is currently scheduled by the weekly recurring rule.";
  }

  return "Piano is not currently scheduled for this date.";
}

function applyPianoOverride(
  preferences: Preferences,
  dateKey: string,
  mode: "add" | "remove",
) {
  const pianoRule = getPianoRule(preferences);
  if (!pianoRule) {
    return preferences;
  }

  const dayIndex = fromDateKey(dateKey).getDay();
  const isDefaultPianoDay = pianoRule.days.includes(dayIndex);
  const additionalDates = new Set(pianoRule.additionalDates ?? []);
  const excludedDates = new Set(pianoRule.excludedDates ?? []);

  if (mode === "add") {
    excludedDates.delete(dateKey);
    if (isDefaultPianoDay) {
      additionalDates.delete(dateKey);
    } else {
      additionalDates.add(dateKey);
    }
  } else if (isDefaultPianoDay) {
    additionalDates.delete(dateKey);
    excludedDates.add(dateKey);
  } else {
    additionalDates.delete(dateKey);
    excludedDates.delete(dateKey);
  }

  return {
    ...preferences,
    reservedCommitmentRules: preferences.reservedCommitmentRules.map((rule) =>
      rule.id === "piano-practice"
        ? {
            ...rule,
            additionalDates: sortDateKeys(additionalDates),
            excludedDates: sortDateKeys(excludedDates),
          }
        : rule,
    ),
  };
}

export function PianoOverrideDialog({
  open,
  defaultDate,
  defaultMode = "add",
  preferences,
  onClose,
  onSave,
}: PianoOverrideDialogProps) {
  const pianoRule = getPianoRule(preferences);
  const initialDate = defaultDate ?? format(new Date(), "yyyy-MM-dd");
  const [dateKey, setDateKey] = useState(initialDate);
  const [mode, setMode] = useState<"add" | "remove">(defaultMode);

  useEffect(() => {
    setDateKey(initialDate);
  }, [initialDate]);

  useEffect(() => {
    setMode(defaultMode);
  }, [defaultMode]);

  const statusDescription = useMemo(
    () => describePianoStatus(dateKey, preferences),
    [dateKey, preferences],
  );

  if (!open || !preferences || !pianoRule) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl">
        <Card data-testid="piano-override-dialog">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>Adjust piano for one day</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Add piano on a normally free day, or remove it for a specific date without changing the weekly rule.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="h-10 w-10 rounded-full p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-sm border border-white/6 bg-white/4 p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-full border border-white/10 bg-white/6 p-2 text-primary">
                  <Music4 className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">Current piano rule</p>
                  <p className="text-sm text-muted-foreground">
                    Weekly days: {pianoRule.days
                      .map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day])
                      .join(", ")} at {pianoRule.preferredStart}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Date</label>
                <Input
                  data-testid="piano-override-date"
                  type="date"
                  value={dateKey}
                  onChange={(event) => setDateKey(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Action</label>
                <Select
                  data-testid="piano-override-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as "add" | "remove")}
                >
                  <option value="add">Add piano on this date</option>
                  <option value="remove">Remove piano on this date</option>
                </Select>
              </div>
            </div>

            <div className="rounded-sm border border-white/6 bg-white/4 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Current status</p>
              <p className="mt-2 text-sm text-foreground">{statusDescription}</p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                data-testid="piano-override-save"
                onClick={() => void onSave(applyPianoOverride(preferences, dateKey, mode))}
              >
                Save piano change
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
