import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { einvoiceSettings, type DatabaseHandle } from '@erp/database';
import { env } from '@erp/config';

import { DATABASE_HANDLE } from '../../database/database.module.js';

import { EinvoicingService } from './einvoicing.service.js';

/**
 * ⏰ ما فات — مُجدول إعادة الإرسال إلى ZATCA.
 *
 * كان البند الرابع في حكم البند ١١: «لا مجدول يضمن الإبلاغ داخل المهلة». الإرسال التلقائي
 * بعد الترحيل يحلّ اللحظة، لكنه يترك ثلاث حالات بلا علاج:
 *
 *   • فاتورةٌ رُحِّلت والشبكة مقطوعة (فشل الإرسال),
 *   • فاتورةٌ رُحِّلت قبل إصدار الشهادة (لا توقيع بعد),
 *   • خادمٌ أُعيد تشغيله والطلبُ لم يكتمل.
 *
 * النبضة تمرّ على المنشآت التي ربطها مفعّل (و«مزامنة يدوية» مطفأة — فالمفتاح يعني ما يقول)
 * وتعيد ما لم يُقبل داخل نافذة الـ٢٤ ساعة. لا تعيد ما قبلها: مستندٌ خارج المهلة يحتاج قرار
 * المحاسب لا إرسالاً أعمى. وتُسجّل تحذيراً بما قارب المهلة، ليظهر في `/einvoice/health`.
 */
@Injectable()
export class EinvoiceRetryScheduler implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(EinvoiceRetryScheduler.name);
  private timer: ReturnType<typeof setInterval> | undefined;

  /** نبضة كل عشر دقائق: أسرع من مهلة الـ٢٤ ساعة بكثير، وأبطأ من أن تُثقل القاعدة. */
  private static readonly TICK_MS = 10 * 60_000;

  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly einvoicing: EinvoicingService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.tick().catch((error: unknown) => {
        this.logger.error({ err: error instanceof Error ? error.message : String(error) }, 'zatca retry tick failed');
      });
    }, EinvoiceRetryScheduler.TICK_MS);
    this.timer.unref?.();
    this.logger.log({ tickMs: EinvoiceRetryScheduler.TICK_MS }, 'zatca retry ticker started');
    // لحاق الإقلاع: نبضة واحدة الآن، فإعادة تشغيل الخادم لا تؤجّل الإرسال عشر دقائق.
    void this.tick().catch(() => undefined);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over the tenants whose link is on. Exposed for tests and for a manual kick. */
  async tick(): Promise<{ tenants: number; retried: number; failed: number; overdue: number }> {
    const settings = await this.database.db
      .select({ tenantId: einvoiceSettings.tenantId, syncManual: einvoiceSettings.syncManual, active: einvoiceSettings.active })
      .from(einvoiceSettings)
      .where(eq(einvoiceSettings.authority, 'zatca'));

    let retried = 0;
    let failed = 0;
    let overdue = 0;
    let tenants = 0;
    for (const row of settings) {
      if (!row.active || row.syncManual) continue;
      tenants += 1;
      try {
        const result = await this.einvoicing.retryPending(row.tenantId);
        retried += result.retried;
        failed += result.failed;
        overdue += result.overdue;
        if (result.overdue > 0) {
          this.logger.warn(
            { tenantId: row.tenantId, overdue: result.overdue },
            'ZATCA: مستندات لم تُقبل وقاربت مهلة الإبلاغ (٢٤ ساعة)',
          );
        }
      } catch (error) {
        this.logger.warn(
          { tenantId: row.tenantId, err: error instanceof Error ? error.message : String(error) },
          'zatca retry skipped for tenant',
        );
      }
    }
    return { tenants, retried, failed, overdue };
  }
}
