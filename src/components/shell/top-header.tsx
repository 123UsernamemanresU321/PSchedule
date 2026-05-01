"use client";

import { Bell, Database, WifiOff } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { usePlannerStore } from "@/lib/store/planner-store";

export function TopHeader() {
  const loading = usePlannerStore((state) => state.loading);
  const horizonStatus = usePlannerStore((state) => state.horizonStatus);
  const backgroundReplanStatus = usePlannerStore((state) => state.backgroundReplanStatus);
  const backgroundReplanScope = usePlannerStore((state) => state.backgroundReplanScope);

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-white/8 bg-background/78 px-5 backdrop-blur-xl lg:px-8">
      <div className="flex items-center gap-3">
        <Badge variant="muted" className="gap-1.5">
          <Database className="h-3.5 w-3.5" />
          IndexedDB
        </Badge>
        <Badge variant="muted" className="gap-1.5">
          <WifiOff className="h-3.5 w-3.5" />
          Local-first
        </Badge>
      </div>
      <div className="flex items-center gap-3">
        {loading ? <Badge variant="default">Replanning…</Badge> : null}
        {!loading && horizonStatus === "stale" ? <Badge variant="warning">Horizon stale</Badge> : null}
        {!loading && horizonStatus === "missing" ? <Badge variant="warning">Horizon missing</Badge> : null}
        {!loading && backgroundReplanStatus === "running" ? (
          <Badge variant="muted">
            {backgroundReplanScope === "tail_from_week" ? "Updating horizon…" : "Validating…"}
          </Badge>
        ) : null}
        {!loading && backgroundReplanStatus === "failed" ? (
          <Badge variant="default">Background sync failed</Badge>
        ) : null}
        <Button variant="ghost" size="sm" className="h-10 w-10 rounded-full p-0">
          <Bell className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
