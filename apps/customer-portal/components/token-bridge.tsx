'use client';

import { useEffect, useRef } from 'react';
import { HANDOFF_FAILED_MARKER, handoffAction } from '@erp/web-core/token-bridge';

import { storeToken } from '../lib/api';

/**
 * هدف الفشل: `/auth/login` لأنّ **لا مسار `/login` في هذه البوابة** (مسارات الدخول تحت
 * `app/auth/*`، ورابط الدخول في ترويسة `app/layout.tsx` نفسه يشير إلى `/auth/login`).
 * كان التحويل يذهب إلى `/login?handoff=failed` فيسقط المستخدم في 404 — أي أنّ أسوأ لحظة
 * (رابط تسليمٍ منتهٍ أو مُستعمل) كانت تُكافأ بصفحةٍ لا وجود لها. والسبيك يتحقّق من أنّ
 * لكلّ هدف تحويلٍ صفحةً فعلًا.
 */
export const FAILED_LOGIN = `/auth/login?handoff=${HANDOFF_FAILED_MARKER}`;

/**
 * AUD-08 — يستقبل جسر الدخول من الواجهة التسويقية في بوابة العميل.
 *
 * كان `?token=<access>&refresh=…` يمرّ في العنوان ثم يُحذف بعد التحميل — والعنوان يكون
 * قد وصل إلى السجلّات. الآن `?handoff=<code>` لمرة واحدة يُستبدل عبر POST، ويُنظَّف
 * العنوان قبل الاستبدال، ورمز الاستبدال لا يُقبل مرتين.
 */
export function TokenBridge() {
  const inFlight = useRef(false);

  useEffect(() => {
    if (inFlight.current) return;
    const url = new URL(globalThis.location.href);
    // القرار من الحزمة المشتركة لا نسخةً محلية: `?handoff=failed` وسمٌ تكتبه هذه الوحدة
    // نفسها، واستبداله رمزاً كان يُعيد التحويل إلى العنوان نفسه ⇒ حلقة إعادة تحميل.
    const action = handoffAction(url.search);
    if (action.kind !== 'redeem') return;
    const code = action.code;
    inFlight.current = true;

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
          globalThis.location.assign(FAILED_LOGIN);
          return;
        }
        const payload = (await response.json()) as { data: { accessToken: string } };
        storeToken(payload.data.accessToken);
        globalThis.location.assign(url.pathname === '/' ? '/portal' : `${url.pathname}${url.search}`);
      } catch {
        globalThis.location.assign(FAILED_LOGIN);
      }
    })();
  }, []);

  return null;
}
