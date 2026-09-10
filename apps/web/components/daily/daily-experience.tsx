"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isAdmin, type InternalRole } from "@/lib/rbac";
import type {
  DailyAdminData,
  DailyMemberData,
  DailySubmissionAnswerRow,
  DailyTeamRow,
} from "@/app/actions/daily-runs";
import { Dialog, useDialogClose } from "@/components/admin/dialog";
import { DailyResponseForm } from "./daily-forms";
import { DailyResponsesByQuestion } from "./daily-responses-by-question";
import { DailyConfigPanel } from "./daily-config-panel";
import { DailyContentCard } from "./daily-content-card";

const dayLabelFmt = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", timeZone: "UTC" });
const weekdayFmt = new Intl.DateTimeFormat("es-AR", { weekday: "short", timeZone: "UTC" });
const longDateFmt = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

function utcDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function localDateKeyInTz(date: Date, timezoneName: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezoneName,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]);
    const map = Object.fromEntries(parts) as Record<string, string>;
    return `${map.year}-${map.month}-${map.day}`;
  } catch {
    return utcDateKey(date);
  }
}

function DialogCloseButton({ label = "Cancelar" }: { label?: string }) {
  const close = useDialogClose();
  return (
    <button className="secondary-button" onClick={() => close?.()} type="button">
      {label}
    </button>
  );
}

function ReadonlyAnswers({ answers }: { answers: DailySubmissionAnswerRow[] }) {
  const ordered = Array.from(new Set(answers.map((answer) => answer.question_text)));
  return (
    <dl className="daily-answer-list">
      {ordered.map((questionText) => {
        const answerText = answers.find((answer) => answer.question_text === questionText)?.answer_text ?? "";
        return (
          <div className="daily-answer-item" key={questionText}>
            <dt>{questionText}</dt>
            <dd>{answerText}</dd>
          </div>
        );
      })}
    </dl>
  );
}

type DailyExperienceProps = {
  role: InternalRole;
  data: DailyAdminData | DailyMemberData;
};

export function DailyExperience({ role, data }: DailyExperienceProps) {
  const hasAdminAccess = isAdmin(role);
  const adminData = hasAdminAccess ? (data as DailyAdminData) : null;

  const submissions = data.submissions;
  const submissionRuns = data.submissionRuns;
  const submissionAnswers = data.submissionAnswers;
  const people = data.people;
  const reportTeams = data.reportTeams;
  const currentUserId = data.currentUserId;
  const pendingRuns = data.pendingRuns;
  const runQuestions = data.runQuestions;

  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [showingConfig, setShowingConfig] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [respondNonce, setRespondNonce] = useState(0);

  const [referenceTimezone, setReferenceTimezone] = useState<string>("UTC");
  useEffect(() => {
    // Keep the UTC server/client snapshot stable, then adopt the browser timezone after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReferenceTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  }, []);

  const todayKey = localDateKeyInTz(new Date(), referenceTimezone);
  const [selectedDate, setSelectedDate] = useState<string>(todayKey);

  const days = useMemo(() => {
    const todayUtc = new Date(`${todayKey}T00:00:00Z`);
    return Array.from({ length: 7 }, (_, index) => {
      const date = new Date(todayUtc);
      date.setUTCDate(todayUtc.getUTCDate() - (6 - index));
      return date;
    });
  }, [todayKey]);
  const teamIdsBySubmission = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const linkedRun of submissionRuns) {
      const teamIds = result.get(linkedRun.submission_id) ?? new Set<string>();
      teamIds.add(linkedRun.team_id);
      result.set(linkedRun.submission_id, teamIds);
    }
    return result;
  }, [submissionRuns]);
  const submissionIdsForDate = useMemo(
    () => new Set(
      submissionRuns
        .filter((linkedRun) => linkedRun.local_date === selectedDate)
        .map((linkedRun) => linkedRun.submission_id),
    ),
    [submissionRuns, selectedDate],
  );

  const selectedDateObj = days.find((date) => utcDateKey(date) === selectedDate) ?? new Date(`${selectedDate}T00:00:00Z`);
  const longDateLabel = longDateFmt.format(selectedDateObj);

  const submissionsForDate = useMemo(
    () =>
      submissions.filter(
        (submission) =>
          submissionIdsForDate.has(submission.id) &&
          (teamFilter === "all" || teamIdsBySubmission.get(submission.id)?.has(teamFilter)),
      ),
    [submissions, submissionIdsForDate, teamFilter, teamIdsBySubmission],
  );

  const mySubmissionForDate = submissions.find(
    (submission) => submission.user_id === currentUserId && submissionIdsForDate.has(submission.id),
  );
  const pendingResponseRunsForDate = useMemo(
    () => pendingRuns.filter((run) => run.local_date === selectedDate),
    [pendingRuns, selectedDate],
  );
  const responseTeams = useMemo(() => {
    const namesByTeamId = new Map(reportTeams.map((team) => [team.id, team.name]));
    return Array.from(new Set(pendingResponseRunsForDate.map((run) => run.team_id))).map((id) => ({
      id,
      name: namesByTeamId.get(id) ?? "Equipo Daily",
    }));
  }, [pendingResponseRunsForDate, reportTeams]);
  const [selectedResponseTeamId, setSelectedResponseTeamId] = useState<string>();
  const responseTeamId = responseTeams.length === 1 ? responseTeams[0].id : selectedResponseTeamId;
  const responsePendingRuns = useMemo(
    () => responseTeamId ? pendingResponseRunsForDate.filter((run) => run.team_id === responseTeamId) : [],
    [pendingResponseRunsForDate, responseTeamId],
  );
  const responseRunIds = useMemo(() => new Set(responsePendingRuns.map((run) => run.id)), [responsePendingRuns]);
  const responseRunQuestions = useMemo(
    () => runQuestions.filter((question) => responseRunIds.has(question.run_id)),
    [responseRunIds, runQuestions],
  );
  const hasResponded = Boolean(mySubmissionForDate);
  const canRespond = pendingResponseRunsForDate.length > 0;

  const answeredCount = useMemo(
    () => new Set(submissionsForDate.map((submission) => submission.user_id)).size,
    [submissionsForDate],
  );
  const teamResponderCount = useMemo(() => {
    const scoped =
      teamFilter === "all"
        ? submissions
        : submissions.filter((submission) => teamIdsBySubmission.get(submission.id)?.has(teamFilter));
    return new Set(scoped.map((submission) => submission.user_id)).size;
  }, [submissions, teamFilter, teamIdsBySubmission]);
  const progressRatio = teamResponderCount === 0 ? 0 : Math.min(1, answeredCount / teamResponderCount);

  const orderedQuestionTexts = useMemo(() => {
    if (!adminData || teamFilter === "all") return undefined;
    const selection = adminData.selections
      .filter((entry) => entry.team_id === teamFilter)
      .sort((left, right) => left.position - right.position);
    return selection
      .map((entry) => adminData.questions.find((question) => question.id === entry.question_id)?.question_text)
      .filter((text): text is string => Boolean(text));
  }, [adminData, teamFilter]);

  const firstDayKey = utcDateKey(days[0]);
  const lastDayKey = utcDateKey(days[days.length - 1]);
  const atStart = selectedDate <= firstDayKey;
  const atEnd = selectedDate >= lastDayKey;

  function shiftDate(delta: number) {
    const index = days.findIndex((date) => utcDateKey(date) === selectedDate);
    const baseIndex = index === -1 ? days.length - 1 : index;
    const nextIndex = Math.min(Math.max(baseIndex + delta, 0), days.length - 1);
    setSelectedDate(utcDateKey(days[nextIndex]));
    setSelectedResponseTeamId(undefined);
  }

  function openModal() {
    if (!canRespond && !hasResponded) return;
    setSelectedResponseTeamId(responseTeams.length === 1 ? responseTeams[0].id : undefined);
    setRespondNonce((value) => value + 1);
    setModalOpen(true);
  }

  function handleModalOpenChange(open: boolean) {
    setModalOpen(open);
    if (!open) setSelectedResponseTeamId(undefined);
  }

  const handleRespondSuccess = useCallback(() => {
    setModalOpen(false);
  }, []);

  const ctaLabel = canRespond ? "Responder Daily" : "Ver mis respuestas";
  const ctaDisabled = !hasResponded && !canRespond;
  const responseHint = "No hay una ejecución pendiente para este día.";
  const isReadonlyModal = hasResponded && !canRespond;

  const emptyState = submissionsForDate.length === 0;

  const modalTitle = isReadonlyModal ? "Tus respuestas del Daily" : "Responder Daily";
  const modalDescription =
    isReadonlyModal
      ? `Estas son las respuestas que enviaste para el ${longDateLabel}.`
      : `Respondé las preguntas de la ejecución del ${longDateLabel}.`;

  const readonlyAnswers = mySubmissionForDate
    ? submissionAnswers.filter((answer) => answer.submission_id === mySubmissionForDate.id)
    : [];

  return (
    <section className="module-page daily-page daily-experience">
      <header className="daily-hero">
        <div className="daily-hero-intro">
          <p className="eyebrow">Daily</p>
          <h1>Daily</h1>
          <p className="muted">Seguimiento diario del equipo</p>
          <p className="daily-hero-date" aria-label="Fecha seleccionada">{longDateLabel}</p>
        </div>
        <div className="daily-hero-actions">
          {hasAdminAccess ? (
            <button
              className={showingConfig ? "daily-config-button active" : "daily-config-button"}
              aria-pressed={showingConfig}
              onClick={() => setShowingConfig((value) => !value)}
              type="button"
            >
              <span aria-hidden="true">{showingConfig ? "←" : "⚙"}</span>
              {showingConfig ? "Volver al Daily" : "Configurar Daily"}
            </button>
          ) : null}
          <button
            className="primary-button daily-respond-cta"
            disabled={ctaDisabled}
            onClick={openModal}
            type="button"
          >
            {ctaLabel}
          </button>
        </div>
      </header>

      {ctaDisabled ? <p className="muted small-text daily-cta-hint">{responseHint}</p> : null}

      {!showingConfig ? (
        <>
          <nav className="daily-day-nav" aria-label="Navegación por día">
            <button
              aria-label="Día anterior"
              className="daily-day-nav-arrow"
              disabled={atStart}
              onClick={() => shiftDate(-1)}
              type="button"
            >
              <span aria-hidden="true">‹</span>
            </button>
            <div className="filter-segment daily-day-segment" role="group" aria-label="Últimos 7 días">
              {days.map((date) => {
                const key = utcDateKey(date);
                const active = key === selectedDate;
                return (
                  <button
                    aria-pressed={active}
                    className={active ? "daily-day-pill active" : "daily-day-pill"}
                    key={key}
                    onClick={() => {
                      setSelectedDate(key);
                      setSelectedResponseTeamId(undefined);
                    }}
                    type="button"
                  >
                    <span className="daily-day-pill-date">{dayLabelFmt.format(date).toUpperCase()}</span>
                    <span className="daily-day-pill-weekday">{weekdayFmt.format(date).replace(".", "")}</span>
                  </button>
                );
              })}
            </div>
            <button
              aria-label="Día siguiente"
              className="daily-day-nav-arrow"
              disabled={atEnd}
              onClick={() => shiftDate(1)}
              type="button"
            >
              <span aria-hidden="true">›</span>
            </button>
          </nav>

          {reportTeams.length > 1 ? (
            <div className="daily-filter-bar daily-team-filter">
              <div className="filter-segment" role="group" aria-label="Filtrar por equipo">
                <button
                  aria-pressed={teamFilter === "all"}
                  className={teamFilter === "all" ? "active" : ""}
                  onClick={() => setTeamFilter("all")}
                  type="button"
                >
                  Todos
                </button>
                {reportTeams.map((team: DailyTeamRow) => (
                  <button
                    aria-pressed={teamFilter === team.id}
                    className={teamFilter === team.id ? "active" : ""}
                    key={team.id}
                    onClick={() => setTeamFilter(team.id)}
                    type="button"
                  >
                    {team.name}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <DailyContentCard dateKey={selectedDate} isCurrentDate={selectedDate === todayKey} key={selectedDate} />

          <section className={hasResponded && !canRespond ? "daily-tu" : "daily-tu daily-response-controls"} aria-live="polite">
            {hasResponded && !canRespond ? (
              <>
                <span className="daily-tu-status answered">✓ Respondido</span>
                <span className="muted small-text">Ya enviaste tu actualización para este día.</span>
                <button className="secondary-button daily-tu-action" onClick={openModal} type="button">
                  Ver mis respuestas
                </button>
              </>
            ) : (
              <>
                <span className="muted small-text">
                  {canRespond ? "Respondé para compartir tu actualización con el equipo." : responseHint}
                </span>
                {canRespond ? (
                  <button className="secondary-button daily-tu-action" onClick={openModal} type="button">
                    Responder Daily
                  </button>
                ) : null}
              </>
            )}
          </section>

          <section className="daily-responses" aria-labelledby="daily-responses-heading">
            <header className="daily-responses-heading">
              <div>
                <p className="eyebrow">Equipo</p>
                <h2 id="daily-responses-heading">Respuestas del equipo</h2>
                <p className="muted">Agrupadas por pregunta para el {longDateLabel}.</p>
              </div>
              <div className="daily-progress" aria-label="Progreso de respuestas">
                <span className="daily-progress-count">{answeredCount} respondieron</span>
                <span className="daily-progress-track" aria-hidden="true">
                  <span className="daily-progress-fill" style={{ width: `${Math.round(progressRatio * 100)}%` }} />
                </span>
              </div>
            </header>

            {emptyState ? (
              <section className="card daily-empty-state daily-empty-prompt">
                <p className="eyebrow">Sin respuestas</p>
                <h3>Todavía no hay respuestas para este día</h3>
                <p className="muted">Sé el primero en compartir tu actualización con el equipo.</p>
                {canRespond ? (
                  <button className="primary-button" onClick={openModal} type="button">
                    Responder Daily
                  </button>
                ) : null}
              </section>
            ) : (
              <DailyResponsesByQuestion
                orderedQuestionTexts={orderedQuestionTexts}
                people={people}
                submissionAnswers={submissionAnswers}
                submissions={submissionsForDate}
              />
            )}
          </section>
        </>
      ) : (
        <DailyConfigPanel data={adminData as DailyAdminData} />
      )}

      <Dialog
        className="daily-response-dialog"
        description={modalDescription}
        onOpenChange={handleModalOpenChange}
        open={modalOpen}
        protectDirtyChanges={!isReadonlyModal}
        title={modalTitle}
      >
        {!isReadonlyModal ? (
          responseTeams.length > 1 && !responseTeamId ? (
            <div className="daily-response-team-picker">
              <p>Seleccioná el equipo para responder su Daily.</p>
              <div className="filter-segment" role="group" aria-label="Equipo para responder Daily">
                {responseTeams.map((team) => (
                  <button key={team.id} onClick={() => setSelectedResponseTeamId(team.id)} type="button">
                    {team.name}
                  </button>
                ))}
              </div>
              <p className="muted small-text">Verás solo las ejecuciones pendientes de ese equipo para este día.</p>
              <div className="dialog-form-footer">
                <DialogCloseButton label="Cancelar" />
              </div>
            </div>
          ) : responsePendingRuns.length > 0 ? (
            <>
              <DailyResponseForm
                key={`respond-${respondNonce}-${selectedDate}-${responseTeamId}`}
                localDate={selectedDate}
                onSuccess={handleRespondSuccess}
                pendingRuns={responsePendingRuns}
                runQuestions={responseRunQuestions}
                className="daily-response-form"
                footer={<DialogCloseButton label="Cancelar" />}
              />
            </>
          ) : (
            <>
              <p className="muted">{responseHint}</p>
              <div className="dialog-form-footer">
                <DialogCloseButton label="Cerrar" />
              </div>
            </>
          )
        ) : (
          <>
            <ReadonlyAnswers answers={readonlyAnswers} />
            <p className="muted small-text daily-readonly-note">
              Las respuestas enviadas no se pueden editar. Se registran como evidencia inmutable.
            </p>
            <div className="dialog-form-footer">
              <DialogCloseButton label="Cerrar" />
            </div>
          </>
        )}
      </Dialog>
    </section>
  );
}
