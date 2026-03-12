"use client";

import { addDays, subDays } from "date-fns";
import { ChevronLeft, ChevronRight, RefreshCw, ShieldAlert } from "lucide-react";
import dynamic from "next/dynamic";

import { MetricCard } from "@/components/layout/metric-card";
import { PageHeader } from "@/components/layout/page-header";
const HoursBarChart = dynamic(
  () =>
    import("@/components/planner/hours-bar-chart").then((module) => module.HoursBarChart),
  {
    ssr: false,
    loading: () => <div className="h-full rounded-sm border border-white/6 bg-white/4" />,
  },
);
import { SubjectBadge } from "@/components/planner/subject-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCarryOverBlocks, getWeekBlocks, getWeeklyPlan } from "@/lib/analytics/metrics";
import { mainSubjectIds } from "@/lib/constants/planner";
import { formatWeekRangeLabel, fromDateKey, startOfPlannerWeek, toDateKey } from "@/lib/dates/helpers";
import { projectSubjectCompletion } from "@/lib/scheduler/feasibility";
import { usePlannerStore } from "@/lib/store/planner-store";

export function WeeklyReviewPage() {
  const currentWeekStart = usePlannerStore((state) => state.currentWeekStart);
  const subjects = usePlannerStore((state) => state.subjects);
  const topics = usePlannerStore((state) => state.topics);
  const studyBlocks = usePlannerStore((state) => state.studyBlocks);
  const weeklyPlans = usePlannerStore((state) => state.weeklyPlans);
  const regenerateHorizon = usePlannerStore((state) => state.regenerateHorizon);
  const setCurrentWeekStart = usePlannerStore((state) => state.setCurrentWeekStart);

  const visibleWeekStart = startOfPlannerWeek(fromDateKey(currentWeekStart));
  const weeklyPlan = getWeeklyPlan(weeklyPlans, currentWeekStart);
  const weekBlocks = getWeekBlocks(studyBlocks, currentWeekStart);
  const carryOverBlocks = getCarryOverBlocks(weekBlocks);
  const chartData = subjects
    .filter((subject) => mainSubjectIds.includes(subject.id as (typeof mainSubjectIds)[number]))
    .map((subject) => ({
      subjectId: subject.id,
      name: subject.shortName.replace(" HL", ""),
      planned: weeklyPlan?.assignedHoursBySubject[subject.id] ?? 0,
      completed: weeklyPlan?.completedHoursBySubject[subject.id] ?? 0,
      target: weeklyPlan?.requiredHoursBySubject[subject.id] ?? 0,
    }));

  const plannedHours = chartData.reduce((total, item) => total + item.planned, 0);
  const completedHours = chartData.reduce((total, item) => total + item.completed, 0);
  const carryOverHours = carryOverBlocks.reduce((total, block) => total + block.estimatedMinutes / 60, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Weekly Review"
        description="Compare plan versus execution, surface carry-over, and see whether the July 31 target remains realistic."
        actions={
          <>
            <div className="flex items-center gap-1 rounded-full border border-white/8 bg-white/4 p-1">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => setCurrentWeekStart(toDateKey(subDays(visibleWeekStart, 7)))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="px-3 text-sm text-muted-foreground">{formatWeekRangeLabel(visibleWeekStart)}</span>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => setCurrentWeekStart(toDateKey(addDays(visibleWeekStart, 7)))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <Button onClick={() => void regenerateHorizon()}>
              <RefreshCw className="h-4 w-4" />
              Auto-adjust
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        <MetricCard eyebrow="Planned hours" value={plannedHours.toFixed(1)} detail="hours scheduled this week" />
        <MetricCard eyebrow="Completed hours" value={completedHours.toFixed(1)} detail="hours marked done or partial" tone={completedHours / Math.max(plannedHours, 1) >= 0.8 ? "success" : "warning"} />
        <MetricCard eyebrow="Carry-over hours" value={carryOverHours.toFixed(1)} detail="hours to reschedule" tone={carryOverHours > 4 ? "warning" : "default"} />
        <MetricCard eyebrow="Feasibility risk" value={weeklyPlan ? weeklyPlan.riskFlag[0].toUpperCase() + weeklyPlan.riskFlag.slice(1) : "Low"} detail={weeklyPlan?.feasibilityWarnings[0] ?? "No major risk flags this week."} tone={weeklyPlan?.riskFlag === "high" ? "danger" : weeklyPlan?.riskFlag === "medium" ? "warning" : "success"} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <Card>
          <CardHeader>
            <CardTitle>Planned vs completed</CardTitle>
            <p className="text-sm text-muted-foreground">Hours by subject, compared against the current weekly target.</p>
          </CardHeader>
          <CardContent className="h-[320px] pt-2">
            <HoursBarChart
              data={chartData}
              bars={[
                { dataKey: "planned", fill: "rgba(59, 130, 246, 0.95)" },
                { dataKey: "completed", fill: "rgba(16, 185, 129, 0.95)" },
                { dataKey: "target", fill: "rgba(245, 158, 11, 0.7)" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Carry-over & adjustments</CardTitle>
            <p className="text-sm text-muted-foreground">Blocks that missed, slipped, or were explicitly rescheduled.</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {carryOverBlocks.length ? (
              carryOverBlocks.map((block) => (
                <div key={block.id} className="rounded-sm border border-white/6 bg-white/4 px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <SubjectBadge
                      subjectId={block.subjectId}
                      label={subjects.find((subject) => subject.id === block.subjectId)?.shortName ?? "Recovery"}
                    />
                    <Badge variant={block.status === "missed" ? "danger" : "warning"}>{block.status}</Badge>
                  </div>
                  <p className="mt-3 text-base font-medium text-foreground">{block.title}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {block.estimatedMinutes} min • {block.generatedReason}
                  </p>
                </div>
              ))
            ) : (
              <div className="rounded-sm border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
                No carry-over blocks in the active week.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex-row items-end justify-between">
          <div>
            <CardTitle>Feasibility analysis</CardTitle>
            <p className="text-sm text-muted-foreground">Projected completion dates based on the current weekly allocation.</p>
          </div>
          <Badge variant={weeklyPlan?.riskFlag === "high" ? "danger" : weeklyPlan?.riskFlag === "medium" ? "warning" : "success"}>
            {weeklyPlan?.riskFlag === "high" ? "High risk" : weeklyPlan?.riskFlag === "medium" ? "Medium risk" : "On track"}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {weeklyPlan?.feasibilityWarnings.length ? (
            <div className="rounded-sm border border-warning/30 bg-warning/12 px-4 py-3 text-warning">
              <div className="flex items-center gap-2 font-medium">
                <ShieldAlert className="h-4 w-4" />
                Feasibility warnings
              </div>
              <ul className="mt-2 space-y-1 text-sm text-warning/90">
                {weeklyPlan.feasibilityWarnings.map((warning) => (
                  <li key={warning}>• {warning}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
            {subjects
              .filter((subject) => mainSubjectIds.includes(subject.id as (typeof mainSubjectIds)[number]))
              .map((subject) => {
                const projection = projectSubjectCompletion({
                  subject,
                  weeklyPlan,
                  topics,
                  referenceDate: visibleWeekStart,
                });
                return (
                  <div key={subject.id} className="rounded-sm border border-white/6 bg-white/4 p-4">
                    <SubjectBadge subjectId={subject.id} label={subject.shortName} />
                    <p className="mt-4 text-sm text-muted-foreground">Projected completion</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {projection.projectedDate.toLocaleDateString()}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {projection.remainingHours.toFixed(1)}h left • ~{projection.weeksNeeded.toFixed(1)} weeks needed
                    </p>
                  </div>
                );
              })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
