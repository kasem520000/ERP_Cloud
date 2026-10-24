/* eslint-disable no-restricted-syntax, import/order */
import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { and, asc, desc, eq, isNotNull } from 'drizzle-orm';

import { DomainError, newId } from '@erp/contracts';
import {
  accounts,
  arProvisions,
  arReminderEvents,
  arReminders,
  arWriteoffs,
  journalEntries,
  journalEntryLines,
  parties,
  salesInvoices,
  withTenantTx,
  type DatabaseHandle,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { AccountingService, type JournalLineInput } from '../accounting/accounting.service.js';
import { tryGetAuthContext } from '../platform/context/tenant-context.js';
import { TreasuryService } from '../treasury/treasury.service.js';
import { WhatsappService } from '../integrations/whatsapp/whatsapp.service.js';

export type ReminderRuleInput = {
  minDays: number;
  maxDays?: number | null;
  channel?: 'whatsapp' | 'email' | 'log_only';
  cooldownDays?: number;
  messageTemplate?: string | null;
  enabled?: boolean;
};

export type SendReminderInput = { invoiceId?: string; message?: string };

export type ProvisionInput = {
  partyId: string;
  invoiceId?: string | null;
  basis: string;
  percent: string;
  expenseAccountId: string;
  allowanceAccountId: string;
  date?: string;
};

export type WriteoffInput = {
  partyId: string;
  invoiceId: string;
  amount: string;
  lossAccountId: string;
  allowanceAccountId?: string | null;
  reason: string;
  date?: string;
};

export type RecoveryInput = { amount: string; cashLocationId: string; date?: string };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * MF-17 / D9 — إدارة التحصيل (سياسة مُقرَّرة في r43 §1):
 *
 *  • تذكير: شريحة تأخر ⇐ قاعدة `ar_reminders`؛ **التسجيل في السجل إجباري دائماً** مهما
 *    كان outcome الإرسال الخارجي (sendPlain يرمي WHATSAPP_NOT_CONFIGURED/… بلا إعداد).
 *  • مخصص: قيد Dr مصروف / Cr مخصص — بلا وسم طرف (سُنّة r43 P3: سطر AR وحده يحمل الطرف).
 *  • شطب: مسوّدة بلا قيد ⇐ اعتماد بقيد واحد: Dr [مخصص حتى رصيد مخصص الفاتورة] + Dr خسارة /
 *    Cr **حساب سطر الفاتورة party-tagged** ⇐ يُصفّر رصيد الكشف بمنهجه نفسه.
 *  • استرداد: سند قبض حقيقي (خزينة) بcounter = حساب خسارة الشطب، بلا partyId.
 *  • الترحيل يمرّ بـpostJournal فيحمي الفترة المغلقة (ACCOUNTING_PERIOD_CLOSED).
 */
@Injectable()
export class CollectionService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly accounting: AccountingService,
    private readonly treasury: TreasuryService,
    private readonly whatsapp: WhatsappService,
  ) {}

  private err(code: string, message: string, status = 422) {
    return new DomainError(code, message, status);
  }

  // ── قواعد التذكير ────────────────────────────────────────────────────────
  async listRules(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(arReminders).where(eq(arReminders.tenantId, tenantId)).orderBy(asc(arReminders.minDays)),
    );
  }

  async createRule(tenantId: string, input: ReminderRuleInput) {
    this.assertBand(input);
    try {
      const [row] = await withTenantTx(this.database.db, tenantId, (tx) =>
        tx
          .insert(arReminders)
          .values({
            id: newId(),
            tenantId,
            minDays: Math.trunc(input.minDays),
            maxDays: input.maxDays == null ? null : Math.trunc(input.maxDays),
            channel: input.channel ?? 'whatsapp',
            cooldownDays: input.cooldownDays ?? 7,
            messageTemplate: input.messageTemplate ?? null,
            enabled: input.enabled ?? true,
          })
          .returning(),
      );
      return row;
    } catch (e) {
      if (e instanceof Error && 'code' in e && (e as { code?: string }).code === '23505') {
        throw this.err('REMINDER_BAND_TAKEN', 'توجد قاعدة لنفس شريحة التأخر', 409);
      }
      throw e;
    }
  }

  async updateRule(tenantId: string, id: string, patch: Partial<ReminderRuleInput>) {
    if (patch.minDays != null || patch.maxDays !== undefined) {
      this.assertBand({ minDays: patch.minDays ?? 0, maxDays: patch.maxDays });
    }
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .update(arReminders)
        .set({
          ...(patch.minDays != null ? { minDays: Math.trunc(patch.minDays) } : {}),
          ...(patch.maxDays !== undefined ? { maxDays: patch.maxDays == null ? null : Math.trunc(patch.maxDays) } : {}),
          ...(patch.channel ? { channel: patch.channel } : {}),
          ...(patch.cooldownDays != null ? { cooldownDays: Math.trunc(patch.cooldownDays) } : {}),
          ...(patch.messageTemplate !== undefined ? { messageTemplate: patch.messageTemplate } : {}),
          ...(patch.enabled != null ? { enabled: patch.enabled } : {}),
          updatedAt: new Date(),
        })
        .where(and(eq(arReminders.id, id), eq(arReminders.tenantId, tenantId)))
        .returning(),
    );
    if (!row) throw this.err('REMINDER_RULE_NOT_FOUND', 'قاعدة التذكير غير موجودة', 404);
    return row;
  }

  private assertBand(input: { minDays: number; maxDays?: number | null }) {
    if (!Number.isFinite(input.minDays) || input.minDays < 0) throw this.err('REMINDER_BAND_INVALID', 'حد الشريحة يجب أن يكون ≥ 0');
    if (input.maxDays != null && input.maxDays < input.minDays) throw this.err('REMINDER_BAND_INVALID', 'حد الشريحة الأعلى يجب ألا يقل عن الأدنى');
  }

  // ── إرسال تذكير + سجل إجباري ────────────────────────────────────────────
  async sendReminder(tenantId: string, partyId: string, input: SendReminderInput) {
    const [party] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(parties).where(and(eq(parties.id, partyId), eq(parties.tenantId, tenantId))),
    );
    if (!party) throw this.err('PARTY_NOT_FOUND', 'الطرف غير موجود', 404);

    const invoices = await this.overdueInvoices(tenantId, partyId);
    if (!invoices.length) throw this.err('NO_OVERDUE_INVOICE', 'لا فواتير متأخرة على هذا الطرف');

    let target = invoices[0]!;
    if (input.invoiceId) {
      const found = invoices.find((i) => i.id === input.invoiceId);
      if (!found) throw this.err('REMINDER_INVOICE_NOT_OVERDUE', 'الفاتورة المحددة ليست متأخرة غير مسدَّدة');
      target = found;
    }
    const bandDays = target.overdueDays;

    const rules = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select()
        .from(arReminders)
        .where(and(eq(arReminders.tenantId, tenantId), eq(arReminders.enabled, true)))
        .orderBy(asc(arReminders.minDays)),
    );
    const rule = rules.find(
      (r) => bandDays >= r.minDays && (r.maxDays == null || bandDays <= r.maxDays),
    );
    if (!rule) throw this.err('REMINDER_NO_RULE', `لا قاعدة تذكير تغطي تأخر ${bandDays} يوماً`);

    // هدوء إعادة الإرسال لنفس الطرف (coalesce ضمنياً).
    const last = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select({ dispatchedAt: arReminderEvents.dispatchedAt })
        .from(arReminderEvents)
        .where(and(eq(arReminderEvents.tenantId, tenantId), eq(arReminderEvents.partyId, partyId)))
        .orderBy(desc(arReminderEvents.dispatchedAt))
        .limit(1),
    );
    if (last[0]) {
      const sinceMs = Date.now() - new Date(last[0].dispatchedAt).getTime();
      if (sinceMs < rule.cooldownDays * 86_400_000) throw this.err('REMINDER_COOLDOWN', `الهدوء ${rule.cooldownDays} يوماً بين تذكيرات الطرف`);
    }

    const message =
      input.message ??
      rule.messageTemplate?.replace(/\{number\}/g, target.number ?? '').replace(/\{amount\}/g, target.total).replace(/\{days\}/g, String(bandDays)) ??
      `تذكير تحصيل: فاتورة ${target.number ?? ''} بمبلغ ${target.total} متأخرة سدادها ${bandDays} يوماً — يُرجى السداد.`;

    // الإرسال أفضل جهد؛ **التسجيل إجباري في كل الحالات** (r43 P5).
    let dispatchStatus: string;
    let error: string | null = null;
    if (rule.channel === 'log_only') {
      dispatchStatus = 'logged';
    } else if (rule.channel === 'email') {
      // لا مزوّد بريد موصول بعد — نُسجَّل بصدق «غير مُهيّأ» لا بادّعاء الإرسال.
      dispatchStatus = 'not_configured';
      error = 'EMAIL_CHANNEL_NOT_WIRED';
    } else if (!party.phone) {
      dispatchStatus = 'failed:PARTY_PHONE_MISSING';
      error = 'لا هاتف للطرف';
    } else {
      try {
        await this.whatsapp.sendPlain(tenantId, { to: party.phone, message, partyId });
        dispatchStatus = 'sent';
      } catch (e) {
        const code = e instanceof DomainError ? e.code : 'INTERNAL';
        dispatchStatus = code === 'WHATSAPP_NOT_CONFIGURED' || code === 'WHATSAPP_DISABLED' ? 'not_configured' : `failed:${code}`;
        error = e instanceof Error ? e.message : String(e);
      }
    }

    const [event] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .insert(arReminderEvents)
        .values({
          id: newId(),
          tenantId,
          partyId,
          invoiceId: target.id,
          bandDays,
          channel: rule.channel,
          message,
          dispatchStatus,
          error,
          createdBy: tryGetAuthContext()?.userId ?? null,
        })
        .returning(),
    );
    return event;
  }

  /** فواتير المبيعات المتأخرة غير المسدَّدة: المتبقي = total − paid − شطوبات معتمدة. */
  private async overdueInvoices(tenantId: string, partyId: string) {
    const rows = await withTenantTx(this.database.db, tenantId, async (tx) => {
      const invs = await tx
        .select({
          id: salesInvoices.id,
          number: salesInvoices.number,
          total: salesInvoices.total,
          paidTotal: salesInvoices.paidTotal,
          dueDate: salesInvoices.dueDate,
          branchId: salesInvoices.branchId,
        })
        .from(salesInvoices)
        .where(
          and(
            eq(salesInvoices.tenantId, tenantId),
            eq(salesInvoices.partyId, partyId),
            eq(salesInvoices.status, 'posted'),
            isNotNull(salesInvoices.dueDate),
          ),
        );
      const wos = await tx
        .select({ invoiceId: arWriteoffs.invoiceId, amount: arWriteoffs.amount })
        .from(arWriteoffs)
        .where(and(eq(arWriteoffs.tenantId, tenantId), eq(arWriteoffs.partyId, partyId), eq(arWriteoffs.status, 'approved')));
      return invs.map((i) => {
        const written = wos
          .filter((w) => w.invoiceId === i.id)
          .reduce((s, w) => s.plus(new Decimal(w.amount)), new Decimal(0));
        const remaining = new Decimal(i.total).minus(i.paidTotal ?? '0').minus(written);
        const overdueDays = i.dueDate
          ? Math.floor((Date.now() - new Date(`${i.dueDate}T00:00:00Z`).getTime()) / 86_400_000)
          : 0;
        return { ...i, remaining: remaining.toFixed(4), overdueDays };
      });
    });
    return rows.filter((r) => new Decimal(r.remaining).gt(0) && r.overdueDays > 0).sort((a, b) => b.overdueDays - a.overdueDays);
  }

  // ── مخصص ────────────────────────────────────────────────────────────────
  async createProvision(tenantId: string, input: ProvisionInput) {
    const percent = new Decimal(input.percent);
    if (percent.lte(0) || percent.gt(100)) throw this.err('PROVISION_PERCENT_INVALID', 'نسبة المخصص يجب أن تكون بين 0 و100');
    const basis = new Decimal(input.basis);
    if (basis.lte(0)) throw this.err('PROVISION_BASIS_INVALID', 'أساس المخصص يجب أن يكون موجباً');
    const amount = basis.times(percent).div(100).toDecimalPlaces(4);
    if (amount.lte(0)) throw this.err('PROVISION_AMOUNT_ZERO', 'قيمة المخصص يجب أن تكون موجبة');

    await this.assertAccounts(tenantId, [input.expenseAccountId, input.allowanceAccountId]);
    const date = input.date ?? today();
    const id = newId();
    await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.insert(arProvisions).values({
        id,
        tenantId,
        partyId: input.partyId,
        invoiceId: input.invoiceId ?? null,
        basisAmount: basis.toFixed(4),
        percent: percent.toFixed(4),
        amount: amount.toFixed(4),
        expenseAccountId: input.expenseAccountId,
        allowanceAccountId: input.allowanceAccountId,
        entryDate: date,
        createdBy: tryGetAuthContext()?.userId ?? null,
      }),
    );
    const entry = await this.accounting.postJournal(tenantId, {
      date,
      description: `مخصص ديون مشكوك فيها ${percent.toFixed(2)}% — ${basis.toFixed(2)}`,
      sourceType: 'ar_provision',
      sourceId: id,
      lines: [
        { accountId: input.expenseAccountId, debit: amount.toFixed(4), description: 'مصروف مخصص ديون مشكوك فيها' },
        { accountId: input.allowanceAccountId, credit: amount.toFixed(4), description: 'مخصص ديون مشكوك فيها' },
      ],
    });
    if (!entry) throw this.err('JOURNAL_NOT_POSTED', 'لم يُرحَّل قيد المخصص', 500);
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.update(arProvisions).set({ journalEntryId: entry.id }).where(eq(arProvisions.id, id)).returning(),
    );
    return row;
  }

  async listProvisions(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select()
        .from(arProvisions)
        .where(eq(arProvisions.tenantId, tenantId))
        .orderBy(desc(arProvisions.createdAt))
        .limit(100),
    );
  }

  // ── شطب ─────────────────────────────────────────────────────────────────
  async createWriteoff(tenantId: string, input: WriteoffInput) {
    const amount = new Decimal(input.amount);
    if (amount.lte(0)) throw this.err('WRITEOFF_AMOUNT_INVALID', 'قيمة الشطب يجب أن تكون موجبة');

    const inv = await this.invoiceForWriteoff(tenantId, input.partyId, input.invoiceId);
    const approved = await this.writeoffApprovedTotals(tenantId, input.invoiceId);
    const remaining = new Decimal(inv.total).minus(inv.paidTotal ?? '0').minus(approved.amount);
    if (amount.gt(remaining)) {
      throw this.err('WRITEOFF_EXCEEDS_OPEN', `المتبقي على الفاتورة ${remaining.toFixed(4)} — طُلب ${amount.toFixed(4)}`);
    }
    await this.assertAccounts(tenantId, [input.lossAccountId, ...(input.allowanceAccountId ? [input.allowanceAccountId] : [])]);

    const id = newId();
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .insert(arWriteoffs)
        .values({
          id,
          tenantId,
          partyId: input.partyId,
          invoiceId: input.invoiceId,
          amount: amount.toFixed(4),
          lossAccountId: input.lossAccountId,
          allowanceAccountId: input.allowanceAccountId ?? null,
          reason: input.reason,
          status: 'draft',
          entryDate: input.date ?? today(),
          createdBy: tryGetAuthContext()?.userId ?? null,
        })
        .returning(),
    );
    return row;
  }

  async approveWriteoff(tenantId: string, id: string) {
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(arWriteoffs).where(and(eq(arWriteoffs.id, id), eq(arWriteoffs.tenantId, tenantId))),
    );
    if (!row) throw this.err('WRITEOFF_NOT_FOUND', 'مستند الشطب غير موجود', 404);
    if (row.status === 'approved') throw this.err('WRITEOFF_ALREADY_APPROVED', 'الشطب مُعتمد مسبقاً', 409);

    const inv = await this.invoiceForWriteoff(tenantId, row.partyId, row.invoiceId);
    const arLine = await this.invoiceReceivableLine(tenantId, row.partyId, row.invoiceId);
    if (!arLine) throw this.err('WRITEOFF_NO_RECEIVABLE_LINE', 'لا سطر ذمة مدين للفاتورة في القيود', 422);

    // المخصص المتاح لهذه الفاتورة = مخصصاتها − ما استُخدم في شطوبات معتمدة سابقة.
    const provisions = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select({ amount: arProvisions.amount, allowanceAccountId: arProvisions.allowanceAccountId })
        .from(arProvisions)
        .where(and(eq(arProvisions.tenantId, tenantId), eq(arProvisions.partyId, row.partyId), eq(arProvisions.invoiceId, row.invoiceId))),
    );
    const priorUsed = await this.writeoffApprovedTotals(tenantId, row.invoiceId);
    const provisionTotal = provisions.reduce((s, p) => s.plus(new Decimal(p.amount)), new Decimal(0));
    const allowanceAvailable = provisionTotal.minus(priorUsed.allowance).gt(0) ? provisionTotal.minus(priorUsed.allowance) : new Decimal(0);
    const amount = new Decimal(row.amount);
    const allowanceUsed = row.allowanceAccountId && allowanceAvailable.gt(0)
      ? Decimal.min(amount, allowanceAvailable)
      : new Decimal(0);
    const lossUsed = amount.minus(allowanceUsed);
    const allowanceAccount = row.allowanceAccountId ?? provisions[0]?.allowanceAccountId ?? null;
    if (allowanceUsed.gt(0) && !allowanceAccount) throw this.err('WRITEOFF_NO_ALLOWANCE_ACCOUNT', 'لا حساب مخصص للاستخدام', 422);

    const lines: JournalLineInput[] = [];
    if (allowanceUsed.gt(0)) {
      lines.push({ accountId: allowanceAccount!, debit: allowanceUsed.toFixed(4), description: 'استهلاك مخصص ديون مشكوك فيها' });
    }
    if (lossUsed.gt(0)) {
      lines.push({ accountId: row.lossAccountId, debit: lossUsed.toFixed(4), description: 'خسارة شطب ذمة مدينة' });
    }
    // سطر الذمة وحده party-tagged (r43 P3) — بحساب الفاتورة نفسه ⇐ تصفير الرصيد.
    lines.push({ accountId: arLine.accountId, credit: amount.toFixed(4), partyId: row.partyId, description: `شطب فاتورة ${inv.number ?? row.invoiceId}` });

    const entry = await this.accounting.postJournal(tenantId, {
      date: row.entryDate,
      description: `شطب فاتورة مدينة ${inv.number ?? ''} — ${amount.toFixed(4)} — ${row.reason}`,
      branchId: inv.branchId ?? undefined,
      sourceType: 'ar_writeoff',
      sourceId: row.id,
      lines,
    });
    if (!entry) throw this.err('JOURNAL_NOT_POSTED', 'لم يُرحَّل قيد الشطب', 500);
    const [updated] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .update(arWriteoffs)
        .set({
          status: 'approved',
          journalEntryId: entry.id,
          allowanceUsed: allowanceUsed.toFixed(4),
          lossUsed: lossUsed.toFixed(4),
          approvedBy: tryGetAuthContext()?.userId ?? null,
          approvedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(arWriteoffs.id, row.id))
        .returning(),
    );
    return updated;
  }

  async listWriteoffs(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(arWriteoffs).where(eq(arWriteoffs.tenantId, tenantId)).orderBy(desc(arWriteoffs.createdAt)).limit(100),
    );
  }

  async recovery(tenantId: string, id: string, input: RecoveryInput) {
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(arWriteoffs).where(and(eq(arWriteoffs.id, id), eq(arWriteoffs.tenantId, tenantId))),
    );
    if (!row) throw this.err('WRITEOFF_NOT_FOUND', 'مستند الشطب غير موجود', 404);
    if (row.status !== 'approved') throw this.err('WRITEOFF_NOT_APPROVED', 'لا استرداد قبل اعتماد الشطب');
    const amount = new Decimal(input.amount);
    if (amount.lte(0)) throw this.err('RECOVERY_AMOUNT_INVALID', 'قيمة الاسترداد يجب أن تكون موجبة');
    const available = new Decimal(row.amount).minus(row.recoveredAmount);
    if (amount.gt(available)) throw this.err('RECOVERY_EXCEEDS', `المتاح للاسترداد ${available.toFixed(4)} — طُلب ${amount.toFixed(4)}`);

    const inv = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select({ branchId: salesInvoices.branchId, number: salesInvoices.number })
        .from(salesInvoices)
        .where(and(eq(salesInvoices.id, row.invoiceId), eq(salesInvoices.tenantId, tenantId))),
    );
    const branchId = inv[0]?.branchId;
    if (!branchId) throw this.err('RECOVERY_NO_BRANCH', 'لا فرع للفاتورة لربط سند الاسترداد', 422);

    // سند قبض حقيقي: Dr نقد / Cr حساب خسارة الشطب — بلا partyId (لا أثر على رصيد الكشف).
    const voucher = await this.treasury.createVoucher(tenantId, {
      branchId,
      kind: 'receipt',
      subtype: 'other',
      date: input.date ?? today(),
      cashLocationId: input.cashLocationId,
      method: 'cash',
      amount: amount.toFixed(4),
      counterAccountId: row.lossAccountId,
      description: `استرداد جزئي من شطب فاتورة ${inv[0]?.number ?? ''}`,
    });
    if (!voucher) throw this.err('VOUCHER_NOT_CREATED', 'لم يُنشأ سند الاسترداد', 500);
    await this.treasury.postVoucher(tenantId, voucher.id, {});

    const [updated] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .update(arWriteoffs)
        .set({ recoveredAmount: new Decimal(row.recoveredAmount).plus(amount).toFixed(4), updatedAt: new Date() })
        .where(eq(arWriteoffs.id, row.id))
        .returning(),
    );
    return { writeoff: updated, voucher };
  }

  // ── مساعر داخلية ────────────────────────────────────────────────────────
  private async invoiceForWriteoff(tenantId: string, partyId: string, invoiceId: string) {
    const [inv] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select()
        .from(salesInvoices)
        .where(and(eq(salesInvoices.id, invoiceId), eq(salesInvoices.tenantId, tenantId))),
    );
    if (!inv) throw this.err('INVOICE_NOT_FOUND', 'الفاتورة غير موجودة', 404);
    if (inv.partyId !== partyId) throw this.err('WRITEOFF_PARTY_MISMATCH', 'الفاتورة ليست لهذا الطرف', 422);
    if (inv.status !== 'posted') throw this.err('WRITEOFF_INVOICE_NOT_POSTED', 'يُشطب فاتورة مرحّلة فقط', 422);
    return inv;
  }

  private async writeoffApprovedTotals(tenantId: string, invoiceId: string) {
    const rows = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select({ amount: arWriteoffs.amount, allowance: arWriteoffs.allowanceUsed })
        .from(arWriteoffs)
        .where(and(eq(arWriteoffs.tenantId, tenantId), eq(arWriteoffs.invoiceId, invoiceId), eq(arWriteoffs.status, 'approved'))),
    );
    return {
      amount: rows.reduce((s, r) => s.plus(new Decimal(r.amount)), new Decimal(0)),
      allowance: rows.reduce((s, r) => s.plus(new Decimal(r.allowance)), new Decimal(0)),
    };
  }

  /** سطر ذمة مدين للفاتورة: قيد مرحّل من مصدرها party-tagged (نفس منطق كشف الطرف). */
  private async invoiceReceivableLine(tenantId: string, partyId: string, invoiceId: string) {
    const rows = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select({ accountId: journalEntryLines.accountId, debit: journalEntryLines.debit })
        .from(journalEntryLines)
        .innerJoin(journalEntries, eq(journalEntryLines.entryId, journalEntries.id))
        .where(
          and(
            eq(journalEntryLines.tenantId, tenantId),
            eq(journalEntryLines.partyId, partyId),
            eq(journalEntries.status, 'posted'),
            eq(journalEntries.sourceId, invoiceId),
          ),
        )
        .orderBy(desc(journalEntryLines.debit))
        .limit(1),
    );
    return rows[0] ?? null;
  }

  private async assertAccounts(tenantId: string, ids: string[]) {
    const unique = [...new Set(ids.filter(Boolean))];
    if (!unique.length) throw this.err('ACCOUNT_REQUIRED', 'الحسابات مطلوبة', 422);
    const rows = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.tenantId, tenantId)),
    );
    const known = new Set(rows.map((a) => a.id));
    const missing = unique.filter((id) => !known.has(id));
    if (missing.length) throw this.err('ACCOUNT_INVALID', `حسابات غير موجودة: ${missing.join(', ')}`, 422);
  }
}
