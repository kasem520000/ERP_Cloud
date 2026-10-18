'use client';

/**
 * P-M6 — استمارة التواصل وطلب العرض: مكوّنٌ واحد وبوّابتان (`kind`).
 *
 * ولماذا مكوّنٌ واحد؟ لأن الحقول واحدة والفرق في النصّ والمصدر — ونسختان تعنيان حقلين
 * يُضافان إلى إحداهما ويُنسيان في الأخرى، ثم استمارتان لا تتشابهان في الحماية.
 *
 * وأربعة قرارات ظاهرة هنا:
 *
 *   * **المصيدة قبل أي إرسال**: حقلٌ اسمه `website` مخفيٌّ بـCSS (لا `hidden`) — إنسانٌ لا
 *     يراه، والماسح الآلي يملؤه، والخادم يقابله بـ202 بلا صفّ.
 *   * **الرسالة تُعرض بجانب حقلها** لا في رأس الاستمارة: من يخطئ في البريد يجد السبب تحته.
 *   * **بعد النجاح لا يبقى حقل**: الاستمارة تُستبدل ببطاقةٍ فيها **المرجع** — فمن ينسى هل
 *     أرسل أم لا، يجد الرقم أمامه.
 *   * **الوسوم تُلتقط لحظة الإرسال** من `location` و`referrer`، لا لحظة تحميل الصفحة.
 */

import Link from 'next/link';
import { useCallback, useState } from 'react';
import type { LeadAccepted } from '@erp/contracts';

import { PortalError, portalFetch } from '../lib/api';
import { trackGoal } from '../lib/track';
import {
  LEAD_HONEYPOT_FIELD,
  emptyLeadDraft,
  leadFormConfig,
  leadPayload,
  leadProblemMessage,
  leadSuccessMessage,
  leadUtm,
  leadVerdict,
  sanitizeBranchCount,
  type LeadDraft,
  type LeadFormKind,
} from '../lib/leads';

export function LeadForm({ kind, presetPlan }: { kind: LeadFormKind; presetPlan?: string }) {
  const config = leadFormConfig[kind];
  const [draft, setDraft] = useState<LeadDraft>({ ...emptyLeadDraft, planInterest: presetPlan ?? '' });
  const [error, setError] = useState<{ field: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<LeadAccepted | null>(null);

  const update = useCallback(<K extends keyof LeadDraft>(key: K, value: LeadDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  }, []);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const verdict = leadVerdict(draft);
    if (!verdict.ok) {
      setError({ field: String(verdict.field), message: verdict.message });
      const target = event.currentTarget.elements.namedItem(String(verdict.field));
      if (target instanceof HTMLElement) target.focus();
      return;
    }

    setBusy(true);
    setError(null);
    try {
      // Campaign context is captured when submitting, not frozen when the component mounts.
      const utm = leadUtm({
        search: globalThis.location.search,
        referrer: globalThis.document.referrer,
        pathname: globalThis.location.pathname,
        host: globalThis.location.host,
      });
      const payload = { ...leadPayload(draft, { utm }), source: config.source };
      const data = await portalFetch<LeadAccepted>('/public/leads', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setAccepted(data);
      // P-M10 — «طلب عرض» يُقاس عند قبول الخادم للطلب (بمرجعه) لا عند النقر.
      trackGoal('request_demo', { source: config.source });
    } catch (failure) {
      const status = failure instanceof PortalError ? failure.status : 0;
      const code = failure instanceof PortalError ? failure.code : undefined;
      const detail = failure instanceof Error ? failure.message : undefined;
      setError({ field: 'form', message: leadProblemMessage(status, code, detail) });
    } finally {
      setBusy(false);
    }
  };

  if (accepted) {
    const success = leadSuccessMessage(accepted.reference);
    return (
      <section className="lead-page lead-success" role="status" aria-live="polite">
        <p className="lead-eyebrow">{config.headingAr}</p>
        <h1>{success.titleAr}</h1>
        <p className="muted">{success.bodyAr}</p>
        <p className="lead-reference">
          <span className="muted">رقم الطلب</span> <bdi className="reference">{success.reference}</bdi>
        </p>
        <Link className="text-link" href={config.alternateHref}>
          {config.alternateLabelAr}
        </Link>
      </section>
    );
  }

  const fieldError = (name: keyof LeadDraft) =>
    error?.field === name ? (
      <span id={`lead-${kind}-${name}-error`} className="field-error" role="alert">
        {error.message}
      </span>
    ) : null;
  const fieldState = (name: keyof LeadDraft) => ({
    'aria-invalid': error?.field === name ? true : undefined,
    'aria-describedby': error?.field === name ? `lead-${kind}-${name}-error` : undefined,
  });

  return (
    <div className="lead-page">
      <header className="lead-hero">
        <p className="lead-eyebrow">{config.eyebrowAr}</p>
        <h1>{config.headingAr}</h1>
        <p className="muted">{config.introAr}</p>
      </header>

      <div className="lead-frame">
        <section className="lead-panel" aria-label={config.formTitleAr}>
          <h2>{config.formTitleAr}</h2>
          <p className="muted">{config.formHintAr}</p>
          <form className="form lead-form" method="post" onSubmit={submit} noValidate>
            {error?.field === 'form' ? (
              <p className="form-error" role="alert">
                {error.message}
              </p>
            ) : null}

            <div className="field-row">
              <label className="field">
                <span>
                  الاسم <span className="lead-required">مطلوب</span>
                </span>
                <input
                  className="input"
                  name="fullName"
                  {...fieldState('fullName')}
                  value={draft.fullName}
                  onChange={(event) => update('fullName', event.target.value)}
                  autoComplete="name"
                  required
                />
                {fieldError('fullName')}
              </label>

              <label className="field">
                <span>الشركة</span>
                <input
                  className="input"
                  name="companyName"
                  {...fieldState('companyName')}
                  value={draft.companyName}
                  onChange={(event) => update('companyName', event.target.value)}
                  autoComplete="organization"
                />
                {fieldError('companyName')}
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>
                  البريد الإلكتروني <span className="lead-required">مطلوب</span>
                </span>
                <input
                  className="input"
                  name="email"
                  {...fieldState('email')}
                  type="email"
                  dir="ltr"
                  value={draft.email}
                  onChange={(event) => update('email', event.target.value)}
                  autoComplete="email"
                  required
                />
                {fieldError('email')}
              </label>

              <label className="field">
                <span>الهاتف</span>
                <input
                  className="input"
                  name="phone"
                  {...fieldState('phone')}
                  dir="ltr"
                  value={draft.phone}
                  onChange={(event) => update('phone', event.target.value)}
                  autoComplete="tel"
                />
                {fieldError('phone')}
              </label>
            </div>

            <div className="field-row">
              <label className="field">
                <span>عدد الفروع</span>
                <input
                  className="input"
                  name="branchCount"
                  {...fieldState('branchCount')}
                  inputMode="numeric"
                  value={draft.branchCount}
                  onChange={(event) => update('branchCount', sanitizeBranchCount(event.target.value))}
                />
                {fieldError('branchCount')}
              </label>

              <label className="field">
                <span>الباقة التي تهمّك (اختياري)</span>
                <input
                  className="input"
                  name="planInterest"
                  {...fieldState('planInterest')}
                  value={draft.planInterest}
                  onChange={(event) => update('planInterest', event.target.value)}
                />
                {fieldError('planInterest')}
              </label>
            </div>

            <label className="field">
              <span>
                {config.messageLabelAr} <span className="lead-required">مطلوب</span>
              </span>
              <textarea
                className="input"
                name="message"
                {...fieldState('message')}
                rows={5}
                value={draft.message}
                onChange={(event) => update('message', event.target.value)}
                placeholder={config.messagePlaceholderAr}
                required
              />
              {fieldError('message')}
            </label>

            <label className="check">
              <input
                type="checkbox"
                checked={draft.acceptsMarketing}
                onChange={(event) => update('acceptsMarketing', event.target.checked)}
              />
              <span>أوافق على استلام تحديثات المنتج والعروض (اختياري، ويمكن سحب الموافقة في أي وقت).</span>
            </label>

            {/*
              المصيدة: مخفيّةٌ بـCSS لا بـ`hidden` — بعض الماسحات تتجاهل `display:none`، وملءُ
              حقلٍ «مخفيٍّ» هو ما يكشفها. الحاوية مقصوصة بصرياً وموسومة `aria-hidden`،
              والإدخال خارج ترتيب التنقّل بـ`tabIndex=-1` دون إزاحة الصفحة أفقياً.
            */}
            <div className="hp-field" aria-hidden="true">
              <label>
                <span>موقعك</span>
                <input
                  className="input"
                  tabIndex={-1}
                  autoComplete="off"
                  name={LEAD_HONEYPOT_FIELD}
                  value={draft[LEAD_HONEYPOT_FIELD]}
                  onChange={(event) => update(LEAD_HONEYPOT_FIELD, event.target.value)}
                />
              </label>
            </div>

            <div className="form-actions">
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'جارٍ الإرسال…' : kind === 'demo' ? 'اطلب العرض' : 'أرسل الرسالة'}
              </button>
              <span className="muted small">تُستخدم بياناتك للرد على طلبك. تحديثات المنتج اختيارية.</span>
            </div>
          </form>
        </section>

        <aside className="lead-guide" aria-label={config.flowTitleAr}>
          <h2>{config.flowTitleAr}</h2>
          <ol>
            {config.flowStepsAr.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p>طلبك لا ينشئ حساباً ولا يشغّل معاملة مالية.</p>
          <Link className="text-link" href={config.alternateHref}>
            {config.alternateLabelAr}
          </Link>
          <Link className="text-link" href="/legal/privacy">
            اقرأ سياسة الخصوصية
          </Link>
        </aside>
      </div>
    </div>
  );
}
