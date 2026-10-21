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
  /**
   * مهل المقبس في الاختبارات أوسع منها في الإنتاج، والسبب مقيس لا تفضيلي.
   *
   * الإنتاج يقطع الطلب بعد ٣٠ ثانية (`HTTP_REQUEST_TIMEOUT_MS`) حمايةً من slowloris —
   * وهذا صحيح هناك. لكن المجموعة كلها تعمل على نواةٍ واحدة وتُنفّذ معاملات ثقيلة
   * (رواتب، مخزون) متزامنة؛ فطلبٌ ينتظر قفل صفٍّ في اختبار التزامن قد يتجاوز ٣٠ ثانية
   * فيقطع Node المقبس ويصل الخطأ `ECONNRESET` بدل `409` المتوقّع. فيصير الاختبار
   * معتمداً على سرعة الجهاز: ينجح منفرداً ويفشل في التشغيل الكامل.
   */
  HTTP_REQUEST_TIMEOUT_MS: process.env.HTTP_REQUEST_TIMEOUT_MS ?? '180000',
  HTTP_HEADERS_TIMEOUT_MS: process.env.HTTP_HEADERS_TIMEOUT_MS ?? '60000',
});
