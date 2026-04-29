"use client";

import { useState } from "react";
import { RefreshCw, Route, Sparkles } from "lucide-react";

import { AiAuthNotice } from "@/components/ai/ai-auth-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAiBlockPlan } from "@/lib/ai/client";
import type { AiBlockPlanResponse } from "@/lib/ai/contracts";
import { useAiStore } from "@/lib/store/ai-store";

export function AiBlockPlanCard({
  context,
}: {
  context: Record<string, unknown>;
}) {
  const token = useAiStore((state) => state.token);
  const signOut = useAiStore((state) => state.signOut);
  const [response, setResponse] = useState<AiBlockPlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return <AiAuthNotice message="AI block plans use the private DeepSeek backend. Sign in from Settings first." />;
  }

  return (
    <Card className="border-primary/20 bg-primary/8">
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Route className="h-4 w-4 text-primary" />
            AI Plan
          </CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Builds a concrete lesson plan from the block length, guide metadata, pace, and surrounding schedule.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            setError(null);
            try {
              setResponse(await fetchAiBlockPlan(token, { context }));
            } catch (planError) {
              if (
                planError instanceof Error &&
                "status" in planError &&
                Number(planError.status) === 401
              ) {
                signOut();
              }
              setError(planError instanceof Error ? planError.message : "Failed to generate AI plan.");
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {response ? "Refresh" : "Generate"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {response ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <PlanPanel label="Lesson goal" value={response.lessonGoal} />
              <PlanPanel label="Minimum target" value={response.minimumProgressTarget} />
              <PlanPanel label="Stretch target" value={response.stretchProgressTarget} />
              <PlanPanel label="If stuck" value={response.ifStuckFallback} />
            </div>

            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Time budget</p>
              <div className="mt-3 space-y-2">
                {response.timeBudget.map((item) => (
                  <div key={`${item.label}-${item.minutes}`} className="flex items-start gap-3 text-sm">
                    <Badge variant="muted" className="min-w-fit px-2 py-0.5">
                      {item.minutes} min
                    </Badge>
                    <p className="text-foreground">
                      <span className="font-medium">{item.label}:</span> {item.purpose}
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Step-by-step plan</p>
              <div className="mt-3 space-y-3">
                {response.stepByStepPlan.map((step, index) => (
                  <div key={`${step.title}-${index}`} className="rounded-sm border border-white/8 bg-black/10 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">{step.title}</p>
                      <Badge variant="default" className="px-2 py-0.5">
                        {step.minutes} min
                      </Badge>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-foreground/85">{step.instructions}</p>
                    <p className="mt-2 text-xs text-muted-foreground">Evidence: {step.successCheck}</p>
                  </div>
                ))}
              </div>
            </div>

            <ListPanel label="Guide focus" values={response.guideFocus} />
            <ListPanel label="Context used" values={response.beforeAfterContextUsed} />
            <ListPanel label="Success evidence" values={response.successEvidence} />
            {response.warnings.length ? <ListPanel label="Warnings" values={response.warnings} /> : null}
            <Badge variant={response.confidence === "high" ? "success" : response.confidence === "medium" ? "warning" : "danger"}>
              {response.confidence} confidence
            </Badge>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Generate this only when you want a precise plan for the selected block. It is read-only and will not change the calendar.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PlanPanel({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-sm border border-white/8 bg-white/4 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm leading-6 text-foreground">{value}</p>
    </div>
  );
}

function ListPanel({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="rounded-sm border border-white/8 bg-white/4 p-4">
      <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <div className="mt-3 space-y-2">
        {values.map((value) => (
          <p key={value} className="text-sm leading-6 text-foreground">
            {value}
          </p>
        ))}
      </div>
    </div>
  );
}
