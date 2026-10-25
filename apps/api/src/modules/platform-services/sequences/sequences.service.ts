import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  DomainError,
  errorCodes,
  formatSequenceNumber,
  type SequenceAllocation,
} from '@erp/contracts';
import {
  documentSequences,
  newId,
  SEQUENCE_SCOPE_NIL_UUID,
  withTenantTx,
  type DatabaseHandle,
  type DrizzleTx,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../../database/database.module.js';

/**
 * Document numbering — DATABASE_DESIGN §3, BL-1:
 * "Allocation: `INSERT … ON CONFLICT DO UPDATE SET current_value = … RETURNING` under tx".
 *
 * How later modules use it:
 *
 * ```ts
 * await withTenantTx(db, tenantId, async (tx) => {
 *   const number = await sequences.next({ tenantId, docType: 'sales_invoice', branchId }, tx);
 *   await tx.insert(salesInvoices).values({ …, number: number.display });
 * });
 * ```
 *
 * Always pass the caller's `tx`: the allocation must share the fate of the document it
 * numbers, otherwise a rolled-back invoice burns a number (a gap an auditor will ask
 * about). The single upsert statement takes a row lock, so N concurrent allocations
 * queue on it and every caller gets a distinct, monotonic value — proven by the
 * 64-parallel test in `test/sequences.spec.ts`.
 */

export type SequenceScope = {
  tenantId: string;
  docType: string;
  /** NULL/omitted = tenant-wide numbering. */
  branchId?: string | null;
  /** NULL/omitted = the sequence does not restart per fiscal year. */
  fiscalYearId?: string | null;
};

export type SequenceOptions = {
  /** Used only when the sequence row is created; afterwards the stored value wins. */
  prefix?: string;
  padding?: number;
  /**
   * The next number to issue (R-47 numbering presets). On row creation the initial
   * `current_value` becomes `GREATEST(startAt, tenant_max + 1)` so the first document
   * gets exactly `startAt`; on an existing row the counter jumps forward to `startAt`
   * (never backward — `GREATEST` protects already-issued numbers).
   */
  startAt?: number;
};

const TENANT_WIDE_DOC_TYPES = new Set([
  'sales_invoice',
  'sales_return',
  'sale',
  'sale_return',
  'credit_note',
  'debit_note',
  'purchase_invoice',
  'purchase_return',
  'purchase',
  'voucher_receipt',
  'voucher_payment',
  'stock_voucher',
  'stock_in',
  'stock_out',
  'opening',
  'stock_transfer',
  'cash_transfer',
  'journal_entry',
  'shift_close',
]);

/** `bigint` columns come back as strings on some drivers; normalise once, here. */
function toCount(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new DomainError(errorCodes.SEQUENCE_EXHAUSTED, 'Sequence value exceeded the safe integer range', 422);
  }
  return parsed;
}

@Injectable()
export class SequencesService {
  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle) {}

  /**
   * Allocates the next number in the scope. Pass `tx` to join a business transaction
   * (the normal case); without it the allocation commits on its own.
   */
  async next(
    scope: SequenceScope,
    tx?: DrizzleTx,
    options: SequenceOptions = {},
  ): Promise<SequenceAllocation> {
    if (tx) return this.allocate(tx, scope, options);
    return withTenantTx(this.database.db, scope.tenantId, (own) => this.allocate(own, scope, options));
  }

  private async allocate(
    tx: DrizzleTx,
    scope: SequenceScope,
    options: SequenceOptions,
  ): Promise<SequenceAllocation> {
    const prefix = options.prefix ?? '';
    const padding = options.padding ?? 6;
    const startAt = options.startAt;
    if (padding < 1 || padding > 18) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'padding must be between 1 and 18', 400, {
        field: 'padding',
      });
    }

    // ACC-100: المستندات المقيدة بفهرس تفرد على مستوى المستأجر تُرقّم بنطاق عام للمستأجر
    // لمنع تصادم الترقيم بين الفروع، مع تهيئة العداد من أعلى قيمة حالية لأي فرع
    const tenantWide = TENANT_WIDE_DOC_TYPES.has(scope.docType);
    const effectiveBranchId = tenantWide ? null : (scope.branchId ?? null);
    // وبنفس المنطق لا تُقسَّم على السنوات: فهرس `journal_entries_tenant_number_key`
    // (0141) فريد على مستوى المستأجر، ومقسمُ السنة يقفز عدّاد سنةٍ فوق أخرى ثم تُعيد
    // القديمة إصدار الرقم نفسه ← انتهاك الفريدة بـ500 (قِيس حيّاً: عكس قيد2029 في
    // فترة2026 بعدد2026=22 ← JE-000023 مكرّر). الترقيم العام متسق مع0141.
    const effectiveFiscalYearId = tenantWide ? null : (scope.fiscalYearId ?? null);

    // One statement: insert the scope row or bump it, and return the allocated value.
    // The ON CONFLICT arbiter mirrors `document_sequences_scope_key` exactly — see
    // `SEQUENCE_SCOPE_NIL_UUID` in the schema for why COALESCE is involved.
    const result = await tx.execute(sql`
      INSERT INTO document_sequences (id, tenant_id, branch_id, doc_type, fiscal_year_id, prefix, padding, current_value, updated_at)
      VALUES (${newId()}, ${scope.tenantId}, ${effectiveBranchId}, ${scope.docType},
              ${effectiveFiscalYearId}, ${prefix}, ${padding},
              GREATEST(${startAt ?? 0}, COALESCE((SELECT MAX(current_value) FROM document_sequences WHERE tenant_id = ${scope.tenantId} AND doc_type = ${scope.docType}), 0) + 1),
              now())
      ON CONFLICT (
        tenant_id,
        coalesce(branch_id, ${SEQUENCE_SCOPE_NIL_UUID}::uuid),
        doc_type,
        coalesce(fiscal_year_id, ${SEQUENCE_SCOPE_NIL_UUID}::uuid)
      )
      DO UPDATE SET current_value = GREATEST(document_sequences.current_value + 1, ${startAt ?? 0}), updated_at = now()
      RETURNING current_value, prefix, padding
    `);

    const row = rowsOf<{ current_value: string | number; prefix: string; padding: number }>(result)[0];
    if (!row) {
      throw new DomainError(errorCodes.SEQUENCE_EXHAUSTED, 'Sequence allocation returned no row', 422);
    }

    const value = toCount(row.current_value);
    return {
      value,
      prefix: row.prefix,
      padding: row.padding,
      display: formatSequenceNumber(value, row.prefix, row.padding),
    };
  }

  /** Current value without allocating — for admin screens and reconciliation. */
  async peek(scope: SequenceScope): Promise<SequenceAllocation | undefined> {
    return withTenantTx(this.database.db, scope.tenantId, async (tx) => {
      const [row] = await tx
        .select()
        .from(documentSequences)
        .where(this.scopePredicate(scope))
        .limit(1);

      if (!row) return undefined;
      const value = toCount(row.currentValue);
      return {
        value,
        prefix: row.prefix,
        padding: row.padding,
        display: formatSequenceNumber(value, row.prefix, row.padding),
      };
    });
  }

  /**
   * Sets the prefix/padding of a scope (ADMIN_PANEL §1 "Sequences/numbering admin").
   * `current_value` is never lowered here: rewinding a sequence would re-issue a number
   * that already exists on a posted document.
   */
  async configure(scope: SequenceScope, options: SequenceOptions): Promise<SequenceAllocation> {
    return withTenantTx(this.database.db, scope.tenantId, async (tx) => {
      const [existing] = await tx
        .select()
        .from(documentSequences)
        .where(this.scopePredicate(scope))
        .limit(1);

      if (!existing) {
        const id = newId();
        const [created] = await tx
          .insert(documentSequences)
          .values({
            id,
            tenantId: scope.tenantId,
            branchId: scope.branchId ?? null,
            docType: scope.docType,
            fiscalYearId: scope.fiscalYearId ?? null,
            prefix: options.prefix ?? '',
            padding: options.padding ?? 6,
            currentValue: 0,
          })
          .returning();
        const row = created as typeof documentSequences.$inferSelect;
        return {
          value: 0,
          prefix: row.prefix,
          padding: row.padding,
          display: formatSequenceNumber(0, row.prefix, row.padding),
        };
      }

      const [updated] = await tx
        .update(documentSequences)
        .set({
          prefix: options.prefix ?? existing.prefix,
          padding: options.padding ?? existing.padding,
          updatedAt: new Date(),
        })
        .where(eq(documentSequences.id, existing.id))
        .returning();

      const row = (updated ?? existing) as typeof documentSequences.$inferSelect;
      const value = toCount(row.currentValue);
      return {
        value,
        prefix: row.prefix,
        padding: row.padding,
        display: formatSequenceNumber(value, row.prefix, row.padding),
      };
    });
  }

  private scopePredicate(scope: SequenceScope) {
    // الانعكاس نفسه لـ`allocate`: أنواع المستأجر الواحد تُخزَّن بنطاق عام (فرع/سنة NIL)
    // فتُطبَّق النطاق العام هنا أيضاً وإلا عاد `peek` بـundefined لصفٍ قائم.
    const tenantWide = TENANT_WIDE_DOC_TYPES.has(scope.docType);
    const branchId = tenantWide ? null : (scope.branchId ?? null);
    const fiscalYearId = tenantWide ? null : (scope.fiscalYearId ?? null);
    return and(
      eq(documentSequences.tenantId, scope.tenantId),
      eq(documentSequences.docType, scope.docType),
      sql`coalesce(${documentSequences.branchId}, ${SEQUENCE_SCOPE_NIL_UUID}::uuid) = coalesce(${
        branchId
      }::uuid, ${SEQUENCE_SCOPE_NIL_UUID}::uuid)`,
      sql`coalesce(${documentSequences.fiscalYearId}, ${SEQUENCE_SCOPE_NIL_UUID}::uuid) = coalesce(${
        fiscalYearId
      }::uuid, ${SEQUENCE_SCOPE_NIL_UUID}::uuid)`,
    );
  }
}

function rowsOf<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : ((result as { rows: T[] }).rows ?? []);
}
