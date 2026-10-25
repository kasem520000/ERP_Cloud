'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Panel } from '@erp/ui';

import { DataTable, Notice } from '../../../components/data-view';
import { ErrorBox, Loading, Screen } from '../../../components/screen';
import { apiData, apiErrorText, apiList, apiPost } from '../../../lib/api';
import { money } from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

/**
 * MF-18 / r45 / D11 — شاشة الإقرارات الضريبية:
 *  • معاينة `vat-return-period` لنطاق من/إلى (نفس أرقام الإقرار الرسمية)؛
 *  • «تقديم الإقرار» يجمّد الأرقام ويقيّد الصافي و**يقفل الفترة الضريبية**
 *    (الأيام/الأشهر المقدَّمة تُصبح مغلقة — لا وثيقة جديدة بتاريخ داخلها)؛
 *  • السجل يعرض الإقرارات المقدَّمة وروابط قيود التسوية.
 * الزر يتطلّب `accounting.period.close` (حارس الخادم نفسه)؛ القراءة `accounting.period.view`.
 */
type Filing = {
  id: string;
  periodFrom: string;
  periodTo: string;
  netVat: string;
  journalEntryId: string | null;
  filedAt: string;
  closedPeriodIds: string[];
};
type ReportRow = { section: string; line: string; net: string; vat: string; s_net_vat: string };
type Report = { rows: ReportRow[]; grandTotal: Array<{ key: string; labelAr: string; amount: string }> };

const iso = (date: Date) => date.toISOString().slice(0, 10);
const currentRange = () => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: iso(start), to: iso(end) };
};

export default function TaxFilingsPage() {
  const { can } = useSession();
  const filings = useQuery<Filing[]>(() => apiList<Filing>('/tax/filings'), []);
  const range = currentRange();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [preview, setPreview] = useState<Report | undefined>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string } | undefined>();

  async function run(action: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      setNotice({ kind: 'ok', text: okText });
      filings.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  if (filings.status === 'loading') return <Loading />;
  if (filings.status !== 'success') {
    return (
      <Screen title="الإقرارات الضريبية" crumbs={['المحاسبة']}>
        <ErrorBox message={filings.error ?? 'تعذّر تحميل سجل الإقرارات'} onRetry={filings.reload} />
      </Screen>
    );
  }

  const rows = preview?.rows ?? [];
  const netCard = preview?.grandTotal.find((card) => card.key === 's_net_vat');
  const rows2 = filings.data ?? [];

  return (
    <Screen
      title="الإقرارات الضريبية"
      subtitle="تقديم يجمّد أرقام الإقرار ويقيّد الصافي عن 2222001 ويقفل الفترة الضريبية"
      crumbs={['المحاسبة', 'العمليات']}
      actions={
        <Link className="btn" href="/reports/vat-return-period">
          تقرير الإقرار الدوري
        </Link>
      }
    >
      <Panel title="تقديم إقرار">
        <Notice notice={notice} />
        <div className="form-grid">
          <label className="field">
            <span>من تاريخ</span>
            <input className="input" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label className="field">
            <span>إلى تاريخ</span>
            <input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
        </div>
        <div className="row">
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const report = await apiData<Report>(`/reports/vat-return-period?from=${from}&to=${to}`);
                setPreview(report);
              }, 'اكتملت معاينة أرقام الإقرار (بلا كتابة).')
            }
          >
            معاينة الإقرار
          </button>
          {can('accounting.period.close') && (
            <button
              className="btn primary"
              type="button"
              disabled={busy || !from || !to}
              onClick={() => {
                if (!window.confirm('تقديم الإقرار سيجمّد أرقامه ويقيّد الصافي ويقفل الفترة الضريبية المغطاة. متابعة؟')) return;
                return run(async () => {
                  const filed = await apiPost<Filing>('/tax/filings', { from, to });
                  setNotice({
                    kind: 'ok',
                    text: `قُدِّم الإقرار ${filed.periodFrom} .. ${filed.periodTo} بصافي ${money(filed.netVat)}${
                      filed.journalEntryId ? ' وقُيّد التسوية.' : ' (صافي صفري بلا قيد).'
                    }`,
                  });
                  setPreview(undefined);
                }, 'حُفظ الإقرار وأُقفلت الفترة.');
              }}
            >
              تقديم الإقرار
            </button>
          )}
        </div>
        {netCard && (
          <p className={Number(netCard.amount) >= 0 ? 'alert info' : 'alert ok'}>
            صافي ضريبة القيمة المضافة للفترة: <strong>{money(netCard.amount)}</strong>{' '}
            {Number(netCard.amount) >= 0 ? '(مستحق الدفع للهيئة)' : '(غير مستحق — مسترد)'} — التصنيف والبنود كما في
            التقرير الرسمي.
          </p>
        )}
      </Panel>

      {rows.length > 0 && (
        <Panel title={`بنود المعاينة ${from} .. ${to} — ${rows.length} بنداً`} flush>
          <DataTable
            rows={rows}
            rowKey={(row) => `${row.section}|${row.line}`}
            columns={[
              { key: 'section', header: 'القسم', cell: (row) => row.section },
              { key: 'line', header: 'الوصف', cell: (row) => row.line },
              { key: 'net', header: 'الوعاء', align: 'num', cell: (row) => money(row.net) },
              { key: 'vat', header: 'الضريبة', align: 'num', cell: (row) => money(row.vat) },
            ]}
          />
        </Panel>
      )}

      <Panel title={`الإقرارات المقدَّمة — ${rows2.length}`} flush>
        <DataTable
          rows={rows2}
          rowKey={(row) => row.id}
          columns={[
            {
              key: 'period',
              header: 'الفترة',
              cell: (row) => `${row.periodFrom} .. ${row.periodTo}`,
            },
            { key: 'net', header: 'الصافي', align: 'num', cell: (row) => money(row.netVat) },
            {
              key: 'journal',
              header: 'قيد التسوية',
              cell: (row) =>
                row.journalEntryId ? (
                  <Link className="btn" href={`/accounting/journal-entries/${row.journalEntryId}`}>
                    عرض القيد
                  </Link>
                ) : (
                  <span className="muted">صفر — بلا قيد</span>
                ),
            },
            { key: 'closed', header: 'الفترات المقفلة', align: 'num', cell: (row) => String(row.closedPeriodIds?.length ?? 0) },
            { key: 'filedAt', header: 'تاريخ التقديم', cell: (row) => row.filedAt.slice(0, 10) },
          ]}
          empty="لا إقرارات مقدَّمة بعد"
        />
      </Panel>
    </Screen>
  );
}
