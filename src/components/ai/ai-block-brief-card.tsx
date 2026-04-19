"use client";

import { useState } from "react";
import { RefreshCw, Sparkles } from "lucide-react";

import { AiAuthNotice } from "@/components/ai/ai-auth-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAiBlockBrief } from "@/lib/ai/client";
import type { AiBlockBriefResponse } from "@/lib/ai/contracts";
import { useAiStore } from "@/lib/store/ai-store";

export function AiBlockBriefCard({
  context,
}: {
  context: Record<string, unknown>;
}) {
  const token = useAiStore((state) => state.token);
  const signOut = useAiStore((state) => state.signOut);
  const [response, setResponse] = useState<AiBlockBriefResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return <AiAuthNotice message="AI block briefs use the private DeepSeek backend. Sign in from Settings first." />;
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle className="text-base">AI Brief</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Generates a short session goal, mistake pattern, and reflection prompt for this block.
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
              setResponse(await fetchAiBlockBrief(token, { context }));
            } catch (briefError) {
              if (
                briefError instanceof Error &&
                "status" in briefError &&
                Number(briefError.status) === 401
              ) {
                signOut();
              }
              setError(
                briefError instanceof Error ? briefError.message : "Failed to generate AI brief.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {response ? "Refresh" : "Generate"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {response ? (
          <>
            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Goal</p>
              <p className="mt-2 text-sm text-foreground">{response.goal}</p>
            </div>
            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Likely mistake pattern</p>
              <p className="mt-2 text-sm text-foreground">{response.likelyMistakePattern}</p>
            </div>
            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Success check</p>
              <p className="mt-2 text-sm text-foreground">{response.successCheck}</p>
            </div>
            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Post-block reflection</p>
              <p className="mt-2 text-sm text-foreground">{response.postBlockReflectionPrompt}</p>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Generate a compact session brief for this exact scheduled block.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
