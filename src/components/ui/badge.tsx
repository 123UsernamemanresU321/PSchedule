import type { HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

type BadgeVariant =
  | "default"
  | "success"
  | "warning"
  | "danger"
  | "subject"
  | "muted";

const variantClasses: Record<BadgeVariant, string> = {
  default: "border-primary/25 bg-primary/12 text-blue-100 shadow-[0_0_20px_hsl(var(--primary)/0.08)]",
  success: "border-success/25 bg-success/12 text-emerald-100",
  warning: "border-warning/30 bg-warning/14 text-amber-100",
  danger: "border-danger/30 bg-danger/14 text-rose-100",
  subject: "border-white/12 bg-white/[0.055] text-foreground",
  muted: "border-white/10 bg-white/[0.04] text-muted-foreground",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & {
  variant?: BadgeVariant;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold tracking-[-0.01em] shadow-inset",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
