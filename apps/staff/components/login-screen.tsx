'use client';

import { useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { ApiError } from '../lib/api';
import { useLang } from '../lib/i18n';
import { useSession } from '../lib/session';

const MARKETING_URL = (process.env.NEXT_PUBLIC_MARKETING_URL ?? '').replace(/\/+$/, '');

/**
 * Sign-in screen for the staff back office. Bilingual, keyboard friendly, with a TOTP step.
 *
 * There is deliberately NO signup mode on this surface: new tenants register on the
 * marketing site (`/onboarding`), which hands them back here with `?tenant=` prefilled.
 */
export function LoginScreen({ initialError }: { initialError?: string }) {
  const { signIn } = useSession();
  const { t } = useLang();
  const params = useSearchParams();
  const [step, setStep] = useState<'credentials' | 'mfa'>('credentials');
  const [tenantCode, setTenantCode] = useState(params.get('tenant') ?? '');
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(initialError);
  const justJoined = params.get('joined') === '1';

  async function attempt(code?: string) {
    setBusy(true);
    setError(undefined);
    try {
      await signIn(email.trim(), password, tenantCode.trim(), code);
    } catch (caught) {
      if (caught instanceof ApiError) {
        if (caught.code === 'MFA_REQUIRED') {
          // Credentials already checked out — only the authenticator code is missing.
          setStep('mfa');
        } else if (caught.status === 401) setError(t(step === 'mfa' ? 'mfa.error.invalid' : 'login.error.invalid'));
        else if (caught.status === 423) setError(t('login.error.suspended'));
        else if (caught.status === 429) setError(t('login.error.rateLimited'));
        else setError(caught.message);
      } else {
        setError(t('login.error.unreachable'));
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
        <h1>{t('app.name')}</h1>
        <p>{t('app.tagline')}</p>
        <ul>
          <li>{t('app.feature.isolation')}</li>
          <li>{t('app.feature.permissions')}</li>
          <li>{t('app.feature.audit')}</li>
        </ul>
      </div>

      <form className="auth-card" onSubmit={submit}>
        <h2>{step === 'mfa' ? t('mfa.title') : t('login.title')}</h2>
        <p className="muted">{step === 'mfa' ? t('mfa.hint') : t('login.subtitle')}</p>

        {justJoined && step === 'credentials' && (
          <p className="alert ok" role="status">
            {t('login.joined')}
          </p>
        )}

        {step === 'credentials' ? (
          <>
            <label className="field">
              <span>{t('login.tenantCode')}</span>
              <input
                className="input"
                value={tenantCode}
                onChange={(event) => setTenantCode(event.target.value)}
                placeholder="demo"
                autoComplete="organization"
                required
                dir="ltr"
              />
            </label>

            <label className="field">
              <span>{t('login.email')}</span>
              <input
                className="input"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="owner@demo.test"
                autoComplete="username"
                required
                dir="ltr"
              />
            </label>

            <label className="field">
              <span>{t('login.password')}</span>
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
            <span>{t('mfa.code')}</span>
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
          {busy ? (step === 'mfa' ? t('mfa.verifying') : t('login.busy')) : step === 'mfa' ? t('mfa.verify') : t('login.submit')}
        </button>

        {step === 'mfa' ? (
          <button
            className="btn block"
            type="button"
            onClick={() => {
              setStep('credentials');
              setMfaCode('');
              setError(undefined);
            }}
          >
            {t('mfa.back')}
          </button>
        ) : (
          <a className="btn block" href={`${MARKETING_URL}/onboarding`}>
            {t('login.signup')}
          </a>
        )}
      </form>
    </div>
  );
}
