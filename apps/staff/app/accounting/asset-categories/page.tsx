'use client';

import Link from 'next/link';

import { Directory, type Tile } from '../../../components/directory';
import { apiList, apiPost } from '../../../lib/api';
import { accountLabel, listAccounts, postableOf, typeOf, type Account } from '../../../lib/accounts';
import { useQuery } from '../../../lib/use-query';

type AssetCategory = {
  id: string;
  code: string;
  nameAr: string;
  method: 'straight_line' | 'declining' | 'units_of_production';
  usefulLifeMonths: number;
  residualValue: string;
  decliningRatePercent: string;
  totalUnits: string | null;
  assetAccountId: string;
  accumulatedDepreciationAccountId: string;
  depreciationExpenseAccountId: string;
};

const METHOD_LABELS: Record<string, string> = {
  straight_line: 'قسط ثابت (Straight line)',
  declining: 'متناقص (Declining balance)',
  units_of_production: 'وحدات الإنتاج (Units)',
};

/**
 * MF-21 — فئات الأصول الثابتة (D8).
 *
 * الفئة تحمل «三位一体» الحسابات (أصل / مُهلك / مصروف إهلاك) وطريقة الإهلاك
 * وعمرها الإنتاجي؛ الأصل يرثها عند الإنشاء. الشاشة تعريفية (إنشاء + عرض) —
 * الإهلاك نفسه يجري من سجل الأصول.
 */
export default function AssetCategoriesPage() {
  const categories = useQuery<AssetCategory[]>(() => apiList<AssetCategory>('/asset-categories'), []);
  const accounts = useQuery<Account[]>(() => listAccounts(), []);

  const assetAccounts = (accounts.data ?? []).filter((account) => postableOf(account) && typeOf(account) === 'asset');
  const expenseAccounts = (accounts.data ?? []).filter((account) => postableOf(account) && typeOf(account) === 'expense');

  const rows = categories.data ?? [];
  const tiles: Tile[] = [
    { label: 'فئات', value: rows.length },
    { label: 'ثابت', value: rows.filter((row) => row.method === 'straight_line').length, hint: 'قسط ثابت' },
    { label: 'متناقص', value: rows.filter((row) => row.method === 'declining').length },
    { label: 'وحدات', value: rows.filter((row) => row.method === 'units_of_production').length },
  ];

  return (
    <Directory<AssetCategory>
      listTitle="فئات الأصول الثابتة"
      title="بطاقة فئة أصول"
      subtitle="عرّف الفئة مرة واحدة: حساباتها الثلاث وطريقة إهلاكها وعمرها — وكل أصل يرثها."
      crumbs={['المحاسبة', 'تعاريف', 'فئات الأصول']}
      listHint={
        <>
          الفئات تُستعمل في <Link href="/accounting/fixed-assets">سجل الأصول الثابتة</Link> —
          قيد الإهلاك الشهري والإستبعادات تُدار من هناك.
        </>
      }
      query={categories}
      tiles={tiles}
      createLabel="فئة جديدة"
      formTitle="فئة أصول ثابتة"
      empty="لا توجد فئات أصول"
      emptyDetail="أنشئ فئة (معدات، مبانٍ، وسائل نقل…) لتسند حساباتها وطريقة إهلاكها لكل أصل."
      blocked={
        assetAccounts.length < 2 || expenseAccounts.length === 0
          ? 'لا يوجد حساب أصل (اثنان: أصل + مُهلك) وحساب مصروف قابلان للترحيل في دليل الحسابات.'
          : undefined
      }
      fields={[
        { name: 'code', label: 'الرمز', required: true, ltr: true },
        { name: 'nameAr', label: 'الاسم بالعربية', required: true },
        { name: 'method', label: 'طريقة الإهلاك', type: 'select', required: true, options: [
          { id: 'straight_line', label: METHOD_LABELS.straight_line! },
          { id: 'declining', label: METHOD_LABELS.declining! },
          { id: 'units_of_production', label: METHOD_LABELS.units_of_production! },
        ] },
        { name: 'usefulLifeMonths', label: 'العمر الإنتاجي (شهور)', type: 'number', required: true, hint: 'مثال: معدة5 سنوات = 60 شهراً.' },
        { name: 'residualValue', label: 'القيمة التخريدية', type: 'number', hint: 'ما يبقى بعد العمر (0 افتراضياً).' },
        { name: 'decliningRatePercent', label: 'نسبة المتناقص % سنوياً', type: 'number', hint: 'للمتناقص فقط — مثل 24.' },
        { name: 'totalUnits', label: 'الوحدات الكلية', type: 'number', hint: 'لوحدات الإنتاج فقط — إجمالي ساعات/قطع العمر.' },
        { name: 'assetAccountId', label: 'حساب الأصول', type: 'select', required: true, wide: true, options: assetAccounts.map((account) => ({ id: account.id, label: accountLabel(account) })) },
        { name: 'accumulatedDepreciationAccountId', label: 'حساب مُهلك الأصول', type: 'select', required: true, wide: true, hint: 'حساب أصول برصيد دائن (contra) — مجمع الإهلاك.', options: assetAccounts.map((account) => ({ id: account.id, label: accountLabel(account) })) },
        { name: 'depreciationExpenseAccountId', label: 'حساب مصروف الإهلاك', type: 'select', required: true, wide: true, options: expenseAccounts.map((account) => ({ id: account.id, label: accountLabel(account) })) },
      ]}
      onCreate={(values) =>
        apiPost('/asset-categories', {
          code: String(values.code),
          nameAr: String(values.nameAr),
          method: String(values.method),
          usefulLifeMonths: Number(values.usefulLifeMonths ?? 0),
          residualValue: String(values.residualValue ?? '0') || '0',
          decliningRatePercent: String(values.decliningRatePercent ?? '0') || '0',
          totalUnits: values.totalUnits ? String(values.totalUnits) : undefined,
          assetAccountId: String(values.assetAccountId),
          accumulatedDepreciationAccountId: String(values.accumulatedDepreciationAccountId),
          depreciationExpenseAccountId: String(values.depreciationExpenseAccountId),
        })
      }
      rowLabel={(row) => `فئة ${row.nameAr}`}
      successText={(values) => `تم حفظ فئة «${String(values.nameAr)}» — أضف أصولها من سجل الأصول.`}
      columns={[
        { key: 'code', header: 'الرمز', align: 'ltr', cell: (row) => row.code },
        { key: 'name', header: 'الفئة', cell: (row) => row.nameAr },
        { key: 'method', header: 'الطريقة', cell: (row) => METHOD_LABELS[row.method] ?? row.method },
        { key: 'life', header: 'العمر', align: 'num', cell: (row) => `${row.usefulLifeMonths} شهر` },
        {
          key: 'assetAccount',
          header: 'حساب الأصل',
          cell: (row) => {
            const account = (accounts.data ?? []).find((candidate) => candidate.id === row.assetAccountId);
            return account ? accountLabel(account) : '—';
          },
        },
        {
          key: 'expenseAccount',
          header: 'مصروف الإهلاك',
          cell: (row) => {
            const account = (accounts.data ?? []).find((candidate) => candidate.id === row.depreciationExpenseAccountId);
            return account ? accountLabel(account) : '—';
          },
        },
      ]}
      rowKey={(row) => row.id}
    />
  );
}
