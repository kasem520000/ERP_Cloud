import type { CSSProperties, ReactNode } from 'react';

import { cn } from '../lib/cn';

/**
 * الشكل البنيوي الموحّد لكل شاشة — لا الألوان.
 *
 * المراجعة السابقة كانت تُبدّل التوكنز فيتبدّل اللون، وتبقى الشاشة كما هي:
 * رأسٌ بحجمٍ هنا وحجمٍ هناك، بطاقاتٌ عائمة بلا رأس، جداول مبطّنة تارةً
 * وملتصقةً تارةً، وأزرارٌ في أعلى الصفحة أو أسفلها بحسب من كتبها.
 *
 * هذه المكوّنات تسدّ ذلك الفراغ: الصفحة صار لها إطارٌ واحد (رأس + جسم)،
 * والقسم له عنوانه وسياقه وإجراؤه، واللوحة لها رأسٌ وجسمٌ وتذييل، وشريط
 * المؤشرات سطحٌ واحد مقسوم، وشريط التصفية نطاقٌ واحد، والنموذج أقسامٌ
 * وحقولٌ وشريط حفظ ثابت. الشاشة تُركَّب من هذه القطع، فلا تختلف شاشتان
 * في المسافات ولا في ترتيب المعلومات — ويبقى لكل شاشة ترتيبها الخاص داخل
 * الإطار نفسه.
 *
 * القواعد كلها في `controls.css` بأصناف `ui-`، لا Tailwind: سطح المنصة
 * والبوابة لا يترجمان Tailwind، والبنية يجب أن تكون واحدة في الاثنين.
 */

/* ------------------------------------------------------------------ page */

/** إطار الشاشة: رأس ثابت ثم جسم بمسافات واحدة. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('ui-page', className)}>{children}</div>;
}

/**
 * رأس الصفحة: المسار فوق العنوان، ثم العنوان، ثم سطر الشرح، والإجراءات
 * في الطرف المقابل. `meta` شريطٌ صغير تحتهما للسياق (الفترة، الفرع، الحالة)
 * فلا يتحوّل الشرح إلى فقرة.
 */
export function PageHead({
  title,
  description,
  breadcrumbs,
  actions,
  meta,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumbs?: Array<{ label: string; href?: string }> | string[];
  actions?: ReactNode;
  meta?: ReactNode;
  eyebrow?: ReactNode;
}) {
  const trail =
    breadcrumbs?.map((crumb) => (typeof crumb === 'string' ? { label: crumb, href: undefined } : crumb)) ??
    [];

  return (
    <header className="ui-page-head">
      <div className="ui-page-head-copy">
        {trail.length > 0 ? (
          <nav className="ui-crumbs" aria-label="مسار الصفحة">
            {trail.map((crumb, index) => (
              <span key={`${crumb.label}-${index}`}>
                {index > 0 ? (
                  <span className="ui-crumbs-sep" aria-hidden>
                    /
                  </span>
                ) : null}
                {crumb.href ? <a href={crumb.href}>{crumb.label}</a> : crumb.label}
              </span>
            ))}
          </nav>
        ) : null}
        {eyebrow ? <span className="ui-eyebrow">{eyebrow}</span> : null}
        <h1 className="ui-page-title">{title}</h1>
        {description ? <p className="ui-page-sub">{description}</p> : null}
      </div>
      {actions ? <div className="ui-page-actions no-print">{actions}</div> : null}
      {meta ? <div className="ui-page-meta">{meta}</div> : null}
    </header>
  );
}

/* --------------------------------------------------------------- section */

/**
 * قسم: عنوانٌ صغير فوق، ثم محتوى. يفصل مجموعات الشاشة الواحدة بلا خطوط
 * ثقيلة، ويعطي كل مجموعة عنوانها وإجراءها بدل أن تتناثر البطاقات.
 */
export function Section({
  title,
  hint,
  actions,
  eyebrow,
  children,
  className,
  id,
  style,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  children?: ReactNode;
  className?: string;
  id?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={cn('ui-section', className)} id={id} style={style}>
      {title || actions ? (
        <header className="ui-section-head">
          <div className="ui-section-copy">
            {eyebrow ? <span className="ui-eyebrow">{eyebrow}</span> : null}
            {title ? <h2 className="ui-section-title">{title}</h2> : null}
            {hint ? <p className="ui-section-hint">{hint}</p> : null}
          </div>
          {actions ? <div className="ui-section-actions no-print">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

/* ----------------------------------------------------------------- panel */

/**
 * لوحة: السطح الذي يحمل المحتوى. الرأس شريطٌ مفصول، والجسم هو الحشو،
 * و`flush` للجداول كي تلتصق بالحدود، والتذييل للعدّاد أو أزرار النهاية.
 */
export function Panel({
  title,
  hint,
  actions,
  children,
  footer,
  flush = false,
  className,
  bodyClassName,
  id,
  style,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  flush?: boolean;
  className?: string;
  bodyClassName?: string;
  id?: string;
  style?: CSSProperties;
}) {
  return (
    <section className={cn('ui-panel', className)} id={id} style={style}>
      {title || actions ? (
        <header className="ui-panel-head">
          <div className="ui-panel-copy">
            {title ? <h2 className="ui-panel-title">{title}</h2> : null}
            {hint ? <p className="ui-panel-hint">{hint}</p> : null}
          </div>
          {actions ? <div className="ui-panel-actions no-print">{actions}</div> : null}
        </header>
      ) : null}
      <div className={cn('ui-panel-body', flush && 'ui-panel-body-flush', bodyClassName)}>{children}</div>
      {footer ? <footer className="ui-panel-foot">{footer}</footer> : null}
    </section>
  );
}

/* -------------------------------------------------------------- kpis ---- */

export type KpiItem = {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'up' | 'down' | 'warn';
  href?: string;
};

/**
 * شريط المؤشرات: سطحٌ واحد مقسوم بخطوط رأسية، لا أربع بطاقات عائمة.
 * هذا هو الفرق البنيوي: المؤشرات تقرأ كسطرٍ واحد لا كأربعة إعلانات.
 */
export function KpiStrip({ items, className }: { items: KpiItem[]; className?: string }) {
  return (
    <div className={cn('ui-kpi-strip', className)}>
      {items.map((item) => {
        const inner = (
          <>
            <span className="ui-kpi-label">
              {item.icon ? (
                <span className="ui-kpi-icon" aria-hidden>
                  {item.icon}
                </span>
              ) : null}
              {item.label}
            </span>
            <span className={cn('ui-kpi-value', item.tone && item.tone !== 'neutral' && `is-${item.tone}`)}>
              {item.value}
            </span>
            {item.hint ? <span className="ui-kpi-hint">{item.hint}</span> : null}
          </>
        );
        return item.href ? (
          <a className="ui-kpi-cell" href={item.href} key={item.label}>
            {inner}
          </a>
        ) : (
          <div className="ui-kpi-cell" key={item.label}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------- filter bar */

/** شريط التصفية: نطاقٌ واحد يضم الحقول والإجراء في صفٍّ واحد. */
export function FilterBand({
  children,
  actions,
  className,
  summary,
}: {
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
  summary?: ReactNode;
}) {
  return (
    <div className={cn('ui-filter-bar', className)}>
      <div className="ui-filter-fields">{children}</div>
      {actions || summary ? (
        <div className="ui-filter-actions">
          {summary ? <span className="ui-filter-summary">{summary}</span> : null}
          {actions}
        </div>
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- split */

/** تخطيط مزدوج: العمود الرئيسي ثم عمود السياق (320px) في الشاشات العريضة. */
export function Split({
  children,
  rail,
  className,
}: {
  children: ReactNode;
  rail?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('ui-split', !rail && 'ui-split-single', className)}>
      <div className="ui-split-main">{children}</div>
      {rail ? <aside className="ui-split-rail">{rail}</aside> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ form */

/** قسم نموذج: عنوانٌ على اليمين وحقولٌ على اليسار، بلا بطاقات متداخلة. */
export function FormSection({
  title,
  hint,
  children,
  actions,
  className,
}: {
  title: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('ui-form-section', className)}>
      <header className="ui-form-section-head">
        <h3 className="ui-form-section-title">{title}</h3>
        {hint ? <p className="ui-form-section-hint">{hint}</p> : null}
      </header>
      <div className="ui-form-section-body">
        {children}
        {actions ? <div className="ui-form-section-actions">{actions}</div> : null}
      </div>
    </section>
  );
}

/**
 * شبكة حقول موحّدة: أربعة أعمدة على الشاشات العريضة — وهي نفسُها شبكةُ
 * `.form-grid` القديمة — ثم ثلاثة تحت 1180px واثنان تحت 900px.
 */
export function FormGrid({
  children,
  cols = 4,
  className,
}: {
  children: ReactNode;
  cols?: 1 | 2 | 3 | 4;
  className?: string;
}) {
  return <div className={cn('ui-form-grid', `ui-form-grid-${cols}`, className)}>{children}</div>;
}

/** شريط إجراءات النموذج: يلتصق بأسفل النافذة عند التمرير، والملاحظة على اليمين. */
export function FormActions({ children, note }: { children: ReactNode; note?: ReactNode }) {
  return (
    <div className="ui-form-actions">
      {note ? <span className="ui-form-actions-note">{note}</span> : <span />}
      <div className="ui-form-actions-buttons no-print">{children}</div>
    </div>
  );
}
