export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ui-kpi-cell">
      <span className="ui-kpi-label">{label}</span>
      <span className="ui-kpi-value">{value}</span>
      {hint ? <span className="ui-kpi-hint">{hint}</span> : null}
    </div>
  );
}
export function Empty({ title, detail }: { title: string; detail: string }) { return <section className="card"><h3>{title}</h3><p className="muted">{detail}</p></section>; }
