import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, or, sql } from 'drizzle-orm';
import { DomainError, newId } from '@erp/contracts';
import { accounts, branches, compatDevices, inventoryTransactions, items, journalEntries, parties, salesInvoices, taxGroups, vouchers, warehouses, withTenantTx, type CompatDevice, type DatabaseHandle } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { SalesService } from '../sales/sales.service.js';
import { TreasuryService } from '../treasury/treasury.service.js';

import { mapLegacySale, mapLegacyVoucher, type LegacySalesInvoiceDto, type LegacyVoucherDto } from './compat-mappers.js';

type Cursor = { updatedAt: string; id: string };
type DeviceInput = { name: string; branchId: string; enumMaps?: Record<string, Record<string, string>> };
type DeviceSession = { device: CompatDevice; token: string };

const sessions = new Map<string, { tenantId: string; deviceId: string; expiresAt: number }>();
const compatPepper = () => process.env.COMPAT_KEY_PEPPER ?? 'dev-compat-pepper-change-me';

@Injectable()
export class CompatService {
  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle, private readonly sales: SalesService, private readonly treasury: TreasuryService) {}

  hashApiKey(key: string): string { return createHash('sha256').update(`${compatPepper()}:${key}`).digest('hex'); }

  async createDevice(tenantId: string, input: DeviceInput) {
    const apiKey = `ck_${randomBytes(24).toString('base64url')}`;
    const id = newId();
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) => tx.insert(compatDevices).values({ id, tenantId, name: input.name, branchId: input.branchId, apiKeyHash: this.hashApiKey(apiKey), enumMaps: input.enumMaps ?? {} }).returning());
    if (!row) throw new DomainError('INTERNAL', 'Device creation failed', 500);
    return { data: { ...maskDevice(row), apiKey } };
  }

  async listDevices(tenantId: string) { return { data: await withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(compatDevices).where(eq(compatDevices.tenantId, tenantId))) }; }
  async revokeDevice(tenantId: string, id: string) { await withTenantTx(this.database.db, tenantId, (tx) => tx.update(compatDevices).set({ status: 'revoked', updatedAt: new Date() }).where(and(eq(compatDevices.tenantId, tenantId), eq(compatDevices.id, id)))); return { data: { id, status: 'revoked' } }; }

  /**
   * Operator-facing view of the sync plane: which devices talk to us, how far each has
   * pulled, and how many documents each entity has received from the legacy clients.
   */
  async syncOverview(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const devices = await tx
        .select({ id: compatDevices.id, name: compatDevices.name, branchId: compatDevices.branchId, branchName: branches.nameAr, status: compatDevices.status, lastSeenAt: compatDevices.lastSeenAt, cursors: compatDevices.cursors })
        .from(compatDevices)
        .leftJoin(branches, eq(branches.id, compatDevices.branchId))
        .where(eq(compatDevices.tenantId, tenantId));
      const counts = await tx.execute(sql`
        SELECT 'invoices' AS entity, count(*)::int AS received, max(updated_at) AS last_at
        FROM sales_invoices WHERE tenant_id = ${tenantId} AND legacy_source = 'compat'
        UNION ALL
        SELECT 'vouchers', count(*)::int, max(updated_at) FROM vouchers WHERE tenant_id = ${tenantId} AND legacy_source = 'compat'
        UNION ALL
        SELECT 'journals', count(*)::int, max(updated_at) FROM journal_entries WHERE tenant_id = ${tenantId} AND legacy_source = 'compat'
        UNION ALL
        SELECT 'stock', count(*)::int, max(tx.occurred_at) FROM inventory_transactions tx
        WHERE tx.tenant_id = ${tenantId} AND tx.doc_id IN (SELECT id FROM sales_invoices WHERE tenant_id = ${tenantId} AND legacy_source = 'compat')`);
      const rows = Array.isArray(counts) ? counts : ((counts as { rows?: unknown[] }).rows ?? []);
      const masters = await tx.execute(sql`
        SELECT 'items' AS entity, count(*)::int AS available, max(updated_at) AS last_at FROM items WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        UNION ALL SELECT 'parties', count(*)::int, max(updated_at) FROM parties WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        UNION ALL SELECT 'accounts', count(*)::int, max(updated_at) FROM accounts WHERE tenant_id = ${tenantId} AND deleted_at IS NULL
        UNION ALL SELECT 'tax-groups', count(*)::int, max(updated_at) FROM tax_groups WHERE tenant_id = ${tenantId}`);
      return { data: { devices, inbound: rows, master: Array.isArray(masters) ? masters : ((masters as { rows?: unknown[] }).rows ?? []) } };
    });
  }

  /** Recent documents that arrived from the legacy clients, per entity. */
  async syncDocuments(tenantId: string, entity: string) {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      if (entity === 'vouchers') {
        return { data: await tx.select({ id: vouchers.id, number: vouchers.number, legacyId: vouchers.legacyId, kind: vouchers.kind, date: vouchers.date, amount: vouchers.amount, status: vouchers.status, updatedAt: vouchers.updatedAt }).from(vouchers).where(and(eq(vouchers.tenantId, tenantId), eq(vouchers.legacySource, 'compat'))).orderBy(desc(vouchers.updatedAt)).limit(200) };
      }
      if (entity === 'journals') {
        return { data: await tx.select({ id: journalEntries.id, number: journalEntries.number, legacyId: journalEntries.legacyId, date: journalEntries.date, kind: journalEntries.kind, status: journalEntries.status, updatedAt: journalEntries.updatedAt }).from(journalEntries).where(and(eq(journalEntries.tenantId, tenantId), eq(journalEntries.legacySource, 'compat'))).orderBy(desc(journalEntries.updatedAt)).limit(200) };
      }
      if (entity === 'stock') {
        return { data: await tx.select({ id: inventoryTransactions.id, occurredAt: inventoryTransactions.occurredAt, itemName: items.nameAr, warehouseName: warehouses.name, direction: inventoryTransactions.direction, qty: inventoryTransactions.qty, totalCost: inventoryTransactions.totalCost, docType: inventoryTransactions.docType, legacyId: salesInvoices.legacyId }).from(inventoryTransactions).innerJoin(salesInvoices, and(eq(salesInvoices.id, inventoryTransactions.docId), eq(salesInvoices.legacySource, 'compat'))).leftJoin(items, eq(items.id, inventoryTransactions.itemId)).leftJoin(warehouses, eq(warehouses.id, inventoryTransactions.warehouseId)).where(eq(inventoryTransactions.tenantId, tenantId)).orderBy(desc(inventoryTransactions.occurredAt)).limit(200) };
      }
      return { data: await tx.select({ id: salesInvoices.id, number: salesInvoices.number, legacyId: salesInvoices.legacyId, kind: salesInvoices.kind, total: salesInvoices.total, status: salesInvoices.status, paymentStatus: salesInvoices.paymentStatus, updatedAt: salesInvoices.updatedAt }).from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.legacySource, 'compat'))).orderBy(desc(salesInvoices.updatedAt)).limit(200) };
    });
  }

  async authDevice(tenantId: string, apiKey: string): Promise<{ data: { accessToken: string; deviceId: string; branchId: string; expiresIn: number } }> {
    const hash = this.hashApiKey(apiKey);
    const device = await withTenantTx(this.database.db, tenantId, async (tx) => {
      const rows = await tx.select().from(compatDevices).where(and(eq(compatDevices.tenantId, tenantId), eq(compatDevices.apiKeyHash, hash))).limit(1);
      return rows[0];
    });
    if (!device || device.status !== 'active' || !safeEqual(hash, device.apiKeyHash)) throw new DomainError('UNAUTHENTICATED', 'Device key is invalid or revoked', 401);
    const token = `compat_${randomBytes(32).toString('base64url')}`;
    sessions.set(token, { tenantId, deviceId: device.id, expiresAt: Date.now() + 15 * 60_000 });
    await this.touchDevice(tenantId, device.id);
    return { data: { accessToken: token, deviceId: device.id, branchId: device.branchId, expiresIn: 900 } };
  }

  async master(tenantId: string, token: string, entity: 'items' | 'parties' | 'accounts' | 'tax-groups', since?: string) {
    const session = await this.requireSession(tenantId, token);
    await this.rateLimit(tenantId, session.device.id);
    const cursor = parseCursor(since);
    const rows = await withTenantTx(this.database.db, tenantId, async (tx) => {
      if (entity === 'items') return tx.select().from(items).where(and(eq(items.tenantId, tenantId), cursorPredicate('items', cursor))).orderBy(items.updatedAt, items.id).limit(200);
      if (entity === 'parties') return tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), cursorPredicate('parties', cursor))).orderBy(parties.updatedAt, parties.id).limit(200);
      if (entity === 'accounts') return tx.select().from(accounts).where(and(eq(accounts.tenantId, tenantId), cursorPredicate('accounts', cursor))).orderBy(accounts.updatedAt, accounts.id).limit(200);
      return tx.select().from(taxGroups).where(and(eq(taxGroups.tenantId, tenantId), cursorPredicate('tax-groups', cursor))).orderBy(taxGroups.updatedAt, taxGroups.id).limit(200);
    });
    const nextCursor = rows.length ? encodeCursor({ updatedAt: String((rows[rows.length - 1] as { updatedAt?: Date; createdAt?: Date }).updatedAt ?? (rows[rows.length - 1] as { createdAt?: Date }).createdAt ?? new Date()), id: String((rows[rows.length - 1] as { id: string }).id) }) : since ?? '';
    return { data: rows.map((row) => ({ ...row, tombstone: Boolean((row as { deletedAt?: Date | null }).deletedAt) })), meta: { nextCursor, limit: 200, branchId: session.device.branchId } };
  }

  async pushSale(tenantId: string, token: string, body: LegacySalesInvoiceDto, idempotencyKey?: string) {
    const session = await this.requireSession(tenantId, token);
    await this.rateLimit(tenantId, session.device.id);
    const mapped = mapLegacySale({ ...body, BranchID: body.BranchID ?? session.device.branchId }, session.device.enumMaps);
    const existing = await this.status(tenantId, mapped.legacyId);
    if (existing.data.found) return { data: { duplicate: true, ...existing.data } };
    const invoice = await this.sales.create(tenantId, mapped);
    await withTenantTx(this.database.db, tenantId, (tx) => tx.update(salesInvoices).set({ legacySource: 'compat', legacyId: mapped.legacyId, updatedAt: new Date() }).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, invoice.id))));
    const posted = await this.sales.post(tenantId, invoice.id);
    return { data: { duplicate: false, legacyId: mapped.legacyId, cloudId: posted.id, number: posted.number, idempotencyKey: idempotencyKey ?? mapped.legacyId } };
  }

  async pushVoucher(tenantId: string, token: string, body: LegacyVoucherDto, idempotencyKey?: string) {
    const session = await this.requireSession(tenantId, token);
    await this.rateLimit(tenantId, session.device.id);
    const mapped = mapLegacyVoucher({ ...body, BranchID: body.BranchID ?? session.device.branchId }, session.device.enumMaps);
    const existing = await this.status(tenantId, mapped.legacyId);
    if (existing.data.found) return { data: { duplicate: true, ...existing.data } };
    const voucher = await this.treasury.createVoucher(tenantId, { ...mapped, idempotencyKey: idempotencyKey ?? mapped.legacyId });
    await withTenantTx(this.database.db, tenantId, (tx) => tx.update(vouchers).set({ legacySource: 'compat', legacyId: mapped.legacyId, updatedAt: new Date() }).where(and(eq(vouchers.tenantId, tenantId), eq(vouchers.id, voucher?.id ?? ''))));
    const posted = await this.treasury.postVoucher(tenantId, voucher!.id);
    return { data: { duplicate: false, legacyId: mapped.legacyId, cloudId: posted.id, number: posted.number } };
  }

  async cursor(tenantId: string, token: string, entity?: string, cursor?: string) {
    const session = await this.requireSession(tenantId, token);
    const cursors = { ...(session.device.cursors ?? {}) };
    const parsed = parseCursor(cursor);
    if (entity && parsed) cursors[entity] = parsed;
    if (entity && parsed) await withTenantTx(this.database.db, tenantId, (tx) => tx.update(compatDevices).set({ cursors, updatedAt: new Date() }).where(and(eq(compatDevices.tenantId, tenantId), eq(compatDevices.id, session.device.id))));
    return { data: { deviceId: session.device.id, cursors } };
  }

  async status(tenantId: string, legacyId: string) {
    const db = this.database.db;
    return withTenantTx(db, tenantId, async (tx) => {
      const sale = (await tx.select({ id: salesInvoices.id, number: salesInvoices.number, status: salesInvoices.status }).from(salesInvoices).where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.legacySource, 'compat'), eq(salesInvoices.legacyId, legacyId))).limit(1))[0];
      if (sale) return { data: { found: true, entity: 'sales_invoice', legacyId, cloudId: sale.id, number: sale.number, status: sale.status } };
      const voucher = (await tx.select({ id: vouchers.id, number: vouchers.number, status: vouchers.status }).from(vouchers).where(and(eq(vouchers.tenantId, tenantId), eq(vouchers.legacySource, 'compat'), eq(vouchers.legacyId, legacyId))).limit(1))[0];
      if (voucher) return { data: { found: true, entity: 'voucher', legacyId, cloudId: voucher.id, number: voucher.number, status: voucher.status } };
      return { data: { found: false, legacyId } };
    });
  }

  private async requireSession(tenantId: string, token: string): Promise<DeviceSession> {
    const session = sessions.get(token);
    if (!session || session.tenantId !== tenantId || session.expiresAt < Date.now()) throw new DomainError('UNAUTHENTICATED', 'Compat token is invalid or expired', 401);
    const device = await withTenantTx(this.database.db, tenantId, async (tx) => (await tx.select().from(compatDevices).where(and(eq(compatDevices.tenantId, tenantId), eq(compatDevices.id, session.deviceId))).limit(1))[0]);
    if (!device || device.status !== 'active') throw new DomainError('UNAUTHENTICATED', 'Device is revoked', 401);
    await this.touchDevice(tenantId, device.id);
    return { device, token };
  }

  private async touchDevice(tenantId: string, id: string) { await withTenantTx(this.database.db, tenantId, (tx) => tx.update(compatDevices).set({ lastSeenAt: new Date() }).where(and(eq(compatDevices.tenantId, tenantId), eq(compatDevices.id, id)))); }
  private async rateLimit(_tenantId: string, _id: string) { return true; }
}

function cursorPredicate(entity: string, cursor?: Cursor) {
  const table = entity === 'items' ? items : entity === 'parties' ? parties : entity === 'accounts' ? accounts : taxGroups;
  if (!cursor) return sql`true`;
  const instant = new Date(cursor.updatedAt);
  return or(gt(table.updatedAt, instant), and(eq(table.updatedAt, instant), gt(table.id, cursor.id))) ?? sql`true`;
}
function parseCursor(value?: string): Cursor | undefined { if (!value) return undefined; try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Cursor; } catch { throw new DomainError('VALIDATION_FAILED', 'Invalid cursor', 422); } }
function encodeCursor(cursor: Cursor): string { return Buffer.from(JSON.stringify(cursor)).toString('base64url'); }
function safeEqual(left: string, right: string): boolean { const a = Buffer.from(left); const b = Buffer.from(right); return a.length === b.length && timingSafeEqual(a, b); }
function maskDevice(row: CompatDevice) { return { id: row.id, tenantId: row.tenantId, name: row.name, branchId: row.branchId, status: row.status, lastSeenAt: row.lastSeenAt, cursors: row.cursors }; }
