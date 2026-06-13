import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
  indicatorClassName,
}: {
  value: number;
  className?: string;
  indicatorClassName?: string;
}) {
  return (
    <div
      className={cn(
        "h-2.5 overflow-hidden rounded-full border border-white/8 bg-black/25 shadow-inset",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full bg-[linear-gradient(90deg,hsl(var(--primary)),hsl(var(--subject-chemistry)))] shadow-[0_0_22px_hsl(var(--primary)/0.22)] transition-all",
          indicatorClassName,
        )}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}
