"use client";

import { AlertTriangle, ArrowUpRight, CalendarClock, CheckCircle2, Clock3, Flame } from "lucide-react";
import { format } from "date-fns";
import dynamic from "next/dynamic";

import { MetricCard } from "@/components/layout/metric-card";
import { PageHeader } from "@/components/layout/page-header";
import { HorizonRoadmap } from "@/components/planner/horizon-roadmap";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  getCalendarCompletionForecast,
  countTrackStatus,
  getDashboardMetrics,
  getHorizonRoadmapSummary,
  getSubjectProgress,
  getTodayBlocks,
  getUrgentTopics,
  getWeekBlocks,
  getWeeklyCoverageState,
  getWeeklyPlan,
} from "@/lib/analytics/metrics";
import { mainSubjectIds } from "@/lib/constants/planner";
import { usePlannerStore } from "@/lib/store/planner-store";

export function DashboardPage() {
  const currentWeekStart = usePlannerStore((state) => state.currentWeekStart);
  const goals = usePlannerStore((state) => state.goals);
  const subjects = usePlannerStore((state) => state.subjects);
  const topics = usePlannerStore((state) => state.topics);
  const studyBlocks = usePlannerStore((state) => state.studyBlocks);
  const weeklyPlans = usePlannerStore((state) => state.weeklyPlans);
  const fixedEvents = usePlannerStore((state) => state.fixedEvents);
  const selectStudyBlock = usePlannerStore((state) => state.selectStudyBlock);
  const preferences = usePlannerStore((state) => state.preferences);

  const weeklyPlan = getWeeklyPlan(weeklyPlans, currentWeekStart);
  const weekBlocks = getWeekBlocks(studyBlocks, currentWeekStart);
  const todayBlocks = getTodayBlocks(weekBlocks);
  const metrics = getDashboardMetrics(weekBlocks, weeklyPlan);
  const trackStatus = countTrackStatus(weeklyPlan);
  const weeklyCoverageState = getWeeklyCoverageState(weeklyPlan);
  const urgentTopics = getUrgentTopics(topics, subjects).slice(0, 3);
  const roadmapSummary = getHorizonRoadmapSummary(weeklyPlans, topics, currentWeekStart);
  const subjectProgress = subjects
    .filter((subject) => mainSubjectIds.includes(subject.id as (typeof mainSubjectIds)[number]))
    .map((subject) => getSubjectProgress(subject, topics));
  const completionForecasts = subjects
    .filter((subject) => mainSubjectIds.includes(subject.id as (typeof mainSubjectIds)[number]))
    .map((subject) =>
      getCalendarCompletionForecast({
        subject,
        topics,
        goals,
        studyBlocks,
        referenceDate: new Date(),
      }),
    );

  const chartData = subjectProgress.map((progress) => ({
    name: progress.subject.shortName.replace(" HL", ""),
    required: weeklyPlan?.requiredHoursBySubject[progress.subject.id] ?? 0,
    assigned: weeklyPlan?.assignedHoursBySubject[progress.subject.id] ?? 0,
    completed: weeklyPlan?.completedHoursBySubject[progress.subject.id] ?? 0,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Today is ${format(new Date(), "EEEE, d MMMM yyyy")}. The planner is balancing deadline pace, syllabus order, and recovery protection from now through July 31, 2026.`}
      />

      <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
        <MetricCard
          eyebrow="Hours planned today"
          value={`${metrics.plannedTodayHours.toFixed(1)}`}
          detail={`${metrics.completedTodayHours.toFixed(1)} hrs completed`}
          accent={<Clock3 className="h-5 w-5 text-primary" />}
        />
        <MetricCard
          eyebrow="Weekly progress"
          value={`${metrics.weeklyProgressPercent}%`}
          detail={`${metrics.weeklyCompletedHours.toFixed(1)} of ${metrics.weeklyPlannedHours.toFixed(1)} hrs completed`}
          tone={metrics.weeklyProgressPercent >= 70 ? "success" : "default"}
          accent={<ArrowUpRight className="h-5 w-5 text-success" />}
        />
        <MetricCard
          eyebrow="On-track subjects"
          value={`${trackStatus.onTrack}/${subjectProgress.length}`}
          detail={`${trackStatus.atRisk} at risk • ${trackStatus.behind} behind`}
          tone={trackStatus.behind > 0 ? "warning" : "success"}
          accent={<CheckCircle2 className="h-5 w-5 text-success" />}
        />
        <MetricCard
          eyebrow="Coverage state"
          value={weeklyCoverageState.label}
          detail={weeklyPlan?.feasibilityWarnings[0] ?? "Buffer capacity is still protecting the week."}
          tone={weeklyCoverageState.tone}
          accent={<Flame className="h-5 w-5 text-warning" />}
        />
      </div>

      {!fixedEvents.length && !preferences?.schoolSchedule.enabled && !preferences?.holidaySchedule.enabled ? (
        <Card className="border-primary/20 bg-primary/8">
          <CardContent className="flex items-start gap-3 pt-5">
            <div className="rounded-sm border border-primary/25 bg-primary/10 p-2 text-primary">
              <CalendarClock className="h-4 w-4" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">Your timetable has not been configured yet.</p>
              <p className="text-sm text-muted-foreground">
                No school day or recurring commitments are preloaded. Add your fixed events in the
                calendar and the planner will generate realistic study blocks from your actual free
                time.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <HorizonRoadmap
        summary={roadmapSummary}
        subjects={subjects}
        compact
        description="This is the forward allocation from the selected week to July 31. If assigned pace slips below required pace, the roadmap flags it immediately."
      />

      <Card>
        <CardHeader className="flex-row items-end justify-between">
          <div>
            <CardTitle>Calendar finish dates</CardTitle>
            <p className="text-sm text-muted-foreground">
              These dates come from the actual study blocks already on your calendar, not from a one-week extrapolation.
            </p>
          </div>
          <Badge variant="muted">{completionForecasts.length} tracked subjects</Badge>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 xl:grid-cols-5 md:grid-cols-2">
            {completionForecasts.map((forecast) => (
              <div key={forecast.subject.id} className="rounded-sm border border-white/6 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <SubjectBadge subjectId={forecast.subject.id} label={forecast.subject.shortName} />
                  <Badge
                    variant={
                      forecast.isCalendarImpossible
                        ? "danger"
                        : forecast.isOnTrack
                          ? "success"
                          : "warning"
                    }
                  >
                    {forecast.isCalendarImpossible
                      ? "Impossible"
                      : forecast.isOnTrack
                        ? "On calendar"
                        : "Past deadline"}
                  </Badge>
                </div>
                <p className="mt-4 text-sm text-muted-foreground">Projected finish</p>
                <p className="mt-2 text-2xl font-semibold text-foreground">
                  {forecast.completionDate
                    ? format(forecast.completionDate, "d MMM yyyy")
                    : "Calendar impossible"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Goal by {forecast.deadline}
                </p>
                <p className="mt-4 text-sm text-muted-foreground">
                  {forecast.isFullyScheduled
                    ? `${forecast.remainingTargetHours.toFixed(1)}h remaining is already covered on the horizon.`
                    : forecast.lastScheduledDate
                      ? `${forecast.missingHours.toFixed(1)}h still missing after ${format(forecast.lastScheduledDate, "d MMM")}.`
                      : `${forecast.missingHours.toFixed(1)}h still missing because the horizon has no future coverage.`}
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.45fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-end justify-between">
            <div>
              <CardTitle>Today&apos;s Study Plan</CardTitle>
              <p className="text-sm text-muted-foreground">{todayBlocks.length} planned blocks in today&apos;s calendar.</p>
            </div>
            <Badge variant="muted">{todayBlocks.length} blocks</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {todayBlocks.length ? (
              todayBlocks.map((block) => (
                <button
                  key={block.id}
                  type="button"
                  onClick={() => selectStudyBlock(block.id)}
                  className="flex w-full items-center gap-4 rounded-sm border border-white/6 bg-white/4 px-4 py-3 text-left transition hover:border-primary/30 hover:bg-white/6"
                >
                  <div className="w-16 text-sm text-muted-foreground">
                    <div>{format(new Date(block.start), "HH:mm")}</div>
                    <div>{format(new Date(block.end), "HH:mm")}</div>
                  </div>
                  <div className="h-10 w-1 rounded-full" style={{ backgroundColor: subjectProgress.find((item) => item.subject.id === block.subjectId)?.subject ? undefined : "rgba(148,163,184,0.4)" }} />
                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {block.subjectId ? (
                        <SubjectBadge
                          subjectId={block.subjectId}
                          label={subjects.find((subject) => subject.id === block.subjectId)?.shortName ?? "Study"}
                        />
                      ) : (
                        <Badge variant="muted">Recovery</Badge>
                      )}
                      <p className="text-base font-medium text-foreground">{block.title}</p>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {block.estimatedMinutes} min • {block.unitTitle ?? "Recovery buffer"}
                    </p>
                  </div>
                  <Badge
                    variant={
                      block.status === "done"
                        ? "success"
                        : block.status === "partial"
                          ? "warning"
                          : block.status === "missed"
                            ? "danger"
                            : "muted"
                    }
                  >
                    {block.status}
                  </Badge>
                </button>
              ))
            ) : (
              <div className="rounded-sm border border-dashed border-white/10 px-4 py-6 text-sm text-muted-foreground">
                No blocks scheduled for today in the selected week.
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-end justify-between">
            <div>
              <CardTitle>Urgent items</CardTitle>
              <p className="text-sm text-muted-foreground">Topics that are most likely to hurt feasibility if ignored.</p>
            </div>
            <Badge variant="warning">{urgentTopics.length} items</Badge>
          </CardHeader>
          <CardContent className="space-y-3">
            {urgentTopics.map(({ topic, subject }) => (
              <div
                key={topic.id}
                className="rounded-sm border border-white/6 bg-white/4 px-4 py-3"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <SubjectBadge subjectId={subject?.id} label={subject?.shortName ?? "Subject"} />
                </div>
                <p className="mt-3 text-base font-medium text-foreground">{topic.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {topic.reviewDue ? `Review due ${topic.reviewDue}` : "Needs a fresh allocation"} •{" "}
                  {Math.max(topic.estHours - topic.completedHours, 0).toFixed(1)}h remaining
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <CardHeader className="flex-row items-end justify-between">
            <div>
              <CardTitle>This week&apos;s required hours by subject</CardTitle>
              <p className="text-sm text-muted-foreground">Required versus already assigned hours for the active week.</p>
            </div>
          </CardHeader>
          <CardContent className="h-[320px] pt-2">
            <HoursBarChart
              data={chartData}
              bars={[
                { dataKey: "required", fill: "rgba(148, 163, 184, 0.35)" },
                { dataKey: "assigned", fill: "rgba(59, 130, 246, 0.95)" },
                { dataKey: "completed", fill: "rgba(16, 185, 129, 0.95)" },
              ]}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Subject progress</CardTitle>
            <p className="text-sm text-muted-foreground">Completion, remaining hours, and topic risk across the tracked goal subjects.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {subjectProgress.map((progress) => (
              <div key={progress.subject.id} className="rounded-sm border border-white/6 bg-white/4 p-4">
                <div className="flex items-center justify-between gap-3">
                  <SubjectBadge subjectId={progress.subject.id} label={progress.subject.shortName} />
                  <Badge variant={progress.atRiskTopics.length > 2 ? "warning" : "success"}>
                    {progress.atRiskTopics.length > 2 ? "At risk" : "On track"}
                  </Badge>
                </div>
                <p className="mt-3 text-2xl font-semibold text-foreground">{progress.completionPercent}%</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {progress.remainingHours.toFixed(1)}h remaining • {progress.completedUnits}/{progress.unitCount} units closed
                </p>
                <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
                  <span>{progress.atRiskTopics.length} topic risks</span>
                  <span>{weeklyPlan?.assignedHoursBySubject[progress.subject.id]?.toFixed(1) ?? "0.0"}h assigned</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
