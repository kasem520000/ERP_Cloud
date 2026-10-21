export function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="ui-kpi-cell">
      <span className="ui-kpi-label">{label}</span>
      <span className="ui-kpi-value">{value}</span>
      {hint ? <span className="ui-kpi-hint">{hint}</span> : null}
    </div>
  );
}

/**
 * حالة الفراغ — نفس شكل `Empty` في بقية التطبيقات: أيقونةٌ في مربّع، عنوان، وسطرُ شرح.
 *
 * `bare` حين تكون داخل لوحة: اللوحة هي السطح، فلا نضع بطاقةً داخل بطاقة.
 */
export function Empty({ title, detail, bare = false }: { title: string; detail?: string; bare?: boolean }) {
  return (
    <div className={bare ? 'empty is-bare' : 'empty'}>
      <span className="empty-icon" aria-hidden>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        </svg>
      </span>
      <p className="empty-title">{title}</p>
      {detail ? <p className="empty-detail">{detail}</p> : null}
    </div>
  );
}
