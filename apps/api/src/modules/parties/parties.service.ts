/* eslint-disable no-restricted-syntax, import/order */
import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { DomainError, errorCodes, newId } from '@erp/contracts';
import { accounts, arReminderEvents, arWriteoffs, journalEntries, journalEntryLines, parties, partyContacts, paymentAllocations, paymentMethods, purchaseInvoices, salesInvoices, vouchers, withTenantTx, type DatabaseHandle } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { CustomFieldsService } from '../custom-fields/custom-fields.service.js';
import { isUniqueViolation } from '../organization/shared/org-support.js';

export type PaymentMethodInput = { code: string; nameAr: string; nameEn?: string; kind?: 'cash' | 'card' | 'transfer' | 'cheque' | 'credit'; dueDays?: number; cashLocationId?: string; isActive?: boolean; isDefault?: boolean };
export type PartyInput = { kind: 'customer' | 'supplier' | 'both'; name: string; paymentMethodId?: string; legalName?: string; taxNo?: string; nationalId?: string; address?: Record<string, string | undefined>; phone?: string; email?: string; receivableAccountId?: string; payableAccountId?: string; creditLimit?: string; /** ACC-105 / MF-08 */ paymentTermsDays?: number | null; /** ACC-105 / MF-08 */ creditHold?: boolean; isOwner?: boolean; isContractor?: boolean; branchId?: string };
export type ContactInput = { name: string; role?: string; phone?: string; email?: string; isPrimary?: boolean };
export type AllocationInput = { partyId: string; voucherId?: string; invoiceKind: string; invoiceId: string; amount: string; invoiceTotal?: string; alreadyAllocated?: string };

@Injectable()
export class PartiesService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly customFields: CustomFieldsService,
  ) {}
  async list(tenantId: string, kind?: string) {
    const rows = await withTenantTx(this.database.db, tenantId, async (tx) => {
      // Ensure provisioned tenants always have the default general customer (`عميل عام`)
      // and general supplier (`مورد عام`).
      const hasDefaultAccounts = await tx
        .select({ id: accounts.id })
        .from(accounts)
        .where(and(eq(accounts.tenantId, tenantId), isNull(accounts.deletedAt), sql`${accounts.code} IN ('12310001', '22111001')`))
        .limit(1);
      if (hasDefaultAccounts.length > 0) {
        const existingDefaults = await tx
          .select({ code: parties.code, name: parties.name })
          .from(parties)
          .where(
            and(
              eq(parties.tenantId, tenantId),
              isNull(parties.deletedAt),
              sql`(${parties.code} IN ('CUST-GEN', 'SUPP-GEN') OR ${parties.name} IN ('عميل عام', 'مورد عام'))`,
            ),
          );
        const hasCustomer = existingDefaults.some((p) => p.code === 'CUST-GEN' || p.name === 'عميل عام');
        const hasSupplier = existingDefaults.some((p) => p.code === 'SUPP-GEN' || p.name === 'مورد عام');
        if (!hasCustomer) {
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
            })
            .onConflictDoNothing();
        }
        if (!hasSupplier) {
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
            })
            .onConflictDoNothing();
        }
      }
      return tx
        .select()
        .from(parties)
        .where(and(eq(parties.tenantId, tenantId), isNull(parties.deletedAt), kind ? eq(parties.kind, kind) : undefined))
        .orderBy(desc(parties.createdAt))
        .limit(100);
    });
    return this.customFields.decorate(tenantId, 'party', rows);
  }
  /**
   * 🔑 R6 — «عميل/مورد» بمعرّفٍ لا وجود له كان يعيد `undefined`، فيخرج الردّ **200 بجسمٍ
   * فارغ**: لا هو نجاحٌ يفهمه العميل ولا خطأٌ يشرح السبب. والغياب يُعلَن: `PARTY_NOT_FOUND`
   * **404**. وهذا يحمي التعديل والحذف كذلك — كانا يكتبان صفرَ صفوف ثم يعيدان الفراغ نفسه.
   */
  async get(tenantId: string, id: string) {
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(parties).where(and(eq(parties.tenantId, tenantId), eq(parties.id, id), isNull(parties.deletedAt))));
    if (!row) throw new DomainError(errorCodes.PARTY_NOT_FOUND, 'Party was not found', 404);
    const [decorated] = await this.customFields.decorate(tenantId, 'party', [row]);
    return decorated ?? row;
  }
  async update(tenantId: string, id: string, input: Partial<PartyInput>) { await withTenantTx(this.database.db, tenantId, (tx) => tx.update(parties).set({ ...input, updatedAt: new Date(), version: sql`${parties.version} + 1` }).where(and(eq(parties.tenantId, tenantId), eq(parties.id, id), isNull(parties.deletedAt)))); return this.get(tenantId, id); }
  async create(tenantId: string, input: PartyInput) {
    const resolvedName = (
      input?.name ??
      (input as { nameAr?: string } | undefined)?.nameAr ??
      ''
    ).trim();
    if (!resolvedName) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'Party name is required', 422);
    }
    const id = newId();
    const explicitCode = (input as { code?: string } | undefined)?.code?.trim();
    const code = await withTenantTx(this.database.db, tenantId, async (tx) => {
      if (explicitCode) return explicitCode;
      const result = await tx.execute(
        sql`SELECT COALESCE(MAX(CAST(code AS INTEGER)), 0) + 1 AS next FROM parties WHERE tenant_id = ${tenantId} AND code ~ '^[0-9]+$'`,
      );
      return String(Number((result.rows[0] as { next: string }).next).toString().padStart(6, '0'));
    });
    const { nameAr: _ignoredNameAr, ...restInput } = input as PartyInput & { nameAr?: string };
    await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.insert(parties).values({
        id,
        tenantId,
        ...restInput,
        code,
        name: resolvedName,
        creditLimit: input.creditLimit ?? '0',
      }),
    );
    return this.get(tenantId, id);
  }
  /**
   * 🗑️ حذف عميل — `frmCustomers`. A party with a balance stays: the refusal protects the
   * ledger, not the row.
   *
   * The comparison is numeric on purpose. `partyBalance` returns money as four-decimal
   * strings, so comparing them to `'0'` refused **every** delete — a عميل with no
   * movement at all could never be removed. Found by `scripts/verify-tailoring.mjs`.
   */
  async softDelete(tenantId: string, id: string) {
    await this.get(tenantId, id);
    const balance = await this.partyBalance(tenantId, id);
    const receivable = new Decimal(balance.receivable);
    const payable = new Decimal(balance.payable);
    if (!receivable.isZero() || !payable.isZero() || balance.open.length)
      throw new DomainError('PARTY_HAS_OPEN_BALANCE', 'Party has an open balance and cannot be deleted', 422);
    await withTenantTx(this.database.db, tenantId, (tx) => tx.update(parties).set({ deletedAt: new Date() }).where(and(eq(parties.tenantId, tenantId), eq(parties.id, id))));
  }
  async contacts(tenantId: string, partyId: string) {
    // جهات الاتصال موردٌ تابع: عميلٌ غير موجود لا تكون له قائمةٌ فارغة، بل 404.
    await this.get(tenantId, partyId);
    return withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(partyContacts).where(and(eq(partyContacts.tenantId, tenantId), eq(partyContacts.partyId, partyId), isNull(partyContacts.deletedAt)))); }
  async addContact(tenantId: string, partyId: string, input: ContactInput) { const id = newId(); await withTenantTx(this.database.db, tenantId, (tx) => tx.insert(partyContacts).values({ id, partyId, tenantId, ...input })); return this.contacts(tenantId, partyId); }
  async removeContact(tenantId: string, partyId: string, id: string) { await withTenantTx(this.database.db, tenantId, (tx) => tx.update(partyContacts).set({ deletedAt: new Date() }).where(and(eq(partyContacts.tenantId, tenantId), eq(partyContacts.partyId, partyId), eq(partyContacts.id, id)))); return this.contacts(tenantId, partyId); }
  async listPaymentMethods(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(paymentMethods).where(and(eq(paymentMethods.tenantId, tenantId), isNull(paymentMethods.deletedAt))).orderBy(paymentMethods.code));
  }

  /**
   * Only one method can be the default, so promoting one demotes the rest inside the same
   * transaction — the partial unique index would reject the second default anyway, and
   * failing after a partial write would leave the tenant with none.
   */
  async createPaymentMethod(tenantId: string, input: PaymentMethodInput) {
    const id = newId();
    if (input.dueDays !== undefined && (!Number.isInteger(input.dueDays) || input.dueDays < 0)) {
      throw new DomainError('PAYMENT_METHOD_DUE_DAYS_INVALID', 'Due days must be a whole number of days', 422);
    }
    try {
      await withTenantTx(this.database.db, tenantId, async (tx) => {
      if (input.isDefault) await tx.update(paymentMethods).set({ isDefault: false }).where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.isDefault, true)));
      await tx.insert(paymentMethods).values({
        id,
        tenantId,
        code: input.code,
        nameAr: input.nameAr,
        nameEn: input.nameEn,
        kind: input.kind ?? 'cash',
        dueDays: input.dueDays ?? 0,
        cashLocationId: input.cashLocationId,
        isActive: input.isActive ?? true,
        isDefault: input.isDefault ?? false,
      });
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new DomainError('PAYMENT_METHOD_CODE_TAKEN', 'Another payment method already uses this code', 422);
      throw error;
    }
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(paymentMethods).where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.id, id))));
    return row;
  }

  async updatePaymentMethod(tenantId: string, id: string, input: Partial<PaymentMethodInput>) {
    await withTenantTx(this.database.db, tenantId, async (tx) => {
      if (input.isDefault) await tx.update(paymentMethods).set({ isDefault: false }).where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.isDefault, true)));
      await tx.update(paymentMethods).set({ ...input, updatedAt: new Date(), version: sql`${paymentMethods.version} + 1` }).where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.id, id), isNull(paymentMethods.deletedAt)));
    });
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(paymentMethods).where(and(eq(paymentMethods.tenantId, tenantId), eq(paymentMethods.id, id))));
    if (!row) throw new DomainError('PAYMENT_METHOD_NOT_FOUND', 'Payment method was not found', 404);
    return row;
  }

  async allocate(tenantId: string, input: AllocationInput) {
    const amount = new Decimal(input.amount);
    if (!amount.isFinite() || amount.lte(0)) {
      throw new DomainError('ALLOCATION_AMOUNT_INVALID', 'Allocation amount must be positive', 422);
    }

    const id = newId();
    await withTenantTx(this.database.db, tenantId, async (tx) => {
      // ACC-049: 1. التحقق من وجود السند وحالته والطرف
      if (input.voucherId) {
        const [voucher] = await tx
          .select()
          .from(vouchers)
          .where(and(eq(vouchers.tenantId, tenantId), eq(vouchers.id, input.voucherId)))
          .for('update');
        if (!voucher) throw new DomainError('VOUCHER_NOT_FOUND', 'Voucher was not found', 404);
        if (voucher.status !== 'posted') throw new DomainError('VOUCHER_NOT_POSTED', 'Cannot allocate an unposted voucher', 422);
        if (voucher.partyId && voucher.partyId !== input.partyId) {
          throw new DomainError('ALLOCATION_PARTY_MISMATCH', 'Voucher party does not match allocation party', 422);
        }

        // 2. التحقق من رصيد السند المتاح
        const existingVoucherAllocs = await tx
          .select({ amount: paymentAllocations.amount })
          .from(paymentAllocations)
          .where(and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.voucherId, input.voucherId)));
        const voucherAllocatedTotal = existingVoucherAllocs.reduce((sum, r) => sum.plus(r.amount), new Decimal(0));
        const voucherRemaining = Decimal.max(0, new Decimal(voucher.amount).minus(voucherAllocatedTotal));
        if (amount.gt(voucherRemaining)) {
          throw new DomainError('ALLOCATION_EXCEEDS_VOUCHER_AMOUNT', 'Allocation exceeds available voucher balance', 422);
        }
      }

      // ACC-049: 3. التحقق من وجود الفاتورة ومطابقتها للطرف ومتبقي رصيدها
      let invoiceTotal = new Decimal(0);
      let invoicePaidTotal = new Decimal(0);
      let invoicePartyId: string | null = null;
      let invoiceStatus = '';

      if (input.invoiceKind === 'sale' || input.invoiceKind === 'sales') {
        const [inv] = await tx
          .select({
            total: salesInvoices.total,
            paidTotal: salesInvoices.paidTotal,
            partyId: salesInvoices.partyId,
            status: salesInvoices.status,
          })
          .from(salesInvoices)
          .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, input.invoiceId)))
          .for('update');
        if (!inv) throw new DomainError('INVOICE_NOT_FOUND', 'Sales invoice was not found', 404);
        invoiceTotal = new Decimal(inv.total);
        invoicePaidTotal = new Decimal(inv.paidTotal ?? '0');
        invoicePartyId = inv.partyId;
        invoiceStatus = inv.status;
      } else if (input.invoiceKind === 'purchase') {
        const [inv] = await tx
          .select({
            total: purchaseInvoices.total,
            paidTotal: purchaseInvoices.paidTotal,
            partyId: purchaseInvoices.partyId,
            status: purchaseInvoices.status,
          })
          .from(purchaseInvoices)
          .where(and(eq(purchaseInvoices.tenantId, tenantId), eq(purchaseInvoices.id, input.invoiceId)))
          .for('update');
        if (!inv) throw new DomainError('INVOICE_NOT_FOUND', 'Purchase invoice was not found', 404);
        invoiceTotal = new Decimal(inv.total);
        invoicePaidTotal = new Decimal(inv.paidTotal ?? '0');
        invoicePartyId = inv.partyId;
        invoiceStatus = inv.status;
      } else {
        throw new DomainError('INVALID_INVOICE_KIND', 'Invoice kind must be sale or purchase', 422);
      }

      if (invoicePartyId && invoicePartyId !== input.partyId) {
        throw new DomainError('ALLOCATION_PARTY_MISMATCH', 'Invoice party does not match allocation party', 422);
      }
      if (invoiceStatus === 'draft' || invoiceStatus === 'voided' || invoiceStatus === 'cancelled') {
        throw new DomainError('INVOICE_NOT_POSTED', 'Cannot allocate payment to unposted or voided invoice', 422);
      }

      const invoiceRemaining = Decimal.max(0, invoiceTotal.minus(invoicePaidTotal));
      if (amount.gt(invoiceRemaining)) {
        throw new DomainError('ALLOCATION_EXCEEDS_INVOICE_BALANCE', 'Allocation exceeds open invoice balance', 422);
      }

      await tx.insert(paymentAllocations).values({
        id,
        tenantId,
        partyId: input.partyId,
        voucherId: input.voucherId,
        invoiceKind: input.invoiceKind,
        invoiceId: input.invoiceId,
        amount: amount.toFixed(4),
      });

      // ACC-049: 4. تحديث المدفوع وحالة السداد في الفاتورة
      const newPaid = invoicePaidTotal.plus(amount);
      const newPaymentStatus = newPaid.gte(invoiceTotal) ? 'paid' : (newPaid.gt(0) ? 'partial' : 'unpaid');
      if (input.invoiceKind === 'sale' || input.invoiceKind === 'sales') {
        await tx
          .update(salesInvoices)
          .set({
            paidTotal: newPaid.toFixed(4),
            paymentStatus: newPaymentStatus,
            updatedAt: new Date(),
          })
          .where(and(eq(salesInvoices.tenantId, tenantId), eq(salesInvoices.id, input.invoiceId)));
      } else if (input.invoiceKind === 'purchase') {
        await tx
          .update(purchaseInvoices)
          .set({
            paidTotal: newPaid.toFixed(4),
            paymentStatus: newPaymentStatus,
            updatedAt: new Date(),
          })
          .where(and(eq(purchaseInvoices.tenantId, tenantId), eq(purchaseInvoices.id, input.invoiceId)));
      }
    });
    return { id, ...input, amount: amount.toFixed(4) };
  }
  async partyBalance(tenantId: string, partyId: string, asOf?: string) {
    // رصيد صفرٌ لعميلٍ غير موجود رقمٌ كاذب؛ والكشف مثله. الغياب يُعلَن قبل الحساب.
    await this.get(tenantId, partyId);
    const allRows = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select({
          accountId: journalEntryLines.accountId,
          accountCode: accounts.code,
          accountType: accounts.type,
          debit: journalEntryLines.debit,
          credit: journalEntryLines.credit,
          date: journalEntries.date,
          entryId: journalEntries.id,
          entryNumber: journalEntries.number,
          description: sql<string | null>`coalesce(${journalEntryLines.description}, ${journalEntries.description})`,
          sourceType: journalEntries.sourceType,
          sourceId: journalEntries.sourceId,
        })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.entryId, journalEntries.id))
        .innerJoin(accounts, eq(journalEntryLines.accountId, accounts.id))
        .where(
          and(
            eq(journalEntryLines.tenantId, tenantId),
            eq(journalEntryLines.partyId, partyId),
            eq(journalEntries.status, 'posted'),
            asOf ? sql`${journalEntries.date} <= ${asOf}` : undefined,
          ),
        )
        .orderBy(journalEntries.date, journalEntries.number),
    );
    const isReceivableAccount = (type: string, code: string) =>
      type === 'asset' && !code.startsWith('121') && !code.startsWith('122') && !code.startsWith('127');
    const isPayableAccount = (type: string, code: string) =>
      type === 'liability' && !code.startsWith('2222');
    const rows = allRows.filter(
      (row) => isReceivableAccount(row.accountType, row.accountCode) || isPayableAccount(row.accountType, row.accountCode),
    );
    const receivable = rows
      .filter((row) => isReceivableAccount(row.accountType, row.accountCode))
      .reduce((sum, row) => sum.plus(new Decimal(row.debit).minus(row.credit)), new Decimal(0));
    const payable = rows
      .filter((row) => isPayableAccount(row.accountType, row.accountCode))
      .reduce((sum, row) => sum.plus(new Decimal(row.credit).minus(row.debit)), new Decimal(0));
    const allocations = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select()
        .from(paymentAllocations)
        .where(and(eq(paymentAllocations.tenantId, tenantId), eq(paymentAllocations.partyId, partyId))),
    );
    // MF-17 / D9 — «يظهر في الكشف كمستند»: سجل التذكيرات + مستندات الشطب.
    const writeoffs = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select()
        .from(arWriteoffs)
        .where(and(eq(arWriteoffs.tenantId, tenantId), eq(arWriteoffs.partyId, partyId)))
        .orderBy(desc(arWriteoffs.createdAt))
        .limit(100),
    );
    const reminders = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select()
        .from(arReminderEvents)
        .where(and(eq(arReminderEvents.tenantId, tenantId), eq(arReminderEvents.partyId, partyId)))
        .orderBy(desc(arReminderEvents.dispatchedAt))
        .limit(20),
    );
    // الشطب المعتمد يُضاف إلى تخصيص سطر الفاتورة فيظهر «مغلقاً» في الكشف.
    const writeoffByInvoice = new Map<string, Decimal>();
    for (const w of writeoffs) {
      if (w.status !== 'approved') continue;
      writeoffByInvoice.set(w.invoiceId, (writeoffByInvoice.get(w.invoiceId) ?? new Decimal(0)).plus(new Decimal(w.amount)));
    }
    // ACC-017 + ACC-222 + NEW-02: مطابقة التخصيص على سطور الفواتير فقط (دون تكرارها على سطر السند نفسه)
    return {
      receivable: receivable.toFixed(4),
      payable: payable.toFixed(4),
      reminders,
      writeoffs,
      open: rows.map((row) => ({
        accountId: row.accountId,
        debit: row.debit,
        credit: row.credit,
        date: row.date,
        entryId: row.entryId,
        entryNumber: row.entryNumber,
        description: row.description,
        sourceType: row.sourceType,
        sourceId: row.sourceId,
        allocated:
          row.sourceType === 'voucher'
            ? '0.0000'
            : allocations
                .filter((a) => a.invoiceId === row.sourceId || a.invoiceId === row.entryId)
                .reduce((sum, a) => sum.plus(a.amount), new Decimal(0))
                .plus(row.sourceId ? writeoffByInvoice.get(row.sourceId) ?? new Decimal(0) : new Decimal(0))
                .toFixed(4),
      })),
    };
  }
  async assertCreditAvailable(tenantId: string, partyId: string, newAmount: string, override = false) {
    const party = await this.get(tenantId, partyId);
    if (!party) throw new DomainError(errorCodes.NOT_FOUND, 'Party not found', 404);
    if (!override && new Decimal((await this.partyBalance(tenantId, partyId)).receivable).plus(new Decimal(newAmount)).gt(new Decimal(party.creditLimit))) throw new DomainError('CREDIT_LIMIT_EXCEEDED', 'Credit limit exceeded', 422);
    return true;
  }
}
