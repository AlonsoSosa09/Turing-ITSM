import Link from "next/link";
import type { DailyAnswerForDateRow } from "@/app/actions/dashboard";

type DashboardDailyResponsesForDateProps = {
  selectedDate: string;
  rows: DailyAnswerForDateRow[];
};

const dateFormatter = new Intl.DateTimeFormat("es-AR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export function DashboardDailyResponsesForDate({ selectedDate, rows }: DashboardDailyResponsesForDateProps) {
  const grouped = new Map<string, DailyAnswerForDateRow[]>();
  rows.forEach((row) => grouped.set(row.question_text, [...(grouped.get(row.question_text) ?? []), row]));
  const responders = new Set(rows.map((row) => row.user_id)).size;

  return (
    <section aria-labelledby="dashboard-daily-title" className="card dashboard-daily-summary">
      <header className="dashboard-widget-header">
        <div><p className="eyebrow">Actualización del equipo</p><h2 className="dashboard-widget-title" id="dashboard-daily-title">Daily del día</h2><p className="muted small-text">{dateFormatter.format(new Date(`${selectedDate}T00:00:00Z`))} · {responders} {responders === 1 ? "persona respondió" : "personas respondieron"}</p></div>
        <Link className="task-card-link" href="/workspace/daily" prefetch={false}>Abrir Daily →</Link>
      </header>
      {grouped.size === 0 ? (
        <p className="empty-state dashboard-empty-state" role="status">No hay respuestas Daily para esta fecha. Elegí otro día o revisá el espacio Daily.</p>
      ) : (
        <div className="dashboard-daily-blocks">
          {Array.from(grouped.entries()).map(([question, answers]) => (
            <section className="dashboard-daily-block" key={question}>
              <h3>{question}</h3>
              <ul>
                {answers.slice(0, 6).map((answer, index) => (
                  <li key={`${answer.user_id}-${index}`}><strong>{answer.full_name ?? "Miembro del equipo"}</strong><p>{answer.answer_text}</p></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}
