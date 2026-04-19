"use client";

import { useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

import { AiAuthNotice } from "@/components/ai/ai-auth-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { fetchAiWhatIf } from "@/lib/ai/client";
import type { AiWhatIfResponse } from "@/lib/ai/contracts";
import type { PlannerExportPayload } from "@/lib/types/planner";
import { useAiStore } from "@/lib/store/ai-store";

const cannedScenarios = [
  "What if I move piano to 08:00 on school days?",
  "What if I add a light sick day tomorrow?",
  "What if I focus Physics this week?",
];

export function AiWhatIfCard({
  snapshot,
  currentWeekStart,
}: {
  snapshot: PlannerExportPayload;
  currentWeekStart: string;
}) {
  const token = useAiStore((state) => state.token);
  const signOut = useAiStore((state) => state.signOut);
  const [scenario, setScenario] = useState("");
  const [response, setResponse] = useState<AiWhatIfResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>What if…</CardTitle>
        </CardHeader>
        <CardContent>
          <AiAuthNotice />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>What if…</CardTitle>
        <p className="mt-1 text-sm text-muted-foreground">
          Runs a read-only simulation on a copied planner snapshot and compares deterministic before/after outputs.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          {cannedScenarios.map((candidate) => (
            <Button
              key={candidate}
              variant="ghost"
              size="sm"
              onClick={() => setScenario(candidate)}
            >
              {candidate}
            </Button>
          ))}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Input
            value={scenario}
            onChange={(event) => setScenario(event.target.value)}
            placeholder="What if I move piano to mornings this week?"
          />
          <Button
            disabled={!scenario.trim() || loading}
            onClick={async () => {
              setLoading(true);
              setError(null);
              try {
                setResponse(
                  await fetchAiWhatIf(token, {
                    scenario,
                    snapshot,
                    currentWeekStart,
                  }),
                );
              } catch (whatIfError) {
                if (
                  whatIfError instanceof Error &&
                  "status" in whatIfError &&
                  Number(whatIfError.status) === 401
                ) {
                  signOut();
                }
                setError(
                  whatIfError instanceof Error ? whatIfError.message : "Failed to run what-if simulation.",
                );
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            Simulate
          </Button>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {response ? (
          <div className="space-y-4">
            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-sm leading-6 text-foreground">{response.summary}</p>
            </div>
            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Parsed changes</p>
              <ul className="mt-3 space-y-2 text-sm text-foreground">
                {response.parsedChanges.map((change) => (
                  <li key={change}>• {change}</li>
                ))}
              </ul>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-sm border border-white/8 bg-white/4 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Coverage</p>
                <p className="mt-3 text-sm text-foreground">
                  Fillable gap: {response.coverage.beforeFillableGap ? "before yes" : "before no"} →{" "}
                  {response.coverage.afterFillableGap ? "after yes" : "after no"}
                </p>
                <p className="mt-2 text-sm text-foreground">
                  Hard coverage failures: {response.coverage.beforeHardCoverageFailures.length} →{" "}
                  {response.coverage.afterHardCoverageFailures.length}
                </p>
              </div>
              <div className="rounded-sm border border-white/8 bg-white/4 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recommended tradeoffs</p>
                <ul className="mt-3 space-y-2 text-sm text-foreground">
                  {response.recommendedTradeoffs.length ? (
                    response.recommendedTradeoffs.map((tradeoff) => <li key={tradeoff}>• {tradeoff}</li>)
                  ) : (
                    <li>• No extra tradeoffs were needed.</li>
                  )}
                </ul>
              </div>
            </div>
            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Subject impacts</p>
              <div className="mt-3 space-y-3">
                {response.impacts.map((impact) => (
                  <div key={impact.subjectId} className="rounded-sm border border-white/8 bg-background/30 p-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-medium text-foreground">{impact.subjectLabel}</p>
                      <p className="text-sm text-muted-foreground">
                        {impact.beforeStatus} → {impact.afterStatus}
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      Unscheduled hours {impact.beforeUnscheduledHours.toFixed(1)} →{" "}
                      {impact.afterUnscheduledHours.toFixed(1)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
