'use client';

import Link from 'next/link';
import {
  ArrowLeft,
  BadgePercent,
  Banknote,
  Boxes,
  BarChart3,
  ClipboardList,
  Factory,
  Landmark,
  ReceiptText,
  ShoppingCart,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { QueryView } from '../../components/data-view';
import { Screen } from '../../components/screen';
import { REPORT_GROUP_LABELS, REPORT_GROUP_ORDER, fetchReportCatalog, type ReportEntry } from '../../lib/reports';
import { useQuery } from '../../lib/use-query';

/** One glyph per group — a report centre reads by family, not by alphabet. */
const GROUP_ICONS: Record<string, LucideIcon> = {
  sales: ReceiptText,
  purchases: ShoppingCart,
  inventory: Boxes,
  accounting: Landmark,
  pos: Banknote,
  hrm: Users,
  marina: BarChart3,
  projects: ClipboardList,
  zatca: BadgePercent,
};

export default function ReportsIndexPage() {
  const catalog = useQuery<ReportEntry[]>(() => fetchReportCatalog(), []);

  return (
    <Screen
      title="مركز التقارير"
      subtitle="كل تقارير النظام تعمل على نفس محرّك التقارير: اختر التقرير، حدّد الفترة والمرشحات، ثم صدّر أو اطبع."
      crumbs={['التقارير']}
    >
      <QueryView query={catalog} empty="لا توجد تقارير مسجلة">
        {(entries) => {
          const groups = REPORT_GROUP_ORDER.filter((group) => entries.some((entry) => entry.group === group));
          return (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {groups.map((group) => {
                  const Icon = GROUP_ICONS[group] ?? Factory;
                  const rows = entries.filter((entry) => entry.group === group);
                  return (
                    <section key={group} className="report-group">
                      <header className="report-group-head">
                        <span className="report-group-icon" aria-hidden>
                          <Icon size={16} strokeWidth={1.8} />
                        </span>
                        <h2 className="m-0 text-[14.5px] font-bold text-ink">
                          {REPORT_GROUP_LABELS[group] ?? group}
                        </h2>
                        <span className="report-group-count">{rows.length}</span>
                      </header>
                      <ul className="report-list">
                        {rows.map((entry) => (
                          <li key={entry.key}>
                            <Link className="report-link" href={`/reports/${entry.key}`}>
                              <span className="report-link-text">
                                <span className="report-link-title">{entry.titleAr}</span>
                                {entry.hintAr ? <span className="report-link-hint">{entry.hintAr}</span> : null}
                              </span>
                              <ArrowLeft size={14} className="report-link-arrow arrow-back" aria-hidden />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            </>
          );
        }}
      </QueryView>
    </Screen>
  );
}
