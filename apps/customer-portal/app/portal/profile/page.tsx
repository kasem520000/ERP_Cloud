'use client';

import { PageHead, Panel } from '@erp/ui';

import { PortalShell, usePortalProfile } from '../../../components/portal-shell';
import { PortalTable } from '../../../components/table';
import { moneyText } from '../../../lib/format';

function Details() {
  const { profile } = usePortalProfile();
  const party = profile?.party;
  const company = profile?.company;

  return (
    <>
      <PageHead
        title="بياناتي"
        description="هذه هي البيانات المسجلة لك في دفاتر المورد. لتعديلها تواصل معه مباشرة — البوابة لا تعدّل البيانات الأساسية."
      />

      <div className="grid cols">
        <Panel title="بطاقتي لدى المورد" flush>
          <PortalTable
            bare
            headless
            columns={[
              { key: 'label', header: '', cell: (row) => <span className="muted">{row.label}</span> },
              { key: 'value', header: '', cell: (row) => row.value },
            ]}
            rows={[
              { label: 'الاسم', value: party?.name ?? '—' },
              { label: 'رقم العميل', value: <bdi dir="ltr">{party?.code ?? '—'}</bdi> },
              { label: 'الرقم الضريبي', value: <bdi dir="ltr">{party?.taxNo || '—'}</bdi> },
              { label: 'الجوال', value: <bdi dir="ltr">{party?.phone || '—'}</bdi> },
              { label: 'البريد', value: party?.email ? <bdi dir="ltr">{party.email}</bdi> : '—' },
              { label: 'حد الائتمان', value: moneyText(party?.creditLimit ?? '0') },
              { label: 'الرصيد الحالي', value: <strong>{moneyText(profile?.balance ?? '0')}</strong> },
            ]}
            rowKey={(row) => row.label}
          />
        </Panel>

        <Panel title="بيانات المورد" flush>
          <PortalTable
            bare
            headless
            columns={[
              { key: 'label', header: '', cell: (row) => <span className="muted">{row.label}</span> },
              { key: 'value', header: '', cell: (row) => row.value },
            ]}
            rows={[
              { label: 'المنشأة', value: company?.nameAr || '—' },
              { label: 'الاسم الإنجليزي', value: company?.nameEn || '—' },
              { label: 'الرقم الضريبي', value: <bdi dir="ltr">{company?.taxNo || '—'}</bdi> },
              {
                label: 'البريد',
                value: company?.email ? (
                  <a href={`mailto:${company.email}`}>
                    <bdi dir="ltr">{company.email}</bdi>
                  </a>
                ) : (
                  '—'
                ),
              },
              {
                label: 'الهواتف',
                value: company?.phones?.length ? <bdi dir="ltr">{company.phones.join(' · ')}</bdi> : '—',
              },
            ]}
            rowKey={(row) => row.label}
          />
        </Panel>
      </div>
    </>
  );
}

export default function ProfilePage() {
  return (
    <PortalShell>
      <Details />
    </PortalShell>
  );
}
