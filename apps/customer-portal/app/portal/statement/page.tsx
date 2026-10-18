'use client';

import { useState } from 'react';
import { ContentPanel, FormField, PageFrame, PageHeader, TableViewport, ViewNotice } from '@erp/ui/page';

import { PortalShell, usePortalProfile } from '../../../components/portal-shell';
import { fetchStatement } from '../../../lib/api';
import { dateText, moneyText } from '../../../lib/format';
import { useAsync } from '../../../lib/use-async';

const DOC_AR: Record<string, string> = {
  invoice: 'فاتورة',
  return: 'مردود',
  receipt: 'سند قبض',
  payment: 'سند صرف',
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
    <PageFrame>
      <PageHeader
        title="كشف الحساب"
        eyebrow="الحركة المالية"
        description={
          <>
            حركة حسابك لدى {profile?.company.nameAr || 'المورد'}: الفواتير مدين، والسدادات دائن، مع الرصيد
            المتحرك.
          </>
        }
      />

      <ContentPanel title="الفترة والإجراءات">
        <div className="portal-filters">
          <FormField label="من تاريخ">
            <input
              className="input"
              type="date"
              value={range.from}
              onChange={(event) => setRange({ ...range, from: event.target.value })}
            />
          </FormField>
          <FormField label="إلى تاريخ">
            <input
              className="input"
              type="date"
              value={range.to}
              onChange={(event) => setRange({ ...range, to: event.target.value })}
            />
          </FormField>
          <div className="portal-filter-actions">
            <button
              className="btn primary"
              type="button"
              onClick={() => setApplied({ from: range.from || undefined, to: range.to || undefined })}
            >
              عرض
            </button>
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
                  `statement-${new Date().toISOString().slice(0, 10)}.csv`,
                )
              }
            >
              تحميل CSV
            </button>
            <button className="btn" type="button" onClick={() => globalThis.print()}>
              طباعة
            </button>
          </div>
        </div>
      </ContentPanel>

      <ContentPanel
        title="الحركات"
        description={statement.status === 'ready' ? `${lines.length} حركة` : undefined}
      >
        {statement.status === 'loading' ? (
          <ViewNotice state="loading">جارٍ تحميل الكشف…</ViewNotice>
        ) : statement.status === 'error' ? (
          <ViewNotice state="error">{statement.error}</ViewNotice>
        ) : lines.length === 0 ? (
          <ViewNotice state="empty">لا توجد حركات في هذه الفترة.</ViewNotice>
        ) : (
          <TableViewport label="حركات كشف الحساب">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المستند</th>
                  <th>الرقم</th>
                  <th>البيان</th>
                  <th>مدين</th>
                  <th>دائن</th>
                  <th>الرصيد</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={`${line.document_id}-${line.doc_type}`}>
                    <td>{dateText(line.day)}</td>
                    <td>{DOC_AR[line.doc_type] ?? line.doc_type}</td>
                    <td>{line.number}</td>
                    <td>{line.description}</td>
                    <td>{Number(line.debit) ? moneyText(line.debit) : '—'}</td>
                    <td>{Number(line.credit) ? moneyText(line.credit) : '—'}</td>
                    <td>
                      <strong>{moneyText(line.running)}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={6}>
                    <strong>رصيد آخر المدة</strong>
                  </td>
                  <td>
                    <strong>{moneyText(statement.data?.closing ?? '0')}</strong>
                  </td>
                </tr>
              </tfoot>
            </table>
          </TableViewport>
        )}
      </ContentPanel>
    </PageFrame>
  );
}

export default function StatementPage() {
  return (
    <PortalShell>
      <Statement />
    </PortalShell>
  );
}
