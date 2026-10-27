'use client';

import { FilterBand, PageHead, Panel } from '@erp/ui';
import { useState } from 'react';
import { todayInMakkah } from '@erp/web-core/date';

import { Empty } from '../../../components/card';
import { PortalShell, usePortalProfile } from '../../../components/portal-shell';
import { PortalTable } from '../../../components/table';
import { fetchStatement } from '../../../lib/api';
import { dateText, moneyText } from '../../../lib/format';
import { useAsync } from '../../../lib/use-async';

const DOC_AR: Record<string, string> = {
  invoice: 'فاتورة',
  return: 'مردود',
  receipt: 'سند قبض',
  payment: 'سند صرف',
  invoice_payment: 'دفعة فاتورة',
};

/** Builds a CSV of exactly what is on screen — no server round-trip, no extra permissions. */
function downloadCsv(rows: string[][], filename: string) {
  const csv = `\uFEFF${rows.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(',')).join('\n')}`;
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function Statement() {
  const { profile } = usePortalProfile();
  const [range, setRange] = useState({ from: '', to: '' });
  const [applied, setApplied] = useState<{ from?: string; to?: string }>({});
  const statement = useAsync(() => fetchStatement(applied), [applied.from, applied.to]);
  const lines = statement.data?.lines ?? [];

  return (
    <>
      <PageHead
        title="كشف الحساب"
        description={`حركة حسابك لدى ${profile?.company.nameAr || 'المورد'}: الفواتير مدين، والسدادات دائن، مع الرصيد المتحرك.`}
      />

      <FilterBand
        summary={`${lines.length} حركة`}
        actions={
          <>
            <button
              className="btn"
              type="button"
              disabled={lines.length === 0}
              onClick={() =>
                downloadCsv(
                  [
                    ['التاريخ', 'المستند', 'الرقم', 'مدين', 'دائن', 'الرصيد'],
                    ...lines.map((line) => [
                      line.day,
                      DOC_AR[line.doc_type] ?? line.doc_type,
                      line.number,
                      line.debit,
                      line.credit,
                      line.running,
                    ]),
                  ],
                  `statement-${todayInMakkah()}.csv`,
                )
              }
            >
              تحميل CSV
            </button>
            <button className="btn" type="button" onClick={() => globalThis.print()}>
              طباعة
            </button>
            <button
              className="btn primary"
              type="button"
              onClick={() => setApplied({ from: range.from || undefined, to: range.to || undefined })}
            >
              عرض
            </button>
          </>
        }
      >
        <label className="field">
          <span>من تاريخ</span>
          <input
            className="input"
            type="date"
            value={range.from}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
          />
        </label>
        <label className="field">
          <span>إلى تاريخ</span>
          <input
            className="input"
            type="date"
            value={range.to}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
          />
        </label>
      </FilterBand>

      <Panel
        title="حركة الحساب"
        hint={
          applied.from || applied.to ? `${applied.from ?? 'البداية'} — ${applied.to ?? 'اليوم'}` : 'كل الفترة'
        }
        flush
      >
        {statement.status === 'loading' ? (
          <p className="panel-state">جارٍ تحميل الكشف…</p>
        ) : statement.status === 'error' ? (
          <p className="panel-state" role="alert">
            {statement.error}
          </p>
        ) : lines.length === 0 ? (
          <Empty
            bare
            title="لا حركات في هذه الفترة"
            detail="وسّع الفترة أو تواصل مع المنشأة إن كنت تتوقع حركة ناقصة."
          />
        ) : (
          <PortalTable
            bare
            empty={<>لا حركات في هذه الفترة.</>}
            columns={[
              { key: 'date', header: 'التاريخ', cell: (line) => dateText(line.day) },
              { key: 'doc', header: 'المستند', cell: (line) => DOC_AR[line.doc_type] ?? line.doc_type },
              { key: 'number', header: 'الرقم', ltr: true, cell: (line) => line.number },
              { key: 'description', header: 'البيان', cell: (line) => line.description },
              {
                key: 'debit',
                header: 'مدين',
                numeric: true,
                cell: (line) => (Number(line.debit) ? moneyText(line.debit) : '—'),
              },
              {
                key: 'credit',
                header: 'دائن',
                numeric: true,
                cell: (line) => (Number(line.credit) ? moneyText(line.credit) : '—'),
              },
              {
                key: 'running',
                header: 'الرصيد',
                numeric: true,
                cell: (line) => <strong>{moneyText(line.running)}</strong>,
              },
            ]}
            rows={lines}
            rowKey={(line) => line.movement_id ?? `${line.document_id}-${line.doc_type}`}
            footer={[
              <strong key="label">رصيد آخر المدة</strong>,
              <span key="blank-1" />,
              <span key="blank-2" />,
              <span key="blank-3" />,
              <span key="blank-4" />,
              <span key="blank-5" />,
              <strong key="closing">{moneyText(statement.data?.closing ?? '0')}</strong>,
            ]}
          />
        )}
      </Panel>
    </>
  );
}

export default function StatementPage() {
  return (
    <PortalShell>
      <Statement />
    </PortalShell>
  );
}
