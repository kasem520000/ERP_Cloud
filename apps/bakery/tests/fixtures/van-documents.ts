import type { DocumentRow } from '../../lib/sales-screen';

/**
 * 🧾 مستندُ توزيعٍ كما يرجعه `GET /van-sales/dashboard` في `documents` — fixture واحدة
 * لشاشتي «فواتير الخطّ» و«التحصيل» معًا، فلا يختلف شكل المستند بين مواصفتين (واختلافُ
 * الشكل هناك يعني شاشةً تقرأ حقلًّا لا يرجعه الخادم).
 *
 * والقيم الافتراضية قابلة للقراءة: بيعٌ آجل ٣٤٫٥٠ ريالًا دُفع منها ١٠ فبقي ٢٤٫٥٠، ومبيع
 * ٢٠ كجم + مجانيّ ٢ ⇒ سقفُ المرتجع ٢٢ (الخادم يجمع المجانيّ إلى المبيع).
 */
export function doc(overrides: Partial<DocumentRow> = {}): DocumentRow {
  return {
    id: 'doc-1',
    number: 'VSD-2026-000123',
    docDate: '2026-10-01',
    createdAt: '2026-10-01T06:00:00.000Z',
    documentKind: 'sale',
    referenceDocumentId: null,
    invoiceMode: 'zatca_tax',
    taxPolicyStatus: 'standard_vat',
    invoiceNumber: 'INV-2026-000456',
    invoiceStatus: 'submitted',
    paymentMethod: 'credit',
    productionBatchNo: 'BATCH-2026-10-01-A',
    loadOrderId: 'load-1',
    salesInvoiceId: 'si-1',
    receiptVoucherId: null,
    salesmanId: 'sm-1',
    salesmanName: 'سالم المندوب',
    partyId: 'party-1',
    customerName: 'بقالة النور',
    customerTaxNo: '300098765400003',
    itemId: 'item-1',
    itemName: 'خبز تميس',
    soldQty: '20.00',
    bonusQty: '2.00',
    bonusReason: 'ترويجي',
    unitPrice: '1.50',
    discountAmount: '0.00',
    discountReason: '',
    subtotal: '30.00',
    taxRate: '15.00',
    taxTotal: '4.50',
    total: '34.50',
    paidAmount: '10.00',
    unitCost: '0.90',
    netProfit: '12.00',
    customerBonusConfirmed: false,
    customerConfirmationCode: '',
    bonusAnomaly: false,
    anomalyReason: '',
    qrPayload: '',
    notes: '',
    ...overrides,
  };
}
