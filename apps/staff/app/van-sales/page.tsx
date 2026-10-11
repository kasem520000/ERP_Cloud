'use client';

import { useEffect, useState } from 'react';

import { Notice } from '../../components/data-view';
import { Screen } from '../../components/screen';
import { ZatcaQrSvg, buildZatcaTlvBase64, printThermalReceipt80mm } from '../../components/zatca-qr-svg';
import { ApiError, apiData, apiPost } from '../../lib/api';
import { listItems, listParties, listSalesmen, type Item, type Party, type Salesman } from '../../lib/lookups';

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
  remainingQty: string;
  maxBonusQty: string;
  maxBonusPct: string;
  expectedCash: string;
  collectedCash: string;
  cashVariance: string;
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
  unitPrice: string;
  subtotal: string;
  taxRate: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  customerBonusConfirmed: boolean;
  customerConfirmationCode: string;
  bonusAnomaly: boolean;
  anomalyReason: string;
  notes: string;
  createdAt: string;
};

type DashboardData = {
  summary: {
    totalLoadedKg: string;
    totalSoldKg: string;
    totalBonusKg: string;
    totalReturnedKg: string;
    remainingInVansKg: string;
    totalZatcaSalesSar: string;
    totalInternalSalesSar: string;
    totalRevenueSar: string;
    anomalyCount: number;
  };
  loadOrders: LoadOrder[];
  customerPrices: CustomerPrice[];
  documents: VanDocument[];
};

export default function VanSalesPage() {
  const [tab, setTab] = useState<'invoice' | 'loads' | 'prices' | 'audit'>('invoice');
  const [data, setData] = useState<DashboardData | null>(null);
  const [salesmen, setSalesmen] = useState<Salesman[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'warn'; text: string }>();
  const [busy, setBusy] = useState(false);

  // Load order form state
  const [loadSalesmanId, setLoadSalesmanId] = useState('');
  const [loadItemId, setLoadItemId] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [productionBatchNo, setProductionBatchNo] = useState('');
  const [loadedQty, setLoadedQty] = useState('200');
  const [maxBonusQty, setMaxBonusQty] = useState('10');
  const maxBonusPct = '5';

  // Customer price tier form state
  const [tierPartyId, setTierPartyId] = useState('');
  const [tierUnitPrice, setTierUnitPrice] = useState('6.50');
  const [tierLabel, setTierLabel] = useState('شريحة جملة محلات — 6.50 ريال/كجم');
  const [tierMaxBonusPct, setTierMaxBonusPct] = useState('5');
  const [tierMaxBonusKg, setTierMaxBonusKg] = useState('2');
  const [tierPreferredMode, setTierPreferredMode] = useState<'zatca_tax' | 'internal_delivery'>('zatca_tax');

  // Van invoice / delivery form state
  const [docLoadOrderId, setDocLoadOrderId] = useState('');
  const [docPartyId, setDocPartyId] = useState('');
  const [docWalkinName, setDocWalkinName] = useState('');
  const [docMode, setDocMode] = useState<'zatca_tax' | 'internal_delivery'>('zatca_tax');
  const [docPayment, setDocPayment] = useState<'cash' | 'card' | 'credit'>('cash');
  const [docSoldQty, setDocSoldQty] = useState('20');
  const [docBonusQty, setDocBonusQty] = useState('0');
  const [docUnitPrice, setDocUnitPrice] = useState('6.50');
  const [docBonusConfirmed, setDocBonusConfirmed] = useState(false);
  const [docConfirmCode, setDocConfirmCode] = useState('');
  const [selectedDoc, setSelectedDoc] = useState<VanDocument | null>(null);

  async function reload() {
    const [dash, sm, cust, it] = await Promise.all([
      apiData<DashboardData>('/van-sales/dashboard'),
      listSalesmen().catch(() => []),
      listParties('customer').catch(() => []),
      listItems().catch(() => []),
    ]);
    setData(dash);
    setSalesmen(sm);
    setCustomers(cust);
    setItems(it);
    if (!loadSalesmanId && sm[0]?.id) setLoadSalesmanId(sm[0].id);
    const activeLoads = (dash.loadOrders ?? []).filter((l) => l.status !== 'settled');
    if (!docLoadOrderId && activeLoads[0]?.id) setDocLoadOrderId(activeLoads[0].id);
    if (!selectedDoc && dash.documents?.[0]) setSelectedDoc(dash.documents[0]);
  }

  useEffect(() => {
    void reload().catch((error: unknown) =>
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر تحميل بيانات التوزيع' }),
    );
  }, []);

  // Auto-apply customer-specific price & invoice mode when selecting a customer
  function onSelectCustomer(partyId: string) {
    setDocPartyId(partyId);
    const rule = data?.customerPrices.find((cp) => cp.partyId === partyId);
    if (rule) {
      setDocUnitPrice(rule.unitPrice);
      setDocMode(rule.preferredInvoiceMode);
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
        text: `تم إصدار أمر التحميل رقم ${newestLoad?.number ?? ''} بدفعة إنتاج المخبز (${newestLoad?.productionBatchNo ?? ''}) بكمية ${loadedQty} كجم.`,
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
        preferredInvoiceMode: tierPreferredMode,
      });
      setData(next);
      setNotice({ kind: 'ok', text: 'تم حفظ شريحة سعر العميل وسقف البونص ونوع الفاتورة المفضل.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر حفظ شريحة السعر' });
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
        unitPrice: docUnitPrice,
        customerBonusConfirmed: docBonusConfirmed,
        customerConfirmationCode: docConfirmCode.trim() || undefined,
      });
      setData(next);
      const newestDoc = next.documents[0] ?? null;
      setSelectedDoc(newestDoc);
      setNotice({
        kind: 'ok',
        text: `تم إصدار ${newestDoc?.invoiceMode === 'zatca_tax' ? 'فاتورة ضريبية (ZATCA)' : 'فاتورة عادية / إيصال تسليم داخلي'} رقم ${newestDoc?.number ?? ''} وخصم الكمية من سيارة المندوب.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر إصدار المستند' });
    } finally {
      setBusy(false);
    }
  }

  async function settleVan(load: LoadOrder) {
    const returned = window.prompt('أدخل الكمية المرتجعة للمخبز بالكيلو (إن وجدت):', load.remainingQty) ?? load.remainingQty;
    const cash = window.prompt('أدخل المبلغ النقدي المسلم فعلياً من المندوب للخزينة (ريال):', load.expectedCash) ?? load.expectedCash;
    setBusy(true);
    setNotice(undefined);
    try {
      const next = await apiPost<DashboardData>(`/van-sales/load-orders/${load.id}/settle`, {
        returnedQty: returned,
        collectedCash: cash,
      });
      setData(next);
      setNotice({ kind: 'ok', text: `تمت تصفية عهدة المندوب (${load.salesmanName}) لأمر التحميل ${load.number}.` });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof ApiError ? error.message : 'تعذر تصفية أمر التحميل' });
    } finally {
      setBusy(false);
    }
  }

  const activeLoadOrder = data?.loadOrders.find((l) => l.id === docLoadOrderId);
  const selectedCustomerRule = data?.customerPrices.find((cp) => cp.partyId === docPartyId);
  const previewSubtotal = Number(docSoldQty || 0) * Number(docUnitPrice || 0);
  const previewVat = docMode === 'zatca_tax' ? previewSubtotal * 0.15 : 0;
  const previewTotal = previewSubtotal + previewVat;

  return (
    <Screen
      title="🚚 توزيع المناديب والمخابز (رقائق السمبوسة والفطائر)"
      subtitle="نظام متكامل لضبط أوامر تحميل سيارات المناديب، دفعات الإنتاج اليومية لمنع خلط بضاعة من مخابز خارجية، رقابة البونص والكميات المجانية، تعدد أسعار العملاء (6 / 6.5 / 7 ريال)، وإصدار الفواتير الضريبية (ZATCA) أو الفواتير العادية."
      crumbs={['توزيع المناديب والمخابز']}
    >
      {notice ? <Notice notice={notice} /> : null}

      {/* KPI Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 10 }}>
        <div className="card">
          <div className="muted small">إجمالي الكميات المحمّلة للمناديب</div>
          <strong style={{ fontSize: 22 }} dir="ltr">
            {data?.summary.totalLoadedKg ?? '0.00'} kg
          </strong>
        </div>
        <div className="card">
          <div className="muted small">الكميات المباعة الفعّالة</div>
          <strong style={{ fontSize: 22, color: 'var(--ok)' }} dir="ltr">
            {data?.summary.totalSoldKg ?? '0.00'} kg
          </strong>
        </div>
        <div className="card">
          <div className="muted small">الكميات المجانية (البونص)</div>
          <strong style={{ fontSize: 22, color: 'var(--warn)' }} dir="ltr">
            {data?.summary.totalBonusKg ?? '0.00'} kg
          </strong>
        </div>
        <div className="card">
          <div className="muted small">المتبقي في سيارات المناديب</div>
          <strong style={{ fontSize: 22 }} dir="ltr">
            {data?.summary.remainingInVansKg ?? '0.00'} kg
          </strong>
        </div>
        <div className="card">
          <div className="muted small">مبيعات ضريبية (ZATCA)</div>
          <strong style={{ fontSize: 20 }} dir="ltr">
            {data?.summary.totalZatcaSalesSar ?? '0.00'} SAR
          </strong>
        </div>
        <div className="card">
          <div className="muted small">فواتير عادية (إيصالات تسليم)</div>
          <strong style={{ fontSize: 20 }} dir="ltr">
            {data?.summary.totalInternalSalesSar ?? '0.00'} SAR
          </strong>
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          className={tab === 'invoice' ? 'btn primary' : 'btn'}
          onClick={() => setTab('invoice')}
        >
          🧾 1. إصدار فاتورة مندوب (ضريبية ZATCA أو عادية)
        </button>
        <button
          type="button"
          className={tab === 'loads' ? 'btn primary' : 'btn'}
          onClick={() => setTab('loads')}
        >
          🚛 2. أوامر تحميل المناديب وتصفية العهدة ({data?.loadOrders.length ?? 0})
        </button>
        <button
          type="button"
          className={tab === 'prices' ? 'btn primary' : 'btn'}
          onClick={() => setTab('prices')}
        >
          🏷️ 3. شرائح أسعار العملاء (6 / 6.5 / 7 ريال) ({data?.customerPrices.length ?? 0})
        </button>
        <button
          type="button"
          className={tab === 'audit' ? 'btn primary' : 'btn'}
          onClick={() => setTab('audit')}
        >
          🛡️ 4. رادار منع التلاعب والبونص والخلط الخارجي
        </button>
      </div>

      {/* TAB 1: Dual Invoicing (ZATCA Tax vs Internal Delivery) */}
      {tab === 'invoice' && (
        <div className="split">
          <form className="card" onSubmit={submitVanDocument} style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>🧾 إصدار فاتورة توزيع من سيارة المندوب</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              يخصم النظام الكمية المباعة + البونص مباشرة من دفعة الإنتاج المحمّلة للمندوب، ويطبّق سعر العميل المعتمد تلقائياً.
            </p>

            <div className="form-grid">
              <label className="field">
                <span>🚛 أمر التحميل / دفعة إنتاج المخبز *</span>
                <select
                  className="input"
                  required
                  value={docLoadOrderId}
                  onChange={(e) => setDocLoadOrderId(e.target.value)}
                >
                  <option value="">— اختر أمر التحميل النشط للمندوب —</option>
                  {(data?.loadOrders ?? [])
                    .filter((l) => l.status !== 'settled')
                    .map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.number} · {l.salesmanName} · دفعة {l.productionBatchNo} (متبقي: {l.remainingQty} كجم)
                      </option>
                    ))}
                </select>
                {activeLoadOrder ? (
                  <span className="muted small">
                    الرصيد المتاح للبيع من دفعة المخبز: <strong dir="ltr">{activeLoadOrder.remainingQty} kg</strong> · سقف البونص المتبقي:{' '}
                    <strong dir="ltr">
                      {(Number(activeLoadOrder.maxBonusQty) - Number(activeLoadOrder.bonusQty)).toFixed(2)} kg
                    </strong>
                  </span>
                ) : (
                  <span className="muted small">أنشئ أمر تحميل للمندوب أولاً من تبويب «أوامر التحميل».</span>
                )}
              </label>

              <label className="field">
                <span>🏪 العميل (المحل / السوبرماركت / المطعم)</span>
                <select
                  className="input"
                  value={docPartyId}
                  onChange={(e) => onSelectCustomer(e.target.value)}
                >
                  <option value="">— محل نقدي عام —</option>
                  {customers.map((c) => {
                    const rule = data?.customerPrices.find((cp) => cp.partyId === c.id);
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name} {rule ? `(${rule.unitPrice} ريال/كجم)` : ''}
                      </option>
                    );
                  })}
                </select>
                {selectedCustomerRule ? (
                  <span className="badge ok" style={{ justifySelf: 'start' }}>
                    سعر العميل المعتمد: {selectedCustomerRule.unitPrice} ريال/كجم · أقصى بونص: {selectedCustomerRule.maxBonusKgPerInvoice} كجم
                  </span>
                ) : null}
              </label>

              {!docPartyId && (
                <label className="field">
                  <span>اسم المحل / المشتري النقدي</span>
                  <input
                    className="input"
                    value={docWalkinName}
                    onChange={(e) => setDocWalkinName(e.target.value)}
                    placeholder="مثال: بوفية أو بقالة الحي"
                  />
                </label>
              )}

              <label className="field">
                <span>📄 نوع المستند (حسب رغبة المحل) *</span>
                <select
                  className="input"
                  value={docMode}
                  onChange={(e) => setDocMode(e.target.value as 'zatca_tax' | 'internal_delivery')}
                >
                  <option value="zatca_tax">
                    🏛️ فاتورة ضريبية مرتبطة بالزاتكا (ZATCA 15% VAT + QR)
                  </option>
                  <option value="internal_delivery">
                    📋 فاتورة عادية / إيصال تسليم داخلي (للمحلات التي لا ترغب بفاتورة زاتكا)
                  </option>
                </select>
                <span className="muted small">
                  {docMode === 'zatca_tax'
                    ? 'تُصدر بضريبة 15% وباركود ZATCA رسمي.'
                    : 'لا تُرسل للزاتكا ولكنها تخصم الكمية 100% من عهدة المندوب وتُسجّل المبلغ في ذمته المالية.'}
                </span>
              </label>

              <label className="field">
                <span>💳 طريقة السداد</span>
                <select
                  className="input"
                  value={docPayment}
                  onChange={(e) => setDocPayment(e.target.value as 'cash' | 'card' | 'credit')}
                >
                  <option value="cash">💵 نقداً للمندوب</option>
                  <option value="card">🖧 شبكة مدى / تحويل</option>
                  <option value="credit">📒 آجل على حساب المحل</option>
                </select>
              </label>

              <label className="field">
                <span>⚖️ الكمية المباعة (كجم) *</span>
                <input
                  className="input"
                  dir="ltr"
                  inputMode="decimal"
                  required
                  value={docSoldQty}
                  onChange={(e) => setDocSoldQty(e.target.value)}
                />
              </label>

              <label className="field">
                <span>💰 سعر الكيلو (ريال) *</span>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    className="input"
                    dir="ltr"
                    inputMode="decimal"
                    required
                    value={docUnitPrice}
                    onChange={(e) => setDocUnitPrice(e.target.value)}
                  />
                  <button type="button" className="btn sm" onClick={() => setDocUnitPrice('6.00')}>
                    6.00
                  </button>
                  <button type="button" className="btn sm" onClick={() => setDocUnitPrice('6.50')}>
                    6.50
                  </button>
                  <button type="button" className="btn sm" onClick={() => setDocUnitPrice('7.00')}>
                    7.00
                  </button>
                </div>
              </label>

              <label className="field">
                <span>🎁 الكمية المجانية / البونص (كجم)</span>
                <input
                  className="input"
                  dir="ltr"
                  inputMode="decimal"
                  value={docBonusQty}
                  onChange={(e) => setDocBonusQty(e.target.value)}
                />
                <span className="muted small">
                  يخضع البونص لسقف المندوب وسقف العميل لمنع ادعاء بونص وهمي.
                </span>
              </label>

              {Number(docBonusQty || 0) > 0 && (
                <label className="field">
                  <span>🔐 رمز / إقرار استلام العميل للبونص المجاني</span>
                  <div className="row" style={{ gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={docBonusConfirmed}
                      onChange={(e) => setDocBonusConfirmed(e.target.checked)}
                    />
                    <input
                      className="input"
                      placeholder="رقم جوال المستلم أو كود التأكيد…"
                      value={docConfirmCode}
                      onChange={(e) => setDocConfirmCode(e.target.value)}
                    />
                  </div>
                </label>
              )}
            </div>

            <div className="card" style={{ background: 'var(--surface-2)', padding: 12 }}>
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <span>
                  الكمية الإجمالية الخارجة من السيارة:{' '}
                  <strong dir="ltr">{(Number(docSoldQty || 0) + Number(docBonusQty || 0)).toFixed(2)} kg</strong>
                </span>
                <span>
                  قبل الضريبة: <strong dir="ltr">{previewSubtotal.toFixed(2)} SAR</strong>
                </span>
                <span>
                  الضريبة ({docMode === 'zatca_tax' ? '15%' : '0%'}):{' '}
                  <strong dir="ltr">{previewVat.toFixed(2)} SAR</strong>
                </span>
                <span style={{ fontSize: 16 }}>
                  الصافي المطلوب: <strong dir="ltr">{previewTotal.toFixed(2)} SAR</strong>
                </span>
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn primary" type="submit" disabled={busy || !docLoadOrderId}>
                {busy ? 'جارٍ الحفظ…' : '⚡ حفظ وإصدار الفاتورة وخصم الكمية من العهدة'}
              </button>
            </div>
          </form>

          {/* Right column: Selected Van Receipt Preview + Thermal Print */}
          <div className="card" style={{ display: 'grid', gap: 12, alignContent: 'start' }}>
            <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={{ margin: 0 }}>🧾 معاينة وطباعة الإيصال</h2>
              {selectedDoc ? (
                <button
                  type="button"
                  className="btn primary sm"
                  onClick={() => {
                    const qrPayload = buildZatcaTlvBase64({
                      sellerName: 'مخبز رقائق السمبوسة والفطائر',
                      vatNo: '300000000000003',
                      timestampIso: selectedDoc.createdAt,
                      total: selectedDoc.total,
                      tax: selectedDoc.taxTotal,
                    });
                    printThermalReceipt80mm({
                      companyName: 'مخبز رقائق السمبوسة والفطائر',
                      taxNo: selectedDoc.invoiceMode === 'zatca_tax' ? '300000000000003' : undefined,
                      branchName: `مندوب: ${selectedDoc.salesmanName} · دفعة: ${selectedDoc.productionBatchNo}`,
                      invoiceNumber: selectedDoc.number,
                      invoiceTypeLabel:
                        selectedDoc.invoiceMode === 'zatca_tax'
                          ? 'فاتورة ضريبية مبسطة (ZATCA)'
                          : 'فاتورة مبيعات عادية / إيصال تسليم بضاعة',
                      issuedAt: new Date(selectedDoc.createdAt).toLocaleString('ar-SA'),
                      customerName: selectedDoc.customerName,
                      paymentMethodLabel:
                        selectedDoc.paymentMethod === 'cash'
                          ? 'نقداً'
                          : selectedDoc.paymentMethod === 'card'
                            ? 'شبكة'
                            : 'آجل',
                      lines: [
                        {
                          name: `${selectedDoc.itemName} (دفعة ${selectedDoc.productionBatchNo})`,
                          quantity: selectedDoc.soldQty,
                          unitPrice: selectedDoc.unitPrice,
                          total: selectedDoc.total,
                        },
                        ...(Number(selectedDoc.bonusQty) > 0
                          ? [
                              {
                                name: 'كمية مجانية (بونص معتمد للعميل)',
                                quantity: selectedDoc.bonusQty,
                                unitPrice: '0.00',
                                total: '0.00',
                              },
                            ]
                          : []),
                      ],
                      subtotal: selectedDoc.subtotal,
                      taxTotal: selectedDoc.taxTotal,
                      total: selectedDoc.total,
                      paidAmount: selectedDoc.paidAmount,
                      qrPayload,
                    });
                  }}
                >
                  🖨️ طباعة إيصال كاشير 80mm
                </button>
              ) : null}
            </div>

            {!selectedDoc ? (
              <p className="muted">أصدر فاتورة أو اختر مستنداً من السجل أدناه لمعاينته وطباعته.</p>
            ) : (
              <div style={{ display: 'grid', gap: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>رقم المستند: {selectedDoc.number}</strong>
                  <span className={`badge ${selectedDoc.invoiceMode === 'zatca_tax' ? 'ok' : 'neutral'}`}>
                    {selectedDoc.invoiceMode === 'zatca_tax'
                      ? '🏛️ فاتورة ضريبية (ZATCA)'
                      : '📋 فاتورة عادية / إيصال تسليم'}
                  </span>
                </div>
                <dl className="kv">
                  <dt>العميل</dt>
                  <dd>{selectedDoc.customerName}</dd>
                  <dt>المندوب</dt>
                  <dd>{selectedDoc.salesmanName}</dd>
                  <dt>رقم دفعة إنتاج المخبز</dt>
                  <dd dir="ltr">{selectedDoc.productionBatchNo}</dd>
                  <dt>الكمية المباعة</dt>
                  <dd dir="ltr">{selectedDoc.soldQty} kg × {selectedDoc.unitPrice} SAR</dd>
                  <dt>الكمية المجانية (البونص)</dt>
                  <dd dir="ltr">
                    {selectedDoc.bonusQty} kg{' '}
                    {selectedDoc.customerBonusConfirmed ? '✅ (مؤكد من العميل)' : ''}
                  </dd>
                  <dt>الصافي الإجمالي</dt>
                  <dd dir="ltr">
                    <strong>{selectedDoc.total} SAR</strong>
                  </dd>
                </dl>
                <div style={{ justifySelf: 'center' }}>
                  <ZatcaQrSvg
                    payload={buildZatcaTlvBase64({
                      sellerName: 'مخبز رقائق السمبوسة والفطائر',
                      vatNo: '300000000000003',
                      timestampIso: selectedDoc.createdAt,
                      total: selectedDoc.total,
                      tax: selectedDoc.taxTotal,
                    })}
                    size={132}
                    label={
                      selectedDoc.invoiceMode === 'zatca_tax'
                        ? `باركود زاتكا + دفعة المخبز (${selectedDoc.productionBatchNo})`
                        : `باركود التحقق من دفعة المخبز (${selectedDoc.productionBatchNo})`
                    }
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: Van Load Orders & Daily Closing */}
      {tab === 'loads' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <form className="card" onSubmit={submitLoadOrder} style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>🚛 إنشاء أمر تحميل سيارة مندوب (بداية اليومية)</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              يقيّد هذا الأمر سقف الكمية القصوى التي يستطيع المندوب بيعها اليوم من دفعة إنتاج المخبز، فلا يستطيع شراء بضاعة رخيصة (5 ريال) من مخبز آخر وإدخالها في مبيعاته.
            </p>
            <div className="form-grid">
              <label className="field">
                <span>👨‍💼 المندوب *</span>
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
                <span>📦 الصنف الرئيسي</span>
                <select className="input" value={loadItemId} onChange={(e) => setLoadItemId(e.target.value)}>
                  <option value="">— رقائق سمبوسة وفطائر (عام) —</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.nameAr}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>🚐 رقم لوحة السيارة</span>
                <input
                  className="input"
                  value={vehiclePlate}
                  onChange={(e) => setVehiclePlate(e.target.value)}
                  placeholder="مثال: أ ب ج 1234"
                />
              </label>
              <label className="field">
                <span>🏭 رقم دفعة الإنتاج اليومية (يُولَّد تلقائياً إن تُرك فارغاً)</span>
                <input
                  className="input"
                  dir="ltr"
                  value={productionBatchNo}
                  onChange={(e) => setProductionBatchNo(e.target.value)}
                  placeholder="BATCH-20261012-A"
                />
              </label>
              <label className="field">
                <span>⚖️ الكمية المحمّلة للمندوب (كجم) *</span>
                <input
                  className="input"
                  dir="ltr"
                  inputMode="decimal"
                  required
                  value={loadedQty}
                  onChange={(e) => setLoadedQty(e.target.value)}
                />
              </label>
              <label className="field">
                <span>🎁 الحد الأقصى للبونص المسموح للمندوب اليوم (كجم)</span>
                <input
                  className="input"
                  dir="ltr"
                  inputMode="decimal"
                  value={maxBonusQty}
                  onChange={(e) => setMaxBonusQty(e.target.value)}
                />
              </label>
            </div>
            <div>
              <button className="btn primary" type="submit" disabled={busy}>
                ➕ اعتماد أمر التحميل وتسليم العهدة للمندوب
              </button>
            </div>
          </form>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>سجل أوامر التحميل وتصفية عهد المناديب</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>رقم الأمر</th>
                    <th>المندوب</th>
                    <th>دفعة الإنتاج</th>
                    <th>المحمّل (كجم)</th>
                    <th>المباع (كجم)</th>
                    <th>البونص (كجم)</th>
                    <th>المرتجع (كجم)</th>
                    <th>المتبقي بالسيارة</th>
                    <th>النقدية المتوقعة</th>
                    <th>النقدية المسلمة</th>
                    <th>الحالة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.loadOrders ?? []).map((load) => (
                    <tr key={load.id}>
                      <td dir="ltr">{load.number}</td>
                      <td>{load.salesmanName}</td>
                      <td dir="ltr">{load.productionBatchNo}</td>
                      <td dir="ltr">{load.loadedQty}</td>
                      <td dir="ltr">{load.soldQty}</td>
                      <td dir="ltr">{load.bonusQty} / {load.maxBonusQty}</td>
                      <td dir="ltr">{load.returnedQty}</td>
                      <td dir="ltr">
                        <strong>{load.remainingQty}</strong>
                      </td>
                      <td dir="ltr">{load.expectedCash} SAR</td>
                      <td dir="ltr">{load.collectedCash} SAR</td>
                      <td>
                        <span className={`badge ${load.status === 'settled' ? 'ok' : 'warn'}`}>
                          {load.status === 'settled' ? 'تمت التصفية' : 'في جولة التوزيع'}
                        </span>
                      </td>
                      <td>
                        {load.status !== 'settled' ? (
                          <button
                            type="button"
                            className="btn sm primary"
                            onClick={() => void settleVan(load)}
                          >
                            تصفية العهدة
                          </button>
                        ) : (
                          <span className="muted small">مغلق</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: Customer Price Tiers (6.00 / 6.50 / 7.00 SAR) */}
      {tab === 'prices' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <form className="card" onSubmit={submitCustomerTier} style={{ display: 'grid', gap: 12 }}>
            <h2 style={{ margin: 0 }}>🏷️ تخصيص سعر الكيلو وسقف البونص ونوع الفاتورة لكل عميل</h2>
            <p className="muted" style={{ margin: 0, fontSize: 13 }}>
              ثبّت سعر كل محل (مثلاً 6.00 ريال لكبار العملاء، 6.50 ريال للمحلات المتوسطة، 7.00 ريال للتجزئة) حتى لا يتلاعب المندوب بفارق السعر.
            </p>
            <div className="form-grid">
              <label className="field">
                <span>🏪 العميل *</span>
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
                <span>💰 سعر الكيلو المعتمد للعميل (ريال) *</span>
                <div className="row" style={{ gap: 6 }}>
                  <input
                    className="input"
                    dir="ltr"
                    inputMode="decimal"
                    required
                    value={tierUnitPrice}
                    onChange={(e) => setTierUnitPrice(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setTierUnitPrice('6.00');
                      setTierLabel('شريحة كبار العملاء (6.00 ريال/كجم)');
                    }}
                  >
                    6.00
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setTierUnitPrice('6.50');
                      setTierLabel('شريحة جملة المحلات (6.50 ريال/كجم)');
                    }}
                  >
                    6.50
                  </button>
                  <button
                    type="button"
                    className="btn sm"
                    onClick={() => {
                      setTierUnitPrice('7.00');
                      setTierLabel('شريحة التجزئة (7.00 ريال/كجم)');
                    }}
                  >
                    7.00
                  </button>
                </div>
              </label>
              <label className="field">
                <span>اسم الشريحة السعرية</span>
                <input
                  className="input"
                  value={tierLabel}
                  onChange={(e) => setTierLabel(e.target.value)}
                />
              </label>
              <label className="field">
                <span>🎁 أقصى بونص مسموح في الفاتورة الواحدة (كجم)</span>
                <input
                  className="input"
                  dir="ltr"
                  inputMode="decimal"
                  value={tierMaxBonusKg}
                  onChange={(e) => setTierMaxBonusKg(e.target.value)}
                />
              </label>
              <label className="field">
                <span>🎁 أقصى نسبة بونص من المشتريات (%)</span>
                <input
                  className="input"
                  dir="ltr"
                  inputMode="decimal"
                  value={tierMaxBonusPct}
                  onChange={(e) => setTierMaxBonusPct(e.target.value)}
                />
              </label>
              <label className="field">
                <span>📄 نوع الفاتورة المفضل لهذا المحل</span>
                <select
                  className="input"
                  value={tierPreferredMode}
                  onChange={(e) => setTierPreferredMode(e.target.value as 'zatca_tax' | 'internal_delivery')}
                >
                  <option value="zatca_tax">🏛️ فاتورة ضريبية مرتبطة بالزاتكا (ZATCA)</option>
                  <option value="internal_delivery">📋 فاتورة عادية / إيصال تسليم غير مرتبط بالزاتكا</option>
                </select>
              </label>
            </div>
            <div>
              <button className="btn primary" type="submit" disabled={busy}>
                💾 حفظ تسعيرة العميل وسياسته
              </button>
            </div>
          </form>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>قائمة أسعار العملاء المعتمدة</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>العميل</th>
                    <th>الشريحة</th>
                    <th>سعر الكيلو</th>
                    <th>أقصى بونص (كجم / %)</th>
                    <th>نوع الفاتورة المفضل</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.customerPrices ?? []).map((cp) => (
                    <tr key={cp.id}>
                      <td>
                        <strong>{cp.partyName}</strong>
                      </td>
                      <td>{cp.priceTierLabel}</td>
                      <td dir="ltr">
                        <strong>{cp.unitPrice} SAR</strong>
                      </td>
                      <td dir="ltr">
                        {cp.maxBonusKgPerInvoice} kg ({cp.maxBonusPct}%)
                      </td>
                      <td>
                        <span className={`badge ${cp.preferredInvoiceMode === 'zatca_tax' ? 'ok' : 'neutral'}`}>
                          {cp.preferredInvoiceMode === 'zatca_tax' ? 'ضريبية (ZATCA)' : 'فاتورة عادية'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 4: Anti-Fraud & Bonus Anomaly Radar */}
      {tab === 'audit' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <section className="card">
            <h2 style={{ marginTop: 0 }}>🛡️ الضوابط الرقابية الخمسة المطبّقة آلياً لمنع تلاعب المناديب</h2>
            <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12 }}>
              <div className="card" style={{ background: 'var(--surface-2)' }}>
                <strong>1️⃣ قفل سقف دفعة الإنتاج اليومية</strong>
                <p className="muted small" style={{ margin: '6px 0 0' }}>
                  لا يستطيع المندوب إصدار أي فاتورة تتجاوز الكيلوجرامات المحمّلة له من دفعة إنتاج المخبز اليومية، مما يمنعه من شراء رقائق سمبوسة بسعر 5 ريال من مخبز خارجي وبيعها بسعر 6.5 ريال.
                </p>
              </div>
              <div className="card" style={{ background: 'var(--surface-2)' }}>
                <strong>2️⃣ ضبط البونص والكميات المجانية</strong>
                <p className="muted small" style={{ margin: '6px 0 0' }}>
                  كل أمر تحميل وكل عميل له سقف بونص محدد بالكيلو والنسبة المئوية، وأي كمية مجانية تتجاوز السقف تتطلب رمز تأكيد استلام من العميل وتظهر في تقرير المخالفات.
                </p>
              </div>
              <div className="card" style={{ background: 'var(--surface-2)' }}>
                <strong>3️⃣ تثبيت شريحة السعر لكل عميل</strong>
                <p className="muted small" style={{ margin: '6px 0 0' }}>
                  يُحمَّل سعر العميل (6.00 أو 6.50 أو 7.00 ريال) تلقائياً عند اختيار اسمه، فلا يستطيع المندوب البيع بـ 7 ريال وتسجيلها بـ 6 ريال في النظام.
                </p>
              </div>
              <div className="card" style={{ background: 'var(--surface-2)' }}>
                <strong>4️⃣ الفواتير المزدوجة (ضريبية ZATCA + عادية)</strong>
                <p className="muted small" style={{ margin: '6px 0 0' }}>
                  حتى المحلات التي ترفض الفاتورة الضريبية الرسمية يصدر لها «إيصال تسليم / فاتورة عادية» غير مرتبطة بالزاتكا، لكنها تخصم البضاعة من سيارة المندوب وتُثبت النقدية في ذمته 100%.
                </p>
              </div>
            </div>
          </section>

          <section className="card">
            <h2 style={{ marginTop: 0 }}>سجل جميع فواتير وإيصالات المناديب ({data?.documents.length ?? 0})</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>رقم المستند</th>
                    <th>النوع</th>
                    <th>المندوب</th>
                    <th>العميل</th>
                    <th>دفعة المخبز</th>
                    <th>المباع (كجم)</th>
                    <th>البونص (كجم)</th>
                    <th>السعر</th>
                    <th>الإجمالي</th>
                    <th>رقابة البونص</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {(data?.documents ?? []).map((doc) => (
                    <tr key={doc.id}>
                      <td dir="ltr">{doc.number}</td>
                      <td>
                        <span className={`badge ${doc.invoiceMode === 'zatca_tax' ? 'ok' : 'neutral'}`}>
                          {doc.invoiceMode === 'zatca_tax' ? 'ضريبية ZATCA' : 'فاتورة عادية'}
                        </span>
                      </td>
                      <td>{doc.salesmanName}</td>
                      <td>{doc.customerName}</td>
                      <td dir="ltr">{doc.productionBatchNo}</td>
                      <td dir="ltr">{doc.soldQty}</td>
                      <td dir="ltr">{doc.bonusQty}</td>
                      <td dir="ltr">{doc.unitPrice}</td>
                      <td dir="ltr">
                        <strong>{doc.total} SAR</strong>
                      </td>
                      <td>
                        {doc.bonusAnomaly ? (
                          <span className="badge danger" title={doc.anomalyReason}>
                            ⚠️ تجاوز بونص ({doc.customerBonusConfirmed ? 'مؤكد' : 'غير مؤكد'})
                          </span>
                        ) : (
                          <span className="badge ok">سليم</span>
                        )}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => {
                            setSelectedDoc(doc);
                            setTab('invoice');
                          }}
                        >
                          معاينة وطباعة
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </Screen>
  );
}
