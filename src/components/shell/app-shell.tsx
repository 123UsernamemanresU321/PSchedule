"use client";

import type { ReactNode } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";

import { StudyBlockDrawer } from "@/components/planner/study-block-drawer";
import { Sidebar } from "@/components/shell/sidebar";
import { TopHeader } from "@/components/shell/top-header";
import { Card } from "@/components/ui/card";
import { usePlannerStore } from "@/lib/store/planner-store";

export function AppShell({
  children,
}: {
  children: ReactNode;
}) {
  const initialized = usePlannerStore((state) => state.initialized);
  const loading = usePlannerStore((state) => state.loading);
  const error = usePlannerStore((state) => state.error);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Sidebar />
      <div className="lg:pl-[264px]">
        <TopHeader />
        <main className="mx-auto max-w-[1680px] px-5 py-7 lg:px-8 lg:py-8">
          {error ? (
            <Card className="mb-6 flex items-start gap-3 border-danger/30 bg-danger/8 p-4 text-danger">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">Planner error</p>
                <p className="text-sm text-danger/80">{error}</p>
              </div>
            </Card>
          ) : null}
          {!initialized && loading ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <div className="flex items-center gap-3 rounded-full border border-white/8 bg-white/4 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Building the deterministic weekly plan…
              </div>
            </div>
          ) : (
            children
          )}
        </main>
        <StudyBlockDrawer />
      </div>
    </div>
  );
}
