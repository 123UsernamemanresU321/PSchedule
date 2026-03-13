"use client";

import { useState } from "react";
import { Clock3, Layers3, RefreshCw, X } from "lucide-react";
import { format } from "date-fns";

import { SubjectBadge } from "@/components/planner/subject-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { blockTypeLabels, studyBlockStatusLabels } from "@/lib/constants/planner";
import { usePlannerStore } from "@/lib/store/planner-store";
import type { StudyBlock, Subject, Topic } from "@/lib/types/planner";

export function StudyBlockDrawer() {
  const selectedStudyBlockId = usePlannerStore((state) => state.selectedStudyBlockId);
  const studyBlocks = usePlannerStore((state) => state.studyBlocks);
  const subjects = usePlannerStore((state) => state.subjects);
  const topics = usePlannerStore((state) => state.topics);
  const selectStudyBlock = usePlannerStore((state) => state.selectStudyBlock);
  const updateStudyBlockStatus = usePlannerStore((state) => state.updateStudyBlockStatus);

  const block = studyBlocks.find((candidate) => candidate.id === selectedStudyBlockId);
  const subject = block?.subjectId
    ? subjects.find((candidate) => candidate.id === block.subjectId) ?? null
    : null;
  const topic = block?.topicId ? topics.find((candidate) => candidate.id === block.topicId) : null;

  if (!block) {
    return null;
  }

  return (
    <StudyBlockDrawerPanel
      key={block.id}
      block={block}
      subject={subject}
      topic={topic}
      onClose={() => selectStudyBlock(null)}
      onStatusUpdate={updateStudyBlockStatus}
    />
  );
}

function StudyBlockDrawerPanel({
  block,
  subject,
  topic,
  onClose,
  onStatusUpdate,
}: {
  block: StudyBlock;
  subject: Subject | null;
  topic: Topic | null | undefined;
  onClose: () => void;
  onStatusUpdate: ReturnType<typeof usePlannerStore.getState>["updateStudyBlockStatus"];
}) {
  const [notes, setNotes] = useState(block.notes);
  const [actualMinutes, setActualMinutes] = useState(
    String(block.actualMinutes ?? block.estimatedMinutes),
  );

  const handleStatusUpdate = async (
    status: "done" | "partial" | "missed" | "rescheduled",
  ) => {
    await onStatusUpdate({
      blockId: block.id,
      status,
      actualMinutes:
        status === "missed"
          ? 0
          : Math.max(0, Number(actualMinutes || block.estimatedMinutes)),
      notes,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end overflow-hidden bg-black/55 backdrop-blur-sm">
      <button
        type="button"
        className="h-full flex-1 cursor-default"
        onClick={onClose}
        aria-label="Close study block drawer"
      />
      <aside className="relative flex h-full min-h-0 w-full max-w-xl flex-col border-l border-white/8 bg-[#121725] shadow-panel">
        <div className="flex items-center justify-between border-b border-white/8 px-6 py-5">
          <div className="space-y-2">
            {subject ? (
              <SubjectBadge subjectId={subject.id} label={subject.shortName} />
            ) : (
              <Badge variant="muted">Recovery</Badge>
            )}
            <div>
              <h2 className="font-display text-2xl font-semibold">{block.title}</h2>
              {topic ? (
                <p className="text-sm text-muted-foreground">{topic.unitTitle}</p>
              ) : null}
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-10 w-10 rounded-full p-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-y-contain px-6 py-6">
          <Card>
            <CardContent className="grid grid-cols-1 gap-4 pt-5 sm:grid-cols-2">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Scheduled time</p>
                <p className="text-sm font-medium text-foreground">
                  {format(new Date(block.start), "EEE, d MMM • HH:mm")} - {format(new Date(block.end), "HH:mm")}
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Estimated duration</p>
                <p className="text-sm font-medium text-foreground">{block.estimatedMinutes} min</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Block type</p>
                <p className="text-sm font-medium text-foreground">{blockTypeLabels[block.blockType]}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Status</p>
                <p className="text-sm font-medium text-foreground">{studyBlockStatusLabels[block.status]}</p>
              </div>
            </CardContent>
          </Card>

          {block.sessionSummary ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Session focus</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm leading-6 text-foreground">{block.sessionSummary}</p>
              </CardContent>
            </Card>
          ) : null}

          <Card className="border-primary/20 bg-primary/8">
            <CardHeader>
              <CardTitle className="text-base">Why this was scheduled</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-6 text-foreground">{block.generatedReason}</p>
              <div className="grid grid-cols-2 gap-3 text-sm text-muted-foreground">
                <div className="rounded-sm border border-white/8 bg-white/4 p-3">
                  <div className="flex items-center gap-2 text-foreground">
                    <Clock3 className="h-4 w-4" />
                    Score
                  </div>
                  <p className="mt-2 text-lg font-semibold text-foreground">{block.scoreBreakdown.total}</p>
                </div>
                <div className="rounded-sm border border-white/8 bg-white/4 p-3">
                  <div className="flex items-center gap-2 text-foreground">
                    <Layers3 className="h-4 w-4" />
                    Slot energy
                  </div>
                  <p className="mt-2 text-lg font-semibold capitalize text-foreground">{block.slotEnergy}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Source materials</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {block.sourceMaterials.length ? (
                block.sourceMaterials.map((material) => (
                  <div
                    key={`${material.type}-${material.label}`}
                    className="rounded-sm border border-white/8 bg-white/4 px-4 py-3"
                  >
                    <p className="text-sm font-medium text-foreground">{material.label}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{material.details}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  This block is reserved as explicit recovery and buffer time.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mark status</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Actual minutes
                  </label>
                  <Input
                    type="number"
                    min={0}
                    value={actualMinutes}
                    onChange={(event) => setActualMinutes(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                    Topic difficulty
                  </label>
                  <div className="flex h-10 items-center rounded-sm border border-white/8 bg-white/4 px-3 text-sm text-foreground">
                    {topic ? `${topic.difficulty}/5` : "Light block"}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Notes
                </label>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add reflections, questions, or reminders…"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Button variant="default" onClick={() => void handleStatusUpdate("done")}>
                  Done
                </Button>
                <Button variant="secondary" onClick={() => void handleStatusUpdate("partial")}>
                  Partial
                </Button>
                <Button variant="outline" onClick={() => void handleStatusUpdate("rescheduled")}>
                  <RefreshCw className="h-4 w-4" />
                  Reschedule
                </Button>
                <Button variant="danger" onClick={() => void handleStatusUpdate("missed")}>
                  Missed
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </aside>
    </div>
  );
}
