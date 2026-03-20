"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SubjectBadge } from "@/components/planner/subject-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { getSubjectProgress } from "@/lib/analytics/metrics";
import { mainSubjectIds, topicStatusLabels } from "@/lib/constants/planner";
import { usePlannerStore } from "@/lib/store/planner-store";
import type { Topic } from "@/lib/types/planner";
import { groupBy } from "@/lib/utils";

export function SubjectsPage() {
  const subjects = usePlannerStore((state) => state.subjects);
  const topics = usePlannerStore((state) => state.topics);
  const studyBlocks = usePlannerStore((state) => state.studyBlocks);
  const [activeTab, setActiveTab] = useState<string>("all");

  const visibleSubjects =
    activeTab === "all"
      ? subjects.filter((subject) => mainSubjectIds.includes(subject.id as (typeof mainSubjectIds)[number]))
      : subjects.filter((subject) => subject.id === activeTab);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="Track what is completed, what is already placed later on the calendar, and what still has no scheduled slot yet. These values feed directly into the deterministic scheduler."
        actions={
          <>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={activeTab === "all" ? "default" : "ghost"}
                onClick={() => setActiveTab("all")}
              >
                All subjects
              </Button>
              {subjects
                .filter((subject) => mainSubjectIds.includes(subject.id as (typeof mainSubjectIds)[number]))
                .map((subject) => (
                  <Button
                    key={subject.id}
                    variant={activeTab === subject.id ? "default" : "ghost"}
                    onClick={() => setActiveTab(subject.id)}
                  >
                    {subject.shortName}
                  </Button>
                ))}
            </div>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {visibleSubjects.map((subject) => {
          const progress = getSubjectProgress(subject, topics, studyBlocks);

          return (
            <Card key={subject.id}>
              <CardHeader className="flex-row items-start justify-between">
                <div>
                  <SubjectBadge subjectId={subject.id} label={subject.name} />
                  <p className="mt-4 text-sm text-muted-foreground">Overall completion</p>
                  <p className="mt-2 text-4xl font-semibold text-foreground">{progress.completionPercent}%</p>
                </div>
                <Badge variant={progress.atRiskTopics.length > 2 ? "warning" : "success"}>
                  {progress.atRiskTopics.length > 2 ? "Developing" : "On track"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4">
                <Progress value={progress.completionPercent} />
                <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground">
                  <div>
                    <p className="uppercase tracking-[0.2em] text-xs">Still unscheduled</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {progress.unscheduledHours.toFixed(1)}
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="uppercase tracking-[0.2em] text-xs">Already planned</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {progress.scheduledFutureHours.toFixed(1)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="uppercase tracking-[0.2em] text-xs">Units completed</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {progress.completedUnits}/{progress.unitCount}
                    </p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Total still to learn: {progress.remainingHours.toFixed(1)}h
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {visibleSubjects.map((subject) => {
        const progress = getSubjectProgress(subject, topics, studyBlocks);
        const unitGroups = Object.entries(groupBy(progress.topics, (topic) => topic.unitTitle));

        return (
          <section key={subject.id} className="space-y-4">
            <div className="flex items-center gap-3">
              <SubjectBadge subjectId={subject.id} label={subject.name} />
              <Badge variant="muted">{progress.unitCount} units</Badge>
            </div>
            <div className="space-y-3">
              {unitGroups.map(([unitTitle, unitTopics]) => {
                const totalHours = unitTopics.reduce((total, topic) => total + topic.estHours, 0);
                const completedHours = unitTopics.reduce(
                  (total, topic) => total + Math.min(topic.completedHours, topic.estHours),
                  0,
                );
                const scheduledFutureHours = unitTopics.reduce((total, topic) => {
                  const remainingHours = Math.max(topic.estHours - topic.completedHours, 0);
                  const plannedFutureHours = progress.plannedFutureHoursByTopic[topic.id] ?? 0;
                  return total + Math.min(remainingHours, plannedFutureHours);
                }, 0);
                const unscheduledHours = unitTopics.reduce((total, topic) => {
                  const remainingHours = Math.max(topic.estHours - topic.completedHours, 0);
                  const plannedFutureHours = progress.plannedFutureHoursByTopic[topic.id] ?? 0;
                  return total + Math.max(remainingHours - plannedFutureHours, 0);
                }, 0);
                const completionPercent = totalHours ? Math.round((completedHours / totalHours) * 100) : 0;

                return (
                  <details
                    key={unitTitle}
                    open={completionPercent < 100}
                    className="group rounded-md border border-white/6 bg-surface/90"
                  >
                    <summary className="flex cursor-pointer list-none items-center gap-4 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="font-display text-lg font-semibold">{unitTitle}</p>
                            <p className="mt-1 text-sm text-muted-foreground">
                              {unscheduledHours.toFixed(1)}h unscheduled • {scheduledFutureHours.toFixed(1)}h already planned • {unitTopics.length} topics
                            </p>
                          </div>
                          <div className="min-w-[240px]">
                            <Progress value={completionPercent} />
                            <div className="mt-2 flex items-center justify-between text-sm text-muted-foreground">
                              <span>{completionPercent}%</span>
                              <Badge variant={completionPercent >= 80 ? "success" : completionPercent >= 50 ? "warning" : "danger"}>
                                {completionPercent >= 80 ? "Strong" : completionPercent >= 50 ? "Developing" : "Needs focus"}
                              </Badge>
                            </div>
                          </div>
                        </div>
                      </div>
                      <ChevronDown className="h-4 w-4 text-muted-foreground transition group-open:rotate-180" />
                    </summary>
                    <div className="border-t border-white/6 px-5 py-4">
                      <div className="space-y-3">
                        {unitTopics.map((topic) => {
                          const remainingHours = Math.max(topic.estHours - topic.completedHours, 0);
                          const plannedFutureHours = Math.min(
                            remainingHours,
                            progress.plannedFutureHoursByTopic[topic.id] ?? 0,
                          );
                          const unscheduledHours = Math.max(
                            remainingHours - plannedFutureHours,
                            0,
                          );

                          return (
                            <div
                              key={topic.id}
                              className="grid gap-3 rounded-sm border border-white/6 bg-white/4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_220px_220px_120px]"
                            >
                              <div>
                                <p className="font-medium text-foreground">{topic.title}</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                  {topic.subtopics.join(" • ")}
                                </p>
                              </div>
                              <div className="text-sm text-muted-foreground">
                                <p>{unscheduledHours.toFixed(1)}h still unscheduled</p>
                                <p className="mt-1">
                                  {plannedFutureHours.toFixed(1)}h already planned later
                                </p>
                                <p className="mt-1">Mastery {topic.mastery}/5</p>
                              </div>
                              <TopicCompletedHoursEditor
                                key={`${topic.id}:${topic.completedHours}`}
                                topic={topic}
                              />
                              <div className="flex items-center justify-end">
                                <Badge
                                  variant={
                                    topic.status === "strong" || topic.status === "reviewed"
                                      ? "success"
                                      : topic.status === "learning" || topic.status === "first_pass_done"
                                        ? "warning"
                                        : "muted"
                                  }
                                >
                                  {topicStatusLabels[topic.status]}
                                </Badge>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TopicCompletedHoursEditor({ topic }: { topic: Topic }) {
  const loading = usePlannerStore((state) => state.loading);
  const updateTopicCompletedHours = usePlannerStore((state) => state.updateTopicCompletedHours);
  const [draftHours, setDraftHours] = useState(formatHoursInput(topic.completedHours));

  const parsedHours = Number(draftHours);
  const normalizedHours = Number.isFinite(parsedHours)
    ? clampHours(parsedHours, topic.estHours)
    : topic.completedHours;
  const hasValidInput = draftHours.trim().length > 0 && Number.isFinite(parsedHours);
  const hasChanges = hasValidInput && Math.abs(normalizedHours - topic.completedHours) > 0.001;

  async function handleSave() {
    if (!hasValidInput) {
      setDraftHours(formatHoursInput(topic.completedHours));
      return;
    }

    await updateTopicCompletedHours({
      topicId: topic.id,
      completedHours: normalizedHours,
    });
  }

  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      <p className="uppercase tracking-[0.2em] text-[11px]">Completed hours</p>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={0}
          max={topic.estHours}
          step="0.1"
          value={draftHours}
          onChange={(event) => setDraftHours(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void handleSave();
            }
          }}
          className="h-9"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={loading || !hasChanges}
          onClick={() => void handleSave()}
        >
          Save
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        0 to {topic.estHours.toFixed(1)}h
      </p>
    </div>
  );
}

function clampHours(value: number, maxHours: number) {
  return Math.min(maxHours, Math.max(0, value));
}

function formatHoursInput(value: number) {
  if (Number.isInteger(value)) {
    return String(value);
  }

  return value.toFixed(2).replace(/\.?0+$/, "");
}
