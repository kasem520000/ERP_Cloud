import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Redis } from 'ioredis';
import { env } from '@erp/config';

/**
 * Token-bucket rate limiter (SECURITY_ARCHITECTURE §8).
 *
 * القاعدة التي تحكم هذا الملف: **سقفٌ لكل عملية ليس سقفاً**. الدلو في ذاكرة العملية
 * صحيحٌ لعقدةٍ واحدة، ويكذب في الإنتاج: نسختان خلف موازِن الحمل تعنيان ضعف السقف،
 * و`RATE_LIMIT_LOGIN_PER_MINUTE=10` تصير عملياً 20 ثم 30 — والهجوم لا يزيد عليه شيئاً،
 * بل يوزّع طلباته على النسخ.
 *
 * فلهذا صار للدلو مخزنان:
 *
 *   1. **مشترك** (`REDIS_URL` مضبوط): عدّادٌ في Redis بـ`INCR` + `PEXPIRE` + `PTTL`
 *      في جولةٍ واحدة. كل النسخ ترى العدّاد نفسه، فالسقف سقف.
 *   2. **محلي** (بلا Redis): دلو الرموز في هذه العملية — وهو الصواب لعقدةٍ واحدة،
 *      ويبقى **احتياطاً** حين يسقط Redis: لا يُغلق باب الدخول لأن عدّاداً سقط.
 *
 * وثلاثة قرارات تُقاس:
 *
 *   · **السقوط ليس رفضاً.** عطل Redis يُسقط إلى الدلو المحلي ويُسجَّل مرّة كل دقيقة،
 *     ويُعدّ في `fallbacks`. الأسوأ أن نخسر المشاركة، لا أن نرفض طلباً مشروعاً.
 *   · **لا انتظار بلا سقف.** مهلة أمرٍ قصيرة (`RATE_LIMIT_REDIS_TIMEOUT_MS`) ونداءٌ
 *     واحدٌ لا يُعاد، فخادمٌ ميت يُسقط الطلب إلى المحلي في أجزاء من الثانية لا يُعلّقه.
 *   · **الشفافية.** `snapshot()` يقول أيّ مخزنٍ يعمل فعلاً — ويُعرض في مجسّ Redis في
 *     لوحة الصحة، لأن «محميّ» بلا معرفةِ أين يُعدّ الطلب ادّعاء.
 */

export type RateLimitDecision = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

type Bucket = { tokens: number; updatedAt: number };

/** رمز الحقن: مخزنٌ بديل يُمرَّر في الاختبارات؛ وغيابه يعني «اختر من البيئة». */
export const RATE_LIMIT_STORE = Symbol('RATE_LIMIT_STORE');

/** المخزن الذي يعدّ الطلبات فعلاً — يُحقن في الاختبارات، ويُختار من البيئة في الإنتاج. */
export type RateLimitStore = {
  /** يستهلك وحدةً من مفتاح، ويعيد القرار. */
  consume(key: string, limit: number, windowMs: number, now: number): Promise<RateLimitDecision>;
  readonly kind: 'memory' | 'redis';
  /** وصفٌ قصير للوحة الصحة. */
  describe(): string;
};

/**
 * دلو الرموز — التنفيذ الأصلي، محفوظٌ كما هو حرفياً كي لا تتغيّر دلالة السقف حين
 * يعمل محلياً: `limit` طلباتٍ في `windowMs`، والتعبئة مستمرّة لا قفزةً في نهاية النافذة.
 */
export class TokenBucketStore implements RateLimitStore {
  readonly kind = 'memory' as const;
  private readonly buckets = new Map<string, Bucket>();

  async consume(key: string, limit: number, windowMs: number, now: number): Promise<RateLimitDecision> {
    const refillPerMs = limit / windowMs;
    const bucket = this.buckets.get(key);

    if (!bucket) {
      this.buckets.set(key, { tokens: limit - 1, updatedAt: now });
      return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
    }

    const elapsed = Math.max(0, now - bucket.updatedAt);
    const tokens = Math.min(limit, bucket.tokens + elapsed * refillPerMs);

    if (tokens < 1) {
      const missing = 1 - tokens;
      return {
        allowed: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil(missing / refillPerMs / 1000)),
      };
    }

    bucket.tokens = tokens - 1;
    bucket.updatedAt = now;
    return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterSeconds: 0 };
  }

  describe(): string {
    return 'محليٌّ لهذه العملية';
  }

  reset(): void {
    this.buckets.clear();
  }
}

/** العميل الذي يحتاجه مخزن Redis — مجموعةٌ صغيرة كي يُختبر بلا خادمٍ حقيقي. */
export type RedisCommands = {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number, mode?: 'NX'): Promise<number>;
  pttl(key: string): Promise<number>;
  quit?(): Promise<unknown>;
};

/**
 * نافذةٌ ثابتة على Redis — ثلاث أوامر في جولةٍ واحدة.
 *
 * `INCR` ذرّي، فالعدّ لا يضيع بين نسختين. و`PEXPIRE … NX` تُثبَّت مرّةً واحدة فقط:
 * لو جدّدناها في كل طلبٍ لصار المفتاح نافذةً منزلقة تُبقي المهاجم داخل السقف إلى الأبد
 * (كل طلب يؤجّل الانتهاء)، ولو لم نثبّتها أصلاً لبقي المفتاح بلا انتهاء.
 */
export class RedisWindowStore implements RateLimitStore {
  readonly kind = 'redis' as const;

  constructor(
    private readonly client: RedisCommands,
    private readonly prefix = 'ratelimit:',
  ) {}

  async consume(key: string, limit: number, windowMs: number, _now: number): Promise<RateLimitDecision> {
    const redisKey = `${this.prefix}${key}:${windowMs}`;
    const count = await this.client.incr(redisKey);

    // أوّل طلبٍ في النافذة يثبّت الانتهاء؛ وما بعده لا يمسّه.
    if (count === 1) await this.client.pexpire(redisKey, windowMs, 'NX');

    if (count > limit) {
      const ttl = await this.client.pttl(redisKey);
      return {
        allowed: false,
        remaining: 0,
        // `-1`/`-2` تعني «لا انتهاء» أو «لا مفتاح» — والحالة الثانية لا تقع عملياً هنا،
        // لكنّ حساب ثانيةٍ سالبة في ترويسة `Retry-After` أسوأ من قيمةٍ متحفّظة.
        retryAfterSeconds: ttl > 0 ? Math.max(1, Math.ceil(ttl / 1000)) : 1,
      };
    }

    return { allowed: true, remaining: limit - count, retryAfterSeconds: 0 };
  }

  describe(): string {
    return 'مشتركٌ عبر النسخ (Redis)';
  }
}

export type RateLimiterSnapshot = {
  store: 'memory' | 'redis';
  /** هل الطلبات تُعدّ في مخزنٍ مشترك فعلاً الآن؟ */
  shared: boolean;
  fallbacks: number;
  lastFallbackAt: string | null;
  lastError: string | null;
};

@Injectable()
export class RateLimiterService {
  private readonly logger = new Logger(RateLimiterService.name);
  private readonly memory = new TokenBucketStore();
  private store: RateLimitStore = this.memory;
  private fallbacks = 0;
  private lastFallbackAt: string | null = null;
  private lastError: string | null = null;
  private lastLogAt = 0;
  private closed = false;
  /** آخر نداءٍ سقط إلى الذاكرة — يجعل `shared` صادقةً بعد العطل لا قبله فقط. */
  private degraded = false;

  constructor(@Optional() @Inject(RATE_LIMIT_STORE) store?: RateLimitStore) {
    const shared = store ?? createRedisStore();
    if (shared) this.store = shared;
  }

  async consume(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitDecision> {
    if (this.store.kind === 'memory') return this.store.consume(key, limit, windowMs, now);

    try {
      const decision = await this.store.consume(key, limit, windowMs, now);
      this.degraded = false;
      return decision;
    } catch (error) {
      this.recordFallback(error);
      this.degraded = true;
      // الدلو المحلي يحمل الطلب بدل أن يسقط: الحماية تنقص، ولا تُلغى.
      return this.memory.consume(key, limit, windowMs, now);
    }
  }

  snapshot(): RateLimiterSnapshot {
    return {
      store: this.store.kind,
      shared: this.store.kind === 'redis' && !this.degraded,
      fallbacks: this.fallbacks,
      lastFallbackAt: this.lastFallbackAt,
      lastError: this.lastError,
    };
  }

  /** Test helper — clears every bucket and forgets fallbacks. */
  reset(): void {
    this.memory.reset();
    this.fallbacks = 0;
    this.lastFallbackAt = null;
    this.lastError = null;
    this.degraded = false;
  }

  /**
   * إغلاق الاتصال المشترك. `onModuleDestroy` كي لا يبقى مقبسٌ مفتوحاً حين يُغلق
   * التطبيق (وهو ما يجعل `app.close()` في الاختبارات يُنهي العملية بلا تعليق).
   */
  async onModuleDestroy(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const client = (this.store as { client?: RedisCommands & { disconnect?: () => void } }).client;
    if (!client?.quit) return;

    // `QUIT` ينتظر ردّ الخادم؛ وخادمٌ لا يغلق المقبس يُعلّق إغلاق التطبيق بأكمله.
    // فسقفٌ زمنيّ للانتظار ثم فصلٌ قسريّ: الإطفاء لا يتوقّف على ردّ.
    const closing = client.quit().catch(() => undefined);
    await Promise.race([closing, new Promise<void>((resolve) => setTimeout(resolve, 1_000).unref())]);
    client.disconnect?.();
  }

  private recordFallback(error: unknown): void {
    this.fallbacks += 1;
    this.lastFallbackAt = new Date().toISOString();
    this.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 200);

    const now = Date.now();
    if (now - this.lastLogAt >= 60_000) {
      this.lastLogAt = now;
      this.logger.warn(
        `rate-limit store unavailable (${this.lastError}); falling back to the per-process bucket ` +
          `(${this.fallbacks} fallbacks so far)`,
      );
    }
  }
}

/**
 * يُنشأ العميل كسولاً وبهدوء: `REDIS_URL` غائب ⇒ لا عميل. وفشل الاتصال لا يُسقط
 * الإقلاع — أوّل `consume` يسقط إلى الذاكرة ويُسجَّل.
 */
function createRedisStore(): RedisWindowStore | null {
  // `memory` فرضٌ صريح: يُغني عن نداء شبكةٍ في كل طلب حين لا تكون المشاركة مطلوبة.
  if (env.RATE_LIMIT_STORE === 'memory' || !env.REDIS_URL) return null;
  try {
    // استيرادٌ أعلى الملف لا كسول: `require` غير معرّفة في بناء ESM (apps/api
    // "type": "module")، وكانت محاولتها تفشل بصمتٍ فيصير المخزن المحلي دائماً.
    const client = new Redis(env.REDIS_URL, {
      lazyConnect: false,
      /**
       * طابورٌ متصل **مُفعَّل** عن قصد: إيقافه يجعل أوّل أمرٍ قبل اكتمال المقبس يفشل
       * بـ«Stream isn't writeable»، فتُخدم أول ثوانٍ بعد الإقلاع من الدلو المحلي بينما
       * العدّاد المشترك لم يُعدّ شيئاً — سقفٌ يبدو قائماً وهو ليس كذلك.
       * والحدّ يحميه من الانتظار: مهلة أمرٍ قصيرة و`maxRetriesPerRequest` واحد.
       */
      enableOfflineQueue: true,
      maxRetriesPerRequest: 1,
      connectTimeout: env.RATE_LIMIT_REDIS_TIMEOUT_MS,
      commandTimeout: env.RATE_LIMIT_REDIS_TIMEOUT_MS,
      retryStrategy: (attempt: number) => Math.min(attempt * 500, 5_000),
    });
    // فشل خلفيّ لا يُسقط العملية: يُسجَّل اوّل مرّة ثم يهدأ.
    client.on('error', () => undefined);

    return new RedisWindowStore(client as unknown as RedisCommands);
  } catch {
    return null;
  }
}
