/**
 * 🚐 عقدُ مساحة عمل المندوب — شكلُ حمولة `GET /van-sales/me` كما يقرأها الخادم حرفًا.
 *
 * وهذا هو موضعُها: فالحزمةُ «عقدُ الشبكة وحده» بحسب ميثاقها، والمسارُ يستهلكه وجهان
 * (‏`apps/staff/app/van-sales/rep/page.tsx` القائم، و`apps/bakery/app/rep/page.tsx`) — ونوعان
 * للحمولة نفسها في تطبيقَين يعني أنّ تغييرًا في الخادم يُكسر أحدهما بصمت.
 *
 * والمصدرُ المرجعيّ `VanSalesService.repWorkspace` في
 * ‏`apps/api/src/modules/van-sales/van-sales.service.ts`، وأحكامُه المقاسة في
 * ‏`apps/api/test/van-sales-rep-workspace-totals.spec.ts` و
 * `apps/api/test/van-sales-returns-in-reports.spec.ts`.
 *
 * ‏**وقاعدتان في الأرقام لا تُنسيان:**
 *
 * 1. **القوائمُ نوافذ والمجاميعُ جدولات**: ‏`loadOrders` أحدثُ ٥٠ و`documents` أحدثُ ١٠٠ و
 *    `collections` أحدثُ ٥٠ و`notifications` أحدثُ ٢٠، وأمّا `totals` و`custody` فجمعُ جدول
 *    المندوب **كلّه** (الشريحة ١٣أ). و`windows` يُعلن العددَين لكلّ قائمة، و`balances` و
 *    `pendingReceipts` كاملتان (بلا `LIMIT`) ⇒ **لا مفتاحَ لهما في `windows`**.
 * 2. **كلُّ أرقام المال صافيةٌ من المرتجعات** (الشريحة ١٣ب): ‏`revenue = salesGross −
 *    returns − returnsVat`، و`cashSales + creditSales − returns − returnsVat = revenue`،
 *    و`outstanding` بعد خصم الإشعارات الدائنة. فأطرافُ المعادلة معروضةٌ معها ولا يُقرأ
 *    رقمٌ صافٍ كأنّ مرتجعًا لم يحدث.
 */

/** رصيدُ صنفٍ في سيارة المندوب من دفتر المخزون الرسميّ (`stock_balances`). */
import type { DashboardWindow, DashboardWindows } from './windows';

export type RepBalanceRow = {
  itemId: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  quantity: string;
  value: string;
  averageCost: string;
};

/** توريدٌ بانتظار تأكيد المندوب استلامَه (بضاعةٌ في الطريق، ليست في السيارة بعد). */
export type RepPendingReceipt = {
  id: string;
  number: string;
  loadDate: string;
  status: string;
  loadedQty: string;
  receivedQty: string;
  productionBatchNo: string;
  stockTransferId: string | null;
  itemName: string;
  fromWarehouseName: string;
};

export type RepLoadOrderRow = {
  id: string;
  number: string;
  loadDate: string;
  status: string;
  itemId?: string | null;
  itemName: string;
  productionBatchNo: string;
  loadedQty: string;
  receivedQty: string;
  soldQty: string;
  bonusQty: string;
  returnedQty: string;
  damagedQty: string;
  shortageQty: string;
  shortageValue: string;
  expectedCash: string;
  collectedCash: string;
  outstandingCash: string;
  /** ما يجب أن يبقى في السيارة حسب المستندات قبل الجرد — حقلُّ الخادم لا حسابُ العميل. */
  expectedRemainingQty: string;
  /** ما أعلنه المندوب فعليًّا عند تقديم الإغلاق. */
  actualRemainingQty: string;
  /**
   * ⚠️ **نقصُ الاستلام** لا فرقُ الجرد: الخادمُ يكتبه في `confirmReceipt`
   * كـ`max(0, loaded_qty − received_qty)` (‏`van-sales.service.ts:3615`)، ومنه تُشتقّ
   * ‏`stock_settlement_status = 'pending_transit_decision'`. ففرقُ الجرد يُقرأ من
   * ‏`expectedRemainingQty` مقابل `actualRemainingQty` ومن `shortageQty` بعد الإقفال.
   */
  discrepancyQty: string;
  discrepancyNotes: string | null;
  closingSubmittedAt: string | null;
  approvedAt: string | null;
  stockSettlementStatus?: string;
  stockSettlementNote?: string;
  remainingAction?: 'return_to_main' | 'carry_over' | null;
};

export type RepDocumentRow = {
  id: string;
  number: string;
  docDate: string;
  documentKind: string;
  invoiceMode: string;
  paymentMethod: string;
  customerName: string;
  itemName: string;
  soldQty: string;
  bonusQty: string;
  unitPrice: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  outstanding: string;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
};

export type RepCollectionRow = {
  id: string;
  collectedAt: string;
  amount: string;
  reason: string;
  voucherNumber: string | null;
  voucherStatus: string | null;
};

export type RepNotification = {
  id: string;
  type: string;
  read: boolean;
  createdAt: string;
  payload: Record<string, unknown>;
};

export type RepTotals = {
  revenue: string;
  salesGross: string;
  cashSales: string;
  creditSales: string;
  collected: string;
  outstanding: string;
  returns: string;
  returnsVat: string;
  returnCount: number;
  /** مرتجعاتٌ إشعارُها الدائن غير مُرحَّل فتكلفتُها مجهولة ⇒ لم يُخصم لها أثرٌ في الربح. */
  returnsWithoutCostCount: number;
};

export type RepCustody = {
  expectedKg: string;
  officialKg: string;
  pendingClosings: number;
};

/**
 * نوافذُ المندوب — **نوعُ الحزمة نفسه** (`DashboardWindow`) لا نوعٌ ثانٍ بشكله: فجملةُ
 * النافذة (`windowNote`) تأخذ `DashboardWindows`، ونوعٌ موازٍ كان يفرض تحويلًا في كلّ شاشة.
 * والمفاتيحُ الأربعةُ هي ما يُعلنه `repWorkspace` (ولا `productionBatches` ولا `movements`
 * ولا `customerPriceHistory` — فتلك نوافذُ لوحة الخطّ).
 */
export type RepWindow = DashboardWindow;

export type RepWindows = Pick<
  DashboardWindows,
  'loadOrders' | 'documents' | 'collections' | 'notifications'
>;

export type RepWorkspace = {
  isRep: boolean;
  salesmanId: string | null;
  salesmanName: string | null;
  employeeId?: string | null;
  warehouseId: string | null;
  vehiclePlate: string | null;
  active: boolean;
  /** رسالةُ الخادم حين لا بطاقةَ مندوب مرتبطة بالحساب — تُعرض كما هي. */
  message?: string;
  custodyKg: string;
  custodyValue: string;
  balances: RepBalanceRow[];
  pendingReceipts: RepPendingReceipt[];
  loadOrders: RepLoadOrderRow[];
  documents: RepDocumentRow[];
  collections: RepCollectionRow[];
  notifications: RepNotification[];
  /** ‏فرعُ «لستَ مندوبًا» لا يحمل مجاميعَ ولا نوافذ — فغيابُها معنىً لا نقصٌ. */
  totals?: RepTotals;
  custody?: RepCustody | null;
  windows?: RepWindows | null;
};

/** صلاحيةُ قراءة المساحة — والخادمُ يشتقّ المندوبَ من عضوية المتّصل لا من معاملٍ في الطلب. */
export const REP_WORKSPACE_PERMISSION = 'van_sales.view';
