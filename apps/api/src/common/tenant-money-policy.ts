import { sql } from 'drizzle-orm';
import type { DrizzleTx } from '@erp/database';

/**
 * ACC-107 / ACC-108 (R33 — P-M17): the tenant's money & tax policy as the document services read it.
 *
 * `/settings/general` has always displayed, validated and audited these keys, but no posting path
 * ever consulted them (ACC-107 «إعدادات ميتة»). They now govern:
 *
 *  - `money.rounding_digits`      → `roundingScale` of `calculateInvoiceTotals` (default 2 = halalas).
 *  - `pricing.price_includes_vat` → default of `priceIncludesVat` when the document does not say.
 *  - `vat.default_rate_percent`   → tax rate of a line that names no `taxRate` and whose item carries
 *                                   no tax group (default 15).
 *  - `invoice.number_prefix` / `invoice.padding` → seed of the tenant-wide `sale` sequence the first
 *                                   time it is allocated (the «الترقيم» admin remains authoritative
 *                                   afterwards, see `SequencesService.configure`).
 *
 * Missing or malformed values fall back to the documented defaults, never to «no policy».
 */
export type TenantMoneyPolicy = {
  roundingDigits: number;
  priceIncludesVat: boolean | null;
  defaultVatRate: string;
  invoicePrefix: string | null;
  invoicePadding: number | null;
};

export const DEFAULT_MONEY_POLICY: TenantMoneyPolicy = {
  roundingDigits: 2,
  priceIncludesVat: null,
  defaultVatRate: '15',
  invoicePrefix: null,
  invoicePadding: null,
};

const KEYS = [
  'money.rounding_digits',
  'pricing.price_includes_vat',
  'vat.default_rate_percent',
  'invoice.number_prefix',
  'invoice.padding',
];

function asBoolean(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
}

function asInt(value: unknown, min: number, max: number): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

function asRate(value: unknown): string | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return String(n);
}

export async function readTenantMoneyPolicy(tx: DrizzleTx, tenantId: string): Promise<TenantMoneyPolicy> {
  const result = (await tx.execute(sql`
    SELECT key, value FROM tenant_settings
    WHERE tenant_id = ${tenantId}::uuid AND key IN (${sql.join(
      KEYS.map((key) => sql`${key}`),
      sql`, `,
    )})
  `)) as unknown;
  const rows: Array<{ key: string; value: unknown }> = Array.isArray(result)
    ? (result as Array<{ key: string; value: unknown }>)
    : (((result as { rows?: Array<{ key: string; value: unknown }> }).rows ?? []) as Array<{ key: string; value: unknown }>);
  const map = new Map(rows.map((row) => [row.key, row.value]));
  const prefix = map.get('invoice.number_prefix');
  return {
    roundingDigits: asInt(map.get('money.rounding_digits'), 0, 6) ?? DEFAULT_MONEY_POLICY.roundingDigits,
    priceIncludesVat: asBoolean(map.get('pricing.price_includes_vat')),
    defaultVatRate: asRate(map.get('vat.default_rate_percent')) ?? DEFAULT_MONEY_POLICY.defaultVatRate,
    invoicePrefix: typeof prefix === 'string' && prefix.trim() ? prefix.trim().slice(0, 12) : null,
    invoicePadding: asInt(map.get('invoice.padding'), 1, 18),
  };
}
