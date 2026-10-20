'use client';

import { useEffect, useState } from 'react';
import { Panel } from '@erp/ui';

import { DataTable, Notice } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { apiErrorText } from '../../../lib/api';
import { forecast, type CrmDeal, type CrmForecast } from '../../../lib/crm';

export default function CrmForecastPage() {
  const [summary, setSummary] = useState<CrmForecast>();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info' | 'warn'; text: string }>();

  useEffect(() => {
    void forecast()
      .then(setSummary)
      .catch((error: unknown) => setNotice({ kind: 'danger', text: apiErrorText(error) }));
  }, []);

  return (
    <Screen
      title="تنبؤ المبيعات"
      subtitle="مجموع قيمة الصفقات المفتوحة مضروباً في احتمالها. الرابحة والخاسرة لا تدخلان."
      crumbs={['المبيعات', 'التنبؤ']}
      kpis={[
        { label: 'القيمة المرجّحة', value: summary?.weighted ?? '0.0000', hint: 'القيمة × احتمال الإغلاق' },
        {
          label: 'صفقات مفتوحة',
          value: summary?.openCount ?? summary?.count ?? 0,
          hint: 'الرابحة والخاسرة مستثناة',
        },
      ]}
    >
      <Notice notice={notice} />
      <Panel title="الصفقات المفتوحة" hint="مرتّبة وفق ما يعيده الخادم — القيمة الخام واحتمال الإغلاق." flush>
        <DataTable
          columns={[
            { key: 'title', header: 'الصفقة', cell: (row: CrmDeal) => row.title },
            { key: 'value', header: 'القيمة', cell: (row: CrmDeal) => row.value },
            { key: 'probability', header: 'الاحتمال', cell: (row: CrmDeal) => `${row.probability}%` },
          ]}
          rows={summary?.deals ?? []}
          rowKey={(row) => row.id}
          empty="لا توجد صفقات مفتوحة في المسار حالياً."
        />
      </Panel>
    </Screen>
  );
}
