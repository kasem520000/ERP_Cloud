'use client';

import Decimal from 'decimal.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Kpi,
  Panel,
  Select,
} from '@erp/ui';
import { apiData, apiErrorText, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { numberText } from '../../lib/lookups';
import { openServerPrintHtml } from '../../lib/server-print';

type PosItem = {
  id: string;
  sku?: string;
  barcode?: string | null;
  nameAr: string;
  categoryId?: string | null;
  salePrice?: string;
  taxGroupId?: string | null;
  showInPos?: boolean;
};

type PosOfflinePayload = {
  items?: PosItem[];
  categories?: Array<{ id: string; nameAr: string }>;
  taxes?: Array<{ id: string; nameAr?: string; rate: string }>;
  branches?: Array<{ id: string; nameAr: string }>;
  warehouses?: Array<{ id: string; name: string; branchId?: string | null; isDefault?: boolean }>;
  cashLocations?: Array<{ id: string; name: string; kind: string; branchId?: string | null }>;
  customers?: Array<{ id: string; name: string; taxNo?: string | null }>;
  defaults?: { branchId?: string | null; warehouseId?: string | null; cashLocationId?: string | null };
};

type CartLine = {
  item: PosItem;
  qty: string;
  unitPrice: string;
};

function localizeWarehouseName(name: string): string {
  const clean = name.trim().toLowerCase();
  if (clean === 'main warehouse' || clean === 'default warehouse' || clean === 'main branch') {
    return 'المستودع الرئيسي';
  }
  return name;
}

export default function BakeryPosPage() {
  const { can } = useSession();
  const canOperate = can('pos.operate');
  const canOpenShift = can('treasury.shift.close');

  const [pos, setPos] = useState<PosOfflinePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger' | 'warn'; text: string } | null>(null);

  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [cashLocationId, setCashLocationId] = useState('');
  const [partyId, setPartyId] = useState('');
  const [cashCustomerName, setCashCustomerName] = useState('عميل عام');
  const [method, setMethod] = useState<'cash' | 'card' | 'transfer' | 'credit'>('cash');
  const [priceIncludesVat, setPriceIncludesVat] = useState(true);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<{ id: string; invoiceNo: string; total: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiData<PosOfflinePayload>('/pos/offline-data');
      setPos(data);
      const defaultBranch = data.defaults?.branchId ?? data.branches?.[0]?.id ?? '';
      const defaultWh =
        data.defaults?.warehouseId ??
        data.warehouses?.find((w) => w.isDefault)?.id ??
        data.warehouses?.[0]?.id ??
        '';
      const defaultCash =
        data.defaults?.cashLocationId ??
        data.cashLocations?.find((c) => c.kind === 'safe')?.id ??
        data.cashLocations?.[0]?.id ??
        '';
      setBranchId((prev) => prev || defaultBranch);
      setWarehouseId((prev) => prev || defaultWh);
      setCashLocationId((prev) => prev || defaultCash);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر تحميل بيانات نقطة البيع'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const taxRateFor = useCallback(
    (taxGroupId?: string | null) => {
      if (!taxGroupId) return new Decimal(0);
      const found = pos?.taxes?.find((t) => t.id === taxGroupId);
      return found ? new Decimal(found.rate || '0') : new Decimal(0);
    },
    [pos?.taxes],
  );

  const visibleItems = useMemo(() => {
    const items = pos?.items ?? [];
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (categoryId && item.categoryId !== categoryId) return false;
      if (!q) return true;
      return (
        item.nameAr.toLowerCase().includes(q) ||
        (item.sku ?? '').toLowerCase().includes(q) ||
        (item.barcode ?? '').toLowerCase().includes(q)
      );
    });
  }, [pos?.items, query, categoryId]);

  const totals = useMemo(() => {
    let net = new Decimal(0);
    let vat = new Decimal(0);
    let gross = new Decimal(0);
    for (const line of cart) {
      const qty = new Decimal(line.qty || '0');
      const unitPriceDec = new Decimal(line.unitPrice || '0');
      if (qty.lte(0) || unitPriceDec.lt(0)) continue;
      const raw = qty.mul(unitPriceDec);
      const taxRateDec = taxRateFor(line.item.taxGroupId).div(100);
      if (priceIncludesVat && taxRateDec.gt(0)) {
        const lineNet = raw.div(taxRateDec.plus(1));
        const lineVat = raw.minus(lineNet);
        net = net.plus(lineNet);
        vat = vat.plus(lineVat);
        gross = gross.plus(raw);
      } else {
        const lineVat = raw.mul(taxRateDec);
        net = net.plus(raw);
        vat = vat.plus(lineVat);
        gross = gross.plus(raw.plus(lineVat));
      }
    }
    return {
      net: net.toFixed(2),
      vat: vat.toFixed(2),
      gross: gross.toFixed(2),
    };
  }, [cart, priceIncludesVat, taxRateFor]);

  const addItem = (item: PosItem) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.item.id === item.id);
      if (idx === -1) {
        return [...prev, { item, qty: '1', unitPrice: item.salePrice ?? '0' }];
      }
      const next = [...prev];
      const existing = next[idx]!;
      next[idx] = { ...existing, qty: new Decimal(existing.qty || '0').plus(1).toString() };
      return next;
    });
  };

  const openShiftNow = async () => {
    if (!branchId || !cashLocationId) {
      setNotice({ tone: 'warn', text: 'اختر الفرع والصندوق أولاً لفتح الوردية.' });
      return;
    }
    try {
      await apiPost('/shift-closes/open', {
        branchId,
        cashLocationId,
        openingCash: '0',
      });
      setNotice({ tone: 'ok', text: 'فُتحت وردية الكاشير بنجاح — يمكنك إتمام البيع الآن.' });
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر فتح وردية الكاشير') });
    }
  };

  const submitCheckout = async () => {
    if (!cart.length) {
      setNotice({ tone: 'warn', text: 'أضف صنفاً واحداً على الأقل إلى السلة.' });
      return;
    }
    if (!branchId || !warehouseId) {
      setNotice({ tone: 'warn', text: 'الفرع والمستودع إلزاميان لإتمام عملية البيع.' });
      return;
    }
    if (method === 'credit' && !partyId) {
      setNotice({ tone: 'warn', text: 'البيع الآجل يتطلب اختيار عميل مسجّل.' });
      return;
    }
    setSubmitting(true);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        branchId,
        warehouseId,
        orderType: 'pos',
        priceIncludesVat,
        ...(partyId ? { partyId } : { cashCustomerName: cashCustomerName.trim() || 'عميل عام' }),
        lines: cart.map((line) => ({
          itemId: line.item.id,
          quantity: new Decimal(line.qty || '0').toString(),
          unitPrice: new Decimal(line.unitPrice || '0').toString(),
          taxRate: taxRateFor(line.item.taxGroupId).toString(),
        })),
        payment: {
          method,
          ...(method !== 'credit' && cashLocationId ? { cashLocationId } : {}),
        },
      };
      const receipt = await apiPost<{
        id?: string;
        invoiceId?: string;
        invoiceNo?: string;
        total?: string;
      }>('/pos/checkout', body);
      const createdId = receipt.invoiceId ?? receipt.id ?? '';
      const invNo = receipt.invoiceNo ?? 'فاتورة جديدة';
      setLastInvoice({ id: createdId, invoiceNo: invNo, total: receipt.total ?? totals.gross });
      setCart([]);
      setNotice({ tone: 'ok', text: `تم إصدار وترحيل فاتورة نقطة البيع (${invNo}) بنجاح.` });
      if (createdId) {
        void openServerPrintHtml(`/reports/print/invoices/${encodeURIComponent(createdId)}?paper=small`).catch(
          () => undefined,
        );
      }
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إتمام عملية البيع') });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">نقاط البيع الكاشير</h1>
          <p className="ui-page-sub">
            بيعٌ مباشر من معرض المخبز مع ترحيل فوري للمخزون والخزينة وطباعة إيصال الكاشير الحراري 80 مم.
          </p>
        </div>
        <div className="ui-page-actions">
          {canOpenShift ? (
            <Button onClick={() => void openShiftNow()} size="sm">
              فتح وردية كاشير
            </Button>
          ) : null}
          <Button onClick={() => void load()} size="sm">
            تحديث الأصناف
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        {notice ? (
          <Card>
            <CardBody>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Badge status={notice.tone === 'ok' ? 'active' : notice.tone === 'warn' ? 'pending' : 'rejected'}>
                  {notice.text}
                </Badge>
                {lastInvoice?.id ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      onClick={() =>
                        void openServerPrintHtml(
                          `/reports/print/invoices/${encodeURIComponent(lastInvoice.id)}?paper=small`,
                        )
                      }
                      size="sm"
                    >
                      طباعة إيصال كاشير 80 مم
                    </Button>
                    <Button
                      onClick={() =>
                        void openServerPrintHtml(`/reports/print/invoices/${encodeURIComponent(lastInvoice.id)}`)
                      }
                      size="sm"
                    >
                      طباعة فاتورة A4
                    </Button>
                  </div>
                ) : null}
              </div>
            </CardBody>
          </Card>
        ) : null}

        <div className="ui-kpi-grid">
          <Kpi title="أصناف نقطة البيع" tone="brand" value={String(visibleItems.length)} />
          <Kpi title="بنود السلة الحالية" tone="neutral" value={String(cart.length)} />
          <Kpi title="الضريبة التقديرية" tone="warn" value={`${numberText(totals.vat)} ر.س`} />
          <Kpi title="الإجمالي المستحق" tone="ok" value={`${numberText(totals.gross)} ر.س`} />
        </div>

        {loading ? (
          <Panel title="نقطة البيع" hint="جارٍ تحميل الأصناف والخزائن…">
            <p className="text-[13px] text-muted">يُقرأ كتالوج نقطة البيع من الخادم…</p>
          </Panel>
        ) : error ? (
          <Panel title="تعذّر التحميل" hint={error}>
            <EmptyState
              action={
                <Button onClick={() => void load()} size="sm">
                  إعادة المحاولة
                </Button>
              }
              description={error}
              icon={<span aria-hidden="true">!</span>}
              title="تعذّر تحميل نقطة البيع"
              tone="danger"
            />
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[1.45fr_1fr]">
            <Card>
              <CardHeader subtitle="انقر على الصنف لإضافته مباشرةً إلى السلة." title="كتالوج الأصناف السريع" />
              <CardBody>
                <div className="mb-3 grid gap-2 sm:grid-cols-2">
                  <Input
                    label="بحث بالاسم أو الباركود"
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="خبز صامولي، توست، باركود…"
                    value={query}
                  />
                  <Select
                    label="الفئة"
                    onChange={(e) => setCategoryId(e.target.value)}
                    options={[
                      { value: '', label: 'كل الفئات' },
                      ...(pos?.categories ?? []).map((c) => ({ value: c.id, label: c.nameAr })),
                    ]}
                    value={categoryId}
                  />
                </div>

                {visibleItems.length === 0 ? (
                  <EmptyState
                    description="لا توجد أصناف مطابقة للبحث الحالي."
                    icon={<span aria-hidden="true">⌕</span>}
                    title="لا أصناف"
                  />
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {visibleItems.map((item) => (
                      <button
                        className="flex flex-col items-start gap-1 rounded-xl border border-line bg-surface-2 p-3 text-start transition hover:border-brand"
                        key={item.id}
                        onClick={() => addItem(item)}
                        type="button"
                      >
                        <span className="text-[13.5px] font-bold text-ink">{item.nameAr}</span>
                        <span className="text-[11.5px] text-muted" dir="ltr">
                          {item.sku ?? '—'}
                        </span>
                        <span className="mt-1 text-[13px] font-extrabold text-brand">
                          {numberText(item.salePrice ?? '0')} ر.س
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader subtitle="راجع الكميات وطريقة السداد قبل الترحيل والطباعة." title="سلة الكاشير والدفع" />
              <CardBody>
                <div className="grid gap-3">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      label="الفرع"
                      onChange={(e) => setBranchId(e.target.value)}
                      options={(pos?.branches ?? []).map((b) => ({ value: b.id, label: b.nameAr }))}
                      value={branchId}
                    />
                    <Select
                      label="المستودع"
                      onChange={(e) => setWarehouseId(e.target.value)}
                      options={(pos?.warehouses ?? []).map((w) => ({
                        value: w.id,
                        label: localizeWarehouseName(w.name),
                      }))}
                      value={warehouseId}
                    />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      label="طريقة الدفع"
                      onChange={(e) => {
                        const nextMethod = e.target.value as typeof method;
                        setMethod(nextMethod);
                        const locs = pos?.cashLocations ?? [];
                        const preferredKind = nextMethod === 'cash' ? 'safe' : 'bank';
                        const match = locs.find((c) => c.kind === preferredKind);
                        if (match) setCashLocationId(match.id);
                      }}
                      options={[
                        { value: 'cash', label: 'نقدي' },
                        { value: 'card', label: 'بطاقة مدى / شبكة' },
                        { value: 'transfer', label: 'تحويل بنكي' },
                        { value: 'credit', label: 'آجل على عميل مسجّل' },
                      ]}
                      value={method}
                    />
                    {method !== 'credit' ? (
                      <Select
                        label={method === 'cash' ? 'الصندوق النقدي المستلم' : 'الحساب البنكي المستلم'}
                        onChange={(e) => setCashLocationId(e.target.value)}
                        options={(() => {
                          const all = pos?.cashLocations ?? [];
                          const wanted = method === 'cash' ? 'safe' : 'bank';
                          const filtered = all.filter((c) => !c.kind || c.kind === wanted);
                          const list = filtered.length > 0 ? filtered : all;
                          return list.map((c) => ({ value: c.id, label: c.name }));
                        })()}
                        value={cashLocationId}
                      />
                    ) : null}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <Select
                      label="عميل مسجّل (اختياري للنقدي)"
                      onChange={(e) => setPartyId(e.target.value)}
                      options={[
                        { value: '', label: 'عميل نقدي مباشر' },
                        ...(pos?.customers ?? []).map((c) => ({ value: c.id, label: c.name })),
                      ]}
                      value={partyId}
                    />
                    {!partyId ? (
                      <Input
                        label="اسم العميل على الإيصال"
                        onChange={(e) => setCashCustomerName(e.target.value)}
                        value={cashCustomerName}
                      />
                    ) : null}
                  </div>

                  <label className="flex items-center gap-2 text-[12.5px] font-semibold text-ink">
                    <input
                      checked={priceIncludesVat}
                      onChange={(e) => setPriceIncludesVat(e.target.checked)}
                      type="checkbox"
                    />
                    الأسعار شاملة ضريبة القيمة المضافة
                  </label>

                  {cart.length === 0 ? (
                    <EmptyState
                      description="اختر الأصناف من القائمة اليمنى لبدء البيع."
                      icon={<span aria-hidden="true">+</span>}
                      title="السلة فارغة"
                    />
                  ) : (
                    <div className="grid gap-2">
                      {cart.map((line, index) => (
                        <div
                          className="grid gap-2 rounded-lg border border-line bg-surface-2 p-2.5 sm:grid-cols-[1.3fr_0.8fr_0.8fr_auto]"
                          key={line.item.id}
                        >
                          <div className="text-[13px] font-bold text-ink">{line.item.nameAr}</div>
                          <Input
                            inputMode="decimal"
                            label="الكمية"
                            onChange={(e) =>
                              setCart((prev) =>
                                prev.map((entry, idx) =>
                                  idx === index ? { ...entry, qty: e.target.value } : entry,
                                ),
                              )
                            }
                            value={line.qty}
                          />
                          <Input
                            inputMode="decimal"
                            label="السعر"
                            onChange={(e) =>
                              setCart((prev) =>
                                prev.map((entry, idx) =>
                                  idx === index ? { ...entry, unitPrice: e.target.value } : entry,
                                ),
                              )
                            }
                            value={line.unitPrice}
                          />
                          <div className="flex items-end">
                            <Button
                              onClick={() => setCart((prev) => prev.filter((_, idx) => idx !== index))}
                              size="sm"
                            >
                              حذف
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
                    <div className="flex justify-between">
                      <span className="text-muted">الصافي قبل الضريبة:</span>
                      <strong>{numberText(totals.net)} ر.س</strong>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted">ضريبة القيمة المضافة:</span>
                      <strong>{numberText(totals.vat)} ر.س</strong>
                    </div>
                    <div className="mt-1 flex justify-between border-t border-line pt-1.5 text-[15px]">
                      <span className="font-bold">الإجمالي النهائي:</span>
                      <strong className="text-brand">{numberText(totals.gross)} ر.س</strong>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={!canOperate || submitting || cart.length === 0}
                      onClick={() => void submitCheckout()}
                      variant="primary"
                    >
                      {submitting ? 'جارٍ الإصدار والترحيل…' : 'إتمام البيع وطباعة الإيصال'}
                    </Button>
                    {cart.length > 0 ? (
                      <Button onClick={() => setCart([])} size="sm">
                        تفريغ السلة
                      </Button>
                    ) : null}
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </section>
  );
}
