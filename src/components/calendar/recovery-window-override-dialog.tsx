"use client";

import { useEffect, useMemo, useState } from "react";
import { Coffee, Soup, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Preferences } from "@/lib/types/planner";

type RecoveryWindowLabel = "Lunch break" | "Dinner reset";

interface RecoveryWindowOverrideDialogProps {
  open: boolean;
  label: RecoveryWindowLabel | null;
  defaultDate: string | null;
  preferences: Preferences | null;
  onClose: () => void;
  onSave: (preferences: Preferences) => Promise<void>;
}

const recoveryWindowCopy: Record<
  RecoveryWindowLabel,
  {
    title: string;
    singular: string;
    configuredLabel: string;
    helperText: string;
  }
> = {
  "Lunch break": {
    title: "Adjust lunch for one day",
    singular: "lunch",
    configuredLabel: "Current lunch rule",
    helperText: "Change lunch time on one specific date without editing the recurring default.",
  },
  "Dinner reset": {
    title: "Adjust dinner for one day",
    singular: "dinner",
    configuredLabel: "Current dinner rule",
    helperText: "Change dinner time on one specific date without editing the recurring default.",
  },
};

function getRecoveryWindow(preferences: Preferences | null, label: RecoveryWindowLabel | null) {
  if (!preferences || !label) {
    return null;
  }

  return preferences.lockedRecoveryWindows.find((window) => window.label === label) ?? null;
}

function buildNextPreferences(options: {
  preferences: Preferences;
  label: RecoveryWindowLabel;
  dateKey: string;
  start: string;
  end: string;
}) {
  const window = getRecoveryWindow(options.preferences, options.label);
  if (!window) {
    return options.preferences;
  }

  const nextOverrides = { ...(window.timeOverrides ?? {}) };
  if (options.start === window.start && options.end === window.end) {
    delete nextOverrides[options.dateKey];
  } else {
    nextOverrides[options.dateKey] = {
      start: options.start,
      end: options.end,
    };
  }

  return {
    ...options.preferences,
    lockedRecoveryWindows: options.preferences.lockedRecoveryWindows.map((candidate) =>
      candidate.label === options.label
        ? {
            ...candidate,
            timeOverrides: Object.fromEntries(
              Object.entries(nextOverrides).sort(([left], [right]) => left.localeCompare(right)),
            ),
          }
        : candidate,
    ),
  };
}

export function RecoveryWindowOverrideDialog({
  open,
  label,
  defaultDate,
  preferences,
  onClose,
  onSave,
}: RecoveryWindowOverrideDialogProps) {
  const initialDate = defaultDate ?? new Date().toISOString().slice(0, 10);
  const [dateKey, setDateKey] = useState(initialDate);
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("13:30");

  useEffect(() => {
    setDateKey(initialDate);
  }, [initialDate]);

  useEffect(() => {
    const window = getRecoveryWindow(preferences, label);
    if (!window) {
      return;
    }

    const override = window.timeOverrides?.[dateKey];
    setStartTime(override?.start ?? window.start);
    setEndTime(override?.end ?? window.end);
  }, [dateKey, label, preferences]);

  const window = getRecoveryWindow(preferences, label);
  const copy = label ? recoveryWindowCopy[label] : null;
  const hasOverride = !!window?.timeOverrides?.[dateKey];
  const icon = label === "Dinner reset" ? <Soup className="h-4 w-4" /> : <Coffee className="h-4 w-4" />;
  const statusDescription = useMemo(() => {
    if (!window) {
      return "";
    }

    if (hasOverride) {
      return `${copy?.singular ?? "This window"} is currently overridden for ${dateKey}.`;
    }

    return `${copy?.singular ?? "This window"} is currently following the recurring default time on ${dateKey}.`;
  }, [copy?.singular, dateKey, hasOverride, window]);

  if (!open || !preferences || !label || !window || !copy) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl">
        <Card data-testid="recovery-window-override-dialog">
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>{copy.title}</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">{copy.helperText}</p>
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
                    Weekly days: {window.days
                      .map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day])
                      .join(", ")} at {window.start} - {window.end}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Date</label>
                <Input
                  data-testid="recovery-window-override-date"
                  type="date"
                  value={dateKey}
                  onChange={(event) => setDateKey(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Start</label>
                <Input
                  data-testid="recovery-window-override-start"
                  type="time"
                  value={startTime}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">End</label>
                <Input
                  data-testid="recovery-window-override-end"
                  type="time"
                  value={endTime}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </div>
            </div>

            <div className="rounded-sm border border-white/6 bg-white/4 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Current status</p>
              <p className="mt-2 text-sm text-foreground">{statusDescription}</p>
            </div>

            <div className="flex justify-between gap-3">
              <Button
                variant="ghost"
                onClick={() => {
                  setStartTime(window.start);
                  setEndTime(window.end);
                }}
              >
                Reset form
              </Button>
              <div className="flex gap-3">
                {hasOverride ? (
                  <Button
                    variant="outline"
                    onClick={() =>
                      void onSave(
                        buildNextPreferences({
                          preferences,
                          label,
                          dateKey,
                          start: window.start,
                          end: window.end,
                        }),
                      ).then(onClose)
                    }
                  >
                    Clear override
                  </Button>
                ) : null}
                <Button
                  data-testid="recovery-window-override-save"
                  onClick={() =>
                    void onSave(
                      buildNextPreferences({
                        preferences,
                        label,
                        dateKey,
                        start: startTime,
                        end: endTime,
                      }),
                    ).then(onClose)
                  }
                >
                  Save
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
