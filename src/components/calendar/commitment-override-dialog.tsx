"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { BookOpen, Music4, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { fromDateKey } from "@/lib/dates/helpers";
import type { Preferences } from "@/lib/types/planner";

type CommitmentRuleId = "piano-practice" | "term-homework";

interface CommitmentOverrideDialogProps {
  open: boolean;
  ruleId: CommitmentRuleId | null;
  defaultDate: string | null;
  defaultMode?: "add" | "remove";
  preferences: Preferences | null;
  onClose: () => void;
  onSave: (preferences: Preferences) => Promise<void>;
}

const commitmentCopy: Record<
  CommitmentRuleId,
  {
    singular: string;
    title: string;
    addLabel: string;
    removeLabel: string;
    configuredLabel: string;
    missingLabel: string;
    addedLabel: string;
    removedLabel: string;
    defaultLabel: string;
  }
> = {
  "piano-practice": {
    singular: "piano",
    title: "Adjust piano for one day",
    addLabel: "Add piano on this date",
    removeLabel: "Remove piano on this date",
    configuredLabel: "Current piano rule",
    missingLabel: "Piano practice rule is not configured.",
    addedLabel: "Piano is currently added specifically for this date.",
    removedLabel: "Piano is currently removed for this date.",
    defaultLabel: "Piano is currently scheduled by the recurring rule.",
  },
  "term-homework": {
    singular: "homework",
    title: "Adjust homework for one day",
    addLabel: "Add homework on this date",
    removeLabel: "Remove homework on this date",
    configuredLabel: "Current homework rule",
    missingLabel: "Homework rule is not configured.",
    addedLabel: "Homework is currently added specifically for this date.",
    removedLabel: "Homework is currently removed for this date.",
    defaultLabel: "Homework is currently scheduled by the recurring rule.",
  },
};

function sortDateKeys(values: Set<string>) {
  return Array.from(values).sort((left, right) => left.localeCompare(right));
}

function getCommitmentRule(preferences: Preferences | null, ruleId: CommitmentRuleId | null) {
  if (!preferences || !ruleId) {
    return null;
  }

  return preferences.reservedCommitmentRules.find((rule) => rule.id === ruleId) ?? null;
}

function describeCommitmentStatus(
  ruleId: CommitmentRuleId,
  dateKey: string,
  preferences: Preferences | null,
) {
  const copy = commitmentCopy[ruleId];
  const rule = getCommitmentRule(preferences, ruleId);
  if (!rule) {
    return copy.missingLabel;
  }

  if (rule.additionalDates?.includes(dateKey)) {
    return copy.addedLabel;
  }

  if (rule.excludedDates?.includes(dateKey)) {
    return copy.removedLabel;
  }

  if (rule.days.includes(fromDateKey(dateKey).getDay())) {
    return copy.defaultLabel;
  }

  return `${rule.label} is not currently scheduled for this date.`;
}

function applyCommitmentOverride(
  preferences: Preferences,
  ruleId: CommitmentRuleId,
  dateKey: string,
  mode: "add" | "remove",
) {
  const rule = getCommitmentRule(preferences, ruleId);
  if (!rule) {
    return preferences;
  }

  const dayIndex = fromDateKey(dateKey).getDay();
  const isDefaultDay = rule.days.includes(dayIndex);
  const additionalDates = new Set(rule.additionalDates ?? []);
  const excludedDates = new Set(rule.excludedDates ?? []);

  if (mode === "add") {
    excludedDates.delete(dateKey);
    if (isDefaultDay) {
      additionalDates.delete(dateKey);
    } else {
      additionalDates.add(dateKey);
    }
  } else if (isDefaultDay) {
    additionalDates.delete(dateKey);
    excludedDates.add(dateKey);
  } else {
    additionalDates.delete(dateKey);
    excludedDates.delete(dateKey);
  }

  return {
    ...preferences,
    reservedCommitmentRules: preferences.reservedCommitmentRules.map((candidate) =>
      candidate.id === ruleId
        ? {
            ...candidate,
            additionalDates: sortDateKeys(additionalDates),
            excludedDates: sortDateKeys(excludedDates),
          }
        : candidate,
    ),
  };
}

export function CommitmentOverrideDialog({
  open,
  ruleId,
  defaultDate,
  defaultMode = "add",
  preferences,
  onClose,
  onSave,
}: CommitmentOverrideDialogProps) {
  const initialDate = defaultDate ?? format(new Date(), "yyyy-MM-dd");
  const [dateKey, setDateKey] = useState(initialDate);
  const [mode, setMode] = useState<"add" | "remove">(defaultMode);
  const [durationMinutes, setDurationMinutes] = useState(90);
  const [startTime, setStartTime] = useState("18:00");

  useEffect(() => {
    setDateKey(initialDate);
  }, [initialDate]);

  useEffect(() => {
    setMode(defaultMode);
  }, [defaultMode]);

  useEffect(() => {
    if (!ruleId) {
      return;
    }

    const nextRule = getCommitmentRule(preferences, ruleId);
    if (!nextRule) {
      return;
    }

    setDurationMinutes(nextRule.durationOverrides?.[dateKey] ?? nextRule.durationMinutes);
    setStartTime(nextRule.timeOverrides?.[dateKey]?.start ?? nextRule.preferredStart);
  }, [dateKey, preferences, ruleId]);

  const rule = getCommitmentRule(preferences, ruleId);
  const copy = ruleId ? commitmentCopy[ruleId] : null;
  const supportsDurationOverride = ruleId === "term-homework";
  const supportsTimeOverride = ruleId === "piano-practice" || ruleId === "term-homework";
  const statusDescription = useMemo(() => {
    if (!ruleId) {
      return "";
    }

    return describeCommitmentStatus(ruleId, dateKey, preferences);
  }, [dateKey, preferences, ruleId]);

  if (!open || !preferences || !ruleId || !rule || !copy) {
    return null;
  }

  const icon =
    ruleId === "piano-practice" ? (
      <Music4 className="h-4 w-4" />
    ) : (
      <BookOpen className="h-4 w-4" />
    );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl">
        <Card data-testid="commitment-override-dialog">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>{copy.title}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Add {copy.singular} on a normally free day, or remove it for a specific date without changing the weekly rule.
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
                  {icon}
                </div>
                <div className="space-y-1">
                  <p className="font-medium text-foreground">{copy.configuredLabel}</p>
                  <p className="text-sm text-muted-foreground">
                    Weekly days: {rule.days
                      .map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day])
                      .join(", ")} at {rule.preferredStart}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Date</label>
                <Input
                  data-testid="commitment-override-date"
                  type="date"
                  value={dateKey}
                  onChange={(event) => setDateKey(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Action</label>
                <Select
                  data-testid="commitment-override-mode"
                  value={mode}
                  onChange={(event) => setMode(event.target.value as "add" | "remove")}
                >
                  <option value="add">{copy.addLabel}</option>
                  <option value="remove">{copy.removeLabel}</option>
                </Select>
              </div>
            </div>

            {supportsDurationOverride && mode === "add" ? (
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Homework length (minutes)
                </label>
                <Input
                  data-testid="commitment-override-duration"
                  type="number"
                  min={30}
                  step={15}
                  value={durationMinutes}
                  onChange={(event) => setDurationMinutes(Number(event.target.value))}
                />
                <p className="text-sm text-muted-foreground">
                  This length will apply only to the selected date.
                </p>
              </div>
            ) : null}

            {supportsTimeOverride && mode === "add" ? (
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  <span className="capitalize">{copy.singular}</span> start time
                </label>
                <Input
                  data-testid="commitment-override-start-time"
                  type="time"
                  step={900}
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  <span className="capitalize">{copy.singular}</span> will take this slot first, and the planner will move overlapping study later in the day or into the next day when needed.
                </p>
              </div>
            ) : null}

            <div className="rounded-sm border border-white/6 bg-white/4 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Current status</p>
              <p className="mt-2 text-sm text-foreground">{statusDescription}</p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button
                data-testid="commitment-override-save"
                onClick={() =>
                  void onSave(
                    applyCommitmentOverrideWithDuration(
                      preferences,
                      ruleId,
                      dateKey,
                      mode,
                      supportsDurationOverride ? durationMinutes : null,
                      supportsTimeOverride ? startTime : null,
                    ),
                  )
                }
              >
                Save {copy.singular} change
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function applyCommitmentOverrideWithDuration(
  preferences: Preferences,
  ruleId: CommitmentRuleId,
  dateKey: string,
  mode: "add" | "remove",
  durationMinutes: number | null,
  startTime: string | null,
) {
  const nextPreferences = applyCommitmentOverride(preferences, ruleId, dateKey, mode);

  return {
    ...nextPreferences,
    reservedCommitmentRules: nextPreferences.reservedCommitmentRules.map((rule) =>
      rule.id === ruleId
        ? {
            ...rule,
            durationOverrides:
              ruleId === "term-homework" && durationMinutes && mode === "add"
                ? {
                    ...(rule.durationOverrides ?? {}),
                    [dateKey]: Math.max(30, Math.round(durationMinutes / 15) * 15),
                  }
                : Object.fromEntries(
                    Object.entries(rule.durationOverrides ?? {}).filter(([key]) => key !== dateKey),
                  ),
            timeOverrides:
              (ruleId === "piano-practice" || ruleId === "term-homework") && startTime && mode === "add" && startTime !== rule.preferredStart
                ? {
                    ...(rule.timeOverrides ?? {}),
                    [dateKey]: {
                      start: startTime,
                    },
                  }
                : Object.fromEntries(
                    Object.entries(rule.timeOverrides ?? {}).filter(([key]) => key !== dateKey),
                  ),
          }
        : rule,
    ),
  };
}
