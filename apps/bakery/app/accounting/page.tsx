'use client';

import { useMemo } from 'react';
import { Badge, Card, CardBody, CardHeader } from '@erp/ui';
import { PageFrame, PageHeader } from '@erp/ui/page';
import { useSession } from '@erp/web-core/session';

import { StaffHandoffLink } from '../../components/staff-handoff-link';
import { destinationsOf, staffBaseUrl } from '../../lib/staff-handoff';

/** The detailed books remain in staff. This page only offers one-time session handoff links. */
const ACCOUNTING_PERMISSIONS = [
  'accounting.reports.view',
  'accounting.account.view',
  'accounting.period.view',
] as const;

export default function AccountingHandoffPage() {
  const { can, me } = useSession();
  const base = staffBaseUrl();
  const destinations = useMemo(() => destinationsOf('accounting'), []);
  const grantedAny = ACCOUNTING_PERMISSIONS.some((code) => can(code));

  return (
    <PageFrame>
      <PageHeader
        eyebrow="المالية"
        title="المحاسبة التفصيلية"
        description={`انتقل إلى سجلات ${me?.membership.tenantName ?? 'المنشأة'} المالية في لوحة الموظفين، باستخدام صلاحيات حسابك الحالية.`}
        actions={
          <>
            <Badge dot status={base ? 'active' : 'pending'}>
              {base ? 'اللوحة متاحة' : 'اللوحة غير متصلة'}
            </Badge>
            <Badge dot status={grantedAny ? 'active' : 'pending'}>
              {grantedAny ? 'لديك صلاحية محاسبية' : 'يلزم منح صلاحية محاسبية'}
            </Badge>
          </>
        }
      />

      {!base ? (
        <Card>
          <CardHeader
            title="لا يمكن فتح لوحة المحاسبة الآن"
            subtitle="رابط لوحة الموظفين غير متاح لهذه المنشأة."
          />
          <CardBody>
            <p className="m-0 text-[13px] leading-relaxed text-ink">
              تواصل مع مسؤول النظام لإعداد رابط لوحة الموظفين. لن تُنشأ جلسة انتقال قبل توافر وجهة صالحة.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {!grantedAny ? (
        <Card>
          <CardHeader
            title="صلاحيات المحاسبة"
            subtitle="الوصول إلى كل سجل يعتمد على صلاحيات حسابك في لوحة الموظفين."
          />
          <CardBody>
            <p className="m-0 text-[13px] leading-relaxed text-ink">
              يمكنك فتح اللوحة، لكن عرض الأستاذ والميزان والفترات يتطلب صلاحية مناسبة. اطلبها من مسؤول المنشأة
              عند الحاجة.
            </p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="اختر السجل الذي تريد فتحه"
          subtitle="تُفتح التفاصيل في لوحة الموظفين دون نسخ القيود إلى واجهة المخابز."
        />
        <CardBody>
          <div className="grid gap-3 md:grid-cols-2">
            {destinations.map((destination) => (
              <article
                className="grid gap-2 rounded-lg border border-line bg-surface p-4 shadow-1"
                key={destination.key}
              >
                <h2 className="m-0 text-[15px] font-extrabold text-ink">{destination.labelAr}</h2>
                <p className="m-0 text-[13px] leading-relaxed text-muted">{destination.noteAr}</p>
                <StaffHandoffLink destination={destination} labelAr="افتح في لوحة المحاسبة" />
              </article>
            ))}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="أين أجد أرقام المخبز؟" />
        <CardBody>
          <p className="m-0 text-[13px] leading-relaxed text-ink">
            تقارير المبيعات والتحصيل متاحة في قسمي التقارير والخزينة. أما القيود والأستاذ وميزان المراجعة
            والفترات المالية، فتُدار في لوحة الموظفين حتى تبقى السجلات المحاسبية في مكان واحد.
          </p>
        </CardBody>
      </Card>
    </PageFrame>
  );
}
