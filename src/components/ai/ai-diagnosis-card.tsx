"use client";

import { useState } from "react";
import { Microscope, RefreshCw } from "lucide-react";

import { AiAuthNotice } from "@/components/ai/ai-auth-notice";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { fetchAiDiagnosis } from "@/lib/ai/client";
import type { AiDiagnosisResponse } from "@/lib/ai/contracts";
import { useAiStore } from "@/lib/store/ai-store";

export function AiDiagnosisCard({
  context,
}: {
  context: Record<string, unknown>;
}) {
  const token = useAiStore((state) => state.token);
  const signOut = useAiStore((state) => state.signOut);
  const [response, setResponse] = useState<AiDiagnosisResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!token) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Diagnosis</CardTitle>
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
          <CardTitle>AI Diagnosis</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Explains strange planner behavior from the real diagnostics already computed in the backend.
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
              setResponse(await fetchAiDiagnosis(token, { context }));
            } catch (diagnosisError) {
              if (
                diagnosisError instanceof Error &&
                "status" in diagnosisError &&
                Number(diagnosisError.status) === 401
              ) {
                signOut();
              }
              setError(
                diagnosisError instanceof Error
                  ? diagnosisError.message
                  : "Failed to fetch AI diagnosis.",
              );
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Microscope className="h-4 w-4" />}
          {response ? "Refresh" : "Diagnose"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        {response ? (
          <>
            <div className="rounded-sm border border-white/8 bg-white/4 p-4">
              <p className="text-sm leading-6 text-foreground">{response.summary}</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-sm border border-white/8 bg-white/4 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Root causes</p>
                <ul className="mt-3 space-y-2 text-sm text-foreground">
                  {response.rootCauses.map((cause) => (
                    <li key={cause}>• {cause}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-sm border border-white/8 bg-white/4 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recommended actions</p>
                <ul className="mt-3 space-y-2 text-sm text-foreground">
                  {response.recommendedActions.map((action) => (
                    <li key={action}>• {action}</li>
                  ))}
                </ul>
              </div>
            </div>
            {response.warnings.length ? (
              <div className="rounded-sm border border-warning/20 bg-warning/10 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-warning">Warnings</p>
                <ul className="mt-3 space-y-2 text-sm text-foreground">
                  {response.warnings.map((warning) => (
                    <li key={warning}>• {warning}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            Generate an explanation for gaps, deadline pressure, carry-over, or strange block behavior.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
