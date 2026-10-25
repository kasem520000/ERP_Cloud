import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { DomainError } from '@erp/contracts';
import {
  accounts,
  branches,
  fiscalPeriods,
  journalEntries,
  newId,
  shiftCloses,
  vatFilings,
  withTenantTx,
  type DatabaseHandle,
  type DrizzleTx,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { isUniqueViolation } from '../organization/shared/org-support.js';
import { ReportingService } from '../reporting/reporting.service.js';

import { AccountingService } from './accounting.service.js';

/**
 * MF-18 / r45 / D11 — دورة الإقرار الضريبي:
 *
 *  • AC1: `file()` يجمّد صفوف تقرير `vat-return-period` في `snapshot` ثم **يقفل** كل
 *    فترة محاسبية مغطاة لنطاق الإقرار داخل معاملة واحدة — فما بعد التقديم لا يُنشئ
 *    ولا يُرحّل أي وثيقة بتاريخ داخله (`FISCAL_PERIOD_CLOSED`)، ولا يُعاد فتح فترة
 *    مغطاة بإقرار (`VAT_FILING_EXISTS` في `reopenPeriod`/`reopenYear`).
 *  • AC2: مصدر الأرقام **هو التقرير نفسه** (`ReportingService.run`) — بنود النموذج
 *    13 بنداً بتصنيف R33 + حصص الإشعارات الدائنة/المدينية.
 *  • AC3: قيد التسوية ينقل الصافي عن `2222001` إلى ذمة «ضريبة مستحقة الدفع» (صافي
 *    موجب) أو أصل «ضريبة مستردة» (سالب) — فيبقى رصيد 2222001 = 0 بعد التقديم، والقيد
 *    `is_vat=false` فلا يدخل إقرارات لاحقة.
 *
 * الحراس: نفس نطاق (409 VAT_FILING_ALREADY_FILED — شهر داخل ربع يعني تسوية مزدوجة) ·
 * لا فترة تغطي النطاق (422 VAT_FILING_NO_FISCAL_PERIOD) · إغلاق المدة يحمّل حواجز
 * `closePeriod` نفسها (مسودات/ورديات) داخل المعاملة — أي فشل يُرجِع كل شيء.
 */
@Injectable()
export class TaxFilingsService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly reporting: ReportingService,
    private readonly accounting: AccountingService,
  ) {}

  private readonly DAY = /^\d{4}-\d{2}-\d{2}$/;

  private parseRange(from?: string, to?: string) {
    if (!from || !to || !this.DAY.test(from) || !this.DAY.test(to)) {
      throw new DomainError('VAT_FILING_DATE_INVALID', 'التاريخ من/إلى مطلوب بصيغة YYYY-MM-DD', 422, {
        field: 'from',
      });
    }
    if (from > to) throw new DomainError('VAT_FILING_DATE_INVALID', '«من» يجب أن يسبق «إلى»', 422, { field: 'from' });
    return { from, to };
  }

  async list(tenantId: string) {
    const rows = await withTenantTx(this.database.db, tenantId, async (tx) => {
      const filings = await tx
        .select()
        .from(vatFilings)
        .where(eq(vatFilings.tenantId, tenantId))
        .orderBy(desc(vatFilings.periodFrom));
      if (filings.length === 0) return [];
      const first = filings[filings.length - 1]!;
      const last = filings[0]!;
      const periods = await tx
        .select({ id: fiscalPeriods.id, start: fiscalPeriods.startDate, end: fiscalPeriods.endDate })
        .from(fiscalPeriods)
        .where(
          and(eq(fiscalPeriods.tenantId, tenantId), lte(fiscalPeriods.startDate, last.periodTo), gte(fiscalPeriods.endDate, first.periodFrom)),
        );
      return filings.map((filing) => ({
        id: filing.id,
        periodFrom: filing.periodFrom,
        periodTo: filing.periodTo,
        netVat: filing.netVat,
        outputVat: filing.outputVat,
        inputVat: filing.inputVat,
        journalEntryId: filing.journalEntryId,
        settlementAccountId: filing.settlementAccountId,
        filedAt: filing.filedAt,
        filedBy: filing.filedBy,
        closedPeriodIds: periods
          .filter((p) => p.start <= filing.periodTo && p.end >= filing.periodFrom)
          .map((p) => p.id),
      }));
    });
    return rows;
  }

  async detail(tenantId: string, id: string) {
    const row = await withTenantTx(this.database.db, tenantId, async (tx) => {
      const [filing] = await tx.select().from(vatFilings).where(and(eq(vatFilings.id, id), eq(vatFilings.tenantId, tenantId)));
      if (!filing) throw new DomainError('NOT_FOUND', 'لا يوجد إقرار بهذا المعرّف', 404);
      const periods = await tx
        .select({ id: fiscalPeriods.id })
        .from(fiscalPeriods)
        .where(
          and(eq(fiscalPeriods.tenantId, tenantId), lte(fiscalPeriods.startDate, filing.periodTo), gte(fiscalPeriods.endDate, filing.periodFrom)),
        );
      return {
        id: filing.id,
        periodFrom: filing.periodFrom,
        periodTo: filing.periodTo,
        netVat: filing.netVat,
        outputVat: filing.outputVat,
        inputVat: filing.inputVat,
        journalEntryId: filing.journalEntryId,
        settlementAccountId: filing.settlementAccountId,
        filedAt: filing.filedAt,
        filedBy: filing.filedBy,
        snapshot: filing.snapshot,
        closedPeriodIds: periods.map((p) => p.id),
      };
    });
    return row;
  }

  /** حساب تسوية يُنشأ عند أول استعمال (كوّدي ثابتان في مخطط حسابات المستأجر). */
  private async ensureSettlementAccount(
    tx: DrizzleTx,
    tenantId: string,
    kind: 'payable' | 'refundable',
    explicitId?: string,
  ) {
    const preset =
      kind === 'payable'
        ? { code: '2222003', nameAr: 'ضريبة مستحقة الدفع', nameEn: 'VAT payable', type: 'liability' as const, normalBalance: 'credit' as const, parentCode: '222' }
        : { code: '1280001', nameAr: 'ضريبة مستردة', nameEn: 'VAT receivable', type: 'asset' as const, normalBalance: 'debit' as const, parentCode: '12' };

    if (explicitId) {
      const [explicit] = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.id, explicitId), eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)));
      if (!explicit) throw new DomainError('VAT_FILING_ACCOUNT_REQUIRED', 'حساب التسوية المحدد غير موجود', 422, { field: kind });
      return explicit.id;
    }

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
    if (!parent) {
      throw new DomainError(
        'VAT_FILING_ACCOUNT_REQUIRED',
        `لا يوجد حساب أب ${preset.parentCode} لإنشاء حساب «${preset.nameAr}» — أنشئ الحساب أو مرّره صريحاً`,
        422,
        { field: kind },
      );
    }
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

  /**
   * تقديم الإقرار: معاينة التقرير ← التحقق من النطاق ← (المعاملة) تسوية + لقطة + إقفال.
   */
  async file(
    tenantId: string,
    userId: string | null,
    input: { from?: string; to?: string; payableAccountId?: string; refundableAccountId?: string },
  ) {
    const { from, to } = this.parseRange(input.from, input.to);

    // AC2/AC3 — أرقام لحظة التقديم من التقرير الرسمي نفسه (مصدر واحد).
    const report = await this.reporting.run(tenantId, 'vat-return-period', { from, to });
    const rows = report.rows as Array<Record<string, string>>;
    const net = new Decimal(report.grandTotal.find((card) => card.key === 's_net_vat')?.amount ?? '0');
    if (!net.isFinite()) throw new DomainError('VAT_FILING_DATE_INVALID', 'تعذّر حساب صافي الإقرار', 422);
    const outputVat = rows.reduce(
      (sum, row) => {
        const value = new Decimal(row.s_net_vat ?? '0');
        return sum.plus(value.isNegative() ? '0' : value);
      },
      new Decimal(0),
    );
    const inputVat = rows.reduce(
      (sum, row) => {
        const value = new Decimal(row.s_net_vat ?? '0');
        return sum.plus(value.isPositive() ? '0' : value.negated());
      },
      new Decimal(0),
    );
    const snapshot = {
      reportKey: 'vat-return-period' as const,
      params: { from, to },
      rows,
      columns: report.columns.map((column) => ({
        key: column.key,
        labelAr: column.labelAr,
        type: column.type,
        hidden: Boolean('hidden' in column && column.hidden),
      })),
      grandTotal: report.grandTotal,
    };

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      // حارس التداخل/التكرار: النطاق المقدَّم (شهر داخل ربع = تسوية مزدوجة).
      const clash = await tx
        .select({ id: vatFilings.id, from: vatFilings.periodFrom, to: vatFilings.periodTo })
        .from(vatFilings)
        .where(
          and(eq(vatFilings.tenantId, tenantId), lte(vatFilings.periodFrom, to), gte(vatFilings.periodTo, from)),
        )
        .limit(1);
      if (clash[0]) {
        throw new DomainError(
          'VAT_FILING_ALREADY_FILED',
          `نطاق الإقرار يتداخل مع إقرار مقدَّم (${clash[0].from} .. ${clash[0].to})`,
          409,
          { filingId: clash[0].id, periodFrom: clash[0].from, periodTo: clash[0].to },
        );
      }

      const periods = await tx
        .select()
        .from(fiscalPeriods)
        .where(
          and(eq(fiscalPeriods.tenantId, tenantId), lte(fiscalPeriods.startDate, to), gte(fiscalPeriods.endDate, from)),
        );
      if (periods.length === 0) {
        throw new DomainError('VAT_FILING_NO_FISCAL_PERIOD', 'لا توجد فترة محاسبية تغطي نطاق الإقرار', 422, {
          from,
          to,
        });
      }

      // AC3 — قيد التسوية داخل المعاملة نفسها (is_vat=false افتراضياً: حركة أرصدة
      // ليست حدثاً ضريباً — وإلا دخلت إقرارات لاحقة وخالفت اللقطة).
      let journalEntryId: string | null = null;
      let settlementAccountId: string | null = null;
      const absNet = net.abs();
      if (absNet.gte('0.005')) {
        const payable = net.gt(0);
        const counterId = await this.ensureSettlementAccount(
          tx,
          tenantId,
          payable ? 'payable' : 'refundable',
          payable ? input.payableAccountId : input.refundableAccountId,
        );
        const [vatRow] = await tx
          .select({ id: accounts.id })
          .from(accounts)
          .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, '2222001'), isNull(accounts.deletedAt)))
          .limit(1);
        if (!vatRow) {
          throw new DomainError('VAT_FILING_ACCOUNT_REQUIRED', 'حساب ضريبة القيمة المضافة 2222001 غير موجود', 422);
        }
        const vatId = vatRow.id;
        const [branch] = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.tenantId, tenantId))
          .limit(1);
        if (!branch) throw new DomainError('VAT_FILING_ACCOUNT_REQUIRED', 'لا يوجد فرع لقيد التسوية', 422);
        // الفترة التي تحوي تاريخ نهاية النطاق (القيد مؤرَّخ بها ويُسجَّل قبل الإقفال).
        const endPeriod = periods.find((period) => period.startDate <= to && period.endDate >= to);
        if (!endPeriod) throw new DomainError('VAT_FILING_NO_FISCAL_PERIOD', 'لا فترة تغطي نهاية النطاق', 422);
        const value = absNet.toFixed(4);
        const entry = await this.accounting.postJournalInTx(tx, tenantId, {
          branchId: branch.id,
          fiscalPeriodId: endPeriod.id,
          date: to,
          description: `تسوية إقرار ضريبي ${from} .. ${to}`,
          sourceType: 'vat_filing',
          idempotencyKey: `vat-filing:${tenantId}:${from}:${to}`,
          lines: payable
            ? [
                { accountId: vatId, debit: value, credit: '0.0000', description: 'صافي ضريبة مستحقة' },
                { accountId: counterId, debit: '0.0000', credit: value, description: 'ضريبة مستحقة الدفع' },
              ]
            : [
                { accountId: counterId, debit: value, credit: '0.0000', description: 'ضريبة مستردة' },
                { accountId: vatId, debit: '0.0000', credit: value, description: 'استرداد من 2222001' },
              ],
        });
        journalEntryId = entry?.id ?? null;
        if (!journalEntryId) throw new DomainError('INTERNAL', 'تعذّر ترحيل قيد التسوية', 500);
        settlementAccountId = counterId;
      }

      const [filing] = await tx
        .insert(vatFilings)
        .values({
          id: newId(),
          tenantId,
          periodFrom: from,
          periodTo: to,
          snapshot,
          netVat: net.toFixed(4),
          outputVat: outputVat.toFixed(4),
          inputVat: inputVat.toFixed(4),
          journalEntryId,
          settlementAccountId,
          filedBy: userId,
        })
        .returning();
      if (!filing) throw new DomainError('INTERNAL', 'تعذّر حفظ الإقرار', 500);

      // AC1 — إقفال كل فترة مغطاة (حواجز closePeriod نفسها داخل المعاملة).
      const open = periods.filter((period) => period.status === 'open');
      if (open.length > 0) {
        const openIds = open.map((period) => period.id);
        const draftRows = await tx
          .select({ c: sql<number>`coalesce(count(*), 0)::int` })
          .from(journalEntries)
          .where(
            and(
              eq(journalEntries.tenantId, tenantId),
              inArray(journalEntries.fiscalPeriodId, openIds),
              eq(journalEntries.status, 'draft'),
            ),
          );
        const draftCount = Number(draftRows[0]?.c ?? 0);
        if (draftCount > 0) {
          throw new DomainError(
            'FISCAL_PERIOD_HAS_DRAFT_JOURNALS',
            'لا يمكن إقفال الفترة لاحتوائها على قيود يومية مسودة',
            409,
            { blockers: ['draft_journals'], drafts: draftCount },
          );
        }
        const shiftRows = await tx
          .select({ c: sql<number>`coalesce(count(*), 0)::int` })
          .from(shiftCloses)
          .where(and(eq(shiftCloses.tenantId, tenantId), eq(shiftCloses.status, 'open')));
        const openShifts = Number(shiftRows[0]?.c ?? 0);
        if (openShifts > 0) {
          throw new DomainError(
            'PERIOD_CLOSE_BLOCKED',
            'لا يمكن إقفال الفترة وورديات صندوق مفتوحة — أغلق الورديات أولاً',
            409,
            { blockers: ['open_shifts'], openShifts },
          );
        }
        await tx
          .update(fiscalPeriods)
          .set({ status: 'closed', closedAt: new Date(), closedBy: userId, isActive: false })
          .where(and(eq(fiscalPeriods.tenantId, tenantId), inArray(fiscalPeriods.id, openIds)));
      }

      return {
        id: filing.id,
        periodFrom: filing.periodFrom,
        periodTo: filing.periodTo,
        netVat: filing.netVat,
        outputVat: filing.outputVat,
        inputVat: filing.inputVat,
        journalEntryId: filing.journalEntryId,
        settlementAccountId: filing.settlementAccountId,
        filedAt: filing.filedAt,
        closedPeriodIds: open.map((period) => period.id),
        rowCount: rows.length,
      };
    });
  }
}
