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
import { apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';

type StockVoucherRow = Record<string, unknown> & {
  id: string;
  voucherNo?: string;
  number?: string;
  kind?: string;
  status?: string;
  reason?: string | null;
  createdAt?: string;
};

type VoucherLine = { itemId: string; qty: string; unitCost: string; batchNo: string };

export default function BakeryInventoryVouchersPage() {
  const { can } = useSession();
  const canAdjust = can('inventory.adjust');

  const [rows, setRows] = useState<StockVoucherRow[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<Array<{ id: string; nameAr: string; purchasePrice?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [kind, setKind] = useState<'opening' | 'in' | 'out'>('opening');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<VoucherLine[]>([
    { itemId: '', qty: '1', unitCost: '0', batchNo: '' },
  ]);
  const [saving, setSaving] = useState(false);
  const [voidTarget, setVoidTarget] = useState<StockVoucherRow | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [vList, brList, whList, itList] = await Promise.all([
        apiList<StockVoucherRow>('/inventory/vouchers'),
        apiList<{ id: string; nameAr: string }>('/branches').catch(() => []),
        apiList<{ id: string; name: string }>('/warehouses').catch(() => []),
        apiList<{ id: string; nameAr: string; purchasePrice?: string }>('/organization/catalog/items').catch(
          () => [],
        ),
      ]);
      setRows(vList);
      setBranches(brList);
      setWarehouses(whList);
      setItems(itList);
      setBranchId((prev) => prev || brList[0]?.id || '');
      setWarehouseId((prev) => prev || whList[0]?.id || '');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة سندات المخزون'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitVoucher = async () => {
    const valid = lines.filter((l) => l.itemId && new Decimal(l.qty || '0').gt(0));
    if (!branchId || !warehouseId || valid.length === 0) {
      setNotice({ tone: 'danger', text: 'اختر الفرع والمستودع وأضف سطراً واحداً على الأقل.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/inventory/vouchers', {
        branchId,
        warehouseId,
        kind,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
        lines: valid.map((l) => ({
          itemId: l.itemId,
          qty: new Decimal(l.qty).toString(),
          ...(l.unitCost.trim() ? { unitCost: new Decimal(l.unitCost).toString() } : {}),
          ...(l.batchNo.trim() ? { batchNo: l.batchNo.trim() } : {}),
        })),
      });
      setCreateOpen(false);
      setLines([{ itemId: '', qty: '1', unitCost: '0', batchNo: '' }]);
      setReason('');
      setNotice({ tone: 'ok', text: 'تم حفظ سند المخزون كمسودة جاهزة للترحيل المتوازن.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ سند المخزون') });
    } finally {
      setSaving(false);
    }
  };

  const postVoucher = async (id: string) => {
    setSaving(true);
    try {
      await apiPost(`/inventory/vouchers/${encodeURIComponent(id)}/post`, {});
      setNotice({ tone: 'ok', text: 'تم ترحيل سند المخزون بقيد متوازن (مدين = دائن) بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر ترحيل السند المخزني') });
    } finally {
      setSaving(false);
    }
  };

  const confirmVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    setSaving(true);
    try {
      await apiPost(`/inventory/vouchers/${encodeURIComponent(voidTarget.id)}/void`, {
        reason: voidReason.trim(),
      });
      setVoidTarget(null);
      setVoidReason('');
      setNotice({ tone: 'ok', text: 'تم إبطال السند المخزني بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إبطال السند') });
    } finally {
      setSaving(false);
    }
  };

  const kindLabel = (k?: string) =>
    k === 'opening' ? 'بضاعة أول المدة' : k === 'in' ? 'إذن إدخال مخزني' : k === 'out' ? 'إذن إخراج مخزني' : k ?? '—';

  const columns: Column<StockVoucherRow>[] = [
    { key: 'no', header: 'رقم السند', ltr: true, cell: (r) => String(r.voucherNo ?? r.number ?? r.id.slice(0, 8)) },
    { key: 'kind', header: 'النوع', cell: (r) => kindLabel(r.kind) },
    { key: 'reason', header: 'البيان', cell: (r) => String(r.reason ?? '—') },
    { key: 'date', header: 'التاريخ', ltr: true, cell: (r) => String(r.createdAt ?? '').slice(0, 10) || '—' },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (
        <Badge status={r.status === 'posted' ? 'active' : r.status === 'draft' ? 'pending' : 'rejected'}>
          {r.status === 'posted' ? 'مرحَّل' : r.status === 'draft' ? 'مسودة' : String(r.status ?? '—')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          {r.status === 'draft' && canAdjust ? (
            <Button onClick={() => void postVoucher(r.id)} size="sm" variant="primary">
              ترحيل
            </Button>
          ) : null}
          {r.status !== 'void' && r.status !== 'voided' && canAdjust ? (
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
          <h1 className="ui-page-title">سندات المخزون (أول المدة · إدخال · إخراج)</h1>
          <p className="ui-page-sub">
            إدارة أرصدة أول المدة المتوازنة محاسبياً وأذون الإدخال والإخراج المخزني المعتمدة.
          </p>
        </div>
        <div className="ui-page-actions">
          {canAdjust ? (
            <Button onClick={() => setCreateOpen(true)} variant="primary">
              + سند مخزني جديد
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
          <CardHeader subtitle="السندات تُنشأ كمسودات ثم تُرحّل لتحريك المخزون والأستاذ." title="سجل سندات المخزون" />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا سندات مخزنية مسجلة"
              rows={rows}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setCreateOpen(false)} open={createOpen} title="إنشاء سند مخزني جديد">
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Select
              label="نوع السند"
              onChange={(e) => setKind(e.target.value as typeof kind)}
              options={[
                { value: 'opening', label: 'بضاعة أول المدة' },
                { value: 'in', label: 'إذن إدخال مخزني' },
                { value: 'out', label: 'إذن إخراج مخزني' },
              ]}
              value={kind}
            />
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
          <Input label="البيان / السبب" onChange={(e) => setReason(e.target.value)} value={reason} />
          {lines.map((line, idx) => (
            <div className="grid gap-2 rounded-lg border border-line p-2.5 sm:grid-cols-4" key={idx}>
              <Select
                label="الصنف"
                onChange={(e) => {
                  const found = items.find((i) => i.id === e.target.value);
                  setLines((prev) =>
                    prev.map((l, i) =>
                      i === idx ? { ...l, itemId: e.target.value, unitCost: found?.purchasePrice ?? l.unitCost } : l,
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
                  setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, qty: e.target.value } : l)))
                }
                value={line.qty}
              />
              <Input
                inputMode="decimal"
                label="تكلفة الوحدة"
                onChange={(e) =>
                  setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, unitCost: e.target.value } : l)))
                }
                value={line.unitCost}
              />
              <Input
                label="رقم التشغيلة (اختياري)"
                onChange={(e) =>
                  setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, batchNo: e.target.value } : l)))
                }
                value={line.batchNo}
              />
            </div>
          ))}
          <div className="flex justify-between gap-2">
            <Button
              onClick={() => setLines((prev) => [...prev, { itemId: '', qty: '1', unitCost: '0', batchNo: '' }])}
              size="sm"
            >
              + إضافة سطر
            </Button>
            <div className="flex gap-2">
              <Button onClick={() => setCreateOpen(false)} size="sm">
                إلغاء
              </Button>
              <Button disabled={saving} onClick={() => void submitVoucher()} variant="primary">
                {saving ? 'جارٍ الحفظ…' : 'حفظ المسودة'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setVoidTarget(null)} open={Boolean(voidTarget)} title="إبطال سند مخزني">
        <div className="grid gap-3">
          <Input label="سبب الإبطال (إلزامي)" onChange={(e) => setVoidReason(e.target.value)} value={voidReason} />
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
