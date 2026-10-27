import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { DomainError, newId } from '@erp/contracts';
import {
  boqTerms,
  contractingReturnLines,
  contractingReturns,
  progressBillLines,
  progressBills,
  projects,
  withTenantTx,
  type DatabaseHandle,
  type DrizzleTx,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { AccountingService } from '../accounting/accounting.service.js';
import { tryGetAuthContext } from '../platform/context/tenant-context.js';
import { SequencesService } from '../platform-services/index.js';
import { SalesService } from '../sales/sales.service.js';
import { todayIso } from '../../common/server-date.js';

import { ProjectsService } from './projects.service.js';

export type ContractingReturnInput = {
  billId: string;
  returnDate?: string;
  reason: string;
  lines: Array<{ termId: string; returnValue: string }>;
};

const dec = (input: string | number | null | undefined) => new Decimal(input ?? 0);
const today = () => todayIso();

/**
 * مرتجع مقاولات.
 *
 * A progress bill that has been posted is not editable: it has produced a numbered sales
 * invoice and moved every BOQ term's billed-to-date figure. When measured work is taken
 * back — a rejected section, a re-measurement, scope removed by a change order — the only
 * honest reversal is a second document.
 *
 * Two things have to move together for the reversal to be true, and this service is the
 * only place that guarantees it: the BOQ term must give the value back so it can be
 * re-billed later, and the customer must receive a credit note for what was invoiced. Do
 * one without the other and the project is either double-billed or permanently short of
 * its own contract value.
 */
@Injectable()
export class ContractingReturnsService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly sequences: SequencesService,
    private readonly projectsService: ProjectsService,
    private readonly sales: SalesService,
    private readonly accounting: AccountingService,
  ) {}

  async list(tenantId: string, filters: { projectId?: string; billId?: string; status?: string } = {}) {
    await this.projectsService.ensureEnabled(tenantId);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const rows = await tx
        .select()
        .from(contractingReturns)
        .where(and(
          eq(contractingReturns.tenantId, tenantId),
          filters.projectId ? eq(contractingReturns.projectId, filters.projectId) : undefined,
          filters.billId ? eq(contractingReturns.billId, filters.billId) : undefined,
          filters.status ? eq(contractingReturns.status, filters.status) : undefined,
        ))
        .orderBy(desc(contractingReturns.createdAt))
        .limit(200);
      if (!rows.length) return [];
      const lines = await tx.select().from(contractingReturnLines).where(and(eq(contractingReturnLines.tenantId, tenantId), inArray(contractingReturnLines.returnId, rows.map((row) => row.id))));
      return rows.map((row) => ({ ...row, lines: lines.filter((line) => line.returnId === row.id).sort((a, b) => a.lineNo - b.lineNo) }));
    });
  }

  async get(tenantId: string, id: string) {
    await this.projectsService.ensureEnabled(tenantId);
    return withTenantTx(this.database.db, tenantId, (tx) => this.load(tx, tenantId, id));
  }

  /**
   * What is still returnable on a bill: what the bill certified per term, minus what
   * earlier returns already took back. The screen needs this before it can offer a
   * sensible maximum, and the create path re-derives it rather than trusting the client.
   */
  async returnable(tenantId: string, billId: string) {
    await this.projectsService.ensureEnabled(tenantId);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const bill = await this.loadBill(tx, tenantId, billId);
      const already = await this.returnedByTerm(tx, tenantId, billId);
      const terms = await tx.select().from(boqTerms).where(and(eq(boqTerms.tenantId, tenantId), eq(boqTerms.projectId, bill.projectId)));
      return {
        billId,
        billNumber: bill.number,
        projectId: bill.projectId,
        status: bill.status,
        lines: bill.lines.map((line) => {
          const term = terms.find((row) => row.id === line.termId);
          const returned = already.get(line.termId) ?? new Decimal(0);
          return {
            termId: line.termId,
            code: term?.code ?? '—',
            description: term?.description ?? '—',
            billedValue: dec(line.billValue).toFixed(4),
            returnedValue: returned.toFixed(4),
            returnableValue: Decimal.max(dec(line.billValue).minus(returned), 0).toFixed(4),
          };
        }),
      };
    });
  }

  async create(tenantId: string, input: ContractingReturnInput) {
    await this.projectsService.ensureEnabled(tenantId);
    if (!input.billId) throw new DomainError('CONTRACTING_RETURN_BILL_REQUIRED', 'A return must name the progress bill it reverses', 422);
    if (!input.reason?.trim()) throw new DomainError('CONTRACTING_RETURN_REASON_REQUIRED', 'A return must carry a reason', 422);
    if (!input.lines?.length) throw new DomainError('CONTRACTING_RETURN_LINES_REQUIRED', 'A return needs at least one line', 422);

    const id = newId();
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const bill = await this.loadBill(tx, tenantId, input.billId);
      // A draft bill has moved nothing yet; edit it instead of reversing it.
      if (!['posted', 'released'].includes(bill.status)) {
        throw new DomainError('PROGRESS_BILL_INVALID_STATE', 'Only a posted progress bill can be returned', 409);
      }
      const [project] = await tx.select().from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, bill.projectId)));
      if (!project) throw new DomainError('PROJECT_NOT_FOUND', 'Project was not found', 404);

      const already = await this.returnedByTerm(tx, tenantId, input.billId);
      const seen = new Set<string>();
      const lines = input.lines.map((line, index) => {
        const returnValue = dec(line.returnValue);
        if (!returnValue.isFinite() || returnValue.lte(0)) throw new DomainError('CONTRACTING_RETURN_VALUE_INVALID', 'Every return line needs a value greater than zero', 422);
        if (seen.has(line.termId)) throw new DomainError('CONTRACTING_RETURN_DUPLICATE_TERM', 'A term can only appear once on a return', 422);
        seen.add(line.termId);
        const billLine = bill.lines.find((row) => row.termId === line.termId);
        if (!billLine) throw new DomainError('CONTRACTING_RETURN_TERM_NOT_ON_BILL', 'That term was not billed on this progress bill', 422);
        const remaining = dec(billLine.billValue).minus(already.get(line.termId) ?? new Decimal(0));
        if (returnValue.gt(remaining)) {
          throw new DomainError('CONTRACTING_RETURN_EXCEEDS_BILL', `Only ${remaining.toFixed(4)} of that term is still returnable on this bill`, 422);
        }
        return { lineNo: index + 1, termId: line.termId, returnValue: returnValue.toFixed(4) };
      });

      const returnValue = lines.reduce((sum, line) => sum.plus(line.returnValue), new Decimal(0));
      // Retention was withheld from the original bill, so returning work releases it too.
      const retentionValue = returnValue.mul(dec(project.retentionPct)).div(100);
      const netValue = returnValue.minus(retentionValue);

      const allocated = await this.sequences.next({ tenantId, branchId: project.branchId, docType: 'contracting_return' }, tx, { prefix: 'CTR-', padding: 6 });
      await tx.insert(contractingReturns).values({
        id,
        tenantId,
        projectId: bill.projectId,
        billId: input.billId,
        branchId: project.branchId,
        number: allocated.display,
        returnDate: input.returnDate ?? today(),
        status: 'draft',
        reason: input.reason.trim(),
        returnValue: returnValue.toFixed(4),
        retentionValue: retentionValue.toFixed(4),
        netValue: netValue.toFixed(4),
        createdBy: tryGetAuthContext()?.userId,
      });
      await tx.insert(contractingReturnLines).values(lines.map((line) => ({ ...line, returnId: id, tenantId })));
      return this.load(tx, tenantId, id);
    });
  }

  /**
   * Posting is the moment the reversal becomes real: BOQ terms give their value back and
   * a **draft** credit note is raised against the bill's invoice. The note is posted from
   * the sales-notes screen, which owns the accounts and the fiscal period — the same
   * division of labour as a contractor payment and its treasury voucher.
   */
  async post(tenantId: string, id: string) {
    await this.projectsService.ensureEnabled(tenantId);
    const document = await this.get(tenantId, id);
    if (document.status !== 'draft') throw new DomainError('CONTRACTING_RETURN_INVALID_STATUS', 'Only a draft return can be posted', 409);

    const bill = await withTenantTx(this.database.db, tenantId, (tx) => this.loadBill(tx, tenantId, document.billId));
    const branchId = document.branchId ?? bill.branchId ?? '';
    // ACC-065 (R33): posting a contracting return must reach the ledger — before, it only rewound
    // `boq_terms.previously_billed` and left a *draft* credit note (no number, no journal, AR unchanged,
    // retention untouched). Now:
    //   1. the credit note for the net value is created AND posted (SCN-number, Dr returns / Cr AR);
    //   2. the retained share of the returned work is reversed as well — Dr revenue / Cr the account that
    //      holds the bill's retention (the dedicated retention account when the bill was posted with one,
    //      otherwise AR) — and the bill's `retention_value` drops by the same amount so a later release
    //      pays out the right figure.
    let creditNoteId: string | undefined;
    let retentionEntryId: string | undefined;
    if (bill.invoiceId && dec(document.netValue).gt(0)) {
      const note = await this.sales.createAdjustmentNote(tenantId, bill.invoiceId, {
        branchId,
        kind: 'credit',
        reason: `مرتجع مقاولات ${document.number}: ${document.reason}`,
        amount: dec(document.netValue).toFixed(2),
      });
      creditNoteId = note?.id;
      if (creditNoteId) await this.sales.postAdjustmentNote(tenantId, creditNoteId);
    }
    if (bill.invoiceId && dec(document.retentionValue).gt(0)) {
      const legs = await withTenantTx(this.database.db, tenantId, (tx) => this.billJournalLegs(tx, tenantId, bill.invoiceId!));
      if (legs.revenueAccountId && legs.retentionAccountId) {
        const [project] = await withTenantTx(this.database.db, tenantId, (tx) =>
          tx.select({ partyId: projects.partyId, costCenterId: projects.costCenterId }).from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, document.projectId))).limit(1),
        );
        const entry = await this.accounting.postJournal(tenantId, {
          branchId: branchId || undefined,
          date: document.returnDate ?? today(),
          description: `عكس محتجز مرتجع مقاولات ${document.number} على مستخلص ${bill.number ?? bill.id}`,
          sourceType: 'contracting_return',
          sourceId: document.id,
          idempotencyKey: `contracting-return-retention:${document.id}`,
          lines: [
            { accountId: legs.revenueAccountId, debit: dec(document.retentionValue).toFixed(4), costCenterId: project?.costCenterId ?? undefined, description: `عكس إيراد الجزء المحتجز من المرتجع ${document.number}` },
            { accountId: legs.retentionAccountId, credit: dec(document.retentionValue).toFixed(4), partyId: project?.partyId ?? undefined, costCenterId: project?.costCenterId ?? undefined, description: `تخفيض محتجز مستخلص ${bill.number ?? bill.id}` },
          ],
        });
        retentionEntryId = (entry as { id?: string } | undefined)?.id;
      }
    }

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      for (const line of document.lines) {
        // GREATEST keeps a term from going negative if two returns race each other.
        await tx.update(boqTerms)
          .set({ previouslyBilled: sql`GREATEST(${boqTerms.previouslyBilled} - ${line.returnValue}, 0)`, updatedAt: new Date() })
          .where(and(eq(boqTerms.tenantId, tenantId), eq(boqTerms.id, line.termId)));
      }
      if (dec(document.retentionValue).gt(0)) {
        await tx.update(progressBills)
          .set({ retentionValue: sql`GREATEST(${progressBills.retentionValue} - ${dec(document.retentionValue).toFixed(4)}::numeric, 0)`, updatedAt: new Date() })
          .where(and(eq(progressBills.tenantId, tenantId), eq(progressBills.id, bill.id)));
      }
      await tx.update(contractingReturns)
        .set({ status: 'posted', postedAt: new Date(), creditNoteId, updatedAt: new Date(), updatedBy: tryGetAuthContext()?.userId })
        .where(and(eq(contractingReturns.tenantId, tenantId), eq(contractingReturns.id, id)));
      const loaded = await this.load(tx, tenantId, id);
      return { ...loaded, retentionJournalEntryId: retentionEntryId ?? null };
    });
  }

  /** The revenue and retention accounts the bill's own posting used (by the line descriptions `postBill` writes). */
  private async billJournalLegs(tx: DrizzleTx, tenantId: string, invoiceId: string) {
    const result = (await tx.execute(sql`
      SELECT l.account_id, l.description, l.debit::text AS debit, l.credit::text AS credit
      FROM journal_entry_lines l
      JOIN journal_entries e ON e.id = l.entry_id
      WHERE l.tenant_id = ${tenantId}::uuid AND e.source_id = ${invoiceId}::uuid AND e.status = 'posted'
      ORDER BY e.created_at ASC, l.line_no ASC
    `)) as unknown as { rows?: Array<{ account_id: string; description: string | null; debit: string; credit: string }> };
    const rows = Array.isArray(result) ? (result as Array<{ account_id: string; description: string | null; debit: string; credit: string }>) : (result.rows ?? []);
    const revenue = rows.find((r) => (r.description ?? '').startsWith('إيراد مستخلص')) ?? rows.find((r) => dec(r.credit).gt(0));
    const retention = rows.find((r) => (r.description ?? '').startsWith('محتجز مستخلص')) ?? rows.find((r) => (r.description ?? '').startsWith('مستخلص أعمال'));
    return { revenueAccountId: revenue?.account_id, retentionAccountId: retention?.account_id };
  }

  async cancel(tenantId: string, id: string) {
    await this.projectsService.ensureEnabled(tenantId);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const document = await this.load(tx, tenantId, id);
      if (document.status !== 'draft') throw new DomainError('CONTRACTING_RETURN_INVALID_STATUS', 'Only a draft return can be cancelled', 409);
      await tx.update(contractingReturns)
        .set({ status: 'cancelled', cancelledAt: new Date(), updatedAt: new Date(), updatedBy: tryGetAuthContext()?.userId })
        .where(and(eq(contractingReturns.tenantId, tenantId), eq(contractingReturns.id, id)));
      return this.load(tx, tenantId, id);
    });
  }

  // --------------------------------------------------------------------- helpers

  private async load(tx: DrizzleTx, tenantId: string, id: string) {
    const [row] = await tx.select().from(contractingReturns).where(and(eq(contractingReturns.tenantId, tenantId), eq(contractingReturns.id, id)));
    if (!row) throw new DomainError('CONTRACTING_RETURN_NOT_FOUND', 'Contracting return was not found', 404);
    const lines = await tx.select().from(contractingReturnLines).where(and(eq(contractingReturnLines.tenantId, tenantId), eq(contractingReturnLines.returnId, id)));
    return { ...row, lines: lines.sort((a, b) => a.lineNo - b.lineNo) };
  }

  private async loadBill(tx: DrizzleTx, tenantId: string, billId: string) {
    const [bill] = await tx.select().from(progressBills).where(and(eq(progressBills.tenantId, tenantId), eq(progressBills.id, billId)));
    if (!bill) throw new DomainError('PROGRESS_BILL_NOT_FOUND', 'Progress bill was not found', 404);
    const lines = await tx.select().from(progressBillLines).where(and(eq(progressBillLines.tenantId, tenantId), eq(progressBillLines.billId, billId)));
    const [project] = await tx.select().from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, bill.projectId)));
    return { ...bill, branchId: project?.branchId ?? null, lines };
  }

  /** Value already returned per term on a bill; cancelled returns count for nothing. */
  private async returnedByTerm(tx: DrizzleTx, tenantId: string, billId: string) {
    const rows = await tx
      .select({ termId: contractingReturnLines.termId, returnValue: contractingReturnLines.returnValue, status: contractingReturns.status })
      .from(contractingReturnLines)
      .innerJoin(contractingReturns, eq(contractingReturns.id, contractingReturnLines.returnId))
      .where(and(eq(contractingReturnLines.tenantId, tenantId), eq(contractingReturns.billId, billId)));
    const totals = new Map<string, Decimal>();
    for (const row of rows) {
      if (row.status === 'cancelled') continue;
      totals.set(row.termId, (totals.get(row.termId) ?? new Decimal(0)).plus(dec(row.returnValue)));
    }
    return totals;
  }
}
