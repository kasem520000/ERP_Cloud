'use client';

import { useEffect, useRef } from 'react';

import { writeSession } from './api';
import { useSession } from './session';

/**
 * AUD-08 — يستقبل جسر الدخول من الواجهة التسويقية.
 *
 * ما كان: `?token=<access>&refresh=<refresh>&tenant=…` — أي أن **رموز الجلسة كاملة**
 * تمرّ في عنوان الطلب الأول، فتُسجَّل في سجلّات الوسيط/الوكيل وفي `Referer`، وإزالتها
 * بعد التحميل لا تلغي ما سُجّل. ما صار: العنوان يحمل `?handoff=<code>` فقط، رمزٌ
 * لمرة واحدة عمره ~60 ثانية **لا يحمل صلاحية بنفسه**، يُستبدل هنا عبر POST بجلسةٍ
 * جديدة، ثم يُنظَّف العنوان بلا إعادة تحميل.
 *
 * الفشل مغلق: رمز منتهٍ أو مُستبدل سابقاً يُلقي المستخدم على شاشة الدخول، لا على جلسة
 * جزئية. ولا يوجد مسار قراءة `token` من الاستعلام بعد اليوم.
 *
 * **وأين هي شاشة الدخول؟** `/?handoff=failed` لا `/login?handoff=failed`: لا مسار `/login`
 * في `apps/staff` (قُيس: `GET /login` ⇒ 404)، فالقشرة (`AuthGate`) هي التي ترسم شاشة الدخول
 * على أي مسارٍ محميّ حين تكون الجلسة مجهولة — وإعادة التوجيه إلى مسارٍ غير موجود كانت
 * تترك المستخدم أمام صفحة 404 بلا سبب. والوسم `handoff=failed` يبقى في العنوان لتقرأه
 * شاشة الدخول وتقول «الرابط منتهٍ أو مُستعمل سابقاً» بدل الصمت.
 */
/**
 * 🚦 قرار العنوان عند الإقلاع — دالّة صافية، والجسران (هنا وفي بوابة العميل) ينفّذانها.
 *
 * `?handoff=<code>` رمزُ تسليمٍ يُستبدل بجلسة. و`?handoff=failed` **ليس رمزاً**: هو الوسم
 * الذي يكتبه الجسر نفسه حين يفشل الاستبدال، لتقرأه شاشة الدخول وتقول «الرابط منتهٍ أو
 * مُستعمل سابقاً» بدل الصمت. ومعاملته رمزاً كانت تُنتج حلقة: استبدال `failed` يفشل ←
 * تحويل إلى العنوان نفسه ← استبدال `failed` … بلا نهاية، وبنداءٍ خاسر للخادم في كلّ دورة.
 * والشاشة ترسم الوسم ولا تحاول استبداله، فلا فرقَ بصريّاً — والفرق كلّهُ في الشبكة.
 */
export const HANDOFF_FAILED_MARKER = 'failed';

export type HandoffAction =
  | { kind: 'redeem'; code: string }
  | { kind: 'failed' }
  | { kind: 'none' };

export function handoffAction(search: string): HandoffAction {
  const value = new URLSearchParams(search).get('handoff');
  if (!value) return { kind: 'none' };
  if (value === HANDOFF_FAILED_MARKER) return { kind: 'failed' };
  return { kind: 'redeem', code: value };
}

/** هدف التحويل الافتراضي عند الفشل — وسمٌ لا رمز، بحكم `handoffAction` أعلاه. */
export const DEFAULT_FAILED_REDIRECT = `/?handoff=${HANDOFF_FAILED_MARKER}`;

export function TokenBridge({ failedRedirect = DEFAULT_FAILED_REDIRECT }: { failedRedirect?: string } = {}) {
  const { status, reload } = useSession();
  const inFlight = useRef(false);

  useEffect(() => {
    if (status !== 'anonymous' || inFlight.current) return;
    const url = new URL(globalThis.location.href);
    const action = handoffAction(url.search);
    // ‏`failed` وسمُ فشلنا نحن: لا يُستبدل (استبداله حلقة)، ولا يُخفي شيئاً عن الشاشة.
    if (action.kind !== 'redeem') return;
    const code = action.code;
    inFlight.current = true;

    // التنظيف فوراً: لا يبقى الرمز في العنوان/المحفوظات حتى لو فشل الاستبدال.
    url.searchParams.delete('handoff');
    globalThis.history.replaceState(null, '', url.toString());

    void (async () => {
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1'}/auth/handoff/redeem`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!response.ok) {
          globalThis.location.assign(failedRedirect);
          return;
        }
        const payload = (await response.json()) as {
          data: { accessToken: string; refreshToken: string; expiresIn: number; memberships: Array<{ tenantCode: string }> };
        };
        writeSession({
          accessToken: payload.data.accessToken,
          refreshToken: payload.data.refreshToken,
          tenantCode: payload.data.memberships[0]?.tenantCode ?? '',
          expiresAt: Date.now() + payload.data.expiresIn * 1000,
        });
        void reload();
      } catch {
        globalThis.location.assign(failedRedirect);
      }
    })();
  }, [status, reload]);

  return null;
}
