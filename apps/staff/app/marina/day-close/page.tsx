'use client';

import { Panel } from '@erp/ui';
import { useState } from 'react';

import { DataTable, Notice, QueryView } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { ApiError, apiData, apiList, apiPost } from '../../../lib/api';
import { arabicName, branchOptions, defaultOf, listBranches, money, shortDate, today, type Branch } from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

type DaySummary = {
  branchId: string;
  closeDate: string;
  closed: boolean;
  bookingsCount: number;
  rentalsCount: number;
  uninvoicedCount: number;
  rentalsTotal: string;
  additionsTotal: string;
  insuranceTotal: string;
  violationsTotal: string;
  violationsCount: number;
};
type DayClosing = {
  id: string;
  branchId: string;
  closeDate: string;
  bookingsCount: number;
  rentalsCount: number;
  rentalsTotal: string;
  violationsTotal: string;
  notes: string | null;
  closedAt: string;
};

export default function MarinaDayClosePage() {
  const { can } = useSession();
  const branches = useQuery<Branch[]>(() => listBranches(), []);
  const branchRows = branches.data ?? [];
  const [branchId, setBranchId] = useState('');
  const [day, setDay] = useState(today());
  const currentBranch = branchId || defaultOf(branchRows)?.id || branchRows[0]?.id || '';

  const summary = useQuery<DaySummary | null>(
    () => (currentBranch && day ? apiData<DaySummary>(`/marina/day-close?branch_id=${currentBranch}&date=${day}`) : Promise.resolve(null)),
    [currentBranch, day],
  );
  const closings = useQuery<DayClosing[]>(() => apiList<DayClosing>('/marina/day-closings'), []);

  const [notes, setNotes] = useState('');
  const [force, setForce] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string } | undefined>();

  const branchName = (id: string) => {
    const branch = branchRows.find((row) => row.id === id);
    return branch ? arabicName(branch) : id;
  };

  async function closeDay() {
    setBusy(true);
    setNotice(undefined);
    try {
      await apiPost('/marina/day-close', { branchId: currentBranch, closeDate: day, notes: notes || undefined, force });
      setNotice({ kind: 'ok', text: 'تم إغلاق اليومية. لن تُقبل حجوزات أو فواتير تأجير جديدة بهذا التاريخ.' });
      setNotes('');
      setForce(false);
      summary.reload();
      closings.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const data = summary.data ?? null;

  return (
    <Screen
      title="إغلاق اليومية — المراسي"
      subtitle="تجميد يوم المرسى: بعد الإغلاق يرفض النظام أي حجز أو فاتورة تأجير بتاريخ ذلك اليوم لنفس الفرع."
      crumbs={['إدارة المراسي', 'العمليات']}
    >
      <div className="ui-filter-bar no-print">
        <div className="ui-filter-fields">
        <label className="field">
          <span>الفرع</span>
          <select className="input" value={currentBranch} onChange={(event) => setBranchId(event.target.value)}>
            {branchOptions(branchRows).map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>التاريخ</span>
          <input className="input" dir="ltr" type="date" value={day} onChange={(event) => setDay(event.target.value)} />
        </label>
        </div>
      </div>

      <Notice notice={notice} />

      {data && (
        <section className="ui-panel">
          <div className="ui-panel-head">
            <div className="ui-panel-copy">
              <h2 className="ui-panel-title">
                حركة {shortDate(data.closeDate)} — {branchName(data.branchId)}
              </h2>
              <p className="ui-panel-hint">تفصيل ما جرى في اليوم قبل تجميده.</p>
            </div>
          </div>
          <div className="ui-panel-body">
          <div className="ui-kpi-strip">
            <div className="ui-kpi-cell"><span className="ui-kpi-label">الحجوزات</span><span className="ui-kpi-value">{data.bookingsCount}</span></div>
            <div className="ui-kpi-cell"><span className="ui-kpi-label">فواتير التأجير</span><span className="ui-kpi-value">{data.rentalsCount}</span></div>
            <div className="ui-kpi-cell"><span className="ui-kpi-label">إجمالي التأجير</span><span className="ui-kpi-value">{money(data.rentalsTotal)}</span></div>
            <div className="ui-kpi-cell"><span className="ui-kpi-label">الإضافات</span><span className="ui-kpi-value">{money(data.additionsTotal)}</span></div>
            <div className="ui-kpi-cell"><span className="ui-kpi-label">التأمينات</span><span className="ui-kpi-value">{money(data.insuranceTotal)}</span></div>
            <div className="ui-kpi-cell"><span className="ui-kpi-label">المخالفات ({data.violationsCount})</span><span className="ui-kpi-value">{money(data.violationsTotal)}</span></div>
          </div>

          {data.closed && <p className="alert ok">هذه اليومية مغلقة بالفعل.</p>}
          {!data.closed && data.uninvoicedCount > 0 && (
            <p className="alert warn">{`يوجد ${data.uninvoicedCount} حجز بلا فاتورة تأجير. الإغلاق فوقها يخفي إيراداً، لذا يتطلب تأكيداً صريحاً.`}</p>
          )}

          {!data.closed && can('marina.manage') && (
            <>
              <label className="field wide">
                <span>ملاحظات الإغلاق</span>
                <input className="input" value={notes} onChange={(event) => setNotes(event.target.value)} />
              </label>
              {data.uninvoicedCount > 0 && (
                <label className="field">
                  <span>
                    <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} /> إغلاق رغم وجود حجوزات غير مفوترة
                  </span>
                </label>
              )}
            </>
          )}
          {!data.closed && can('marina.manage') ? (
            <div className="ui-form-actions">
              <span className="ui-form-actions-note">الإغلاق نهائي لهذا اليوم — لا يمكن التراجع عنه.</span>
              <div className="ui-form-actions-buttons">
                <button className="btn primary" type="button" onClick={closeDay} disabled={busy || data.bookingsCount === 0}>
                  {busy ? 'جارٍ الإغلاق…' : 'إغلاق اليومية'}
                </button>
              </div>
            </div>
          ) : null}
          </div>
        </section>
      )}

      <Panel title="إغلاقات سابقة" hint="كل يومية أُغلقت، ومن أغلقها ومتى." flush>
        <QueryView query={closings} empty="لا توجد إغلاقات سابقة" emptyDetail="أغلق أول يومية لتظهر هنا.">
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              { key: 'date', header: 'التاريخ', align: 'ltr', cell: (row) => shortDate(row.closeDate) },
              { key: 'branch', header: 'الفرع', cell: (row) => branchName(row.branchId) },
              { key: 'bookings', header: 'الحجوزات', align: 'num', cell: (row) => row.bookingsCount },
              { key: 'rentals', header: 'الفواتير', align: 'num', cell: (row) => row.rentalsCount },
              { key: 'total', header: 'إجمالي التأجير', align: 'num', cell: (row) => money(row.rentalsTotal) },
              { key: 'violations', header: 'المخالفات', align: 'num', cell: (row) => money(row.violationsTotal) },
              { key: 'notes', header: 'ملاحظات', cell: (row) => row.notes ?? '—' },
            ]}
          />
        )}
        </QueryView>
      </Panel>
    </Screen>
  );
}
