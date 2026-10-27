'use client';

import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  QuickLoginPanel,
  RememberMeCheckbox,
  useQuickLogin,
  type QuickLoginSecret,
} from '@erp/web-core/quick-login';

import { login, PortalError, storeToken } from '../lib/api';
import { surfaceHref } from '../lib/surfaces';

type WhoAmI =
  | { kind: 'staff'; mustChangePassword: boolean }
  | { kind: 'portal' }
  | { kind: 'unknown' };

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

/**
 * Smart entry login: one form that authenticates against the shared API and then
 * routes the visitor to the surface their account belongs to — tenant staff go to
 * the staff app, supplier-issued buyer accounts go to the customer portal.
 *
 * Includes a self-service Forgot Password / Reset Password flow (`POST /auth/forgot-password`
 * and `POST /auth/reset-password`).
 */
export function SmartLogin() {
  const [mode, setMode] = useState<'login' | 'forgot' | 'reset'>('login');
  const [staffTarget, setStaffTarget] = useState<'staff' | 'bakery'>('staff');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(false);
  const quickLogin = useQuickLogin('marketing');
  const pendingQuickSecretRef = useRef<QuickLoginSecret | null>(null);

  async function detect(token: string): Promise<WhoAmI> {
    const headers = { authorization: `Bearer ${token}` };
    try {
      const me = await fetch(`${baseUrl}/me`, { headers }).then((response) => (response.ok ? response.json() : null));
      const membership = me?.data?.membership ?? me?.membership;
      if (membership?.tenantId) {
        return { kind: 'staff', mustChangePassword: me?.data?.user?.mustChangePassword === true };
      }
    } catch {
      /* fall through to the portal probe */
    }
    try {
      const profile = await fetch(`${baseUrl}/portal/me`, { headers }).then((response) => (response.ok ? response.json() : null));
      if (profile) return { kind: 'portal' };
    } catch {
      /* unknown account */
    }
    return { kind: 'unknown' };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setNotice('');
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      if (mode === 'forgot') {
        const res = await fetch(`${baseUrl}/auth/forgot-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: String(form.get('email') ?? '').trim(),
            tenantCode: String(form.get('tenantCode') ?? '').trim() || undefined,
          }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.detail || payload?.message || 'تعذر إرسال رمز الاستعادة');
        }
        setNotice(payload?.data?.message || 'تم إرسال رمز ورابط استعادة كلمة المرور إلى بريدك الإلكتروني.');
        setMode('reset');
        return;
      }

      if (mode === 'reset') {
        const res = await fetch(`${baseUrl}/auth/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: String(form.get('token') ?? '').trim(),
            newPassword: String(form.get('newPassword') ?? ''),
          }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(payload?.detail || payload?.message || 'تعذر إعادة تعيين كلمة المرور');
        }
        setNotice(payload?.data?.message || 'تم إعادة تعيين كلمة المرور بنجاح. يمكنك الآن تسجيل الدخول.');
        setMode('login');
        return;
      }

      const mfaRaw = String(form.get('mfaCode') ?? '').trim();
      const activeQuick = pendingQuickSecretRef.current;
      const targetTenant = activeQuick ? activeQuick.tenantCode.trim() : String(form.get('tenantCode')).trim();
      const targetEmail = activeQuick ? activeQuick.email.trim() : String(form.get('email')).trim();
      const targetPassword = activeQuick ? activeQuick.password : String(form.get('password'));
      const effectiveTarget = activeQuick?.staffTarget ?? staffTarget;

      const session = await login({
        tenantCode: targetTenant,
        email: targetEmail,
        password: targetPassword,
        ...(mfaRaw ? { mfaCode: mfaRaw } : {}),
      });
      if (!activeQuick) {
        await quickLogin.persistIfRemembered({
          tenantCode: targetTenant,
          email: targetEmail,
          password: targetPassword,
          staffTarget: effectiveTarget,
        });
      }
      pendingQuickSecretRef.current = null;
      storeToken(session.accessToken);
      const target = await detect(session.accessToken);

      const minted = await fetch(`${baseUrl}/auth/handoff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({}),
      });
      if (!minted.ok) {
        setError('تعذر تجهيز الجلسة. أعد المحاولة.');
        return;
      }
      const code = ((await minted.json()) as { data: { code: string } }).data.code;
      const bridge = `handoff=${encodeURIComponent(code)}`;
      if (target.kind === 'staff') {
        if (effectiveTarget === 'bakery') {
          const path = target.mustChangePassword ? '/change-password' : '/';
          globalThis.location.assign(`${surfaceHref('bakery', path)}?${bridge}`);
        } else {
          const path = target.mustChangePassword ? '/settings/change-password' : '/';
          globalThis.location.assign(`${surfaceHref('staff', path)}?${bridge}`);
        }
      } else if (target.kind === 'portal') {
        const path = session.mustChangePassword ? '/auth/change-password' : '/portal';
        globalThis.location.assign(`${surfaceHref('portal', path)}?${bridge}`);
      } else {
        setError('تعذر تحديد نوع الحساب. تواصل مع المورد أو إدارة المنصة.');
      }
    } catch (loginError) {
      if (loginError instanceof PortalError && loginError.code === 'MFA_REQUIRED') {
        setNeedsMfa(true);
        setError('MFA_REQUIRED');
      } else {
        pendingQuickSecretRef.current = null;
        setError(loginError instanceof Error ? loginError.message : 'تعذر تسجيل الدخول');
      }
    } finally {
      setLoading(false);
    }
  }

  async function submitQuickLogin() {
    setError('');
    setNotice('');
    setLoading(true);
    try {
      const secret = await quickLogin.loadSecret();
      if (!secret) {
        await quickLogin.forget();
        setError('انتهت صلاحية البيانات المحفوظة على هذا الجهاز — يرجى تسجيل الدخول مرة واحدة لحفظها مجدداً.');
        return;
      }
      pendingQuickSecretRef.current = secret;
      const effectiveTarget = secret.staffTarget ?? staffTarget;
      const session = await login({
        tenantCode: secret.tenantCode.trim(),
        email: secret.email.trim(),
        password: secret.password,
      });
      pendingQuickSecretRef.current = null;
      storeToken(session.accessToken);
      const target = await detect(session.accessToken);
      const minted = await fetch(`${baseUrl}/auth/handoff`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({}),
      });
      if (!minted.ok) {
        setError('تعذر تجهيز الجلسة. أعد المحاولة.');
        return;
      }
      const code = ((await minted.json()) as { data: { code: string } }).data.code;
      const bridge = `handoff=${encodeURIComponent(code)}`;
      if (target.kind === 'staff') {
        const destSurface = effectiveTarget === 'bakery' ? 'bakery' : 'staff';
        const path = target.mustChangePassword
          ? destSurface === 'bakery'
            ? '/change-password'
            : '/settings/change-password'
          : '/';
        globalThis.location.assign(`${surfaceHref(destSurface, path)}?${bridge}`);
      } else if (target.kind === 'portal') {
        const path = session.mustChangePassword ? '/auth/change-password' : '/portal';
        globalThis.location.assign(`${surfaceHref('portal', path)}?${bridge}`);
      } else {
        setError('تعذر تحديد نوع الحساب. تواصل مع المورد أو إدارة المنصة.');
      }
    } catch (loginError) {
      if (loginError instanceof PortalError && loginError.code === 'MFA_REQUIRED') {
        setNeedsMfa(true);
        setError('MFA_REQUIRED');
      } else {
        pendingQuickSecretRef.current = null;
        setError(loginError instanceof Error ? loginError.message : 'تعذر تسجيل الدخول');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      {notice ? (
        <p role="status" className="muted">
          {notice}
        </p>
      ) : null}

      {mode === 'login' && (
        <>
          <QuickLoginPanel
            meta={quickLogin.meta}
            busy={loading}
            onQuickSignIn={() => void submitQuickLogin()}
            onForget={() => void quickLogin.forget()}
          />

          <div className="login-target-tabs" role="radiogroup" aria-label="وجهة الدخول للموظفين">
            <button
              type="button"
              className={staffTarget === 'staff' ? 'chip active' : 'chip'}
              onClick={() => setStaffTarget('staff')}
            >
              لوحة المنشأة والمحاسبة
            </button>
            <button
              type="button"
              className={staffTarget === 'bakery' ? 'chip active' : 'chip'}
              onClick={() => setStaffTarget('bakery')}
            >
              نظام المخابز ونقاط البيع
            </button>
          </div>
          <input className="input" name="tenantCode" placeholder="رمز المنشأة" aria-label="tenant" required={!pendingQuickSecretRef.current} />
          <input className="input" name="email" type="email" placeholder="البريد الإلكتروني" aria-label="email" required={!pendingQuickSecretRef.current} />
          <input className="input" name="password" type="password" placeholder="كلمة المرور" aria-label="password" required={!pendingQuickSecretRef.current} />
          <RememberMeCheckbox
            checked={quickLogin.rememberMe}
            onChange={quickLogin.setRememberMe}
            disabled={loading}
          />
          {needsMfa ? (
            <input
              className="input mono"
              name="mfaCode"
              inputMode="numeric"
              placeholder="رمز التحقق بخطوتين (6 أرقام)"
              aria-label="mfaCode"
              required
            />
          ) : null}
        </>
      )}

      {mode === 'forgot' && (
        <>
          <input className="input" name="tenantCode" placeholder="رمز المنشأة (اختياري)" aria-label="tenant" />
          <input className="input" name="email" type="email" placeholder="البريد الإلكتروني المسجّل" aria-label="email" required />
        </>
      )}

      {mode === 'reset' && (
        <>
          <input className="input" name="token" placeholder="رمز الاستعادة (rst_...)" aria-label="token" required />
          <input
            className="input"
            name="newPassword"
            type="password"
            placeholder="كلمة المرور الجديدة (12 حرفاً على الأقل)"
            aria-label="newPassword"
            required
          />
        </>
      )}

      {error === 'MFA_REQUIRED' ? (
        <p role="alert" className="muted">
          حسابك محمي بالتحقق بخطوتين — أدخل الرمز المكوّن من 6 أرقام من تطبيق المصادقة أعلاه ثم اضغط تسجيل الدخول.
        </p>
      ) : error ? (
        <p role="alert" className="muted">
          {error}
        </p>
      ) : null}

      <button className="btn primary" type="submit" disabled={loading}>
        {loading
          ? 'جارٍ التحقق...'
          : mode === 'forgot'
            ? 'إرسال رمز الاستعادة'
            : mode === 'reset'
              ? 'حفظ كلمة المرور الجديدة'
              : 'تسجيل الدخول'}
      </button>

      {mode === 'login' ? (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setError('');
            setNotice('');
            setMode('forgot');
          }}
        >
          نسيت كلمة السر؟
        </button>
      ) : (
        <button
          type="button"
          className="btn"
          onClick={() => {
            setError('');
            setMode('login');
          }}
        >
          العودة لتسجيل الدخول
        </button>
      )}
    </form>
  );
}
