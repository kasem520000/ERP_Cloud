import { sql } from 'drizzle-orm';
import { date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { accounts, costCenters, journalEntries } from './accounting.js';
import { branches, cashLocations } from './organization.js';
import { employees } from './hrm.js';
import { tenants } from './platform.js';
import { vouchers } from './treasury.js';

const money = { precision: 20, scale: 4, mode: 'string' as const };

/** MF-21 — فئات الأصول الثابتة (حسابات + طريقة الإهلاك + العمر). */
export const assetCategories = pgTable(
  'asset_categories',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    code: text('code').notNull(),
    nameAr: text('name_ar').notNull(),
    nameEn: text('name_en'),
    method: text('method').notNull(),
    usefulLifeMonths: integer('useful_life_months').notNull(),
    residualValue: numeric('residual_value', money).notNull().default('0'),
    decliningRatePercent: numeric('declining_rate_percent', { precision: 9, scale: 4, mode: 'string' as const }).notNull().default('0'),
    totalUnits: numeric('total_units', money),
    assetAccountId: uuid('asset_account_id')
      .notNull()
      .references(() => accounts.id),
    accumulatedDepreciationAccountId: uuid('accumulated_depreciation_account_id')
      .notNull()
      .references(() => accounts.id),
    depreciationExpenseAccountId: uuid('depreciation_expense_account_id')
      .notNull()
      .references(() => accounts.id),
    status: text('status').notNull().default('active'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUniq: uniqueIndex('asset_categories_tenant_code_key').on(t.tenantId, t.code),
  }),
);

/** MF-21 — سجل الأصول الثابتة: التكلفة/التشغيل/الطريقة المُحلّة عند الإنشاء. */
export const fixedAssets = pgTable(
  'fixed_assets',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => assetCategories.id),
    code: text('code').notNull(),
    name: text('name').notNull(),
    cost: numeric('cost', money).notNull(),
    residualValue: numeric('residual_value', money).notNull().default('0'),
    method: text('method').notNull(),
    usefulLifeMonths: integer('useful_life_months').notNull(),
    decliningRatePercent: numeric('declining_rate_percent', { precision: 9, scale: 4, mode: 'string' as const }).notNull().default('0'),
    totalUnits: numeric('total_units', money),
    inServiceDate: date('in_service_date').notNull(),
    costCenterId: uuid('cost_center_id').references(() => costCenters.id),
    /** العهدة — مرجع حرفي مرن (موظف/شخص) بلا قيد فكّ ترميز صارم. */
    custodianId: uuid('custodian_id').references(() => employees.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('active'),
    disposalDate: date('disposal_date'),
    sourceType: text('source_type'),
    sourceId: uuid('source_id'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeUniq: uniqueIndex('fixed_assets_tenant_code_key').on(t.tenantId, t.code),
    sourceUniq: uniqueIndex('fixed_assets_tenant_source_key')
      .on(t.tenantId, t.sourceType, t.sourceId)
      .where(sql`source_id IS NOT NULL`),
    scope: index('fixed_assets_scope_idx').on(t.tenantId, t.status),
  }),
);

/** MF-21 — تشغيل إهلاك شهري واحد لكل فترة (معاينة ثم ترحيل). */
export const assetDepreciationRuns = pgTable(
  'asset_depreciation_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    period: date('period').notNull(),
    status: text('status').notNull().default('preview'),
    totalAmount: numeric('total_amount', money).notNull().default('0'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    postedAt: timestamp('posted_at', { withTimezone: true }),
    postedBy: uuid('posted_by'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    periodUniq: uniqueIndex('asset_depreciation_runs_tenant_period_key').on(t.tenantId, t.period),
    scope: index('asset_depreciation_runs_scope_idx').on(t.tenantId, t.status),
  }),
);

export const assetDepreciationLines = pgTable(
  'asset_depreciation_lines',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    runId: uuid('run_id')
      .notNull()
      .references(() => assetDepreciationRuns.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => fixedAssets.id),
    amount: numeric('amount', money).notNull(),
    accumulatedAfter: numeric('accumulated_after', money).notNull(),
    bookValueAfter: numeric('book_value_after', money).notNull(),
  },
  (t) => ({
    runAssetUniq: uniqueIndex('asset_depreciation_lines_run_asset_key').on(t.runId, t.assetId),
    assetIdx: index('asset_depreciation_lines_asset_idx').on(t.assetId),
  }),
);

/** MF-21 — استبعاد/بيع: كامل أو بنسبة (cost_amount ≤ التكلفة الباقية). */
export const assetDisposals = pgTable(
  'asset_disposals',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => fixedAssets.id),
    date: date('date').notNull(),
    kind: text('kind').notNull(),
    costDisposed: numeric('cost_disposed', money).notNull(),
    accumulatedRemoved: numeric('accumulated_removed', money).notNull(),
    proceeds: numeric('proceeds', money).notNull().default('0'),
    gainLoss: numeric('gain_loss', money).notNull(),
    gainAccountId: uuid('gain_account_id')
      .notNull()
      .references(() => accounts.id),
    lossAccountId: uuid('loss_account_id')
      .notNull()
      .references(() => accounts.id),
    proceedsAccountId: uuid('proceeds_account_id').references(() => accounts.id),
    cashLocationId: uuid('cash_location_id').references(() => cashLocations.id),
    voucherId: uuid('voucher_id').references(() => vouchers.id),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    reason: text('reason'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scope: index('asset_disposals_scope_idx').on(t.tenantId, t.assetId),
  }),
);
