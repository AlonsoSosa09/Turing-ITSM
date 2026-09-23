import { z } from "zod";

export const FULL_NAME_MAX_LENGTH = 160;

export function normalizeFullName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export const fullNameSchema = z
  .string()
  .transform(normalizeFullName)
  .pipe(z.string().min(1).max(FULL_NAME_MAX_LENGTH));

export const ticketPrioritySchema = z.enum(["low", "moderate", "high", "urgent"]);

export const ticketAttachmentInputSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(255).optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
});

export const createTicketSchema = z.object({
  submitterName: z.string().trim().min(1).max(160),
  companyName: z.string().trim().min(1).max(160),
  department: z.string().trim().min(1).max(120),
  subject: z.string().trim().min(3).max(180),
  priority: ticketPrioritySchema,
  description: z.string().trim().min(10).max(8000),
  attachments: z.array(ticketAttachmentInputSchema).max(10).optional(),
});

export type CreateTicketInput = z.infer<typeof createTicketSchema>;
export type TicketPriorityInput = z.infer<typeof ticketPrioritySchema>;
export type TicketAttachmentInput = z.infer<typeof ticketAttachmentInputSchema>;

// Workers daily tasks ---------------------------------------------------------
export const taskStatusSchema = z.enum(["todo", "doing", "done", "blocked"]);
export const taskPrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

export const dailyCheckinSchema = z.object({
  q1Yesterday: z.string().trim().min(1).max(1000),
  q2Today: z.string().trim().min(1).max(1000),
  q3Blockers: z.string().trim().max(1000).optional().nullable(),
});

export const updateDailyCheckinSchema = dailyCheckinSchema.partial().extend({
  id: z.string().uuid().optional(),
});

// Daily runs ------------------------------------------------------------------
const dailyEntityIdSchema = z.string().trim().toLowerCase().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const dailyLocalTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/);
const dailyWeekdaySchema = z.coerce.number().int().min(1).max(7);

export const createDailyQuestionSchema = z.object({
  questionText: z.string().trim().min(3).max(500),
});

export const deactivateDailyQuestionSchema = z.object({
  questionId: dailyEntityIdSchema,
  confirmation: z.literal("true"),
});

export const teamDailyScheduleSchema = z.object({
  teamId: dailyEntityIdSchema,
  timezoneName: z.string().trim().min(1).max(100),
  localTime: dailyLocalTimeSchema,
  weekdays: z
    .array(dailyWeekdaySchema)
    .min(1)
    .max(7)
    .refine((values) => new Set(values).size === values.length),
  responseWindowMinutes: z.coerce.number().int().min(1).max(10080),
  isActive: z.boolean(),
});

export const teamDailyQuestionsSchema = z.object({
  teamId: dailyEntityIdSchema,
  questionIds: z
    .array(dailyEntityIdSchema)
    .max(3)
    .refine((values) => new Set(values).size === values.length),
});

export const generateDailyRunSchema = z.object({
  teamId: dailyEntityIdSchema,
  localDate: z.string().date(),
});

export const submitDailyResponseSchema = z.object({
  runIds: z.array(dailyEntityIdSchema).min(1).max(100).refine((values) => new Set(values).size === values.length),
  localDate: z.string().date(),
  plannedActivityTitles: z
    .array(z.string().trim().min(1).max(400))
    .min(1)
    .max(100),
  carriedActivityIds: z
    .array(dailyEntityIdSchema)
    .max(100)
    .refine((values) => new Set(values).size === values.length),
  answers: z
    .array(
      z.object({
        questionId: dailyEntityIdSchema,
        answer: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(300)
  .refine((values) => new Set(values.map((value) => value.questionId)).size === values.length),
});

export const dailyActivityCompletionSchema = z.object({
  teamId: dailyEntityIdSchema,
  logicalDate: z.string().date(),
  completedActivityIds: z
    .array(dailyEntityIdSchema)
    .max(100)
    .refine((values) => new Set(values).size === values.length),
});

export const createProjectSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().max(1000).optional().nullable(),
});

const organizationIdSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const organizationDescriptionSchema = z
  .string()
  .trim()
  .max(1000)
  .transform((value) => value || null);

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(100),
  description: organizationDescriptionSchema,
});

export const updateTeamSchema = createTeamSchema.extend({
  teamId: organizationIdSchema,
});

export const teamIdSchema = z.object({
  teamId: organizationIdSchema,
});

export const createOrganizationProjectSchema = createTeamSchema.extend({
  teamId: organizationIdSchema,
});

export const updateOrganizationProjectSchema = createTeamSchema.extend({
  projectId: organizationIdSchema,
});

export const projectIdSchema = z.object({
  projectId: organizationIdSchema,
});

export const teamMembershipSchema = z.object({
  teamId: organizationIdSchema,
  userId: organizationIdSchema,
});

export const projectMembershipSchema = z.object({
  projectId: organizationIdSchema,
  userId: organizationIdSchema,
});

export const staffAccessSchema = z.object({
  userId: organizationIdSchema,
  teamId: organizationIdSchema,
  projectId: organizationIdSchema,
});

const optionalOrganizationIdSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  organizationIdSchema.optional(),
);

export const createInternalMemberSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
  role: z.enum(["admin", "support_agent", "superadmin"]),
  teamId: optionalOrganizationIdSchema,
  projectId: optionalOrganizationIdSchema,
});

const optionalPasswordSchema = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(8).max(128).optional(),
);

const optionalFullNameSchema = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  fullNameSchema.optional(),
);

export const updateInternalMemberSchema = z.object({
  userId: organizationIdSchema,
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  fullName: optionalFullNameSchema,
  password: optionalPasswordSchema,
  role: z.enum(["admin", "support_agent", "superadmin"]),
});

export const internalMemberIdSchema = z.object({
  userId: organizationIdSchema,
});

export const deactivateInternalMemberSchema = internalMemberIdSchema.extend({
  confirmation: z.literal("true"),
});

export const deleteInternalMemberSchema = internalMemberIdSchema.extend({
  confirmation: z.literal("true"),
});

export const removeProjectMembershipSchema = projectMembershipSchema.extend({
  cascadeAcknowledged: z.literal("true"),
});

export const updateProjectSchema = createProjectSchema.partial().extend({
  id: z.string().uuid(),
});

export const createTaskSchema = z.object({
  projectId: z.string().uuid(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  status: taskStatusSchema.optional().default("todo"),
  priority: taskPrioritySchema.optional().default("medium"),
  assigneeId: z.string().uuid().optional().nullable(),
});

export const updateTaskStatusSchema = z.object({
  taskId: z.string().uuid(),
  status: taskStatusSchema,
});

export const updateTaskSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.string().uuid().optional().nullable(),
});

export const listDailyCheckinsSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  userId: z.string().uuid().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});

export const createBoardTaskSchema = z.object({
  projectId: organizationIdSchema,
  columnId: organizationIdSchema,
  isCurrentSprint: z.boolean(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(8000),
  estimateQuantity: z
    .string()
    .trim()
    .regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/)
    .transform(Number)
    .pipe(z.number().positive().max(99_999_999.99)),
  estimateUnit: z.enum(["hours", "days"]),
  priority: taskPrioritySchema.default("medium"),
  assigneeIds: z.array(organizationIdSchema).max(100).default([]),
});

export const updateBoardTaskSchema = createBoardTaskSchema.omit({
  projectId: true,
  isCurrentSprint: true,
}).extend({
  taskId: organizationIdSchema,
});

export const setTaskCurrentSprintSchema = z.object({
  taskId: organizationIdSchema,
  isCurrentSprint: z.boolean(),
});

export const moveTaskSchema = z.object({
  taskId: organizationIdSchema,
  targetColumnId: organizationIdSchema,
  targetIndex: z.number().int().min(0).max(10000),
});

export const taskIdInputSchema = z.object({ taskId: organizationIdSchema });

export const createWorkflowColumnSchema = z.object({
  projectId: organizationIdSchema,
  name: z.string().trim().min(1).max(80),
});

export const renameWorkflowColumnSchema = z.object({
  columnId: organizationIdSchema,
  name: z.string().trim().min(1).max(80),
});

export const reorderWorkflowColumnSchema = z.object({
  columnId: organizationIdSchema,
  direction: z.enum(["left", "right"]),
});

export const workflowColumnIdSchema = z.object({ columnId: organizationIdSchema });

export const createTaskCommentSchema = z.object({
  taskId: organizationIdSchema,
  body: z.string().trim().min(1).max(8000),
});

export const taskAttachmentMetadataSchema = z.object({
  taskId: organizationIdSchema,
  fileName: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().max(255),
  sizeBytes: z.number().int().min(1).max(10485760),
});

export const taskAttachmentIdSchema = z.object({
  attachmentId: organizationIdSchema,
});

export const listTasksSchema = z.object({
  projectId: z.string().uuid().optional(),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  assigneeId: z.string().uuid().optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});

export const listBoardTasksSchema = z.object({
  projectId: organizationIdSchema,
  columnId: organizationIdSchema.optional(),
  priority: taskPrioritySchema.optional(),
  page: z.number().int().min(1).optional().default(1),
  pageSize: z.number().int().min(1).max(100).optional().default(20),
});

export type DailyCheckinInput = z.infer<typeof dailyCheckinSchema>;
export type CreateDailyQuestionInput = z.infer<typeof createDailyQuestionSchema>;
export type TeamDailyScheduleInput = z.infer<typeof teamDailyScheduleSchema>;
export type TeamDailyQuestionsInput = z.infer<typeof teamDailyQuestionsSchema>;
export type GenerateDailyRunInput = z.infer<typeof generateDailyRunSchema>;
export type SubmitDailyResponseInput = z.infer<typeof submitDailyResponseSchema>;
export type DailyActivityCompletionInput = z.infer<typeof dailyActivityCompletionSchema>;
export type CreateProjectInput = z.infer<typeof createProjectSchema>;
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
export type UpdateTaskStatusInput = z.infer<typeof updateTaskStatusSchema>;
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

// KPI Dashboard ----------------------------------------------------------------

export const getKpiDashboardSchema = z.object({
  boardId: z.number().int().positive().optional().nullable(),
  sprintId: z.number().int().positive().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  velocitySprintCount: z.number().int().min(1).max(50).optional().default(6),
  burndownSprintId: z.number().int().positive().optional().nullable(),
  granularity: z.enum(["D", "W", "M"]).optional().default("W"),
  currency: z.enum(["USD", "MXN"]).optional().default("USD"),
  fromDate: z.string().date().optional().nullable(),
  toDate: z.string().date().optional().nullable(),
  annotationsTeamId: z.string().uuid().optional().nullable(),
  annotationsSprintId: z.number().int().positive().optional().nullable(),
});

export type GetKpiDashboard = z.infer<typeof getKpiDashboardSchema>;

export const getDashboardAggregateSchema = z.object({
  teamId: z.string().uuid().optional().nullable(),
  projectId: z.string().uuid().optional().nullable(),
  selectedDate: z.string().date().optional(),
  range: z.enum(["7d", "30d", "90d"]).optional().default("30d"),
  compactCardsPageSize: z.number().int().min(1).max(10).optional().default(5),
});

export type GetDashboardAggregateInput = z.infer<typeof getDashboardAggregateSchema>;

// Jira Integration ------------------------------------------------------------

const jiraDomainSchema = z.string().trim().min(4).max(253).transform((v) => v.trim());
const jiraEmailSchema = z.string().trim().email().max(254);
const jiraApiTokenSchema = z.string().trim().min(8).max(512);
const storyPointsFieldSchema = z.string().trim().min(1).max(80).default("customfield_10016");

export const createJiraIntegrationSchema = z.object({
  jiraDomain: jiraDomainSchema,
  jiraEmail: jiraEmailSchema,
  jiraApiToken: jiraApiTokenSchema,
  defaultBoardId: z.number().int().positive().optional().nullable(),
  storyPointsField: storyPointsFieldSchema,
});

export const updateJiraIntegrationSchema = z.object({
  jiraDomain: jiraDomainSchema.optional(),
  jiraEmail: jiraEmailSchema.optional(),
  jiraApiToken: jiraApiTokenSchema.optional(),
  defaultBoardId: z.number().int().positive().optional().nullable(),
  storyPointsField: storyPointsFieldSchema.optional(),
});

export type CreateJiraIntegration = z.infer<typeof createJiraIntegrationSchema>;
export type UpdateJiraIntegration = z.infer<typeof updateJiraIntegrationSchema>;

export const triggerJiraSyncSchema = z.object({
  integrationId: z.string().uuid(),
  mode: z.enum(["full", "incremental"]).default("full"),
  boardIds: z.array(z.number().int().positive()).optional().nullable(),
});

export type TriggerJiraSync = z.infer<typeof triggerJiraSyncSchema>;

// KPI Dashboard Types (matching TuringITSM v4 RPC signatures)

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
  bucket: string;
  service_name: string;
  provider_name: string | null;
  cost_usd: number;
  cost_mxn: number;
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

export type KpiActionState = {
  status: "idle" | "success" | "error";
  message: string;
};
