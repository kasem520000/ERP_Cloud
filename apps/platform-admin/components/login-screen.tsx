'use client';

import { useState } from 'react';

import { ApiError } from '../lib/api';
import { useSession } from '../lib/session';

/**
 * Sign-in screen for the platform console. Deliberately Arabic-only and WITHOUT a
 * signup path: platform operators are provisioned by hand, never self-service.
 * Supports the TOTP second factor like the staff surface.
 */
export function LoginScreen({ initialError }: { initialError?: string }) {
  const { signIn } = useSession();
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [tenantCode, setTenantCode] = useState('platform');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);

  async function attempt(code?: string) {
    setBusy(true);
    setError(undefined);
    try {
      await signIn(email.trim(), password, tenantCode.trim(), code);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === 'MFA_REQUIRED') {
          setStep('mfa');
        } else if (caught.status === 401) setError('بيانات الدخول غير صحيحة.');
        else if (caught.status === 423) setError('الحساب موقوف مؤقتاً.');
        else if (caught.status === 429) setError('محاولات كثيرة. انتظر قليلاً ثم أعد المحاولة.');
        else setError(caught.message);
      } else {
        setError('تعذر الاتصال بالخادم.');
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (step === 'mfa') void attempt(mfaCode.trim());
    else void attempt();
  }

  return (
    <div className="auth-page">
      <div className="auth-brand">
        <span className="logo big">ERP</span>
        <h1>لوحة تحكم المنصة</h1>
        <p>إدارة المنشآت والاشتراكات والتراخيص — لمشغّلي المنصة فقط.</p>
      </div>

      <form className="auth-card" onSubmit={submit}>
        <h2>{step === 'mfa' ? 'التحقق بخطوتين' : 'تسجيل الدخول'}</h2>
        <p className="muted">
          {step === 'mfa' ? 'أدخل الرمز من تطبيق المصادقة.' : 'سجّل الدخول بحساب مشغّل المنصة.'}
        </p>

        {step === 'credentials' ? (
          <>
            <label className="field">
              <span>رمز المنشأة</span>
              <input
                className="input"
                value={tenantCode}
                onChange={(event) => setTenantCode(event.target.value)}
                placeholder="platform"
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
                autoComplete="username"
                required
                dir="ltr"
              />
            </label>

            <label className="field">
              <span>كلمة المرور</span>
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
        ) : (
          <label className="field">
            <span>رمز المصادقة</span>
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

        {error && (
          <p className="alert danger" role="alert">
            {error}
          </p>
        )}

        <button className="btn primary block" type="submit" disabled={busy}>
          {busy ? 'جارٍ التحقق…' : step === 'mfa' ? 'تحقق' : 'دخول'}
        </button>

        {step === 'mfa' && (
          <button
            className="btn block"
            type="button"
            onClick={() => {
              setStep('credentials');
              setMfaCode('');
              setError(undefined);
            }}
          >
            رجوع
          </button>
        )}
      </form>
    </div>
  );
}
