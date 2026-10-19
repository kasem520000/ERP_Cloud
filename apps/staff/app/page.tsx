'use client';

import Link from 'next/link';
import {
  ArrowRight,
  CalendarClock,
  CalendarDays,
  FilePlus2,
  LayoutDashboard,
  PackageSearch,
  ReceiptText,
  ShieldAlert,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { KpiStrip, Panel, Section } from '@erp/ui';

import { UserDashboard } from '../components/dashboard/user-dashboard';
import { AreaCardChart, DonutCardChart } from '../components/ui/chart';
import { CountUp, Reveal } from '../components/ui/count-up';
import { EmptyState } from '../components/ui/empty-state';
import { SkeletonCard } from '../components/ui/skeleton';
import { Badge } from '../components/ui/badge';
import { useSession } from '../lib/session';
import { money, quantity, shortDate } from '../lib/lookups';
import { computeStats, fetchDashboardData, partyName, type DashboardData } from '../lib/dashboard';

function useDashboardData() {
  const [state, setState] = useState<{
    status: 'loading' | 'success' | 'error';
    data?: DashboardData;
    error?: string;
  }>({
    status: 'loading',
  });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    fetchDashboardData()
      .then((data) => !cancelled && setState({ status: 'success', data }))
      .catch(
        (error) =>
          !cancelled &&
          setState({ status: 'error', error: error instanceof Error ? error.message : String(error) }),
      );
    return () => {
      cancelled = true;
    };
  }, [nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** Hijri + Gregorian date line for the greeting. */
function dateLine(now = new Date()): { greg: string; hijri: string } {
  const greg = new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(now);
  let hijri = '';
  try {
    hijri = new Intl.DateTimeFormat('ar-SA-u-ca-islamic-umalqura', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(now);
  } catch {
    hijri = '';
  }
  return { greg, hijri };
}

const SAR = (value: number) => money(value);

/** A quiet count + link inside the action centre. No chart, no invented metric. */
function ActionTile({
  href,
  icon,
  label,
  value,
  hint,
  tone,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
  value: number;
  hint: string;
  tone: 'ok' | 'warn' | 'danger';
}) {
  const toneStyle =
    tone === 'danger'
      ? { color: 'var(--danger-ink)', background: 'var(--danger-soft)', borderColor: 'var(--danger-line)' }
      : tone === 'warn'
        ? { color: 'var(--warn-ink)', background: 'var(--warn-soft)', borderColor: 'var(--warn-line)' }
        : { color: 'var(--ok-ink)', background: 'var(--ok-soft)', borderColor: 'var(--ok-line)' };

  return (
    <Link href={href} className="exec-press group flex items-center gap-3.5 px-5 py-4 hover:bg-surface-2">
      <span
        aria-hidden
        className="grid size-10 flex-none place-items-center rounded-[11px] border"
        style={toneStyle}
      >
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-bold uppercase tracking-[0.07em] text-muted">{label}</span>
        <span className="mt-1 flex items-baseline gap-2">
          <b className="num text-[21px] leading-none font-extrabold text-ink">{value}</b>
          <span className="truncate text-xs font-medium text-muted">{hint}</span>
        </span>
      </span>
      <ArrowRight size={14} className="arrow-forward flex-none text-muted" aria-hidden />
    </Link>
  );
}

export default function DashboardPage() {
  const { me, can } = useSession();
  const data = useDashboardData();

  const stats = data.status === 'success' && data.data ? computeStats(data.data) : null;
  const firstName = (me?.user.fullName ?? 'زميلي').split(' ')[0];
  const hour = new Date().getUTCHours();
  const greetingWord = hour < 12 ? 'صباح الخير' : 'مساء الخير';
  const dates = dateLine();

  const todayDelta =
    stats && stats.yesterdaySales > 0
      ? ((stats.todaySales - stats.yesterdaySales) / stats.yesterdaySales) * 100
      : null;
  const monthDelta =
    stats && stats.lastMonthSales > 0
      ? ((stats.monthSales - stats.lastMonthSales) / stats.lastMonthSales) * 100
      : null;

  if (data.status === 'error') {
    return (
      <EmptyState
        tone="red"
        icon={<TrendingDown size={30} strokeWidth={1.5} />}
        title="تعذر تحميل بيانات لوحة المتابعة"
        description={data.error}
      />
    );
  }

  return (
    <div className="grid gap-5">
      {/* ---------------------------------------------------- greeting */}
      <Reveal>
        <section className="exec-hero p-6 sm:p-7">
          <div className="exec-grain" aria-hidden />
          <div className="relative flex flex-wrap items-start justify-between gap-6">
            <div className="min-w-0">
              <span className="exec-eyebrow">
                {can('accounting.reports.view') ? 'الملخص التنفيذي' : 'لوحة المتابعة'}
              </span>
              <h1 className="m-0 mt-2 text-[27px] font-extrabold leading-tight tracking-[-0.03em] text-white sm:text-[32px]">
                {greetingWord}، {firstName}
              </h1>
              <p className="m-0 mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-white/70">
                <span className="inline-flex items-center gap-1.5">
                  <CalendarDays size={14} className="text-[#d2ad45]" aria-hidden />
                  {dates.greg}
                </span>
                {dates.hijri ? (
                  <span className="inline-flex items-center gap-1.5 text-white/55">
                    <span className="size-1 rounded-full bg-white/30" aria-hidden /> {dates.hijri} هـ
                  </span>
                ) : null}
              </p>
              <p className="m-0 mt-4 max-w-xl text-[12.5px] leading-relaxed text-white/60">
                {data.status === 'success'
                  ? 'نظرة موحّدة على المبيعات والتحصيل والمخزون، محدَّثة من قيودك المرحّلة.'
                  : 'جارٍ تجهيز أرقامك من قيود الفترة الحالية…'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {can('sales.invoice.create') ? (
                <Link href="/sales/invoices/new" className="hero-btn hero-btn-primary">
                  <FilePlus2 size={16} aria-hidden />
                  فاتورة جديدة
                </Link>
              ) : null}
              {can('sales.view') ? (
                <Link href="/sales/invoices" className="hero-btn">
                  <ReceiptText size={16} aria-hidden />
                  كل الفواتير
                </Link>
              ) : null}
              <Link href="/reports/sales" className="hero-btn">
                <TrendingUp size={16} aria-hidden />
                تقارير المبيعات
              </Link>
              {can('dashboards.view') ? (
                <Link href="/dashboards" className="hero-btn hero-btn-ghost">
                  <LayoutDashboard size={16} aria-hidden />
                  لوحاتي
                </Link>
              ) : null}
            </div>
          </div>
        </section>
      </Reveal>

      <UserDashboard />

      {/* -------------------------------------------------------- KPIs */}
      <Section
        title="نبض المنشأة اليوم"
        hint={data.status === 'success' ? 'مقارنة بالفترة السابقة' : 'جارٍ التحديث…'}
      >
        <KpiStrip
          items={[
            {
              label: 'مبيعات اليوم',
              value: stats ? <CountUp value={stats.todaySales} format={SAR} /> : '—',
              icon: <Wallet size={18} />,
              delta: todayDelta,
              deltaLabel: 'عن الأمس',
              href: '/sales/invoices',
            },
            {
              label: `مبيعات ${new Intl.DateTimeFormat('ar', { month: 'long' }).format(new Date())}`,
              value: stats ? <CountUp value={stats.monthSales} format={SAR} /> : '—',
              icon: <ShoppingCart size={18} />,
              delta: monthDelta,
              deltaLabel: 'عن الشهر الماضي',
            },
            {
              label: 'ذمم مدينة (فواتير غير مسددة)',
              value: stats ? <CountUp value={stats.receivable} format={SAR} /> : '—',
              icon: <TrendingUp size={18} />,
              hint: stats
                ? `${stats.overdueInvoices} فاتورة لدى ${stats.overdueCustomers} عميل`
                : 'جارٍ التحديث…',
              tone: stats && stats.overdueInvoices > 0 ? 'warn' : 'neutral',
            },
            {
              label: 'أصناف تحت الحد الأدنى',
              value: stats ? <CountUp value={stats.lowStockCount} /> : '—',
              icon: <PackageSearch size={18} />,
              hint: stats ? `${stats.nearExpiryCount} صنف قريب من الانتهاء` : 'جارٍ التحديث…',
              tone: stats && stats.lowStockCount > 0 ? 'down' : 'neutral',
              href: '/inventory/below-minimum',
            },
          ]}
        />
      </Section>

      {/* ------------------------------------------------- action centre */}
      {stats ? (
        <Reveal delay={0.1}>
          <Panel
            title="مركز الإجراءات"
            hint="بنود تحتاج نظراً منك اليوم."
            flush
            actions={
              <div className="flex flex-wrap items-center gap-3 text-[11.5px] font-bold">
                <Link
                  className="inline-flex items-center gap-1 text-brand hover:underline"
                  href="/approvals/inbox"
                >
                  صندوق الموافقات <ArrowRight size={12} className="arrow-forward" aria-hidden />
                </Link>
                <Link
                  className="inline-flex items-center gap-1 text-muted hover:text-ink"
                  href="/accounting/income-statement"
                >
                  قائمة الدخل <ArrowRight size={12} className="arrow-forward" aria-hidden />
                </Link>
                <Link
                  className="inline-flex items-center gap-1 text-muted hover:text-ink"
                  href="/accounting/trial-balance"
                >
                  ميزان المراجعة <ArrowRight size={12} className="arrow-forward" aria-hidden />
                </Link>
              </div>
            }
          >
            <div className="grid grid-cols-1 divide-y divide-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <ActionTile
                href="/sales/invoices"
                icon={<ReceiptText size={17} />}
                label="فواتير بانتظار التحصيل"
                value={stats.unpaidInvoices}
                hint={`${money(stats.receivable)} مستحقة`}
                tone="warn"
              />
              <ActionTile
                href="/inventory/below-minimum"
                icon={<ShieldAlert size={17} />}
                label="أصناف تحت الحد الأدنى"
                value={stats.lowStockCount}
                hint="تحتاج إعادة طلب"
                tone={stats.lowStockCount > 0 ? 'danger' : 'ok'}
              />
              <ActionTile
                href="/inventory/expiry"
                icon={<CalendarClock size={17} />}
                label="أصناف قريبة من الانتهاء"
                value={stats.nearExpiryCount}
                hint="خلال نافذة الصلاحية"
                tone={stats.nearExpiryCount > 0 ? 'warn' : 'ok'}
              />
            </div>
          </Panel>
        </Reveal>
      ) : null}

      {/* ------------------------------------------------------ charts */}
      <div className="grid gap-4 grid-cols-1 xl:grid-cols-5">
        <Reveal delay={0.15} className="xl:col-span-3">
          <Panel
            className="h-full"
            title="مبيعات آخر 7 أيام"
            hint="إجمالي الفواتير المرحّلة (بالريال السعودي)."
            actions={
              <Badge tone="blue" dot>
                {stats ? `${stats.week.reduce((sum, day) => sum + day.count, 0)} فاتورة` : '…'}
              </Badge>
            }
          >
            {data.status === 'loading' ? (
              <SkeletonCard lines={5} />
            ) : stats ? (
              <AreaCardChart
                data={stats.week}
                xKey="label"
                dataKey="total"
                formatter={SAR}
                name="المبيعات"
                height={264}
              />
            ) : null}
          </Panel>
        </Reveal>

        <Reveal delay={0.25} className="xl:col-span-2">
          <Panel className="h-full" title="المبيعات حسب الفرع" hint="توزيع الإيراد على الفروع.">
            {data.status === 'loading' ? (
              <SkeletonCard lines={5} />
            ) : stats && stats.branchTotals.length > 0 ? (
              <DonutCardChart
                data={stats.branchTotals.map((entry) => ({ name: entry.label, value: entry.total }))}
                formatter={SAR}
                centerValue={money(stats.branchTotals.reduce((sum, entry) => sum + entry.total, 0))}
                centerLabel="الإجمالي"
                height={210}
              />
            ) : (
              <EmptyState
                tone="slate"
                icon={<ReceiptText size={28} strokeWidth={1.5} />}
                title="لا توجد مبيعات مرحّلة بعد"
                description="عندما تُرحَّل أول فاتورة سيظهر توزيعها على الفروع هنا."
              />
            )}
          </Panel>
        </Reveal>
      </div>

      {/* ------------------------------------------------ mini tables */}
      <div className="grid gap-4 grid-cols-1 xl:grid-cols-2">
        <Reveal delay={0.3}>
          <Panel
            flush
            title="أحدث الفواتير"
            actions={
              <Link
                href="/sales/invoices"
                className="inline-flex items-center gap-1 text-[12.5px] font-bold text-brand-600 hover:text-brand-700"
              >
                عرض الكل <ArrowRight size={12} className="arrow-forward" aria-hidden />
              </Link>
            }
          >
            {data.status === 'loading' ? (
              <div className="p-4">
                <SkeletonCard lines={4} />
              </div>
            ) : stats && stats.lastInvoices.length > 0 ? (
              <ul className="m-0 list-none p-0 divide-y divide-line">
                {stats.lastInvoices.map((invoice) => (
                  <li key={invoice.id}>
                    <Link
                      href={`/sales/invoices/${invoice.id}`}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2 transition-colors duration-150"
                    >
                      <span className="grid place-items-center size-9 rounded-lg bg-info-soft text-brand-600 flex-none">
                        <ReceiptText size={16} />
                      </span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[13px] font-bold text-ink truncate" dir="ltr">
                          {invoice.number ?? 'مسودة'}
                        </span>
                        <span className="block text-[11.5px] text-muted truncate">
                          {data.data ? partyName(invoice, data.data.parties) : '—'} ·{' '}
                          {shortDate(invoice.postedAt ?? invoice.createdAt)}
                        </span>
                      </span>
                      <span
                        className="text-[13px] font-bold text-ink"
                        style={{ fontVariantNumeric: 'tabular-nums' }}
                      >
                        {money(invoice.total)}
                      </span>
                      <Badge
                        tone={invoice.paymentStatus === 'paid' ? 'green' : 'amber'}
                        status={invoice.paymentStatus}
                      >
                        {invoice.paymentStatus === 'paid' ? 'مسدّدة' : 'غير مسدّدة'}
                      </Badge>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4">
                <EmptyState
                  tone="slate"
                  icon={<ReceiptText size={28} strokeWidth={1.5} />}
                  title="لا توجد فواتير بعد"
                  description="ابدأ بإصدار أول فاتورة مبيعات."
                />
              </div>
            )}
          </Panel>
        </Reveal>

        <Reveal delay={0.4}>
          <Panel
            flush
            title="أصناف تحت الحد الأدنى"
            actions={
              <Link
                href="/inventory/below-minimum"
                className="inline-flex items-center gap-1 text-[12.5px] font-bold text-brand-600 hover:text-brand-700"
              >
                عرض الكل <ArrowRight size={12} className="arrow-forward" aria-hidden />
              </Link>
            }
          >
            {data.status === 'loading' ? (
              <div className="p-4">
                <SkeletonCard lines={4} />
              </div>
            ) : data.data && data.data.lowStock.length > 0 ? (
              <ul className="m-0 list-none p-0 divide-y divide-line">
                {data.data.lowStock.slice(0, 5).map((row) => (
                  <li
                    key={`${row.itemId}-${row.warehouseId}`}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <span className="grid place-items-center size-9 rounded-lg bg-danger-soft text-danger flex-none">
                      <PackageSearch size={16} />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-[13px] font-bold text-ink truncate">{row.nameAr}</span>
                      <span className="block text-[11.5px] text-muted truncate" dir="ltr">
                        {row.sku}
                      </span>
                    </span>
                    <span className="text-[12px] text-muted font-semibold">
                      المتاح <b className="text-danger">{quantity(row.quantity)}</b> / الحد{' '}
                      {quantity(row.minQty)}
                    </span>
                    <Badge tone="red" dot>
                      ناقص {row.shortage}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="p-4">
                <EmptyState
                  tone="green"
                  icon={<PackageSearch size={28} strokeWidth={1.5} />}
                  title="المخزون ضمن الحدود"
                  description="لا توجد أصناف تحت الحد الأدنى حالياً."
                />
              </div>
            )}
          </Panel>
        </Reveal>
      </div>
    </div>
  );
}
