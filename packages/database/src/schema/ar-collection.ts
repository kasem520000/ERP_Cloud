import { sql } from 'drizzle-orm';
import { boolean, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { accounts, journalEntries } from './accounting.js';
import { parties } from './parties.js';
import { tenants } from './platform.js';

const money = { precision: 20, scale: 4, mode: 'string' as const };

/** MF-17 / دفقة D9 — قاعدة تذكير التحصيل: شريحة تأخر ⇐ قناة + هدوء إعادة الإرسال. */
export const arReminders = pgTable(
  'ar_reminders',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** الحد الأدنى لأيام التأخر (شمول هذا الحد). */
    minDays: integer('min_days').notNull(),
    /** الحد الأعلى (شمول قبله) — NULL = شريحة مفتوحة إلى ما لا نهاية. */
    maxDays: integer('max_days'),
    channel: text('channel').notNull().default('whatsapp'),
    cooldownDays: integer('cooldown_days').notNull().default(7),
    messageTemplate: text('message_template'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    bandUniq: uniqueIndex('ar_reminders_tenant_min_days_key').on(t.tenantId, t.minDays),
    scopeIdx: index('ar_reminders_scope_idx').on(t.tenantId, t.enabled),
  }),
);

/** MF-17 — سجل التذكير: يُكتب دائماً (نجاح أو فشل الإرسال) ⇐ «التذكير يُسجَّل في سجل الطرف». */
export const arReminderEvents = pgTable(
  'ar_reminder_events',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id'),
    bandDays: integer('band_days'),
    channel: text('channel').notNull(),
    message: text('message').notNull(),
    /** sent | failed:<code> | not_configured | queued — الإرسال خارجيّ أفضل جهد والتسجيل إجباري. */
    dispatchStatus: text('dispatch_status').notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
    error: text('error'),
    createdBy: uuid('created_by'),
  },
  (t) => ({
    partyIdx: index('ar_reminder_events_party_idx').on(t.tenantId, t.partyId),
    timeIdx: index('ar_reminder_events_time_idx').on(t.tenantId, t.dispatchedAt),
  }),
);

/** MF-17 — مخصص ديون مشكوك فيها بنسبة لكل شريحة (قيد: Dr مصروف / Cr مخصص). */
export const arProvisions = pgTable(
  'ar_provisions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id'),
    basisAmount: numeric('basis_amount', money).notNull(),
    percent: numeric('percent', { precision: 9, scale: 4, mode: 'string' as const }).notNull(),
    amount: numeric('amount', money).notNull(),
    expenseAccountId: uuid('expense_account_id')
      .notNull()
      .references(() => accounts.id),
    allowanceAccountId: uuid('allowance_account_id')
      .notNull()
      .references(() => accounts.id),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    entryDate: date('entry_date').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partyIdx: index('ar_provisions_party_idx').on(t.tenantId, t.partyId),
    dateIdx: index('ar_provisions_date_idx').on(t.tenantId, t.entryDate),
  }),
);

/** MF-17 — شطب فاتورة مدينة (مسوّدة ⇐ اعتماد بقيد: Dr مخصص+خسارة / Cr AR بالطرف). */
export const arWriteoffs = pgTable(
  'ar_writeoffs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    partyId: uuid('party_id')
      .notNull()
      .references(() => parties.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id').notNull(),
    amount: numeric('amount', money).notNull(),
    lossAccountId: uuid('loss_account_id')
      .notNull()
      .references(() => accounts.id),
    allowanceAccountId: uuid('allowance_account_id').references(() => accounts.id),
    allowanceUsed: numeric('allowance_used', money).notNull().default('0'),
    lossUsed: numeric('loss_used', money).notNull().default('0'),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('draft'),
    journalEntryId: uuid('journal_entry_id').references(() => journalEntries.id),
    approvedBy: uuid('approved_by'),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    recoveredAmount: numeric('recovered_amount', money).notNull().default('0'),
    entryDate: date('entry_date').notNull(),
    createdBy: uuid('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partyIdx: index('ar_writeoffs_party_idx').on(t.tenantId, t.partyId),
    statusIdx: index('ar_writeoffs_status_idx').on(t.tenantId, t.status),
    dateIdx: index('ar_writeoffs_date_idx').on(t.tenantId, t.entryDate),
  }),
);
