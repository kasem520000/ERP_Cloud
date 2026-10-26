import { ZATCA_QR_MISSING_TEXT, renderQrSvgMarkup } from './qr';

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
  documentKind?: string;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
  zatcaStatus?: string | null;
  zatcaPhase?: 1 | 2;
  invoiceTitleAr?: string;
  saleDate: string;
  companyName: string;
  companyNameEn: string;
  companyTaxNo: string;
  companyCrNo: string;
  companyCrn?: string;
  companyFieldAr?: string;
  companyFieldEn?: string;
  companyAddressAr?: string;
  companyAddressEn?: string;
  companyEmail: string;
  companyPhones: string[];
  companyAddress: Record<string, unknown> | null;
  banks?: Array<{ name: string; iban: string }>;
  returnPolicy?: string;
  customerName: string;
  customerTaxNo: string;
  customerPhone: string;
  customerMobile: string;
  customerAddress?: Record<string, unknown> | null;
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

function extractNa(raw: Record<string, unknown> | null | undefined) {
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
  };
}

function renderNationalAddressGrid(
  caption: string,
  raw: Record<string, unknown> | null | undefined,
  crn = '',
): string {
  const a = extractNa(raw);
  const hasAny = Boolean(
    a.street || a.district || a.city || a.region || a.building || a.additional || a.postal || crn,
  );
  if (!hasAny) return '';
  return `<table class="na-grid">
    <thead>
      <tr><th colspan="8" class="na-cap">${escapeHtml(caption)}</th></tr>
      <tr><th>الشارع</th><th>الحي</th><th>المدينة</th><th>المنطقة</th><th>المبنى</th><th>الإضافي</th><th>الرمز البريدي</th><th>الرقم الموحد</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>${escapeHtml(a.street || '—')}</td>
        <td>${escapeHtml(a.district || '—')}</td>
        <td>${escapeHtml(a.city || '—')}</td>
        <td>${escapeHtml(a.region || 'المملكة العربية السعودية')}</td>
        <td dir="ltr">${escapeHtml(a.building || '—')}</td>
        <td dir="ltr">${escapeHtml(a.additional || '—')}</td>
        <td dir="ltr">${escapeHtml(a.postal || '—')}</td>
        <td dir="ltr">${escapeHtml(crn || a.unit || '—')}</td>
      </tr>
    </tbody>
  </table>`;
}

function qrBlock(view: VanDocumentPrintView): string {
  if (view.qrPayload) {
    const phaseLabel =
      view.zatcaPhase === 2
        ? 'رمز الفاتورة الإلكترونية — المرحلة الثانية (ZATCA Phase 2)'
        : 'رمز الفاتورة الإلكترونية — المرحلة الأولى (ZATCA QR)';
    return `<div class="qr">${renderQrSvgMarkup(view.qrPayload, 145)}<div class="qr-phase">${escapeHtml(phaseLabel)}</div><div class="muted small">حمولة TLV الصادرة من وحدة الفوترة الإلكترونية: <span dir="ltr">${escapeHtml(view.qrPayload)}</span></div></div>`;
  }
  if (view.invoiceMode !== 'zatca_tax') return '';
  return `<div class="qr qr-missing">${escapeHtml(ZATCA_QR_MISSING_TEXT)}</div>`;
}

export function buildVanDocumentPrintHtml(view: VanDocumentPrintView): string {
  const hasCustomerTax = Boolean(
    view.customerTaxNo &&
      view.customerTaxNo.trim().length > 0 &&
      view.customerName.trim() !== 'عميل عام' &&
      view.customerName.trim() !== 'عميل نقدي',
  );
  const primaryTitle =
    view.invoiceTitleAr ||
    (view.invoiceMode === 'zatca_tax'
      ? hasCustomerTax
        ? 'فاتورة ضريبية'
        : 'فاتورة ضريبية مبسطة'
      : 'إشعار تسليم / فاتورة توزيع داخلية');
  const subTitle =
    view.invoiceMode === 'zatca_tax'
      ? 'فاتورة ضريبية إلكترونية (مبيعات توزيع)'
      : 'إشعار تسليم / فاتورة توزيع داخلية';

  const shortAddr =
    view.companyAddressAr ||
    (view.companyAddress
      ? [
          view.companyAddress.street ? String(view.companyAddress.street) : '',
          view.companyAddress.district ? String(view.companyAddress.district) : '',
          view.companyAddress.city ? String(view.companyAddress.city) : '',
        ]
          .filter(Boolean)
          .join(' — ')
      : '');

  const sellerNaGrid = renderNationalAddressGrid(
    'العنوان الوطني للمنشأة',
    view.companyAddress,
    view.companyCrn || view.companyCrNo,
  );
  // العنوان الوطني للعميل يظهر فقط عند وجود رقم ضريبي للعميل
  const customerNaGrid = hasCustomerTax
    ? renderNationalAddressGrid('العنوان الوطني للعميل', view.customerAddress ?? null)
    : '';

  const banksHtml =
    view.banks && view.banks.length > 0
      ? `<div class="banks">${view.banks
          .map((b) => `<div><b>${escapeHtml(b.name)}:</b> <span dir="ltr">${escapeHtml(b.iban)}</span></div>`)
          .join('')}</div>`
      : '';

  const renderCopy = (copy: VanDocumentPrintCopy): string => `
  <section class="copy">
    <header class="repx-head">
      <div class="company">
        <h1>${escapeHtml(view.companyName || 'المنشأة')}</h1>
        ${view.companyFieldAr ? `<div class="field-line">${escapeHtml(view.companyFieldAr)}</div>` : ''}
        <div class="meta">
          ${view.companyTaxNo ? `<span>الرقم الضريبي: <b dir="ltr">${escapeHtml(view.companyTaxNo)}</b></span>` : ''}
          ${view.companyCrNo ? `<span>السجل التجاري: <b dir="ltr">${escapeHtml(view.companyCrNo)}</b></span>` : ''}
          ${view.companyPhones.length ? `<span>هاتف: <b dir="ltr">${escapeHtml(view.companyPhones.join(' ، '))}</b></span>` : ''}
          ${view.companyEmail ? `<span>بريد: <b dir="ltr">${escapeHtml(view.companyEmail)}</b></span>` : ''}
          ${shortAddr ? `<span>العنوان: ${escapeHtml(shortAddr)}</span>` : ''}
        </div>
      </div>
      <div class="head-center">
        <div class="copy-label">${escapeHtml(copy.copyLabel)}</div>
      </div>
      <div class="head-en" dir="ltr">
        ${view.companyNameEn ? `<div class="en">${escapeHtml(view.companyNameEn)}</div>` : ''}
        ${view.companyFieldEn ? `<div class="field-line">${escapeHtml(view.companyFieldEn)}</div>` : ''}
        ${view.companyAddressEn ? `<div class="small muted">${escapeHtml(view.companyAddressEn)}</div>` : ''}
        ${banksHtml}
      </div>
    </header>

    ${sellerNaGrid}

    <div class="title-banner">
      <h2>${escapeHtml(primaryTitle)}</h2>
      <div class="muted small">${escapeHtml(subTitle)}</div>
    </div>

    <table class="meta-grid">
      <tr>
        <th>رقم المستند</th>
        <td dir="ltr"><b>${escapeHtml(view.documentNumber)}</b></td>
        ${view.invoiceNumber ? `<th>رقم الفاتورة الرسمية</th><td dir="ltr"><b>${escapeHtml(view.invoiceNumber)}</b></td>` : '<th>الوضع الضريبي</th><td>' + escapeHtml(view.taxPolicyStatus) + '</td>'}
        <th>طريقة الدفع</th>
        <td><b>${escapeHtml(view.paymentMethod === 'cash' ? 'نقدًا' : view.paymentMethod === 'card' ? 'شبكة' : 'آجل')}</b></td>
      </tr>
      <tr>
        <th>تاريخ البيع</th>
        <td dir="ltr">${escapeHtml(view.saleDate)}</td>
        <th>تاريخ ووقت الطباعة</th>
        <td colspan="3" dir="ltr">${escapeHtml(formatPrintedAt(view.printedAt))}</td>
      </tr>
    </table>

    <div class="parties">
      <div class="party-box">
        <h3>بيانات العميل</h3>
        <div><b>${escapeHtml(view.customerName || 'عميل نقدي')}</b></div>
        ${view.customerTaxNo ? `<div>الرقم الضريبي: <b dir="ltr">${escapeHtml(view.customerTaxNo)}</b></div>` : ''}
        ${view.customerPhone || view.customerMobile ? `<div>جوال: <b dir="ltr">${escapeHtml(view.customerMobile || view.customerPhone)}</b></div>` : ''}
      </div>
      <div class="party-box">
        <h3>المندوب وسيارة التوزيع</h3>
        <div><b>${escapeHtml(view.salesmanName)}</b></div>
        ${view.salesmanMobile ? `<div>جوال: <b dir="ltr">${escapeHtml(view.salesmanMobile)}</b></div>` : ''}
        <div>العهدة: ${escapeHtml(view.vanWarehouseName)}</div>
        ${view.loadOrderNumber ? `<div>أمر التحميل: <b dir="ltr">${escapeHtml(view.loadOrderNumber)}</b></div>` : ''}
        ${view.productionBatchNo ? `<div>دفعة الإنتاج: <b dir="ltr">${escapeHtml(view.productionBatchNo)}</b></div>` : ''}
      </div>
    </div>

    ${customerNaGrid}

    <table class="lines">
      <thead>
        <tr><th>م</th><th>كود</th><th>الصنف / البيان</th><th>الكمية</th><th>سعر الوحدة</th><th>الخصم</th><th>الإجمالي</th></tr>
      </thead>
      <tbody>
        ${view.lines
          .map(
            (line, index) => `<tr class="${line.kind === 'bonus' ? 'bonus' : ''}">
              <td>${index + 1}</td>
              <td dir="ltr">${escapeHtml(line.sku || '—')}</td>
              <td>${escapeHtml(line.itemName)}${line.reason ? ` <span class="muted">(${escapeHtml(line.reason)})</span>` : ''}</td>
              <td dir="ltr">${escapeHtml(line.quantity)}</td>
              <td dir="ltr">${escapeHtml(line.unitPrice)}</td>
              <td dir="ltr">${escapeHtml(line.discount)}</td>
              <td dir="ltr"><b>${escapeHtml(line.lineTotal)}</b></td>
            </tr>`,
          )
          .join('')}
      </tbody>
    </table>

    ${Number(view.bonusQtyTotal) > 0 ? `<div class="bonus-note">🎁 الكميات المجانية (البونص): <b dir="ltr">${escapeHtml(view.bonusQtyTotal)}</b> — مُسلَّمة بلا قيمة وبلا ضريبة، وتُخصم من المخزون بالتكلفة.</div>` : ''}

    <div class="bottom-split">
      <div class="bottom-right">
        ${qrBlock(view)}
        ${view.notes ? `<div class="notes"><b>ملاحظات:</b> ${escapeHtml(view.notes)}</div>` : ''}
        ${view.returnPolicy ? `<div class="policy-box"><b>سياسة الاسترجاع والاستبدال:</b><div>${escapeHtml(view.returnPolicy).replace(/\n/g, '<br/>')}</div></div>` : ''}
      </div>

      <table class="totals">
        <tr><td>الإجمالي قبل الضريبة</td><th dir="ltr">${escapeHtml(view.subtotal)}</th></tr>
        ${Number(view.discountTotal) > 0 ? `<tr><td>الخصم</td><th dir="ltr">${escapeHtml(view.discountTotal)}</th></tr>` : ''}
        <tr><td>ضريبة القيمة المضافة (${escapeHtml(view.vatRate)}%)</td><th dir="ltr">${escapeHtml(view.vatTotal)}</th></tr>
        <tr class="grand"><td>الإجمالي المستحق</td><th dir="ltr">${escapeHtml(view.grandTotal)}</th></tr>
        <tr><td>المدفوع</td><th dir="ltr">${escapeHtml(view.paidAmount)}</th></tr>
        <tr><td>المتبقي</td><th dir="ltr">${escapeHtml(view.outstandingAmount)}</th></tr>
      </table>
    </div>

    ${
      copy.requiresCustomerSignature && copy.signatureBlock
        ? `<div class="sign">
            <div class="sign-box"><span>${escapeHtml(copy.signatureBlock.customerSignatureLabel)}</span></div>
            <div class="sign-box"><span>${escapeHtml(copy.signatureBlock.repSignatureLabel)}</span></div>
            <div class="muted small">${escapeHtml(copy.signatureBlock.accountantNote)}</div>
          </div>`
        : ''
    }
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
  @page { size: A4; margin: 10mm; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; margin: 0; padding: 14px; background: #fff; color: #111; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .no-print { text-align: center; margin-bottom: 12px; }
  .copy { border: 1.5px solid #222; padding: 12px; margin: 0 auto 18px; max-width: 800px; page-break-after: always; }
  .copy:last-child { page-break-after: auto; }
  header.repx-head { display: grid; grid-template-columns: 1.3fr auto 1.1fr; gap: 10px; align-items: center; border: 1.5px solid #222; padding: 8px 10px; margin-bottom: 6px; }
  h1 { font-size: 18px; margin: 0 0 2px; font-weight: 800; }
  h2 { font-size: 17px; margin: 0; font-weight: 800; }
  h3 { font-size: 12.5px; margin: 0 0 4px; background: #dfe3e8; padding: 3px 6px; border-bottom: 1px solid #333; }
  .en { font-size: 14px; font-weight: 800; color: #111; }
  .field-line { font-size: 11.5px; font-weight: 600; color: #333; }
  .head-center { text-align: center; }
  .head-en { text-align: left; font-size: 11px; }
  .banks { margin-top: 4px; border-top: 1px dashed #999; padding-top: 3px; font-size: 10.5px; }
  .meta { font-size: 11px; color: #222; display: flex; flex-wrap: wrap; gap: 8px; margin-top: 4px; }
  .copy-label { display: inline-block; background: #111; color: #fff; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 4px; }
  .title-banner { border: 1.5px solid #111; background: #eef0f3; text-align: center; padding: 5px 8px; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  .meta-grid th, .meta-grid td { border: 1px solid #333; padding: 4px 6px; text-align: right; }
  .meta-grid th { background: #eef0f3; font-weight: 700; white-space: nowrap; }
  .na-grid { margin-bottom: 6px; font-size: 10.5px; }
  .na-grid th, .na-grid td { border: 1px solid #333; padding: 3px 4px; text-align: center; }
  .na-grid thead th { background: #eef0f3; }
  .na-grid .na-cap { background: #dfe3e8; text-align: right; padding-inline: 6px; font-weight: 800; }
  .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: 6px 0; }
  .party-box { border: 1px solid #333; padding-bottom: 5px; font-size: 11.5px; }
  .party-box > div { padding: 1px 7px; }
  .lines { margin-top: 6px; }
  .lines th, .lines td { border: 1px solid #333; padding: 4px 6px; text-align: right; }
  .lines thead th { background: #dfe3e8; text-align: center; font-weight: 800; }
  .lines tr.bonus td { background: #fffbe8; }
  .bonus-note { margin: 6px 0; font-size: 11.5px; background: #fffbe8; border: 1px dashed #c9a227; padding: 5px 8px; }
  .bottom-split { display: grid; grid-template-columns: 1.25fr 0.95fr; gap: 10px; align-items: start; margin-top: 8px; }
  .bottom-right { display: flex; flex-direction: column; gap: 6px; }
  .totals { border: 1.5px solid #222; }
  .totals td, .totals th { border: 1px solid #333; padding: 4px 7px; text-align: right; }
  .totals td { background: #f6f7f9; font-weight: 600; }
  .totals tr.grand td, .totals tr.grand th { background: #dfe3e8; border-top: 2px solid #111; border-bottom: 2px solid #111; font-size: 13.5px; font-weight: 800; }
  .sign { display: flex; gap: 12px; margin-top: 12px; align-items: flex-end; flex-wrap: wrap; }
  .sign-box { flex: 1; min-width: 180px; border: 1px solid #333; height: 58px; display: flex; align-items: flex-end; justify-content: center; padding: 5px; font-size: 11px; font-weight: 700; color: #222; background: #fafafa; }
  .notes { border: 1px dashed #555; padding: 5px 7px; font-size: 11.5px; }
  .policy-box { border: 1px solid #333; padding: 5px 7px; font-size: 11px; background: #fafafa; line-height: 1.4; }
  .muted { color: #555; }
  .small { font-size: 10.5px; }
  footer { margin-top: 8px; border-top: 1.5px solid #222; padding-top: 5px; }
  .qr { border: 1px solid #333; padding: 6px; text-align: center; background: #fff; }
  .qr svg { display: block; margin: 0 auto 4px; }
  .qr-phase { font-size: 11px; font-weight: 800; margin-bottom: 2px; }
  .qr-missing { font-size: 11px; color: #555; border: 1px dashed #999; padding: 6px 8px; }
  @media print { .no-print { display: none !important; } body { padding: 0; } }
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

export type PrintWindowLike = {
  open(url: string, target: string, features: string): PrintDocumentHost | null;
};

export type PrintDocumentHost = {
  document: { open(): void; write(html: string): void; close(): void };
};

export const PRINT_WINDOW_FEATURES = 'width=900,height=1000';

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
