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

type AdjustmentRow = Record<string, unknown> & {
  id: string;
  number?: string;
  status?: string;
  reason?: string | null;
  warehouseName?: string;
  createdAt?: string;
};

type CountLine = { itemId: string; countedQty: string };

export default function BakeryCountsPage() {
  const { can } = useSession();
  const canAdjust = can('inventory.adjust');

  const [rows, setRows] = useState<AdjustmentRow[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [branchId, setBranchId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [reason, setReason] = useState('جرد مخزني دوري');
  const [lines, setLines] = useState<CountLine[]>([{ itemId: '', countedQty: '0' }]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [adj, br, wh, it] = await Promise.all([
        apiList<AdjustmentRow>('/inventory/adjustments'),
        apiList<{ id: string; nameAr: string }>('/branches').catch(() => []),
        apiList<{ id: string; name: string }>('/warehouses').catch(() => []),
        apiList<{ id: string; nameAr: string }>('/organization/catalog/items').catch(() => []),
      ]);
      setRows(adj);
      setBranches(br);
      setWarehouses(wh);
      setItems(it);
      setBranchId((prev) => prev || br[0]?.id || '');
      setWarehouseId((prev) => prev || wh[0]?.id || '');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر تحميل محاضر الجرد والتسويات'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCount = async () => {
    const valid = lines.filter((l) => l.itemId && new Decimal(l.countedQty || '0').gte(0));
    if (!branchId || !warehouseId || valid.length === 0) {
      setNotice({ tone: 'danger', text: 'اختر الفرع والمستودع وأدخل كمية الجرد الفعلي لصنف واحد على الأقل.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/inventory/adjustments', {
        branchId,
        warehouseId,
        reason: reason.trim() || 'جرد فعلي',
        lines: valid.map((l) => ({
          itemId: l.itemId,
          countedQty: new Decimal(l.countedQty || '0').toString(),
        })),
      });
      setCreateOpen(false);
      setLines([{ itemId: '', countedQty: '0' }]);
      setNotice({ tone: 'ok', text: 'تم حفظ محضر الجرد كمسودة — راجعه ثم رحّله لتسوية الفروق.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ تسوية الجرد') });
    } finally {
      setSaving(false);
    }
  };

  const postAdjustment = async (id: string) => {
    setSaving(true);
    try {
      await apiPost(`/inventory/adjustments/${encodeURIComponent(id)}/post`, {});
      setNotice({ tone: 'ok', text: 'تم ترحيل محضر الجرد وتسوية رصيد المستودع والأستاذ.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر ترحيل تسوية الجرد') });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<AdjustmentRow>[] = [
    { key: 'no', header: 'رقم المحضر', ltr: true, cell: (r) => String(r.number ?? r.id.slice(0, 8)) },
    { key: 'reason', header: 'سبب الجرد/التسوية', cell: (r) => String(r.reason ?? '—') },
    { key: 'date', header: 'التاريخ', ltr: true, cell: (r) => String(r.createdAt ?? '').slice(0, 10) || '—' },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (
        <Badge status={r.status === 'posted' ? 'active' : 'pending'}>
          {r.status === 'posted' ? 'مرحَّل' : String(r.status ?? 'مسودة')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراء',
      cell: (r) =>
        r.status === 'draft' && canAdjust ? (
          <Button onClick={() => void postAdjustment(r.id)} size="sm" variant="primary">
            ترحيل الفروق
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
          <h1 className="ui-page-title">الجرد الفعلي وتسويات المخزون</h1>
          <p className="ui-page-sub">
            إثبات الكميات الفعلية في المستودعات ومقارنتها بالرصيد الدفتري وترحيل فروق الزيادة أو العجز.
          </p>
        </div>
        <div className="ui-page-actions">
          {canAdjust ? (
            <Button onClick={() => setCreateOpen(true)} variant="primary">
              + محضر جرد جديد
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
          <CardHeader subtitle="كل تسوية مرحَّلة تولّد حركة مخزنية وقيد فروق جرد رسمي." title="محاضر الجرد والتسويات" />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا محاضر جرد مسجلة"
              rows={rows}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setCreateOpen(false)} open={createOpen} title="إنشاء محضر جرد فعلي">
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
          <Input label="سبب الجرد" onChange={(e) => setReason(e.target.value)} value={reason} />
          {lines.map((line, idx) => (
            <div className="grid gap-2 rounded-lg border border-line p-2.5 sm:grid-cols-2" key={idx}>
              <Select
                label="الصنف"
                onChange={(e) =>
                  setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, itemId: e.target.value } : l)))
                }
                options={[
                  { value: '', label: 'اختر الصنف…' },
                  ...items.map((it) => ({ value: it.id, label: it.nameAr })),
                ]}
                value={line.itemId}
              />
              <Input
                inputMode="decimal"
                label="الكمية الفعلية المعدودة"
                onChange={(e) =>
                  setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, countedQty: e.target.value } : l)))
                }
                value={line.countedQty}
              />
            </div>
          ))}
          <div className="flex justify-between gap-2">
            <Button onClick={() => setLines((prev) => [...prev, { itemId: '', countedQty: '0' }])} size="sm">
              + إضافة صنف للجرد
            </Button>
            <div className="flex gap-2">
              <Button onClick={() => setCreateOpen(false)} size="sm">
                إلغاء
              </Button>
              <Button disabled={saving} onClick={() => void submitCount()} variant="primary">
                {saving ? 'جارٍ الحفظ…' : 'حفظ محضر الجرد'}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </section>
  );
}
