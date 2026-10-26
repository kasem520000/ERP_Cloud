import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, lte, gte, sql } from 'drizzle-orm';
import { tenantSettingsRegistry } from '@erp/config';
import {
  accounts,
  branches,
  branchPostingProfiles,
  cashLocationBalances,
  cashLocations,
  currencies,
  DEMO_CHART_OF_ACCOUNTS,
  DEMO_POSTING_PROFILE,
  fiscalPeriods,
  fiscalYears,
  itemCategories,
  newId,
  parties,
  paymentMethods,
  priceLists,
  salaryAdjustmentTypes,
  tailoringGarmentTypes,
  tailoringMeasurementAttributes,
  tailoringOrderStatuses,
  taxGroups,
  tenants,
  unitsOfMeasure,
  warehouses,
  withTenantTx,
  type DatabaseHandle,
  type DrizzleTx,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../../database/database.module.js';

/**
 * `provisionOrgDefaults(tenantId)` — PHASE_05 §5.7.
 *
 * A tenant that exists but has no branch cannot be used: documents cannot be numbered
 * (`document_sequences` is scoped by branch), stock has nowhere to live and money has
 * nowhere to sit. This service creates that minimum — base currency, main branch, main
 * warehouse, main safe with a zero balance, default price list — and is the seam the
 * PHASE_03 tenant factory and the PHASE_15 migrator both call.
 *
 * It is **idempotent**: every step is skipped when its row already exists, so calling it
 * twice (a retried provisioning job, a re-run import) is safe and returns the same ids.
 * It deliberately writes through the tables rather than through the CRUD services: it
 * runs outside any HTTP request, so there is no branch scope, no actor and no audit
 * interceptor to satisfy.
 */

export type OrgDefaults = {
  tenantId: string;
  branchId: string;
  warehouseId: string;
  cashLocationId: string;
  priceListId: string;
  currencyCode: string;
  /** False when everything already existed — the call was a no-op. */
  created: boolean;
};

export type ProvisionOptions = {
  actorUserId?: string | null;
  /** Defaults to `MAIN`; the migrator overrides it to match the legacy code. */
  code?: string;
  nameAr?: string;
  nameEn?: string;
  warehouseName?: string;
  /**
   * When true (new customer/tenant account creation via Platform Console, Self-Signup,
   * Lead Conversion, or Company File creation), also seeds the starter Fiscal Year & 12
   * monthly periods, single `مجموعة عامة` category, `15%` + `0%` tax groups, basic
   * measurement units, baseline payment methods, and default tenant settings so the
   * tenant can transact immediately on first login.
   */
  seedStarterData?: boolean;
};

const DEFAULT_CODE = 'MAIN';

@Injectable()
export class OrgProvisioningService {
  private readonly logger = new Logger(OrgProvisioningService.name);

  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle) {}

  async provisionOrgDefaults(tenantId: string, options: ProvisionOptions = {}): Promise<OrgDefaults> {
    return withTenantTx(this.database.db, tenantId, (tx) => this.provisionInTx(tx, tenantId, options));
  }

  /** Same work inside a caller's transaction — the tenant factory creates both at once. */
  async provisionInTx(tx: DrizzleTx, tenantId: string, options: ProvisionOptions = {}): Promise<OrgDefaults> {
    const actorUserId = options.actorUserId ?? null;
    const now = new Date();
    const code = (options.code ?? DEFAULT_CODE).toUpperCase();
    const nameAr = options.nameAr ?? 'الفرع الرئيسي';
    const nameEn = options.nameEn ?? 'Main branch';
    let created = false;

    const currencyCode = await this.ensureBaseCurrency(tx, tenantId, actorUserId, now);
    const mainCashAccountId = await this.ensureChartOfAccounts(tx, tenantId, actorUserId, now);
    if (mainCashAccountId) created = true;
    if (await this.ensurePostingProfile(tx, tenantId, actorUserId, now)) created = true;
    if (await this.ensureSalaryAdjustmentTypes(tx, tenantId, actorUserId, now)) created = true;
    if (await this.ensureTailoringOrderStatuses(tx, tenantId, actorUserId, now)) created = true;
    if (await this.ensureTailoringGarmentTypes(tx, tenantId, actorUserId, now)) created = true;
    if (await this.ensureMeasurementAttributes(tx, tenantId, actorUserId, now)) created = true;

    let branchId = await firstId(
      tx
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.tenantId, tenantId), eq(branches.isDefault, true), isNull(branches.deletedAt)))
        .limit(1),
    );
    if (!branchId) {
      branchId = newId();
      await tx.insert(branches).values({
        id: branchId,
        tenantId,
        code,
        nameAr,
        nameEn,
        isDefault: true,
        isActive: true,
        createdAt: now,
        createdBy: actorUserId,
      });
      created = true;
    }

    let warehouseId = await firstId(
      tx
        .select({ id: warehouses.id })
        .from(warehouses)
        .where(
          and(
            eq(warehouses.tenantId, tenantId),
            eq(warehouses.isDefault, true),
            isNull(warehouses.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!warehouseId) {
      warehouseId = newId();
      await tx.insert(warehouses).values({
        id: warehouseId,
        tenantId,
        branchId,
        code,
        name: options.warehouseName ?? 'المستودع الرئيسي',
        isDefault: true,
        isActive: true,
        createdAt: now,
        createdBy: actorUserId,
      });
      created = true;
    }

    let cashLocationId = await firstId(
      tx
        .select({ id: cashLocations.id })
        .from(cashLocations)
        .where(
          and(
            eq(cashLocations.tenantId, tenantId),
            eq(cashLocations.kind, 'safe'),
            eq(cashLocations.isDefault, true),
            isNull(cashLocations.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!cashLocationId) {
      cashLocationId = newId();
      await tx.insert(cashLocations).values({
        id: cashLocationId,
        tenantId,
        branchId,
        kind: 'safe',
        name: 'الصندوق الرئيسي',
        // The desktop chart is seeded above, so the safe posts to 1211001 from day one.
        accountId: mainCashAccountId,
        currencyCode: null,
        isDefault: true,
        isActive: true,
        createdAt: now,
        createdBy: actorUserId,
      });
      created = true;
    }

    // PHASE_05 §11: a provisioned tenant's safe reports a balance, and it is zero.
    await tx
      .insert(cashLocationBalances)
      .values({ tenantId, cashLocationId, currencyCode, balance: '0' })
      .onConflictDoNothing();

    let priceListId = await firstId(
      tx
        .select({ id: priceLists.id })
        .from(priceLists)
        .where(
          and(
            eq(priceLists.tenantId, tenantId),
            eq(priceLists.isDefault, true),
            isNull(priceLists.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!priceListId) {
      priceListId = newId();
      await tx.insert(priceLists).values({
        id: priceListId,
        tenantId,
        name: 'قائمة الأسعار الافتراضية',
        currencyCode,
        isDefault: true,
        isActive: true,
        createdAt: now,
        createdBy: actorUserId,
      });
      created = true;
    }

    const defaultCustomer = await firstId(
      tx
        .select({ id: parties.id })
        .from(parties)
        .where(
          and(
            eq(parties.tenantId, tenantId),
            eq(parties.code, 'CUST-GEN'),
            isNull(parties.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!defaultCustomer) {
      await tx
        .insert(parties)
        .values({
          id: newId(),
          tenantId,
          code: 'CUST-GEN',
          kind: 'customer',
          name: 'عميل عام',
          legalName: 'عميل عام',
          creditLimit: '0',
          createdAt: now,
          createdBy: actorUserId,
        })
        .onConflictDoNothing();
    }

    const defaultSupplier = await firstId(
      tx
        .select({ id: parties.id })
        .from(parties)
        .where(
          and(
            eq(parties.tenantId, tenantId),
            eq(parties.code, 'SUPP-GEN'),
            isNull(parties.deletedAt),
          ),
        )
        .limit(1),
    );
    if (!defaultSupplier) {
      await tx
        .insert(parties)
        .values({
          id: newId(),
          tenantId,
          code: 'SUPP-GEN',
          kind: 'supplier',
          name: 'مورد عام',
          legalName: 'مورد عام',
          creditLimit: '0',
          createdAt: now,
          createdBy: actorUserId,
        })
        .onConflictDoNothing();
    }

    if (options.seedStarterData) {
      if (await this.ensureFiscalCalendar(tx, tenantId, actorUserId, now)) created = true;
      if (await this.ensureDefaultCategory(tx, tenantId, actorUserId, now)) created = true;
      if (await this.ensureDefaultTaxGroups(tx, tenantId, actorUserId, now)) created = true;
      if (await this.ensureDefaultUnits(tx, tenantId, actorUserId, now)) created = true;
      if (await this.ensureDefaultPaymentMethods(tx, tenantId, cashLocationId, actorUserId, now)) created = true;
      if (await this.ensureDefaultTenantSettings(tx, tenantId)) created = true;
    }

    if (created) {
      this.logger.log(
        { tenantId, branchId, warehouseId, cashLocationId, starter: Boolean(options.seedStarterData) },
        'organization defaults provisioned',
      );
    }

    return { tenantId, branchId, warehouseId, cashLocationId, priceListId, currencyCode, created };
  }

  private async ensureFiscalCalendar(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<boolean> {
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(now);
    const currentYear = Number(today.slice(0, 4));
    const currentMonthLabel = today.slice(0, 7);

    const [coveringYear] = await tx
      .select({ id: fiscalYears.id })
      .from(fiscalYears)
      .where(
        and(
          eq(fiscalYears.tenantId, tenantId),
          lte(fiscalYears.startDate, today),
          gte(fiscalYears.endDate, today),
        ),
      )
      .limit(1);

    let fiscalYearId = coveringYear?.id;
    let changed = false;
    if (!fiscalYearId) {
      fiscalYearId = newId();
      await tx.insert(fiscalYears).values({
        id: fiscalYearId,
        tenantId,
        name: String(currentYear),
        startDate: `${currentYear}-01-01`,
        endDate: `${currentYear}-12-31`,
        status: 'open',
        createdAt: now,
        createdBy: actorUserId,
      });
      changed = true;
    }

    const existingPeriods = await tx
      .select({ name: fiscalPeriods.name, isActive: fiscalPeriods.isActive })
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.tenantId, tenantId), eq(fiscalPeriods.fiscalYearId, fiscalYearId)));
    const presentNames = new Set(existingPeriods.map((row) => row.name));
    const [anyActive] = await tx
      .select({ id: fiscalPeriods.id })
      .from(fiscalPeriods)
      .where(and(eq(fiscalPeriods.tenantId, tenantId), eq(fiscalPeriods.isActive, true)))
      .limit(1);

    let activeAssigned = Boolean(anyActive);
    for (let month = 1; month <= 12; month += 1) {
      const label = `${currentYear}-${String(month).padStart(2, '0')}`;
      if (presentNames.has(label)) continue;
      const startDate = `${label}-01`;
      const endDate = new Date(Date.UTC(currentYear, month, 0)).toISOString().slice(0, 10);
      const isActive = !activeAssigned && label === currentMonthLabel;
      if (isActive) activeAssigned = true;
      await tx.insert(fiscalPeriods).values({
        id: newId(),
        tenantId,
        fiscalYearId,
        name: label,
        startDate,
        endDate,
        status: 'open',
        isActive,
        createdAt: now,
        createdBy: actorUserId,
      });
      changed = true;
    }
    return changed;
  }

  /**
   * عند إنشاء منشأة جديدة يُولَّد تصنيف افتراضي واحد فقط باسم «مجموعة عامة».
   */
  private async ensureDefaultCategory(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<boolean> {
    const existing = await tx
      .select({ id: itemCategories.id })
      .from(itemCategories)
      .where(and(eq(itemCategories.tenantId, tenantId), isNull(itemCategories.deletedAt)))
      .limit(1);
    if (existing.length > 0) return false;
    await tx.insert(itemCategories).values({
      id: newId(),
      tenantId,
      code: 'GEN',
      nameAr: 'مجموعة عامة',
      nameEn: 'General Group',
      sortOrder: 1,
      showInPos: true,
      showInSale: true,
      showInPurch: true,
      createdAt: now,
      createdBy: actorUserId,
    });
    return true;
  }

  /**
   * المجموعات الضريبية الافتراضية للمنشآت الجديدة:
   * 1) ضريبة القيمة المضافة = 15% (مربوطة بحساب 2222001)
   * 2) ضريبة صفرية = 0%
   */
  private async ensureDefaultTaxGroups(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<boolean> {
    const existing = await tx
      .select({ nameAr: taxGroups.nameAr, rate: taxGroups.rate })
      .from(taxGroups)
      .where(and(eq(taxGroups.tenantId, tenantId), isNull(taxGroups.deletedAt)));

    const [vatAccount] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), eq(accounts.code, '2222001'), isNull(accounts.deletedAt)))
      .limit(1);

    const has15 = existing.some(
      (row) => Number(row.rate) === 15 || row.nameAr.includes('القيمة المضافة'),
    );
    const has0 = existing.some(
      (row) => Number(row.rate) === 0 || row.nameAr.includes('صفرية'),
    );

    let changed = false;
    if (!has15) {
      await tx.insert(taxGroups).values({
        id: newId(),
        tenantId,
        nameAr: 'ضريبة القيمة المضافة',
        nameEn: 'VAT 15%',
        rate: '15.0000',
        vatAccountId: vatAccount?.id ?? null,
        isInclusiveDefault: false,
        createdAt: now,
        createdBy: actorUserId,
      });
      changed = true;
    }
    if (!has0) {
      await tx.insert(taxGroups).values({
        id: newId(),
        tenantId,
        nameAr: 'ضريبة صفرية',
        nameEn: 'Zero VAT 0%',
        rate: '0.0000',
        vatAccountId: null,
        isInclusiveDefault: false,
        createdAt: now,
        createdBy: actorUserId,
      });
      changed = true;
    }
    return changed;
  }

  /**
   * الوحدات الأساسية للمنشآت الجديدة.
   */
  private async ensureDefaultUnits(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<boolean> {
    const seed: Array<{ code: string; nameAr: string; nameEn: string }> = [
      { code: 'PCS', nameAr: 'حبة', nameEn: 'Piece' },
      { code: 'CTN', nameAr: 'كرتون', nameEn: 'Carton' },
      { code: 'BOX', nameAr: 'علبة', nameEn: 'Box' },
      { code: 'KG', nameAr: 'كيلوجرام', nameEn: 'Kilogram' },
      { code: 'LTR', nameAr: 'لتر', nameEn: 'Litre' },
      { code: 'MTR', nameAr: 'متر', nameEn: 'Meter' },
    ];
    const existing = await tx
      .select({ code: unitsOfMeasure.code })
      .from(unitsOfMeasure)
      .where(and(eq(unitsOfMeasure.tenantId, tenantId), isNull(unitsOfMeasure.deletedAt)));
    const present = new Set(existing.map((row) => row.code.trim().toUpperCase()));
    const missing = seed.filter((row) => !present.has(row.code));
    if (!missing.length) return false;
    await tx.insert(unitsOfMeasure).values(
      missing.map((row) => ({
        id: newId(),
        tenantId,
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        createdAt: now,
        createdBy: actorUserId,
      })),
    );
    return true;
  }

  private async ensureDefaultPaymentMethods(
    tx: DrizzleTx,
    tenantId: string,
    cashLocationId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<boolean> {
    const existing = await tx
      .select({ code: paymentMethods.code, isDefault: paymentMethods.isDefault })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.tenantId, tenantId), isNull(paymentMethods.deletedAt)));
    const present = new Set(existing.map((row) => row.code.trim().toUpperCase()));
    const hasDefault = existing.some((row) => row.isDefault);

    const seed: Array<{
      code: string;
      nameAr: string;
      nameEn: string;
      kind: string;
      dueDays: number;
      useCashLocation?: boolean;
      defaultCandidate?: boolean;
    }> = [
      { code: 'CASH', nameAr: 'نقدي', nameEn: 'Cash', kind: 'cash', dueDays: 0, useCashLocation: true, defaultCandidate: true },
      { code: 'CARD', nameAr: 'بطاقة / شبكة', nameEn: 'Card / Network', kind: 'card', dueDays: 0 },
      { code: 'TRANSFER', nameAr: 'تحويل بنكي', nameEn: 'Bank transfer', kind: 'transfer', dueDays: 0 },
      { code: 'CREDIT', nameAr: 'آجل', nameEn: 'Credit', kind: 'credit', dueDays: 30 },
    ];
    const missing = seed.filter((row) => !present.has(row.code));
    if (!missing.length) return false;
    await tx.insert(paymentMethods).values(
      missing.map((row) => ({
        id: newId(),
        tenantId,
        code: row.code,
        nameAr: row.nameAr,
        nameEn: row.nameEn,
        kind: row.kind,
        dueDays: row.dueDays,
        cashLocationId: row.useCashLocation ? cashLocationId : null,
        isActive: true,
        isDefault: Boolean(row.defaultCandidate && !hasDefault),
        createdAt: now,
        createdBy: actorUserId,
      })),
    );
    return true;
  }

  private async ensureDefaultTenantSettings(tx: DrizzleTx, tenantId: string): Promise<boolean> {
    let inserted = 0;
    for (const definition of tenantSettingsRegistry) {
      if (definition.key.startsWith('feature.')) continue;
      const result = await tx.execute(sql`
        INSERT INTO tenant_settings (tenant_id, key, value)
        VALUES (${tenantId}, ${definition.key}, ${JSON.stringify(definition.defaultValue)}::jsonb)
        ON CONFLICT (tenant_id, key) DO NOTHING
      `);
      inserted += result.rowCount ?? 0;
    }
    return inserted > 0;
  }

  /**
   * Seeds the desktop default chart of accounts (`Accounts_Index`, 112 accounts + the
   * cloud COGS extension) for a tenant that has none yet.
   *
   * Idempotent: a tenant with any live account is left untouched, so re-running
   * provisioning never duplicates or renames the accountant's chart. Parents precede
   * children in `DEMO_CHART_OF_ACCOUNTS`, so one ordered pass resolves every `parent_id`,
   * `level` and ltree `path` exactly the way `AccountingService.create` would.
   *
   * Returns the id of 1211001 (الصندوق الرئيسي) so the main safe can post to it —
   * or `null` when the chart already existed (the safe keeps whatever link it has).
   */
  private async ensureChartOfAccounts(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<string | null> {
    /**
     * An existing chart is *completed*, never rewritten. Later phases add leaves to
     * `DEMO_CHART_OF_ACCOUNTS` (بضاعة تحت التحويل، تسويات المخزون …) and a tenant
     * provisioned before them would otherwise post every new document straight into
     * `ACCOUNT_PROFILE_MISSING` — with no way out short of hand-editing the chart.
     * Inserting the codes that are missing, and only those, keeps an accountant's
     * own edits intact while letting an old tenant use new features.
     */
    const existingRows = await tx
      .select({ id: accounts.id, code: accounts.code, path: accounts.path, level: accounts.level })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt)));
    const idByCode = new Map(existingRows.map((row) => [row.code.trim(), row.id]));
    const pathByCode = new Map(existingRows.map((row) => [row.code.trim(), row.path]));
    const levelByCode = new Map(existingRows.map((row) => [row.code.trim(), row.level]));

    let inserted = 0;
    for (const account of DEMO_CHART_OF_ACCOUNTS) {
      if (idByCode.has(account.code)) continue;
      const id = newId();
      const parentId = account.parent ? idByCode.get(account.parent) : undefined;
      const parentPath = account.parent ? pathByCode.get(account.parent) : undefined;
      const level = account.parent ? (levelByCode.get(account.parent) ?? 0) + 1 : 0;
      const path = parentPath ? `${parentPath}.${id}` : id;
      await tx.insert(accounts).values({
        id,
        tenantId,
        code: account.code,
        nameAr: account.nameAr,
        nameEn: account.nameEn ?? null,
        parentId: parentId ?? null,
        level,
        path,
        type: account.type,
        normalBalance:
          account.normalBalance ??
          (account.type === 'asset' || account.type === 'expense' ? 'debit' : 'credit'),
        isPostable: account.postable !== false,
        allowManual: true,
        createdAt: now,
        createdBy: actorUserId,
        legacySource: 'desktop-erp',
        legacyId: `Accounts_Index:${account.code}`,
      });
      idByCode.set(account.code, id);
      pathByCode.set(account.code, path);
      levelByCode.set(account.code, level);
      inserted += 1;
    }

    if (inserted > 0) {
      this.logger.log({ tenantId, inserted, total: idByCode.size }, 'desktop chart of accounts seeded');
    }
    // A chart that already existed keeps whatever account its main safe is linked to.
    return existingRows.length > 0 ? null : (idByCode.get('1211001') ?? null);
  }

  /**
   * Seeds the tenant-wide posting profile (`branch NULL`, doc `*`) that every
   * auto-posting engine resolves through `PostingProfilesService` — the cloud heir
   * of the desktop `SettingGeneral.*Acc` defaults.
   *
   * Idempotent: an existing `*` profile is left untouched (the accountant may have
   * customised it). Codes that resolve to no account are omitted rather than
   * guessed — posting then fails with a named key error instead of corrupting the
   * ledger. Returns whether a profile was created.
   */
  /**
   * 🎁 أنواع الحوافز والجزاءات — the three rows `frmEmpSalaryAddSub` cannot work
   * without. `SalaryAddSubTypes` is a database table in the desktop and its seed is not
   * in the repository, but the code-behind names the three by id: 1 = مكافأة (an
   * addition), 2 = خصم, 3 = سلفة (both deductions). Migration `0050` inserts them for
   * every tenant that already existed; this does it for every tenant created after it,
   * in the same transaction that seeds the chart of accounts.
   */
  private async ensureSalaryAdjustmentTypes(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<boolean> {
    const seed: Array<{ code: string; name: string; kind: string; sortOrder: number }> = [
      { code: 'bonus', name: 'مكافأة', kind: 'addition', sortOrder: 1 },
      { code: 'deduction', name: 'خصم', kind: 'deduction', sortOrder: 2 },
      { code: 'advance', name: 'سلفة', kind: 'deduction', sortOrder: 3 },
    ];
    const existing = await tx
      .select({ code: salaryAdjustmentTypes.code })
      .from(salaryAdjustmentTypes)
      .where(and(eq(salaryAdjustmentTypes.tenantId, tenantId), isNull(salaryAdjustmentTypes.deletedAt)));
    const present = new Set(existing.map((row) => row.code));
    const missing = seed.filter((row) => !present.has(row.code));
    if (!missing.length) return false;
    await tx.insert(salaryAdjustmentTypes).values(
      missing.map((row) => ({
        id: newId(),
        tenantId,
        code: row.code,
        name: row.name,
        kind: row.kind,
        sortOrder: row.sortOrder,
        isActive: true,
        createdAt: now,
        createdBy: actorUserId,
      })),
    );
    this.logger.log({ tenantId, inserted: missing.length }, 'salary adjustment types seeded');
    return true;
  }

  /**
   * 🧵 حالات طلب التفصيل — `OrderStatus` in `frmOrders.LoadStatusFilter` L54. The table's
   * seed is not in the repository; the one place the lifecycle is written in words is
   * `frmViewOrders.GetStateText` L119 (`مستلم · في الخياطة · جاهز · تم التسليم`).
   * Migration `0053` inserts them for every tenant that already existed; this does it
   * for every tenant created after it.
   */
  private async ensureTailoringOrderStatuses(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<boolean> {
    const seed: Array<{ code: string; nameAr: string; displayOrder: number }> = [
      { code: 'received', nameAr: 'مستلم', displayOrder: 1 },
      { code: 'sewing', nameAr: 'في الخياطة', displayOrder: 2 },
      { code: 'ready', nameAr: 'جاهز', displayOrder: 3 },
      { code: 'delivered', nameAr: 'تم التسليم', displayOrder: 4 },
    ];
    const existing = await tx
      .select({ code: tailoringOrderStatuses.code })
      .from(tailoringOrderStatuses)
      .where(and(eq(tailoringOrderStatuses.tenantId, tenantId), isNull(tailoringOrderStatuses.deletedAt)));
    const present = new Set(existing.map((row) => row.code));
    const missing = seed.filter((row) => !present.has(row.code));
    if (!missing.length) return false;
    await tx.insert(tailoringOrderStatuses).values(
      missing.map((row) => ({
        id: newId(),
        tenantId,
        code: row.code,
        nameAr: row.nameAr,
        displayOrder: row.displayOrder,
        // ⚙️ الحالة النهائية — «تم التسليم», which is what ends ⌛ متأخّر.
        isFinal: row.code === 'delivered',
        active: true,
        createdAt: now,
        createdBy: actorUserId,
      })),
    );
    this.logger.log({ tenantId, inserted: missing.length }, 'tailoring order statuses seeded');
    return true;
  }

  /**
   * 👔 أنواع الثوب — `typeCB` in `AddNewSizes.xaml` L423 names its four items in the
   * markup (`سعودي · بحريني · اماراتي · كويتي`), unlike `OrderStatus` whose rows are
   * only data. Migration `0054` inserts them for every tenant that already existed;
   * this does it for every tenant created after it.
   */
  private async ensureTailoringGarmentTypes(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<boolean> {
    const seed: Array<{ code: string; nameAr: string; displayOrder: number }> = [
      { code: 'saudi', nameAr: 'سعودي', displayOrder: 1 },
      { code: 'bahraini', nameAr: 'بحريني', displayOrder: 2 },
      { code: 'emirati', nameAr: 'اماراتي', displayOrder: 3 },
      { code: 'kuwaiti', nameAr: 'كويتي', displayOrder: 4 },
    ];
    const existing = await tx
      .select({ code: tailoringGarmentTypes.code })
      .from(tailoringGarmentTypes)
      .where(and(eq(tailoringGarmentTypes.tenantId, tenantId), isNull(tailoringGarmentTypes.deletedAt)));
    const present = new Set(existing.map((row) => row.code));
    const missing = seed.filter((row) => !present.has(row.code));
    if (!missing.length) return false;
    await tx.insert(tailoringGarmentTypes).values(
      missing.map((row) => ({
        id: newId(),
        tenantId,
        code: row.code,
        nameAr: row.nameAr,
        displayOrder: row.displayOrder,
        active: true,
        createdAt: now,
        createdBy: actorUserId,
      })),
    );
    this.logger.log({ tenantId, inserted: missing.length }, 'tailoring garment types seeded');
    return true;
  }

  /**
   * 📏 خصائص القياسات — `MeasurementAttributes(AttributeID, AttributeName, DisplayOrder,
   * IsActive)`. Rows of that table are data, and they are not in this repository; the
   * only place it names any خاصية is the add prompt of
   * `frmMeasurementAttributes.xaml.cs` `btnAdd_Click`:
   * «أدخل اسم الخاصية (مثل: الطول، العرض، الكم)» — so those three are seeded, in that
   * order, exactly as migration `0055` seeds them for tenants that already existed.
   */
  private async ensureMeasurementAttributes(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<boolean> {
    const seed: Array<{ nameAr: string; displayOrder: number }> = [
      { nameAr: 'الطول', displayOrder: 1 },
      { nameAr: 'العرض', displayOrder: 2 },
      { nameAr: 'الكم', displayOrder: 3 },
    ];
    const existing = await tx
      .select({ nameAr: tailoringMeasurementAttributes.nameAr })
      .from(tailoringMeasurementAttributes)
      .where(and(eq(tailoringMeasurementAttributes.tenantId, tenantId), isNull(tailoringMeasurementAttributes.deletedAt)));
    const present = new Set(existing.map((row) => row.nameAr));
    const missing = seed.filter((row) => !present.has(row.nameAr));
    if (!missing.length) return false;
    await tx.insert(tailoringMeasurementAttributes).values(
      missing.map((row) => ({
        id: newId(),
        tenantId,
        nameAr: row.nameAr,
        displayOrder: row.displayOrder,
        active: true,
        createdAt: now,
        createdBy: actorUserId,
      })),
    );
    this.logger.log({ tenantId, inserted: missing.length }, 'measurement attributes seeded');
    return true;
  }

  private async ensurePostingProfile(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<boolean> {
    const [existing] = await tx
      .select({ id: branchPostingProfiles.id, mapping: branchPostingProfiles.mapping })
      .from(branchPostingProfiles)
      .where(
        and(
          eq(branchPostingProfiles.tenantId, tenantId),
          isNull(branchPostingProfiles.branchId),
          eq(branchPostingProfiles.docType, '*'),
        ),
      )
      .limit(1);
    const codes = [...new Set(Object.values(DEMO_POSTING_PROFILE))];
    const rows = await tx
      .select({ id: accounts.id, code: accounts.code })
      .from(accounts)
      .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt), inArray(accounts.code, codes)));
    const byCode = new Map(rows.map((row) => [row.code.trim(), row.id]));
    const mapping: Record<string, string | number> = { version: 1 };
    for (const [key, code] of Object.entries(DEMO_POSTING_PROFILE)) {
      const accountId = byCode.get(code);
      if (accountId) mapping[key] = accountId;
    }

    /**
     * The same reasoning as the chart: when a later phase adds a key
     * (`stockInTransitAccountId` …) an already-provisioned tenant would never see it.
     * Keys the accountant has *cleared* stay cleared — we only fill ones that are
     * absent, never overwrite ones she changed.
     */
    if (existing) {
      const current = (existing.mapping ?? {}) as Record<string, unknown>;
      const missing = Object.entries(mapping).filter(
        ([key, value]) => key !== 'version' && typeof value === 'string' && !(key in current),
      );
      if (!missing.length) return false;
      const nextMapping: Record<string, unknown> = {
        ...current,
        ...Object.fromEntries(missing),
        version: Number(current.version ?? 1) + 1,
      };
      await tx
        .update(branchPostingProfiles)
        .set({ mapping: nextMapping, updatedAt: now, updatedBy: actorUserId })
        .where(eq(branchPostingProfiles.id, existing.id));
      this.logger.log({ tenantId, added: missing.map(([key]) => key) }, 'tenant posting profile completed');
      return true;
    }

    await tx.insert(branchPostingProfiles).values({
      id: newId(),
      tenantId,
      branchId: null,
      docType: '*',
      mapping,
      createdAt: now,
      createdBy: actorUserId,
    });
    this.logger.log({ tenantId, keys: Object.keys(mapping).length - 1 }, 'tenant posting profile seeded');
    return true;
  }

  /**
   * The tenant record already names a base currency (PHASE_01 `tenants.base_currency`);
   * provisioning turns that string into an actual `currencies` row so FX and price lists
   * have something to reference.
   */
  private async ensureBaseCurrency(
    tx: DrizzleTx,
    tenantId: string,
    actorUserId: string | null,
    now: Date,
  ): Promise<string> {
    const [existingBase] = await tx
      .select({ code: currencies.code })
      .from(currencies)
      .where(and(eq(currencies.tenantId, tenantId), eq(currencies.isBase, true)))
      .limit(1);
    if (existingBase) return existingBase.code.trim();

    const [tenantRow] = await tx
      .select({ baseCurrency: tenants.baseCurrency })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const code = (tenantRow?.baseCurrency ?? 'SAR').trim().toUpperCase();

    await tx
      .insert(currencies)
      .values({
        tenantId,
        code,
        nameAr: code,
        nameEn: code,
        minorUnits: code === 'KWD' || code === 'BHD' || code === 'OMR' ? 3 : 2,
        isBase: true,
        isActive: true,
        createdAt: now,
        createdBy: actorUserId,
      })
      .onConflictDoNothing();

    // A tenant may already have the currency enabled without it being base.
    await tx
      .update(currencies)
      .set({ isBase: true })
      .where(and(eq(currencies.tenantId, tenantId), eq(currencies.code, code)));

    return code;
  }
}

async function firstId(query: PromiseLike<Array<{ id: string }>>): Promise<string | undefined> {
  const rows = await query;
  return rows[0]?.id;
}
