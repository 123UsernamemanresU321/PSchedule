"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { PageHeader } from "@/components/layout/page-header";
import { SubjectBadge } from "@/components/planner/subject-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { getSubjectProgress } from "@/lib/analytics/metrics";
import { mainSubjectIds, topicStatusLabels } from "@/lib/constants/planner";
import { usePlannerStore } from "@/lib/store/planner-store";
import { groupBy } from "@/lib/utils";

export function SubjectsPage() {
  const subjects = usePlannerStore((state) => state.subjects);
  const topics = usePlannerStore((state) => state.topics);
  const [activeTab, setActiveTab] = useState<string>("all");

  const visibleSubjects =
    activeTab === "all"
      ? subjects.filter((subject) => mainSubjectIds.includes(subject.id as (typeof mainSubjectIds)[number]))
      : subjects.filter((subject) => subject.id === activeTab);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subjects"
        description="Track syllabus coverage, mastery, and remaining workload by unit and topic. These values feed directly into the deterministic scheduler."
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
          const progress = getSubjectProgress(subject, topics);

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
                <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
                  <div>
                    <p className="uppercase tracking-[0.2em] text-xs">Remaining hours</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">{progress.remainingHours.toFixed(1)}</p>
                  </div>
                  <div className="text-right">
                    <p className="uppercase tracking-[0.2em] text-xs">Units completed</p>
                    <p className="mt-2 text-2xl font-semibold text-foreground">
                      {progress.completedUnits}/{progress.unitCount}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {visibleSubjects.map((subject) => {
        const progress = getSubjectProgress(subject, topics);
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
                              {Math.max(totalHours - completedHours, 0).toFixed(1)}h left • {unitTopics.length} topics
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
                        {unitTopics.map((topic) => (
                          <div
                            key={topic.id}
                            className="grid gap-3 rounded-sm border border-white/6 bg-white/4 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_160px_120px]"
                          >
                            <div>
                              <p className="font-medium text-foreground">{topic.title}</p>
                              <p className="mt-1 text-sm text-muted-foreground">
                                {topic.subtopics.join(" • ")}
                              </p>
                            </div>
                            <div className="text-sm text-muted-foreground">
                              <p>{Math.max(topic.estHours - topic.completedHours, 0).toFixed(1)}h remaining</p>
                              <p className="mt-1">Mastery {topic.mastery}/5</p>
                            </div>
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
                        ))}
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
