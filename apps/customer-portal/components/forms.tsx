'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { FormField } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { login } from '../lib/api';

export function LoginForm() {
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<globalThis.HTMLFormElement>) {
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
      globalThis.location.assign(session.mustChangePassword ? '/auth/change-password' : '/portal');
    } catch (loginError) {
      setError(arabicErrorText(loginError, 'تعذر تسجيل الدخول. حاول مجدداً.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="form" onSubmit={submit} noValidate>
      <FormField label="رمز الشركة (المورد)">
        <input
          className="input"
          name="tenantCode"
          autoComplete="organization"
          dir="ltr"
          aria-label="tenant"
          required
        />
      </FormField>
      <FormField label="البريد الإلكتروني">
        <input
          className="input"
          name="email"
          type="email"
          autoComplete="email"
          dir="ltr"
          aria-label="email"
          required
        />
      </FormField>
      <FormField label="كلمة المرور">
        <input
          className="input"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-label="password"
          required
        />
      </FormField>
      {error ? (
        <p role="alert" className="alert danger">
          {error}
        </p>
      ) : null}
      <button className="btn primary" type="submit" disabled={loading}>
        {loading ? 'جارٍ التحقق...' : 'تسجيل الدخول'}
      </button>
      <a className="muted" href="/auth/forgot">
        نسيت كلمة المرور؟
      </a>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, setState] = useState<{ error: string; done: boolean; busy: boolean }>({
    error: '',
    done: false,
    busy: false,
  });

  async function submit(event: FormEvent<globalThis.HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = String(form.get('next'));
    if (next !== String(form.get('confirm'))) {
      setState({ error: 'كلمتا المرور غير متطابقتين', done: false, busy: false });
      return;
    }
    setState({ error: '', done: false, busy: true });
    try {
      const { changePassword } = await import('../lib/api');
      await changePassword(String(form.get('current')), next);
      setState({ error: '', done: true, busy: false });
      // All sessions are revoked server-side after a password change.
      globalThis.setTimeout(() => globalThis.location.assign('/auth/login'), 1500);
    } catch (error) {
      setState({
        error: error instanceof Error ? error.message : 'تعذّر تغيير كلمة المرور',
        done: false,
        busy: false,
      });
    }
  }

  if (state.done)
    return (
      <p className="alert ok" role="status">
        تم تغيير كلمة المرور. سيتم تحويلك لتسجيل الدخول من جديد…
      </p>
    );

  return (
    <form className="form" onSubmit={submit} noValidate>
      <FormField label="كلمة المرور الحالية أو المؤقتة">
        <input className="input" name="current" type="password" autoComplete="current-password" required />
      </FormField>
      <FormField label="كلمة المرور الجديدة" hint="12 حرفاً على الأقل">
        <input
          className="input"
          name="next"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
        />
      </FormField>
      <FormField label="تأكيد كلمة المرور الجديدة">
        <input
          className="input"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
        />
      </FormField>
      {state.error ? (
        <p role="alert" className="alert danger">
          {state.error}
        </p>
      ) : null}
      <button className="btn primary" type="submit" disabled={state.busy}>
        {state.busy ? 'جارٍ الحفظ…' : 'حفظ كلمة المرور'}
      </button>
    </form>
  );
}
