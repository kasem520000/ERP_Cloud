'use client';

import Link from 'next/link';
import { ContentPanel, WorkflowGuide } from '@erp/ui/page';
import { AlertTriangle, Database, Gauge, HardDrive, Mail, RefreshCw, Server, Timer } from 'lucide-react';

import { Forbidden, Screen } from '../../components/screen';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { EmptyState } from '../../components/ui/empty-state';
import { MetricCard } from '../../components/ui/metric-card';
import { SkeletonRows } from '../../components/ui/skeleton';
import { apiData } from '../../lib/api';
import { useQuery } from '../../lib/use-query';

/**
 * صحة النظام — الصفحة تقرأ الآن `GET /platform/health/detailed` (P-C9).
 *
 * قبل هذا الجزء كانت الشاشة تفحص `GET /api/health/ready` من **متصفّح المشغّل**، وهذا كان
 * يجيب سؤالاً آخر: «هل يصل متصفّحي إلى الواجهة؟» لا «هل الخدمة بخير؟» — ومسار الوكيل في
 * Next.js ينجح حتى ومزوّد البريد معطَّل. الآن تُقاس ستّة مجسّات على الخادم (قاعدة · Redis ·
 * تخزين · بريد · طابور · عامل) ومعها عدّادات الطلبات ودلاء الاستجابة، ويبقى الفحص المحلي
 * صفاً واحداً في الأسفل: هو دليلٌ على أن *هذا المتصفّح* يرى الـAPI، لا على صحة الخدمة.
 */

type Probe = {
  name: string;
  status: 'up' | 'degraded' | 'down' | 'not_configured';
  detail: string;
  latencyMs: number | null;
};

type Health = {
  status: 'ok' | 'degraded' | 'down';
  checkedAt: string;
  startedAt: string;
  uptimeSeconds: number;
  incident: { active: boolean; message: string | null };
  requests: { count: number; errors: number; errorRate: number; p95Ms: number };
  backlog: { pending: number; published: number; dead: number; oldestPendingAgeSeconds: number | null };
  probes: Probe[];
};

const PROBE_LABEL: Record<string, string> = {
  database: 'قاعدة البيانات',
  redis: 'وسيط الرسائل',
  storage: 'مخزن الملفات',
  email: 'البريد',
  queue: 'الطابور',
  worker: 'العامل',
};

const PROBE_ICON: Record<string, React.ReactNode> = {
  database: <Database size={16} />,
  redis: <Server size={16} />,
  storage: <HardDrive size={16} />,
  email: <Mail size={16} />,
  queue: <Gauge size={16} />,
  worker: <Timer size={16} />,
};

const STATUS_LABEL: Record<string, string> = {
  up: 'سليم',
  degraded: 'متدهوّر',
  down: 'متوقّف',
  not_configured: 'غير مهيّأ',
};

const OVERALL: Record<string, { label: string; cls: string }> = {
  ok: { label: 'الخدمة سليمة', cls: 'text-ok-ink' },
  degraded: { label: 'الخدمة متدهوّرة', cls: 'text-warn-ink' },
  down: { label: 'الخدمة متوقّفة', cls: 'text-danger-ink' },
};

export default function HealthPage() {
  const health = useQuery<Health>(() => apiData<Health>('/platform/health/detailed'), []);
  const data = health.data;

  return (
    <Screen
      title="صحة النظام"
      subtitle="راقب الخدمات والطلبات والطابور لتفرّق بين خدمة غير مهيأة وحادثة تحتاج إجراءً."
      crumbs={['المنصة', 'التشغيل']}
      actions={
        <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={health.reload}>
          إعادة الفحص
        </Button>
      }
    >
      <WorkflowGuide
        title="كيف تقرأ مؤشرات الصحة؟"
        steps={[
          { title: 'ابدأ بالحالة العامة', detail: 'حادثة معلنة أو خدمة متوقفة تتطلب متابعة فورية.' },
          { title: 'راجع كل خدمة', detail: 'غير مهيأة تختلف عن خدمة كانت تعمل ثم توقفت.' },
          { title: 'افحص الطابور والأخطاء', detail: 'تراكم المهام مع توقف العامل يستدعي فحص التشغيل.' },
        ]}
      />
      {health.status === 'loading' ? (
        <div className="rounded-[10px] border border-line bg-surface p-4 shadow-1">
          <SkeletonRows rows={5} />
        </div>
      ) : health.status === 'forbidden' ? (
        <Forbidden />
      ) : health.status === 'error' ? (
        <EmptyState tone="red" icon={<AlertTriangle size={26} strokeWidth={1.5} />} title="تعذّر الفحص" description={health.error} />
      ) : null}

      {health.status === 'success' && data && (
        <>
          {data.incident.active && (
            <div className="flex items-start gap-3 rounded-[10px] border-2 border-danger-line bg-danger-soft px-4 py-3">
              <span className="relative mt-1 flex size-3 flex-none">
                <span className="absolute inline-flex size-full animate-ping rounded-full bg-danger opacity-70" />
                <span className="relative inline-flex size-3 rounded-full bg-danger" />
              </span>
              <div>
                <p className="m-0 text-[14px] font-extrabold text-danger-ink">
                  حادثة معلَنة: {data.incident.message ?? 'صيانة جارية'}
                </p>
                <p className="m-0 mt-1 text-[12px] text-danger">
                  يظهر إعلان الصيانة للعميل من إعدادات المنصة؛ راجع الرسالة المنشورة قبل تحديثها.
                </p>
              </div>
            </div>
          )}

          {/* overall strip */}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[10px] border border-line bg-surface px-4 py-3 shadow-1">
            <span className="flex items-center gap-2.5">
              <span className="relative flex size-3">
                {data.status !== 'down' && (
                  <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-50 ${data.status === 'ok' ? 'bg-ok' : 'bg-warn'}`} />
                )}
                <span className={`relative inline-flex size-3 rounded-full ${data.status === 'ok' ? 'bg-ok' : data.status === 'degraded' ? 'bg-warn' : 'bg-danger'}`} />
              </span>
              <span className={`text-[15px] font-extrabold ${OVERALL[data.status]?.cls ?? 'text-ink-2'}`}>
                {OVERALL[data.status]?.label ?? data.status}
              </span>
            </span>
            <span className="font-mono text-[12px] text-muted" dir="ltr">
              مدة التشغيل: {formatDuration(data.uptimeSeconds)}
            </span>
            <span className="text-[12px] text-muted">آخر فحص {new Date(data.checkedAt).toLocaleTimeString('ar-SA')}</span>
            <span className="ms-auto flex flex-wrap gap-2">
              <Badge tone={data.backlog.dead > 0 ? 'red' : 'neutral'} dot>متعذّرة: {data.backlog.dead}</Badge>
              <Badge tone={data.requests.errorRate > 0.01 ? 'amber' : 'green'} dot>
                أخطاء {(data.requests.errorRate * 100).toFixed(2)}٪
              </Badge>
            </span>
          </div>

          {/* probes grid */}
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            {data.probes.map((probe, _index) => {
              const up = probe.status === 'up';
              const down = probe.status === 'down';
              return (
                <div
                  key={probe.name}
                  className="rounded-[10px] border border-line bg-surface p-3.5 shadow-1 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-2"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`grid size-9 flex-none place-items-center rounded-lg ${
                        up ? 'bg-ok-soft text-ok' : down ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn'
                      }`}
                    >
                      {PROBE_ICON[probe.name] ?? <Gauge size={16} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold text-ink">{PROBE_LABEL[probe.name] ?? 'خدمة إضافية'}</span>
                      <span
                        className={`inline-flex items-center gap-1.5 text-[11.5px] font-bold ${
                          up ? 'text-ok' : down ? 'text-danger' : 'text-warn'
                        }`}
                      >
                        {up || down ? (
                          <span className="relative flex size-1.5">
                            <span className={`absolute inline-flex size-full animate-ping rounded-full opacity-60 ${up ? 'bg-ok' : 'bg-danger'}`} />
                            <span className={`relative inline-flex size-1.5 rounded-full ${up ? 'bg-ok' : 'bg-danger'}`} />
                          </span>
                        ) : (
                          <span className="size-1.5 rounded-full bg-warn" />
                        )}
                        {STATUS_LABEL[probe.status] ?? 'قيد الفحص'}
                      </span>
                    </span>
                    <span className="flex-none font-mono text-[12px] font-bold text-muted" dir="ltr">
                      {probe.latencyMs === null ? '—' : `${probe.latencyMs} ملّي ثانية`}
                    </span>
                  </div>
                  <p className="m-0 mt-2 text-[11.5px] text-muted">
                    {probe.status === 'up' ? 'تستجيب للفحص الحالي.' : probe.status === 'not_configured' ? 'لم تُفعّل لهذه البيئة.' : probe.status === 'degraded' ? 'تحتاج متابعة؛ بعض الوظائف قد تتأخر.' : 'تعذّر الوصول إليها في هذا الفحص.'}
                  </p>
                </div>
              );
            })}
          </div>

          {/* requests + backlog */}
          <div className="mt-3 grid gap-3 xl:grid-cols-2">
            <section className="rounded-[10px] border border-line bg-surface p-4 shadow-1">
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">الطلبات</h3>
              <div className="grid grid-cols-2 gap-3">
                <MetricCard label="العدد الكلي" value={data.requests.count} tone="violet" delay={0} />
                <MetricCard label="أخطاء الخادم" value={data.requests.errors} tone={data.requests.errors > 0 ? 'red' : 'green'} delay={0.04} />
                <MetricCard
                  label="نسبة الخطأ"
                  value={Number((data.requests.errorRate * 100).toFixed(2))}
                  suffix="٪"
                  tone={data.requests.errorRate > 0.01 ? 'amber' : 'green'}
                  delay={0.08}
                />
                <MetricCard label="زمن 95٪ من الطلبات" value={data.requests.p95Ms} suffix="ملّي ثانية" tone="sky" delay={0.12} />
              </div>
              <p className="m-0 mt-3 text-[11.5px] text-muted leading-relaxed">
                هذه الأرقام تقيس الطلبات منذ بدء تشغيل الخدمة. زمن الاستجابة المعروض هو الحد الذي اكتمل خلاله 95٪ من الطلبات.
              </p>
            </section>

            <section className="rounded-[10px] border border-line bg-surface p-4 shadow-1">
              <h3 className="m-0 mb-3 text-[15px] font-bold text-ink">الطابور</h3>
              <div className="grid grid-cols-2 gap-3">
                <MetricCard
                  label="بانتظار النشر"
                  value={data.backlog.pending}
                  tone={data.backlog.pending > 50 ? 'amber' : 'violet'}
                  delay={0.04}
                />
                <MetricCard label="نُشرت" value={data.backlog.published} tone="sky" delay={0.08} />
                <MetricCard label="متعذّرة" value={data.backlog.dead} tone={data.backlog.dead > 0 ? 'red' : 'green'} delay={0.12} />
                <div className="rounded-xl border border-line bg-surface-2 p-3">
                  <p className="m-0 text-[11.5px] font-bold text-muted">أقدم معلَّقة</p>
                  <p className="m-0 mt-1 font-mono text-[18px] font-bold text-ink-2" dir="ltr">
                    {data.backlog.oldestPendingAgeSeconds === null ? 'لا شيء' : formatDuration(data.backlog.oldestPendingAgeSeconds)}
                  </p>
                </div>
              </div>
              <p className="m-0 mt-3 text-[11.5px] text-muted leading-relaxed">
                الفعل على هذه الصفوف في <a className="font-bold text-brand-600 underline" href="/jobs">المهام والطوابير</a> — هذه الشاشة تقيس ولا تعالج.
              </p>
            </section>
          </div>

          <ContentPanel title="الخطوة التالية" description="تحديد موضع العطل يسبق أي تعديل في الإعدادات أو إعادة تشغيل المهام.">
            <div className="erp-page-actions">
              <Link className="btn" href="/jobs">مراجعة المهام والطوابير</Link>
              <Link className="btn" href="/tickets">فتح طلبات الدعم</Link>
              <Link className="btn" href="/settings">مراجعة رسالة الصيانة</Link>
            </div>
          </ContentPanel>
        </>
      )}
    </Screen>
  );
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} ثانية`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} دقيقة`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} ساعة`;
  return `${Math.floor(seconds / 86_400)} يوم`;
}
