'use client';

import { useState } from 'react';

import { Directory, type Tile } from '../../../components/directory';
import { apiErrorText, apiList, apiPost } from '../../../lib/api';
import { accountLabel, listAccounts, postableOf, typeOf, type Account } from '../../../lib/accounts';
import { useQuery } from '../../../lib/use-query';

type Schedule = {
  id: string;
  kind: string;
  sourceType: string;
  sourceId: string | null;
  status: string;
  expenseAccountId: string;
  deferralAccountId: string;
  totalAmount: string;
  installmentAmount: string;
  months: number;
  startDate: string;
  generatedCount: number;
  balance?: string | null;
  remainingMonths?: number;
};

type Voucher = { id: string; number?: string | null; amount: string; status?: string; kind?: string };

const KIND_LABELS: Record<string, string> = { prepaid: 'مقدّم', accrual: 'مستحق' };
const SOURCE_LABELS: Record<string, string> = { voucher: 'سند صرف', purchase_invoice: 'فاتورة شراء', manual: 'يدوي' };
const STATUS_LABELS: Record<string, string> = { active: 'نشط', completed: 'مكتمل', cancelled: 'ملغى' };

/** القسط التالي = تاريخ البداية + عدد الأقساط المولَّدة (نفس رياضية الخادم). */
function nextPeriodOf(row: Schedule): string {
  const parts = row.startDate.split('-').map(Number);
  const year = parts[0] ?? 0;
  const month = parts[1] ?? 1;
  const elapsedMonths = year * 12 + (month - 1) + (row.generatedCount ?? 0);
  const y = Math.floor(elapsedMonths / 12);
  const m = (elapsedMonths % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/**
 * MF-22 — جداول المصروفات المقدّمة والمستحقة.
 *
 * الشاشة تفعل اثنين: تُنشئ جدولاً من سند صرف مرحَّل (أو بمفرده للاستحقاق)، وتولّد
 * القسط التالي بضغطة واحدة لكل فترة. كل توليد قيد حيّ عبر `POST
 * /amortization-schedules/:id/generate` — التكرار والفترة المغلقة يُرَدان من الخادم
 * (409/409) ويظهر سببهما في التنبيه.
 */
export default function AmortizationSchedulesPage() {
  const schedules = useQuery<Schedule[]>(() => apiList<Schedule>('/amortization-schedules'), []);
  const accounts = useQuery<Account[]>(() => listAccounts(), []);
  const vouchers = useQuery<Voucher[]>(() => apiList<Voucher>('/vouchers'), []);
  const [busyId, setBusyId] = useState<string | null>(null);

  const rows = schedules.data ?? [];
  const expenseAccounts = (accounts.data ?? []).filter((account) => postableOf(account) && typeOf(account) === 'expense');
  const deferralAccounts = (accounts.data ?? []).filter(
    (account) => postableOf(account) && (typeOf(account) === 'asset' || typeOf(account) === 'liability'),
  );
  const voucherOptions = (vouchers.data ?? [])
    .filter((voucher) => (voucher.kind ?? 'payment') === 'payment' && (voucher.status ?? 'posted') === 'posted')
    .map((voucher) => ({ id: voucher.id, label: `${voucher.number ?? voucher.id.slice(0, 8)} — ${voucher.amount}` }));

  const sumBalance = (kind: string): number =>
    rows
      .filter((row) => row.kind === kind)
      .reduce((sum, row) => sum + Number(row.balance ?? 0), 0)
      .toFixed(3)
      .replace(/\.?0+$/, '') as unknown as number;
  const tiles: Tile[] = [
    { label: 'جداول', value: rows.length, hint: `نشطة ${rows.filter((row) => row.status === 'active').length}` },
    { label: 'مقدّم قائم', value: String(sumBalance('prepaid')), hint: 'بقيّة الإطفاء بعد الأقساط المولَّدة' },
    { label: 'مستحق قائم', value: String(sumBalance('accrual')), hint: 'استحقاق مولَّد لم يُعكَس بعد' },
  ];

  return (
    <Directory<Schedule>
      listTitle="جداول المقدّم والاستحقاق"
      title="جدول إطفاء/استحقاق"
      subtitle="وزّع الإيجار المدفوع مقدماً على شهوره، أو استحدث استحقاقاً بعكس تلقائي أول الشهر التالي."
      crumbs={['المحاسبة', 'جداول المقدّم والاستحقاق']}
      query={schedules}
      tiles={tiles}
      createLabel="جدول جديد"
      formTitle="جدول مقدّم/مستحق"
      empty="لا توجد جداول بعد"
      emptyDetail="أنشئ جدولاً من سند صرف مرحَّل (إيجار سنوي مثلاً) أو جدولاً يدوياً للاستحقاق."
      blocked={
        expenseAccounts.length === 0 || deferralAccounts.length === 0
          ? 'لا يوجد حساب مصروف وحساب تسوية قابلان للترحيل في دليل الحسابات.'
          : undefined
      }
      fields={[
        { name: 'kind', label: 'النوع', type: 'select', required: true, options: [
          { id: 'prepaid', label: 'مصروف مقدّم (يُوزَّع شهرياً)' },
          { id: 'accrual', label: 'مصروف مستحق (يستحدث ويعكس تلقائياً)' },
        ] },
        { name: 'sourceType', label: 'المصدر', type: 'select', required: true, options: [
          { id: 'voucher', label: 'سند صرف (يأخذ المبلغ والتاريخ منه)' },
          { id: 'manual', label: 'يدوي (بلا سند)' },
        ] },
        { name: 'sourceId', label: 'سند الصرف', type: 'select', wide: true, options: voucherOptions, hint: 'يُستعمل مع المصدر «سند صرف» — السند المرحَّل وحده يظهر هنا.' },
        { name: 'totalAmount', label: 'الإجمالي', hint: 'يُستعمل مع المصدر اليدوي فقط — السند يحدّد الإجمالي تلقائياً.' },
        { name: 'months', label: 'عدد الشهور', type: 'number', required: true },
        { name: 'startDate', label: 'أول شهر', type: 'date', hint: 'إن تركته فارغاً يُستنتج من السند: شهر بعد تاريخه.' },
        { name: 'expenseAccountId', label: 'حساب المصروف', type: 'select', required: true, wide: true, options: expenseAccounts.map((account) => ({ id: account.id, label: accountLabel(account) })) },
        { name: 'deferralAccountId', label: 'حساب المقدّم/المستحق', type: 'select', required: true, wide: true, hint: 'مقدّم = حساب أصول غير نقدي · مستحق = حساب خصوم. لا تختار حساباً نقدياً.', options: deferralAccounts.map((account) => ({ id: account.id, label: accountLabel(account) })) },
      ]}
      onCreate={(values) =>
        apiPost('/amortization-schedules', {
          kind: String(values.kind ?? ''),
          sourceType: String(values.sourceType ?? 'voucher'),
          sourceId: values.sourceId ? String(values.sourceId) : undefined,
          totalAmount: values.totalAmount ? String(values.totalAmount) : undefined,
          months: Number(values.months ?? 0),
          startDate: values.startDate ? String(values.startDate) : undefined,
          expenseAccountId: String(values.expenseAccountId ?? ''),
          deferralAccountId: String(values.deferralAccountId ?? ''),
        })
      }
      rowLabel={(row) => `جدول ${KIND_LABELS[row.kind] ?? row.kind} ${row.startDate}`}
      successText={(values) => `تم إنشاء الجدول (${String(values.months)} شهراً). ولّد أول قسط من هذه القائمة.`}
      columns={[
        { key: 'kind', header: 'النوع', cell: (row) => KIND_LABELS[row.kind] ?? row.kind },
        { key: 'source', header: 'المصدر', cell: (row) => `${SOURCE_LABELS[row.sourceType] ?? row.sourceType}${row.sourceId ? ` · ${row.sourceId.slice(0, 8)}` : ''}` },
        { key: 'total', header: 'الإجمالي', align: 'num', cell: (row) => row.totalAmount },
        { key: 'installment', header: 'القسط', align: 'num', cell: (row) => row.installmentAmount },
        { key: 'progress', header: 'التوليد', align: 'num', cell: (row) => `${row.generatedCount}/${row.months}` },
        { key: 'balance', header: 'الرصيد', align: 'num', cell: (row) => row.balance ?? '—' },
        { key: 'status', header: 'الحالة', cell: (row) => STATUS_LABELS[row.status] ?? row.status },
        {
          key: 'action',
          header: 'إجراء',
          cell: (row) =>
            row.status === 'active' ? (
              <button
                type="button"
                className="btn"
                disabled={busyId === row.id}
                onClick={async () => {
                  setBusyId(row.id);
                  try {
                    await apiPost(`/amortization-schedules/${row.id}/generate`, { period: nextPeriodOf(row) });
                    schedules.reload();
                  } catch (error) {
                    window.alert(apiErrorText(error));
                  } finally {
                    setBusyId(null);
                  }
                }}
              >
                {busyId === row.id ? 'جارٍ التوليد…' : `توليد ${nextPeriodOf(row)}`}
              </button>
            ) : (
              '—'
            ),
        },
      ]}
      rowKey={(row) => row.id}
    />
  );
}
