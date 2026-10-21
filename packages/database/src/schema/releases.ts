import { sql } from 'drizzle-orm';
import { boolean, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { users } from './platform.js';

/**
 * 🗜️ سجلّ إصدارات المنصّة (migration `0138_platform_releases.sql`).
 *
 * صفٌّ لكل حزمةِ تحديثٍ **رُفضت أو قُبلت** — لا للمقبولة وحدها: الحزمة المرفوضة سجلٌّ
 * أيضاً («من حاول نشر ماذا، ولماذا رُفض»)، وحذفها من السجلّ يجعل السؤال «هل جرّب أحدٌ نشر
 * ملفٍّ تنفيذي؟» بلا جواب.
 *
 * ولا تُخزَّن بايتات الأرشيف هنا ولا في مخزنٍ آخر: ما يُحفظ هو **قياسُها** — البصمة والحجم
 * والأسماء والقرار. فالحزمة بيانُ نشرٍ يُقاس ويُعلَن، لا شيفرةٌ تستقرّ على جهاز الـAPI.
 */
export const platformReleases = pgTable(
  'platform_releases',
  {
    id: uuid('id').primaryKey(),
    version: text('version'),
    channel: text('channel').notNull().default('stable'),
    status: text('status').notNull().default('accepted'),
    notes: text('notes').notNull().default(''),
    highlights: jsonb('highlights').notNull().default(sql`'[]'::jsonb`),
    minFromVersion: text('min_from_version'),
    filename: text('filename').notNull(),
    bytes: integer('bytes').notNull().default(0),
    entries: integer('entries').notNull().default(0),
    checksum: text('checksum').notNull(),
    checksum_verified: boolean('checksum_verified').notNull().default(false),
    files: jsonb('files').notNull().default(sql`'[]'::jsonb`),
    /** سبب الرفع — ولماذا يُقبل الإصدار أو يُسحب. نصٌّ مكتوب، لا علم. */
    reason: text('reason').notNull().default(''),
    rejection_code: text('rejection_code'),
    rejection_detail: text('rejection_detail'),
    /** الإصدار المعروض على المستأجرين — يُصان بـ`UPDATE` واحدٍ في الخدمة. */
    is_current: boolean('is_current').notNull().default(false),
    uploaded_by: uuid('uploaded_by').references(() => users.id, { onDelete: 'set null' }),
    uploaded_at: timestamp('uploaded_at', { withTimezone: true }).notNull().defaultNow(),
    revoked_at: timestamp('revoked_at', { withTimezone: true }),
  },
  (table) => ({
    versionIdx: uniqueIndex('platform_releases_version_channel_key')
      .on(table.version, table.channel)
      .where(sql`status <> 'rejected'`),
    currentIdx: index('platform_releases_current_idx').on(table.is_current),
    uploadedIdx: index('platform_releases_uploaded_idx').on(table.uploaded_at),
  }),
);

export type PlatformReleaseRow = typeof platformReleases.$inferSelect;
