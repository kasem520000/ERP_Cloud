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
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { numberText } from '../../lib/lookups';
import { makkahTodayIso, openServerPrintHtml } from '../../lib/server-print';

type SalesInvoiceRow = Record<string, unknown> & {
  id: string;
  invoiceNo?: string;
  number?: string;
  kind?: string;
  status?: string;
  partyName?: string;
  cashCustomerName?: string | null;
  issueDate?: string;
  createdAt?: string;
  subtotal?: string;
  vatTotal?: string;
  total?: string;
  paidAmount?: string;
};

type LookupItem = { id: string; nameAr: string; sku?: string; salePrice?: string; taxGroupId?: string | null };
type TaxGroup = { id: string; rate: string };
type DraftLine = { itemId: string; quantity: string; unitPrice: string; discountRate: string };

export default function BakerySalesInvoicesPage() {
  const { can } = useSession();
  const canCreate = can('sales.invoice.create');
  const canPost = can('sales.invoice.post');
  const canReturn = can('sales.return.create');
  const canVoid = can('sales.invoice.void');

  const [rows, setRows] = useState<SalesInvoiceRow[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [parties, setParties] = useState<Array<{ id: string; name: string; taxNo?: string | null }>>([]);
  const [items, setItems] = useState<LookupItem[]>([]);
  const [taxes, setTaxes] = useState<TaxGroup[]>([]);
  const [cashLocations, setCashLocations] = useState<Array<{ id: string; name: string; accountId?: string | null }>>(
    [],
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const [createOpen, setCreateOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [cashCustomerName, setCashCustomerName] = useState('عميل عام');
  const [dueDate, setDueDate] = useState(makkahTodayIso());
  const [priceIncludesVat, setPriceIncludesVat] = useState(true);
  const [lines, setLines] = useState<DraftLine[]>([
    { itemId: '', quantity: '1', unitPrice: '0', discountRate: '0' },
  ]);
  const [saving, setSaving] = useState(false);

  const [postTarget, setPostTarget] = useState<SalesInvoiceRow | null>(null);
  const [settlement, setSettlement] = useState<'credit' | 'cash' | 'bank'>('credit');
  const [settlementCashId, setSettlementCashId] = useState('');
  const [voidTarget, setVoidTarget] = useState<SalesInvoiceRow | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, brRes, whRes, prRes, itRes, txRes, clRes] = await Promise.allSettled([
        apiList<SalesInvoiceRow>('/sales/invoices'),
        apiList<{ id: string; nameAr: string }>('/branches'),
        apiList<{ id: string; name: string }>('/warehouses'),
        apiList<{ id: string; name: string; taxNo?: string | null }>('/parties?kind=customer'),
        apiList<LookupItem>('/organization/catalog/items'),
        apiList<TaxGroup>('/organization/catalog/tax-groups'),
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
      if (prRes.status === 'fulfilled') setParties(prRes.value);
      if (itRes.status === 'fulfilled') setItems(itRes.value);
      if (txRes.status === 'fulfilled') setTaxes(txRes.value);
      if (clRes.status === 'fulfilled') {
        setCashLocations(clRes.value);
        setSettlementCashId((prev) => prev || clRes.value[0]?.id || '');
      }
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر تحميل فواتير المبيعات'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      if (!q) return true;
      const num = String(row.invoiceNo ?? row.number ?? '').toLowerCase();
      const customer = String(row.partyName ?? row.cashCustomerName ?? '').toLowerCase();
      return num.includes(q) || customer.includes(q);
    });
  }, [rows, search, statusFilter]);

  const summary = useMemo(() => {
    let postedTotal = new Decimal(0);
    let draftCount = 0;
    for (const r of rows) {
      if (r.status === 'posted') postedTotal = postedTotal.plus(new Decimal(String(r.total ?? '0')));
      if (r.status === 'draft') draftCount += 1;
    }
    return { totalCount: rows.length, draftCount, postedTotal: postedTotal.toFixed(2) };
  }, [rows]);

  const submitCreate = async () => {
    const valid = lines.filter((l) => l.itemId && new Decimal(l.quantity || '0').gt(0));
    if (!branchId || !warehouseId || valid.length === 0) {
      setNotice({ tone: 'danger', text: 'اختر الفرع والمستودع وأضف سطراً واحداً صحيحاً على الأقل.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/sales/invoices', {
        branchId,
        warehouseId,
        orderType: 'counter',
        priceIncludesVat,
        ...(dueDate ? { dueDate } : {}),
        ...(partyId ? { partyId } : { cashCustomerName: cashCustomerName.trim() || 'عميل عام' }),
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
      setNotice({ tone: 'ok', text: 'تم حفظ مسودة فاتورة المبيعات — يمكنك ترحيلها أو طباعتها.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إنشاء الفاتورة') });
    } finally {
      setSaving(false);
    }
  };

  const confirmPost = async () => {
    if (!postTarget) return;
    setSaving(true);
    try {
      const cashLoc = cashLocations.find((c) => c.id === settlementCashId);
      await apiPost(`/sales/invoices/${encodeURIComponent(postTarget.id)}/post`, {
        settlement,
        ...(settlement !== 'credit' && settlementCashId ? { settlementCashLocationId: settlementCashId } : {}),
        ...(settlement !== 'credit' && cashLoc?.accountId ? { settlementAccountId: cashLoc.accountId } : {}),
      });
      setPostTarget(null);
      setNotice({ tone: 'ok', text: 'تم ترحيل فاتورة المبيعات وتوليد القيد المحاسبي بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر ترحيل الفاتورة') });
    } finally {
      setSaving(false);
    }
  };

  const createFullReturn = async (invoice: SalesInvoiceRow) => {
    setSaving(true);
    try {
      const detail = await apiData<{
        lines?: Array<{ id?: string; itemId: string; quantity: string; unitPrice: string }>;
      }>(`/sales/invoices/${encodeURIComponent(invoice.id)}`);
      const retLines = (detail.lines ?? []).map((l) => ({
        ...(l.id ? { invoiceLineId: l.id } : {}),
        itemId: l.itemId,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
      }));
      await apiPost(`/sales/invoices/${encodeURIComponent(invoice.id)}/return`, {
        reason: 'مرتجع مبيعات معتمد',
        lines: retLines,
      });
      setNotice({ tone: 'ok', text: 'تم إنشاء إشعار دائن بمرتجع المبيعات بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر تسجيل مرتجع المبيعات') });
    } finally {
      setSaving(false);
    }
  };

  const confirmVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    setSaving(true);
    try {
      await apiPost(`/sales/invoices/${encodeURIComponent(voidTarget.id)}/void`, {
        reason: voidReason.trim(),
      });
      setVoidTarget(null);
      setVoidReason('');
      setNotice({ tone: 'ok', text: 'تم إبطال الفاتورة وتوثيق السبب.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إبطال الفاتورة') });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<SalesInvoiceRow>[] = [
    {
      key: 'invoiceNo',
      header: 'رقم الفاتورة',
      ltr: true,
      cell: (r) => String(r.invoiceNo ?? r.number ?? r.id.slice(0, 8)),
    },
    {
      key: 'customer',
      header: 'العميل',
      cell: (r) => String(r.partyName ?? r.cashCustomerName ?? 'عميل عام'),
    },
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
        <Badge
          status={
            r.status === 'posted'
              ? 'active'
              : r.status === 'draft'
                ? 'pending'
                : 'rejected'
          }
        >
          {r.status === 'posted' ? 'مرحَّلة' : r.status === 'draft' ? 'مسودة' : String(r.status ?? '—')}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: 'الإجمالي (ر.س)',
      numeric: true,
      cell: (r) => numberText(String(r.total ?? '0')),
    },
    {
      key: 'actions',
      header: 'إجراءات وطباعة',
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          <Button
            onClick={() =>
              void openServerPrintHtml(`/reports/print/invoices/${encodeURIComponent(r.id)}`)
            }
            size="sm"
          >
            طباعة A4
          </Button>
          <Button
            onClick={() =>
              void openServerPrintHtml(`/reports/print/invoices/${encodeURIComponent(r.id)}?paper=small`)
            }
            size="sm"
          >
            إيصال 80 مم
          </Button>
          {r.status === 'draft' && canPost ? (
            <Button onClick={() => setPostTarget(r)} size="sm" variant="primary">
              ترحيل
            </Button>
          ) : null}
          {r.status === 'posted' && canReturn ? (
            <Button onClick={() => void createFullReturn(r)} size="sm">
              مرتجع
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
          <h1 className="ui-page-title">فواتير المبيعات الضريبية</h1>
          <p className="ui-page-sub">
            إصدار وترحيل فواتير المبيعات الضريبية والمبسطة وطباعتها بقالب A4 أو إيصال الكاشير مع رمز الاستجابة الضريبي.
          </p>
        </div>
        <div className="ui-page-actions">
          {canCreate ? (
            <Button onClick={() => setCreateOpen(true)} variant="primary">
              + فاتورة مبيعات جديدة
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
          <Kpi title="إجمالي الفواتير" tone="brand" value={String(summary.totalCount)} />
          <Kpi title="مسودات بانتظار الترحيل" tone="warn" value={String(summary.draftCount)} />
          <Kpi title="إجمالي المبيعات المرحَّلة" tone="ok" value={`${numberText(summary.postedTotal)} ر.س`} />
        </div>

        <Card>
          <CardHeader subtitle="ابحث برقم الفاتورة أو اسم العميل، أو صفِّ حسب حالة المستند." title="سجل فواتير المبيعات" />
          <CardBody>
            <div className="mb-3 grid gap-2 sm:grid-cols-2">
              <Input
                label="بحث سريع"
                onChange={(e) => setSearch(e.target.value)}
                placeholder="رقم الفاتورة أو العميل…"
                value={search}
              />
              <Select
                label="الحالة"
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: 'all', label: 'الكل' },
                  { value: 'draft', label: 'مسودة' },
                  { value: 'posted', label: 'مرحَّلة' },
                  { value: 'void', label: 'ملغاة' },
                ]}
                value={statusFilter}
              />
            </div>

            <DataTable
              columns={columns}
              empty="لا فواتير مبيعات مطابقة"
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
        title="إنشاء مسودة فاتورة مبيعات"
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
              label="المستودع"
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
              label="العميل"
              onChange={(e) => setPartyId(e.target.value)}
              options={[
                { value: '', label: 'عميل نقدي عام' },
                ...parties.map((p) => ({
                  value: p.id,
                  label: p.taxNo ? `${p.name} (ضريبي: ${p.taxNo})` : p.name,
                })),
              ]}
              value={partyId}
            />
            {!partyId ? (
              <Input
                label="اسم العميل النقدي"
                onChange={(e) => setCashCustomerName(e.target.value)}
                value={cashCustomerName}
              />
            ) : (
              <Input
                label="تاريخ الاستحقاق"
                onChange={(e) => setDueDate(e.target.value)}
                type="date"
                value={dueDate}
              />
            )}
          </div>
          <label className="flex items-center gap-2 text-[12.5px] font-semibold">
            <input
              checked={priceIncludesVat}
              onChange={(e) => setPriceIncludesVat(e.target.checked)}
              type="checkbox"
            />
            الأسعار شاملة ضريبة القيمة المضافة
          </label>

          {lines.map((line, idx) => (
            <div className="grid gap-2 rounded-lg border border-line p-2.5 sm:grid-cols-4" key={idx}>
              <Select
                label="الصنف"
                onChange={(e) => {
                  const found = items.find((i) => i.id === e.target.value);
                  setLines((prev) =>
                    prev.map((l, i) =>
                      i === idx
                        ? { ...l, itemId: e.target.value, unitPrice: found?.salePrice ?? l.unitPrice }
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
                label="السعر"
                onChange={(e) =>
                  setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, unitPrice: e.target.value } : l)))
                }
                value={line.unitPrice}
              />
              <Input
                inputMode="decimal"
                label="خصم %"
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

      <Modal
        onClose={() => setPostTarget(null)}
        open={Boolean(postTarget)}
        title="ترحيل فاتورة المبيعات"
      >
        <div className="grid gap-3">
          <Select
            label="طريقة التسوية"
            onChange={(e) => setSettlement(e.target.value as typeof settlement)}
            options={[
              { value: 'credit', label: 'آجل على ذمّة العميل' },
              { value: 'cash', label: 'نقدي في الصندوق' },
              { value: 'bank', label: 'تحويل / شبكة في البنك' },
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

      <Modal
        onClose={() => setVoidTarget(null)}
        open={Boolean(voidTarget)}
        title="إبطال فاتورة المبيعات"
      >
        <div className="grid gap-3">
          <Input
            label="سبب الإبطال (إلزامي)"
            onChange={(e) => setVoidReason(e.target.value)}
            placeholder="دوّن سبب الإبطال بدقة…"
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
