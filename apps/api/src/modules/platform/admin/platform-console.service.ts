import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import {
  DomainError,
  errorCodes,
  findPlatformSettingDefinition,
  platformSettingAllowsScope,
  platformSettingsForScope,
  platformSettingDefaultMap,
  validatePlatformSettingValue,
  auditActions,
  parseFilters,
  type PlatformAuditEntry,
  type PlatformAuditQueryDto,
  type PlatformProblemCounts,
  type PlatformProblemQueryDto,
  type PlatformProblemRow,
  type PlatformProblemSource,
  platformProblemSourceLabels,
  type PlatformSettingView,
  type PlatformSettingsResponse,
  type PlatformTenantSearchResult,
} from '@erp/contracts';
import {
  auditLog,
  newId,
  outboxJobs,
  platformSettings,
  tenants,
  withPlatformAdminTx,
  withTenantTx,
  type DatabaseHandle,
  type DrizzleTx,
} from '@erp/database';
import { env } from '@erp/config';

import { DATABASE_HANDLE } from '../../../database/database.tokens.js';
import { getAuthContext } from '../../../request-context/request-context.js';
import { AuditService } from '../../platform-services/audit/audit.service.js';

/**
 * P-C1 — the console's own service: cross-tenant audit, platform settings and the Ctrl+K
 * tenant lookup.
 *
 * Three rules it never breaks:
 *
 * 1. **Every read runs inside `withPlatformAdminTx`** so the `platform_admin_plane`
 *    policies added by migration 0066 apply. The tenant GUC stays unset, so a predicate
 *    that forgets a tenant still returns rows from every tenant rather than silently the
 *    wrong one — the elevation is the point here, and the guard has already proved it.
 * 2. **Settings are validated against the shared catalogue** (`@erp/contracts`), so the
 *    screen and the API cannot disagree about what a key accepts.
 * 3. **Every write is audited** with a real before/after diff and the operator as actor —
 *    the platform settings are the one place where a mistake affects every customer.
 */

/** `NODE_ENV` → the badge the console shows. Labels are the Arabic names of the phases. */
const ENVIRONMENT_LABELS: Record<string, string> = {
  development: 'تطوير',
  test: 'اختبار',
  production: 'إنتاج',
};

/** صفٌّ خام من أي مصدر — الشكل نفسه بعد التطبيع، فالشاشة لا تعرف مصادرها. */
type RawProblem = {
  id: string;
  tenant_id: string | null;
  attempts: number | null;
  severity: string;
  title: string | null;
  detail: string | null;
  occurred_at: string | Date;
};

/** ماذا يفعل المشغّل بهذا الصفّ — الشرح العربي بجانب نصّ النظام الخام. */
const PROBLEM_HINTS: Record<PlatformProblemSource, string> = {
  email: 'لم تخرج الرسالة: راجع اعتماد المزوّد والنطاق في شاشة البريد، ثم أعد المحاولة.',
  einvoice: 'رفضت الهيئة الفاتورة أو تعذّر إرسالها: راجع إعدادات الربط وشاشة الفواتير الإلكترونية للمنشأة.',
  webhook: 'لم يُسلَّم الحدث إلى نقطة الويب هوك: تحقّق من العنوان والمفتاح ثم أعد المحاولة.',
  outbox: 'مهمةٌ نفدت محاولاتها: أصلح السبب ثم أعد تشغيلها من شاشة المهام والطوابير.',
  backup: 'فشلت النسخة: تحقّق من المخزن ثم أعد تشغيلها من شاشة البيانات والنسخ.',
};

/** الشاشة التي يُصلَح فيها الصفّ — لا رابط عام، بل موضع الفعل. */
const PROBLEM_HREFS: Record<PlatformProblemSource, string> = {
  email: '/email',
  einvoice: '/tenants',
  webhook: '/webhooks',
  outbox: '/jobs',
  backup: '/backups',
};

@Injectable()
export class PlatformConsoleService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  /** The deployment the API is running as — shown next to the console title. */
  environment(): { name: string; labelAr: string } {
    const name = env.NODE_ENV;
    return { name, labelAr: ENVIRONMENT_LABELS[name] ?? name };
  }

  // ------------------------------------------------------------------- settings

  /**
   * `GET /platform/settings` — the catalogue joined with whatever has been written.
   *
   * A key with no row is *not* missing: it reports its catalogue default with
   * `isDefault: true`, so the screen shows the value the platform actually uses.
   */
  async listSettings(): Promise<PlatformSettingsResponse> {
    const rows = await withPlatformAdminTx(this.database.db, async (tx) =>
      tx
        .select({
          key: platformSettings.key,
          // Read the JSON **text** and parse it here, once.
          //
          // Reading the column directly is not safe for this table: the driver hands jsonb
          // back already parsed, and Drizzle's `jsonb` mapper parses a *string* value again,
          // so a stored string that happens to be valid JSON comes back as the wrong type —
          // `'920000000'` as a number, `'true'` as a boolean, `'{"x":1}'` as an object. A
          // phone number, a domain or a prefix is exactly that kind of value, and silently
          // changing its type would write nonsense into the screens and into API clients.
          raw: sql<string>`${platformSettings.value}::text`,
          updatedAt: platformSettings.updatedAt,
          updatedBy: platformSettings.updatedBy,
        })
        .from(platformSettings)
        .where(isNull(platformSettings.tenantId))
        .orderBy(asc(platformSettings.key)),
    );

    const stored = new Map(rows.map((row) => [row.key, row]));
    // Platform-scope keys only. The catalogue is shared with the tenant card
    // (`GET /platform/tenants/:id/settings`), and keys declared `['tenant']` — the three
    // `branding.*` keys P-C2 added — must not appear as writable platform-wide values.
    const settings: PlatformSettingView[] = platformSettingsForScope('platform').map((definition) => {
      const row = stored.get(definition.key);
      return {
        key: definition.key,
        labelAr: definition.labelAr,
        labelEn: definition.labelEn,
        kind: definition.kind,
        // الخيارات والحدود من الكتالوج نفسه — لا تُخترع في الشاشة ولا تُترك للتخمين.
        ...(definition.options ? { options: [...definition.options] } : {}),
        ...(definition.optionLabels ? { optionLabels: [...definition.optionLabels] } : {}),
        ...(definition.min !== undefined ? { min: definition.min } : {}),
        ...(definition.max !== undefined ? { max: definition.max } : {}),
        helpAr: definition.helpAr,
        value: row ? (JSON.parse(row.raw) as PlatformSettingView['value']) : definition.defaultValue,
        isDefault: row === undefined,
        // A platform-scoped read can only answer from the platform row or the catalogue:
        // `tenant` appears on `GET /platform/tenants/:id/settings` (P-C2).
        source: row === undefined ? 'default' : 'platform',
        updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
        updatedBy: row?.updatedBy ?? null,
      };
    });

    return { settings, environment: this.environment() };
  }

  /**
   * `PUT /platform/settings` — upsert the keys the operator sent.
   *
   * One transaction for the whole batch and one audit row per key: a maintenance switch
   * that was flipped has to be readable as a *change*, and a generic "updated settings"
   * row would lose which key and which value.
   */
  async updateSettings(values: Record<string, unknown>): Promise<PlatformSettingsResponse> {
    const entries = Object.entries(values);
    if (entries.length === 0) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'No settings were supplied', 422);
    }

    // Validate everything *before* opening the transaction: a bad key in a batch must not
    // leave the good half written.
    const validated = entries.map(([key, value]) => {
      const definition = findPlatformSettingDefinition(key);
      if (!definition) {
        throw new DomainError(errorCodes.VALIDATION_FAILED, `Unknown platform setting: ${key}`, 422, {
          field: key,
        });
      }
      if (!platformSettingAllowsScope(key, 'platform')) {
        throw new DomainError(errorCodes.VALIDATION_FAILED, `المفتاح «${key}» ليس إعداداً للمنصّة`, 422, {
          field: key,
        });
      }
      const result = validatePlatformSettingValue(key, value);
      if (!result.ok) {
        throw new DomainError(errorCodes.VALIDATION_FAILED, `${key}: ${result.reason}`, 422, {
          field: key,
        });
      }
      return { key, value: result.value };
    });

    const auth = getAuthContext();
    const defaults = platformSettingDefaultMap();

    await withPlatformAdminTx(this.database.db, async (tx) => {
      for (const entry of validated) {
        const before = await tx
          .select({
            id: platformSettings.id,
            version: platformSettings.version,
            // Same reason as `listSettings`: the raw text is the only faithful read.
            raw: sql<string>`${platformSettings.value}::text`,
          })
          .from(platformSettings)
          .where(and(isNull(platformSettings.tenantId), eq(platformSettings.key, entry.key)))
          .limit(1);
        const previous = before[0];

        if (previous) {
          await tx
            .update(platformSettings)
            .set({
              value: entry.value,
              updatedAt: new Date(),
              updatedBy: auth.userId,
              version: previous.version + 1,
            })
            .where(eq(platformSettings.id, previous.id));
        } else {
          await tx.insert(platformSettings).values({
            id: newId(),
            tenantId: null,
            key: entry.key,
            value: entry.value,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          });
        }

        await this.audit.recordInTx(tx, {
          // NULL tenant: a platform-wide setting is not any one customer's row.
          tenantId: null,
          actorUserId: auth.userId,
          action: auditActions.UPDATE,
          entity: 'platform_settings',
          entityId: entry.key,
          before: { value: previous ? JSON.parse(previous.raw) : defaults[entry.key] },
          after: { value: entry.value },
          meta: { scope: 'platform' },
        });
      }
    });

    return this.listSettings();
  }

  // ---------------------------------------------------------------------- audit

  /**
   * `GET /platform/audit` — the cross-tenant trail (`console.audit.view`).
   *
   * This is the endpoint the previous console pretended to have: `/audit` used to read
   * `GET /audit-log`, which is tenant-scoped, so an operator saw the *platform tenant's*
   * own rows and nothing else (INCOMPLETE_INVENTORY §4.2).
   *
   * Each row carries its customer's code and name, because "who did what" is useless in a
   * control plane without "for whom".
   */
  async listAudit(query: PlatformAuditQueryDto): Promise<{
    items: PlatformAuditEntry[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const filters = parseFilters(query.filter, [
      'tenantId',
      'actorUserId',
      'action',
      'entity',
      'entityId',
      'from',
      'to',
    ] as const);

    const conditions: SQL[] = [];
    if (filters.tenantId) conditions.push(eq(auditLog.tenantId, filters.tenantId));
    if (filters.actorUserId) conditions.push(eq(auditLog.actorUserId, filters.actorUserId));
    if (filters.action) conditions.push(eq(auditLog.action, filters.action));
    if (filters.entity) conditions.push(eq(auditLog.entity, filters.entity));
    if (filters.entityId) conditions.push(eq(auditLog.entityId, filters.entityId));
    if (filters.from) conditions.push(gte(auditLog.createdAt, parseDate(filters.from, 'from')));
    if (filters.to) conditions.push(lte(auditLog.createdAt, parseDate(filters.to, 'to')));

    return withPlatformAdminTx(this.database.db, async (tx) => {
      const where = conditions.length > 0 ? and(...conditions) : undefined;

      const totalRow = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(auditLog)
        .where(where);

      const rows = await tx
        .select({
          id: auditLog.id,
          tenantId: auditLog.tenantId,
          tenantCode: tenants.code,
          tenantName: tenants.name,
          actorUserId: auditLog.actorUserId,
          actorLabel: auditLog.actorLabel,
          action: auditLog.action,
          entity: auditLog.entity,
          entityId: auditLog.entityId,
          before: auditLog.before,
          after: auditLog.after,
          meta: auditLog.meta,
          createdAt: auditLog.createdAt,
        })
        .from(auditLog)
        .leftJoin(tenants, eq(tenants.id, auditLog.tenantId))
        .where(where)
        .orderBy(desc(auditLog.createdAt))
        .limit(query.limit)
        .offset(query.offset);

      return {
        items: rows.map((row) => ({
          id: row.id,
          tenantId: row.tenantId,
          tenantCode: row.tenantCode ?? null,
          tenantName: row.tenantName ?? null,
          actorUserId: row.actorUserId,
          actorLabel: row.actorLabel,
          action: row.action,
          entity: row.entity,
          entityId: row.entityId,
          before: row.before ?? null,
          after: row.after ?? null,
          meta: (row.meta ?? {}) as Record<string, unknown>,
          createdAt: row.createdAt.toISOString(),
        })),
        total: totalRow[0]?.value ?? 0,
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  // --------------------------------------------------------------------- jobs

  /**
   * `GET /platform/jobs/outbox` — the queue, across every customer.
   *
   * The console has shown a «المهام والطوابير» page since the 2026-09 separation, but it
   * read `GET /jobs/outbox`, which is tenant-scoped: an operator saw the *platform
   * tenant's* outbox — always `[]` — while `console.jobs.view` was one of the ten codes
   * declared and unused (INCOMPLETE_INVENTORY §4.2). The plan's P-C1 endpoint list does not
   * include this route; it is added because P-C1 is also «ترميم الصلاحيات», and a sidebar
   * item that opens a lying page is not repaired by a permission.
   *
   * Read-only on purpose: retrying and draining jobs is P-C9 (العمليات).
   */
  async listOutbox(query: { limit: number; offset: number; status?: string }): Promise<{
    items: Array<{
      id: string;
      tenantId: string;
      tenantCode: string | null;
      queue: string;
      type: string;
      status: string;
      attempts: number;
      lastError: string | null;
      createdAt: string;
      /**
       * P-C7: موعد التنفيذ. مهمّةُ نشرٍ مجدولة لا معنى لصفّها بلا وقتها — والعمود قائم
       * في الجدول أصلاً، فإظهاره يجعل «مجدولة» في شاشة الإعلانات قابلةً للتحقّق من الطابور.
       */
      runAt: string;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const status = query.status && query.status.length > 0 ? query.status : null;
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const where = status ? eq(outboxJobs.status, status) : undefined;

      const totalRow = await tx
        .select({ value: sql<number>`count(*)::int` })
        .from(outboxJobs)
        .where(where);

      const rows = await tx
        .select({
          id: outboxJobs.id,
          tenantId: outboxJobs.tenantId,
          tenantCode: tenants.code,
          queue: outboxJobs.queue,
          type: outboxJobs.type,
          status: outboxJobs.status,
          attempts: outboxJobs.attempts,
          lastError: outboxJobs.lastError,
          createdAt: outboxJobs.createdAt,
          runAt: outboxJobs.runAt,
        })
        .from(outboxJobs)
        .leftJoin(tenants, eq(tenants.id, outboxJobs.tenantId))
        .where(where)
        .orderBy(desc(outboxJobs.createdAt))
        .limit(query.limit)
        .offset(query.offset);

      return {
        items: rows.map((row) => ({
          ...row,
          lastError: row.lastError ?? null,
          createdAt: row.createdAt.toISOString(),
          runAt: row.runAt.toISOString(),
        })),
        total: totalRow[0]?.value ?? 0,
        limit: query.limit,
        offset: query.offset,
      };
    });
  }

  // ------------------------------------------------------------------- problem log

  /**
   * `GET /platform/problems` — البند 20: «سجلّ الأخطاء والمشاكل» في لوحة المنصّة.
   *
   * المصادر أربعة صفوفٍ قائمةٍ لا جدولاً جديداً: رسائل بريدٍ لم تخرج، فواتير إلكترونية
   * رُفضت، أحداث ويب هوكٍ لم تُسلَّم، مهام طابورٍ نفدت محاولاتها، ونسخٌ فشلت. كلها كانت
   * موجودةً في شاشاتٍ أربع، ولم يكن أحدٌ يسأل السؤال الواحد: **ما الذي يفشل الآن؟**
   *
   * وقراءة `einvoice_submissions` تمرّ بسياق كل مستأجرٍ على حدة (`withTenantTx`)، لا
   * بسياق المنصّة: الجدول محميٌّ بسياسة عزلٍ للمستأجر وحده (لا `platform_admin_plane`)،
   * فقراءته من مستوى المنصّة كانت ستُعيد صفراً — أسوأ من خطأ، لأنه يبدو سلامة.
   */
  async listProblems(query: PlatformProblemQueryDto): Promise<{
    rows: PlatformProblemRow[];
    meta: { total: number; limit: number; offset: number };
    counts: PlatformProblemCounts;
  }> {
    const filters = parseFilters(query.filter, ['source', 'tenantId', 'severity', 'from', 'to'] as const);
    const sources = (await this.platformProblems(filters)).concat(
      await this.einvoiceProblems(filters),
    );

    const filtered = sources
      .filter((row) => (filters.tenantId ? row.tenantId === filters.tenantId : true))
      .filter((row) => (filters.severity ? row.severity === filters.severity : true))
      .filter((row) => (filters.source ? row.source === filters.source : true))
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));

    const bySource = Object.fromEntries(
      Object.keys(platformProblemSourceLabels).map((key) => [key, 0]),
    ) as Record<PlatformProblemSource, number>;
    const bySeverity = { error: 0, warning: 0 } as PlatformProblemCounts['bySeverity'];
    for (const row of filtered) {
      bySource[row.source] = (bySource[row.source] ?? 0) + 1;
      bySeverity[row.severity] = (bySeverity[row.severity] ?? 0) + 1;
    }

    const page = filtered.slice(query.offset, query.offset + query.limit);
    return {
      rows: page,
      meta: { total: filtered.length, limit: query.limit, offset: query.offset },
      counts: {
        total: filtered.length,
        bySource,
        bySeverity,
        oldestAt: filtered.length > 0 ? filtered[filtered.length - 1]!.occurredAt : null,
      },
    };
  }

  /** مصادرٌ مقروءةٌ من مستوى المنصّة (سياساتها تسمح بذلك صراحةً). */
  private async platformProblems(
    filters: Partial<Record<'from' | 'to', string>>,
  ): Promise<PlatformProblemRow[]> {
    const since = filters.from ? new Date(filters.from) : null;
    const until = filters.to ? new Date(filters.to) : null;
    const window = (column: SQL) =>
      sql`${column} >= ${since ?? new Date(0)} AND ${column} <= ${until ?? new Date('2999-12-31')}`;

    return withPlatformAdminTx(this.database.db, async (tx) => {
      const email = (
        await tx.execute(sql`
          SELECT id, tenant_id, attempts,
                 CASE WHEN status = 'failed' THEN 'error' ELSE 'warning' END AS severity,
                 COALESCE(subject, event) AS title, last_error AS detail,
                 COALESCE(updated_at, created_at) AS occurred_at
            FROM email_messages
           WHERE last_error IS NOT NULL AND status <> 'sent'
             AND ${window(sql`COALESCE(updated_at, created_at)`)}
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT 500
        `)
      ).rows as unknown as RawProblem[];

      const webhooks = (
        await tx.execute(sql`
          SELECT id, tenant_id, attempts, 'error' AS severity,
                 'ويب هوك: ' || event AS title, error AS detail,
                 COALESCE(next_attempt_at, created_at) AS occurred_at
            FROM webhook_deliveries
           WHERE (status = 'failed' OR (error IS NOT NULL AND status <> 'delivered'))
             AND ${window(sql`COALESCE(next_attempt_at, created_at)`)}
           ORDER BY COALESCE(next_attempt_at, created_at) DESC
           LIMIT 500
        `)
      ).rows as unknown as RawProblem[];

      const outbox = (
        await tx.execute(sql`
          SELECT id, tenant_id, attempts,
                 CASE WHEN status = 'dead' THEN 'error' ELSE 'warning' END AS severity,
                 'مهمة: ' || type AS title, last_error AS detail,
                 COALESCE(processed_at, run_at, created_at) AS occurred_at
            FROM outbox_jobs
           WHERE (status = 'dead' OR (last_error IS NOT NULL AND status <> 'published'))
             AND ${window(sql`COALESCE(processed_at, run_at, created_at)`)}
           ORDER BY COALESCE(processed_at, run_at, created_at) DESC
           LIMIT 500
        `)
      ).rows as unknown as RawProblem[];

      const backups = (
        await tx.execute(sql`
          SELECT id, tenant_id, NULL::int AS attempts, 'error' AS severity,
                 'نسخة احتياطية فاشلة' AS title, failure_reason AS detail,
                 COALESCE(finished_at, started_at) AS occurred_at
            FROM backup_jobs
           WHERE status = 'failed'
             AND ${window(sql`COALESCE(finished_at, started_at)`)}
           ORDER BY COALESCE(finished_at, started_at) DESC
           LIMIT 500
        `)
      ).rows as unknown as RawProblem[];

      const tenantMap = await this.tenantNames(tx);
      return [
        ...email.map((row) => this.toProblem('email', row, tenantMap)),
        ...webhooks.map((row) => this.toProblem('webhook', row, tenantMap)),
        ...outbox.map((row) => this.toProblem('outbox', row, tenantMap)),
        ...backups.map((row) => this.toProblem('backup', row, tenantMap)),
      ];
    });
  }

  /**
   * الفاتورة الإلكترونية: قراءةٌ لكل مستأجرٍ في سياقه لأن الجدول لا يملك سياسة مستوى
   * المنصّة. الحدّ الأعلى 300 مستأجرٍ في الطلب الواحد — وهو حدُّ شاشةٍ تُقرأ بالعين لا
   * تصديرٍ شامل، فلا يُسقط الصفّ تنبيهٌ عن مستأجرٍ بعيد.
   */
  private async einvoiceProblems(
    filters: Partial<Record<'from' | 'to', string>>,
  ): Promise<PlatformProblemRow[]> {
    const directory = await withPlatformAdminTx(this.database.db, (tx) =>
      tx.select({ id: tenants.id, code: tenants.code, name: tenants.name }).from(tenants).limit(300),
    );
    const tenantIds = directory.map((row) => row.id);
    const tenantMap = new Map(
      directory.map((row) => [row.id, { code: row.code, name: row.name }] as const),
    );

    const since = filters.from ? new Date(filters.from) : new Date(0);
    const until = filters.to ? new Date(filters.to) : new Date('2999-12-31');
    const rows: PlatformProblemRow[] = [];
    for (const tenantId of tenantIds) {
      const found = await withTenantTx(this.database.db, tenantId, (tx) =>
        tx.execute(sql`
          SELECT id, tenant_id, CASE WHEN attempts ~ '^[0-9]+$' THEN attempts::int END AS attempts,
                 'error' AS severity,
                 'فاتورة إلكترونية: ' || status AS title, error AS detail,
                 COALESCE(updated_at, created_at) AS occurred_at
            FROM einvoice_submissions
           WHERE (status = 'failed' OR (error IS NOT NULL AND status NOT IN ('cleared', 'reported')))
             AND COALESCE(updated_at, created_at) >= ${since}
             AND COALESCE(updated_at, created_at) <= ${until}
           ORDER BY COALESCE(updated_at, created_at) DESC
           LIMIT 200
        `),
      );
      for (const row of (found.rows as unknown as RawProblem[])) {
        rows.push(this.toProblem('einvoice', row, tenantMap));
      }
    }
    return rows;
  }

  private async tenantNames(
    tx: DrizzleTx,
  ): Promise<Map<string, { code: string | null; name: string | null }>> {
    const rows = await tx.select({ id: tenants.id, code: tenants.code, name: tenants.name }).from(tenants);
    return new Map(rows.map((row) => [row.id, { code: row.code, name: row.name }]));
  }

  private toProblem(
    source: PlatformProblemSource,
    row: RawProblem,
    tenantMap: Map<string, { code: string | null; name: string | null }>,
  ): PlatformProblemRow {
    const tenant = row.tenant_id ? tenantMap.get(row.tenant_id) : undefined;
    return {
      key: `${source}:${row.id}`,
      source,
      severity: row.severity === 'error' ? 'error' : 'warning',
      title: row.title ?? platformProblemSourceLabels[source],
      detail: row.detail ?? null,
      hint: PROBLEM_HINTS[source],
      tenantId: row.tenant_id ?? null,
      tenantCode: tenant?.code ?? null,
      tenantName: tenant?.name ?? null,
      attempts: row.attempts ?? null,
      occurredAt: new Date(row.occurred_at).toISOString(),
      href: PROBLEM_HREFS[source],
    };
  }

  // ------------------------------------------------------------------- omnibox

  /**
   * `GET /platform/tenants/search?q=` — the Ctrl+K provider.
   *
   * Search only. It answers with the three fields a palette row can render and never with
   * the tenant's financial state, so the cheapest console permission
   * (`console.tenants.view`) is enough to hold it.
   */
  async searchTenants(term: string): Promise<PlatformTenantSearchResult[]> {
    const pattern = `%${term.trim()}%`;
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const rows = await tx
        .select({
          id: tenants.id,
          code: tenants.code,
          name: tenants.name,
          status: tenants.status,
        })
        .from(tenants)
        .where(or(ilike(tenants.code, pattern), ilike(tenants.name, pattern)))
        .orderBy(asc(tenants.name))
        .limit(10);
      return rows;
    });
  }
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError(errorCodes.VALIDATION_FAILED, `filter[${field}] must be an ISO-8601 date`, 400, {
      field: `filter[${field}]`,
    });
  }
  return parsed;
}
