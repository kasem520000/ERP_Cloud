import type { HTMLAttributes, ReactNode } from 'react';

/** Structural primitives for operational screens. No data fetching or permissions live here.
 * A page owns its actions, error copy and domain semantics; the engine owns its rhythm. */
export function PageFrame({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`erp-page ${className}`} {...rest}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  eyebrow,
  breadcrumbs,
  actions,
  className = '',
}: {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  breadcrumbs?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={`erp-page-header ${className}`}>
      <div className="erp-page-heading">
        {breadcrumbs ? (
          <nav className="erp-page-breadcrumbs" aria-label="المسار">
            {breadcrumbs}
          </nav>
        ) : null}
        {eyebrow ? <p className="erp-page-eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        {description ? <p className="erp-page-description">{description}</p> : null}
      </div>
      {actions ? <div className="erp-page-actions no-print">{actions}</div> : null}
    </header>
  );
}

/** Flat by default: tables and dense forms are not nested in decorative cards. */
export function ContentPanel({
  title,
  description,
  actions,
  children,
  className = '',
  ...rest
}: HTMLAttributes<HTMLElement> & { title?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return (
    <section className={`erp-panel ${className}`} {...rest}>
      {title || description || actions ? (
        <div className="erp-panel-header">
          <div className="erp-panel-heading">
            {title ? <h2>{title}</h2> : null}
            {description ? <p>{description}</p> : null}
          </div>
          {actions ? <div className="erp-page-actions no-print">{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Horizontal scroll is local to the table, never to the whole ERP page. */
export function TableViewport({
  children,
  label,
  className = '',
}: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  return (
    <div className={`erp-table-viewport ${className}`} role="region" aria-label={label} tabIndex={0}>
      {children}
    </div>
  );
}

/** Explicit form label and error association via native label nesting. */
export function FormField({
  label,
  children,
  hint,
  error,
  className = '',
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  className?: string;
}) {
  return (
    <label className={`erp-field ${className}`}>
      <span className="erp-field-label">{label}</span>
      {children}
      {hint ? <span className="erp-field-hint">{hint}</span> : null}
      {error ? (
        <span className="erp-field-error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}

/** Passive summary; the caller supplies a formatted string, never a JS floating-point amount. */
export function SummaryStat({
  label,
  value,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <article className="erp-stat">
      <span className="erp-stat-label">{label}</span>
      <strong className="erp-stat-value" dir="auto">
        {value}
      </strong>
      {hint ? <span className="erp-stat-hint">{hint}</span> : null}
    </article>
  );
}

export function ViewNotice({
  state,
  children,
}: {
  state: 'loading' | 'empty' | 'error';
  children: ReactNode;
}) {
  return (
    <div
      className={`erp-view-notice erp-view-${state}`}
      role={state === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      {children}
    </div>
  );
}

/** Access-control overview is deliberately read-only; role writes remain in each app. */
export function AccessOverview({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: { label: string; value: ReactNode; hint: string }[];
}) {
  return (
    <section className="erp-access-overview" aria-label={title}>
      <div className="erp-access-intro">
        <span className="erp-access-kicker">إدارة الوصول</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="erp-access-stats">
        {items.map((item) => (
          <div className="erp-access-stat" key={item.label}>
            <span>{item.label}</span>
            <strong dir="auto">{item.value}</strong>
            <small>{item.hint}</small>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Native checkbox, readable detail and selected state; no permission decisions here. */
export function PermissionChoice({
  title,
  detail,
  checked,
  disabled = false,
  changed = false,
  onChange,
}: {
  title: string;
  detail?: string;
  checked: boolean;
  disabled?: boolean;
  changed?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="erp-permission-choice" data-selected={checked} data-changed={changed}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span className="erp-permission-copy">
        <strong>{title}</strong>
        {detail ? <small>{detail}</small> : null}
      </span>
      {changed ? <span className="erp-permission-change">تغيير غير محفوظ</span> : null}
    </label>
  );
}
