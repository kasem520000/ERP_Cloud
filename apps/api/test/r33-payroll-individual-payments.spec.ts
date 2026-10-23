import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * R33 — the payroll run and the individual إذن صرف راتب must not overwrite each other.
 *
 *   • ACC-182 «تقرير الرواتب» answered 500 on every call (`UNION types date and text`).
 *   • ACC-183 an individual إذن flagged *every* run line of the employee as `paid` — reversed runs,
 *     drafts, other months — so a voided payroll re-appeared as salaries paid and a later run
 *     skipped the employee.
 *   • ACC-184 a hire who joined after the month's payroll was paid could not be paid at all:
 *     409 `SALARY_PAYMENT_ALREADY_PAID` on a run he was never in.
 *   • ACC-185 reversing a run voided and soft-deleted every individual إذن of the same month,
 *     including ones with no link to the run — cash that had left the safe vanished from the books.
 */
describe('R33 — payroll run × individual salary payment (ACC-182..185)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branchId = '';
  let cashLocationId = '';
  let employeeAId = '';
  let employeeAName = '';
  let hireId = '';
  let hireName = '';
  let hirePaymentId = '';
  let hirePaymentNumber = '';
  let earlierRunId = '';
  let paidRunId = '';

  const year = new Date().getUTCFullYear();
  const M1 = `${year}-08`;
  const M2 = `${year}-09`;

  const data = (body: Record<string, unknown>): Record<string, unknown> => (body.data ?? body) as Record<string, unknown>;
  const post = (path: string, body: Record<string, unknown>) => api(ctx.server, 'post', `/api/v1${path}`, { token: actor.token, body });
  const get = (path: string) => api(ctx.server, 'get', `/api/v1${path}`, { token: actor.token });
  const lineStatuses = async (runId: string) => {
    const run = await get(`/hrm/payroll/runs/${runId}`);
    expect(run.status).toBe(200);
    const lines = (data(run.body).lines as Array<{ employeeId: string; status: string }>) ?? [];
    return Object.fromEntries(lines.map((line) => [line.employeeId, line.status]));
  };
  const statement = async (yearMonth: string) => {
    const [y, m] = yearMonth.split('-');
    const res = await get(`/reports/salary-statement?month=${Number(m)}&year=${y}`);
    expect(res.status).toBe(200);
    const body = data(res.body) as { rows?: Array<Record<string, string>>; grandTotal?: Array<{ key: string; amount: string }> };
    return { rows: body.rows ?? [], net: body.grandTotal?.find((card) => card.key === 'net')?.amount ?? '0' };
  };

  beforeAll(async () => {
    ctx = await createTestApp('r33-payroll-individual');
    actor = await createActor(ctx, {
      tenantCode: 'r33-pay',
      email: 'owner@r33-pay.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        'hrm.view',
        'hrm.manage',
        'hrm.payroll.post',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.reports.view',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'reporting.view',
        'organization.branch.manage',
        'organization.cashlocation.manage',
        'organization.cashlocation.view',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.voucher.void',
      ],
    });

    const fiscal = await post('/fiscal-years', { name: `FY${year}`, startDate: `${year}-01-01`, endDate: `${year}-12-31` });
    expect(fiscal.status).toBe(201);
    const branch = await post('/branches', { code: 'BR1', nameAr: 'الفرع الرئيسي' });
    expect(branch.status).toBe(201);
    branchId = data(branch.body).id as string;

    const cashAccountId = data((await post('/accounts', { code: '1211', nameAr: 'الصندوق', type: 'asset' })).body).id as string;
    const safe = await post('/cash-locations', { branchId, kind: 'safe', name: 'الخزينة الرئيسية', accountId: cashAccountId, isDefault: true });
    expect(safe.status).toBe(201);
    cashLocationId = data(safe.body).id as string;
    // the payroll journal needs the salary expense leaf and the employees' parent (ACC-170 / Common.cs L998)
    expect((await post('/accounts', { code: '3122001', nameAr: 'الرواتب والأجور', type: 'expense' })).status).toBe(201);
    expect((await post('/accounts', { code: '2241', nameAr: 'موظفين الفرع الرئيسي', type: 'liability', isPostable: false })).status).toBe(201);

    const employeeA = await post('/hrm/employees', { employeeNo: 'A-1', name: 'موظف المسيّر', branchId, salaryComponents: { basic: '3000', housing: '500' } });
    expect(employeeA.status).toBe(201);
    employeeAId = data(employeeA.body).id as string;
    employeeAName = data(employeeA.body).name as string;

    // an earlier month: run → post → pay → reverse (its lines are `reversed`)
    const earlier = await post('/hrm/payroll/runs', { yearMonth: M1 });
    expect(earlier.status).toBe(201);
    earlierRunId = data(earlier.body).id as string;
    expect((await post(`/hrm/payroll/runs/${earlierRunId}/post`, { branchId })).status).toBe(201);
    expect((await post(`/hrm/payroll/runs/${earlierRunId}/pay`, { branchId, cashLocationId, method: 'cash' })).status).toBe(201);
    expect((await post(`/hrm/payroll/runs/${earlierRunId}/reverse`, { reason: 'تصحيح' })).status).toBe(201);
    expect(await lineStatuses(earlierRunId)).toEqual({ [employeeAId]: 'reversed' });

    // the month under test: run → post → pay for employee A
    const run = await post('/hrm/payroll/runs', { yearMonth: M2 });
    expect(run.status).toBe(201);
    paidRunId = data(run.body).id as string;
    expect((await post(`/hrm/payroll/runs/${paidRunId}/post`, { branchId })).status).toBe(201);
    const paid = await post(`/hrm/payroll/runs/${paidRunId}/pay`, { branchId, cashLocationId, method: 'cash' });
    expect(paid.status).toBe(201);
    expect(data(paid.body).status).toBe('paid');

    // the hire who joined after payroll day
    const hire = await post('/hrm/employees', { employeeNo: 'H-1', name: 'موظف التحق بعد المسيّر', branchId, salaryComponents: { basic: '1200' } });
    expect(hire.status).toBe(201);
    hireId = data(hire.body).id as string;
    hireName = data(hire.body).name as string;
  }, 240_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('ACC-182 — «تقرير الرواتب» answers 200 and lists the run line with its own voucher', async () => {
    const { rows, net } = await statement(M2);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employee).toBe(employeeAName);
    expect(Number(rows[0]?.basic)).toBe(3000);
    expect(Number(rows[0]?.housing)).toBe(500);
    expect(Number(rows[0]?.net)).toBe(3500);
    expect(rows[0]?.doc_no?.startsWith('PV-')).toBe(true);
    expect(Number(net)).toBe(3500);
    // the reversed month shows nothing
    expect((await statement(M1)).rows).toHaveLength(0);
  });

  it('ACC-184 — the new hire is paid individually although the month\'s run is already paid', async () => {
    const paymentRes = await post('/hrm/salary-payments', {
      employeeId: hireId,
      yearMonth: M2,
      paymentDate: `${M2}-28`,
      branchId,
      cashLocationId,
      method: 'cash',
    });
    expect(paymentRes.status).toBe(201);
    const payment = data(paymentRes.body) as { id: string; number: string; net: string; voucherId?: string };
    expect(Number(payment.net)).toBe(1200);
    hirePaymentId = payment.id;
    hirePaymentNumber = payment.number;

    // the employee who WAS on the paid run is still refused
    const onRun = await post('/hrm/salary-payments', { employeeId: employeeAId, yearMonth: M2, paymentDate: `${M2}-28`, branchId, cashLocationId, method: 'cash' });
    expect(onRun.status).toBe(409);
    expect(onRun.body).toMatchObject({ code: 'SALARY_PAYMENT_ALREADY_PAID' });
  });

  it('ACC-183 — that إذن touched no other run line: the reversed month stays reversed, the paid run keeps its line', async () => {
    expect(await lineStatuses(earlierRunId)).toEqual({ [employeeAId]: 'reversed' });
    expect(await lineStatuses(paidRunId)).toEqual({ [employeeAId]: 'paid' });
    // a fresh draft for a later month is untouched by the إذن as well
    const draft = await post('/hrm/payroll/runs', { yearMonth: `${year}-10` });
    expect(draft.status).toBe(201);
    const draftId = data(draft.body).id as string;
    const statuses = await lineStatuses(draftId);
    expect(new Set(Object.values(statuses))).toEqual(new Set(['draft']));
    // the statement now carries both: the run line and the hire's إذن
    const { rows, net } = await statement(M2);
    expect(rows.map((row) => row.employee).sort()).toEqual([employeeAName, hireName].sort());
    expect(rows.find((row) => row.employee === hireName)?.doc_no).toBe(hirePaymentNumber);
    expect(Number(net)).toBe(4700);
  });

  it('ACC-185 — reversing the run undoes the run only; the hire\'s إذن and its voucher survive', async () => {
    const reversed = await post(`/hrm/payroll/runs/${paidRunId}/reverse`, { reason: 'عكس المسيّر — لا علاقة للإذن الفردي به' });
    expect(reversed.status).toBe(201);
    expect(data(reversed.body).status).toBe('reversed');

    const payment = await get(`/hrm/salary-payments/${hirePaymentId}`);
    expect(payment.status).toBe(200);
    const voucherId = data(payment.body).voucherId as string;
    expect(voucherId).toBeTruthy();
    const voucher = await get(`/vouchers/${voucherId}`);
    expect(voucher.status).toBe(200);
    expect(data(voucher.body).status).toBe('posted');

    const { rows, net } = await statement(M2);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.employee).toBe(hireName);
    expect(Number(net)).toBe(1200);
  });
});
