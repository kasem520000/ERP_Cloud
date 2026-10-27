'use client';

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
  SegmentedTabs,
  Select,
  type Column,
} from '@erp/ui';
import { apiErrorText, apiList, apiPatch, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { numberText } from '../../lib/lookups';
import { openServerPrintHtml } from '../../lib/server-print';

type SalesRow = Record<string, unknown> & {
  id: string;
  invoiceNo?: string;
  partyName?: string;
  cashCustomerName?: string | null;
  status?: string;
  total?: string;
  issueDate?: string;
};

type SalesmanRow = Record<string, unknown> & {
  id: string;
  name?: string;
  code?: string;
  phone?: string | null;
  commissionPct?: string;
  vehiclePlate?: string | null;
  warehouseId?: string | null;
  isActive?: boolean;
};

export default function BakerySalesRegistryPage() {
  const { can } = useSession();
  const canManageSalesman = can('sales.salesman.manage');

  const [tab, setTab] = useState<'invoices' | 'salesmen'>('invoices');
  const [invoices, setInvoices] = useState<SalesRow[]>([]);
  const [salesmen, setSalesmen] = useState<SalesmanRow[]>([]);
  const [warehouses, setWarehouses] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SalesmanRow | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState('');
  const [commissionPct, setCommissionPct] = useState('0');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [inv, sm, wh] = await Promise.all([
        apiList<SalesRow>('/sales/invoices'),
        apiList<SalesmanRow>('/sales/salesmen'),
        apiList<{ id: string; name: string }>('/warehouses').catch(() => []),
      ]);
      setInvoices(inv);
      setSalesmen(sm);
      setWarehouses(wh);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر تحميل سجل المبيعات والمناديب'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row?: SalesmanRow) => {
    setEditing(row ?? null);
    setName(String(row?.name ?? ''));
    setCode(String(row?.code ?? ''));
    setPhone(String(row?.phone ?? ''));
    setCommissionPct(String(row?.commissionPct ?? '0'));
    setVehiclePlate(String(row?.vehiclePlate ?? ''));
    setWarehouseId(String(row?.warehouseId ?? ''));
    setModalOpen(true);
  };

  const saveSalesman = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        ...(code.trim() ? { code: code.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(commissionPct.trim() ? { commissionPct: commissionPct.trim() } : {}),
        ...(vehiclePlate.trim() ? { vehiclePlate: vehiclePlate.trim() } : {}),
        ...(warehouseId ? { warehouseId } : {}),
      };
      if (editing) {
        await apiPatch(`/sales/salesmen/${encodeURIComponent(editing.id)}`, payload);
      } else {
        await apiPost('/sales/salesmen', payload);
      }
      setModalOpen(false);
      setNotice({ tone: 'ok', text: 'تم حفظ بطاقة مندوب المبيعات بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ بطاقة المندوب') });
    } finally {
      setSaving(false);
    }
  };

  const filteredInvoices = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return invoices;
    return invoices.filter(
      (r) =>
        String(r.invoiceNo ?? '').toLowerCase().includes(q) ||
        String(r.partyName ?? r.cashCustomerName ?? '').toLowerCase().includes(q),
    );
  }, [invoices, query]);

  const invoiceColumns: Column<SalesRow>[] = [
    { key: 'invoiceNo', header: 'رقم المستند', ltr: true, cell: (r) => String(r.invoiceNo ?? r.id.slice(0, 8)) },
    { key: 'customer', header: 'العميل', cell: (r) => String(r.partyName ?? r.cashCustomerName ?? 'عميل عام') },
    { key: 'date', header: 'التاريخ', ltr: true, cell: (r) => String(r.issueDate ?? '').slice(0, 10) || '—' },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (
        <Badge status={r.status === 'posted' ? 'active' : 'pending'}>
          {r.status === 'posted' ? 'مرحَّلة' : String(r.status ?? 'مسودة')}
        </Badge>
      ),
    },
    { key: 'total', header: 'الإجمالي (ر.س)', numeric: true, cell: (r) => numberText(String(r.total ?? '0')) },
    {
      key: 'print',
      header: 'الطباعة',
      cell: (r) => (
        <div className="flex gap-1.5">
          <Button
            onClick={() => void openServerPrintHtml(`/reports/print/invoices/${encodeURIComponent(r.id)}`)}
            size="sm"
          >
            A4
          </Button>
          <Button
            onClick={() =>
              void openServerPrintHtml(`/reports/print/invoices/${encodeURIComponent(r.id)}?paper=small`)
            }
            size="sm"
          >
            80 مم
          </Button>
        </div>
      ),
    },
  ];

  const salesmanColumns: Column<SalesmanRow>[] = [
    { key: 'name', header: 'اسم المندوب', cell: (r) => String(r.name ?? '—') },
    { key: 'code', header: 'الرمز', ltr: true, cell: (r) => String(r.code ?? '—') },
    { key: 'phone', header: 'الجوال', ltr: true, cell: (r) => String(r.phone ?? '—') },
    { key: 'vehiclePlate', header: 'لوحة السيارة', cell: (r) => String(r.vehiclePlate ?? '—') },
    {
      key: 'commissionPct',
      header: 'نسبة العمولة %',
      numeric: true,
      cell: (r) => String(r.commissionPct ?? '0'),
    },
    {
      key: 'actions',
      header: 'إجراء',
      cell: (r) =>
        canManageSalesman ? (
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
          <h1 className="ui-page-title">سجل المبيعات وبطاقات المناديب</h1>
          <p className="ui-page-sub">
            استعراضٌ موحّد لفواتير المبيعات ودفتر بطاقات مناديب المبيعات ونِسَب عمولاتهم ومستودعاتهم.
          </p>
        </div>
        <div className="ui-page-actions">
          {tab === 'salesmen' && canManageSalesman ? (
            <Button onClick={() => openEditor()} variant="primary">
              + مندوب مبيعات جديد
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

        <SegmentedTabs
          onChange={(next) => setTab(next as typeof tab)}
          items={[
            { key: 'invoices', label: `سجل الفواتير (${invoices.length})` },
            { key: 'salesmen', label: `سجل مناديب المبيعات (${salesmen.length})` },
          ]}
          value={tab}
        />

        <Card>
          <CardHeader
            subtitle={tab === 'invoices' ? 'بحث فوري وطباعة مباشرة.' : 'بطاقات مناديب المبيعات ونسب العمولة.'}
            title={tab === 'invoices' ? 'فواتير المبيعات' : 'مناديب المبيعات'}
          />
          <CardBody>
            {tab === 'invoices' ? (
              <>
                <div className="mb-3 max-w-md">
                  <Input
                    label="بحث برقم الفاتورة أو العميل"
                    onChange={(e) => setQuery(e.target.value)}
                    value={query}
                  />
                </div>
                <DataTable
                  columns={invoiceColumns}
                  empty="لا توجد فواتير مبيعات"
                  rows={filteredInvoices}
                  rowKey={rowKeyFrom(['id'])}
                  state={listState({ loading, error })}
                />
              </>
            ) : (
              <DataTable
                columns={salesmanColumns}
                empty="لا توجد بطاقات مناديب مسجلة"
                rows={salesmen}
                rowKey={rowKeyFrom(['id'])}
                state={listState({ loading, error })}
              />
            )}
          </CardBody>
        </Card>
      </div>

      <Modal
        onClose={() => setModalOpen(false)}
        open={modalOpen}
        title={editing ? 'تعديل بطاقة مندوب مبيعات' : 'إضافة مندوب مبيعات'}
      >
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input label="اسم المندوب" onChange={(e) => setName(e.target.value)} value={name} />
            <Input label="رمز المندوب" onChange={(e) => setCode(e.target.value)} value={code} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input label="رقم الجوال" onChange={(e) => setPhone(e.target.value)} value={phone} />
            <Input
              inputMode="decimal"
              label="نسبة العمولة %"
              onChange={(e) => setCommissionPct(e.target.value)}
              value={commissionPct}
            />
            <Input label="لوحة السيارة" onChange={(e) => setVehiclePlate(e.target.value)} value={vehiclePlate} />
          </div>
          <Select
            label="مستودع العهدة المرتبط"
            onChange={(e) => setWarehouseId(e.target.value)}
            options={[
              { value: '', label: 'بدون مستودع مخصص' },
              ...warehouses.map((w) => ({ value: w.id, label: w.name })),
            ]}
            value={warehouseId}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving || !name.trim()} onClick={() => void saveSalesman()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
