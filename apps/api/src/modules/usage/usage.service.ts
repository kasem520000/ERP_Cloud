import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import {
  DomainError,
  errorCodes,
  platformSettingDefinitions,
  usageAuditActions,
  usageMetricDefinition,
  usageMetricRegistry,
  usageModuleLabelsAr,
  usagePercentUsed,
  usagePeriodOf,
  usageSoftThresholdPercent,
  usageStateFor,
  type CreateUsageRequestInput,
  type PlatformUsageGridResponse,
  type PlatformUsageGridRow,
  type ReviewUsageRequestInput,
  type UsageAvailablePlan,
  type UsageMetricKey,
  type UsageMetricState,
  type UsageMetricUsage,
  type UsageModuleKey,
  type UsageRequest,
  type UsageRequestStatus,
  type UsageSnapshot,
  type UsageSubscriptionSummary,
} from '@erp/contracts';
import {
  newId,
  withPlatformAdminTx,
  withTenantTx,
  type DatabaseHandle,
  type DrizzleTx,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
// مسار مباشر لا برميل: البرميل يعيد تصدير `PlatformServicesModule` الذي يوفّر
// `FilesService`، وهذا الأخير يستدعي `UsageService` — فكانت الحلقة (Nest: «circular
// dependency inside UsageModule»). الوحدة عالمية، و`AuditService` يُحقن منها بلا حاجة
// إلى استيراد الوحدة نفسها.
import { AuditService } from '../platform-services/audit/audit.service.js';

/** أرقام مقياسٍ واحد في لحظةٍ واحدة. */
type Measured = Record<UsageMetricKey, number>;

/** ما تحتاجه القراءة كلها: الأرقام، وسلسلة استدعاءات الـAPI، وحدود المقياس. */
type Measurement = {
  values: Map<string, Measured>;
  series: Map<string, { day: string; count: number }[]>;
};

type EffectiveLimit = {
  /** `plan` — حدٌّ من باقة الاشتراك النشطة، و`tenant` تجاوزٌ صريح فوقه. */
  value: number | null;
  source: 'tenant' | 'plan' | 'platform' | 'default';
  enforced: boolean;
};

const SERIES_DAYS = 30;

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  // ══════════════════════════════════════════════════ القراءة

  /** لقطة العميل نفسه — يُقرأ فيها سطح العميل بمعاملة مستأجر (العزل يضمن ألّا يرى غير نفسه). */
  async snapshotForTenant(tenantId: string, period: string = usagePeriodOf()): Promise<UsageSnapshot> {
    const [limits, subscription] = await withPlatformAdminTx(this.database.db, async (tx) => [
      await this.limitsInTx(tx, tenantId),
      await this.subscriptionSummaryInTx(tx, tenantId),
    ]);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const tenant = await this.tenantInTx(tx, tenantId);
      const measured = await this.measureInTx(tx, [tenantId], period);
      return this.assemble(tenantId, tenant, period, measured, limits, subscription);
    });
  }

  /** لقطة عميلٍ من المنصة — تبويب «الاستخدام» في بطاقة العميل. */
  async snapshotForPlatform(tenantId: string, period: string = usagePeriodOf()): Promise<UsageSnapshot> {
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const tenant = await this.tenantInTx(tx, tenantId);
      const limits = await this.limitsInTx(tx, tenantId);
      const subscription = await this.subscriptionSummaryInTx(tx, tenantId);
      const measured = await this.measureInTx(tx, [tenantId], period);
      return this.assemble(tenantId, tenant, period, measured, limits, subscription);
    });
  }

  /** شبكة اللوحة — كل العملاء باستعلامٍ لكل مقياس، وحدود كل منشأة معزولة لمنشأتها وحدها. */
  async grid(period: string = usagePeriodOf()): Promise<PlatformUsageGridResponse> {
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const tenants = await tx.execute(sql`
        SELECT id, code, name, status FROM tenants
         WHERE status <> 'archived'
         ORDER BY code ASC
      `);
      const ids = tenants.rows.map((row) => String(row.id));
      const limitsByTenant = await this.limitsByTenantInTx(tx, ids);
      const measured = await this.measureInTx(tx, ids, period);

      const rows: PlatformUsageGridRow[] = tenants.rows.map((tenant) => {
        const tenantId = String(tenant.id);
        const snapshot = this.assemble(
          tenantId,
          { code: String(tenant.code), name: String(tenant.name), status: String(tenant.status) },
          period,
          measured,
          limitsByTenant.get(tenantId) ?? new Map(),
          null,
        );
        return {
          tenantId,
          tenantCode: snapshot.tenantCode,
          tenantName: snapshot.tenantName,
          status: snapshot.tenantStatus,
          metrics: snapshot.metrics,
          worst: worstState(snapshot.metrics.map((metric) => metric.state)),
          softCount: snapshot.metrics.filter((metric) => metric.state === 'soft').length,
          hardCount: snapshot.metrics.filter((metric) => metric.state === 'hard').length,
        };
      });

      rows.sort(
        (a, b) => stateWeight(b.worst) - stateWeight(a.worst) || a.tenantCode.localeCompare(b.tenantCode, 'ar'),
      );

      const sum = (metric: UsageMetricKey) =>
        rows.reduce((acc, row) => acc + (row.metrics.find((entry) => entry.key === metric)?.used ?? 0), 0);

      return {
        period,
        periodStart: monthStartIso(period),
        periodEnd: monthEndIso(period),
        tenants: rows,
        totals: {
          tenants: rows.length,
          soft: rows.reduce((acc, row) => acc + row.softCount, 0),
          hard: rows.reduce((acc, row) => acc + row.hardCount, 0),
          apiCallsToday: sum('api_calls_per_day'),
          invoicesThisMonth: sum('invoices_per_month'),
        },
        generatedAt: new Date().toISOString(),
      };
    });
  }

  /** سطور تصدير الشبكة — تُبنى من الشبكة نفسها فلا يخرج ملفٌّ يخالف الشاشة. */
  async exportRows(period: string = usagePeriodOf()): Promise<string[][]> {
    const grid = await this.grid(period);
    const rows: string[][] = [
      [
        'period',
        'tenantCode',
        'tenantName',
        'metric',
        'labelAr',
        'used',
        'limit',
        'limitSource',
        'percentUsed',
        'state',
        'enforced',
      ],
    ];
    for (const tenant of grid.tenants) {
      for (const metric of tenant.metrics) {
        rows.push([
          grid.period,
          tenant.tenantCode,
          tenant.tenantName,
          metric.key,
          metric.labelAr,
          String(metric.used),
          metric.limit === null ? '' : String(metric.limit),
          metric.limitSource,
          metric.percentUsed === null ? '' : String(metric.percentUsed),
          metric.state,
          metric.enforced ? 'yes' : 'no',
        ]);
      }
    }
    return rows;
  }

  // ══════════════════════════════════════════════════ الكتابة والإنفاذ

  /**
   * زيادة عدّادٍ ذرّية وإرجاع قيمته الجديدة. الفترة تُشتقّ من المقياس نفسه (يومي/شهري)، فلا
   * يكتب المستدعي تقويماً.
   */
  async record(tenantId: string, metric: UsageMetricKey, by = 1): Promise<number> {
    const definition = usageMetricDefinition(metric);
    if (definition.source !== 'counter') {
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        `${definition.labelAr} يُقاس من الجدول لا من عدّاد`,
        400,
        { metric },
      );
    }
    const period = definition.period === 'day' ? todayIso() : usagePeriodOf();
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const result = await tx.execute(sql`
        INSERT INTO usage_counters (id, tenant_id, metric, period, value, created_at, updated_at)
        VALUES (${newId()}, ${tenantId}, ${metric}, ${period}, ${by}, now(), now())
        ON CONFLICT (tenant_id, metric, period)
        DO UPDATE SET value = usage_counters.value + ${by}, updated_at = now()
        RETURNING value::int AS value
      `);
      return Number(result.rows[0]?.value ?? 0);
    });
  }

  /**
   * عدّاد استدعاءات الـAPI: يُزاد **ثم** يُفحص، فالرفض عند الحدّ لا يسمح بطلبٍ إضافي ولا
   * يفلت منه طلبان متوازيان. والقياس لا يُسقِط الطلب عند خطأ قاعدة: سجلٌّ مفقود أهون من
   * خدمةٍ معطَّلة.
   */
  async meterApiCall(tenantId: string): Promise<void> {
    let value: number;
    try {
      value = await this.record(tenantId, 'api_calls_per_day');
    } catch (error) {
      this.logger.warn(`usage meter failed for ${tenantId}: ${(error as Error).message}`);
      return;
    }
    const limit = (await this.limitsFor(tenantId)).get('api_calls_per_day');
    if (!limit || !limit.enforced || limit.value === null) return;
    if (value > limit.value) {
      const labelAr = usageMetricDefinition('api_calls_per_day').labelAr;
      await this.auditOnce(tenantId, usageAuditActions.limitReached, 'api_calls_per_day', {
        used: value,
        limit: limit.value,
        limitSource: limit.source,
      });
      throw new DomainError(
        errorCodes.USAGE_LIMIT_REACHED,
        `اشتراكك وحصتك الحالية لا تسمح بالعملية: بلغت حدّ «${labelAr}» (${value} من ${limit.value}). قدّم طلباً لإدارة المنصة للاعتماد أو ترقية الباقة.`,
        409,
        { metric: 'api_calls_per_day', used: value, limit: limit.value },
      );
    }
    await this.notifySoft(tenantId, 'api_calls_per_day', value, limit);
  }

  /**
   * حرّاس الكتابة في سطح العميل: يُنادى **قبل** الإنشاء، ويرمي `USAGE_LIMIT_REACHED` (409)
   * حين يكون الاشتراك موقوفاً مؤقتاً أو حين يكون الحدّ مطبَّقاً ويبلغه العميل.
   */
  async assertWithinLimit(tenantId: string, metric: UsageMetricKey, by = 1): Promise<void> {
    const { limits, pausedPlanName } = await withPlatformAdminTx(this.database.db, async (tx) => {
      const paused = await tx.execute(sql`
        SELECT p.name AS plan_name
          FROM tenant_subscriptions s
          JOIN billing_plans p ON p.id = s.plan_id
         WHERE s.tenant_id = ${tenantId}::uuid AND s.status = 'paused'
         LIMIT 1
      `);
      return {
        limits: await this.limitsInTx(tx, tenantId),
        pausedPlanName: paused.rows[0]?.plan_name ? String(paused.rows[0].plan_name) : null,
      };
    });

    if (pausedPlanName) {
      throw new DomainError(
        errorCodes.USAGE_LIMIT_REACHED,
        `اشتراك منشأتك في باقة «${pausedPlanName}» موقوف مؤقتاً حالياً ولا يسمح بتنفيذ هذه العملية. يرجى تقديم طلب لإدارة المنصة للاعتماد أو إعادة التفعيل.`,
        409,
        { metric, paused: true },
      );
    }

    const limit = limits.get(metric);
    if (!limit || !limit.enforced || limit.value === null) return;

    const used = await this.usedFor(tenantId, metric);
    const after = used + by;
    if (after > limit.value) {
      const labelAr = usageMetricDefinition(metric).labelAr;
      await this.auditOnce(tenantId, usageAuditActions.limitReached, metric, {
        used,
        would: after,
        limit: limit.value,
        limitSource: limit.source,
      });
      throw new DomainError(
        errorCodes.USAGE_LIMIT_REACHED,
        `اشتراكك وحصتك الحالية لا تسمح بالعملية: بلغت حدّ «${labelAr}» (${used} من ${limit.value}). قدّم طلباً لإدارة المنصة للاعتماد أو ترقية الباقة.`,
        409,
        { metric, used, limit: limit.value, requested: by },
      );
    }
    await this.notifySoft(tenantId, metric, after, limit);
  }

  /**
   * حارس وحدات الباقة (`feature.pos` · `feature.projects` · `feature.hrm` · `feature.niche`):
   * إذا كان للمنشأة اشتراكٌ حيّ (`active` / `trialing` / `past_due`) وباقته تنصّ صراحةً على أنّ
   * الوحدة غير مشمولة (`value = false`) دون وجود تجاوز صريح `true` في `tenant_settings`، يُمنع
   * التنفيذ برمز `USAGE_LIMIT_REACHED` وتُوجَّه المنشأة لتقديم طلب اعتماد لإدارة المنصة.
   */
  async assertModuleAllowed(tenantId: string, moduleKey: UsageModuleKey): Promise<void> {
    const decision = await withPlatformAdminTx(this.database.db, async (tx) => {
      const overrideRow = await tx.execute(sql`
        SELECT value FROM tenant_settings
         WHERE tenant_id = ${tenantId}::uuid AND key = ${moduleKey}
         LIMIT 1
      `);
      const overrideVal = overrideRow.rows[0]?.value;
      if (overrideVal === true || overrideVal === 'true') {
        return { allowed: true as const };
      }

      const planEntitlement = await tx.execute(sql`
        SELECT p.name AS plan_name, e.value
          FROM tenant_subscriptions s
          JOIN billing_plans p ON p.id = s.plan_id
          JOIN billing_plan_entitlements e ON e.plan_id = s.plan_id AND e.kind = 'module' AND e.key = ${moduleKey}
         WHERE s.tenant_id = ${tenantId}::uuid
           AND s.status IN ('active', 'trialing', 'past_due')
         ORDER BY s.created_at DESC
         LIMIT 1
      `);
      const row = planEntitlement.rows[0];
      if (!row) return { allowed: true as const };
      if (row.value === false || row.value === 'false') {
        return {
          allowed: false as const,
          planName: String(row.plan_name),
        };
      }
      return { allowed: true as const };
    });

    if (!decision.allowed) {
      const moduleLabel = usageModuleLabelsAr[moduleKey] ?? moduleKey;
      throw new DomainError(
        errorCodes.USAGE_LIMIT_REACHED,
        `اشتراكك الحالي في باقة «${decision.planName}» لا يتضمّن ميزة «${moduleLabel}». قدّم طلباً لإدارة المنصة للاعتماد أو ترقية الباقة.`,
        409,
        { module: moduleKey, planName: decision.planName },
      );
    }
  }

  // ══════════════════════════════════════════════════ طلبات اعتماد الحصص وترقية الباقات

  /** كتالوج الباقات النشطة وحقوقها لعرضها للمنشأة عند طلب الترقية. */
  async listAvailablePlansForTenant(): Promise<UsageAvailablePlan[]> {
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const plansRes = await tx.execute(sql`
        SELECT id, code, name, interval, amount::text AS amount, currency
          FROM billing_plans
         WHERE active = true
         ORDER BY amount ASC, interval ASC, code ASC
      `);
      if (plansRes.rows.length === 0) return [];
      const planIds = plansRes.rows.map((r) => String(r.id));
      const entRes = await tx.execute(sql`
        SELECT plan_id, kind, key, value
          FROM billing_plan_entitlements
         WHERE plan_id IN (${uuidList(planIds)})
         ORDER BY kind ASC, key ASC
      `);
      return plansRes.rows.map((p) => {
        const pid = String(p.id);
        const entitlements = entRes.rows
          .filter((e) => String(e.plan_id) === pid)
          .map((e) => ({
            kind: (String(e.kind) as 'module' | 'limit' | 'flag'),
            key: String(e.key),
            value: (typeof e.value === 'boolean' || typeof e.value === 'number' || typeof e.value === 'string'
              ? e.value
              : String(e.value ?? '')) as boolean | number | string,
          }));
        return {
          id: pid,
          code: String(p.code),
          name: String(p.name),
          interval: String(p.interval) === 'year' ? 'year' : 'month',
          amount: String(p.amount),
          currency: String(p.currency),
          entitlements,
        };
      });
    });
  }

  /** قائمة طلبات المنشأة نفسها مع حالة الاعتماد وملاحظات المنصة. */
  async listRequestsForTenant(tenantId: string): Promise<UsageRequest[]> {
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const res = await tx.execute(sql`
        SELECT r.*,
               t.code AS tenant_code,
               t.name AS tenant_name,
               rp.name AS requested_plan_name,
               req_u.email AS requested_by_email,
               rev_u.email AS reviewed_by_email
          FROM tenant_quota_requests r
          JOIN tenants t ON t.id = r.tenant_id
          LEFT JOIN billing_plans rp ON rp.id = r.requested_plan_id
          LEFT JOIN users req_u ON req_u.id = r.requested_by
          LEFT JOIN users rev_u ON rev_u.id = r.reviewed_by
         WHERE r.tenant_id = ${tenantId}::uuid
         ORDER BY r.created_at DESC
         LIMIT 100
      `);
      return res.rows.map((row) => this.mapRequestRow(row));
    });
  }

  /** تقديم طلب رفع حصة أو تفعيل ميزة أو ترقية باقة من المنشأة إلى إدارة المنصة. */
  async createRequest(
    tenantId: string,
    actorUserId: string,
    input: CreateUsageRequestInput,
  ): Promise<UsageRequest> {
    const currentLimit =
      input.requestType === 'quota_increase' && input.metricKey
        ? ((await this.limitsFor(tenantId)).get(input.metricKey)?.value ?? null)
        : null;

    if (input.requestType === 'plan_upgrade' && input.requestedPlanId) {
      const exists = await withPlatformAdminTx(this.database.db, async (tx) => {
        const r = await tx.execute(sql`
          SELECT id FROM billing_plans WHERE id = ${input.requestedPlanId}::uuid AND active = true LIMIT 1
        `);
        return r.rows.length > 0;
      });
      if (!exists) {
        throw new DomainError(errorCodes.NOT_FOUND, 'الباقة المطلوبة غير متاحة حالياً', 404);
      }
    }

    const requestId = newId();
    await withTenantTx(this.database.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO tenant_quota_requests
          (id, tenant_id, requested_by, request_type, metric_key, module_key,
           current_limit, requested_limit, requested_plan_id, reason, status, created_at, updated_at)
        VALUES
          (${requestId}::uuid, ${tenantId}::uuid, ${actorUserId}::uuid,
           ${input.requestType},
           ${input.metricKey ?? null},
           ${input.moduleKey ?? null},
           ${currentLimit},
           ${input.requestedLimit ?? null},
           ${input.requestedPlanId ? sql`${input.requestedPlanId}::uuid` : sql`null::uuid`},
           ${input.reason.trim()},
           'pending', now(), now())
      `);

      await this.audit.recordInTx(tx, {
        tenantId,
        actorUserId,
        action: usageAuditActions.requestCreated,
        entity: 'tenant_quota_request',
        entityId: requestId,
        after: {
          requestType: input.requestType,
          metricKey: input.metricKey ?? null,
          moduleKey: input.moduleKey ?? null,
          currentLimit,
          requestedLimit: input.requestedLimit ?? null,
          requestedPlanId: input.requestedPlanId ?? null,
          reason: input.reason.trim(),
        },
        meta: { scope: 'tenant_usage' },
      });
    });

    const list = await this.listRequestsForTenant(tenantId);
    const created = list.find((item) => item.id === requestId);
    if (!created) throw new DomainError(errorCodes.INTERNAL, 'تعذّر قراءة الطلب بعد حفظه', 500);
    return created;
  }

  /** قائمة طلبات المنشآت على مستوى لوحة تحكم المنصة (مع الاستهلاك الحالي واسم الباقة). */
  async listRequestsForPlatform(status?: UsageRequestStatus): Promise<UsageRequest[]> {
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const res = await tx.execute(sql`
        SELECT r.*,
               t.code AS tenant_code,
               t.name AS tenant_name,
               cp.name AS current_plan_name,
               rp.name AS requested_plan_name,
               req_u.email AS requested_by_email,
               rev_u.email AS reviewed_by_email
          FROM tenant_quota_requests r
          JOIN tenants t ON t.id = r.tenant_id
          LEFT JOIN LATERAL (
            SELECT p.name
              FROM tenant_subscriptions s
              JOIN billing_plans p ON p.id = s.plan_id
             WHERE s.tenant_id = r.tenant_id
               AND s.status IN ('active', 'trialing', 'past_due', 'paused')
             ORDER BY s.created_at DESC
             LIMIT 1
          ) cp ON true
          LEFT JOIN billing_plans rp ON rp.id = r.requested_plan_id
          LEFT JOIN users req_u ON req_u.id = r.requested_by
          LEFT JOIN users rev_u ON rev_u.id = r.reviewed_by
         WHERE (${status ?? null}::text IS NULL OR r.status = ${status ?? null})
         ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END ASC, r.created_at DESC
         LIMIT 200
      `);
      const tenantIds = [...new Set(res.rows.map((r) => String(r.tenant_id)))];
      const measured = tenantIds.length > 0 ? await this.measureInTx(tx, tenantIds, usagePeriodOf()) : null;

      return res.rows.map((row) => {
        const mapped = this.mapRequestRow(row);
        if (mapped.metricKey && measured) {
          mapped.currentUsed = measured.values.get(mapped.tenantId)?.[mapped.metricKey] ?? 0;
        }
        return mapped;
      });
    });
  }

  /**
   * مراجعة الطلب واعتماده أو رفضه من لوحة تحكم المنصة:
   * - عند اعتماد `quota_increase`: يُكتب التجاوز مباشرة في `platform_settings` للمنشأة.
   * - عند اعتماد `module_enable`: تُفعَّل الوحدة في `tenant_settings` للمنشأة.
   * - عند اعتماد `plan_upgrade`: يُفعَّل اشتراك المنشأة على الباقة الجديدة.
   * - يُرسَل إشعارٌ فوري لمالكي المنشأة داخل النظام مع سجلّ تدقيقٍ كامل.
   */
  async reviewRequest(
    requestId: string,
    reviewerUserId: string,
    input: ReviewUsageRequestInput,
  ): Promise<UsageRequest> {
    const outcome = await withPlatformAdminTx(this.database.db, async (tx) => {
      const existing = await tx.execute(sql`
        SELECT * FROM tenant_quota_requests WHERE id = ${requestId}::uuid FOR UPDATE
      `);
      const req = existing.rows[0];
      if (!req) throw new DomainError(errorCodes.NOT_FOUND, 'الطلب غير موجود', 404);
      if (String(req.status) !== 'pending') {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'تمت مراجعة هذا الطلب مسبقاً', 409);
      }

      const tenantId = String(req.tenant_id);
      const reqType = String(req.request_type) as 'quota_increase' | 'plan_upgrade' | 'module_enable';
      const metricKey = req.metric_key ? (String(req.metric_key) as UsageMetricKey) : null;
      const moduleKey = req.module_key ? (String(req.module_key) as UsageModuleKey) : null;
      const requestedPlanId = req.requested_plan_id ? String(req.requested_plan_id) : null;
      const effectiveApprovedLimit =
        input.approve && reqType === 'quota_increase'
          ? (input.approvedLimit ?? numericValue(req.requested_limit) ?? 1)
          : null;

      let summaryAr = '';

      if (input.approve) {
        if (reqType === 'quota_increase' && metricKey && effectiveApprovedLimit !== null) {
          const def = usageMetricDefinition(metricKey);
          await tx.execute(sql`
            INSERT INTO platform_settings (id, tenant_id, key, value, updated_by, updated_at)
            VALUES (${newId()}::uuid, ${tenantId}::uuid, ${def.limitKey}, ${JSON.stringify(effectiveApprovedLimit)}::jsonb, ${reviewerUserId}::uuid, now())
            ON CONFLICT (tenant_id, key) WHERE tenant_id IS NOT NULL
            DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()
          `);
          summaryAr = `تم اعتماد رفع حصة «${def.labelAr}» إلى ${effectiveApprovedLimit} ${def.unitAr}.`;
        } else if (reqType === 'module_enable' && moduleKey) {
          summaryAr = `تم اعتماد تفعيل ميزة «${usageModuleLabelsAr[moduleKey] ?? moduleKey}» لمنشأتكم.`;
        } else if (reqType === 'plan_upgrade' && requestedPlanId) {
          const planRes = await tx.execute(sql`
            SELECT id, name, interval FROM billing_plans WHERE id = ${requestedPlanId}::uuid LIMIT 1
          `);
          const plan = planRes.rows[0];
          if (!plan) throw new DomainError(errorCodes.NOT_FOUND, 'الباقة المطلوبة غير موجودة', 404);
          const months = String(plan.interval) === 'year' ? 12 : 1;
          await tx.execute(sql`
            UPDATE tenant_subscriptions
               SET status = 'canceled', canceled_at = now(),
                   canceled_reason = 'استُبدل باعتماد طلب ترقية باقة', updated_at = now(), updated_by = ${reviewerUserId}::uuid
             WHERE tenant_id = ${tenantId}::uuid
               AND status IN ('trialing', 'active', 'past_due', 'paused')
          `);
          await tx.execute(sql`
            INSERT INTO tenant_subscriptions
              (id, tenant_id, plan_id, status, provider, activated_at, current_period_start,
               current_period_end, notes, updated_by)
            VALUES
              (${newId()}::uuid, ${tenantId}::uuid, ${requestedPlanId}::uuid, 'active', 'manual',
               now(), now(), (now() + (${months} || ' months')::interval),
               ${input.decisionNotes ?? 'ترقية باقة بناءً على طلب المنشأة'}, ${reviewerUserId}::uuid)
          `);
          summaryAr = `تم اعتماد ترقية اشتراك منشأتكم إلى باقة «${String(plan.name)}».`;
        }
      } else {
        summaryAr = `تم رفض الطلب من قِبل إدارة المنصة${input.decisionNotes ? `: ${input.decisionNotes}` : '.'}`;
      }

      const newStatus: UsageRequestStatus = input.approve ? 'approved' : 'rejected';
      await tx.execute(sql`
        UPDATE tenant_quota_requests
           SET status = ${newStatus},
               reviewed_by = ${reviewerUserId}::uuid,
               reviewed_at = now(),
               approved_limit = ${effectiveApprovedLimit},
               decision_notes = ${input.decisionNotes?.trim() || null},
               updated_at = now()
         WHERE id = ${requestId}::uuid
      `);

      await this.audit.recordInTx(tx, {
        tenantId,
        actorUserId: reviewerUserId,
        action: input.approve ? usageAuditActions.requestApproved : usageAuditActions.requestRejected,
        entity: 'tenant_quota_request',
        entityId: requestId,
        before: { status: 'pending' },
        after: {
          status: newStatus,
          approvedLimit: effectiveApprovedLimit,
          decisionNotes: input.decisionNotes?.trim() || null,
        },
        meta: { scope: 'platform_console', requestType: reqType, metricKey, moduleKey, requestedPlanId },
      });

      const owners = await tx.execute(sql`
        SELECT id FROM memberships
         WHERE tenant_id = ${tenantId}::uuid AND status = 'active' AND is_owner = true AND deleted_at IS NULL
      `);
      return {
        tenantId,
        reqType,
        moduleKey,
        summaryAr,
        ownerMembershipIds: owners.rows.map((r) => String(r.id)),
      };
    });

    // كتابة إعدادات المنشأة وإشعاراتها داخل معاملة المستأجر احتراماً لسياسة `tenant_isolation`
    await withTenantTx(this.database.db, outcome.tenantId, async (tx) => {
      if (input.approve && outcome.reqType === 'module_enable' && outcome.moduleKey) {
        await tx.execute(sql`
          INSERT INTO tenant_settings (tenant_id, key, value, updated_at, updated_by)
          VALUES (${outcome.tenantId}::uuid, ${outcome.moduleKey}, 'true'::jsonb, now(), ${reviewerUserId}::uuid)
          ON CONFLICT (tenant_id, key)
          DO UPDATE SET value = 'true'::jsonb, updated_at = now(), updated_by = EXCLUDED.updated_by
        `);
      }

      for (const membershipId of outcome.ownerMembershipIds) {
        await tx.execute(sql`
          INSERT INTO notifications (id, tenant_id, membership_id, type, payload, created_at)
          VALUES (
            ${newId()}::uuid,
            ${outcome.tenantId}::uuid,
            ${membershipId}::uuid,
            ${input.approve ? 'usage.request.approved' : 'usage.request.rejected'},
            ${JSON.stringify({
              title: input.approve ? 'تم اعتماد طلب رفع الحصة / الترقية' : 'نتيجة مراجعة طلب الحصة / الترقية',
              body: outcome.summaryAr,
              href: '/settings/usage',
            })}::jsonb,
            now()
          )
        `);
      }
    });

    const updated = (await this.listRequestsForPlatform()).find((r) => r.id === requestId);
    if (!updated) throw new DomainError(errorCodes.INTERNAL, 'تعذّر قراءة الطلب بعد المراجعة', 500);
    return updated;
  }

  private mapRequestRow(row: Record<string, unknown>): UsageRequest {
    const metricKey = row.metric_key ? (String(row.metric_key) as UsageMetricKey) : null;
    const moduleKey = row.module_key ? (String(row.module_key) as UsageModuleKey) : null;
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      tenantCode: row.tenant_code ? String(row.tenant_code) : undefined,
      tenantName: row.tenant_name ? String(row.tenant_name) : undefined,
      currentPlanName: row.current_plan_name ? String(row.current_plan_name) : null,
      requestType: String(row.request_type) as 'quota_increase' | 'plan_upgrade' | 'module_enable',
      metricKey,
      metricLabelAr: metricKey ? usageMetricDefinition(metricKey).labelAr : null,
      moduleKey,
      moduleLabelAr: moduleKey ? (usageModuleLabelsAr[moduleKey] ?? moduleKey) : null,
      currentUsed: null,
      currentLimit: numericValue(row.current_limit),
      requestedLimit: numericValue(row.requested_limit),
      approvedLimit: numericValue(row.approved_limit),
      requestedPlanId: row.requested_plan_id ? String(row.requested_plan_id) : null,
      requestedPlanName: row.requested_plan_name ? String(row.requested_plan_name) : null,
      reason: String(row.reason ?? ''),
      status: String(row.status) as UsageRequestStatus,
      decisionNotes: row.decision_notes ? String(row.decision_notes) : null,
      requestedByEmail: row.requested_by_email ? String(row.requested_by_email) : null,
      reviewedByEmail: row.reviewed_by_email ? String(row.reviewed_by_email) : null,
      createdAt:
        row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ''),
      reviewedAt:
        row.reviewed_at instanceof Date
          ? row.reviewed_at.toISOString()
          : row.reviewed_at
            ? String(row.reviewed_at)
            : null,
    };
  }

  // ══════════════════════════════════════════════════ الحدود والاشتراكات

  private async limitsFor(tenantId: string): Promise<Map<UsageMetricKey, EffectiveLimit>> {
    return withPlatformAdminTx(this.database.db, (tx) => this.limitsInTx(tx, tenantId));
  }

  private async limitsInTx(tx: DrizzleTx, tenantId: string): Promise<Map<UsageMetricKey, EffectiveLimit>> {
    const map = await this.limitsByTenantInTx(tx, [tenantId]);
    return map.get(tenantId) ?? new Map();
  }

  private async limitsByTenantInTx(
    tx: DrizzleTx,
    tenantIds: string[],
  ): Promise<Map<string, Map<UsageMetricKey, EffectiveLimit>>> {
    const out = new Map<string, Map<UsageMetricKey, EffectiveLimit>>();
    const defaults = new Map(
      usageMetricRegistry.map((metric) => {
        const definition = platformSettingDefinitions.find((entry) => entry.key === metric.limitKey);
        return [
          metric.key,
          typeof definition?.defaultValue === 'number' ? definition.defaultValue : null,
        ] as const;
      }),
    );

    if (tenantIds.length === 0) return out;

    const rows = await tx.execute(sql`
      SELECT tenant_id, key, value FROM platform_settings
       WHERE key IN (${keyList()})
         AND (tenant_id IS NULL OR tenant_id IN (${uuidList(tenantIds)}))
    `);

    /**
     * حدود الباقة تُطبَّق على كل اشتراكٍ حيّ (`active` · `trialing` · `past_due`):
     * التجربة المجانية والتأخر في السداد يخضعان لسقف الباقة ذاته حتى لا تتجاوز المنشأة حصتها.
     */
    const planRows = await tx.execute(sql`
      SELECT s.tenant_id, e.key, e.value
        FROM tenant_subscriptions s
        JOIN billing_plan_entitlements e ON e.plan_id = s.plan_id AND e.kind = 'limit'
       WHERE s.status IN ('active', 'trialing', 'past_due')
         AND s.tenant_id IN (${uuidList(tenantIds)})
    `);

    for (const tenantId of tenantIds) {
      const perMetric = new Map<UsageMetricKey, EffectiveLimit>();
      for (const metric of usageMetricRegistry) {
        const tenantRow = rows.rows.find(
          (row) => row.key === metric.limitKey && row.tenant_id !== null && String(row.tenant_id) === tenantId,
        );
        const planRow = planRows.rows.find(
          (row) => row.key === metric.limitKey && row.tenant_id !== null && String(row.tenant_id) === tenantId,
        );
        const platformRow = rows.rows.find((row) => row.key === metric.limitKey && row.tenant_id === null);
        const row = tenantRow ?? planRow ?? platformRow;
        const value = numericValue(row?.value);
        const source: EffectiveLimit['source'] = tenantRow
          ? 'tenant'
          : planRow
            ? 'plan'
            : platformRow
              ? 'platform'
              : 'default';
        perMetric.set(metric.key, {
          value: row ? value : (defaults.get(metric.key) ?? null),
          source,
          enforced: source !== 'default' && value !== null,
        });
      }
      out.set(tenantId, perMetric);
    }
    return out;
  }

  private async subscriptionSummaryInTx(
    tx: DrizzleTx,
    tenantId: string,
  ): Promise<UsageSubscriptionSummary | null> {
    const res = await tx.execute(sql`
      SELECT s.id, s.plan_id, s.status, s.current_period_end, s.trial_ends_at,
             p.code AS plan_code, p.name AS plan_name, p.interval, p.amount::text AS amount, p.currency
        FROM tenant_subscriptions s
        JOIN billing_plans p ON p.id = s.plan_id
       WHERE s.tenant_id = ${tenantId}::uuid
       ORDER BY CASE WHEN s.status IN ('active', 'trialing', 'past_due', 'paused') THEN 0 ELSE 1 END ASC,
                s.created_at DESC
       LIMIT 1
    `);
    const row = res.rows[0];
    if (!row) return null;
    return {
      subscriptionId: String(row.id),
      planId: String(row.plan_id),
      planCode: String(row.plan_code),
      planName: String(row.plan_name),
      status: String(row.status),
      interval: String(row.interval) === 'year' ? 'year' : 'month',
      amount: String(row.amount),
      currency: String(row.currency),
      currentPeriodEnd:
        row.current_period_end instanceof Date
          ? row.current_period_end.toISOString()
          : row.current_period_end
            ? String(row.current_period_end)
            : null,
      trialEndsAt:
        row.trial_ends_at instanceof Date
          ? row.trial_ends_at.toISOString()
          : row.trial_ends_at
            ? String(row.trial_ends_at)
            : null,
    };
  }

  /** استهلاك مقياسٍ واحد الآن — يُقرأ في الطائرة الإدارية (الفحص قبل الكتابة). */
  private async usedFor(tenantId: string, metric: UsageMetricKey): Promise<number> {
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const measured = await this.measureInTx(tx, [tenantId], usagePeriodOf());
      return measured.values.get(tenantId)?.[metric] ?? 0;
    });
  }

  // ══════════════════════════════════════════════════ القياس

  private async measureInTx(tx: DrizzleTx, tenantIds: string[], period: string): Promise<Measurement> {
    const values = new Map<string, Measured>();
    for (const tenantId of tenantIds) values.set(tenantId, emptyMeasured());
    if (tenantIds.length === 0) return { values, series: new Map() };

    const ids = uuidList(tenantIds);
    const start = monthStartIso(period);
    const end = monthEndIso(period);

    const derived = await tx.execute(sql`
      SELECT t.id AS tenant_id,
             COALESCE(m.n, 0)   AS users,
             COALESCE(b.n, 0)   AS branches,
             COALESCE(i.n, 0)   AS items,
             COALESCE(inv.n, 0) AS invoices_per_month,
             COALESCE(f.mb, 0)  AS storage_mb,
             COALESCE(w.n, 0)   AS whatsapp_per_month
        FROM tenants t
        LEFT JOIN (SELECT tenant_id, count(*)::int AS n FROM memberships
                    WHERE deleted_at IS NULL AND tenant_id IN (${ids}) GROUP BY 1) m ON m.tenant_id = t.id
        LEFT JOIN (SELECT tenant_id, count(*)::int AS n FROM branches
                    WHERE deleted_at IS NULL AND tenant_id IN (${ids}) GROUP BY 1) b ON b.tenant_id = t.id
        LEFT JOIN (SELECT tenant_id, count(*)::int AS n FROM items
                    WHERE deleted_at IS NULL AND tenant_id IN (${ids}) GROUP BY 1) i ON i.tenant_id = t.id
        LEFT JOIN (SELECT tenant_id, count(*)::int AS n FROM sales_invoices
                    WHERE tenant_id IN (${ids}) AND created_at >= ${start} AND created_at < ${end}
                    GROUP BY 1) inv ON inv.tenant_id = t.id
        LEFT JOIN (SELECT tenant_id, (COALESCE(sum(size_bytes), 0) / 1048576.0)::int AS mb FROM files
                    WHERE tenant_id IN (${ids}) AND status = 'ready' AND deleted_at IS NULL
                    GROUP BY 1) f ON f.tenant_id = t.id
        LEFT JOIN (SELECT tenant_id, count(*)::int AS n FROM whatsapp_messages
                    WHERE tenant_id IN (${ids}) AND status <> 'skipped'
                      AND created_at >= ${start} AND created_at < ${end} GROUP BY 1) w ON w.tenant_id = t.id
       WHERE t.id IN (${ids})
    `);
    for (const row of derived.rows) {
      const bucket = values.get(String(row.tenant_id));
      if (!bucket) continue;
      bucket.users = Number(row.users ?? 0);
      bucket.branches = Number(row.branches ?? 0);
      bucket.items = Number(row.items ?? 0);
      bucket.invoices_per_month = Number(row.invoices_per_month ?? 0);
      bucket.storage_mb = Number(row.storage_mb ?? 0);
      bucket.whatsapp_per_month = Number(row.whatsapp_per_month ?? 0);
    }

    const counters = await tx.execute(sql`
      SELECT tenant_id, metric, value::int AS value FROM usage_counters
       WHERE tenant_id IN (${ids})
         AND ((metric = 'api_calls_per_day' AND period = ${todayIso()})
           OR (metric = 'email_sends_per_month' AND period = ${period}))
    `);
    for (const row of counters.rows) {
      const bucket = values.get(String(row.tenant_id));
      if (!bucket) continue;
      const metric = String(row.metric) as UsageMetricKey;
      if (metric in bucket) bucket[metric] = Number(row.value ?? 0);
    }

    const series = await this.seriesInTx(tx, tenantIds);
    return { values, series };
  }

  private async seriesInTx(
    tx: DrizzleTx,
    tenantIds: string[],
    days = SERIES_DAYS,
  ): Promise<Map<string, { day: string; count: number }[]>> {
    const daysList: string[] = [];
    const cursor = new Date();
    cursor.setUTCHours(0, 0, 0, 0);
    for (let index = days - 1; index >= 0; index -= 1) {
      const day = new Date(cursor);
      day.setUTCDate(day.getUTCDate() - index);
      daysList.push(day.toISOString().slice(0, 10));
    }

    const perTenant = new Map<string, Map<string, number>>();
    for (const tenantId of tenantIds) perTenant.set(tenantId, new Map());
    if (tenantIds.length > 0) {
      const rows = await tx.execute(sql`
        SELECT tenant_id, period AS day, COALESCE(sum(value), 0)::int AS count FROM usage_counters
         WHERE metric = 'api_calls_per_day'
           AND tenant_id IN (${uuidList(tenantIds)})
           AND period >= ${daysList[0]}
         GROUP BY 1, 2
      `);
      for (const row of rows.rows) {
        const bucket = perTenant.get(String(row.tenant_id));
        if (!bucket) continue;
        bucket.set(String(row.day), Number(row.count ?? 0));
      }
    }

    const out = new Map<string, { day: string; count: number }[]>();
    for (const tenantId of tenantIds) {
      const counts = perTenant.get(tenantId) ?? new Map();
      out.set(
        tenantId,
        daysList.map((day) => ({ day, count: counts.get(day) ?? 0 })),
      );
    }
    return out;
  }

  // ══════════════════════════════════════════════════ التركيب

  private assemble(
    tenantId: string,
    tenant: { code: string; name: string; status: string },
    period: string,
    measured: Measurement,
    limits: Map<UsageMetricKey, EffectiveLimit>,
    subscription: UsageSubscriptionSummary | null,
  ): UsageSnapshot {
    const values = measured.values.get(tenantId) ?? emptyMeasured();
    const metrics: UsageMetricUsage[] = usageMetricRegistry.map((definition) => {
      const limit = limits.get(definition.key) ?? { value: null, source: 'default' as const, enforced: false };
      const used = Number(values[definition.key] ?? 0);
      const state = usageStateFor(used, limit.value);
      return {
        key: definition.key,
        labelAr: definition.labelAr,
        unitAr: definition.unitAr,
        period: definition.period,
        used,
        limit: limit.value,
        limitSource: limit.source,
        percentUsed: usagePercentUsed(used, limit.value),
        state,
        enforced: limit.enforced,
        noticeAr: noticeFor(definition.labelAr, used, limit, state),
        enforcedAtAr: definition.enforcedAtAr,
      };
    });

    return {
      tenantId,
      tenantCode: tenant.code,
      tenantName: tenant.name,
      tenantStatus: tenant.status,
      period,
      periodStart: monthStartIso(period),
      periodEnd: monthEndIso(period),
      metrics,
      apiCallsPerDay: measured.series.get(tenantId) ?? [],
      subscription,
      generatedAt: new Date().toISOString(),
    };
  }

  private async tenantInTx(tx: DrizzleTx, tenantId: string): Promise<{ code: string; name: string; status: string }> {
    const rows = await tx.execute(sql`
      SELECT code, name, status FROM tenants WHERE id = ${tenantId}
    `);
    const row = rows.rows[0];
    if (!row) throw new DomainError(errorCodes.NOT_FOUND, 'المنشأة غير موجودة', 404, { tenantId });
    return { code: String(row.code), name: String(row.name), status: String(row.status) };
  }

  // ══════════════════════════════════════════════════ الإشعار والتدقيق

  private async notifySoft(
    tenantId: string,
    metric: UsageMetricKey,
    after: number,
    limit: EffectiveLimit,
  ): Promise<void> {
    if (!limit.enforced || limit.value === null) return;
    const percent = usagePercentUsed(after, limit.value) ?? 0;
    if (percent < usageSoftThresholdPercent || after > limit.value) return;
    await this.auditOnce(tenantId, usageAuditActions.softLimit, metric, {
      used: after,
      limit: limit.value,
      percent,
      limitSource: limit.source,
    });
  }

  private async auditOnce(
    tenantId: string,
    action: string,
    metric: UsageMetricKey,
    meta: Record<string, unknown>,
  ): Promise<void> {
    const period = usagePeriodOf();
    try {
      await withTenantTx(this.database.db, tenantId, async (tx) => {
        const existing = await tx.execute(sql`
          SELECT 1 FROM audit_log
           WHERE tenant_id = ${tenantId} AND action = ${action}
             AND meta->>'metric' = ${metric} AND meta->>'period' = ${period}
           LIMIT 1
        `);
        if (existing.rows.length > 0) return;
        await this.audit.recordInTx(tx, {
          tenantId,
          action,
          entity: 'usage_counter',
          entityId: null,
          after: { metric, ...meta, period },
          meta: { metric, period, scope: 'platform_console' },
        });
      });
    } catch (error) {
      this.logger.warn(`usage audit failed for ${tenantId}: ${(error as Error).message}`);
    }
  }
}

function emptyMeasured(): Measured {
  return {
    users: 0,
    branches: 0,
    items: 0,
    invoices_per_month: 0,
    storage_mb: 0,
    api_calls_per_day: 0,
    whatsapp_per_month: 0,
    email_sends_per_month: 0,
  };
}

function uuidList(values: string[]): SQL {
  return sql.join(
    values.map((value) => sql`${value}::uuid`),
    sql`, `,
  );
}

function keyList(): SQL {
  return sql.join(
    usageMetricRegistry.map((metric) => sql`${metric.limitKey}`),
    sql`, `,
  );
}

function numericValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Math.trunc(Number(value));
  }
  return null;
}

function noticeFor(
  labelAr: string,
  used: number,
  limit: EffectiveLimit,
  state: UsageMetricState,
): string | null {
  if (limit.value === null) return null;
  if (state === 'hard') {
    return limit.enforced
      ? `${labelAr}: بلغ العميل الحدّ (${used} من ${limit.value}) — الكتابة الجديدة تُرفض، قدّم طلباً لإدارة المنصة للاعتماد.`
      : `${labelAr}: بلغ المغلّف الافتراضي (${used} من ${limit.value}) — لا رفض (الحدّ لم يضبطه مشغّل).`;
  }
  if (state === 'soft') {
    return limit.enforced
      ? `${labelAr}: اقترب من الحدّ (${used} من ${limit.value}).`
      : `${labelAr}: اقترب من المغلّف الافتراضي (${used} من ${limit.value}) — لا رفض.`;
  }
  return null;
}

function stateWeight(state: UsageMetricState): number {
  return state === 'hard' ? 3 : state === 'soft' ? 2 : state === 'ok' ? 1 : 0;
}

function worstState(states: UsageMetricState[]): UsageMetricState {
  return states.reduce<UsageMetricState>(
    (worst, current) => (stateWeight(current) > stateWeight(worst) ? current : worst),
    'unlimited',
  );
}

function monthStartIso(period: string): string {
  return `${period}-01`;
}

function monthEndIso(period: string): string {
  const [year = 1970, month = 1] = period.split('-').map((part) => Number(part));
  return new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}
