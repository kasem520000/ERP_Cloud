/**
 * MF-21 — رياضيات الإهلاك الخالصة (بلا قاعدة بيانات ولا HTTP): طرق
 * الإهلاك الثلاثة المتعارف عليها، كلها تُقصر المبلغ على **الباقي القابل
 * للإهلاك** (التكلفة − القيمة المتبقية − المُهلك سابقاً) فلا يتجاوز أي
 * تشغيل الأساس أبداً — القسط الأخير يصل حتماً إلى الباقي لا أكثر.
 *
 * الوحدات تُدخل بالـstrings (نفس دقة numeric(20,4) في القاعدة) وتُخرج عدداً
 * مدوَّراً إلى4 أرقام عشرية.
 */
export type DepreciationMethod = 'straight_line' | 'declining' | 'units_of_production';

export type DepreciationInput = {
  method: DepreciationMethod;
  cost: string;
  residualValue?: string | null;
  usefulLifeMonths: number;
  accumulated: string;
  /** متناقص: نسبة سنوية % (شهرياً = rate/12 من القيمة الدفترية). */
  decliningRatePercent?: string | null;
  /** وحدات الإنتاج: إجمالي الوحدات المتوقعة للعمر كله. */
  totalUnits?: string | null;
  /** وحدات الإنتاج: وحدات الفترة الجاري (إلزامية لطريق الوحدات). */
  periodUnits?: string | null;
};

const R4 = (value: number): number => Math.round(value * 10000) / 10000;

export function computeDepreciation(input: DepreciationInput): number {
  const cost = Number(input.cost);
  const residual = Number(input.residualValue ?? 0);
  const accumulated = Number(input.accumulated);
  const base = cost - residual;
  const remaining = base - accumulated;
  if (!(base > 0) || !(remaining > 0.005)) return 0;

  if (input.method === 'straight_line') {
    const life = Number(input.usefulLifeMonths);
    const monthly = life > 0 ? base / life : remaining;
    return R4(Math.min(monthly, remaining));
  }

  if (input.method === 'declining') {
    const rate = Number(input.decliningRatePercent ?? 0) / 100 / 12;
    if (!(rate > 0)) return 0;
    const bookValue = cost - accumulated;
    if (!(bookValue > 0)) return 0;
    return R4(Math.min(bookValue * rate, remaining));
  }

  if (input.method === 'units_of_production') {
    const totalUnits = Number(input.totalUnits ?? 0);
    if (!(totalUnits > 0)) {
      throw new Error('units_of_production requires totalUnits > 0');
    }
    if (input.periodUnits === undefined || input.periodUnits === null || input.periodUnits === '') {
      throw new Error('units_of_production requires periodUnits');
    }
    const periodUnits = Number(input.periodUnits);
    if (!(periodUnits >= 0)) return 0;
    return R4(Math.min((base * periodUnits) / totalUnits, remaining));
  }

  throw new Error(`unknown depreciation method: ${String(input.method)}`);
}
