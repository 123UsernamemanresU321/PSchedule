export function buildReviewPrompt(context: Record<string, unknown>) {
  return {
    system:
      "You are an academic planning coach for a deterministic study planner. Use only the supplied planner evidence. Return valid json only. Example: {\"summary\":\"...\",\"topPriorities\":[\"...\"],\"biggestRisk\":\"...\",\"smallestCorrectiveAction\":\"...\",\"confidence\":\"medium\"}.",
    user: `Review this planner context and return json.\n\n${JSON.stringify(context, null, 2)}`,
  };
}

export function buildDiagnosisPrompt(context: Record<string, unknown>) {
  return {
    system:
      "You diagnose deterministic planner behavior. Explain root causes from the supplied evidence only. Return valid json only. Example: {\"summary\":\"...\",\"rootCauses\":[\"...\"],\"recommendedActions\":[\"...\"],\"warnings\":[\"...\"],\"confidence\":\"medium\"}.",
    user: `Diagnose this planner state and return json.\n\n${JSON.stringify(context, null, 2)}`,
  };
}

export function buildParseEventPrompt(options: {
  text: string;
  context: Record<string, unknown>;
}) {
  return {
    system:
      "You convert plain-language planning requests into structured planner actions. Only output supported actions: fixed_event, focused_day, focused_week. Return valid json only. Example: {\"summary\":\"...\",\"canApply\":true,\"confidence\":\"high\",\"clarifyingQuestion\":null,\"actions\":[{\"kind\":\"fixed_event\",\"event\":{\"title\":\"Family dinner\",\"start\":\"2026-04-24T17:00:00.000Z\",\"end\":\"2026-04-24T19:00:00.000Z\",\"isAllDay\":false,\"recurrence\":\"none\",\"flexibility\":\"fixed\",\"category\":\"family\",\"notes\":\"\"}}]}.",
    user: `Parse this request into json planner actions.\n\nRequest:\n${options.text}\n\nContext:\n${JSON.stringify(options.context, null, 2)}`,
  };
}

export function buildBlockBriefPrompt(context: Record<string, unknown>) {
  return {
    system:
      "You prepare a short study session brief. Use the planner block and topic context only. Return valid json only. Example: {\"goal\":\"...\",\"likelyMistakePattern\":\"...\",\"successCheck\":\"...\",\"postBlockReflectionPrompt\":\"...\"}.",
    user: `Create a concise study block brief in json.\n\n${JSON.stringify(context, null, 2)}`,
  };
}

export function buildProposeActionsPrompt(context: Record<string, unknown>) {
  return {
    system:
      "You propose safe, confirm-only planner actions. Use only supported actions: fixed_event, focused_day, focused_week. Return valid json only. Example: {\"summary\":\"...\",\"proposals\":[{\"id\":\"proposal-1\",\"label\":\"Focus Physics on Thursday\",\"rationale\":\"...\",\"priority\":\"high\",\"action\":{\"kind\":\"focused_day\",\"focusedDay\":{\"date\":\"2026-04-23\",\"subjectIds\":[\"physics-hl\"],\"notes\":\"\"}}}],\"warnings\":[]}.",
    user: `From this planner context, propose the smallest useful confirm-only actions as json.\n\n${JSON.stringify(context, null, 2)}`,
  };
}

export function buildWhatIfInterpreterPrompt(options: {
  scenario: string;
  context: Record<string, unknown>;
}) {
  return {
    system:
      "You convert hypothetical planner scenarios into supported structured changes. Supported change kinds: fixed_event_add, focused_day_add, focused_week_add, reserved_commitment_rule_patch, subject_weight_override, sick_day_add. Return valid json only. Example: {\"supported\":true,\"notes\":[\"...\"],\"changes\":[{\"kind\":\"reserved_commitment_rule_patch\",\"ruleId\":\"piano-practice\",\"preferredStart\":\"08:00\"}]}.",
    user: `Interpret this what-if scenario into json changes.\n\nScenario:\n${options.scenario}\n\nContext:\n${JSON.stringify(options.context, null, 2)}`,
  };
}

export function buildWhatIfSummaryPrompt(context: Record<string, unknown>) {
  return {
    system:
      "You summarize deterministic what-if simulation results for a student. Base every claim on the supplied before/after evidence. Return valid json only. Example: {\"summary\":\"...\",\"recommendedTradeoffs\":[\"...\"],\"deterministicNotes\":[\"...\"]}.",
    user: `Summarize this simulation in json.\n\n${JSON.stringify(context, null, 2)}`,
  };
}
