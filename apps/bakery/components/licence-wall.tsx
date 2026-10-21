import { LICENCE_COPY } from '../lib/licence';

import { BakeryLogoMark } from './module-icon';

/**
 * جدار الترخيص — الرفضُ الصريح بدل نصف عمل.
 *
 * يُرسم حين تكون المنشأة غير مرخَّصة (`unlicensed`) أو حين لم يقل الخادم شيئاً (`unknown`)،
 * ويقول في الحالتين **ما الذي حدث وما الذي يُعمل**: طريقُ الطلب (سوق الإضافات ← قرار
 * مالك المنصة) أو سببُ الشكّ (`enabledApps` غائب من `/me`) مع إعادة المحاولة. ولا يُخفي
 * الرفض وراء تحويلٍ أو شاشةٍ فارغة.
 *
 * ولا يستورد `@erp/ui` عن قصد: هذا المكوّن يجب أن يُرسم حتى حين تكون الشبكة أو الكتالوج
 * أو حزمة العرض نفسها في حالٍ سيّئة — وأخفّ اعتمادٍ هنا هو أصدقُ سلوك. وهو مقيسٌ في
 * ‏`tests/licence-wall.spec.tsx` بالرسم الفعليّ لا بقراءة النصّ.
 */
export function LicenceWall({
  verdict,
  onRetry,
}: {
  verdict: 'unlicensed' | 'unknown';
  onRetry?: () => void;
}) {
  const copy = LICENCE_COPY[verdict];
  const tone =
    verdict === 'unlicensed'
      ? 'border-danger-line bg-danger-soft text-danger-ink'
      : 'border-warn-line bg-warn-soft text-warn-ink';

  return (
    <main className="bak-wall">
      <div
        role="alert"
        className={`grid w-full max-w-2xl gap-3 rounded-[12px] border p-6 shadow-1 ${tone}`}
      >
        <span aria-hidden="true" className="bak-wall-mark">
          <BakeryLogoMark size={26} />
        </span>
        <h1 className="m-0 text-[19px] font-extrabold tracking-tight">{copy.title}</h1>
        <p className="m-0 text-[13.5px] leading-relaxed">{copy.body}</p>
        <ol className="m-0 grid gap-1.5 text-[13px] leading-relaxed">
          {copy.steps.map((step, index) => (
            <li key={step}>
              <span className="font-bold">{index + 1}.</span> {step}
            </li>
          ))}
        </ol>
        {onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="justify-self-start rounded-[8px] border border-line bg-surface px-4 py-2 text-[13px] font-bold text-ink"
          >
            إعادة المحاولة
          </button>
        ) : null}
      </div>
    </main>
  );
}
