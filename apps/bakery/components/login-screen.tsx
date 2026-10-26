'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { ApiError, apiErrorText, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { handoffAction } from '@erp/web-core/token-bridge';

const MARKETING_URL = (process.env.NEXT_PUBLIC_MARKETING_URL ?? '').replace(/\/+$/, '');

const HANDOFF_FAILED_AR =
  'رابط الدخول المسلَّم منتهٍ أو مُستعمل سابقاً — سجّل الدخول مباشرةً أدناه.';

type AuthStep = 'credentials' | 'mfa' | 'forgot' | 'reset';

/**
 * شاشة تسجيل الدخول الموحّدة لواجهة المخابز والتوزيع — مطابقة في التصميم والتجربة
 * لشاشة تسجيل الدخول في بقيّة تطبيقات النظام (دعم التحقّق الثنائي MFA واستعادة
 * وتعيين كلمة المرور ورابط الاشتراك الجديد).
 */
export function LoginScreen({ initialError }: { initialError?: string }) {
  const { signIn } = useSession();
  const params = useSearchParams();
  const urlResetToken = params.get('resetToken') ?? '';
  const handoffFailed = handoffAction(params.toString()).kind === 'failed';
  const justJoined = params.get('joined') === '1';

  const [step, setStep] = useState<AuthStep>(urlResetToken ? 'reset' : 'credentials');
  const [tenantCode, setTenantCode] = useState(params.get('tenant') ?? '');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [resetToken, setResetToken] = useState(urlResetToken);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(
    initialError ?? (handoffFailed ? HANDOFF_FAILED_AR : undefined),
  );
  const [notice, setNotice] = useState<string | undefined>();

  useEffect(() => {
    if (urlResetToken) {
      setResetToken(urlResetToken);
      setStep('reset');
    }
  }, [urlResetToken]);

  async function attempt(code?: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      await signIn(email.trim(), password, tenantCode.trim(), code);
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'MFA_REQUIRED') {
        setStep('mfa');
      } else {
        setError(apiErrorText(caught, 'تعذّر تسجيل الدخول. تحقّق من رمز الشركة والبريد وكلمة المرور.'));
      }
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot() {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const res = await apiPost<{ data?: { ok: boolean; message?: string }; message?: string }>(
        '/auth/forgot-password',
        {
          email: email.trim(),
          ...(tenantCode.trim() ? { tenantCode: tenantCode.trim() } : {}),
        },
      );
      setNotice(
        res?.message ??
          res?.data?.message ??
          'إذا كان البريد الإلكتروني مسجّلاً لدينا، فقد أُرسل رمز ورابط استعادة كلمة المرور.',
      );
      setStep('reset');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر إرسال طلب استعادة كلمة المرور.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitReset() {
    if (newPassword !== confirmPassword) {
      setError('كلمتا المرور غير متطابقتين.');
      return;
    }
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const res = await apiPost<{ data?: { ok: boolean; message?: string }; message?: string }>(
        '/auth/reset-password',
        {
          token: resetToken.trim(),
          newPassword,
        },
      );
      setNotice(
        res?.message ??
          res?.data?.message ??
          'تمت إعادة تعيين كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.',
      );
      setPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setStep('credentials');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر إعادة تعيين كلمة المرور.'));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (step === 'mfa') void attempt(mfaCode.trim());
    else if (step === 'forgot') void submitForgot();
    else if (step === 'reset') void submitReset();
    else void attempt();
  }

  const titleText =
    step === 'mfa'
      ? 'التحقّق الثنائي'
      : step === 'forgot'
        ? 'استعادة كلمة المرور'
        : step === 'reset'
          ? 'تعيين كلمة مرور جديدة'
          : 'تسجيل الدخول';

  const subtitleText =
    step === 'mfa'
      ? 'أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة لإكمال الدخول.'
      : step === 'forgot'
        ? 'أدخل بريدك الإلكتروني المسجّل لإرسال رمز ورابط استعادة كلمة المرور.'
        : step === 'reset'
          ? 'أدخل رمز الاستعادة المرسل إلى بريدك الإلكتروني وكلمة المرور الجديدة.'
          : 'أدخل رمز الشركة وبريدك الإلكتروني وكلمة المرور للوصول إلى نظام الإنتاج والتوزيع.';

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <span className="exec-eyebrow">Cloud ERP · Bakery &amp; Distribution</span>
        <span className="logo big">ERP</span>
        <h1>منصة سحاب المحاسبية — المخابز والتوزيع</h1>
        <p>
          إدارة متكاملة لدفعات الإنتاج، أحمال التوزيع، عهد المناديب، التحصيل النقدي والآجل، وإقفال
          الورديات في سجلّ محاسبي موحّد مع لوحة المنشأة.
        </p>
        <ul>
          <li>عزل كامل لبيانات كل منشأة وصلاحيات دقيقة للإدارة والمناديب</li>
          <li>متابعة فورية للعهد والأوزان والمرتجعات والذمم بتوقيت مكة المكرمة</li>
          <li>تطبيق ميداني للمندوب يعمل متصلاً ودون اتصال مع مطابقة آلية</li>
        </ul>
        <p className="m-0 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-muted">
          إنتاج المخابز · توزيع المناديب · رقابة مالية ومخزنية
        </p>
      </div>

      <form className="auth-card" onSubmit={submit}>
        <h2>{titleText}</h2>
        <p className="muted">{subtitleText}</p>

        {justJoined && step === 'credentials' && (
          <p className="alert ok" role="status">
            تم تفعيل حسابك بنجاح — يمكنك تسجيل الدخول الآن.
          </p>
        )}

        {notice && (
          <p className="alert ok" role="status">
            {notice}
          </p>
        )}

        {step === 'credentials' && (
          <>
            <label className="field">
              <span>رمز الشركة</span>
              <input
                className="input"
                value={tenantCode}
                onChange={(event) => setTenantCode(event.target.value)}
                placeholder="company-code"
                autoComplete="organization"
                required
                dir="ltr"
              />
            </label>

            <label className="field">
              <span>البريد الإلكتروني</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="user@company.com"
                autoComplete="username"
                required
                dir="ltr"
              />
            </label>

            <label className="field">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>كلمة المرور</span>
                <button
                  type="button"
                  onClick={() => {
                    setError(undefined);
                    setNotice(undefined);
                    setStep('forgot');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--color-brand-600, var(--brand))',
                    fontSize: '0.82rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  نسيت كلمة السر؟
                </button>
              </div>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                required
                dir="ltr"
              />
            </label>
          </>
        )}

        {step === 'mfa' && (
          <label className="field">
            <span>رمز التحقّق الثنائي</span>
            <input
              className="input"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
              placeholder="000000"
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
              required
              dir="ltr"
            />
          </label>
        )}

        {step === 'forgot' && (
          <>
            <label className="field">
              <span>رمز الشركة (اختياري)</span>
              <input
                className="input"
                value={tenantCode}
                onChange={(event) => setTenantCode(event.target.value)}
                placeholder="company-code"
                autoComplete="organization"
                dir="ltr"
              />
            </label>

            <label className="field">
              <span>البريد الإلكتروني</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="user@company.com"
                autoComplete="username"
                required
                dir="ltr"
              />
            </label>
          </>
        )}

        {step === 'reset' && (
          <>
            <label className="field">
              <span>رمز الاستعادة</span>
              <input
                className="input"
                value={resetToken}
                onChange={(event) => setResetToken(event.target.value)}
                placeholder="rst_..."
                required
                dir="ltr"
              />
            </label>

            <label className="field">
              <span>كلمة المرور الجديدة (12 حرفاً على الأقل)</span>
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={12}
                autoComplete="new-password"
                required
                dir="ltr"
              />
            </label>

            <label className="field">
              <span>تأكيد كلمة المرور الجديدة</span>
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={12}
                autoComplete="new-password"
                required
                dir="ltr"
              />
            </label>
          </>
        )}

        {error && (
          <p className="alert danger" role="alert">
            {error}
          </p>
        )}

        <button className="btn primary block" type="submit" disabled={busy} aria-busy={busy || undefined}>
          {busy
            ? step === 'mfa'
              ? 'جارٍ التحقّق…'
              : 'جارٍ التنفيذ…'
            : step === 'mfa'
              ? 'تأكيد الرمز'
              : step === 'forgot'
                ? 'إرسال رابط ورمز الاستعادة'
                : step === 'reset'
                  ? 'حفظ كلمة المرور الجديدة'
                  : 'تسجيل الدخول'}
        </button>

        {step === 'forgot' && (
          <button
            className="btn block"
            type="button"
            onClick={() => {
              setError(undefined);
              setStep('reset');
            }}
          >
            لدي رمز الاستعادة بالفعل
          </button>
        )}

        {step !== 'credentials' ? (
          <button
            className="btn block"
            type="button"
            onClick={() => {
              setStep('credentials');
              setMfaCode('');
              setError(undefined);
            }}
          >
            العودة لتسجيل الدخول
          </button>
        ) : (
          <a className="btn block" href={`${MARKETING_URL || '/'}/onboarding`}>
            إنشاء اشتراك جديد
          </a>
        )}
      </form>
    </div>
  );
}
