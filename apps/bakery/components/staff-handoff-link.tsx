'use client';

import { useState } from 'react';
import { Button } from '@erp/ui';
import { apiErrorText, apiPost } from '@erp/web-core/api';

import { handoffPlan, staffBaseUrl, type StaffDestination } from '../lib/staff-handoff';

/**
 * ‏`POST /auth/handoff` ⇒ ‏`handoffCreateResponseSchema` في `@erp/contracts` (‏`code` و
 * ‏`expiresIn`). والنوعُ محليٌّ لأنّ الفهرس لا يُصدّره — ولا يُستورد من مسارٍ داخليّ في
 * حزمةٍ أخرى.
 */
type HandoffCode = { code?: string; expiresIn?: number };

/**
 * 🔗 زرُّ التسليم إلى لوحة staff — ويصنع الرمزَ **عند النقر** لا عند التحميل.
 *
 * والسببُ مقاسٌ في `packages/web-core/src/token-bridge.tsx`: الرمزُ لمرةٍ واحدة وعمرُه
 * ‏~٦٠ ثانية (‏`expiresIn` يرجعه الخادم)، فرمزٌ مُعدٌّ عند تحميل الشاشة ينتهي قبل أن
 * يُضغط، ورابطٌ منسوخٌ يعمل مرةً ثم يصير فخًّا لمن يستعمله ثانيةً.
 *
 * والفشلُ يُقال بنصّه: فشلُ صنع الرمز (٤٠١/٤٠٣/٤٢٩) نصٌّ من الخادم عبر `apiErrorText`،
 * وعنوانُ اللوحة غير المُهيَّأ نصٌّ يقول أيَّ متغيّرٍ ينقص — ولا يُخترع `localhost` ولا
 * يُفتح مسارٌ بلا رمز.
 */
export function StaffHandoffLink({
  destination,
  labelAr = 'افتح في اللوحة',
  size = 'sm',
  variant = 'secondary',
  onProblem,
}: {
  destination: StaffDestination;
  labelAr?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'primary' | 'secondary' | 'ghost';
  /** تُرفع المشكلةُ إلى الشاشة إن أرادت عرضها في مكانها (وتبقى معروضةً هنا أيضًا). */
  onProblem?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | undefined>();

  /** بلا عنوانٍ مُهيَّأ لا يُصنع رمزٌ — فرمزٌ لا يُستبدل ضياعٌ لرمزٍ لمرة واحدة. */
  const base = staffBaseUrl();

  const open = async (): Promise<void> => {
    if (!base) {
      const plan = handoffPlan(base, destination, '');
      const message = 'problemAr' in plan ? plan.problemAr : 'تعذّر تجهيز الرابط.';
      setProblem(message);
      onProblem?.(message);
      return;
    }
    setBusy(true);
    setProblem(undefined);
    try {
      const minted = await apiPost<HandoffCode>('/auth/handoff', {});
      const plan = handoffPlan(base, destination, String(minted?.code ?? ''));
      if ('problemAr' in plan) {
        setProblem(plan.problemAr);
        onProblem?.(plan.problemAr);
        return;
      }
      // التحويلُ بكامل الصفحة: فاللوحةُ تطبيقٌ آخر وجسرُ الرموز فيها يقرأ `?handoff=` عند الإقلاع.
      globalThis.location.assign(plan.href);
    } catch (caught) {
      const message = apiErrorText(caught, 'تعذّر صنع رمز التسليم إلى اللوحة');
      setProblem(message);
      onProblem?.(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col gap-1">
      <Button disabled={busy} loading={busy} onClick={() => void open()} size={size} variant={variant}>
        {busy ? 'يُجهَّز الرمز…' : labelAr}
      </Button>
      {problem ? (
        <p className="text-[12px] leading-5 text-danger-ink" role="alert">
          {problem}
        </p>
      ) : null}
    </span>
  );
}
