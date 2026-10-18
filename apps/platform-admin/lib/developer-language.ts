import type { ApiKeyScope, WebhookEvent } from '@erp/contracts';

/** Labels are presentation only: the API still receives the original catalogue codes. */
export const SCOPE_LABELS: Record<ApiKeyScope, string> = {
  'invoices:read': 'قراءة الفواتير',
  'invoices:write': 'إدارة الفواتير',
  'inventory:read': 'قراءة المخزون',
  'inventory:write': 'إدارة المخزون',
  'parties:read': 'قراءة العملاء والموردين',
  'parties:write': 'إدارة العملاء والموردين',
  'reporting:read': 'قراءة التقارير',
  'webhooks:manage': 'إدارة اشتراكات الأحداث',
};

export const EVENT_LABELS: Record<WebhookEvent, string> = {
  'invoice.posted': 'اعتماد فاتورة',
  'invoice.paid': 'سداد فاتورة',
  'invoice.voided': 'إلغاء فاتورة',
  'stock.below_reorder': 'انخفاض المخزون عن حد إعادة الطلب',
  'einvoice.submission_failed': 'تعذّر إرسال الفاتورة الإلكترونية',
  'shift.closed': 'إغلاق وردية',
  'subscription.activated': 'تفعيل اشتراك',
  'subscription.plan_changed': 'تغيير باقة الاشتراك',
  'subscription.suspended': 'تعليق الاشتراك',
};

export function scopeLabel(code: string): string {
  return SCOPE_LABELS[code as ApiKeyScope] ?? 'نطاق إضافي';
}

export function eventLabel(code: string): string {
  return EVENT_LABELS[code as WebhookEvent] ?? 'حدث إضافي';
}
