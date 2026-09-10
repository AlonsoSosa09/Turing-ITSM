import Link from "next/link";
import type { DailyMemberData } from "@/app/actions/daily-runs";
import { DailyResponseForm } from "@/components/daily/daily-forms";

function TeamSelector({ teams }: { teams: Array<{ id: string; name: string }> }) {
  return (
    <form action="/workspace/dashboard" className="dashboard-daily-team-form" method="get">
      <label>
        <span>Equipo Daily</span>
        <select name="dailyTeam" required>
          <option disabled value="">Seleccioná un equipo…</option>
          {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
        </select>
      </label>
      <button className="secondary-button" type="submit">Ver equipo</button>
    </form>
  );
}

export function DashboardDailyCard({
  result,
}: {
  result: { data?: DailyMemberData; error?: string };
}) {
  const data = result.data;
  if (!data) {
    return (
      <section className="card dashboard-daily-card" aria-labelledby="dashboard-daily-title">
        <header className="dashboard-widget-header">
          <h2 className="dashboard-widget-title" id="dashboard-daily-title">Daily</h2>
          <Link className="task-card-link" href="/workspace/daily">Abrir Daily →</Link>
        </header>
        <p className="form-error dashboard-error" role="alert">No pudimos cargar Daily. {result.error}</p>
      </section>
    );
  }

  const selectedTeam = data.selectedResponseTeam;

  if (!selectedTeam && data.responseTeamOptions.length > 1) {
    return (
      <section className="card dashboard-daily-card" aria-labelledby="dashboard-daily-title">
        <header className="dashboard-widget-header">
          <h2 className="dashboard-widget-title" id="dashboard-daily-title">Daily</h2>
          <span className="count-pill">Equipo requerido</span>
        </header>
        <p className="muted">Seleccioná el equipo de las respuestas Daily que querés completar.</p>
        <TeamSelector teams={data.responseTeamOptions} />
      </section>
    );
  }

  if (!selectedTeam) {
    return (
      <section className="card dashboard-daily-card" aria-labelledby="dashboard-daily-title">
        <header className="dashboard-widget-header">
          <h2 className="dashboard-widget-title" id="dashboard-daily-title">Daily</h2>
          <Link className="task-card-link" href="/workspace/daily">Abrir Daily →</Link>
        </header>
        <p className="form-error dashboard-error" role="alert">No hay un equipo Daily disponible para tu cuenta.</p>
      </section>
    );
  }

  const pendingRunsForDate = data.pendingRuns.filter(
    (run) => run.team_id === selectedTeam.id && run.local_date === selectedTeam.localDate,
  );
  const activityTeam = data.activityTeams.find(
    (team) => team.teamId === selectedTeam.id && team.localDate === selectedTeam.localDate,
  );
  return (
    <section className="card dashboard-daily-card" aria-labelledby="dashboard-daily-title">
      <header className="dashboard-widget-header">
        <div>
          <p className="eyebrow">{selectedTeam.name}</p>
          <h2 className="dashboard-widget-title" id="dashboard-daily-title">Daily</h2>
        </div>
        <Link className="task-card-link" href="/workspace/daily">Abrir Daily →</Link>
      </header>
      {pendingRunsForDate.length > 0 ? (
        <DailyResponseForm
          localDate={selectedTeam.localDate}
          pendingRuns={pendingRunsForDate}
          runQuestions={data.runQuestions}
          activityItems={activityTeam?.activities}
          previousCompletedActivities={activityTeam?.previousCompletedActivities}
        />
      ) : (
        <p className="empty-state">No hay una ejecución Daily pendiente para este equipo.</p>
      )}
    </section>
  );
}
