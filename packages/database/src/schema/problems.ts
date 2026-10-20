import { index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * `platform_problem_events` — سجلّ أخطاء السيرفرات (migration `0136_platform_problem_events.sql`).
 *
 * صفٌّ واحد لكل عطبٍ من جانب الخادم: 5xx من الـAPI، أو استثناءٌ لم يُلتقط في العملية، أو
 * تقريرٌ من سيرفر Next عبر `onRequestError`. والصفّ يحمل ما يلزم للتشخيص وحده: الرمز
 * والرسالة والمسار والطريقة والبصمة و`meta` (حيث المكدّس المختصر)، وأين ومتى.
 */
export const platformProblemEvents = pgTable(
  'platform_problem_events',
  {
    id: uuid('id').primaryKey(),
    source: text('source').notNull().default('api'),
    severity: text('severity').notNull().default('error'),
    code: text('code'),
    message: text('message').notNull(),
    path: text('path'),
    method: text('method'),
    status: integer('status'),
    traceId: text('trace_id'),
    tenantId: uuid('tenant_id'),
    actorUserId: uuid('actor_user_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    recentIdx: index('platform_problem_events_recent_idx').on(table.occurredAt),
    sourceIdx: index('platform_problem_events_source_idx').on(table.source, table.occurredAt),
  }),
);

export type PlatformProblemEvent = typeof platformProblemEvents.$inferSelect;
