import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function MetricCard({
  eyebrow,
  value,
  detail,
  tone = "default",
  accent,
}: {
  eyebrow: string;
  value: string;
  detail: string;
  tone?: "default" | "warning" | "danger" | "success";
  accent?: ReactNode;
}) {
  return (
    <Card
      className={cn(
        "h-full overflow-hidden border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02))]",
        tone === "warning" && "ring-1 ring-warning/25",
        tone === "danger" && "ring-1 ring-danger/25",
        tone === "success" && "ring-1 ring-success/25",
      )}
    >
      <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
        <div className="space-y-1">
          <p className="text-[11px] uppercase tracking-[0.24em] text-muted-foreground">{eyebrow}</p>
          <CardTitle className="text-[2.4rem] font-semibold leading-none">{value}</CardTitle>
        </div>
        {accent}
      </CardHeader>
      <CardContent className="pt-1 text-sm leading-6 text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}
