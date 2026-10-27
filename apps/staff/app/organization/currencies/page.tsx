'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Panel } from '@erp/ui';
import { dayInMakkah } from '@erp/web-core/date';

import { DataTable, Notice } from '../../../components/data-view';
import { ErrorBox, Loading, Screen } from '../../../components/screen';
import { apiErrorText, apiList, apiPost } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

/**
 * MF-28 / r46 / D12 — «العملات وأسعار الصرف»:
 *  • العملات المفعّلة (وتفعيل عملة جديدة) · آخر أسعار الجدول النافذة · تسجيل سعر جديد
 *    (لا سعر حر: الفواتير والسندات تُسعَّر من هذا الجدول ضمن ±5%)؛
 *  • «إعادة تقييم تاريخ» تشغِّل قيداً غير محقَّق + **عكسه الآلي** (Fiscal close hygiene)؛
 *  • سجل عمليات إعادة التقييم بروابط القيود.
 * القراءة `organization.currency.view` · تسجيل سعر/تفعيل `organization.currency.manage` ·
 * التشغيل `accounting.journal.post` (حارس الخادم نفسه).
 */
type Currency = { code: string; nameAr: string; isBase: boolean; isActive: boolean; minorUnits: number };
type FxRate = { id: string; fromCode: string; toCode: string; rate: string; effectiveFrom: string };
type Run = {
  id: string;
  runDate: string;
  status: string;
  journalEntryId: string | null;
  reversalEntryId: string | null;
  gainLoss: string;
};

const iso = (date: Date) => dayInMakkah(date);
const rateFmt = (value: string) => {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(4) : String(value);
};

export default function CurrenciesPage() {
  const { can } = useSession();
  const currencies = useQuery<Currency[]>(() => apiList<Currency>('/currencies'), []);
  const rates = useQuery<FxRate[]>(() => apiList<FxRate>('/fx-rates'), []);
  const runs = useQuery<Run[]>(() => apiList<Run>('/accounting/fx-revaluation-runs'), []);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string } | undefined>();

  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [fromCode, setFromCode] = useState('USD');
  const [toCode, setToCode] = useState('SAR');
  const [rateDate, setRateDate] = useState(iso(new Date()));
  const [quote, setQuote] = useState('');
  const [runDate, setRunDate] = useState(iso(new Date()));

  async function run(action: () => Promise<unknown>, okText: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      await action();
      setNotice({ kind: 'ok', text: okText });
      currencies.reload();
      rates.reload();
      runs.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  if (currencies.status === 'loading' || rates.status === 'loading' || runs.status === 'loading') return <Loading />;
  if (currencies.status !== 'success' || rates.status !== 'success' || runs.status !== 'success') {
    return (
      <Screen title="العملات وأسعار الصرف" crumbs={['الإعدادات']}>
        <ErrorBox
          message={currencies.error ?? rates.error ?? runs.error ?? 'تعذّر تحميل بيانات العملات'}
          onRetry={() => {
            currencies.reload();
            rates.reload();
            runs.reload();
          }}
        />
      </Screen>
    );
  }

  const currencyRows = currencies.data ?? [];
  const rateRows = rates.data ?? [];
  const runRows = [...(runs.data ?? [])].sort((a, b) => (a.runDate < b.runDate ? 1 : -1));

  return (
    <Screen
      title="العملات وأسعار الصرف"
      subtitle="جدول الأسعار النافذ مصدر التسعير الوحيد — لا سعر حر في الفاتورة أو السند"
      crumbs={['الإعدادات', 'تعاريف المنشأة']}
    >
      <Panel title="العملات">
        <Notice notice={notice} />
        <DataTable
          rows={currencyRows}
          rowKey={(row) => row.code}
          columns={[
            { key: 'code', header: 'الرمز', cell: (row) => <span dir="ltr">{row.code}</span> },
            { key: 'name', header: 'الاسم', cell: (row) => row.nameAr },
            { key: 'base', header: 'العملة الأساسية', cell: (row) => (row.isBase ? 'نعم' : '—') },
            {
              key: 'active',
              header: 'الحالة',
              cell: (row) => (row.isActive ? <span className="badge active">مفعّلة</span> : <span className="badge">موقوفة</span>),
            },
            { key: 'minor', header: 'الخانات العشرية', align: 'num', cell: (row) => String(row.minorUnits ?? 2) },
          ]}
          empty="لا عملات مفعّلة"
        />
        {can('organization.currency.manage') && (
          <div className="row" style={{ marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
            <label className="field">
              <span>رمز العملة (ISO)</span>
              <input className="input" dir="ltr" maxLength={3} value={newCode} onChange={(e) => setNewCode(e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span>الاسم</span>
              <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </label>
            <button
              className="btn"
              type="button"
              disabled={busy || newCode.trim().length !== 3 || !newName.trim()}
              onClick={() =>
                run(async () => {
                  await apiPost<Currency>('/currencies', { code: newCode.trim().toUpperCase(), nameAr: newName.trim(), isActive: true });
                  setNewCode('');
                  setNewName('');
                }, 'فُعِّلت العملة وأصبحت متاحة للتسعير.')
              }
            >
              تفعيل عملة
            </button>
          </div>
        )}
      </Panel>

      <Panel title={`آخر أسعار الصرف — ${rateRows.length}`} flush>
        <DataTable
          rows={rateRows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'pair', header: 'الزوج', cell: (row) => <span dir="ltr">{`${row.fromCode} → ${row.toCode}`}</span> },
            { key: 'rate', header: 'السعر', align: 'num', cell: (row) => <span dir="ltr">{rateFmt(row.rate)}</span> },
            { key: 'from', header: 'سارح من', cell: (row) => row.effectiveFrom },
          ]}
          empty="لا أسعار مسجَّلة — سجّل سعراً قبل أي فاتورة أجنبية"
        />
        {can('organization.currency.manage') && (
          <div className="row" style={{ marginTop: 12, alignItems: 'flex-end', flexWrap: 'wrap', gap: 8 }}>
            <label className="field">
              <span>من</span>
              <input className="input" dir="ltr" maxLength={3} value={fromCode} onChange={(e) => setFromCode(e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span>إلى</span>
              <input className="input" dir="ltr" maxLength={3} value={toCode} onChange={(e) => setToCode(e.target.value.toUpperCase())} />
            </label>
            <label className="field">
              <span>من تاريخ</span>
              <input className="input" type="date" value={rateDate} onChange={(e) => setRateDate(e.target.value)} />
            </label>
            <label className="field">
              <span>السعر</span>
              <input className="input" dir="ltr" inputMode="decimal" value={quote} onChange={(e) => setQuote(e.target.value)} />
            </label>
            <button
              className="btn"
              type="button"
              disabled={busy || !quote.trim() || fromCode === toCode || !rateDate}
              onClick={() =>
                run(async () => {
                  await apiPost<FxRate>('/fx-rates', {
                    fromCode: fromCode.trim().toUpperCase(),
                    toCode: toCode.trim().toUpperCase(),
                    rate: quote.trim(),
                    effectiveFrom: rateDate,
                  });
                  setQuote('');
                }, 'سُجِّل السعر في الجدول النافذ.')
              }
            >
              تسجيل سعر
            </button>
          </div>
        )}
      </Panel>

      <Panel title="إعادة تقييم نهاية الفترة">
        <div className="form-grid">
          <label className="field">
            <span>تاريخ التشغيل</span>
            <input className="input" type="date" value={runDate} onChange={(e) => setRunDate(e.target.value)} />
          </label>
        </div>
        <div className="row">
          {can('accounting.journal.post') && (
            <button
              className="btn primary"
              type="button"
              disabled={busy || !runDate}
              onClick={() => {
                if (!window.confirm('سيقيّد التشغيل فروق غير محققة على الفواتير الأجنبية المفتوحة ويعكسها آلياً في اليوم التالي. متابعة؟')) return;
                return run(async () => {
                  const result = await apiPost<Run>('/accounting/fx-revaluation-runs', { date: runDate });
                  setNotice({
                    kind: 'ok',
                    text: result.journalEntryId
                      ? `أُعيد التقييم بصافي ${Number(result.gainLoss).toFixed(4)} — قيد وعكسه آلي بتاريخ غد (${result.runDate}).`
                      : `لا أرصدة أجنبية مفتوحة في ${result.runDate} — بلا قيد.`,
                  });
                }, 'اكتمل تشغيل إعادة التقييم.');
              }}
            >
              تشغيل إعادة التقييم
            </button>
          )}
          <Link className="btn" href="/accounting/journal-entries">
            دفتر القيود
          </Link>
        </div>
      </Panel>

      <Panel title={`سجل عمليات إعادة التقييم — ${runRows.length}`} flush>
        <DataTable
          rows={runRows}
          rowKey={(row) => row.id}
          columns={[
            { key: 'date', header: 'التاريخ', cell: (row) => row.runDate },
            { key: 'net', header: 'الصافي غير المحقَّق', align: 'num', cell: (row) => Number(row.gainLoss).toFixed(4) },
            {
              key: 'journal',
              header: 'القيد',
              cell: (row) =>
                row.journalEntryId ? (
                  <Link className="btn" href={`/accounting/journal-entries/${row.journalEntryId}`}>
                    عرض القيد
                  </Link>
                ) : (
                  <span className="muted">صفر — بلا قيد</span>
                ),
            },
            {
              key: 'reversal',
              header: 'العكس الآلي',
              cell: (row) =>
                row.reversalEntryId ? (
                  <Link className="btn" href={`/accounting/journal-entries/${row.reversalEntryId}`}>
                    عرض العكس
                  </Link>
                ) : (
                  <span className="muted">—</span>
                ),
            },
            { key: 'status', header: 'الحالة', cell: (row) => (row.status === 'posted' ? 'مُرحَّل' : row.status) },
          ]}
          empty="لا عمليات إعادة تقييم بعد"
        />
      </Panel>
    </Screen>
  );
}
