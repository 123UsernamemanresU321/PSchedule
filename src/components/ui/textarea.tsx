import type { TextareaHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export function Textarea({
  className,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "premium-control-ring min-h-28 w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-foreground shadow-inset placeholder:text-muted-foreground/70 hover:border-white/16 hover:bg-white/[0.035] focus:bg-white/[0.04] disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}
