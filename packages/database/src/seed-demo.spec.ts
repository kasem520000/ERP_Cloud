import { describe, expect, it } from 'vitest';

import { DEMO_CHART_OF_ACCOUNTS, DEMO_PLANS, DEMO_POSTING_PROFILE, DEMO_TAX_GROUPS } from './seed-demo.js';

/**
 * The demo seed inserts the chart of accounts in a single pass and derives each account's
 * ltree path from the parent it has already inserted. That only works while the list obeys
 * the invariants below, and a broken invariant surfaces as a confusing runtime failure in
 * the middle of `pnpm db:seed` — so they are asserted here instead.
 */
describe('DEMO_CHART_OF_ACCOUNTS', () => {
  it('has unique codes', () => {
    const codes = DEMO_CHART_OF_ACCOUNTS.map((account) => account.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('declares every parent before its children', () => {
    const seen = new Set<string>();
    for (const account of DEMO_CHART_OF_ACCOUNTS) {
      if (account.parent) expect(seen, `parent of ${account.code}`).toContain(account.parent);
      seen.add(account.code);
    }
  });

  it('gives every child the type of its parent', () => {
    const typeByCode = new Map(DEMO_CHART_OF_ACCOUNTS.map((account) => [account.code, account.type]));
    for (const account of DEMO_CHART_OF_ACCOUNTS) {
      if (!account.parent) continue;
      // Documented exception: the desktop hangs equity (21) under the liabilities root (2).
      if (account.code === '21') continue;
      expect(account.type, `type of ${account.code}`).toBe(typeByCode.get(account.parent));
    }
  });

  it('nests every account under the class its code starts with', () => {
    for (const account of DEMO_CHART_OF_ACCOUNTS) {
      if (!account.parent) continue;
      expect(account.code.startsWith(account.parent), `${account.code} under ${account.parent}`).toBe(true);
    }
  });

  it('marks parents as non-postable so a posting can never hit a header account', () => {
    const parents = new Set(
      DEMO_CHART_OF_ACCOUNTS.map((account) => account.parent).filter((code): code is string => Boolean(code)),
    );
    for (const account of DEMO_CHART_OF_ACCOUNTS) {
      if (parents.has(account.code)) expect(account.postable, `${account.code}`).toBe(false);
    }
  });

  it('opens the five classes and only uses contra accounts deliberately', () => {
    const roots = DEMO_CHART_OF_ACCOUNTS.filter((account) => !account.parent).map((account) => account.code);
    expect(roots).toEqual(['1', '2', '3', '4']);

    // A contra account is the only reason to override the natural side of its class.
    const naturalSide = (type: string) => (type === 'asset' || type === 'expense' ? 'debit' : 'credit');
    const overridden = DEMO_CHART_OF_ACCOUNTS.filter(
      (account) => account.normalBalance && account.normalBalance !== naturalSide(account.type),
    ).map((account) => account.code);
    expect(overridden).toEqual(['3200002', '3200003', '4100002', '4100003']);
  });

  it('contains the accounts the opening entry and the cash locations depend on', () => {
    const codes = new Set(DEMO_CHART_OF_ACCOUNTS.map((account) => account.code));
    for (const code of ['1211001', '1221001', '1160001', '2110001', '3200004']) expect(codes).toContain(code);
  });
});

describe('DEMO_POSTING_PROFILE', () => {
  it('maps every account to a code that exists and is postable', () => {
    const byCode = new Map(DEMO_CHART_OF_ACCOUNTS.map((account) => [account.code, account]));
    for (const [key, code] of Object.entries(DEMO_POSTING_PROFILE)) {
      const account = byCode.get(code);
      expect(account, `${key} -> ${code}`).toBeDefined();
      expect(account?.postable ?? true, `${key} -> ${code} postable`).not.toBe(false);
    }
  });

  it('covers the mappings sales, purchases and treasury postings need', () => {
    for (const key of [
      'salesAccountId',
      'purchasesAccountId',
      'vatOutputAccountId',
      'vatInputAccountId',
      'inventoryAccountId',
      'cogsAccountId',
      'receivableAccountId',
      'payableAccountId',
    ]) {
      expect(Object.keys(DEMO_POSTING_PROFILE)).toContain(key);
    }
  });
});

describe('DEMO_PLANS', () => {
  it('has unique codes and a well-formed amount', () => {
    expect(new Set(DEMO_PLANS.map((plan) => plan.code)).size).toBe(DEMO_PLANS.length);
    for (const plan of DEMO_PLANS) {
      expect(plan.amount).toMatch(/^\d+\.\d{2}$/);
      expect(['month', 'year']).toContain(plan.interval);
      expect(plan.currency).toHaveLength(3);
    }
  });
});

/**
 * نسبةُ الضريبة في البذرة — ومحورُها «مئوية» لا «كسر».
 *
 * العيبُ الذي يُقفل هنا قِيس على منشأة العرض (‏2026-10-17): البذرةُ كتبت `0.1500` بتعليقٍ
 * يقول «كسر»، والمحرّك يحسب `subtotal × rate / 100`، فخرجت فاتورةُ ٦٠٠٫٠٠ بضريبة **٠٫٩٠**
 * (‏٠٫١٥٪) وإجمالي ٦٠٠٫٩٠ بدل ٦٩٠٫٠٠. والنسبةُ تُقفل بعد أوّل استعمال
 * (‏`TAX_GROUP_RATE_LOCKED`)، فالخطأ في البذرة يصير خطأً دائمًا في المنشأة.
 */
describe('DEMO_TAX_GROUPS', () => {
  /** الرقمُ في الاسم هو العقد: «ضريبة القيمة المضافة 15%» ⇒ ‏`rate` = ١٥ (مئوية). */
  const percentInLabel = (group: { nameAr?: string; nameEn?: string }): number | null => {
    const label = `${group.nameAr ?? ''} ${group.nameEn ?? ''}`;
    const said = label.match(/(\d+(?:[.٫]\d+)?)\s*%/);
    return said ? Number(said[1].replace('٫', '.')) : null;
  };

  it('يكتب النسبةَ التي يقولها الاسم — والاسمُ يقول ١٥٪ لا ٠٫١٥٪', () => {
    for (const group of DEMO_TAX_GROUPS) {
      const percent = Number(group.rate);
      const said = percentInLabel(group);
      if (said === null) {
        expect(percent, `«${group.nameAr}» بلا نسبةٍ في الاسم فلا نسبةَ في الرقم`).toBe(0);
      } else {
        expect(percent, `الاسمُ يقول ${said}% والرقمُ المكتوب ${group.rate}`).toBe(said);
      }
      expect(percent, 'نسبةٌ مئوية محصورة — فالكسرُ (٠٫١٥) يعني ٠٫١٥٪ عند المحرّك').toBeLessThanOrEqual(100);
    }
  });

  it('فاتورةُ ٦٠٠ تخرج بضريبة ٩٠ لا ٠٫٩٠ (صيغةُ المحرّك نفسها: rate/100)', () => {
    const vat = DEMO_TAX_GROUPS.find((group) => (group.nameAr ?? '').includes('القيمة المضافة'));
    expect(vat, 'مجموعةُ ضريبة القيمة المضافة في البذرة').toBeDefined();
    expect(vat?.rate).toBe('15.0000');
    // ‏`van-sales.service.ts:4627` — ‏`subtotal.mul(taxRate.div(100))`.
    const vatOnSixHundred = (600 * Number(vat?.rate)) / 100;
    expect(vatOnSixHundred).toBe(90);
    expect(vatOnSixHundred, 'ولو عاد الكسرُ لكان الناتج ٠٫٩٠').not.toBe(0.9);
  });

  it('المجموعةُ الصفرية صفرٌ — فلا ضريبةَ على الضريبة الصفرية', () => {
    const zero = DEMO_TAX_GROUPS.find(
      (group) => (group.nameAr ?? '').includes('صفرية') || (group.nameAr ?? '').includes('معفاة'),
    );
    expect(zero?.rate).toBe('0.0000');
    expect(zero?.vatAccountCode, 'والضريبة الصفرية بلا حساب ضريبة مفروض').toBeUndefined();
  });
});
