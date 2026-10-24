import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '@erp/contracts';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Decimal } from 'decimal.js';

import {
  assetCategories,
  assetDepreciationLines,
  assetDepreciationRuns,
  assetDisposals,
  accounts,
  fixedAssets,
  fiscalPeriods,
  journalEntries,
  purchaseInvoices,
  withTenantTx,
  type DatabaseHandle,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { isUniqueViolation } from '../organization/shared/org-support.js';
import { tryGetAuthContext } from '../platform/context/tenant-context.js';

import { AccountingService, type JournalLineInput } from './accounting.service.js';
import { computeDepreciation, type DepreciationMethod } from './depreciation-math.js';

/**
 * MF-21 — سجل الأصول الثابتة والتشغيلات الشهرية (دفقة D8).
 *
 * الترحيل يمرّ عبر `postJournal` بمفتاح idempotency فريد لكل فترة
 * (`depreciation:<مستأجر>:<yyyy-mm>`) ⇐ يرث `FISCAL_PERIOD_CLOSED` والحرّاسة
 * ضد التكرار من الفهرس الفريد `(tenant, period)` — «لا تشغيل مزدوج للشهر نفسه»
 * مفروض في القاعدة وفي الخدمة معاً. **فحص الفترة المغلقة عند الإنشاء نفسه**
 * صريح (لا حتى معاينة لفترة مغلقة) ومعاينة لا تكتب قيداً إطلاقاً.
 *
 * المجمع لكل أصل يُشتق من أسطر التشغيلات المرحَّلة ناقص الاستبعادات —
 * مرجع واحد لا يتكرر، ومطابقة السجل مع الحسابات تُتحقّق في r42 حيّاً.
 */
export type AssetCategoryInput = {
  code: string;
  nameAr: string;
  nameEn?: string;
  method: DepreciationMethod;
  usefulLifeMonths: number;
  residualValue?: string;
  decliningRatePercent?: string;
  totalUnits?: string;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  depreciationExpenseAccountId: string;
};

export type FixedAssetInput = {
  code: string;
  name: string;
  categoryId: string;
  cost?: string;
  inServiceDate: string;
  residualValue?: string;
  method?: DepreciationMethod;
  usefulLifeMonths?: number;
  decliningRatePercent?: string;
  totalUnits?: string;
  branchId?: string;
  costCenterId?: string;
  custodianId?: string;
  sourceType?: 'manual' | 'journal' | 'purchase_invoice';
  sourceId?: string;
  /** إن وُجد: قيد انقلال (مدين حساب الأصل / دائن الحساب المصدر) بمبلغ التكلفة. */
  reclassifyFromAccountId?: string;
};

export type DepreciationRunInput = { period?: string; unitsByAsset?: Record<string, string> };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const METHODS: DepreciationMethod[] = ['straight_line', 'declining', 'units_of_production'];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function lastDayOf(periodYear: number, periodMonth1: number): string {
  const day = new Date(Date.UTC(periodYear, periodMonth1, 0)).getUTCDate();
  return `${periodYear}-${pad2(periodMonth1)}-${pad2(day)}`;
}

@Injectable()
export class FixedAssetsService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly accounting: AccountingService,
  ) {}

  // ========================== الفئات ==========================

  async createCategory(tenantId: string, input: AssetCategoryInput) {
    if (!METHODS.includes(input.method)) {
      throw new DomainError('ASSET_CATEGORY_INPUT_INVALID', 'method غير معروف', 422, { field: 'method' });
    }
    const life = Number(input.usefulLifeMonths);
    if (!Number.isInteger(life) || life < 1) {
      throw new DomainError('ASSET_CATEGORY_INPUT_INVALID', 'usefulLifeMonths يجب أن يكون عدداً موجباً', 422, {
        field: 'usefulLifeMonths',
      });
    }
    const triple = [input.assetAccountId, input.accumulatedDepreciationAccountId, input.depreciationExpenseAccountId];
    if (triple.some((id) => !id) || new Set(triple).size !== 3) {
      throw new DomainError('ASSET_CATEGORY_INPUT_INVALID', 'حسابات الفئة الثلاثة مطلوبة ومختلفة', 422, {
        field: 'accounts',
      });
    }
    if (input.method === 'units_of_production' && !(Number(input.totalUnits ?? 0) > 0)) {
      throw new DomainError('ASSET_CATEGORY_INPUT_INVALID', 'طريق وحدات الإنتاج يتطلب totalUnits > 0', 422, {
        field: 'totalUnits',
      });
    }

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const found = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), inArray(accounts.id, triple)));
      if (found.length !== 3) {
        throw new DomainError('ASSET_CATEGORY_ACCOUNT_NOT_FOUND', 'أحد حسابات الفئة غير موجود في المستأجر', 422);
      }
      try {
        const inserted = await tx
          .insert(assetCategories)
          .values({
            tenantId,
            code: input.code,
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
            method: input.method,
            usefulLifeMonths: life,
            residualValue: new Decimal(input.residualValue ?? '0').toFixed(4),
            decliningRatePercent: new Decimal(input.decliningRatePercent ?? '0').toFixed(4),
            totalUnits: input.totalUnits ? new Decimal(input.totalUnits).toFixed(4) : null,
            assetAccountId: input.assetAccountId,
            accumulatedDepreciationAccountId: input.accumulatedDepreciationAccountId,
            depreciationExpenseAccountId: input.depreciationExpenseAccountId,
          })
          .returning();
        return inserted[0]!;
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DomainError('ASSET_CATEGORY_CODE_EXISTS', 'رمز فئة الأصول مستخدم في المستأجر', 409, {
            code: input.code,
          });
        }
        throw error;
      }
    });
  }

  async listCategories(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) =>
      tx.select().from(assetCategories).where(eq(assetCategories.tenantId, tenantId)).orderBy(asc(assetCategories.code)),
    );
  }

  // ========================== الأصول ==========================

  async createAsset(tenantId: string, input: FixedAssetInput) {
    if (!input.code || !input.name || !input.categoryId) {
      throw new DomainError('FIXED_ASSET_INPUT_INVALID', 'code وname وcategoryId مطلوبة', 422);
    }
    if (!input.inServiceDate || !DATE_RE.test(input.inServiceDate)) {
      throw new DomainError('FIXED_ASSET_INPUT_INVALID', 'inServiceDate يجب أن يكون YYYY-MM-DD', 422, {
        field: 'inServiceDate',
      });
    }
    const sourceType = input.sourceType ?? 'manual';
    if (!['manual', 'journal', 'purchase_invoice'].includes(sourceType)) {
      throw new DomainError('FIXED_ASSET_INPUT_INVALID', 'sourceType غير معروف', 422, { field: 'sourceType' });
    }

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const category = (
        await tx
          .select()
          .from(assetCategories)
          .where(and(eq(assetCategories.tenantId, tenantId), eq(assetCategories.id, input.categoryId)))
          .limit(1)
      )[0];
      if (!category) {
        throw new DomainError('FIXED_ASSET_CATEGORY_NOT_FOUND', 'فئة الأصل غير موجودة', 422, {
          categoryId: input.categoryId,
        });
      }

      // التكلفة: الفاتورة مصدرها إجماليها (أو تكلفة صريحة)، واليدوي/القيد يتطلبان تكلفة.
      let cost: Decimal;
      if (sourceType === 'purchase_invoice') {
        if (!input.sourceId) {
          throw new DomainError('FIXED_ASSET_SOURCE_REQUIRED', 'sourceId مطلوب لرسملة فاتورة شراء', 422, {
            field: 'sourceId',
          });
        }
        const invoice = (
          await tx
            .select({ total: purchaseInvoices.total })
            .from(purchaseInvoices)
            .where(and(eq(purchaseInvoices.tenantId, tenantId), eq(purchaseInvoices.id, input.sourceId)))
            .limit(1)
        )[0];
        if (!invoice) {
          throw new DomainError('FIXED_ASSET_SOURCE_NOT_FOUND', 'فاتورة الشراء غير موجودة', 422, {
            sourceId: input.sourceId,
          });
        }
        cost = new Decimal(input.cost ?? invoice.total ?? '0');
      } else {
        cost = new Decimal(input.cost ?? '0');
      }
      if (!cost.isFinite() || cost.lte(0)) {
        throw new DomainError('FIXED_ASSET_COST_INVALID', 'تكلفة الأصل يجب أن تكون أكبر من صفر', 422, {
          field: 'cost',
        });
      }

      const method = (input.method ?? category.method) as DepreciationMethod;
      if (!METHODS.includes(method)) {
        throw new DomainError('FIXED_ASSET_INPUT_INVALID', 'method غير معروف', 422, { field: 'method' });
      }
      const life = Number(input.usefulLifeMonths ?? category.usefulLifeMonths);
      if (!Number.isInteger(life) || life < 1) {
        throw new DomainError('FIXED_ASSET_INPUT_INVALID', 'usefulLifeMonths يجب أن يكون عدداً موجباً', 422, {
          field: 'usefulLifeMonths',
        });
      }
      const totalUnits = input.totalUnits ?? category.totalUnits;
      if (method === 'units_of_production' && !(Number(totalUnits ?? 0) > 0)) {
        throw new DomainError('FIXED_ASSET_INPUT_INVALID', 'طريق وحدات الإنتاج يتطلب totalUnits > 0', 422, {
          field: 'totalUnits',
        });
      }

      // الانقلال قبل الإدراج: المفتاح حتمي بالمصدر/الرمز ⇐ تكرار المحاولة
      // يجد القيد المنشور فلا يُنشئ قيداً ثانياً، ثم يُرفض الإدراج بالفهرس الفريد.
      let reclassEntryId: string | null = null;
      if (input.reclassifyFromAccountId) {
        if (input.reclassifyFromAccountId === category.assetAccountId) {
          throw new DomainError(
            'FIXED_ASSET_INPUT_INVALID',
            'حساب الانقلال يجب أن يختلف عن حساب الأصل',
            422,
            { field: 'reclassifyFromAccountId' },
          );
        }
        const sourceAccount = (
          await tx
            .select({ id: accounts.id })
            .from(accounts)
            .where(and(eq(accounts.tenantId, tenantId), eq(accounts.id, input.reclassifyFromAccountId)))
            .limit(1)
        )[0];
        if (!sourceAccount) {
          throw new DomainError('FIXED_ASSET_ACCOUNT_NOT_FOUND', 'حساب الانقلال غير موجود', 422);
        }
        const idempotencyKey =
          sourceType === 'purchase_invoice' && input.sourceId
            ? `capitalization:${tenantId}:purchase_invoice:${input.sourceId}`
            : `capitalization:${tenantId}:asset:${input.code}`;
        const existing = await tx
          .select({ id: journalEntries.id })
          .from(journalEntries)
          .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.idempotencyKey, idempotencyKey)))
          .limit(1);
        if (existing.length === 0) {
          const entry = (await this.accounting.postJournal(tenantId, {
            date: input.inServiceDate,
            description: `رسملة ${sourceType === 'purchase_invoice' ? 'فاتورة شراء' : 'قيد'} — ${input.code} ${input.name}`,
            lines: [
              { accountId: category.assetAccountId, debit: cost.toFixed(4) },
              { accountId: input.reclassifyFromAccountId, credit: cost.toFixed(4) },
            ],
            sourceType: 'fixed_asset',
            idempotencyKey,
          })) as { id?: string };
          reclassEntryId = String(entry.id ?? '') || null;
        } else {
          reclassEntryId = existing[0]!.id;
        }
      }

      try {
        const inserted = await tx
          .insert(fixedAssets)
          .values({
            tenantId,
            branchId: input.branchId ?? null,
            categoryId: category.id,
            code: input.code,
            name: input.name,
            cost: cost.toFixed(4),
            residualValue: new Decimal(input.residualValue ?? category.residualValue ?? '0').toFixed(4),
            method,
            usefulLifeMonths: life,
            decliningRatePercent: new Decimal(
              input.decliningRatePercent ?? category.decliningRatePercent ?? '0',
            ).toFixed(4),
            totalUnits: totalUnits ? new Decimal(totalUnits).toFixed(4) : null,
            inServiceDate: input.inServiceDate,
            costCenterId: input.costCenterId ?? null,
            custodianId: input.custodianId ?? null,
            sourceType,
            sourceId: input.sourceId ?? null,
          })
          .returning();
        return { ...inserted[0]!, capitalizationEntryId: reclassEntryId };
      } catch (error) {
        if (isUniqueViolation(error)) {
          const message = error instanceof Error ? error.message : String(error);
          if (message.includes('fixed_assets_tenant_source_key')) {
            throw new DomainError('FIXED_ASSET_SOURCE_EXISTS', 'هذا المصدر رُمَّل سلفاً', 409, {
              sourceType,
              sourceId: input.sourceId,
            });
          }
          throw new DomainError('FIXED_ASSET_CODE_EXISTS', 'رمز الأصل مستخدم في المستأجر', 409, {
            code: input.code,
          });
        }
        throw error;
      }
    });
  }

  /** قائمة الأصول بأرصدة مشتقة: مُهلك = مجموع تشغيلات المُرحَّل − مُرفوع في الاستبعادات. */
  async listAssets(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const assets = await tx
        .select({
          asset: fixedAssets,
          categoryName: assetCategories.nameAr,
          categoryCode: assetCategories.code,
        })
        .from(fixedAssets)
        .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
        .where(eq(fixedAssets.tenantId, tenantId))
        .orderBy(asc(fixedAssets.code));

      const depRows = await tx
        .select({
          assetId: assetDepreciationLines.assetId,
          total: sql<string>`COALESCE(SUM(${assetDepreciationLines.amount}), 0)::text`,
        })
        .from(assetDepreciationLines)
        .innerJoin(assetDepreciationRuns, eq(assetDepreciationRuns.id, assetDepreciationLines.runId))
        .where(and(eq(assetDepreciationRuns.tenantId, tenantId), eq(assetDepreciationRuns.status, 'posted')))
        .groupBy(assetDepreciationLines.assetId);
      const depByAsset = new Map(depRows.map((row) => [row.assetId, Number(row.total)]));

      const dispRows = await tx
        .select({
          assetId: assetDisposals.assetId,
          accum: sql<string>`COALESCE(SUM(${assetDisposals.accumulatedRemoved}), 0)::text`,
        })
        .from(assetDisposals)
        .where(eq(assetDisposals.tenantId, tenantId))
        .groupBy(assetDisposals.assetId);
      const dispByAsset = new Map(dispRows.map((row) => [row.assetId, Number(row.accum)]));

      return assets.map(({ asset, categoryName, categoryCode }) => {
        const accumulated = (depByAsset.get(asset.id) ?? 0) - (dispByAsset.get(asset.id) ?? 0);
        const cost = Number(asset.cost);
        const bookValue = asset.status === 'disposed' ? 0 : cost - accumulated;
        return {
          ...asset,
          categoryName,
          categoryCode,
          accumulated: new Decimal(accumulated).toFixed(4),
          bookValue: new Decimal(bookValue).toFixed(4),
        };
      });
    });
  }

  // ========================== تشغيلات الإهلاك ==========================

  async createRun(tenantId: string, input: DepreciationRunInput) {
    const period = String(input.period ?? '');
    if (!PERIOD_RE.test(period)) {
      throw new DomainError('DEPRECIATION_PERIOD_INVALID', 'period يجب أن يكون YYYY-MM', 422, { field: 'period' });
    }
    const [pYear, pMonth] = [Number(period.slice(0, 4)), Number(period.slice(5, 7))];
    const periodDate = `${period}-01`;
    const lastDay = lastDayOf(pYear, pMonth);
    const unitsByAsset = input.unitsByAsset ?? {};

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      // «لا إهلاك في فترة مقفلة» — يُمنع عند المدخل نفسه (حتى المعاينة).
      const closed = await tx
        .select({ id: fiscalPeriods.id })
        .from(fiscalPeriods)
        .where(
          and(
            eq(fiscalPeriods.tenantId, tenantId),
            eq(fiscalPeriods.status, 'closed'),
            sql`${fiscalPeriods.startDate} <= ${lastDay}`,
            sql`${fiscalPeriods.endDate} >= ${lastDay}`,
          ),
        )
        .limit(1);
      if (closed.length > 0) {
        throw new DomainError('FISCAL_PERIOD_CLOSED', 'لا يمكن إنشاء تشغيل إهلاك لفترة مغلقة', 409, { period });
      }

      // وجود التشغيل قبل الأهلية: فترة منشورة سابقاً تُردّ RUN_EXISTS بغضّ
      // النظر عن بقاء أصولها المؤهلة (أدقّ من NO_ASSETS) — فهرس (tenant, period)
      // يبقى الحرس الأخير ضد سباق الإنشاء.
      const existingRun = await tx
        .select({ id: assetDepreciationRuns.id })
        .from(assetDepreciationRuns)
        .where(and(eq(assetDepreciationRuns.tenantId, tenantId), eq(assetDepreciationRuns.period, periodDate)))
        .limit(1);
      if (existingRun.length > 0) {
        throw new DomainError('DEPRECIATION_PERIOD_RUN_EXISTS', 'تشغيل لهذه الفترة موجود سلفاً (معاينة أو مرحَّل)', 409, {
          period,
        });
      }

      const assets = await tx
        .select({ asset: fixedAssets, category: assetCategories })
        .from(fixedAssets)
        .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
        .where(and(eq(fixedAssets.tenantId, tenantId), eq(fixedAssets.status, 'active')));

      // الأهلية: الأصل المُشغَّل قبل الشهر الفارق (شهر التشغيل نفسه لا يُهلك —
      // «يبدأ من الشهر التالي لتشغيله») وشهر الفترة بعده تماماً.
      const eligible = assets.filter(({ asset }) => asset.inServiceDate.slice(0, 7) < period);
      if (eligible.length === 0) {
        throw new DomainError('DEPRECIATION_NO_ASSETS', 'لا أصول مؤهلة لهذه الفترة', 422, { period });
      }

      // وحدات الإنتاج: مدخلات الفترة إلزامية — لا نصف تشغيل ولا صفر صامت.
      const missingUnits = eligible
        .filter(({ asset }) => asset.method === 'units_of_production' && !unitsByAsset[asset.id])
        .map(({ asset }) => ({ id: asset.id, code: asset.code }));
      if (missingUnits.length > 0) {
        throw new DomainError('DEPRECIATION_UNITS_REQUIRED', 'وحدات الفترة مطلوبة لأصول وحدات الإنتاج', 422, {
          period,
          assets: missingUnits,
        });
      }

      const depRows = await tx
        .select({
          assetId: assetDepreciationLines.assetId,
          total: sql<string>`COALESCE(SUM(${assetDepreciationLines.amount}), 0)::text`,
        })
        .from(assetDepreciationLines)
        .innerJoin(assetDepreciationRuns, eq(assetDepreciationRuns.id, assetDepreciationLines.runId))
        .where(and(eq(assetDepreciationRuns.tenantId, tenantId), eq(assetDepreciationRuns.status, 'posted')))
        .groupBy(assetDepreciationLines.assetId);
      const depByAsset = new Map(depRows.map((row) => [row.assetId, Number(row.total)]));

      const dispRows = await tx
        .select({
          assetId: assetDisposals.assetId,
          accum: sql<string>`COALESCE(SUM(${assetDisposals.accumulatedRemoved}), 0)::text`,
        })
        .from(assetDisposals)
        .where(eq(assetDisposals.tenantId, tenantId))
        .groupBy(assetDisposals.assetId);
      const dispByAsset = new Map(dispRows.map((row) => [row.assetId, Number(row.accum)]));

      const lineInputs: Array<{ assetId: string; amount: number; accumulatedAfter: number; bookValueAfter: number }> = [];
      for (const { asset, category } of eligible) {
        const accumulated = (depByAsset.get(asset.id) ?? 0) - (dispByAsset.get(asset.id) ?? 0);
        const amount = computeDepreciation({
          method: asset.method as DepreciationMethod,
          cost: asset.cost,
          residualValue: asset.residualValue,
          usefulLifeMonths: asset.usefulLifeMonths,
          accumulated: String(accumulated),
          decliningRatePercent: asset.decliningRatePercent ?? category.decliningRatePercent,
          totalUnits: asset.totalUnits ?? category.totalUnits,
          periodUnits: unitsByAsset[asset.id],
        });
        if (!(amount > 0.005)) continue;
        const accumulatedAfter = accumulated + amount;
        lineInputs.push({
          assetId: asset.id,
          amount,
          accumulatedAfter,
          bookValueAfter: Number(asset.cost) - accumulatedAfter,
        });
      }
      if (lineInputs.length === 0) {
        throw new DomainError('DEPRECIATION_NOTHING_TO_RUN', 'لا مبلغ إهلاك لهذه الفترة (كل الأصول مستهلكة)', 422, {
          period,
        });
      }

      const totalAmount = lineInputs.reduce((sum, line) => sum + line.amount, 0);
      try {
        const run = (
          await tx
            .insert(assetDepreciationRuns)
            .values({
              tenantId,
              branchId: null,
              period: periodDate,
              status: 'preview',
              totalAmount: new Decimal(totalAmount).toFixed(4),
              createdBy: tryGetAuthContext()?.userId ?? null,
            })
            .returning()
        )[0]!;
        const lines = await tx.insert(assetDepreciationLines).values(
          lineInputs.map((line) => ({
            runId: run.id,
            assetId: line.assetId,
            amount: new Decimal(line.amount).toFixed(4),
            accumulatedAfter: new Decimal(line.accumulatedAfter).toFixed(4),
            bookValueAfter: new Decimal(line.bookValueAfter).toFixed(4),
          })),
        ).returning();
        return { ...run, lines };
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new DomainError('DEPRECIATION_PERIOD_RUN_EXISTS', 'تشغيل لهذه الفترة موجود سلفاً (معاينة أو مرحَّل)', 409, {
            period,
          });
        }
        throw error;
      }
    });
  }

  async listRuns(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) =>
      tx
        .select()
        .from(assetDepreciationRuns)
        .where(eq(assetDepreciationRuns.tenantId, tenantId))
        .orderBy(desc(assetDepreciationRuns.period)),
    );
  }

  async getRun(tenantId: string, runId: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const run = (
        await tx
          .select()
          .from(assetDepreciationRuns)
          .where(and(eq(assetDepreciationRuns.tenantId, tenantId), eq(assetDepreciationRuns.id, runId)))
          .limit(1)
      )[0];
      if (!run) {
        throw new DomainError('DEPRECIATION_RUN_NOT_FOUND', 'تشغيل الإهلاك غير موجود', 404, { runId });
      }
      const lines = await tx
        .select({
          line: assetDepreciationLines,
          assetCode: fixedAssets.code,
          assetName: fixedAssets.name,
        })
        .from(assetDepreciationLines)
        .innerJoin(fixedAssets, eq(fixedAssets.id, assetDepreciationLines.assetId))
        .where(eq(assetDepreciationLines.runId, runId))
        .orderBy(asc(fixedAssets.code));
      return { ...run, lines: lines.map(({ line, assetCode, assetName }) => ({ ...line, assetCode, assetName })) };
    });
  }

  async postRun(tenantId: string, runId: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const run = (
        await tx
          .select()
          .from(assetDepreciationRuns)
          .where(and(eq(assetDepreciationRuns.tenantId, tenantId), eq(assetDepreciationRuns.id, runId)))
          .limit(1)
      )[0];
      if (!run) {
        throw new DomainError('DEPRECIATION_RUN_NOT_FOUND', 'تشغيل الإهلاك غير موجود', 404, { runId });
      }
      if (run.status === 'posted') {
        throw new DomainError('DEPRECIATION_RUN_ALREADY_POSTED', 'التشغيل مرحَّل سلفاً', 409, { runId });
      }

      const periodStr = run.period.slice(0, 7);
      const idempotencyKey = `depreciation:${tenantId}:${periodStr}`;

      // إصلاح ذاتي بعد انقطاع: القيد منشور والتشغيل لم يُحدَّث — نُكمل التحديث لا نُكرر القيد.
      const existing = await tx
        .select({ id: journalEntries.id })
        .from(journalEntries)
        .where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.idempotencyKey, idempotencyKey)))
        .limit(1);

      let journalEntryId = existing[0]?.id ?? '';
      if (existing.length === 0) {
        const lineRows = await tx
          .select({
            amount: assetDepreciationLines.amount,
            expenseAccountId: assetCategories.depreciationExpenseAccountId,
            accumAccountId: assetCategories.accumulatedDepreciationAccountId,
          })
          .from(assetDepreciationLines)
          .innerJoin(fixedAssets, eq(fixedAssets.id, assetDepreciationLines.assetId))
          .innerJoin(assetCategories, eq(assetCategories.id, fixedAssets.categoryId))
          .where(eq(assetDepreciationLines.runId, runId));
        if (lineRows.length === 0) {
          throw new DomainError('DEPRECIATION_NOTHING_TO_RUN', 'لا أسطر في التشغيل', 422, { runId });
        }
        const pairs = new Map<string, { expense: string; accum: string; total: Decimal }>();
        for (const row of lineRows) {
          const key = `${row.expenseAccountId}|${row.accumAccountId}`;
          const current = pairs.get(key);
          if (current) {
            current.total = current.total.plus(new Decimal(row.amount));
          } else {
            pairs.set(key, {
              expense: row.expenseAccountId,
              accum: row.accumAccountId,
              total: new Decimal(row.amount),
            });
          }
        }
        const lines: JournalLineInput[] = [];
        for (const pair of pairs.values()) {
          lines.push({ accountId: pair.expense, debit: pair.total.toFixed(4) });
          lines.push({ accountId: pair.accum, credit: pair.total.toFixed(4) });
        }
        const [pYear, pMonth] = [Number(periodStr.slice(0, 4)), Number(periodStr.slice(5, 7))];
        const entry = (await this.accounting.postJournal(tenantId, {
          date: lastDayOf(pYear, pMonth),
          description: `تشغيل إهلاك ${periodStr} — ${lineRows.length} أصل`,
          lines,
          sourceType: 'depreciation_run',
          sourceId: runId,
          idempotencyKey,
        })) as { id?: string };
        journalEntryId = String(entry.id ?? '') || '';
      }

      const [updated] = await tx
        .update(assetDepreciationRuns)
        .set({
          status: 'posted',
          journalEntryId: journalEntryId || null,
          postedAt: new Date(),
          postedBy: tryGetAuthContext()?.userId ?? null,
          updatedAt: new Date(),
        })
        .where(eq(assetDepreciationRuns.id, runId))
        .returning();
      return { ...updated, journalEntryId };
    });
  }

  // ========================== التقارير ==========================

  async registerStatement(tenantId: string) {
    const rows = await this.listAssets(tenantId);
    const active = rows.filter((row) => row.status === 'active');
    const totals = active.reduce(
      (acc, row) => ({
        cost: acc.cost.plus(new Decimal(row.cost)),
        accumulated: acc.accumulated.plus(new Decimal(row.accumulated)),
        bookValue: acc.bookValue.plus(new Decimal(row.bookValue)),
      }),
      { cost: new Decimal(0), accumulated: new Decimal(0), bookValue: new Decimal(0) },
    );
    return {
      data: rows,
      totals: {
        cost: totals.cost.toFixed(4),
        accumulated: totals.accumulated.toFixed(4),
        bookValue: totals.bookValue.toFixed(4),
      },
    };
  }

  async movementStatement(tenantId: string, from?: string, to?: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const conditions = [
        eq(assetDepreciationRuns.tenantId, tenantId),
        eq(assetDepreciationRuns.status, 'posted'),
      ];
      if (from) conditions.push(sql`${assetDepreciationRuns.period} >= ${from}`);
      if (to) conditions.push(sql`${assetDepreciationRuns.period} <= ${to}`);
      const rows = await tx
        .select({
          runId: assetDepreciationRuns.id,
          period: assetDepreciationRuns.period,
          assetId: fixedAssets.id,
          assetCode: fixedAssets.code,
          assetName: fixedAssets.name,
          amount: assetDepreciationLines.amount,
          accumulatedAfter: assetDepreciationLines.accumulatedAfter,
          bookValueAfter: assetDepreciationLines.bookValueAfter,
        })
        .from(assetDepreciationLines)
        .innerJoin(assetDepreciationRuns, eq(assetDepreciationRuns.id, assetDepreciationLines.runId))
        .innerJoin(fixedAssets, eq(fixedAssets.id, assetDepreciationLines.assetId))
        .where(and(...conditions))
        .orderBy(asc(assetDepreciationRuns.period), asc(fixedAssets.code));
      const total = rows.reduce((sum, row) => sum + Number(row.amount), 0);
      return { data: rows, totals: { amount: new Decimal(total).toFixed(4), count: rows.length } };
    });
  }
}
