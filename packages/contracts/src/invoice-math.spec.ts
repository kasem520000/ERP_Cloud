import { describe, expect, it } from 'vitest';

import { calculateInvoiceTotals } from './invoice-math.js';

describe('calculateInvoiceTotals', () => {
  it('calculates exclusive VAT and line discounts with decimal precision (legacy 4-dp scale)', () => {
    const result = calculateInvoiceTotals({
      lines: [{ quantity: '2.5', unitPrice: '10.00', discountRate: '10', discountAmount: '0', taxRate: '15' }],
      roundingScale: 4,
    });
    expect(result.subtotal).toBe('22.5');
    expect(result.tax).toBe('3.375');
    expect(result.total).toBe('25.875');
  });

  it('ACC-108: money figures are rounded HALF_UP to the currency minor unit (2 dp by default)', () => {
    // 2.5 × 10 − 10 % = 22.50; VAT 3.375 → 3.38; total 25.88 — net + tax = total holds in halalas.
    const result = calculateInvoiceTotals({ lines: [{ quantity: '2.5', unitPrice: '10.00', discountRate: '10', discountAmount: '0', taxRate: '15' }] });
    expect(result.subtotal).toBe('22.5');
    expect(result.tax).toBe('3.38');
    expect(result.total).toBe('25.88');
    expect(result.lines[0]?.tax).toBe('3.38');
    expect(result.lines[0]?.total).toBe('25.88');
    // 3 × 1.03 + 15 % (the R25 purchase): 3.09 + 0.4635 → 0.46 / 3.55, not 0.4635 / 3.5535.
    const r25 = calculateInvoiceTotals({ lines: [{ quantity: '3', unitPrice: '1.03', discountRate: '0', discountAmount: '0', taxRate: '15' }] });
    expect(r25.subtotal).toBe('3.09');
    expect(r25.tax).toBe('0.46');
    expect(r25.total).toBe('3.55');
    // Two lines of 1 × 1.03: each line rounds on its own (1.03 + 0.15 = 1.18), so the invoice is 2.36.
    const twoLines = calculateInvoiceTotals({
      lines: [1, 2].map(() => ({ quantity: '1', unitPrice: '1.03', discountRate: '0', discountAmount: '0', taxRate: '15' })),
    });
    expect(twoLines.tax).toBe('0.3');
    expect(twoLines.total).toBe('2.36');
    // Inclusive pricing: 1.5 × 1.03 = 1.545 → the inclusive total is 1.55; VAT 0.20; net 1.35.
    const inclusive = calculateInvoiceTotals({
      priceIncludesVat: true,
      lines: [{ quantity: '1.5', unitPrice: '1.03', discountRate: '0', discountAmount: '0', taxRate: '15' }],
    });
    expect(inclusive.total).toBe('1.55');
    expect(inclusive.tax).toBe('0.2');
    expect(inclusive.subtotal).toBe('1.35');
    // roundingScale 0 → whole riyals.
    const whole = calculateInvoiceTotals({ lines: [{ quantity: '1', unitPrice: '10.4', discountRate: '0', discountAmount: '0', taxRate: '15' }], roundingScale: 0 });
    expect(whole.subtotal).toBe('10');
    expect(whole.tax).toBe('2');
    expect(whole.total).toBe('12');
  });

  it('extracts inclusive VAT without floating point drift', () => {
    const result = calculateInvoiceTotals({ priceIncludesVat: true, lines: [{ quantity: '1', unitPrice: '115', discountRate: '0', discountAmount: '0', taxRate: '15' }] });
    expect(result.tax).toBe('15');
    expect(result.total).toBe('115');
  });

  it('applies document discount, extra tax, and withholding', () => {
    const result = calculateInvoiceTotals({ invoiceDiscount: '5', extraTax: '2', withholding: '3', lines: [{ quantity: '1', unitPrice: '100', discountRate: '0', discountAmount: '0', taxRate: '0' }] });
    expect(result.total).toBe('94');
  });

  it('recomputes VAT after the header discount, pro-rata by gross (desktop InvoiceCalc rule)', () => {
    const result = calculateInvoiceTotals({
      invoiceDiscount: '30',
      lines: [
        { quantity: '1', unitPrice: '200', discountRate: '0', discountAmount: '0', taxRate: '15' },
        { quantity: '1', unitPrice: '100', discountRate: '0', discountAmount: '0', taxRate: '15' },
      ],
    });
    // Gross 300, discount 30 -> shares 20 + 10; VAT follows the discounted bases.
    expect(result.lines[0]?.headerDiscountShare).toBe('20');
    expect(result.lines[1]?.headerDiscountShare).toBe('10');
    expect(result.subtotal).toBe('270');
    expect(result.tax).toBe('40.5');
    expect(result.total).toBe('310.5');
  });

  it('keeps per-line rates when the discount spans mixed VAT rates', () => {
    const result = calculateInvoiceTotals({
      invoiceDiscount: '20',
      lines: [
        { quantity: '1', unitPrice: '100', discountRate: '0', discountAmount: '0', taxRate: '15' },
        { quantity: '1', unitPrice: '100', discountRate: '0', discountAmount: '0', taxRate: '0' },
      ],
    });
    expect(result.lines[0]?.tax).toBe('13.5');
    expect(result.lines[1]?.tax).toBe('0');
    expect(result.total).toBe('193.5');
  });

  it('distributes the discount from the VAT-inclusive base on inclusive prices', () => {
    const result = calculateInvoiceTotals({
      priceIncludesVat: true,
      invoiceDiscount: '23',
      lines: [{ quantity: '1', unitPrice: '230', discountRate: '0', discountAmount: '0', taxRate: '15' }],
    });
    expect(result.subtotal).toBe('180');
    expect(result.tax).toBe('27');
    expect(result.total).toBe('207');
  });

  it('reconciles header totals with the lines so ZATCA buckets match', () => {
    const result = calculateInvoiceTotals({
      invoiceDiscount: '7',
      lines: [
        { quantity: '2', unitPrice: '50', discountRate: '10', discountAmount: '0', taxRate: '15' },
        { quantity: '1', unitPrice: '30', discountRate: '0', discountAmount: '0', taxRate: '15' },
      ],
    });
    const lineNet = result.lines.reduce((sum, line) => sum + Number(line.net), 0);
    const lineTax = result.lines.reduce((sum, line) => sum + Number(line.tax), 0);
    expect(lineNet).toBeCloseTo(Number(result.subtotal), 4);
    expect(lineTax).toBeCloseTo(Number(result.tax), 4);
    expect(Number(result.total)).toBeCloseTo(lineNet + lineTax, 4);
  });

  it('rounds half up at the configured precision', () => {
    const result = calculateInvoiceTotals({ scale: 2, lines: [{ quantity: '1', unitPrice: '1.005', discountRate: '0', discountAmount: '0', taxRate: '0' }] });
    expect(result.subtotal).toBe('1.01');
  });

  it('ACC-114: includes excise tax (extraTax) in the VAT taxable base under KSA VAT regulations', () => {
    // 1 x 20 + excise tax 1.00 + 15% VAT => VAT is 15% on (20 + 1) = 3.15, total = 24.15
    const result = calculateInvoiceTotals({
      extraTax: '1',
      lines: [{ quantity: '1', unitPrice: '20', discountRate: '0', discountAmount: '0', taxRate: '15' }],
    });
    expect(result.subtotal).toBe('20');
    expect(result.extraTax).toBe('1');
    expect(result.tax).toBe('3.15');
    expect(result.total).toBe('24.15');
  });
});
