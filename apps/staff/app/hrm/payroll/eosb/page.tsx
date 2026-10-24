'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Panel } from '@erp/ui';

import { DataTable, Notice } from '../../../../components/data-view';
import { ErrorBox, Loading, Screen } from '../../../../components/screen';
import { accountLabel, listAccounts, postableOf, type Account } from '../../../../lib/accounts';
import { apiData, apiErrorText, apiList, apiPost, apiPatch } from '../../../../lib/api';
import { money } from '../../../../lib/lookups';
import { useSession } from '../../../../lib/session';
import { useQuery } from '../../../../lib/use-query';

type Policy = {
  monthsPerYearFirst: string;
  monthsPerYearAfter: string;
  enabled: boolean;
  expenseAccountId: string | null;
  liabilityAccountId: string | null;
};
type PreviewRow = {
  employeeId: string;
  employeeNo: string;
  name: string;
  hireDate: string | null;
  serviceYears: string;
  basis: string;
  cumulative: string;
  priorAccrued: string;
  delta: string;
};
type Preview = { yearMonth: string; status: string; rows: PreviewRow[]; totalDelta: string };
type Accrual = {
  id: string;
  period: string;
  employeeNo: string;
  employeeName: string;
  serviceYears: string;
  delta: string;
  status: string;
};

const currentMonth = () => new Date().toISOString().slice(0, 7);

export default function EosbPage() {
  const { can } = useSession();
  const policyQuery = useQuery<Policy>(() => apiData<Policy>('/hrm/payroll/eosb-policy'), []);
  const accounts = useQuery<Account[]>(() => listAccounts(), []);
  const accruals = useQuery<Accrual[]>(() => apiList<Accrual>('/hrm/payroll/eosb/accruals'), []);

  const [yearMonth, setYearMonth] = useState(currentMonth());
  const [preview, setPreview] = useState<Preview | undefined>();
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [liabilityAccountId, setLiabilityAccountId] = useState('');
  const [monthsFirst, setMonthsFirst] = useState('');
  const [monthsAfter, setMonthsAfter] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string } | undefined>();

  async function run(action: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      setNotice({ kind: 'ok', text: okText });
      accruals.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  if (policyQuery.status === 'loading') return <Loading />;
  if (policyQuery.status !== 'success' || !policyQuery.data) {
    return (
      <Screen title="مخصص نهاية الخدمة" crumbs={['الموظفين والرواتب']}>
        <ErrorBox message={policyQuery.error ?? 'تعذّر تحميل سياسة المخصص'} onRetry={policyQuery.reload} />
      </Screen>
    );
  }

  const policy = policyQuery.data;
  const postable = (accounts.data ?? []).filter((account) => postableOf(account));
  const rows = preview?.rows ?? [];

  return (
    <Screen
      title="مخصص نهاية الخدمة"
      subtitle={`${policy.enabled ? 'السياسة مفعّلة' : 'السياسة موقوفة'} — ${policy.monthsPerYearFirst} شهراً/سنة في الخمس الأولى ثم ${policy.monthsPerYearAfter} شهر`}
      crumbs={['الموظفين والرواتب', 'العمليات']}
      actions={
        <Link className="btn" href="/reports/end-of-service-liability">
          تقرير رصيد المخصص
        </Link>
      }
    >
      <Panel title="الإجراءات">
        <Notice notice={notice} />
        <div className="form-grid">
          <label className="field">
            <span>الفترة (YYYY-MM)</span>
            <input className="input" value={yearMonth} onChange={(event) => setYearMonth(event.target.value)} />
          </label>
        </div>
        <div className="row">
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const result = await apiData<Preview>('/hrm/payroll/eosb/preview', {
                  method: 'POST',
                  body: JSON.stringify({ yearMonth }),
                });
                setPreview(result);
              }, 'اكتملت المعاينة (بلا كتابة).')}
          >
            معاينة
          </button>
          {can('hrm.payroll.post') && (
            <button
              className="btn primary"
              type="button"
              disabled={busy}
              onClick={() => run(() => apiPost('/hrm/payroll/eosb/post', { yearMonth }), 'ترحيل المخصص بقيد الاستحقاق.')}
            >
              ترحيل المخصص
            </button>
          )}
          {can('hrm.payroll.post') && (
            <button
              className="btn danger"
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => run(() => apiPost('/hrm/payroll/eosb/reverse', { yearMonth, reason }), 'عُكس قيد المخصص.')}
            >
              عكس الترحيل
            </button>
          )}
        </div>
        <label className="field">
          <span>سبب العكس (إلزامي)</span>
          <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        {preview && (
          <p className={preview.status === 'posted' ? 'alert ok' : 'alert info'}>
            {preview.status === 'posted'
              ? 'هذه الفترة مُرحَّلة — العكس ثم إعادة الترحيل متاحان.'
              : preview.status === 'reversed'
                ? 'هذه الفترة معكوسة — إعادة الترحيل متاحة.'
                : 'هذه الفترة بلا ترحيل بعد.'}{' '}
            إجمالي Δ: {money(preview.totalDelta)}
          </p>
        )}
      </Panel>

      {rows.length > 0 && (
        <Panel title={`معاينة ${preview?.yearMonth ?? ''} — ${rows.length} موظف`} flush>
          <DataTable
            rows={rows}
            rowKey={(row) => row.employeeId}
            columns={[
              { key: 'no', header: 'الرقم', cell: (row) => row.employeeNo },
              { key: 'name', header: 'الموظف', cell: (row) => row.name },
              { key: 'years', header: 'السنوات', align: 'num', cell: (row) => row.serviceYears },
              { key: 'basis', header: 'الأساس', align: 'num', cell: (row) => money(row.basis) },
              { key: 'cumulative', header: 'التراكمي', align: 'num', cell: (row) => money(row.cumulative) },
              { key: 'prior', header: 'السابق', align: 'num', cell: (row) => money(row.priorAccrued) },
              { key: 'delta', header: 'Δ الفترة', align: 'num', cell: (row) => money(row.delta) },
            ]}
          />
        </Panel>
      )}

      {can('hrm.manage') && (
        <Panel title="سياسة المخصص">
          <div className="form-grid">
            <label className="field">
              <span>أشهر/السنة — الخمس الأولى</span>
              <input
                className="input"
                defaultValue={policy.monthsPerYearFirst}
                onChange={(event) => setMonthsFirst(event.target.value)}
              />
            </label>
            <label className="field">
              <span>أشهر/السنة — بعدها</span>
              <input
                className="input"
                defaultValue={policy.monthsPerYearAfter}
                onChange={(event) => setMonthsAfter(event.target.value)}
              />
            </label>
            <label className="field">
              <span>حساب المصروف</span>
              <select
                className="input"
                value={expenseAccountId || policy.expenseAccountId || ''}
                onChange={(event) => setExpenseAccountId(event.target.value)}
              >
                <option value="">— من السياسة —</option>
                {postable.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>حساب المخصص</span>
              <select
                className="input"
                value={liabilityAccountId || policy.liabilityAccountId || ''}
                onChange={(event) => setLiabilityAccountId(event.target.value)}
              >
                <option value="">— من السياسة —</option>
                {postable.map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountLabel(account)}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <button
            className="btn primary"
            type="button"
            disabled={busy}
            onClick={() =>
              run(
                () =>
                  apiPatch('/hrm/payroll/eosb-policy', {
                    ...(monthsFirst.trim() ? { monthsPerYearFirst: monthsFirst.trim() } : {}),
                    ...(monthsAfter.trim() ? { monthsPerYearAfter: monthsAfter.trim() } : {}),
                    ...(expenseAccountId ? { expenseAccountId } : {}),
                    ...(liabilityAccountId ? { liabilityAccountId } : {}),
                  }),
                'حُفظت سياسة المخصص.',
              )
            }
          >
            حفظ السياسة
          </button>
        </Panel>
      )}

      <Panel title="السطور المرحّلة" flush>
        <DataTable
          rows={accruals.data ?? []}
          rowKey={(row) => row.id}
          columns={[
            { key: 'period', header: 'الفترة', cell: (row) => row.period },
            { key: 'no', header: 'الرقم', cell: (row) => row.employeeNo },
            { key: 'name', header: 'الموظف', cell: (row) => row.employeeName },
            { key: 'years', header: 'السنوات', align: 'num', cell: (row) => row.serviceYears },
            { key: 'delta', header: 'Δ', align: 'num', cell: (row) => money(row.delta) },
            {
              key: 'status',
              header: 'الحالة',
              cell: (row) => (row.status === 'posted' ? 'مرحّل' : 'معكوس'),
            },
          ]}
        />
      </Panel>
    </Screen>
  );
}
