"use client";

import { useEffect, type ReactNode } from "react";

import { usePlannerStore } from "@/lib/store/planner-store";

const STALE_CHUNK_RELOAD_KEY = "__planner_stale_chunk_reload__";
const STALE_CHUNK_RELOAD_PARAM = "__planner_chunk_reload__";
const STALE_CHUNK_RELOAD_TTL_MS = 60_000;

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

  useEffect(() => {
    if (!initialized) {
      void initialize();
    }
  }, [initialize, initialized]);

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
