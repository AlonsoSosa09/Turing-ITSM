"use server";

import {
  createJiraIntegrationSchema,
  getKpiDashboardSchema,
  triggerJiraSyncSchema,
  type GetKpiDashboard,
} from "@turing-itsm/validation";
import { revalidatePath } from "next/cache";
import {
  isAdmin,
  isInternalRole,
  type InternalRole,
} from "@/lib/rbac";
import { createClient } from "@/utils/supabase/server";

type SupabaseClient = Awaited<ReturnType<typeof createClient>>;

type KpiContext = {
  tenantId: string;
  userId: string;
  role: InternalRole;
};

export type KpiActionState = {
  status: "idle" | "success" | "error";
  message: string;
};

export type SprintBurndownPoint = {
  as_of_date: string;
  scope: number;
  completed: number;
  remaining: number;
  ideal: number | null;
};

export type AssignedSpByMemberRow = {
  assignee_email: string;
  assignee_display_name: string;
  assigned_sp: number;
  completed_sp: number;
  pct_of_total_sp: number;
};

export type SpCompletedOverTimeRow = {
  bucket: string;
  completed_sp: number;
  completed_issues: number;
};

export type CloudCostPivotRow = {
  bucket_start: string;
  service_name: string;
  provider_name: string | null;
  cost: number;
  total_per_bucket: number;
};

export type DailyAnnotationForSprintRow = {
  team_name: string;
  user_id: string;
  full_name: string | null;
  local_date: string;
  submission_id: string | null;
  answers: Array<{
    question_text: string;
    answer_text: string | null;
  }> | null;
};

export type VelocitySummaryRow = {
  sprints_count: number;
  avg_sp_completed: number;
  total_sp_completed: number;
  latest_sprint_id: number | null;
  latest_sprint_name: string | null;
};

export type KpiDashboardData = {
  velocity: VelocitySummaryRow | null;
  activeBurndown: SprintBurndownPoint[];
  assignmentGrid: AssignedSpByMemberRow[];
  spCompletedOverTime: SpCompletedOverTimeRow[];
  dailyAnnotations: DailyAnnotationForSprintRow[];
  integrations: Array<{
    id: string;
    jira_domain: string;
    default_board_id: number | null;
    last_synced_at: string | null;
    sync_status: string | null;
  }>;
  tenantId: string;
};

const success = (message: string): KpiActionState => ({ status: "success", message });
const failure = (message: string): KpiActionState => ({ status: "error", message });

async function resolveKpiContext(
  supabase: SupabaseClient,
): Promise<{ context: KpiContext | null; error: string | null }> {
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
    return { context: null, error: "No tenés permiso para acceder al tablero KPI." };
  }

  return {
    context: { tenantId: profile.tenant_id, userId: auth.user.id, role: profile.role },
    error: null,
  };
}

export async function getKpiDashboard(
  _params?: Partial<GetKpiDashboard>,
): Promise<{ data?: KpiDashboardData; error?: string }> {
  const params = getKpiDashboardSchema.safeParse(_params ?? {});
  if (!params.success) {
    return { error: "Parámetros inválidos para KPI Dashboard." };
  }

  const supabase = await createClient();
  const { context, error: contextError } = await resolveKpiContext(supabase);
  if (!context) return { error: contextError ?? "Sesión no válida." };

  const {
    boardId,
    sprintId,
    projectId,
    velocitySprintCount = 6,
    burndownSprintId,
    granularity = "W",
    fromDate,
    toDate,
    annotationsTeamId,
    annotationsSprintId,
  } = params.data;

  // The latest SQL migrations keep project filtering as the final optional argument.
  const [velocitySource, assignmentSource, spCompletedSource, annotationsSource, integrationsSource] =
    await Promise.all([
      supabase.rpc("kpi_velocity_summary", {
        p_tenant_id: context.tenantId,
        p_board_id: boardId ?? null,
        p_last_n_sprints: velocitySprintCount,
        p_done_statuses: ["Done"],
        p_project_id: projectId ?? null,
      }),
      supabase.rpc("kpi_assigned_sp_by_member", {
        p_tenant_id: context.tenantId,
        p_sprint_id: sprintId ?? null,
        p_project_id: projectId ?? null,
      }),
      supabase.rpc("kpi_sp_completed_over_time", {
        p_tenant_id: context.tenantId,
        p_granularity: granularity,
        p_from_date: fromDate ?? null,
        p_to_date: toDate ?? null,
        p_project_id: projectId ?? null,
      }),
      supabase.rpc("kpi_daily_annotations_for_sprint", {
        p_tenant_id: context.tenantId,
        p_team_id: annotationsTeamId ?? null,
        p_sprint_id: annotationsSprintId ?? null,
        p_project_id: projectId ?? null,
      }),
      supabase
        .from("jira_integrations")
        .select("id, jira_domain, default_board_id, last_synced_at, sync_status")
        .eq("tenant_id", context.tenantId),
    ]);

  if (
    velocitySource.error ||
    assignmentSource.error ||
    spCompletedSource.error ||
    annotationsSource.error ||
    integrationsSource.error
  ) {
    return {
      error: "No se pudo cargar el tablero KPI. Revisá que existan las SQL functions v4 y los permisos.",
    };
  }

  const velocityRows = (velocitySource.data ?? []) as Array<Record<string, unknown>>;
  const velocity: VelocitySummaryRow | null = velocityRows[0]
    ? ({
        sprints_count: Number(velocityRows[0].sprints_count ?? 0),
        avg_sp_completed: Number(velocityRows[0].avg_sp_completed ?? 0),
        total_sp_completed: Number(velocityRows[0].total_sp_completed ?? 0),
        latest_sprint_id:
          velocityRows[0].latest_sprint_id == null
            ? null
            : Number(velocityRows[0].latest_sprint_id),
        latest_sprint_name:
          velocityRows[0].latest_sprint_name == null
            ? null
            : String(velocityRows[0].latest_sprint_name),
      } as VelocitySummaryRow)
    : null;

  const activeSprintId = Number(
    burndownSprintId ?? sprintId ?? velocity?.latest_sprint_id ?? 0,
  );
  const burndownSource = activeSprintId
    ? await supabase.rpc("kpi_sprint_burndown", {
        p_tenant_id: context.tenantId,
        p_sprint_id: activeSprintId,
        p_project_id: projectId ?? null,
      })
    : { data: [], error: null };

  if (burndownSource.error) {
    return { error: "No se pudo cargar el burndown del sprint activo." };
  }

  const activeBurndown = (burndownSource.data ?? []).map(
    (row: Record<string, unknown>) =>
      ({
        as_of_date: String(row.as_of_date),
        scope: Number(row.scope ?? 0),
        completed: Number(row.completed ?? 0),
        remaining: Number(row.remaining ?? 0),
        ideal:
          row.ideal == null
            ? null
            : Number(row.ideal),
      }) as SprintBurndownPoint,
  );

  return {
    data: {
      velocity,
      activeBurndown,
      assignmentGrid: (assignmentSource.data ?? []) as AssignedSpByMemberRow[],
      spCompletedOverTime: (spCompletedSource.data ?? []) as SpCompletedOverTimeRow[],
      dailyAnnotations: (annotationsSource.data ?? []) as DailyAnnotationForSprintRow[],
      integrations: (integrationsSource.data ?? []).map((row) => ({
        id: String(row.id),
        jira_domain: String(row.jira_domain),
        default_board_id:
          row.default_board_id == null ? null : Number(row.default_board_id),
        last_synced_at:
          typeof row.last_synced_at === "string" ? row.last_synced_at : null,
        sync_status:
          typeof row.sync_status === "string" ? row.sync_status : null,
      })),
      tenantId: context.tenantId,
    },
  };
}

export async function saveJiraIntegration(
  _previousState: KpiActionState,
  formData: FormData,
): Promise<KpiActionState> {
  const payload = createJiraIntegrationSchema.safeParse({
    jiraDomain: formData.get("jiraDomain"),
    jiraEmail: formData.get("jiraEmail"),
    jiraApiToken: formData.get("jiraApiToken"),
    defaultBoardId: formData.get("defaultBoardId"),
    storyPointsField: formData.get("storyPointsField"),
  });
  if (!payload.success) {
    return failure("Completá dominio, email y token válidos de Jira.");
  }

  const supabase = await createClient();
  const { context, error: contextError } = await resolveKpiContext(supabase);
  if (!context) return failure(contextError ?? "Acceso denegado.");
  if (!isAdmin(context.role)) {
    return failure("Solo administradores pueden registrar integraciones de Jira.");
  }

  // Encrypt credentials using database RPCs
  const emailEncrypted = await supabase.rpc("encrypt_jira_credential", {
    p_plaintext: payload.data.jiraEmail,
  });
  const tokenEncrypted = await supabase.rpc("encrypt_jira_credential", {
    p_plaintext: payload.data.jiraApiToken,
  });

  const { error } = await supabase.from("jira_integrations").insert({
    tenant_id: context.tenantId,
    jira_domain: payload.data.jiraDomain,
    jira_email_encrypted: emailEncrypted.data,
    jira_api_token_encrypted: tokenEncrypted.data,
    default_board_id: payload.data.defaultBoardId ?? null,
    story_points_field: payload.data.storyPointsField ?? "customfield_10016",
    created_by: context.userId,
  });

  if (error) {
    return failure(
      error.code === "23505"
        ? "Ya existe una integración para ese tenant y dominio."
        : "No se pudo guardar la integración de Jira.",
    );
  }

  revalidatePath("/workspace/kpi");
  return success("Integración de Jira registrada con credenciales encriptadas.");
}

export async function triggerJiraSync(
  _previousState: KpiActionState,
  formData: FormData,
): Promise<KpiActionState> {
  const parsed = triggerJiraSyncSchema.safeParse({
    integrationId: formData.get("integrationId"),
    mode: formData.get("mode") ?? "full",
  });
  if (!parsed.success) return failure("Seleccioná una integración y un modo válido.");

  const supabase = await createClient();
  const { context, error: contextError } = await resolveKpiContext(supabase);
  if (!context) return failure(contextError ?? "Acceso denegado.");

  // Use the new internal Jira sync RPC or API endpoint
  // For now, call the internal API endpoint
  const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "http://localhost:8000";
  const endpoint = parsed.data.mode === "incremental" ? "/jira/integrations/{id}/sync" : "/jira/integrations/{id}/sync";

  try {
    const response = await fetch(`${apiBase}${endpoint.replace("{id}", parsed.data.integrationId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: parsed.data.mode,
        board_ids: [],
      }),
    });
    if (!response.ok) {
      return failure(`API Jira respondió ${response.status}. Revisá el API.`);
    }
  } catch {
    return failure(
      "No se pudo contactar el API de Jira. Asegurate de que el backend esté corriendo.",
    );
  }

  revalidatePath("/workspace/kpi");
  return success(`Sync ${parsed.data.mode} disparado. La información se actualizará en unos segundos.`);
}
