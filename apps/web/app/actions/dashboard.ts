"use server";

import {
  getDashboardAggregateSchema,
  type GetDashboardAggregateInput,
} from "@turing-itsm/validation";
import { getKpiDashboard } from "@/app/actions/kpi";
import { listMyCards } from "@/app/actions/tasks";
import { isAdmin, isInternalRole, type InternalRole } from "@/lib/rbac";
import { createClient } from "@/utils/supabase/server";
import { z } from "zod";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type DashboardContext = {
  tenantId: string;
  userId: string;
  role: InternalRole;
};

export type DashboardTeamRow = { id: string; name: string };

export type DashboardProjectRow = {
  id: string;
  team_id: string;
  name: string;
};

export type DashboardHierarchy = {
  teams: DashboardTeamRow[];
  projects: Array<DashboardProjectRow & { team_name: string }>;
  defaultTeamId?: string;
};

export type DailyAnswerForDateRow = {
  user_id: string;
  full_name: string | null;
  question_text: string;
  answer_text: string;
};

export type DashboardAggregateData = {
  hierarchy: DashboardHierarchy;
  kpi: Awaited<ReturnType<typeof getKpiDashboard>>["data"] | null;
  kpiError?: string;
  dailyAnswers: DailyAnswerForDateRow[];
  myCards: Awaited<ReturnType<typeof listMyCards>>["data"] extends infer Data
    ? Data extends { rows: infer Rows }
      ? Rows
      : never
    : never;
  myCardsError?: string;
  meta: {
    selectedDate: string;
    range: "7d" | "30d" | "90d";
    teamId?: string;
    projectId?: string;
    isAdmin: boolean;
  };
};

const uuidSchema = z.string().uuid();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

async function resolveDashboardContext(
  supabase: SupabaseClient,
): Promise<{ context: DashboardContext | null; error: string | null }> {
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
    return { context: null, error: "No tenés permiso para acceder al dashboard." };
  }

  return {
    context: { tenantId: profile.tenant_id, userId: auth.user.id, role: profile.role },
    error: null,
  };
}

async function loadHierarchy(
  supabase: SupabaseClient,
  context: DashboardContext,
): Promise<{ data?: DashboardHierarchy; error?: string }> {
  const projectsPromise = listMyProjects(supabase, context);

  let teamsResult: { data: unknown[] | null; error: { message?: string } | null };
  if (isAdmin(context.role)) {
    teamsResult = await supabase
      .from("teams")
      .select("id, name")
      .eq("tenant_id", context.tenantId)
      .is("archived_at", null)
      .order("name");
  } else {
    const membershipsResult = await supabase
      .from("team_memberships")
      .select("team_id")
      .eq("tenant_id", context.tenantId)
      .eq("user_id", context.userId);
    if (membershipsResult.error) {
      return { error: "No se pudieron cargar tus equipos." };
    }

    const teamIds = Array.from(
      new Set((membershipsResult.data ?? []).map((row) => String(row.team_id))),
    );
    teamsResult = teamIds.length
      ? await supabase
          .from("teams")
          .select("id, name")
          .eq("tenant_id", context.tenantId)
          .is("archived_at", null)
          .in("id", teamIds)
          .order("name")
      : { data: [], error: null };
  }

  const projectsResult = await projectsPromise;
  if (teamsResult.error || projectsResult.error) {
    return { error: "No se pudo cargar la jerarquía de equipos y proyectos." };
  }

  const teams = (teamsResult.data ?? []) as DashboardTeamRow[];
  const teamNames = new Map(teams.map((team) => [team.id, team.name]));
  const projects = (projectsResult.data?.rows ?? []) as DashboardProjectRow[];

  return {
    data: {
      teams,
      projects: projects
        .filter((project) => teamNames.has(project.team_id))
        .map((project) => ({
          ...project,
          team_name: teamNames.get(project.team_id) ?? "Equipo sin nombre",
        })),
      defaultTeamId: teams[0]?.id,
    },
  };
}

async function listMyProjects(
  supabase: SupabaseClient,
  context: DashboardContext,
): Promise<{ data?: { rows: DashboardProjectRow[] }; error?: string }> {
  if (isAdmin(context.role)) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, team_id, name")
      .eq("tenant_id", context.tenantId)
      .is("archived_at", null)
      .order("name");
    return error ? { error: "No se pudieron cargar los proyectos." } : { data: { rows: (data ?? []) as DashboardProjectRow[] } };
  }

  const membershipsResult = await supabase
    .from("project_memberships")
    .select("project_id")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.userId);
  if (membershipsResult.error) return { error: "No se pudieron cargar tus proyectos." };

  const projectIds = Array.from(
    new Set((membershipsResult.data ?? []).map((row) => String(row.project_id))),
  );
  if (projectIds.length === 0) return { data: { rows: [] } };

  const { data, error } = await supabase
    .from("projects")
    .select("id, team_id, name")
    .eq("tenant_id", context.tenantId)
    .is("archived_at", null)
    .in("id", projectIds)
    .order("name");
  return error ? { error: "No se pudieron cargar tus proyectos." } : { data: { rows: (data ?? []) as DashboardProjectRow[] } };
}

export async function getAnswersForDate(input: {
  teamId?: string;
  localDate: string;
}): Promise<{ data?: DailyAnswerForDateRow[]; error?: string }> {
  const parsedDate = z.string().date().safeParse(input.localDate);
  const parsedTeam = input.teamId ? uuidSchema.safeParse(input.teamId) : null;
  if (!parsedDate.success || (parsedTeam && !parsedTeam.success)) {
    return { error: "La fecha o el equipo seleccionado no es válido." };
  }

  const supabase = await createClient();
  const { context, error: contextError } = await resolveDashboardContext(supabase);
  if (!context) return { error: contextError ?? "Sesión no válida." };

  let runsQuery = supabase
    .from("daily_runs")
    .select("id, team_id")
    .eq("tenant_id", context.tenantId)
    .eq("local_date", parsedDate.data);
  if (parsedTeam?.success) runsQuery = runsQuery.eq("team_id", parsedTeam.data);

  const { data: runs, error: runsError } = await runsQuery;
  if (runsError) return { error: "No se pudieron cargar las ejecuciones Daily." };
  const runIds = (runs ?? []).map((run) => String(run.id));
  if (runIds.length === 0) return { data: [] };

  const { data: links, error: linksError } = await supabase
    .from("daily_submission_runs")
    .select("submission_id")
    .eq("tenant_id", context.tenantId)
    .in("run_id", runIds);
  if (linksError) return { error: "No se pudieron cargar las respuestas Daily." };
  const submissionIds = Array.from(new Set((links ?? []).map((link) => String(link.submission_id))));
  if (submissionIds.length === 0) return { data: [] };

  const [submissionsResult, answersResult] = await Promise.all([
    supabase
      .from("daily_submissions")
      .select("id, user_id")
      .eq("tenant_id", context.tenantId)
      .in("id", submissionIds),
    supabase
      .from("daily_submission_answers")
      .select("submission_id, question_text, answer_text")
      .eq("tenant_id", context.tenantId)
      .in("submission_id", submissionIds),
  ]);
  if (submissionsResult.error || answersResult.error) {
    return { error: "No se pudieron leer las respuestas Daily." };
  }

  const submissions = (submissionsResult.data ?? []) as Array<{ id: string; user_id: string }>;
  const userIds = Array.from(new Set(submissions.map((submission) => submission.user_id)));
  const profilesResult = userIds.length
    ? await supabase
        .from("profiles")
        .select("id, full_name")
        .eq("tenant_id", context.tenantId)
        .in("id", userIds)
    : { data: [], error: null };
  if (profilesResult.error) return { error: "No se pudieron cargar los nombres del equipo." };

  const namesByUserId = new Map(
    (profilesResult.data ?? []).map((profile) => [String(profile.id), profile.full_name as string | null]),
  );
  const userBySubmissionId = new Map(
    submissions.map((submission) => [submission.id, submission.user_id]),
  );

  return {
    data: (answersResult.data ?? []).flatMap((answer) => {
      const userId = userBySubmissionId.get(String(answer.submission_id));
      return userId
        ? [{
            user_id: userId,
            full_name: namesByUserId.get(userId) ?? null,
            question_text: String(answer.question_text),
            answer_text: String(answer.answer_text),
          }]
        : [];
    }),
  };
}

export async function getDashboardAggregate(
  input?: Partial<GetDashboardAggregateInput>,
): Promise<{ data?: DashboardAggregateData; error?: string }> {
  const parsed = getDashboardAggregateSchema.safeParse(input ?? {});
  if (!parsed.success) return { error: "Los filtros del dashboard no son válidos." };

  const params = parsed.data;
  const selectedDate = params.selectedDate ?? todayKey();
  const supabase = await createClient();
  const { context, error: contextError } = await resolveDashboardContext(supabase);
  if (!context) return { error: contextError ?? "Sesión no válida." };

  const hierarchyResult = await loadHierarchy(supabase, context);
  if (!hierarchyResult.data) return { error: hierarchyResult.error };

  const [kpiResult, dailyResult, cardsResult] = await Promise.all([
    getKpiDashboard({
      projectId: params.projectId ?? undefined,
      velocitySprintCount: 6,
      granularity: params.range === "7d" ? "D" : "W",
    }),
    getAnswersForDate({ teamId: params.teamId ?? undefined, localDate: selectedDate }),
    listMyCards({ page: 1, pageSize: params.compactCardsPageSize }),
  ]);

  return {
    data: {
      hierarchy: hierarchyResult.data,
      kpi: kpiResult.data ?? null,
      kpiError: kpiResult.error,
      dailyAnswers: dailyResult.data ?? [],
      myCards: cardsResult.data?.rows ?? [],
      myCardsError: cardsResult.error,
      meta: {
        selectedDate,
        range: params.range,
        teamId: params.teamId ?? undefined,
        projectId: params.projectId ?? undefined,
        isAdmin: isAdmin(context.role),
      },
    },
  };
}

export async function getDashboardHierarchyOnly(): Promise<{
  data?: DashboardHierarchy;
  error?: string;
}> {
  const supabase = await createClient();
  const { context, error: contextError } = await resolveDashboardContext(supabase);
  if (!context) return { error: contextError ?? "Sesión no válida." };
  return loadHierarchy(supabase, context);
}
