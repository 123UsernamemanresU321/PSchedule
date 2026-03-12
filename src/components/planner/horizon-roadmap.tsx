"use client";

import { AlertTriangle, ArrowRight, CalendarRange, Gauge, Target } from "lucide-react";

import { SubjectBadge } from "@/components/planner/subject-badge";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { HorizonRoadmapSummary, Subject } from "@/lib/types/planner";

export function HorizonRoadmap({
  summary,
  subjects,
  title = "Roadmap to July 31",
  description = "Required pace versus assigned work across the remaining horizon.",
  compact = false,
}: {
  summary: HorizonRoadmapSummary;
  subjects: Subject[];
  title?: string;
  description?: string;
  compact?: boolean;
}) {
  const visibleWeeks = compact ? summary.weeks.slice(0, 4) : summary.weeks.slice(0, 8);
  const paceDelta = Number((summary.totalAssignedHours - summary.totalRequiredHours).toFixed(1));

  return (
    <Card className="overflow-hidden border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.015))]">
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/8 px-3 py-1 text-xs font-medium text-primary">
            <CalendarRange className="h-3.5 w-3.5" />
            Horizon through {summary.weeks[0]?.horizonEndDate ?? summary.endWeek}
          </div>
          <div>
            <CardTitle className="text-xl">{title}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <Badge variant={paceDelta >= 0 ? "success" : "warning"}>
          {paceDelta >= 0 ? "On pace" : `${Math.abs(paceDelta).toFixed(1)}h behind pace`}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-3 md:grid-cols-4">
          <div className="rounded-md border border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <Target className="h-3.5 w-3.5" />
              Weeks left
            </div>
            <p className="mt-3 text-3xl font-semibold text-foreground">{summary.weeksRemaining}</p>
          </div>
          <div className="rounded-md border border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              Required pace
            </div>
            <p className="mt-3 text-3xl font-semibold text-foreground">{summary.totalRequiredHours.toFixed(1)}h</p>
          </div>
          <div className="rounded-md border border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <ArrowRight className="h-3.5 w-3.5" />
              Assigned
            </div>
            <p className="mt-3 text-3xl font-semibold text-foreground">{summary.totalAssignedHours.toFixed(1)}h</p>
          </div>
          <div className="rounded-md border border-white/8 bg-white/[0.04] p-4">
            <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
              <AlertTriangle className="h-3.5 w-3.5" />
              Risk weeks
            </div>
            <p className="mt-3 text-3xl font-semibold text-foreground">{summary.riskWeeks}</p>
          </div>
        </div>

        <div className="space-y-3">
          {visibleWeeks.map((week) => {
            const ratio = week.requiredHours > 0 ? Math.min(week.assignedHours / week.requiredHours, 1.25) : 1;
            const weekState =
              !week.coverageComplete && week.slackMinutes === 0
                ? { label: "Calendar-impossible", variant: "danger" as const }
                : week.coverageComplete && week.overloadMinutes > 0
                  ? { label: "Overloaded", variant: "warning" as const }
                  : !week.coverageComplete || week.forcedCoverageMinutes > 0
                    ? { label: "Catch-up", variant: "warning" as const }
                    : { label: "On target", variant: "success" as const };

            return (
              <div
                key={week.weekStart}
                className="rounded-md border border-white/8 bg-white/[0.03] px-4 py-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium text-foreground">{week.weekLabel}</p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {week.requiredHours.toFixed(1)}h required • {week.assignedHours.toFixed(1)}h assigned • {week.remainingCoreHours.toFixed(1)}h core work still open
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={weekState.variant}>
                      {weekState.label}
                    </Badge>
                    <span className="text-sm font-medium text-foreground">
                      {(ratio * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-[linear-gradient(90deg,rgba(59,130,246,0.95),rgba(45,212,191,0.95))]"
                    style={{ width: `${Math.min(ratio * 100, 100)}%` }}
                  />
                </div>
                {week.usedSundayMinutes > 0 || week.forcedCoverageMinutes > 0 ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    {week.usedSundayMinutes > 0 ? `${Math.round(week.usedSundayMinutes)} min on Sunday` : "No Sunday load"} •{" "}
                    {week.forcedCoverageMinutes > 0 ? `${Math.round(week.forcedCoverageMinutes)} forced catch-up min` : "No forced catch-up"}
                  </p>
                ) : null}
                {week.underplannedSubjectIds.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {week.underplannedSubjectIds.map((subjectId) => (
                      <SubjectBadge
                        key={`${week.weekStart}-${subjectId}`}
                        subjectId={subjectId}
                        label={subjects.find((subject) => subject.id === subjectId)?.shortName ?? subjectId}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
