'use client';

import { useCallback, useEffect, useState } from 'react';

import { apiData } from '../lib/api';
import { useQuery } from '../lib/use-query';

/**
 * جرس الإشعارات (P-C7، `docs/roadmap/PLATFORM_CONSOLE_PLAN.md` §4: «مركز إشعارات في
 * staff: جرس + شاشة»).
 *
 * الرقم الذي يعرضه الجرس هو `meta.unread` من `GET /notifications` نفسه — لا عدّادٌ ثانٍ
 * يُحسب في المتصفح، فلا رقمان لسؤالٍ واحد. والاستطلاع كل دقيقةٍ استطلاعٌ هادئ: طلب واحد
 * صغير، ويفشل صامتاً (جرسٌ لا رقم خيرٌ من شاشة خطأ في الشريط العلوي).
 */
export function NotificationBell({ label }: { label: string }) {
  const [unread, setUnread] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const page = await apiData<{ meta: { unread: number } }>('/notifications?limit=1');
      setUnread(page.meta.unread);
    } catch {
      setUnread(null); // صامتٌ عن قصد: الجرس زينةٌ لا وظيفة.
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => clearInterval(timer);
  }, [refresh]);

  return (
    <a className="btn bell" href="/notifications" title={label} aria-label={label}>
      🔔
      {unread !== null && unread > 0 && <span className="bell-count">{unread}</span>}
    </a>
  );
}

/**
 * مركز الإشعارات — الصفحة التي يقود إليها الجرس. تقرأ صندوق العضوية الحالية
 * (`GET /notifications`) وتوسم المقروء (`POST /notifications/:id/read`)، وتعرض ما يرسله
 * المشغّل بإعلاناته: العنوان والنصّ من `payload` الذي وضعه الإعلان نفسه، فلا ترجمةٌ ثانية
 * في الواجهة ولا نصٌّ مخترع هنا.
 */
export function NotificationInbox({ locale }: { locale: 'ar' | 'en' }) {
  const [onlyUnread, setOnlyUnread] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | undefined>(undefined);

  const inbox = useQuery<{ data: Notification[]; meta: { unread: number; total: number } }>(
    () =>
      apiData<{ data: Notification[]; meta: { unread: number; total: number } }>(
        `/notifications?limit=50${onlyUnread ? '&filter[read]=false' : ''}`,
      ),
    [onlyUnread],
  );

  async function markRead(id: string) {
    setBusyId(id);
    setNotice(undefined);
    try {
      await apiData(`/notifications/${id}/read`, { method: 'POST' });
      inbox.reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  async function markAllRead() {
    setBusyId('all');
    setNotice(undefined);
    try {
      const unread = (inbox.data?.data ?? []).filter((item) => !item.readAt);
      for (const item of unread) {
        await apiData(`/notifications/${item.id}/read`, { method: 'POST' });
      }
      setNotice(unread.length === 0 ? 'لا غيرَ مقروء.' : `وُسم ${unread.length} إشعاراً مقروءاً.`);
      inbox.reload();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid">
      <div className="toolbar">
        <span className="chip">
          {locale === 'ar' ? 'غير مقروء' : 'Unread'}: {inbox.data?.meta.unread ?? 0}
        </span>
        <label className="row" style={{ gap: 6, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={onlyUnread}
            onChange={(event) => setOnlyUnread(event.target.checked)}
          />
          <span>{locale === 'ar' ? 'غير المقروء فقط' : 'Unread only'}</span>
        </label>
        <button className="btn" type="button" disabled={busyId === 'all'} onClick={() => void markAllRead()}>
          {locale === 'ar' ? 'قراءة الكل' : 'Mark all read'}
        </button>
        <button className="btn" type="button" onClick={inbox.reload}>
          {locale === 'ar' ? 'تحديث' : 'Refresh'}
        </button>
      </div>

      {notice && <p className="notice">{notice}</p>}
      {inbox.status === 'loading' && <p className="muted">…</p>}
      {inbox.status === 'error' && <p className="error">{inbox.error}</p>}
      {inbox.status === 'success' && (inbox.data?.data.length ?? 0) === 0 && (
        <p className="muted">{locale === 'ar' ? 'لا جديد.' : 'Nothing new.'}</p>
      )}

      <ul className="inbox">
        {(inbox.data?.data ?? []).map((item) => {
          const text = notificationText(item, locale);
          return (
            <li key={item.id} className={item.readAt ? 'read' : 'unread'}>
              <div className="row" style={{ justifyContent: 'space-between', gap: 12 }}>
                <div>
                  <strong>{text.title}</strong>
                  <p className="muted" style={{ margin: '4px 0 0' }}>
                    {text.body}
                  </p>
                  {typeof item.payload.href === 'string' ? (
                    <a href={item.payload.href}>فتح المستند</a>
                  ) : null}
                  <p className="muted" style={{ margin: '6px 0 0', fontSize: 12 }}>
                    {new Date(item.createdAt).toLocaleString(locale === 'ar' ? 'ar-SA' : 'en-GB')} ·{' '}
                    {item.type}
                  </p>
                </div>
                {!item.readAt && (
                  <button
                    className="btn"
                    type="button"
                    disabled={busyId === item.id}
                    onClick={() => void markRead(item.id)}
                  >
                    {locale === 'ar' ? 'تحديد كمقروء' : 'Mark read'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

type Notification = {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

/** نصّ الإشعار بلغة القارئ. غير المعروف يُعرض بمعرّفه — لا نخترع نصّاً لحدثٍ لا نعرفه. */
function notificationText(item: Notification, locale: 'ar' | 'en'): { title: string; body: string } {
  const payload = item.payload ?? {};
  if (item.type === 'announcement') {
    return {
      title: locale === 'ar' ? text(payload.titleAr, 'إعلان') : text(payload.titleEn, 'Announcement'),
      body: locale === 'ar' ? text(payload.bodyAr) : text(payload.bodyEn),
    };
  }
  if (item.type === 'comment.mention') {
    return {
      title: text(payload.title, locale === 'ar' ? 'إشارة في تعليق' : 'Comment mention'),
      body: text(payload.message),
    };
  }
  return { title: item.type, body: text(payload.message) };
}
