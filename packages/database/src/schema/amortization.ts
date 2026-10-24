import { sql } from 'drizzle-orm';
import { date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { accounts } from './accounting.js';
import { branches } from './organization.js';
import { tenants } from './platform.js';

const money = { precision: 20, scale: 4, mode: 'string' as const };

/**
 * MF-22 — المصروفات المقدّمة والمستحقة وجداول الإطفاء.
 *
 * كل صف جدول يمثّل قسطاً-شهرياً محسوباً: `installment_amount` = total/months،
 * والقسط الأخير يُعايَر على الباقي (تفادي فروق التقريب). التوليد يمرّ عبر
 * `postJournal` بمفتاح idempotency فريد لكل (جدول، فترة) ⇐ الحراسة ضد التوليد
 * المزدوج مفروضة في قاعدة البيانات أيضاً (`journal_entries_idempotency_key`).
 *
 * `source_type='manual'` يسمح بجدول بلا سند (استحقاق مُقدَّر) — وحينها
 * `source_id` يكون NULL والفهرس الجزئي الفريد لا يُلزم (NULLS DISTINCT).
 */
export const amortizationSchedules = pgTable(
  'amortization_schedules',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').references(() => branches.id, { onDelete: 'set null' }),
    /** prepaid = مقدّم يُوزَّع · accrual = مستحق يُستحدث ويعكس تلقائياً. */
    kind: text('kind').notNull(),
    /** voucher | purchase_invoice | manual. */
    sourceType: text('source_type').notNull(),
    sourceId: uuid('source_id'),
    status: text('status').notNull().default('active'),
    expenseAccountId: uuid('expense_account_id')
      .notNull()
      .references(() => accounts.id),
    deferralAccountId: uuid('deferral_account_id')
      .notNull()
      .references(() => accounts.id),
    totalAmount: numeric('total_amount', money).notNull(),
    installmentAmount: numeric('installment_amount', money).notNull(),
    months: integer('months').notNull(),
    startDate: date('start_date').notNull(),
    generatedCount: integer('generated_count').notNull().default(0),
    lastGeneratedPeriod: date('last_generated_period'),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scope: index('amortization_schedules_scope_idx').on(t.tenantId, t.status),
    sourceUniq: uniqueIndex('amortization_schedules_source_uniq')
      .on(t.tenantId, t.sourceType, t.sourceId)
      .where(sql`source_id IS NOT NULL`),
  }),
);
