"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Plus, Trash2, Upload } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SubjectBadge } from "@/components/planner/subject-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toDateKey } from "@/lib/dates/helpers";
import { createExportFilename } from "@/lib/storage/json-transfer";
import { usePlannerStore } from "@/lib/store/planner-store";
import type { Preferences, SickDay } from "@/lib/types/planner";
import { createId } from "@/lib/utils";

const weekdayOptions = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
] as const;

const sickDaySeverityDescriptions: Record<
  SickDay["severity"],
  { label: string; description: string }
> = {
  light: {
    label: "Light",
    description: "Mild cold. The planner keeps the day lighter than normal and limits intense sessions.",
  },
  moderate: {
    label: "Moderate",
    description: "Tired or foggy. Essential work only, no deep work, and no piano practice.",
  },
  severe: {
    label: "Severe",
    description: "Recovery-first. Only minimal light maintenance if unavoidable.",
  },
};

export function SettingsPage() {
  const preferences = usePlannerStore((state) => state.preferences);
  const subjects = usePlannerStore((state) => state.subjects);
  const sickDays = usePlannerStore((state) => state.sickDays);
  const saveSickDay = usePlannerStore((state) => state.saveSickDay);
  const deleteSickDay = usePlannerStore((state) => state.deleteSickDay);
  const updatePreferences = usePlannerStore((state) => state.updatePreferences);
  const exportToJson = usePlannerStore((state) => state.exportToJson);
  const importFromJson = usePlannerStore((state) => state.importFromJson);
  const [form, setForm] = useState<Preferences | null>(preferences);
  const [sickDayDrafts, setSickDayDrafts] = useState<SickDay[]>(sickDays);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preferences) {
      // Sync the editable settings form when IndexedDB state finishes bootstrapping.
      setForm(preferences);
    }
  }, [preferences]);

  useEffect(() => {
    setSickDayDrafts(sickDays);
  }, [sickDays]);

  if (!form) {
    return null;
  }

  const appendSchoolTerm = (label: string) => {
    setForm({
      ...form,
      schoolSchedule: {
        ...form.schoolSchedule,
        terms: [
          ...form.schoolSchedule.terms,
          { id: createId("term"), label, startDate: "", endDate: "" },
        ],
      },
    });
  };

  const appendNextYearTerms = () => {
    const existing2027Terms = form.schoolSchedule.terms.filter((term) =>
      term.label.includes("2027"),
    ).length;
    const nextTerms = [1, 2, 3, 4].map((termNumber) => ({
      id: createId("term"),
      label: `2027 Term ${existing2027Terms + termNumber}`,
      startDate: "",
      endDate: "",
    }));

    setForm({
      ...form,
      schoolSchedule: {
        ...form.schoolSchedule,
        terms: [...form.schoolSchedule.terms, ...nextTerms],
      },
    });
  };

  const appendSickDay = () => {
    const today = toDateKey(new Date());
    setSickDayDrafts((current) => [
      ...current,
      {
        id: createId("sick"),
        startDate: today,
        endDate: today,
        severity: "light",
        notes: "",
      },
    ]);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Change the school-term routine, holiday routine, daily caps, buffer rules, and subject weights that the planner uses for deterministic horizon planning."
        actions={
          <>
            <Button
              variant="outline"
              onClick={async () => {
                const json = await exportToJson();
                const blob = new Blob([json], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const anchor = document.createElement("a");
                anchor.href = url;
                anchor.download = createExportFilename();
                anchor.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="h-4 w-4" />
              Export JSON
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json"
              className="hidden"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) {
                  return;
                }

                const raw = await file.text();
                await importFromJson(raw);
              }}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Import JSON
            </Button>
            <Button onClick={() => void updatePreferences(form)}>Save preferences</Button>
          </>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>School schedule</CardTitle>
              <p className="text-sm text-muted-foreground">
                Define school hours and term dates once. The planner will treat holidays as extra free capacity automatically.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-sm border border-white/6 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-foreground">Use school schedule</p>
                    <p className="text-sm text-muted-foreground">
                      Generates school blocks on active term weekdays without needing separate recurring events.
                    </p>
                  </div>
                  <Switch
                    checked={form.schoolSchedule.enabled}
                    onCheckedChange={(checked) =>
                      setForm({
                        ...form,
                        schoolSchedule: {
                          ...form.schoolSchedule,
                          enabled: checked,
                        },
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">School start</label>
                  <Input
                    type="time"
                    value={form.schoolSchedule.start}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        schoolSchedule: {
                          ...form.schoolSchedule,
                          start: event.target.value,
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">School end</label>
                  <Input
                    type="time"
                    value={form.schoolSchedule.end}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        schoolSchedule: {
                          ...form.schoolSchedule,
                          end: event.target.value,
                        },
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">School weekdays</label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="rounded-full border border-white/8 px-3"
                    onClick={() =>
                      setForm({
                        ...form,
                        schoolSchedule: {
                          ...form.schoolSchedule,
                          weekdays: [1, 2, 3, 4, 5],
                        },
                      })
                    }
                  >
                    Weekdays
                  </Button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {weekdayOptions.map((option) => {
                    const active = form.schoolSchedule.weekdays.includes(option.value);

                    return (
                      <Button
                        key={option.value}
                        type="button"
                        variant={active ? "default" : "ghost"}
                        size="sm"
                        className="min-w-12 rounded-full"
                        onClick={() =>
                          setForm({
                            ...form,
                            schoolSchedule: {
                              ...form.schoolSchedule,
                              weekdays: active
                                ? form.schoolSchedule.weekdays.filter((day) => day !== option.value)
                                : [...form.schoolSchedule.weekdays, option.value].sort((left, right) => left - right),
                            },
                          })
                        }
                      >
                        {option.label}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Term dates</label>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-full border border-white/8 px-3"
                      onClick={() => appendSchoolTerm(`Term ${form.schoolSchedule.terms.length + 1}`)}
                    >
                      <Plus className="h-4 w-4" />
                      Add term
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="rounded-full border border-white/8 px-3"
                      onClick={appendNextYearTerms}
                    >
                      <Plus className="h-4 w-4" />
                      Add 2027 terms
                    </Button>
                  </div>
                </div>
                {form.schoolSchedule.terms.map((term, index) => (
                  <div key={term.id} className="rounded-sm border border-white/6 bg-white/4 p-4">
                    <div className="mb-3 flex items-center justify-between gap-3">
                      <p className="text-sm font-medium text-foreground">{term.label}</p>
                      {form.schoolSchedule.terms.length > 1 ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 rounded-full border border-white/8"
                          onClick={() =>
                            setForm({
                              ...form,
                              schoolSchedule: {
                                ...form.schoolSchedule,
                                terms: form.schoolSchedule.terms.filter((candidate) => candidate.id !== term.id),
                              },
                            })
                          }
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      ) : null}
                    </div>
                    <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)]">
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Label</label>
                        <Input
                          value={term.label}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              schoolSchedule: {
                                ...form.schoolSchedule,
                                terms: form.schoolSchedule.terms.map((candidate, candidateIndex) =>
                                  candidateIndex === index
                                    ? { ...candidate, label: event.target.value }
                                    : candidate,
                                ),
                              },
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Start date</label>
                        <Input
                          type="date"
                          value={term.startDate}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              schoolSchedule: {
                                ...form.schoolSchedule,
                                terms: form.schoolSchedule.terms.map((candidate, candidateIndex) =>
                                  candidateIndex === index
                                    ? { ...candidate, startDate: event.target.value }
                                    : candidate,
                                ),
                              },
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">End date</label>
                        <Input
                          type="date"
                          value={term.endDate}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              schoolSchedule: {
                                ...form.schoolSchedule,
                                terms: form.schoolSchedule.terms.map((candidate, candidateIndex) =>
                                  candidateIndex === index
                                    ? { ...candidate, endDate: event.target.value }
                                    : candidate,
                                ),
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Holiday routine</CardTitle>
              <p className="text-sm text-muted-foreground">
                Outside school terms, the planner can switch to a dedicated holiday study day starting at 08:00.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-sm border border-white/6 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-foreground">Use holiday routine outside terms</p>
                    <p className="text-sm text-muted-foreground">
                      Applies the holiday study window and deep-work preferences whenever a date is outside the configured school terms.
                    </p>
                  </div>
                  <Switch
                    checked={form.holidaySchedule.enabled}
                    onCheckedChange={(checked) =>
                      setForm({
                        ...form,
                        holidaySchedule: {
                          ...form.holidaySchedule,
                          enabled: checked,
                        },
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Holiday start</label>
                  <Input
                    type="time"
                    value={form.holidaySchedule.dailyStudyWindow.start}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        holidaySchedule: {
                          ...form.holidaySchedule,
                          dailyStudyWindow: {
                            ...form.holidaySchedule.dailyStudyWindow,
                            start: event.target.value,
                          },
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Holiday end</label>
                  <Input
                    type="time"
                    value={form.holidaySchedule.dailyStudyWindow.end}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        holidaySchedule: {
                          ...form.holidaySchedule,
                          dailyStudyWindow: {
                            ...form.holidaySchedule.dailyStudyWindow,
                            end: event.target.value,
                          },
                        },
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Holiday soft cap</label>
                  <Input
                    type="number"
                    min={1}
                    max={12}
                    step={0.5}
                    value={form.holidaySchedule.maxStudyHoursPerDay ?? ""}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        holidaySchedule: {
                          ...form.holidaySchedule,
                          maxStudyHoursPerDay: event.target.value
                            ? Number(event.target.value)
                            : null,
                        },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Holiday days and Saturdays now use the full study window whenever hard-goal work still needs coverage. This value only acts as a softer planning preference outside that catch-up behavior.
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                {form.holidaySchedule.preferredDeepWorkWindows.map((window, index) => (
                  <div key={`${window.label}-${index}`} className="rounded-sm border border-white/6 bg-white/4 p-4">
                    <p className="font-medium text-foreground">{window.label}</p>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Start</label>
                        <Input
                          type="time"
                          value={window.start}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              holidaySchedule: {
                                ...form.holidaySchedule,
                                preferredDeepWorkWindows: form.holidaySchedule.preferredDeepWorkWindows.map((candidate, candidateIndex) =>
                                  candidateIndex === index
                                    ? { ...candidate, start: event.target.value }
                                    : candidate,
                                ),
                              },
                            })
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">End</label>
                        <Input
                          type="time"
                          value={window.end}
                          onChange={(event) =>
                            setForm({
                              ...form,
                              holidaySchedule: {
                                ...form.holidaySchedule,
                                preferredDeepWorkWindows: form.holidaySchedule.preferredDeepWorkWindows.map((candidate, candidateIndex) =>
                                  candidateIndex === index
                                    ? { ...candidate, end: event.target.value }
                                    : candidate,
                                ),
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>School-term deep-work windows</CardTitle>
              <p className="text-sm text-muted-foreground">Prime slots are where heavy maths, physics, and Olympiad work should land during active school terms.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {form.preferredDeepWorkWindows.map((window, index) => (
                <div key={`${window.label}-${index}`} className="rounded-sm border border-white/6 bg-white/4 p-4">
                  <p className="font-medium text-foreground">{window.label}</p>
                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Start</label>
                      <Input
                        type="time"
                        value={window.start}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            preferredDeepWorkWindows: form.preferredDeepWorkWindows.map((candidate, candidateIndex) =>
                              candidateIndex === index
                                ? { ...candidate, start: event.target.value }
                                : candidate,
                            ),
                          })
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">End</label>
                      <Input
                        type="time"
                        value={window.end}
                        onChange={(event) =>
                          setForm({
                            ...form,
                            preferredDeepWorkWindows: form.preferredDeepWorkWindows.map((candidate, candidateIndex) =>
                              candidateIndex === index
                                ? { ...candidate, end: event.target.value }
                                : candidate,
                            ),
                          })
                        }
                      />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Session limits</CardTitle>
              <p className="text-sm text-muted-foreground">These caps prevent chain-reaction schedules after disruption.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Max heavy sessions / day</label>
                  <Input
                    type="number"
                    min={1}
                    value={form.maxHeavySessionsPerDay}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        maxHeavySessionsPerDay: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Max study hours / day</label>
                  <Input
                    type="number"
                    step="0.5"
                    min={1}
                    value={form.maxStudyHoursPerDay}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        maxStudyHoursPerDay: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Minimum break (min)</label>
                  <Input
                    type="number"
                    min={5}
                    step={5}
                    value={form.minBreakMinutes}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        minBreakMinutes: Number(event.target.value),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Late-night cutoff</label>
                  <Input
                    type="time"
                    value={form.lateNightCutoff}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        lateNightCutoff: event.target.value,
                      })
                    }
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Sunday planning</CardTitle>
              <p className="text-sm text-muted-foreground">
                Decide whether the planner should use Sundays and how hard Sunday should run compared with a normal study day.
              </p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-sm border border-white/6 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-foreground">Plan study on Sundays</p>
                    <p className="text-sm text-muted-foreground">
                      When off, Sunday stays out of the study horizon. When on, Sunday becomes available subject to the intensity setting below.
                    </p>
                  </div>
                  <Switch
                    checked={form.sundayStudy.enabled}
                    onCheckedChange={(checked) =>
                      setForm({
                        ...form,
                        sundayStudy: {
                          ...form.sundayStudy,
                          enabled: checked,
                        },
                      })
                    }
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Sunday workload intensity</label>
                  <Input
                    type="number"
                    min={0.25}
                    max={1.5}
                    step={0.05}
                    value={form.sundayStudy.workloadIntensity}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        sundayStudy: {
                          ...form.sundayStudy,
                          workloadIntensity: Number(event.target.value),
                        },
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    `1.00` = same cap as a normal day. Lower values make Sunday lighter; higher values let the planner push harder on Sunday.
                  </p>
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Effective Sunday cap</label>
                  <div className="rounded-sm border border-white/6 bg-white/4 px-3 py-2 text-sm text-foreground">
                    {((
                      (form.holidaySchedule.enabled
                        ? ((Number(form.holidaySchedule.dailyStudyWindow.end.slice(0, 2)) * 60 +
                            Number(form.holidaySchedule.dailyStudyWindow.end.slice(3, 5)) -
                            (Number(form.holidaySchedule.dailyStudyWindow.start.slice(0, 2)) * 60 +
                              Number(form.holidaySchedule.dailyStudyWindow.start.slice(3, 5))) +
                            24 * 60) %
                            (24 * 60) || 24 * 60
                          ) / 60
                        : form.maxStudyHoursPerDay) * form.sundayStudy.workloadIntensity
                    )).toFixed(1)} hours
                  </div>
                  <p className="text-xs text-muted-foreground">
                    This is the maximum planned study load for Sunday before fixed events and recovery are subtracted.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-end justify-between gap-4">
              <div>
                <CardTitle>Sick days</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Mark single days or ranges when you are ill. Saving a sick day immediately lightens that date and regenerates the horizon.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={appendSickDay}
                data-testid="settings-add-sick-day"
              >
                <Plus className="h-4 w-4" />
                Add sick day
              </Button>
            </CardHeader>
            <CardContent className="space-y-4">
              {sickDayDrafts.length ? (
                sickDayDrafts.map((sickDay) => {
                  const saved = sickDays.some((candidate) => candidate.id === sickDay.id);
                  const severityCopy = sickDaySeverityDescriptions[sickDay.severity];

                  return (
                    <div
                      key={sickDay.id}
                      className="rounded-sm border border-white/6 bg-white/4 p-4"
                      data-testid="settings-sick-day-row"
                    >
                      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px]">
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">From</label>
                          <Input
                            type="date"
                            value={sickDay.startDate}
                            data-testid={`settings-sick-day-from-${sickDay.id}`}
                            onChange={(event) =>
                              setSickDayDrafts((current) =>
                                current.map((candidate) =>
                                  candidate.id === sickDay.id
                                    ? { ...candidate, startDate: event.target.value }
                                    : candidate,
                                ),
                              )
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">To</label>
                          <Input
                            type="date"
                            value={sickDay.endDate}
                            data-testid={`settings-sick-day-to-${sickDay.id}`}
                            onChange={(event) =>
                              setSickDayDrafts((current) =>
                                current.map((candidate) =>
                                  candidate.id === sickDay.id
                                    ? { ...candidate, endDate: event.target.value }
                                    : candidate,
                                ),
                              )
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Severity</label>
                          <select
                            value={sickDay.severity}
                            data-testid={`settings-sick-day-severity-${sickDay.id}`}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                            onChange={(event) =>
                              setSickDayDrafts((current) =>
                                current.map((candidate) =>
                                  candidate.id === sickDay.id
                                    ? {
                                        ...candidate,
                                        severity: event.target.value as SickDay["severity"],
                                      }
                                    : candidate,
                                ),
                              )
                            }
                          >
                            {Object.entries(sickDaySeverityDescriptions).map(([value, copy]) => (
                              <option key={value} value={value}>
                                {copy.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </div>
                      <div className="mt-4 space-y-2">
                        <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Notes (optional)</label>
                        <Input
                          value={sickDay.notes ?? ""}
                          data-testid={`settings-sick-day-notes-${sickDay.id}`}
                          placeholder="Cold, headache, fever, exhausted after travel..."
                          onChange={(event) =>
                            setSickDayDrafts((current) =>
                              current.map((candidate) =>
                                candidate.id === sickDay.id
                                  ? { ...candidate, notes: event.target.value }
                                  : candidate,
                              ),
                            )
                          }
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                        <p className="text-sm text-muted-foreground">{severityCopy.description}</p>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            data-testid={`settings-sick-day-delete-${sickDay.id}`}
                            onClick={async () => {
                              if (saved) {
                                await deleteSickDay(sickDay.id);
                              } else {
                                setSickDayDrafts((current) =>
                                  current.filter((candidate) => candidate.id !== sickDay.id),
                                );
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                            Delete
                          </Button>
                          <Button
                            type="button"
                            data-testid={`settings-sick-day-save-${sickDay.id}`}
                            onClick={() =>
                              void saveSickDay({
                                ...sickDay,
                                notes: sickDay.notes?.trim() ? sickDay.notes.trim() : undefined,
                              })
                            }
                          >
                            {saved ? "Update sick day" : "Save sick day"}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-sm border border-dashed border-white/10 bg-white/3 px-4 py-5 text-sm text-muted-foreground">
                  No sick days added yet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Buffer rules</CardTitle>
              <p className="text-sm text-muted-foreground">Weekly slack and recovery protection keep the plan resilient when blocks move.</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-sm border border-white/6 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-foreground">Reserve Sunday evening as free time</p>
                    <p className="text-sm text-muted-foreground">Keep Sunday 20:00-22:00 clear so Monday starts realistic.</p>
                  </div>
                  <Switch
                    checked={form.reserveSundayEvening}
                    onCheckedChange={(checked) =>
                      setForm({
                        ...form,
                        reserveSundayEvening: checked,
                      })
                    }
                  />
                </div>
              </div>
              <div className="rounded-sm border border-white/6 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-foreground">Avoid late-night heavy blocks</p>
                    <p className="text-sm text-muted-foreground">Stops deep-work sessions from leaking into low-energy hours.</p>
                  </div>
                  <Switch
                    checked={form.avoidLateNightHeavy}
                    onCheckedChange={(checked) =>
                      setForm({
                        ...form,
                        avoidLateNightHeavy: checked,
                      })
                    }
                  />
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Weekly buffer ratio</label>
                <Input
                  type="number"
                  min={0}
                  max={0.5}
                  step={0.01}
                  value={form.weeklyBufferRatio}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      weeklyBufferRatio: Number(event.target.value),
                    })
                  }
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Buffer before fixed events (min)</label>
                <Input
                  type="number"
                  min={0}
                  step={5}
                  value={form.bufferMinutesBeforeFixedEvent}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      bufferMinutesBeforeFixedEvent: Number(event.target.value),
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-end justify-between">
              <div>
                <CardTitle>Subject weights & priority</CardTitle>
                <p className="text-sm text-muted-foreground">These weights are part of the task scoring formula.</p>
              </div>
              <Badge variant="muted">Deterministic inputs</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {subjects.map((subject) => (
                <div key={subject.id} className="grid items-center gap-4 rounded-sm border border-white/6 bg-white/4 p-4 md:grid-cols-[minmax(0,1fr)_120px]">
                  <div>
                    <SubjectBadge subjectId={subject.id} label={subject.name} />
                    <p className="mt-2 text-sm text-muted-foreground">{subject.description}</p>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={2}
                    step={0.05}
                    value={form.subjectWeightOverrides[subject.id] ?? subject.defaultPriority}
                    onChange={(event) =>
                      setForm({
                        ...form,
                        subjectWeightOverrides: {
                          ...form.subjectWeightOverrides,
                          [subject.id]: Number(event.target.value),
                        },
                      })
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
