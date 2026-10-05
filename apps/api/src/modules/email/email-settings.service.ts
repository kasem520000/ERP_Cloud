import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { env } from '@erp/config';
import {
  emailAuditActions,
  type EmailProvider,
  type EmailSettings,
  type EmailSettingsUpdate,
} from '@erp/contracts';
import { newId, withPlatformAdminTx, type DatabaseHandle, type DrizzleTx } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.tokens.js';
import { getAuthContext } from '../../request-context/request-context.js';
import { AuditService } from '../platform-services/audit/audit.service.js';

/**
 * P-C6 — إعدادات البريد: هوية المُرسِل والحدود، بصفٍّ عامّ وصفٍّ لكل عميل.
 *
 * **ما لا يخزّنه هذا الجدول، ولماذا:** اعتمادات SMTP (المستخدم وكلمة المرور). جدولٌ يقرأه
 * مشغّلٌ ليس مكان سرّ، والتقليد في هذا المستودع أن تُقرأ الأسرار من البيئة (`SMTP_USER` ·
 * `SMTP_PASS`) كما يفعل `smtpOptionsFromEnv` منذ PHASE_04. أمّا **المزوّد** فيُخزَّن لأن
 * تبديله قرارٌ تشغيلي لا يجوز أن يحتاج إعادة نشر (نصّ الخطة §7.2)، و`email.service` يبني
 * المهايئ المطلوب لحظة الإرسال (`createMailerFor`).
 *
 * **الوراثة حقلٌ بحقل.** صفّ العميل يتفوّق على صفّ المنصة في الحقول التي يحملها، وما تركه
 * العميل `null` (مثل `replyTo` أو `dailyLimit`) يرثه من المنصة — فلا يضطر عميلٌ إلى تكرار
 * إعدادٍ لم يغيّره.
 */
@Injectable()
export class EmailSettingsService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  /** الإعدادات الفعّالة لعميلٍ (أو للمنصة عند `null`). */
  async effective(tenantId: string | null): Promise<EmailSettings> {
    return withPlatformAdminTx(this.database.db, (tx) => this.effectiveInTx(tx, tenantId));
  }

  private async effectiveInTx(tx: DrizzleTx, tenantId: string | null): Promise<EmailSettings> {
    const platform = (await tx.execute(sql`
      SELECT id, tenant_id, provider, from_name, from_email, reply_to, sending_domain,
             daily_limit, monthly_limit, updated_at, updated_by
        FROM email_settings WHERE tenant_id IS NULL LIMIT 1
    `)).rows[0];
    const tenant = tenantId
      ? (await tx.execute(sql`
          SELECT id, tenant_id, provider, from_name, from_email, reply_to, sending_domain,
                 daily_limit, monthly_limit, updated_at, updated_by
            FROM email_settings WHERE tenant_id = ${tenantId} LIMIT 1
        `)).rows[0]
      : undefined;

    const pick = <T>(key: string, fallback: T): T => {
      const fromTenant = tenant ? (tenant[key] as T | null | undefined) : undefined;
      if (fromTenant !== undefined && fromTenant !== null) return fromTenant;
      const fromPlatform = platform ? (platform[key] as T | null | undefined) : undefined;
      if (fromPlatform !== undefined && fromPlatform !== null) return fromPlatform;
      return fallback;
    };

    const row = tenant ?? platform;
    return {
      tenantId,
      // أوّل قراءةٍ ترث ما يشغّله الخادم فعلاً (`MAIL_TRANSPORT`)، فلا تكون الشاشة كاذبة.
      provider: pick<EmailProvider>('provider', env.MAIL_TRANSPORT as EmailProvider),
      fromName: pick<string>('from_name', 'منصة ERP'),
      fromEmail: pick<string>('from_email', env.MAIL_FROM),
      replyTo: pick<string | null>('reply_to', null),
      sendingDomain: pick<string | null>('sending_domain', null),
      dailyLimit: pick<number | null>('daily_limit', null),
      monthlyLimit: pick<number | null>('monthly_limit', null),
      smtpHost: env.SMTP_HOST || null,
      smtpConfigured: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS),
      updatedAt: row?.updated_at ? new Date(row.updated_at as string).toISOString() : null,
      updatedBy: row?.updated_by ? String(row.updated_by) : null,
    };
  }

  /** كتابة صفٍّ عامّ أو صفّ عميل — upsert بلا مسار حذف (إفراغ حقلٍ يعني «ارث من المنصة»). */
  async update(
    tenantId: string | null,
    input: EmailSettingsUpdate,
    reason?: string,
  ): Promise<EmailSettings> {
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const before = await this.effectiveInTx(tx, tenantId);
      const existing = (await tx.execute(sql`
        SELECT id FROM email_settings
         WHERE ${tenantId === null ? sql`tenant_id IS NULL` : sql`tenant_id = ${tenantId}`}
         LIMIT 1
      `)).rows[0];

      const fields: Record<string, unknown> = {
        provider: input.provider ?? null,
        from_name: input.fromName ?? null,
        from_email: input.fromEmail ?? null,
        reply_to: input.replyTo === undefined ? undefined : input.replyTo,
        sending_domain: input.sendingDomain === undefined ? undefined : input.sendingDomain,
        daily_limit: input.dailyLimit === undefined ? undefined : input.dailyLimit,
        monthly_limit: input.monthlyLimit === undefined ? undefined : input.monthlyLimit,
      };

      if (existing) {
        await tx.execute(sql`
          UPDATE email_settings SET
            provider       = COALESCE(${fields.provider ?? null}, provider),
            from_name      = COALESCE(${fields.from_name ?? null}, from_name),
            from_email     = COALESCE(${fields.from_email ?? null}, from_email),
            reply_to       = CASE WHEN ${input.replyTo === undefined} THEN reply_to ELSE ${input.replyTo ?? null} END,
            sending_domain = CASE WHEN ${input.sendingDomain === undefined} THEN sending_domain ELSE ${input.sendingDomain ?? null} END,
            daily_limit    = CASE WHEN ${input.dailyLimit === undefined} THEN daily_limit ELSE ${input.dailyLimit ?? null} END,
            monthly_limit  = CASE WHEN ${input.monthlyLimit === undefined} THEN monthly_limit ELSE ${input.monthlyLimit ?? null} END,
            updated_at     = now(),
            updated_by     = ${getAuthContext().userId}
          WHERE id = ${String(existing.id)}
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO email_settings
            (id, tenant_id, provider, from_name, from_email, reply_to, sending_domain,
             daily_limit, monthly_limit, updated_by)
          VALUES (
            ${newId()}, ${tenantId},
            ${(input.provider ?? before.provider) as string},
            ${(input.fromName ?? before.fromName) as string},
            ${(input.fromEmail ?? before.fromEmail) as string},
            ${input.replyTo === undefined ? null : input.replyTo},
            ${input.sendingDomain === undefined ? null : input.sendingDomain},
            ${input.dailyLimit === undefined ? null : input.dailyLimit},
            ${input.monthlyLimit === undefined ? null : input.monthlyLimit},
            ${getAuthContext().userId}
          )
        `);
      }

      const after = await this.effectiveInTx(tx, tenantId);
      await this.audit.recordInTx(tx, {
        tenantId,
        actorUserId: getAuthContext().userId,
        action: tenantId ? emailAuditActions.tenantSettingsUpdate : emailAuditActions.settingsUpdate,
        entity: 'email_settings',
        entityId: existing ? String(existing.id) : null,
        before: { provider: before.provider, fromName: before.fromName, fromEmail: before.fromEmail },
        after: {
          provider: after.provider,
          fromName: after.fromName,
          fromEmail: after.fromEmail,
          sendingDomain: after.sendingDomain,
          dailyLimit: after.dailyLimit,
          monthlyLimit: after.monthlyLimit,
        },
        meta: { scope: tenantId ? 'tenant' : 'platform_console', reason: reason ?? null },
      });
      return after;
    });
  }

  /**
   * حدّا الإرسال المعلَنان في الإعدادات — يُقرآن عند كل محاولة إرسال. لا يُخلَطان بحصّة
   * P-C5 (`limits.max_emails_per_month`): تلك حصّة**مطَبَّقة** عبر `usage_counters`، وهذان
   * سقفان تشغيليان يمنعان إغراق مزوّد البريد (سياسة المُرسِل لا العقد).
   */
  async limitsFor(tenantId: string | null): Promise<{ daily: number | null; monthly: number | null }> {
    const settings = await this.effective(tenantId);
    return { daily: settings.dailyLimit, monthly: settings.monthlyLimit };
  }
}
