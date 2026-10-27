'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  type Column,
} from '@erp/ui';
import { apiErrorText, apiList, apiPost } from '@erp/web-core/api';

import { listState, rowKeyFrom } from '../../lib/ui-kit';

type NotificationRow = Record<string, unknown> & {
  id: string;
  title?: string;
  body?: string;
  message?: string;
  readAt?: string | null;
  isRead?: boolean;
  createdAt?: string;
};

export default function BakeryNotificationsPage() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiList<NotificationRow>('/notifications');
      setRows(list);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة مركز الإشعارات'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = async (id: string) => {
    try {
      await apiPost(`/notifications/${encodeURIComponent(id)}/read`, {});
      await load();
    } catch {
      // silent retry on next refresh
    }
  };

  const columns: Column<NotificationRow>[] = [
    { key: 'title', header: 'العنوان', cell: (r) => String(r.title ?? 'تنبيه نظام') },
    { key: 'body', header: 'التفاصيل', cell: (r) => String(r.body ?? r.message ?? '—') },
    {
      key: 'date',
      header: 'التوقيت',
      ltr: true,
      cell: (r) => String(r.createdAt ?? '').slice(0, 16).replace('T', ' ') || '—',
    },
    {
      key: 'status',
      header: 'القراءة',
      cell: (r) => {
        const read = Boolean(r.readAt || r.isRead);
        return <Badge status={read ? 'active' : 'pending'}>{read ? 'مقروء' : 'جديد'}</Badge>;
      },
    },
    {
      key: 'action',
      header: 'إجراء',
      cell: (r) =>
        !(r.readAt || r.isRead) ? (
          <Button onClick={() => void markRead(r.id)} size="sm">
            تعليم كمقروء
          </Button>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">مركز الإشعارات والتنبيهات</h1>
          <p className="ui-page-sub">تنبيهات أوامر التحميل وإقفالات العهد والاعتمادات المحاسبية الواردة لحسابك.</p>
        </div>
        <div className="ui-page-actions">
          <Button onClick={() => void load()} size="sm">
            تحديث الإشعارات
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        <Card>
          <CardHeader subtitle="اضغط تعليم كمقروء بعد مراجعة التنبيه." title={`الإشعارات (${rows.length})`} />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا إشعارات جديدة في صندوقك"
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
