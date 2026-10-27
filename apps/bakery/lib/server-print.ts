import { apiData } from '@erp/web-core/api';
import { dayInMakkah } from '@erp/web-core/date';

/** تاريخ اليوم بتوقيت مكة المكرمة بصيغة YYYY-MM-DD (متوافق مع الخادم). */
export function makkahTodayIso(now: Date = new Date()): string {
  return dayInMakkah(now);
}

/** تاريخ ووقت مقروء بتوقيت مكة المكرمة. */
export function formatMakkahDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return String(iso);
  try {
    return new Intl.DateTimeFormat('ar-SA', {
      timeZone: 'Asia/Riyadh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(parsed);
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

/** يفتح مستند HTML جاهزاً للطباعة في نافذة معاينة أو إطار مخفي عند حجب النوافذ المنبثقة. */
export function openHtmlPrintWindow(html: string): void {
  if (!html.trim() || typeof window === 'undefined') return;
  const popup = window.open('', '_blank', 'noopener,noreferrer,width=960,height=840');
  if (popup) {
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    setTimeout(() => {
      try {
        popup.print();
      } catch {
        /* user can print manually from the preview window */
      }
    }, 280);
    return;
  }

  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const doc = iframe.contentWindow?.document;
  if (doc) {
    doc.open();
    doc.write(html);
    doc.close();
    setTimeout(() => {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
      setTimeout(() => {
        iframe.remove();
      }, 4000);
    }, 300);
  }
}

/**
 * يجلب صفحة الطباعة الرسمية من الخادم (`{ html }`) — شاملةً ترويسة المنشأة ورمز QR الضريبي
 * والعنوان الوطني المشروط وقالب A4 أو إيصال الكاشير 80mm — ويفتحها للطباعة الفورية.
 */
export async function openServerPrintHtml(path: string): Promise<void> {
  const res = await apiData<{ html?: string }>(path);
  const html = res?.html ?? '';
  if (!html.trim()) {
    throw new Error('لم يُرجع الخادم محتوى قابلاً للطباعة');
  }
  openHtmlPrintWindow(html);
}
