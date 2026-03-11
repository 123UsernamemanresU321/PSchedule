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
  default: "bg-primary/14 text-primary",
  success: "bg-success/14 text-success",
  warning: "bg-warning/18 text-warning",
  danger: "bg-danger/14 text-danger",
  subject: "bg-white/8 text-foreground",
  muted: "bg-white/6 text-muted-foreground",
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
        "inline-flex items-center rounded-full border border-white/8 px-2.5 py-1 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
      {...props}
    />
  );
}
