'use client';

import { useCallback, useMemo } from 'react';

import { createSubmissionKeyTracker } from './idempotency';
import type { SubmissionKeyTracker } from './idempotency';

export type SubmissionKeyHandle = {
  /**
   * المفتاح الحالي — يُستدعى لحظة الإرسال لا أثناء الرسم. بلا حجةٍ يُبنى من المسودة المُتتبَّعة
   * عند الرسم (النمط الأول)، وبحمولةٍ يُتتبّعها ثم يُبنى منها (النمط الثاني) — والحجة تُمرَّر
   * حرفياً وإلا ابتلعها الغلاف كما فعلت نسخةٌ أولى من هذا الخطّاف.
   */
  key: (payload?: unknown) => string;
  /** يُستدعى بعد نجاحٍ رُصد، فتصير النيّة التالية جديدة ولو تطابق محتواها. */
  reset: () => void;
};

/**
 * 🔑 مفتاح عدم تكرارٍ لشاشةٍ فيها مسودة.
 *
 * يُمرَّر جسم المسودة (الكائن نفسه الذي يُبنى منه جسم الطلب، أو `useMemo`-ها) فيتغيّر المفتاح
 * حين تتغيّر النيّة، ويثبت ما لم تتغيّر — وهذا ما يجعل إعادة الإرسال بعد انقطاع الشبكة ترجع
 * بالمستند الأول بدل مستندٍ ثانٍ. التفصيل والقياس في `idempotency.ts`.
 *
 * ونمطان كلاهما صحيح:
 *
 * 1. **مسودةٌ عند الرسم** — `useSubmissionKey('van-load-order', draft)` ثمّ `key()` لحظة الإرسال.
 *    يصلح لشاشةٍ مسودتها `useMemo` معلّق، وهو الأغلب.
 * 2. **حمولةٌ عند الإرسال** — `useSubmissionKey('van-load-order')` ثمّ `key(body)` حيث `body` هو
 *    الجسم المُرسل نفسه. يصلح حين يُبنى الجسم داخل المعالج من متغيّراتٍ كثيرة (كلوحة مشرف
 *    التوزيع)، ويجعل المفتاح مشتقّاً ممّا يُرسل حرفياً فلا ينساه مُعيدُ ترتيب الحقول.
 *
 * ولا يجمع النمطان في شاشةٍ واحدة: تمريرُ مسودةٍ ثمّ استدعاء `key(body)` بجسمٍ مختلف يُدوّر
 * رقمَ المحاولة في كلِّ رسمٍ فتضيع الحماية.
 *
 * الخطّاف غلافٌ رقيق: المنطق في متتبّعٍ نقِيّ، والتتبّع مقارنةُ نصٍّ فلا حالة React ولا إعادة
 * رسم، والرسم المزدوج في `StrictMode` لا يستهلك رقمَي محاولة.
 */
export function useSubmissionKey(prefix: string, draft?: unknown): SubmissionKeyHandle {
  const tracker: SubmissionKeyTracker = useMemo(() => createSubmissionKeyTracker(prefix), [prefix]);
  if (draft !== undefined) tracker.track(draft);

  const key = useCallback((payload?: unknown) => tracker.key(payload), [tracker]);
  const reset = useCallback(() => tracker.reset(), [tracker]);
  return { key, reset };
}
