'use client';

import { PageHead, Panel } from '@erp/ui';

import { PortalShell, usePortalProfile } from '../../../components/portal-shell';
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
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td className="muted">الاسم</td>
                  <td>{party?.name ?? '—'}</td>
                </tr>
                <tr>
                  <td className="muted">رقم العميل</td>
                  <td>{party?.code ?? '—'}</td>
                </tr>
                <tr>
                  <td className="muted">الرقم الضريبي</td>
                  <td>
                    <bdi dir="ltr">{party?.taxNo || '—'}</bdi>
                  </td>
                </tr>
                <tr>
                  <td className="muted">الجوال</td>
                  <td>
                    <bdi dir="ltr">{party?.phone || '—'}</bdi>
                  </td>
                </tr>
                <tr>
                  <td className="muted">البريد</td>
                  <td>
                    <bdi dir="ltr">{party?.email || '—'}</bdi>
                  </td>
                </tr>
                <tr>
                  <td className="muted">حد الائتمان</td>
                  <td>{moneyText(party?.creditLimit ?? '0')}</td>
                </tr>
                <tr>
                  <td className="muted">الرصيد الحالي</td>
                  <td>
                    <strong>{moneyText(profile?.balance ?? '0')}</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Panel>

        <Panel title="بيانات المورد" flush>
          <div className="table-wrap">
            <table>
              <tbody>
                <tr>
                  <td className="muted">المنشأة</td>
                  <td>{company?.nameAr || '—'}</td>
                </tr>
                <tr>
                  <td className="muted">Company</td>
                  <td>{company?.nameEn || '—'}</td>
                </tr>
                <tr>
                  <td className="muted">الرقم الضريبي</td>
                  <td>
                    <bdi dir="ltr">{company?.taxNo || '—'}</bdi>
                  </td>
                </tr>
                <tr>
                  <td className="muted">البريد</td>
                  <td>
                    {company?.email ? (
                      <a href={`mailto:${company.email}`}>
                        <bdi dir="ltr">{company.email}</bdi>
                      </a>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
                <tr>
                  <td className="muted">الهواتف</td>
                  <td>{company?.phones?.length ? <bdi dir="ltr">{company.phones.join(' · ')}</bdi> : '—'}</td>
                </tr>
              </tbody>
            </table>
          </div>
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
