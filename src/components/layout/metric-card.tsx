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
        "h-full overflow-hidden",
        tone === "warning" && "border-warning/25 shadow-[0_0_32px_hsl(var(--warning)/0.06)]",
        tone === "danger" && "border-danger/25 shadow-[0_0_32px_hsl(var(--danger)/0.06)]",
        tone === "success" && "border-success/25 shadow-[0_0_32px_hsl(var(--success)/0.06)]",
      )}
    >
      <CardHeader className="flex-row items-start justify-between gap-4 pb-3">
        <div className="space-y-1">
          <p className="premium-label">{eyebrow}</p>
          <CardTitle className="text-[2.45rem] font-semibold leading-none tracking-[-0.055em]">{value}</CardTitle>
        </div>
        {accent}
      </CardHeader>
      <CardContent className="pt-1 text-sm leading-6 text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}
