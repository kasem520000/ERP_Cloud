import { redirect } from 'next/navigation';

/**
 * تحويل دائم من المسار القديم `/organization/company` إلى المسار الفعلي لبطاقة المنشأة
 * والعنوان الوطني `/settings/company`، منعاً لخطأ 404 عند فتح الروابط القديمة أو المحفوظة.
 */
export default function OrganizationCompanyRedirectPage() {
  redirect('/settings/company');
}
