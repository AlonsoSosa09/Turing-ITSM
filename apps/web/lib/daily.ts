export const DAILY_PLANNED_WORK_KEY = "planned_work" as const;
export const DAILY_COMPLETED_WORK_KEY = "completed_work" as const;
export const DAILY_BLOCKERS_KEY = "blockers" as const;

function normalizedQuestionText(questionText: string | null | undefined): string {
  return questionText?.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim() ?? "";
}

export function isDailyPlannedWorkQuestion(
  semanticKey: string | null | undefined,
  questionText?: string,
): boolean {
  if (semanticKey === DAILY_PLANNED_WORK_KEY) return true;
  const normalized = normalizedQuestionText(questionText);
  return normalized === "what will you work on next?" || normalized === "¿en que trabajaras hoy?";
}

export function isDailyCompletedWorkQuestion(
  semanticKey: string | null | undefined,
  questionText?: string,
): boolean {
  if (semanticKey === DAILY_COMPLETED_WORK_KEY) return true;
  const normalized = normalizedQuestionText(questionText);
  return normalized === "what did you complete since your last update?" || normalized === "¿en que trabajaste ayer?";
}

export function isDailyBlockerQuestion(
  semanticKey: string | null | undefined,
  questionText?: string,
): boolean {
  if (semanticKey === DAILY_BLOCKERS_KEY) return true;
  const normalized = normalizedQuestionText(questionText);
  return normalized.includes("blocker") || normalized.includes("bloqueo");
}
