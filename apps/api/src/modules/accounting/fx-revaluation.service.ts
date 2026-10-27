import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { DomainError } from '@erp/contracts';
import {
  accounts,
  fxRevaluationRuns,
  newId,
  withTenantTx,
  type DatabaseHandle,
  type DrizzleTx,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { isUniqueViolation } from '../organization/shared/org-support.js';
import { tryGetAuthContext } from '../platform/context/tenant-context.js';
import { todayIso } from '../../common/server-date.js';

import { AccountingService } from './accounting.service.js';

/**
 * MF-28 / r46 / D12 — إعادة تقييم العملات (فروق غير محققة).
 *
 *   الوعاء: فواتير المبيعات المفتوحة بسعر صرف مخزَّن (`fx_rate IS NOT NULL`):
 *   لكل عملة `Σ (المتبقي × (سعر_اليوم − سعر_الفاتورة))` — كلها بالأساس.
 *   قيد واحد (رُجل لكل عملة) + **عكسه الآلي** بتاريخ التشغيل + 1 يوم — ثم صفّ التشغيل
 *   يربط الاثنين. فروق محققة وغير محققة تتشاركان الحسابين (الوصف يميّز): ربح ⇐
 *   `Dr 1290001 / Cr 4200004` · خسارة ⇐ `Dr 3121003 / Cr 1290001`.
 *   صفر مطلق ⇐ 201 بلا قيد (نمط D11) · نفس اليوم مرتين ⇐ 409 (UNIQUE).
 *   بلا سعر جدول لعملة مفتوحة ⇐ تُستبعد مع ملاحظة في `detail` (لا سعر حر).
 */
@Injectable()
export class FxRevaluationService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly accounting: AccountingService,
  ) {}

  /** أحدث سعر نافذ ≤ التاريخ معبّراًً بـ«أساس مقابل وحدة العملة» (NULL = بلا جدول). */
  private async tableRateInTx(tx: DrizzleTx, tenantId: string, currency: string, date: string): Promise<Decimal | null> {
    const rows = (await tx.execute(sql`
      SELECT from_code, to_code, rate::text AS rate FROM fx_rates
       WHERE tenant_id = ${tenantId}::uuid
         AND ((from_code = ${currency} AND to_code = 'SAR') OR (from_code = 'SAR' AND to_code = ${currency}))
         AND effective_from <= ${date}::date
       ORDER BY effective_from DESC, created_at DESC
       LIMIT 1
    `)) as unknown;
    const list: Array<{ from_code: string; to_code: string; rate: string }> = Array.isArray(rows)
      ? (rows as Array<{ from_code: string; to_code: string; rate: string }>)
      : (((rows as { rows?: Array<{ from_code: string; to_code: string; rate: string }> }).rows ?? []) as Array<{
          from_code: string;
          to_code: string;
          rate: string;
        }>);
    const row = list[0];
    if (!row) return null;
    const rowQuote = new Decimal(row.rate);
    if (!rowQuote.isFinite() || rowQuote.lte(0)) return null;
    const basePerUnit = row.from_code === currency ? rowQuote : new Decimal(1).div(rowQuote);
    return basePerUnit.isFinite() ? basePerUnit : null;
  }

  /** حسابات الفروق تُؤمَّن عند أول استعمال (نمط D11 — بلا إدراج في الترحيل). */
  private async ensureFxAccountInTx(tx: DrizzleTx, tenantId: string, kind: 'gain' | 'loss' | 'revaluation') {
    const preset =
      kind === 'gain'
        ? { code: '4200004', nameAr: 'إيراد فرق العملة', nameEn: 'FX gain', type: 'revenue' as const, normalBalance: 'credit' as const, parentCode: '42' }
        : kind === 'loss'
          ? { code: '3121003', nameAr: 'مصاريف فرق العملة', nameEn: 'FX loss', type: 'expense' as const, normalBalance: 'debit' as const, parentCode: '3121' }
          : { code: '1290001', nameAr: 'فرق إعادة تقييم العملات (غير محقّق)', nameEn: 'FX revaluation', type: 'asset' as const, normalBalance: 'debit' as const, parentCode: '12' };

    const existing = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, preset.code), isNull(accounts.deletedAt)))
      .limit(1);
    if (existing[0]) return existing[0].id;

    const [parent] = await tx
      .select({ id: accounts.id, level: accounts.level, path: accounts.path })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, preset.parentCode), isNull(accounts.deletedAt)))
      .limit(1);
    if (!parent)
      throw new DomainError(
        'FX_ACCOUNT_MISSING',
        `لا يوجد حساب أب ${preset.parentCode} لإنشاء «${preset.nameAr}» — أنشئ الحساب أو مرّره`,
        422,
        { field: 'accountId', accountCode: preset.code },
      );
    try {
      const id = newId();
      await tx.insert(accounts).values({
        id,
        tenantId,
        code: preset.code,
        nameAr: preset.nameAr,
        nameEn: preset.nameEn,
        type: preset.type,
        normalBalance: preset.normalBalance,
        parentId: parent.id,
        level: parent.level + 1,
        path: `${parent.path}.${id}`,
        isPostable: true,
        openingBalance: '0',
      });
      return id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const [raced] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, preset.code), isNull(accounts.deletedAt)))
        .limit(1);
      if (!raced) throw error;
      return raced.id;
    }
  }

  async createRun(tenantId: string, input: { date?: string; branchId?: string }) {
    const date = (input.date ?? '').trim() || todayIso();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
      throw new DomainError('FX_DATE_INVALID', 'تاريخ التشغيل يجب أن يكون YYYY-MM-DD', 422, { field: 'date' });
    const userId = tryGetAuthContext()?.userId ?? null;

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      // فريد مبكر (مستأجر، يوم): التزامن يناله الطرف الثاني 409 قبل أي حساب.
      const inserted = (await tx
        .insert(fxRevaluationRuns)
        .values({ id: newId(), tenantId, runDate: date, createdBy: userId, detail: {} })
        .onConflictDoNothing()
        .returning({ id: fxRevaluationRuns.id })) as Array<{ id: string }>;
      if (!inserted[0])
        throw new DomainError('FX_REVALUATION_EXISTS', `تشغيل إعادة تقييم بتاريخ ${date} قائم مسبقاً`, 409, {
          field: 'date',
          runDate: date,
        });
      const runId = inserted[0].id;

      // الوعاء: فواتير بيع مرحَّلة مفتوحة لها سعر صرف مخزَّن.
      const openRows = (await tx.execute(sql`
        SELECT currency, fx_rate::text AS fx_rate,
               coalesce(sum(total - paid_total), 0)::text AS open_amount,
               count(*)::int AS invoices
          FROM sales_invoices
         WHERE tenant_id = ${tenantId}::uuid
           AND status = 'posted' AND kind = 'sale'
           AND fx_rate IS NOT NULL AND paid_total < total
         GROUP BY currency, fx_rate
         ORDER BY currency
      `)) as unknown;
      const openList: Array<{ currency: string; fx_rate: string; open_amount: string; invoices: number }> = Array.isArray(
        openRows,
      )
        ? (openRows as Array<{ currency: string; fx_rate: string; open_amount: string; invoices: number }>)
        : (((openRows as { rows?: Array<{ currency: string; fx_rate: string; open_amount: string; invoices: number }> })
            .rows ?? []) as Array<{ currency: string; fx_rate: string; open_amount: string; invoices: number }>);

      const perCurrency = new Map<string, { net: Decimal; invoices: number; openAmount: Decimal; bookRate: string }>();
      const skipped: Array<{ currency: string; bookRate: string; reason: string }> = [];
      for (const row of openList) {
        const fxQuote = await this.tableRateInTx(tx, tenantId, row.currency, date);
        if (!fxQuote) {
          skipped.push({ currency: row.currency, bookRate: row.fx_rate, reason: 'FX_RATE_MISSING' });
          continue;
        }
        const diff = new Decimal(row.open_amount).times(fxQuote.minus(row.fx_rate)).toDecimalPlaces(4, Decimal.ROUND_HALF_UP);
        const bucket = perCurrency.get(row.currency) ?? {
          net: new Decimal(0),
          invoices: 0,
          openAmount: new Decimal(0),
          bookRate: row.fx_rate,
        };
        bucket.net = bucket.net.plus(diff);
        bucket.invoices += row.invoices;
        bucket.openAmount = bucket.openAmount.plus(row.open_amount);
        perCurrency.set(row.currency, bucket);
      }

      const active = [...perCurrency.entries()].filter(([, bucket]) => bucket.net.abs().gte('0.005'));
      const totalNet = active.reduce((sum, [, bucket]) => sum.plus(bucket.net), new Decimal(0));
      const detail = {
        currencies: [...perCurrency.entries()].map(([currency, bucket]) => ({
          currency,
          net: bucket.net.toFixed(4),
          openAmount: bucket.openAmount.toFixed(4),
          invoices: bucket.invoices,
        })),
        skipped,
      };

      if (totalNet.abs().lt('0.005')) {
        await tx
          .update(fxRevaluationRuns)
          .set({ gainLoss: '0', detail })
          .where(eq(fxRevaluationRuns.id, runId));
        return this.dto(tx, tenantId, runId);
      }

      // فرع القيد: صريح أو أول فرع للمستأجر (إعادة التقييم حدث محاسبي لا تجاري).
      let branchId = input.branchId?.trim() || '';
      if (!branchId) {
        const rows = (await tx.execute(
          sql`SELECT id::text AS id FROM branches WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at LIMIT 1`,
        )) as unknown;
        const list: Array<{ id: string }> = Array.isArray(rows)
          ? (rows as Array<{ id: string }>)
          : (((rows as { rows?: Array<{ id: string }> }).rows ?? []) as Array<{ id: string }>);
        branchId = list[0]?.id ?? '';
      }
      if (!branchId)
        throw new DomainError('FX_REVALUATION_BRANCH_REQUIRED', 'لا يوجد فرع لتثبيت قيد إعادة التقييم', 422, {
          field: 'branchId',
        });

      const lines: Array<{ accountId: string; debit?: string; credit?: string; description?: string }> = [];
      for (const [currency, bucket] of active) {
        const gainAcct = await this.ensureFxAccountInTx(tx, tenantId, 'gain');
        const lossAcct = await this.ensureFxAccountInTx(tx, tenantId, 'loss');
        const adjAcct = await this.ensureFxAccountInTx(tx, tenantId, 'revaluation');
        const note = `إعادة تقييم غير محققة — ${currency} (${bucket.net.toFixed(4)} أساس)`;
        if (bucket.net.gt(0)) {
          lines.push({ accountId: adjAcct, debit: bucket.net.toFixed(4), description: note });
          lines.push({ accountId: gainAcct, credit: bucket.net.toFixed(4), description: note });
        } else {
          lines.push({ accountId: lossAcct, debit: bucket.net.abs().toFixed(4), description: note });
          lines.push({ accountId: adjAcct, credit: bucket.net.abs().toFixed(4), description: note });
        }
      }

      const entry = await this.accounting.postJournalInTx(tx, tenantId, {
        branchId,
        fiscalPeriodId: await this.accounting.openPeriodForDateInTx(tx, tenantId, date),
        date,
        description: `إعادة تقييم العملات ${date}`,
        lines,
        sourceType: 'fx_revaluation',
        idempotencyKey: `fx-reval:${tenantId}:${date}`,
      });
      if (!entry) throw new DomainError('FX_REVALUATION_JOURNAL_FAILED', 'تعذّر ترحيل قيد إعادة التقييم', 500);

      // العكس الآلي: تاريخ التشغيل + 1 يوم (آخر يوم ⇐ أول يوم للفترة التالية).
      const reversalDate = (() => {
        const d = new Date(`${date}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + 1);
        return d.toISOString().slice(0, 10);
      })();
      const reversal = await this.accounting.reverseJournalInTx(tx, tenantId, entry.id, {
        reason: `عكس آلي لإعادة تقييم العملات ${date}`,
        date: reversalDate,
        sourceType: 'fx_revaluation',
        idempotencyKey: `fx-reval-rev:${tenantId}:${date}`,
      });

      await tx
        .update(fxRevaluationRuns)
        .set({ journalEntryId: entry.id, reversalEntryId: reversal.id, gainLoss: totalNet.toFixed(4), detail })
        .where(eq(fxRevaluationRuns.id, runId));
      return this.dto(tx, tenantId, runId);
    });
  }

  async list(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(fxRevaluationRuns)
        .where(eq(fxRevaluationRuns.tenantId, tenantId))
        .orderBy(fxRevaluationRuns.runDate)
        .limit(100);
      return rows.map((row) => this.toDto(row));
    });
  }

  async detail(tenantId: string, id: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) => this.dto(tx, tenantId, id));
  }

  private async dto(tx: DrizzleTx, tenantId: string, id: string) {
    const [row] = await tx.select().from(fxRevaluationRuns).where(and(eq(fxRevaluationRuns.id, id), eq(fxRevaluationRuns.tenantId, tenantId)));
    if (!row) throw new DomainError('FX_REVALUATION_NOT_FOUND', 'تشغيل إعادة التقييم غير موجود', 404, { field: 'id' });
    return this.toDto(row);
  }

  private toDto(row: {
    id: string;
    runDate: Date | string;
    status: string;
    journalEntryId: string | null;
    reversalEntryId: string | null;
    gainLoss: string;
    detail: unknown;
    createdBy: string | null;
    createdAt: Date | string;
  }) {
    const iso = (value: Date | string) => (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10);
    return {
      id: row.id,
      runDate: iso(row.runDate),
      status: row.status,
      journalEntryId: row.journalEntryId,
      reversalEntryId: row.reversalEntryId,
      gainLoss: row.gainLoss,
      detail: row.detail,
      createdBy: row.createdBy,
      createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : row.createdAt,
    };
  }
}
