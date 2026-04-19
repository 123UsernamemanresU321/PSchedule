"use client";

import { useEffect, type ReactNode } from "react";

import { useAiStore } from "@/lib/store/ai-store";
import { usePlannerStore } from "@/lib/store/planner-store";

const STALE_CHUNK_RELOAD_KEY = "__planner_stale_chunk_reload__";
const STALE_CHUNK_RELOAD_PARAM = "__planner_chunk_reload__";
const STALE_CHUNK_RELOAD_TTL_MS = 60_000;

export function isStaleChunkMessage(message: string, stack = "", filename = "") {
  const signal = [message, stack, filename].filter(Boolean).join("\n");
  const looksLikeWebpackRuntimeMismatch =
    (signal.includes("l[e].call") ||
      signal.includes("reading 'call'") ||
      signal.includes('reading "call"')) &&
    (signal.includes("webpack-") || signal.includes("/_next/static/chunks/"));

  return (
    signal.includes("ChunkLoadError") ||
    signal.includes("Loading chunk") ||
    signal.includes("Failed to load module script") ||
    signal.includes("Importing a module script failed") ||
    signal.includes("Failed to fetch dynamically imported module") ||
    (signal.includes("/_next/static/chunks/") && signal.includes("page.js")) ||
    looksLikeWebpackRuntimeMismatch
  );
}

function reloadForStaleChunkOnce(reason: string) {
  if (typeof window === "undefined") {
    return;
  }

  const now = Date.now();
  const previousAttempt = window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY);

  if (previousAttempt) {
    try {
      const parsed = JSON.parse(previousAttempt) as {
        timestamp?: number;
      };

      if (
        typeof parsed.timestamp === "number" &&
        now - parsed.timestamp < STALE_CHUNK_RELOAD_TTL_MS
      ) {
        return;
      }
    } catch {
      // Ignore malformed session storage entries and continue with a fresh one.
    }
  }

  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set(STALE_CHUNK_RELOAD_PARAM, String(now));
  window.sessionStorage.setItem(
    STALE_CHUNK_RELOAD_KEY,
    JSON.stringify({ reason, timestamp: now }),
  );
  window.location.replace(nextUrl.toString());
}

export function PlannerBootstrap({
  children,
}: {
  children: ReactNode;
}) {
  const initialized = usePlannerStore((state) => state.initialized);
  const initialize = usePlannerStore((state) => state.initialize);
  const hydrateAi = useAiStore((state) => state.hydrate);

  useEffect(() => {
    if (!initialized) {
      void initialize();
    }
  }, [initialize, initialized]);

  useEffect(() => {
    hydrateAi();
  }, [hydrateAi]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const currentUrl = new URL(window.location.href);
    if (!currentUrl.searchParams.has(STALE_CHUNK_RELOAD_PARAM)) {
      return;
    }

    currentUrl.searchParams.delete(STALE_CHUNK_RELOAD_PARAM);
    window.history.replaceState(window.history.state, "", currentUrl.toString());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleError = (event: ErrorEvent) => {
      const message =
        event.message ||
        event.error?.message ||
        "";
      const stack =
        typeof event.error?.stack === "string" ? event.error.stack : "";
      const filename = typeof event.filename === "string" ? event.filename : "";

      if (isStaleChunkMessage(message, stack, filename)) {
        reloadForStaleChunkOnce([message, stack, filename].filter(Boolean).join("\n"));
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reasonMessage =
        typeof event.reason === "string"
          ? event.reason
          : event.reason instanceof Error
            ? event.reason.message
            : typeof event.reason?.message === "string"
              ? event.reason.message
              : "";
      const reasonStack =
        event.reason instanceof Error
          ? (event.reason.stack ?? "")
          : typeof event.reason?.stack === "string"
            ? event.reason.stack
            : "";

      if (isStaleChunkMessage(reasonMessage, reasonStack)) {
        reloadForStaleChunkOnce([reasonMessage, reasonStack].filter(Boolean).join("\n"));
      }
    };

    window.addEventListener("error", handleError);
    window.addEventListener("unhandledrejection", handleRejection);

    return () => {
      window.removeEventListener("error", handleError);
      window.removeEventListener("unhandledrejection", handleRejection);
    };
  }, []);

  return children;
}
