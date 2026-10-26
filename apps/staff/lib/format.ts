import { Decimal } from 'decimal.js';

/**
 * One number script across the product.
 *
 * Half the accounting screens formatted money with `ar-SA`, which renders Arabic-Indic
 * digits (٢٦٠٫٠٠), while every other screen (dashboard, invoices, tables, print) used Latin
 * digits (`money()` / `en-US`). Two scripts in one ledger is a reading error waiting to
 * happen. Latin digits stay the single convention; the surrounding text is still Arabic.
 */
export function moneyText(valueText: string, currency = 'SAR', locale = 'ar-SA-u-nu-latn'): string {
  const fixed = new Decimal(valueText || '0').toFixed(2);
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(Number(fixed));
}

export function qtyText(valueText: string): string { return new Decimal(valueText || '0').toFixed(4); }
export function persistColumns(key: string, columns: string[]): void { if (typeof localStorage !== 'undefined') localStorage.setItem(`erp:columns:${key}`, JSON.stringify(columns)); }
export function readColumns(key: string, fallback: string[]): string[] { if (typeof localStorage === 'undefined') return fallback; try { return JSON.parse(localStorage.getItem(`erp:columns:${key}`) ?? 'null') as string[] ?? fallback; } catch { return fallback; } }

export const MAKKAH_TIMEZONE = 'Asia/Riyadh';

/**
 * تاريخ للقراءة في جدول بتوقيت مكة المكرمة (`Asia/Riyadh`) بلا انقلاب اتجاهي.
 *
 * `toLocaleDateString('ar-SA…')` يُخرج «١٨‏/١٠‏/٢٠٢٧» بقواطع اتجاهية، فتظهر في
 * خلية RTL مقلوبة («182027/10/»). والعزل (U+2066…U+2069) يجعل الرقم والصيغة
 * وحدةً واحدة تُقرأ كما هي، بلا وسوم في JSX كل خلية.
 */
export function dateText(value: string | Date | null | undefined): string {
  if (!value) return '—';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return `\u2066${value.trim()}\u2069`;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: MAKKAH_TIMEZONE }).format(date);
  return `\u2066${iso}\u2069`;
}
