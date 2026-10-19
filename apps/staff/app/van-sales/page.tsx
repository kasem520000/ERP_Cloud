'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Panel, Tabs } from '@erp/ui';
import { useSubmissionKey } from '@erp/web-core/use-submission-key';
import { openVanDocumentPrintWindow, type VanDocumentPrintView } from '@erp/web-van/document-print';
import { DASHBOARD_TOTALS_CLAUSE, windowNote, type DashboardWindows } from '@erp/web-van/windows';

import { Notice } from '../../components/data-view';
import { Screen } from '../../components/screen';
import { ZatcaQrSvg, printThermalReceipt80mm } from '../../components/zatca-qr-svg';
import { apiData, apiErrorText, apiPost } from '../../lib/api';
import {
  buildProductionBatchPayload,
  estimateComponentCost,
  type ProductionBatchPayload,
} from '../../lib/van-production';
import {
  defaultOf,
  itemLabel,
  listCashLocations,
  listItems,
  listParties,
  listSalesmen,
  listWarehouses,
  today,
  type CashLocation,
  type Item,
  type Party,
  type Salesman,
  type Warehouse,
} from '../../lib/lookups';
import { Table } from '../../components/ui/table';

/**
 * صف من الرصيد الرسمي — one row of `stock_balances`, the ledger the item card and the
 * stock report read. The factory tab shows these instead of a number derived from the
 * add-on tables, so the two screens can never disagree about what the warehouse holds.
 */
type OfficialStockRow = {
  itemId: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  warehouseCode: string;
  branchId: string | null;
  quantity: string;
  value: string;
  averageCost: string;
};

/** مندوب التوزيع — the official `salesmen` card with its employee, login and custody. */
type VanSalesman = {
  id: string;
  name: string;
  active: boolean;
  employeeId: string | null;
  employeeNo: string | null;
  employeeName: string | null;
  employeeStatus: string | null;
  membershipId: string | null;
  membershipStatus: string | null;
  userEmail: string | null;
  userStatus: string | null;
  roleCount: number;
  permissions: string[];
  warehouseId: string | null;
  warehouseName: string | null;
  warehouseCode: string | null;
  vehiclePlate: string | null;
  tel: string | null;
  mobile: string | null;
  email: string | null;
  custody: {
    openLoadOrders: number;
    pendingReceipts: number;
    pendingClosings: number;
    custodyQty: string;
    outstandingCash: string;
    items: Array<{
      itemId: string;
      itemName: string;
      warehouseName: string;
      quantity: string;
      value: string;
    }>;
  };
  readiness: {
    hasEmployee: boolean;
    hasLoginAccount: boolean;
    loginActive: boolean;
    hasVanWarehouse: boolean;
    hasVanSalesPermissions: boolean;
  };
};

type ProductionBatch = {
  id: string;
  batchNo: string;
  productionDate: string;
  itemId: string | null;
  itemName: string;
  producedQty: string;
  issuedQty: string;
  returnedGoodQty: string;
  damagedQty: string;
  availableWarehouseQty: string;
  unitCost: string;
  totalCost: string;
  /** أساس التكلفة: أمر تصنيع رسمي، أم إدخال يدوي/تكلفة البطاقة. */
  costBasis?: string;
  /** قيمة الفاقد، وهل حُمِّلت على تكلفة المنتج الجيد. */
  scrapQty?: string;
  scrapValue?: string;
  scrapCostLoaded?: boolean;
  /** الربط الرسمي للدفعة: أمر الإنتاج/التصنيع، الحركة المخزنية، ودفعة الناتج (اللوت). */
  warehouseId?: string | null;
  productionOrderId?: string | null;
  manufacturingOrderId?: string | null;
  inventoryTransactionId?: string | null;
  lotId?: string | null;
  status: string;
  supervisorName: string;
  notes: string;
};

type RepPerformance = {
  salesmanId: string;
  salesmanName: string;
  loadedKg: string;
  soldKg: string;
  bonusKg: string;
  returnedKg: string;
  damagedKg: string;
  shortageKg: string;
  shortageSar: string;
  custodyRemainingKg: string;
  revenueSar: string;
  collectedSar: string;
  creditDebtSar: string;
  netProfitSar: string;
  pendingClosings: number;
};

type LoadOrder = {
  id: string;
  number: string;
  loadDate: string;
  productionBatchNo: string;
  vehiclePlate: string;
  status: string;
  salesmanId: string;
  salesmanName: string;
  itemId: string | null;
  itemName: string;
  loadedQty: string;
  /** ما أكّد المندوب استلامه فعلًا — أساس العهدة بعد خطوة الاستلام. */
  receivedQty?: string;
  discrepancyQty?: string;
  discrepancyNotes?: string;
  receivedAt?: string | null;
  awaitingReceipt?: boolean;
  warehouseId?: string | null;
  vanWarehouseId?: string | null;
  stockTransferId?: string | null;
  soldQty: string;
  bonusQty: string;
  returnedQty: string;
  damagedQty: string;
  shortageQty: string;
  shortageValue: string;
  remainingQty: string;
  /** ما أعلنته الوردية فعلياً عند الجرد. */
  actualRemainingQty?: string;
  /** ما تقول المستندات إنه يجب أن يبقى في السيارة. */
  expectedRemainingQty?: string;
  /** موجب = عجز عن الجرد، سالب = فائض. */
  countVarianceQty?: string;
  /** قيمة فرق الجرد على أساس التكلفة — قيمة تسوية مخزنية، لا دين على المندوب. */
  countVarianceCostValue?: string;
  /** ما كتبه مستند الجرد الرسمي نفسه بعد ترحيله. */
  countDocumentVarianceValue?: string | null;
  countDocumentExpectedQty?: string | null;
  /**
   * تسوية المخزون الرسمية — مستند الجرد الرسمي، مصير المتبقي الفعلي، وحالة التسوية.
   * العهدة لا تُغلق (`settled`) ورصيد السيارة الرسمي يختلف عن الجرد الفعلي.
   */
  stockAdjustmentId?: string | null;
  remainingAction?: 'return_to_main' | 'carry_over' | null;
  remainingInventoryTxId?: string | null;
  stockSettlementStatus?: string;
  stockSettlementNote?: string;
  damageJournalEntryId?: string | null;
  awaitingStockSettlement?: boolean;
  awaitingTransitDecision?: boolean;
  maxBonusQty: string;
  maxBonusPct: string;
  expectedCash: string;
  collectedCash: string;
  cashVariance: string;
  damageReason: string;
  damageInspected: boolean;
  salaryDeductionApproved: boolean;
  closingNotes: string;
  closingSubmittedAt: string | null;
  approvedAt: string | null;
  approvedByLabel: string;
  notes: string;
};

type CustomerPrice = {
  id: string;
  partyId: string;
  partyName: string;
  partyCode: string;
  partyTaxNo: string;
  itemId: string | null;
  itemName: string;
  priceTierLabel: string;
  unitPrice: string;
  maxBonusPct: string;
  maxBonusKgPerInvoice: string;
  preferredInvoiceMode: 'zatca_tax' | 'internal_delivery';
  creditLimit: string;
  paymentTermsDays: number;
  lockPrice: boolean;
  maxDiscountPct: string;
  notes: string;
};

type VanDocument = {
  id: string;
  number: string;
  docDate: string;
  invoiceMode: 'zatca_tax' | 'internal_delivery';
  paymentMethod: string;
  documentKind?: string;
  referenceDocumentId?: string | null;
  /** رقم وحالة الفاتورة الرسمية في `sales_invoices`. */
  invoiceNumber?: string | null;
  invoiceStatus?: string | null;
  productionBatchNo: string;
  loadOrderId: string | null;
  salesmanId: string | null;
  salesmanName: string;
  partyId: string | null;
  customerName: string;
  customerTaxNo: string;
  itemId: string | null;
  itemName: string;
  soldQty: string;
  bonusQty: string;
  bonusReason: string;
  unitPrice: string;
  discountAmount: string;
  discountReason: string;
  subtotal: string;
  taxRate: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  unitCost: string;
  netProfit: string;
  customerBonusConfirmed: boolean;
  customerConfirmationCode: string;
  bonusAnomaly: boolean;
  anomalyReason: string;
  /** رمز ZATCA (TLV) المبني على الخادم من ملف المنشأة الرسمي. */
  qrPayload?: string;
  notes: string;
  createdAt: string;
};

type StockMovement = {
  id: string;
  movementType: string;
  batchNo: string;
  qty: string;
  unitPrice: string;
  amount: string;
  reason: string;
  salesmanName: string;
  customerName: string;
  actorLabel: string;
  approvedByLabel: string;
  createdAt: string;
};

type CustomerPriceHistoryItem = {
  id: string;
  customerPriceId: string;
  partyId: string;
  itemId: string | null;
  previousUnitPrice: string | null;
  newUnitPrice: string;
  maxBonusPct: string;
  maxBonusKgPerInvoice: string;
  maxDiscountPct: string;
  lockPrice: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  changeReason: string;
  changedBy: string | null;
  changedAt: string;
};

type LegacyReconciliationPreview = {
  mode: 'dry_run' | 'execute';
  inspectedAt: string;
  batches: { total: number; linkedToCore: number; unlinkedLegacy: number };
  loadOrders: { total: number; linkedToTransfer: number; unlinkedLegacy: number };
  documents: { total: number; linkedToSalesInvoice: number; unlinkedLegacy: number; conflicts: string[] };
  reconciledCount: number;
};

/**
 * جملُ النوافذ الاحتياطية — تُعرض حين لا يقول الخادم كم في الجدول (فلا يُخترع رقم)،
 * والحدودُ من استعلامات `dashboard()` نفسها: ‏٥٠ دفعة، ٦٠ أمرًا، ١٢٠ مستندًا، ٨٠ حركة،
 * ٥٠ سجل تسعير.
 */
const PRODUCTION_WINDOW_FALLBACK = 'أحدث ٥٠ دفعة إنتاج (حدُّ نافذة الخادم)';
const LOAD_ORDERS_WINDOW_FALLBACK = 'أحدث ٦٠ أمر تحميل (حدُّ نافذة الخادم)';
const DOCUMENTS_WINDOW_FALLBACK = 'أحدث ١٢٠ مستند بيع (حدُّ نافذة الخادم)';
const MOVEMENTS_WINDOW_FALLBACK = 'أحدث ٨٠ حركة (حدُّ نافذة الخادم)';
const PRICE_HISTORY_WINDOW_FALLBACK = 'أحدث ٥٠ سجل تسعير (حدُّ نافذة الخادم)';

/** نسبةٌ لمعاينة الضريبة فقط — انظر `configuredVatFactor` تحت. */
const PREVIEW_VAT_RATE_PCT = 15;

type DashboardData = {
  /**
   * سياسةُ المنشأة **كما يرجعها الخادم فعلًا** (`dashboard()` — `policy`): ثلاثةُ
   * مفاتيح وهويّةُ البائع الضريبية. وكان النوعُ هنا يعلن ستّةً (`internalDeliveryEnabled`،
   * ‏`internalDeliveryTaxMode`، `productionCostBasis`، `bonusAccountingMode`،
   * ‏`defaultVatRatePct`) لا يرسل الخادمُ واحدةً منها، ولا استعمالَ لها في الصفحة — أي
   * توثيقٌ مكتوبٌ لحمولةٍ غير موجودة. وصُحِّح لأنّ الإنذارَ أدناه يقرأ `zatcaSeller` منها.
   */
  policy?: {
    allowInternalDeliveryWithoutTax: boolean;
    preventSelfApproval: boolean;
    shortageValuationBasis: string;
    /** هويّةُ البائع وجملةُ رفض الخادم حرفًا (`resolveZatcaSellerInTx`). */
    zatcaSeller?: {
      ready: boolean;
      missingFields: string[];
      refusalDetail: string | null;
    } | null;
  };
  /**
   * نوافذُ القراءة كما يعلنها الخادم: القوائمُ الخمس محدودةٌ بـ`LIMIT` وأمّا `summary`
   * فجمعُ الجدول كلّه — والجملةُ من `@erp/web-van/windows` (تنفيذٌ واحدٌ مع المخابز وشاشة
   * المندوب). وغيابُ المفتاح يعني «لا أعرف» فتُعرض الجملةُ الاحتياطية.
   */
  windows?: DashboardWindows | null;
  /** الأرصدة الرسمية من `stock_balances` — نفس ما تقرأه شاشة المخزون وبطاقة الصنف. */
  officialStock?: OfficialStockRow[];
  mainWarehouseId?: string | null;
  postingReadiness?: {
    branchId: string | null;
    salesInvoice: boolean;
    stockTransfer: boolean;
    receiptVoucher: boolean;
    message: string | null;
  };
  summary: {
    totalProducedKg: string;
    totalScrapKg?: string;
    mainWarehouseBalanceKg: string;
    vanWarehousesBalanceKg?: string;
    /** بضاعة خرجت ولم يؤكّد المندوب استلامها: ليست في السيارة ولا في المستودع. */
    inTransitKg?: string;
    inTransitValueSar?: string;
    inTransitTransfersCount?: number;
    derivedMainWarehouseBalanceKg?: string;
    stockLedgerAgrees?: boolean;
    pendingReceiptsCount?: number;
    totalProductionCostSar: string;
    totalLoadedKg: string;
    totalSoldKg: string;
    totalBonusKg: string;
    totalReturnedKg: string;
    totalDamagedKg: string;
    totalShortageKg: string;
    totalShortageSar: string;
    remainingInVansKg: string;
    /**
     * ‏**أرقامُ المال كلها صافيةٌ من المرتجعات** (منذ إصلاح مجاميع التوزيع): الإيرادُ
     * والوعاءان والذممُ وصافي الربح. وأطرافُ المعادلة اختياريةٌ هنا لأنّ حمولةً من خادمٍ
     * أقدم لا تحملها، وعندها تُعرض الأرقامُ الصافية بلا شرح — ولا يُخترع رقم.
     */
    totalZatcaSalesSar: string;
    totalInternalSalesSar: string;
    totalRevenueSar: string;
    totalSalesGrossSar?: string;
    totalReturnsSar?: string;
    totalReturnsVatSar?: string;
    returnDocumentCount?: number;
    /** مرتجعاتٌ إشعارُها الدائن غير مُرحَّل فتكلفتُها مجهولة ⇒ لم يُخصم لها أثرٌ في الربح. */
    returnsWithoutCostCount?: number;
    totalCollectedCashSar: string;
    totalCreditReceivablesSar: string;
    totalNetProfitSar: string;
    anomalyCount: number;
    pendingClosingsCount: number;
    /** عهد اعتُمدت كمياتها ولم تُسوَّ مخزنياً بعد — لا تُغلق قبل تسويتها. */
    pendingStockSettlementsCount?: number;
    /** فروق استلام بلا قرار (return / shortage). */
    pendingTransitDecisionsCount?: number;
  };
  productionBatches: ProductionBatch[];
  repPerformance: RepPerformance[];
  loadOrders: LoadOrder[];
  customerPrices: CustomerPrice[];
  customerPriceHistory?: CustomerPriceHistoryItem[];
  documents: VanDocument[];
  movements: StockMovement[];
};

/**
 * مصفوفة الصلاحيات — محتوى سياسي لا بيانات: الأدوار الأربعة في المصنع وما يملكه كل دور.
 * مكتوبة كصفوفة بيانات حتى تُعرض بالجدول المشترك نفسه الذي تعرض به بقية الشاشة جداولها.
 */
const ROLE_MATRIX: Array<{ role: ReactNode; production: ReactNode; pricing: ReactNode; closing: ReactNode }> =
  [
    {
      role: <strong>صاحب المصنع (Factory Owner)</strong>,
      production: 'اطلاع كامل على لوحة صاحب المصنع، تكلفة الإنتاج، وهوامش الربح لكل صنف ومندوب وعميل.',
      pricing: 'تحديد وتثبيت شرائح الأسعار (6 / 6.5 / 7 ريال) واعتماد الخصومات الاستثنائية وتجاوز البونص.',
      closing: 'اعتماد نهائي لإغلاق الورديات، مراجعة سجل التدقيق الكامل، واستلام التنبيهات الفورية.',
    },
    {
      role: <strong>المحاسب (Accountant)</strong>,
      production: 'مطابقة أرصدة المستودع الرئيسي وعهد المناديب والقيود المحاسبية وتكلفة البضاعة المباعة.',
      pricing: 'مراجعة الفواتير الضريبية (ZATCA) والعادية، ومراقبة السقوف الائتمانية والتحصيل.',
      closing: (
        <strong>
          مراجعة إغلاقات الورديات المعلقة، تأكيد الفحص الفعلي للتالف، تصفير العهد، وقيد العجز خصماً على راتب
          المندوب.
        </strong>
      ),
    },
    {
      role: <strong>أمين المستودع (Warehouse Keeper)</strong>,
      production: 'تسجيل دفعات الإنتاج اليومية، صرف أوامر التحميل للمناديب، واستلام المرتجع السليم.',
      pricing: 'لا يملك صلاحية تعديل أسعار العملاء أو منح خصومات مالية.',
      closing: 'المشاركة في الفحص الفعلي للكميات التالفة والجرد الدوري المفاجئ لسيارات المناديب.',
    },
    {
      role: <strong>المندوب (Sales Rep)</strong>,
      production: 'استلام العهدة المحددة بأمر التحميل فقط (يُمنع بيع أي كمية تتجاوز دفعة المخبز المستلمة).',
      pricing: 'البيع بالسعر المثبّت للعميل تلقائياً، وتسجيل سبب البونص ضمن السقف المسموح فقط.',
      closing: (
        <strong>
          تقديم طلب إغلاق الوردية اليومي في نهاية الدوام (تبقى الحالة معلقة حتى يعتمدها المحاسب).
        </strong>
      ),
    },
  ];

const MOVEMENT_TYPE_AR: Record<string, string> = {
  production_in: 'إنتاج يومي للمستودع الرئيسي',
  van_load: 'صرف وتحميل عهدة مندوب',
  van_sale: 'بيع فعلي لعميل',
  van_bonus: 'كمية مجانية / عينات',
  van_return: 'إرجاع سليم للمستودع',
  van_damage: 'تالف مفحوص ومعتمد',
  van_shortage: 'عجز عهدة مخصوم من راتب المندوب',
  stocktake_adjustment: 'تسوية جرد فعلي',
  collection_receipt: 'سند قبض وتحصيل مديونية',
};

const LOAD_STATUS_AR: Record<string, string> = {
  draft: 'مسودة',
  /** صُرفت البضاعة من المستودع الرئيسي وهي رسميًّا «تحت التحويل» — لم تدخل عهدة المندوب بعد. */
  pending_receipt: 'مصروف وبانتظار تأكيد استلام المندوب',
  loaded: 'محمّل في السيارة (بعد تأكيد الاستلام)',
  in_route: 'قيد التوزيع اليومي',
  pending_closing: 'معلق بانتظار فحص التالف واعتماد المحاسب',
  /** الكميات اعتُمدت، لكن رصيد السيارة الرسمي ما زال يختلف عن الجرد الفعلي. */
  pending_stock_settlement: 'بانتظار تسوية المخزون الرسمية (العهدة لم تُغلق)',
  settled: 'معتمد ومُصفّى ومُسوّى مخزنياً',
  reconciled: 'مُطابَق',
  rejected: 'مرفوض من المندوب (أُعيدت الكمية رسمياً)',
  canceled: 'ملغى (أُلغيت المناقلة الرسمية)',
};

/** حالة تسوية المخزون الرسمية كما يراها المحاسب. */
const SETTLEMENT_STATUS_AR: Record<string, string> = {
  not_required: 'لا يلزم تسوية',
  pending_transit_decision: 'فرق استلام بلا قرار',
  pending_count_decision: 'جرد بلا تسوية مُرحّلة',
  settled_officially: 'سُوّي رسمياً',
  blocked_missing_accounts: 'حسابات ملف الترحيل ناقصة',
};

const BONUS_REASONS = [
  'بونص ترويجي متفق عليه مع العميل',
  'عينات مجانية لتجربة صنف جديد',
  'تعويض تلف سابق معتمد',
  'عرض كميات خاص بالموسم / رمضان',
];

type TabKey = 'owner' | 'production' | 'reps' | 'loads' | 'invoice' | 'prices' | 'audit';

export default function VanSalesPage() {
  const [tab, setTab] = useState<TabKey>('owner');
  const [data, setData] = useState<DashboardData | null>(null);
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [cashLocations, setCashLocations] = useState<CashLocation[]>([]);
  /** مندوبو التوزيع ببطاقاتهم الرسمية وعهدهم الحيّة — من `/van-sales/salesmen`. */
  const [vanSalesmen, setVanSalesmen] = useState<VanSalesman[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'warn'; text: string }>();
  const [busy, setBusy] = useState(false);

  /**
   * مفاتيح عدم التكرار لمسارات الإنشاء الخمسة التي تقبلها الخدمة وتفردُها بفهرسٍ فريد
   * (‏`0122_van_sales_core_integration_and_idempotency.sql`): دفعة الإنتاج، أمر التحميل، المستند،
   * المرتجع، التحصيل. تُبنى الأجسام داخل المعالجات فالمفتاح يُشتقّ من الجسم المُرسل نفسه
   * (`key(body)`)، ويُدوَّر بعد نجاحٍ رُصد (`reset()`) حتى يبقى البيعان المتطابقان المقصودان
   * مستندين. وأمّا مسارات الانتقال (تأكيد الاستلام، الرفض، الإلغاء، الإغلاق، التسوية) فلا
   * معاملَ مفتاحٍ فيها ولا حاجة: كلّها تقفل صفّ الأمر `FOR UPDATE OF l` فالثانية تصطدم بالحالة.
   */
  const productionKey = useSubmissionKey('van-production-batch');
  const loadOrderKey = useSubmissionKey('van-load-order');
  const vanDocumentKey = useSubmissionKey('van-document');
  const returnKey = useSubmissionKey('van-return');
  const collectKey = useSubmissionKey('van-collection');

  // Pillar 1: Production batch form state
  const [prodItemName, setProdItemName] = useState('');
  const [prodItemId, setProdItemId] = useState('');
  /** المستودع الرئيسي الذي يدخله الإنتاج — يُقرأ من المستودعات الرسمية لا يُخترَع. */
  const [prodWarehouseId, setProdWarehouseId] = useState('');
  const [prodDate, setProdDate] = useState(today());
  const [prodQty, setProdQty] = useState('500');
  const [prodScrapQty, setProdScrapQty] = useState('0');
  /** سبب الفاقد — إلزامي مع أي كمية فاقد: الخادم يرفض فاقدًا بلا سبب. */
  const [prodScrapReason, setProdScrapReason] = useState('');
  /**
   * رقم الدفعة — يكتبه المشرف عندما يريد أن يتطابق رقم الدفعة مع رقم دفعة الناتج (اللوت) في
   * الرصيد الرسمي. **فارغ = رقم تسلسلي رسمي**، والتعبئة المسبقة من المتصفح كانت ستصطدم بقيد
   * التفرد على (المستأجر + رقم الدفعة) عند فتح الشاشتين معاً، لذلك تُترك للمشرف.
   */
  const [prodBatchNo, setProdBatchNo] = useState('');
  /**
   * مكوّنات الدفعة — مصدر المواد الإلزامي. كل دفعة إنتاج تُصرف موادها رسمياً من مستودع
   * المنشأة، وبلا مكوّنات (أو قائمة مواد) تُرفض الدفعة؛ أما الوارد من خارج المنشأة فموضعه إذن
   * إدخال مخزني رسمي أو تسوية جرد معتمدة.
   */
  const [prodComponents, setProdComponents] = useState<Array<{ itemId: string; qty: string }>>([
    /** سطرٌ فارغ جاهز للكتابة — والسطر الذي لم يُلمس لا يُرسل ولا يُحتسب. */
    { itemId: '', qty: '' },
  ]);
  const [prodSupervisor, setProdSupervisor] = useState('مشرف خط الإنتاج');
  const [reconciliationPreview, setReconciliationPreview] = useState<LegacyReconciliationPreview | null>(
    null,
  );

  // شاشة المندوبين: ربط الموظف وحساب الدخول ومستودع السيارة
  const [repTarget, setRepTarget] = useState<VanSalesman | null>(null);
  const [repEmail, setRepEmail] = useState('');
  const [repFullName, setRepFullName] = useState('');
  const [repScopeToVan, setRepScopeToVan] = useState(true);

  // Pillar 2: Load order form state (default 150 kg per client proposal example)
  const [loadSalesmanId, setLoadSalesmanId] = useState('');
  const [loadItemId, setLoadItemId] = useState('');
  const [loadWarehouseId, setLoadWarehouseId] = useState('');
  const [loadVanWarehouseId, setLoadVanWarehouseId] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('أ ب ج 4521');
  const [productionBatchNo, setProductionBatchNo] = useState('');
  const [loadedQty, setLoadedQty] = useState('150');
  const [maxBonusQty, setMaxBonusQty] = useState('20');
  const maxBonusPct = '20';

  // Pillar 2: Shift Closing & Accountant Approval Modal State
  const [closingTarget, setClosingTarget] = useState<LoadOrder | null>(null);
  const [closingReturnedQty, setClosingReturnedQty] = useState('0');
  const [closingDamagedQty, setClosingDamagedQty] = useState('0');
  const [closingDamageReason, setClosingDamageReason] = useState('');
  const [closingCollectedCash, setClosingCollectedCash] = useState('0');
  /** المتبقي الفعلي بالجرد — يُعبّأ بما أعلنته الوردية ولا يُفتَرَض صفرًا ولا رقمًا من الكود. */
  const [closingActualRemaining, setClosingActualRemaining] = useState('0');
  const [closingNotes, setClosingNotes] = useState('');
  const [closingDamageInspected, setClosingDamageInspected] = useState(false);
  const [closingSalaryDeduction, setClosingSalaryDeduction] = useState(false);
  /** مصير المتبقي الفعلي — قرار صريح، و'' تعني أن المحاسب لم يختر بعد. */
  const [closingRemainingAction, setClosingRemainingAction] = useState<'return_to_main' | 'carry_over' | ''>(
    '',
  );
  /** تفويض ترحيل مستند الجرد الرسمي — بدونه يبقى المستند مسودة وتبقى العهدة معلّقة. */
  const [closingSettleStock, setClosingSettleStock] = useState(false);
  /** إقرار صريح بأن الجرد الفعلي أكبر من العهدة (فائض). */
  const [closingSurplusAck, setClosingSurplusAck] = useState(false);

  // Pillar 4 & 5: Customer price tier & credit limit form state
  const [tierPartyId, setTierPartyId] = useState('');
  const [tierUnitPrice, setTierUnitPrice] = useState('6.50');
  const [tierLabel, setTierLabel] = useState('شريحة جملة محلات — 6.50 ريال/كجم');
  const [tierMaxBonusPct, setTierMaxBonusPct] = useState('20');
  const [tierMaxBonusKg, setTierMaxBonusKg] = useState('20');
  const [tierCreditLimit, setTierCreditLimit] = useState('5000');
  const [tierPaymentTerms, setTierPaymentTerms] = useState('15');
  const [tierLockPrice, setTierLockPrice] = useState(true);
  const [tierMaxDiscountPct, setTierMaxDiscountPct] = useState('0');
  const [tierPreferredMode, setTierPreferredMode] = useState<'zatca_tax' | 'internal_delivery'>('zatca_tax');
  const [tierChangeReason, setTierChangeReason] = useState('اعتماد وتحديث شريحة سعر العميل');

  // Pillar 3, 4, 8: Van invoice / delivery form state
  const [docLoadOrderId, setDocLoadOrderId] = useState('');
  const [docPartyId, setDocPartyId] = useState('');
  const [docWalkinName, setDocWalkinName] = useState('');
  const [docMode, setDocMode] = useState<'zatca_tax' | 'internal_delivery'>('zatca_tax');
  const [docPayment, setDocPayment] = useState<'cash' | 'card' | 'credit'>('cash');
  /** الصندوق الذي يستقر فيه نقد المندوب — يُمرَّر إلى تسوية الفاتورة الرسمية. */
  const [docCashLocationId, setDocCashLocationId] = useState('');
  const [docSoldQty, setDocSoldQty] = useState('100');
  const [docBonusQty, setDocBonusQty] = useState('20');
  const [docBonusReason, setDocBonusReason] = useState(BONUS_REASONS[0] ?? 'بونص ترويجي متفق عليه مع العميل');
  const [docUnitPrice, setDocUnitPrice] = useState('6.50');
  const [docDiscountAmount, setDocDiscountAmount] = useState('0');
  const [docDiscountReason, setDocDiscountReason] = useState('');
  const [docAllowOverride, setDocAllowOverride] = useState(false);
  const [docBonusConfirmed, setDocBonusConfirmed] = useState(true);
  const [docConfirmCode, setDocConfirmCode] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<VanDocument | null>(null);

  async function reload() {
    const dash = await apiData<DashboardData>('/van-sales/dashboard');
    const [smRes, custRes, itRes, whRes, cashRes, vanSmRes] = await Promise.allSettled([
      listSalesmen(),
      listParties('customer'),
      listItems(),
      listWarehouses(),
      listCashLocations(),
      apiData<VanSalesman[]>('/van-sales/salesmen'),
    ]);
    const sm = smRes.status === 'fulfilled' ? smRes.value : [];
    const cust = custRes.status === 'fulfilled' ? custRes.value : [];
    const it = itRes.status === 'fulfilled' ? itRes.value : [];
    const wh = whRes.status === 'fulfilled' ? whRes.value : [];
    const cash = cashRes.status === 'fulfilled' ? cashRes.value : [];
    const vanSm = vanSmRes.status === 'fulfilled' ? vanSmRes.value : [];
    setData(dash);
    setSalesmen(sm);
    setCustomers(cust);
    setItems(it);
    setWarehouses(wh);
    setCashLocations(cash);
    setVanSalesmen(vanSm);
    if (!loadSalesmanId && sm[0]?.id) setLoadSalesmanId(sm[0].id);
    /**
     * المستودع الرئيسي الافتراضي — pre-selected so production always lands somewhere real;
     * the server resolves the same default when the field is left empty.
     */
    if (!prodWarehouseId) {
      const mainWarehouse = defaultOf(wh) ?? wh[0];
      if (mainWarehouse?.id) setProdWarehouseId(mainWarehouse.id);
    }
    if (!prodItemId && it[0]?.id) setProdItemId(it[0].id);
    if (!loadWarehouseId) {
      const mainWarehouse = defaultOf(wh) ?? wh[0];
      if (mainWarehouse?.id) setLoadWarehouseId(mainWarehouse.id);
    }
    if (!productionBatchNo && dash.productionBatches?.[0]?.batchNo) {
      setProductionBatchNo(dash.productionBatches[0].batchNo);
    }
    const activeLoads = (dash.loadOrders ?? []).filter((l) => l.status !== 'settled');
    if (!docLoadOrderId && activeLoads[0]?.id) setDocLoadOrderId(activeLoads[0].id);
    if (!selectedDoc && dash.documents?.[0]) setSelectedDoc(dash.documents[0]);
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get('tab') as TabKey | null;
    if (
      initialTab &&
      ['owner', 'production', 'reps', 'loads', 'invoice', 'prices', 'audit'].includes(initialTab)
    ) {
      setTab(initialTab);
    }
    void reload().catch((error: unknown) =>
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر تحميل بيانات المصنع والتوزيع') }),
    );
  }, []);

  function onSelectCustomer(partyId: string) {
    setDocPartyId(partyId);
    const rule = data?.customerPrices.find((cp) => cp.partyId === partyId);
    if (rule) {
      setDocUnitPrice(rule.unitPrice);
      setDocMode(rule.preferredInvoiceMode);
    }
  }

  async function submitProductionBatch(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      /**
       * الحمولة تُبنى في `lib/van-production.ts` — عقد الشبكة (الحقل `qty`، وأسباب
       * الرفض التي سيقولها الخادم) مُختبَر هناك كدوالّ نقية بدل أن يُترك في JSX. والفحص
       * هنا راحةٌ للمشرف لا رقابة: الحكم الفعلي في الخادم.
       */
      const verdict = buildProductionBatchPayload({
        itemId: prodItemId,
        warehouseId: prodWarehouseId,
        productionDate: prodDate,
        itemName: prodItemName,
        producedQty: prodQty,
        scrapQty: prodScrapQty,
        scrapReason: prodScrapReason,
        batchNo: prodBatchNo,
        supervisorName: prodSupervisor,
        components: prodComponents,
      });
      if (!verdict.ok) {
        setNotice({ kind: 'danger', text: verdict.message });
        setBusy(false);
        return;
      }
      const batchBody = verdict.payload satisfies ProductionBatchPayload;
      const next = await apiPost<DashboardData>('/van-sales/production-batches', {
        ...batchBody,
        idempotencyKey: productionKey.key(batchBody),
      });
      setData(next);
      productionKey.reset();
      const newestBatch = next.productionBatches[0];
      if (newestBatch) setProductionBatchNo(newestBatch.batchNo);
      const warehouseName =
        warehouses.find((row) => row.id === newestBatch?.warehouseId)?.name ?? 'المستودع الرئيسي';
      setNotice({
        kind: 'ok',
        text: `تم تسجيل دفعة الإنتاج (${newestBatch?.batchNo ?? ''}) بكمية ${prodQty} كجم، ودخلت الرصيد الرسمي في ${warehouseName} — الرصيد الرسمي الآن ${next.summary.mainWarehouseBalanceKg} كجم. التكلفة الفعلية ${newestBatch?.unitCost ?? '0'} ريال/كجم ${
          newestBatch?.costBasis === 'manufacturing_order'
            ? 'محسوبة مما صُرف من المكوّنات عبر أمر الإنتاج الرسمي'
            : 'غير محسوبة من أمر رسمي — راجع أساس التكلفة في الجدول'
        }${newestBatch?.lotId ? '، ورقم دفعة الناتج (اللوت) مطابق لرقم الدفعة' : ''}.`,
      });
      setProdComponents([{ itemId: '', qty: '' }]);
      setProdBatchNo('');
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر تسجيل دفعة الإنتاج') });
    } finally {
      setBusy(false);
    }
  }

  /** تأكيد استلام التوريد — what turns "sent" into custody on the official balance. */
  async function confirmLoadReceipt(loadOrderId: string, receivedQty: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>(`/van-sales/load-orders/${loadOrderId}/confirm-receipt`, {
        receivedQty,
      });
      setData(next);
      setNotice({
        kind: 'ok',
        text: `تم تأكيد استلام ${receivedQty} كجم ودخولها الرصيد الرسمي لمستودع سيارة المندوب.`,
      });
    } catch (error) {
      setNotice({
        kind: 'danger',
        text: apiErrorText(error, 'تعذر تأكيد استلام التوريد'),
      });
    } finally {
      setBusy(false);
    }
  }

  /** ربط المندوب بحساب دخول رسمي (مستخدم + عضوية + دور + نطاق مستودع السيارة). */
  async function linkRepAccount(event: React.FormEvent) {
    event.preventDefault();
    if (!repTarget) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await apiPost<{
        membershipId: string;
        email: string;
        status: string;
        roleName: string;
        activationRequired: boolean;
        scopedToVanWarehouse: boolean;
      }>(`/van-sales/salesmen/${repTarget.id}/account`, {
        email: repEmail,
        fullName: repFullName || undefined,
        restrictToVanWarehouse: repScopeToVan,
      });
      setNotice({
        kind: 'ok',
        text: `تم ربط المندوب (${repTarget.name}) بحساب الدخول ${result.email} على دور «${result.roleName}»${
          result.scopedToVanWarehouse ? ' مع قصر صلاحيته على مستودع سيارته' : ''
        }${result.activationRequired ? ' — الحساب بانتظار تفعيل كلمة المرور من رابط الدعوة الرسمي' : ''}.`,
      });
      setRepTarget(null);
      await reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر ربط حساب المندوب') });
    } finally {
      setBusy(false);
    }
  }

  /**
   * طباعة نسختين — customer copy + rep copy (with a signature box) of the *same*
   * official document. Rendered from `/van-sales/documents/:id/print-view`, so the numbers
   * on paper are the numbers in the ledger. والمُصيِّر في `@erp/web-van/document-print`:
   * الورقة نفسها التي تطبعها واجهة المخابز، حرفًا بحرف.
   */
  async function printDocumentCopies(documentId: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      const view = await apiData<VanDocumentPrintView>(
        `/van-sales/documents/${documentId}/print-view?copies=2`,
      );
      if (!openVanDocumentPrintWindow(view)) {
        setNotice({
          kind: 'danger',
          text: 'لم يفتح المتصفّح نافذة الطباعة — اسمح بالنوافذ المنبثقة لهذه اللوحة ثمّ أعد المحاولة.',
        });
      }
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر تجهيز نسخة الطباعة') });
    } finally {
      setBusy(false);
    }
  }

  /**
   * الإيصال الحراري — built from the same official print view, so the company name and
   * tax number come from the company profile instead of a string in the code.
   */
  async function printThermalFromView(documentId: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      const view = await apiData<VanDocumentPrintView>(
        `/van-sales/documents/${documentId}/print-view?copies=1`,
      );
      printThermalReceipt80mm({
        companyName: view.companyName,
        taxNo: view.companyTaxNo,
        branchName: `دفعة إنتاج: ${view.productionBatchNo}`,
        invoiceNumber: view.invoiceNumber ?? view.documentNumber,
        invoiceTypeLabel:
          view.invoiceMode === 'zatca_tax' ? 'فاتورة ضريبية مبسطة (ZATCA)' : 'إيصال تسليم بضاعة (توزيع)',
        issuedAt: view.saleDate,
        customerName: view.customerName,
        cashierName: view.salesmanName,
        paymentMethodLabel:
          view.paymentMethod === 'cash'
            ? 'نقدي (Cash)'
            : view.paymentMethod === 'card'
              ? 'شبكة مدى'
              : 'آجل (Credit)',
        lines: view.lines.map((line) => ({
          name: line.itemName,
          quantity: line.quantity,
          unitPrice: line.unitPrice,
          total: line.lineTotal,
        })),
        subtotal: view.subtotal,
        discount: view.discountTotal,
        taxTotal: view.vatTotal,
        total: view.grandTotal,
        paidAmount: view.paidAmount,
        qrPayload: view.qrPayload,
      });
    } catch (error) {
      setNotice({
        kind: 'danger',
        text: apiErrorText(error, 'تعذر تجهيز الإيصال الحراري'),
      });
    } finally {
      setBusy(false);
    }
  }

  /** ↩ مرتجع العميل — official `sale_return` against the original document. */
  async function submitReturn(documentId: string, returnedQty: string, reason: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      const returnBody = { returnedQty, reason };
      const next = await apiPost<DashboardData>(`/van-sales/documents/${documentId}/returns`, {
        ...returnBody,
        idempotencyKey: returnKey.key({ documentId, ...returnBody }),
      });
      setData(next);
      returnKey.reset();
      setNotice({
        kind: 'ok',
        text: `تم تسجيل مرتجع العميل (${returnedQty} كجم) وإصدار فاتورة مرتجع رسمية وإرجاع الكمية إلى عهدة المندوب.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر تسجيل المرتجع') });
    } finally {
      setBusy(false);
    }
  }

  async function submitLoadOrder(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const loadBody = {
        salesmanId: loadSalesmanId,
        itemId: loadItemId || undefined,
        warehouseId: loadWarehouseId || undefined,
        vanWarehouseId: loadVanWarehouseId || undefined,
        vehiclePlate,
        productionBatchNo: productionBatchNo || undefined,
        loadedQty,
        maxBonusQty,
        maxBonusPct,
      };
      const next = await apiPost<DashboardData>('/van-sales/load-orders', {
        ...loadBody,
        idempotencyKey: loadOrderKey.key(loadBody),
      });
      setData(next);
      loadOrderKey.reset();
      const newestLoad = next.loadOrders[0];
      if (newestLoad) setDocLoadOrderId(newestLoad.id);
      setNotice({
        kind: 'ok',
        text: `تم إنشاء مناولة مخزنية رسمية وصرف ${loadedQty} كجم من المستودع الرئيسي لأمر التحميل ${newestLoad?.number ?? ''} — الحالة الآن «بانتظار تأكيد استلام المندوب»، ولن تدخل عهدة المندوب قبل تأكيده.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر إنشاء أمر التحميل') });
    } finally {
      setBusy(false);
    }
  }

  async function submitCustomerTier(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>('/van-sales/customer-prices', {
        partyId: tierPartyId,
        priceTierLabel: tierLabel,
        unitPrice: tierUnitPrice,
        maxBonusPct: tierMaxBonusPct,
        maxBonusKgPerInvoice: tierMaxBonusKg,
        creditLimit: tierCreditLimit,
        paymentTermsDays: Number(tierPaymentTerms || 15),
        lockPrice: tierLockPrice,
        maxDiscountPct: tierMaxDiscountPct,
        preferredInvoiceMode: tierPreferredMode,
        changeReason: tierChangeReason,
      });
      setData(next);
      setNotice({
        kind: 'ok',
        text: 'تم حفظ سعر العميل المخصص، تثبيت السعر، سقف الائتمان، وسياسة الكميات المجانية مع توثيق التعديل في سجل الأسعار.',
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر حفظ شريحة السعر') });
    } finally {
      setBusy(false);
    }
  }

  async function handleRunLegacyPreview() {
    setBusy(true);
    setNotice(undefined);
    try {
      const preview = await apiPost<LegacyReconciliationPreview>('/van-sales/legacy-reconciliation', {
        mode: 'dry_run',
      });
      setReconciliationPreview(preview);
      setNotice({
        kind: 'ok',
        text: 'تم تنفيذ فحص توافق البيانات السابقة (Dry-Run) بنجاح دون أي تعديل على البيانات.',
      });
    } catch (error) {
      setNotice({
        kind: 'danger',
        text: apiErrorText(error, 'تعذر تنفيذ فحص توافق البيانات السابقة'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function submitVanDocument(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const documentBody = {
        loadOrderId: docLoadOrderId,
        partyId: docPartyId || undefined,
        customerName: docPartyId ? undefined : docWalkinName.trim() || 'محل تجزئة نقدي',
        invoiceMode: docMode,
        paymentMethod: docPayment,
        cashLocationId: docCashLocationId || undefined,
        soldQty: docSoldQty,
        bonusQty: docBonusQty || '0',
        bonusReason: Number(docBonusQty || 0) > 0 ? docBonusReason : undefined,
        unitPrice: docUnitPrice,
        discountAmount: docDiscountAmount || '0',
        discountReason: docDiscountReason.trim() || undefined,
        allowPriceDiscountOverride: docAllowOverride,
        customerBonusConfirmed: docBonusConfirmed,
        customerConfirmationCode: docConfirmCode.trim() || undefined,
      };
      const next = await apiPost<DashboardData>('/van-sales/documents', {
        ...documentBody,
        idempotencyKey: vanDocumentKey.key(documentBody),
      });
      setData(next);
      vanDocumentKey.reset();
      const newestDoc = next.documents[0] ?? null;
      setSelectedDoc(newestDoc);
      setNotice({
        kind: 'ok',
        text: `تم إصدار ${newestDoc?.invoiceMode === 'zatca_tax' ? 'فاتورة ضريبية إلكترونية (ZATCA)' : 'فاتورة توزيع عادية محفوظة محاسبياً'} رقم ${newestDoc?.number ?? ''} وخصم الكمية من عهدة المندوب.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر إصدار المستند') });
    } finally {
      setBusy(false);
    }
  }

  function openClosingModal(load: LoadOrder) {
    setClosingTarget(load);
    setClosingReturnedQty(load.returnedQty && Number(load.returnedQty) > 0 ? load.returnedQty : '0');
    setClosingDamagedQty(load.damagedQty && Number(load.damagedQty) > 0 ? load.damagedQty : '0');
    setClosingDamageReason(load.damageReason || '');
    setClosingCollectedCash(Number(load.collectedCash) > 0 ? load.collectedCash : load.expectedCash);
    // ما سجّله المندوب فعلياً إن وُجد، وإلا المتبقي المتوقع حتى يعدّله المحاسب بعد الجرد.
    setClosingActualRemaining(
      Number(load.actualRemainingQty ?? 0) > 0
        ? String(load.actualRemainingQty)
        : String(load.expectedRemainingQty ?? load.remainingQty ?? '0'),
    );
    setClosingNotes(load.closingNotes || '');
    // لا يُفتَرَض الفحص ولا الخصم: إقراران صريحان من المحاسب في كل مرة.
    setClosingDamageInspected(load.damageInspected === true);
    setClosingSalaryDeduction(load.salaryDeductionApproved === true);
    // قرار مصير المتبقي لا يُفتَرَض: يُقرأ إن سبق تسجيله، وإلا يبقى بلا اختيار.
    setClosingRemainingAction(
      load.remainingAction === 'return_to_main' || load.remainingAction === 'carry_over'
        ? load.remainingAction
        : '',
    );
    setClosingSettleStock(false);
    setClosingSurplusAck(false);
  }

  async function handleSubmitPendingClosing() {
    if (!closingTarget) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>(`/van-sales/load-orders/${closingTarget.id}/submit-closing`, {
        returnedQty: closingReturnedQty,
        damagedQty: closingDamagedQty,
        damageReason: closingDamageReason,
        collectedCash: closingCollectedCash,
        actualRemainingQty: closingActualRemaining,
        closingNotes,
      });
      setData(next);
      const updated = next.loadOrders.find((l) => l.id === closingTarget.id) ?? null;
      setClosingTarget(updated);
      setNotice({
        kind: 'warn',
        text: `تم تقديم طلب إغلاق الوردية (${closingTarget.number}) وحساب العجز تلقائياً، وباتت الحالة «معلق بانتظار فحص التالف واعتماد المحاسب».`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر تقديم إغلاق الوردية') });
    } finally {
      setBusy(false);
    }
  }

  /**
   * استكمال تسوية المخزون — the recovery path for a custody whose quantities were approved
   * but whose official count settlement did not complete. Same official mechanism, safe to repeat.
   */
  async function handleSettleLoadOrderStock(load: LoadOrder, settleStockAdjustment: boolean) {
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>(`/van-sales/load-orders/${load.id}/settle-stock`, {
        settleStockAdjustment,
        ...(load.remainingAction ? { remainingAction: load.remainingAction } : {}),
      });
      setData(next);
      const updated = next.loadOrders.find((l) => l.id === load.id) ?? null;
      setNotice({
        kind: updated?.status === 'settled' ? 'ok' : 'warn',
        text:
          updated?.status === 'settled'
            ? `سُوّي رصيد السيارة الرسمي مع الجرد الفعلي (${load.number}) وأُغلقت العهدة. مسؤولية أي عجز ما زالت معلّقة بانتظار السياسة.`
            : `${updated?.stockSettlementNote ?? 'لم تكتمل تسوية المخزون بعد'} (${load.number}).`,
      });
    } catch (error) {
      setNotice({
        kind: 'danger',
        text: apiErrorText(error, 'تعذّر استكمال تسوية المخزون'),
      });
    } finally {
      setBusy(false);
    }
  }

  /** قرار فرق الاستلام — financial decision taken explicitly, never assumed by the system. */
  async function handleCloseTransitDifference(load: LoadOrder, mode: 'return' | 'shortage') {
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>(
        `/van-sales/load-orders/${load.id}/close-transit-difference`,
        { mode, reason: mode === 'return' ? 'إرجاع الفرق إلى المستودع المصدر' : 'اعتبار الفرق عجز تحويل' },
      );
      setData(next);
      setNotice({
        kind: 'ok',
        text:
          mode === 'return'
            ? `أُعيد فرق الاستلام (${load.discrepancyQty ?? '0'} كجم) رسمياً إلى المستودع المصدر بقيد من ملف الترحيل (${load.number}).`
            : `اعتُبر فرق الاستلام (${load.discrepancyQty ?? '0'} كجم) عجز تحويل ورُحّل رسمياً (Dr تسوية المخزون / Cr بضاعة تحت التحويل) (${load.number}).`,
      });
    } catch (error) {
      setNotice({
        kind: 'danger',
        text: apiErrorText(error, 'تعذّر إقفال فرق الاستلام'),
      });
    } finally {
      setBusy(false);
    }
  }

  /** إلغاء توريد لم يُستلَم — عبر الإلغاء الرسمي للمناقلة (يعيد الكميات ويعكس القيد). */
  async function handleCancelLoadOrder(load: LoadOrder) {
    const reason = window.prompt(
      `سبب إلغاء أمر التحميل (${load.number}) — ستُعاد الكميات رسمياً إلى المستودع المصدر ويُلغى قيد الإرسال:`,
      '',
    );
    if (reason === null) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>(`/van-sales/load-orders/${load.id}/cancel`, {
        reason: reason.trim() || undefined,
      });
      setData(next);
      setNotice({
        kind: 'ok',
        text: `أُلغي أمر التحميل (${load.number}) وأُلغيت المناقلة الرسمية وأعادت الكميات وقيد الإرسال.`,
      });
    } catch (error) {
      setNotice({
        kind: 'danger',
        text: apiErrorText(error, 'تعذّر إلغاء أمر التحميل'),
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleAccountantApproveClosing() {
    if (!closingTarget) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>(
        `/van-sales/load-orders/${closingTarget.id}/approve-closing`,
        {
          returnedQty: closingReturnedQty,
          damagedQty: closingDamagedQty,
          collectedCash: closingCollectedCash,
          damageInspected: closingDamageInspected,
          salaryDeductionApproved: closingSalaryDeduction,
          notes: closingNotes,
          // الجرد الفعلي كما يقرّره المحاسب، ومصير المتبقي، وتفويض ترحيل مستند الجرد.
          actualRemainingQty: closingActualRemaining,
          ...(closingRemainingAction ? { remainingAction: closingRemainingAction } : {}),
          settleStockAdjustment: closingSettleStock,
          ...(modalSurplusKg > 0 ? { surplusAcknowledged: closingSurplusAck } : {}),
        },
      );
      setData(next);
      const updated = next.loadOrders.find((l) => l.id === closingTarget.id) ?? null;
      setClosingTarget(null);
      const stillOpen = updated?.status === 'pending_stock_settlement';
      setNotice({
        kind: stillOpen ? 'warn' : 'ok',
        text: stillOpen
          ? // ‏بلا `**…**`: فنصُّ التنبيه يُطبع كما هو، وعلاماتُ التنصيص لا تُصرَف في JSX —
            // ‏وكانت النجمتان تظهران للمستخدم حرفيًّا.
            `اعتُمدت كميات الوردية (${closingTarget.number}) لكن العهدة لم تُغلق: ${
              updated?.stockSettlementNote ?? 'رصيد السيارة الرسمي ما زال يختلف عن الجرد الفعلي'
            } — استخدم «استكمال تسوية المخزون» بعد تفويض ترحيل مستند الجرد الرسمي.`
          : `اعتُمدت الوردية (${closingTarget.number}) وسُوّي رصيد السيارة الرسمي مع الجرد الفعلي${
              closingRemainingAction === 'return_to_main'
                ? ' وأُعيد المتبقي رسمياً إلى المستودع الرئيسي'
                : closingRemainingAction === 'carry_over'
                  ? ' وبقي المتبقي عهدة الوردية التالية'
                  : ''
            }.${
              modalShortageKg > 0
                ? ` العجز (${modalShortageKg.toFixed(2)} كجم ≈ ${modalShortageSar.toFixed(2)} ريال) مسجّل وقيمته مثبتة في مستند الجرد الرسمي، ومسؤوليته المالية ما زالت معلّقة — لا قيد على راتب المندوب أو ذمته قبل اعتماد السياسة.`
                : ''
            }`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر اعتماد إغلاق الوردية') });
    } finally {
      setBusy(false);
    }
  }

  async function handleCollectDebt(doc: VanDocument) {
    const unpaid = Math.max(0, Number(doc.total) - Number(doc.paidAmount)).toFixed(2);
    const input = window.prompt(
      `أدخل المبلغ المحصّل من العميل (${doc.customerName}) للفاتورة ${doc.number}:`,
      unpaid,
    );
    if (!input) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const collectBody = {
        documentId: doc.id,
        collectedAmount: input,
        notes: 'تحصيل مديونية عميل توزيع',
      };
      const next = await apiPost<DashboardData>('/van-sales/collections', {
        ...collectBody,
        idempotencyKey: collectKey.key(collectBody),
      });
      setData(next);
      collectKey.reset();
      setNotice({ kind: 'ok', text: `تم تسجيل سند قبض بمبلغ ${input} ريال للفاتورة ${doc.number}.` });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر تسجيل التحصيل') });
    } finally {
      setBusy(false);
    }
  }

  const activeLoadOrder = data?.loadOrders.find((l) => l.id === docLoadOrderId);
  const selectedCustomerRule = data?.customerPrices.find((cp) => cp.partyId === docPartyId);
  /**
   * معاينةُ الضريبة **تقديرٌ** بنسبة ١٥٪: فحمولةُ اللوحة لا تحمل نسبةً ضريبية — والنوعُ
   * كان يعلن `policy.defaultVatRatePct` الذي لا يرسله الخادمُ أصلًا، فكان هذا الرقمُ يسقط
   * إلى ١٥ في كلّ مرّة (وهو ما كان يخفيه `?? 15`). والخادمُ يحسم النسبةَ الفعلية عند
   * الإصدار من المجموعة الضريبية للصنف، وإلا المجموعةِ الافتراضية الأعلى في المنشأة، وإلا
   * ١٥٪ (‏`createDocument`). فالتقديرُ يبقى — لأنّ بديلَه صفرٌ أو رقمٌ من حمولةٍ لا تحمله —
   * لكنّه يُعرض **وهو معلنٌ أنّه تقدير** في السطر تحته.
   */
  const configuredVatFactor = PREVIEW_VAT_RATE_PCT / 100;
  const previewGross = Number(docSoldQty || 0) * Number(docUnitPrice || 0);
  const previewDiscount = Number(docDiscountAmount || 0);
  const previewSubtotal = Math.max(0, previewGross - previewDiscount);
  const previewVat = docMode === 'zatca_tax' ? previewSubtotal * configuredVatFactor : 0;
  const previewTotal = previewSubtotal + previewVat;

  /**
   * حساب مباشر داخل نافذة الإغلاق على **أساس العهدة الحقيقي**: ما أكّد المندوب استلامه
   * (`receivedQty`) لا ما خرج من المستودع الرئيسي، مطروحاً منه المباع والبونص والمرتجع
   * والتالف = المتبقي المتوقع، والفرق بينه وبين الجرد الفعلي هو العجز.
   */
  const modalReceived = Number(closingTarget?.receivedQty ?? 0);
  const modalLoaded = modalReceived > 0 ? modalReceived : Number(closingTarget?.loadedQty ?? 0);
  const modalSold = Number(closingTarget?.soldQty ?? 0);
  const modalBonus = Number(closingTarget?.bonusQty ?? 0);
  const modalReturned = Number(closingReturnedQty || 0);
  const modalDamaged = Number(closingDamagedQty || 0);
  const modalActualRemaining = Number(closingActualRemaining || 0);
  const modalExpectedRemaining = modalLoaded - (modalSold + modalBonus + modalReturned + modalDamaged);
  const modalShortageKg = Math.max(0, modalExpectedRemaining - modalActualRemaining);
  const modalSurplusKg = Math.max(0, modalActualRemaining - modalExpectedRemaining);
  const targetShortageUnitRate =
    closingTarget && Number(closingTarget.shortageQty) > 0
      ? Number(closingTarget.shortageValue) / Number(closingTarget.shortageQty)
      : Number(data?.customerPrices?.[0]?.unitPrice ?? docUnitPrice ?? 0);
  const modalShortageSar = modalShortageKg * targetShortageUnitRate;

  return (
    <Screen
      title="نظام المصنع والمخابز ومناديب التوزيع المتكامل"
      subtitle="الحل الشامل لإدارة الإنتاج اليومي، المستودع الرئيسي، عهد المناديب، إغلاق الوردية المعلق لاعتماد المحاسب وفحص التالف وخصم العجز من الراتب، ضبط الأسعار والبونص، والفوترة الإلكترونية ZATCA."
      crumbs={['توزيع المناديب والمخابز']}
      chips={
        <Tabs
          value={tab}
          onChange={(key) => setTab(key as TabKey)}
          label="أقسام نظام التوزيع"
          items={[
            { key: 'owner', label: 'الملخص التنفيذي' },
            {
              key: 'production',
              label: 'الإنتاج والمستودع',
              badge: data?.productionBatches.length ?? 0,
            },
            { key: 'reps', label: 'مندوبو التوزيع', badge: vanSalesmen.length },
            { key: 'loads', label: 'العهد والورديات', badge: data?.loadOrders.length ?? 0 },
            { key: 'invoice', label: 'فواتير التوزيع', badge: data?.documents.length ?? 0 },
            { key: 'prices', label: 'الأسعار والائتمان', badge: data?.customerPrices.length ?? 0 },
            { key: 'audit', label: 'البونص والصلاحيات' },
          ]}
        />
      }
    >
      {notice ? <Notice notice={notice} /> : null}

      {/* أقسام الشاشة: شريطُ تبويبٍ واحد بدل سبعة أزرارٍ متساوية. */}
      {/* Pending Shift Closings Alert Banner */}
      {(data?.summary.pendingClosingsCount ?? 0) > 0 && (
        <div className="ui-callout warn">
          <div className="ui-callout-head">
            <p className="ui-callout-title">
              يوجد ({data?.summary.pendingClosingsCount}) طلب إغلاق وردية مندوب معلق بانتظار فحص التالف
              واعتماد المحاسب
            </p>
            <button type="button" className="btn sm" onClick={() => setTab('loads')}>
              مراجعة واعتماد الإغلاقات
            </button>
          </div>
          <p className="ui-callout-text">
            لا تُصفَّر عهدة المندوب ولا يُقيَّد التالف والعجز على راتبه إلا بعد مراجعة المحاسب والاعتماد
            النهائي.
          </p>
        </div>
      )}

      {/* عهد لم تُغلق: الرصيد الرسمي ما زال يختلف عن الجرد الفعلي */}
      {((data?.summary.pendingStockSettlementsCount ?? 0) > 0 ||
        (data?.summary.pendingTransitDecisionsCount ?? 0) > 0) && (
        <div className="ui-callout danger">
          <div className="ui-callout-head">
            <p className="ui-callout-title">
              يوجد ({data?.summary.pendingStockSettlementsCount ?? 0}) وردية اعتُمدت كمياتها ولم تُسوَّ
              مخزنياً
              {(data?.summary.pendingTransitDecisionsCount ?? 0) > 0
                ? ` و(${data?.summary.pendingTransitDecisionsCount}) فرق استلام بلا قرار`
                : ''}
            </p>
            <button type="button" className="btn sm" onClick={() => setTab('loads')}>
              عرض الورديات المعلّقة
            </button>
          </div>
          <p className="ui-callout-text">
            العهدة <b>لم تُغلق</b>: رصيد السيارة الرسمي في دفتر المخزون ما زال يختلف عن الجرد الفعلي. لا تُغلق
            أي عهدة مع بقاء فرق بلا تسوية — استخدم «استكمال تسوية المخزون» بعد تفويض ترحيل مستند الجرد الرسمي.
            المسؤولية المالية عن أي عجز تبقى معلّقة حتى تعتمد السياسة.
          </p>
        </div>
      )}

      {/* Pending supply receipts — goods officially in transit, not yet in the rep's custody */}
      {(data?.summary.pendingReceiptsCount ?? 0) > 0 && (
        <div className="ui-callout info">
          <div className="ui-callout-head">
            <p className="ui-callout-title">
              يوجد ({data?.summary.pendingReceiptsCount}) توريد بانتظار تأكيد استلام المندوب
            </p>
            <button type="button" className="btn sm" onClick={() => setTab('loads')}>
              عرض التوريدات المنتظرة
            </button>
          </div>
          <p className="ui-callout-text">
            البضاعة خرجت من المستودع الرئيسي وهي رسميًّا «تحت التحويل» — لا تدخل عهدة المندوب ولا يظهر لها
            رصيد في سيارته إلا بعد أن يؤكّد الاستلام من تطبيق المندوب (أو يؤكده المحاسب نيابةً عنه).
          </p>
        </div>
      )}

      {/* جاهزية الترحيل المحاسبي — named per operation so the message is actionable */}
      {data?.postingReadiness && !data.postingReadiness.salesInvoice && (
        <div className="ui-callout warn">
          <p className="ui-callout-title">ملف الترحيل المحاسبي غير مكتمل</p>
          <p className="ui-callout-text">{data.postingReadiness.message}</p>
          <p className="ui-callout-text">
            الحالة الآن: فاتورة المبيعات الرسمية {data.postingReadiness.salesInvoice ? 'جاهزة' : 'غير جاهزة'}{' '}
            · المناولات المخزنية {data.postingReadiness.stockTransfer ? 'جاهزة' : 'غير جاهزة'} · سندات القبض{' '}
            {data.postingReadiness.receiptVoucher ? 'جاهزة' : 'غير جاهزة'} — تسجيل الإنتاج وحركة الأرصدة
            يعملان بدونها.
          </p>
        </div>
      )}

      {/* الأرصدة الرسمية — the same rows the inventory screens read */}
      <Panel title="الأرصدة الرسمية في المستودعات (من دفتر المخزون الموحّد)" flush>
        <div className="muted small" style={{ marginBottom: 8 }}>
          هذه هي الأرصدة نفسها التي تراها في شاشة أرصدة المخزون وبطاقة الصنف والتقارير الرسمية — تُقرأ من
          <code> stock_balances</code> ولا تُحتسب من جداول الإضافة.
          {data?.summary.stockLedgerAgrees === false ? (
            <b style={{ color: 'var(--danger)' }}>
              {' '}
              يوجد اختلاف بين الرصيد الرسمي والرصيد المشتق من سجلات التوزيع — راجع الحركات.
            </b>
          ) : null}
        </div>
        <Table
          bare
          empty={<>لا توجد أرصدة رسمية بعد — سجّل دفعة إنتاج وستظهر هنا وفي شاشة المخزون معًا.</>}
          columns={[
            {
              key: 'c0',
              header: 'المستودع',
              cell: (row) => (
                <>
                  {row.warehouseName}
                  {row.warehouseId === data?.mainWarehouseId ? ' (رئيسي)' : ''}
                </>
              ),
            },
            {
              key: 'c1',
              header: 'الصنف',
              cell: (row) => row.itemName,
            },
            {
              key: 'c2',
              header: 'البطاقة',
              ltr: true,
              cell: (row) => row.sku,
            },
            {
              key: 'c3',
              header: 'الرصيد الرسمي',
              numeric: true,
              ltr: true,
              cell: (row) => row.quantity,
            },
            {
              key: 'c4',
              header: 'متوسط التكلفة',
              numeric: true,
              ltr: true,
              cell: (row) => row.averageCost,
            },
            {
              key: 'c5',
              header: 'قيمة الرصيد',
              numeric: true,
              ltr: true,
              cell: (row) => row.value,
            },
          ]}
          rows={data?.officialStock ?? []}
          rowKey={(row) => `${row.warehouseId}-${row.itemId}`}
        />
      </Panel>

      {/* بضاعة تحت التحويل — الكمية التي لا هي في المستودع ولا في السيارة */}
      {Number(data?.summary.inTransitKg ?? 0) > 0 && (
        <div className="ui-callout info">
          <p className="ui-callout-title">
            بضاعة تحت التحويل: {data?.summary.inTransitKg} كجم بقيمة {data?.summary.inTransitValueSar} ريال (
            {data?.summary.inTransitTransfersCount ?? 0} مناولة)
          </p>
          <p className="ui-callout-text">
            خرجت من المستودع الرسمي ولم يؤكّد المندوب استلامها بعد: ليست في رصيد السيارة ولا في رصيد المستودع،
            وقيمتها واقفة في حساب «بضاعة تحت التحويل» بقيد (Dr بضاعة تحت التحويل / Cr المخزون). أي فرق عند
            الاستلام يبقى معلّقاً حتى يُتخذ فيه قرار صريح (إرجاع إلى المصدر أو اعتباره عجز تحويل) — لا يُرحَّل
            تلقائياً.
          </p>
        </div>
      )}

      {/* TAB 1: FACTORY OWNER DASHBOARD (Pillar 9) */}
      {tab === 'owner' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="ui-kpi-grid">
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">إجمالي الإنتاج اليومي</span>
              <span className="ui-kpi-value" dir="ltr">
                {data?.summary.totalProducedKg ?? '0.00'} kg
              </span>
              <span className="ui-kpi-hint">
                رصيد المستودع: {data?.summary.mainWarehouseBalanceKg ?? '0.00'} kg
              </span>
            </div>
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">إجمالي المسلم لعهد المناديب</span>
              <span className="ui-kpi-value" dir="ltr">
                {data?.summary.totalLoadedKg ?? '0.00'} kg
              </span>
              <span className="ui-kpi-hint">
                متبقي بالعهد: {data?.summary.remainingInVansKg ?? '0.00'} kg
              </span>
            </div>
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">المباع الفعلي + البونص</span>
              <span className="ui-kpi-value" dir="ltr">
                {data?.summary.totalSoldKg ?? '0.00'} kg
              </span>
              <span className="ui-kpi-hint">بونص وعينات: {data?.summary.totalBonusKg ?? '0.00'} kg</span>
            </div>
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">التالف المفحوص + العجز</span>
              <span className="ui-kpi-value is-down" dir="ltr">
                {data?.summary.totalShortageKg ?? '0.00'} kg
              </span>
              <span className="ui-kpi-hint">
                تالف: {data?.summary.totalDamagedKg ?? '0.00'} kg · خصم رواتب:{' '}
                {data?.summary.totalShortageSar ?? '0.00'} SAR
              </span>
            </div>
            <div className="ui-kpi-cell">
              {/**
               * العنوانُ كان «إجمالي المبيعات» والرقمُ صار **صافيًا** من المرتجعات — فبقي
               * العنوانُ كما هو يعني كذبًا. والسطرُ الثاني يعرض أطرافَ المعادلة حين تكون في
               * السجلّ مرتجعات: إجماليٌّ − مرتجعاتٌ − ضريبتُها = الصافي المعروض.
               */}
              <span className="ui-kpi-label">صافي المبيعات (ZATCA + عادية − مرتجعات)</span>
              <span className="ui-kpi-value is-up" dir="ltr">
                {data?.summary.totalRevenueSar ?? '0.00'} SAR
              </span>
              <span className="ui-kpi-hint">
                ضريبية: {data?.summary.totalZatcaSalesSar ?? '0.00'} · عادية:{' '}
                {data?.summary.totalInternalSalesSar ?? '0.00'}
              </span>
            </div>
            <div className="ui-kpi-cell">
              <span className="ui-kpi-label">التحصيل والمديونيات وصافي الربح</span>
              <span className="ui-kpi-value is-up" dir="ltr">
                {data?.summary.totalNetProfitSar ?? '0.00'} SAR
              </span>
              <span className="ui-kpi-hint">
                محصّل: {data?.summary.totalCollectedCashSar ?? '0.00'} · آجل:{' '}
                {data?.summary.totalCreditReceivablesSar ?? '0.00'}
              </span>
            </div>
          </div>

          <Panel
            title="ملخص رقابة المناديب والعهد والربحية والعجز المخصوم من الراتب"
            hint="مقارنة شاملة لكل مندوب: المستلم، المباع، البونص، التالف، العجز المحسوب على المندوب، التحصيل، المديونيات، وصافي الربح."
            actions={
              <button type="button" className="btn sm primary" onClick={() => setTab('loads')}>
                تحميل عهدة / إغلاق وردية
              </button>
            }
          >
            <Table
              bare
              empty={<>لا توجد حركات مناديب بعد — ابدأ بتسجيل دفعة إنتاج أو أمر تحميل للمندوب.</>}
              columns={[
                {
                  key: 'c0',
                  header: 'المندوب',
                  cell: (rep) => (
                    <>
                      <strong>{rep.salesmanName}</strong>
                      {rep.pendingClosings > 0 && (
                        <div>
                          <span className="badge warn">إغلاق معلق ({rep.pendingClosings})</span>
                        </div>
                      )}
                    </>
                  ),
                },
                {
                  key: 'c1',
                  header: 'المستلم (كجم)',
                  ltr: true,
                  cell: (rep) => rep.loadedKg,
                },
                {
                  key: 'c2',
                  header: 'المباع (كجم)',
                  ltr: true,
                  cell: (rep) => rep.soldKg,
                },
                {
                  key: 'c3',
                  header: 'البونص (كجم)',
                  ltr: true,
                  cell: (rep) => rep.bonusKg,
                },
                {
                  key: 'c4',
                  header: 'مرتجع سليم',
                  ltr: true,
                  cell: (rep) => rep.returnedKg,
                },
                {
                  key: 'c5',
                  header: 'تالف مفحوص',
                  ltr: true,
                  cell: (rep) => rep.damagedKg,
                },
                {
                  key: 'c6',
                  header: 'عجز على المندوب',
                  ltr: true,
                  cell: (rep) => <>{rep.shortageKg} kg</>,
                },
                {
                  key: 'c7',
                  header: 'خصم الراتب (SAR)',
                  ltr: true,
                  cell: (rep) => <>{rep.shortageSar} SAR</>,
                },
                {
                  key: 'c8',
                  header: 'العهدة المتبقية',
                  ltr: true,
                  cell: (rep) => (
                    <>
                      <span className={`badge ${Number(rep.custodyRemainingKg) === 0 ? 'ok' : 'warn'}`}>
                        {rep.custodyRemainingKg} kg
                      </span>
                    </>
                  ),
                },
                {
                  key: 'c9',
                  header: 'المبيعات (SAR)',
                  ltr: true,
                  cell: (rep) => (
                    <>
                      <strong>{rep.revenueSar}</strong>
                    </>
                  ),
                },
                {
                  key: 'c10',
                  header: 'المحصّل',
                  ltr: true,
                  cell: (rep) => rep.collectedSar,
                },
                {
                  key: 'c11',
                  header: 'مديونية العملاء',
                  ltr: true,
                  cell: (rep) => rep.creditDebtSar,
                },
                {
                  key: 'c12',
                  header: 'صافي الربح',
                  ltr: true,
                  cell: (rep) => <>{rep.netProfitSar} SAR</>,
                },
              ]}
              rows={data?.repPerformance ?? []}
              rowKey={(rep) => rep.salesmanId}
            />
          </Panel>
        </div>
      )}

      {/* TAB 2: FACTORY PRODUCTION & GOODS MOVEMENT LEDGER (Pillar 1 & 6) */}
      {tab === 'production' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <form onSubmit={submitProductionBatch} style={{ display: 'grid', gap: 12 }}>
            <Panel title="تسجيل دفعة إنتاج يومي للمصنع والمخبز وتوريدها للمستودع الرئيسي">
              <p className="muted small" style={{ margin: 0 }}>
                تُقيَّد الكمية المنتجة في <b>الرصيد الرسمي للمستودع</b> برقم دفعة فريد (نفس الأرصدة التي تظهر
                في شاشة المخزون وبطاقة الصنف)، ولا يستطيع أي مندوب بيع كمية إلا بعد صرفها رسمياً من هذه
                الدفعات.
              </p>
              <div className="form-grid">
                <label className="field">
                  <span>الصنف المنتج من الأصناف المسجلة *</span>
                  <select
                    className="input"
                    required
                    value={prodItemId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setProdItemId(nextId);
                      const picked = items.find((it) => it.id === nextId);
                      if (picked) {
                        setProdItemName(itemLabel(picked));
                      }
                    }}
                  >
                    <option value="">— اختر الصنف —</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {itemLabel(it)}
                      </option>
                    ))}
                  </select>
                  <span className="muted small">
                    لا يمكن تسجيل إنتاج لصنف غير مسجل: الرصيد الرسمي يُحتسب بالصنف والمستودع.
                  </span>
                </label>
                <label className="field">
                  <span>المستودع الرئيسي المُورَّد إليه *</span>
                  <select
                    className="input"
                    value={prodWarehouseId}
                    onChange={(e) => setProdWarehouseId(e.target.value)}
                  >
                    {warehouses.map((wh) => (
                      <option key={wh.id} value={wh.id}>
                        {wh.name ?? wh.nameAr ?? wh.code}
                        {wh.isDefault ? ' (افتراضي)' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="muted small">
                    يُختار المستودع الافتراضي تلقائيًا إن تُرك فارغًا — ولن تُسجَّل الدفعة بلا مستودع.
                  </span>
                </label>
                <label className="field">
                  <span>تاريخ الإنتاج</span>
                  <input
                    className="input"
                    type="date"
                    dir="ltr"
                    value={prodDate}
                    onChange={(e) => setProdDate(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>الكمية المنتجة الصالحة (كجم) *</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    required
                    dir="ltr"
                    value={prodQty}
                    onChange={(e) => setProdQty(e.target.value)}
                  />
                  <span className="muted small">هذه الكمية هي التي تدخل الرصيد الرسمي وتُتاح للبيع.</span>
                </label>
                <label className="field">
                  <span>فاقد التصنيع / الهالك (كجم)</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    min="0"
                    dir="ltr"
                    value={prodScrapQty}
                    onChange={(e) => setProdScrapQty(e.target.value)}
                  />
                  <span className="muted small">
                    يُسجَّل في حركة مستقلة ولا يدخل الرصيد الصالح للبيع، وتُحسب قيمته منفصلة عن تكلفة المنتج
                    الجيد.
                  </span>
                </label>
                <label className="field">
                  <span>سبب الفاقد {Number(prodScrapQty) > 0 ? '*' : ''}</span>
                  <input
                    className="input"
                    required={Number(prodScrapQty) > 0}
                    value={prodScrapReason}
                    onChange={(e) => setProdScrapReason(e.target.value)}
                    placeholder="مثال: عجين لم يختمر / قطع محترقة في الفرن الثاني"
                  />
                  <span className="muted small">
                    لا يُرحَّل فاقد بلا سبب: الكمية والسبب والدفعة تُسجَّل معاً حتى يمكن مراجعته.
                  </span>
                </label>
                <label className="field">
                  <span>رقم دفعة الإنتاج (اختياري)</span>
                  <input
                    className="input"
                    dir="ltr"
                    value={prodBatchNo}
                    onChange={(e) => setProdBatchNo(e.target.value)}
                    placeholder="مثال: BR-2026-0001"
                  />
                  <span className="muted small">
                    اتركه فارغاً ليُخصَّص رقم تسلسلي رسمي؛ وإن كتبته صار <b>رقم دفعة الناتج (اللوت)</b> في
                    الرصيد الرسمي مطابقاً له — فيُقرأ الرقم نفسه على الشحنة والرفّ والجرد.
                  </span>
                </label>
                <div className="field" style={{ gridColumn: '1 / -1' }}>
                  <span>مكوّنات الدفعة — مصدر المواد *</span>
                  <span className="muted small">
                    كل مكوّن يُصرف رسمياً من مستودع المنشأة بالمتوسط المرجّح، وقيمته هي تكلفة الدفعة. بلا
                    مكوّنات (أو قائمة مواد مرتبطة بالصنف) تُرفض الدفعة؛ والوارد من خارج المنشأة موضعه إذن
                    إدخال مخزني رسمي أو تسوية جرد معتمدة لا دفعة إنتاج.
                  </span>
                  {prodComponents.map((line, index) => (
                    <div
                      key={`component-${index}`}
                      style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 160px auto', gap: 8 }}
                    >
                      <select
                        className="input"
                        value={line.itemId}
                        onChange={(e) =>
                          setProdComponents((rows) =>
                            rows.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, itemId: e.target.value } : row,
                            ),
                          )
                        }
                      >
                        <option value="">— اختر المكوّن —</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {itemLabel(it)}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input"
                        type="number"
                        step="0.01"
                        min="0"
                        dir="ltr"
                        placeholder="الكمية"
                        value={line.qty}
                        onChange={(e) =>
                          setProdComponents((rows) =>
                            rows.map((row, rowIndex) =>
                              rowIndex === index ? { ...row, qty: e.target.value } : row,
                            ),
                          )
                        }
                      />
                      <button
                        type="button"
                        className="btn"
                        onClick={() =>
                          setProdComponents((rows) => rows.filter((_row, rowIndex) => rowIndex !== index))
                        }
                      >
                        حذف
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                    <button
                      type="button"
                      className="btn"
                      onClick={() => setProdComponents((rows) => [...rows, { itemId: '', qty: '' }])}
                    >
                      إضافة مكوّن
                    </button>
                    {(() => {
                      const filled = prodComponents.filter(
                        (line) => line.itemId.trim().length > 0 && Number(line.qty) > 0,
                      );
                      if (filled.length === 0) return null;
                      const estimate = estimateComponentCost({
                        lines: filled,
                        producedQty: prodQty,
                        stockRows: data?.officialStock ?? [],
                        warehouseId: prodWarehouseId,
                      });
                      return estimate.unvalued > 0 ? (
                        <span className="small" style={{ color: 'var(--warn)' }}>
                          {estimate.unvalued} من المكوّنات ليس له قيمة أو رصيد في هذا المستودع — ستُرفض الدفعة
                          حتى تُقيَّم المواد (إذن إدخال رسمي أو تسوية جرد معتمدة).
                        </span>
                      ) : (
                        <span className="muted small">
                          تقدير التكلفة من المتوسط الرسمي: {estimate.totalValue} ريال {estimate.perKg}{' '}
                          ريال/كجم — والرقم الفعلي هو قيمة ما يخرج من الرفّ.
                        </span>
                      );
                    })()}
                  </div>
                </div>
                <label className="field">
                  <span>مشرف الإنتاج / أمين المستودع</span>
                  <input
                    className="input"
                    value={prodSupervisor}
                    onChange={(e) => setProdSupervisor(e.target.value)}
                  />
                </label>
              </div>
              <div>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'جارٍ الحفظ…' : 'اعتماد دفعة الإنتاج وتوريدها للمستودع الرئيسي'}
                </button>
              </div>
            </Panel>
          </form>

          <Panel title="دفعات الإنتاج وأرصدة المستودع الرئيسي" flush>
            <div className="muted small">
              {windowNote(data?.windows, 'productionBatches', PRODUCTION_WINDOW_FALLBACK, {
                totalsClause: DASHBOARD_TOTALS_CLAUSE,
              })}
            </div>
            <Table
              bare
              empty={<>لم يتم تسجيل دفعة إنتاج بعد.</>}
              columns={[
                {
                  key: 'c0',
                  header: 'رقم دفعة الإنتاج',
                  ltr: true,
                  cell: (b) => (
                    <>
                      <strong>{b.batchNo}</strong>
                    </>
                  ),
                },
                {
                  key: 'c1',
                  header: 'التاريخ',
                  ltr: true,
                  cell: (b) => b.productionDate,
                },
                {
                  key: 'c2',
                  header: 'الصنف',
                  cell: (b) => b.itemName,
                },
                {
                  key: 'c3',
                  header: 'الكمية المنتجة',
                  ltr: true,
                  cell: (b) => (
                    <>
                      <strong>{b.producedQty} kg</strong>
                    </>
                  ),
                },
                {
                  key: 'c4',
                  header: 'المصروف للمناديب',
                  ltr: true,
                  cell: (b) => <>{b.issuedQty} kg</>,
                },
                {
                  key: 'c5',
                  header: 'المرتجع السليم',
                  ltr: true,
                  cell: (b) => <>{b.returnedGoodQty} kg</>,
                },
                {
                  key: 'c6',
                  header: 'التالف المعتمد',
                  ltr: true,
                  cell: (b) => <>{b.damagedQty} kg</>,
                },
                {
                  key: 'c7',
                  header: 'الرصيد المتاح بالمستودع',
                  ltr: true,
                  cell: (b) => (
                    <>
                      <span className="badge ok">{b.availableWarehouseQty} kg</span>
                    </>
                  ),
                },
                {
                  key: 'c8',
                  header: 'تكلفة الكيلو',
                  ltr: true,
                  cell: (b) => (
                    <>
                      {b.unitCost} SAR
                      <div className="muted small">
                        {b.costBasis === 'manufacturing_order'
                          ? 'تكلفة فعلية من أمر تصنيع رسمي'
                          : 'تكلفة مدخلة أو من بطاقة الصنف — ليست تكلفة أمر تصنيع'}
                      </div>
                      {Number(b.scrapQty ?? 0) > 0 ? (
                        <div
                          className="muted small"
                          style={{ color: b.scrapCostLoaded ? undefined : 'var(--warn)' }}
                        >
                          فاقد {b.scrapQty} كجم بقيمة {b.scrapValue} SAR —{' '}
                          {b.scrapCostLoaded
                            ? 'محمّلة على تكلفة المنتج الجيد'
                            : 'غير محمّلة على المنتج الجيد — أمر الإنتاج يُنتج الكمية الصالحة وحدها فلا تُصرف مواد للفاقد (تحميله قرار تسعير تكلفة لم يُعتمد بعد)'}
                        </div>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: 'c9',
                  header: 'الربط الرسمي',
                  cell: (b) => (
                    <>
                      {b.productionOrderId ? (
                        <span className="badge ok">أمر إنتاج رسمي</span>
                      ) : b.manufacturingOrderId ? (
                        <span className="badge ok">أمر تصنيع رسمي</span>
                      ) : (
                        <span className="badge warn">دفعة قديمة بلا أمر رسمي</span>
                      )}
                      <div className="muted small">
                        {b.inventoryTransactionId ? 'حركة مخزون رسمية ' : 'بلا حركة رسمية مربوطة'}
                        {b.lotId ? ' · دفعة ناتج (لوت) ' : ''}
                      </div>
                    </>
                  ),
                },
                {
                  key: 'c10',
                  header: 'إجمالي تكلفة الدفعة',
                  ltr: true,
                  cell: (b) => (
                    <>
                      <strong>{b.totalCost} SAR</strong>
                    </>
                  ),
                },
              ]}
              rows={data?.productionBatches ?? []}
              rowKey={(b) => b.id}
            />
          </Panel>

          <Panel title="سجل الرقابة على حركة البضاعة والتدقيق (من نفذ العملية ومن اعتمدها)" flush>
            <div className="muted small">
              {windowNote(data?.windows, 'movements', MOVEMENTS_WINDOW_FALLBACK, {
                totalsClause: DASHBOARD_TOTALS_CLAUSE,
              })}
            </div>
            <Table
              bare
              columns={[
                {
                  key: 'c0',
                  header: 'الوقت',
                  ltr: true,
                  cell: (m) => new Date(m.createdAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
                },
                {
                  key: 'c1',
                  header: 'نوع الحركة',
                  cell: (m) => (
                    <>
                      <strong>{MOVEMENT_TYPE_AR[m.movementType] ?? m.movementType}</strong>
                    </>
                  ),
                },
                {
                  key: 'c2',
                  header: 'دفعة الإنتاج',
                  ltr: true,
                  cell: (m) => m.batchNo || '—',
                },
                {
                  key: 'c3',
                  header: 'المندوب',
                  cell: (m) => m.salesmanName,
                },
                {
                  key: 'c4',
                  header: 'العميل',
                  cell: (m) => m.customerName,
                },
                {
                  key: 'c5',
                  header: 'الكمية (كجم)',
                  ltr: true,
                  cell: (m) => <>{m.qty} kg</>,
                },
                {
                  key: 'c6',
                  header: 'المبلغ (SAR)',
                  ltr: true,
                  cell: (m) => <>{m.amount} SAR</>,
                },
                {
                  key: 'c7',
                  header: 'البيان والسبب',
                  cell: (m) => m.reason,
                },
                {
                  key: 'c8',
                  header: 'منفّذ العملية',
                  cell: (m) => m.actorLabel,
                },
                {
                  key: 'c9',
                  header: 'المعتمد',
                  cell: (m) => m.approvedByLabel || '—',
                },
              ]}
              rows={data?.movements ?? []}
              rowKey={(m) => m.id}
            />
          </Panel>
        </div>
      )}

      {/* TAB 3: DISTRIBUTION REPS — the official `salesmen` card, its employee, its login, its van */}
      {tab === 'reps' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Panel
            title="مندوبو التوزيع — البطاقة والموظف وحساب الدخول ومستودع السيارة"
            hint={
              <>
                لا يوجد جدول مندوبين منفصل: هذه هي بطاقة المندوب الرسمية نفسها (<code>salesmen</code>) مربوطة
                ببطاقة الموظف (<code>employees</code>) وحساب الدخول (<code>memberships</code>{' '}
                <code>users</code>) ومستودع سيارة التوزيع. إنشاء المندوب نفسه وتعديل عمولاته من شاشة{' '}
                <a href="/sales/salesmen">المبيعات المندوبين</a>، وهنا يُستكمل ربط التوزيع.
              </>
            }
            flush
          >
            <Table
              bare
              empty={<>لا يوجد مندوبون — أنشئ بطاقة المندوب من شاشة المبيعات المندوبين ثم اربطها هنا.</>}
              columns={[
                {
                  key: 'c0',
                  header: 'المندوب',
                  cell: (rep) => (
                    <>
                      <b>{rep.name}</b>
                      {!rep.active ? <span className="muted small"> (موقوف)</span> : null}
                      {rep.mobile ? (
                        <div className="muted small" dir="ltr">
                          {rep.mobile}
                        </div>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: 'c1',
                  header: 'الموظف المرتبط',
                  cell: (rep) =>
                    rep.employeeName ? (
                      <>
                        {rep.employeeName}
                        <div className="muted small" dir="ltr">
                          {rep.employeeNo}
                        </div>
                      </>
                    ) : (
                      <span className="muted small">بلا بطاقة موظف</span>
                    ),
                },
                {
                  key: 'c2',
                  header: 'حساب الدخول',
                  cell: (rep) =>
                    rep.userEmail ? (
                      <>
                        <span dir="ltr">{rep.userEmail}</span>
                        <div className="muted small">
                          {rep.membershipStatus === 'active' ? ' فعّال' : `${rep.membershipStatus ?? 'مدعو'}`}
                          {rep.roleCount ? ` · ${rep.roleCount} دور` : ''}
                        </div>
                      </>
                    ) : (
                      <span className="muted small">بلا حساب دخول</span>
                    ),
                },
                {
                  key: 'c3',
                  header: 'مستودع السيارة / اللوحة',
                  cell: (rep) =>
                    rep.warehouseName ? (
                      <>
                        {rep.warehouseName}
                        <div className="muted small" dir="ltr">
                          {rep.warehouseCode}
                        </div>
                        {rep.vehiclePlate ? <div className="muted small">{rep.vehiclePlate}</div> : null}
                      </>
                    ) : (
                      <span className="muted small">بلا مستودع سيارة</span>
                    ),
                },
                {
                  key: 'c4',
                  header: 'العهدة الحالية',
                  numeric: true,
                  ltr: true,
                  cell: (rep) => (
                    <>
                      {rep.custody.custodyQty} kg
                      <div className="muted small">
                        {rep.custody.openLoadOrders} أمر · {rep.custody.pendingReceipts} بانتظار الاستلام
                      </div>
                    </>
                  ),
                },
                {
                  key: 'c5',
                  header: 'نقد مستحق',
                  numeric: true,
                  ltr: true,
                  cell: (rep) => rep.custody.outstandingCash,
                },
                {
                  key: 'c6',
                  header: 'الحالة والجهوزية',
                  cell: (rep) => (
                    <>
                      <div className="muted small">
                        {rep.readiness.hasEmployee ? 'موظف مرتبط' : 'بلا موظف'} ·{' '}
                        {rep.readiness.hasLoginAccount ? 'حساب دخول' : 'بلا حساب دخول'} ·{' '}
                        {rep.readiness.hasVanWarehouse ? 'مستودع مخصّص' : 'بلا مستودع'} ·{' '}
                        {rep.readiness.hasVanSalesPermissions ? 'صلاحيات توزيع' : 'بلا صلاحيات توزيع'}
                      </div>
                      {rep.custody.items.length ? (
                        <div className="muted small">
                          {rep.custody.items.map((row) => `${row.itemName}: ${row.quantity}`).join(' · ')}
                        </div>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: 'c7',
                  header: 'إجراءات',
                  cell: (rep) => (
                    <>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setRepTarget(rep);
                            setRepEmail(rep.userEmail ?? rep.email ?? '');
                            setRepFullName(rep.employeeName ?? rep.name);
                          }}
                        >
                          {rep.membershipId ? 'إعادة ربط الحساب' : 'ربط حساب دخول'}
                        </button>
                        <a className="btn sm" href="/sales/salesmen">
                          بطاقة المندوب
                        </a>
                      </div>
                    </>
                  ),
                },
              ]}
              rows={vanSalesmen}
              rowKey={(rep) => rep.id}
            />
          </Panel>

          {repTarget ? (
            <form onSubmit={linkRepAccount} style={{ display: 'grid', gap: 12 }}>
              <Panel title={<>ربط المندوب ( {repTarget.name} ) بحساب دخول رسمي</>}>
                <p className="muted small" style={{ margin: 0 }}>
                  يُنشئ النظام مستخدمًا وعضوية عبر مسار الدعوة الرسمي نفسه المستعمل لبقية الموظفين، ويضعها على
                  دور «مندوب توزيع» بصلاحيات: رؤية عهدته، إصدار فواتيره، تسجيل تحصيلاته، وتقديم إغلاق ورديته.
                  كلمة المرور لا تُخترَع هنا — يصل المندوب رابط التفعيل الرسمي.
                </p>
                <div className="form-grid">
                  <label className="field">
                    <span>البريد الإلكتروني لحساب المندوب *</span>
                    <input
                      className="input"
                      type="email"
                      required
                      dir="ltr"
                      value={repEmail}
                      onChange={(e) => setRepEmail(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>الاسم الظاهر</span>
                    <input
                      className="input"
                      value={repFullName}
                      onChange={(e) => setRepFullName(e.target.value)}
                    />
                  </label>
                </div>
                <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                  <input
                    type="checkbox"
                    checked={repScopeToVan}
                    onChange={(e) => setRepScopeToVan(e.target.checked)}
                  />
                  <span>
                    قصر صلاحية الحساب على مستودع سيارة هذا المندوب فقط (يمنعه من قراءة عهدة مندوب آخر)
                  </span>
                </label>
                {!repTarget.readiness.hasEmployee ? (
                  <div className="muted small" style={{ color: 'var(--warn)' }}>
                    هذه البطاقة غير مربوطة ببطاقة موظف — اربطها أولًا من شاشة المبيعات المندوبين حتى تُنسب
                    سندات القبض والإغلاقات إلى الموظف نفسه.
                  </div>
                ) : null}
                <div className="row" style={{ gap: 8 }}>
                  <button type="submit" className="btn primary" disabled={busy}>
                    {busy ? 'جارٍ الربط…' : 'إنشاء / ربط حساب الدخول'}
                  </button>
                  <button type="button" className="btn" onClick={() => setRepTarget(null)}>
                    إلغاء
                  </button>
                </div>
              </Panel>
            </form>
          ) : null}
        </div>
      )}

      {/* TAB 4: SUPPLY TO VANS, CUSTODY & END-OF-DAY SHIFT CLOSING (Pillar 2 & 7) */}
      {tab === 'loads' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <form onSubmit={submitLoadOrder} style={{ display: 'grid', gap: 12 }}>
            <Panel title="توريد المنتجات من المستودع الرئيسي إلى سيارة المندوب">
              <p className="muted small" style={{ margin: 0 }}>
                يُنشئ النظام <b>مناولة مخزنية رسمية</b> (تحويل بين مستودعين) فتخرج الكمية من رصيد المستودع
                الرئيسي إلى «بضاعة تحت التحويل»، وتبقى هناك حتى <b>يؤكّد المندوب الاستلام</b> — عندها فقط تدخل
                رصيد سيارة المندوب وتصبح عهدة قابلة للبيع. لا تُخصم الكمية مرتين ولا تظهر في العهدة قبل
                الاستلام.
              </p>
              <div className="form-grid">
                <label className="field">
                  <span>المندوب *</span>
                  <select
                    className="input"
                    required
                    value={loadSalesmanId}
                    onChange={(e) => setLoadSalesmanId(e.target.value)}
                  >
                    <option value="">— اختر المندوب —</option>
                    {salesmen.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>المستودع الرئيسي (مصدر التوريد) *</span>
                  <select
                    className="input"
                    value={loadWarehouseId}
                    onChange={(e) => setLoadWarehouseId(e.target.value)}
                  >
                    {warehouses.map((wh) => (
                      <option key={wh.id} value={wh.id}>
                        {wh.name ?? wh.nameAr ?? wh.code}
                        {wh.isDefault ? ' (افتراضي)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>مستودع سيارة المندوب (الوجهة) *</span>
                  <select
                    className="input"
                    value={loadVanWarehouseId}
                    onChange={(e) => setLoadVanWarehouseId(e.target.value)}
                  >
                    <option value="">— مستودع المندوب المُسند في بطاقته —</option>
                    {warehouses
                      .filter((wh) => wh.id !== loadWarehouseId)
                      .map((wh) => (
                        <option key={wh.id} value={wh.id}>
                          {wh.name ?? wh.nameAr ?? wh.code}
                        </option>
                      ))}
                  </select>
                  <span className="muted small">
                    يُستخدم مستودع السيارة المُسند للمندوب في بطاقته إن تُرك فارغًا — ويجب أن يختلف عن مستودع
                    المصدر.
                  </span>
                </label>
                <label className="field">
                  <span>رقم دفعة الإنتاج (Batch No)</span>
                  <input
                    className="input"
                    dir="ltr"
                    value={productionBatchNo}
                    onChange={(e) => setProductionBatchNo(e.target.value)}
                    placeholder="تلقائي: PROD-YYYYMMDD-XXX"
                  />
                </label>
                <label className="field">
                  <span>رقم لوحة السيارة</span>
                  <input
                    className="input"
                    value={vehiclePlate}
                    onChange={(e) => setVehiclePlate(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>الكمية المستلمة كعهدة (كجم) *</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    required
                    dir="ltr"
                    value={loadedQty}
                    onChange={(e) => setLoadedQty(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>سقف البونص المسموح في الرحلة (كجم)</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    dir="ltr"
                    value={maxBonusQty}
                    onChange={(e) => setMaxBonusQty(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>الصنف (اختياري)</span>
                  <select
                    className="input"
                    value={loadItemId}
                    onChange={(e) => setLoadItemId(e.target.value)}
                  >
                    <option value="">رقائق سمبوسة وفطائر (عام)</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>
                        {it.nameAr}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div>
                <button type="submit" className="btn primary" disabled={busy}>
                  {busy ? 'جارٍ الإصدار…' : 'اعتماد أمر التحميل وتسليم العهدة للمندوب'}
                </button>
              </div>
            </Panel>
          </form>

          <Panel title="سجل عهد المناديب وإغلاق الورديات واعتماد المحاسب" flush>
            <div className="muted small">
              {windowNote(data?.windows, 'loadOrders', LOAD_ORDERS_WINDOW_FALLBACK, {
                totalsClause: DASHBOARD_TOTALS_CLAUSE,
              })}
            </div>
            <Table
              bare
              columns={[
                {
                  key: 'c0',
                  header: 'رقم الأمر',
                  ltr: true,
                  cell: (l) => (
                    <>
                      <strong>{l.number}</strong>
                    </>
                  ),
                },
                {
                  key: 'c1',
                  header: 'المندوب',
                  cell: (l) => (
                    <>
                      <strong>{l.salesmanName}</strong>
                    </>
                  ),
                },
                {
                  key: 'c2',
                  header: 'دفعة الإنتاج',
                  ltr: true,
                  cell: (l) => l.productionBatchNo,
                },
                {
                  key: 'c3',
                  header: 'المصروف من المستودع',
                  ltr: true,
                  cell: (l) => (
                    <>
                      <strong>{l.loadedQty} kg</strong>
                    </>
                  ),
                },
                {
                  key: 'c4',
                  header: 'أكّد المندوب استلامه',
                  ltr: true,
                  cell: (l) =>
                    l.awaitingReceipt ? (
                      <div className="row" style={{ gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span className="badge warn">{l.loadedQty} kg</span>
                        <button
                          type="button"
                          className="btn sm primary"
                          disabled={busy}
                          onClick={() => void confirmLoadReceipt(l.id, l.loadedQty)}
                        >
                          تأكيد الاستلام نيابةً عن المندوب
                        </button>
                      </div>
                    ) : (
                      <>
                        <strong>{l.receivedQty ?? '0.00'} kg</strong>
                        {Number(l.discrepancyQty ?? 0) > 0 ? (
                          <div className="muted small" style={{ color: 'var(--danger)' }}>
                            فرق {l.discrepancyQty} kg
                            {l.discrepancyNotes ? ` — ${l.discrepancyNotes}` : ''}
                          </div>
                        ) : null}
                      </>
                    ),
                },
                {
                  key: 'c5',
                  header: 'المباع',
                  ltr: true,
                  cell: (l) => <>{l.soldQty} kg</>,
                },
                {
                  key: 'c6',
                  header: 'البونص',
                  ltr: true,
                  cell: (l) => <>{l.bonusQty} kg</>,
                },
                {
                  key: 'c7',
                  header: 'مرتجع سليم',
                  ltr: true,
                  cell: (l) => <>{l.returnedQty} kg</>,
                },
                {
                  key: 'c8',
                  header: 'تالف للفحص',
                  ltr: true,
                  cell: (l) => (
                    <>
                      {l.damagedQty} kg
                      {l.damageInspected && Number(l.damagedQty) > 0 ? ' (مفحوص)' : ''}
                    </>
                  ),
                },
                {
                  key: 'c9',
                  header: 'العجز على المندوب',
                  ltr: true,
                  cell: (l) => (
                    <>
                      {l.shortageQty} kg
                      {Number(l.shortageValue) > 0 ? ` (${l.shortageValue} SAR)` : ''}
                    </>
                  ),
                },
                {
                  key: 'c10',
                  header: 'المتبقي (متوقع / جرد فعلي)',
                  ltr: true,
                  cell: (l) => (
                    <>
                      <strong>{l.remainingQty} kg</strong>
                      <div className="muted small">
                        متوقع {l.expectedRemainingQty ?? '0.00'} / جرد {l.actualRemainingQty ?? '0.00'}
                      </div>
                      {Number(l.countVarianceQty ?? 0) !== 0 ? (
                        <div
                          className="muted small"
                          style={{
                            color: Number(l.countVarianceQty ?? 0) > 0 ? 'var(--danger)' : 'var(--ok)',
                          }}
                        >
                          {Number(l.countVarianceQty ?? 0) > 0
                            ? `عجز جرد ${l.countVarianceQty} kg`
                            : `فائض جرد ${Math.abs(Number(l.countVarianceQty ?? 0)).toFixed(2)} kg`}
                          {l.countVarianceCostValue
                            ? ` ≈ ${l.countVarianceCostValue} ريال على أساس التكلفة`
                            : ''}
                          {l.countDocumentVarianceValue
                            ? ` (مستند الجرد الرسمي: ${l.countDocumentVarianceValue} ريال)`
                            : ' (مستند الجرد لم يُرحَّل بعد)'}
                          <br />
                          قيمة تسوية مخزنية — <b>ليست ديناً على المندوب</b>: المسؤولية المالية تبقى معلّقة حتى
                          تعتمد السياسة.
                        </div>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: 'c11',
                  header: 'النقد المتوقع / المسلم',
                  ltr: true,
                  cell: (l) => (
                    <>
                      {l.expectedCash} / {l.collectedCash} SAR
                    </>
                  ),
                },
                {
                  key: 'c12',
                  header: 'الحالة',
                  cell: (l) => (
                    <>
                      <span
                        className={`badge ${
                          l.status === 'settled' || l.status === 'reconciled'
                            ? 'ok'
                            : l.status === 'pending_closing' || l.status === 'pending_stock_settlement'
                              ? 'warn'
                              : l.status === 'rejected' || l.status === 'canceled'
                                ? 'neutral'
                                : 'neutral'
                        }`}
                      >
                        {LOAD_STATUS_AR[l.status] ?? l.status}
                      </span>
                      {l.stockSettlementStatus && l.stockSettlementStatus !== 'not_required' ? (
                        <div
                          className="muted small"
                          style={{
                            color:
                              l.awaitingStockSettlement || l.awaitingTransitDecision
                                ? 'var(--danger)'
                                : undefined,
                          }}
                        >
                          {SETTLEMENT_STATUS_AR[l.stockSettlementStatus] ?? l.stockSettlementStatus}
                          {l.remainingAction
                            ? ` · المتبقي: ${
                                l.remainingAction === 'return_to_main'
                                  ? 'إرجاع للمستودع الرئيسي'
                                  : 'عهدة الوردية التالية'
                              }`
                            : ''}
                          {l.stockSettlementNote ? ` — ${l.stockSettlementNote}` : ''}
                        </div>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: 'c13',
                  header: 'إجراء الإغلاق والاعتماد',
                  cell: (l) => (
                    <>
                      <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {l.awaitingStockSettlement ? (
                          <>
                            <button
                              type="button"
                              className="btn sm primary"
                              disabled={busy}
                              onClick={() => void handleSettleLoadOrderStock(l, true)}
                            >
                              استكمال تسوية المخزون وترحيل مستند الجرد
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              disabled={busy}
                              onClick={() => openClosingModal(l)}
                            >
                              مراجعة الأرقام
                            </button>
                          </>
                        ) : l.status !== 'settled' && l.status !== 'reconciled' ? (
                          <button
                            type="button"
                            className={`btn sm ${l.status === 'pending_closing' ? 'primary' : ''}`}
                            disabled={l.status === 'rejected' || l.status === 'canceled'}
                            onClick={() => openClosingModal(l)}
                          >
                            {l.status === 'pending_closing'
                              ? 'مراجعة واعتماد المحاسب'
                              : 'إغلاق الوردية وتصفية العهدة'}
                          </button>
                        ) : (
                          <span className="muted small">
                            معتمد ومسوّى {l.approvedByLabel ? `بواسطة ${l.approvedByLabel}` : ''}
                          </span>
                        )}

                        {/* فرق استلام بلا قرار — the quantity is still officially in transit */}
                        {l.awaitingTransitDecision ? (
                          <>
                            <button
                              type="button"
                              className="btn sm"
                              disabled={busy}
                              onClick={() => void handleCloseTransitDifference(l, 'return')}
                            >
                              إرجاع الفرق إلى المصدر
                            </button>
                            <button
                              type="button"
                              className="btn sm"
                              disabled={busy}
                              onClick={() => void handleCloseTransitDifference(l, 'shortage')}
                            >
                              اعتباره عجز تحويل
                            </button>
                          </>
                        ) : null}

                        {/* إلغاء توريد لم يُستلَم بعد */}
                        {l.status === 'pending_receipt' ? (
                          <button
                            type="button"
                            className="btn sm"
                            disabled={busy}
                            onClick={() => void handleCancelLoadOrder(l)}
                          >
                            إلغاء التوريد
                          </button>
                        ) : null}
                      </div>
                    </>
                  ),
                },
              ]}
              rows={data?.loadOrders ?? []}
              rowKey={(l) => l.id}
            />
          </Panel>

          {/* Shift Closing & Accountant Approval Modal */}
          {closingTarget && (
            <div
              role="dialog"
              aria-modal="true"
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.6)',
                display: 'grid',
                placeItems: 'center',
                zIndex: 80,
                padding: 16,
              }}
            >
              <Panel style={{ width: '100%', maxWidth: 680, display: 'grid', gap: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2>
                    إغلاق وردية المندوب ({closingTarget.salesmanName}) — أمر رقم {closingTarget.number}
                  </h2>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => setClosingTarget(null)}
                    aria-label="إغلاق"
                  >
                    <X size={14} />
                  </button>
                </div>

                <div
                  style={{
                    padding: 12,
                    borderRadius: 10,
                    border: '1px solid var(--line)',
                    background: 'var(--surface-2)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
                    gap: 8,
                    textAlign: 'center',
                  }}
                >
                  <div>
                    <div className="muted small">1. الكمية المستلمة</div>
                    <strong dir="ltr">{modalLoaded.toFixed(2)} kg</strong>
                  </div>
                  <div>
                    <div className="muted small">2. المباع الفعلي</div>
                    <strong style={{ color: 'var(--ok)' }} dir="ltr">
                      {modalSold.toFixed(2)} kg
                    </strong>
                  </div>
                  <div>
                    <div className="muted small">3. البونص المجاني</div>
                    <strong style={{ color: 'var(--warn)' }} dir="ltr">
                      {modalBonus.toFixed(2)} kg
                    </strong>
                  </div>
                  <div>
                    <div className="muted small">4. المرتجع السليم</div>
                    <strong dir="ltr">{modalReturned.toFixed(2)} kg</strong>
                  </div>
                  <div>
                    <div className="muted small">5. التالف (للفحص)</div>
                    <strong style={{ color: 'var(--warn)' }} dir="ltr">
                      {modalDamaged.toFixed(2)} kg
                    </strong>
                  </div>
                  <div>
                    <div className="muted small">6. المتبقي المتوقع</div>
                    <strong dir="ltr">{modalExpectedRemaining.toFixed(2)} kg</strong>
                  </div>
                  <div>
                    <div className="muted small">7. المتبقي الفعلي بالجرد</div>
                    <strong dir="ltr">{modalActualRemaining.toFixed(2)} kg</strong>
                  </div>
                  <div>
                    <div className="muted small">8. العجز على المندوب</div>
                    <strong style={{ color: 'var(--danger)', fontSize: 16 }} dir="ltr">
                      {modalShortageKg.toFixed(2)} kg ({modalShortageSar.toFixed(2)} SAR)
                    </strong>
                  </div>
                </div>

                <div className="form-grid">
                  <label className="field">
                    <span>الكمية المرتجعة السليمة للمستودع (كجم)</span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      dir="ltr"
                      value={closingReturnedQty}
                      onChange={(e) => setClosingReturnedQty(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>الكمية التالفة الخاضعة للفحص الفعلي (كجم)</span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      dir="ltr"
                      value={closingDamagedQty}
                      onChange={(e) => setClosingDamagedQty(e.target.value)}
                    />
                  </label>
                  <label className="field">
                    <span>المتبقي الفعلي بالجرد في السيارة (كجم)</span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      dir="ltr"
                      value={closingActualRemaining}
                      onChange={(e) => setClosingActualRemaining(e.target.value)}
                    />
                    <span className="muted small">
                      المتوقع {modalExpectedRemaining.toFixed(2)} كجم —
                      {modalSurplusKg > 0
                        ? ` يوجد فائض ${modalSurplusKg.toFixed(2)} كجم عن المستندات يجب تفسيره.`
                        : modalShortageKg > 0
                          ? ` الفرق ${modalShortageKg.toFixed(2)} كجم عجز يُحال للمحاسب.`
                          : ' لا فرق بين الجرد والمستندات.'}
                    </span>
                  </label>
                  <label className="field">
                    <span>النقد المسلم فعلياً للصندوق (ريال)</span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      dir="ltr"
                      value={closingCollectedCash}
                      onChange={(e) => setClosingCollectedCash(e.target.value)}
                    />
                  </label>
                </div>

                <label className="field">
                  <span>سبب التلف وتفاصيل الفحص (إلزامي عند وجود تالف)</span>
                  <input
                    className="input"
                    value={closingDamageReason}
                    onChange={(e) => setClosingDamageReason(e.target.value)}
                    placeholder="مثال: تلف أثناء النقل ويحتاج فحص فعلي من أمين المستودع والمحاسب"
                  />
                </label>

                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: '1px solid var(--line)',
                    background: 'var(--surface)',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <strong>ضوابط اعتماد المحاسب النهائي:</strong>
                  <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={closingDamageInspected}
                      onChange={(e) => setClosingDamageInspected(e.target.checked)}
                    />
                    <span>
                      أقرّ بأن الكمية التالفة ({modalDamaged.toFixed(2)} كجم) تم فحصها فعلياً واستلامها.
                    </span>
                  </label>
                  <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={closingSalaryDeduction}
                      onChange={(e) => setClosingSalaryDeduction(e.target.checked)}
                    />
                    <span>
                      إقرار بمراجعة العجز ({modalShortageKg.toFixed(2)} كجم ≈ {modalShortageSar.toFixed(2)}{' '}
                      ريال) وسببه، وتصفير رصيد عهدة المندوب إلى (0.00 كجم).
                      <br />
                      <span className="muted small">
                        لا يُنشئ هذا الإقرار أي قيد على راتب المندوب أو ذمته: المعالجة المالية للعجز (أساس
                        التقييم والحساب المقابل) معلّقة حتى تعتمد السياسة من الإعدادات، ويُكتفى بتسجيل الحالة
                        «بانتظار اعتماد السياسة».
                      </span>
                    </span>
                  </label>
                </div>

                <div
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: '1px solid var(--line)',
                    background: 'var(--surface)',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <strong>تسوية المخزون الرسمية (بدونها لا تُغلق العهدة):</strong>

                  {modalActualRemaining > 0 ? (
                    <div style={{ display: 'grid', gap: 6 }}>
                      <span className="muted small">
                        مصير المتبقي الفعلي ({modalActualRemaining.toFixed(2)} كجم) — قرار صريح، لا يُفتَرَض:
                      </span>
                      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <input
                          type="radio"
                          name="closing-remaining-action"
                          checked={closingRemainingAction === 'return_to_main'}
                          onChange={() => setClosingRemainingAction('return_to_main')}
                        />
                        <span>
                          إرجاعه رسمياً إلى المستودع الرئيسي (حركة مخزنية رسمية وقيد من ملف الترحيل، ورصيد
                          السيارة يصبح صفراً)
                        </span>
                      </label>
                      <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                        <input
                          type="radio"
                          name="closing-remaining-action"
                          checked={closingRemainingAction === 'carry_over'}
                          onChange={() => setClosingRemainingAction('carry_over')}
                        />
                        <span>
                          إبقاؤه عهدة المندوب للوردية التالية (يبقى في رصيد السيارة الرسمي بنفس الكمية
                          المجرودة)
                        </span>
                      </label>
                    </div>
                  ) : (
                    <div className="muted small">الجرد الفعلي صفر — لا متبقي يحتاج قراراً.</div>
                  )}

                  {modalSurplusKg > 0 ? (
                    <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={closingSurplusAck}
                        onChange={(e) => setClosingSurplusAck(e.target.checked)}
                      />
                      <span>
                        أقرّ بأن الجرد الفعلي أكبر من العهدة بفائض {modalSurplusKg.toFixed(2)} كجم، ويُسجَّل
                        في مستند الجرد الرسمي (Dr المخزون / Cr تسوية الجرد) — لا إيراداً ولا هديةً ولا تعديلاً
                        على المستندات.
                      </span>
                    </label>
                  ) : null}

                  <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={closingSettleStock}
                      onChange={(e) => setClosingSettleStock(e.target.checked)}
                    />
                    <span>
                      فوّضني بترحيل مستند الجرد الرسمي الآن، فيصبح رصيد السيارة الرسمي مساوياً للجرد الفعلي (
                      {modalActualRemaining.toFixed(2)} كجم).
                      <br />
                      <span className="muted small">
                        بدون هذا التفويض يُنشأ مستند الجرد <b>مسودةً</b> وتبقى الوردية «بانتظار تسوية المخزون»
                        ولا تُغلق العهدة — وهذا هو المقصود: لا تُغلق عهدة مع بقاء فرق في دفتر المخزون.
                        المسؤولية المالية عن العجز تبقى معلّقة في الحالتين.
                      </span>
                    </span>
                  </label>
                </div>

                <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy}
                    onClick={() => void handleSubmitPendingClosing()}
                  >
                    1. حفظ وتقديم كطلب إغلاق معلق للمحاسب
                  </button>
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn" onClick={() => setClosingTarget(null)}>
                      إلغاء
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={
                        busy ||
                        (modalActualRemaining > 0 && !closingRemainingAction) ||
                        (modalSurplusKg > 0 && !closingSurplusAck)
                      }
                      onClick={() => void handleAccountantApproveClosing()}
                    >
                      {closingSettleStock
                        ? '2. اعتماد المحاسب وتسوية المخزون رسمياً'
                        : '2. اعتماد الكميات (العهدة تبقى بانتظار تسوية المخزون)'}
                    </button>
                  </div>
                </div>
              </Panel>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: VAN INVOICING (ZATCA TAX vs INTERNAL DELIVERY) & COLLECTION (Pillar 3, 4, 5, 8) */}
      {tab === 'invoice' && (
        <div className="ui-split">
          <div className="ui-split-main">
            <form onSubmit={submitVanDocument} style={{ display: 'grid', gap: 12 }}>
              <Panel title="إصدار فاتورة توزيع (ضريبية ZATCA أو عادية)">
                <p className="muted small" style={{ margin: 0 }}>
                  السعر يُجلب ويُثبّت تلقائياً حسب العميل، وتُخصم الكمية مباشرة من عهدة المندوب، مع دعم
                  الفاتورة الضريبية (15% VAT + QR) أو فاتورة تسليم عادية للمحلات التي لا تطلب فاتورة ضريبية
                  ورقية.
                </p>
                {/**
                 * إنذارُ هويّة البائع **بجملة الخادم نفسها** (`policy.zatcaSeller.refusalDetail`):
                 * فالخادمُ يرفض الفاتورة الضريبية ٤٢٢ (`VAN_ZATCA_SELLER_IDENTITY_REQUIRED`)
                 * حين ينقص اسمُ المنشأة أو رقمُها الضريبيّ، لأنّ رقمَ ضريبةٍ ليس للمنشأة في
                 * رمزٍ على فاتورة عميلٍ خطأُ امتثالٍ لا خطأُ عرض. والمحاسبُ أولى بأن يعرف قبل أن
                 * يُصدر، لا بعد أن يُرفض — والجملةُ من الحمولة فلا نسخةَ ثانيةَ منها هنا.
                 */}
                {data?.policy?.zatcaSeller && data.policy.zatcaSeller.ready === false ? (
                  <p className="muted small" style={{ margin: 0, color: 'var(--danger)' }}>
                    {data.policy.zatcaSeller.refusalDetail}
                  </p>
                ) : null}

                <div className="form-grid">
                  <label className="field">
                    <span>أمر التحميل / عهدة المندوب *</span>
                    <select
                      className="input"
                      required
                      value={docLoadOrderId}
                      onChange={(e) => setDocLoadOrderId(e.target.value)}
                    >
                      <option value="">— اختر عهدة المندوب —</option>
                      {(data?.loadOrders ?? [])
                        .filter((l) => l.status !== 'settled')
                        .map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.number} · {l.salesmanName} (متبقي: {l.remainingQty} كجم — دفعة{' '}
                            {l.productionBatchNo})
                          </option>
                        ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>العميل (اختياري لمحلات التجزئة)</span>
                    <select
                      className="input"
                      value={docPartyId}
                      onChange={(e) => onSelectCustomer(e.target.value)}
                    >
                      <option value="">— محل تجزئة نقدي / عام —</option>
                      {customers.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  {!docPartyId && (
                    <label className="field">
                      <span>اسم المحل / العميل</span>
                      <input
                        className="input"
                        value={docWalkinName}
                        onChange={(e) => setDocWalkinName(e.target.value)}
                        placeholder="مثال: بوفية البركة"
                      />
                    </label>
                  )}

                  <label className="field">
                    <span>نوع المستند (متوافق مع ZATCA) *</span>
                    <select
                      className="input"
                      value={docMode}
                      onChange={(e) => setDocMode(e.target.value as 'zatca_tax' | 'internal_delivery')}
                    >
                      <option value="zatca_tax">فاتورة ضريبية إلكترونية ZATCA (15% VAT + QR)</option>
                      <option value="internal_delivery">
                        فاتورة توزيع عادية (لمحل لا يطلب ضريبية ورقية)
                      </option>
                    </select>
                  </label>

                  <label className="field">
                    <span>طريقة الدفع</span>
                    <select
                      className="input"
                      value={docPayment}
                      onChange={(e) => setDocPayment(e.target.value as 'cash' | 'card' | 'credit')}
                    >
                      <option value="cash">نقدي (Cash)</option>
                      <option value="card">شبكة مدى / تحويل</option>
                      <option value="credit">آجل على ذمة العميل (Credit)</option>
                    </select>
                  </label>

                  {docPayment !== 'credit' ? (
                    <label className="field">
                      <span>الصندوق / موقع النقد *</span>
                      <select
                        className="input"
                        value={docCashLocationId}
                        onChange={(e) => setDocCashLocationId(e.target.value)}
                      >
                        <option value="">— الصندوق الافتراضي للفرع —</option>
                        {cashLocations.map((location) => (
                          <option key={location.id} value={location.id}>
                            {location.name}
                            {location.isDefault ? ' (افتراضي)' : ''}
                          </option>
                        ))}
                      </select>
                      <span className="muted small">
                        البيع النقدي يُرحَّل إلى حساب هذا الصندوق في الفاتورة الرسمية — لا يُخترَع حساب في
                        الكود.
                      </span>
                    </label>
                  ) : null}

                  <label className="field">
                    <span>الكمية المباعة (كجم) *</span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      required
                      dir="ltr"
                      value={docSoldQty}
                      onChange={(e) => setDocSoldQty(e.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>سعر الكيلو (ريال) {selectedCustomerRule?.lockPrice ? 'مثبّت للعميل' : ''}</span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      required
                      dir="ltr"
                      readOnly={Boolean(selectedCustomerRule?.lockPrice && !docAllowOverride)}
                      value={docUnitPrice}
                      onChange={(e) => setDocUnitPrice(e.target.value)}
                    />
                  </label>

                  <label className="field">
                    <span>الكمية المجانية / البونص (كجم)</span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      dir="ltr"
                      value={docBonusQty}
                      onChange={(e) => setDocBonusQty(e.target.value)}
                    />
                  </label>

                  {Number(docBonusQty || 0) > 0 && (
                    <label className="field">
                      <span>سبب منح الكمية المجانية / العينات *</span>
                      <select
                        className="input"
                        value={docBonusReason}
                        onChange={(e) => setDocBonusReason(e.target.value)}
                      >
                        {BONUS_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="field">
                    <span>خصم استثنائي (ريال — يتطلب صلاحية)</span>
                    <input
                      className="input"
                      type="number"
                      step="0.01"
                      dir="ltr"
                      value={docDiscountAmount}
                      onChange={(e) => setDocDiscountAmount(e.target.value)}
                    />
                  </label>

                  {Number(docDiscountAmount || 0) > 0 && (
                    <label className="field">
                      <span>سبب الخصم الاستثنائي</span>
                      <input
                        className="input"
                        value={docDiscountReason}
                        onChange={(e) => setDocDiscountReason(e.target.value)}
                      />
                    </label>
                  )}
                </div>

                <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                  <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={docBonusConfirmed}
                      onChange={(e) => setDocBonusConfirmed(e.target.checked)}
                    />
                    <span>إقرار استلام العميل للكمية المجانية ({docBonusQty || '0'} كجم)</span>
                  </label>
                  <label className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={docAllowOverride}
                      onChange={(e) => setDocAllowOverride(e.target.checked)}
                    />
                    <span>اعتماد استثنائي من صاحب المصنع / المحاسب لتجاوز السعر أو الخصم</span>
                  </label>
                  <input
                    className="input"
                    style={{ maxWidth: 200 }}
                    value={docConfirmCode}
                    onChange={(e) => setDocConfirmCode(e.target.value)}
                    placeholder="رمز/توقيع العميل (اختياري)"
                  />
                </div>

                <div
                  className="row"
                  style={{
                    justifyContent: 'space-between',
                    padding: 12,
                    borderRadius: 10,
                    background: 'var(--surface-2)',
                  }}
                >
                  <div>
                    <span>
                      الصافي قبل الضريبة: <strong dir="ltr">{previewSubtotal.toFixed(2)} SAR</strong>
                    </span>
                    {' · '}
                    <span>
                      الضريبة: <strong dir="ltr">{previewVat.toFixed(2)} SAR</strong>
                    </span>
                    {' · '}
                    <span>
                      الإجمالي:{' '}
                      <strong dir="ltr" style={{ color: 'var(--brand)' }}>
                        {previewTotal.toFixed(2)} SAR
                      </strong>
                    </span>
                    <div className="muted small">
                      الضريبةُ والإجماليُّ أعلاه تقديرٌ بنسبة {PREVIEW_VAT_RATE_PCT}٪ — والنسبةُ الفعلية تُحسم
                      عند الإصدار من المجموعة الضريبية للصنف، وإلا المجموعةِ الافتراضية للمنشأة، وإلا ١٥٪.
                      والمستندُ الصادرُ هو الرقمُ المعتمد.
                    </div>
                  </div>
                  <button type="submit" className="btn primary" disabled={busy || !activeLoadOrder}>
                    {busy ? 'جارٍ الإصدار…' : 'اعتماد الفاتورة وخصم العهدة'}
                  </button>
                </div>
              </Panel>
            </form>
          </div>

          <aside className="ui-split-rail">
            {/* Printing: one official document, two copies (customer + rep) and an 80mm receipt */}
            <Panel style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                <h3 style={{ margin: 0 }}>طباعة مستند البيع — نسختان من فاتورة رسمية واحدة</h3>
                {selectedDoc && (
                  <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      className="btn sm primary"
                      disabled={busy}
                      onClick={() => void printDocumentCopies(selectedDoc.id)}
                    >
                      طباعة نسختين (عميل + مندوب موقّعة)
                    </button>
                    <button
                      type="button"
                      className="btn sm"
                      disabled={busy}
                      onClick={() => void printThermalFromView(selectedDoc.id)}
                    >
                      إيصال حراري 80mm
                    </button>
                    {selectedDoc.documentKind !== 'return' ? (
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy}
                        onClick={() => {
                          const qty = window.prompt(
                            `كمية المرتجع من المستند ${selectedDoc.number} (المباع ${selectedDoc.soldQty} + البونص ${selectedDoc.bonusQty})`,
                            selectedDoc.soldQty,
                          );
                          if (!qty) return;
                          const reason =
                            window.prompt('سبب المرتجع (يُطبع على المستند ويُسجَّل في التدقيق)') ?? '';
                          void submitReturn(selectedDoc.id, qty, reason);
                        }}
                      >
                        مرتجع عميل
                      </button>
                    ) : null}
                  </div>
                )}
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                النسخة الأولى للعميل، والثانية للمندوب يعيدها موقّعة من العميل إلى المحاسب. النسختان تُقرأان
                من الفاتورة الرسمية نفسها (بيانات المنشأة من ملف المنشأة، ورقم الفاتورة الرسمية، وتاريخ ووقت
                الطباعة مستقل عن تاريخ البيع) — ولا يُنشأ مستند محاسبي ثانٍ.
              </p>

              {selectedDoc ? (
                <div
                  style={{
                    border: '1px dashed var(--line-strong)',
                    borderRadius: 12,
                    padding: 14,
                    display: 'grid',
                    gap: 6,
                    fontSize: 13,
                  }}
                >
                  <div style={{ textAlign: 'center', fontWeight: 700 }}>
                    {selectedDoc.invoiceMode === 'zatca_tax'
                      ? 'فاتورة ضريبية مبسطة (ZATCA)'
                      : 'إيصال تسليم بضاعة (داخلي)'}
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      رقم المستند: <strong dir="ltr">{selectedDoc.number}</strong>
                    </span>
                    <span>
                      الدفعة: <strong dir="ltr">{selectedDoc.productionBatchNo}</strong>
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      العميل: <strong>{selectedDoc.customerName}</strong>
                    </span>
                    <span>
                      المندوب: <strong>{selectedDoc.salesmanName}</strong>
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      المباع:{' '}
                      <strong dir="ltr">
                        {selectedDoc.soldQty} kg × {selectedDoc.unitPrice}
                      </strong>
                    </span>
                    <span>
                      البونص: <strong dir="ltr">{selectedDoc.bonusQty} kg</strong>
                    </span>
                  </div>
                  <div className="row" style={{ justifyContent: 'space-between' }}>
                    <span>
                      الإجمالي: <strong dir="ltr">{selectedDoc.total} SAR</strong>
                    </span>
                    <span>
                      صافي ربح الفاتورة:{' '}
                      <strong dir="ltr" style={{ color: 'var(--ok)' }}>
                        {selectedDoc.netProfit} SAR
                      </strong>
                    </span>
                  </div>
                  <div style={{ display: 'grid', placeItems: 'center', marginTop: 6 }}>
                    <ZatcaQrSvg size={128} payload={selectedDoc.qrPayload ?? ''} />
                  </div>
                </div>
              ) : (
                <p className="muted">اختر فاتورة أو أصدر فاتورة جديدة لمعاينتها وطباعتها.</p>
              )}

              {/**
               * قصّان اثنان يُعلان معًا: هذه القائمةُ تعرض **أول ١٢** صفًّا (`slice(0, 12)`)
               * من نافذة الخادم (أحدث ١٢٠ مستندًا) — فالجملةُ تقول العددَين معًا كي لا يُقرأ
               * الاثنا عشرَ كأنّها مستنداتُ المنشأة.
               */}
              <div className="muted small">
                يُعرض هنا أول ١٢ مستندًا للاختيار — و
                {windowNote(data?.windows, 'documents', DOCUMENTS_WINDOW_FALLBACK, {
                  totalsClause: DASHBOARD_TOTALS_CLAUSE,
                })}
              </div>
              <Table
                bare
                columns={[
                  {
                    key: 'number',
                    header: 'الرقم',
                    ltr: true,
                    cell: (d) => <strong>{d.number}</strong>,
                  },
                  { key: 'customer', header: 'العميل', cell: (d) => d.customerName },
                  {
                    key: 'qty',
                    header: 'المباع / البونص',
                    ltr: true,
                    cell: (d) => `${d.soldQty} + ${d.bonusQty} kg`,
                  },
                  { key: 'total', header: 'الإجمالي', ltr: true, cell: (d) => d.total },
                  { key: 'paid', header: 'المدفوع', ltr: true, cell: (d) => d.paidAmount },
                  {
                    key: 'collect',
                    header: 'تحصيل',
                    cell: (d) => {
                      const unpaid = Math.max(0, Number(d.total) - Number(d.paidAmount));
                      return unpaid > 0.01 ? (
                        <button
                          type="button"
                          className="btn sm primary"
                          onClick={(ev) => {
                            ev.stopPropagation();
                            void handleCollectDebt(d);
                          }}
                        >
                          تحصيل ({unpaid.toFixed(2)})
                        </button>
                      ) : (
                        <span className="badge ok">مسددة</span>
                      );
                    },
                  },
                ]}
                rows={(data?.documents ?? []).slice(0, 12)}
                rowKey={(d) => d.id}
                onRowClick={(d) => setSelectedDoc(d)}
              />
            </Panel>
          </aside>
        </div>
      )}

      {/* TAB 5: CUSTOMER PRICE TIERS, LOCKING & CREDIT LIMITS (Pillar 4 & 5) */}
      {tab === 'prices' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <form onSubmit={submitCustomerTier} style={{ display: 'grid', gap: 12 }}>
            <Panel title="تخصيص وتثبيت سعر العميل (6 / 6.5 / 7 ريال) وسقف الائتمان والبونص">
              <div className="form-grid">
                <label className="field">
                  <span>العميل *</span>
                  <select
                    className="input"
                    required
                    value={tierPartyId}
                    onChange={(e) => setTierPartyId(e.target.value)}
                  >
                    <option value="">— اختر العميل —</option>
                    {customers.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>سعر الكيلو المخصص (ريال) *</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    required
                    dir="ltr"
                    value={tierUnitPrice}
                    onChange={(e) => setTierUnitPrice(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>وصف الشريحة</span>
                  <input className="input" value={tierLabel} onChange={(e) => setTierLabel(e.target.value)} />
                </label>
                <label className="field">
                  <span>سقف الائتمان الآجل (SAR)</span>
                  <input
                    className="input"
                    type="number"
                    step="1"
                    dir="ltr"
                    value={tierCreditLimit}
                    onChange={(e) => setTierCreditLimit(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>مهلة السداد (أيام)</span>
                  <input
                    className="input"
                    type="number"
                    dir="ltr"
                    value={tierPaymentTerms}
                    onChange={(e) => setTierPaymentTerms(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>أقصى خصم مسموح للمندوب (%)</span>
                  <input
                    className="input"
                    type="number"
                    step="0.5"
                    dir="ltr"
                    value={tierMaxDiscountPct}
                    onChange={(e) => setTierMaxDiscountPct(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>أقصى نسبة بونص مجاني (%)</span>
                  <input
                    className="input"
                    type="number"
                    step="0.5"
                    dir="ltr"
                    value={tierMaxBonusPct}
                    onChange={(e) => setTierMaxBonusPct(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>أقصى بونص في الفاتورة (كجم)</span>
                  <input
                    className="input"
                    type="number"
                    step="0.1"
                    dir="ltr"
                    value={tierMaxBonusKg}
                    onChange={(e) => setTierMaxBonusKg(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>نوع الفاتورة المفضل للعميل</span>
                  <select
                    className="input"
                    value={tierPreferredMode}
                    onChange={(e) =>
                      setTierPreferredMode(e.target.value as 'zatca_tax' | 'internal_delivery')
                    }
                  >
                    <option value="zatca_tax">فاتورة ضريبية إلكترونية ZATCA</option>
                    <option value="internal_delivery">فاتورة توزيع عادية (بدون ضريبية ورقية)</option>
                  </select>
                </label>
                <label className="field">
                  <span>سبب اعتماد / تعديل السعر (لسجل التدقيق)</span>
                  <input
                    className="input"
                    value={tierChangeReason}
                    onChange={(e) => setTierChangeReason(e.target.value)}
                  />
                </label>
              </div>
              <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={tierLockPrice}
                  onChange={(e) => setTierLockPrice(e.target.checked)}
                />
                <span>تثبيت السعر تلقائياً عند البيع ومنع المندوب من تغييره أو البيع بسعر أقل</span>
              </label>
              <div>
                <button type="submit" className="btn primary" disabled={busy}>
                  حفظ سياسة العميل السعرية والائتمانية
                </button>
              </div>
            </Panel>
          </form>

          <Panel title="قائمة أسعار وسياسات العملاء المعتمدة" flush>
            <Table
              bare
              columns={[
                {
                  key: 'c0',
                  header: 'العميل',
                  cell: (cp) => (
                    <>
                      <strong>{cp.partyName}</strong>
                    </>
                  ),
                },
                {
                  key: 'c1',
                  header: 'الشريحة',
                  cell: (cp) => cp.priceTierLabel,
                },
                {
                  key: 'c2',
                  header: 'سعر الكيلو',
                  ltr: true,
                  cell: (cp) => (
                    <>
                      <strong>{cp.unitPrice} SAR</strong>
                    </>
                  ),
                },
                {
                  key: 'c3',
                  header: 'تثبيت السعر',
                  cell: (cp) => (cp.lockPrice ? <span className="badge ok">مثبّت</span> : 'مرن'),
                },
                {
                  key: 'c4',
                  header: 'سقف الائتمان',
                  ltr: true,
                  cell: (cp) => (
                    <>
                      {cp.creditLimit} SAR ({cp.paymentTermsDays} يوم)
                    </>
                  ),
                },
                {
                  key: 'c5',
                  header: 'أقصى بونص',
                  ltr: true,
                  cell: (cp) => (
                    <>
                      {cp.maxBonusKgPerInvoice} kg ({cp.maxBonusPct}%)
                    </>
                  ),
                },
                {
                  key: 'c6',
                  header: 'أقصى خصم',
                  ltr: true,
                  cell: (cp) => <>{cp.maxDiscountPct}%</>,
                },
                {
                  key: 'c7',
                  header: 'نوع الفاتورة',
                  cell: (cp) => (cp.preferredInvoiceMode === 'zatca_tax' ? 'ضريبية ZATCA' : 'توزيع عادية'),
                },
              ]}
              rows={data?.customerPrices ?? []}
              rowKey={(cp) => cp.id}
            />
          </Panel>

          <Panel title="سجل تدقيق وتاريخ تعديلات أسعار العملاء" flush>
            <div className="muted small">
              {windowNote(data?.windows, 'customerPriceHistory', PRICE_HISTORY_WINDOW_FALLBACK, {
                totalsClause: DASHBOARD_TOTALS_CLAUSE,
              })}
            </div>
            <Table
              bare
              columns={[
                {
                  key: 'c0',
                  header: 'السعر السابق',
                  ltr: true,
                  cell: (h) => (h.previousUnitPrice ? `${h.previousUnitPrice} SAR` : '—'),
                },
                {
                  key: 'c1',
                  header: 'السعر الجديد',
                  ltr: true,
                  cell: (h) => (
                    <>
                      <strong>{h.newUnitPrice} SAR</strong>
                    </>
                  ),
                },
                {
                  key: 'c2',
                  header: 'بداية السريان',
                  ltr: true,
                  cell: (h) => h.effectiveFrom,
                },
                {
                  key: 'c3',
                  header: 'تثبيت السعر',
                  cell: (h) => (h.lockPrice ? 'مثبّت' : 'مرن'),
                },
                {
                  key: 'c4',
                  header: 'سبب التعديل',
                  cell: (h) => h.changeReason || '—',
                },
                {
                  key: 'c5',
                  header: 'تاريخ التسجيل',
                  ltr: true,
                  cell: (h) => new Date(h.changedAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
                },
              ]}
              rows={data?.customerPriceHistory ?? []}
              rowKey={(h) => h.id}
            />
          </Panel>
        </div>
      )}

      {/* TAB 6: BONUS RADAR & ROLE PERMISSIONS MATRIX (Pillar 3 & 10) */}
      {tab === 'audit' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <Panel
            title="فحص توافق البيانات السابقة وربطها بالنواة (Dry-Run)"
            actions={
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void handleRunLegacyPreview()}
              >
                تشغيل فحص التوافق الآمن (Dry-Run)
              </button>
            }
          >
            {reconciliationPreview ? (
              <div className="form-grid">
                <div>
                  <strong>دفعات الإنتاج:</strong> الإجمالي {reconciliationPreview.batches.total} (مرتبط
                  بالنواة: {reconciliationPreview.batches.linkedToCore} | غير مرتبط:{' '}
                  {reconciliationPreview.batches.unlinkedLegacy})
                </div>
                <div>
                  <strong>أوامر التحميل:</strong> الإجمالي {reconciliationPreview.loadOrders.total} (مرتبط
                  بتحويل مخزني: {reconciliationPreview.loadOrders.linkedToTransfer} | غير مرتبط:{' '}
                  {reconciliationPreview.loadOrders.unlinkedLegacy})
                </div>
                <div>
                  <strong>فواتير المناديب:</strong> الإجمالي {reconciliationPreview.documents.total} (مرتبط بـ
                  sales_invoices: {reconciliationPreview.documents.linkedToSalesInvoice} | غير مرتبط:{' '}
                  {reconciliationPreview.documents.unlinkedLegacy})
                </div>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                يعرض هذا الفحص حالة ربط السجلات السابقة بجداول النواة الرسمية (`sales_invoices`,
                `stock_transfers`, `inventory_transactions`) في وضع المعاينة الآمنة دون أي تعديل على قاعدة
                البيانات.
              </p>
            )}
          </Panel>

          <Panel title="رادار الرقابة على الكميات المجانية (البونص) والعينات والخصومات" flush>
            <Table
              bare
              columns={[
                {
                  key: 'c0',
                  header: 'رقم الفاتورة',
                  ltr: true,
                  cell: (d) => (
                    <>
                      <strong>{d.number}</strong>
                    </>
                  ),
                },
                {
                  key: 'c1',
                  header: 'المندوب',
                  cell: (d) => d.salesmanName,
                },
                {
                  key: 'c2',
                  header: 'العميل',
                  cell: (d) => d.customerName,
                },
                {
                  key: 'c3',
                  header: 'المباع',
                  ltr: true,
                  cell: (d) => <>{d.soldQty} kg</>,
                },
                {
                  key: 'c4',
                  header: 'البونص المجاني',
                  ltr: true,
                  cell: (d) => <>{d.bonusQty} kg</>,
                },
                {
                  key: 'c5',
                  header: 'سبب البونص',
                  cell: (d) => d.bonusReason || '—',
                },
                {
                  key: 'c6',
                  header: 'الخصم',
                  ltr: true,
                  cell: (d) => <>{d.discountAmount} SAR</>,
                },
                {
                  key: 'c7',
                  header: 'تأكيد العميل',
                  cell: (d) => (d.customerBonusConfirmed ? 'مؤكد' : 'غير مؤكد'),
                },
                {
                  key: 'c8',
                  header: 'التنبيه الرقابي',
                  cell: (d) =>
                    d.bonusAnomaly ? (
                      <span className="badge danger">{d.anomalyReason || 'تجاوز سقف البونص'}</span>
                    ) : (
                      <span className="badge ok">ضمن السياسة المعتمدة</span>
                    ),
                },
              ]}
              rows={(data?.documents ?? []).filter(
                (d) => Number(d.bonusQty) > 0 || Number(d.discountAmount) > 0 || d.bonusAnomaly,
              )}
              rowKey={(d) => d.id}
            />
          </Panel>

          <Panel title="مصفوفة الصلاحيات والأمان للأدوار الأربعة في المصنع" flush>
            <Table
              bare
              columns={[
                { key: 'role', header: 'الدور الوظيفي', cell: (row) => row.role },
                { key: 'production', header: 'صلاحيات الإنتاج والمستودع', cell: (row) => row.production },
                {
                  key: 'pricing',
                  header: 'صلاحيات الأسعار والخصومات والبونص',
                  cell: (row) => row.pricing,
                },
                {
                  key: 'closing',
                  header: 'صلاحيات إغلاق الوردية والتالف والعجز',
                  cell: (row) => row.closing,
                },
              ]}
              rows={ROLE_MATRIX}
              rowKey={(_, index) => String(index)}
            />
          </Panel>
        </div>
      )}
    </Screen>
  );
}
