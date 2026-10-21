import { createHash } from 'node:crypto';

import { env } from '@erp/config';

/**
 * 🔐 فحص كلمات المرور المسرَّبة — SECURITY_ARCHITECTURE §2 («breach-list check»).
 *
 * القائمة المحلّية في `password-policy.ts` أربعة عشر سطراً، وهي جيّدة كخطّ دفاعٍ رخيص
 * وسيّئة كبديل: كلمة مرورٍ واحدة مسرَّبة في اختراقٍ حقيقي قد لا تكون في القائمة، فتمرّ.
 * والبديل المعياري هو فحص قاعدة Have I Been Pwned بنمط **k-anonymity**:
 *
 *   · يُحسَب SHA-1 لكلمة المرور في الذاكرة، ويُرسَل **أوّل خمسة أحرف** منه فقط.
 *   · يعيد المزوّد كل البصمات التي تبدأ بهذه الأحرف (مئات السطور)، ويُطابَق الباقي محلّياً.
 *   · فلا تخرج كلمة المرور ولا بصمتها الكاملة من هذا الخادم إلى أي جهة.
 *
 * وهذا الملف يقيس ثلاثة أشياء لا يُقاس فيها الادّعاء:
 *
 *   1. **الفشل ليس رفضاً.** مزوّدٌ ساقط أو شبكةٌ محجوبة لا تُقفل باب الدخول على المستأجرين:
 *      تُعاد `unknown` وتُسجَّل. لكنها **ليست** «نظيف» — والفرق بينهما هو ما يمنع الشاشة
 *      من أن تقول «فُحص» عن شيء لم يُفحص.
 *   2. **القاطع.** ثلاثة إخفاقات متتالية تفتح قاطعاً لمدّةٍ محدودة، فلا يدفع كلُّ تغييرٍ
 *      لكلمة المرور ثانيةً ونصفاً من مهلةٍ إلى مزوّدٍ ساقط. والانتهاء يعيد المحاولة.
 *   3. **الذاكرة.** البادئة الواحدة تُخدم من كاشٍ لعشر دقائق؛ تغيير كلمات مرور عشرين
 *      موظّفاً في يومٍ واحد لا يعيد تحميل القائمة نفسها عشرين مرّة.
 *
 * ولا يُسجَّل من كلمة المرور شيء — لا هي ولا بصمتها ولا بادئتها. ما يُسجَّل عدّادات.
 */

/** `off` لا يفحص · `warn` يفحص ويسجّل ولا يمنع · `enforce` يمنع. */
export type BreachCheckMode = 'off' | 'warn' | 'enforce';

export type BreachCheckResult =
  | { status: 'clean'; count: 0 }
  | { status: 'breached'; count: number }
  /** لم يُفحص: إمّا لأن الفحص متوقّف، أو لأن المزوّد لم يُجب (والقاطع مفتوح أو النداء فشل). */
  | { status: 'unknown'; reason: 'disabled' | 'unavailable' };

export type BreachCheckSnapshot = {
  mode: BreachCheckMode;
  /** هل الفحص مُفعَّل أصلاً (لا يعني أن المزوّد حيّ). */
  enabled: boolean;
  /** عدد المرّات التي أُجيب فيها بجوابٍ حقيقي من المزوّد أو من الكاش. */
  checked: number;
  breached: number;
  /** مرّات لم يُفحص فيها لتعذّر الوصول. */
  unavailable: number;
  /** إخفاقات متتالية — تُصفَّر بأوّل نجاح. */
  consecutiveFailures: number;
  /** طابع فتح القاطع بالمللي ثانية، أو `null` وهو مغلق. */
  circuitOpenUntil: number | null;
  lastCheckedAt: string | null;
  lastFailureAt: string | null;
  /** آخر خطأ كما قاله المزوّد — للوحة الصحة، لا للمستأجر. */
  lastError: string | null;
  cacheEntries: number;
};

export type PasswordBreachCheckerOptions = {
  mode?: BreachCheckMode;
  /** عنوان قائمة النطاقات؛ يجب أن ينتهي بـ`/` لأن البادئة تُلحَق به. */
  endpoint?: string;
  timeoutMs?: number;
  circuitMs?: number;
  /** حقن `fetch` في الاختبارات — الافتراضي هو `fetch` العامّ. */
  fetchImpl?: typeof fetch;
  /** حقن الساعة في الاختبارات. */
  now?: () => number;
  cacheTtlMs?: number;
  cacheMaxEntries?: number;
};

const DEFAULT_CACHE_TTL_MS = 10 * 60_000;
const DEFAULT_CACHE_MAX_ENTRIES = 256;
const FAILURE_THRESHOLD = 3;

type CacheEntry = { expiresAt: number; body: string };

export class PasswordBreachChecker {
  private readonly options: Required<
    Pick<PasswordBreachCheckerOptions, 'timeoutMs' | 'circuitMs' | 'cacheTtlMs' | 'cacheMaxEntries'>
  > & {
    mode: BreachCheckMode;
    endpoint: string;
    fetchImpl: typeof fetch;
    now: () => number;
  };

  private readonly cache = new Map<string, CacheEntry>();
  private stats = {
    checked: 0,
    breached: 0,
    unavailable: 0,
    consecutiveFailures: 0,
    circuitOpenUntil: null as number | null,
    lastCheckedAt: null as string | null,
    lastFailureAt: null as string | null,
    lastError: null as string | null,
  };

  constructor(options: PasswordBreachCheckerOptions = {}) {
    const resolvedMode: BreachCheckMode =
      options.mode ?? env.PASSWORD_BREACH_CHECK ?? (env.NODE_ENV === 'production' ? 'enforce' : 'off');

    this.options = {
      mode: resolvedMode,
      endpoint: options.endpoint ?? env.PASSWORD_BREACH_CHECK_URL,
      timeoutMs: options.timeoutMs ?? env.PASSWORD_BREACH_CHECK_TIMEOUT_MS,
      circuitMs: options.circuitMs ?? env.PASSWORD_BREACH_CHECK_CIRCUIT_SECONDS * 1000,
      cacheTtlMs: options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS,
      cacheMaxEntries: options.cacheMaxEntries ?? DEFAULT_CACHE_MAX_ENTRIES,
      fetchImpl: options.fetchImpl ?? fetch,
      now: options.now ?? Date.now,
    };
  }

  get mode(): BreachCheckMode {
    return this.options.mode;
  }

  get enabled(): boolean {
    return this.options.mode !== 'off';
  }

  /** الفحص. لا يرمي أبداً: أيّ عطلٍ يعود `unknown`. */
  async check(password: string): Promise<BreachCheckResult> {
    if (!this.enabled) return { status: 'unknown', reason: 'disabled' };

    const now = this.options.now();
    if (this.stats.circuitOpenUntil !== null && now < this.stats.circuitOpenUntil) {
      this.stats.unavailable += 1;
      return { status: 'unknown', reason: 'unavailable' };
    }
    // انتهى القاطع: تُصفَّر الإخفاقات كي لا يُعاد فتحه بأوّل عطلٍ بعد نافذةٍ هادئة.
    if (this.stats.circuitOpenUntil !== null) {
      this.stats.circuitOpenUntil = null;
      this.stats.consecutiveFailures = 0;
    }

    const digest = createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();
    const prefix = digest.slice(0, 5);
    const suffix = digest.slice(5);

    let body: string;
    try {
      body = this.cached(prefix) ?? (await this.fetchRange(prefix));
    } catch (error) {
      this.recordFailure(error);
      return { status: 'unknown', reason: 'unavailable' };
    }

    const count = findSuffix(body, suffix);
    this.stats.checked += 1;
    this.stats.consecutiveFailures = 0;
    this.stats.lastCheckedAt = new Date(this.options.now()).toISOString();

    if (count > 0) {
      this.stats.breached += 1;
      return { status: 'breached', count };
    }
    return { status: 'clean', count: 0 };
  }

  /** لقطةٌ للوحة الصحة — عدّادات وحدود، لا كلمات مرور. */
  snapshot(): BreachCheckSnapshot {
    const now = this.options.now();
    return {
      mode: this.options.mode,
      enabled: this.enabled,
      checked: this.stats.checked,
      breached: this.stats.breached,
      unavailable: this.stats.unavailable,
      consecutiveFailures: this.stats.consecutiveFailures,
      circuitOpenUntil:
        this.stats.circuitOpenUntil !== null && this.stats.circuitOpenUntil > now
          ? this.stats.circuitOpenUntil
          : null,
      lastCheckedAt: this.stats.lastCheckedAt,
      lastFailureAt: this.stats.lastFailureAt,
      lastError: this.stats.lastError,
      cacheEntries: this.cache.size,
    };
  }

  /** خطّاف اختبار: يُفرغ الكاش والعدّادات. */
  reset(): void {
    this.cache.clear();
    this.stats = {
      checked: 0,
      breached: 0,
      unavailable: 0,
      consecutiveFailures: 0,
      circuitOpenUntil: null,
      lastCheckedAt: null,
      lastFailureAt: null,
      lastError: null,
    };
  }

  private cached(prefix: string): string | undefined {
    const entry = this.cache.get(prefix);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.options.now()) {
      this.cache.delete(prefix);
      return undefined;
    }
    // إعادة الإدراج تحفظ ترتيب الأحدث استخداماً في `Map` فتُطاح الأقدم لا الأكثر طلباً.
    this.cache.delete(prefix);
    this.cache.set(prefix, entry);
    return entry.body;
  }

  private async fetchRange(prefix: string): Promise<string> {
    const url = `${this.options.endpoint}${prefix}`;
    const response = await this.options.fetchImpl(url, {
      method: 'GET',
      headers: {
        /**
         * `Add-Padding` يجعل حجم الردّ ثابتاً تقريباً بغضّ النظر عن عدد المطابقات، فلا
         * يستدلّ مراقبُ الشبكة على البادئة بحجم الردّ. وهو مدعوم في HIBP ويُتجاهَل بأمان عند غيره.
         */
        'Add-Padding': 'true',
        'User-Agent': 'erp-cloud-password-policy',
        accept: 'text/plain',
      },
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`breach range lookup failed with HTTP ${response.status}`);
    }
    const body = await response.text();
    this.remember(prefix, body);
    return body;
  }

  private remember(prefix: string, body: string): void {
    if (this.cache.size >= this.options.cacheMaxEntries) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.cache.set(prefix, { expiresAt: this.options.now() + this.options.cacheTtlMs, body });
  }

  private recordFailure(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.stats.unavailable += 1;
    this.stats.consecutiveFailures += 1;
    this.stats.lastFailureAt = new Date(this.options.now()).toISOString();
    // الرسالة قد تحمل العنوان لا كلمة المرور؛ ومع ذلك تُقصّ كي لا تتحوّل سطرَ سجلٍّ طويلاً.
    this.stats.lastError = message.slice(0, 200);

    if (this.stats.consecutiveFailures >= FAILURE_THRESHOLD) {
      this.stats.circuitOpenUntil = this.options.now() + this.options.circuitMs;
    }
  }
}

/**
 * السطور بصيغة `SUFFIX:COUNT` (35 حرفاً سادس عشرياً). وHIBP يعيد سطور حشوٍ بعددٍ صفر
 * لحجب حجم الردّ — والصفر ليس تسريباً، فتُقرأ كما هي: صفر.
 */
export function findSuffix(body: string, suffix: string): number {
  const wanted = suffix.toUpperCase();
  let occurrences = 0;
  for (const line of body.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator === -1) continue;
    const candidate = line.slice(0, separator).trim().toUpperCase();
    if (candidate.length !== 35 || candidate !== wanted) continue;
    const count = Number.parseInt(line.slice(separator + 1).trim(), 10);
    if (Number.isFinite(count) && count > 0) occurrences += count;
  }
  return occurrences;
}
