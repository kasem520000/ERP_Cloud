import { redirect } from 'next/navigation';

/**
 * `/purchases` — عنوان الوحدة نفسه لا شاشة له؛ أول شاشة فيها هي فواتير المشتريات.
 *
 * كان الوصول إلى `/purchases` (من رابطٍ قديم أو عنوانٍ مكتوب بيد) يعطي 404، بينما الشريط
 * الجانبي يشير إلى `/purchases/invoices`. التحويل يجعل المسار الأقصر يعمل بلا شاشةٍ ثانية
 * تُكرّر القائمة — أي بلا نسخةٍ جديدة تُصان إلى الأبد.
 */
export default function PurchasesIndexPage(): never {
  redirect('/purchases/invoices');
}
