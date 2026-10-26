import qrcode from 'qrcode-generator';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildVanDocumentPrintHtml,
  escapeHtml,
  openVanDocumentPrintWindow,
  PRINT_WINDOW_FEATURES,
  ZATCA_QR_MISSING_TEXT,
  type PrintWindowLike,
  type VanDocumentPrintCopy,
  type VanDocumentPrintView,
} from '../src/index';

/**
 * 🖨️ ما يُطبع هنا ورقةٌ يدفعها العميل لجهةٍ حكومية ويوقّعها مندوب، فلا يُقاس «أنّ HTML
 * خرج» بل ما تقوله الورقة: (١) مستندٌ واحد بنسختين — لا فاتورة ثانية ولا نسخة يخترعها
 * المتصفّح؛ (٢) الأرقام كما جاءَت من الخادم حرفًا، فلا حسابَ ولا تقريبَ في العميل؛
 * (٣) رمز ZATCA يُرسم ترميزًا حقيقيًّا من الحمولة الصادرة وحدها — وكان في هذه الورقة
 * `‏<img src="data:image/png;base64,">` بحمولةٍ فارغة، أي صورةٌ مكسورة بدل الرمز؛
 * (٤) هويّة المنشأة ورقمها الضريبي لا يُخترعان عند الغياب.
 */

/** حمولة TLV حقيقية الطول (اسم بائع عربيّ + رقم ضريبي + مبلغ) بصيغتها base64. */
const ISSUED_PAYLOAD =
  'D+WIhuaXg+S4iCDYp9in2YrYqCDZhdin2YjYqNmK2KkgMjAyNi0xMC0xNFQwODowMDowMFoEJTM3OS41MAUCJDI1LjMw';

const CUSTOMER_COPY: VanDocumentPrintCopy = {
  copyIndex: 1,
  kind: 'customer',
  copyLabel: 'نسخة العميل',
  requiresCustomerSignature: false,
  signatureBlock: null,
};

const REP_COPY: VanDocumentPrintCopy = {
  copyIndex: 2,
  kind: 'rep',
  copyLabel: 'نسخة المندوب — تُعاد موقّعة إلى المحاسب',
  requiresCustomerSignature: true,
  signatureBlock: {
    customerSignatureLabel: 'توقيع العميل / المستلم',
    repSignatureLabel: 'توقيع المندوب',
    accountantNote: 'تُعاد هذه النسخة موقّعة إلى المحاسب مع إقفال العهدة.',
  },
};

const BASE: VanDocumentPrintView = {
  documentId: 'doc-1',
  documentNumber: 'VSD-2026-000123',
  invoiceNumber: 'INV-2026-000456',
  invoiceStatus: 'submitted',
  saleDate: '2026-10-14',
  companyName: 'مخابز الوحدة',
  companyNameEn: 'Al-Wahda Bakeries',
  companyTaxNo: '300012345600003',
  companyCrNo: '1010999888',
  companyEmail: 'sales@wahda.example',
  companyPhones: ['0112345678'],
  companyAddress: { street: 'طريق الملك عبدالله', district: 'الحزم', city: 'الرياض' },
  customerName: 'بقالة النور',
  customerTaxNo: '300098765400003',
  customerPhone: '0114567890',
  customerMobile: '0551234567',
  salesmanName: 'سالم المندوب',
  salesmanMobile: '0559876543',
  vanWarehouseName: 'عهدة سيارة ١',
  loadOrderNumber: 'LO-2026-000077',
  productionBatchNo: 'BATCH-2026-10-14-A',
  invoiceMode: 'zatca_tax',
  taxPolicyStatus: 'مُفعَّلة',
  paymentMethod: 'credit',
  lines: [
    {
      kind: 'sale',
      itemName: 'خبز تميس',
      sku: 'BRD-001',
      quantity: '20',
      unitPrice: '1.50',
      discount: '0.00',
      lineTotal: '30.00',
    },
    {
      kind: 'bonus',
      itemName: 'صمون صغير',
      sku: 'BRD-002',
      quantity: '2',
      unitPrice: '0.00',
      discount: '0.00',
      lineTotal: '0.00',
      reason: 'بونص معتمد',
    },
  ],
  subtotal: '30.00',
  discountTotal: '0.00',
  vatRate: '15',
  vatTotal: '4.50',
  grandTotal: '117.259',
  paidAmount: '0.00',
  outstandingAmount: '117.259',
  bonusQtyTotal: '2',
  qrPayload: ISSUED_PAYLOAD,
  notes: 'التسليم قبل العاشرة صباحًا',
  printedAt: '2026-10-14T08:05:00.000Z',
  copies: [CUSTOMER_COPY, REP_COPY],
  copiesCount: 2,
};

function printView(overrides: Partial<VanDocumentPrintView> = {}): VanDocumentPrintView {
  return { ...BASE, ...overrides };
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** مصفوفة المُرمِّز الحقيقيّ — للتحقّق من أنّ ما على الورق هو الرمز لا زخرفة. */
function matrixOf(payload: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  const modules = qr.getModuleCount();
  return Array.from({ length: modules }, (_, row) =>
    Array.from({ length: modules }, (_, col) => qr.isDark(row, col)),
  );
}

/** نافذةٌ مزروعة تلتقط ما يُكتب في نافذة الطباعة — لا متصفّح هنا ولا اختراع. */
function fakeHost(
  onWrite: (html: string) => void,
  opens: boolean,
): PrintWindowLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    open: (url: string, target: string, features: string) => {
      calls.push(`${url}|${target}|${features}`);
      if (!opens) return null;
      return {
        document: {
          open: () => undefined,
          write: (html: string) => {
            onWrite(html);
          },
          close: () => undefined,
        },
      };
    },
    calls,
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('one official document, printed twice — never two invoices', () => {
  it('renders exactly the copies the server listed, each labelled as the server labelled it', () => {
    const html = buildVanDocumentPrintHtml(printView());

    expect(countOf(html, '<section class="copy">')).toBe(2);
    expect(html).toContain(CUSTOMER_COPY.copyLabel);
    expect(html).toContain(REP_COPY.copyLabel);
    expect(countOf(html, '<title>')).toBe(1);
    expect(html).toContain(`<title>${BASE.documentNumber} — نسختا الطباعة</title>`);
    // رقم المستند نفسه على النسختين: مستندٌ واحد، لا مستندان برقمين.
    expect(countOf(html, BASE.documentNumber)).toBeGreaterThanOrEqual(2);
  });

  it('renders a single copy when the server sent one', () => {
    const html = buildVanDocumentPrintHtml(
      printView({ copies: [CUSTOMER_COPY], copiesCount: 1 }),
    );
    expect(countOf(html, '<section class="copy">')).toBe(1);
  });

  it('carries the signature box on the copy the server flagged, once', () => {
    const html = buildVanDocumentPrintHtml(printView());
    const block = REP_COPY.signatureBlock;
    expect(block).not.toBeNull();
    expect(countOf(html, block?.customerSignatureLabel ?? '—')).toBe(1);
    expect(countOf(html, block?.repSignatureLabel ?? '—')).toBe(1);
    expect(countOf(html, block?.accountantNote ?? '—')).toBe(1);
  });

  it('adds no signature box when the server flagged none', () => {
    const html = buildVanDocumentPrintHtml(
      printView({ copies: [CUSTOMER_COPY], copiesCount: 1 }),
    );
    // قاعدة `.sign-box` في CSS الورقة موجودةٌ دائمًا؛ والمقياس هو العلامة المرسومة فعلًا.
    expect(html).not.toContain('<div class="sign">');
    expect(html).not.toContain(REP_COPY.signatureBlock?.customerSignatureLabel ?? '—');
  });
});

describe('the paper carries the server’s numbers, not the browser’s arithmetic', () => {
  it('prints every money string verbatim, without rounding', () => {
    const html = buildVanDocumentPrintHtml(printView());

    for (const value of [
      BASE.subtotal,
      BASE.vatTotal,
      BASE.grandTotal,
      BASE.paidAmount,
      BASE.outstandingAmount,
    ]) {
      expect(html).toContain(value);
    }
    // ‏117.259 كما جاء من الخادم؛ ولو قرّبَ العميل لظهر 117.26.
    expect(html).not.toContain('117.26');
    expect(html).toContain(`ضريبة القيمة المضافة (${BASE.vatRate}%)`);
  });

  it('omits the discount row when the server reported no discount', () => {
    expect(buildVanDocumentPrintHtml(printView())).not.toContain('<td>الخصم</td><th');
    const html = buildVanDocumentPrintHtml(printView({ discountTotal: '2.50' }));
    expect(html).toContain('<td>الخصم</td>');
    expect(html).toContain('2.50');
  });

  it('marks bonus lines and prints the server’s bonus note only when there is a bonus', () => {
    const html = buildVanDocumentPrintHtml(printView());
    expect(html).toContain('<tr class="bonus">');
    expect(html).toContain('الكميات المجانية (البونص)');
    expect(html).toContain('بونص معتمد');

    const none = buildVanDocumentPrintHtml(printView({ bonusQtyTotal: '0' }));
    expect(none).not.toContain('الكميات المجانية (البونص)');
  });

  it('escapes what comes from the ledger instead of injecting it', () => {
    const html = buildVanDocumentPrintHtml(
      printView({ customerName: '<script>alert(1)</script>', notes: 'a & b "c"' }),
    );
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('a &amp; b &quot;c&quot;');
  });

  it('escapeHtml covers the four characters that break a double-quoted attribute', () => {
    expect(escapeHtml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;\'&lt;/a&gt;');
    expect(escapeHtml('')).toBe('');
  });

  it('prints the sale date as the server dated it, and the print stamp as a real timestamp', () => {
    const html = buildVanDocumentPrintHtml(printView());
    expect(html).toContain(BASE.saleDate);
    const printed = new Date(BASE.printedAt);
    expect(html).toContain(printed.toLocaleDateString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh' }));
    expect(html).not.toContain('Invalid Date');
  });

  it('prints an unreadable stamp as it came, rather than inventing a date', () => {
    const html = buildVanDocumentPrintHtml(printView({ printedAt: 'لم يُحدَّد' }));
    expect(html).toContain('لم يُحدَّد');
    expect(html).not.toContain('Invalid Date');
  });
});

describe('the tenant’s identity is printed, never an invented one', () => {
  it('drops the tax and CR lines when the profile has none', () => {
    const html = buildVanDocumentPrintHtml(
      printView({ companyTaxNo: '', companyCrNo: '', customerTaxNo: '' }),
    );
    expect(html).not.toContain('الرقم الضريبي');
    expect(html).not.toContain('السجل التجاري');
    expect(html).not.toContain('300000000000003');
  });

  it('prints the registered numbers when the profile has them', () => {
    const html = buildVanDocumentPrintHtml(printView());
    expect(countOf(html, BASE.companyTaxNo)).toBeGreaterThanOrEqual(1);
    expect(html).toContain(BASE.companyCrNo);
    expect(html).toContain(BASE.customerTaxNo);
  });

  it('names a cash customer instead of leaving the party blank', () => {
    const html = buildVanDocumentPrintHtml(printView({ customerName: '' }));
    expect(html).toContain('عميل نقدي');
  });

  it('says which tax document this is, from the server’s mode and status', () => {
    const tax = buildVanDocumentPrintHtml(printView());
    expect(tax).toContain('فاتورة ضريبية إلكترونية (مبيعات توزيع)');
    expect(tax).toContain(`مستند ضريبي إلكتروني — الحالة: ${BASE.invoiceStatus}`);

    const internal = buildVanDocumentPrintHtml(
      printView({ invoiceMode: 'internal_delivery', taxPolicyStatus: 'معفاة داخليًّا' }),
    );
    expect(internal).toContain('إشعار تسليم / فاتورة توزيع داخلية');
    expect(internal).toContain('حالة السياسة الضريبية: معفاة داخليًّا');
  });
});

describe('the ZATCA symbol on paper is the issued one, and nothing is faked', () => {
  it('draws the real encoder’s modules — the old markup drew a broken image instead', () => {
    const html = buildVanDocumentPrintHtml(printView());
    const matrix = matrixOf(ISSUED_PAYLOAD);
    const quiet = 2;

    // الرمز على النسختين معًا: مستندٌ واحد بنسختين، والرمز نفسه على كلّ نسخة.
    expect(countOf(html, '<svg')).toBe(2);
    expect(html).not.toContain('data:image/png;base64,');
    expect(html).toContain(`viewBox="0 0 ${matrix.length + quiet * 2} ${matrix.length + quiet * 2}"`);

    const firstSymbol = html.slice(html.indexOf('<svg'), html.indexOf('</svg>'));
    const drawn = [...firstSymbol.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1"/g)].map(
      (match) => `${Number(match[1]) - quiet},${Number(match[2]) - quiet}`,
    );
    const expected = matrix.flatMap((row, r) => row.flatMap((cell, c) => (cell ? [`${c},${r}`] : [])));
    expect(drawn.sort()).toEqual(expected.sort());
    expect(html).toContain(ISSUED_PAYLOAD);
  });

  it('prints the explicit «not issued yet» line on a tax invoice with no payload', () => {
    const html = buildVanDocumentPrintHtml(printView({ qrPayload: '' }));
    expect(html).toContain(ZATCA_QR_MISSING_TEXT);
    expect(html).not.toContain('<svg');
  });

  it('raises no false alarm on an internal delivery note, which has no QR at all', () => {
    const html = buildVanDocumentPrintHtml(
      printView({ qrPayload: '', invoiceMode: 'internal_delivery' }),
    );
    expect(html).not.toContain(ZATCA_QR_MISSING_TEXT);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('class="qr');
  });
});

describe('opening the print window is reported, not assumed', () => {
  it('writes the same html the builder produced, once, and closes the document', () => {
    const written: string[] = [];
    const host = fakeHost((html) => written.push(html), true);
    const view = printView();

    expect(openVanDocumentPrintWindow(view, host)).toBe(true);
    expect(written).toEqual([buildVanDocumentPrintHtml(view)]);
    expect(host).toMatchObject({ calls: [`|_blank|${PRINT_WINDOW_FEATURES}`] });
  });

  it('returns false when the browser blocks the popup, so the screen can say so', () => {
    const written: string[] = [];
    expect(openVanDocumentPrintWindow(printView(), fakeHost((html) => written.push(html), false))).toBe(
      false,
    );
    expect(written).toEqual([]);
  });

  it('returns false with no window at all (server render), instead of throwing', () => {
    expect(typeof window).toBe('undefined');
    expect(openVanDocumentPrintWindow(printView())).toBe(false);
  });

  it('uses the ambient window when the caller passes none', () => {
    const written: string[] = [];
    (globalThis as Record<string, unknown>).window = fakeHost((html) => written.push(html), true);
    expect(openVanDocumentPrintWindow(printView())).toBe(true);
    expect(written.length).toBe(1);
  });
});
