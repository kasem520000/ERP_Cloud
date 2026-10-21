import 'reflect-metadata';

/**
 * Vitest setup — NestJS needs `reflect-metadata` loaded before any decorated class is
 * evaluated, and it must happen before the test modules are imported.
 */
Object.assign(process.env, {
  NODE_ENV: process.env.NODE_ENV ?? 'test',
  /**
   * الاختبارات لا تخاطب Redis حقيقياً: `.env` يضبط `REDIS_URL=localhost:6379` وغالباً
   * لا شيء يستمع هناك، فيدفع كل طلب ثمن مهلة `RATE_LIMIT_REDIS_TIMEOUT_MS` ثم يسقط
   * إلى المحلي — 24 ثانية بدل 4 في ملفٍ واحد. المشاركة نفسها مُثبتة في
   * `rate-limiter.service.spec.ts` على مقبسٍ حقيقي (`test/support/stub-redis.ts`).
   */
  RATE_LIMIT_STORE: process.env.RATE_LIMIT_STORE ?? 'memory',
});
