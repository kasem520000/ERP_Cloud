/**
 * 🖨️ مستند البيع الرسميّ بنسختيه — **مُصيِّرٌ واحد لورقةٍ واحدة يطبعها سطحان**.
 *
 * والمدخل هو `GET /van-sales/documents/:id/print-view` كما يرجعه الخادم: الأرقام على
 * الورق هي أرقام الأستاذ، ولا يُعاد حساب إجماليٍّ أو ضريبة في المتصفّح، ولا يُنشأ مستندٌ
 * ثانٍ هنا — فالخادم يقرّر عدد النسخ (`?copies=`) ونوع كلّ نسخة (`customer` / `rep` مع
 * مربّع توقيع). نسخةٌ للعميل ونسخةٌ تعود موقّعة إلى المحاسب من **سند بيعٍ واحد**، لا
 * فاتورتان.
 *
 * ورمز ZATCA يُرسم من الحمولة الصادرة على الفاتورة وحدها (`qrPayload` من وحدة الفوترة
 * الإلكترونية) — انظر `./qr`. وكان هنا قبل الرفع `‏<img src="data:image/png;base64,">`
 * بحمولةٍ فارغة: صورةٌ مكسورة على ورقةٍ رسمية بدل الرمز. فصار الرمز يُرسم فعلًا، وحين لا
 * تكون للفاتورة الضريبية حمولةٌ صادرة يُطبع القول الصريح نفسه الذي تقولُه الشاشة وإيصال
 * الكاشير — فلا ورقةَ توحي بإصدارٍ إلكترونيّ لم يحدث.
 *
 * ومكانه `@erp/web-van` لأنّ المستهلكين اثنان (`apps/staff` و`apps/bakery`) والخادم واحد:
 * ومُصيِّران يعنيان ورقًا يختلف عن ورق في اليوم الذي يُصلح فيه أحدهما.
 */
import { ZATCA_QR_MISSING_TEXT, renderQrSvgMarkup } from './qr';

/** 🖨️ نسخة الطباعة — what `/van-sales/documents/:id/print-view` returns. */
export type VanDocumentPrintCopy = {
  copyIndex: number;
  kind: 'customer' | 'rep';
  copyLabel: string;
  requiresCustomerSignature: boolean;
  signatureBlock: {
    customerSignatureLabel: string;
    repSignatureLabel: string;
    accountantNote: string;
  } | null;
};

export type VanDocumentPrintView = {
  documentId: string;
  documentNumber: string;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  saleDate: string;
  companyName: string;
  companyNameEn: string;
  companyTaxNo: string;
  companyCrNo: string;
  companyEmail: string;
  companyPhones: string[];
  companyAddress: Record<string, unknown> | null;
  customerName: string;
  customerTaxNo: string;
  customerPhone: string;
  customerMobile: string;
  salesmanName: string;
  salesmanMobile: string;
  vanWarehouseName: string;
  loadOrderNumber: string;
  productionBatchNo: string;
  invoiceMode: string;
  taxPolicyStatus: string;
  paymentMethod: string;
  lines: Array<{
    kind: string;
    itemName: string;
    sku: string;
    quantity: string;
    unitPrice: string;
    discount: string;
    lineTotal: string;
    reason?: string;
  }>;
  subtotal: string;
  discountTotal: string;
  vatRate: string;
  vatTotal: string;
  grandTotal: string;
  paidAmount: string;
  outstandingAmount: string;
  bonusQtyTotal: string;
  qrPayload: string;
  notes: string;
  printedAt: string;
  copies: VanDocumentPrintCopy[];
  copiesCount: number;
};

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatPrintedAt = (value: string): string => {
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return `${at.toLocaleDateString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh' })} ${at.toLocaleTimeString('ar-SA-u-ca-gregory', { timeZone: 'Asia/Riyadh' })}`;
};

/**
 * الرمز على الورق: يُرسم إن كانت للفاتورة حمولةٌ صادرة، ويُطبع قولٌ صريح إن كانت ضريبيةً
 * ولم تصدر بعد، ولا شيءَ إطلاقًا لإشعار التسليم الداخليّ (فلا QR له أصلًا، وسطرُ «لم
 * تُصدر» هناك إيهامٌ بنقصٍ ليس نقصًا).
 */
function qrBlock(view: VanDocumentPrintView): string {
  if (view.qrPayload) {
    return `<div class="qr">${renderQrSvgMarkup(view.qrPayload, 150)}<div class="muted small">حمولة TLV الصادرة من وحدة الفوترة الإلكترونية: <span dir="ltr">${escapeHtml(view.qrPayload)}</span></div></div>`;
  }
  if (view.invoiceMode !== 'zatca_tax') return '';
  return `<div class="qr qr-missing">${escapeHtml(ZATCA_QR_MISSING_TEXT)}</div>`;
}

/**
 * 🖨️ نسختان من مستند بيع واحد — one official document, printed twice: the customer's copy
 * and the rep's copy that comes back signed. Opening a print window (the same pattern the
 * thermal receipt uses) keeps the browser's own dialog in charge of the printer, and no
 * second invoice is ever created here.
 */
export function buildVanDocumentPrintHtml(view: VanDocumentPrintView): string {
  const address = view.companyAddress
    ? [
        view.companyAddress.street ? String(view.companyAddress.street) : '',
        view.companyAddress.district ? String(view.companyAddress.district) : '',
        view.companyAddress.city ? String(view.companyAddress.city) : '',
      ]
        .filter(Boolean)
        .join(' — ')
    : '';

  const renderCopy = (copy: VanDocumentPrintCopy): string => `
  <section class="copy">
    <header>
      <div class="company">
        <h1>${escapeHtml(view.companyName || 'المنشأة')}</h1>
        ${view.companyNameEn ? `<div class="en">${escapeHtml(view.companyNameEn)}</div>` : ''}
        <div class="meta">
          ${view.companyTaxNo ? `<span>الرقم الضريبي: <b dir="ltr">${escapeHtml(view.companyTaxNo)}</b></span>` : ''}
          ${view.companyCrNo ? `<span>السجل التجاري: <b dir="ltr">${escapeHtml(view.companyCrNo)}</b></span>` : ''}
          ${view.companyPhones.length ? `<span>هاتف: <b dir="ltr">${escapeHtml(view.companyPhones.join(' ، '))}</b></span>` : ''}
          ${view.companyEmail ? `<span>بريد: <b dir="ltr">${escapeHtml(view.companyEmail)}</b></span>` : ''}
          ${address ? `<span>العنوان: ${escapeHtml(address)}</span>` : ''}
        </div>
      </div>
      <div class="doc">
        <div class="copy-label">${escapeHtml(copy.copyLabel)}</div>
        <h2>${view.invoiceMode === 'zatca_tax' ? 'فاتورة ضريبية إلكترونية (مبيعات توزيع)' : 'إشعار تسليم / فاتورة توزيع داخلية'}</h2>
        <table class="kv">
          <tr><td>رقم المستند</td><th dir="ltr">${escapeHtml(view.documentNumber)}</th></tr>
          ${view.invoiceNumber ? `<tr><td>رقم الفاتورة الرسمية</td><th dir="ltr">${escapeHtml(view.invoiceNumber)}</th></tr>` : ''}
          <tr><td>تاريخ البيع</td><th dir="ltr">${escapeHtml(view.saleDate)}</th></tr>
          <tr><td>تاريخ ووقت الطباعة</td><th dir="ltr">${escapeHtml(formatPrintedAt(view.printedAt))}</th></tr>
          <tr><td>طريقة الدفع</td><th>${escapeHtml(view.paymentMethod === 'cash' ? 'نقدًا' : view.paymentMethod === 'card' ? 'شبكة' : 'آجل')}</th></tr>
        </table>
      </div>
    </header>

    <div class="parties">
      <div>
        <h3>بيانات العميل</h3>
        <div><b>${escapeHtml(view.customerName || 'عميل نقدي')}</b></div>
        ${view.customerTaxNo ? `<div>الرقم الضريبي: <b dir="ltr">${escapeHtml(view.customerTaxNo)}</b></div>` : ''}
        ${view.customerPhone || view.customerMobile ? `<div>جوال: <b dir="ltr">${escapeHtml(view.customerMobile || view.customerPhone)}</b></div>` : ''}
      </div>
      <div>
        <h3>المندوب وسيارة التوزيع</h3>
        <div><b>${escapeHtml(view.salesmanName)}</b></div>
        ${view.salesmanMobile ? `<div>جوال: <b dir="ltr">${escapeHtml(view.salesmanMobile)}</b></div>` : ''}
        <div>العهدة: ${escapeHtml(view.vanWarehouseName)}</div>
        ${view.loadOrderNumber ? `<div>أمر التحميل: <b dir="ltr">${escapeHtml(view.loadOrderNumber)}</b></div>` : ''}
        ${view.productionBatchNo ? `<div>دفعة الإنتاج: <b dir="ltr">${escapeHtml(view.productionBatchNo)}</b></div>` : ''}
      </div>
    </div>

    <table class="lines">
      <thead>
        <tr><th>#</th><th>الصنف</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>الإجمالي</th></tr>
      </thead>
      <tbody>
        ${view.lines
          .map(
            (line, index) => `<tr class="${line.kind === 'bonus' ? 'bonus' : ''}">
              <td>${index + 1}</td>
              <td>${escapeHtml(line.itemName)}${line.reason ? ` <span class="muted">(${escapeHtml(line.reason)})</span>` : ''}</td>
              <td dir="ltr">${escapeHtml(line.quantity)}</td>
              <td dir="ltr">${escapeHtml(line.unitPrice)}</td>
              <td dir="ltr">${escapeHtml(line.discount)}</td>
              <td dir="ltr">${escapeHtml(line.lineTotal)}</td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>

    ${Number(view.bonusQtyTotal) > 0 ? `<div class="bonus-note">🎁 الكميات المجانية (البونص): <b dir="ltr">${escapeHtml(view.bonusQtyTotal)}</b> — مُسلَّمة بلا قيمة وبلا ضريبة، وتُخصم من المخزون بالتكلفة.</div>` : ''}

    <table class="totals">
      <tr><td>الإجمالي قبل الضريبة</td><th dir="ltr">${escapeHtml(view.subtotal)}</th></tr>
      ${Number(view.discountTotal) > 0 ? `<tr><td>الخصم</td><th dir="ltr">${escapeHtml(view.discountTotal)}</th></tr>` : ''}
      <tr><td>ضريبة القيمة المضافة (${escapeHtml(view.vatRate)}%)</td><th dir="ltr">${escapeHtml(view.vatTotal)}</th></tr>
      <tr class="grand"><td>الإجمالي المستحق</td><th dir="ltr">${escapeHtml(view.grandTotal)}</th></tr>
      <tr><td>المدفوع</td><th dir="ltr">${escapeHtml(view.paidAmount)}</th></tr>
      <tr><td>المتبقي</td><th dir="ltr">${escapeHtml(view.outstandingAmount)}</th></tr>
    </table>

    ${qrBlock(view)}

    ${
      copy.requiresCustomerSignature && copy.signatureBlock
        ? `<div class="sign">
            <div class="sign-box"><span>${escapeHtml(copy.signatureBlock.customerSignatureLabel)}</span></div>
            <div class="sign-box"><span>${escapeHtml(copy.signatureBlock.repSignatureLabel)}</span></div>
            <div class="muted small">${escapeHtml(copy.signatureBlock.accountantNote)}</div>
          </div>`
        : ''
    }
    ${view.notes ? `<div class="notes">ملاحظات: ${escapeHtml(view.notes)}</div>` : ''}
    <footer class="muted small">
      ${view.invoiceMode === 'zatca_tax' ? 'مستند ضريبي إلكتروني — الحالة: ' + escapeHtml(view.invoiceStatus || '—') : 'حالة السياسة الضريبية: ' + escapeHtml(view.taxPolicyStatus)}
    </footer>
  </section>`;

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(view.documentNumber)} — نسختا الطباعة</title>
<style>
  :root { color-scheme: light; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 16px; background: #fff; color: #111; }
  .no-print { text-align: center; margin-bottom: 12px; }
  .copy { border: 1px solid #999; border-radius: 6px; padding: 14px; margin: 0 auto 18px; max-width: 780px; page-break-after: always; }
  .copy:last-child { page-break-after: auto; }
  header { display: flex; justify-content: space-between; gap: 14px; border-bottom: 2px solid #111; padding-bottom: 8px; }
  h1 { font-size: 19px; margin: 0 0 2px; }
  h2 { font-size: 15px; margin: 0 0 6px; }
  h3 { font-size: 13px; margin: 0 0 4px; }
  .en { font-size: 12px; color: #444; }
  .meta { font-size: 11px; color: #333; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
  .copy-label { display: inline-block; background: #111; color: #fff; font-size: 11px; padding: 2px 8px; border-radius: 10px; margin-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .kv td, .kv th { text-align: right; padding: 1px 4px; font-weight: 400; }
  .kv th { font-weight: 700; }
  .parties { display: flex; gap: 24px; margin: 10px 0; }
  .lines th, .lines td { border: 1px solid #bbb; padding: 4px 6px; text-align: right; }
  .lines thead th { background: #f2f2f2; }
  .lines tr.bonus td { background: #fffbe8; }
  .bonus-note { margin: 8px 0; font-size: 12px; background: #fffbe8; border: 1px dashed #c9a227; padding: 6px 8px; border-radius: 4px; }
  .totals { width: 320px; margin: 10px 0 10px auto; }
  .totals td, .totals th { border-bottom: 1px solid #ddd; padding: 3px 6px; text-align: right; }
  .totals tr.grand td, .totals tr.grand th { border-top: 2px solid #111; font-size: 14px; }
  .sign { display: flex; gap: 18px; margin-top: 18px; }
  .sign-box { flex: 1; border: 1px solid #999; border-radius: 4px; height: 62px; display: flex; align-items: flex-end; padding: 6px; font-size: 11px; color: #555; }
  .notes { margin-top: 10px; font-size: 12px; }
  .muted { color: #555; }
  .small { font-size: 11px; }
  footer { margin-top: 10px; border-top: 1px solid #ddd; padding-top: 6px; }
  .qr { margin: 12px 0; text-align: center; }
  .qr svg { display: block; margin: 0 auto 6px; }
  .qr-missing { font-size: 11px; color: #555; border: 1px dashed #999; border-radius: 4px; padding: 6px 8px; }
  @media print { .no-print { display: none !important; } body { padding: 0; } .copy { border: none; } }
</style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()" style="padding:8px 16px;font-weight:700;cursor:pointer;">🖨️ طباعة النسختين</button>
    <span class="muted small"> نسخة للعميل ونسخة للمندوب تُعاد موقّعة إلى المحاسب — مستند بيع رسمي واحد بنسختين مطبوعتين</span>
  </div>
  ${view.copies.map(renderCopy).join('')}
</body>
</html>`;
}

/** نافذة الطباعة كما يحتاجها المُصيِّر — أقلّ من `Window`، فيُقاس بلا متصفّح. */
export type PrintWindowLike = {
  open(url: string, target: string, features: string): PrintDocumentHost | null;
};

export type PrintDocumentHost = {
  document: { open(): void; write(html: string): void; close(): void };
};

export const PRINT_WINDOW_FEATURES = 'width=900,height=1000';

/**
 * يفتح نافذة الطباعة ويكتب فيها النسخ، ويُعيد `false` حين لا نافذة (بناءُ الخادم، أو
 * حاجبُ النوافذ المنبثقة) — فلا يظنّ المشرف أنّ الورق خرج وهو لم يخرج. والمتصفّح هو الذي
 * يتولّى حوار الطابعة، كما في الإيصال الحراريّ.
 */
export function openVanDocumentPrintWindow(
  view: VanDocumentPrintView,
  host?: PrintWindowLike | null,
): boolean {
  const target = host ?? (typeof window === 'undefined' ? null : window);
  if (!target) return false;
  const win = target.open('', '_blank', PRINT_WINDOW_FEATURES);
  if (!win) return false;
  win.document.open();
  win.document.write(buildVanDocumentPrintHtml(view));
  win.document.close();
  return true;
}
