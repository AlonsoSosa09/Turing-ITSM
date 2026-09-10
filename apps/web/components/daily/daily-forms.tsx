"use client";

import {
  Fragment,
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import {
  createDailyQuestion,
  deactivateDailyQuestion,
  generateDailyRun,
  saveTeamDailyQuestions,
  saveTeamDailySchedule,
  submitDailyActivityCompletion,
  submitDailyResponse,
  type DailyActivityRow,
  type DailyActionState,
  type DailyQuestionRow,
  type DailyRunQuestionRow,
  type DailyRunRow,
  type DailyScheduleRow,
  type DailyTeamRow,
} from "@/app/actions/daily-runs";
import { isDailyCompletedWorkQuestion, isDailyPlannedWorkQuestion } from "@/lib/daily";

const initialState: DailyActionState = { status: "idle", message: "" };

type DailyAction = (
  state: DailyActionState,
  formData: FormData,
) => Promise<DailyActionState>;

const weekdays = [
  { value: 1, label: "L", name: "Lunes" },
  { value: 2, label: "M", name: "Martes" },
  { value: 3, label: "X", name: "Miércoles" },
  { value: 4, label: "J", name: "Jueves" },
  { value: 5, label: "V", name: "Viernes" },
  { value: 6, label: "S", name: "Sábado" },
  { value: 7, label: "D", name: "Domingo" },
];

function MutationForm({
  action,
  children,
  submitLabel,
  pendingLabel,
  className = "daily-form",
  footer,
  onSuccess,
  onSubmit,
}: {
  action: DailyAction;
  children: ReactNode;
  submitLabel: string;
  pendingLabel: string;
  className?: string;
  footer?: ReactNode;
  onSuccess?: () => void;
  onSubmit?: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [state, formAction, pending] = useActionState(action, initialState);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const handledSuccess = useRef<DailyActionState | null>(null);
  const onSuccessRef = useRef(onSuccess);
  const router = useRouter();

  useEffect(() => {
    onSuccessRef.current = onSuccess;
  }, [onSuccess]);

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  useEffect(() => {
    if (state.status !== "success" || handledSuccess.current === state) return;
    handledSuccess.current = state;
    onSuccessRef.current?.();
    router.refresh();
  }, [router, state]);

  return (
    <form action={formAction} className={className} onSubmit={onSubmit}>
      {children}
      {state.message ? (
        <p
          aria-live="polite"
          className={state.status === "error" ? "action-message error" : "action-message success"}
          ref={state.status === "error" ? errorRef : undefined}
          role={state.status === "error" ? "alert" : "status"}
          tabIndex={state.status === "error" ? -1 : undefined}
        >
          {state.message}
        </p>
      ) : null}
      {footer ? (
        <div className="dialog-form-footer">
          {footer}
          <button className="primary-button" disabled={pending} type="submit">
            {pending ? pendingLabel : submitLabel}
          </button>
        </div>
      ) : (
        <button className="primary-button" disabled={pending} type="submit">
          {pending ? pendingLabel : submitLabel}
        </button>
      )}
    </form>
  );
}

export function CreateDailyQuestionForm() {
  return (
    <MutationForm action={createDailyQuestion} pendingLabel="Creando…" submitLabel="Agregar pregunta">
      <label>
        <span>Nueva pregunta</span>
        <textarea
          autoComplete="off"
          maxLength={500}
          minLength={3}
          name="questionText"
          placeholder="Ej.: ¿Qué avance querés compartir con el equipo?…"
          required
          rows={3}
        />
      </label>
    </MutationForm>
  );
}

export function DeactivateDailyQuestionForm({ questionId }: { questionId: string }) {
  return (
    <details className="daily-question-actions">
      <summary>Más acciones</summary>
      <MutationForm
        action={deactivateDailyQuestion}
        className="daily-deactivate-form"
        pendingLabel="Desactivando…"
        submitLabel="Desactivar"
      >
        <input name="questionId" type="hidden" value={questionId} />
        <label className="daily-confirmation">
          <input name="confirmation" required type="checkbox" value="true" />
          <span>Quitar esta pregunta de las selecciones activas.</span>
        </label>
      </MutationForm>
    </details>
  );
}

function intervalToMinutes(value: string): number {
  const match = /^(?:(\d+) days? )?(\d{2}):(\d{2}):\d{2}$/.exec(value);
  if (!match) return 480;
  return Number(match[1] ?? "0") * 1440 + Number(match[2]) * 60 + Number(match[3]);
}

function timeInputValue(value: string): string {
  return /^\d{2}:\d{2}/.test(value) ? value.slice(0, 5) : "09:00";
}

export function TeamDailyConfigurationForm({
  team,
  schedule,
  selectedQuestionIds,
  activeQuestions,
}: {
  team: DailyTeamRow;
  schedule?: DailyScheduleRow;
  selectedQuestionIds: string[];
  activeQuestions: DailyQuestionRow[];
}) {
  const timezoneListId = `${useId()}-daily-timezones`;
  const positionValues = [0, 1, 2].map((index) => selectedQuestionIds[index] ?? "");
  const selectedWeekdays = new Set(schedule?.scheduled_weekdays ?? [1, 2, 3, 4, 5]);

  return (
    <details className="card daily-team-card">
      <summary className="daily-team-heading">
        <div>
          <p className="eyebrow">Equipo</p>
          <h3>{team.name}</h3>
          <p className="muted small-text">{schedule ? `${timeInputValue(schedule.local_time)} · ${schedule.scheduled_weekdays.length} días` : "Configuración pendiente"}</p>
        </div>
        <span className={schedule?.is_active ? "daily-state active" : "daily-state"}>
          {schedule?.is_active ? "Horario activo" : "Sin horario activo"}
        </span>
      </summary>

      <div className="daily-team-editor">

      <MutationForm action={saveTeamDailySchedule} pendingLabel="Guardando…" submitLabel="Guardar horario">
        <input name="teamId" type="hidden" value={team.id} />
        <div className="daily-schedule-grid">
          <label>
            <span>Zona horaria</span>
            <input
              autoComplete="off"
              defaultValue={schedule?.timezone_name ?? "America/Argentina/Buenos_Aires"}
              list={timezoneListId}
              maxLength={100}
              name="timezoneName"
              required
            />
          </label>
          <label>
            <span>Hora local</span>
            <input autoComplete="off" defaultValue={timeInputValue(schedule?.local_time ?? "09:00")} name="localTime" required type="time" />
          </label>
          <label>
            <span>Ventana de respuesta (minutos)</span>
            <input
              autoComplete="off"
              defaultValue={intervalToMinutes(schedule?.response_window ?? "08:00:00")}
              max={10080}
              min={1}
              name="responseWindowMinutes"
              required
              step={1}
              type="number"
            />
          </label>
        </div>
        <datalist id={timezoneListId}>
          <option value="America/Argentina/Buenos_Aires" />
          <option value="America/Santiago" />
          <option value="America/Bogota" />
          <option value="America/Mexico_City" />
          <option value="America/New_York" />
          <option value="Europe/Madrid" />
          <option value="UTC" />
        </datalist>
        <fieldset className="daily-weekdays">
          <legend>Días de ejecución</legend>
          <div>
            {weekdays.map((weekday) => (
              <label key={weekday.value}>
                <input aria-label={weekday.name} defaultChecked={selectedWeekdays.has(weekday.value)} name="weekday" type="checkbox" value={weekday.value} />
                <span>{weekday.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <label className="daily-confirmation">
          <input defaultChecked={schedule?.is_active ?? true} name="isActive" type="checkbox" value="true" />
          <span>Equipo habilitado para recibir ejecuciones Daily</span>
        </label>
      </MutationForm>

      <MutationForm action={saveTeamDailyQuestions} pendingLabel="Guardando…" submitLabel="Guardar preguntas">
        <input name="teamId" type="hidden" value={team.id} />
        <div className="daily-question-selection-heading">
          <div>
            <h3>Preguntas y orden</h3>
            <p className="muted small-text">La posición 1 aparece primero. Podés operar con menos de 3 preguntas, pero es recomendable completar las 3.</p>
          </div>
          {selectedQuestionIds.length < 3 ? <span className="daily-state warning">Faltan {3 - selectedQuestionIds.length}</span> : null}
        </div>
        {[1, 2, 3].map((position, index) => (
          <label className="daily-question-position" key={position}>
            <span>Posición {position}</span>
            <select autoComplete="off" defaultValue={positionValues[index]} name="questionId">
              <option value="">Sin pregunta</option>
              {activeQuestions.map((question) => (
                <option key={question.id} value={question.id}>
                  {question.question_text}
                </option>
              ))}
            </select>
          </label>
        ))}
        <details className="context-note">
          <summary>Consideración técnica</summary>
          <p>Si una pregunta se desactiva mientras editás, actualizá la página antes de guardar nuevamente.</p>
        </details>
      </MutationForm>
      </div>
    </details>
  );
}

export function GenerateDailyRunForm({ teams, schedules }: { teams: DailyTeamRow[]; schedules: DailyScheduleRow[] }) {
  const activeTeamIds = new Set(schedules.filter((schedule) => schedule.is_active).map((schedule) => schedule.team_id));
  const eligibleTeams = teams.filter((team) => activeTeamIds.has(team.id));

  if (eligibleTeams.length === 0) {
    return <p className="muted">Primero guardá un horario activo para al menos un equipo.</p>;
  }

  return (
    <MutationForm action={generateDailyRun} pendingLabel="Generando…" submitLabel="Generar ejecución">
      <div className="daily-schedule-grid">
        <label>
          <span>Equipo con horario activo</span>
          <select autoComplete="off" defaultValue="" name="teamId" required>
            <option disabled value="">Seleccioná un equipo…</option>
            {eligibleTeams.map((team) => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Fecha local del equipo</span>
          <input autoComplete="off" name="localDate" required type="date" />
        </label>
      </div>
      <p className="muted small-text">La ejecución usa la fecha local y el horario configurado del equipo.</p>
    </MutationForm>
  );
}

export function DailyResponseForm({
  localDate,
  pendingRuns,
  runQuestions,
  activityItems = [],
  previousCompletedActivities = [],
  onSuccess,
  className = "card daily-response-form",
  footer,
}: {
  localDate: string;
  pendingRuns: DailyRunRow[];
  runQuestions: DailyRunQuestionRow[];
  activityItems?: DailyActivityRow[];
  previousCompletedActivities?: string[];
  onSuccess?: () => void;
  className?: string;
  footer?: ReactNode;
}) {
  const pendingRunIds = new Set(pendingRuns.map((run) => run.id));
  const runQuestionsForPendingRuns = runQuestions.filter((question) => pendingRunIds.has(question.run_id));
  const questions = Array.from(
    runQuestionsForPendingRuns
      .slice()
      .sort((left, right) => left.position - right.position)
      .reduce((byId, question) => {
        if (!byId.has(question.question_id)) byId.set(question.question_id, question);
        return byId;
      }, new Map<string, DailyRunQuestionRow>())
      .values(),
  );
  const plannedQuestion = questions.find((question) => isDailyPlannedWorkQuestion(question.semantic_key, question.question_text));
  const initialActivities = activityItems
    .filter((activity) => activity.status === "planned")
    .sort((left, right) => {
      const leftCarried = left.carried_from_id !== null ? 0 : 1;
      const rightCarried = right.carried_from_id !== null ? 0 : 1;
      return leftCarried - rightCarried || left.position - right.position;
    });
  const carriedActivityIds = initialActivities
    .filter((activity) => activity.carried_from_id !== null)
    .map((activity) => activity.id);
  const [activityTitles, setActivityTitles] = useState<string[]>(() => initialActivities.map((activity) => activity.title).concat(initialActivities.length === 0 ? [""] : []));
  if (pendingRuns.length === 0) {
    return <p className="muted">La ejecución seleccionada ya no está disponible para esta fecha.</p>;
  }
  if (!plannedQuestion) {
    return <p className="muted">La ejecución no tiene una pregunta de trabajo planificado válida.</p>;
  }

  const previousWorkValue = previousCompletedActivities.map((activity) => `- ${activity}`).join("\n");

  return (
    <MutationForm
      action={submitDailyResponse}
      onSuccess={onSuccess}
      pendingLabel="Enviando…"
      submitLabel="Enviar"
      className={className}
      footer={footer}
    >
      <div className="daily-response-card">
        <input name="localDate" type="hidden" value={localDate} />
        {pendingRuns.map((run) => <input key={run.id} name="runId" type="hidden" value={run.id} />)}
        <div className="daily-response-intro">
          <p className="eyebrow">Respuesta única</p>
          <h2>Respondé las preguntas de tus ejecuciones pendientes</h2>
          <p className="muted">Las preguntas compartidas se responden una sola vez y se aplican a las {pendingRuns.length} ejecuciones visibles.</p>
        </div>
        {questions.map((question, index) => {
          const questionNumber = index + 1;

          if (question.question_id === plannedQuestion.question_id) {
            return (
              <Fragment key={question.question_id}>
                {carriedActivityIds.map((activityId) => (
                  <input key={activityId} name="carriedActivityId" type="hidden" value={activityId} />
                ))}
                <fieldset className="daily-activity-field">
                  <legend>{questionNumber}. {question.question_text}</legend>
                  <p className="muted small-text">Agregá cada actividad por separado. Las actividades que quedaron pendientes del último Daily ya están incluidas.</p>
                  <div className="daily-activity-list">
                    {activityTitles.map((title, activityIndex) => {
                      const isCarried = activityIndex < carriedActivityIds.length;
                      return (
                        <div className="daily-activity-input" key={`${carriedActivityIds[activityIndex] ?? "new"}-${activityIndex}`}>
                          <label htmlFor={`daily-activity-${activityIndex}`}>Actividad {activityIndex + 1}</label>
                          <input
                            id={`daily-activity-${activityIndex}`}
                            maxLength={400}
                            minLength={1}
                            name="plannedActivity"
                            onChange={(event) => {
                              const next = [...activityTitles];
                              next[activityIndex] = event.target.value;
                              setActivityTitles(next);
                            }}
                            required
                            value={title}
                          />
                          {!isCarried && activityTitles.length > 1 ? (
                            <button
                              aria-label={`Quitar actividad ${activityIndex + 1}`}
                              className="secondary-button daily-activity-remove"
                              onClick={() => setActivityTitles((current) => current.filter((_, itemIndex) => itemIndex !== activityIndex))}
                              type="button"
                            >
                              Quitar
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <button className="secondary-button" onClick={() => setActivityTitles((current) => [...current, ""])} type="button">
                    + Agregar actividad
                  </button>
                </fieldset>
              </Fragment>
            );
          }

          return (
            <label className="daily-answer-field" key={question.question_id}>
              <span>{questionNumber}. {question.question_text}</span>
              <textarea
                autoComplete="off"
                maxLength={4000}
                minLength={1}
                name={`answer:${question.question_id}`}
                placeholder="Escribí tu respuesta…"
                required
                rows={4}
                defaultValue={isDailyCompletedWorkQuestion(question.semantic_key, question.question_text) ? previousWorkValue : undefined}
              />
            </label>
          );
        })}
        <p className="daily-response-note muted small-text">
          <span aria-hidden="true" className="daily-response-note-icon">i</span>
          <span>Al enviar, la respuesta queda registrada como evidencia inmutable y no se puede editar.</span>
        </p>
      </div>
    </MutationForm>
  );
}

export function DailyActivityCompletionForm({
  teamId,
  logicalDate,
  activities,
}: {
  teamId: string;
  logicalDate: string;
  activities: DailyActivityRow[];
}) {
  const plannedActivities = activities
    .filter((activity) => activity.status === "planned")
    .sort((left, right) => left.position - right.position);

  if (plannedActivities.length === 0) {
    return <p className="muted">No hay actividades planificadas para cerrar.</p>;
  }

  return (
    <MutationForm
      action={submitDailyActivityCompletion}
      className="daily-completion-form"
      pendingLabel="Guardando…"
      submitLabel="Registrar cierre"
    >
      <input name="teamId" type="hidden" value={teamId} />
      <input name="logicalDate" type="hidden" value={logicalDate} />
      <fieldset className="daily-completion-list">
        <legend>¿Qué acabaste?</legend>
        <p className="muted small-text">Seleccioná las actividades completadas. Las demás pasarán automáticamente al próximo Daily.</p>
        {plannedActivities.map((activity) => (
          <label className="daily-completion-item" key={activity.id}>
            <input name="completedActivityId" type="checkbox" value={activity.id} />
            <span>{activity.title}</span>
          </label>
        ))}
      </fieldset>
      <p className="daily-response-note muted small-text">
        El cierre es único por equipo y fecha local. Después de registrarlo no se puede editar ni repetir.
      </p>
    </MutationForm>
  );
}
