"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, KeyRound, RefreshCw, Shield } from "lucide-react";

import { getAiBackendBaseUrl } from "@/lib/ai/client";
import { useAiStore } from "@/lib/store/ai-store";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function AiSettingsCard() {
  const token = useAiStore((state) => state.token);
  const expiresAt = useAiStore((state) => state.expiresAt);
  const status = useAiStore((state) => state.status);
  const statusError = useAiStore((state) => state.statusError);
  const refreshStatus = useAiStore((state) => state.refreshStatus);
  const signIn = useAiStore((state) => state.signIn);
  const signOut = useAiStore((state) => state.signOut);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const backendUrl = getAiBackendBaseUrl();

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div>
          <CardTitle>AI backend</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            DeepSeek runs through a separate Vercel backend. The API key belongs there, never in GitHub Pages.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshStatus()}>
          <RefreshCw className="h-4 w-4" />
          Refresh
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="rounded-sm border border-white/8 bg-white/4 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Frontend backend URL</p>
            <p className="mt-2 break-all text-sm text-foreground">
              {backendUrl || "NEXT_PUBLIC_AI_BACKEND_URL is not set"}
            </p>
          </div>
          <div className="rounded-sm border border-white/8 bg-white/4 p-4">
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Backend status</p>
            <p className="mt-2 text-sm text-foreground">
              {status
                ? status.configured
                  ? "Configured"
                  : "Reachable, but missing server environment variables"
                : statusError
                  ? "Unavailable"
                  : "Checking"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {status
                ? `${status.provider} • fast ${status.fastModel} • review ${status.reviewModel}`
                : statusError ?? "Waiting for status response"}
            </p>
          </div>
        </div>

        <div className="rounded-sm border border-primary/20 bg-primary/8 p-4">
          <div className="flex items-start gap-3">
            <Shield className="mt-0.5 h-4 w-4 text-primary" />
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Where the secrets go</p>
              <p>
                Put <span className="font-mono text-foreground">DEEPSEEK_API_KEY</span>,{" "}
                <span className="font-mono text-foreground">AI_ACCESS_PASSWORD</span>,{" "}
                <span className="font-mono text-foreground">AI_SESSION_SECRET</span>, and{" "}
                <span className="font-mono text-foreground">AI_ALLOWED_ORIGIN</span> in Vercel project environment variables.
              </p>
              <p>
                Put only <span className="font-mono text-foreground">NEXT_PUBLIC_AI_BACKEND_URL</span> into the GitHub Pages build environment.
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-sm border border-white/8 bg-white/4 p-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-foreground">Private AI session</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {token && expiresAt
                  ? `Signed in until ${new Date(expiresAt).toLocaleString()}.`
                  : "Sign in with your private AI access password. The session token is stored only in browser session storage."}
              </p>
            </div>
            {token ? (
              <Button variant="outline" onClick={signOut}>
                Sign out
              </Button>
            ) : null}
          </div>
          {!token ? (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <div className="relative flex-1">
                <Input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter AI access password"
                />
                <button
                  type="button"
                  className="absolute inset-y-0 right-3 flex items-center text-muted-foreground"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <Button
                onClick={async () => {
                  setSubmitting(true);
                  setError(null);
                  try {
                    await signIn(password);
                    setPassword("");
                  } catch (signinError) {
                    setError(
                      signinError instanceof Error
                        ? signinError.message
                        : "Failed to sign in to the AI backend.",
                    );
                  } finally {
                    setSubmitting(false);
                  }
                }}
                disabled={!password.trim() || submitting}
              >
                <KeyRound className="h-4 w-4" />
                {submitting ? "Signing in" : "Sign in"}
              </Button>
            </div>
          ) : null}
          {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        </div>
      </CardContent>
    </Card>
  );
}
