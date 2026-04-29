import { Badge } from "@/components/ui/badge";
import type { SyllabusLevel } from "@/lib/types/planner";
import { cn } from "@/lib/utils";

const syllabusLevelLabels: Record<SyllabusLevel, string> = {
  sl: "SL",
  hl: "HL/AHL",
  mixed: "Mixed SL/HL",
};

const syllabusLevelVariants: Record<SyllabusLevel, "muted" | "warning" | "default"> = {
  sl: "muted",
  hl: "warning",
  mixed: "default",
};

export function getSyllabusLevelLabel(level: SyllabusLevel | null | undefined) {
  return level ? syllabusLevelLabels[level] : null;
}

export function SyllabusLevelBadge({
  level,
  className,
}: {
  level: SyllabusLevel | null | undefined;
  className?: string;
}) {
  if (!level) {
    return null;
  }

  const label = syllabusLevelLabels[level];

  return (
    <Badge
      variant={syllabusLevelVariants[level]}
      className={cn("shrink-0 uppercase tracking-[0.14em]", className)}
    >
      {label}
    </Badge>
  );
}
