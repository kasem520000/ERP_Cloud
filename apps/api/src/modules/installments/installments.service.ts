import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { and, asc, eq, isNull, lte, sql } from 'drizzle-orm';
import { DomainError, newId } from '@erp/contracts';
import { installmentContracts, installmentSchedule, tenantSettings, withTenantTx, type DatabaseHandle } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { SequencesService } from '../platform-services/index.js';
import { TreasuryService } from '../treasury/treasury.service.js';

import { generateInstallmentSchedule } from './installment-calculator.js';

export type ContractInput = { branchId: string; partyId: string; itemId?: string; sourceInvoiceId?: string; contractValue: string; downPayment?: string; installmentCount: number; periodUnit?: 'days' | 'months'; periodEvery?: number; firstDueDate: string; earlySettlementDiscount?: string; scheduleLines?: Array<{ dueDate: string; dueValue: string }> };
export type CollectInput = { branchId: string; cashLocationId: string; paidValue: string; method?: 'cash' | 'cheque' | 'bank_transfer' | 'card' };

@Injectable()
export class InstallmentsService {
  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle, private readonly sequences: SequencesService, private readonly treasury: TreasuryService) {}
  async ensureEnabled(tenantId: string) { const [flag] = await withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(tenantSettings).where(and(eq(tenantSettings.tenantId, tenantId), eq(tenantSettings.key, 'pack.installments'))).limit(1)); if (flag && flag.value !== true && flag.value !== 'true') throw new DomainError('NOT_FOUND', 'Installments pack is disabled for this tenant', 404); }
  async list(tenantId: string) { await this.ensureEnabled(tenantId); return { data: await withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(installmentContracts).where(and(eq(installmentContracts.tenantId, tenantId), isNull(installmentContracts.deletedAt))).orderBy(installmentContracts.createdAt)) }; }
  async create(tenantId: string, input: ContractInput) { await this.ensureEnabled(tenantId); const id = newId(); const lines = input.scheduleLines?.length ? input.scheduleLines.map((line, index) => ({ lineNo: index + 1, dueDate: line.dueDate, dueValue: line.dueValue })) : generateInstallmentSchedule({ contractValue: input.contractValue, downPayment: input.downPayment ?? '0', count: input.installmentCount, firstDueDate: input.firstDueDate, periodUnit: input.periodUnit ?? 'months', periodEvery: input.periodEvery ?? 1 }); const expected = new Decimal(input.contractValue).minus(input.downPayment ?? '0'); const actual = lines.reduce((sum, line) => sum.plus(line.dueValue), new Decimal(0)); if (!actual.eq(expected)) throw new DomainError('INSTALLMENT_SCHEDULE_INVALID', 'Schedule total must match contract value less down payment', 422); await withTenantTx(this.database.db, tenantId, async (tx) => { const allocated = await this.sequences.next({ tenantId, branchId: input.branchId, docType: 'installment_contract' }, tx, { prefix: 'IC-', padding: 6 }); await tx.insert(installmentContracts).values({ id, tenantId, branchId: input.branchId, partyId: input.partyId, itemId: input.itemId, sourceInvoiceId: input.sourceInvoiceId, number: allocated.display, contractValue: input.contractValue, downPayment: input.downPayment ?? '0', installmentCount: input.installmentCount, periodUnit: input.periodUnit ?? 'months', periodEvery: input.periodEvery ?? 1, firstDueDate: input.firstDueDate, status: 'active', earlySettlementDiscount: input.earlySettlementDiscount ?? '0', summary: { scheduleSum: lines.reduce((sum, line) => sum.plus(line.dueValue), new Decimal(0)).toFixed(4) } }); await tx.insert(installmentSchedule).values(lines.map((line) => ({ id: newId(), tenantId, contractId: id, lineNo: line.lineNo, dueDate: line.dueDate, dueValue: line.dueValue }))); }); return this.read(tenantId, id); }
  async read(tenantId: string, id: string) { await this.ensureEnabled(tenantId); const [contract] = await withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(installmentContracts).where(and(eq(installmentContracts.tenantId, tenantId), eq(installmentContracts.id, id))).limit(1)); if (!contract) throw new DomainError('NOT_FOUND', 'Installment contract not found', 404); const schedule = await withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(installmentSchedule).where(and(eq(installmentSchedule.tenantId, tenantId), eq(installmentSchedule.contractId, id))).orderBy(installmentSchedule.lineNo)); return { data: { ...contract, schedule } }; }
  async overdue(tenantId: string, asOf = new Date().toISOString().slice(0, 10)) { await this.ensureEnabled(tenantId); return { data: await withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(installmentSchedule).where(and(eq(installmentSchedule.tenantId, tenantId), lte(installmentSchedule.dueDate, asOf), sql`paid_value < due_value`)).orderBy(installmentSchedule.dueDate)) }; }
  async collect(tenantId: string, contractId: string, input: CollectInput) {
    await this.ensureEnabled(tenantId);
    const contract = await this.read(tenantId, contractId);
    const paidValue = new Decimal(input.paidValue);
    if (!paidValue.isFinite() || paidValue.lte(0)) {
      throw new DomainError('INSTALLMENT_PAYMENT_INVALID', 'Paid value must be positive', 422);
    }

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(installmentSchedule)
        .where(and(eq(installmentSchedule.tenantId, tenantId), eq(installmentSchedule.contractId, contractId)))
        .orderBy(asc(installmentSchedule.lineNo))
        .for('update');

      // ACC-055: حساب المتبقي على العقد ومنع التحصيل الزائد
      const totalUnpaid = rows.reduce(
        (sum, r) => sum.plus(Decimal.max(0, new Decimal(r.dueValue).minus(r.paidValue))),
        new Decimal(0),
      );
      if (paidValue.gt(totalUnpaid)) {
        throw new DomainError(
          'INSTALLMENT_OVERCOLLECT',
          `Payment amount (${paidValue.toFixed(2)}) exceeds contract remaining due (${totalUnpaid.toFixed(2)})`,
          422,
        );
      }

      // ACC-054: إنشاء وترحيل سند القبض ذرّياً داخل المعاملة
      const branchId = input.branchId || contract.data.branchId;
      const voucher = await this.treasury.createVoucherInTx(tx, tenantId, {
        branchId,
        kind: 'receipt',
        subtype: 'customer',
        partyId: contract.data.partyId,
        cashLocationId: input.cashLocationId,
        method: input.method ?? 'cash',
        amount: input.paidValue,
        netAmount: input.paidValue,
        date: new Date().toISOString().slice(0, 10),
        idempotencyKey: `installment:${contractId}:${Date.now()}`,
      });
      if (!voucher) throw new DomainError('INTERNAL', 'Failed to create installment receipt voucher', 500);

      const postedVoucher = await this.treasury.postVoucherInTx(tx, tenantId, voucher.id);

      let remaining = paidValue;
      for (const row of rows) {
        if (remaining.lte(0)) break;
        const dueLeft = new Decimal(row.dueValue).minus(row.paidValue);
        if (dueLeft.lte(0)) continue;
        const applied = Decimal.min(dueLeft, remaining);
        const nextPaid = new Decimal(row.paidValue).plus(applied);
        remaining = remaining.minus(applied);
        await tx
          .update(installmentSchedule)
          .set({
            paidValue: nextPaid.toFixed(4),
            status: nextPaid.gte(row.dueValue) ? 'paid' : 'partial',
            voucherId: postedVoucher.id,
            collectedAt: new Date(),
          })
          .where(and(eq(installmentSchedule.tenantId, tenantId), eq(installmentSchedule.id, row.id)));
      }

      const remainingUnpaid = totalUnpaid.minus(paidValue);
      if (remainingUnpaid.lte(0)) {
        await tx
          .update(installmentContracts)
          .set({ status: 'closed', updatedAt: new Date() })
          .where(and(eq(installmentContracts.tenantId, tenantId), eq(installmentContracts.id, contractId)));
      }

      const updatedContract = await tx
        .select()
        .from(installmentContracts)
        .where(and(eq(installmentContracts.tenantId, tenantId), eq(installmentContracts.id, contractId)))
        .limit(1);
      const updatedSchedule = await tx
        .select()
        .from(installmentSchedule)
        .where(and(eq(installmentSchedule.tenantId, tenantId), eq(installmentSchedule.contractId, contractId)))
        .orderBy(installmentSchedule.lineNo);

      return { data: { ...updatedContract[0], schedule: updatedSchedule } };
    });
  }
}
