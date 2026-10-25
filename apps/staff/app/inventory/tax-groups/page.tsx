'use client';

import { useMemo } from 'react';
import { Badge } from '@erp/ui';

import { Directory } from '../../../components/directory';
import { apiDelete, apiPatch, apiPost } from '../../../lib/api';
import {
  arabicName,
  listAccounts,
  listTaxGroups,
  type Account,
  type TaxGroup,
} from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

function formatRatePercent(raw: string | number | undefined): string {
  const num = Number(raw ?? 0);
  if (!Number.isFinite(num)) return '0%';
  const fixed = Number.isInteger(num) ? String(num) : num.toFixed(2).replace(/\.?0+$/, '');
  return `${fixed}%`;
}

export default function TaxGroupsPage() {
  const { can } = useSession();
  const taxGroups = useQuery<TaxGroup[]>(() => listTaxGroups(), []);
  const accounts = useQuery<Account[]>(
    () => (can('accounting.account.view') ? listAccounts() : Promise.resolve([])),
    [can],
  );

  const rows = taxGroups.data ?? [];
  const accountOptions = useMemo(() => {
    const postable = (accounts.data ?? []).filter(
      (acc) => acc.isPostable !== false && acc.is_postable !== false,
    );
    return [
      { id: '', label: '— بدون ربط خاص (يُستخدم حساب الضريبة العام) —' },
      ...postable.map((acc) => ({
        id: acc.id,
        label: `${acc.code} — ${arabicName(acc)}`,
      })),
    ];
  }, [accounts.data]);

  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((acc) => [acc.id, `${acc.code} — ${arabicName(acc)}`])),
    [accounts.data],
  );

  const defaultVatAccountId = useMemo(() => {
    const vat = (accounts.data ?? []).find((acc) => acc.code === '2222001');
    return vat?.id ?? '';
  }, [accounts.data]);

  const taxableCount = rows.filter((row) => Number(row.rate) > 0).length;
  const zeroCount = rows.filter((row) => Number(row.rate) === 0).length;

  return (
    <Directory<TaxGroup>
      listTitle="المجموعات الضريبية"
      title="بطاقة مجموعة ضريبية"
      subtitle="تعريف فئات ونِسب الضريبة المعتمدة للأصناف والفواتير (ضريبة القيمة المضافة 15%، ضريبة صفرية 0%…)."
      crumbs={['المستودعات', 'التعاريف']}
      query={taxGroups}
      canCreate={can('catalog.taxgroup.manage')}
      createLabel="مجموعة ضريبية جديدة"
      initial={{ rate: '15', vatAccountId: defaultVatAccountId, isInclusiveDefault: false }}
      tiles={[
        { label: 'إجمالي المجموعات', value: rows.length, hint: 'مجموعة ضريبية معرّفة', tone: 'brand' },
        { label: 'خاضعة للضريبة', value: taxableCount, hint: 'نسبة أكبر من 0%', tone: 'ok' },
        { label: 'ضريبة صفرية (0%)', value: zeroCount, hint: 'نسبة 0%' },
      ]}
      fields={[
        { name: 'nameAr', label: 'الاسم العربي', required: true, placeholder: 'ضريبة القيمة المضافة' },
        { name: 'nameEn', label: 'الاسم الإنجليزي', ltr: true, placeholder: 'VAT 15%' },
        {
          name: 'rate',
          label: 'النسبة الضريبية (%)',
          type: 'number',
          required: true,
          ltr: true,
          placeholder: '15',
          hint: 'تُكتب كنسبة مئوية (مثال: 15 تعني 15%، و 0 تعني 0%).',
        },
        {
          name: 'vatAccountId',
          label: 'حساب الضريبة',
          type: 'select',
          options: accountOptions,
        },
        {
          name: 'isInclusiveDefault',
          label: 'الأسعار شاملة الضريبة افتراضياً',
          type: 'checkbox',
        },
      ]}
      onCreate={(values) => {
        const vatAccountId = String(values.vatAccountId ?? '').trim();
        return apiPost('/organization/catalog/tax-groups', {
          nameAr: String(values.nameAr).trim(),
          nameEn: String(values.nameEn ?? '').trim() || undefined,
          rate: String(values.rate ?? '0').trim(),
          vatAccountId: vatAccountId || undefined,
          isInclusiveDefault: Boolean(values.isInclusiveDefault),
        });
      }}
      edit={
        can('catalog.taxgroup.manage')
          ? {
              toForm: (row) => ({
                nameAr: row.nameAr ?? row.name_ar ?? '',
                nameEn: row.nameEn ?? row.name_en ?? '',
                rate: String(Number(row.rate ?? 0)),
                vatAccountId: row.vatAccountId ?? row.vat_account_id ?? '',
                isInclusiveDefault: Boolean(row.isInclusiveDefault ?? row.is_inclusive_default),
              }),
              onUpdate: (row, values) => {
                const vatAccountId = String(values.vatAccountId ?? '').trim();
                return apiPatch(`/organization/catalog/tax-groups/${row.id}`, {
                  nameAr: String(values.nameAr).trim(),
                  nameEn: String(values.nameEn ?? '').trim() || null,
                  rate: String(values.rate ?? '0').trim(),
                  vatAccountId: vatAccountId || null,
                  isInclusiveDefault: Boolean(values.isInclusiveDefault),
                });
              },
            }
          : undefined
      }
      onDelete={
        can('catalog.taxgroup.manage')
          ? (row) => apiDelete(`/organization/catalog/tax-groups/${row.id}`)
          : undefined
      }
      rowLabel={(row) => `المجموعة الضريبية «${arabicName(row)}»`}
      successText={(values) => `تم حفظ المجموعة الضريبية «${String(values.nameAr)}».`}
      rowKey={(row) => row.id}
      empty="لا توجد مجموعات ضريبية معرّفة"
      columns={[
        { key: 'name', header: 'المجموعة الضريبية', cell: (row) => arabicName(row) },
        {
          key: 'rate',
          header: 'النسبة',
          align: 'ltr',
          cell: (row) => (
            <Badge tone={Number(row.rate) > 0 ? 'brand' : 'neutral'}>
              {formatRatePercent(row.rate)}
            </Badge>
          ),
        },
        {
          key: 'vatAccount',
          header: 'حساب الضريبة',
          cell: (row) => {
            const id = row.vatAccountId ?? row.vat_account_id;
            return id ? (accountById.get(id) ?? 'مرتبط بحساب ضريبة') : '— افتراضي —';
          },
        },
        {
          key: 'inclusive',
          header: 'شامل الضريبة افتراضياً',
          cell: (row) =>
            row.isInclusiveDefault || row.is_inclusive_default ? 'نعم' : 'لا',
        },
      ]}
    />
  );
}
