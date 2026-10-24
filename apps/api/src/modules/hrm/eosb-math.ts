import { Decimal } from 'decimal.js';

/**
 * MF-17→MF-42 / D10 — رياضيات مخصص نهاية الخدمة (EOSB) في صميم نقَّاء.
 *
 * السياسة (§6.8 مُفكّ — قرار مالك «سياسة المخصصات»): نصف شهر عن كل سنة في السنوات الخمس
 * الأولى وشهر كامل بعدها — والمعدَّلان قابلان للتهيئة في `eosb_policies` (لا رقم محفور).
 * الصيغة تُشتق من آخر يوم الفترة لا من «سنوات مكتملة» ⇐ تراكم شهري سلس بلا قفزات سنوية.
 */
export type EosbRates = { monthsPerYearFirst: string; monthsPerYearAfter: string };

export const DEFAULT_EOSB_RATES: EosbRates = { monthsPerYearFirst: '0.5', monthsPerYearAfter: '1' };

/** سنوات الخدمة حتى `periodEnd` — متصلة (365.25) بأربع خانات؛ بلا تعيين/بلا فائدة ⇐ '0'. */
export function serviceYearsAt(hireDate: string | null | undefined, periodEnd: string): string {
  if (!hireDate) return '0.0000';
  const hire = Date.parse(`${hireDate}T00:00:00Z`);
  const end = Date.parse(`${periodEnd}T00:00:00Z`);
  if (!Number.isFinite(hire) || !Number.isFinite(end) || end <= hire) return '0.0000';
  return new Decimal(end - hire)
    .div(86_400_000)
    .div('365.25')
    .toDecimalPlaces(4)
    .toFixed(4);
}

/** الأشهر المستحقة: min(س,5)×Rate الأولى + max(س−5,0)×Rate بعدها. */
export function entitlementMonths(years: string, rates: EosbRates = DEFAULT_EOSB_RATES): string {
  const y = new Decimal(years);
  const first = Decimal.min(y, 5);
  const after = Decimal.max(0, y.minus(5));
  return first
    .times(rates.monthsPerYearFirst)
    .plus(after.times(rates.monthsPerYearAfter))
    .toDecimalPlaces(4)
    .toFixed(4);
}

/** التراكمي المستحق حتى الفترة = الأساس الشهري (Σ مكوّنات) × الأشهر. */
export function cumulativeEntitlement(basis: string, months: string): string {
  return new Decimal(basis).times(months).toDecimalPlaces(4).toFixed(4);
}

/**
 * Δ الفترة = التراكمي − المُرحَّل سابقاً (signed، 4 خانات).
 * موجب ⇐ استحقاق جديد (Dr مصروف/Cr مخصص) · سالب ⇐ تراجع الأساس (قيد معكوس).
 */
export function periodDelta(cumulative: string, priorAccrued: string): string {
  return new Decimal(cumulative).minus(priorAccrued).toDecimalPlaces(4).toFixed(4);
}
