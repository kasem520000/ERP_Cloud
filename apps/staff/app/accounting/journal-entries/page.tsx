'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { apiData } from '../../../lib/api';
import { downloadCsv } from '../../../lib/accounts';
import { sourceTypeLabel } from '../../../lib/lookups';
import { useQuery } from '../../../lib/use-query';
import { Table } from '../../../components/ui/table';

type Entry = {
  id: string;
  number: string | null;
  date: string;
  kind: string;
  status: string;
  description: string | null;
  totalDebit: string;
  totalCredit: string;
  lineCount: number;
  sourceType: string | null;
};

function money(value: string) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function JournalRegisterPage() {
  const search = useSearchParams();
  /**
   * كشف الحساب يفتح قيداً بعينه من عموده «تفاصيل» (`?entry=<id>`). وفي R10 صار للقيد
   * شاشةٌ بمعرّفه (`/accounting/journal-entries/[id]`) تحمل متنقّل النافذة المكتبية
   * (⏮ ◀ ▶ ⏭) وطباعتها — فالرابط القديم يُحوَّل إليها.
   */
  const linked = search.get('entry') ?? '';
  const router = useRouter();
  /**
   * ACC-202 (R33): النطاق الافتراضي شهر اليوم كان يُخفي القيد الافتتاحي (JE-000001 في
   * 1/1) فتفتح «القيود اليومية» بـ12 من13 ويبقى الاختلاف خفيًّا. الافتراضي الآن كل
   * القيود المرحّلة، والرابط يحمل من/to/status إن وُجدت فيُفتح النطاق المطلوب.
   */
  const [from, setFrom] = useState(search.get('from') ?? '');
  const [to, setTo] = useState(search.get('to') ?? '');
  const [status, setStatus] = useState(search.get('status') ?? '');
  const [applied, setApplied] = useState({
    from: search.get('from') ?? '',
    to: search.get('to') ?? '',
    status: search.get('status') ?? '',
  });

  /**
   * `?entry=<id>` وصل من كشف الحساب («تفاصيل») قبل R10. والآن للقيد **شاشةٌ** تُفتح
   * بمعرّفه، فيُحوَّل الرابط القديم إليها بدل أن يبقى عرضاً ثانياً داخل السجل — فالمُدخِل
   * يصل إلى المتنقّل والطباعة، والرابط لا ينكسر.
   */
  useEffect(() => {
    if (!linked) return;
    router.replace(`/accounting/journal-entries/${linked}`);
  }, [linked, router]);

  const entries = useQuery<Entry[]>(() => {
    const params = new URLSearchParams();
    if (applied.from) params.set('from', applied.from);
    if (applied.to) params.set('to', applied.to);
    if (applied.status) params.set('status', applied.status);
    return apiData<Entry[]>(`/journal-entries?${params.toString()}`);
  }, [applied]);

  const rows = entries.data ?? [];
  /** نطاق السجل ينتقل إلى شاشة القيد كما هو (فترة · حالة). */
  const scopeSuffix =
    applied.from || applied.to || applied.status
      ? `?${new URLSearchParams(
          Object.entries({ from: applied.from, to: applied.to, status: applied.status }).filter(([, value]) =>
            Boolean(value),
          ) as Array<[string, string]>,
        ).toString()}`
      : '';
  const totalDebit = rows.reduce((sum, row) => sum + Number(row.totalDebit || 0), 0);
  const totalCredit = rows.reduce((sum, row) => sum + Number(row.totalCredit || 0), 0);

  return (
    <Screen
      title="القيود اليومية"
      subtitle="سجل كل القيود المرحّلة — اترك الفترة فارغة لعرضها كاملة (بما فيها القيد الافتتاحي)."
      crumbs={['المحاسبة', 'تقارير محاسبية']}
      kpis={[
        { label: 'عدد القيود', value: rows.length, hint: 'داخل النطاق المعروض' },
        { label: 'إجمالي المدين', value: money(String(totalDebit)) },
        { label: 'إجمالي الدائن', value: money(String(totalCredit)) },
        {
          label: 'فرق المدين والدائن',
          value: money(String(totalDebit - totalCredit)),
          hint: totalDebit === totalCredit ? 'القيود متوازنة' : 'يجب أن يكون صفراً',
          tone: totalDebit === totalCredit ? 'up' : 'down',
        },
      ]}
      actions={
        <>
          <button className="btn" type="button" onClick={() => window.print()}>
            طباعة
          </button>
          <button
            className="btn"
            type="button"
            onClick={() =>
              downloadCsv(
                'journal-entries.csv',
                ['الرقم', 'التاريخ', 'البيان', 'مدين', 'دائن', 'الحالة'],
                rows.map((row) => [
                  row.number ?? '',
                  row.date,
                  row.description ?? '',
                  row.totalDebit,
                  row.totalCredit,
                  row.status,
                ]),
              )
            }
          >
            تصدير CSV
          </button>
        </>
      }
    >
      <div className="ui-filter-bar no-print">
        <div className="ui-filter-fields">
          <label className="field" style={{ marginBottom: 0 }}>
            <span>من تاريخ</span>
            <input
              className="input"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>إلى تاريخ</span>
            <input className="input" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>الحالة</span>
            <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">الكل</option>
              <option value="posted">مرحّل</option>
              <option value="draft">مسودة</option>
              <option value="void">ملغي</option>
            </select>
          </label>
        </div>
        <div className="ui-filter-actions">
          <span className="ui-filter-summary">{rows.length} قيد</span>
          <button className="btn primary" type="button" onClick={() => setApplied({ from, to, status })}>
            عرض
          </button>
        </div>
      </div>

      {entries.status === 'loading' && <Loading />}
      {entries.status === 'forbidden' && <Forbidden />}
      {entries.status === 'error' && <ErrorBox message={entries.error} onRetry={entries.reload} />}
      {entries.status === 'success' &&
        (rows.length === 0 ? (
          <Empty title="لا توجد قيود في هذه الفترة" detail="جرّب توسيع المدى الزمني أو أنشئ سند قيد جديد." />
        ) : (
          <>
            <div className="ui-panel">
              <div className="ui-panel-body" style={{ padding: 0 }}>
                <Table
                  columns={[
                    {
                      key: 'c0',
                      header: 'الرقم',
                      ltr: true,
                      cell: (row) => row.number ?? '—',
                    },
                    {
                      key: 'c1',
                      header: 'التاريخ',
                      ltr: true,
                      cell: (row) => row.date,
                    },
                    {
                      key: 'c2',
                      header: 'النوع',
                      cell: (row) => (row.kind === 'reversal' ? 'عكسي' : sourceTypeLabel(row.sourceType)),
                    },
                    {
                      key: 'c3',
                      header: 'البيان',
                      cell: (row) => row.description ?? '—',
                    },
                    {
                      key: 'c4',
                      header: 'مدين',
                      numeric: true,
                      cell: (row) => money(row.totalDebit),
                    },
                    {
                      key: 'c5',
                      header: 'دائن',
                      numeric: true,
                      cell: (row) => money(row.totalCredit),
                    },
                    {
                      key: 'c6',
                      header: 'الحالة',
                      cell: (row) => (
                        <span className={`badge ${row.status}`}>
                          {row.status === 'posted' ? 'مرحّل' : row.status === 'void' ? 'ملغي' : 'مسودة'}
                        </span>
                      ),
                    },
                    {
                      key: 'c7',
                      header: '',
                      cell: (row) => (
                        <span className="row">
                          {/*
                                    «تفاصيل» صارت باباً إلى شاشة القيد (R10) — في الرابط
         نطاقُ السجل نفسه، فيبقى المتنقّل داخل الفترة المعروضة.
                                  */}
                          <Link
                            className="btn sm"
                            href={`/accounting/journal-entries/${row.id}${scopeSuffix}`}
                          >
                            تفاصيل
                          </Link>
                          <Link className="btn sm" href={`/print/journal-entry/${row.id}`}>
                            طباعة
                          </Link>
                        </span>
                      ),
                    },
                  ]}
                  rows={rows}
                  rowKey={(row) => row.id}
                />
              </div>
            </div>
          </>
        ))}
    </Screen>
  );
}
