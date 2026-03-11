"use client";

import { useEffect, type ReactNode } from "react";

import { usePlannerStore } from "@/lib/store/planner-store";

const STALE_CHUNK_RELOAD_KEY = "__planner_stale_chunk_reload__";
const STALE_CHUNK_RELOAD_TTL_MS = 15_000;

function isStaleChunkMessage(message: string) {
  return (
    message.includes("ChunkLoadError") ||
    message.includes("Loading chunk") ||
    message.includes("Failed to fetch dynamically imported module") ||
    (message.includes("/_next/static/chunks/") && message.includes("page.js"))
  );
}

function reloadForStaleChunkOnce(reason: string) {
  if (typeof window === "undefined") {
    return;
  }

  const now = Date.now();
  const path = window.location.pathname;
  const previousAttempt = window.sessionStorage.getItem(STALE_CHUNK_RELOAD_KEY);

  if (previousAttempt) {
    try {
      const parsed = JSON.parse(previousAttempt) as {
        path?: string;
        timestamp?: number;
      };

      if (
        parsed.path === path &&
        typeof parsed.timestamp === "number" &&
        now - parsed.timestamp < STALE_CHUNK_RELOAD_TTL_MS
      ) {
        return;
      }
    } catch {
      // Ignore malformed session storage entries and continue with a fresh one.
    }
  }

  window.sessionStorage.setItem(
    STALE_CHUNK_RELOAD_KEY,
    JSON.stringify({ path, reason, timestamp: now }),
  );
  window.location.reload();
}

export function PlannerBootstrap({
  children,
}: {
  children: ReactNode;
}) {
  const initialized = usePlannerStore((state) => state.initialized);
  const initialize = usePlannerStore((state) => state.initialize);

  useEffect(() => {
    if (!initialized) {
      void initialize();
    }
  }, [initialize, initialized]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleError = (event: ErrorEvent) => {
      const message =
        event.message ||
        event.error?.message ||
        (typeof event.filename === "string" ? event.filename : "");

      if (isStaleChunkMessage(message)) {
        reloadForStaleChunkOnce(message);
      }
    };

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason =
        typeof event.reason === "string"
          ? event.reason
          : event.reason instanceof Error
            ? event.reason.message
            : "";

      if (isStaleChunkMessage(reason)) {
        reloadForStaleChunkOnce(reason);
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
