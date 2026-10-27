'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Kpi,
  Select,
  type Column,
} from '@erp/ui';
import { apiData, apiErrorText, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { numberText } from '../../lib/lookups';
import { openServerPrintHtml } from '../../lib/server-print';

type FilingRow = Record<string, unknown> & {
  id: string;
  invoiceId?: string;
  submissionId?: string;
  invoiceNumber?: string;
  invoiceType?: string;
  status?: string;
  total?: string;
  icv?: number;
  qrSource?: string;
  createdAt?: string;
};

type ChainState = {
  lastIcv?: number;
  pendingCount?: number;
  acceptedCount?: number;
  rejectedCount?: number;
};

export default function BakeryTaxFilingsPage() {
  const { can } = useSession();
  const canSubmit = can('einvoice.submit');

  const [rows, setRows] = useState<FilingRow[]>([]);
  const [chain, setChain] = useState<ChainState | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ pageSize: '50' });
      if (statusFilter) qs.set('status', statusFilter);
      const [filingsRes, chainRes] = await Promise.all([
        apiData<{ items?: FilingRow[]; rows?: FilingRow[] } | FilingRow[]>(`/einvoice/filings?${qs.toString()}`),
        apiData<ChainState>('/einvoice/chain').catch(() => null),
      ]);
      const list = Array.isArray(filingsRes)
        ? filingsRes
        : (filingsRes.items ?? filingsRes.rows ?? []);
      setRows(list);
      setChain(chainRes);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة سجل الفوترة الإلكترونية'));
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const syncAll = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      await apiPost('/einvoice/sync', {});
      setNotice({ tone: 'ok', text: 'اكتملت مزامنة الفواتير المرحَّلة وتحديث رموز الاستجابة السريعة.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر مزامنة الفواتير الضريبية') });
    } finally {
      setSyncing(false);
    }
  };

  const retrySubmission = async (submissionId: string) => {
    try {
      await apiPost(`/einvoice/submissions/${encodeURIComponent(submissionId)}/retry`, {});
      setNotice({ tone: 'ok', text: 'تمت إعادة إرسال الفاتورة بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إعادة الإرسال') });
    }
  };

  const columns: Column<FilingRow>[] = [
    { key: 'icv', header: 'تسلسل العداد', numeric: true, cell: (r) => String(r.icv ?? '—') },
    { key: 'inv', header: 'رقم الفاتورة', ltr: true, cell: (r) => String(r.invoiceNumber ?? r.id.slice(0, 8)) },
    {
      key: 'type',
      header: 'النوع الضريبي',
      cell: (r) => (r.invoiceType === 'standard' ? 'فاتورة ضريبية' : 'فاتورة ضريبية مبسطة'),
    },
    { key: 'total', header: 'الإجمالي (ر.س)', numeric: true, cell: (r) => numberText(String(r.total ?? '0')) },
    {
      key: 'status',
      header: 'حالة الاعتماد',
      cell: (r) => (
        <Badge
          status={
            r.status === 'accepted' || r.status === 'cleared' || r.status === 'reported'
              ? 'active'
              : r.status === 'rejected' || r.status === 'failed'
                ? 'rejected'
                : 'pending'
          }
        >
          {String(r.status ?? 'قيد المعالجة')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          {r.invoiceId ? (
            <Button
              onClick={() => void openServerPrintHtml(`/reports/print/invoices/${encodeURIComponent(r.invoiceId!)}`)}
              size="sm"
            >
              طباعة A4 + QR
            </Button>
          ) : null}
          {(r.status === 'rejected' || r.status === 'failed') && r.submissionId && canSubmit ? (
            <Button onClick={() => void retrySubmission(r.submissionId!)} size="sm" variant="primary">
              إعادة إرسال
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">الفوترة الإلكترونية وسلسلة التشفير</h1>
          <p className="ui-page-sub">
            متابعة حالة رفع الفواتير الضريبية واعتمادها وسلامة سلسلة التوقيع ورموز الاستجابة السريعة للمرحلة الثانية.
          </p>
        </div>
        <div className="ui-page-actions">
          {canSubmit ? (
            <Button disabled={syncing} onClick={() => void syncAll()} variant="primary">
              {syncing ? 'جارٍ المزامنة…' : 'مزامنة الفواتير المرحَّلة'}
            </Button>
          ) : null}
          <Button onClick={() => void load()} size="sm">
            تحديث
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        {notice ? (
          <Card>
            <CardBody>
              <Badge status={notice.tone === 'ok' ? 'active' : 'rejected'}>{notice.text}</Badge>
            </CardBody>
          </Card>
        ) : null}

        {chain ? (
          <div className="ui-kpi-grid">
            <Kpi title="آخر عداد تسلسلي" tone="brand" value={String(chain.lastIcv ?? 0)} />
            <Kpi title="معتمدة / مبلَّغة" tone="ok" value={String(chain.acceptedCount ?? 0)} />
            <Kpi title="بانتظار الرفع" tone="warn" value={String(chain.pendingCount ?? 0)} />
            <Kpi title="بحاجة لمعالجة" tone="danger" value={String(chain.rejectedCount ?? 0)} />
          </div>
        ) : null}

        <Card>
          <CardHeader subtitle="تُعتمد شارة QR المرحلة الثانية تلقائياً للفواتير المرفوعة." title="سجل الإيداعات الضريبية" />
          <CardBody>
            <div className="mb-3 max-w-xs">
              <Select
                label="تصفية بالحالة"
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: '', label: 'جميع الحالات' },
                  { value: 'accepted', label: 'معتمدة' },
                  { value: 'pending', label: 'قيد الانتظار' },
                  { value: 'rejected', label: 'مرفوضة / متعثرة' },
                ]}
                value={statusFilter}
              />
            </div>
            <DataTable
              columns={columns}
              empty="لا إيداعات ضريبية مسجلة"
              rows={rows}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
