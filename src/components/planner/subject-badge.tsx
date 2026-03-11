import { cn } from "@/lib/utils";

const subjectTokenMap: Record<string, string> = {
  "physics-hl": "subject-physics",
  "maths-aa-hl": "subject-maths",
  "chemistry-hl": "subject-chemistry",
  olympiad: "subject-olympiad",
  "english-a-sl": "subject-english",
  "french-b-sl": "subject-french",
  "geography-transition": "subject-geography",
};

export function getSubjectAccentStyles(subjectId: string | null | undefined) {
  const token = subjectId ? subjectTokenMap[subjectId] : null;

  if (!token) {
    return {
      backgroundColor: "rgba(148, 163, 184, 0.12)",
      borderColor: "rgba(148, 163, 184, 0.18)",
      color: "rgba(226, 232, 240, 0.8)",
    };
  }

  return {
    backgroundColor: `hsl(var(--${token}) / 0.14)`,
    borderColor: `hsl(var(--${token}) / 0.32)`,
    color: `hsl(var(--${token}))`,
  };
}

export function SubjectBadge({
  subjectId,
  label,
  className,
}: {
  subjectId: string | null | undefined;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
        className,
      )}
      style={getSubjectAccentStyles(subjectId)}
    >
      {label}
    </span>
  );
}
