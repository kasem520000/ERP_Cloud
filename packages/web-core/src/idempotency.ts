/**
 * 🔁 مفاتيح عدم التكرار للإرسالات — **مفتاحٌ واحدٌ للنيّة الواحدة، لا للنقرة الواحدة**.
 *
 * الخادم يفرد الإرسال بمفتاحه: إعادة `POST /van-sales/load-orders` بالمفتاح نفسه رجعت ‏201
 * **بلا تحويلٍ مخزنيٍّ ثانٍ** (الرصيد الرسمي بقي 30 في
 * `apps/api/test/van-sales-stock-acceptance.spec.ts`)، لأنّ `van_load_orders.idempotency_key`
 * عليه فهرسٌ فريد لكلّ مستأجر (`0122_van_sales_core_integration_and_idempotency.sql`) وكذلك
 * `factory_production_batches` و`van_sales_documents` و`van_stock_movements`.
 *
 * فالمفتاح ينفع فقط إن كان **ثابتاً بين محاولتين للنيّة نفسها**. وهنا وقع خلطان شائعان:
 *
 * 1. مفتاحٌ عشوائيٌّ لكلّ نداء (`Date.now()` + `Math.random()` داخل معالج الإرسال) — وهو ما كان
 *    في `apps/staff/app/van-sales/rep/page.tsx` تحت تعليقٍ يَعِد بعكسه: يحمي من النقرة المزدوجة
 *    لأنّ الزرّ معطّلٌ أثناء الطيران، لكنّه **لا يحمي من إعادة الإرسال بعد انقطاع الشبكة** —
 *    فالمحاولة الثانية تحمل مفتاحاً جديداً فيُنشأ مستندٌ ثانٍ وفاتورةٌ ثانية وخصمٌ ثانٍ من
 *    رصيد السيارة. وهذا أسوأ الحالات لأنّ العميل لا يعرف هل وصلت الأولى.
 * 2. مفتاحٌ مشتقٌّ من محتوى المسودة وحده — يمنع التكرار حقّاً، لكنّه **يبتلع النيّة الثانية
 *    المقصودة**: مندوبٌ يورّد لصاحبه عشر كيلوات مرتين في اليوم بمسودتين متطابقتين يصبح إرساله
 *    الثاني صامتاً (يرجع الخادم نتيجة الأول) فيظنّ أنّه سُجّل.
 *
 * لذا المفتاح هنا = ‏`بادئة : بصمة المسودة : رقم المحاولة`، ورقم المحاولة يتغيّر في حالتين
 * فقط: تغيّر المسودة (نيّةٌ أخرى)، ورصد نجاحٍ (فالنيّة التالية جديدة ولو تطابق محتواها).
 * أمّا ما بينهما — نقرةٌ مزدوجة، إعادة محاولة بعد مهلة، تحديث الصفحة والضغط مرة أخرى قبل أن
 * يُرى النجاح — فمفتاحٌ واحدٌ ومستندٌ واحد.
 *
 * الطبقة نقيةٌ بلا React عن قصد: كلّ السلوك يُقاس في `tests/idempotency.spec.ts`، والخطّاف في
 * `use-submission-key.ts` غلافٌ من عشرة أسطر. ولا `crypto.subtle` هنا (غير متاحٍ إلا في سياقٍ
 * آمن، و`http://` في شبكةٍ محليّة ليس كذلك) — بصمة FNV-1a بخانطين تكفي للتمييز لا للأمان،
 * فالأمان في الفهرس الفريد في قاعدة البيانات.
 */

/** البادئة جزءٌ من المفتاح يُقرأ في السجلات، فتُقيَّد بما لا يكسر سطر سجلٍّ ولا مساراً. */
const PREFIX_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const NONCE_PATTERN = /^[A-Za-z0-9]+$/;

/**
 * سقف طول المفتاح. العمود `text` بلا قيدٍ في القاعدة، لكنّ مفتاحاً بلا سقف يعني أنّ مسودةً
 * كبيرة (قائمة بنود طويلة) تُنسخ في عمودٍ يُفهرَس ويُقارَن، فالبصمة ثابتة الطول والبادئة
 * ورقم المحاولة مقصوص — والأطول الممكن عمليّاً نحو 60 حرفاً.
 */
export const SUBMISSION_KEY_MAX_LENGTH = 120;

/** طول رقم المحاولة المقصوص: ‏16 حرفاً ‏(≈95 بت) من العشوائية تكفي ألا يتصادم مستخدِمان. */
const NONCE_LENGTH = 16;

const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * نصٌّ قانونيٌّ للحمولة: مفاتيح الكائنات مرتّبة، و`undefined` محذوف، و`Date` بصيغته المعيارية.
 *
 * الهدف أن يكون النصّ **ما يراه الخادم فعلاً**: ‏`apiPost` يمرّر الجسم عبر `JSON.stringify`،
 * فترتيب الحقول في كائن JavaScript لا يصل إلى السلك، والحقل `undefined` لا يصل أصلاً. وبدون
 * هذا التقنين كانت مسودتان متطابقتان في المعنى تنتجان مفتاحين مختلفين لمجرد أنّ حقليهما كُتبا
 * بترتيبٍ مختلف في مصفّتَي `useMemo` — أي أنّ الحماية كانت ستنكسر بصمت عند أول إعادة ترتيب.
 */
export function canonicalPayloadText(payload: unknown): string {
  return JSON.stringify(canonicalize(payload, new WeakSet<object>())) ?? '';
}

/**
 * بصمةٌ ثابتة بخطين من FNV-1a (‏64 بت سداسية). الخطّان ببذرتين مختلفتين فاحتمال تصادمهما معاً
 * ضئيل، والمطلوب تمييزٌ لا مقاومةُ تصادمٍ مُعادية — فالضمانة ضدّ التكرار هي الفهرس الفريد.
 */
export function stableDigest(text: string): string {
  const first = fnv1a(text, FNV_OFFSET_BASIS);
  const second = fnv1a(text, FNV_PRIME);
  return `${toHex(first)}${toHex(second)}`;
}

/** رقم محاولةٍ جديد. ‏`crypto.randomUUID` إن وُجد، وإلا بديلٌ زمنيٌّ عشوائي (لا يعتمد على مكتبة). */
export function newSubmissionNonce(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  const uuid = typeof cryptoRef?.randomUUID === 'function' ? cryptoRef.randomUUID() : '';
  const raw = uuid || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  const cleaned = raw.replace(/[^A-Za-z0-9]/g, '').slice(0, NONCE_LENGTH);
  return cleaned.length > 0 ? cleaned : 'n0';
}

/**
 * يبني المفتاح. البادئة ورقم المحاولة خطأُ مبرمجٍ إن خالفا القيود (ثوابتُ في الشاشة لا مدخلاتُ
 * مستخدِم) فيُرفضان بصوتٍ عالٍ بدل أن يُنتجا مفتاحاً غامضاً يصعب تتبّعه في السجلات.
 */
export function submissionIdempotencyKey(prefix: string, payload: unknown, nonce: string): string {
  if (!PREFIX_PATTERN.test(prefix)) {
    throw new Error(`بادئة مفتاح عدم التكرار غير صالحة: "${prefix}" — المطلوب أحرفٌ لاتينية صغيرة وأرقام وشرطة`);
  }
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error(`رقم محاولة مفتاح عدم التكرار غير صالح: "${nonce}" — المطلوب أحرفٌ وأرقام فقط`);
  }
  const key = `${prefix}:${stableDigest(canonicalPayloadText(payload))}:${nonce}`;
  if (key.length > SUBMISSION_KEY_MAX_LENGTH) {
    throw new Error(`مفتاح عدم التكرار أطول من ${SUBMISSION_KEY_MAX_LENGTH} حرفاً — البادئة "${prefix}" طويلة`);
  }
  return key;
}

export type SubmissionKeyTracker = {
  /**
   * يتتبّع المسودة الحالية: إن تغيّر نصّها القانوني تغيّر رقم المحاولة. يُستدعى في كل رسم،
   * ورخيصٌ لأنّه يقارن نصّاً ولا يُنشئ مفتاحاً.
   */
  track(draft: unknown): void;
  /**
   * مفتاح الإرسال الحالي. تُمرَّر الحمولة اختياراً فتُتتبَّع ثم يُبنى المفتاح منها، وإلا بُني من
   * آخر مسودةٍ مُتتبَّعة — وإن لم تُتتبَّع مسودةٌ قطّ فذلك خطأُ توصيلٍ يُرفض لا يُتجاهل، لأنّ
   * البديل مفتاحٌ واحدٌ مشترك لكلّ إرسالات الشاشة.
   */
  key(payload?: unknown): string;
  /** رقم محاولةٍ جديد بعد نجاحٍ رُصد: فالنيّة التالية جديدة ولو تطابق محتواها. */
  reset(): void;
};

/**
 * متتبّع مفاتيح شاشةٍ واحدة. الحالة داخلية (لا `useState`) فلا إعادة رسم ولا تحذير تعديل حالةٍ
 * أثناء الرسم، والرسم المزدوج في `StrictMode` لا يستهلك رقمين لأنّ التتبّع يقارن النصّ.
 */
export function createSubmissionKeyTracker(prefix: string): SubmissionKeyTracker {
  let nonce = newSubmissionNonce();
  let tracked: string | null = null;

  return {
    track(draft: unknown): void {
      const canonical = canonicalPayloadText(draft);
      if (canonical !== tracked) {
        tracked = canonical;
        nonce = newSubmissionNonce();
      }
    },
    key(payload?: unknown): string {
      if (payload !== undefined) {
        this.track(payload);
      }
      if (tracked === null) {
        throw new Error(`لم تُتتبَّع مسودةٌ للمفتاح "${prefix}" — مرّر المسودة إلى useSubmissionKey`);
      }
      return submissionIdempotencyKey(prefix, tracked, nonce);
    },
    reset(): void {
      nonce = newSubmissionNonce();
    },
  };
}

function canonicalize(value: unknown, seen: WeakSet<object>): unknown {
  if (value === null) return null;

  const kind = typeof value;
  if (kind === 'string' || kind === 'boolean') return value;
  if (kind === 'number') {
    // ‏`JSON.stringify` يُصيّر `NaN` و`Infinity` إلى `null`، فالتقنين يفعل مثله وإلا اختلف النصّ
    // عمّا يصل إلى السلك.
    return Number.isFinite(value as number) ? value : null;
  }
  if (kind === 'bigint') return (value as bigint).toString();
  // الدوال والرموز و`undefined` لا تصل إلى السلك، فهي تُحذف هنا كذلك.
  if (kind === 'undefined' || kind === 'function' || kind === 'symbol') return undefined;

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item, seen) ?? null);
  }
  if (kind === 'object') {
    const source = value as Record<string, unknown> & { toJSON?: () => unknown };
    if (typeof source.toJSON === 'function') return canonicalize(source.toJSON(), seen);
    if (seen.has(source)) {
      throw new Error('مسودة الإرسال دائرية المرجع — لا يُبنى منها مفتاحٌ ولا جسم طلب');
    }
    seen.add(source);
    const canonical: Record<string, unknown> = {};
    for (const name of Object.keys(source).sort()) {
      const member = canonicalize(source[name], seen);
      if (member !== undefined) canonical[name] = member;
    }
    // يُرفع التعليم بعد الانتهاء: الدائرة الحقيقية خطأ، أمّا الكائن نفسه في فرعين شقيقين فصحيح.
    seen.delete(source);
    return canonical;
  }
  return null;
}

function fnv1a(text: string, seed: number): number {
  let hash = seed >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    const unit = text.charCodeAt(index);
    hash ^= unit & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
    hash ^= (unit >>> 8) & 0xff;
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

function toHex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0');
}
