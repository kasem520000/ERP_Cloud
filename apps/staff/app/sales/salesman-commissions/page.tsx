'use client';

import Link from 'next/link';
import { FilterBand, Panel, TableFrame } from '@erp/ui';
import { Suspense, useState } from 'react';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { downloadCsv } from '../../../lib/accounts';
import { apiFetch } from '../../../lib/api';
import { listBranches, listSalesmen, money } from '../../../lib/lookups';
import { useQuery } from '../../../lib/use-query';

/**
 * طباعة فواتير مندوب وعمولاتهم — `Form_WPF/frmInvBySalesMen.xaml`
 * («مبيعات مندوب خلال فترة»), opened from `frmSalesMen` L272.
 *
 * The window's filters are `👤 المندوب` with `🌐 الكل` (checked) and
 * `📅 الفترة الزمنية` with `كل الفترة` (checked), `من` and `إلى` — both on today —
 * and ` عرض`. Its grid is ` نوع الحركة · التاريخ · رقم السند ·
 * رقم المرجع · المندوب · القيمة · عمولة المبيعات · عمولة التحصيل ·
 * عمولة الربح · عرض`, and its footer is
 * ` إجمالي القيمة: · ع. المبيعات: · ع. التحصيل: · ع. الربح:` under
 * `🏆 الإجمالي`.
 *
 * Three ledgers feed it: the فواتير (`ShowInvoiceResults` L196), the «إشعار مدين»
 * hanging off a sale (`LoadCreditNotes` L351) and the سندات القبض
 * (`LoadReceiptsByType` L411). Two of the desktop's own quirks are ported as they stand
 * and written down in `PHASE_09_VERTICALS.md` §2:
 *
 *   • «كل الفترة» lifts the dates from the invoices only — the سندات stay inside `من`
 *     and `إلى` always (`L426`), which is why the two date boxes are never disabled here.
 *   • a سند is never narrowed by branch (`Receipts.BranchID` exists and is unused), so
 *     choosing a فرع filters the فواتير and leaves the سندات where they are.
 *
 * The one thing not ported: `RecalculateSummary` L482 adds `Value` **without** `isPlus`,
 * so a مرتجع raises the desktop's «💰 إجمالي القيمة». Here the total is signed — a
 * report that grows when the goods come back would pay commission on a refund.
 */
type Row = {
  seq: number;
  movementType: string;
  date: string | null;
  documentId: string;
  number: string | null;
  refNumber: string | null;
  salesmanId: string;
  salesmanName: string;
  branchName: string | null;
  value: string;
  salesCommission: string;
  collectionCommission: string;
  profitCommission: string;
  isPlus: 1 | -1;
};

type Summary = {
  totalValue: string;
  salesCommission: string;
  collectionCommission: string;
  profitCommission: string;
  invoices: number;
  notes: number;
  receipts: number;
  rows: number;
};

type Envelope = {
  salesmanId: string | null;
  salesmanName: string | null;
  allSalesmen: boolean;
  allPeriod: boolean;
  from: string;
  to: string;
  branchId: string | null;
  summary: Summary;
  rows: Row[];
};

type Filters = {
  salesmanId: string;
  allSalesmen: boolean;
  allPeriod: boolean;
  from: string;
  to: string;
  branchId: string;
};

const EMPTY: Summary = {
  totalValue: '0',
  salesCommission: '0',
  collectionCommission: '0',
  profitCommission: '0',
  invoices: 0,
  notes: 0,
  receipts: 0,
  rows: 0,
};

const today = () => new Date().toISOString().slice(0, 10);

type Salesman = { id: string; name: string; active?: boolean };
type Branch = { id: string; nameAr?: string; name?: string };

function SalesmanCommissions() {
  const salesmen = useQuery<Salesman[]>(() => listSalesmen(), []);
  const branches = useQuery<Branch[]>(() => listBranches(), []);

  const [salesmanId, setSalesmanId] = useState('');
  const [allSalesmen, setAllSalesmen] = useState(true);
  const [allPeriod, setAllPeriod] = useState(true);
  const [from, setFrom] = useState(today());
  const [to, setTo] = useState(today());
  const [branchId, setBranchId] = useState('');
  const [applied, setApplied] = useState<Filters>({
    salesmanId: '',
    allSalesmen: true,
    allPeriod: true,
    from: today(),
    to: today(),
    branchId: '',
  });

  const report = useQuery<Envelope>(() => {
    const params = new URLSearchParams();
    if (applied.salesmanId) params.set('salesman_id', applied.salesmanId);
    params.set('all_salesmen', applied.allSalesmen ? '1' : '0');
    params.set('all_period', applied.allPeriod ? '1' : '0');
    params.set('from', applied.from);
    params.set('to', applied.to);
    if (applied.branchId) params.set('branch_id', applied.branchId);
    return apiFetch<{ data: Envelope }>(`/sales/salesmen/commissions?${params.toString()}`).then(
      (body) => body.data,
    );
  }, [applied]);

  const rows = report.data?.rows ?? [];
  const totals = report.data?.summary ?? EMPTY;

  return (
    <Screen
      title="مبيعات مندوب خلال فترة"
      subtitle="طباعة فواتير مندوب وعمولاتهم — فواتيره وإشعارات مدينه وسندات قبضه، وما يستحقّه على كلٍّ منها."
      crumbs={['التقارير', 'المبيعات']}
      actions={
        <>
          <button className="btn" type="button" onClick={() => window.print()} disabled={rows.length === 0}>
            طباعة
          </button>
          <button
            className="btn"
            type="button"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `salesman-commissions-${applied.salesmanId || 'all'}-${applied.from}.csv`,
                [
                  'م',
                  'نوع الحركة',
                  'التاريخ',
                  'رقم السند',
                  'رقم المرجع',
                  'المندوب',
                  'الفرع',
                  'القيمة',
                  'عمولة المبيعات',
                  'عمولة التحصيل',
                  'عمولة الربح',
                ],
                rows.map((row) => [
                  row.seq,
                  row.movementType,
                  row.date ?? '',
                  row.number ?? '',
                  row.refNumber ?? '',
                  row.salesmanName,
                  row.branchName ?? '',
                  Number(row.value) * row.isPlus,
                  Number(row.salesCommission) * row.isPlus,
                  Number(row.collectionCommission) * row.isPlus,
                  Number(row.profitCommission) * row.isPlus,
                ]),
              )
            }
          >
            تصدير CSV
          </button>
        </>
      }
      filters={
        <FilterBand summary="«كل الفترة» ترفع التاريخين عن الفواتير وحدها؛ وسندات القبض مقيدة بهما دائماً، ولا تُقيَّد بالفرع.">
          <label className="field">
            <span>المندوب</span>
            <select
              className="ui-select"
              value={salesmanId}
              onChange={(event) => {
                setSalesmanId(event.target.value);
                if (event.target.value) setAllSalesmen(false);
              }}
              disabled={allSalesmen}
            >
              <option value="">اختر المندوب…</option>
              {(salesmen.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field-check">
            <input
              type="checkbox"
              checked={allSalesmen}
              onChange={(event) => {
                setAllSalesmen(event.target.checked);
                if (event.target.checked) setSalesmanId('');
              }}
            />
            <span>كل المناديب</span>
          </label>
          <label className="field">
            <span>الفرع</span>
            <select
              className="ui-select"
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              <option value="">كل الفروع</option>
              {(branches.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.nameAr ?? branch.name ?? branch.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>من</span>
            <input
              className="input"
              type="date"
              value={from}
              disabled={allPeriod}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="field">
            <span>إلى</span>
            <input
              className="input"
              type="date"
              value={to}
              disabled={allPeriod}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
          <label className="field-check">
            <input
              type="checkbox"
              checked={allPeriod}
              onChange={(event) => setAllPeriod(event.target.checked)}
            />
            <span>كل الفترة</span>
          </label>
          <button
            className="btn primary"
            type="button"
            onClick={() => setApplied({ salesmanId, allSalesmen, allPeriod, from, to, branchId })}
          >
            عرض
          </button>
        </FilterBand>
      }
    >
      {report.status === 'loading' && <Loading rows={6} />}
      {report.status === 'forbidden' && <Forbidden />}
      {report.status === 'error' && <ErrorBox message={report.error} onRetry={report.reload} />}
      {report.status === 'success' && (
        <>
          <div className="ui-kpi-grid">
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">إجمالي القيمة</span>
              <span className="ui-kpi-value num is-up" dir="ltr">
                {money(totals.totalValue)}
              </span>
              <span className="ui-kpi-hint">المبيعات − المرتجعات − الإشعارات + التحصيل</span>
            </div>
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">عمولة المبيعات</span>
              <span className="ui-kpi-value num" dir="ltr">
                {money(totals.salesCommission)}
              </span>
            </div>
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">عمولة التحصيل</span>
              <span className="ui-kpi-value num" dir="ltr">
                {money(totals.collectionCommission)}
              </span>
            </div>
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">عمولة الربح</span>
              <span className="ui-kpi-value num" dir="ltr">
                {money(totals.profitCommission)}
              </span>
            </div>
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">عدد الفواتير</span>
              <span className="ui-kpi-value num" dir="ltr">
                {totals.invoices}
              </span>
            </div>
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">إشعارات مدين</span>
              <span className="ui-kpi-value num" dir="ltr">
                {totals.notes}
              </span>
            </div>
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">سندات القبض</span>
              <span className="ui-kpi-value num" dir="ltr">
                {totals.receipts}
              </span>
            </div>
          </div>

          {rows.length === 0 ? (
            <Empty
              title="لا حركات للمندوب في هذه الفترة"
              detail="تأكد من التاريخين، أو أن فواتير المندوب مرحَّلة، أو أن له سندات قبض باسم بطاقة موظفه."
            />
          ) : (
            <Panel flush hint="القيمة بإشارتها: المرتجع وإشعار المدين ينقصان." title="حركات المندوب">
              <TableFrame>
                <thead>
                  <tr>
                    <th>م</th>
                    <th>نوع الحركة</th>
                    <th>التاريخ</th>
                    <th>رقم السند</th>
                    <th>رقم المرجع</th>
                    <th>المندوب</th>
                    <th>الفرع</th>
                    <th className="num">القيمة</th>
                    <th className="num">عمولة المبيعات</th>
                    <th className="num">عمولة التحصيل</th>
                    <th className="num">عمولة الربح</th>
                    <th>عرض</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const isInvoice = row.movementType.includes('فاتورة');
                    const isNote = row.movementType.includes('إشعار');
                    const isReceipt = row.movementType.includes('سند قبض');
                    let href = '';
                    if (isInvoice) href = `/sales/invoices/${row.documentId}`;
                    else if (isNote) href = `/sales/notes/debit?id=${row.documentId}`;
                    else if (isReceipt) href = `/treasury/vouchers?kind=receipt&id=${row.documentId}`;
                    return (
                      <tr key={`${row.documentId}-${row.seq}`}>
                        <td dir="ltr">{row.seq}</td>
                        <td>{row.movementType}</td>
                        <td dir="ltr">{row.date ?? '—'}</td>
                        <td dir="ltr">{row.number ?? '—'}</td>
                        <td dir="ltr">{row.refNumber ?? '—'}</td>
                        <td>{row.salesmanName}</td>
                        <td>{row.branchName ?? '—'}</td>
                        {/* «القيمة» تُعرض بإشارتها: المرتجع وإشعار المدين ينقصان. */}
                        <td className="num">{money(String(Number(row.value) * row.isPlus))}</td>
                        <td className="num">{money(String(Number(row.salesCommission) * row.isPlus))}</td>
                        <td className="num">
                          {money(String(Number(row.collectionCommission) * row.isPlus))}
                        </td>
                        <td className="num">{money(String(Number(row.profitCommission) * row.isPlus))}</td>
                        <td>
                          {href ? (
                            <Link className="btn sm" href={href}>
                              عرض
                            </Link>
                          ) : (
                            <span className="muted">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={7}>الإجمالي</th>
                    <th className="num">{money(totals.totalValue)}</th>
                    <th className="num">{money(totals.salesCommission)}</th>
                    <th className="num">{money(totals.collectionCommission)}</th>
                    <th className="num">{money(totals.profitCommission)}</th>
                    <th>
                      <span className="sr-only">إجراءات</span>
                    </th>
                  </tr>
                </tfoot>
              </TableFrame>
            </Panel>
          )}
        </>
      )}
    </Screen>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading rows={6} />}>
      <SalesmanCommissions />
    </Suspense>
  );
}
