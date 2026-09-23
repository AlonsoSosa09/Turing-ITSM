import type { KpiDashboardData } from "@/app/actions/kpi";

type DashboardKpiSummaryProps = {
  data: KpiDashboardData | null;
  error?: string;
};

const numberFormatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 });

function number(value: number): string {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

function BurndownChart({ points }: { points: KpiDashboardData["activeBurndown"] }) {
  if (points.length === 0) return <p className="dashboard-chart-empty">Sin sprint activo para graficar.</p>;
  const max = Math.max(...points.map((point) => point.scope), 1);
  const line = (field: "remaining" | "ideal") => points
    .map((point, index) => {
      const x = points.length === 1 ? 50 : (index / (points.length - 1)) * 100;
      const y = 96 - ((point[field] ?? 0) / max) * 82;
      return `${x},${Math.max(10, y)}`;
    })
    .join(" ");

  return (
    <div className="dashboard-chart-wrap">
      <svg aria-label="Burndown del sprint" className="dashboard-chart" role="img" viewBox="0 0 100 100" preserveAspectRatio="none">
        <title>Story points restantes por fecha</title>
        <line className="dashboard-chart-gridline" x1="0" x2="100" y1="14" y2="14" />
        <line className="dashboard-chart-gridline" x1="0" x2="100" y1="55" y2="55" />
        <line className="dashboard-chart-gridline" x1="0" x2="100" y1="96" y2="96" />
        <polyline className="dashboard-chart-ideal" points={line("ideal")} />
        <polyline className="dashboard-chart-line" points={line("remaining")} />
      </svg>
      <div className="dashboard-chart-legend"><span>Restantes</span><span className="ideal">Ideal</span></div>
    </div>
  );
}

function CompletedChart({ rows }: { rows: KpiDashboardData["spCompletedOverTime"] }) {
  if (rows.length === 0) return <p className="dashboard-chart-empty">Sin cierres en el período.</p>;
  const max = Math.max(...rows.map((row) => row.completed_sp), 1);
  return (
    <div className="dashboard-bars" aria-label="Story points completados por período" role="img">
      {rows.slice(-8).map((row) => (
        <div className="dashboard-bar-item" key={row.bucket}>
          <span className="dashboard-bar-value">{number(row.completed_sp)}</span>
          <span className="dashboard-bar-track"><span style={{ height: `${Math.max(6, (row.completed_sp / max) * 100)}%` }} /></span>
          <small>{row.bucket.slice(5)}</small>
        </div>
      ))}
    </div>
  );
}

function AssignmentList({ rows }: { rows: KpiDashboardData["assignmentGrid"] }) {
  if (rows.length === 0) return <p className="dashboard-chart-empty">Sin story points asignados.</p>;
  return (
    <ul className="dashboard-assignment-list">
      {rows.slice(0, 5).map((row) => (
        <li key={`${row.assignee_email}-${row.assignee_display_name}`}>
          <div><strong>{row.assignee_display_name}</strong><span>{number(row.completed_sp)} / {number(row.assigned_sp)} SP completados</span></div>
          <span className="dashboard-assignment-percent">{number(row.pct_of_total_sp)}%</span>
        </li>
      ))}
    </ul>
  );
}

export function DashboardKpiSummary({ data, error }: DashboardKpiSummaryProps) {
  const velocity = data?.velocity;
  const hasData = Boolean(velocity || data?.activeBurndown.length || data?.spCompletedOverTime.length || data?.assignmentGrid.length);

  return (
    <section aria-labelledby="dashboard-kpi-title" className="card dashboard-kpi-card">
      <header className="dashboard-widget-header">
        <div><p className="eyebrow">Rendimiento</p><h2 className="dashboard-widget-title" id="dashboard-kpi-title">KPI del trabajo</h2></div>
        <span className="dashboard-source-badge">Jira · {hasData ? "conectado" : "sin datos"}</span>
      </header>
      {error ? <p className="dashboard-inline-error" role="alert">{error}</p> : null}
      {!hasData ? (
        <p className="empty-state dashboard-empty-state" role="status">Todavía no hay datos KPI. Conectá Jira y ejecutá una sincronización para habilitar estas métricas.</p>
      ) : (
        <>
          <div className="dashboard-kpi-metrics">
            <div><span>Promedio por sprint</span><strong>{number(velocity?.avg_sp_completed ?? 0)} SP</strong></div>
            <div><span>Total completado</span><strong>{number(velocity?.total_sp_completed ?? 0)} SP</strong></div>
            <div><span>Sprints analizados</span><strong>{number(velocity?.sprints_count ?? 0)}</strong></div>
            <div><span>Último sprint</span><strong>{velocity?.latest_sprint_name ?? "Sin sprint"}</strong></div>
          </div>
          <div className="dashboard-kpi-chart-grid">
            <div className="dashboard-kpi-panel"><h3>Burndown del sprint</h3><BurndownChart points={data?.activeBurndown ?? []} /></div>
            <div className="dashboard-kpi-panel"><h3>Story points completados</h3><CompletedChart rows={data?.spCompletedOverTime ?? []} /></div>
            <div className="dashboard-kpi-panel dashboard-kpi-panel-wide"><h3>Distribución por persona</h3><AssignmentList rows={data?.assignmentGrid ?? []} /></div>
          </div>
        </>
      )}
    </section>
  );
}
