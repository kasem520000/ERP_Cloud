'use client';

import { Decimal } from 'decimal.js';
import qrcode from 'qrcode-generator';
import React from 'react';

function fmt2(val: string | undefined | null): string {
  try {
    return new Decimal(val && val.trim() ? val : '0').toFixed(2);
  } catch {
    return '0.00';
  }
}

/**
 * 🧾 ما يقوله المستند حين لا تكون للفاتورة حمولة فوترة إلكترونية صادرة فعلًا. النصّ
 * نفسه الذي تكتبه وثيقة الطباعة على الخادم (`print-templates.service.qrBlock`)، فلا
 * يختلف الورق عن الشاشة.
 */
export const ZATCA_QR_MISSING_TEXT = 'لم تُصدر بعد بيانات الفاتورة الإلكترونية (QR) لهذا المستند.';

/**
 * الرمز يُرسم بمُرمِّز QR حقيقي — `qrcode-generator`، المكتبة نفسها التي ترسمه في وثيقة
 * الطباعة على الخادم. ما كان هنا قبل ذلك مصفوفة 29×29 للزينة: أنماط تحديدٍ وتوقيت ثمّ
 * بتّات الحمولة تحت قناعٍ مختلَق، بلا تصحيح أخطاءٍ ولا معلومات إصدار ولا ترميز بيانات
 * صحيح — أي شكلٌ يشبه الرمز ولا يقرأه أيّ ماسح. ورقٌ يحمل رمزًا لا يُقرأ أسوأ من سطرٍ
 * يقول الحقيقة، لأنّه يوحي بأنّ الفاتورة صدرت إلكترونيًّا وهي لم تصدر.
 */
function buildQrMatrix(payload: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
  );
}

/**
 * حمولةٌ فارغة = لا رمز: تُرجع نصًّا فارغًا ليقول المستند «لم تُصدر بعد» بدل مربّعٍ
 * زائف. لا تُبنى حمولة TLV محليًّا هنا ولا في أيّ شاشة — الحمولة الصادقة هي التي
 * كتبتها وحدة الفوترة الإلكترونية على الفاتورة (`zatca_qr`).
 */
export function renderQrSvgMarkup(payload: string | null | undefined, px = 136): string {
  if (!payload) return '';
  const matrix = buildQrMatrix(payload);
  const n = matrix.length;
  const quiet = 2;
  const gridDim = n + quiet * 2;
  const rects: string[] = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (matrix[r]?.[c]) {
        rects.push(`<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1" fill="#000"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${gridDim} ${gridDim}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${gridDim}" height="${gridDim}" fill="#fff"/>${rects.join('')}</svg>`;
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
  /**
   * الرقم الضريبي للمنشأة كما هو في ملفّها (`company_profiles.tax_no`). لا يُخترَع رقمٌ
   * عند غيابه: السطر يُحذف من الإيصال، فرقمٌ ثابت لمنشأةٍ أخرى ادّعاءٌ لا زينة.
   */
  taxNo?: string | null;
  branchName?: string;
  invoiceNumber: string;
  invoiceTypeLabel?: string;
  issuedAt: string;
  customerName: string;
  cashierName?: string;
  paymentMethodLabel: string;
  lines: Array<{
    name: string;
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
  /** الحمولة الصادرة من وحدة الفوترة الإلكترونية، أو لا شيء — انظر `renderQrSvgMarkup`. */
  qrPayload?: string | null;
};

export function printThermalReceipt80mm(receipt: ThermalReceiptData) {
  if (typeof window === 'undefined') return;
  const qrSvg = renderQrSvgMarkup(receipt.qrPayload, 138);
  const rowsHtml = receipt.lines
    .map(
      (line) => `
      <tr>
        <td style="text-align:right;padding:3px 0;border-bottom:1px dashed #cbd5e1;">${escapeHtml(line.name)}</td>
        <td style="text-align:center;padding:3px 2px;border-bottom:1px dashed #cbd5e1;" dir="ltr">${fmt2(line.quantity)}</td>
        <td style="text-align:center;padding:3px 2px;border-bottom:1px dashed #cbd5e1;" dir="ltr">${fmt2(line.unitPrice)}</td>
        <td style="text-align:left;padding:3px 0;border-bottom:1px dashed #cbd5e1;font-weight:700;" dir="ltr">${fmt2(line.total)}</td>
      </tr>`,
    )
    .join('');

  const hasDiscount = new Decimal(receipt.discount || '0').gt(0);
  const hasChange = new Decimal(receipt.changeAmount || '0').gt(0);

  const html = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <title>إيصال كاشير ${escapeHtml(receipt.invoiceNumber)}</title>
  <style>
    @page { size: 80mm auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      font-family: 'Tajawal', 'Cairo', Tahoma, Arial, sans-serif;
      width: 76mm;
      margin: 0 auto;
      padding: 4mm 3mm;
      color: #000;
      background: #fff;
      font-size: 12px;
      line-height: 1.45;
    }
    .center { text-align: center; }
    .title { font-size: 15px; font-weight: 800; margin: 2px 0; }
    .sub { font-size: 11px; color: #333; margin: 1px 0; }
    .divider { border-top: 1px dashed #000; margin: 6px 0; }
    .meta-row { display: flex; justify-content: space-between; font-size: 11px; margin: 2px 0; }
    table { width: 100%; border-collapse: collapse; font-size: 11px; margin-top: 4px; }
    th { border-bottom: 1px solid #000; padding: 3px 0; font-weight: 700; }
    .tot-row { display: flex; justify-content: space-between; font-size: 12px; margin: 3px 0; }
    .tot-grand { display: flex; justify-content: space-between; font-size: 15px; font-weight: 800; border-top: 1px solid #000; border-bottom: 1px solid #000; padding: 4px 0; margin: 5px 0; }
    .qr-box { text-align: center; margin-top: 8px; }
    .no-print { text-align: center; margin-bottom: 8px; }
    @media print { .no-print { display: none !important; } }
  </style>
</head>
<body>
  <div class="no-print">
    <button onclick="window.print()" style="padding:6px 14px;font-weight:700;cursor:pointer;">🖨️ طباعة الإيصال الحراري (80mm)</button>
  </div>
  <div class="center">
    <div class="title">${escapeHtml(receipt.companyName)}</div>
    <div class="sub">${escapeHtml(receipt.invoiceTypeLabel || 'فاتورة ضريبية مبسطة')}</div>
    ${receipt.taxNo ? `<div class="sub">الرقم الضريبي: <span dir="ltr">${escapeHtml(receipt.taxNo)}</span></div>` : ''}
    ${receipt.branchName ? `<div class="sub">الفرع: ${escapeHtml(receipt.branchName)}</div>` : ''}
  </div>
  <div class="divider"></div>
  <div class="meta-row"><span>رقم الفاتورة:</span><strong dir="ltr">${escapeHtml(receipt.invoiceNumber)}</strong></div>
  <div class="meta-row"><span>التاريخ:</span><span dir="ltr">${escapeHtml(receipt.issuedAt)}</span></div>
  <div class="meta-row"><span>العميل:</span><span>${escapeHtml(receipt.customerName || 'عميل عام')}</span></div>
  <div class="meta-row"><span>طريقة الدفع:</span><span>${escapeHtml(receipt.paymentMethodLabel)}</span></div>
  <div class="divider"></div>
  <table>
    <thead>
      <tr>
        <th style="text-align:right;">الصنف</th>
        <th style="text-align:center;">الكمية</th>
        <th style="text-align:center;">السعر</th>
        <th style="text-align:left;">الإجمالي</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="divider"></div>
  <div class="tot-row"><span>الإجمالي قبل الضريبة:</span><span dir="ltr">${fmt2(receipt.subtotal)} SAR</span></div>
  ${hasDiscount ? `<div class="tot-row"><span>الخصم:</span><span dir="ltr">-${fmt2(receipt.discount)} SAR</span></div>` : ''}
  <div class="tot-row"><span>ضريبة القيمة المضافة (15%):</span><span dir="ltr">${fmt2(receipt.taxTotal)} SAR</span></div>
  <div class="tot-grand"><span>الصافي النهائي:</span><span dir="ltr">${fmt2(receipt.total)} SAR</span></div>
  ${receipt.paidAmount !== undefined ? `<div class="tot-row"><span>المدفوع:</span><span dir="ltr">${fmt2(receipt.paidAmount)} SAR</span></div>` : ''}
  ${hasChange ? `<div class="tot-row"><span>الباقي للعميل:</span><span dir="ltr">${fmt2(receipt.changeAmount)} SAR</span></div>` : ''}
  <div class="qr-box">
    ${
      qrSvg
        ? `${qrSvg}
    <div class="sub" style="margin-top:4px;">رمز الفاتورة الضريبية المبسطة (ZATCA QR)</div>`
        : `<div class="sub">${escapeHtml(ZATCA_QR_MISSING_TEXT)}</div>`
    }
    <div class="sub">شكراً لزيارتكم</div>
  </div>
  <script>setTimeout(function(){ try { window.print(); } catch(e) {} }, 180);</script>
</body>
</html>`;

  const popup = window.open('', '_blank', 'width=420,height=720');
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
