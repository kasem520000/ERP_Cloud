import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import qrcode from 'qrcode-generator';
import { env } from '@erp/config';
import { DomainError } from '@erp/contracts';
import { brandMark, withTenantTx, type DatabaseHandle } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { buildQrPayload } from '../einvoicing/zatca/qr.js';
import { signedContentUrl } from '../platform-services/files/download-token.js';

import {
  PrintSettingsService,
  type PrintFont,
  type PrintSettings,
  type PrintTemplate,
} from './print-settings.service.js';
import {
  composeSections,
  customFieldsHtml,
  customHeaderLinesHtml,
  customTermsHtml,
  customTitles,
  escapeText,
  logoSizeCss,
  paperCss,
  qrSizeCss,
  resolveColumns,
  signatureLabels,
  watermarkHtml,
  type WorksheetSection,
} from './print-design.js';
import { amountInArabicWords } from './tafqeet.js';

export type ReportPrintOptions = {
  settings: PrintSettings;
  /** عدد النسخ — `printNo`, overridable by `?copies=` for one print. */
  copies: number;
  /** نوع الورقة — 1 «ورقة A4» · 2 «ورق صغير 80mm», overridable by `?paper=`. */
  paper: 'a4' | 'small';
};

export type DocumentPrintQuery = {
  paper?: string;
  copies?: string;
};

export type PrintStyle = {
  template: PrintTemplate;
  accent: string | null;
  fontFamily: PrintFont;
  /** مضاعف الحجم — 0.85 .. 1.30 */
  scale: number;
};

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

export function printStyle(settings: PrintSettings | undefined, brandColour?: string | null): PrintStyle {
  const accent = settings?.accentColor?.trim() ?? '';
  const brand = (brandColour ?? '').trim();
  return {
    template: settings?.template ?? 'classic',
    accent: HEX_COLOUR.test(accent) ? accent : HEX_COLOUR.test(brand) ? brand : null,
    fontFamily: settings?.fontFamily ?? 'segoe',
    scale: Math.min(1.3, Math.max(0.85, (settings?.fontScale ?? 100) / 100)),
  };
}

const FONT_STACKS: Record<PrintFont, string> = {
  segoe: "'Segoe UI', Tahoma, 'Noto Naskh Arabic', sans-serif",
  naskh: "'Noto Naskh Arabic', 'Traditional Arabic', 'Times New Roman', serif",
  sans: "system-ui, -apple-system, 'Segoe UI', Arial, sans-serif",
};

@Injectable()
export class PrintTemplatesService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly printSettings: PrintSettingsService,
  ) {}

  // ------------------------------------------------------------------ documents

  async salesInvoice(tenantId: string, id: string, query: DocumentPrintQuery = {}) {
    const basePrint = applyQueryOverrides(await this.settingsFor(tenantId, 'sales'), query);
    const docScopes = await this.readDocScopes(tenantId, [
      'doc:pos_receipt',
      'doc:sales_invoice',
      'doc:sales_return',
    ]);

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const company = await this.company(tx, tenantId);
      const invoice = first(
        await tx.execute(sql`
          SELECT i.*, b.name_ar AS branch_name, b.code AS branch_code, b.phone AS branch_phone,
                 p.name AS party_name, p.code AS party_code, p.tax_no AS party_tax_no,
                 p.phone AS party_phone, p.address AS party_address,
                 s.name AS salesman_name, w.name AS warehouse_name,
                 COALESCE(u.full_name, u.email) AS cashier_name,
                 COALESCE(
                   NULLIF(BTRIM(i.zatca_qr), ''),
                   (SELECT es.qr_payload FROM einvoice_submissions es
                     WHERE es.tenant_id = i.tenant_id AND es.invoice_id = i.id
                       AND es.status IN ('signed', 'submitted', 'reported', 'cleared')
                       AND COALESCE(BTRIM(es.qr_payload), '') <> ''
                     ORDER BY es.created_at DESC LIMIT 1)
                 ) AS effective_zatca_qr,
                 COALESCE(
                   NULLIF(BTRIM(i.zatca_status), ''),
                   (SELECT es.status FROM einvoice_submissions es
                     WHERE es.tenant_id = i.tenant_id AND es.invoice_id = i.id
                     ORDER BY es.created_at DESC LIMIT 1)
                 ) AS effective_zatca_status
            FROM sales_invoices i
            LEFT JOIN branches b ON b.id = i.branch_id
            LEFT JOIN parties p ON p.id = i.party_id
            LEFT JOIN salesmen s ON s.id = i.salesman_id
            LEFT JOIN warehouses w ON w.id = i.warehouse_id
            LEFT JOIN users u ON u.id = COALESCE(i.cashier_id, i.created_by)
           WHERE i.tenant_id = ${tenantId} AND i.id = ${id}
        `),
      );
      if (!invoice) throw new DomainError('NOT_FOUND', 'Invoice was not found', 404);

      let lines = rows(
        await tx.execute(sql`
          SELECT l.*, COALESCE(l.description, it.name_ar) AS label, it.sku,
                 COALESCE(u.name_ar, u.code) AS unit_label, u.code AS unit_code, it.name_ar AS item_name
            FROM sales_invoice_lines l
            LEFT JOIN items it ON it.id = l.item_id
            LEFT JOIN units_of_measure u ON u.id = it.base_unit_id
           WHERE l.tenant_id = ${tenantId} AND l.invoice_id = ${id}
           ORDER BY l.line_no
        `),
      );
      const payments = rows(
        await tx.execute(sql`
          SELECT method, amount, reference FROM invoice_payments
           WHERE tenant_id = ${tenantId} AND invoice_id = ${id}
           ORDER BY created_at
        `),
      );

      const isReturn = str(invoice.kind) === 'sale_return' || str(invoice.kind) === 'return';
      // 🧩 قالب المستند: إيصال الكاشير / فاتورة مبيعات / إشعار دائن — لكلٍّ تصميمه المستقل،
      // وما لم يُخصَّص يرجع إلى «مبيعات» ثم «الإفتراضي» كما كان.
      const docScope =
        basePrint.printType === 2
          ? 'doc:pos_receipt'
          : isReturn
            ? 'doc:sales_return'
            : 'doc:sales_invoice';
      const print = applyDocSettings(basePrint, docScopes.get(docScope));
      const paper: 'a4' | 'small' = print.printType === 2 ? 'small' : 'a4';
      lines = this.sortByPrintItemType(lines, print.printItemType);
      const kindTitle = SALES_KIND_TITLES[str(invoice.kind)] ?? 'فاتورة مبيعات';
      const customerTaxNo = str(invoice.party_tax_no).trim();
      const customerName = str(invoice.party_name) || str(invoice.cash_customer_name) || 'عميل نقدي';
      const hasCustomerTaxNo = Boolean(
        customerTaxNo &&
          customerName !== 'عميل عام' &&
          customerName !== 'عميل نقدي' &&
          str(invoice.party_code) !== 'CUST-GEN',
      );

      // عنوان الفاتورة الرسمي: «فاتورة ضريبية» عند وجود رقم ضريبي للعميل أو «فاتورة ضريبية مبسطة» عند غيابه
      const invoiceTitleAr = isReturn
        ? hasCustomerTaxNo
          ? 'إشعار دائن ضريبي'
          : 'إشعار دائن ضريبي مبسط'
        : hasCustomerTaxNo
          ? 'فاتورة ضريبية'
          : 'فاتورة ضريبية مبسطة';
      const invoiceTitleEn = isReturn
        ? hasCustomerTaxNo
          ? 'Tax Credit Note'
          : 'Simplified Tax Credit Note'
        : hasCustomerTaxNo
          ? 'Tax Invoice'
          : 'Simplified Tax Invoice';

      // رمز الاستجابة السريعة (QR) إلزامي: عند الإرسال للزاتكا نستخدم حمولة المرحلة الثانية (`zatca_qr`)،
      // وإلا نولّد حمولة المرحلة الأولى الرسمية (TLV Tags 1..5).
      const postedAt = invoice.posted_at ?? invoice.created_at ?? new Date();
      const stamps = (value: unknown): string =>
        value instanceof Date
          ? value.toISOString().replace(/\.\d{3}Z$/, 'Z')
          : new Date(String(value)).toISOString().replace(/\.\d{3}Z$/, 'Z');
      const phaseTwoQr = str(invoice.effective_zatca_qr ?? invoice.zatca_qr).trim();
      const phaseOneQr = buildQrPayload({
        sellerName: company.nameAr,
        vatNo: company.taxNo,
        timestamp: stamps(postedAt),
        grandTotal: Number(str(invoice.total) || 0).toFixed(2),
        vatTotal: Number(str(invoice.tax_total) || 0).toFixed(2),
      });
      const qrPayload = phaseTwoQr || phaseOneQr;
      const isPhaseTwo = phaseTwoQr.length > 0;
      const zatcaStatus = str(invoice.effective_zatca_status ?? invoice.zatca_status);

      const totalDec = new Decimal(str(invoice.total) || '0');
      const paidDec = new Decimal(str(invoice.paid_total) || '0');
      const isPartiallyPaid = paidDec.gt(0) && paidDec.lt(totalDec);
      const baseMethods =
        payments.length > 0
          ? payments.map((p) => PAYMENT_METHODS[str(p.method)] ?? str(p.method)).join(' + ')
          : '';
      const paymentMethodLabel = isPartiallyPaid
        ? `آجل (جزئي: ${baseMethods || 'دفعة'})`
        : payments.length > 0 && paidDec.gte(totalDec)
          ? baseMethods
          : paidDec.gte(totalDec) && totalDec.gt(0)
            ? 'نقدي'
            : 'آجل';

      const docNotes = str(invoice.notes).trim() || company.defaultNotes || str(print.note).trim();
      const returnPolicy = company.returnPolicy;
      const customerPhone = str(invoice.party_phone) || str(invoice.cash_customer_mobile);
      // العنوان الوطني للعميل يظهر فقط إذا كان للعميل رقم ضريبي مسجّل
      const buyerAddress = hasCustomerTaxNo
        ? (invoice.party_address as Record<string, unknown> | null)
        : null;

      if (paper === 'small') {
        return this.documentPage(print, company, {
          title: `${kindTitle} ${str(invoice.number) || ''}`.trim(),
          suppressAutoStampAndFooter: true,
          body: this.renderPosReceipt80mm(company, {
            invoiceTitleAr,
            invoiceTitleEn,
            number: str(invoice.number) || '—',
            dateTime: dateTimeText(postedAt),
            branchName: str(invoice.branch_name),
            warehouseName: str(invoice.warehouse_name),
            salesmanName: str(invoice.salesman_name),
            cashierName: str(invoice.cashier_name),
            paymentMethodLabel,
            customerName,
            customerTaxNo: hasCustomerTaxNo ? customerTaxNo : '',
            customerPhone,
            customerAddress: buyerAddress,
            lines,
            currency: str(invoice.currency) || 'SAR',
            subtotal: str(invoice.subtotal),
            discount: str(invoice.invoice_discount),
            tax: str(invoice.tax_total),
            total: str(invoice.total),
            paid: str(invoice.paid_total),
            qrPayload,
            isPhaseTwo,
            zatcaStatus,
            notes: docNotes,
            returnPolicy,
            showHeader: print.printHeader,
            showSignatures: print.showSignatures,
            design: print.designConfig,
          }),
        });
      }

      return this.documentPage(print, company, {
        title: `${kindTitle} ${str(invoice.number) || ''}`.trim(),
        suppressAutoStampAndFooter: true,
        body: this.renderSalesInvoiceA4(company, print, {
          invoiceTitleAr,
          invoiceTitleEn,
          number: str(invoice.number) || '—',
          date: dateText(postedAt),
          time: timeText(postedAt),
          supplyDate: dateText(invoice.supply_date ?? postedAt),
          status: STATUS_LABELS[str(invoice.status)] ?? str(invoice.status),
          branchName: str(invoice.branch_name),
          warehouseName: str(invoice.warehouse_name),
          salesmanName: str(invoice.salesman_name),
          cashierName: str(invoice.cashier_name),
          referenceNo: str(invoice.reference_no),
          paymentMethodLabel,
          customerName,
          customerCode: str(invoice.party_code),
          customerTaxNo: hasCustomerTaxNo ? customerTaxNo : '',
          customerPhone,
          customerAddress: buyerAddress,
          lines,
          currency: str(invoice.currency) || 'SAR',
          subtotal: str(invoice.subtotal),
          discount: str(invoice.invoice_discount),
          tax: str(invoice.tax_total),
          extraTax: str(invoice.extra_tax),
          withholding: str(invoice.withholding),
          total: str(invoice.total),
          paid: str(invoice.paid_total),
          payments: payments.map((row) => ({
            method: PAYMENT_METHODS[str(row.method)] ?? str(row.method),
            amount: str(row.amount),
            reference: str(row.reference),
          })),
          qrPayload,
          isPhaseTwo,
          zatcaStatus,
          notes: docNotes,
          returnPolicy,
        }),
      });
    });
  }

  async purchaseInvoice(tenantId: string, id: string, query: DocumentPrintQuery = {}) {
    const baseP = applyQueryOverrides(await this.settingsFor(tenantId, 'purchases'), query);
    const docScopes = await this.readDocScopes(tenantId, ['doc:purchase_invoice', 'doc:purchase_return']);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const company = await this.company(tx, tenantId);
      const invoice = first(
        await tx.execute(sql`
          SELECT i.*, b.name_ar AS branch_name, w.name AS warehouse_name,
                 p.name AS party_name, p.code AS party_code, p.tax_no AS party_tax_no, p.phone AS party_phone, p.address AS party_address
            FROM purchase_invoices i
            LEFT JOIN branches b ON b.id = i.branch_id
            LEFT JOIN warehouses w ON w.id = i.warehouse_id
            LEFT JOIN parties p ON p.id = i.party_id
           WHERE i.tenant_id = ${tenantId} AND i.id = ${id}
        `),
      );
      if (!invoice) throw new DomainError('NOT_FOUND', 'Invoice was not found', 404);

      let lines = rows(
        await tx.execute(sql`
          SELECT l.*, COALESCE(l.description, it.name_ar) AS label, it.sku,
                 COALESCE(u.name_ar, u.code) AS unit_label, u.code AS unit_code, it.name_ar AS item_name
            FROM purchase_invoice_lines l
            LEFT JOIN items it ON it.id = l.item_id
            LEFT JOIN units_of_measure u ON u.id = it.base_unit_id
           WHERE l.tenant_id = ${tenantId} AND l.invoice_id = ${id}
           ORDER BY l.line_no
        `),
      );

      const isReturn = str(invoice.kind) === 'purchase_return' || str(invoice.kind) === 'return';
      const print = applyDocSettings(
        baseP,
        docScopes.get(isReturn ? 'doc:purchase_return' : 'doc:purchase_invoice'),
      );
      lines = this.sortByPrintItemType(lines, print.printItemType);
      const kindTitle = isReturn ? 'مردود مشتريات' : 'فاتورة مشتريات';
      const supplierTaxNo = str(invoice.party_tax_no).trim();
      return this.documentPage(print, company, {
        title: `${kindTitle} ${str(invoice.number) || ''}`.trim(),
        body: `
          ${this.header(
            company,
            {
              docTitle: kindTitle,
              docTitleEn: isReturn ? 'Purchase Return' : 'Purchase Invoice',
              number: str(invoice.number) || '—',
              date: dateText(invoice.posted_at ?? invoice.created_at),
              status: STATUS_LABELS[str(invoice.status)] ?? str(invoice.status),
              extra: [
                ['الفرع', str(invoice.branch_name)],
                ['المستودع', str(invoice.warehouse_name)],
                ['مرجع المورد', str(invoice.supplier_reference_no)],
              ],
            },
            print.printHeader,
          )}
          ${this.partyBlock('بيانات المورد', {
            name: str(invoice.party_name) || '—',
            code: str(invoice.party_code),
            taxNo: supplierTaxNo,
            phone: str(invoice.party_phone),
            address: supplierTaxNo ? invoice.party_address : null,
          })}
          ${this.linesTable(lines)}
          ${this.totalsBlock({
            currency: str(invoice.currency) || 'SAR',
            subtotal: str(invoice.subtotal),
            discount: str(invoice.invoice_discount),
            tax: str(invoice.tax_total),
            extraTax: str(invoice.extra_tax),
            withholding: str(invoice.withholding),
            additional: str(invoice.additional_cost_total),
            total: str(invoice.total),
            paid: str(invoice.paid_total),
            payments: [],
            qrApplicable: false,
          })}
          ${customFieldsHtml(print.designConfig, 'above_table')}
          ${this.signatures(signatureLabels(print.designConfig, ['المورد', 'أمين المستودع', 'المحاسب']))}
          ${customFieldsHtml(print.designConfig, 'below_table')}
          ${customTermsHtml(print.designConfig)}
        `,
      });
    });
  }

  async voucher(tenantId: string, id: string, query: DocumentPrintQuery = {}) {
    const baseV = applyQueryOverrides(await this.settingsFor(tenantId, 'default'), query);
    const docScopes = await this.readDocScopes(tenantId, ['doc:receipt_voucher', 'doc:payment_voucher']);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const company = await this.company(tx, tenantId);
      const voucher = first(
        await tx.execute(sql`
          SELECT v.*, b.name_ar AS branch_name, p.name AS party_name, p.code AS party_code,
                 c.name AS cash_location_name, a.code AS counter_code, a.name_ar AS counter_name,
                 cc.code AS cost_center_code, cc.name_ar AS cost_center_name
            FROM vouchers v
            LEFT JOIN branches b ON b.id = v.branch_id
            LEFT JOIN parties p ON p.id = v.party_id
            LEFT JOIN cash_locations c ON c.id = v.cash_location_id
            LEFT JOIN accounts a ON a.id = v.counter_account_id
            LEFT JOIN cost_centers cc ON cc.id = v.cost_center_id
           WHERE v.tenant_id = ${tenantId} AND v.id = ${id}
        `),
      );
      if (!voucher) throw new DomainError('NOT_FOUND', 'Voucher was not found', 404);

      const isReceipt = str(voucher.kind) === 'receipt';
      const print = applyDocSettings(
        baseV,
        docScopes.get(isReceipt ? 'doc:receipt_voucher' : 'doc:payment_voucher'),
      );
      const currency = str(voucher.currency) || 'SAR';
      const voucherAmount = str(voucher.amount);
      const label = isReceipt ? 'سند قبض' : 'سند صرف';
      const counterparty = str(voucher.party_name) || str(voucher.recipient) || '—';

      return this.documentPage(print, company, {
        title: `${label} ${str(voucher.number) || ''}`.trim(),
        body: `
          ${this.header(
            company,
            {
              docTitle: label,
              docTitleEn: isReceipt ? 'Receipt Voucher' : 'Payment Voucher',
              number: str(voucher.number) || '—',
              date: dateText(voucher.date),
              status: STATUS_LABELS[str(voucher.status)] ?? str(voucher.status),
              extra: [
                ['الفرع', str(voucher.branch_name)],
                ['الصندوق / البنك', str(voucher.cash_location_name)],
                ['طريقة الدفع', PAYMENT_METHODS[str(voucher.method)] ?? str(voucher.method)],
              ],
            },
            print.printHeader,
          )}
          <section class="panel">
            <div class="kv"><span>${isReceipt ? 'استلمنا من السيد' : 'صرفنا إلى السيد'}</span><b>${escapeHtml(counterparty)}</b></div>
            <div class="kv"><span>مبلغاً وقدره</span><b>${escapeHtml(money(voucherAmount))} ${escapeHtml(currency)}</b></div>
            <div class="kv words"><span>فقط</span><b>${escapeHtml(amountInArabicWords(voucherAmount, currency))}</b></div>
            <div class="kv"><span>وذلك عن</span><b>${escapeHtml(str(voucher.counter_name) || VOUCHER_SUBTYPES[str(voucher.subtype)] || str(voucher.subtype))}</b></div>
            ${str(voucher.reference_no) ? `<div class="kv"><span>المرجع</span><b>${escapeHtml(str(voucher.reference_no))}</b></div>` : ''}
            ${str(voucher.cheque_no) ? `<div class="kv"><span>الشيك</span><b>${escapeHtml(str(voucher.cheque_no))} — ${escapeHtml(str(voucher.bank_name))} — ${escapeHtml(dateText(voucher.cheque_date))}</b></div>` : ''}
            ${str(voucher.cost_center_name) ? `<div class="kv"><span>مركز التكلفة</span><b>${escapeHtml(`${str(voucher.cost_center_code)} — ${str(voucher.cost_center_name)}`)}</b></div>` : ''}
            ${new Decimal(str(voucher.vat_amount) || '0').gt(0) ? `<div class="kv"><span>منها ضريبة القيمة المضافة</span><b>${escapeHtml(money(str(voucher.vat_amount)))}</b></div>` : ''}
          </section>
          ${customFieldsHtml(print.designConfig, 'meta')}
          ${customFieldsHtml(print.designConfig, 'below_table')}
          ${this.signatures(
            signatureLabels(print.designConfig, [
              isReceipt ? 'المستلم' : 'المستفيد',
              'أمين الصندوق',
              'المدير المالي',
            ]),
          )}
          ${customTermsHtml(print.designConfig)}
        `,
      });
    });
  }

  async journalEntry(tenantId: string, id: string, query: DocumentPrintQuery = {}) {
    const baseJ = applyQueryOverrides(await this.settingsFor(tenantId, 'default'), query);
    const docScopes = await this.readDocScopes(tenantId, ['doc:journal_entry']);
    const print = applyDocSettings(baseJ, docScopes.get('doc:journal_entry'));
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const company = await this.company(tx, tenantId);
      const entry = first(
        await tx.execute(sql`
          SELECT j.*, b.name_ar AS branch_name FROM journal_entries j
            LEFT JOIN branches b ON b.id = j.branch_id
           WHERE j.tenant_id = ${tenantId} AND j.id = ${id}
        `),
      );
      if (!entry) throw new DomainError('NOT_FOUND', 'Journal entry was not found', 404);

      const lines = rows(
        await tx.execute(sql`
          SELECT l.line_no, l.debit, l.credit, l.description, a.code AS account_code, a.name_ar AS account_name,
                 cc.code AS cost_center_code, p.name AS party_name
            FROM journal_entry_lines l
            LEFT JOIN accounts a ON a.id = l.account_id
            LEFT JOIN cost_centers cc ON cc.id = l.cost_center_id
            LEFT JOIN parties p ON p.id = l.party_id
           WHERE l.tenant_id = ${tenantId} AND l.entry_id = ${id}
           ORDER BY l.line_no
        `),
      );
      const debit = lines.reduce((sum, row) => sum.plus(str(row.debit) || '0'), new Decimal(0));
      const credit = lines.reduce((sum, row) => sum.plus(str(row.credit) || '0'), new Decimal(0));

      return this.documentPage(print, company, {
        title: `سند قيد ${str(entry.number) || ''}`.trim(),
        body: `
          ${this.header(
            company,
            {
              docTitle: 'سند قيد',
              docTitleEn: 'Journal Voucher',
              number: str(entry.number) || '—',
              date: dateText(entry.date),
              status: STATUS_LABELS[str(entry.status)] ?? str(entry.status),
              extra: [
                ['الفرع', str(entry.branch_name)],
                ['البيان', str(entry.description)],
              ],
            },
            print.printHeader,
          )}
          <table class="lines">
            <thead>
              <tr><th>#</th><th>الحساب</th><th>البيان</th><th>مركز التكلفة</th><th>الجهة</th><th>مدين</th><th>دائن</th></tr>
            </thead>
            <tbody>
              ${lines
                .map(
                  (row) => `<tr>
                    <td class="num">${escapeHtml(str(row.line_no))}</td>
                    <td>${escapeHtml(`${str(row.account_code)} — ${str(row.account_name)}`)}</td>
                    <td>${escapeHtml(str(row.description))}</td>
                    <td>${escapeHtml(str(row.cost_center_code))}</td>
                    <td>${escapeHtml(str(row.party_name))}</td>
                    <td class="num">${escapeHtml(money(str(row.debit)))}</td>
                    <td class="num">${escapeHtml(money(str(row.credit)))}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
            <tfoot>
              <tr><th colspan="5">الإجمالي</th><th class="num">${escapeHtml(money(debit.toFixed(2)))}</th><th class="num">${escapeHtml(money(credit.toFixed(2)))}</th></tr>
            </tfoot>
          </table>
          <p class="words">فقط ${escapeHtml(amountInArabicWords(debit.toFixed(2), 'SAR'))}</p>
          ${customFieldsHtml(print.designConfig, 'below_table')}
          ${this.signatures(signatureLabels(print.designConfig, ['المحاسب', 'المراجع', 'المدير المالي']))}
          ${customTermsHtml(print.designConfig)}
        `,
      });
    });
  }

  async shiftClose(tenantId: string, id: string, query: DocumentPrintQuery = {}) {
    const baseS = applyQueryOverrides(await this.settingsFor(tenantId, 'reports'), query);
    const docScopes = await this.readDocScopes(tenantId, ['doc:shift_close']);
    const print = applyDocSettings(baseS, docScopes.get('doc:shift_close'));
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const company = await this.company(tx, tenantId);
      const shift = first(
        await tx.execute(sql`
          SELECT s.*, b.name_ar AS branch_name FROM shift_closes s
            LEFT JOIN branches b ON b.id = s.branch_id
           WHERE s.tenant_id = ${tenantId} AND s.id = ${id}
        `),
      );
      if (!shift) throw new DomainError('NOT_FOUND', 'Shift was not found', 404);

      const counts = rows(
        await tx.execute(
          sql`SELECT currency_code, denomination, count, total FROM cash_count_lines WHERE tenant_id = ${tenantId} AND shift_close_id = ${id} ORDER BY denomination DESC`,
        ),
      );
      const totals = rows(
        await tx.execute(
          sql`SELECT kind, method, amount FROM shift_close_lines WHERE tenant_id = ${tenantId} AND shift_close_id = ${id} ORDER BY line_no`,
        ),
      );
      const diff = new Decimal(str(shift.diff) || '0');

      return this.documentPage(print, company, {
        title: 'إغلاق اليومية',
        body: `
          ${this.header(
            company,
            {
              docTitle: 'إغلاق اليومية',
              docTitleEn: 'Shift Close',
              number: shortId(str(shift.id)),
              date: dateText(shift.closed_at ?? shift.opened_at),
              status: str(shift.status) === 'closed' ? 'مغلقة' : 'مفتوحة',
              extra: [
                ['الفرع', str(shift.branch_name)],
                ['الفتح', dateTimeText(shift.opened_at)],
                ['الإغلاق', dateTimeText(shift.closed_at)],
              ],
            },
            print.printHeader,
          )}
          <section class="panel">
            <div class="kv"><span>النقد المتوقع</span><b>${escapeHtml(money(str(shift.expected_cash)))}</b></div>
            <div class="kv"><span>النقد المعدود</span><b>${escapeHtml(money(str(shift.counted_cash)))}</b></div>
            <div class="kv"><span>الفرق</span><b class="${diff.isZero() ? '' : 'warn'}">${escapeHtml(money(str(shift.diff)))}${diff.isZero() ? ' (مطابق)' : diff.gt(0) ? ' (زيادة)' : ' (عجز)'}</b></div>
          </section>
          ${
            totals.length
              ? `<table class="lines"><thead><tr><th>البند</th><th>طريقة الدفع</th><th>المبلغ</th></tr></thead><tbody>
                  ${totals.map((row) => `<tr><td>${escapeHtml(str(row.kind))}</td><td>${escapeHtml(PAYMENT_METHODS[str(row.method)] ?? str(row.method))}</td><td class="num">${escapeHtml(money(str(row.amount)))}</td></tr>`).join('')}
                 </tbody></table>`
              : ''
          }
          ${
            counts.length
              ? `<table class="lines"><thead><tr><th>الفئة</th><th>العدد</th><th>الإجمالي</th></tr></thead><tbody>
                  ${counts.map((row) => `<tr><td class="num">${escapeHtml(money(str(row.denomination)))}</td><td class="num">${escapeHtml(str(row.count))}</td><td class="num">${escapeHtml(money(str(row.total)))}</td></tr>`).join('')}
                 </tbody></table>`
              : ''
          }
          ${customFieldsHtml(print.designConfig, 'below_table')}
          ${this.signatures(signatureLabels(print.designConfig, ['الكاشير', 'المشرف', 'المحاسب']))}
          ${customTermsHtml(print.designConfig)}
        `,
      });
    });
  }

  /**
   * قالب طباعة أي تقرير A4/80mm وفق ترويسة `header.repx` وتذييل `footer.repx`.
   */
  async reportSheet(
    tenantId: string,
    report: {
      titleAr: string;
      columns: Array<{ key: string; labelAr: string; numeric: boolean; qr?: boolean }>;
      rows: Array<Record<string, string>>;
      totals: Record<string, string>;
      grandTotal?: Array<{ labelAr: string; amount: string }>;
      captions: string[];
      generatedAt: string;
      emptyAr?: string;
      signature?: boolean;
      print?: ReportPrintOptions;
    },
    userId?: string,
  ) {
    const company = await withTenantTx(this.database.db, tenantId, async (tx) => this.company(tx, tenantId));
    const userName = userId ? await this.userName(tenantId, userId) : null;

    const settings = report.print?.settings;
    const design = settings?.designConfig;
    const copies = Math.min(50, Math.max(1, report.print?.copies ?? 1));
    const paper = report.print?.paper ?? 'a4';
    const showHeader = settings?.printHeader !== false;
    const showFooter = settings?.printFooter === true;
    const stamp = settings?.printStamp === false ? '' : (settings?.stampImageUrl || company.stampUrl || '');
    const showSignatures = settings?.showSignatures !== false;
    const note = (settings?.note ?? '').trim();
    const image = (src: string, alt: string) =>
      src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />` : '';

    const columns = resolveColumns(design, report.columns.map((column) => ({ key: column.key, labelAr: column.labelAr })))
      .map((column) => {
        const source = report.columns.find((entry) => entry.key === column.key)!;
        return { ...source, labelAr: column.labelAr };
      });
    const head = columns.map((column) => `<th>${escapeHtml(column.labelAr)}</th>`).join('');
    const body = report.rows.length
      ? report.rows
          .map(
            (row, index) =>
              `<tr><td class="num">${index + 1}</td>${columns
                .map((column) =>
                  column.qr
                    ? `<td class="qr-cell">${this.reportQr(row[column.key] ?? '')}</td>`
                    : `<td${column.numeric ? ' class="num"' : ''}>${escapeHtml(cellText(row[column.key] ?? '', column.numeric))}</td>`,
                )
                .join('')}</tr>`,
          )
          .join('')
      : `<tr><td class="empty" colspan="${columns.length + 1}">${escapeHtml(report.emptyAr ?? 'لا توجد بيانات ضمن معايير البحث المحددة.')}</td></tr>`;
    const hasTotals = Object.keys(report.totals).length > 0;
    const footer = hasTotals
      ? `<tfoot><tr><th>الإجمالي</th>${columns
          .map(
            (column) =>
              column.qr
                ? '<th></th>'
                : `<th class="num">${report.totals[column.key] ? escapeHtml(money(report.totals[column.key]!)) : ''}</th>`,
          )
          .join('')}</tr></tfoot>`
      : '';

    const titles = customTitles(design);
    const reportTitle = titles.titleAr || report.titleAr;
    const signatureStrip = signatureLabels(design, ['أعده', 'راجعه', 'المدير']);

    const sections: WorksheetSection[] = [
      {
        key: 'letterhead',
        html: showHeader ? this.renderRepxLetterhead(company, settings?.headerImageUrl ?? '') : '',
      },
      {
        key: 'titleBanner',
        html: `<div class="repx-report-banner">
          <div class="doc-title">${escapeHtml(reportTitle)}</div>
          ${titles.subtitleAr ? `<div class="doc-title-en">${escapeHtml(titles.subtitleAr)}</div>` : ''}
          <div class="repx-report-meta">
            ${report.captions.map((caption) => `<span>${escapeHtml(caption)}</span>`).join('')}
            <span>عدد السجلات: ${report.rows.length}</span>
            ${userName ? `<span>المستخدم: ${escapeHtml(userName)}</span>` : ''}
            <span>طُبع في: ${escapeHtml(dateTimeText(report.generatedAt))}</span>
            ${copies > 1 ? `<span>عدد النسخ: ${copies}</span>` : ''}
          </div>
        </div>`,
      },
      { key: 'customTop', html: `${customHeaderLinesHtml(design)}${customFieldsHtml(design, 'above_table')}` },
      {
        key: 'linesTable',
        html: `<table class="lines report">
          <thead><tr><th>#</th>${head}</tr></thead>
          <tbody>${body}</tbody>
          ${footer}
        </table>`,
      },
      {
        key: 'totalsAndQr',
        html: `${
          report.grandTotal?.length
            ? `<div class="totals-strip">${report.grandTotal
                .map(
                  (card) =>
                    `<span><b>${escapeHtml(card.labelAr)}:</b> ${escapeHtml(money(card.amount))}</span>`,
                )
                .join('')}</div>`
            : ''
        }
        ${note ? `<div class="doc-note"><b>ملاحظات التقرير:</b> ${escapeHtml(note).replace(/\n/g, '<br />')}</div>` : ''}
        ${stamp ? `<div class="doc-stamp">${image(stamp, 'الختم')}</div>` : ''}`,
      },
      { key: 'customBottom', html: `${customFieldsHtml(design, 'below_table')}${customTermsHtml(design)}` },
      {
        key: 'signatures',
        html:
          report.signature && showSignatures
            ? `<table class="signatures"><tr>${signatureStrip
                .map((label) => `<td>${escapeHtml(label)}</td>`)
                .join('')}</tr><tr>${signatureStrip.map(() => '<td>&nbsp;</td>').join('')}</tr></table>`
            : '',
      },
      { key: 'footer', html: showFooter ? this.renderRepxFooter(company, settings?.footerImageUrl ?? '') : '' },
    ];

    const sheet = composeSections(design, sections);

    const sheets =
      copies === 1
        ? sheet
        : Array.from({ length: copies }, () => `<div class="copy">${sheet}</div>`).join('');
    const printers = [settings?.casherPrinter, settings?.kitchenPrinter]
      .filter(Boolean)
      .map((name) => escapeHtml(name!));
    const toolbar = [
      printers.length ? `الطابعات: ${printers.join(' · ')}` : '',
      copies > 1 ? `عدد النسخ: ${copies}` : '',
      paper === 'small' ? `ورق صغير ${design?.paperWidthMm === 58 ? 58 : 80}mm` : 'ورقة A4',
    ]
      .filter(Boolean)
      .join(' — ');

    return this.page({
      title: reportTitle,
      // اتجاه الورقة: التصميم يحكم؛ والتقارير أفقية افتراضياً كما كانت.
      landscape: design?.orientation ? design.orientation === 'landscape' : true,
      paper,
      toolbar,
      style: printStyle(settings, company.brandColor),
      design,
      body: sheets,
    });
  }

  // --------------------------------------------------- rptInvA4 & rptInv renderers

  /**
   * تصميم فاتورة A4 الرسمي المطابق لقالب `rptInvA4.repx`.
   */
  private renderSalesInvoiceA4(
    company: Awaited<ReturnType<PrintTemplatesService['company']>>,
    print: PrintSettings,
    inv: {
      invoiceTitleAr: string;
      invoiceTitleEn: string;
      number: string;
      date: string;
      time: string;
      supplyDate: string;
      status: string;
      branchName: string;
      warehouseName: string;
      salesmanName: string;
      cashierName: string;
      referenceNo: string;
      paymentMethodLabel: string;
      customerName: string;
      customerCode: string;
      customerTaxNo: string;
      customerPhone: string;
      customerAddress: Record<string, unknown> | null;
      lines: Array<Record<string, unknown>>;
      currency: string;
      subtotal: string;
      discount: string;
      tax: string;
      extraTax?: string;
      withholding?: string;
      total: string;
      paid: string;
      payments: Array<{ method: string; amount: string; reference: string }>;
      qrPayload: string;
      isPhaseTwo: boolean;
      zatcaStatus: string;
      notes: string;
      returnPolicy: string;
    },
  ) {
    const due = Decimal.max(0, new Decimal(inv.total || '0').minus(inv.paid || '0'));
    const grossBeforeDiscount = new Decimal(inv.subtotal || '0').plus(inv.discount || '0');
    const stampSrc = print.printStamp === false ? '' : (print.stampImageUrl || company.stampUrl || '');
    const companyAddrGrid = this.renderNationalAddressGrid(
      'العنوان الوطني للمنشأة',
      company.address,
      company.crn || company.crNo,
    );
    const customerAddrGrid = inv.customerTaxNo
      ? this.renderNationalAddressGrid('العنوان الوطني للعميل', inv.customerAddress, '', true)
      : '';

    // 🧩 التصميم: أعمدة الجدول وترتيبها وتسمياتها من `designConfig`، والقيم نفسها من المستند.
    const design = print.designConfig;
    const columns = resolveColumns(design, [
      { key: 'no', labelAr: 'م<br/><small>No</small>' },
      { key: 'sku', labelAr: 'الكود<br/><small>Code</small>' },
      { key: 'description', labelAr: 'اسم الصنف / البيان<br/><small>Description</small>' },
      { key: 'unit', labelAr: 'الوحدة<br/><small>Unit</small>' },
      { key: 'qty', labelAr: 'الكمية<br/><small>Qty</small>' },
      { key: 'unitPrice', labelAr: 'السعر<br/><small>Price</small>' },
      { key: 'gross', labelAr: 'الإجمالي<br/><small>Gross</small>' },
      { key: 'discount', labelAr: 'الخصم<br/><small>Disc.</small>' },
      { key: 'vat', labelAr: 'الضريبة<br/><small>VAT</small>' },
      { key: 'netTotal', labelAr: 'الصافي<br/><small>Net Total</small>' },
    ]);
    const columnCell = (line: Record<string, unknown>, key: string, idx: number): string => {
      const qtyDec = new Decimal(str(line.quantity) || '0');
      const priceDec = new Decimal(str(line.unit_price) || '0');
      const grossLine = qtyDec.mul(priceDec);
      switch (key) {
        case 'no':
          return `<td class="num center">${escapeHtml(str(line.line_no || idx + 1))}</td>`;
        case 'sku':
          return `<td class="num center">${escapeHtml(str(line.sku) || '—')}</td>`;
        case 'description':
          return `<td><b>${escapeHtml(str(line.label))}</b></td>`;
        case 'unit':
          return `<td class="center">${escapeHtml(str(line.unit_label || line.unit_code) || '—')}</td>`;
        case 'qty':
          return `<td class="num center">${escapeHtml(qty(str(line.quantity)))}</td>`;
        case 'unitPrice':
          return `<td class="num">${escapeHtml(money(str(line.unit_price)))}</td>`;
        case 'gross':
          return `<td class="num">${escapeHtml(money(grossLine.toFixed(2)))}</td>`;
        case 'discount':
          return `<td class="num">${escapeHtml(money(str(line.discount_amount)))}</td>`;
        case 'vat':
          return `<td class="num">${escapeHtml(money(str(line.tax)))}</td>`;
        case 'netTotal':
          return `<td class="num bold-cell">${escapeHtml(money(str(line.total)))}</td>`;
        default:
          return '<td></td>';
      }
    };

    const lineRows = inv.lines.length
      ? inv.lines
          .map((line, idx) =>
            `<tr>${columns.map((column) => columnCell(line, column.key, idx)).join('')}</tr>`,
          )
          .join('')
      : `<tr><td colspan="${columns.length}" class="empty">لا توجد بنود على هذه الفاتورة.</td></tr>`;

    const signLabels = signatureLabels(design, [
      'المستلم — Receiver',
      'الختم — Official Stamp',
      'البائع / المحاسب — Seller',
    ]);
    const signCells = signLabels.map((label, index) => {
      const isStamp = /الختم|stamp/i.test(label);
      const value = isStamp
        ? stampSrc
          ? `<img src="${escapeHtml(stampSrc)}" alt="الختم" class="stamp-inline" />`
          : '&nbsp;'
        : index === signLabels.length - 1
          ? escapeHtml(inv.salesmanName || inv.cashierName || '') || '&nbsp;'
          : '&nbsp;';
      return `<td><div class="sign-label">${escapeHtml(label)}</div><div class="sign-space">${value}</div></td>`;
    });

    const sections: WorksheetSection[] = [
      {
        key: 'letterhead',
        html:
          print.printHeader !== false
            ? this.renderRepxLetterhead(company, print.headerImageUrl, design?.showCompanyBanks !== false)
            : '',
      },
      {
        key: 'nationalAddress',
        html:
          print.printHeader !== false && design?.showNationalAddress !== false ? companyAddrGrid : '',
      },
      {
        key: 'titleBanner',
        html: `<div class="repx-title-banner">
          <div class="doc-title">${escapeHtml(customTitles(design).titleAr || inv.invoiceTitleAr)}</div>
          <div class="doc-title-en">${escapeHtml(customTitles(design).subtitleAr || inv.invoiceTitleEn)}</div>
        </div>`,
      },
      {
        key: 'metaGrid',
        html: design?.showMetaGrid === false ? '' : `<table class="repx-meta-grid">
          <tr>
            <th>رقم الفاتورة</th>
            <td dir="ltr"><b>${escapeHtml(inv.number)}</b></td>
            <th>نوع السداد</th>
            <td>${escapeHtml(inv.paymentMethodLabel)}</td>
            <th>التاريخ والوقت</th>
            <td dir="ltr">${escapeHtml(`${inv.date} ${inv.time}`.trim())}</td>
          </tr>
          <tr>
            <th>الفرع / نقطة البيع</th>
            <td>${escapeHtml(inv.branchName || 'الفرع الرئيسي')}</td>
            <th>تاريخ التوريد</th>
            <td dir="ltr">${escapeHtml(inv.supplyDate)}</td>
            <th>الحالة / المرجع</th>
            <td>${escapeHtml(inv.referenceNo ? `${inv.status} — ${inv.referenceNo}` : inv.status)}</td>
          </tr>
          </table>
          ${customFieldsHtml(design, 'meta')}`,
      },
      {
        key: 'partyBox',
        html: design?.showPartyBox === false ? '' : `<section class="party repx-customer-box">
          <div class="repx-box-head">بيانات العميل / المشتري — Customer Details</div>
          <table class="repx-meta-grid inner">
            <tr>
              <th>اسم العميل</th>
              <td><b>${escapeHtml(inv.customerName)}</b>${inv.customerCode ? ` <span class="sku" style="display:inline" dir="ltr">(${escapeHtml(inv.customerCode)})</span>` : ''}</td>
              ${inv.customerTaxNo ? `<th>الرقم الضريبي للعميل</th><td dir="ltr"><b>${escapeHtml(inv.customerTaxNo)}</b></td>` : '<th>نوع الفاتورة</th><td>مبسطة (مستهلك نهائي)</td>'}
            </tr>
            <tr>
              <th>الجوال / الهاتف</th>
              <td dir="ltr">${escapeHtml(inv.customerPhone || '—')}</td>
              <th>المندوب / البائع</th>
              <td>${escapeHtml(inv.salesmanName || inv.cashierName || '—')}</td>
            </tr>
          </table>
          ${customerAddrGrid}
        </section>`,
      },
      { key: 'customTop', html: `${customHeaderLinesHtml(design)}${customFieldsHtml(design, 'above_table')}` },
      {
        key: 'linesTable',
        html: `<table class="lines repx-inv-lines">
          <thead><tr>${columns.map((column) => `<th>${column.labelAr}</th>`).join('')}</tr></thead>
          <tbody>${lineRows}</tbody>
        </table>`,
      },
      {
        key: 'totalsAndQr',
        html: `<section class="repx-bottom-split">
          <div class="repx-bottom-right">
            <div class="repx-qr-and-words">
              ${this.qrBlock(inv.qrPayload, inv.zatcaStatus, true, inv.isPhaseTwo)}
              <div class="repx-words-stack">
                ${design?.showTafqeet === false ? '' : `<p class="words"><b>المبلغ بالحروف:</b> فقط ${escapeHtml(amountInArabicWords(inv.total, inv.currency))}</p>`}
                ${
                  inv.payments.length
                    ? `<table class="pay"><thead><tr><th>طريقة الدفع</th><th>المبلغ</th></tr></thead><tbody>
                        ${inv.payments
                          .map(
                            (row) =>
                              `<tr><td>${escapeHtml(row.method)}${row.reference ? ` — ${escapeHtml(row.reference)}` : ''}</td><td class="num">${escapeHtml(money(row.amount))}</td></tr>`,
                          )
                          .join('')}
                       </tbody></table>`
                    : ''
                }
                ${inv.notes ? `<div class="repx-note-box"><b>ملاحظات:</b> ${escapeHtml(inv.notes).replace(/\n/g, '<br/>')}</div>` : ''}
              </div>
            </div>
            ${
              inv.returnPolicy && design?.showReturnPolicy !== false
                ? `<div class="repx-policy-box"><b>سياسة الاسترجاع والاستبدال:</b><div>${escapeHtml(inv.returnPolicy).replace(/\n/g, '<br/>')}</div></div>`
                : ''
            }
          </div>

          <table class="totals-table repx-totals-box">
            <tr><th>الإجمالي قبل الخصم والضريبة</th><td class="num">${escapeHtml(money(grossBeforeDiscount.toFixed(2)))}</td></tr>
            <tr><th>مجموع الخصومات</th><td class="num">${escapeHtml(money(inv.discount))}</td></tr>
            <tr><th>الإجمالي الخاضع للضريبة</th><td class="num">${escapeHtml(money(inv.subtotal))}</td></tr>
            <tr><th>ضريبة القيمة المضافة (15%)</th><td class="num">${escapeHtml(money(inv.tax))}</td></tr>
            ${
              inv.extraTax && !new Decimal(inv.extraTax || '0').isZero()
                ? `<tr><th>ضريبة إضافية</th><td class="num">${escapeHtml(money(inv.extraTax))}</td></tr>`
                : ''
            }
            ${
              inv.withholding && !new Decimal(inv.withholding || '0').isZero()
                ? `<tr><th>الاستقطاع</th><td class="num">${escapeHtml(money(inv.withholding))}</td></tr>`
                : ''
            }
            <tr class="grand"><th>الصافي شامل الضريبة (${escapeHtml(inv.currency)})</th><td class="num">${escapeHtml(money(inv.total))}</td></tr>
            <tr><th>المدفوع</th><td class="num">${escapeHtml(money(inv.paid))}</td></tr>
            <tr><th>المتبقي</th><td class="num">${escapeHtml(money(due.toFixed(2)))}</td></tr>
          </table>
        </section>`,
      },
      { key: 'customBottom', html: `${customFieldsHtml(design, 'below_table')}${customTermsHtml(design)}` },
      {
        key: 'signatures',
        html: print.showSignatures === false ? '' : `<table class="repx-sign-strip"><tr>${signCells.join('')}</tr></table>`,
      },
      {
        key: 'footer',
        html: print.printFooter === true ? this.renderRepxFooter(company, print.footerImageUrl) : '',
      },
    ];

    return composeSections(design, sections);
  }

  /**
   * تصميم إيصال نقطة البيع كاشير (80mm) المطابق لقالب `rptInv.repx`.
   */
  private renderPosReceipt80mm(
    company: Awaited<ReturnType<PrintTemplatesService['company']>>,
    rec: {
      invoiceTitleAr: string;
      invoiceTitleEn: string;
      number: string;
      dateTime: string;
      branchName: string;
      warehouseName: string;
      salesmanName: string;
      cashierName: string;
      paymentMethodLabel: string;
      customerName: string;
      customerTaxNo: string;
      customerPhone: string;
      customerAddress: Record<string, unknown> | null;
      lines: Array<Record<string, unknown>>;
      currency: string;
      subtotal: string;
      discount: string;
      tax: string;
      total: string;
      paid: string;
      qrPayload: string;
      isPhaseTwo: boolean;
      zatcaStatus: string;
      notes: string;
      returnPolicy: string;
      showHeader: boolean;
      showSignatures?: boolean;
      design?: import('./print-settings.service.js').PrintDesignConfig;
    },
  ) {
    const due = Decimal.max(0, new Decimal(rec.total || '0').minus(rec.paid || '0'));
    const companyAddrText = company.addressAr || nationalAddressText(company.address);
    const customerAddrText = rec.customerTaxNo ? nationalAddressText(rec.customerAddress as Record<string, string> | null) : '';
    const design = rec.design;
    const titles = customTitles(design);

    const columns = resolveColumns(design, [
      { key: 'description', labelAr: 'الصنف' },
      { key: 'qty', labelAr: 'الكمية' },
      { key: 'unitPrice', labelAr: 'السعر' },
      { key: 'netTotal', labelAr: 'الإجمالي' },
    ]);
    const columnCell = (line: Record<string, unknown>, key: string): string => {
      switch (key) {
        case 'description': {
          const lineUnit = str(line.unit_label || line.unit_code);
          return `<td class="pos-item-col"><b>${escapeHtml(str(line.label))}</b>${
            lineUnit ? `<div class="pos-sub">${escapeHtml(lineUnit)}</div>` : ''
          }</td>`;
        }
        case 'qty':
          return `<td class="num center">${escapeHtml(qty(str(line.quantity)))}</td>`;
        case 'unitPrice':
          return `<td class="num">${escapeHtml(money(str(line.unit_price)))}</td>`;
        case 'netTotal':
          return `<td class="num bold-cell">${escapeHtml(money(str(line.total)))}</td>`;
        case 'sku':
          return `<td class="num center">${escapeHtml(str(line.sku) || '—')}</td>`;
        case 'unit':
          return `<td class="center">${escapeHtml(str(line.unit_label || line.unit_code) || '—')}</td>`;
        case 'discount':
          return `<td class="num">${escapeHtml(money(str(line.discount_amount)))}</td>`;
        case 'vat':
          return `<td class="num">${escapeHtml(money(str(line.tax)))}</td>`;
        default:
          return '<td></td>';
      }
    };
    const itemsRows = rec.lines
      .map((line) => `<tr>${columns.map((column) => columnCell(line, column.key)).join('')}</tr>`)
      .join('');

    const sections: WorksheetSection[] = [
      {
        key: 'letterhead',
        html:
          rec.showHeader !== false
            ? `<div class="pos-head company">
                <div class="pos-logo">${company.logoHtml}</div>
                <h1>${escapeHtml(company.nameAr)}</h1>
                ${company.fieldAr ? `<div class="pos-sub">${escapeHtml(company.fieldAr)}</div>` : ''}
                ${rec.branchName ? `<div class="pos-sub">الفرع: <b>${escapeHtml(rec.branchName)}</b></div>` : ''}
                ${company.taxNo ? `<div class="pos-sub">الرقم الضريبي: <b dir="ltr">${escapeHtml(company.taxNo)}</b></div>` : ''}
                ${company.crNo ? `<div class="pos-sub">السجل التجاري: <b dir="ltr">${escapeHtml(company.crNo)}</b></div>` : ''}
                ${company.phones.length ? `<div class="pos-sub" dir="ltr">${escapeHtml(company.phones.join(' - '))}</div>` : ''}
                ${companyAddrText ? `<div class="pos-sub">${escapeHtml(companyAddrText)}</div>` : ''}
                ${customHeaderLinesHtml(design)}
              </div>`
            : '',
      },
      {
        key: 'titleBanner',
        html: `<div class="pos-title-box">
          <div class="doc-title">${escapeHtml(titles.titleAr || rec.invoiceTitleAr)}</div>
          <div class="pos-title-en">${escapeHtml(titles.subtitleAr || rec.invoiceTitleEn)}</div>
        </div>`,
      },
      {
        key: 'metaGrid',
        html: design?.showMetaGrid === false ? '' : `<table class="pos-meta-table">
          <tr>
            <th>رقم الفاتورة</th>
            <td dir="ltr"><b>${escapeHtml(rec.number)}</b></td>
            <th>طريقة الدفع</th>
            <td><b>${escapeHtml(rec.paymentMethodLabel)}</b></td>
          </tr>
          <tr>
            <th>التاريخ</th>
            <td colspan="3" dir="ltr">${escapeHtml(rec.dateTime)}</td>
          </tr>
          ${
            rec.cashierName || rec.salesmanName
              ? `<tr>
                  <th>الكاشير</th>
                  <td>${escapeHtml(rec.cashierName || '—')}</td>
                  <th>المندوب</th>
                  <td>${escapeHtml(rec.salesmanName || '—')}</td>
                </tr>`
              : ''
          }
        </table>
        ${customFieldsHtml(design, 'meta')}`,
      },
      {
        key: 'partyBox',
        html: design?.showPartyBox === false ? '' : `<div class="pos-customer-box">
          <div><span>العميل:</span> <b>${escapeHtml(rec.customerName)}</b></div>
          ${rec.customerPhone ? `<div><span>جوال العميل:</span> <b dir="ltr">${escapeHtml(rec.customerPhone)}</b></div>` : ''}
          ${rec.customerTaxNo ? `<div><span>الرقم الضريبي للعميل:</span> <b dir="ltr">${escapeHtml(rec.customerTaxNo)}</b></div>` : ''}
          ${customerAddrText ? `<div data-national-address><span>العنوان الوطني للعميل:</span> <b>${escapeHtml(customerAddrText)}</b></div>` : ''}
        </div>`,
      },
      { key: 'customTop', html: `${customFieldsHtml(design, 'above_table')}` },
      {
        key: 'linesTable',
        html: `<table class="lines pos-lines">
          <thead>
            <tr>${columns.map((column) => `<th>${column.labelAr}</th>`).join('')}</tr>
          </thead>
          <tbody>${itemsRows}</tbody>
        </table>`,
      },
      {
        key: 'totalsAndQr',
        html: `<table class="pos-totals-table">
          <tr><th>الإجمالي قبل الضريبة</th><td class="num">${escapeHtml(money(rec.subtotal))}</td></tr>
          ${
            !new Decimal(rec.discount || '0').isZero()
              ? `<tr><th>الخصم</th><td class="num">${escapeHtml(money(rec.discount))}</td></tr>`
              : ''
          }
          <tr><th>ضريبة القيمة المضافة (15%)</th><td class="num">${escapeHtml(money(rec.tax))}</td></tr>
          <tr class="grand"><th>الصافي شامل الضريبة (${escapeHtml(rec.currency)})</th><td class="num">${escapeHtml(money(rec.total))}</td></tr>
          <tr><th>المدفوع</th><td class="num">${escapeHtml(money(rec.paid))}</td></tr>
          ${!due.isZero() ? `<tr><th>المتبقي</th><td class="num">${escapeHtml(money(due.toFixed(2)))}</td></tr>` : ''}
        </table>

        ${design?.showTafqeet === false ? '' : `<p class="pos-words">فقط ${escapeHtml(amountInArabicWords(rec.total, rec.currency))}</p>`}

        ${rec.notes ? `<div class="pos-note"><b>ملاحظات:</b> ${escapeHtml(rec.notes).replace(/\n/g, '<br/>')}</div>` : ''}
        ${
          rec.returnPolicy && design?.showReturnPolicy !== false
            ? `<div class="pos-policy"><b>سياسة الاسترجاع والاستبدال:</b><div>${escapeHtml(rec.returnPolicy).replace(/\n/g, '<br/>')}</div></div>`
            : ''
        }

        <div class="pos-qr-wrap">
          ${this.qrBlock(rec.qrPayload, rec.zatcaStatus, true, rec.isPhaseTwo)}
        </div>`,
      },
      { key: 'customBottom', html: `${customFieldsHtml(design, 'below_table')}${customTermsHtml(design)}` },
      {
        key: 'signatures',
        html:
          rec.showSignatures === false
            ? ''
            : `<div class="pos-sign">${signatureLabels(design, ['الكاشير', 'المستلم'])
                .map((label) => `<span>${escapeHtml(label)}</span>`)
                .join('')}</div>`,
      },
      { key: 'footer', html: '' },
    ];

    return composeSections(design, sections);
  }

  /**
   * الترويسة الرسمية ثلاثية الأعمدة وفق `header.repx` و`rptInvA4.repx`.
   */
  private renderRepxLetterhead(
    company: Awaited<ReturnType<PrintTemplatesService['company']>>,
    headerImageUrl = '',
    includeBanks = false,
  ) {
    const titleStyle = company.brandColor ? ` style="color:${company.brandColor}"` : '';
    const phones = company.phones.join(' / ');
    const shortAddrAr = company.addressAr || addressText(company.address);
    const shortAddrEn = company.addressEn || '';
    const banksHtml =
      includeBanks && company.banks.length
        ? `<div class="repx-banks">${company.banks
            .map(
              (b) =>
                `<div><b>${escapeHtml(b.name)}:</b> <span dir="ltr">${escapeHtml(b.iban)}</span></div>`,
            )
            .join('')}</div>`
        : '';

    return `
      <header class="company" data-letterhead="repx">
        <div class="repx-lh-right">
          <h1${titleStyle}>${escapeHtml(company.nameAr)}</h1>
          ${company.fieldAr ? `<div class="repx-field">${escapeHtml(company.fieldAr)}</div>` : ''}
          <div class="repx-kv-list">
            ${company.taxNo ? `<div>الرقم الضريبي: <b dir="ltr">${escapeHtml(company.taxNo)}</b></div>` : '<div class="warn">لم يُسجَّل الرقم الضريبي في بطاقة المنشأة</div>'}
            ${company.crNo ? `<div>السجل التجاري: <b dir="ltr">${escapeHtml(company.crNo)}</b></div>` : ''}
            ${phones ? `<div>هاتف / جوال: <b dir="ltr">${escapeHtml(phones)}</b></div>` : ''}
            ${shortAddrAr ? `<div>العنوان: ${escapeHtml(shortAddrAr)}</div>` : ''}
          </div>
        </div>
        <div class="repx-lh-center">
          ${company.logoHtml}
          ${headerImageUrl ? `<img src="${escapeHtml(headerImageUrl)}" alt="الترويـسة" class="repx-extra-header" />` : ''}
        </div>
        <div class="repx-lh-left" dir="ltr">
          ${company.nameEn ? `<div class="repx-en-name">${escapeHtml(company.nameEn)}</div>` : `<div class="repx-en-name">${escapeHtml(company.nameAr)}</div>`}
          ${company.fieldEn ? `<div class="repx-field">${escapeHtml(company.fieldEn)}</div>` : ''}
          <div class="repx-kv-list">
            ${company.taxNo ? `<div>VAT No.: <b>${escapeHtml(company.taxNo)}</b></div>` : ''}
            ${company.crNo ? `<div>C.R.: <b>${escapeHtml(company.crNo)}</b></div>` : ''}
            ${phones ? `<div>Tel: <b>${escapeHtml(phones)}</b></div>` : ''}
            ${shortAddrEn ? `<div>${escapeHtml(shortAddrEn)}</div>` : ''}
          </div>
          ${banksHtml}
        </div>
      </header>
    `;
  }

  /**
   * التذييل الرسمي المؤطّر وفق `footer.repx`.
   */
  private renderRepxFooter(
    company: Awaited<ReturnType<PrintTemplatesService['company']>>,
    footerImageUrl = '',
  ) {
    const addr = company.addressAr || nationalAddressText(company.address) || addressText(company.address);
    const phones = company.phones.join(' - ');
    return `
      <footer class="doc-foot">
        <div class="repx-foot-grid">
          <div>${addr ? `العنوان: ${escapeHtml(addr)}` : escapeHtml(company.nameAr)}</div>
          <div>${phones ? `هاتف / جوال: <b dir="ltr">${escapeHtml(phones)}</b>` : company.email ? escapeHtml(company.email) : ''}</div>
          <div>${company.taxNo ? `الرقم الضريبي: <b dir="ltr">${escapeHtml(company.taxNo)}</b>` : ''}${company.crNo ? ` · س.ت: <b dir="ltr">${escapeHtml(company.crNo)}</b>` : ''}</div>
        </div>
        ${footerImageUrl ? `<img src="${escapeHtml(footerImageUrl)}" alt="التـذيـيـل" />` : ''}
      </footer>
    `;
  }

  /**
   * جدول العنوان الوطني ذو الـ 8 خانات المطابق لـ `rptInvA4.repx`.
   */
  private renderNationalAddressGrid(
    captionAr: string,
    rawAddress: Record<string, unknown> | null | undefined,
    crnOrSub = '',
    alwaysRenderWhenValid = false,
  ) {
    const a = extractNationalAddressParts(rawAddress);
    const hasAny = Boolean(
      a.street || a.district || a.city || a.region || a.building || a.additional || a.postal || crnOrSub,
    );
    if (!hasAny && !alwaysRenderWhenValid) return '';
    if (!hasAny) return '';
    return `
      <div class="repx-na-wrap" data-national-address>
        <table class="repx-na-table">
          <thead>
            <tr>
              <th colspan="8" class="repx-na-caption">${escapeHtml(captionAr)}</th>
            </tr>
            <tr>
              <th>الشارع</th>
              <th>الحي</th>
              <th>المدينة</th>
              <th>المنطقة</th>
              <th>رقم المبنى</th>
              <th>الرقم الإضافي</th>
              <th>الرمز البريدي</th>
              <th>الرقم الموحد / الفرعي</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>${escapeHtml(a.street || '—')}</td>
              <td>${escapeHtml(a.district || '—')}</td>
              <td>${escapeHtml(a.city || '—')}</td>
              <td>${escapeHtml(a.region || a.country || 'المملكة العربية السعودية')}</td>
              <td dir="ltr">${escapeHtml(a.building || '—')}</td>
              <td dir="ltr">${escapeHtml(a.additional || '—')}</td>
              <td dir="ltr">${escapeHtml(a.postal || '—')}</td>
              <td dir="ltr">${escapeHtml(crnOrSub || a.unit || '—')}</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;
  }

  private async userName(tenantId: string, userId: string): Promise<string | null> {
    try {
      const row = first(
        await withTenantTx(this.database.db, tenantId, async (tx) =>
          rows(
            await tx.execute(
              sql`SELECT coalesce(full_name, email) AS name FROM users WHERE id = ${userId} LIMIT 1`,
            ),
          ),
        ),
      );
      return row?.name ? str(row.name) : null;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------- pieces

  // ------------------------------------------------------------------ previews

  /**
   * 👁️ معاينة القالب — تُرسم بنفس دوال الطباعة الحقيقية ونفس CSS، ببيانات نموذجية
   * صريحة. ولهذا فما تراه في الإعدادات هو ما يخرج من الطابعة بعد الحفظ، لا صورةً
   * تسويقية تفترق عن الورقة عند أول تغيير.
   */
  async samplePreview(tenantId: string, rawScope: string, printSettings: PrintSettings): Promise<string> {
    const company = await withTenantTx(this.database.db, tenantId, async (tx) => this.company(tx, tenantId));
    const print = { ...printSettings, scope: rawScope };
    const sampleLines = SAMPLE_LINES;
    const subtotal = '582.00';
    const tax = '87.30';
    const total = '669.30';

    // إيصال الكاشير يُطبع على ورق حراري افتراضياً، لكن اختيار «A4» في الشاشة يجب أن
    // يُغيّر المقاس فعلاً — وإلا بدا الخيار كأنه لا يفعل شيئاً (وهو ما شكا منه المستخدم).
    const posOnA4 = print.printType === 1;
    if ((rawScope === 'doc:pos_receipt' || rawScope === 'pos') && !posOnA4) {
      return this.documentPage({ ...print, printType: 2 }, company, {
        title: 'معاينة إيصال الكاشير',
        suppressAutoStampAndFooter: true,
        body: this.renderPosReceipt80mm(company, {
          invoiceTitleAr: 'فاتورة ضريبية مبسطة',
          invoiceTitleEn: 'Simplified Tax Invoice',
          number: 'SI-000042',
          dateTime: `${dateText(new Date())} ${timeText(new Date())}`,
          branchName: 'الفرع الرئيسي',
          warehouseName: 'المستودع الرئيسي',
          salesmanName: 'سالم العتيبي',
          cashierName: 'أحمد الشمري',
          paymentMethodLabel: 'نقداً',
          customerName: 'عميل نقدي',
          customerTaxNo: '',
          customerPhone: '',
          customerAddress: null,
          lines: sampleLines,
          currency: 'SAR',
          subtotal,
          discount: '0.00',
          tax,
          total,
          paid: total,
          qrPayload: SAMPLE_QR_PAYLOAD,
          isPhaseTwo: false,
          zatcaStatus: 'prepared',
          notes: 'نموذج معاينة — لا يُحتسب في أي سجل مالي.',
          returnPolicy: company.returnPolicy || 'تُسترجع البضاعة خلال 7 أيام بشرط إحضار أصل الفاتورة.',
          showHeader: print.printHeader,
          showSignatures: print.showSignatures,
          design: print.designConfig,
        }),
      });
    }

    if (rawScope === 'doc:receipt_voucher' || rawScope === 'doc:payment_voucher') {
      const isReceipt = rawScope === 'doc:receipt_voucher';
      const label = isReceipt ? 'سند قبض' : 'سند صرف';
      return this.documentPage(print, company, {
        title: `معاينة ${label}`,
        body: `
          ${this.header(
            company,
            {
              docTitle: label,
              docTitleEn: isReceipt ? 'Receipt Voucher' : 'Payment Voucher',
              number: isReceipt ? 'RV-000118' : 'PV-000207',
              date: dateText(new Date()),
              status: 'مرحّلة',
              extra: [
                ['الفرع', 'الفرع الرئيسي'],
                ['الصندوق / البنك', 'الصندوق الرئيسي'],
                ['طريقة الدفع', 'نقداً'],
              ],
            },
            print.printHeader,
          )}
          <section class="panel">
            <div class="kv"><span>${isReceipt ? 'استلمنا من السيد' : 'صرفنا إلى السيد'}</span><b>مؤسسة النخبة للتجارة</b></div>
            <div class="kv"><span>مبلغاً وقدره</span><b>1,250.75 SAR</b></div>
            <div class="kv words"><span>فقط</span><b>${escapeHtml(amountInArabicWords('1250.75', 'SAR'))}</b></div>
            <div class="kv"><span>وذلك عن</span><b>${isReceipt ? 'دفعة من عميل' : 'مصروف تشغيلي'}</b></div>
          </section>
          ${customFieldsHtml(print.designConfig, 'below_table')}
          ${this.signatures(
            signatureLabels(print.designConfig, [
              isReceipt ? 'المستلم' : 'المستفيد',
              'أمين الصندوق',
              'المدير المالي',
            ]),
          )}
          ${customTermsHtml(print.designConfig)}
        `,
      });
    }

    if (rawScope === 'doc:journal_entry') {
      const lines = [
        ['1', '1101 — الصندوق الرئيسي', 'دفعة نقدية من عميل', 'الرياض', 'مؤسسة النخبة', '1,250.75', ''],
        ['2', '1201 — العملاء', 'تسوية ذمة عميل', '', 'مؤسسة النخبة', '', '1,250.75'],
      ];
      return this.documentPage(print, company, {
        title: 'معاينة سند قيد',
        body: `
          ${this.header(
            company,
            {
              docTitle: 'سند قيد',
              docTitleEn: 'Journal Voucher',
              number: 'JV-000901',
              date: dateText(new Date()),
              status: 'مرحّلة',
              extra: [
                ['الفرع', 'الفرع الرئيسي'],
                ['البيان', 'تحصيل دفعة من عميل'],
              ],
            },
            print.printHeader,
          )}
          <table class="lines">
            <thead>
              <tr><th>#</th><th>الحساب</th><th>البيان</th><th>مركز التكلفة</th><th>الجهة</th><th>مدين</th><th>دائن</th></tr>
            </thead>
            <tbody>
              ${lines
                .map(
                  (row) => `<tr>
                    <td class="num">${row[0]}</td><td>${escapeHtml(row[1]!)}</td><td>${escapeHtml(row[2]!)}</td>
                    <td>${escapeHtml(row[3]!)}</td><td>${escapeHtml(row[4]!)}</td>
                    <td class="num">${escapeHtml(row[5]!)}</td><td class="num">${escapeHtml(row[6]!)}</td>
                  </tr>`,
                )
                .join('')}
            </tbody>
            <tfoot><tr><th colspan="5">الإجمالي</th><th class="num">1,250.75</th><th class="num">1,250.75</th></tr></tfoot>
          </table>
          <p class="words">فقط ${escapeHtml(amountInArabicWords('1250.75', 'SAR'))}</p>
          ${customFieldsHtml(print.designConfig, 'below_table')}
          ${this.signatures(signatureLabels(print.designConfig, ['المحاسب', 'المراجع', 'المدير المالي']))}
          ${customTermsHtml(print.designConfig)}
        `,
      });
    }

    if (rawScope === 'doc:shift_close') {
      return this.documentPage(print, company, {
        title: 'معاينة إغلاق اليومية',
        body: `
          ${this.header(
            company,
            {
              docTitle: 'إغلاق اليومية',
              docTitleEn: 'Shift Close',
              number: 'SH-000034',
              date: dateText(new Date()),
              status: 'مغلقة',
              extra: [
                ['الفرع', 'الفرع الرئيسي'],
                ['الفتح', dateTimeText(new Date(Date.now() - 8 * 3600_000))],
                ['الإغلاق', dateTimeText(new Date())],
              ],
            },
            print.printHeader,
          )}
          <section class="panel">
            <div class="kv"><span>النقد المتوقع</span><b>4,850.00</b></div>
            <div class="kv"><span>النقد المعدود</span><b>4,850.00</b></div>
            <div class="kv"><span>الفرق</span><b>0.00 (مطابق)</b></div>
          </section>
          ${customFieldsHtml(print.designConfig, 'below_table')}
          ${this.signatures(signatureLabels(print.designConfig, ['الكاشير', 'المشرف', 'المحاسب']))}
          ${customTermsHtml(print.designConfig)}
        `,
      });
    }

    if (
      rawScope === 'doc:purchase_invoice' ||
      rawScope === 'doc:purchase_return' ||
      rawScope === 'purchases'
    ) {
      const isReturn = rawScope === 'doc:purchase_return';
      const kindTitle = isReturn ? 'مردود مشتريات' : 'فاتورة مشتريات';
      return this.documentPage(print, company, {
        title: `معاينة ${kindTitle}`,
        body: `
          ${this.header(
            company,
            {
              docTitle: kindTitle,
              docTitleEn: isReturn ? 'Purchase Return' : 'Purchase Invoice',
              number: isReturn ? 'PR-000011' : 'PI-000356',
              date: dateText(new Date()),
              status: 'مرحّلة',
              extra: [
                ['الفرع', 'الفرع الرئيسي'],
                ['المستودع', 'المستودع الرئيسي'],
                ['مرجع المورد', 'SUP-8842'],
              ],
            },
            print.printHeader,
          )}
          ${this.partyBlock('بيانات المورد', {
            name: 'شركة الوفرة للتوريدات',
            code: 'SUP-004',
            taxNo: '310000000000021',
            phone: '0112345678',
            address: null,
          })}
          ${this.linesTable(sampleLines)}
          ${this.totalsBlock({
            currency: 'SAR',
            subtotal,
            discount: '0.00',
            tax,
            total,
            paid: total,
            payments: [],
            qrApplicable: false,
          })}
          ${customFieldsHtml(print.designConfig, 'above_table')}
          ${this.signatures(signatureLabels(print.designConfig, ['المورد', 'أمين المستودع', 'المحاسب']))}
          ${customFieldsHtml(print.designConfig, 'below_table')}
          ${customTermsHtml(print.designConfig)}
        `,
      });
    }

    if (rawScope === 'reports' || rawScope.startsWith('report:')) {
      return this.reportSheet(tenantId, {
        titleAr: 'معاينة تقرير — فواتير المبيعات',
        columns: [
          { key: 'number', labelAr: 'رقم الفاتورة', numeric: false },
          { key: 'date', labelAr: 'التاريخ', numeric: false },
          { key: 'customer', labelAr: 'العميل', numeric: false },
          { key: 'net', labelAr: 'الصافي', numeric: true },
          { key: 'vat', labelAr: 'الضريبة', numeric: true },
          { key: 'total', labelAr: 'الإجمالي', numeric: true },
        ],
        rows: [
          { number: 'SI-000041', date: '2026-10-20', customer: 'مؤسسة النخبة', net: '582.00', vat: '87.30', total: '669.30' },
          { number: 'SI-000042', date: '2026-10-21', customer: 'عميل نقدي', net: '145.00', vat: '21.75', total: '166.75' },
        ],
        totals: { net: '727.00', vat: '109.05', total: '836.05' },
        grandTotal: [{ labelAr: 'إجمالي صافي البيع', amount: '727.00' }],
        captions: ['الفترة: من 2026-10-01 إلى 2026-10-31', 'الفرع: الفرع الرئيسي'],
        generatedAt: new Date().toISOString(),
        signature: true,
        print: { settings: print, copies: 1, paper: print.printType === 2 ? 'small' : 'a4' },
      });
    }

    // الفاتورة الضريبية A4 — القالب الافتراضي لبقية النطاقات.
    return this.documentPage(print, company, {
      title: 'معاينة الفاتورة الضريبية',
      suppressAutoStampAndFooter: true,
      body:
        print.printType === 2
          ? this.renderPosReceipt80mm(company, {
              invoiceTitleAr: 'فاتورة ضريبية مبسطة',
              invoiceTitleEn: 'Simplified Tax Invoice',
              number: 'SI-000042',
              dateTime: `${dateText(new Date())} ${timeText(new Date())}`,
              branchName: 'الفرع الرئيسي',
              warehouseName: 'المستودع الرئيسي',
              salesmanName: 'سالم العتيبي',
              cashierName: 'أحمد الشمري',
              paymentMethodLabel: 'نقداً',
              customerName: 'عميل نقدي',
              customerTaxNo: '',
              customerPhone: '',
              customerAddress: null,
              lines: sampleLines,
              currency: 'SAR',
              subtotal,
              discount: '0.00',
              tax,
              total,
              paid: total,
              qrPayload: SAMPLE_QR_PAYLOAD,
              isPhaseTwo: false,
              zatcaStatus: 'prepared',
              notes: 'نموذج معاينة — لا يُحتسب في أي سجل مالي.',
              returnPolicy: company.returnPolicy,
              showHeader: print.printHeader,
              showSignatures: print.showSignatures,
              design: print.designConfig,
            })
          : this.renderSalesInvoiceA4(company, print, {
              invoiceTitleAr: 'فاتورة ضريبية',
              invoiceTitleEn: 'Tax Invoice',
              number: 'SI-000042',
              date: dateText(new Date()),
              time: timeText(new Date()),
              supplyDate: dateText(new Date()),
              status: 'مرحّلة',
              branchName: 'الفرع الرئيسي',
              warehouseName: 'المستودع الرئيسي',
              salesmanName: 'سالم العتيبي',
              cashierName: 'أحمد الشمري',
              referenceNo: 'PO-9921',
              paymentMethodLabel: 'نقداً',
              customerName: 'مؤسسة النخبة للتجارة',
              customerCode: 'CUST-018',
              customerTaxNo: '310000000000012',
              customerPhone: '0551234567',
              customerAddress: {
                building: '4532',
                street: 'طريق الملك فهد',
                district: 'حي العليا',
                city: 'الرياض',
                postal: '12211',
                additional: '2135',
              },
              lines: sampleLines,
              currency: 'SAR',
              subtotal,
              discount: '0.00',
              tax,
              extraTax: '0.00',
              withholding: '0.00',
              total,
              paid: total,
              payments: [{ method: 'نقداً', amount: total, reference: '' }],
              qrPayload: SAMPLE_QR_PAYLOAD,
              isPhaseTwo: false,
              zatcaStatus: 'prepared',
              notes: 'نموذج معاينة — لا يُحتسب في أي سجل مالي.',
              returnPolicy: company.returnPolicy,
            }),
    });
  }

  private async company(tx: Tx, tenantId: string) {
    const profile = first(
      await tx.execute(
        sql`SELECT name_ar, name_en, tax_no, cr_no, address, phones, email, logo_data_url FROM company_profiles WHERE tenant_id = ${tenantId}`,
      ),
    );
    const tenant = first(await tx.execute(sql`SELECT name FROM tenants WHERE id = ${tenantId}`));
    const settingRows = rows(
      await tx.execute(
        sql`SELECT key, value FROM tenant_settings WHERE tenant_id = ${tenantId}::uuid AND key LIKE 'report.%'`,
      ),
    );
    const reportMap = new Map<string, string>(
      settingRows.map((r) => [
        str(r.key),
        typeof r.value === 'string' ? r.value : r.value == null ? '' : String(r.value),
      ]),
    );
    const banks = [1, 2, 3]
      .map((n) => ({
        name: (reportMap.get(`report.bank${n}_name`) ?? '').trim(),
        iban: (reportMap.get(`report.bank${n}_iban`) ?? '').trim(),
      }))
      .filter((b) => b.name || b.iban);

    const brand = await this.brand(tx, tenantId);
    const address = (profile?.address ?? null) as Record<string, string> | null;
    const inlineLogo = str(profile?.logo_data_url);
    return {
      nameAr: str(profile?.name_ar) || str(tenant?.name) || 'المنشأة',
      nameEn: str(profile?.name_en),
      taxNo: str(profile?.tax_no),
      crNo: str(profile?.cr_no),
      email: str(profile?.email),
      phones: Array.isArray(profile?.phones) ? (profile?.phones as string[]) : [],
      address,
      nationalAddress: nationalAddressText(address),
      logoHtml: inlineLogo ? brandMark(inlineLogo, brand.color).logoHtml : brand.logoHtml,
      brandColor: brand.color,
      returnPolicy: (reportMap.get('report.return_policy') ?? '').trim(),
      defaultNotes: (reportMap.get('report.default_notes') ?? '').trim(),
      fieldAr: (reportMap.get('report.field_ar') ?? '').trim(),
      fieldEn: (reportMap.get('report.field_en') ?? '').trim(),
      addressAr: (reportMap.get('report.address_ar') ?? '').trim(),
      addressEn: (reportMap.get('report.address_en') ?? '').trim(),
      crn: (reportMap.get('report.crn') ?? '').trim(),
      stampUrl: (reportMap.get('report.stamp_url') ?? '').trim(),
      banks,
    };
  }

  private async brand(tx: Tx, tenantId: string) {
    try {
      const row = first(
        await tx.execute(sql`
        SELECT logo_file_id, primary_color FROM tenant_branding WHERE tenant_id = ${tenantId}::uuid LIMIT 1
      `),
      );
      const fileId = str(row?.logo_file_id);
      const logoUrl = fileId ? signedContentUrl(fileId, tenantId, env.FILES_DOWNLOAD_URL_TTL_SECONDS) : '';
      return brandMark(logoUrl, str(row?.primary_color));
    } catch {
      return brandMark('', '');
    }
  }

  private header(
    company: Awaited<ReturnType<PrintTemplatesService['company']>>,
    doc: {
      docTitle: string;
      docTitleEn: string;
      number: string;
      date: string;
      status: string;
      extra: Array<[string, string]>;
    },
    showCompany = true,
  ) {
    return `
      ${showCompany ? this.renderRepxLetterhead(company) : ''}
      <div class="repx-title-banner">
        <div class="doc-title">${escapeHtml(doc.docTitle)}</div>
        <div class="doc-title-en">${escapeHtml(doc.docTitleEn)}</div>
      </div>
      <table class="repx-meta-grid">
        <tr>
          <th>رقم المستند</th>
          <td dir="ltr"><b>${escapeHtml(doc.number)}</b></td>
          <th>التاريخ</th>
          <td dir="ltr">${escapeHtml(doc.date)}</td>
          <th>الحالة</th>
          <td>${escapeHtml(doc.status)}</td>
        </tr>
        ${
          doc.extra.filter(([, value]) => value).length
            ? `<tr>${doc.extra
                .filter(([, value]) => value)
                .slice(0, 3)
                .map(([label, value]) => `<th>${escapeHtml(label)}</th><td>${escapeHtml(value)}</td>`)
                .join('')}</tr>`
            : ''
        }
      </table>
    `;
  }

  private partyBlock(
    title: string,
    party: { name: string; code: string; taxNo: string; phone: string; address: unknown },
  ) {
    const address = addressText(party.address);
    return `
      <section class="party">
        <h2>${escapeHtml(title)}</h2>
        <div class="party-grid">
          <div><span>الاسم</span><b>${escapeHtml(party.name)}</b></div>
          ${party.code ? `<div><span>الرمز</span><b dir="ltr">${escapeHtml(party.code)}</b></div>` : ''}
          ${party.taxNo ? `<div><span>الرقم الضريبي</span><b dir="ltr">${escapeHtml(party.taxNo)}</b></div>` : ''}
          ${party.phone ? `<div><span>الهاتف</span><b dir="ltr">${escapeHtml(party.phone)}</b></div>` : ''}
          ${address ? `<div class="wide" data-national-address><span>العنوان الوطني</span><b>${escapeHtml(address)}</b></div>` : ''}
        </div>
      </section>
    `;
  }

  private linesTable(lines: Array<Record<string, unknown>>) {
    if (!lines.length) return '<p class="empty">لا توجد بنود على هذا المستند.</p>';
    return `
      <table class="lines">
        <thead>
          <tr>
            <th>#</th><th>الصنف</th><th>الوحدة</th><th>الكمية</th><th>السعر</th><th>الخصم</th><th>الصافي</th><th>الضريبة</th><th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${lines
            .map(
              (line) => `<tr>
                <td class="num">${escapeHtml(str(line.line_no))}</td>
                <td>${escapeHtml(str(line.label))}${str(line.sku) ? `<span class="sku" dir="ltr">${escapeHtml(str(line.sku))}</span>` : ''}</td>
                <td>${escapeHtml(str(line.unit_label || line.unit_code))}</td>
                <td class="num">${escapeHtml(qty(str(line.quantity)))}</td>
                <td class="num">${escapeHtml(money(str(line.unit_price)))}</td>
                <td class="num">${escapeHtml(money(str(line.discount_amount)))}</td>
                <td class="num">${escapeHtml(money(str(line.net)))}</td>
                <td class="num">${escapeHtml(money(str(line.tax)))}</td>
                <td class="num">${escapeHtml(money(str(line.total)))}</td>
              </tr>`,
            )
            .join('')}
        </tbody>
      </table>
    `;
  }

  private totalsBlock(totals: {
    currency: string;
    subtotal: string;
    discount: string;
    tax: string;
    extraTax?: string;
    withholding?: string;
    additional?: string;
    total: string;
    paid: string;
    payments: Array<{ method: string; amount: string; reference: string }>;
    qr?: string;
    zatcaStatus?: string;
    qrApplicable?: boolean;
  }) {
    const due = new Decimal(totals.total || '0').minus(totals.paid || '0');
    const optional = (label: string, value?: string) =>
      value && !new Decimal(value || '0').isZero()
        ? `<tr><th>${escapeHtml(label)}</th><td class="num">${escapeHtml(money(value))}</td></tr>`
        : '';

    return `
      <section class="totals">
        <div class="totals-side">
          <p class="words">فقط ${escapeHtml(amountInArabicWords(totals.total, totals.currency))}</p>
          ${
            totals.payments.length
              ? `<table class="pay"><thead><tr><th>الدفعات</th><th>المبلغ</th></tr></thead><tbody>
                  ${totals.payments.map((row) => `<tr><td>${escapeHtml(row.method)}${row.reference ? ` — ${escapeHtml(row.reference)}` : ''}</td><td class="num">${escapeHtml(money(row.amount))}</td></tr>`).join('')}
                 </tbody></table>`
              : ''
          }
          ${this.qrBlock(totals.qr, totals.zatcaStatus, totals.qrApplicable)}
        </div>
        <table class="totals-table">
          <tr><th>الإجمالي قبل الضريبة</th><td class="num">${escapeHtml(money(totals.subtotal))}</td></tr>
          ${optional('خصم الفاتورة', totals.discount)}
          ${optional('تكاليف إضافية', totals.additional)}
          <tr><th>ضريبة القيمة المضافة</th><td class="num">${escapeHtml(money(totals.tax))}</td></tr>
          ${optional('ضريبة إضافية', totals.extraTax)}
          ${optional('الاستقطاع', totals.withholding)}
          <tr class="grand"><th>الإجمالي المستحق (${escapeHtml(totals.currency)})</th><td class="num">${escapeHtml(money(totals.total))}</td></tr>
          <tr><th>المدفوع</th><td class="num">${escapeHtml(money(totals.paid))}</td></tr>
          <tr><th>المتبقي</th><td class="num">${escapeHtml(money(due.toFixed(2)))}</td></tr>
        </table>
      </section>
    `;
  }

  private qrBlock(payload?: string, status?: string, applicable = true, isPhaseTwo = false) {
    if (!applicable) return '';
    const statusLabel = status ? ZATCA_STATUS_LABELS[status] : null;
    const drawnLabel = isPhaseTwo
      ? `${statusLabel ?? 'رمز الفوترة الإلكترونية'} — المرحلة الثانية (ZATCA)`
      : (statusLabel ?? 'رمز الاستجابة السريعة (المرحلة الأولى)');
    if (!payload) {
      return `<div class="qr-empty">لم تُصدر بعد بيانات الفاتورة الإلكترونية (QR) لهذا المستند.${statusLabel ? ` الحالة: ${statusLabel}.` : ''}</div>`;
    }
    const qr = qrcode(0, 'M');
    qr.addData(payload);
    qr.make();
    return `<div class="qr">${qr.createSvgTag({ cellSize: 3, margin: 0, scalable: true })}<span>${escapeHtml(drawnLabel)}</span></div>`;
  }

  private reportQr(payload: string): string {
    const value = payload.trim();
    if (!value) return '';
    const qr = qrcode(0, 'M');
    qr.addData(value);
    qr.make();
    return `<div class="rep-qr">${qr.createSvgTag({ cellSize: 2, margin: 0, scalable: true })}</div>`;
  }

  private signatures(labels: string[]) {
    return `<section class="signs">${labels.map((label) => `<div><span>${escapeHtml(label)}</span><i></i></div>`).join('')}</section>`;
  }

  private documentPage(
    print: PrintSettings,
    company: Awaited<ReturnType<PrintTemplatesService['company']>>,
    page: {
      title: string;
      body: string;
      landscape?: boolean;
      suppressAutoStampAndFooter?: boolean;
    },
  ) {
    const copies = Math.min(50, Math.max(1, print.printNo));
    const paper = print.printType === 2 ? 'small' : 'a4';
    const stampSrc = print.stampImageUrl || company.stampUrl || '';
    const footer =
      !page.suppressAutoStampAndFooter && print.printFooter === true
        ? this.renderRepxFooter(company, print.footerImageUrl)
        : '';
    const stamp =
      !page.suppressAutoStampAndFooter && print.printStamp !== false && stampSrc
        ? `<div class="doc-stamp"><img src="${escapeHtml(stampSrc)}" alt="الختم" /></div>`
        : '';
    const body = `<div class="copy">${page.body}${stamp}${footer}</div>`;
    const printers = [print.casherPrinter, print.kitchenPrinter]
      .filter(Boolean)
      .map((name) => escapeHtml(name!));
    const toolbar = [
      printers.length ? `الطابعات: ${printers.join(' · ')}` : '',
      copies > 1 ? `عدد النسخ: ${copies}` : '',
      paper === 'small'
        ? `ورق صغير ${print.designConfig.paperWidthMm === 58 ? 58 : 80}mm`
        : 'ورقة A4',
    ]
      .filter(Boolean)
      .join(' — ');
    return this.page({
      title: page.title,
      landscape: page.landscape,
      paper,
      toolbar,
      style: printStyle(print, company.brandColor),
      design: print.designConfig,
      body: copies === 1 ? body : Array.from({ length: copies }, () => body).join(''),
    });
  }

  private sortByPrintItemType(
    lines: Array<Record<string, unknown>>,
    printItemType: number,
  ): Array<Record<string, unknown>> {
    const type = Number(printItemType) || 1;
    if (type === 1) return lines;
    const copy = [...lines];
    if (type === 2) {
      copy.sort((a, b) => str(a.sku || a.label).localeCompare(str(b.sku || b.label), 'ar'));
    } else if (type === 3) {
      copy.sort((a, b) => str(a.item_name || a.label).localeCompare(str(b.item_name || b.label), 'ar'));
    } else if (type === 4) {
      copy.sort((a, b) => {
        try {
          return new Decimal(str(b.quantity) || '0').minus(str(a.quantity) || '0').toNumber();
        } catch {
          return 0;
        }
      });
    } else if (type === 5) {
      copy.sort((a, b) => {
        try {
          return new Decimal(str(b.unit_price) || '0').minus(str(a.unit_price) || '0').toNumber();
        } catch {
          return 0;
        }
      });
    }
    return copy;
  }

  private settingsFor(tenantId: string, scope: string) {
    return this.printSettings.effective(tenantId, [scope, 'default']);
  }

  /** 🧩 قوالب المستندات — تُقرأ مرة واحدة قبل فتح معاملة القراءة اندماجاً مع `effective`. */
  private async readDocScopes(tenantId: string, scopes: string[]) {
    const entries = await Promise.all(
      scopes.map(async (scope) => [scope, await this.printSettings.read(tenantId, scope)] as const),
    );
    return new Map(entries.filter((entry): entry is readonly [string, PrintSettings] => entry[1].saved));
  }

  private page({
    title,
    body,
    landscape,
    paper = 'a4',
    toolbar,
    style,
    design,
  }: {
    title: string;
    body: string;
    landscape?: boolean;
    toolbar?: string;
    style?: PrintStyle;
    paper?: 'a4' | 'small';
    design?: import('./print-settings.service.js').PrintDesignConfig;
  }) {
    const sheet = paperCss(paper === 'small' ? 2 : 1, design, landscape === true);
    return `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: ${sheet.size}; margin: ${sheet.margin}; }
  * { box-sizing: border-box; }
  body { font-family: inherit; color: #111; margin: 0; padding: 14px; background: #f4f5f7; font-size: calc(11.5px * var(--scale)); -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .sheet { background: #fff; max-width: ${sheet.maxWidth}; margin: 0 auto; padding: ${sheet.padding}; box-shadow: 0 1px 8px rgba(0,0,0,.12); position: relative; }
  .sheet.small { font-size: 0.92em; }
  .copy + .copy { page-break-before: always; margin-top: 12mm; }
  .brand-logo { max-height: 76px; max-width: 145px; object-fit: contain; display: block; margin: 0 auto; }
  .repx-extra-header { max-height: 55px; max-width: 150px; display: block; margin: 4px auto 0; }
  .doc-stamp { position: relative; display: inline-block; margin-top: 8px; }
  .doc-stamp img, .stamp-inline { max-height: 78px; max-width: 140px; object-fit: contain; }
  .doc-note { margin-top: 0.7em; border: 1px dashed #666; padding: 0.45em 0.65em; color: #222; }
  .doc-foot { margin-top: 0.9em; border: 1.5px solid #222; padding: 0.45em 0.65em; color: #222; font-size: 0.9em; background: #fafafa; }
  .doc-foot img { max-height: 60px; max-width: 100%; display: block; margin: 4px auto 0; }
  .repx-foot-grid { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; }

  /* ── ترويسة المنشأة الثلاثية وفق header.repx & rptInvA4.repx ── */
  header.company { display: grid; grid-template-columns: 1.25fr auto 1.25fr; gap: 12px; align-items: center; border: 1.5px solid #222; padding: 8px 10px; margin-bottom: 6px; background: #fff; }
  .repx-lh-right { text-align: right; }
  .repx-lh-right h1 { font-size: 1.32em; margin: 0 0 2px; font-weight: 800; }
  .repx-lh-center { text-align: center; padding: 0 6px; }
  .repx-lh-left { text-align: left; font-size: 0.93em; }
  .repx-en-name { font-size: 1.15em; font-weight: 800; margin-bottom: 2px; }
  .repx-field { color: #333; font-weight: 600; font-size: 0.92em; margin-bottom: 3px; }
  .repx-kv-list { line-height: 1.45; color: #222; font-size: 0.92em; }
  .repx-banks { margin-top: 4px; padding-top: 3px; border-top: 1px dashed #aaa; font-size: 0.85em; line-height: 1.35; }

  /* ── جدول العنوان الوطني ذو الـ 8 خانات ── */
  .repx-na-wrap { margin-bottom: 6px; }
  .repx-na-table { width: 100%; border-collapse: collapse; font-size: 0.85em; }
  .repx-na-table th, .repx-na-table td { border: 1px solid #333; padding: 3px 5px; text-align: center; }
  .repx-na-table thead th { background: #eef0f3; font-weight: 700; }
  .repx-na-table .repx-na-caption { background: #dfe3e8; font-size: 0.95em; text-align: right; padding-inline: 8px; }

  /* ── شريط عنوان المستند (Document / Report Title Banner) ── */
  .repx-title-banner { border: 1.5px solid var(--accent); background: #f2f4f7; text-align: center; padding: 5px 10px; margin: 6px 0; }
  .doc-title { font-size: 1.3em; font-weight: 800; letter-spacing: 0.2px; }
  .doc-title-en { color: #444; font-size: 0.88em; font-weight: 600; }
  .repx-report-banner { border: 1.5px solid var(--accent); background: #f4f6f9; padding: 6px 10px; margin-bottom: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .repx-report-meta { display: flex; gap: 12px; flex-wrap: wrap; font-size: 0.9em; color: #333; font-weight: 600; }

  /* ── جدول بيانات الفاتورة والعميل ── */
  .repx-meta-grid { width: 100%; border-collapse: collapse; margin-bottom: 6px; font-size: 0.92em; }
  .repx-meta-grid th, .repx-meta-grid td { border: 1px solid #333; padding: 4px 7px; }
  .repx-meta-grid th { background: #eef0f3; font-weight: 700; text-align: right; white-space: nowrap; width: 14%; }
  .repx-meta-grid td { text-align: right; }
  .repx-meta-grid.inner { margin-bottom: 0; }
  .repx-customer-box { border: 1.5px solid #333; border-radius: 0; padding: 0; margin-bottom: 8px; }
  .repx-customer-box .repx-box-head { background: #dfe3e8; font-weight: 800; padding: 4px 8px; border-bottom: 1px solid #333; font-size: 0.94em; }
  .repx-customer-box .repx-na-wrap { margin: 0; }
  .repx-customer-box .repx-na-table th, .repx-customer-box .repx-na-table td { border-bottom: 0; }

  .party { border: 1px solid #333; padding: 0.6em 0.8em; margin-bottom: 0.75em; }
  .party h2 { font-size: 1em; margin: 0 0 0.4em; }
  .party-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px 12px; }
  .party-grid .wide { grid-column: 1 / -1; }
  .party-grid span { color: #555; margin-inline-end: 6px; }

  /* ── جداول البنود ── */
  table.lines { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  table.lines th, table.lines td { border: 1px solid #333; padding: 4px 6px; }
  table.lines thead th { background: var(--head-bg, #dfe3e8); font-weight: 700; text-align: center; line-height: 1.2; }
  table.lines thead th small { font-weight: 600; color: #444; font-size: 0.82em; }
  table.lines tfoot th { background: #eef0f3; }
  .center { text-align: center !important; }
  .bold-cell { font-weight: 700; }
  .num { text-align: left; font-variant-numeric: tabular-nums; direction: ltr; }
  .sku { display: block; color: #666; font-size: 0.86em; }

  /* ── القسم السفلي لفاتورة rptInvA4 (كيو آر + تفقيط + ملاحظات + سياسة الإرجاع + الإجماليات) ── */
  .repx-bottom-split { display: grid; grid-template-columns: 1.35fr 0.95fr; gap: 10px; align-items: stretch; margin-top: 4px; page-break-inside: avoid; }
  .repx-bottom-right { display: flex; flex-direction: column; gap: 6px; }
  .repx-qr-and-words { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #333; padding: 6px 8px; }
  .repx-words-stack { flex: 1; display: flex; flex-direction: column; gap: 5px; }
  .words { background: #f4f5f7; border: 1px solid #bbb; border-inline-start: 3px solid var(--accent); padding: 5px 8px; margin: 0; font-size: 0.94em; }
  .repx-note-box { border: 1px dashed #666; padding: 4px 7px; font-size: 0.9em; background: #fff; }
  .repx-policy-box { border: 1px solid #333; padding: 5px 8px; font-size: 0.88em; background: #fafafa; line-height: 1.45; }
  .repx-totals-box { width: 100%; border-collapse: collapse; border: 1.5px solid #222; }
  .repx-totals-box th, .repx-totals-box td { border: 1px solid #333; padding: 4px 8px; }
  .repx-totals-box th { background: #f2f4f7; text-align: right; font-weight: 700; }
  .repx-totals-box tr.grand th, .repx-totals-box tr.grand td { background: #dfe3e8; font-size: 1.08em; font-weight: 800; border-top: 2px solid #111; border-bottom: 2px solid #111; }

  /* ── جدول التوقيعات والختم السفلي ── */
  .repx-sign-strip { width: 100%; border-collapse: collapse; margin-top: 8px; page-break-inside: avoid; }
  .repx-sign-strip td { border: 1px solid #333; width: 33.33%; text-align: center; vertical-align: top; padding: 4px 6px; }
  .repx-sign-strip .sign-label { font-weight: 700; background: #eef0f3; padding: 3px; border-bottom: 1px solid #ccc; margin: -4px -6px 4px; font-size: 0.9em; }
  .repx-sign-strip .sign-space { min-height: 54px; display: flex; align-items: center; justify-content: center; font-weight: 600; }

  /* ── أنماط باقي السندات والتقارير ── */
  .totals-strip { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 0.7em; padding: 0.5em 0.85em; border: 2px solid var(--accent); font-size: 1.12em; }
  .totals-strip span { direction: ltr; }
  table.signatures { width: 100%; border-collapse: collapse; margin-top: 1.2em; page-break-inside: avoid; }
  table.signatures td { border: 1px solid #333; padding: 1.1em 0.5em 0.5em; text-align: center; width: 33%; color: #333; font-weight: 700; }
  .totals { display: flex; gap: 16px; align-items: flex-start; justify-content: space-between; }
  .totals-side { flex: 1; }
  .totals-table { border-collapse: collapse; min-width: 260px; }
  .totals-table th { text-align: right; padding: 3px 8px; color: #222; font-weight: 600; }
  .totals-table td { padding: 3px 8px; border-bottom: 1px solid #ddd; }
  .totals-table .grand th, .totals-table .grand td { font-size: 1.12em; font-weight: 800; border-top: 2px solid var(--accent); border-bottom: 2px solid var(--accent); }
  table.pay { border-collapse: collapse; width: 100%; font-size: 0.88em; }
  table.pay th, table.pay td { border: 1px solid #555; padding: 2px 6px; }
  .panel { border: 1px solid #333; padding: 0.8em 1em; margin-bottom: 0.9em; }
  .panel .kv { display: flex; gap: 8px; padding: 4px 0; border-bottom: 1px dashed #ccc; }
  .panel .kv:last-child { border-bottom: 0; }
  .panel .kv span { color: #555; min-width: 150px; }
  .qr { display: inline-flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; }
  .qr svg { width: 118px; height: 118px; }
  .qr span, .qr-empty { font-size: 0.82em; color: #333; font-weight: 600; max-width: 135px; }
  .qr-empty { display: block; margin-top: 0.5em; }
  .warn { color: #a4400a; }
  .empty { color: #666; padding: 1em; border: 1px dashed #ccc; text-align: center; }
  .signs { display: flex; gap: 24px; margin-top: 1.8em; }
  .signs div { flex: 1; text-align: center; color: #333; font-weight: 700; }
  .signs i { display: block; border-top: 1px solid #555; margin-top: 2.2em; }
  .toolbar { max-width: 210mm; margin: 0 auto 10px; display: flex; gap: 8px; }
  .toolbar button { font: inherit; padding: 6px 14px; border: 1px solid #111; background: #111; color: #fff; border-radius: 6px; cursor: pointer; }
  .toolbar-note { align-self: center; color: #555; }
  table.report { font-size: 0.92em; }
  table.report thead { display: table-header-group; }
  table.report tbody tr { page-break-inside: avoid; }
  table.report tbody tr:nth-child(even) { background: #fafafa; }
  table.report td.empty { text-align: center; color: #666; padding: 1.5em; border: 1px solid #ccc; }
  .rep-qr svg { width: 46px; height: 46px; }

  /* ── إيصال الكاشير الحراري 80mm وفق rptInv.repx ── */
  .pos-receipt { width: 100%; font-size: 11px; color: #000; }
  .pos-head { text-align: center; border-bottom: 1.5px dashed #000; padding-bottom: 6px; margin-bottom: 6px; }
  .pos-head h1 { font-size: 1.25em; margin: 2px 0; font-weight: 800; }
  .pos-logo .brand-logo { max-height: 54px; max-width: 120px; margin: 0 auto 4px; }
  .pos-sub { font-size: 0.9em; color: #111; line-height: 1.35; }
  .pos-title-box { border: 1.5px solid #000; background: #eaecef; text-align: center; padding: 4px 6px; margin-bottom: 5px; }
  .pos-title-box .doc-title { font-size: 1.15em; font-weight: 800; }
  .pos-title-en { font-size: 0.82em; color: #222; }
  .pos-meta-table { width: 100%; border-collapse: collapse; margin-bottom: 5px; font-size: 0.9em; }
  .pos-meta-table th, .pos-meta-table td { border: 1px solid #000; padding: 2px 4px; }
  .pos-meta-table th { background: #f0f1f4; font-weight: 700; text-align: right; white-space: nowrap; }
  /* 🧾 الورق الحراري أضيق من أن يحمل خانات «الآن»: الأعمدة تنكسر بدل أن تفيض خارج الورقة. */
  .sheet.small .pos-meta-table th, .sheet.small .repx-meta-grid th { white-space: normal; }
  .sheet.small .pos-meta-table td, .sheet.small .pos-meta-table th { word-break: break-word; font-size: 0.86em; padding: 2px 3px; }
  .sheet.small .pos-lines th, .sheet.small .pos-lines td { padding: 2px 3px !important; word-break: break-word; }
  .sheet.paper-58 { font-size: 9.6px; padding: 2mm 2.5mm; }
  .sheet.paper-58 .pos-meta-table, .sheet.paper-58 .pos-totals-table { font-size: 0.84em; }
  .sheet.paper-58 .pos-head h1 { font-size: 1.12em; }
  .sheet.paper-58 .pos-lines th, .sheet.paper-58 .pos-lines td { font-size: 0.82em; }
  .sheet.paper-58 .pos-title-box .doc-title { font-size: 1em; }
  .sheet.paper-58 .pos-words, .sheet.paper-58 .pos-note, .sheet.paper-58 .pos-policy { font-size: 0.8em; }
  /* أعمدة الإيصال بأعراضٍ ثابتة: الورق الحراري لا يحتمل جدولاً يعيد توزيع نفسه. */
  .sheet.small .pos-lines td.pos-item-col { word-break: break-word; }
  .sheet.paper-58 .pos-lines { table-layout: fixed; }
  .sheet.paper-58 .pos-lines th:nth-child(2), .sheet.paper-58 .pos-lines td:nth-child(2) { width: 15%; }
  .sheet.paper-58 .pos-lines th:nth-child(3), .sheet.paper-58 .pos-lines td:nth-child(3) { width: 20%; }
  .sheet.paper-58 .pos-lines th:nth-child(4), .sheet.paper-58 .pos-lines td:nth-child(4) { width: 25%; }
  .pos-customer-box { border: 1px solid #000; padding: 4px 6px; margin-bottom: 5px; font-size: 0.9em; line-height: 1.4; }
  .pos-lines th, .pos-lines td { border: 1px solid #000 !important; padding: 3px 4px !important; font-size: 0.92em; }
  .pos-lines thead th { background: #e5e7eb !important; }
  .pos-totals-table { width: 100%; border-collapse: collapse; margin-bottom: 5px; font-size: 0.94em; }
  .pos-totals-table th, .pos-totals-table td { border: 1px solid #000; padding: 3px 5px; }
  .pos-totals-table th { text-align: right; background: #f5f5f5; }
  .pos-totals-table tr.grand th, .pos-totals-table tr.grand td { background: #dfe3e8; font-weight: 800; font-size: 1.05em; }
  .pos-words { border: 1px dashed #000; padding: 3px 5px; margin: 0 0 5px; font-size: 0.88em; text-align: center; font-weight: 700; }
  .pos-note, .pos-policy { border: 1px solid #000; padding: 4px 5px; margin-bottom: 5px; font-size: 0.86em; line-height: 1.35; }
  .pos-qr-wrap { text-align: center; margin-top: 6px; padding-top: 4px; border-top: 1px dashed #000; }
  .pos-qr-wrap .qr svg { width: 150px; height: 150px; }
  .pos-sign { display: flex; justify-content: space-between; gap: 8px; margin-top: 6px; padding-top: 4px; border-top: 1px dashed #000; font-size: 0.82em; font-weight: 700; }
  .pos-sign span { flex: 1; text-align: center; }

  /* ── القوالب الثلاثة (classic / modern / minimal) ── */
  body.tpl-modern .sheet { border-top: 5px solid var(--accent); }
  body.tpl-modern h1, body.tpl-modern .doc-title { color: var(--accent); }
  body.tpl-modern table.lines thead th { background: var(--accent); color: #fff; }
  body.tpl-modern table.lines thead th small { color: #e5e7eb; }
  body.tpl-minimal .sheet { box-shadow: none; border: 1px solid #eee; }
  body.tpl-minimal table.lines thead th, body.tpl-minimal table.lines tfoot th { background: #fff; }

  .design-watermark { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; z-index: 0; }
  .design-watermark::before { content: attr(data-text); }
  .design-watermark { font-size: 3.2em; font-weight: 800; color: rgba(17, 24, 39, 0.08); transform: rotate(-28deg); letter-spacing: 4px; white-space: nowrap; overflow: hidden; }
  .sheet > * { position: relative; z-index: 1; }
  .design-head-lines { text-align: center; font-size: 0.92em; color: #222; margin-bottom: 4px; }
  .design-terms { border: 1px solid #333; padding: 5px 8px; font-size: 0.88em; margin-top: 6px; background: #fafafa; line-height: 1.45; }
  .design-custom-fields { margin-bottom: 6px; }
  .brand-logo { max-height: var(--logo-size, 76px); }
  .qr svg, .pos-qr-wrap .qr svg { width: var(--qr-size, 118px); height: var(--qr-size, 118px); }
  .pos-qr-wrap .qr svg { width: var(--qr-size, 150px); height: var(--qr-size, 150px); }
  body[data-logo='right'] .repx-lh-center { order: -1; }
  body[data-logo='left'] .repx-lh-center { order: 2; }
  body[data-logo='hidden'] .repx-lh-center { display: none; }
  body[data-tbl='striped'] table.lines tbody tr:nth-child(even) { background: #f7f8fa; }
  body[data-tbl='clean'] table.lines th,
  body[data-tbl='clean'] table.lines td { border-left: 0; border-right: 0; border-top: 0; }
  body[data-tbl='clean'] table.lines thead th { background: transparent; border-bottom: 2px solid var(--accent); }

  @media print {
    body { background: #fff; padding: 0; }
    .sheet { box-shadow: none; margin: 0; max-width: none; }
    .toolbar { display: none; }
  }
</style>
</head>
<body class="tpl-${escapeHtml(style?.template ?? 'classic')}" data-tbl="${escapeHtml(design?.tableStyle ?? 'grid')}" data-logo="${escapeHtml(design?.logoPosition ?? 'center')}" style="${[
      `--scale:${(style?.scale ?? 1).toFixed(2)}`,
      style?.accent ? `--accent:${escapeHtml(style.accent)}` : '--accent:#111',
      `font-family:${FONT_STACKS[style?.fontFamily ?? 'segoe']}`,
      logoSizeCss(design),
      qrSizeCss(design),
      design?.headerBgColor && /^#[0-9a-fA-F]{6}$/.test(design.headerBgColor)
        ? `--head-bg:${design.headerBgColor}`
        : '',
    ]
      .filter(Boolean)
      .join(';')}">
  <div class="toolbar"><button type="button" onclick="window.print()">طباعة</button>${toolbar ? `<span class="toolbar-note">${toolbar}</span>` : ''}</div>
  <div class="sheet${sheet.isSmall ? ' small' : ''}${sheet.isSmall && design?.paperWidthMm === 58 ? ' paper-58' : ''}">${watermarkHtml(design)}${body}</div>
</body>
</html>`;
  }
}

// ---------------------------------------------------------------------- helpers

const SAMPLE_LINES: Array<Record<string, unknown>> = [
  {
    line_no: 1,
    sku: 'RICE-5',
    label: 'أرز بسمتي ٥ كجم',
    item_name: 'أرز بسمتي ٥ كجم',
    unit_label: 'حبة',
    unit_code: 'PCS',
    quantity: '12',
    unit_price: '27.50',
    discount_amount: '0.00',
    tax: '49.50',
    net: '330.00',
    total: '379.50',
  },
  {
    line_no: 2,
    sku: 'OIL-1',
    label: 'زيت زيتون ١ لتر',
    item_name: 'زيت زيتون ١ لتر',
    unit_label: 'عبوة',
    unit_code: 'BTL',
    quantity: '6',
    unit_price: '42.00',
    discount_amount: '0.00',
    tax: '37.80',
    net: '252.00',
    total: '289.80',
  },
];

/** حمولة QR لعيّنةٍ تجريبية — وسوم المرحلة الأولى (TLV 1..5) بترميز Base64. */
const SAMPLE_QR_PAYLOAD = buildQrPayload({
  sellerName: 'مؤسسة الأفق للتجارة',
  vatNo: '310000000000003',
  timestamp: '2026-10-20T10:15:00Z',
  grandTotal: '669.30',
  vatTotal: '87.30',
});

type Tx = Parameters<Parameters<typeof withTenantTx>[2]>[0];

/**
 * دمج قالب المستند المحفوظ فوق إعدادات القسم، ثم تطبيق تجاوزات سطر الاستعلام بعده
 * (فالورق والنسخ المطلوبان لهذه الطبعة يسبقان المحفوظ).
 */
function applyDocSettings(base: PrintSettings, doc: PrintSettings | undefined): PrintSettings {
  if (!doc) return base;
  return {
    ...base,
    template: doc.template,
    accentColor: doc.accentColor,
    fontFamily: doc.fontFamily,
    fontScale: doc.fontScale,
    showSignatures: doc.showSignatures,
    printHeader: doc.printHeader,
    printFooter: doc.printFooter,
    printStamp: doc.printStamp,
    printItemType: doc.printItemType,
    note: doc.note || base.note,
    headerImageUrl: doc.headerImageUrl,
    footerImageUrl: doc.footerImageUrl,
    stampImageUrl: doc.stampImageUrl,
    casherPrinter: doc.casherPrinter || base.casherPrinter,
    kitchenPrinter: doc.kitchenPrinter || base.kitchenPrinter,
    designConfig: doc.designConfig,
  };
}

function applyQueryOverrides(base: PrintSettings, query: DocumentPrintQuery): PrintSettings {
  const next = { ...base };
  if (query.paper === 'small' || query.paper === '80mm') next.printType = 2;
  else if (query.paper === 'a4') next.printType = 1;
  if (query.copies !== undefined) {
    const parsed = Number(query.copies);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 50) {
      next.printNo = parsed;
    }
  }
  return next;
}

function rows(result: unknown): Array<Record<string, unknown>> {
  return Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []);
}
function first(result: unknown): Record<string, unknown> | undefined {
  return rows(result)[0];
}
function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}
function money(value: string | number | null | undefined): string {
  const decimal = new Decimal(value === null || value === undefined || value === '' ? 0 : value);
  return decimal.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
function qty(value: string): string {
  if (!value) return '0';
  const decimal = new Decimal(value);
  return decimal.eq(decimal.trunc()) ? decimal.toFixed(0) : decimal.toFixed(3);
}
function dateText(value: unknown): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(date);
}
function timeText(value: unknown): string {
  if (!value) return '';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Riyadh',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
function dateTimeText(value: unknown): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return `${dateText(date)} ${timeText(date)}`.trim();
}
function shortId(value: string): string {
  return value ? value.slice(0, 8).toUpperCase() : '—';
}

function extractNationalAddressParts(raw: Record<string, unknown> | null | undefined) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = r[k];
      if (typeof v === 'string' && v.trim() !== '') return v.trim();
    }
    return '';
  };
  return {
    street: pick('street', 'streetName', 'addStreet', 'additionalStreet'),
    district: pick('district', 'neighborhood'),
    city: pick('city'),
    region: pick('region', 'province', 'state'),
    building: pick('building', 'buildingNumber', 'buildingNo'),
    additional: pick('additional', 'additionalNumber', 'plot'),
    postal: pick('postal', 'postalCode', 'zip'),
    unit: pick('unit', 'crn'),
    country: pick('country', 'countryCode'),
  };
}

function addressText(address: unknown): string {
  if (!address || typeof address !== 'object') return '';
  const record = address as Record<string, unknown>;
  const keys = [
    'building',
    'buildingNumber',
    'street',
    'addStreet',
    'additionalStreet',
    'district',
    'city',
    'region',
    'postal',
    'postalCode',
    'additional',
    'unit',
    'country',
    'countryCode',
    'plot',
  ];
  return keys
    .map((key) => record[key])
    .filter((value): value is string => typeof value === 'string' && value.trim() !== '')
    .join('، ');
}

function nationalAddressText(address: Record<string, string> | null | undefined): string {
  if (!address) return '';
  const a = extractNationalAddressParts(address);
  const parts: string[] = [];
  if (a.building) parts.push(`مبنى ${a.building}`);
  if (a.street) parts.push(`شارع ${a.street}`);
  if (a.district) parts.push(`حي ${a.district}`);
  if (a.city) parts.push(a.city);
  if (a.region) parts.push(a.region);
  if (a.postal) parts.push(`الرمز البريدي ${a.postal}`);
  if (a.additional) parts.push(`الرقم الإضافي ${a.additional}`);
  if (a.unit) parts.push(`الوحدة ${a.unit}`);
  return parts.join('، ');
}

function cellText(value: string, numeric: boolean): string {
  if (!value) return '—';
  return numeric && /^-?\d+(\.\d+)?$/.test(value) ? money(value) : value;
}

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}

const ZATCA_STATUS_LABELS: Record<string, string> = {
  prepared: 'رمز الفوترة الإلكترونية (المرحلة الأولى)',
  signed: 'رمز موقّع — بانتظار الإرسال للهيئة',
  reported: 'مُبلَّغة لهيئة الزكاة والضريبة',
  cleared: 'مُصادق عليها من هيئة الزكاة والضريبة',
  failed: 'تعذّر الإرسال للهيئة',
};

const SALES_KIND_TITLES: Record<string, string> = {
  sale: 'فاتورة مبيعات',
  sale_return: 'مردود مبيعات',
  return: 'مردود مبيعات',
  quotation: 'عرض سعر',
  contracting: 'فاتورة مقاولات',
};
const STATUS_LABELS: Record<string, string> = {
  draft: 'مسودة',
  posted: 'مرحّلة',
  void: 'ملغاة',
  voided: 'ملغاة',
  paid: 'مدفوعة',
  open: 'مفتوحة',
  closed: 'مغلقة',
};
const PAYMENT_METHODS: Record<string, string> = {
  cash: 'نقداً',
  card: 'شبكة',
  bank: 'تحويل بنكي',
  bank_transfer: 'تحويل بنكي',
  transfer: 'تحويل بنكي',
  cheque: 'شيك',
  credit: 'آجل',
};
const VOUCHER_SUBTYPES: Record<string, string> = {
  customer: 'دفعة من عميل',
  supplier: 'دفعة لمورد',
  expense: 'مصروف',
  salary: 'رواتب',
  tax: 'ضريبة',
  other: 'أخرى',
};
