'use client';

import Decimal from 'decimal.js';
import { useCallback, useEffect, useState } from 'react';
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
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { numberText } from '../../lib/lookups';

type CustomerPriceRow = Record<string, unknown> & {
  id?: string;
  partyId?: string;
  partyName?: string;
  itemId?: string | null;
  itemName?: string | null;
  unitPrice?: string;
  maxDiscountPct?: string | null;
  maxBonusPct?: string | null;
  maxBonusKgPerInvoice?: string | null;
  creditLimit?: string | null;
  paymentTermsDays?: number | null;
  lockPrice?: boolean;
  preferredInvoiceMode?: string;
};

export default function BakeryPricesPage() {
  const { can } = useSession();
  const canManage = can('van_sales.pricing.manage');

  const [rows, setRows] = useState<CustomerPriceRow[]>([]);
  const [parties, setParties] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [partyId, setPartyId] = useState('');
  const [itemId, setItemId] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [preferredInvoiceMode, setPreferredInvoiceMode] = useState('credit');
  const [maxDiscountPct, setMaxDiscountPct] = useState('0');
  const [maxBonusPct, setMaxBonusPct] = useState('0');
  const [maxBonusKg, setMaxBonusKg] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState('30');
  const [lockPrice, setLockPrice] = useState(true);
  const [changeReason, setChangeReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dash, prList, itList] = await Promise.all([
        apiData<{ customerPrices?: CustomerPriceRow[] }>('/van-sales/dashboard'),
        apiList<{ id: string; name: string }>('/parties?kind=customer'),
        apiList<{ id: string; nameAr: string }>('/organization/catalog/items'),
      ]);
      setRows(dash.customerPrices ?? []);
      setParties(prList);
      setItems(itList);
      setPartyId((prev) => prev || prList[0]?.id || '');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة سجل تسعير العملاء'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitPrice = async () => {
    if (!partyId || !unitPrice.trim() || !changeReason.trim()) {
      setNotice({ tone: 'danger', text: 'العميل والسعر وسبب التغيير حقول إلزامية لحفظ التسعير.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/van-sales/customer-prices', {
        partyId,
        ...(itemId ? { itemId } : {}),
        unitPrice: new Decimal(unitPrice).toString(),
        preferredInvoiceMode,
        ...(maxDiscountPct ? { maxDiscountPct: new Decimal(maxDiscountPct).toString() } : {}),
        ...(maxBonusPct ? { maxBonusPct: new Decimal(maxBonusPct).toString() } : {}),
        ...(maxBonusKg ? { maxBonusKgPerInvoice: new Decimal(maxBonusKg).toString() } : {}),
        ...(creditLimit ? { creditLimit: new Decimal(creditLimit).toString() } : {}),
        ...(paymentTermsDays ? { paymentTermsDays: Number(paymentTermsDays) } : {}),
        lockPrice,
        changeReason: changeReason.trim(),
      });
      setFormOpen(false);
      setChangeReason('');
      setNotice({ tone: 'ok', text: 'تم حفظ تسعيرة العميل وتوثيق سبب التغيير في السجل.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ تسعير العميل') });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<CustomerPriceRow>[] = [
    { key: 'partyName', header: 'العميل', cell: (r) => String(r.partyName ?? '—') },
    { key: 'itemName', header: 'الصنف', cell: (r) => String(r.itemName ?? 'جميع الأصناف') },
    {
      key: 'unitPrice',
      header: 'السعر المعتمد (ر.س)',
      numeric: true,
      cell: (r) => numberText(String(r.unitPrice ?? '0')),
    },
    {
      key: 'maxDiscountPct',
      header: 'سقف الخصم %',
      numeric: true,
      cell: (r) => String(r.maxDiscountPct ?? '0'),
    },
    {
      key: 'creditLimit',
      header: 'سقف الائتمان',
      numeric: true,
      cell: (r) => (r.creditLimit ? `${numberText(String(r.creditLimit))} ر.س` : '—'),
    },
    {
      key: 'lockPrice',
      header: 'تثبيت السعر',
      cell: (r) => (
        <Badge status={r.lockPrice ? 'active' : 'pending'}>{r.lockPrice ? 'مثبَّت' : 'مرن'}</Badge>
      ),
    },
  ];

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">تسعير العملاء وسقوف الائتمان</h1>
          <p className="ui-page-sub">
            أسعارٌ خاصة لكلّ عميل وصنف مع سقوف الخصم والكميات المجانية وتثبيت السعر على أجهزة المناديب.
          </p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => setFormOpen(true)} variant="primary">
              + إضافة / تعديل تسعيرة عميل
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
          <CardHeader subtitle="كل تعديل يُحفظ بسعره السابق والجديد وسبب التغيير." title="قائمة تسعير العملاء" />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا توجد تسعيرات عملاء مخصّصة بعد"
              rows={rows}
              rowKey={rowKeyFrom(['id', 'partyId'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setFormOpen(false)} open={formOpen} title="تحديد سعر خاص لعميل">
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="العميل"
              onChange={(e) => setPartyId(e.target.value)}
              options={parties.map((p) => ({ value: p.id, label: p.name }))}
              value={partyId}
            />
            <Select
              label="الصنف (اختياري)"
              onChange={(e) => setItemId(e.target.value)}
              options={[
                { value: '', label: 'سعر عام لكافة أصناف العميل' },
                ...items.map((it) => ({ value: it.id, label: it.nameAr })),
              ]}
              value={itemId}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              inputMode="decimal"
              label="سعر الوحدة (ر.س)"
              onChange={(e) => setUnitPrice(e.target.value)}
              value={unitPrice}
            />
            <Input
              inputMode="decimal"
              label="سقف الخصم %"
              onChange={(e) => setMaxDiscountPct(e.target.value)}
              value={maxDiscountPct}
            />
            <Select
              label="نمط الفاتورة المفضل"
              onChange={(e) => setPreferredInvoiceMode(e.target.value)}
              options={[
                { value: 'credit', label: 'آجل' },
                { value: 'cash', label: 'نقدي' },
              ]}
              value={preferredInvoiceMode}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              inputMode="decimal"
              label="سقف البونص %"
              onChange={(e) => setMaxBonusPct(e.target.value)}
              value={maxBonusPct}
            />
            <Input
              inputMode="decimal"
              label="سقف البونص (كجم)"
              onChange={(e) => setMaxBonusKg(e.target.value)}
              value={maxBonusKg}
            />
            <Input
              inputMode="decimal"
              label="سقف الائتمان (ر.س)"
              onChange={(e) => setCreditLimit(e.target.value)}
              value={creditLimit}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              inputMode="numeric"
              label="أجل السداد (يوم)"
              onChange={(e) => setPaymentTermsDays(e.target.value)}
              value={paymentTermsDays}
            />
            <Input
              label="سبب اعتماد/تغيير السعر (إلزامي)"
              onChange={(e) => setChangeReason(e.target.value)}
              placeholder="اتفاقية توريد شهرية…"
              value={changeReason}
            />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] font-semibold">
            <input checked={lockPrice} onChange={(e) => setLockPrice(e.target.checked)} type="checkbox" />
            تثبيت السعر ومنع المندوب من التعديل دون صلاحية تجاوز
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setFormOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void submitPrice()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ التسعيرة'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
