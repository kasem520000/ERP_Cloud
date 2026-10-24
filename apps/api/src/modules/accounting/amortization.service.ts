import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@erp/contracts';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { Decimal } from 'decimal.js';

import {
  accounts,
  amortizationSchedules,
  journalEntries,
  purchaseInvoices,
  vouchers,
  withTenantTx,
  type DatabaseHandle,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { isUniqueViolation } from '../organization/shared/org-support.js';

import { AccountingService } from './accounting.service.js';

/**
 * MF-22 — المصروفات المقدّمة والمستحقة وجداول الإطفاء (دفقة D7).
 *
 * التوليد يمرّ حصراً عبر `accounting.postJournal` بمفتاح idempotency فريد لكل
 * (جدول، فترة) ⇐ يرث كل الحرّاس المُختبَرة سابقاً: `FISCAL_PERIOD_CLOSED`
 * (لا قسط في فترة مغلقة)، الحارس النقدي/الحسابات، والقيد المتوازن — ولا يُختبر
 * حرّاساً جُدد هنا مرة واحدة. الاستحقاق يُنفَّذ بقيد يليه **عكس تلقائي أول الشهر
 * التالي** عبر `reverseJournal` (نفسه idempotent بـ`kind='reversal'` و`reversalOf`)؛
 * وفترة العكس تُفتح/يُتحقّق منها **قبل** نشر الاستحقاق حتى لا يبقى قيد بلا عكس.
 *
 * القسط الأخير يُعايَر على الباقي (`total − installment × (months−1)`) فتفادي
 * فروق التقريب (12000/12 = 1000.0000 تماماً، وأي انقسام آخر يُسوَّى في القسط
 * الأخير).
 */
export type AmortizationScheduleInput = {
  kind: 'prepaid' | 'accrual';
  months: number;
  expenseAccountId: string;
  deferralAccountId: string;
  sourceType?: 'voucher' | 'purchase_invoice' | 'manual';
  sourceId?: string;
  /** مطلوب مع `sourceType='manual'` وبعض مصادر الفواتير. */
  totalAmount?: string;
  startDate?: string;
  branchId?: string;
};

export type GenerateInstallmentInput = { period?: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function daysInMonth(year: number, month1: number): number {
  return new Date(Date.UTC(year, month1, 0)).getUTCDate();
}

/** إزاحة تاريخ بأشهر مع الحفاظ على اليوم (ويُقصّ يوم الشهر إن لزم مثل 31→30). */
function advanceMonths(dateStr: string, months: number): string {
  const parts = dateStr.split('-').map(Number);
  const y = parts[0] ?? 0;
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const total = y * 12 + (m - 1) + months;
  const y2 = Math.floor(total / 12);
  const m2 = (total % 12) + 1;
  return `${y2}-${pad2(m2)}-${pad2(Math.min(d, daysInMonth(y2, m2)))}`;
}

function assertDate(value: string, field: string): void {
  if (!DATE_RE.test(value)) {
    throw new DomainError('AMORTIZATION_INPUT_INVALID', `${field} يجب أن يكون تاريخاً YYYY-MM-DD`, 422, {
      field,
    });
  }
}

@Injectable()
export class AmortizationService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly accounting: AccountingService,
  ) {}

  async createSchedule(tenantId: string, input: AmortizationScheduleInput) {
    const kind = input.kind;
    if (kind !== 'prepaid' && kind !== 'accrual') {
      throw new DomainError('AMORTIZATION_INPUT_INVALID', 'kind يجب أن يكون prepaid أو accrual', 422, {
        field: 'kind',
      });
    }
    const months = Number(input.months);
    if (!Number.isInteger(months) || months < 1 || months > 120) {
      throw new DomainError('AMORTIZATION_INPUT_INVALID', 'months يجب أن يكون عدداً صحيحاً بين 1 و120', 422, {
        field: 'months',
      });
    }
    if (!input.expenseAccountId || !input.deferralAccountId || input.expenseAccountId === input.deferralAccountId) {
      throw new DomainError(
        'AMORTIZATION_INPUT_INVALID',
        'expenseAccountId وdeferralAccountId مطلوبان ويجب أن يختلفا',
        422,
        { field: 'accounts' },
      );
    }

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const found = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, [input.expenseAccountId, input.deferralAccountId])));
      if (found.length !== 2) {
        throw new DomainError('AMORTIZATION_ACCOUNT_NOT_FOUND', 'حساب المصروف أو حساب التسوية غير موجود في المستأجر', 422);
      }

      const sourceType = input.sourceType ?? (input.sourceId ? 'voucher' : 'manual');
      let total: Decimal;
      let startDate: string;
      let branchId: string | null = input.branchId ?? null;
      let sourceId: string | null = null;

      if (sourceType === 'voucher') {
        if (!input.sourceId) {
          throw new DomainError('AMORTIZATION_SOURCE_REQUIRED', 'sourceId مطلوب لمصدر من نوع سند', 422, {
            field: 'sourceId',
          });
        }
        const voucher = (
          await tx
            .select()
            .from(vouchers)
            .where(and(eq(vouchers.tenantId, tenantId), eq(vouchers.id, input.sourceId), eq(vouchers.kind, 'payment')))
            .limit(1)
        )[0];
        if (!voucher) {
          throw new DomainError('AMORTIZATION_SOURCE_NOT_FOUND', 'سند الصرف غير موجود', 422, { sourceId: input.sourceId });
        }
        if (voucher.status !== 'posted') {
          throw new DomainError('AMORTIZATION_SOURCE_NOT_POSTED', 'لا يُشتق جدول من سند غير مرحَّل', 422, {
            sourceId: input.sourceId,
          });
        }
        total = new Decimal(voucher.amount);
        startDate = input.startDate ?? advanceMonths(voucher.date, 1);
        branchId = branchId ?? voucher.branchId;
        sourceId = voucher.id;
      } else if (sourceType === 'purchase_invoice') {
        if (!input.sourceId) {
          throw new DomainError('AMORTIZATION_SOURCE_REQUIRED', 'sourceId مطلوب لمصدر من نوع فاتورة شراء', 422, {
            field: 'sourceId',
          });
        }
        const invoice = (
          await tx.select().from(purchaseInvoices).where(and(eq(purchaseInvoices.tenantId, tenantId), eq(purchaseInvoices.id, input.sourceId))).limit(1)
        )[0];
        if (!invoice) {
          throw new DomainError('AMORTIZATION_SOURCE_NOT_FOUND', 'فاتورة الشراء غير موجودة', 422, {
            sourceId: input.sourceId,
          });
        }
        total = new Decimal(invoice.total ?? '0');
        if (total.lte(0)) {
          throw new DomainError('AMORTIZATION_TOTAL_INVALID', 'إجمالي الفاتورة يجب أن يكون أكبر من صفر', 422);
        }
        const anchor = invoice.dueDate ?? invoice.supplierReferenceDate;
        startDate = input.startDate ?? (anchor ? advanceMonths(anchor, 1) : '');
        branchId = branchId ?? invoice.branchId;
        sourceId = invoice.id;
      } else if (sourceType === 'manual') {
        const raw = input.totalAmount ?? '';
        const parsed = new Decimal(raw || '0');
        if (!raw || parsed.lte(0) || !parsed.isFinite()) {
          throw new DomainError('AMORTIZATION_TOTAL_INVALID', 'totalAmount مطلوب وموجب للمصدر اليدوي', 422, {
            field: 'totalAmount',
          });
        }
        total = parsed;
        startDate = input.startDate ?? '';
      } else {
        throw new DomainError('AMORTIZATION_INPUT_INVALID', 'sourceType غير معروف', 422, { field: 'sourceType' });
      }

      if (!startDate) {
        throw new DomainError('AMORTIZATION_START_DATE_REQUIRED', 'startDate مطلوب حين لا يستنتج من المصدر', 422, {
          field: 'startDate',
        });
      }
      assertDate(startDate, 'startDate');
      if (total.lte(0)) {
        throw new DomainError('AMORTIZATION_TOTAL_INVALID', 'قيمة الجدول يجب أن تكون أكبر من صفر', 422);
      }

      const installment = total.div(months);
      if (installment.lte(0)) {
        throw new DomainError('AMORTIZATION_TOTAL_INVALID', 'القسط المحسوب أكبر من صفر', 422);
      }

      try {
        const inserted = await tx
          .insert(amortizationSchedules)
          .values({
            tenantId,
            branchId,
            kind,
            sourceType,
            sourceId,
            expenseAccountId: input.expenseAccountId,
            deferralAccountId: input.deferralAccountId,
            totalAmount: total.toFixed(4),
            installmentAmount: installment.toFixed(4),
            months,
            startDate,
          })
          .returning();
        return inserted[0]!;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DomainError('AMORTIZATION_SCHEDULE_EXISTS', 'جدول مفتوح لهذا المصدر سلفاً', 409, {
            sourceType,
            sourceId,
          });
        }
        throw error;
      }
    });
  }

  async listSchedules(tenantId: string) {
    const rows = await withTenantTx(this.database.db, tenantId, async (tx) =>
      tx.select().from(amortizationSchedules).where(eq(amortizationSchedules.tenantId, tenantId)).orderBy(asc(amortizationSchedules.startDate)),
    );
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((row) => {
      const total = new Decimal(row.totalAmount);
      const installment = new Decimal(row.installmentAmount);
      const generated = row.generatedCount;
      let balance: Decimal;
      if (row.kind === 'accrual') {
        // المستحق القائم = قسط أُستحدث ولم يُعكَس بعد (تاريخ عكسه بعد اليوم).
        const lastReversalDate =
          generated > 0 ? advanceMonths(advanceMonths(row.startDate, generated - 1), 1) : '';
        balance = generated > 0 && lastReversalDate > today ? installment : new Decimal(0);
      } else {
        balance = Decimal.max(total.minus(installment.times(generated)), 0);
      }
      return {
        ...row,
        amortizedAmount: installment.times(generated).toFixed(4),
        balance: balance.toFixed(4),
        remainingMonths: Math.max(row.months - generated, 0),
      };
    });
  }

  async generate(tenantId: string, scheduleId: string, input: GenerateInstallmentInput) {
    const period = String(input.period ?? '');
    if (!PERIOD_RE.test(period)) {
      throw new DomainError('AMORTIZATION_PERIOD_INVALID', 'period يجب أن يكون YYYY-MM', 422, { field: 'period' });
    }
    const periodParts = period.split('-').map(Number);
    const pYear = periodParts[0] ?? 0;
    const pMonth = periodParts[1] ?? 1;

    const schedule = (
      await withTenantTx(this.database.db, tenantId, async (tx) =>
        tx.select().from(amortizationSchedules).where(and(eq(amortizationSchedules.tenantId, tenantId), eq(amortizationSchedules.id, scheduleId))).limit(1),
      )
    )[0];
    if (!schedule) {
      throw new DomainError('AMORTIZATION_SCHEDULE_NOT_FOUND', 'جدول الإطفاء غير موجود', 404, { scheduleId });
    }
    if (schedule.status === 'cancelled') {
      throw new DomainError('AMORTIZATION_CANCELLED', 'الجدول ملغى', 409, { scheduleId });
    }

    const startParts = schedule.startDate.split('-').map(Number);
    const sYear = startParts[0] ?? 0;
    const sMonth = startParts[1] ?? 1;
    const index = (pYear - sYear) * 12 + (pMonth - sMonth);
    if (index < 0 || index >= schedule.months) {
      throw new DomainError(
        'AMORTIZATION_PERIOD_OUT_OF_RANGE',
        'الفترة خارج مدى الجدول',
        422,
        { period, startDate: schedule.startDate, months: schedule.months },
      );
    }

    const installmentDate = advanceMonths(schedule.startDate, index);
    const canonicalPeriod = installmentDate.slice(0, 7);
    const idempotencyKey = `amortization:${scheduleId}:${canonicalPeriod}`;

    const existing = await withTenantTx(this.database.db, tenantId, async (tx) =>
      tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.idempotencyKey, idempotencyKey)))
        .limit(1),
    );
    if (existing.length > 0) {
      throw new DomainError('AMORTIZATION_INSTALLMENT_EXISTS', 'قسط هذه الفترة مُولَّد سلفاً', 409, {
        period: canonicalPeriod,
        entryId: existing[0]!.id,
      });
    }

    const total = new Decimal(schedule.totalAmount);
    const installment = new Decimal(schedule.installmentAmount);
    const amount =
      index === schedule.months - 1 ? total.minus(installment.times(schedule.months - 1)) : installment;
    const amountStr = amount.toFixed(4);

    // الاستحقاق: عكسه أول الشهر التالي يجب أن تتوفر فترة مفتوحة له — يُتحقّق
    // قبل نشر القيد حتى لا يبقى استحقاق بلا عكس إن كانت فترة العكس مغلقة.
    const reversalDate = advanceMonths(installmentDate, 1);
    if (schedule.kind === 'accrual') {
      await this.accounting.openPeriodForDate(tenantId, reversalDate);
    }

    let entry: { id?: string; number?: string; [k: string]: unknown };
    try {
      entry = (await this.accounting.postJournal(tenantId, {
        date: installmentDate,
        description:
          schedule.kind === 'accrual'
            ? `قيد استحقاق ${canonicalPeriod} — جدول ${scheduleId}`
            : `إطفاء مقدّم ${canonicalPeriod} — جدول ${scheduleId}`,
        lines: [
          { accountId: schedule.expenseAccountId, debit: amountStr },
          { accountId: schedule.deferralAccountId, credit: amountStr },
        ],
        sourceType: 'amortization',
        sourceId: scheduleId,
        idempotencyKey,
      })) as { id?: string; number?: string; [k: string]: unknown };
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError('AMORTIZATION_INSTALLMENT_EXISTS', 'قسط هذه الفترة مُولَّد سلفاً', 409, {
          period: canonicalPeriod,
        });
      }
      throw error;
    }

    let reversalEntryId: string | null = null;
    if (schedule.kind === 'accrual') {
      // الطريق الداخلي `reverseJournalInTx` — الحارس العام ACC-186 يمنع عكس قيود
      // المستندات من شاشة القيود (عمداً)، ومقصود الجدول هنا هو شاشة هذا المستند؛
      // العكس يبقى مؤرَّخاً بـ`kind='reversal'` و`reversalOf` وبنفس فحص فترة العكس.
      reversalEntryId = await withTenantTx(this.database.db, tenantId, async (tx) => {
        const reversal = await this.accounting.reverseJournalInTx(tx, tenantId, String(entry.id ?? ''), {
          date: reversalDate,
          reason: 'عكس تلقائي أول الشهر التالي — استحقاق جدول MF-22',
        });
        return String(reversal?.id ?? '') || null;
      });
    }

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const current = (
        await tx
          .select({ generatedCount: amortizationSchedules.generatedCount })
          .from(amortizationSchedules)
          .where(eq(amortizationSchedules.id, scheduleId))
          .limit(1)
      )[0];
      const next = (current?.generatedCount ?? schedule.generatedCount) + 1;
      await tx
        .update(amortizationSchedules)
        .set({
          generatedCount: next,
          lastGeneratedPeriod: installmentDate,
          status: next >= schedule.months ? 'completed' : 'active',
          updatedAt: new Date(),
        })
        .where(eq(amortizationSchedules.id, scheduleId));
    });

    return {
      scheduleId,
      period: canonicalPeriod,
      installmentDate,
      amount: amountStr,
      entryId: String(entry.id ?? ''),
      reversalEntryId,
    };
  }
}
