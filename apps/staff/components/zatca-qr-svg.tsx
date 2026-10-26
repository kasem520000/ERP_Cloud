'use client';

import {
  ZATCA_QR_MISSING_TEXT,
  buildQrMatrix,
  renderQrSvgMarkup,
} from '@erp/web-van/qr';
import { Decimal } from 'decimal.js';
import React from 'react';

/**
 * `@erp/web-van/qr` هو المُرمِّز الواحد للرمز على الورق الرسميّ (لوحة staff وواجهة
 * المخابز معًا)، ويُعاد تصديره هنا كما هو: والقائمة المُصدَّرة مقصودةٌ بضيقها —
 * `tests/zatca-qr.spec.ts` يقيسها بأسمائها كي لا يرجع مُنشئ حمولة TLV محليّ يومًا.
 */
export { ZATCA_QR_MISSING_TEXT, renderQrSvgMarkup };

function fmt2(val: string | undefined | null): string {
  try {
    return new Decimal(val && val.trim() ? val : '0').toFixed(2);
  } catch {
    return '0.00';
  }
}

const QR_BOX_STYLE: React.CSSProperties = {
  display: 'inline-grid',
  justifyItems: 'center',
  gap: 6,
  padding: 10,
  borderRadius: 12,
  border: '1px solid var(--line)',
  background: '#ffffff',
  color: '#0f172a',
};

export function ZatcaQrSvg({
  payload,
  size = 140,
  label = 'باركود الفاتورة الضريبية (ZATCA QR)',
  missingText = ZATCA_QR_MISSING_TEXT,
}: {
  payload?: string | null;
  size?: number;
  label?: string;
  missingText?: string;
}) {
  if (!payload) {
    return (
      <div style={{ ...QR_BOX_STYLE, borderStyle: 'dashed', maxWidth: size + 40 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textAlign: 'center', lineHeight: 1.6 }}>
          {missingText}
        </span>
      </div>
    );
  }

  const matrix = buildQrMatrix(payload);
  const n = matrix.length;
  const quiet = 2;
  const gridDim = n + quiet * 2;

  return (
    <div style={QR_BOX_STYLE}>
      <svg
        viewBox={`0 0 ${gridDim} ${gridDim}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        aria-label={label}
      >
        <rect width={gridDim} height={gridDim} fill="#ffffff" />
        {matrix.map((row, r) =>
          row.map((cell, c) =>
            cell ? (
              <rect key={`${r}-${c}`} x={c + quiet} y={r + quiet} width={1} height={1} fill="#000000" />
            ) : null,
          ),
        )}
      </svg>
      {label ? (
        <span style={{ fontSize: 11, fontWeight: 700, color: '#334155', textAlign: 'center' }}>{label}</span>
      ) : null}
    </div>
  );
}

export type ThermalReceiptData = {
  companyName: string;
  companyNameEn?: string | null;
  taxNo?: string | null;
  crNo?: string | null;
  companyPhones?: string[];
  companyAddress?: string | Record<string, unknown> | null;
  logoDataUrl?: string | null;
  branchName?: string;
  invoiceNumber: string;
  invoiceTypeLabel?: string;
  issuedAt: string;
  customerName: string;
  customerTaxNo?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | Record<string, unknown> | null;
  cashierName?: string;
  salesmanName?: string;
  paymentMethodLabel: string;
  lines: Array<{
    name: string;
    unit?: string;
    quantity: string;
    unitPrice: string;
    total: string;
  }>;
  subtotal: string;
  discount?: string;
  taxTotal: string;
  total: string;
  paidAmount?: string;
  changeAmount?: string;
  notes?: string | null;
  returnPolicy?: string | null;
  zatcaPhase?: 1 | 2;
  qrPayload?: string | null;
};

function formatAddressInline(addr: string | Record<string, unknown> | null | undefined): string {
  if (!addr) return '';
  if (typeof addr === 'string') return addr.trim();
  if (typeof addr !== 'object') return '';
  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = addr[k];
      if (typeof v === 'string' && v.trim()) return v.trim();
    }
    return '';
  };
  const parts: string[] = [];
  const building = pick('building', 'buildingNumber');
  const street = pick('street', 'streetName', 'addStreet');
  const district = pick('district', 'neighborhood');
  const city = pick('city');
  const postal = pick('postal', 'postalCode');
  const additional = pick('additional', 'additionalNumber');
  if (building) parts.push(`مبنى ${building}`);
  if (street) parts.push(`شارع ${street}`);
  if (district) parts.push(`حي ${district}`);
  if (city) parts.push(city);
  if (postal) parts.push(`رمز بريدي ${postal}`);
  if (additional) parts.push(`إضافي ${additional}`);
  return parts.join(' ، ');
}

export function printThermalReceipt80mm(receipt: ThermalReceiptData) {
  if (typeof window === 'undefined') return;
  const qrSvg = renderQrSvgMarkup(receipt.qrPayload, 148);
  const hasCustomerTax = Boolean(
    receipt.customerTaxNo &&
      receipt.customerTaxNo.trim().length > 0 &&
      receipt.customerName.trim() !== 'عميل عام' &&
      receipt.customerName.trim() !== 'عميل نقدي',
  );
  const resolvedTitle =
    receipt.invoiceTypeLabel?.trim() || (hasCustomerTax ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة');
  // العنوان الوطني للعميل يظهر فقط إذا كان للعميل رقم ضريبي مسجّل
  const customerAddrInline = hasCustomerTax ? formatAddressInline(receipt.customerAddress) : '';
  const companyAddrInline = formatAddressInline(receipt.companyAddress);

  const rowsHtml = receipt.lines
    .map(
      (line) => `
 <tr>
 <td class="item-td"><b>${escapeHtml(line.name)}</b>${line.unit ? `<div class="unit-sub">${escapeHtml(line.unit)}</div>` : ''}</td>
 <td class="num center" dir="ltr">${fmt2(line.quantity)}</td>
 <td class="num" dir="ltr">${fmt2(line.unitPrice)}</td>
 <td class="num bold" dir="ltr">${fmt2(line.total)}</td>
 </tr>`,
    )
    .join('');

  const hasDiscount = new Decimal(receipt.discount || '0').gt(0);
  const hasChange = new Decimal(receipt.changeAmount || '0').gt(0);
  const qrCaption = hasCustomerTax
    ? receipt.zatcaPhase === 2
      ? 'رمز الفاتورة الضريبية — المرحلة الثانية (ZATCA QR)'
      : 'رمز الفاتورة الضريبية (ZATCA QR)'
    : receipt.zatcaPhase === 2
      ? 'رمز الفاتورة الضريبية المبسطة (ZATCA QR) — المرحلة الثانية'
      : 'رمز الفاتورة الضريبية المبسطة (ZATCA QR)';

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
 <meta charset="utf-8" />
 <title>إيصال كاشير ${escapeHtml(receipt.invoiceNumber)}</title>
 <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Tajawal', 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif;
      width: 76mm;
      margin: 0 auto;
      padding: 3.5mm 2.5mm;
      color: #000;
      background: #fff;
      font-size: 11.5px;
      line-height: 1.4;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .center { text-align: center; }
    .head-box { text-align: center; border-bottom: 1.5px dashed #000; padding-bottom: 5px; margin-bottom: 5px; }
    .head-logo { max-width: 115px; max-height: 50px; object-fit: contain; margin: 0 auto 3px; display: block; }
    .title { font-size: 15px; font-weight: 800; margin: 2px 0; }
    .sub { font-size: 10.5px; color: #111; margin: 1px 0; }
    .inv-banner { border: 1.5px solid #000; background: #eaecef; text-align: center; padding: 4px 6px; margin-bottom: 5px; font-size: 13.5px; font-weight: 800; }
    table { width: 100%; border-collapse: collapse; font-size: 10.5px; margin-bottom: 5px; }
    .meta-tbl th, .meta-tbl td { border: 1px solid #000; padding: 2px 4px; text-align: right; }
    .meta-tbl th { background: #f2f4f7; font-weight: 700; white-space: nowrap; }
    .cust-box { border: 1px solid #000; padding: 3px 5px; margin-bottom: 5px; font-size: 10.5px; }
    .items-tbl th, .items-tbl td { border: 1px solid #000; padding: 3px 4px; }
    .items-tbl thead th { background: #dfe3e8; font-weight: 800; text-align: center; }
    .item-td { text-align: right; }
    .unit-sub { font-size: 9.5px; color: #333; }
    .num { text-align: left; font-variant-numeric: tabular-nums; }
    .bold { font-weight: 800; }
    .tot-tbl th, .tot-tbl td { border: 1px solid #000; padding: 3px 5px; }
    .tot-tbl th { background: #f5f5f5; text-align: right; font-weight: 700; }
    .tot-tbl tr.grand th, .tot-tbl tr.grand td { background: #dfe3e8; font-size: 12.5px; font-weight: 800; }
    .box-note { border: 1px solid #000; padding: 3px 5px; margin-bottom: 5px; font-size: 10px; line-height: 1.35; }
    .qr-box { text-align: center; margin-top: 6px; padding-top: 5px; border-top: 1px dashed #000; }
    .no-print { text-align: center; margin-bottom: 8px; }
    @media print { .no-print { display: none !important; } }
 </style>
</head>
<body>
 <div class="no-print">
 <button onclick="window.print()" style="padding:6px 14px;font-weight:700;cursor:pointer;">طباعة الإيصال الحراري (80mm)</button>
 </div>

 <div class="head-box">
  ${receipt.logoDataUrl ? `<img src="${escapeHtml(receipt.logoDataUrl)}" alt="logo" class="head-logo" />` : ''}
  <div class="title">${escapeHtml(receipt.companyName)}</div>
  ${receipt.companyNameEn ? `<div class="sub" dir="ltr">${escapeHtml(receipt.companyNameEn)}</div>` : ''}
  ${receipt.branchName ? `<div class="sub">الفرع: <b>${escapeHtml(receipt.branchName)}</b></div>` : ''}
  ${receipt.taxNo ? `<div class="sub">الرقم الضريبي: <b dir="ltr">${escapeHtml(receipt.taxNo)}</b></div>` : ''}
  ${receipt.crNo ? `<div class="sub">السجل التجاري: <b dir="ltr">${escapeHtml(receipt.crNo)}</b></div>` : ''}
  ${receipt.companyPhones && receipt.companyPhones.length ? `<div class="sub" dir="ltr">${escapeHtml(receipt.companyPhones.join(' - '))}</div>` : ''}
  ${companyAddrInline ? `<div class="sub">${escapeHtml(companyAddrInline)}</div>` : ''}
 </div>

 <div class="inv-banner">${escapeHtml(resolvedTitle)}</div>

 <table class="meta-tbl">
  <tr>
   <th>رقم الفاتورة</th>
   <td dir="ltr"><b>${escapeHtml(receipt.invoiceNumber)}</b></td>
   <th>طريقة الدفع</th>
   <td><b>${escapeHtml(receipt.paymentMethodLabel)}</b></td>
  </tr>
  <tr>
   <th>التاريخ</th>
   <td colspan="3" dir="ltr">${escapeHtml(receipt.issuedAt)}</td>
  </tr>
  ${
    receipt.cashierName || receipt.salesmanName
      ? `<tr>
          <th>الكاشير</th>
          <td>${escapeHtml(receipt.cashierName || '—')}</td>
          <th>المندوب</th>
          <td>${escapeHtml(receipt.salesmanName || '—')}</td>
         </tr>`
      : ''
  }
 </table>

 <div class="cust-box">
  <div>العميل: <b>${escapeHtml(receipt.customerName || 'عميل عام')}</b></div>
  ${receipt.customerPhone ? `<div>جوال العميل: <b dir="ltr">${escapeHtml(receipt.customerPhone)}</b></div>` : ''}
  ${hasCustomerTax && receipt.customerTaxNo ? `<div>الرقم الضريبي للعميل: <b dir="ltr">${escapeHtml(receipt.customerTaxNo)}</b></div>` : ''}
  ${customerAddrInline ? `<div data-national-address>العنوان الوطني للعميل: <b>${escapeHtml(customerAddrInline)}</b></div>` : ''}
 </div>

 <table class="items-tbl">
  <thead>
   <tr>
    <th style="text-align:right;">الصنف</th>
    <th style="width:42px;">الكمية</th>
    <th style="width:52px;">السعر</th>
    <th style="width:60px;">الإجمالي</th>
   </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
 </table>

 <table class="tot-tbl">
  <tr><th>الإجمالي قبل الضريبة</th><td class="num" dir="ltr">${fmt2(receipt.subtotal)} SAR</td></tr>
  ${hasDiscount ? `<tr><th>الخصم</th><td class="num" dir="ltr">-${fmt2(receipt.discount)} SAR</td></tr>` : ''}
  <tr><th>ضريبة القيمة المضافة (15%)</th><td class="num" dir="ltr">${fmt2(receipt.taxTotal)} SAR</td></tr>
  <tr class="grand"><th>الصافي شامل الضريبة</th><td class="num" dir="ltr">${fmt2(receipt.total)} SAR</td></tr>
  ${receipt.paidAmount !== undefined ? `<tr><th>المدفوع</th><td class="num" dir="ltr">${fmt2(receipt.paidAmount)} SAR</td></tr>` : ''}
  ${hasChange ? `<tr><th>الباقي للعميل</th><td class="num" dir="ltr">${fmt2(receipt.changeAmount)} SAR</td></tr>` : ''}
 </table>

 ${receipt.notes && receipt.notes.trim() ? `<div class="box-note"><b>ملاحظات:</b> ${escapeHtml(receipt.notes).replace(/\n/g, '<br/>')}</div>` : ''}
 ${receipt.returnPolicy && receipt.returnPolicy.trim() ? `<div class="box-note"><b>سياسة الاسترجاع والاستبدال:</b><div>${escapeHtml(receipt.returnPolicy).replace(/\n/g, '<br/>')}</div></div>` : ''}

 <div class="qr-box">
  ${
    qrSvg
      ? `${qrSvg}
 <div class="sub" style="margin-top:4px;font-weight:700;">${escapeHtml(qrCaption)}</div>`
      : `<div class="sub">${escapeHtml(ZATCA_QR_MISSING_TEXT)}</div>`
  }
  <div class="sub">شكراً لزيارتكم</div>
 </div>
 <script>setTimeout(function(){ try { window.print(); } catch(e) {} }, 180);</script>
</body>
</html>`;

  const popup = window.open('', '_blank', 'width=420,height=760');
  if (popup) {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
  }
}

function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
