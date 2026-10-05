'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

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
 * Detection is behavioural, not guesswork: a token that can read `/me` with a
 * staff membership routes to staff, a token that can read `/portal/me` routes to
 * the portal. The access token is handed over via a short-lived `?token=` bridge
 * the target app consumes and strips from the address bar.
 */
export function SmartLogin() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
    setLoading(true);
    const form = new FormData(event.currentTarget);
    try {
      const session = await login({
        tenantCode: String(form.get('tenantCode')).trim(),
        email: String(form.get('email')).trim(),
        password: String(form.get('password')),
      });
      storeToken(session.accessToken);
      const target = await detect(session.accessToken);
      const tenantCode = String(form.get('tenantCode')).trim();
      const bridge = `token=${encodeURIComponent(session.accessToken)}&refresh=${encodeURIComponent(session.refreshToken)}&tenant=${encodeURIComponent(tenantCode)}`;
      if (target.kind === 'staff') {
        const path = target.mustChangePassword ? '/settings/change-password' : '/';
        globalThis.location.assign(`${surfaceHref('staff', path)}?${bridge}`);
      } else if (target.kind === 'portal') {
        const path = session.mustChangePassword ? '/auth/change-password' : '/portal';
        globalThis.location.assign(`${surfaceHref('portal', path)}?${bridge}`);
      } else {
        setError('تعذر تحديد نوع الحساب. تواصل مع المورد أو إدارة المنصة.');
      }
    } catch (loginError) {
      if (loginError instanceof PortalError && loginError.code === 'MFA_REQUIRED') {
        setError('MFA_REQUIRED');
      } else {
        setError(loginError instanceof Error ? loginError.message : 'تعذر تسجيل الدخول');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <input className="input" name="tenantCode" placeholder="رمز المنشأة" aria-label="tenant" required />
      <input className="input" name="email" type="email" placeholder="البريد الإلكتروني" aria-label="email" required />
      <input className="input" name="password" type="password" placeholder="كلمة المرور" aria-label="password" required />
      {error === 'MFA_REQUIRED' ? (
        <p role="alert" className="muted">
          حسابك محمي بالتحقق بخطوتين — أكمل الدخول من <a href={surfaceHref('staff', '/')}>لوحة الإدارة</a>.
        </p>
      ) : error ? (
        <p role="alert" className="muted">
          {error}
        </p>
      ) : null}
      <button className="btn primary" type="submit" disabled={loading}>
        {loading ? 'جارٍ التحقق...' : 'تسجيل الدخول'}
      </button>
    </form>
  );
}
