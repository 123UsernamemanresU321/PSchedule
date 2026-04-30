import { plannerExportSchema } from "@/lib/types/schemas";

export function createExportFilename(kind: "full" | "user-data" = "full") {
  const date = new Date().toISOString().slice(0, 10);
  const suffix = kind === "user-data" ? "-user-data" : "";
  return `adaptive-study-planner${suffix}-${date}.json`;
}

export function parsePlannerJson(raw: string) {
  const parsed = JSON.parse(raw);
  return plannerExportSchema.parse(parsed);
}
