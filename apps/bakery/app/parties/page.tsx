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
  SegmentedTabs,
  type Column,
} from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost, apiPut } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { numberText } from '../../lib/lookups';

type PartyRow = Record<string, unknown> & {
  id: string;
  kind?: string;
  name: string;
  phone?: string | null;
  taxNo?: string | null;
  creditLimit?: string | null;
  paymentTermsDays?: number | null;
  creditHold?: boolean;
  address?: Record<string, unknown> | null;
};

export default function BakeryPartiesPage() {
  const { can } = useSession();
  const canManage = can('parties.manage');

  const [kind, setKind] = useState<'customer' | 'supplier'>('customer');
  const [rows, setRows] = useState<PartyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PartyRow | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [taxNo, setTaxNo] = useState('');
  const [city, setCity] = useState('');
  const [district, setDistrict] = useState('');
  const [street, setStreet] = useState('');
  const [buildingNo, setBuildingNo] = useState('');
  const [postalCode, setPostalCode] = useState('');
  const [creditLimit, setCreditLimit] = useState('');
  const [paymentTermsDays, setPaymentTermsDays] = useState('');
  const [creditHold, setCreditHold] = useState(false);
  const [saving, setSaving] = useState(false);

  const [balanceModal, setBalanceModal] = useState<{ name: string; balance: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiList<PartyRow>(`/parties?kind=${kind}`);
      setRows(list);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة سجل الأطراف'));
    } finally {
      setLoading(false);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row?: PartyRow) => {
    setEditing(row ?? null);
    setName(row?.name ?? '');
    setPhone(String(row?.phone ?? ''));
    setTaxNo(String(row?.taxNo ?? ''));
    const addr = (row?.address ?? {}) as Record<string, string>;
    setCity(addr.city ?? '');
    setDistrict(addr.district ?? '');
    setStreet(addr.street ?? '');
    setBuildingNo(addr.buildingNo ?? '');
    setPostalCode(addr.postalCode ?? '');
    setCreditLimit(String(row?.creditLimit ?? ''));
    setPaymentTermsDays(row?.paymentTermsDays != null ? String(row.paymentTermsDays) : '');
    setCreditHold(Boolean(row?.creditHold));
    setModalOpen(true);
  };

  const saveParty = async () => {
    if (!name.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const hasAddress = Boolean(
        city.trim() || district.trim() || street.trim() || buildingNo.trim() || postalCode.trim(),
      );
      const body: Record<string, unknown> = {
        kind,
        name: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(taxNo.trim() ? { taxNo: taxNo.trim() } : {}),
        ...(creditLimit.trim() ? { creditLimit: new Decimal(creditLimit).toString() } : {}),
        ...(paymentTermsDays.trim() ? { paymentTermsDays: Number(paymentTermsDays) } : {}),
        creditHold,
        ...(hasAddress
          ? {
              address: {
                ...(city.trim() ? { city: city.trim() } : {}),
                ...(district.trim() ? { district: district.trim() } : {}),
                ...(street.trim() ? { street: street.trim() } : {}),
                ...(buildingNo.trim() ? { buildingNo: buildingNo.trim() } : {}),
                ...(postalCode.trim() ? { postalCode: postalCode.trim() } : {}),
                country: 'SA',
              },
            }
          : {}),
      };
      if (editing) {
        await apiPut(`/parties/${encodeURIComponent(editing.id)}`, body);
      } else {
        await apiPost('/parties', body);
      }
      setModalOpen(false);
      setNotice({ tone: 'ok', text: 'تم حفظ بطاقة الطرف بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ بطاقة الطرف') });
    } finally {
      setSaving(false);
    }
  };

  const inspectBalance = async (row: PartyRow) => {
    try {
      const res = await apiData<{ balance?: string; netBalance?: string }>(
        `/parties/${encodeURIComponent(row.id)}/balance`,
      );
      setBalanceModal({
        name: row.name,
        balance: String(res.balance ?? res.netBalance ?? '0'),
      });
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر قراءة رصيد الطرف') });
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        String(r.phone ?? '').toLowerCase().includes(q) ||
        String(r.taxNo ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  const columns: Column<PartyRow>[] = [
    { key: 'name', header: kind === 'customer' ? 'اسم العميل' : 'اسم المورد', cell: (r) => r.name },
    { key: 'phone', header: 'الجوال', ltr: true, cell: (r) => String(r.phone ?? '—') },
    { key: 'taxNo', header: 'الرقم الضريبي', ltr: true, cell: (r) => String(r.taxNo ?? 'غير مسجل') },
    {
      key: 'creditLimit',
      header: 'سقف الائتمان',
      numeric: true,
      cell: (r) => (r.creditLimit ? `${numberText(String(r.creditLimit))} ر.س` : '—'),
    },
    {
      key: 'hold',
      header: 'الائتمان',
      cell: (r) => (
        <Badge status={r.creditHold ? 'rejected' : 'active'}>{r.creditHold ? 'موقوف' : 'نشط'}</Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => void inspectBalance(r)} size="sm">
            الرصيد
          </Button>
          {canManage ? (
            <Button onClick={() => openEditor(r)} size="sm">
              تعديل
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
          <h1 className="ui-page-title">العملاء والموردون</h1>
          <p className="ui-page-sub">
            إدارة بيانات العملاء والموردين والرقم الضريبي والعنوان الوطني (يُطبع تلقائياً عند وجود رقم ضريبي).
          </p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => openEditor()} variant="primary">
              + {kind === 'customer' ? 'عميل جديد' : 'مورد جديد'}
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
          onChange={(next) => setKind(next as typeof kind)}
          items={[
            { key: 'customer', label: 'العملاء' },
            { key: 'supplier', label: 'الموردون' },
          ]}
          value={kind}
        />

        <Card>
          <CardHeader subtitle="ابحث بالاسم أو الجوال أو الرقم الضريبي." title={kind === 'customer' ? 'دفتر العملاء' : 'دفتر الموردين'} />
          <CardBody>
            <div className="mb-3 max-w-md">
              <Input label="بحث سريع" onChange={(e) => setQuery(e.target.value)} value={query} />
            </div>
            <DataTable
              columns={columns}
              empty="لا أطراف مسجلة في هذا التصنيف"
              rows={filtered}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal
        onClose={() => setModalOpen(false)}
        open={modalOpen}
        title={editing ? 'تعديل بيانات الطرف' : kind === 'customer' ? 'إضافة عميل جديد' : 'إضافة مورد جديد'}
      >
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input label="الاسم الرسمي" onChange={(e) => setName(e.target.value)} value={name} />
            <Input label="رقم الجوال" onChange={(e) => setPhone(e.target.value)} value={phone} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              label="الرقم الضريبي (15 رقماً)"
              onChange={(e) => setTaxNo(e.target.value)}
              placeholder="300..."
              value={taxNo}
            />
            <Input
              inputMode="decimal"
              label="سقف الائتمان (ر.س)"
              onChange={(e) => setCreditLimit(e.target.value)}
              value={creditLimit}
            />
            <Input
              inputMode="numeric"
              label="أجل السداد (يوم)"
              onChange={(e) => setPaymentTermsDays(e.target.value)}
              value={paymentTermsDays}
            />
          </div>
          <div className="grid gap-2 rounded-lg border border-line bg-surface-2 p-2.5 sm:grid-cols-3">
            <Input label="المدينة (العنوان الوطني)" onChange={(e) => setCity(e.target.value)} value={city} />
            <Input label="الحي" onChange={(e) => setDistrict(e.target.value)} value={district} />
            <Input label="الشارع" onChange={(e) => setStreet(e.target.value)} value={street} />
            <Input label="رقم المبنى" onChange={(e) => setBuildingNo(e.target.value)} value={buildingNo} />
            <Input label="الرمز البريدي" onChange={(e) => setPostalCode(e.target.value)} value={postalCode} />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] font-semibold">
            <input checked={creditHold} onChange={(e) => setCreditHold(e.target.checked)} type="checkbox" />
            إيقاف البيع الآجل مؤقتاً لهذا الطرف
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving || !name.trim()} onClick={() => void saveParty()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setBalanceModal(null)} open={Boolean(balanceModal)} title="الرصيد المحاسبي الحالي">
        {balanceModal ? (
          <div className="grid gap-2 text-[14px]">
            <div>
              الطرف: <strong>{balanceModal.name}</strong>
            </div>
            <div>
              الرصيد القائم في الأستاذ: <strong>{numberText(balanceModal.balance)} ر.س</strong>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
