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
  Modal,
  Select,
  type Column,
} from '@erp/ui';
import { apiErrorText, apiList, apiPatch, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { numberText } from '../../lib/lookups';

type ItemRow = Record<string, unknown> & {
  id: string;
  sku: string;
  barcode?: string | null;
  nameAr: string;
  kind?: string;
  categoryId?: string;
  baseUnitId?: string;
  taxGroupId?: string | null;
  salePrice?: string;
  purchasePrice?: string;
  minQty?: string;
  trackLot?: boolean;
  showInPos?: boolean;
};

export default function BakeryItemsPage() {
  const { can } = useSession();
  const canManage = can('catalog.item.manage');

  const [items, setItems] = useState<ItemRow[]>([]);
  const [categories, setCategories] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [units, setUnits] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [taxes, setTaxes] = useState<Array<{ id: string; nameAr?: string; rate: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ItemRow | null>(null);
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [kind, setKind] = useState<'goods' | 'service' | 'raw_material'>('goods');
  const [categoryId, setCategoryId] = useState('');
  const [baseUnitId, setBaseUnitId] = useState('');
  const [taxGroupId, setTaxGroupId] = useState('');
  const [salePrice, setSalePrice] = useState('0');
  const [purchasePrice, setPurchasePrice] = useState('0');
  const [minQty, setMinQty] = useState('0');
  const [trackLot, setTrackLot] = useState(false);
  const [showInPos, setShowInPos] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itList, catList, unList, txList] = await Promise.all([
        apiList<ItemRow>('/organization/catalog/items'),
        apiList<{ id: string; nameAr: string }>('/organization/catalog/categories').catch(() => []),
        apiList<{ id: string; nameAr: string }>('/organization/catalog/units').catch(() => []),
        apiList<{ id: string; nameAr?: string; rate: string }>('/organization/catalog/tax-groups').catch(
          () => [],
        ),
      ]);
      setItems(itList);
      setCategories(catList);
      setUnits(unList);
      setTaxes(txList);
      setCategoryId((prev) => prev || catList[0]?.id || '');
      setBaseUnitId((prev) => prev || unList[0]?.id || '');
      setTaxGroupId((prev) => prev || txList[0]?.id || '');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة كتالوج الأصناف'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row?: ItemRow) => {
    setEditing(row ?? null);
    setSku(row?.sku ?? '');
    setBarcode(String(row?.barcode ?? ''));
    setNameAr(row?.nameAr ?? '');
    setKind((row?.kind as typeof kind) ?? 'goods');
    setCategoryId(row?.categoryId ?? categories[0]?.id ?? '');
    setBaseUnitId(row?.baseUnitId ?? units[0]?.id ?? '');
    setTaxGroupId(String(row?.taxGroupId ?? taxes[0]?.id ?? ''));
    setSalePrice(String(row?.salePrice ?? '0'));
    setPurchasePrice(String(row?.purchasePrice ?? '0'));
    setMinQty(String(row?.minQty ?? '0'));
    setTrackLot(Boolean(row?.trackLot));
    setShowInPos(row ? Boolean(row.showInPos) : true);
    setModalOpen(true);
  };

  const saveItem = async () => {
    if (!sku.trim() || !nameAr.trim() || !categoryId || !baseUnitId) {
      setNotice({ tone: 'danger', text: 'الرمز والاسم والفئة والوحدة حقول إلزامية لتعريف الصنف.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        sku: sku.trim(),
        ...(barcode.trim() ? { barcode: barcode.trim() } : {}),
        nameAr: nameAr.trim(),
        categoryId,
        baseUnitId,
        kind,
        ...(taxGroupId ? { taxGroupId } : {}),
        salePrice: new Decimal(salePrice || '0').toString(),
        purchasePrice: new Decimal(purchasePrice || '0').toString(),
        minQty: new Decimal(minQty || '0').toString(),
        trackLot,
      };
      if (editing) {
        await apiPatch(`/organization/catalog/items/${encodeURIComponent(editing.id)}`, {
          ...payload,
          showInPos,
        });
      } else {
        const created = await apiPost<{ id?: string }>('/organization/catalog/items', payload);
        if (created?.id && showInPos) {
          await apiPatch(`/organization/catalog/items/${encodeURIComponent(created.id)}`, {
            showInPos: true,
          }).catch(() => undefined);
        }
      }
      setModalOpen(false);
      setNotice({ tone: 'ok', text: 'تم حفظ بطاقة الصنف في الكتالوج بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ الصنف') });
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) =>
        i.nameAr.toLowerCase().includes(q) ||
        i.sku.toLowerCase().includes(q) ||
        String(i.barcode ?? '').toLowerCase().includes(q),
    );
  }, [items, query]);

  const columns: Column<ItemRow>[] = [
    { key: 'sku', header: 'رمز الصنف', ltr: true, cell: (r) => r.sku },
    { key: 'nameAr', header: 'اسم الصنف', cell: (r) => r.nameAr },
    {
      key: 'category',
      header: 'الفئة',
      cell: (r) => categories.find((c) => c.id === r.categoryId)?.nameAr ?? '—',
    },
    {
      key: 'salePrice',
      header: 'سعر البيع',
      numeric: true,
      cell: (r) => `${numberText(String(r.salePrice ?? '0'))} ر.س`,
    },
    {
      key: 'purchasePrice',
      header: 'التكلفة',
      numeric: true,
      cell: (r) => `${numberText(String(r.purchasePrice ?? '0'))} ر.س`,
    },
    {
      key: 'pos',
      header: 'نقطة البيع',
      cell: (r) => (
        <Badge status={r.showInPos ? 'active' : 'pending'}>{r.showInPos ? 'ظاهر' : 'مخفي'}</Badge>
      ),
    },
    {
      key: 'edit',
      header: 'إجراء',
      cell: (r) =>
        canManage ? (
          <Button onClick={() => openEditor(r)} size="sm">
            تعديل
          </Button>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">الأصناف والمنتجات</h1>
          <p className="ui-page-sub">
            إدارة أصناف المخبز والمواد الخام وأسعار البيع والتكلفة والباركود وإظهار الأصناف في الكاشير.
          </p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => openEditor()} variant="primary">
              + صنف جديد
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

        <Card>
          <CardHeader subtitle="بحث بالاسم أو الرمز أو الباركود." title={`قائمة الأصناف (${filtered.length})`} />
          <CardBody>
            <div className="mb-3 max-w-md">
              <Input label="بحث سريع" onChange={(e) => setQuery(e.target.value)} value={query} />
            </div>
            <DataTable
              columns={columns}
              empty="لا أصناف مطابقة"
              rows={filtered}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setModalOpen(false)} open={modalOpen} title={editing ? 'تعديل صنف' : 'إضافة صنف جديد'}>
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input label="رمز الصنف (SKU)" onChange={(e) => setSku(e.target.value)} value={sku} />
            <Input label="الباركود" onChange={(e) => setBarcode(e.target.value)} value={barcode} />
          </div>
          <Input label="الاسم بالعربية" onChange={(e) => setNameAr(e.target.value)} value={nameAr} />
          <div className="grid gap-2 sm:grid-cols-3">
            <Select
              label="النوع"
              onChange={(e) => setKind(e.target.value as typeof kind)}
              options={[
                { value: 'goods', label: 'منتج مخزني / مخبوزات' },
                { value: 'raw_material', label: 'مادة خام' },
                { value: 'service', label: 'خدمة' },
              ]}
              value={kind}
            />
            <Select
              label="الفئة"
              onChange={(e) => setCategoryId(e.target.value)}
              options={categories.map((c) => ({ value: c.id, label: c.nameAr }))}
              value={categoryId}
            />
            <Select
              label="الوحدة الأساسية"
              onChange={(e) => setBaseUnitId(e.target.value)}
              options={units.map((u) => ({ value: u.id, label: u.nameAr }))}
              value={baseUnitId}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-4">
            <Input
              inputMode="decimal"
              label="سعر البيع"
              onChange={(e) => setSalePrice(e.target.value)}
              value={salePrice}
            />
            <Input
              inputMode="decimal"
              label="سعر التكلفة"
              onChange={(e) => setPurchasePrice(e.target.value)}
              value={purchasePrice}
            />
            <Input
              inputMode="decimal"
              label="الحد الأدنى"
              onChange={(e) => setMinQty(e.target.value)}
              value={minQty}
            />
            <Select
              label="مجموعة الضريبة"
              onChange={(e) => setTaxGroupId(e.target.value)}
              options={[
                { value: '', label: 'بدون ضريبة' },
                ...taxes.map((t) => ({ value: t.id, label: `${t.nameAr ?? 'ضريبة'} (${t.rate}%)` })),
              ]}
              value={taxGroupId}
            />
          </div>
          <div className="flex flex-wrap gap-4 text-[12.5px] font-semibold">
            <label className="flex items-center gap-2">
              <input checked={showInPos} onChange={(e) => setShowInPos(e.target.checked)} type="checkbox" />
              إظهار الصنف في شاشة نقطة البيع
            </label>
            <label className="flex items-center gap-2">
              <input checked={trackLot} onChange={(e) => setTrackLot(e.target.checked)} type="checkbox" />
              تتبّع رقم التشغيلة / الدفعة
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void saveItem()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ الصنف'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
