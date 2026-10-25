'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Directory, type Tile } from '../../../components/directory';
import { apiErrorText, apiList, apiPost } from '../../../lib/api';
import { accountLabel, listAccounts, postableOf, typeOf, type Account } from '../../../lib/accounts';
import { arabicName, listCostCenters, type CostCenter } from '../../../lib/lookups';
import { useQuery } from '../../../lib/use-query';

type Asset = {
  id: string;
  code: string;
  name: string;
  categoryId: string;
  categoryName?: string;
  cost: string;
  residualValue: string;
  method: string;
  usefulLifeMonths: number;
  inServiceDate: string;
  status: 'active' | 'disposed';
  sourceType: string;
  accumulated: string;
  bookValue: string;
};

type AssetCategory = { id: string; code: string; nameAr: string };

type DepreciationRun = {
  id: string;
  period: string;
  status: 'preview' | 'posted';
  totalAmount: string;
  journalEntryId: string | null;
};

type MovementLine = {
  period: string;
  assetCode: string;
  assetName: string;
  amount: string;
  accumulatedAfter: string;
  bookValueAfter: string;
};

const STATUS_LABELS: Record<string, string> = { active: 'نشط', disposed: 'مستبعد' };
const METHOD_LABELS: Record<string, string> = {
  straight_line: 'ثابت',
  declining: 'متناقص',
  units_of_production: 'وحدات',
};

function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * MF-21 — سجل الأصول الثابتة والتشغيلات الشهرية (D8).
 *
 * الجزء الأول دليل (Directory): تسجيل الأصول بإرث الفئة + أرصدتها المشتقة
 * (مُهلك من التشغيلات المرحَّلة ناقص الاستبعادات · صافي = تكلفة − مُهلك).
 * تحته لوحان عبر `children`:
 *   • تشغيلات الإهلاك: معاينة لشهر ثم ترحيل — التكرار والفترة المغلقة والوحدات
 *     الناقصة كلها تُردّ من الخادم (409/409/422) وتظهر أسبابها في التنبيه.
 *   • حركة الإهلاك: كشف أسطر مرحَّلة بنطاق شهور.
 */
export default function FixedAssetsPage() {
  const assets = useQuery<Asset[]>(() => apiList<Asset>('/fixed-assets'), []);
  const categories = useQuery<AssetCategory[]>(() => apiList<AssetCategory>('/asset-categories'), []);
  const accounts = useQuery<Account[]>(() => listAccounts(), []);
  const costCenters = useQuery<CostCenter[]>(() => listCostCenters(), []);
  const runs = useQuery<DepreciationRun[]>(() => apiList<DepreciationRun>('/fixed-assets/depreciation-runs'), []);

  const [runPeriod, setRunPeriod] = useState(currentPeriod());
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [busyRunId, setBusyRunId] = useState<string | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);

  const [moveFrom, setMoveFrom] = useState(currentPeriod());
  const [moveTo, setMoveTo] = useState(currentPeriod());
  const [movement, setMovement] = useState<{ lines: MovementLine[]; total: number } | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);

  const rows = assets.data ?? [];
  const activeRows = rows.filter((row) => row.status === 'active');
  const assetAccounts = (accounts.data ?? []).filter((account) => postableOf(account) && typeOf(account) === 'asset');

  const totals = activeRows.reduce(
    (acc, row) => ({
      cost: acc.cost + Number(row.cost ?? 0),
      accumulated: acc.accumulated + Number(row.accumulated ?? 0),
      book: acc.book + Number(row.bookValue ?? 0),
    }),
    { cost: 0, accumulated: 0, book: 0 },
  );

  const tiles: Tile[] = [
    { label: 'أصول نشطة', value: activeRows.length, hint: `مستبعد ${rows.length - activeRows.length}` },
    { label: 'التكلفة', value: totals.cost.toFixed(2) },
    { label: 'مُهلك', value: totals.accumulated.toFixed(2) },
    { label: 'الصافي', value: totals.book.toFixed(2), hint: 'قيمة دفترية قائمة' },
  ];

  const runRows = runs.data ?? [];

  return (
    <Directory<Asset>
      listTitle="سجل الأصول الثابتة"
      title="أصل ثابت"
      subtitle="سجّل الأصل بإرث فئته، ثم شغّل الإهلاك الشهري من اللوح أسفله — والبيع/الاستبعاد يقيّدهما الخادم بسند قبض وقيد تحرّك."
      crumbs={['المحاسبة', 'العمليات', 'سجل الأصول']}
      listHint={
        <>
          تعريف الحسابات وطرق الإهلاك في <Link href="/accounting/asset-categories">فئات الأصول الثابتة</Link>.
        </>
      }
      query={assets}
      tiles={tiles}
      createLabel="أصل جديد"
      formTitle="تسجيل أصل ثابت"
      empty="لا توجد أصول ثابتة"
      emptyDetail="عرّف فئة أولاً ثم سجّل الأصل (آلة، مبنى، مركبة…) ليبدأ إهلاكه من الشهر التالي لتشغيله."
      blocked={
        (categories.data ?? []).length === 0
          ? 'لا توجد فئات أصول — أنشئ فئتك الأولى أولاً.'
          : assetAccounts.length === 0
            ? 'لا يوجد حساب أصول قابل للترحيل في دليل الحسابات.'
            : undefined
      }
      fields={[
        { name: 'code', label: 'الرمز', required: true, ltr: true },
        { name: 'name', label: 'اسم الأصل', required: true },
        { name: 'categoryId', label: 'الفئة', type: 'select', required: true, wide: true, options: (categories.data ?? []).map((category) => ({ id: category.id, label: `${category.code} — ${category.nameAr}` })) },
        { name: 'cost', label: 'التكلفة', type: 'number', required: true, hint: 'إجمالي الكلفة (منها إن رُمّل من فاتورة).' },
        { name: 'inServiceDate', label: 'تاريخ التشغيل', type: 'date', required: true, hint: 'الإهلاك يبدأ من الشهر التالي.' },
        { name: 'reclassifyFromAccountId', label: 'حساب الانقلال (رسملة)', type: 'select', wide: true, hint: 'اختياري — إن اخترته يُنشئ الخادم قيد: مدين الأصل / دائن هذا الحساب بنفس التكلفة.', options: assetAccounts.map((account) => ({ id: account.id, label: accountLabel(account) })) },
        { name: 'costCenterId', label: 'مركز التكلفة', type: 'select', options: (costCenters.data ?? []).map((center) => ({ id: center.id, label: `${center.code} — ${arabicName(center)}` })) },
      ]}
      onCreate={(values) =>
        apiPost('/fixed-assets', {
          code: String(values.code),
          name: String(values.name),
          categoryId: String(values.categoryId),
          cost: String(values.cost),
          inServiceDate: String(values.inServiceDate),
          reclassifyFromAccountId: values.reclassifyFromAccountId ? String(values.reclassifyFromAccountId) : undefined,
          costCenterId: values.costCenterId ? String(values.costCenterId) : undefined,
        })
      }
      footer={(assetRows) => {
        const active = assetRows.filter((row) => row.status === 'active');
        const acqSum = active.reduce((sum, row) => sum + Number(row.cost ?? 0), 0);
        const accSum = active.reduce((sum, row) => sum + Number(row.accumulated ?? 0), 0);
        const netSum = active.reduce((sum, row) => sum + Number(row.bookValue ?? 0), 0);
        return [
          <span key="cost">الأصول النشطة: {active.length}</span>,
          <span key="totals">التكلفة {acqSum.toFixed(2)} · المُهلك {accSum.toFixed(2)} · الصافي {netSum.toFixed(2)}</span>,
        ];
      }}
      rowLabel={(row) => `الأصل ${row.code} ${row.name}`}
      successText={(values) => `تم تسجيل الأصل «${String(values.code)}» — راقب قسطه في تشغيلات الإهلاك أسفل القائمة.`}
      columns={[
        { key: 'code', header: 'الرمز', align: 'ltr', cell: (row) => row.code },
        { key: 'name', header: 'الأصل', cell: (row) => row.name },
        { key: 'category', header: 'الفئة', cell: (row) => row.categoryName ?? '—' },
        { key: 'cost', header: 'التكلفة', align: 'num', cell: (row) => row.cost },
        { key: 'accumulated', header: 'مُهلك', align: 'num', cell: (row) => row.accumulated },
        { key: 'book', header: 'الصافي', align: 'num', cell: (row) => row.bookValue },
        { key: 'method', header: 'الطريقة', cell: (row) => METHOD_LABELS[row.method] ?? row.method },
        { key: 'status', header: 'الحالة', cell: (row) => STATUS_LABELS[row.status] ?? row.status },
        { key: 'source', header: 'المصدر', cell: (row) => (row.sourceType === 'purchase_invoice' ? 'فاتورة شراء' : row.sourceType === 'journal' ? 'قيد' : 'يدوي') },
      ]}
      rowKey={(row) => row.id}
    >
      {/* لوح تشغيلات الإهلاك — معاينة بلا قيد ثم ترحيل (MF-21). */}
      <section aria-label="تشغيلات الإهلاك" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>تشغيلات الإهلاك الشهرية</h2>
        <p style={{ color: 'var(--muted, #667)', fontSize: 13, margin: '0 0 10px' }}>
          المعاينة تحسب الأقساط ولا تكتب قيداً؛ الترحيل يُنشئ قيداً مجمَّعاً واحداً لتاريخ آخر يوم
          الشهر. التشغيل الواحد لكل فترة — والفترة المغلقة تُردّ قبل أي حساب.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <label htmlFor="run-period" style={{ fontSize: 13 }}>الفترة</label>
          <input
            id="run-period"
            className="input"
            style={{ width: 130 }}
            placeholder="YYYY-MM"
            value={runPeriod}
            onChange={(event) => setRunPeriod(event.target.value)}
          />
          <button
            type="button"
            className="btn"
            disabled={previewBusy}
            onClick={async () => {
              setPreviewBusy(true);
              setRunMsg(null);
              try {
                const created = await apiPost<{ totalAmount?: string; lines?: unknown[] }>(
                  '/fixed-assets/depreciation-runs',
                  { period: runPeriod },
                );
                const lines = Array.isArray(created?.lines) ? created.lines.length : 0;
                setRunMsg(`معاينة ${runPeriod} جاهزة: ${lines} أصل بمبلغ ${created?.totalAmount ?? '—'} — رُحّلها من الجدول.`);
                runs.reload();
              } catch (error) {
                setRunMsg(apiErrorText(error));
              } finally {
                setPreviewBusy(false);
              }
            }}
          >
            {previewBusy ? 'جارٍ الحساب…' : `معاينة ${runPeriod || '…'}`}
          </button>
          {runMsg ? (
            <span role="status" style={{ fontSize: 13 }}>{runMsg}</span>
          ) : null}
        </div>
        {runRows.length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted, #667)' }}>لا تشغيلات بعد — ابدأ بمعاينة الفترة الحالية.</p>
        ) : (
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th scope="col">الفترة</th>
                <th scope="col">الحالة</th>
                <th scope="col">المبلغ</th>
                <th scope="col">قيد الترحيل</th>
                <th scope="col">إجراء</th>
              </tr>
            </thead>
            <tbody>
              {runRows.map((run) => (
                <tr key={run.id}>
                  <td style={{ fontFamily: 'monospace' }}>{run.period?.slice(0, 7)}</td>
                  <td>{run.status === 'posted' ? 'مرحَّل' : 'معاينة'}</td>
                  <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{run.totalAmount}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{run.journalEntryId ? run.journalEntryId.slice(0, 8) : '—'}</td>
                  <td>
                    {run.status === 'preview' ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={busyRunId === run.id}
                        onClick={async () => {
                          setBusyRunId(run.id);
                          setRunMsg(null);
                          try {
                            await apiPost(`/fixed-assets/depreciation-runs/${run.id}/post`, {});
                            setRunMsg(`رُحّل تشغيل ${run.period.slice(0, 7)} — قيد مجمَّع بتاريخ آخر يوم الشهر.`);
                            runs.reload();
                            assets.reload();
                          } catch (error) {
                            setRunMsg(apiErrorText(error));
                          } finally {
                            setBusyRunId(null);
                          }
                        }}
                      >
                        {busyRunId === run.id ? 'جارٍ الترحيل…' : 'ترحيل'}
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* لوح حركة الإهلاك — كشف مُرحَّل بنطاق شهور (MF-21). */}
      <section aria-label="حركة الإهلاك" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>حركة الإهلاك (كشف)</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <label htmlFor="move-from" style={{ fontSize: 13 }}>من</label>
          <input id="move-from" className="input" style={{ width: 130 }} placeholder="YYYY-MM" value={moveFrom} onChange={(event) => setMoveFrom(event.target.value)} />
          <label htmlFor="move-to" style={{ fontSize: 13 }}>إلى</label>
          <input id="move-to" className="input" style={{ width: 130 }} placeholder="YYYY-MM" value={moveTo} onChange={(event) => setMoveTo(event.target.value)} />
          <button
            type="button"
            className="btn"
            disabled={moveBusy}
            onClick={async () => {
              setMoveBusy(true);
              try {
                const result = await apiList<MovementLine>(
                  `/statements/depreciation-movement?from=${moveFrom}&to=${moveTo}`,
                );
                const lines = Array.isArray(result) ? result : [];
                setMovement({
                  lines,
                  total: lines.reduce((sum, line) => sum + Number(line.amount ?? 0), 0),
                });
              } catch (error) {
                setMovement({ lines: [], total: 0 });
                window.alert(apiErrorText(error));
              } finally {
                setMoveBusy(false);
              }
            }}
          >
            {moveBusy ? 'جارٍ الجلب…' : 'عرض الحركة'}
          </button>
        </div>
        {movement ? (
          movement.lines.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--muted, #667)' }}>لا أسطر مرحَّلة في هذا النطاق.</p>
          ) : (
            <table className="table" style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th scope="col">الفترة</th>
                  <th scope="col">الأصل</th>
                  <th scope="col">القسط</th>
                  <th scope="col">مُهلك حتى هنا</th>
                  <th scope="col">صافي بعد القسط</th>
                </tr>
              </thead>
              <tbody>
                {movement.lines.map((line, index) => (
                  <tr key={`${line.period}-${line.assetCode}-${index}`}>
                    <td style={{ fontFamily: 'monospace' }}>{line.period?.slice(0, 7)}</td>
                    <td>{line.assetCode} — {line.assetName}</td>
                    <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{line.amount}</td>
                    <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{line.accumulatedAfter}</td>
                    <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{line.bookValueAfter}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}><strong>الإجمالي</strong></td>
                  <td style={{ textAlign: 'left', fontFamily: 'monospace' }}><strong>{movement.total.toFixed(4)}</strong></td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )
        ) : null}
      </section>
    </Directory>
  );
}
