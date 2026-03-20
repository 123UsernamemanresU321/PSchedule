import type { Topic } from "@/lib/types/planner";

export function deriveTopicStatus(topic: Pick<Topic, "completedHours" | "estHours" | "mastery">) {
  const completionRatio = topic.completedHours / Math.max(topic.estHours, 0.25);
  if (completionRatio >= 1 && topic.mastery >= 4) {
    return "strong" as const;
  }

  if (completionRatio >= 1) {
    return "reviewed" as const;
  }

  if (completionRatio >= 0.7) {
    return "first_pass_done" as const;
  }

  if (completionRatio > 0) {
    return "learning" as const;
  }

  return "not_started" as const;
}

export function normalizeTopicProgress<T extends Topic>(topic: T): T {
  return {
    ...topic,
    status: deriveTopicStatus(topic),
  };
}
