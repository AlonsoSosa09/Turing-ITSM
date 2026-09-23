type DashboardUnavailableCardProps = {
  title: string;
  description: string;
};

export function DashboardUnavailableCard({ title, description }: DashboardUnavailableCardProps) {
  return (
    <section aria-labelledby={`${title}-title`} className="card dashboard-unavailable-card">
      <div className="dashboard-unavailable-icon" aria-hidden="true">○</div>
      <div>
        <p className="eyebrow">Próximamente</p>
        <h2 id={`${title}-title`}>{title}</h2>
        <p className="muted">{description}</p>
        <span className="dashboard-unavailable-status">Fuente no configurada</span>
      </div>
    </section>
  );
}
