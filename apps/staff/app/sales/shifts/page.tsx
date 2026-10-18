'use client';

import Link from 'next/link';
import { FilterBand, FormGrid, FormSection, Panel } from '@erp/ui';
import { useState } from 'react';

import { DataTable, Notice, QueryView } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { ApiError, apiData, apiList, apiPost } from '../../../lib/api';
import {
  branchOptions,
  dateTime,
  defaultOf,
  listBranches,
  money,
  statusLabel,
  type Branch,
} from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

type Takings = {
  vouchers: number;
  vouchersCash: string;
  invoices: number;
  sales: { cash: string; card: string; bank: string; credit: string };
  returns: { cash: string; card: string; bank: string; credit: string };
  expectedCash: string;
};

type Shift = {
  id: string;
  branchId: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  expectedCash: string;
  countedCash: string;
  diff: string;
  /** Takings so far — only present on the open shift (Phase 04). */
  live?: Takings;
  /** Frozen at closing; carries the same shape as `live` plus the count. */
  summary?: Takings & { countedCash: string; diff: string };
  /** قيد الإغلاق — `EntryOper.BindCloseShiftToEntry` (L402): الإغلاق يُربط بقيده. */
  number?: string | null;
  journalEntryId?: string | null;
  postedAt?: string | null;
};

const DENOMINATIONS = ['500', '200', '100', '50', '20', '10', '5', '1', '0.5'];

export default function ShiftsPage() {
  const { can } = useSession();
  const branches = useQuery<Branch[]>(() => listBranches(), []);
  const branchRows = branches.data ?? [];
  const [branchId, setBranchId] = useState('');
  const effectiveBranch = branchId || defaultOf(branchRows)?.id || '';

  const shifts = useQuery<Shift[]>(
    () => apiList<Shift>(`/shift-closes${effectiveBranch ? `?branch_id=${effectiveBranch}` : ''}`),
    [effectiveBranch],
  );
  const current = useQuery<Shift | null>(
    () =>
      effectiveBranch
        ? apiData<Shift | null>(`/shift-closes/current?branch_id=${effectiveBranch}`)
        : Promise.resolve(null),
    [effectiveBranch],
  );

  const [counts, setCounts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();

  const countedValue = DENOMINATIONS.reduce(
    (sum, denomination) => sum + Number(denomination) * Number(counts[denomination] ?? 0),
    0,
  );

  async function run(action: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      setNotice({ kind: 'ok', text: okText });
      shifts.reload();
      current.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }

  const openShift = current.data;

  return (
    <Screen
      title="إغلاق اليومية"
      subtitle="فتح وردية الكاشير، ثم جرد النقد وإغلاقها بمقارنة المتوقع بالمعدود — نقداً وشبكة وآجل."
      crumbs={['المبيعات', 'العمليات']}
      filters={
        <FilterBand>
          <label className="field">
            <span>الفرع</span>
            <select
              className="ui-select"
              value={effectiveBranch}
              onChange={(event) => setBranchId(event.target.value)}
            >
              {branchOptions(branchRows).map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </FilterBand>
      }
    >
      <Panel hint="الأرقام حيّة من الخادم — المتوقع يُقارن بالمعدود عند الإغلاق." title="الوردية الحالية">
        <Notice notice={notice} />
        {openShift ? (
          <>
            <p className="m-0 text-[12.5px] text-muted">فُتحت {dateTime(openShift.openedAt)}</p>
            <div className="ui-kpi-grid">
              <div className="ui-kpi-cell">
                <span className="ui-kpi-label">مبيعات نقدية</span>
                <span className="ui-kpi-value num" dir="ltr">
                  {money(openShift.live?.sales.cash ?? '0')}
                </span>
              </div>
              <div className="ui-kpi-cell">
                <span className="ui-kpi-label">شبكة</span>
                <span className="ui-kpi-value num" dir="ltr">
                  {money(openShift.live?.sales.card ?? '0')}
                </span>
              </div>
              <div className="ui-kpi-cell">
                <span className="ui-kpi-label">تحويل بنكي</span>
                <span className="ui-kpi-value num" dir="ltr">
                  {money(openShift.live?.sales.bank ?? '0')}
                </span>
              </div>
              <div className="ui-kpi-cell">
                <span className="ui-kpi-label">مبيعات آجلة</span>
                <span className="ui-kpi-value num" dir="ltr">
                  {money(openShift.live?.sales.credit ?? '0')}
                </span>
              </div>
              <div className="ui-kpi-cell">
                <span className="ui-kpi-label">سندات قبض نقدية</span>
                <span className="ui-kpi-value num" dir="ltr">
                  {money(openShift.live?.vouchersCash ?? '0')}
                </span>
              </div>
              <div className="ui-kpi-cell">
                <span className="ui-kpi-label">النقد المتوقع الآن</span>
                <span className="ui-kpi-value num" dir="ltr">
                  {money(openShift.live?.expectedCash ?? '0')}
                </span>
              </div>
            </div>

            <FormSection hint="عدّ الفئات كما هي في الدرج؛ المجموع يُقارن بالمتوقع." title="جرد النقد">
              <FormGrid cols={3}>
                {DENOMINATIONS.map((denomination) => (
                  <label className="field" key={denomination}>
                    <span>فئة {denomination}</span>
                    <input
                      className="input"
                      dir="ltr"
                      inputMode="numeric"
                      value={counts[denomination] ?? ''}
                      onChange={(event) =>
                        setCounts((data) => ({ ...data, [denomination]: event.target.value }))
                      }
                    />
                  </label>
                ))}
              </FormGrid>
            </FormSection>

            <p className="m-0 text-[13px] font-semibold text-ink">
              إجمالي المعدود:{' '}
              <span className="num" dir="ltr">
                {money(countedValue)}
              </span>
            </p>

            {can('treasury.shift.close') && (
              <button
                className="btn primary"
                type="button"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      apiPost(`/shift-closes/${openShift.id}/close`, {
                        counts: DENOMINATIONS.filter(
                          (denomination) => Number(counts[denomination] ?? 0) > 0,
                        ).map((denomination) => ({
                          denomination,
                          count: Number(counts[denomination] ?? 0),
                        })),
                      }),
                    'تم إغلاق الوردية.',
                  )
                }
              >
                إغلاق الوردية
              </button>
            )}
          </>
        ) : (
          <>
            <p className="m-0 text-[13px] text-muted">
              لا توجد وردية مفتوحة لهذا الفرع — افتح وردية لبدء تسجيل النقد.
            </p>
            {can('treasury.shift.close') && (
              <button
                className="btn primary"
                type="button"
                disabled={busy || !effectiveBranch}
                onClick={() =>
                  run(() => apiPost('/shift-closes/open', { branchId: effectiveBranch }), 'تم فتح الوردية.')
                }
              >
                فتح وردية
              </button>
            )}
          </>
        )}
      </Panel>

      <Panel
        flush
        hint="كل وردية مغلقة بفرقها وقيد إغلاقها — والربط بالقيد خطوةٌ منفصلة."
        title="سجل الورديات"
      >
        <QueryView query={shifts} empty="لا توجد إغلاقات" emptyDetail="ستظهر الورديات المغلقة هنا.">
          {(rows) => (
            <DataTable
              rows={rows}
              rowKey={(row) => row.id}
              columns={[
                { key: 'opened', header: 'الفتح', align: 'ltr', cell: (row) => dateTime(row.openedAt) },
                {
                  key: 'closed',
                  header: 'الإغلاق',
                  align: 'ltr',
                  cell: (row) => (row.closedAt ? dateTime(row.closedAt) : '—'),
                },
                { key: 'expected', header: 'المتوقع', align: 'num', cell: (row) => money(row.expectedCash) },
                { key: 'counted', header: 'المعدود', align: 'num', cell: (row) => money(row.countedCash) },
                { key: 'diff', header: 'الفرق', align: 'num', cell: (row) => money(row.diff) },
                {
                  key: 'cash',
                  header: 'نقداً',
                  align: 'num',
                  cell: (row) => (row.summary ? money(row.summary.sales.cash) : '—'),
                },
                {
                  key: 'card',
                  header: 'شبكة',
                  align: 'num',
                  cell: (row) => (row.summary ? money(row.summary.sales.card) : '—'),
                },
                {
                  key: 'credit',
                  header: 'آجل',
                  align: 'num',
                  cell: (row) => (row.summary ? money(row.summary.sales.credit) : '—'),
                },
                {
                  key: 'status',
                  header: 'الحالة',
                  cell: (row) => <span className="badge">{statusLabel(row.status)}</span>,
                },
                {
                  key: 'entry',
                  header: 'قيد الإغلاق',
                  /**
                   * قيد الإغلاق — `EntryOper.BindCloseShiftToEntry` (س402): الديسكتوب
                   * يشترط أن يكون الإغلاق مربوطاً بقيده («قيد الإغلاق غير مربوط بالإغلاق»،
                   * `frmCloseShift.xaml.cs` س1822) ويكتب فيه فروق اليومية. والسحابة تُرحّل
                   * قيد الفرق عند سماح المعدود… فإن طابق الصندوق رفض المحرّك بـ`SHIFT_BALANCED`
                   * («الصندوق مطابق — لا قيد») — والرسالة تُعرَض كما هي، فرقٌ بصفر ليس قيداً.
                   */
                  cell: (row) =>
                    row.journalEntryId ? (
                      <span className="badge posted">مربوط</span>
                    ) : row.status === 'closed' ? (
                      <button
                        className="btn sm"
                        type="button"
                        disabled={busy}
                        title="قيد الإغلاق غير مربوط بالإغلاق"
                        onClick={() =>
                          run(
                            () => apiPost(`/shift-closes/${row.id}/post`, {}),
                            'تم ربط الإغلاق بقيد اليومية.',
                          )
                        }
                      >
                        ربط
                      </button>
                    ) : (
                      '—'
                    ),
                },
                {
                  key: 'print',
                  header: '',
                  cell: (row) => (
                    <Link className="btn sm" href={`/print/shift/${row.id}`}>
                      طباعة
                    </Link>
                  ),
                },
              ]}
            />
          )}
        </QueryView>
      </Panel>
    </Screen>
  );
}
