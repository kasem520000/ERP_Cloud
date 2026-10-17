'use client';

import { useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Card, CardBody, Input } from '@erp/ui';
import { ApiError, apiErrorText } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { handoffAction } from '@erp/web-core/token-bridge';

/** النصّ نفسه الذي تقوله بقيّة الواجهات: الرابط المُسلَّم لمرةٍ واحدة وقد فات. */
const HANDOFF_FAILED_AR =
  'رابط الدخول المسلَّم منتهٍ أو مُستعمل سابقاً. سجّل الدخول أدناه، أو اطلب رابطاً جديداً من مكتب الدعم في اللوحة.';

/**
 * شاشة دخول واجهة المخابز — الجلسة نفسها والخادم نفسه: رمز المنشأة والبريد وكلمة المرور
 * (ورمز التحقّق الثنائي حين يطلبه الخادم). ولا حسابات ولا كلمات مرور خاصة بهذه الواجهة،
 * ولا مسار `/login`: القشرة ترسم الشاشة على أيّ مسارٍ محميّ حين تكون الجلسة مجهولة.
 *
 * ووسم الفشل يُقرأ بالدالّة المشتركة `handoffAction` نفسها التي يقرأها الجسر، فيتّفق
 * الطرفان بحكم البناء: الجسر لا يستبدل `failed` رمزاً (وإلّا دارت حلقة إعادة تحميل)،
 * والشاشة ترسمه خبراً.
 */
export function LoginScreen({ initialError }: { initialError?: string }) {
  const { signIn } = useSession();
  const params = useSearchParams();
  const handoffFailed = handoffAction(params.toString()).kind === 'failed';

  const [tenantCode, setTenantCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaCode, setMfaCode] = useState('');
  const [needsMfa, setNeedsMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(
    initialError ?? (handoffFailed ? HANDOFF_FAILED_AR : undefined),
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await signIn(email.trim(), password, tenantCode.trim(), needsMfa ? mfaCode.trim() || undefined : undefined);
    } catch (caught) {
      // ‏`MFA_REQUIRED` ليست خطأً بل خطوةٌ ثانية: تُعرض الخانة ويبقى ما كُتب.
      if (caught instanceof ApiError && caught.code === 'MFA_REQUIRED') {
        setNeedsMfa(true);
        setError('أدخل رمز التحقّق الثنائي المرسل إلى جهازك لإكمال الدخول.');
      } else {
        setError(apiErrorText(caught, 'تعذّر تسجيل الدخول'));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="bak-wall">
      <Card className="w-full max-w-md shadow-4">
        <CardBody className="grid gap-5">
          <header className="grid justify-items-center gap-3 text-center">
            <span aria-hidden="true" className="bak-logo bak-logo-lg">
              🥖
            </span>
            <div className="grid gap-1">
              <h1 className="m-0 text-[21px] font-extrabold tracking-tight text-ink">واجهة المخابز</h1>
              <p className="m-0 text-[12.5px] text-muted">الإنتاج والتوزيع والمناديب والتحصيل</p>
            </div>
          </header>

          {error ? (
            <p
              className="m-0 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger-ink"
              role="alert"
            >
              {error}
            </p>
          ) : null}

          <form className="grid gap-3.5" onSubmit={(event) => void submit(event)}>
            <Input
              autoComplete="organization"
              dir="rtl"
              hint="رمز المنشأة كما يظهر في لوحة التحكم"
              label="رمز المنشأة"
              onChange={(event) => setTenantCode(event.target.value)}
              required
              value={tenantCode}
            />
            <Input
              autoComplete="username"
              dir="ltr"
              label="البريد الإلكتروني"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
            <Input
              autoComplete="current-password"
              dir="ltr"
              label="كلمة المرور"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
            {needsMfa ? (
              <Input
                autoComplete="one-time-code"
                dir="ltr"
                hint="الخطوةُ الثانية ليست خطأً: ما كُتب أعلاه محفوظ"
                inputMode="numeric"
                label="رمز التحقّق الثنائي"
                onChange={(event) => setMfaCode(event.target.value)}
                value={mfaCode}
              />
            ) : null}

            <Button block className="mt-1 h-11 text-[14px]" disabled={busy} loading={busy} type="submit" variant="primary">
              تسجيل الدخول
            </Button>
          </form>

          <p className="m-0 rounded-[10px] border border-line bg-surface-2 px-3.5 py-3 text-[12px] leading-relaxed text-muted">
            الجلسة والخادم واحدان مع لوحة التحكم: الدخول هنا هو الدخول نفسه بصلاحياتك
            الممنوحة، ولا تُنشئ هذه الواجهة حسابات ولا تمنح صلاحيات. وتحتاج المنشأة باقةً
            قطاعية مرخَّصة (`bakery_distribution`) لتعمل الشاشات — وإلّا ظهر الرفض صريحاً.
          </p>
        </CardBody>
      </Card>
    </main>
  );
}
