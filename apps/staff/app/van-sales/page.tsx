'use client';

import { useEffect, useState } from 'react';

import { Notice } from '../../components/data-view';
import { Screen } from '../../components/screen';
import { ZatcaQrSvg, buildZatcaTlvBase64, printThermalReceipt80mm } from '../../components/zatca-qr-svg';
import { ApiError, apiData, apiPost } from '../../lib/api';
import { listItems, listParties, listSalesmen, type Item, type Party, type Salesman } from '../../lib/lookups';

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
  soldQty: string;
  bonusQty: string;
  returnedQty: string;
  damagedQty: string;
  shortageQty: string;
  shortageValue: string;
  remainingQty: string;
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

type DashboardData = {
  policy?: {
    internalDeliveryEnabled: boolean;
    internalDeliveryTaxMode: string;
    shortageValuationBasis: string;
    productionCostBasis: string;
    bonusAccountingMode: string;
    defaultVatRatePct: string;
  };
  summary: {
    totalProducedKg: string;
    totalScrapKg?: string;
    mainWarehouseBalanceKg: string;
    totalProductionCostSar: string;
    totalLoadedKg: string;
    totalSoldKg: string;
    totalBonusKg: string;
    totalReturnedKg: string;
    totalDamagedKg: string;
    totalShortageKg: string;
    totalShortageSar: string;
    remainingInVansKg: string;
    totalZatcaSalesSar: string;
    totalInternalSalesSar: string;
    totalRevenueSar: string;
    totalCollectedCashSar: string;
    totalCreditReceivablesSar: string;
    totalNetProfitSar: string;
    anomalyCount: number;
    pendingClosingsCount: number;
  };
  productionBatches: ProductionBatch[];
  repPerformance: RepPerformance[];
  loadOrders: LoadOrder[];
  customerPrices: CustomerPrice[];
  customerPriceHistory?: CustomerPriceHistoryItem[];
  documents: VanDocument[];
  movements: StockMovement[];
};

const MOVEMENT_TYPE_AR: Record<string, string> = {
  production_in: '🏭 إنتاج يومي للمستودع الرئيسي',
  van_load: '🚚 صرف وتحميل عهدة مندوب',
  van_sale: '🧾 بيع فعلي لعميل',
  van_bonus: '🎁 كمية مجانية / عينات',
  van_return: '↩️ إرجاع سليم للمستودع',
  van_damage: '⚠️ تالف مفحوص ومعتمد',
  van_shortage: '🔴 عجز عهدة مخصوم من راتب المندوب',
  stocktake_adjustment: '📋 تسوية جرد فعلي',
  collection_receipt: '💵 سند قبض وتحصيل مديونية',
};

const LOAD_STATUS_AR: Record<string, string> = {
  draft: 'مسودة',
  loaded: 'محمّل في السيارة',
  in_route: 'قيد التوزيع اليومي',
  pending_closing: '⏳ معلق بانتظار فحص التالف واعتماد المحاسب',
  settled: '✅ معتمد ومُصفّى (رصيد العهدة = 0)',
  canceled: 'ملغى',
};

const BONUS_REASONS = [
  'بونص ترويجي متفق عليه مع العميل',
  'عينات مجانية لتجربة صنف جديد',
  'تعويض تلف سابق معتمد',
  'عرض كميات خاص بالموسم / رمضان',
];

type TabKey = 'owner' | 'production' | 'loads' | 'invoice' | 'prices' | 'audit';

export default function VanSalesPage() {
  const [tab, setTab] = useState<TabKey>('owner');
  const [data, setData] = useState<DashboardData | null>(null);
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'warn'; text: string }>();
  const [busy, setBusy] = useState(false);

  // Pillar 1: Production batch form state
  const [prodItemName, setProdItemName] = useState('رقائق سمبوسة بلدي طازجة (كجم)');
  const [prodItemId, setProdItemId] = useState('');
  const [prodQty, setProdQty] = useState('500');
  const [prodScrapQty, setProdScrapQty] = useState('0');
  const [prodUnitCost, setProdUnitCost] = useState('3.80');
  const [prodSupervisor, setProdSupervisor] = useState('مشرف خط الإنتاج');
  const [reconciliationPreview, setReconciliationPreview] = useState<LegacyReconciliationPreview | null>(null);

  // Pillar 2: Load order form state (default 150 kg per client proposal example)
  const [loadSalesmanId, setLoadSalesmanId] = useState('');
  const [loadItemId, setLoadItemId] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('أ ب ج 4521');
  const [productionBatchNo, setProductionBatchNo] = useState('');
  const [loadedQty, setLoadedQty] = useState('150');
  const [maxBonusQty, setMaxBonusQty] = useState('20');
  const maxBonusPct = '20';

  // Pillar 2: Shift Closing & Accountant Approval Modal State
  const [closingTarget, setClosingTarget] = useState<LoadOrder | null>(null);
  const [closingReturnedQty, setClosingReturnedQty] = useState('0');
  const [closingDamagedQty, setClosingDamagedQty] = useState('25');
  const [closingDamageReason, setClosingDamageReason] = useState('تلف أثناء النقل والحرارة — جاهز للفحص الفعلي');
  const [closingCollectedCash, setClosingCollectedCash] = useState('0');
  const [closingNotes, setClosingNotes] = useState('');
  const [closingDamageInspected, setClosingDamageInspected] = useState(true);
  const [closingSalaryDeduction, setClosingSalaryDeduction] = useState(true);

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
    const [smRes, custRes, itRes] = await Promise.allSettled([
      listSalesmen(),
      listParties('customer'),
      listItems(),
    ]);
    const sm = smRes.status === 'fulfilled' ? smRes.value : [];
    const cust = custRes.status === 'fulfilled' ? custRes.value : [];
    const it = itRes.status === 'fulfilled' ? itRes.value : [];
    setData(dash);
    setSalesmen(sm);
    setCustomers(cust);
    setItems(it);
    if (!loadSalesmanId && sm[0]?.id) setLoadSalesmanId(sm[0].id);
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
    if (initialTab && ['owner', 'production', 'loads', 'invoice', 'prices', 'audit'].includes(initialTab)) {
      setTab(initialTab);
    }
    void reload().catch((error: unknown) =>
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر تحميل بيانات المصنع والتوزيع' }),
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
      const next = await apiPost<DashboardData>('/van-sales/production-batches', {
        itemId: prodItemId || undefined,
        itemName: prodItemName,
        producedQty: prodQty,
        scrapQty: prodScrapQty || '0',
        unitCost: prodUnitCost,
        supervisorName: prodSupervisor,
      });
      setData(next);
      const newestBatch = next.productionBatches[0];
      if (newestBatch) setProductionBatchNo(newestBatch.batchNo);
      setNotice({
        kind: 'ok',
        text: `تم تسجيل دفعة الإنتاج اليومية (${newestBatch?.batchNo ?? ''}) بكمية ${prodQty} كجم وتوريدها للمستودع الرئيسي.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر تسجيل دفعة الإنتاج' });
    } finally {
      setBusy(false);
    }
  }

  async function submitLoadOrder(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>('/van-sales/load-orders', {
        salesmanId: loadSalesmanId,
        itemId: loadItemId || undefined,
        vehiclePlate,
        productionBatchNo: productionBatchNo || undefined,
        loadedQty,
        maxBonusQty,
        maxBonusPct,
      });
      setData(next);
      const newestLoad = next.loadOrders[0];
      if (newestLoad) setDocLoadOrderId(newestLoad.id);
      setNotice({
        kind: 'ok',
        text: `تم صرف وتحميل عهدة المندوب رقم ${newestLoad?.number ?? ''} من دفعة الإنتاج (${newestLoad?.productionBatchNo ?? ''}) بكمية ${loadedQty} كجم.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر إنشاء أمر التحميل' });
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
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر حفظ شريحة السعر' });
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
        text: error instanceof ApiError ? error.message : 'تعذر تنفيذ فحص توافق البيانات السابقة',
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
      const next = await apiPost<DashboardData>('/van-sales/documents', {
        loadOrderId: docLoadOrderId,
        partyId: docPartyId || undefined,
        customerName: docPartyId ? undefined : docWalkinName.trim() || 'محل تجزئة نقدي',
        invoiceMode: docMode,
        paymentMethod: docPayment,
        soldQty: docSoldQty,
        bonusQty: docBonusQty || '0',
        bonusReason: Number(docBonusQty || 0) > 0 ? docBonusReason : undefined,
        unitPrice: docUnitPrice,
        discountAmount: docDiscountAmount || '0',
        discountReason: docDiscountReason.trim() || undefined,
        allowPriceDiscountOverride: docAllowOverride,
        customerBonusConfirmed: docBonusConfirmed,
        customerConfirmationCode: docConfirmCode.trim() || undefined,
      });
      setData(next);
      const newestDoc = next.documents[0] ?? null;
      setSelectedDoc(newestDoc);
      setNotice({
        kind: 'ok',
        text: `تم إصدار ${newestDoc?.invoiceMode === 'zatca_tax' ? 'فاتورة ضريبية إلكترونية (ZATCA)' : 'فاتورة توزيع عادية محفوظة محاسبياً'} رقم ${newestDoc?.number ?? ''} وخصم الكمية من عهدة المندوب.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر إصدار المستند' });
    } finally {
      setBusy(false);
    }
  }

  function openClosingModal(load: LoadOrder) {
    setClosingTarget(load);
    setClosingReturnedQty(load.returnedQty && Number(load.returnedQty) > 0 ? load.returnedQty : '0');
    setClosingDamagedQty(load.damagedQty && Number(load.damagedQty) > 0 ? load.damagedQty : '25');
    setClosingDamageReason(load.damageReason || 'تلف أثناء النقل والحرارة — جاهز للفحص الفعلي');
    setClosingCollectedCash(Number(load.collectedCash) > 0 ? load.collectedCash : load.expectedCash);
    setClosingNotes(load.closingNotes || '');
    setClosingDamageInspected(true);
    setClosingSalaryDeduction(true);
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
        closingNotes,
      });
      setData(next);
      const updated = next.loadOrders.find((l) => l.id === closingTarget.id) ?? null;
      setClosingTarget(updated);
      setNotice({
        kind: 'warn',
        text: `⏳ تم تقديم طلب إغلاق الوردية (${closingTarget.number}) وحساب العجز تلقائياً، وباتت الحالة «معلق بانتظار فحص التالف واعتماد المحاسب».`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر تقديم إغلاق الوردية' });
    } finally {
      setBusy(false);
    }
  }

  async function handleAccountantApproveClosing() {
    if (!closingTarget) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>(`/van-sales/load-orders/${closingTarget.id}/approve-closing`, {
        returnedQty: closingReturnedQty,
        damagedQty: closingDamagedQty,
        collectedCash: closingCollectedCash,
        damageInspected: closingDamageInspected,
        salaryDeductionApproved: closingSalaryDeduction,
        notes: closingNotes,
      });
      setData(next);
      setClosingTarget(null);
      setNotice({
        kind: 'ok',
        text: `✅ تم اعتماد المحاسب النهائي لإغلاق الوردية (${closingTarget.number})، تأكيد فحص التالف، تصفير عهدة المندوب (0.00 كجم)، وقيد العجز خصماً على راتب المندوب.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر اعتماد إغلاق الوردية' });
    } finally {
      setBusy(false);
    }
  }

  async function handleCollectDebt(doc: VanDocument) {
    const unpaid = Math.max(0, Number(doc.total) - Number(doc.paidAmount)).toFixed(2);
    const input = window.prompt(`أدخل المبلغ المحصّل من العميل (${doc.customerName}) للفاتورة ${doc.number}:`, unpaid);
    if (!input) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>('/van-sales/collections', {
        documentId: doc.id,
        collectedAmount: input,
        notes: 'تحصيل مديونية عميل توزيع',
      });
      setData(next);
      setNotice({ kind: 'ok', text: `تم تسجيل سند قبض بمبلغ ${input} ريال للفاتورة ${doc.number}.` });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر تسجيل التحصيل' });
    } finally {
      setBusy(false);
    }
  }

  const activeLoadOrder = data?.loadOrders.find((l) => l.id === docLoadOrderId);
  const selectedCustomerRule = data?.customerPrices.find((cp) => cp.partyId === docPartyId);
  const configuredVatFactor = Number(data?.policy?.defaultVatRatePct ?? 15) / 100;
  const previewGross = Number(docSoldQty || 0) * Number(docUnitPrice || 0);
  const previewDiscount = Number(docDiscountAmount || 0);
  const previewSubtotal = Math.max(0, previewGross - previewDiscount);
  const previewVat = docMode === 'zatca_tax' ? previewSubtotal * configuredVatFactor : 0;
  const previewTotal = previewSubtotal + previewVat;

  // Live calculation inside the Shift Closing Modal (e.g. 150 loaded - 100 sold - 20 bonus - 0 returned - 25 damaged = 5 kg shortage)
  const modalLoaded = Number(closingTarget?.loadedQty ?? 0);
  const modalSold = Number(closingTarget?.soldQty ?? 0);
  const modalBonus = Number(closingTarget?.bonusQty ?? 0);
  const modalReturned = Number(closingReturnedQty || 0);
  const modalDamaged = Number(closingDamagedQty || 0);
  const modalShortageKg = Math.max(0, modalLoaded - (modalSold + modalBonus + modalReturned + modalDamaged));
  const targetShortageUnitRate =
    closingTarget && Number(closingTarget.shortageQty) > 0
      ? Number(closingTarget.shortageValue) / Number(closingTarget.shortageQty)
      : Number(data?.customerPrices?.[0]?.unitPrice ?? docUnitPrice ?? 0);
  const modalShortageSar = modalShortageKg * targetShortageUnitRate;

  return (
    <Screen
      title="🏭 نظام المصنع والمخابز ومناديب التوزيع المتكامل"
      subtitle="الحل الشامل لإدارة الإنتاج اليومي، المستودع الرئيسي، عهد المناديب، إغلاق الوردية المعلق لاعتماد المحاسب وفحص التالف وخصم العجز من الراتب، ضبط الأسعار والبونص، والفوترة الإلكترونية ZATCA."
      crumbs={['توزيع المناديب والمخابز']}
    >
      {notice ? <Notice notice={notice} /> : null}

      {/* Navigation Tabs for the 10-Pillar System */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={tab === 'owner' ? 'btn primary' : 'btn'}
          onClick={() => setTab('owner')}
        >
          📊 1. لوحة صاحب المصنع والملخص التنفيذي
        </button>
        <button
          type="button"
          className={tab === 'production' ? 'btn primary' : 'btn'}
          onClick={() => setTab('production')}
        >
          🏭 2. الإنتاج اليومي والمستودع وحركة البضاعة ({data?.productionBatches.length ?? 0})
        </button>
        <button
          type="button"
          className={tab === 'loads' ? 'btn primary' : 'btn'}
          onClick={() => setTab('loads')}
        >
          🚚 3. عهد المناديب وإغلاق الوردية واعتماد المحاسب ({data?.loadOrders.length ?? 0})
        </button>
        <button
          type="button"
          className={tab === 'invoice' ? 'btn primary' : 'btn'}
          onClick={() => setTab('invoice')}
        >
          🧾 4. فواتير التوزيع (ZATCA / عادية) والتحصيل ({data?.documents.length ?? 0})
        </button>
        <button
          type="button"
          className={tab === 'prices' ? 'btn primary' : 'btn'}
          onClick={() => setTab('prices')}
        >
          💰 5. ضبط أسعار العملاء والائتمان والبونص ({data?.customerPrices.length ?? 0})
        </button>
        <button
          type="button"
          className={tab === 'audit' ? 'btn primary' : 'btn'}
          onClick={() => setTab('audit')}
        >
          🛡️ 6. رادار البونص والصلاحيات والأمان
        </button>
      </div>

      {/* Pending Shift Closings Alert Banner */}
      {(data?.summary.pendingClosingsCount ?? 0) > 0 && (
        <div
          className="card"
          style={{
            border: '2px solid var(--warn)',
            background: 'var(--warn-soft, var(--surface-2))',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div>
            <strong>
              ⏳ يوجد ({data?.summary.pendingClosingsCount}) طلب إغلاق وردية مندوب معلق بانتظار فحص التالف واعتماد المحاسب!
            </strong>
            <div className="muted small">
              لا يتم تصفير عهدة المندوب أو قيد التالف والعجز على راتب المندوب إلا بعد مراجعة المحاسب والاعتماد النهائي.
            </div>
          </div>
          <button type="button" className="btn primary" onClick={() => setTab('loads')}>
            مراجعة واعتماد إغلاقات الورديات الآن ←
          </button>
        </div>
      )}

      {/* TAB 1: FACTORY OWNER DASHBOARD (Pillar 9) */}
      {tab === 'owner' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(185px, 1fr))', gap: 10 }}>
            <div className="card">
              <div className="muted small">إجمالي الإنتاج اليومي</div>
              <strong style={{ fontSize: 21 }} dir="ltr">{data?.summary.totalProducedKg ?? '0.00'} kg</strong>
              <div className="muted small">رصيد المستودع: {data?.summary.mainWarehouseBalanceKg ?? '0.00'} kg</div>
            </div>
            <div className="card">
              <div className="muted small">إجمالي المسلم لعهد المناديب</div>
              <strong style={{ fontSize: 21 }} dir="ltr">{data?.summary.totalLoadedKg ?? '0.00'} kg</strong>
              <div className="muted small">متبقي بالعهد: {data?.summary.remainingInVansKg ?? '0.00'} kg</div>
            </div>
            <div className="card">
              <div className="muted small">المباع الفعلي + البونص</div>
              <strong style={{ fontSize: 21, color: 'var(--ok)' }} dir="ltr">
                {data?.summary.totalSoldKg ?? '0.00'} kg
              </strong>
              <div className="muted small" style={{ color: 'var(--warn)' }}>
                بونص وعينات: {data?.summary.totalBonusKg ?? '0.00'} kg
              </div>
            </div>
            <div className="card">
              <div className="muted small">التالف المفحوص + العجز</div>
              <strong style={{ fontSize: 21, color: 'var(--danger)' }} dir="ltr">
                عجز: {data?.summary.totalShortageKg ?? '0.00'} kg
              </strong>
              <div className="muted small">
                تالف: {data?.summary.totalDamagedKg ?? '0.00'} kg · خصم رواتب: {data?.summary.totalShortageSar ?? '0.00'} SAR
              </div>
            </div>
            <div className="card">
              <div className="muted small">إجمالي المبيعات (ZATCA + عادية)</div>
              <strong style={{ fontSize: 21, color: 'var(--brand)' }} dir="ltr">
                {data?.summary.totalRevenueSar ?? '0.00'} SAR
              </strong>
              <div className="muted small">
                ضريبية: {data?.summary.totalZatcaSalesSar ?? '0.00'} · عادية: {data?.summary.totalInternalSalesSar ?? '0.00'}
              </div>
            </div>
            <div className="card">
              <div className="muted small">التحصيل والمديونيات وصافي الربح</div>
              <strong style={{ fontSize: 21, color: 'var(--ok)' }} dir="ltr">
                ربح: {data?.summary.totalNetProfitSar ?? '0.00'} SAR
              </strong>
              <div className="muted small">
                محصّل: {data?.summary.totalCollectedCashSar ?? '0.00'} · آجل: {data?.summary.totalCreditReceivablesSar ?? '0.00'}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div>
                <h2 style={{ margin: 0 }}>👨‍✈️ ملخص رقابة المناديب والعهد والربحية والعجز المخصوم من الراتب</h2>
                <p className="muted small" style={{ margin: 0 }}>
                  مقارنة شاملة لكل مندوب: المستلم، المباع، البونص، التالف، العجز المحسوب على المندوب، التحصيل، المديونيات، وصافي الربح.
                </p>
              </div>
              <button type="button" className="btn sm primary" onClick={() => setTab('loads')}>
                ➕ تحميل عهدة / إغلاق وردية
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>المندوب</th>
                    <th>المستلم (كجم)</th>
                    <th>المباع (كجم)</th>
                    <th>البونص (كجم)</th>
                    <th>مرتجع سليم</th>
                    <th>تالف مفحوص</th>
                    <th>عجز على المندوب</th>
                    <th>خصم الراتب (SAR)</th>
                    <th>العهدة المتبقية</th>
                    <th>المبيعات (SAR)</th>
                    <th>المحصّل</th>
                    <th>مديونية العملاء</th>
                    <th>صافي الربح</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.repPerformance ?? []).map((rep) => (
                    <tr key={rep.salesmanId}>
                      <td>
                        <strong>{rep.salesmanName}</strong>
                        {rep.pendingClosings > 0 && (
                          <div>
                            <span className="badge warn">إغلاق معلق ({rep.pendingClosings})</span>
                          </div>
                        )}
                      </td>
                      <td dir="ltr">{rep.loadedKg}</td>
                      <td dir="ltr" style={{ color: 'var(--ok)', fontWeight: 700 }}>{rep.soldKg}</td>
                      <td dir="ltr" style={{ color: 'var(--warn)' }}>{rep.bonusKg}</td>
                      <td dir="ltr">{rep.returnedKg}</td>
                      <td dir="ltr">{rep.damagedKg}</td>
                      <td dir="ltr" style={{ color: Number(rep.shortageKg) > 0 ? 'var(--danger)' : undefined, fontWeight: 700 }}>
                        {rep.shortageKg} kg
                      </td>
                      <td dir="ltr" style={{ color: Number(rep.shortageSar) > 0 ? 'var(--danger)' : undefined, fontWeight: 700 }}>
                        {rep.shortageSar} SAR
                      </td>
                      <td dir="ltr">
                        <span className={`badge ${Number(rep.custodyRemainingKg) === 0 ? 'ok' : 'warn'}`}>
                          {rep.custodyRemainingKg} kg
                        </span>
                      </td>
                      <td dir="ltr"><strong>{rep.revenueSar}</strong></td>
                      <td dir="ltr">{rep.collectedSar}</td>
                      <td dir="ltr" style={{ color: Number(rep.creditDebtSar) > 0 ? 'var(--warn)' : undefined }}>
                        {rep.creditDebtSar}
                      </td>
                      <td dir="ltr" style={{ color: 'var(--ok)', fontWeight: 700 }}>{rep.netProfitSar} SAR</td>
                    </tr>
                  ))}
                  {(data?.repPerformance ?? []).length === 0 && (
                    <tr>
                      <td colSpan={13} className="muted" style={{ textAlign: 'center', padding: 18 }}>
                        لا توجد حركات مناديب بعد — ابدأ بتسجيل دفعة إنتاج أو أمر تحميل للمندوب.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: FACTORY PRODUCTION & GOODS MOVEMENT LEDGER (Pillar 1 & 6) */}
      {tab === 'production' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <form className="card" onSubmit={submitProductionBatch} style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>🏭 تسجيل دفعة إنتاج يومي للمصنع والمخبز وتوريدها للمستودع الرئيسي</h2>
            <p className="muted small" style={{ margin: 0 }}>
              تُقيَّد الكمية المنتجة في المستودع الرئيسي برقم دفعة فريد، ولا يستطيع أي مندوب بيع كمية إلا بعد صرفها رسمياً من هذه الدفعات.
            </p>
            <div className="form-grid">
              <label className="field">
                <span>الصنف المنتج (سمبوسة / فطائر / عجين / خبز)</span>
                <input
                  className="input"
                  required
                  value={prodItemName}
                  onChange={(e) => setProdItemName(e.target.value)}
                />
              </label>
              <label className="field">
                <span>ربط ببطاقة صنف في المخزون (اختياري)</span>
                <select className="input" value={prodItemId} onChange={(e) => setProdItemId(e.target.value)}>
                  <option value="">— تلقائي —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>{it.nameAr}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>الكمية المنتجة اليوم (كجم) *</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  required
                  dir="ltr"
                  value={prodQty}
                  onChange={(e) => setProdQty(e.target.value)}
                />
              </label>
              <label className="field">
                <span>فاقد التصنيع / الهالك (كجم)</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  dir="ltr"
                  value={prodScrapQty}
                  onChange={(e) => setProdScrapQty(e.target.value)}
                />
              </label>
              <label className="field">
                <span>تكلفة إنتاج الكيلو (ريال) *</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  required
                  dir="ltr"
                  value={prodUnitCost}
                  onChange={(e) => setProdUnitCost(e.target.value)}
                />
              </label>
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
                {busy ? 'جارٍ الحفظ…' : '➕ اعتماد دفعة الإنتاج وتوريدها للمستودع الرئيسي'}
              </button>
            </div>
          </form>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>📦 دفعات الإنتاج وأرصدة المستودع الرئيسي</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>رقم دفعة الإنتاج</th>
                    <th>التاريخ</th>
                    <th>الصنف</th>
                    <th>الكمية المنتجة</th>
                    <th>المصروف للمناديب</th>
                    <th>المرتجع السليم</th>
                    <th>التالف المعتمد</th>
                    <th>الرصيد المتاح بالمستودع</th>
                    <th>تكلفة الكيلو</th>
                    <th>إجمالي تكلفة الدفعة</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.productionBatches ?? []).map((b) => (
                    <tr key={b.id}>
                      <td dir="ltr"><strong>{b.batchNo}</strong></td>
                      <td dir="ltr">{b.productionDate}</td>
                      <td>{b.itemName}</td>
                      <td dir="ltr"><strong>{b.producedQty} kg</strong></td>
                      <td dir="ltr">{b.issuedQty} kg</td>
                      <td dir="ltr" style={{ color: 'var(--ok)' }}>{b.returnedGoodQty} kg</td>
                      <td dir="ltr" style={{ color: 'var(--danger)' }}>{b.damagedQty} kg</td>
                      <td dir="ltr">
                        <span className="badge ok">{b.availableWarehouseQty} kg</span>
                      </td>
                      <td dir="ltr">{b.unitCost} SAR</td>
                      <td dir="ltr"><strong>{b.totalCost} SAR</strong></td>
                    </tr>
                  ))}
                  {(data?.productionBatches ?? []).length === 0 && (
                    <tr>
                      <td colSpan={10} className="muted" style={{ textAlign: 'center', padding: 16 }}>
                        لم يتم تسجيل دفعة إنتاج بعد.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>🔍 سجل الرقابة على حركة البضاعة والتدقيق (من نفذ العملية ومن اعتمدها)</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الوقت</th>
                    <th>نوع الحركة</th>
                    <th>دفعة الإنتاج</th>
                    <th>المندوب</th>
                    <th>العميل</th>
                    <th>الكمية (كجم)</th>
                    <th>المبلغ (SAR)</th>
                    <th>البيان والسبب</th>
                    <th>منفّذ العملية</th>
                    <th>المعتمد</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.movements ?? []).map((m) => (
                    <tr key={m.id}>
                      <td dir="ltr" className="small">{new Date(m.createdAt).toLocaleString('ar-SA')}</td>
                      <td><strong>{MOVEMENT_TYPE_AR[m.movementType] ?? m.movementType}</strong></td>
                      <td dir="ltr">{m.batchNo || '—'}</td>
                      <td>{m.salesmanName}</td>
                      <td>{m.customerName}</td>
                      <td dir="ltr">{m.qty} kg</td>
                      <td dir="ltr">{m.amount} SAR</td>
                      <td>{m.reason}</td>
                      <td>{m.actorLabel}</td>
                      <td>{m.approvedByLabel || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: VAN LOAD ORDERS & END-OF-DAY SHIFT CLOSING WORKFLOW (Pillar 2 & 7) */}
      {tab === 'loads' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <form className="card" onSubmit={submitLoadOrder} style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>🚚 صرف أمر تحميل جديد لعهدة مندوب (من المستودع الرئيسي)</h2>
            <p className="muted small" style={{ margin: 0 }}>
              مثال عملي مطابق لآلية المصنع: استلام المندوب <strong>150 كجم</strong> كعهدة صباحية، وفي نهاية اليوم يقدم إغلاق الوردية للمحاسب (مباع + بونص + تالف للفحص + عجز يُخصم من الراتب).
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
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
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
                <select className="input" value={loadItemId} onChange={(e) => setLoadItemId(e.target.value)}>
                  <option value="">رقائق سمبوسة وفطائر (عام)</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>{it.nameAr}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <button type="submit" className="btn primary" disabled={busy}>
                {busy ? 'جارٍ الإصدار…' : '➕ اعتماد أمر التحميل وتسليم العهدة للمندوب'}
              </button>
            </div>
          </form>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>📋 سجل عهد المناديب وإغلاق الورديات واعتماد المحاسب</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>رقم الأمر</th>
                    <th>المندوب</th>
                    <th>دفعة الإنتاج</th>
                    <th>المستلم</th>
                    <th>المباع</th>
                    <th>البونص</th>
                    <th>مرتجع سليم</th>
                    <th>تالف للفحص</th>
                    <th>العجز على المندوب</th>
                    <th>المتبقي بالعهدة</th>
                    <th>النقد المتوقع / المسلم</th>
                    <th>الحالة</th>
                    <th>إجراء الإغلاق والاعتماد</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.loadOrders ?? []).map((l) => (
                    <tr key={l.id}>
                      <td dir="ltr"><strong>{l.number}</strong></td>
                      <td><strong>{l.salesmanName}</strong></td>
                      <td dir="ltr">{l.productionBatchNo}</td>
                      <td dir="ltr"><strong>{l.loadedQty} kg</strong></td>
                      <td dir="ltr" style={{ color: 'var(--ok)', fontWeight: 700 }}>{l.soldQty} kg</td>
                      <td dir="ltr" style={{ color: 'var(--warn)' }}>{l.bonusQty} kg</td>
                      <td dir="ltr">{l.returnedQty} kg</td>
                      <td dir="ltr" style={{ color: Number(l.damagedQty) > 0 ? 'var(--warn)' : undefined }}>
                        {l.damagedQty} kg
                        {l.damageInspected && Number(l.damagedQty) > 0 ? ' (✔ مفحوص)' : ''}
                      </td>
                      <td dir="ltr" style={{ color: Number(l.shortageQty) > 0 ? 'var(--danger)' : undefined, fontWeight: 700 }}>
                        {l.shortageQty} kg
                        {Number(l.shortageValue) > 0 ? ` (${l.shortageValue} SAR)` : ''}
                      </td>
                      <td dir="ltr"><strong>{l.remainingQty} kg</strong></td>
                      <td dir="ltr">{l.expectedCash} / {l.collectedCash} SAR</td>
                      <td>
                        <span
                          className={`badge ${
                            l.status === 'settled'
                              ? 'ok'
                              : l.status === 'pending_closing'
                                ? 'warn'
                                : 'neutral'
                          }`}
                        >
                          {LOAD_STATUS_AR[l.status] ?? l.status}
                        </span>
                      </td>
                      <td>
                        {l.status !== 'settled' ? (
                          <button
                            type="button"
                            className={`btn sm ${l.status === 'pending_closing' ? 'primary' : ''}`}
                            onClick={() => openClosingModal(l)}
                          >
                            {l.status === 'pending_closing'
                              ? '🔍 مراجعة واعتماد المحاسب'
                              : '🔒 إغلاق الوردية وتصفية العهدة'}
                          </button>
                        ) : (
                          <span className="muted small">
                            معتمد {l.approvedByLabel ? `بواسطة ${l.approvedByLabel}` : ''}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

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
              <div className="card" style={{ width: '100%', maxWidth: 680, display: 'grid', gap: 12 }}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ margin: 0 }}>
                    🔒 إغلاق وردية المندوب ({closingTarget.salesmanName}) — أمر رقم {closingTarget.number}
                  </h2>
                  <button type="button" className="btn sm" onClick={() => setClosingTarget(null)}>✕</button>
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
                    <strong style={{ color: 'var(--ok)' }} dir="ltr">{modalSold.toFixed(2)} kg</strong>
                  </div>
                  <div>
                    <div className="muted small">3. البونص المجاني</div>
                    <strong style={{ color: 'var(--warn)' }} dir="ltr">{modalBonus.toFixed(2)} kg</strong>
                  </div>
                  <div>
                    <div className="muted small">4. المرتجع السليم</div>
                    <strong dir="ltr">{modalReturned.toFixed(2)} kg</strong>
                  </div>
                  <div>
                    <div className="muted small">5. التالف (للفحص)</div>
                    <strong style={{ color: 'var(--warn)' }} dir="ltr">{modalDamaged.toFixed(2)} kg</strong>
                  </div>
                  <div>
                    <div className="muted small">6. العجز على المندوب</div>
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
                  <strong>✅ ضوابط اعتماد المحاسب النهائي:</strong>
                  <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={closingDamageInspected}
                      onChange={(e) => setClosingDamageInspected(e.target.checked)}
                    />
                    <span>أقرّ بأن الكمية التالفة ({modalDamaged.toFixed(2)} كجم) تم فحصها فعلياً واستلامها.</span>
                  </label>
                  <label className="row" style={{ gap: 8, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={closingSalaryDeduction}
                      onChange={(e) => setClosingSalaryDeduction(e.target.checked)}
                    />
                    <span>
                      اعتماد قيد العجز ({modalShortageKg.toFixed(2)} كجم = {modalShortageSar.toFixed(2)} ريال) على حساب المندوب وخصمه من راتبه، وتصفير رصيد عهدته إلى (0.00 كجم).
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
                    📤 1. حفظ وتقديم كطلب إغلاق معلق للمحاسب
                  </button>
                  <div className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn" onClick={() => setClosingTarget(null)}>
                      إلغاء
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy}
                      onClick={() => void handleAccountantApproveClosing()}
                    >
                      ✅ 2. اعتماد المحاسب النهائي وتصفير العهدة
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 4: VAN INVOICING (ZATCA TAX vs INTERNAL DELIVERY) & COLLECTION (Pillar 3, 4, 5, 8) */}
      {tab === 'invoice' && (
        <div className="split">
          <form className="card" onSubmit={submitVanDocument} style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>🧾 إصدار فاتورة توزيع (ضريبية ZATCA أو عادية)</h2>
            <p className="muted small" style={{ margin: 0 }}>
              السعر يُجلب ويُثبّت تلقائياً حسب العميل، وتُخصم الكمية مباشرة من عهدة المندوب، مع دعم الفاتورة الضريبية (15% VAT + QR) أو فاتورة تسليم عادية للمحلات التي لا تطلب فاتورة ضريبية ورقية.
            </p>

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
                        {l.number} · {l.salesmanName} (متبقي: {l.remainingQty} كجم — دفعة {l.productionBatchNo})
                      </option>
                    ))}
                </select>
              </label>

              <label className="field">
                <span>العميل (اختياري لمحلات التجزئة)</span>
                <select className="input" value={docPartyId} onChange={(e) => onSelectCustomer(e.target.value)}>
                  <option value="">— محل تجزئة نقدي / عام —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
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
                  <option value="internal_delivery">فاتورة توزيع عادية (لمحل لا يطلب ضريبية ورقية)</option>
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
                <span>
                  سعر الكيلو (ريال) {selectedCustomerRule?.lockPrice ? '🔒 مثبّت للعميل' : ''}
                </span>
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
                      <option key={r} value={r}>{r}</option>
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
                <span>الصافي قبل الضريبة: <strong dir="ltr">{previewSubtotal.toFixed(2)} SAR</strong></span>
                {' · '}
                <span>الضريبة: <strong dir="ltr">{previewVat.toFixed(2)} SAR</strong></span>
                {' · '}
                <span>الإجمالي: <strong dir="ltr" style={{ color: 'var(--brand)' }}>{previewTotal.toFixed(2)} SAR</strong></span>
              </div>
              <button type="submit" className="btn primary" disabled={busy || !activeLoadOrder}>
                {busy ? 'جارٍ الإصدار…' : '🚀 اعتماد الفاتورة وخصم العهدة'}
              </button>
            </div>
          </form>

          {/* 80mm Thermal Receipt Preview with Visual ZATCA QR */}
          <div className="card" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 style={{ margin: 0 }}>🖨️ معاينة إيصال 80mm الحراري والباركود</h3>
              {selectedDoc && (
                <button
                  type="button"
                  className="btn sm primary"
                  onClick={() =>
                    printThermalReceipt80mm({
                      companyName: 'مصنع ومخابز رقائق السمبوسة والفطائر',
                      taxNo: '300000000000003',
                      branchName: `دفعة إنتاج: ${selectedDoc.productionBatchNo}`,
                      invoiceNumber: selectedDoc.number,
                      invoiceTypeLabel:
                        selectedDoc.invoiceMode === 'zatca_tax'
                          ? 'فاتورة ضريبية مبسطة (ZATCA)'
                          : 'إيصال تسليم بضاعة (توزيع)',
                      issuedAt: selectedDoc.createdAt || new Date().toISOString(),
                      customerName: selectedDoc.customerName,
                      cashierName: selectedDoc.salesmanName,
                      paymentMethodLabel:
                        selectedDoc.paymentMethod === 'cash'
                          ? 'نقدي (Cash)'
                          : selectedDoc.paymentMethod === 'card'
                            ? 'شبكة مدى'
                            : 'آجل (Credit)',
                      lines: [
                        {
                          name: `${selectedDoc.itemName} (مباع)`,
                          quantity: selectedDoc.soldQty,
                          unitPrice: selectedDoc.unitPrice,
                          total: selectedDoc.total,
                        },
                        ...(Number(selectedDoc.bonusQty) > 0
                          ? [
                              {
                                name: `🎁 بونص مجاني (${selectedDoc.bonusReason || 'ترويجي'})`,
                                quantity: selectedDoc.bonusQty,
                                unitPrice: '0.00',
                                total: '0.00',
                              },
                            ]
                          : []),
                      ],
                      subtotal: selectedDoc.subtotal,
                      discount: selectedDoc.discountAmount || '0.00',
                      taxTotal: selectedDoc.taxTotal,
                      total: selectedDoc.total,
                      paidAmount: selectedDoc.paidAmount,
                      qrPayload: buildZatcaTlvBase64({
                        sellerName: 'مصنع ومخابز رقائق السمبوسة والفطائر',
                        vatNo: '300000000000003',
                        timestampIso: selectedDoc.createdAt || new Date().toISOString(),
                        total: selectedDoc.total,
                        tax: selectedDoc.taxTotal,
                      }),
                    })
                  }
                >
                  🖨️ طباعة حرارية 80mm
                </button>
              )}
            </div>

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
                  <span>رقم المستند: <strong dir="ltr">{selectedDoc.number}</strong></span>
                  <span>الدفعة: <strong dir="ltr">{selectedDoc.productionBatchNo}</strong></span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>العميل: <strong>{selectedDoc.customerName}</strong></span>
                  <span>المندوب: <strong>{selectedDoc.salesmanName}</strong></span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>المباع: <strong dir="ltr">{selectedDoc.soldQty} kg × {selectedDoc.unitPrice}</strong></span>
                  <span>البونص: <strong dir="ltr">{selectedDoc.bonusQty} kg</strong></span>
                </div>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>الإجمالي: <strong dir="ltr">{selectedDoc.total} SAR</strong></span>
                  <span>صافي ربح الفاتورة: <strong dir="ltr" style={{ color: 'var(--ok)' }}>{selectedDoc.netProfit} SAR</strong></span>
                </div>
                <div style={{ display: 'grid', placeItems: 'center', marginTop: 6 }}>
                  <ZatcaQrSvg
                    size={128}
                    payload={buildZatcaTlvBase64({
                      sellerName: 'مصنع ومخابز رقائق السمبوسة والفطائر',
                      vatNo: '300000000000003',
                      timestampIso: selectedDoc.createdAt || new Date().toISOString(),
                      total: selectedDoc.total,
                      tax: selectedDoc.taxTotal,
                    })}
                  />
                </div>
              </div>
            ) : (
              <p className="muted">اختر فاتورة أو أصدر فاتورة جديدة لمعاينتها وطباعتها.</p>
            )}

            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>العميل</th>
                    <th>المباع / البونص</th>
                    <th>الإجمالي</th>
                    <th>المدفوع</th>
                    <th>تحصيل</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.documents ?? []).slice(0, 12).map((d) => {
                    const unpaid = Math.max(0, Number(d.total) - Number(d.paidAmount));
                    return (
                      <tr
                        key={d.id}
                        onClick={() => setSelectedDoc(d)}
                        style={{ cursor: 'pointer' }}
                      >
                        <td dir="ltr"><strong>{d.number}</strong></td>
                        <td>{d.customerName}</td>
                        <td dir="ltr">{d.soldQty} + {d.bonusQty} kg</td>
                        <td dir="ltr">{d.total}</td>
                        <td dir="ltr">{d.paidAmount}</td>
                        <td>
                          {unpaid > 0.01 ? (
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
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 5: CUSTOMER PRICE TIERS, LOCKING & CREDIT LIMITS (Pillar 4 & 5) */}
      {tab === 'prices' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <form className="card" onSubmit={submitCustomerTier} style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>💰 تخصيص وتثبيت سعر العميل (6 / 6.5 / 7 ريال) وسقف الائتمان والبونص</h2>
            <div className="form-grid">
              <label className="field">
                <span>العميل *</span>
                <select className="input" required value={tierPartyId} onChange={(e) => setTierPartyId(e.target.value)}>
                  <option value="">— اختر العميل —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
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
                  onChange={(e) => setTierPreferredMode(e.target.value as 'zatca_tax' | 'internal_delivery')}
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
              <span>🔒 تثبيت السعر تلقائياً عند البيع ومنع المندوب من تغييره أو البيع بسعر أقل</span>
            </label>
            <div>
              <button type="submit" className="btn primary" disabled={busy}>
                حفظ سياسة العميل السعرية والائتمانية
              </button>
            </div>
          </form>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>📋 قائمة أسعار وسياسات العملاء المعتمدة</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>العميل</th>
                    <th>الشريحة</th>
                    <th>سعر الكيلو</th>
                    <th>تثبيت السعر</th>
                    <th>سقف الائتمان</th>
                    <th>أقصى بونص</th>
                    <th>أقصى خصم</th>
                    <th>نوع الفاتورة</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.customerPrices ?? []).map((cp) => (
                    <tr key={cp.id}>
                      <td><strong>{cp.partyName}</strong></td>
                      <td>{cp.priceTierLabel}</td>
                      <td dir="ltr"><strong>{cp.unitPrice} SAR</strong></td>
                      <td>{cp.lockPrice ? <span className="badge ok">🔒 مثبّت</span> : 'مرن'}</td>
                      <td dir="ltr">{cp.creditLimit} SAR ({cp.paymentTermsDays} يوم)</td>
                      <td dir="ltr">{cp.maxBonusKgPerInvoice} kg ({cp.maxBonusPct}%)</td>
                      <td dir="ltr">{cp.maxDiscountPct}%</td>
                      <td>{cp.preferredInvoiceMode === 'zatca_tax' ? 'ضريبية ZATCA' : 'توزيع عادية'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>📜 سجل تدقيق وتاريخ تعديلات أسعار العملاء</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>السعر السابق</th>
                    <th>السعر الجديد</th>
                    <th>بداية السريان</th>
                    <th>تثبيت السعر</th>
                    <th>سبب التعديل</th>
                    <th>تاريخ التسجيل</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.customerPriceHistory ?? []).map((h) => (
                    <tr key={h.id}>
                      <td dir="ltr">{h.previousUnitPrice ? `${h.previousUnitPrice} SAR` : '—'}</td>
                      <td dir="ltr"><strong>{h.newUnitPrice} SAR</strong></td>
                      <td dir="ltr">{h.effectiveFrom}</td>
                      <td>{h.lockPrice ? '🔒 مثبّت' : 'مرن'}</td>
                      <td>{h.changeReason || '—'}</td>
                      <td dir="ltr">{new Date(h.changedAt).toLocaleString('ar-SA')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 6: BONUS RADAR & ROLE PERMISSIONS MATRIX (Pillar 3 & 10) */}
      {tab === 'audit' && (
        <div style={{ display: 'grid', gap: 16 }}>
          <div className="card">
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <h2 style={{ margin: 0 }}>🔍 فحص توافق البيانات السابقة وربطها بالنواة (Dry-Run)</h2>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() => void handleRunLegacyPreview()}
              >
                تشغيل فحص التوافق الآمن (Dry-Run)
              </button>
            </div>
            {reconciliationPreview ? (
              <div className="form-grid">
                <div>
                  <strong>دفعات الإنتاج:</strong> الإجمالي {reconciliationPreview.batches.total} (مرتبط بالنواة: {reconciliationPreview.batches.linkedToCore} | غير مرتبط: {reconciliationPreview.batches.unlinkedLegacy})
                </div>
                <div>
                  <strong>أوامر التحميل:</strong> الإجمالي {reconciliationPreview.loadOrders.total} (مرتبط بتحويل مخزني: {reconciliationPreview.loadOrders.linkedToTransfer} | غير مرتبط: {reconciliationPreview.loadOrders.unlinkedLegacy})
                </div>
                <div>
                  <strong>فواتير المناديب:</strong> الإجمالي {reconciliationPreview.documents.total} (مرتبط بـ sales_invoices: {reconciliationPreview.documents.linkedToSalesInvoice} | غير مرتبط: {reconciliationPreview.documents.unlinkedLegacy})
                </div>
              </div>
            ) : (
              <p className="muted" style={{ margin: 0 }}>
                يعرض هذا الفحص حالة ربط السجلات السابقة بجداول النواة الرسمية (`sales_invoices`, `stock_transfers`, `inventory_transactions`) في وضع المعاينة الآمنة دون أي تعديل على قاعدة البيانات.
              </p>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>🛡️ رادار الرقابة على الكميات المجانية (البونص) والعينات والخصومات</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>رقم الفاتورة</th>
                    <th>المندوب</th>
                    <th>العميل</th>
                    <th>المباع</th>
                    <th>البونص المجاني</th>
                    <th>سبب البونص</th>
                    <th>الخصم</th>
                    <th>تأكيد العميل</th>
                    <th>التنبيه الرقابي</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.documents ?? [])
                    .filter((d) => Number(d.bonusQty) > 0 || Number(d.discountAmount) > 0 || d.bonusAnomaly)
                    .map((d) => (
                      <tr key={d.id}>
                        <td dir="ltr"><strong>{d.number}</strong></td>
                        <td>{d.salesmanName}</td>
                        <td>{d.customerName}</td>
                        <td dir="ltr">{d.soldQty} kg</td>
                        <td dir="ltr" style={{ color: 'var(--warn)', fontWeight: 700 }}>{d.bonusQty} kg</td>
                        <td>{d.bonusReason || '—'}</td>
                        <td dir="ltr">{d.discountAmount} SAR</td>
                        <td>{d.customerBonusConfirmed ? '✔ مؤكد' : 'غير مؤكد'}</td>
                        <td>
                          {d.bonusAnomaly ? (
                            <span className="badge danger">{d.anomalyReason || 'تجاوز سقف البونص'}</span>
                          ) : (
                            <span className="badge ok">ضمن السياسة المعتمدة</span>
                          )}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>🔐 مصفوفة الصلاحيات والأمان للأدوار الأربعة في المصنع</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الدور الوظيفي</th>
                    <th>صلاحيات الإنتاج والمستودع</th>
                    <th>صلاحيات الأسعار والخصومات والبونص</th>
                    <th>صلاحيات إغلاق الوردية والتالف والعجز</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td><strong>👑 صاحب المصنع (Factory Owner)</strong></td>
                    <td>اطلاع كامل على لوحة صاحب المصنع، تكلفة الإنتاج، وهوامش الربح لكل صنف ومندوب وعميل.</td>
                    <td>تحديد وتثبيت شرائح الأسعار (6 / 6.5 / 7 ريال) واعتماد الخصومات الاستثنائية وتجاوز البونص.</td>
                    <td>اعتماد نهائي لإغلاق الورديات، مراجعة سجل التدقيق الكامل، واستلام التنبيهات الفورية.</td>
                  </tr>
                  <tr>
                    <td><strong>🧮 المحاسب (Accountant)</strong></td>
                    <td>مطابقة أرصدة المستودع الرئيسي وعهد المناديب والقيود المحاسبية وتكلفة البضاعة المباعة.</td>
                    <td>مراجعة الفواتير الضريبية (ZATCA) والعادية، ومراقبة السقوف الائتمانية والتحصيل.</td>
                    <td><strong>مراجعة إغلاقات الورديات المعلقة، تأكيد الفحص الفعلي للتالف، تصفير العهد، وقيد العجز خصماً على راتب المندوب.</strong></td>
                  </tr>
                  <tr>
                    <td><strong>📦 أمين المستودع (Warehouse Keeper)</strong></td>
                    <td>تسجيل دفعات الإنتاج اليومية، صرف أوامر التحميل للمناديب، واستلام المرتجع السليم.</td>
                    <td>لا يملك صلاحية تعديل أسعار العملاء أو منح خصومات مالية.</td>
                    <td>المشاركة في الفحص الفعلي للكميات التالفة والجرد الدوري المفاجئ لسيارات المناديب.</td>
                  </tr>
                  <tr>
                    <td><strong>🚚 المندوب (Sales Rep)</strong></td>
                    <td>استلام العهدة المحددة بأمر التحميل فقط (يُمنع بيع أي كمية تتجاوز دفعة المخبز المستلمة).</td>
                    <td>البيع بالسعر المثبّت للعميل تلقائياً، وتسجيل سبب البونص ضمن السقف المسموح فقط.</td>
                    <td><strong>تقديم طلب إغلاق الوردية اليومي في نهاية الدوام (تبقى الحالة معلقة حتى يعتمدها المحاسب).</strong></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}
