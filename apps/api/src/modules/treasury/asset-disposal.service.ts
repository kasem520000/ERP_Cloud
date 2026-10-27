import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@erp/contracts';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';
import {
  accounts,
  assetCategories,
  assetDepreciationLines,
  assetDepreciationRuns,
  assetDisposals,
  branches,
  cashLocations,
  fixedAssets,
  withTenantTx,
  type DatabaseHandle,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { tryGetAuthContext } from '../platform/context/tenant-context.js';
import { AccountingService, type JournalLineInput } from '../accounting/accounting.service.js';

import { TreasuryService } from './treasury.service.js';

/**
 * MF-21 — استبعاد/بيع الأصول الثابتة (دفقة D8).
 *
 * الخدمة هذه **بوحدة الخزينة** لا المحاسبة لأن البيع يستدعي **سند قبض حقيقياً**
 * (الاتجاه الوحيد المسموح treasury→accounting بلا دورة وحدات): المبيعات لا
 * تُقيَّد نقداً مباشراً في الأستاذ وحده وإلا خالف رصيد الخزينة الأستاذ (خط Tema
 * موثّق في عمليات التدقيق). التدفّق:
 *
 *   1) تحقّق + إدراج صف الاستبعاد (منطوق حسابي قبل أي قيد).
 *   2) (بيع فقط) سند قبض: مدين الصندوق/البنك — دائن **حساب تسوية** (لا الربح):
 *      التسوية تصفّر في القيد التالي فلا يمرّ الربح عبر الخزينة ناقصاً.
 *   3) قيد التحرّك (postJournal بمفتاح `disposal-journal:<id>`): مدين التسوية
 *      + مجمع الإهلاك [+ خسارة] — دائن الأصل [+ ربح]. الرصيد هندسي مضمون:
 *      طرفان = التكلفة في كل الحالات.
 *   4) تحديث الأصل (كامل ⇐ disposed · جزئي ⇐ نزف التكلفة) وربط السند والقيد.
 *
 * الاستبعاد الجزئي: `cost_amount ≤ التكلفة الباقية` والمجمع المرفوع بنسبة
 * التكلفة (نصف الكلفة ⇐ نصف المجمع بالضبط — مُتحقَّق في r42).
 */
export type AssetDisposalInput = {
  kind: 'sale' | 'scrap';
  date: string;
  costAmount?: string;
  proceeds?: string;
  cashLocationId?: string;
  gainAccountId: string;
  lossAccountId: string;
  proceedsAccountId?: string;
  branchId?: string;
  reason?: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const R4 = (value: Decimal): string => value.toDecimalPlaces(4).toFixed(4);

@Injectable()
export class AssetDisposalService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly accounting: AccountingService,
    private readonly treasury: TreasuryService,
  ) {}

  async createDisposal(tenantId: string, assetId: string, input: AssetDisposalInput) {
    if (input.kind !== 'sale' && input.kind !== 'scrap') {
      throw new DomainError('DISPOSAL_INPUT_INVALID', 'kind يجب أن يكون sale أو scrap', 422, { field: 'kind' });
    }
    if (!input.date || !DATE_RE.test(input.date)) {
      throw new DomainError('DISPOSAL_INPUT_INVALID', 'date يجب أن يكون YYYY-MM-DD', 422, { field: 'date' });
    }
    if (!input.gainAccountId || !input.lossAccountId || input.gainAccountId === input.lossAccountId) {
      throw new DomainError('DISPOSAL_INPUT_INVALID', 'حسابا ربح وخسارة مطلوبان ومختلفان', 422, {
        field: 'accounts',
      });
    }

    // ===== (1) تحقّق + إدراج صف الاستبعاد =====
    const phase1 = await withTenantTx(this.database.db, tenantId, async (tx) => {
      const asset = (
        await tx
          .select({ asset: fixedAssets, category: assetCategories })
          .from(fixedAssets)
          .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
          .where(and(eq(fixedAssets.tenantId, tenantId), eq(fixedAssets.id, assetId)))
          .limit(1)
      )[0];
      if (!asset) {
        throw new DomainError('FIXED_ASSET_NOT_FOUND', 'الأصل غير موجود', 404, { assetId });
      }
      if (asset.asset.status === 'disposed') {
        throw new DomainError('FIXED_ASSET_ALREADY_DISPOSED', 'الأصل مستبعد سلفاً', 409, { assetId });
      }

      const cost = new Decimal(asset.asset.cost);
      const costDisposed = input.costAmount ? new Decimal(input.costAmount) : cost;
      if (!costDisposed.isFinite() || costDisposed.lte(0) || costDisposed.gt(cost)) {
        throw new DomainError('DISPOSAL_AMOUNT_INVALID', 'costAmount يجب أن يكون موجباً لا يتجاوز تكلفة الأصل', 422, {
          field: 'costAmount',
          cost: asset.asset.cost,
        });
      }

      const proceeds = new Decimal(input.proceeds ?? '0');
      if (!proceeds.isFinite() || proceeds.lt(0)) {
        throw new DomainError('DISPOSAL_PROCEEDS_INVALID', 'proceeds يجب أن يكون غير سالب', 422, {
          field: 'proceeds',
        });
      }
      if (input.kind === 'sale') {
        if (proceeds.lte(0)) {
          throw new DomainError('DISPOSAL_PROCEEDS_REQUIRED', 'البيع يتطلب عائداً أكبر من صفر', 422, {
            field: 'proceeds',
          });
        }
        if (!input.cashLocationId || !input.proceedsAccountId) {
          throw new DomainError(
            'DISPOSAL_PROCEEDS_REQUIRED',
            'البيع يتطلب cashLocationId (الصندوق/البنك) وproceedsAccountId (التسوية)',
            422,
          );
        }
      } else if (proceeds.gt(0)) {
        throw new DomainError('DISPOSAL_PROCEEDS_INVALID', 'التخفيض بلا عائد — استخدم kind=sale للبيع', 422, {
          field: 'proceeds',
        });
      }

      // المجمع الحالي = تشغيلات مرحَّلة − مرفوع في استبعادات سابقة.
      const depRow = (
        await tx
          .select({ total: sql<string>`COALESCE(SUM(${assetDepreciationLines.amount}), 0)::text` })
          .from(assetDepreciationLines)
          .innerJoin(assetDepreciationRuns, eq(assetDepreciationRuns.id, assetDepreciationLines.runId))
          .where(and(eq(assetDepreciationRuns.tenantId, tenantId), eq(assetDepreciationRuns.status, 'posted'), eq(assetDepreciationLines.assetId, assetId)))
      )[0];
      const dispRow = (
        await tx
          .select({ accum: sql<string>`COALESCE(SUM(${assetDisposals.accumulatedRemoved}), 0)::text` })
          .from(assetDisposals)
          .where(and(eq(assetDisposals.tenantId, tenantId), eq(assetDisposals.assetId, assetId)))
      )[0];
      const accumulated = new Decimal(depRow?.total ?? '0').minus(new Decimal(dispRow?.accum ?? '0'));

      // مرفوع proportional: الكامل ⇐ المجمع كله، وإلا بالحصة من الكلفة.
      const isFull = costDisposed.gte(cost);
      const accumRemoved = isFull
        ? accumulated
        : accumulated.mul(costDisposed).div(cost).toDecimalPlaces(4);
      const nbvRemoved = costDisposed.minus(accumRemoved);
      const gainLoss = proceeds.minus(nbvRemoved);

      // حسابات الحركة مطلوبة وموجودة.
      const accountIds = [input.gainAccountId, input.lossAccountId];
      if (input.proceedsAccountId) accountIds.push(input.proceedsAccountId);
      const foundAccounts = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, accountIds)));
      if (new Set(foundAccounts.map((a) => a.id)).size !== new Set(accountIds).size) {
        throw new DomainError('DISPOSAL_ACCOUNT_NOT_FOUND', 'أحد حسابات البيع/التخفيض غير موجود', 422);
      }
      if (input.kind === 'sale') {
        const location = await tx
          .select({ id: cashLocations.id })
          .from(cashLocations)
          .where(and(eq(cashLocations.tenantId, tenantId), eq(cashLocations.id, String(input.cashLocationId))))
          .limit(1);
        if (location.length === 0) {
          throw new DomainError('DISPOSAL_CASH_LOCATION_NOT_FOUND', 'موقع النقد غير موجود', 422);
        }
      }

      const inserted = await tx
        .insert(assetDisposals)
        .values({
          tenantId,
          assetId,
          date: input.date,
          kind: input.kind,
          costDisposed: R4(costDisposed),
          accumulatedRemoved: R4(accumRemoved),
          proceeds: R4(proceeds),
          gainLoss: R4(gainLoss),
          gainAccountId: input.gainAccountId,
          lossAccountId: input.lossAccountId,
          proceedsAccountId: input.proceedsAccountId ?? null,
          cashLocationId: input.cashLocationId ?? null,
          reason: input.reason ?? null,
          createdBy: tryGetAuthContext()?.userId ?? null,
        })
        .returning();

      // فرع السند: من الأصل أو من الطلب أو أول فرع في المستأجر (احتياط).
      let branchId = asset.asset.branchId ?? input.branchId ?? null;
      if (!branchId) {
        const firstBranch = await tx
          .select({ id: branches.id })
          .from(branches)
          .where(eq(branches.tenantId, tenantId))
          .orderBy(asc(branches.id))
          .limit(1);
        branchId = firstBranch[0]?.id ?? null;
      }

      return {
        disposal: inserted[0]!,
        asset: asset.asset,
        category: asset.category,
        costDisposed: R4(costDisposed),
        accumulatedRemoved: R4(accumRemoved),
        proceeds: R4(proceeds),
        gainLoss: R4(gainLoss),
        branchId,
      };
    });

    const disposalId = phase1.disposal.id;
    let voucherId: string | null = null;

    // ===== (2) سند القبض (بيع فقط) =====
    if (input.kind === 'sale') {
      const voucher = await this.treasury.createVoucher(tenantId, {
        branchId: String(phase1.branchId),
        kind: 'receipt',
        subtype: 'account',
        date: input.date,
        counterAccountId: String(input.proceedsAccountId),
        cashLocationId: String(input.cashLocationId),
        method: 'cash',
        amount: phase1.proceeds,
        description: `عائد بيع أصل ${phase1.asset.code} ${phase1.asset.name}`,
      });
      const newVoucherId = String(voucher?.id ?? '');
      if (!newVoucherId) {
        throw new DomainError('DISPOSAL_VOUCHER_FAILED', 'تعذّر إنشاء سند القبض', 500, { assetId });
      }
      await this.treasury.postVoucher(tenantId, newVoucherId);
      voucherId = newVoucherId;
    }

    // ===== (3) قيد التحرّك =====
    const costD = new Decimal(phase1.costDisposed);
    const accumD = new Decimal(phase1.accumulatedRemoved);
    const proceedsD = new Decimal(phase1.proceeds);
    const nbvD = costD.minus(accumD);
    const gainD = Decimal.max(proceedsD.minus(nbvD), 0);
    const lossD = Decimal.max(nbvD.minus(proceedsD), 0);

    const journalLines: JournalLineInput[] = [];
    if (proceedsD.gt(0)) journalLines.push({ accountId: String(input.proceedsAccountId), debit: R4(proceedsD) });
    if (accumD.gt(0)) journalLines.push({ accountId: phase1.category.accumulatedDepreciationAccountId, debit: R4(accumD) });
    if (lossD.gt(0)) journalLines.push({ accountId: input.lossAccountId, debit: R4(lossD) });
    journalLines.push({ accountId: phase1.category.assetAccountId, credit: R4(costD) });
    if (gainD.gt(0)) journalLines.push({ accountId: input.gainAccountId, credit: R4(gainD) });

    const debits = journalLines.reduce((sum, line) => sum.plus(new Decimal(line.debit ?? '0')), new Decimal(0));
    const credits = journalLines.reduce((sum, line) => sum.plus(new Decimal(line.credit ?? '0')), new Decimal(0));
    if (!debits.eq(credits)) {
      throw new DomainError('DISPOSAL_INTERNAL_IMBALANCE', 'قيد الاستبعاد غير متوازن — راجع الحسابات', 500, {
        debits: R4(debits),
        credits: R4(credits),
      });
    }

    const entry = (await this.accounting.postJournal(tenantId, {
      date: input.date,
      description:
        input.kind === 'sale'
          ? `بيع أصل ${phase1.asset.code} — ${phase1.asset.name}`
          : `تخفيض/سحب أصل ${phase1.asset.code} — ${phase1.asset.name}`,
      lines: journalLines,
      sourceType: 'fixed_asset_disposal',
      sourceId: disposalId,
      idempotencyKey: `disposal-journal:${disposalId}`,
    })) as { id?: string };
    const journalEntryId = String(entry.id ?? '');

    // ===== (4) تحديث الأصل والربط =====
    await withTenantTx(this.database.db, tenantId, async (tx) => {
      const isFull = new Decimal(phase1.costDisposed).gte(new Decimal(phase1.asset.cost));
      if (isFull) {
        await tx
          .update(fixedAssets)
          .set({ status: 'disposed', disposalDate: input.date, updatedAt: new Date() })
          .where(eq(fixedAssets.id, assetId));
      } else {
        await tx
          .update(fixedAssets)
          .set({
            cost: R4(new Decimal(phase1.asset.cost).minus(new Decimal(phase1.costDisposed))),
            updatedAt: new Date(),
          })
          .where(eq(fixedAssets.id, assetId));
      }
      await tx
        .update(assetDisposals)
        .set({ voucherId, journalEntryId, updatedAt: new Date() })
        .where(eq(assetDisposals.id, disposalId));
    });

    return {
      id: disposalId,
      assetId,
      date: input.date,
      kind: input.kind,
      costDisposed: phase1.costDisposed,
      accumulatedRemoved: phase1.accumulatedRemoved,
      proceeds: phase1.proceeds,
      gainLoss: phase1.gainLoss,
      voucherId,
      journalEntryId,
      assetStatus: new Decimal(phase1.costDisposed).gte(new Decimal(phase1.asset.cost)) ? 'disposed' : 'active',
    };
  }

  async listDisposals(tenantId: string, assetId: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) =>
      tx
        .select()
        .from(assetDisposals)
        .where(and(eq(assetDisposals.tenantId, tenantId), eq(assetDisposals.assetId, assetId)))
        .orderBy(asc(assetDisposals.date)),
    );
  }
}
