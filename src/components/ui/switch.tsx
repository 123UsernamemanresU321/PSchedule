"use client";

import { cn } from "@/lib/utils";

export function Switch({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 rounded-full border border-white/8 transition",
        checked ? "bg-primary" : "bg-white/8",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white transition",
          checked ? "left-[1.3rem]" : "left-0.5",
        )}
      />
    </button>
  );
}
