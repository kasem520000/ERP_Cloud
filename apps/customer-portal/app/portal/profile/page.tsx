'use client';

import { ContentPanel, PageFrame, PageHeader } from '@erp/ui/page';

import { PortalShell, usePortalProfile } from '../../../components/portal-shell';
import { moneyText } from '../../../lib/format';

function Details() {
  const { profile } = usePortalProfile();
  const party = profile?.party;
  const company = profile?.company;

  return (
    <PageFrame>
      <PageHeader
        title="بياناتي"
        eyebrow="الحساب"
        description="هذه هي البيانات المسجلة لك في دفاتر المورد. لتعديلها تواصل معه مباشرة — البوابة لا تعدّل البيانات الأساسية."
      />
      <div className="portal-details-grid">
        <ContentPanel title="بطاقتي لدى المورد">
          <dl className="portal-details">
            <div>
              <dt>الاسم</dt>
              <dd>{party?.name ?? '—'}</dd>
            </div>
            <div>
              <dt>رقم العميل</dt>
              <dd className="num" dir="auto">
                {party?.code ?? '—'}
              </dd>
            </div>
            <div>
              <dt>الرقم الضريبي</dt>
              <dd className="num" dir="auto">
                {party?.taxNo || '—'}
              </dd>
            </div>
            <div>
              <dt>الجوال</dt>
              <dd className="num" dir="auto">
                {party?.phone || '—'}
              </dd>
            </div>
            <div>
              <dt>البريد</dt>
              <dd dir="auto">{party?.email || '—'}</dd>
            </div>
            <div>
              <dt>حد الائتمان</dt>
              <dd className="num" dir="auto">
                {moneyText(party?.creditLimit ?? '0')}
              </dd>
            </div>
            <div>
              <dt>الرصيد الحالي</dt>
              <dd className="num" dir="auto">
                <strong>{moneyText(profile?.balance ?? '0')}</strong>
              </dd>
            </div>
          </dl>
        </ContentPanel>
        <ContentPanel title="بيانات المورد">
          <dl className="portal-details">
            <div>
              <dt>المنشأة</dt>
              <dd>{company?.nameAr || '—'}</dd>
            </div>
            <div>
              <dt>Company</dt>
              <dd dir="auto">{company?.nameEn || '—'}</dd>
            </div>
            <div>
              <dt>الرقم الضريبي</dt>
              <dd className="num" dir="auto">
                {company?.taxNo || '—'}
              </dd>
            </div>
            <div>
              <dt>البريد</dt>
              <dd>{company?.email ? <a href={`mailto:${company.email}`}>{company.email}</a> : '—'}</dd>
            </div>
            <div>
              <dt>الهواتف</dt>
              <dd dir="auto">{company?.phones?.length ? company.phones.join(' · ') : '—'}</dd>
            </div>
          </dl>
        </ContentPanel>
      </div>
    </PageFrame>
  );
}

export default function ProfilePage() {
  return (
    <PortalShell>
      <Details />
    </PortalShell>
  );
}
