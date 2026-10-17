import { renderToStaticMarkup } from 'react-dom/server';
import qrcode from 'qrcode-generator';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import * as zatcaQrModule from '../components/zatca-qr-svg';
import {
  ZATCA_QR_MISSING_TEXT,
  ZatcaQrSvg,
  printThermalReceipt80mm,
  renderQrSvgMarkup,
} from '../components/zatca-qr-svg';

/**
 * 🧾 ما يُطبع على ورقةٍ يدفعها العميل لجهةٍ حكومية ليس تفصيلًا تجميليًّا. هذا السبيك
 * يقيس three things: (١) الرمز مرمَّزٌ ترميزًا حقيقيًّا يقرأه الماسح — لا مصفوفة 29×29
 * مزخرفة؛ (٢) غياب الحمولة الصادرة يُطبع قولًا صريحًا لا مربّعًا زائفًا؛ (٣) هويّة
 * المنشأة ورقمها الضريبي لا يُخترعان عند الغياب.
 */

/** حمولة TLV حقيقية الطول (اسم بائع عربيّ + رقم ضريبي + مبلغ) بصيغتها base64. */
const ISSUED_PAYLOAD =
  'D+WIhuaXg+S4iCDYp9in2YrYqCDZhdin2YjYqNmK2KkgMjAyNi0xMC0xNFQwODowMDowMFoEJTM3OS41MAUCJDI1LjMw';
const SHORT_PAYLOAD = 'AQ0xMjM0NQ==';

function matrixOf(payload: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
  );
}

function viewBoxDim(markup: string): number {
  const match = /viewBox="0 0 (\d+) (\d+)"/.exec(markup);
  expect(match, `viewBox missing in: ${markup.slice(0, 120)}`).not.toBeNull();
  return Number(match?.[1]);
}

const RECEIPT = {
  companyName: 'مخابز الوحدة',
  branchName: 'فرع الحزم',
  invoiceNumber: 'INV-0001',
  invoiceTypeLabel: 'فاتورة ضريبية مبسطة — إيصال كاشير',
  issuedAt: '2026-10-14 08:00',
  customerName: 'عميل عام',
  paymentMethodLabel: 'نقداً',
  lines: [{ name: 'خبز تميس', quantity: '2', unitPrice: '1.50', total: '3.00' }],
  subtotal: '3.00',
  taxTotal: '0.45',
  total: '3.45',
  paidAmount: '5.00',
  changeAmount: '1.55',
};

/** نافذةٌ مزروعة تلتقط ما يُكتب في نافذة الطباعة — لا متصفّح هنا ولا اختراع. */
function captureReceiptHtml(): string[] {
  const written: string[] = [];
  const fakeWindow = {
    open: () => ({
      document: {
        open: () => undefined,
        write: (html: string) => {
          written.push(html);
        },
        close: () => undefined,
      },
    }),
  };
  (globalThis as Record<string, unknown>).window = fakeWindow;
  return written;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('the receipt QR is encoded, not decorated', () => {
  it('draws every dark module the real encoder produces, at the encoder’s own size', () => {
    const markup = renderQrSvgMarkup(ISSUED_PAYLOAD, 138);
    const matrix = matrixOf(ISSUED_PAYLOAD);
    const quiet = 2;

    const rects = [...markup.matchAll(/<rect x="(\d+)" y="(\d+)" width="1" height="1"/g)].map((match) =>
      `${Number(match[1]) - quiet},${Number(match[2]) - quiet}`,
    );
    const expected = matrix.flatMap((row, r) =>
      row.flatMap((cell, c) => (cell ? [`${c},${r}`] : [])),
    );

    expect(rects.sort()).toEqual(expected.sort());
    expect(viewBoxDim(markup)).toBe(matrix.length + quiet * 2);
  });

  it('grows the symbol with the payload — a fixed 29×29 decoration cannot', () => {
    // The removed fake drew a 29×29 grid for every payload; a real version-1 symbol is
    // 21 modules and this TLV needs more, so the size has to move with the data.
    expect(viewBoxDim(renderQrSvgMarkup(SHORT_PAYLOAD))).toBe(21 + 4);
    expect(matrixOf(ISSUED_PAYLOAD).length).toBeGreaterThan(29);
    expect(viewBoxDim(renderQrSvgMarkup(ISSUED_PAYLOAD))).toBeGreaterThan(viewBoxDim(renderQrSvgMarkup(SHORT_PAYLOAD)));
  });

  it('encodes differently for different payloads of the same length', () => {
    const a = renderQrSvgMarkup('AAAA-BBBB-1111');
    const b = renderQrSvgMarkup('AAAA-BBBB-2222');
    expect(a).not.toEqual(b);
  });

  it('exposes no local TLV builder to fabricate a payload in the browser', () => {
    // المصدّرات كما هي وقت التشغيل — لا مسحٌ لنصّ المصدر: لو رجع مُنشئ الحمولة المحليّ
    // يومًا فسيظهر هنا اسمًا حقيقيًّا ويسقط هذا القياس.
    expect(Object.keys(zatcaQrModule).sort()).toEqual(
      ['ZATCA_QR_MISSING_TEXT', 'ZatcaQrSvg', 'printThermalReceipt80mm', 'renderQrSvgMarkup'].sort(),
    );
  });
});

describe('nothing is printed when no e-invoice payload was issued', () => {
  it('renderQrSvgMarkup returns no markup for an empty payload', () => {
    expect(renderQrSvgMarkup('')).toBe('');
    expect(renderQrSvgMarkup(null)).toBe('');
    expect(renderQrSvgMarkup(undefined)).toBe('');
  });

  it('ZatcaQrSvg says «لم تُصدر بعد» instead of drawing a square', () => {
    const html = renderToStaticMarkup(React.createElement(ZatcaQrSvg, { payload: null }));
    expect(html).toContain(ZATCA_QR_MISSING_TEXT);
    expect(html).not.toContain('<svg');
  });

  it('ZatcaQrSvg draws the symbol when a real payload exists', () => {
    const html = renderToStaticMarkup(
      React.createElement(ZatcaQrSvg, { payload: ISSUED_PAYLOAD, label: 'باركود الفاتورة الضريبية المبسطة (QR)' }),
    );
    expect(html).toContain('<svg');
    expect(html).not.toContain(ZATCA_QR_MISSING_TEXT);
  });

  it('the thermal receipt prints the note, not a fake square', () => {
    const written = captureReceiptHtml();
    printThermalReceipt80mm({ ...RECEIPT, qrPayload: null });
    const html = written[0] ?? '';
    expect(html).toContain(ZATCA_QR_MISSING_TEXT);
    expect(html).not.toContain('<svg');
    expect(html).not.toContain('رمز الفاتورة الضريبية المبسطة (ZATCA QR)');
  });

  it('the thermal receipt prints the issued symbol when there is one', () => {
    const written = captureReceiptHtml();
    printThermalReceipt80mm({ ...RECEIPT, qrPayload: ISSUED_PAYLOAD });
    const html = written[0] ?? '';
    expect(html).toContain('<svg');
    expect(html).toContain('رمز الفاتورة الضريبية المبسطة (ZATCA QR)');
    expect(html).not.toContain(ZATCA_QR_MISSING_TEXT);
  });
});

describe('the receipt carries the tenant’s identity, never an invented one', () => {
  it('prints the company name and omits the tax line when no tax number is known', () => {
    const written = captureReceiptHtml();
    printThermalReceipt80mm({ ...RECEIPT, companyName: 'مخابز الوحدة', taxNo: '', qrPayload: null });
    const html = written[0] ?? '';
    expect(html).toContain('مخابز الوحدة');
    expect(html).not.toContain('الرقم الضريبي');
    expect(html).not.toContain('ERP Cloud KSA');
    expect(html).not.toContain('300000000000003');
  });

  it('prints the registered tax number when the profile has one', () => {
    const written = captureReceiptHtml();
    printThermalReceipt80mm({ ...RECEIPT, taxNo: '300012345600003', qrPayload: null });
    const html = written[0] ?? '';
    expect(html).toContain('الرقم الضريبي');
    expect(html).toContain('300012345600003');
  });
});
