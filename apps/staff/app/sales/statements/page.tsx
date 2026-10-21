'use client';

import { FilterBand, Panel } from '@erp/ui';
import { useState } from 'react';

import { DataTable, QueryView } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { downloadCsv } from '../../../lib/accounts';
import { apiData } from '../../../lib/api';
import { listParties, money, partyLabel, shortDate, type Party } from '../../../lib/lookups';
import { useQuery } from '../../../lib/use-query';

type StatementRow = {
  entryId: string;
  accountId: string;
  date: string;
  debit: string;
  credit: string;
  allocated: string;
};
type Statement = { receivable: string; payable: string; open: StatementRow[] };

export default function PartyStatementPage() {
  const [kind, setKind] = useState<'customer' | 'supplier'>('customer');
  const [partyId, setPartyId] = useState('');
  const parties = useQuery<Party[]>(() => listParties(kind), [kind]);
  const statement = useQuery<Statement | null>(
    () => (partyId ? apiData<Statement>(`/parties/${partyId}/statement`) : Promise.resolve(null)),
    [partyId],
  );

  const rows = statement.data?.open ?? [];
  let running = 0;
  const withBalance = rows.map((row) => {
    running += Number(row.debit) - Number(row.credit);
    return { ...row, runningText: running.toFixed(4) };
  });

  return (
    <Screen
      title="كشف حساب طرف"
      subtitle="حركة العميل أو المورد على حسابه في الأستاذ مع الرصيد التراكمي."
      crumbs={['المبيعات', 'تقارير']}
      actions={
        <button
          className="btn"
          type="button"
          disabled={withBalance.length === 0}
          onClick={() =>
            downloadCsv(
              'party-statement.csv',
              ['التاريخ', 'مدين', 'دائن', 'الرصيد'],
              withBalance.map((row) => [shortDate(row.date), row.debit, row.credit, row.runningText]),
            )
          }
        >
          تصدير CSV
        </button>
      }
      filters={
        <FilterBand>
          <label className="field">
            <span>النوع</span>
            <select
              className="ui-select"
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as 'customer' | 'supplier');
                setPartyId('');
              }}
            >
              <option value="customer">عميل</option>
              <option value="supplier">مورد</option>
            </select>
          </label>
          <label className="field">
            <span>الطرف</span>
            <select
              className="ui-select"
              value={partyId}
              onChange={(event) => setPartyId(event.target.value)}
            >
              <option value="">— اختر —</option>
              {(parties.data ?? []).map((row) => (
                <option key={row.id} value={row.id}>
                  {partyLabel(row)}
                </option>
              ))}
            </select>
          </label>
        </FilterBand>
      }
    >
      {!partyId ? (
        <p className="m-0 text-[13px] text-muted">
          اختر عميلاً أو مورداً لعرض كشف حسابه — الحركةُ والرصيدُ التراكمي كما رحّلهما الأستاذ.
        </p>
      ) : null}
      {partyId ? (
        <>
          <Panel title="الرصيد الحالي" hint="مستحقٌّ لنا أو علينا بحسب طبيعة الحساب.">
            <div className="ui-kpi-grid">
              <div className="ui-kpi-cell">
                <span className="ui-kpi-label">الرصيد المدين (مستحق لنا)</span>
                <span className="ui-kpi-value num" dir="ltr">
                  {money(statement.data?.receivable)}
                </span>
              </div>
              <div className="ui-kpi-cell">
                <span className="ui-kpi-label">الرصيد الدائن (مستحق عليه)</span>
                <span className="ui-kpi-value num" dir="ltr">
                  {money(statement.data?.payable)}
                </span>
              </div>
            </div>
          </Panel>

          <Panel flush hint="كل صف قيدٌ مرحَّل، والرصيد عمودٌ تراكمي من أول الحركة." title="حركة الحساب">
            <QueryView
              query={statement}
              isEmpty={() => withBalance.length === 0}
              empty="لا توجد حركة"
              emptyDetail="لم تُرحَّل أي قيود على هذا الطرف بعد."
            >
              {() => (
                <DataTable
                  rows={withBalance}
                  rowKey={(row, index) => `${row.entryId}:${index}`}
                  columns={[
                    { key: 'date', header: 'التاريخ', align: 'ltr', cell: (row) => shortDate(row.date) },
                    { key: 'debit', header: 'مدين', align: 'num', cell: (row) => money(row.debit) },
                    { key: 'credit', header: 'دائن', align: 'num', cell: (row) => money(row.credit) },
                    {
                      key: 'allocated',
                      header: 'المسدّد',
                      align: 'num',
                      cell: (row) => money(row.allocated),
                    },
                    { key: 'running', header: 'الرصيد', align: 'num', cell: (row) => money(row.runningText) },
                  ]}
                />
              )}
            </QueryView>
          </Panel>
        </>
      ) : null}
    </Screen>
  );
}
