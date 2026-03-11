import { plannerExportSchema } from "@/lib/types/schemas";

export function createExportFilename() {
  const date = new Date().toISOString().slice(0, 10);
  return `adaptive-study-planner-${date}.json`;
}

export function parsePlannerJson(raw: string) {
  const parsed = JSON.parse(raw);
  return plannerExportSchema.parse(parsed);
}
