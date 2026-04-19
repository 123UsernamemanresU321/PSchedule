"use client";

import { useState } from "react";
import { Brain, RefreshCw } from "lucide-react";

import { AiAuthNotice } from "@/components/ai/ai-auth-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAiReview } from "@/lib/ai/client";
import type { AiReviewResponse } from "@/lib/ai/contracts";
import { useAiStore } from "@/lib/store/ai-store";

export function AiCoachCard({
  context,
}: {
  context: Record<string, unknown>;
}) {
  const token = useAiStore((state) => state.token);
  const signOut = useAiStore((state) => state.signOut);
  const [response, setResponse] = useState<AiReviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Coach</CardTitle>
        </CardHeader>
        <CardContent>
          <AiAuthNotice />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>AI Coach</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Planner-grounded weekly priorities from the deterministic horizon, not generic advice.
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
              setResponse(await fetchAiReview(token, { context }));
            } catch (reviewError) {
              if (
                reviewError instanceof Error &&
                "status" in reviewError &&
                Number(reviewError.status) === 401
              ) {
                signOut();
              }
              setError(
                reviewError instanceof Error ? reviewError.message : "Failed to fetch AI coach output.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Brain className="h-4 w-4" />}
          {response ? "Refresh" : "Generate"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {response ? (
          <>
            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-sm leading-6 text-foreground">{response.summary}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-sm border border-white/8 bg-white/4 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Biggest risk</p>
                <p className="mt-2 text-sm text-foreground">{response.biggestRisk}</p>
              </div>
              <div className="rounded-sm border border-white/8 bg-white/4 p-4 md:col-span-2">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Smallest corrective action</p>
                <p className="mt-2 text-sm text-foreground">{response.smallestCorrectiveAction}</p>
              </div>
            </div>
            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Top priorities</p>
              <ul className="mt-3 space-y-2 text-sm text-foreground">
                {response.topPriorities.map((priority) => (
                  <li key={priority}>• {priority}</li>
                ))}
              </ul>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Generate a planner-grounded coach note from the current full-horizon state.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
