import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import { todayIso } from '../src/common/server-date.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * خطة MISSING_FEATURES — دفقة D4، بطاقة MF-15 «محرك مطابقة أدق» (الجزء المُصرَّح:
 * المحرّك — تقرير التسوية الرسمية المؤجَّل بإذن المالك):
 *
 *   • رجوع ACC-044/045 على مستوى المسار (كانت الحرّاس في الكود بلا اختبار مسار):
 *     اتجاه خاطئ422 · مبلغ مختلف422 · سند مسودة422 · سند مستخدم بسطر آخر409.
 *   • **جديد**: `POST …/lines/:lineId/expense` — «سند رسوم/عمولة» من سطر غير مطابَق
 *     بحساب مُعيَّن (expense-type) يُنشأ ويُرحَّل ويُطابَق السطر به ذرّياً.
 *   • **جديد**: `POST …/approve` + `POST …/unapprove` — قفل الكشف بعد الاعتماد:
 *     بعد الاعتماد تُرفض كل عمليات الكتابة على أسطره بـ409 `BANK_STATEMENT_APPROVED`
 *     (مطابقة/تلقائي/تجاهل/فك/مصروف/حذف) والقراءة تبقى مفتوحة؛ «unapprove» يعيد
 *     الحالة المحسوبة من الأسطر ويحرّر القفل.
 *
 * معايير القبول من البطاقة: سند مسودة لا يظهر للمطابقة ✓ (رجوع)؛ استيراد مكرر مرفوض ✓
 * (phase4)؛ والقفل بعد الاعتماد ✓ (جديد).
 */
describe('R37 — bank matching guards, fee voucher from a line, statement approval lock (MF-15)', () => {
  let ctx: TestApp;
  let actor: Actor;
  let branchId = '';
  let bankGlAccountId = '';
  let bankCashLocationId = '';
  let bankAccountId = '';
  let expenseTypeId = '';
  let expenseAccountId = '';
  let statementId = '';
  let feeLineId = ''; // −50 رسوم (debit — money OUT)
  let depositLineId = ''; // +100 إيداع (credit — money IN)
  let otherCreditLineId = ''; // +75 سطر دائن ثالث (لاختبار سند المستخدم مرتين)

  const data = (body: Record<string, unknown>): Record<string, unknown> => (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const b = body as { data?: unknown; rows?: unknown };
    if (Array.isArray(b?.rows)) return b.rows as Array<Record<string, unknown>>;
    if (Array.isArray(b?.data)) return b.data as Array<Record<string, unknown>>;
    return [];
  };
  const req = (method: 'get' | 'post' | 'patch' | 'delete', path: string, body?: unknown) =>
    api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });

  const year = new Date().getUTCFullYear();
  const today = todayIso();

  /** سند بنكي مُرحَّل بمبلغ واتجاه — لبناء حالات المطابقة. */
  const makeVoucher = async (kind: 'receipt' | 'payment', amount: string): Promise<string> => {
    const created = await req('post', '/vouchers', {
      branchId,
      kind,
      subtype: kind === 'receipt' ? 'other' : 'expense',
      date: today,
      cashLocationId: bankCashLocationId,
      method: 'bank_transfer',
      amount,
      ...(kind === 'receipt' ? {} : { counterAccountId: expenseAccountId }),
    });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const id = String(data(created.body).id);
    const posted = await req('post', `/vouchers/${id}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
    return id;
  };

  beforeAll(async () => {
    ctx = await createTestApp('r37-bank-fee-approve');
    actor = await createActor(ctx, {
      tenantCode: 'r37-bank',
      email: 'owner@r37-bank.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'treasury.view',
        'treasury.bank.view',
        'treasury.bank.manage',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.expensetype.manage',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.reports.view',
        'accounting.period.view',
        'accounting.period.close',
        'reporting.view',
      ],
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    branchId = String(rows((await req('get', '/branches')).body)[0]?.id);
    const fy = await req('post', '/fiscal-years', { code: `FY${year}`, name: `FY ${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` });
    expect(fy.status, JSON.stringify(fy.body)).toBe(201);

    // حساب بنكي (رقابة) + موقع نقدي بنكي + حساب بنك الرسوم + نوع مصروف.
    const accounts = rows((await req('get', '/accounts')).body);
    let bankAcc = accounts.find((a) => a.code === '1221001');
    if (!bankAcc) {
      const createdBank = await req('post', '/accounts', { code: '1221001', nameAr: 'بنك R37', type: 'asset' });
      expect(createdBank.status, JSON.stringify(createdBank.body)).toBeLessThan(300);
      bankAcc = data(createdBank.body) as Record<string, unknown>;
    }
    bankGlAccountId = String(bankAcc.id);
    const feeAcc = accounts.find((a) => a.code === '3110001')
      ?? (await (async () => {
        const c = await req('post', '/accounts', { code: '3110001', nameAr: 'مصاريف بنكية R37', type: 'expense' });
        expect(c.status, JSON.stringify(c.body)).toBeLessThan(300);
        return data(c.body);
      })());
    expenseAccountId = String(feeAcc.id);

    const loc = await req('post', '/cash-locations', {
      branchId,
      kind: 'bank',
      name: 'بنك R37',
      accountId: bankGlAccountId,
      bank: { bankName: 'R37 Bank', iban: 'SA0380000000608010167519' },
    });
    expect(loc.status, JSON.stringify(loc.body)).toBe(201);
    bankCashLocationId = String(data(loc.body).id);

    const ba = await req('post', '/treasury/bank-accounts', {
      bankName: 'R37 Bank',
      accountNo: 'R37-ACC-1',
      currency: 'SAR',
      openingBalance: '5000.0000',
      accountId: bankGlAccountId,
    });
    expect(ba.status, JSON.stringify(ba.body)).toBeLessThan(300);
    bankAccountId = String(data(ba.body).id);

    const et = await req('post', '/expense-types', { nameAr: 'رسوم بنكية', accountId: String(feeAcc.id) });
    expect(et.status, JSON.stringify(et.body)).toBeLessThan(300);
    expenseTypeId = String(data(et.body).id);

    const csv = `التاريخ,البيان,المرجع,المدين,الدائن,الرصيد
${year}-03-05,رسوم حوالة صادرة,R37-FEE,50.00,,4950.00
${year}-03-06,إيداع نقدي,R37-DEP,,100.00,5050.00
${year}-03-07,إيداع آخر,R37-DEP2,,75.00,5125.00`;
    const imp = await req('post', '/treasury/bank-statements/import', { bankAccountId, csv, fileName: 'r37.csv' });
    expect([200, 201]).toContain(imp.status);
    const stmt = ((data(imp.body).statement as Record<string, unknown>) ?? data(imp.body)) as Record<string, unknown>;
    statementId = String(stmt.id);
    const lines = rows((await req('get', `/treasury/bank-statements/${statementId}/lines`)).body);
    expect(lines.length, JSON.stringify(lines)).toBe(3);
    feeLineId = String(lines.find((l) => Number(l.amount) < 0)?.id ?? '');
    depositLineId = String(lines.find((l) => Number(l.amount) === 100)?.id ?? '');
    otherCreditLineId = String(lines.find((l) => Number(l.amount) === 75)?.id ?? '');
    expect(feeLineId).not.toBe('');
    expect(depositLineId).not.toBe('');
    expect(otherCreditLineId).not.toBe('');
  }, 240_000);

  afterAll(async () => {
    await ctx?.app.close();
  });

  it('ACC-044/045 regression — manual match refuses drafts, wrong direction and wrong amounts', async () => {
    // مسودة (بلا ترحيل) ← ACC-045.
    const draft = await req('post', '/vouchers', {
      branchId,
      kind: 'payment',
      subtype: 'expense',
      date: today,
      cashLocationId: bankCashLocationId,
      method: 'bank_transfer',
      amount: '50.0000',
      counterAccountId: expenseAccountId,
    });
    expect(draft.status, JSON.stringify(draft.body)).toBeLessThan(300);
    const draftId = String(data(draft.body).id);
    expect(String(data(draft.body).status)).toBe('draft');
    const draftMatch = await req('post', `/treasury/bank-statements/${statementId}/match`, { lineId: feeLineId, voucherId: draftId });
    expect(draftMatch.status, JSON.stringify(draftMatch.body)).toBe(422);
    expect(JSON.stringify(draftMatch.body)).toContain('BANK_MATCH_TARGET_NOT_POSTED');

    // اتجاه خاطئ: سطر رسوم (مدين/خارج) بسند قبض ← ACC-044.
    const receiptId = await makeVoucher('receipt', '50.0000');
    const dirMatch = await req('post', `/treasury/bank-statements/${statementId}/match`, { lineId: feeLineId, voucherId: receiptId });
    expect(dirMatch.status, JSON.stringify(dirMatch.body)).toBe(422);
    expect(JSON.stringify(dirMatch.body)).toContain('BANK_MATCH_DIRECTION_MISMATCH');

    // مبلغ مختلف بلا اعتراف جزئي صريح ← ACC-044.
    const smallPayment = await makeVoucher('payment', '30.0000');
    const amtMatch = await req('post', `/treasury/bank-statements/${statementId}/match`, { lineId: feeLineId, voucherId: smallPayment });
    expect(amtMatch.status, JSON.stringify(amtMatch.body)).toBe(422);
    expect(JSON.stringify(amtMatch.body)).toContain('BANK_MATCH_AMOUNT_MISMATCH');

    // سند واحد لسطر واحد: مطابقة جزئية صريحة للقبض على سطر دائن، ثم إعادة استخدام نفس
    // السند على الدائن الآخر (بنفس الاتجاه) ← 409.
    const partial = await req('post', `/treasury/bank-statements/${statementId}/match`, {
      lineId: depositLineId,
      voucherId: receiptId,
      partial: true,
    });
    expect(partial.status, JSON.stringify(partial.body)).toBeLessThan(300);
    const reuse = await req('post', `/treasury/bank-statements/${statementId}/match`, {
      lineId: otherCreditLineId,
      voucherId: receiptId,
    });
    expect(reuse.status, JSON.stringify(reuse.body)).toBe(409);
    expect(JSON.stringify(reuse.body)).toContain('BANK_MATCH_TARGET_ALREADY_MATCHED');
    // نُفكّ ليبقى السطر الرسومي حراً لاختبار سند الرسوم.
    const un = await req('delete', `/treasury/bank-statements/${statementId}/lines/${depositLineId}/match`);
    expect(un.status, JSON.stringify(un.body)).toBeLessThan(300);
  }, 180_000);

  it('MF-15 new — a fee expense from an unmatched line posts a voucher and matches the line atomically', async () => {
    const fee = await req('post', `/treasury/bank-statements/${statementId}/lines/${feeLineId}/expense`, {
      expenseTypeId,
      description: 'رسوم حوالة R37',
    });
    const linesBefore = rows((await req('get', `/treasury/bank-statements/${statementId}/lines`)).body);
    expect(fee.status, JSON.stringify({ fee: fee.body, linesBefore })).toBeLessThan(300);
    const feeData = data(fee.body) as { voucher?: Record<string, unknown>; line?: Record<string, unknown> };
    const voucher = feeData.voucher ?? feeData;
    expect(String(voucher.status)).toBe('posted');
    expect(Number(voucher.amount)).toBe(50);
    expect(String(voucher.counterAccountId ?? '')).not.toBe('');
    // السطر صار matched بالسند نفسه وبثقة كاملة.
    const lines = rows((await req('get', `/treasury/bank-statements/${statementId}/lines`)).body);
    const feeLine = lines.find((l) => l.id === feeLineId) as Record<string, unknown>;
    expect(String(feeLine.status)).toBe('matched');
    expect(String(feeLine.matchedVoucherId)).toBe(String(voucher.id));
    expect(Number(feeLine.matchConfidence)).toBeGreaterThanOrEqual(0.99);

    // سطر إيداع (دائن — وارد) مرفوض للرسوم (الرسوم تخرج).
    const wrong = await req('post', `/treasury/bank-statements/${statementId}/lines/${depositLineId}/expense`, { expenseTypeId });
    expect(wrong.status, JSON.stringify(wrong.body)).toBe(422);

    // السطر المطابَق لا يُعاد استخدامه.
    const again = await req('post', `/treasury/bank-statements/${statementId}/lines/${feeLineId}/expense`, { expenseTypeId });
    expect(again.status, JSON.stringify(again.body)).toBe(409);
  }, 180_000);

  it('MF-15 new — approve locks every write on the statement and unapprove reopens it', async () => {
    const approved = await req('post', `/treasury/bank-statements/${statementId}/approve`, { note: 'اعتماد R37' });
    expect(approved.status, JSON.stringify(approved.body)).toBeLessThan(300);
    expect(String(data(approved.body).status)).toBe('approved');

    const double = await req('post', `/treasury/bank-statements/${statementId}/approve`, {});
    expect(double.status, JSON.stringify(double.body)).toBe(409);

    const guard = async (label: string, p: Promise<{ status: number; body: unknown }>) => {
      const r = await p;
      expect(r.status, `${label} → ${JSON.stringify(r.body)}`).toBe(409);
      expect(JSON.stringify(r.body)).toContain('BANK_STATEMENT_APPROVED');
    };
    // أول فحص في المسار هو القفل: حتى بجسم ناقص يجب409 لا422/404.
    await guard('match', req('post', `/treasury/bank-statements/${statementId}/match`, { lineId: depositLineId }));
    await guard('auto-match', req('post', `/treasury/bank-statements/${statementId}/auto-match`, {}));
    await guard('ignore', req('post', `/treasury/bank-statements/${statementId}/lines/${depositLineId}/ignore`, {}));
    await guard('unmatch', req('delete', `/treasury/bank-statements/${statementId}/lines/${feeLineId}/match`));
    await guard('fee', req('post', `/treasury/bank-statements/${statementId}/lines/${depositLineId}/expense`, { expenseTypeId }));
    await guard('delete', req('delete', `/treasury/bank-statements/${statementId}`));

    // القراءة تبقى مفتوحة.
    const view = await req('get', `/treasury/bank-statements/${statementId}/lines`);
    expect(view.status).toBe(200);
    const recon = await req('get', `/treasury/bank-reconciliation?bank_account_id=${bankAccountId}`);
    expect(recon.status).toBe(200);

    // فك الاعتماد يعيد الحالة المحسوبة ويحرّر العمليات.
    const unlocked = await req('post', `/treasury/bank-statements/${statementId}/unapprove`, {});
    expect(unlocked.status, JSON.stringify(unlocked.body)).toBeLessThan(300);
    expect(String(data(unlocked.body).status)).not.toBe('approved');
    const after = await req('post', `/treasury/bank-statements/${statementId}/auto-match`, {});
    expect(after.status, JSON.stringify(after.body)).toBeLessThan(300);
  }, 180_000);
});
