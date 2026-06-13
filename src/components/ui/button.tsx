"use client";

import {
  forwardRef,
  type ButtonHTMLAttributes,
} from "react";

import { cn } from "@/lib/utils";

type ButtonVariant = "default" | "secondary" | "ghost" | "outline" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const variantClasses: Record<ButtonVariant, string> = {
  default:
    "border border-primary/35 bg-[linear-gradient(180deg,hsl(var(--primary)/0.98),hsl(var(--primary)/0.82))] text-primary-foreground shadow-[0_14px_32px_hsl(var(--primary)/0.18)] hover:border-primary/55 hover:brightness-110 active:brightness-95",
  secondary:
    "border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.075),rgba(255,255,255,0.035))] text-foreground shadow-inset hover:border-white/16 hover:bg-white/[0.07]",
  ghost:
    "border border-transparent bg-transparent text-muted-foreground hover:border-white/10 hover:bg-white/[0.055] hover:text-foreground",
  outline:
    "border border-white/12 bg-black/10 text-foreground shadow-inset hover:border-white/20 hover:bg-white/[0.055]",
  danger:
    "border border-danger/25 bg-danger/14 text-danger hover:border-danger/40 hover:bg-danger/22",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-sm",
};

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "md", ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "premium-control-ring inline-flex items-center justify-center gap-2 rounded-lg font-medium tracking-[-0.01em] transition duration-150 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
