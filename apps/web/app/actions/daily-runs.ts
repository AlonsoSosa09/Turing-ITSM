"use server";

import {
  createDailyQuestionSchema,
  deactivateDailyQuestionSchema,
  generateDailyRunSchema,
  submitDailyResponseSchema,
  teamDailyQuestionsSchema,
  teamDailyScheduleSchema,
} from "@turing-itsm/validation";
import { revalidatePath } from "next/cache";
import { isAdmin, isInternalRole, type InternalRole } from "@/lib/rbac";
import { createClient } from "@/utils/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type DailyContext = {
  tenantId: string;
  userId: string;
  role: InternalRole;
};

export type DailyActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type DailyQuestionRow = {
  id: string;
  question_text: string;
  semantic_key: string | null;
  is_active: boolean;
  created_at: string;
  deactivated_at: string | null;
};

export type DailyTeamRow = { id: string; name: string };

export type DailyResponseTeam = DailyTeamRow & { localDate: string };

export type DailyScheduleRow = {
  id: string;
  team_id: string;
  timezone_name: string;
  local_time: string;
  scheduled_weekdays: number[];
  response_window: string;
  is_active: boolean;
};

export type DailySelectionRow = {
  team_id: string;
  question_id: string;
  position: number;
};

export type DailyRunRow = {
  id: string;
  team_id: string;
  schedule_id: string;
  scheduled_for: string;
  due_at: string;
  local_date: string;
  timezone_snapshot: string;
};

export type DailyRunQuestionRow = {
  run_id: string;
  question_id: string;
  question_text: string;
  semantic_key: string | null;
  position: number;
};

export type DailySubmissionRow = {
  id: string;
  user_id: string;
  submitted_at: string;
};

export type DailySubmissionReportRunRow = {
  submission_id: string;
  run_id: string;
  team_id: string;
  local_date: string;
};

export type DailySubmissionAnswerRow = {
  submission_id: string;
  question_text: string;
  answer_text: string;
};

export type DailyAdminData = {
  teams: DailyTeamRow[];
  questions: DailyQuestionRow[];
  schedules: DailyScheduleRow[];
  selections: DailySelectionRow[];
  runs: DailyRunRow[];
  reportTeams: DailyTeamRow[];
  submissions: DailySubmissionRow[];
  submissionRuns: DailySubmissionReportRunRow[];
  submissionAnswers: DailySubmissionAnswerRow[];
  people: Array<{ id: string; full_name: string }>;
  currentUserId: string;
  pendingRuns: DailyRunRow[];
  runQuestions: DailyRunQuestionRow[];
};

export type DailyMemberData = {
  pendingRuns: DailyRunRow[];
  runQuestions: DailyRunQuestionRow[];
  history: DailySubmissionRow[];
  historyRunCounts: Record<string, number>;
  reportTeams: DailyTeamRow[];
  submissions: DailySubmissionRow[];
  submissionRuns: DailySubmissionReportRunRow[];
  submissionAnswers: DailySubmissionAnswerRow[];
  people: Array<{ id: string; full_name: string }>;
  currentUserId: string;
  responseTeamOptions: DailyTeamRow[];
  selectedResponseTeam?: DailyResponseTeam;
};

const success = (message: string): DailyActionState => ({ status: "success", message });
const failure = (message: string): DailyActionState => ({ status: "error", message });

function formFields(formData: FormData): Record<string, FormDataEntryValue> {
  return Object.fromEntries(formData.entries());
}

function revalidateDaily(): void {
  revalidatePath("/workspace/daily");
  revalidatePath("/workspace/dashboard");
}

function databaseMessage(
  error: { code?: string; message?: string } | null,
  fallback: string,
): string {
  const message = error?.message?.toLowerCase() ?? "";
  if (error?.code === "23505") {
    if (message.includes("daily_runs") || message.includes("team_id, local_date")) {
      return "Ya existe una ejecución Daily para ese equipo y fecha local.";
    }
    return "Ya existe un registro con esos datos.";
  }
  if (error?.code === "23503") return "El equipo o la pregunta seleccionada ya no está disponible.";
  if (error?.code === "42501") return "Ya no tenés permiso para realizar esta acción.";
  if (message.includes("timezone") || message.includes("time zone")) {
    return "La zona horaria indicada no es válida para Daily.";
  }
  if (message.includes("does not match its team schedule occurrence")) {
    return "La fecha elegida no coincide con una ocurrencia válida del horario del equipo.";
  }
  if (message.includes("requires the active schedule")) {
    return "El equipo no tiene un horario Daily activo.";
  }
  if (message.includes("only active daily questions")) {
    return "Una de las preguntas ya fue desactivada. Actualizá la página y elegí otra.";
  }
  return fallback;
}

async function resolveInternalContext(
  supabase: SupabaseClient,
): Promise<{ context: DailyContext | null; error: string | null }> {
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    return { context: null, error: "Tu sesión venció. Volvé a iniciar sesión." };
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("tenant_id, role, status")
    .eq("id", auth.user.id)
    .maybeSingle();

  if (
    profileError ||
    !profile ||
    profile.status !== "active" ||
    typeof profile.tenant_id !== "string" ||
    !isInternalRole(profile.role)
  ) {
    return { context: null, error: "Se requiere una cuenta interna activa." };
  }

  return {
    context: { tenantId: profile.tenant_id, userId: auth.user.id, role: profile.role },
    error: null,
  };
}

async function resolveAdminContext(
  supabase: SupabaseClient,
): Promise<{ context: DailyContext | null; error: string | null }> {
  const result = await resolveInternalContext(supabase);
  if (!result.context || !isAdmin(result.context.role)) {
    return { context: null, error: "Se requiere acceso de administrador activo." };
  }
  return result;
}

async function findActiveTeam(
  supabase: SupabaseClient,
  context: DailyContext,
  teamId: string,
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("teams")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("id", teamId)
    .is("archived_at", null)
    .maybeSingle();
  return data as { id: string } | null;
}

function parseScheduleTime(value: string): { hours: number; minutes: number; seconds: number } | null {
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]), seconds: Number(match[3] ?? "0") };
}

function localDateParts(date: Date, timezoneName: string): Record<string, string> {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
}

function resolveScheduledFor(
  localDate: string,
  localTime: string,
  timezoneName: string,
): { scheduledFor: string | null; error: string | null } {
  const time = parseScheduleTime(localTime);
  if (!time) return { scheduledFor: null, error: "El horario Daily almacenado no tiene un formato válido." };

  const [year, month, day] = localDate.split("-").map(Number);
  const expected = {
    year: String(year).padStart(4, "0"),
    month: String(month).padStart(2, "0"),
    day: String(day).padStart(2, "0"),
    hour: String(time.hours).padStart(2, "0"),
    minute: String(time.minutes).padStart(2, "0"),
    second: String(time.seconds).padStart(2, "0"),
  };

  try {
    const nominalUtc = Date.UTC(year, month - 1, day, time.hours, time.minutes, time.seconds);
    const matches: Date[] = [];
    for (let offsetMinutes = -900; offsetMinutes <= 900; offsetMinutes += 1) {
      const candidate = new Date(nominalUtc + offsetMinutes * 60_000);
      const parts = localDateParts(candidate, timezoneName);
      if (
        parts.year === expected.year &&
        parts.month === expected.month &&
        parts.day === expected.day &&
        parts.hour === expected.hour &&
        parts.minute === expected.minute &&
        parts.second === expected.second
      ) {
        matches.push(candidate);
      }
    }

    if (matches.length === 0) {
      return { scheduledFor: null, error: "La hora elegida no existe en esa zona horaria por un cambio de horario de verano." };
    }
    if (matches.length > 1) {
      return { scheduledFor: null, error: "La hora elegida es ambigua por un cambio de horario de verano. Elegí otra hora." };
    }
    return { scheduledFor: matches[0].toISOString(), error: null };
  } catch {
    return { scheduledFor: null, error: "La zona horaria configurada no es válida en el servidor." };
  }
}

function weekdayForLocalDate(localDate: string): number {
  const weekday = new Date(`${localDate}T00:00:00.000Z`).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

export async function createDailyQuestion(
  _previousState: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  const parsed = createDailyQuestionSchema.safeParse(formFields(formData));
  if (!parsed.success) return failure("Escribí una pregunta de entre 3 y 500 caracteres.");

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere acceso de administrador activo.");

  const { error } = await supabase.from("daily_questions").insert({
    tenant_id: context.tenantId,
    question_text: parsed.data.questionText,
    created_by: context.userId,
  });
  if (error) return failure(databaseMessage(error, "No se pudo crear la pregunta."));

  revalidateDaily();
  return success("Pregunta Daily creada.");
}

export async function deactivateDailyQuestion(
  _previousState: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  const parsed = deactivateDailyQuestionSchema.safeParse(formFields(formData));
  if (!parsed.success) return failure("Confirmá la desactivación de la pregunta.");

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere acceso de administrador activo.");

  const { data, error } = await supabase
    .from("daily_questions")
    .update({ is_active: false })
    .eq("tenant_id", context.tenantId)
    .eq("id", parsed.data.questionId)
    .eq("is_active", true)
    .select("id")
    .maybeSingle();
  if (error) return failure(databaseMessage(error, "No se pudo desactivar la pregunta."));
  if (!data) return failure("La pregunta ya no está activa o no pertenece a tu tenant.");

  revalidateDaily();
  return success("Pregunta desactivada. Se quitó de las selecciones de equipo vigentes.");
}

export async function saveTeamDailySchedule(
  _previousState: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  const parsed = teamDailyScheduleSchema.safeParse({
    ...formFields(formData),
    weekdays: formData.getAll("weekday"),
    isActive: formData.get("isActive") === "true",
  });
  if (!parsed.success) {
    return failure("Completá una zona horaria, una hora, al menos un día y una ventana de respuesta válida.");
  }

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere acceso de administrador activo.");
  if (!(await findActiveTeam(supabase, context, parsed.data.teamId))) {
    return failure("Elegí un equipo activo de tu tenant.");
  }

  const { data: existing, error: lookupError } = await supabase
    .from("team_daily_schedules")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("team_id", parsed.data.teamId)
    .maybeSingle();
  if (lookupError) return failure(databaseMessage(lookupError, "No se pudo consultar el horario Daily."));

  const scheduleValues = {
    timezone_name: parsed.data.timezoneName,
    local_time: parsed.data.localTime,
    scheduled_weekdays: parsed.data.weekdays,
    response_window: `${parsed.data.responseWindowMinutes} minutes`,
    is_active: parsed.data.isActive,
  };
  const { error } = existing
    ? await supabase
        .from("team_daily_schedules")
        .update(scheduleValues)
        .eq("tenant_id", context.tenantId)
        .eq("id", existing.id)
    : await supabase.from("team_daily_schedules").insert({
        ...scheduleValues,
        tenant_id: context.tenantId,
        team_id: parsed.data.teamId,
        created_by: context.userId,
      });
  if (error) return failure(databaseMessage(error, "No se pudo guardar el horario Daily."));

  revalidateDaily();
  return success("Horario Daily guardado.");
}

export async function saveTeamDailyQuestions(
  _previousState: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  const questionIds = formData
    .getAll("questionId")
    .map((value) => String(value).trim())
    .filter(Boolean);
  const parsed = teamDailyQuestionsSchema.safeParse({
    ...formFields(formData),
    questionIds,
  });
  if (!parsed.success) return failure("Elegí hasta 3 preguntas distintas del catálogo activo.");

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere acceso de administrador activo.");
  if (!(await findActiveTeam(supabase, context, parsed.data.teamId))) {
    return failure("Elegí un equipo activo de tu tenant.");
  }

  if (parsed.data.questionIds.length > 0) {
    const { data: activeQuestions, error: questionError } = await supabase
      .from("daily_questions")
      .select("id")
      .eq("tenant_id", context.tenantId)
      .eq("is_active", true)
      .in("id", parsed.data.questionIds);
    if (questionError) return failure(databaseMessage(questionError, "No se pudo validar las preguntas seleccionadas."));
    if ((activeQuestions ?? []).length !== parsed.data.questionIds.length) {
      return failure("Todas las preguntas seleccionadas deben seguir activas y pertenecer a tu tenant.");
    }
  }

  const { error: removeError } = await supabase
    .from("team_daily_questions")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("team_id", parsed.data.teamId);
  if (removeError) return failure(databaseMessage(removeError, "No se pudo actualizar la selección del equipo."));

  if (parsed.data.questionIds.length > 0) {
    const { error: insertError } = await supabase.from("team_daily_questions").insert(
      parsed.data.questionIds.map((questionId, index) => ({
        tenant_id: context.tenantId,
        team_id: parsed.data.teamId,
        question_id: questionId,
        position: index + 1,
        selected_by: context.userId,
      })),
    );
    if (insertError) {
      return failure(
        "No se pudo aplicar la selección completa. Actualizá la página y revisá la configuración antes de intentar nuevamente.",
      );
    }
  }

  revalidateDaily();
  return success("Selección y orden de preguntas guardados.");
}

export async function generateDailyRun(
  _previousState: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  const parsed = generateDailyRunSchema.safeParse(formFields(formData));
  if (!parsed.success) return failure("Elegí un equipo y una fecha local válida.");

  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere acceso de administrador activo.");
  if (!(await findActiveTeam(supabase, context, parsed.data.teamId))) {
    return failure("Elegí un equipo activo de tu tenant.");
  }

  const { data: schedule, error: scheduleError } = await supabase
    .from("team_daily_schedules")
    .select("id, timezone_name, local_time, scheduled_weekdays")
    .eq("tenant_id", context.tenantId)
    .eq("team_id", parsed.data.teamId)
    .eq("is_active", true)
    .maybeSingle();
  if (scheduleError) return failure(databaseMessage(scheduleError, "No se pudo consultar el horario Daily."));
  if (!schedule) return failure("El equipo no tiene un horario Daily activo.");

  const scheduleWeekdays = schedule.scheduled_weekdays as number[];
  if (!scheduleWeekdays.includes(weekdayForLocalDate(parsed.data.localDate))) {
    return failure("La fecha elegida no está incluida en los días configurados para este equipo.");
  }

  const { data: selections, error: selectionError } = await supabase
    .from("team_daily_questions")
    .select("question_id")
    .eq("tenant_id", context.tenantId)
    .eq("team_id", parsed.data.teamId);
  if (selectionError) return failure(databaseMessage(selectionError, "No se pudo consultar las preguntas del equipo."));
  const selectedQuestionIds = (selections ?? []).map((selection) => selection.question_id as string);
  if (selectedQuestionIds.length === 0) {
    return failure("El equipo no tiene preguntas Daily activas seleccionadas.");
  }

  const { data: activeQuestions, error: activeQuestionError } = await supabase
    .from("daily_questions")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("is_active", true)
    .in("id", selectedQuestionIds);
  if (activeQuestionError) return failure(databaseMessage(activeQuestionError, "No se pudo validar las preguntas del equipo."));
  if ((activeQuestions ?? []).length === 0) {
    return failure("El equipo no tiene preguntas Daily activas seleccionadas.");
  }

  const occurrence = resolveScheduledFor(
    parsed.data.localDate,
    String(schedule.local_time),
    String(schedule.timezone_name),
  );
  if (!occurrence.scheduledFor) return failure(occurrence.error ?? "No se pudo calcular la ocurrencia Daily.");

  const { error } = await supabase.from("daily_runs").insert({
    tenant_id: context.tenantId,
    team_id: parsed.data.teamId,
    schedule_id: schedule.id,
    scheduled_for: occurrence.scheduledFor,
  });
  if (error) return failure(databaseMessage(error, "No se pudo generar la ejecución Daily."));

  revalidateDaily();
  return success("Ejecución Daily generada con el horario y la zona horaria del equipo.");
}

export async function submitDailyResponse(
  _previousState: DailyActionState,
  formData: FormData,
): Promise<DailyActionState> {
  const runIds = formData.getAll("runId").map(String);
  const localDate = formData.get("localDate");
  const answers = Array.from(formData.entries())
    .filter(([name]) => name.startsWith("answer:"))
    .map(([name, value]) => ({ questionId: name.slice("answer:".length), answer: String(value) }));
  const parsed = submitDailyResponseSchema.safeParse({ runIds, localDate, answers });
  if (!parsed.success) {
    return failure(
      parsed.error.issues.some((issue) => issue.path[0] === "localDate")
        ? "La fecha seleccionada no es válida."
        : "Respondé cada pregunta con entre 1 y 4000 caracteres.",
    );
  }

  const supabase = await createClient();
  const { context, error: contextError } = await resolveInternalContext(supabase);
  if (!context) return failure(contextError ?? "Se requiere una cuenta interna activa.");

  const { error } = await supabase.rpc("submit_daily_response_with_tasks", {
    p_run_ids: parsed.data.runIds,
    p_answers: parsed.data.answers.map((answer) => ({
      question_id: answer.questionId,
      answer: answer.answer.trim(),
    })),
    p_local_date: parsed.data.localDate,
    p_carried_task_ids: [],
  });
  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("do not match the selected local date")) {
      return failure("La ejecución no coincide con la fecha seleccionada. Actualizá la página.");
    }
    if (message.includes("already has a submission")) {
      return failure("Una de estas ejecuciones ya fue respondida. Actualizá la página.");
    }
    if (message.includes("missing, duplicated, or inaccessible")) {
      return failure("Una de las ejecuciones ya no está disponible para tu cuenta. Actualizá la página.");
    }
    if (message.includes("answers must")) {
      return failure("Las respuestas no coinciden con las preguntas pendientes. Actualizá la página e intentá nuevamente.");
    }
    if (message.includes("exactly one team")) {
      return failure("Seleccioná un solo equipo antes de responder Daily.");
    }
    return failure("No se pudo registrar la respuesta Daily. Intentá nuevamente.");
  }

  return success("Respuesta Daily registrada. Las respuestas enviadas no se pueden editar.");
}

function countById(rows: Array<{ submission_id: string }>): Record<string, number> {
  return rows.reduce<Record<string, number>>((counts, row) => {
    counts[row.submission_id] = (counts[row.submission_id] ?? 0) + 1;
    return counts;
  }, {});
}

function dailyReportWindow(): { cutoff: string; now: string } {
  const now = new Date();
  return {
    cutoff: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    now: now.toISOString(),
  };
}

async function resolveMemberResponseTeam(
  supabase: SupabaseClient,
  context: DailyContext,
  reportTeams: DailyTeamRow[],
  requestedTeamId?: string,
): Promise<{ responseTeamOptions: DailyTeamRow[]; selectedResponseTeam?: DailyResponseTeam; error?: string }> {
  const scopeResult = isAdmin(context.role)
    ? await supabase
        .from("teams")
        .select("id, name")
        .eq("tenant_id", context.tenantId)
        .is("archived_at", null)
        .order("name")
    : await supabase
        .from("team_memberships")
        .select("team_id")
        .eq("tenant_id", context.tenantId)
        .eq("user_id", context.userId);

  if (scopeResult.error) return { responseTeamOptions: [], error: "No se pudieron cargar tus equipos Daily." };

  const responseTeamIds = isAdmin(context.role)
    ? (scopeResult.data as Array<{ id: string }> ?? []).map((team) => String(team.id))
    : Array.from(new Set((scopeResult.data as Array<{ team_id: string }> ?? []).map((membership) => String(membership.team_id))));
  const responseTeamOptions = reportTeams.filter((team) => responseTeamIds.includes(team.id));
  const selectedTeamId = requestedTeamId && responseTeamOptions.some((team) => team.id === requestedTeamId)
    ? requestedTeamId
    : responseTeamOptions.length === 1
      ? responseTeamOptions[0].id
      : undefined;

  if (!selectedTeamId) return { responseTeamOptions };

  const { data: schedule, error: scheduleError } = await supabase
    .from("team_daily_schedules")
    .select("timezone_name")
    .eq("tenant_id", context.tenantId)
    .eq("team_id", selectedTeamId)
    .eq("is_active", true)
    .maybeSingle();
  if (scheduleError) return { responseTeamOptions, error: "No se pudo cargar el horario Daily del equipo." };
  if (!schedule || typeof schedule.timezone_name !== "string") return { responseTeamOptions };

  const parts = localDateParts(new Date(), schedule.timezone_name);
  if (!parts.year || !parts.month || !parts.day) {
    return { responseTeamOptions, error: "No se pudo resolver la fecha local del equipo Daily." };
  }

  const team = responseTeamOptions.find((option) => option.id === selectedTeamId);
  return {
    responseTeamOptions,
    selectedResponseTeam: team
      ? { ...team, localDate: `${parts.year}-${parts.month}-${parts.day}` }
      : undefined,
  };
}

export async function getDailyAdminWorkspace(): Promise<{
  data?: DailyAdminData;
  error?: string;
}> {
  const supabase = await createClient();
  const { context, error: contextError } = await resolveAdminContext(supabase);
  if (!context) return { error: contextError ?? "Se requiere acceso de administrador activo." };
  const [teamsResult, reportTeamsResult, questionsResult, schedulesResult, selectionsResult, runsResult, peopleResult, pendingRunsSourceResult, submissionLinksResult] =
    await Promise.all([
      supabase.from("teams").select("id, name").eq("tenant_id", context.tenantId).is("archived_at", null).order("name"),
      supabase.from("teams").select("id, name").eq("tenant_id", context.tenantId).order("name"),
      supabase.from("daily_questions").select("id, question_text, semantic_key, is_active, created_at, deactivated_at").eq("tenant_id", context.tenantId).order("is_active", { ascending: false }).order("created_at", { ascending: false }),
      supabase.from("team_daily_schedules").select("id, team_id, timezone_name, local_time, scheduled_weekdays, response_window, is_active").eq("tenant_id", context.tenantId),
      supabase.from("team_daily_questions").select("team_id, question_id, position").eq("tenant_id", context.tenantId).order("position"),
      supabase.from("daily_runs").select("id, team_id, schedule_id, scheduled_for, due_at, local_date, timezone_snapshot").eq("tenant_id", context.tenantId).order("scheduled_for", { ascending: false }).limit(20),
      supabase.from("profiles").select("id, full_name").eq("tenant_id", context.tenantId).eq("status", "active").in("role", ["support_agent", "admin", "superadmin"]),
      supabase.from("daily_runs").select("id, team_id, schedule_id, scheduled_for, due_at, local_date, timezone_snapshot").eq("tenant_id", context.tenantId).order("scheduled_for", { ascending: true }),
      supabase.from("daily_submission_runs").select("submission_id, run_id").eq("tenant_id", context.tenantId).eq("user_id", context.userId),
    ]);

  if ([teamsResult.error, reportTeamsResult.error, questionsResult.error, schedulesResult.error, selectionsResult.error, runsResult.error, peopleResult.error, pendingRunsSourceResult.error, submissionLinksResult.error].some(Boolean)) {
    return { error: "No se pudo cargar la información Daily. Actualizá la página e intentá nuevamente." };
  }

  const responderIds = (peopleResult.data ?? []).map((person) => String(person.id));
  const window = dailyReportWindow();
  const submissionsResult = responderIds.length
    ? await supabase
        .from("daily_submissions")
        .select("id, user_id, submitted_at")
        .eq("tenant_id", context.tenantId)
        .in("user_id", responderIds)
        .gte("submitted_at", window.cutoff)
        .lte("submitted_at", window.now)
        .order("submitted_at", { ascending: false })
    : { data: [], error: null };
  if (submissionsResult.error) {
    return { error: "No se pudieron cargar las respuestas recientes de Daily. Actualizá la página e intentá nuevamente." };
  }

  const submissions = (submissionsResult.data ?? []) as DailySubmissionRow[];
  const submissionIds = submissions.map((submission) => submission.id);
  const [submissionRunsResult, answersResult] = submissionIds.length
    ? await Promise.all([
        supabase.from("daily_submission_runs").select("submission_id, run_id, team_id").eq("tenant_id", context.tenantId).in("submission_id", submissionIds),
        supabase.from("daily_submission_answers").select("submission_id, question_text, answer_text").eq("tenant_id", context.tenantId).in("submission_id", submissionIds),
      ])
    : [{ data: [], error: null }, { data: [], error: null }];
  if (submissionRunsResult.error || answersResult.error) {
    return { error: "No se pudo cargar el resumen de envíos Daily. Actualizá la página e intentá nuevamente." };
  }

  const submittedRunIds = new Set((submissionLinksResult.data ?? []).map((row) => String(row.run_id)));
  const allRuns = (pendingRunsSourceResult.data ?? []) as DailyRunRow[];
  const localDateByRunId = new Map(allRuns.map((run) => [run.id, run.local_date]));
  const pendingRuns = allRuns.filter((run) => !submittedRunIds.has(run.id));
  const pendingRunIds = pendingRuns.map((run) => run.id);
  const pendingRunQuestionsResult = pendingRunIds.length
    ? await supabase
        .from("daily_run_questions")
        .select("run_id, question_id, question_text, semantic_key, position")
        .eq("tenant_id", context.tenantId)
        .in("run_id", pendingRunIds)
        .order("position")
    : { data: [], error: null };
  if (pendingRunQuestionsResult.error) {
    return { error: "No se pudieron cargar las preguntas pendientes de Daily. Actualizá la página e intentá nuevamente." };
  }
  const runQuestions = (pendingRunQuestionsResult.data ?? []) as DailyRunQuestionRow[];

  const people = (peopleResult.data ?? []) as Array<{
    id: string;
    full_name: string;
  }>;
  return {
    data: {
      teams: (teamsResult.data ?? []) as DailyTeamRow[],
      questions: (questionsResult.data ?? []) as DailyQuestionRow[],
      schedules: (schedulesResult.data ?? []) as DailyScheduleRow[],
      selections: (selectionsResult.data ?? []) as DailySelectionRow[],
      runs: (runsResult.data ?? []) as DailyRunRow[],
      reportTeams: (reportTeamsResult.data ?? []) as DailyTeamRow[],
      submissions,
      submissionRuns: (submissionRunsResult.data ?? []).map((row) => ({
        ...(row as { submission_id: string; run_id: string; team_id: string }),
        local_date: localDateByRunId.get(String(row.run_id)) ?? "",
      })),
      submissionAnswers: (answersResult.data ?? []) as DailySubmissionAnswerRow[],
      people,
      currentUserId: context.userId,
      pendingRuns,
      runQuestions,
    },
  };
}

export async function getDailyMemberWorkspace(requestedTeamId?: string): Promise<{
  data?: DailyMemberData;
  error?: string;
}> {
  const supabase = await createClient();
  const { context, error: contextError } = await resolveInternalContext(supabase);
  if (!context) return { error: contextError ?? "Se requiere una cuenta interna activa." };

  const window = dailyReportWindow();
  const [runsResult, submissionLinksResult, historyResult, reportTeamsResult, submissionsResult] = await Promise.all([
    supabase.from("daily_runs").select("id, team_id, schedule_id, scheduled_for, due_at, local_date, timezone_snapshot").eq("tenant_id", context.tenantId).order("scheduled_for", { ascending: true }),
    supabase.from("daily_submission_runs").select("submission_id, run_id").eq("tenant_id", context.tenantId).eq("user_id", context.userId),
    supabase.from("daily_submissions").select("id, user_id, submitted_at").eq("tenant_id", context.tenantId).eq("user_id", context.userId).order("submitted_at", { ascending: false }).limit(10),
    supabase.from("teams").select("id, name").eq("tenant_id", context.tenantId).order("name"),
    supabase.from("daily_submissions").select("id, user_id, submitted_at").eq("tenant_id", context.tenantId).gte("submitted_at", window.cutoff).lte("submitted_at", window.now).order("submitted_at", { ascending: false }),
  ]);
  if (runsResult.error || submissionLinksResult.error || historyResult.error || reportTeamsResult.error || submissionsResult.error) {
    return { error: "No se pudieron cargar tus Daily pendientes. Actualizá la página e intentá nuevamente." };
  }

  const submittedRunIds = new Set((submissionLinksResult.data ?? []).map((row) => String(row.run_id)));
  const allRuns = (runsResult.data ?? []) as DailyRunRow[];
  const localDateByRunId = new Map(allRuns.map((run) => [run.id, run.local_date]));
  const pendingRuns = allRuns.filter((run) => !submittedRunIds.has(run.id));
  const pendingRunIds = pendingRuns.map((run) => run.id);
  const history = (historyResult.data ?? []) as DailySubmissionRow[];
  const historyIds = history.map((submission) => submission.id);
  const submissions = (submissionsResult.data ?? []) as DailySubmissionRow[];
  const submissionIds = submissions.map((submission) => submission.id);
  const submissionUserIds = Array.from(new Set(submissions.map((submission) => submission.user_id)));
  const [questionsResult, historyLinksResult, submissionRunsResult, answersResult, peopleResult] = await Promise.all([
    pendingRunIds.length
      ? supabase.from("daily_run_questions").select("run_id, question_id, question_text, semantic_key, position").eq("tenant_id", context.tenantId).in("run_id", pendingRunIds).order("position")
      : Promise.resolve({ data: [], error: null }),
    historyIds.length
      ? supabase.from("daily_submission_runs").select("submission_id").eq("tenant_id", context.tenantId).eq("user_id", context.userId).in("submission_id", historyIds)
      : Promise.resolve({ data: [], error: null }),
    submissionIds.length
      ? supabase.from("daily_submission_runs").select("submission_id, run_id, team_id").eq("tenant_id", context.tenantId).in("submission_id", submissionIds)
      : Promise.resolve({ data: [], error: null }),
    submissionIds.length
      ? supabase.from("daily_submission_answers").select("submission_id, question_text, answer_text").eq("tenant_id", context.tenantId).in("submission_id", submissionIds)
      : Promise.resolve({ data: [], error: null }),
    submissionUserIds.length
      ? supabase.from("profiles").select("id, full_name").eq("tenant_id", context.tenantId).in("id", submissionUserIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (questionsResult.error || historyLinksResult.error || submissionRunsResult.error || answersResult.error || peopleResult.error) {
    return { error: "No se pudieron cargar las preguntas Daily. Actualizá la página e intentá nuevamente." };
  }

  const responseTeamContext = await resolveMemberResponseTeam(
    supabase,
    context,
    (reportTeamsResult.data ?? []) as DailyTeamRow[],
    requestedTeamId,
  );
  if (responseTeamContext.error) return { error: responseTeamContext.error };
  return {
    data: {
      pendingRuns,
      runQuestions: (questionsResult.data ?? []) as DailyRunQuestionRow[],
      history,
      historyRunCounts: countById((historyLinksResult.data ?? []) as Array<{ submission_id: string }>),
      reportTeams: (reportTeamsResult.data ?? []) as DailyTeamRow[],
      submissions,
      submissionRuns: (submissionRunsResult.data ?? []).map((row) => ({
        ...(row as { submission_id: string; run_id: string; team_id: string }),
        local_date: localDateByRunId.get(String(row.run_id)) ?? "",
      })),
      submissionAnswers: (answersResult.data ?? []) as DailySubmissionAnswerRow[],
      people: (peopleResult.data ?? []) as Array<{ id: string; full_name: string }>,
      currentUserId: context.userId,
      responseTeamOptions: responseTeamContext.responseTeamOptions,
      selectedResponseTeam: responseTeamContext.selectedResponseTeam,
    },
  };
}
