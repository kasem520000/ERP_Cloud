'use client';

import { Panel } from '@erp/ui';
import { ChevronDown } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

import { Notice } from '../../../../components/data-view';
import {
  InvoiceLines,
  StickyInvoiceBar,
  computeTotals,
  emptyLine,
  filledLines,
  serialList,
  toApiLines,
  type LineDraft,
} from '../../../../components/invoice-editor';
import { Empty, Screen } from '../../../../components/screen';
import { ApiError, apiData, apiErrorText, apiList, apiPost } from '../../../../lib/api';
import {
  arabicName,
  branchOptions,
  defaultOf,
  listBranches,
  listCostCenters,
  listItems,
  listParties,
  listTaxGroups,
  listUnits,
  listWarehouses,
  partyLabel,
  today,
  type Branch,
  type CostCenter,
  type Item,
  type Party,
  type TaxGroup,
  type Unit,
  type Warehouse,
} from '../../../../lib/lookups';
import { SERIAL_MESSAGES, decideSerial, type SerialLookup } from '../../../../lib/serial-numbers';
import { useSession } from '../../../../lib/session';
import { useQuery } from '../../../../lib/use-query';

type PurchaseInvoiceSummary = {
  id: string;
  number?: string | null;
  kind?: string | null;
  status: string;
  partyId: string;
  total?: string | null;
  supplierReferenceNo: string | null;
};
type PurchaseInvoiceDetail = {
  partyId?: string | null;
  branchId?: string | null;
  warehouseId?: string | null;
  priceIncludesVat?: boolean | null;
  lines?: Array<{
    itemId?: string | null;
    description?: string | null;
    quantity?: string | null;
    unitPrice?: string | null;
    discountRate?: string | null;
    taxRate?: string | null;
    taxGroupId?: string | null;
  }>;
};

function PurchaseInvoiceForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedKind: 'purchase' | 'purchase_return' =
    searchParams.get('kind') === 'purchase_return' ? 'purchase_return' : 'purchase';

  const { can } = useSession();
  const branches = useQuery<Branch[]>(() => listBranches(), []);
  const warehouses = useQuery<Warehouse[]>(() => listWarehouses(), []);
  const suppliers = useQuery<Party[]>(() => listParties('supplier'), []);
  const items = useQuery<Item[]>(() => listItems(), []);
  const taxGroups = useQuery<TaxGroup[]>(() => listTaxGroups(), []);
  const units = useQuery<Unit[]>(() => listUnits(), []);
  const invoices = useQuery<PurchaseInvoiceSummary[]>(() => apiList('/purchase-invoices'), []);
  const costCenters = useQuery<CostCenter[]>(() => listCostCenters(), []);

  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [kind, setKind] = useState<'purchase' | 'purchase_return'>(requestedKind);
  const [referenceInvoiceId, setReferenceInvoiceId] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [costCenterId, setCostCenterId] = useState('');
  const [supplierRefDate, setSupplierRefDate] = useState(today());
  const [includesVat, setIncludesVat] = useState(false);
  const [allocation, setAllocation] = useState<'value' | 'qty'>('value');
  const [invoiceDiscountText, setInvoiceDiscountText] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const [serialQuery, setSerialQuery] = useState('');
  const [showExtras, setShowExtras] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'warn' | 'danger'; text: string } | undefined>();

  // Keep `kind` synchronized when navigating via sidebar between Purchase Invoice and Purchase Return
  useEffect(() => {
    setKind(requestedKind);
    if (requestedKind === 'purchase') {
      setReferenceInvoiceId('');
    }
  }, [requestedKind]);

  const branchRows = branches.data ?? [];
  const warehouseRows = warehouses.data ?? [];
  const supplierRows = suppliers.data ?? [];
  const defaultSupplier =
    supplierRows.find((row) => row.code === 'SUPP-GEN' || row.name === 'مورد عام') ?? supplierRows[0];
  const effectivePartyId = partyId || defaultSupplier?.id || '';
  const effectiveBranch = branchId || defaultOf(branchRows)?.id || '';
  const effectiveWarehouse =
    warehouseId ||
    defaultOf(warehouseRows.filter((row) => !effectiveBranch || row.branchId === effectiveBranch))?.id ||
    '';
  const totals = computeTotals(lines, {
    priceIncludesVat: includesVat,
    invoiceDiscount: invoiceDiscountText,
  });
  const duplicateRef =
    supplierRef.trim().length > 0 &&
    (invoices.data ?? []).some((row) => (row.supplierReferenceNo ?? '').trim() === supplierRef.trim());
  const referenceCandidates = (invoices.data ?? []).filter(
    (row) =>
      row.status === 'posted' &&
      (row.kind ?? 'purchase') === 'purchase' &&
      (!partyId || row.partyId === partyId),
  );
  const referenceMissing = kind === 'purchase_return' && !referenceInvoiceId;
  const supplierNameOf = (id: string) => {
    const party = supplierRows.find((row) => row.id === id);
    return party ? partyLabel(party) : '—';
  };
  const hasExtraValues = Boolean(
    supplierRef.trim() || invoiceDiscountText.trim() || costCenterId || includesVat || allocation !== 'value',
  );

  async function pickReference(id: string) {
    setReferenceInvoiceId(id);
    setNotice(undefined);
    if (!id) return;
    try {
      const doc = await apiData<PurchaseInvoiceDetail>(`/purchase-invoices/${id}`);
      if (doc.partyId) setPartyId(doc.partyId);
      if (doc.branchId) setBranchId(doc.branchId);
      if (doc.warehouseId) setWarehouseId(doc.warehouseId);
      setIncludesVat(Boolean(doc.priceIncludesVat));
      const drafted = (doc.lines ?? []).map((line) => ({
        ...emptyLine(line.taxRate != null ? String(Number(line.taxRate)) : '15'),
        itemId: line.itemId ?? '',
        description: line.description ?? '',
        quantityText: String(Number(line.quantity ?? 0)),
        unitPriceText: String(Number(line.unitPrice ?? 0)),
        discountRateText:
          line.discountRate != null && Number(line.discountRate) > 0 ? String(Number(line.discountRate)) : '',
        taxGroupId: line.taxGroupId ?? '',
      }));
      if (drafted.length) setLines(drafted);
    } catch (error) {
      setNotice({ kind: 'warn', text: apiErrorText(error) });
    }
  }

  async function findSerial() {
    const value = serialQuery.trim();
    setNotice(undefined);
    if (!value) {
      setNotice({ kind: 'warn', text: SERIAL_MESSAGES.empty });
      return;
    }
    try {
      const lookup = await apiData<SerialLookup>(
        `/inventory/serials/lookup?serialNo=${encodeURIComponent(value)}`,
      );
      const verdict = decideSerial({ lookup: { ...lookup, serialNo: value }, lines, parse: serialList });
      if (verdict.decision.kind === 'reject') {
        setNotice({ kind: 'warn', text: verdict.decision.text });
        return;
      }
      const decision = verdict.decision;
      const item = (items.data ?? []).find((row) => row.id === decision.itemId);
      const group = item?.taxGroupId
        ? (taxGroups.data ?? []).find((row) => row.id === item.taxGroupId)
        : undefined;
      const base = emptyLine(group ? String(Number(group.rate)) : '15');
      setLines([
        ...lines.filter((line) => line.itemId || line.description.trim() || line.serialText.trim()),
        {
          ...base,
          itemId: decision.itemId,
          unitPriceText: String(item?.purchasePrice ?? item?.purchase_price ?? ''),
          taxGroupId: group?.id ?? '',
          serialText: decision.serialNo,
        },
      ]);
      setSerialQuery('');
    } catch (error) {
      const text =
        error instanceof ApiError && error.status === 403 ? SERIAL_MESSAGES.forbidden : apiErrorText(error);
      setNotice({ kind: 'warn', text });
    }
  }

  async function save(event: React.SyntheticEvent, print = false, autoPost = true) {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      if (filledLines(lines).length === 0)
        throw new ApiError(422, 'VALIDATION_FAILED', 'لا يمكن حفظ الفاتورة بدون أصناف.');
      if (referenceMissing)
        throw new ApiError(
          422,
          'PURCHASE_RETURN_REFERENCE_REQUIRED',
          'اختر فاتورة الشراء المرحَّلة التي يُردّ عليها المردود أولاً.',
        );
      const invoice = await apiPost<{ id: string }>('/purchase-invoices', {
        branchId: effectiveBranch,
        warehouseId: effectiveWarehouse || undefined,
        partyId: effectivePartyId,
        kind,
        referenceInvoiceId: kind === 'purchase_return' ? referenceInvoiceId : undefined,
        supplierReferenceNo: supplierRef.trim() || undefined,
        supplierReferenceDate: supplierRefDate || undefined,
        priceIncludesVat: includesVat,
        invoiceDiscount: invoiceDiscountText.trim() || undefined,
        landedCostAlloc: allocation,
        costCenterId: costCenterId || undefined,
        autoPost,
        lines: toApiLines(lines).map((line) => ({ ...line, itemId: line.itemId })),
      });
      router.push(print ? `/print/purchase-invoice/${invoice.id}` : `/purchases/invoices/${invoice.id}`);
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
      setBusy(false);
    }
  }

  const pageTitle = kind === 'purchase_return' ? 'مردود المشتريات' : 'فاتورة المشتريات';
  const pageSubtitle =
    kind === 'purchase_return'
      ? 'اختر فاتورة الشراء المرحَّلة المرجعية وحدّد الكميات المرتجعة؛ يُرحَّل المردود ويُعدّل المخزون وحساب المورد فوراً.'
      : 'أضف الأصناف وبيانات المورد؛ الإجماليات وأزرار الحفظ والترحيل ظاهرة دائماً أسفل الشاشة.';

  if (!can('purchase.invoice.create')) {
    return (
      <Screen title={pageTitle} crumbs={['المشتريات', 'العمليات']}>
        <Empty
          title="لا تملك صلاحية إنشاء فواتير المشتريات"
          detail="اطلب من مسؤول الحساب منحك صلاحية إنشاء فواتير المشتريات."
        />
      </Screen>
    );
  }

  return (
    <Screen title={pageTitle} subtitle={pageSubtitle} crumbs={['المشتريات', 'العمليات']}>
      <form onSubmit={save} className="invoice-compact-header">
        <Panel
          title={kind === 'purchase_return' ? 'بيانات مردود المشتريات' : 'بيانات فاتورة المشتريات'}
          actions={
            <button
              type="button"
              className="invoice-extra-toggle"
              onClick={() => setShowExtras((prev) => !prev)}
            >
              <span>
                {showExtras ? 'إخفاء الخيارات الإضافية' : 'مرجع المورد · الخصم · التكلفة · التسلسلي'}
                {hasExtraValues ? ' •' : ''}
              </span>
              <ChevronDown size={13} />
            </button>
          }
        >
          <div className="invoice-compact-grid">
            <label className="field">
              <span>النوع</span>
              <select
                className="input"
                value={kind}
                onChange={(event) => {
                  const next = event.target.value as 'purchase' | 'purchase_return';
                  setKind(next);
                  if (next === 'purchase') setReferenceInvoiceId('');
                  router.replace(
                    next === 'purchase_return'
                      ? '/purchases/invoices/new?kind=purchase_return'
                      : '/purchases/invoices/new',
                    { scroll: false },
                  );
                }}
              >
                <option value="purchase">فاتورة مشتريات</option>
                <option value="purchase_return">مردود مشتريات</option>
              </select>
            </label>
            <label className="field">
              <span>اسم المورد *</span>
              <select
                className="input"
                value={effectivePartyId}
                onChange={(event) => setPartyId(event.target.value)}
              >
                {supplierRows.length === 0 && <option value="">مورد عام (الافتراضي)</option>}
                {supplierRows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {partyLabel(row)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>الفرع *</span>
              <select
                className="input"
                value={effectiveBranch}
                onChange={(event) => setBranchId(event.target.value)}
                required
              >
                {branchOptions(branchRows).map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>المستودع</span>
              <select
                className="input"
                value={effectiveWarehouse}
                onChange={(event) => setWarehouseId(event.target.value)}
              >
                <option value="">— بدون حركة مخزنية —</option>
                {warehouseRows
                  .filter((row) => !effectiveBranch || row.branchId === effectiveBranch)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {arabicName(row)}
                    </option>
                  ))}
              </select>
              {filledLines(lines).some((line) => line.itemId) && !effectiveWarehouse && (
                <span className="muted small">ترحيل أصناف مخزنية يتطلب مستودعاً.</span>
              )}
            </label>
          </div>

          {kind === 'purchase_return' && (
            <div style={{ marginTop: 8 }}>
              <label className="field" style={{ marginBottom: 0 }}>
                <span>الفاتورة المرجعية (مشتريات مرحَّلة يُردّ عليها) *</span>
                <select
                  className="input"
                  value={referenceInvoiceId}
                  onChange={(event) => void pickReference(event.target.value)}
                  required
                >
                  <option value="">— اختر فاتورة الشراء الأصلية —</option>
                  {referenceCandidates.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.number ?? row.id} — {supplierNameOf(row.partyId)} —{' '}
                      {Number(row.total ?? 0).toFixed(2)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          {(showExtras || duplicateRef) && (
            <div className="invoice-extra-details">
              <div className="invoice-compact-grid">
                <label className="field">
                  <span>مرجع فاتورة المورد</span>
                  <input
                    className="input"
                    dir="ltr"
                    value={supplierRef}
                    onChange={(event) => setSupplierRef(event.target.value)}
                  />
                  {duplicateRef && (
                    <span className="muted small">عفوآ رقم المرجع موجود مسبقآ هل تريد الاستمرار ؟</span>
                  )}
                </label>
                <label className="field">
                  <span>تاريخ فاتورة المورد</span>
                  <input
                    className="input"
                    type="date"
                    dir="ltr"
                    value={supplierRefDate}
                    onChange={(event) => setSupplierRefDate(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>خصم على الفاتورة</span>
                  <input
                    className="input"
                    dir="ltr"
                    inputMode="decimal"
                    placeholder="0.00"
                    value={invoiceDiscountText}
                    onChange={(event) => setInvoiceDiscountText(event.target.value)}
                  />
                </label>
                <label className="field">
                  <span>مركز التكلفة</span>
                  <select
                    className="input"
                    value={costCenterId}
                    onChange={(event) => setCostCenterId(event.target.value)}
                  >
                    <option value="">— بلا مركز —</option>
                    {(costCenters.data ?? []).map((center) => (
                      <option key={center.id} value={center.id}>
                        {center.code} — {arabicName(center)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>توزيع المصاريف</span>
                  <select
                    className="input"
                    value={allocation}
                    onChange={(event) => setAllocation(event.target.value as 'value' | 'qty')}
                  >
                    <option value="value">بحسب القيمة</option>
                    <option value="qty">بحسب الكمية</option>
                  </select>
                </label>
                <label className="field">
                  <span>الأسعار شاملة الضريبة</span>
                  <span className="row" style={{ minHeight: 38, alignItems: 'center' }}>
                    <input
                      type="checkbox"
                      checked={includesVat}
                      onChange={(event) => setIncludesVat(event.target.checked)}
                    />
                    <span className="muted small">تُستخرج الضريبة من السعر</span>
                  </span>
                </label>
                <label className="field" style={{ gridColumn: 'span 2' }}>
                  <span>إدراج بالرقم التسلسلي:</span>
                  <span className="row">
                    <input
                      className="input"
                      dir="ltr"
                      value={serialQuery}
                      placeholder="امسح الرقم التسلسلي أو اكتبه ثم Enter"
                      onChange={(event) => setSerialQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          void findSerial();
                        }
                      }}
                    />
                    <button className="btn sm" type="button" onClick={() => void findSerial()}>
                      بحث
                    </button>
                  </span>
                </label>
              </div>
            </div>
          )}
        </Panel>

        <Panel title="الأصناف" flush>
          <InvoiceLines
            lines={lines}
            onChange={setLines}
            items={items.data ?? []}
            taxGroups={taxGroups.data ?? []}
            units={units.data ?? []}
            priceField="purchasePrice"
            withNumbers
            costCenters={costCenters.data ?? []}
            priceIncludesVat={includesVat}
            invoiceDiscount={invoiceDiscountText}
          />
        </Panel>

        <Notice notice={notice} />

        <StickyInvoiceBar totals={totals} variant="purchase">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'جارٍ الحفظ والترحيل…' : kind === 'purchase_return' ? 'حفظ وترحيل المردود' : 'حفظ وترحيل'}
          </button>
          <button className="btn" type="button" disabled={busy} onClick={(event) => void save(event, true)}>
            {busy ? 'جارٍ الحفظ…' : 'حفظ وترحيل + طباعة'}
          </button>
          <button
            className="btn"
            type="button"
            disabled={busy}
            onClick={(event) => void save(event, false, false)}
          >
            حفظ كمسودة
          </button>
        </StickyInvoiceBar>
      </form>
    </Screen>
  );
}

export default function NewPurchaseInvoicePage() {
  return (
    <Suspense>
      <PurchaseInvoiceForm />
    </Suspense>
  );
}
