'use client';

import Decimal from 'decimal.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Input,
  Kpi,
  SegmentedTabs,
  Select,
  type Column,
} from '@erp/ui';
import { apiData, apiErrorText, apiList } from '@erp/web-core/api';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { numberText } from '../../lib/lookups';

type LevelRow = Record<string, unknown> & {
  id?: string;
  warehouseId?: string;
  warehouseName?: string;
  itemId?: string;
  itemName?: string;
  sku?: string;
  quantity?: string;
  qtyOnHand?: string;
  value?: string;
  avgCost?: string;
};

type MovementRow = Record<string, unknown> & {
  id?: string;
  itemId?: string;
  itemName?: string;
  warehouseName?: string;
  direction?: string;
  kind?: string;
  quantity?: string;
  qty?: string;
  unitCost?: string;
  createdAt?: string;
  occurredAt?: string;
};

type ItemCardPayload = {
  openingQty?: string;
  closingQty?: string;
  inQty?: string;
  outQty?: string;
  rows?: MovementRow[];
};

function whAr(name?: string | null): string {
  if (!name) return '—';
  const low = name.trim().toLowerCase();
  if (low === 'main warehouse' || low === 'default warehouse') return 'المستودع الرئيسي';
  return name;
}

export default function BakeryInventoryPage() {
  const [tab, setTab] = useState<'levels' | 'movements' | 'card'>('levels');
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<Array<{ id: string; nameAr: string; sku?: string }>>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [itemId, setItemId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  const [levels, setLevels] = useState<LevelRow[]>([]);
  const [movements, setMovements] = useState<MovementRow[]>([]);
  const [itemCard, setItemCard] = useState<ItemCardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLookups = useCallback(async () => {
    const [wh, it] = await Promise.all([
      apiList<{ id: string; name: string }>('/warehouses').catch(() => []),
      apiList<{ id: string; nameAr: string; sku?: string }>('/organization/catalog/items').catch(() => []),
    ]);
    setWarehouses(wh);
    setItems(it);
    setItemId((prev) => prev || it[0]?.id || '');
  }, []);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (warehouseId) qs.set('warehouse_id', warehouseId);
      if (itemId && tab !== 'levels') qs.set('item_id', itemId);
      if (fromDate) qs.set('from', fromDate);
      if (toDate) qs.set('to', toDate);

      if (tab === 'levels') {
        const lqs = new URLSearchParams();
        if (warehouseId) lqs.set('warehouse_id', warehouseId);
        const rows = await apiList<LevelRow>(`/inventory/levels${lqs.toString() ? `?${lqs}` : ''}`);
        setLevels(rows);
      } else if (tab === 'movements') {
        const rows = await apiList<MovementRow>(`/inventory/movements${qs.toString() ? `?${qs}` : ''}`);
        setMovements(rows);
      } else if (itemId) {
        const cqs = new URLSearchParams({ item_id: itemId });
        if (warehouseId) cqs.set('warehouse_id', warehouseId);
        if (fromDate) cqs.set('from', fromDate);
        if (toDate) cqs.set('to', toDate);
        const card = await apiData<ItemCardPayload>(`/inventory/item-card?${cqs.toString()}`);
        setItemCard(card);
      }
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة بيانات المخزون'));
    } finally {
      setLoading(false);
    }
  }, [tab, warehouseId, itemId, fromDate, toDate]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const levelTotals = useMemo(() => {
    let totalVal = new Decimal(0);
    for (const r of levels) {
      totalVal = totalVal.plus(new Decimal(String(r.value ?? '0')));
    }
    return totalVal.toFixed(2);
  }, [levels]);

  const itemNameOf = (id?: string) => items.find((i) => i.id === id)?.nameAr ?? '—';
  const whNameOf = (id?: string, fallback?: string) =>
    whAr(fallback ?? warehouses.find((w) => w.id === id)?.name);

  const levelColumns: Column<LevelRow>[] = [
    { key: 'item', header: 'الصنف', cell: (r) => String(r.itemName ?? itemNameOf(r.itemId)) },
    { key: 'warehouse', header: 'المستودع', cell: (r) => whNameOf(r.warehouseId, r.warehouseName) },
    {
      key: 'qty',
      header: 'الكمية المتاحة',
      numeric: true,
      cell: (r) => numberText(String(r.quantity ?? r.qtyOnHand ?? '0')),
    },
    {
      key: 'avgCost',
      header: 'متوسط التكلفة',
      numeric: true,
      cell: (r) => numberText(String(r.avgCost ?? '0')),
    },
    {
      key: 'value',
      header: 'القيمة الدفترية (ر.س)',
      numeric: true,
      cell: (r) => numberText(String(r.value ?? '0')),
    },
  ];

  const moveColumns: Column<MovementRow>[] = [
    {
      key: 'date',
      header: 'التاريخ',
      ltr: true,
      cell: (r) => String(r.occurredAt ?? r.createdAt ?? '').slice(0, 16).replace('T', ' ') || '—',
    },
    { key: 'item', header: 'الصنف', cell: (r) => String(r.itemName ?? itemNameOf(r.itemId)) },
    { key: 'warehouse', header: 'المستودع', cell: (r) => whAr(r.warehouseName) },
    { key: 'kind', header: 'نوع الحركة', cell: (r) => String(r.kind ?? r.direction ?? '—') },
    {
      key: 'qty',
      header: 'الكمية',
      numeric: true,
      cell: (r) => numberText(String(r.quantity ?? r.qty ?? '0')),
    },
  ];

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">أرصدة وحركة المخزون</h1>
          <p className="ui-page-sub">
            متابعة حية لأرصدة المستودع الرئيسي ومستودعات سيارات التوزيع وحركة الأصناف وبطاقة الصنف التفصيلية.
          </p>
        </div>
        <div className="ui-page-actions">
          <Button onClick={() => void loadData()} size="sm">
            تحديث القراءة
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        <div className="ui-kpi-grid">
          <Kpi title="عدد المستودعات" tone="brand" value={String(warehouses.length)} />
          <Kpi title="سطور الأرصدة" tone="neutral" value={String(levels.length)} />
          <Kpi title="إجمالي قيمة المخزون" tone="ok" value={`${numberText(levelTotals)} ر.س`} />
        </div>

        <SegmentedTabs
          onChange={(next) => setTab(next as typeof tab)}
          items={[
            { key: 'levels', label: 'أرصدة المخزون الحالية' },
            { key: 'movements', label: 'دفتر حركات المخزون' },
            { key: 'card', label: 'بطاقة صنف تفصيلية' },
          ]}
          value={tab}
        />

        <Card>
          <CardHeader subtitle="صفِّ القراءة بالمستودع أو الصنف أو الفترة الزمنية." title="مرشّحات وسجل المخزون" />
          <CardBody>
            <div className="mb-3 grid gap-2 sm:grid-cols-4">
              <Select
                label="المستودع"
                onChange={(e) => setWarehouseId(e.target.value)}
                options={[
                  { value: '', label: 'جميع المستودعات' },
                  ...warehouses.map((w) => ({ value: w.id, label: whAr(w.name) })),
                ]}
                value={warehouseId}
              />
              {tab !== 'levels' ? (
                <Select
                  label="الصنف"
                  onChange={(e) => setItemId(e.target.value)}
                  options={[
                    ...(tab === 'movements' ? [{ value: '', label: 'جميع الأصناف' }] : []),
                    ...items.map((it) => ({ value: it.id, label: it.nameAr })),
                  ]}
                  value={itemId}
                />
              ) : null}
              {tab !== 'levels' ? (
                <>
                  <Input
                    label="من تاريخ"
                    onChange={(e) => setFromDate(e.target.value)}
                    type="date"
                    value={fromDate}
                  />
                  <Input
                    label="إلى تاريخ"
                    onChange={(e) => setToDate(e.target.value)}
                    type="date"
                    value={toDate}
                  />
                </>
              ) : null}
            </div>

            {tab === 'levels' ? (
              <DataTable
                columns={levelColumns}
                empty="لا أرصدة مخزون مسجلة حالياً"
                rows={levels}
                rowKey={rowKeyFrom(['id', 'itemId'])}
                state={listState({ loading, error })}
              />
            ) : tab === 'movements' ? (
              <DataTable
                columns={moveColumns}
                empty="لا حركات مخزون في الفترة المحددة"
                rows={movements}
                rowKey={rowKeyFrom(['id'])}
                state={listState({ loading, error })}
              />
            ) : (
              <div className="grid gap-3">
                {itemCard ? (
                  <div className="ui-kpi-grid">
                    <Kpi title="رصيد أول المدة" tone="neutral" value={numberText(itemCard.openingQty ?? '0')} />
                    <Kpi title="إجمالي الوارد" tone="ok" value={numberText(itemCard.inQty ?? '0')} />
                    <Kpi title="إجمالي المنصرف" tone="warn" value={numberText(itemCard.outQty ?? '0')} />
                    <Kpi title="الرصيد الختامي" tone="brand" value={numberText(itemCard.closingQty ?? '0')} />
                  </div>
                ) : null}
                <DataTable
                  columns={moveColumns}
                  empty="لا حركات مسجلة لهذا الصنف"
                  rows={itemCard?.rows ?? []}
                  rowKey={rowKeyFrom(['id'])}
                  state={listState({ loading, error })}
                />
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
