'use client';

import { useMemo } from 'react';
import { Badge, Card, CardBody, CardHeader } from '@erp/ui';
import { useSession } from '@erp/web-core/session';

import { StaffHandoffLink } from '../../components/staff-handoff-link';
import {
  HANDOFF_NOTES_AR,
  STAFF_URL_ENV,
  destinationsOf,
  staffBaseUrl,
  type StaffDestination,
} from '../../lib/staff-handoff';

/**
 * أيُّ رموز المحاسبة تُظهر هذه الشاشة — وهي رموزٌ حقيقية في سجلّ العقود (‏`isKnownPermissionCode`
 * يقيسها `tests/navigation.spec.ts`) وتفرضها **وجهاتُ اللوحة** لا هذا الرابط: فـ`POST /auth/handoff`
 * متاحٌ لأيّ عضوٍ نشط، وما يُفتح في staff يُحكم عليه هناك بأذونات الجلسة نفسها.
 */
const ACCOUNTING_PERMISSIONS = [
  'accounting.reports.view',
  'accounting.account.view',
  'accounting.period.view',
] as const;

/**
 * المحاسبة التفصيلية — **رابطٌ يعمل**، لا شاشةٌ تُقلّد الأستاذ.
 *
 * ولماذا ليست نسخةً هنا (قرارُ المالك رقم ١ لهذه الواجهة، وأكّده في الشريحة ٢٠): فالأستاذُ
 * والقيودُ والميزانُ والفتراتُ ومراكزُ التكلفة محرّكٌ واحد في `apps/api` وواجهتُه الكاملة في
 * ‏`apps/staff` — ونسخةٌ في واجهة المخابز تعني محرّكًا محاسبيًّا ثانيًا أو شاشةً تعرض بعضَ
 * الحقول وتُوحي أنّها كلّها. وما هنا يسدّ الحاجةَ الحقيقية: أن يصل صاحبُ المخبز من رقمٍ في
 * الخطّ إلى القيد الذي كتبه، بجلسته هو، بلا لصقِ عنوانٍ ولا خروجٍ من السياق.
 *
 * والآليةُ من `@erp/web-core` نفسها (‏AUD-08): رمزُ تسليمٍ لمرةٍ واحدة يُصنع عند النقر،
 * والعنوانُ يحمله وحده، ولوحةُ staff تستبدله بجلسة. والمساراتُ مقاسةٌ على شجرة
 * ‏`apps/staff/app` — ويثبّت `tests/staff-handoff.spec.ts` أنّ لكلٍّ صفحةً موجودة، فلا رابطَ
 * ميتٍ هنا (والرابطُ الميتُ كان أحدَ شكلَي الكذب الذي تمنعه `lib/navigation.ts`).
 */
export default function AccountingHandoffPage() {
  const { can, me } = useSession();
  const base = staffBaseUrl();
  const destinations: readonly StaffDestination[] = useMemo(() => destinationsOf('accounting'), []);
  const grantedAny = ACCOUNTING_PERMISSIONS.some((code) => can(code));

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">المحاسبة التفصيلية — في لوحة staff</h1>
          <p className="ui-page-sub">
            {me?.membership.tenantName ?? 'المنشأة'} · لا أستاذَ ولا قيدَ في هذه الواجهة: ما هنا روابطُ تعمل
            بتسليم جلسة إلى المحرّك المحاسبيّ نفسه.
          </p>
        </div>
        <div className="ui-page-actions">
          <Badge dot status={base ? 'active' : 'pending'} title={`${STAFF_URL_ENV} من .env`}>
            {base ? (
              <>
                اللوحة: <span dir="ltr">{base}</span>
              </>
            ) : (
              <>{STAFF_URL_ENV} غير مُهيَّأ</>
            )}
          </Badge>
          <Badge dot status={grantedAny ? 'active' : 'pending'}>
            {grantedAny ? 'معك صلاحيةُ قراءةٍ محاسبية' : 'بلا صلاحيةِ محاسبةٍ في جلستك'}
          </Badge>
        </div>
      </header>
      <div className="ui-screen-body">
        {!base ? (
          <Card>
            <CardHeader subtitle="ولا يُخترع عنوانٌ بديل" title="الرابطُ غير مُهيَّأ" />
            <CardBody>
              <p className="m-0 text-[13px] leading-relaxed text-ink">
                أضِف إلى <span dir="ltr">.env</span> (مثالُه في <span dir="ltr">.env.example</span>: ‏
                <span dir="ltr">http://localhost:3001</span>) ثم أعد تشغيل الواجهة. وبلا عنوانٍ صحيح **لا
                يُصنع رمزُ تسليم** — فرمزٌ لمرةٍ واحدة لا يُستبدل ضياعٌ له، والرابطُ الميتُ كذب.
              </p>
            </CardBody>
          </Card>
        ) : null}

        {!grantedAny ? (
          <Card>
            <CardHeader
              subtitle="فاللوحةُ تعرض ما تملكه لا ما تملكه هذه الشاشة"
              title="جلستُك بلا رموز محاسبة"
            />
            <CardBody>
              <p className="m-0 text-[13px] leading-relaxed text-ink">
                التسليمُ يعمل لأيّ عضوٍ نشط، لكنّ الوجهات أدناه تفرض أذوناتها في اللوحة: فبلا{' '}
                <span dir="ltr">accounting.reports.view</span> أو{' '}
                <span dir="ltr">accounting.account.view</span> أو{' '}
                <span dir="ltr">accounting.period.view</span> لن ترى الأستاذَ ولا الميزانَ ولا الفترات هناك.
                والضابطُ الخادمُ في الطرفَين — وهذه الشاشةُ لا تمنح شيئًا.
              </p>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            subtitle="لكلٍّ مسارٌ حقيقيّ في apps/staff/app — ويُقاس وجودُه في الاختبار."
            title="وجهاتُ المحاسبة التفصيلية"
          />
          <CardBody>
            <div className="grid gap-3 md:grid-cols-2">
              {destinations.map((destination) => (
                <article
                  className="grid gap-2 rounded-lg border border-line bg-surface p-4 shadow-1"
                  key={destination.key}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="m-0 text-[15px] font-extrabold text-ink">{destination.labelAr}</h2>
                    <Badge tone="neutral">
                      <span dir="ltr">{destination.path}</span>
                    </Badge>
                  </div>
                  <p className="m-0 text-[13px] leading-relaxed text-muted">{destination.noteAr}</p>
                  <StaffHandoffLink destination={destination} labelAr="افتح في لوحة المحاسبة" />
                </article>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            subtitle="من `packages/web-core/src/token-bridge.tsx` — ولا آليةَ ثانية هنا."
            title="كيف يُسلَّم الرابط"
          />
          <CardBody>
            <ul className="m-0 grid gap-2 text-[13px] leading-relaxed text-ink">
              {HANDOFF_NOTES_AR.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <Card>
          <CardHeader subtitle="فلا تظنّ الشاشةُ أنّها تفعل ما لا تفعله." title="ما ليس هنا" />
          <CardBody>
            <ul className="m-0 grid gap-2 text-[13px] leading-relaxed text-muted">
              <li>
                <strong>لا أستاذَ ولا قيودَ ولا ميزانَ</strong> في واجهة المخابز — ولا تُستنسخ جداولُ المحاسبة
                هنا ولا يُنشأ محرّكٌ ثانٍ (قرارُ المالك رقم ١).
              </li>
              <li>
                <strong>أرقامُ الخطّ نفسها</strong> في <span dir="ltr">/reports</span> (تقريرُ الفترة من محرّك
                التقارير) وفي <span dir="ltr">/treasury</span> (سنداتُ القبض التي كتبها التحصيل وأرصدةُ مواضع
                النقد) — وهي قراءةٌ من الخادم نفسه لا حسابٌ في المتصفح.
              </li>
              <li>
                <strong>ولا شيءَ يُرحَّل من هنا</strong>: ترحيلُ سندٍ أو قيدِ فرقٍ أو إغلاقُ فترةٍ كتابةٌ في
                المال، ووجهتُها اللوحةُ بالأذونات التي تفرضها.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
