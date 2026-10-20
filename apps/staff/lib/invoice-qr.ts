import { apiData } from './api';

/**
 * 🧾 حمولة رمز الفاتورة الإلكترونية **كما أصدرتها وحدة الفوترة** على الفاتورة نفسها
 * (`sales_invoices.zatca_qr`، تُكتب عند `POST /sales-invoices/:id/einvoice/submit` أو عند
 * المصادقة من الهيئة).
 *
 * لا تُبنى حمولة TLV في المتصفّح: رمزٌ بلا توقيعٍ ولا مفتاحٍ عام ليس فاتورةً إلكترونية،
 * ورسمه على إيصالٍ يدفعه العميل لجهةٍ حكومية ادّعاءٌ لا زينة. والقراءة best-effort:
 * فاتورةٌ لم تُصدر بعد، أو مستخدمٌ لا يملك قراءتها، أو شبكةٌ مقطوعة — كلها `null`،
 * والإيصال يطبع سطر «لم تُصدر بعد» الصريح.
 */
export async function issuedQrPayload(invoiceId?: string | null): Promise<string | null> {
  const id = invoiceId?.trim();
  if (!id) return null;
  try {
    const doc = await apiData<{ qrCode?: string | null }>(`/sales/invoices/${id}`);
    const payload = doc.qrCode?.trim();
    return payload ? payload : null;
  } catch {
    return null;
  }
}
