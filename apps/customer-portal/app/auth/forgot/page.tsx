'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';
import { ContentPanel, FormField, PageFrame, PageHeader } from '@erp/ui/page';
import { arabicErrorText, arabicProblem } from '@erp/web-core/error-language';

const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';

export default function ForgotPage() {
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [tenantCode, setTenantCode] = useState('');
  const [token, setToken] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError('');
    setNotice('');
    try {
      if (step === 'request') {
        const res = await fetch(`${baseUrl}/auth/forgot-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: email.trim(),
            ...(tenantCode.trim() ? { tenantCode: tenantCode.trim() } : {}),
          }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(arabicProblem(res.status, payload?.message, payload?.detail).message);
        }
        setNotice(
          arabicErrorText(payload?.data?.message, 'تم إرسال رمز ورابط الاستعادة إلى بريدك الإلكتروني.'),
        );
        setStep('reset');
      } else {
        const res = await fetch(`${baseUrl}/auth/reset-password`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            token: token.trim(),
            newPassword,
          }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(arabicProblem(res.status, payload?.message, payload?.detail).message);
        }
        setNotice(arabicErrorText(payload?.data?.message, 'تم إعادة تعيين كلمة المرور بنجاح.'));
      }
    } catch (caught) {
      setError(arabicErrorText(caught, 'تعذر إتمام الطلب. حاول مجدداً.'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <PageFrame className="portal-auth">
      <PageHeader
        eyebrow="أمان الحساب"
        title="استعادة كلمة المرور"
        description="أدخل بريدك المسجّل لطلب رمز الاستعادة، أو استخدم الرمز الذي وصلك لتعيين كلمة مرور جديدة."
      />
      <ContentPanel>
        {notice ? (
          <p className="alert ok" role="status">
            {notice}
          </p>
        ) : null}
        {error ? (
          <p className="alert danger" role="alert">
            {error}
          </p>
        ) : null}

        <form className="form" method="post" onSubmit={submit}>
          {step === 'request' ? (
            <>
              <FormField label="رمز المنشأة (اختياري)">
                <input
                  className="input"
                  value={tenantCode}
                  onChange={(event) => setTenantCode(event.target.value)}
                  dir="ltr"
                  autoComplete="organization"
                />
              </FormField>
              <FormField label="البريد الإلكتروني المسجّل">
                <input
                  className="input"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  dir="ltr"
                  autoComplete="email"
                />
              </FormField>
              <button className="btn primary" type="submit" disabled={loading}>
                {loading ? 'جارٍ الإرسال…' : 'إرسال رمز الاستعادة'}
              </button>
              <button className="btn" type="button" onClick={() => setStep('reset')}>
                لدي رمز الاستعادة بالفعل
              </button>
            </>
          ) : (
            <>
              <FormField label="رمز الاستعادة" hint="الصق الرمز كما ورد في الرسالة (rst_...)">
                <input
                  className="input"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  required
                  dir="ltr"
                />
              </FormField>
              <FormField label="كلمة المرور الجديدة" hint="12 حرفاً على الأقل">
                <input
                  className="input"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  minLength={12}
                  required
                  autoComplete="new-password"
                />
              </FormField>
              <button className="btn primary" type="submit" disabled={loading}>
                {loading ? 'جارٍ الحفظ…' : 'تعيين كلمة المرور الجديدة'}
              </button>
              <button className="btn" type="button" onClick={() => setStep('request')}>
                طلب رمز جديد
              </button>
            </>
          )}
        </form>

        <div className="toolbar portal-form-links">
          <a className="btn" href="/auth/login">
            رجوع لتسجيل الدخول
          </a>
          <a className="btn" href="/portal/profile">
            بيانات التواصل مع المورد
          </a>
        </div>
      </ContentPanel>
    </PageFrame>
  );
}
