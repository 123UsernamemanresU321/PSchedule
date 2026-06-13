"use client";

import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

export function Switch({
  checked,
  onCheckedChange,
  ...props
}: SwitchProps) {
  return (
    <button
      type="button"
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "premium-control-ring relative inline-flex h-6 w-11 rounded-full border transition shadow-inset",
        checked
          ? "border-primary/45 bg-primary/90 shadow-[0_0_28px_hsl(var(--primary)/0.22)]"
          : "border-white/12 bg-black/25 hover:bg-white/[0.06]",
      )}
      aria-pressed={checked}
      {...props}
    >
      <span
        className={cn(
          "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-[0_4px_14px_rgba(0,0,0,0.32)] transition",
          checked ? "left-[1.3rem]" : "left-0.5",
        )}
      />
    </button>
  );
}
