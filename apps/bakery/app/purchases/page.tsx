'use client';

import Decimal from 'decimal.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Input,
  Kpi,
  Modal,
  Select,
  type Column,
} from '@erp/ui';
import { apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { numberText } from '../../lib/lookups';
import { makkahTodayIso, openServerPrintHtml } from '../../lib/server-print';

type PurchaseInvoiceRow = Record<string, unknown> & {
  id: string;
  invoiceNo?: string;
  number?: string;
  kind?: string;
  status?: string;
  partyName?: string;
  supplierReferenceNo?: string | null;
  issueDate?: string;
  createdAt?: string;
  total?: string;
};

type CatalogItem = { id: string; nameAr: string; purchasePrice?: string; taxGroupId?: string | null };
type PurchaseLine = { itemId: string; quantity: string; unitPrice: string; discountRate: string };

export default function BakeryPurchasesPage() {
  const { can } = useSession();
  const canCreate = can('purchase.invoice.create');
  const canPost = can('purchase.invoice.post');
  const canVoid = can('purchase.invoice.void');

  const [rows, setRows] = useState<PurchaseInvoiceRow[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [suppliers, setSuppliers] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [taxes, setTaxes] = useState<Array<{ id: string; rate: string }>>([]);
  const [cashLocations, setCashLocations] = useState<Array<{ id: string; name: string; accountId?: string | null }>>(
    [],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [search, setSearch] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [isReturn, setIsReturn] = useState(false);
  const [referenceInvoiceId, setReferenceInvoiceId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [supplierRef, setSupplierRef] = useState('');
  const [dueDate, setDueDate] = useState(makkahTodayIso());
  const [priceIncludesVat, setPriceIncludesVat] = useState(false);
  const [lines, setLines] = useState<PurchaseLine[]>([
    { itemId: '', quantity: '1', unitPrice: '0', discountRate: '0' },
  ]);
  const [saving, setSaving] = useState(false);

  const [postTarget, setPostTarget] = useState<PurchaseInvoiceRow | null>(null);
  const [settlement, setSettlement] = useState<'credit' | 'cash' | 'bank'>('credit');
  const [settlementCashId, setSettlementCashId] = useState('');
  const [voidTarget, setVoidTarget] = useState<PurchaseInvoiceRow | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, brRes, whRes, spRes, itRes, txRes, clRes] = await Promise.allSettled([
        apiList<PurchaseInvoiceRow>('/purchase-invoices'),
        apiList<{ id: string; nameAr: string }>('/branches'),
        apiList<{ id: string; name: string }>('/warehouses'),
        apiList<{ id: string; name: string }>('/parties?kind=supplier'),
        apiList<CatalogItem>('/organization/catalog/items'),
        apiList<{ id: string; rate: string }>('/organization/catalog/tax-groups'),
        apiList<{ id: string; name: string; accountId?: string | null }>('/cash-locations?limit=200'),
      ]);
      if (invRes.status === 'fulfilled') setRows(invRes.value);
      else throw invRes.reason;
      if (brRes.status === 'fulfilled') {
        setBranches(brRes.value);
        setBranchId((prev) => prev || brRes.value[0]?.id || '');
      }
      if (whRes.status === 'fulfilled') {
        setWarehouses(whRes.value);
        setWarehouseId((prev) => prev || whRes.value[0]?.id || '');
      }
      if (spRes.status === 'fulfilled') {
        setSuppliers(spRes.value);
        setPartyId((prev) => prev || spRes.value[0]?.id || '');
      }
      if (itRes.status === 'fulfilled') setItems(itRes.value);
      if (txRes.status === 'fulfilled') setTaxes(txRes.value);
      if (clRes.status === 'fulfilled') {
        setCashLocations(clRes.value);
        setSettlementCashId((prev) => prev || clRes.value[0]?.id || '');
      }
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر تحميل فواتير المشتريات'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        String(r.invoiceNo ?? r.number ?? '').toLowerCase().includes(q) ||
        String(r.partyName ?? '').toLowerCase().includes(q) ||
        String(r.supplierReferenceNo ?? '').toLowerCase().includes(q),
    );
  }, [rows, search]);

  const totals = useMemo(() => {
    let posted = new Decimal(0);
    let drafts = 0;
    for (const r of rows) {
      if (r.status === 'posted') posted = posted.plus(new Decimal(String(r.total ?? '0')));
      if (r.status === 'draft') drafts += 1;
    }
    return { count: rows.length, drafts, posted: posted.toFixed(2) };
  }, [rows]);

  const submitCreate = async () => {
    const valid = lines.filter((l) => l.itemId && new Decimal(l.quantity || '0').gt(0));
    if (!branchId || !partyId || valid.length === 0) {
      setNotice({ tone: 'danger', text: 'اختر الفرع والمورد وأضف سطراً واحداً على الأقل.' });
      return;
    }
    if (isReturn && !referenceInvoiceId) {
      setNotice({ tone: 'danger', text: 'مرتجع المشتريات يتطلب اختيار فاتورة المشتريات الأصلية.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/purchase-invoices', {
        branchId,
        partyId,
        priceIncludesVat,
        ...(warehouseId ? { warehouseId } : {}),
        ...(dueDate ? { dueDate } : {}),
        ...(supplierRef.trim() ? { supplierReferenceNo: supplierRef.trim() } : {}),
        ...(isReturn ? { kind: 'purchase_return', referenceInvoiceId } : {}),
        lines: valid.map((l) => {
          const item = items.find((i) => i.id === l.itemId);
          const taxRate = taxes.find((t) => t.id === item?.taxGroupId)?.rate ?? '15';
          return {
            itemId: l.itemId,
            quantity: new Decimal(l.quantity || '0').toString(),
            unitPrice: new Decimal(l.unitPrice || '0').toString(),
            discountRate: new Decimal(l.discountRate || '0').toString(),
            taxRate,
          };
        }),
      });
      setCreateOpen(false);
      setLines([{ itemId: '', quantity: '1', unitPrice: '0', discountRate: '0' }]);
      setNotice({
        tone: 'ok',
        text: 'تم حفظ المسودة بطريقة الصافي للخصم — الترحيل يحرّك المخزون وذمة المورد.',
      });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ فاتورة المشتريات') });
    } finally {
      setSaving(false);
    }
  };

  const confirmPost = async () => {
    if (!postTarget) return;
    setSaving(true);
    try {
      const cashLoc = cashLocations.find((c) => c.id === settlementCashId);
      await apiPost(`/purchase-invoices/${encodeURIComponent(postTarget.id)}/post`, {
        settlement,
        ...(settlement !== 'credit' && settlementCashId ? { settlementCashLocationId: settlementCashId } : {}),
        ...(settlement !== 'credit' && cashLoc?.accountId ? { settlementAccountId: cashLoc.accountId } : {}),
      });
      setPostTarget(null);
      setNotice({ tone: 'ok', text: 'تم ترحيل فاتورة المشتريات وإدخال البضاعة للمستودع.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر ترحيل فاتورة المشتريات') });
    } finally {
      setSaving(false);
    }
  };

  const confirmVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    setSaving(true);
    try {
      await apiPost(`/purchase-invoices/${encodeURIComponent(voidTarget.id)}/void`, {
        reason: voidReason.trim(),
      });
      setVoidTarget(null);
      setVoidReason('');
      setNotice({ tone: 'ok', text: 'تم إبطال فاتورة المشتريات.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إبطال الفاتورة') });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<PurchaseInvoiceRow>[] = [
    {
      key: 'invoiceNo',
      header: 'رقم المستند',
      ltr: true,
      cell: (r) => String(r.invoiceNo ?? r.number ?? r.id.slice(0, 8)),
    },
    {
      key: 'kind',
      header: 'النوع',
      cell: (r) => (r.kind === 'purchase_return' ? 'مرتجع مشتريات' : 'فاتورة شراء'),
    },
    { key: 'partyName', header: 'المورد', cell: (r) => String(r.partyName ?? '—') },
    {
      key: 'date',
      header: 'التاريخ',
      ltr: true,
      cell: (r) => String(r.issueDate ?? r.createdAt ?? '').slice(0, 10) || '—',
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (
        <Badge status={r.status === 'posted' ? 'active' : r.status === 'draft' ? 'pending' : 'rejected'}>
          {r.status === 'posted' ? 'مرحَّلة' : r.status === 'draft' ? 'مسودة' : String(r.status ?? '—')}
        </Badge>
      ),
    },
    { key: 'total', header: 'الإجمالي (ر.س)', numeric: true, cell: (r) => numberText(String(r.total ?? '0')) },
    {
      key: 'actions',
      header: 'إجراءات',
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          <Button
            onClick={() =>
              void openServerPrintHtml(`/reports/print/purchase-invoices/${encodeURIComponent(r.id)}`)
            }
            size="sm"
          >
            طباعة A4
          </Button>
          {r.status === 'draft' && canPost ? (
            <Button onClick={() => setPostTarget(r)} size="sm" variant="primary">
              ترحيل
            </Button>
          ) : null}
          {r.status !== 'void' && r.status !== 'voided' && canVoid ? (
            <Button onClick={() => setVoidTarget(r)} size="sm">
              إبطال
            </Button>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">فواتير المشتريات ومرتجعاتها</h1>
          <p className="ui-page-sub">
            توريد المواد الخام والدقيق ومستلزمات الإنتاج بطريقة الصافي للخصم وترحيلها للمستودع والأستاذ العام.
          </p>
        </div>
        <div className="ui-page-actions">
          {canCreate ? (
            <Button
              onClick={() => {
                setIsReturn(false);
                setCreateOpen(true);
              }}
              variant="primary"
            >
              + فاتورة شراء جديدة
            </Button>
          ) : null}
          {canCreate ? (
            <Button
              onClick={() => {
                setIsReturn(true);
                setCreateOpen(true);
              }}
              size="sm"
            >
              + مرتجع مشتريات
            </Button>
          ) : null}
          <Button onClick={() => void load()} size="sm">
            تحديث
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        {notice ? (
          <Card>
            <CardBody>
              <Badge status={notice.tone === 'ok' ? 'active' : 'rejected'}>{notice.text}</Badge>
            </CardBody>
          </Card>
        ) : null}

        <div className="ui-kpi-grid">
          <Kpi title="إجمالي المستندات" tone="brand" value={String(totals.count)} />
          <Kpi title="مسودات غير مرحَّلة" tone="warn" value={String(totals.drafts)} />
          <Kpi title="المشتريات المرحَّلة" tone="ok" value={`${numberText(totals.posted)} ر.س`} />
        </div>

        <Card>
          <CardHeader subtitle="بحث برقم الفاتورة أو اسم المورد أو مرجع المورد." title="دفتر المشتريات" />
          <CardBody>
            <div className="mb-3 max-w-md">
              <Input label="بحث سريع" onChange={(e) => setSearch(e.target.value)} value={search} />
            </div>
            <DataTable
              columns={columns}
              empty="لا فواتير مشتريات مسجّلة"
              rows={filtered}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal
        onClose={() => setCreateOpen(false)}
        open={createOpen}
        title={isReturn ? 'إنشاء مرتجع مشتريات' : 'إنشاء فاتورة مشتريات جديدة'}
      >
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="الفرع"
              onChange={(e) => setBranchId(e.target.value)}
              options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
              value={branchId}
            />
            <Select
              label="المستودع المستلم"
              onChange={(e) => setWarehouseId(e.target.value)}
              options={warehouses.map((w) => ({
                value: w.id,
                label: w.name === 'Main Warehouse' ? 'المستودع الرئيسي' : w.name,
              }))}
              value={warehouseId}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="المورد"
              onChange={(e) => setPartyId(e.target.value)}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              value={partyId}
            />
            <Input
              label="رقم فاتورة المورد"
              onChange={(e) => setSupplierRef(e.target.value)}
              value={supplierRef}
            />
          </div>
          {isReturn ? (
            <Select
              label="فاتورة المشتريات الأصلية (المرحَّلة)"
              onChange={(e) => setReferenceInvoiceId(e.target.value)}
              options={[
                { value: '', label: 'اختر الفاتورة الأصلية…' },
                ...rows
                  .filter((r) => r.status === 'posted' && r.kind !== 'purchase_return')
                  .map((r) => ({ value: r.id, label: String(r.invoiceNo ?? r.number ?? r.id) })),
              ]}
              value={referenceInvoiceId}
            />
          ) : null}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input label="تاريخ الاستحقاق" onChange={(e) => setDueDate(e.target.value)} type="date" value={dueDate} />
            <label className="flex items-center gap-2 pt-5 text-[12.5px] font-semibold">
              <input
                checked={priceIncludesVat}
                onChange={(e) => setPriceIncludesVat(e.target.checked)}
                type="checkbox"
              />
              أسعار المورد شاملة الضريبة
            </label>
          </div>

          {lines.map((line, idx) => (
            <div className="grid gap-2 rounded-lg border border-line p-2.5 sm:grid-cols-4" key={idx}>
              <Select
                label="الصنف"
                onChange={(e) => {
                  const found = items.find((i) => i.id === e.target.value);
                  setLines((prev) =>
                    prev.map((l, i) =>
                      i === idx
                        ? { ...l, itemId: e.target.value, unitPrice: found?.purchasePrice ?? l.unitPrice }
                        : l,
                    ),
                  );
                }}
                options={[
                  { value: '', label: 'اختر الصنف…' },
                  ...items.map((it) => ({ value: it.id, label: it.nameAr })),
                ]}
                value={line.itemId}
              />
              <Input
                inputMode="decimal"
                label="الكمية"
                onChange={(e) =>
                  setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, quantity: e.target.value } : l)))
                }
                value={line.quantity}
              />
              <Input
                inputMode="decimal"
                label="تكلفة الوحدة"
                onChange={(e) =>
                  setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, unitPrice: e.target.value } : l)))
                }
                value={line.unitPrice}
              />
              <Input
                inputMode="decimal"
                label="خصم % (صافي)"
                onChange={(e) =>
                  setLines((prev) =>
                    prev.map((l, i) => (i === idx ? { ...l, discountRate: e.target.value } : l)),
                  )
                }
                value={line.discountRate}
              />
            </div>
          ))}
          <div className="flex flex-wrap justify-between gap-2">
            <Button
              onClick={() =>
                setLines((prev) => [...prev, { itemId: '', quantity: '1', unitPrice: '0', discountRate: '0' }])
              }
              size="sm"
            >
              + إضافة سطر
            </Button>
            <div className="flex gap-2">
              <Button onClick={() => setCreateOpen(false)} size="sm">
                إلغاء
              </Button>
              <Button disabled={saving} onClick={() => void submitCreate()} variant="primary">
                {saving ? 'جارٍ الحفظ…' : 'حفظ المسودة'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setPostTarget(null)} open={Boolean(postTarget)} title="ترحيل فاتورة المشتريات">
        <div className="grid gap-3">
          <Select
            label="طريقة التسوية"
            onChange={(e) => setSettlement(e.target.value as typeof settlement)}
            options={[
              { value: 'credit', label: 'آجل في ذمّة المورد' },
              { value: 'cash', label: 'سداد نقدي من الصندوق' },
              { value: 'bank', label: 'سداد بنكي' },
            ]}
            value={settlement}
          />
          {settlement !== 'credit' ? (
            <Select
              label="الصندوق / البنك"
              onChange={(e) => setSettlementCashId(e.target.value)}
              options={cashLocations.map((c) => ({ value: c.id, label: c.name }))}
              value={settlementCashId}
            />
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPostTarget(null)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void confirmPost()} variant="primary">
              {saving ? 'جارٍ الترحيل…' : 'تأكيد الترحيل'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setVoidTarget(null)} open={Boolean(voidTarget)} title="إبطال فاتورة مشتريات">
        <div className="grid gap-3">
          <Input
            label="سبب الإبطال (إلزامي)"
            onChange={(e) => setVoidReason(e.target.value)}
            value={voidReason}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setVoidTarget(null)} size="sm">
              تراجع
            </Button>
            <Button disabled={saving || !voidReason.trim()} onClick={() => void confirmVoid()} variant="primary">
              تأكيد الإبطال
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
