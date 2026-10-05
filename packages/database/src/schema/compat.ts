import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { baseAuditColumns } from '../columns.js';

import { branches } from './organization.js';
import { tenants } from './platform.js';

/** Legacy desktop compatibility devices — PHASE_16. */
export const compatDevices = pgTable(
  'compat_devices',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id').notNull().references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    apiKeyHash: text('api_key_hash').notNull(),
    branchId: uuid('branch_id').notNull().references(() => branches.id, { onDelete: 'restrict' }),
    cursors: jsonb('cursors').$type<Record<string, { updatedAt: string; id: string }>>().notNull().default({}),
    enumMaps: jsonb('enum_maps').$type<Record<string, Record<string, string>>>().notNull().default({}),
    status: text('status').notNull().default('active'),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    rateWindowStartedAt: timestamp('rate_window_started_at', { withTimezone: true }),
    rateWindowCount: text('rate_window_count').notNull().default('0'),
    ...baseAuditColumns(),
  },
  (table) => ({
    compatDevicesHashKey: uniqueIndex('compat_devices_tenant_hash_key').on(table.tenantId, table.apiKeyHash),
    compatDevicesBranchIdx: index('compat_devices_branch_idx').on(table.tenantId, table.branchId),
    compatDevicesStatusIdx: index('compat_devices_status_idx').on(table.tenantId, table.status),
  }),
);

export type CompatDevice = typeof compatDevices.$inferSelect;
export type NewCompatDevice = typeof compatDevices.$inferInsert;
