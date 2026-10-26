'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

interface NotificationDtoRow {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface RepWorkspaceNotificationRow {
  id: string;
  type: string;
  payload: Record<string, unknown> | string;
  readAt: string | null;
  createdAt: string;
}

interface NotificationsEnvelope {
  data?: NotificationDtoRow[];
  meta?: { total?: number; unread?: number };
}

interface RepWorkspaceEnvelope {
  data?: {
    notifications?: RepWorkspaceNotificationRow[];
  };
}

const TYPE_LABEL_AR: Record<string, string> = {
  support_ticket_reply: 'رد الدعم الفني',
  marketplace_addon_approved: 'تفعيل باقة إضافية',
  marketplace_addon_rejected: 'تحديث طلب باقة',
  van_sales_closing_request: 'طلب اعتماد إقفال عهدة مندوب',
  van_sales_closing_approved: 'اعتماد إقفال العهدة',
  van_sales_receipt_confirmed: 'تأكيد استلام توريد',
  van_sales_receipt_discrepancy: 'فرق كمية في استلام توريد',
  van_sales_supply_pending_receipt: 'أمر تحميل بانتظار الاستلام',
  van_sales_load_canceled: 'إلغاء أمر تحميل',
  announcement: 'إعلان المنصة',
  'settings.updated': 'تحديث إعدادات المنشأة',
  'payment.received': 'دفعة مستلمة',
  'comment.mention': 'إشارة في تعليق',
};

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim().length > 0 ? value : fallback;
}

function normalizePayload(raw: Record<string, unknown> | string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return raw;
}

function extractText(item: NotificationDtoRow): { title: string; body: string; href: string | null } {
  const payload = item.payload ?? {};
  const rawHref = typeof payload.href === 'string' && payload.href.length > 0 ? payload.href : null;
  if (item.type === 'announcement') {
    return {
      title: str(payload.titleAr, 'إعلان من المنصة'),
      body: str(payload.bodyAr, str(payload.body)),
      href: rawHref,
    };
  }
  return {
    title: str(payload.title, TYPE_LABEL_AR[item.type] ?? 'إشعار جديد'),
    body: str(payload.body, str(payload.message)),
    href: rawHref,
  };
}

function mapBakeryHref(href: string | null, type: string): string | null {
  if (type === 'van_sales_closing_request') return '/custody';
  if (
    type === 'van_sales_supply_pending_receipt' ||
    type === 'van_sales_load_canceled'
  ) {
    return '/rep';
  }
  if (!href) return null;
  if (href.startsWith('/van-sales/rep')) return '/rep';
  if (href.startsWith('/van-sales')) return '/distribution';
  return null;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('ar-SA', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function BakeryNotificationBell() {
  const { can } = useSession();
  const canTenantNotifications = can('tenant.notification.view');
  const canVanView = can('van_sales.view');

  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationDtoRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      if (canTenantNotifications) {
        const res = await apiFetch<NotificationsEnvelope>('/notifications?limit=12');
        const rows: NotificationDtoRow[] = Array.isArray(res?.data) ? res.data : [];
        setItems(rows);
        setUnread(
          typeof res?.meta?.unread === 'number'
            ? res.meta.unread
            : rows.filter((row: NotificationDtoRow) => !row.readAt).length,
        );
        return;
      }
      if (canVanView) {
        const res = await apiFetch<RepWorkspaceEnvelope>('/van-sales/me');
        const rawRows = Array.isArray(res?.data?.notifications) ? res.data.notifications : [];
        const rows: NotificationDtoRow[] = rawRows.slice(0, 12).map((row) => ({
          id: row.id,
          type: row.type,
          payload: normalizePayload(row.payload),
          readAt: row.readAt ?? null,
          createdAt: row.createdAt,
        }));
        setItems(rows);
        setUnread(rows.filter((row: NotificationDtoRow) => !row.readAt).length);
      }
    } catch {
      // نبض هادئ — لا يقطع سير العمل عند انقطاع مؤقت
    }
  }, [canTenantNotifications, canVanView]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const onClickOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [open]);

  const markRead = async (id: string) => {
    if (!canTenantNotifications) {
      setItems((prev) =>
        prev.map((row) => (row.id === id ? { ...row, readAt: new Date().toISOString() } : row)),
      );
      setUnread((prev) => Math.max(0, prev - 1));
      return;
    }
    try {
      await apiFetch(`/notifications/${id}/read`, { method: 'POST', body: '{}' });
      setItems((prev) =>
        prev.map((row) => (row.id === id ? { ...row, readAt: new Date().toISOString() } : row)),
      );
      setUnread((prev) => Math.max(0, prev - 1));
    } catch {
      // سيعاد تحديثه في الجلب القادم
    }
  };

  const markAllRead = async () => {
    setBusy(true);
    try {
      const unreadRows = items.filter((row) => !row.readAt);
      if (canTenantNotifications) {
        await Promise.all(
          unreadRows.map((row) =>
            apiFetch(`/notifications/${row.id}/read`, { method: 'POST', body: '{}' }).catch(() => null),
          ),
        );
      }
      const now = new Date().toISOString();
      setItems((prev) => prev.map((row) => ({ ...row, readAt: row.readAt ?? now })));
      setUnread(0);
    } finally {
      setBusy(false);
    }
  };

  if (!canTenantNotifications && !canVanView) {
    return null;
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) void load();
        }}
        className="relative inline-flex h-8 w-8 items-center justify-center rounded-md border border-line bg-surface text-ink transition hover:bg-surface-2"
        aria-label={unread > 0 ? `الإشعارات (${unread} غير مقروءة)` : 'الإشعارات'}
        title="الإشعارات"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 ? (
          <span
            className="absolute -top-1 -start-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-danger px-1 text-[10px] font-extrabold leading-none text-white"
            dir="ltr"
          >
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="قائمة الإشعارات"
          className="fixed inset-x-3 top-14 z-50 overflow-hidden rounded-lg border border-line bg-surface shadow-2 sm:absolute sm:inset-x-auto sm:end-0 sm:top-10 sm:w-[340px]"
        >
          <div className="flex items-center justify-between border-b border-line bg-surface-2 px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <strong className="text-[13px] font-bold text-ink">الإشعارات</strong>
              {unread > 0 ? (
                <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand">
                  {unread} جديد
                </span>
              ) : null}
            </div>
            {unread > 0 ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => void markAllRead()}
                className="text-[11.5px] font-semibold text-brand hover:underline disabled:opacity-50"
              >
                تعليم الكل كمقروء
              </button>
            ) : null}
          </div>

          <div className="max-h-[360px] divide-y divide-line overflow-y-auto">
            {items.length === 0 ? (
              <p className="m-0 px-4 py-7 text-center text-[12.5px] text-muted">
                لا توجد إشعارات حالياً.
              </p>
            ) : (
              items.map((item) => {
                const { title, body, href } = extractText(item);
                const targetHref = mapBakeryHref(href, item.type);
                const inner = (
                  <div className="flex items-start gap-2.5">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        item.readAt ? 'bg-transparent' : 'bg-brand'
                      }`}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <strong className="truncate text-[12.5px] font-bold text-ink">
                          {title}
                        </strong>
                        <span className="shrink-0 text-[10.5px] text-muted">
                          {formatTime(item.createdAt)}
                        </span>
                      </div>
                      {body ? (
                        <p className="m-0 mt-1 line-clamp-2 text-[12px] leading-relaxed text-ink-2">
                          {body}
                        </p>
                      ) : null}
                    </div>
                  </div>
                );

                const itemClass = `block w-full px-3.5 py-2.5 text-start transition hover:bg-surface-2 ${
                  item.readAt ? 'opacity-75' : 'bg-brand-soft/20'
                }`;

                return targetHref ? (
                  <Link
                    key={item.id}
                    href={targetHref}
                    onClick={() => {
                      if (!item.readAt) void markRead(item.id);
                      setOpen(false);
                    }}
                    className={itemClass}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      if (!item.readAt) void markRead(item.id);
                    }}
                    className={itemClass}
                  >
                    {inner}
                  </button>
                );
              })
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
