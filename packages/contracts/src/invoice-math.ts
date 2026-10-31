import { z } from 'zod';


const decimalString = z.string().regex(/^-?\d+(?:\.\d+)?$/);

export const invoiceLineInputSchema = z.object({
  quantity: decimalString,
  unitPrice: decimalString,
  discountRate: decimalString.default('0'),
  discountAmount: decimalString.default('0'),
  taxRate: decimalString.default('0'),
});

export type InvoiceLineInput = z.input<typeof invoiceLineInputSchema>;
export type InvoiceLineTotal = {
  gross: string;
  discount: string;
  net: string;
  tax: string;
  total: string;
  /**
   * The line's share of the header (document) discount, distributed pro-rata by
   * gross value — the desktop `InvoiceCalc`/`BindToEntry` rule
   * (`price × qty × TotDiscount / SumPrice`). It is already subtracted from `net`
   * (and its VAT from `tax`), so header totals reconcile with the lines — which is
   * what ZATCA validates. Zero when the invoice carries no header discount.
   */
  headerDiscountShare: string;
};

export type InvoiceTotalsInput = {
  lines: InvoiceLineInput[];
  priceIncludesVat?: boolean;
  invoiceDiscount?: string;
  extraTax?: string;
  withholding?: string;
  scale?: number;
  /**
   * ACC-108 (R33 — P-M17): the currency's minor-unit scale (`money.rounding_digits`, default 2).
   * Every money figure that leaves this function — line net / tax / total, header tax, extra tax,
   * withholding and total — is rounded HALF_UP to this scale, so the ledger, the receivable and
   * the cash collected never carry fractions of a halala. `scale` (default 4) remains the working
   * precision for quantities × prices and for pro-rata shares; pass `roundingScale: scale` to
   * keep the legacy unrounded behaviour.
   */
  roundingScale?: number;
};

export type InvoiceTotals = {
  lines: InvoiceLineTotal[];
  subtotal: string;
  discount: string;
  taxable: string;
  tax: string;
  extraTax: string;
  withholding: string;
  total: string;
};

type Int = bigint;
const ten = (scale: number): Int => 10n ** BigInt(scale);

function parse(value: string | number, scale: number): Int {
  const normalized = typeof value === 'number' ? value.toString() : String(value ?? '0').trim();
  const [wholePart = '0', fraction = ''] = normalized.replace(/^\+/, '').split('.');
  const negative = wholePart.startsWith('-');
  const wholeValue = BigInt(negative ? wholePart.slice(1) || '0' : wholePart || '0');
  const kept = fraction.padEnd(scale, '0').slice(0, scale);
  const base = wholeValue * ten(scale) + BigInt(kept || '0');
  const rounded = fraction.length > scale && Number(fraction[scale]) >= 5 ? base + 1n : base;
  return negative ? -rounded : rounded;
}

function format(value: Int, scale: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const raw = absolute.toString().padStart(scale + 1, '0');
  if (scale === 0) return `${negative ? '-' : ''}${raw}`;
  const fraction = raw.slice(-scale).replace(/0+$/, '');
  const whole = raw.slice(0, raw.length - scale);
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function divRound(numerator: Int, denominator: Int): Int {
  if (denominator === 0n) throw new Error('Cannot divide by zero');
  const sign = numerator < 0n === denominator < 0n ? 1n : -1n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  return sign * ((n + d / 2n) / d);
}

/** HALF_UP rounding of a scaled integer to `drop` fewer fractional digits (ACC-108). */
function roundInt(value: Int, drop: number): Int {
  if (drop <= 0) return value;
  const unit = 10n ** BigInt(drop);
  const quotient = value / unit;
  const remainder = value % unit;
  const half = unit / 2n;
  if (remainder >= half) return (quotient + 1n) * unit;
  if (remainder <= -half) return (quotient - 1n) * unit;
  return quotient * unit;
}

export function calculateInvoiceTotals(input: InvoiceTotalsInput): InvoiceTotals {
  const scale = input.scale ?? 4;
  const unit = ten(scale);
  const roundingScale = Math.min(scale, Math.max(0, input.roundingScale ?? 2));
  const money = (value: Int) => roundInt(value, scale - roundingScale);
  // 💲 تنسيق المخرجات بعدد المنازل المحفوظ في إعدادات المنشأة (الم默لي 2)، وليس الدقة الداخلية (4).
  const displayUnit = ten(scale - roundingScale);
  const display = (value: Int) => format(roundInt(value, scale - roundingScale) / displayUnit, roundingScale);
  const prepared = input.lines.map((line) => {
    const quantity = parse(line.quantity, scale);
    const unitPrice = parse(line.unitPrice, scale);
    const gross = divRound(quantity * unitPrice, unit);
    const rate = parse(line.discountRate ?? '0', scale);
    const rateDiscount = divRound(gross * rate, 100n * unit);
    const discount = rateDiscount + parse(line.discountAmount ?? '0', scale);
    const net = gross - discount;
    const taxRate = parse(line.taxRate ?? '0', scale);
    return { gross, discount, net, taxRate };
  });

  // The header discount is distributed across the lines pro-rata by gross value
  // (desktop rule) so every line's net and VAT already reflect it. A discount that
  // only shrank the header while the lines kept their VAT would overstate the tax
  // and fail ZATCA reconciliation (header taxable must equal the sum of line nets).
  const headerDiscount = parse(input.invoiceDiscount ?? '0', scale);
  const shares = new Array<Int>(prepared.length).fill(0n);
  if (headerDiscount !== 0n && prepared.length > 0) {
    const totalGross = prepared.reduce((sum, line) => sum + (line.gross > 0n ? line.gross : 0n), 0n);
    if (totalGross > 0n) {
      for (let index = 0; index < prepared.length; index += 1) {
        const base = prepared[index]!.gross > 0n ? prepared[index]!.gross : 0n;
        shares[index] = divRound(headerDiscount * base, totalGross);
      }
      const distributed = shares.reduce((sum, share) => sum + share, 0n);
      const remainder = headerDiscount - distributed;
      if (remainder !== 0n) {
        let target = 0;
        for (let index = 1; index < prepared.length; index += 1) {
          if (prepared[index]!.gross > prepared[target]!.gross) target = index;
        }
        shares[target] = (shares[target] ?? 0n) + remainder;
      }
    }
  }

  // ACC-114: Under KSA VAT regulations, excise tax (extraTax) is part of the taxable base for VAT.
  // Distribute excise tax across lines pro-rata by gross to augment the VAT taxable base.
  const extraTaxTotal = parse(input.extraTax ?? '0', scale);
  const extraShares = new Array<Int>(prepared.length).fill(0n);
  if (extraTaxTotal !== 0n && prepared.length > 0) {
    const totalGross = prepared.reduce((sum, line) => sum + (line.gross > 0n ? line.gross : 0n), 0n);
    if (totalGross > 0n) {
      for (let index = 0; index < prepared.length; index += 1) {
        const base = prepared[index]!.gross > 0n ? prepared[index]!.gross : 0n;
        extraShares[index] = divRound(extraTaxTotal * base, totalGross);
      }
      const distributed = extraShares.reduce((sum, share) => sum + share, 0n);
      const remainder = extraTaxTotal - distributed;
      if (remainder !== 0n) {
        let target = 0;
        for (let index = 1; index < prepared.length; index += 1) {
          if (prepared[index]!.gross > prepared[target]!.gross) target = index;
        }
        extraShares[target] = (extraShares[target] ?? 0n) + remainder;
      }
    }
  }

  const lines = prepared.map((line, index) => {
    const share = shares[index] ?? 0n;
    const extraShare = extraShares[index] ?? 0n;
    // The share reduces the VAT-inclusive base, exactly as the desktop subtracts the
    // header discount from the gross sum before extracting VAT.
    // ACC-108: the line's money figures are rounded to the currency's minor unit *before* the
    // VAT is derived from them, so net + tax = total holds exactly in halalas.
    const base = money(line.net - share);
    const extraShareMoney = money(extraShare);
    const vatBase = base + extraShareMoney;
    const tax = money(
      input.priceIncludesVat
        ? divRound(vatBase * line.taxRate, 100n * unit + line.taxRate)
        : divRound(vatBase * line.taxRate, 100n * unit),
    );
    const taxableNet = input.priceIncludesVat ? vatBase - tax : base;
    const total = input.priceIncludesVat ? base + extraShareMoney : base + tax + extraShareMoney;
    return { gross: display(line.gross), discount: display(line.discount), net: display(taxableNet), tax: display(tax), total: display(total), headerDiscountShare: display(share) };
  });
  const subtotal = lines.reduce((sum, line) => sum + parse(line.net, scale), 0n);
  const tax = lines.reduce((sum, line) => sum + parse(line.tax, scale), 0n);
  const extraTax = money(parse(input.extraTax ?? '0', scale));
  const withholding = money(parse(input.withholding ?? '0', scale));
  // Normally every fils of the discount is distributed (the remainder lands on the
  // largest line above). Only a zero-gross invoice leaves a share unallocated, and
  // dropping it silently would undercharge — so it still reduces the header total,
  // which the service then rejects as negative for sales documents.
  const unallocated = money(headerDiscount - shares.reduce((sum, share) => sum + share, 0n));
  const total = subtotal + tax + extraTax - withholding - unallocated;
  return { lines, subtotal: display(subtotal), discount: display(headerDiscount), taxable: display(subtotal), tax: display(tax), extraTax: display(extraTax), withholding: display(withholding), total: display(total) };
}

export type LandedCostLineInput = { lineId?: string; itemId?: string; quantity: string; net: string; unitCost?: string };
export type LandedCostInput = { lines: LandedCostLineInput[]; costs: Array<{ amount: string }>; method: 'qty' | 'value'; scale?: number };
export type LandedCostLineAllocation = {
  lineId?: string;
  itemId?: string;
  base: string;
  allocatedCost: string;
  net: string;
  landedTotal: string;
  effectiveUnitCost: string;
};
export type LandedCostAllocation = { method: 'qty' | 'value'; totalCost: string; lines: LandedCostLineAllocation[] };

/**
 * Allocates landed costs pro-rata by quantity or value, HALF_UP at the selected scale,
 * then assigns any rounding remainder to the line with the largest allocation base.
 */
export function allocateLandedCost(input: LandedCostInput): LandedCostAllocation {
  const scale = input.scale ?? 4;
  const totalCost = input.costs.reduce((sum, cost) => sum + parse(cost.amount, scale), 0n);
  const prepared = input.lines.map((line, index) => {
    const quantity = parse(line.quantity, scale);
    const net = parse(line.net, scale);
    const base = input.method === 'qty' ? quantity : net;
    return { line, index, quantity, net, base };
  });
  const totalBase = prepared.reduce((sum, line) => sum + line.base, 0n);
  if (prepared.length === 0 || totalCost < 0n || totalBase <= 0n) {
    throw new Error('Cannot allocate landed cost without positive lines, costs and allocation base');
  }

  const allocations = prepared.map((line) => divRound(totalCost * line.base, totalBase));
  const allocated = allocations.reduce((sum, value) => sum + value, 0n);
  const remainder = totalCost - allocated;
  if (remainder !== 0n) {
    let target = 0;
    for (let index = 1; index < prepared.length; index += 1) {
      if (prepared[index]!.base > prepared[target]!.base) target = index;
    }
    allocations[target] = (allocations[target] ?? 0n) + remainder;
  }

  return {
    method: input.method,
    totalCost: format(totalCost, scale),
    lines: prepared.map(({ line, quantity, net, base }, index) => {
      const allocatedCost = allocations[index] ?? 0n;
      const landedTotal = net + allocatedCost;
      const effectiveUnitCost = divRound(landedTotal * ten(scale), quantity);
      return {
        lineId: line.lineId,
        itemId: line.itemId,
        base: format(base, scale),
        allocatedCost: format(allocatedCost, scale),
        net: format(net, scale),
        landedTotal: format(landedTotal, scale),
        effectiveUnitCost: format(effectiveUnitCost, scale),
      };
    }),
  };
}

export const invoiceMath = { calculateInvoiceTotals, allocateLandedCost, invoiceLineInputSchema };
