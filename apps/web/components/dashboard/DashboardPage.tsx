import Link from "next/link";
import { getDashboardAggregate } from "@/app/actions/dashboard";
import type { InternalAuthUser } from "@/lib/auth";
import { DashboardDailyResponsesForDate } from "@/components/dashboard/DashboardDailyResponsesForDate";
import { DashboardHierarchyFilter } from "@/components/dashboard/DashboardHierarchyFilter";
import { DashboardKpiSummary } from "@/components/dashboard/DashboardKpiSummary";
import { DashboardTimeline } from "@/components/dashboard/DashboardTimeline";
import { DashboardUnavailableCard } from "@/components/dashboard/DashboardUnavailableCard";
import { MyCardsWidget } from "@/components/dashboard/MyCardsWidget";

type DashboardPageProps = {
  searchParamsPromise: Promise<Record<string, string | undefined>>;
  user: InternalAuthUser;
};

function DashboardUnavailable({ message }: { message: string }) {
  return (
    <section aria-live="polite" className="card dashboard-status-card">
      <p className="eyebrow">Dashboard</p>
      <h1>No se pudo cargar el dashboard</h1>
      <p className="muted">{message}</p>
      <Link className="secondary-button" href="/workspace/dashboard">Reintentar</Link>
    </section>
  );
}

export async function DashboardPage({ searchParamsPromise, user }: DashboardPageProps) {
  const params = await searchParamsPromise;
  const teamId = params.teamId || undefined;
  const projectId = params.projectId || undefined;
  const selectedDate = params.selectedDate || new Date().toISOString().slice(0, 10);
  const range = params.range === "7d" || params.range === "90d" ? params.range : "30d";
  const result = await getDashboardAggregate({ teamId, projectId, selectedDate, range });

  if (!result.data) return <DashboardUnavailable message={result.error ?? "Actualizá la página e intentá nuevamente."} />;

  const { hierarchy, kpi, dailyAnswers, myCards, myCardsError } = result.data;
  return (
    <section className="module-page dashboard-page">
      <header className="dashboard-hero glass-panel">
        <div className="dashboard-hero-copy">
          <p className="eyebrow">{user.name} · Vista operativa</p>
          <h1>Tu trabajo, en movimiento</h1>
          <p className="muted page-description">
            Revisá el pulso de tus proyectos, priorizá tus tareas y leé las actualizaciones del equipo desde un solo lugar.
          </p>
        </div>
        <DashboardHierarchyFilter
          hierarchy={hierarchy}
          initialProjectId={projectId}
          initialTeamId={teamId}
        />
      </header>

      <section aria-label="Navegación de fechas" className="card dashboard-timeline-card">
        <DashboardTimeline initialSelectedDate={selectedDate} />
      </section>

      <div className="dashboard-main-grid">
        <DashboardKpiSummary data={kpi ?? null} error={result.data.kpiError} />
        <MyCardsWidget result={myCardsError ? { error: myCardsError } : { data: { rows: myCards, count: myCards.length, page: 1, pageSize: myCards.length } }} />
      </div>

      <section aria-labelledby="dashboard-signals-title" className="dashboard-section-heading">
        <div><p className="eyebrow">Fuentes conectadas</p><h2 id="dashboard-signals-title">El contexto que todavía falta</h2></div>
        <p className="muted">Estos bloques aparecen cuando exista una fuente autorizada y datos reales.</p>
      </section>
      <div className="dashboard-unavailable-grid">
        <DashboardUnavailableCard description="TuringITSM todavía no tiene un contrato de GitHub habilitado para commits, PRs o actividad diaria." title="Actividad GitHub" />
        <DashboardUnavailableCard description="TuringITSM todavía no tiene una acción de costos Cloud disponible para este dashboard." title="Costos Cloud" />
      </div>

      <DashboardDailyResponsesForDate rows={dailyAnswers} selectedDate={selectedDate} />

      {hierarchy.teams.length === 0 ? (
        <section className="card dashboard-empty-onboarding">
          <p className="eyebrow">Primer paso</p>
          <h2>Creá tu primer equipo</h2>
          <p className="muted">La jerarquía del dashboard se construye con equipos y proyectos activos.</p>
          <Link className="primary-button" href="/workspace/roles-permisos" prefetch={false}>Ir a Roles & Permissions →</Link>
        </section>
      ) : null}
    </section>
  );
}
