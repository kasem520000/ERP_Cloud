import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { baseAuditColumns, baseLegacyColumns, baseSoftDeleteColumns } from '../columns.js';

import { employees } from './hrm.js';
import { branches } from './organization.js';
import { tenants, users } from './platform.js';

const money = { precision: 20, scale: 4, mode: 'string' as const };

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en'),
    parentId: uuid('parent_id'),
    level: integer('level').notNull().default(0),
    path: text('path').notNull(),
    type: text('type').notNull(),
    subtype: text('subtype'),
    normalBalance: text('normal_balance').notNull(),
    isPostable: boolean('is_postable').notNull().default(true),
    allowManual: boolean('allow_manual').notNull().default(true),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    currencyCode: text('currency_code'),
    /**
     * 📅 تاريخ فتح الحساب — `Form_WPF/frmAccountsTree.xaml` («بطاقة حساب»). Nullable: an
     * account opened years ago has no recorded date, and a chart imported by
     * `desktop-coa.ts` must not be forced to invent one (migration 0045).
     */
    openedAt: date('opened_at'),
    /** 💰 الرصيد الافتتاحي — defaults to 0 so a NULL can never break a sum. */
    openingBalance: numeric('opening_balance', money).notNull().default('0'),
    /** 📊 مركز التكلفة — the card's default centre, inherited by a line that names none. */
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    ...baseAuditColumns(),
    ...baseSoftDeleteColumns(),
    ...baseLegacyColumns(),
  },
  (table) => ({
    accountCodeKey: uniqueIndex('accounts_tenant_code_key').on(table.tenantId, table.code).where(sql`deleted_at IS NULL`),
    accountPathIdx: index('accounts_tenant_path_idx').on(table.tenantId, table.path),
    accountParentIdx: index('accounts_tenant_parent_idx').on(table.tenantId, table.parentId),
  }),
);

export const fiscalYears = pgTable(
  'fiscal_years',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: text('status').notNull().default('open'),
    /** MF-04 — قيد إقفال السنة (null قبل الإقفال). FK موجود في ترحيل0145؛ هنا بلا
        `.references` لتفادي دورة نوعية drizzle (years → entries → periods → years). */
    closingEntryId: uuid('closing_entry_id'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedBy: uuid('closed_by'),
    notes: text('notes'),
    ...baseAuditColumns(),
  },
  (table) => ({
    fiscalYearsTenantDatesIdx: index('fiscal_years_tenant_dates_idx').on(table.tenantId, table.startDate, table.endDate),
  }),
);

export const fiscalPeriods = pgTable(
  'fiscal_periods',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date').notNull(),
    status: text('status').notNull().default('open'),
    closedBy: uuid('closed_by'),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    /** ✔️ فترة نشطة حالياً — `FrmAccountingPeriods.xaml` `ChkIsActive` (migration 0048). */
    isActive: boolean('is_active').notNull().default(false),
    /** ملاحظات — `FrmAccountingPeriods.xaml` `TxtNotes` (migration 0048). */
    notes: text('notes'),
    ...baseAuditColumns(),
  },
  (table) => ({
    periodsYearDatesIdx: index('fiscal_periods_year_dates_idx').on(table.fiscalYearId, table.startDate, table.endDate),
    periodsTenantStatusIdx: index('fiscal_periods_tenant_status_idx').on(table.tenantId, table.status),
    periodsOneActiveIdx: uniqueIndex('fiscal_periods_one_active_idx').on(table.tenantId).where(sql`${table.isActive}`),
  }),
);

export const periodModuleLocks = pgTable(
  'period_module_locks',
  {
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').notNull().references(() => fiscalPeriods.id, { onDelete: 'cascade' }),
    module: text('module').notNull(),
    locked: boolean('locked').notNull().default(false),
    lockedBy: uuid('locked_by'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
  },
  (table) => ({
    periodModuleLocksPk: primaryKey({ columns: [table.periodId, table.module] }),
  }),
);

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
    fiscalPeriodId: uuid('fiscal_period_id').notNull().references(() => fiscalPeriods.id, { onDelete: 'restrict' }),
    date: date('date').notNull(),
    number: text('number'),
    /** ⏰ الوقت — `FrmNewEntry.xaml` `txtTime`; NULL for entries posted before it was recorded. */
    entryTime: time('entry_time'),
    /** ✅ قيد ضريبي — `FrmNewEntry.xaml` `chkIsVAT` (`Entry.IsVAT`). */
    isVat: boolean('is_vat').notNull().default(false),
    kind: text('kind').notNull().default('manual'),
    status: text('status').notNull().default('draft'),
    description: text('description'),
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
    reversalOf: uuid('reversal_of'),
    idempotencyKey: text('idempotency_key'),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedBy: uuid('posted_by'),
    ...baseAuditColumns(),
    ...baseLegacyColumns(),
  },
  (table) => ({
    journalTenantDateIdx: index('journal_entries_tenant_date_idx').on(table.tenantId, table.date),
    journalSourceIdx: index('journal_entries_source_idx').on(table.tenantId, table.sourceType, table.sourceId),
    journalIdempotencyKey: uniqueIndex('journal_entries_idempotency_key').on(table.tenantId, table.idempotencyKey),
    journalTenantNumberKey: uniqueIndex('journal_entries_tenant_number_key')
      .on(table.tenantId, table.number)
      .where(sql`number IS NOT NULL`),
  }),
);

export const journalEntryLines = pgTable(
  'journal_entry_lines',
  {
    entryId: uuid('entry_id').notNull().references(() => journalEntries.id, { onDelete: 'restrict' }),
    lineNo: integer('line_no').notNull(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
    debit: numeric('debit', money).notNull().default('0'),
    credit: numeric('credit', money).notNull().default('0'),
    currencyCode: text('currency_code'),
    currencyAmount: numeric('currency_amount', money),
    fxRate: numeric('fx_rate', { precision: 20, scale: 10 }),
    costCenterId: uuid('cost_center_id'),
    partyId: uuid('party_id'),
    branchId: uuid('branch_id'),
    /** المندوب — `FrmNewEntry.xaml` `colSalesman` (`Entry_sub.salesman`); NULL when no one is credited. */
    salesmanId: uuid('salesman_id').references(() => employees.id, { onDelete: 'set null' }),
    description: text('description'),
  },
  (table) => ({
    journalLinesPk: primaryKey({ columns: [table.entryId, table.lineNo] }),
    journalLinesAccountIdx: index('journal_lines_tenant_account_idx').on(table.tenantId, table.accountId),
    journalLinesPartyIdx: index('journal_lines_tenant_party_idx').on(table.tenantId, table.partyId),
  }),
);

export const costCenters = pgTable(
  'cost_centers',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en'),
    parentId: uuid('parent_id'),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'restrict' }),
    ...baseAuditColumns(),
    ...baseSoftDeleteColumns(),
    ...baseLegacyColumns(),
  },
  (table) => ({
    costCenterCodeKey: uniqueIndex('cost_centers_tenant_code_key').on(table.tenantId, table.code).where(sql`deleted_at IS NULL`),
  }),
);

export const openingBalances = pgTable(
  'opening_balances',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    fiscalYearId: uuid('fiscal_year_id').notNull().references(() => fiscalYears.id, { onDelete: 'restrict' }),
    accountId: uuid('account_id').notNull().references(() => accounts.id, { onDelete: 'restrict' }),
    partyId: uuid('party_id'),
    itemId: uuid('item_id'),
    warehouseId: uuid('warehouse_id'),
    debit: numeric('debit', money).notNull().default('0'),
    credit: numeric('credit', money).notNull().default('0'),
    qty: numeric('qty', money),
    unitCost: numeric('unit_cost', money),
    note: text('note'),
    status: text('status').notNull().default('draft'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id, { onDelete: 'restrict' }),
    ...baseAuditColumns(),
  },
  (table) => ({
    openingUniqueKey: uniqueIndex('opening_balances_scope_key').on(table.tenantId, table.fiscalYearId, table.accountId, table.partyId, table.itemId, table.warehouseId),
  }),
);

/**
 * MF-18 / D11 — الإقرار الضريبي المقدَّم: أرقام التقرير مجمَّدة في `snapshot` لحظة
 * التقديم (AC1)، و`net_vat` = الصافي الذي نُقل عن2222001 في قيد التسوية (AC3)، والقيد
 * والحساب مرتبطان بالمصفوفة. التداخل بين نطاقين ممنوع على مستوى التطبيق (409).
 */
export type VatFilingSnapshot = {
  reportKey: 'vat-return-period';
  params: { from: string; to: string };
  rows: Array<Record<string, string>>;
  columns: Array<{ key: string; labelAr: string; type: string; hidden?: boolean }>;
  grandTotal: Array<{ key: string; labelAr: string; amount: string }>;
};

export const vatFilings = pgTable(
  'vat_filings',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    periodFrom: date('period_from').notNull(),
    periodTo: date('period_to').notNull(),
    /** لقطة التقرير الرسمية `vat-return-period` (rows + columns + grandTotal + params). */
    snapshot: jsonb('snapshot').notNull().$type<VatFilingSnapshot>(),
    netVat: numeric('net_vat', { precision: 18, scale: 4 }).notNull(),
    outputVat: numeric('output_vat', { precision: 18, scale: 4 }).notNull().default('0'),
    inputVat: numeric('input_vat', { precision: 18, scale: 4 }).notNull().default('0'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    settlementAccountId: uuid('settlement_account_id').references(() => accounts.id),
    filedAt: timestamp('filed_at', { withTimezone: true }).notNull().default(sql`now()`),
    filedBy: uuid('filed_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    scopeKey: uniqueIndex('vat_filings_scope_key').on(table.tenantId, table.periodFrom, table.periodTo),
    tenantPeriodIdx: index('vat_filings_tenant_period_idx').on(table.tenantId, table.periodFrom, table.periodTo),
  }),
);

/**
 * MF-28 / D12 — تشغيل إعادة تقييم العملات: قيد غير محقَّق (وإن كان صفراً بلا قيد) +
 * عكسه الآلي المرتبط. فريد (مستأجر، يوم) ⇐ تكرار التشغيل = 409 على التطبيق.
 */
export const fxRevaluationRuns = pgTable(
  'fx_revaluation_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    runDate: date('run_date').notNull(),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    reversalEntryId: uuid('reversal_entry_id').references(() => journalEntries.id),
    /** `posted` = قيد موجود أو صفر بلا قيد · `reversal` يدوي لاحق ⇐ `reversed`. */
    status: text('status').notNull().default('posted'),
    gainLoss: numeric('gain_loss', money).notNull().default('0'),
    /** لقطة الأرصدة المقيَّمة والأسعار والعملات المستبعدة (لإعادة التحقق). */
    detail: jsonb('detail').notNull().default({}),
    createdBy: uuid('created_by').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tenantDateKey: uniqueIndex('fx_revaluation_runs_tenant_date_key').on(table.tenantId, table.runDate),
    tenantDateIdx: index('fx_revaluation_runs_tenant_date_idx').on(table.tenantId, table.runDate),
  }),
);

export type Account = typeof accounts.$inferSelect;
export type JournalEntry = typeof journalEntries.$inferSelect;
export type JournalEntryLine = typeof journalEntryLines.$inferSelect;
export type FiscalPeriod = typeof fiscalPeriods.$inferSelect;
export type VatFiling = typeof vatFilings.$inferSelect;
export type FxRevaluationRun = typeof fxRevaluationRuns.$inferSelect;
