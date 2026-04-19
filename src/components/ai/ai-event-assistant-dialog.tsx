"use client";

import { useState } from "react";
import { Sparkles, X } from "lucide-react";

import { applyAiPlannerActions } from "@/lib/ai/actions";
import { fetchAiParseEvent } from "@/lib/ai/client";
import type { AiParseEventResponse } from "@/lib/ai/contracts";
import { useAiStore } from "@/lib/store/ai-store";
import type { FixedEvent, FocusedDay, FocusedWeek } from "@/lib/types/planner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export function AiEventAssistantDialog({
  open,
  context,
  onClose,
  saveFixedEvent,
  saveFocusedDay,
  saveFocusedWeek,
}: {
  open: boolean;
  context: Record<string, unknown>;
  onClose: () => void;
  saveFixedEvent: (event: FixedEvent) => Promise<void>;
  saveFocusedDay: (focusedDay: FocusedDay) => Promise<void>;
  saveFocusedWeek: (focusedWeek: FocusedWeek) => Promise<void>;
}) {
  const token = useAiStore((state) => state.token);
  const signOut = useAiStore((state) => state.signOut);
  const [text, setText] = useState("");
  const [response, setResponse] = useState<AiParseEventResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto overscroll-contain">
        <Card>
          <CardHeader className="flex-row items-start justify-between">
            <div>
              <CardTitle>Add with AI</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Describe an event or focus request in plain language. AI proposes structured actions, and nothing is applied until you confirm.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="h-10 w-10 rounded-full p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {!token ? (
              <div className="rounded-sm border border-white/8 bg-white/4 p-4 text-sm text-muted-foreground">
                AI access is private. Sign in from Settings first.
              </div>
            ) : null}
            <Textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Family dinner next Friday 18:00-20:00 and focus Physics this week."
            />
            <div className="flex justify-end">
              <Button
                disabled={!token || !text.trim() || loading}
                onClick={async () => {
                  if (!token) {
                    return;
                  }
                  setLoading(true);
                  setError(null);
                  try {
                    setResponse(
                      await fetchAiParseEvent(token, {
                        text,
                        context,
                      }),
                    );
                  } catch (parseError) {
                    if (
                      parseError instanceof Error &&
                      "status" in parseError &&
                      Number(parseError.status) === 401
                    ) {
                      signOut();
                    }
                    setError(
                      parseError instanceof Error
                        ? parseError.message
                        : "Failed to parse AI event request.",
                    );
                  } finally {
                    setLoading(false);
                  }
                }}
              >
                <Sparkles className="h-4 w-4" />
                {loading ? "Parsing" : "Parse request"}
              </Button>
            </div>
            {error ? <p className="text-sm text-danger">{error}</p> : null}
            {response ? (
              <div className="space-y-4 rounded-sm border border-white/8 bg-white/4 p-4">
                <p className="text-sm text-foreground">{response.summary}</p>
                {response.clarifyingQuestion ? (
                  <p className="text-sm text-warning">{response.clarifyingQuestion}</p>
                ) : null}
                <div className="space-y-2">
                  {response.actions.map((action, index) => (
                    <div key={`${action.kind}-${index}`} className="rounded-sm border border-white/8 bg-background/40 p-3 text-sm text-foreground">
                      {action.kind === "fixed_event" ? (
                        <p>
                          Fixed event: {action.event.title} from {new Date(action.event.start).toLocaleString()} to{" "}
                          {new Date(action.event.end).toLocaleString()}
                        </p>
                      ) : action.kind === "focused_day" ? (
                        <p>
                          Focus day: {action.focusedDay.date} on {action.focusedDay.subjectIds.join(", ")}
                        </p>
                      ) : (
                        <p>
                          Focus week: {action.focusedWeek.weekStart} on {action.focusedWeek.subjectIds.join(", ")}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex justify-end gap-3">
                  <Button variant="outline" onClick={onClose}>
                    Cancel
                  </Button>
                  <Button
                    disabled={!response.canApply || applying}
                    onClick={async () => {
                      setApplying(true);
                      setError(null);
                      try {
                        await applyAiPlannerActions({
                          actions: response.actions,
                          saveFixedEvent,
                          saveFocusedDay,
                          saveFocusedWeek,
                        });
                        onClose();
                      } catch (applyError) {
                        setError(
                          applyError instanceof Error
                            ? applyError.message
                            : "Failed to apply AI planner actions.",
                        );
                      } finally {
                        setApplying(false);
                      }
                    }}
                  >
                    {applying ? "Applying" : "Apply actions"}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
