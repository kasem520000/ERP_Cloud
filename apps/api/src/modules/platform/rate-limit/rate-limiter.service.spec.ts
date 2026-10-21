import { Redis } from 'ioredis';
import { describe, expect, it } from 'vitest';

import { startStubRedis, type StubRedis } from '../../../../test/support/stub-redis.js';

import { RateLimiterService, RedisWindowStore, TokenBucketStore } from './rate-limiter.service.js';

/**
 * سقف الطلبات — الوحدات والدلالة، ثم **المشاركة عبر السلك**.
 *
 * القسم الأول يحفظ دلالة دلو الرموز كما كانت (تعبئة مستمرّة، ومفاتيح مستقلّة) لأن
 * تغييرها يغيّر تجربة المستخدم لا الحماية. والقسم الثاني يقيس العيب الذي كان قائماً:
 * نسختان من الخدمة، وسقفٌ واحد.
 */
describe('RateLimiterService — الدلو المحلي (token bucket)', () => {
  it('allows up to the bucket size and then refuses', async () => {
    const limiter = new RateLimiterService(new TokenBucketStore());
    const now = 1_000_000;

    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const decision = await limiter.consume('login:127.0.0.1', 10, 60_000, now);
      expect(decision.allowed, `attempt ${attempt}`).toBe(true);
      expect(decision.remaining).toBe(10 - attempt);
    }

    const refused = await limiter.consume('login:127.0.0.1', 10, 60_000, now);
    expect(refused.allowed).toBe(false);
    expect(refused.remaining).toBe(0);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('refills over time', async () => {
    const limiter = new RateLimiterService(new TokenBucketStore());
    const start = 1_000_000;

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await limiter.consume('login:ip', 10, 60_000, start);
    }
    expect((await limiter.consume('login:ip', 10, 60_000, start)).allowed).toBe(false);

    // ٦ ثوانٍ عند ١٠ رموز / ٦٠ ثانية = رمزٌ واحد بالضبط.
    expect((await limiter.consume('login:ip', 10, 60_000, start + 6_000)).allowed).toBe(true);
    expect((await limiter.consume('login:ip', 10, 60_000, start + 6_000)).allowed).toBe(false);
  });

  it('keeps buckets independent per key and exposes that it is not shared', async () => {
    const limiter = new RateLimiterService(new TokenBucketStore());
    const now = 1_000_000;

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await limiter.consume('login:alice', 5, 60_000, now);
    }
    expect((await limiter.consume('login:alice', 5, 60_000, now)).allowed).toBe(false);
    expect((await limiter.consume('login:bob', 5, 60_000, now)).allowed).toBe(true);
    expect(limiter.snapshot()).toMatchObject({ store: 'memory', shared: false, fallbacks: 0 });
  });
});

describe('RedisWindowStore — العدّاد المشترك على السلك', () => {
  it('shares one budget between two service instances', async () => {
    const redis: StubRedis = await startStubRedis();
    const clients = [new Redis(redis.url), new Redis(redis.url)];
    const copies = clients.map((client) => new RateLimiterService(new RedisWindowStore(client)));

    try {
      // ٥ طلباتٍ موزّعة على النسختين: النسخة الأولى تستهلك اثنين، والثانية ثلاثة.
      const decisions = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        decisions.push(await copies[attempt % 2]!.consume('login:203.0.113.9', 5, 60_000));
      }
      expect(decisions.map((decision) => decision.allowed)).toEqual([true, true, true, true, true]);
      expect(decisions.map((decision) => decision.remaining)).toEqual([4, 3, 2, 1, 0]);

      // والطلب السادس — من أي نسخة — مرفوض: هذا هو الفرق الذي كان غائباً.
      const refused = await copies[0]!.consume('login:203.0.113.9', 5, 60_000);
      expect(refused.allowed).toBe(false);
      expect(refused.remaining).toBe(0);
      expect(refused.retryAfterSeconds).toBeGreaterThan(0);

      expect(redis.keys()).toEqual([
        expect.objectContaining({ key: 'ratelimit:login:203.0.113.9:60000', count: 6 }),
      ]);
      expect(copies[0]!.snapshot()).toMatchObject({ store: 'redis', shared: true, fallbacks: 0 });
    } finally {
      for (const client of clients) await client.quit().catch(() => undefined);
      await redis.close();
    }
  });

  it('sets the expiry once, so the window cannot be renewed by every request', async () => {
    const redis = await startStubRedis();
    const client = new Redis(redis.url);
    const store = new RedisWindowStore(client);

    try {
      await store.consume('tenant:t1', 100, 60_000, Date.now());
      const [first] = redis.keys();
      const originalTtl = first!.ttlMs;

      await new Promise((resolve) => setTimeout(resolve, 15));
      await store.consume('tenant:t1', 100, 60_000, Date.now());
      const [second] = redis.keys();

      expect(second!.count).toBe(2);
      // المهلة لا تُجدَّد: لو جُدِّدت لكانت الثانية أكبر من الأولى بمقدار التأخير.
      expect(second!.ttlMs).toBeLessThanOrEqual(originalTtl);
    } finally {
      await client.quit().catch(() => undefined);
      await redis.close();
    }
  });

  it('falls back to the local bucket when Redis dies, and says so', async () => {
    const redis = await startStubRedis();
    const client = new Redis(redis.url, { enableOfflineQueue: false, maxRetriesPerRequest: 1 });
    client.on('error', () => undefined);
    if (client.status !== 'ready') {
      await new Promise<void>((resolve) => client.once('ready', () => resolve()));
    }
    const limiter = new RateLimiterService(new RedisWindowStore(client));

    try {
      expect((await limiter.consume('login:x', 3, 60_000)).allowed).toBe(true);
      expect(limiter.snapshot().shared).toBe(true);
    } finally {
      await redis.crash();
    }

    // الخادم ساقط: الطلب يُخدم بالدلو المحلي — لا 500 ولا 429 على مستخدمٍ مشروع.
    const afterCrash = await limiter.consume('login:x', 3, 60_000);
    expect(afterCrash.allowed).toBe(true);
    const snapshot = limiter.snapshot();
    expect(snapshot.shared).toBe(false);
    expect(snapshot.fallbacks).toBeGreaterThan(0);
    expect(snapshot.lastError).not.toBeNull();

    await client.quit().catch(() => undefined);
  });

  it('reports an honest snapshot before any call (no invented counters)', async () => {
    const redis = await startStubRedis();
    const client = new Redis(redis.url);
    const limiter = new RateLimiterService(new RedisWindowStore(client));
    try {
      expect(limiter.snapshot()).toEqual({
        store: 'redis',
        shared: true,
        fallbacks: 0,
        lastFallbackAt: null,
        lastError: null,
      });
    } finally {
      await client.quit().catch(() => undefined);
      await redis.close();
    }
  });
});
