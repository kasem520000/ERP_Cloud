'use client';

import {
  platformProblemSourceLabels,
  type PlatformProblemRow,
  type PlatformProblemSource,
  type PlatformProblemsResponse,
} from '@erp/contracts';
import { Panel } from '@erp/ui';
import {
  AlertTriangle,
  ArrowLeft,
  DatabaseBackup,
  FlaskConical,
  Mail,
  RefreshCw,
  ReceiptText,
  ServerCrash,
  Webhook,
} from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ErrorBox, Forbidden, Screen } from '../../components/screen';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Select } from '../../components/ui/input';
import { Table, type Column } from '../../components/ui/table';
import { apiData } from '../../lib/api';
import { useQuery } from '../../lib/use-query';

/**
 * سجلّ المشاكل — البند 20 من قائمة العيوب.
 *
 * الشاشة تجيب السؤال الذي لم تكن أي شاشةٍ أخرى تجيبه: **«ما الذي يفشل الآن؟»**.
 * قبلها كان المشغّل يزور البريد ليعرف أن رسالةً لم تخرج، والطوابير ليعرف أن مهمةً
 * ماتت، والنسخ ليعرف أن نسخةً فشلت، ولوحة العميل ليعرف أن فاتورةً رُفضت — أربع شاشاتٍ
 * لأربع حوادث قد تكون حادثةً واحدة.
 *
 * والقاعدة التي تلتزمها: **لا صفَّ يُصنع من فراغ**. كل صفٍّ هو صفٌّ قائم في جدولٍ حقيقي،
 * وإن كان النظام سليماً فالجدول فارغ ويقولها بصراحة — لا رسالة «كل شيء بخير» تُخفي
 * أنها لم تُفحص.
 */

const SOURCE_ICON: Record<PlatformProblemSource, React.ReactNode> = {
  email: <Mail size={14} />,
  einvoice: <ReceiptText size={14} />,
  webhook: <Webhook size={14} />,
  outbox: <FlaskConical size={14} />,
  backup: <DatabaseBackup size={14} />,
  server: <ServerCrash size={14} />,
};

export default function ProblemsPage() {
  const [source, setSource] = useState<'' | PlatformProblemSource>('');
  const [severity, setSeverity] = useState<'' | 'error' | 'warning'>('');

  const query = new URLSearchParams({ limit: '100' });
  if (source) query.set('filter[source]', source);
  if (severity) query.set('filter[severity]', severity);

  const problems = useQuery<PlatformProblemsResponse>(
    () => apiData<PlatformProblemsResponse>(`/platform/problems?${query.toString()}`),
    [source, severity],
  );

  const rows = problems.data?.rows ?? [];
  const counts = problems.data?.counts;
  const problemCount = counts?.total ?? 0;

  const columns: Array<Column<PlatformProblemRow>> = [
    {
      key: 'occurredAt',
      header: 'الوقت',
      ltr: true,
      width: 150,
      cell: (row) => (
        <span className="whitespace-nowrap text-[11.5px] text-muted" dir="ltr">
          {new Date(row.occurredAt).toLocaleString('en-GB-u-ca-gregory-nu-latn', {
            dateStyle: 'short',
            timeStyle: 'short',
          })}
        </span>
      ),
    },
    {
      key: 'source',
      header: 'المصدر',
      width: 130,
      cell: (row) => (
        <span className="flex items-center gap-1.5 text-[12.5px] font-semibold">
          <span className="text-muted" aria-hidden>
            {SOURCE_ICON[row.source]}
          </span>
          {platformProblemSourceLabels[row.source]}
        </span>
      ),
    },
    {
      key: 'tenant',
      header: 'العميل',
      width: 150,
      cell: (row) =>
        row.tenantName ? (
          <>
            <span className="block text-[12.5px]">{row.tenantName}</span>
            <span className="block font-mono text-[11px] text-muted" dir="ltr">
              {row.tenantCode ?? row.tenantId?.slice(0, 8)}
            </span>
          </>
        ) : (
          <span className="text-muted">المنصّة</span>
        ),
    },
    {
      key: 'title',
      header: 'المشكلة',
      grow: true,
      cell: (row) => (
        <>
          <span className="flex items-center gap-2">
            <Badge tone={row.severity === 'error' ? 'red' : 'amber'} dot>
              {row.severity === 'error' ? 'خطأ' : 'تحذير'}
            </Badge>
            <strong className="text-[12.5px]">{row.title}</strong>
          </span>
          {row.hint ? <span className="mt-1 block text-[11.5px] text-muted">{row.hint}</span> : null}
        </>
      ),
    },
    {
      key: 'detail',
      header: 'ردّ النظام',
      grow: true,
      ltr: true,
      cell: (row) =>
        row.detail ? (
          <span className="block max-w-[420px] overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11.5px] text-danger-ink" title={row.detail}>
            {row.detail}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      key: 'attempts',
      header: 'المحاولات',
      numeric: true,
      width: 90,
      cell: (row) => (row.attempts === null ? <span className="text-muted">—</span> : row.attempts),
    },
    {
      key: 'href',
      header: '',
      width: 110,
      hideOnPrint: true,
      cell: (row) => (
        <Link className="btn small ghost" href={row.href}>
          <ArrowLeft size={12} /> افتح
        </Link>
      ),
    },
  ];

  return (
    <Screen
      title="سجل المشاكل"
      subtitle="كل ما يفشل الآن في مكان واحد: بريدٌ لم يخرج، فاتورةٌ إلكترونية رُفضت، ويب هوك لم يُسلَّم، مهمةٌ نفدت محاولاتها، ونسخةٌ فشلت — بمصدره وبعميله وبموضع إصلاحه."
      crumbs={['المنصة', 'التشغيل']}
      actions={
        <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={problems.reload}>
          تحديث
        </Button>
      }
      kpis={[
        {
          label: 'إجمالي المشاكل',
          value: problemCount,
          icon: <AlertTriangle size={14} />,
          tone: problemCount > 0 ? 'warn' : 'neutral',
          hint: counts?.oldestAt
            ? `أقدمها: ${new Date(counts.oldestAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn')}`
            : 'لا شيء يفشل الآن',
        },
        ...(Object.keys(platformProblemSourceLabels) as PlatformProblemSource[]).map((key) => ({
          label: platformProblemSourceLabels[key],
          value: counts?.bySource?.[key] ?? 0,
          icon: SOURCE_ICON[key],
          hint: 'مصدر مراقَب',
        })),
      ]}
      filters={
        <div className="flex flex-wrap items-end gap-3 no-print">
          <Select
            label="المصدر"
            value={source}
            onChange={(event) => setSource(event.target.value as '' | PlatformProblemSource)}
          >
            <option value="">كل المصادر</option>
            {(Object.keys(platformProblemSourceLabels) as PlatformProblemSource[]).map((key) => (
              <option key={key} value={key}>
                {platformProblemSourceLabels[key]}
              </option>
            ))}
          </Select>
          <Select
            label="الخطورة"
            value={severity}
            onChange={(event) => setSeverity(event.target.value as '' | 'error' | 'warning')}
          >
            <option value="">الكل</option>
            <option value="error">خطأ</option>
            <option value="warning">تحذير</option>
          </Select>
          <span className="pb-2 text-[12px] text-muted">
            يُقرأ من خمسة مصادر: البريد، الفاتورة الإلكترونية، الويب هوك، الطابور، والنسخ — لا
            جدول أعطالٍ منفصل، فإن سكن العطب سكنت الشاشة.
          </span>
        </div>
      }
    >
      {problems.status === 'loading' && (
        <Panel>
          <Table columns={columns} rows={[]} rowKey={(row) => row.key} loading skeletonRows={6} />
        </Panel>
      )}
      {problems.status === 'forbidden' && <Forbidden />}
      {problems.status === 'error' && (
        <ErrorBox message={problems.error} onRetry={problems.reload} />
      )}
      {problems.status === 'success' && (
        <Panel className="tight">
          <Table
            bare
            dense
            columns={columns}
            rows={rows}
            rowKey={(row) => row.key}
            pageSize={50}
            empty={
              <div className="grid place-items-center gap-2 py-10 text-center">
                <Badge tone="green" dot>
                  لا مشاكل
                </Badge>
                <p className="m-0 text-[13px] font-semibold">لا صفَّ فاشلاً في المصادر الخمسة.</p>
                <p className="m-0 max-w-[52ch] text-[12px] text-muted">
                  هذه قراءةٌ فعلية لصفوف البريد والفاتورة الإلكترونية والويب هوك والطابور والنسخ
                  لحظة الضغط على تحديث — لا لافتةً ثابتة.
                </p>
              </div>
            }
          />
        </Panel>
      )}
    </Screen>
  );
}
