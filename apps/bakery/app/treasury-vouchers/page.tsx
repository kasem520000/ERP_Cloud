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
import { numberText } from '../../lib/lookups';
import { makkahTodayIso, openServerPrintHtml } from '../../lib/server-print';

type VoucherRow = Record<string, unknown> & {
  id: string;
  voucherNo?: string;
  number?: string;
  kind?: string;
  subtype?: string;
  status?: string;
  date?: string;
  amount?: string;
  description?: string;
};

export default function BakeryTreasuryVouchersPage() {
  const { can } = useSession();
  const canCreate = can('treasury.voucher.create');
  const canPost = can('treasury.voucher.post');
  const canVoid = can('treasury.voucher.void');

  const [rows, setRows] = useState<VoucherRow[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [cashLocations, setCashLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [parties, setParties] = useState<Array<{ id: string; name: string }>>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; code?: string; nameAr?: string; name?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [kind, setKind] = useState<'receipt' | 'payment'>('payment');
  const [subtype, setSubtype] = useState<'expense' | 'party' | 'general'>('expense');
  const [branchId, setBranchId] = useState('');
  const [cashLocationId, setCashLocationId] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'card'>('cash');
  const [date, setDate] = useState(makkahTodayIso());
  const [voucherAmountText, setVoucherAmountText] = useState('');
  const [vatAmount, setVatAmount] = useState('0');
  const [partyId, setPartyId] = useState('');
  const [counterAccountId, setCounterAccountId] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const [voidTarget, setVoidTarget] = useState<VoucherRow | null>(null);
  const [voidReason, setVoidReason] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [v, br, cl, pr, acc] = await Promise.all([
        apiList<VoucherRow>('/vouchers'),
        apiList<{ id: string; nameAr: string }>('/branches').catch(() => []),
        apiList<{ id: string; name: string }>('/cash-locations?limit=200').catch(() => []),
        apiList<{ id: string; name: string }>('/parties').catch(() => []),
        apiList<{ id: string; code?: string; nameAr?: string; name?: string }>('/accounts').catch(() => []),
      ]);
      setRows(v);
      setBranches(br);
      setCashLocations(cl);
      setParties(pr);
      setAccounts(acc);
      setBranchId((prev) => prev || br[0]?.id || '');
      setCashLocationId((prev) => prev || cl[0]?.id || '');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة سندات الخزينة'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitVoucher = async () => {
    if (!branchId || !cashLocationId || !voucherAmountText.trim() || !description.trim()) {
      setNotice({ tone: 'danger', text: 'الفرع والصندوق والمبلغ والبيان حقول إلزامية.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/vouchers', {
        branchId,
        kind,
        subtype,
        date,
        cashLocationId,
        method,
        amount: new Decimal(voucherAmountText).toString(),
        ...(vatAmount.trim() ? { vatAmount: new Decimal(vatAmount).toString() } : {}),
        ...(partyId ? { partyId } : {}),
        ...(counterAccountId ? { counterAccountId } : {}),
        description: description.trim(),
        idempotencyKey: `bak-vch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      });
      setModalOpen(false);
      setVoucherAmountText('');
      setDescription('');
      setNotice({ tone: 'ok', text: 'تم إنشاء السند كمسودة — رحّله لإثبات الحركة في الصندوق والأستاذ.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إنشاء السند') });
    } finally {
      setSaving(false);
    }
  };

  const postVoucher = async (id: string) => {
    try {
      await apiPost(`/vouchers/${encodeURIComponent(id)}/post`, {});
      setNotice({ tone: 'ok', text: 'تم ترحيل السند المالي بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر ترحيل السند') });
    }
  };

  const confirmVoid = async () => {
    if (!voidTarget || !voidReason.trim()) return;
    try {
      await apiPost(`/vouchers/${encodeURIComponent(voidTarget.id)}/void`, { reason: voidReason.trim() });
      setVoidTarget(null);
      setVoidReason('');
      setNotice({ tone: 'ok', text: 'تم إبطال السند المالي.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إبطال السند') });
    }
  };

  const columns: Column<VoucherRow>[] = [
    { key: 'no', header: 'رقم السند', ltr: true, cell: (r) => String(r.voucherNo ?? r.number ?? r.id.slice(0, 8)) },
    { key: 'kind', header: 'النوع', cell: (r) => (r.kind === 'receipt' ? 'سند قبض' : 'سند صرف / مصروف') },
    { key: 'date', header: 'التاريخ', ltr: true, cell: (r) => String(r.date ?? '').slice(0, 10) || '—' },
    { key: 'desc', header: 'البيان', cell: (r) => String(r.description ?? '—') },
    { key: 'amount', header: 'المبلغ (ر.س)', numeric: true, cell: (r) => numberText(String(r.amount ?? '0')) },
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
          <Button
            onClick={() => void openServerPrintHtml(`/reports/print/vouchers/${encodeURIComponent(r.id)}`)}
            size="sm"
          >
            طباعة
          </Button>
          {r.status === 'draft' && canPost ? (
            <Button onClick={() => void postVoucher(r.id)} size="sm" variant="primary">
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
          <h1 className="ui-page-title">سندات القبض والصرف والمصروفات</h1>
          <p className="ui-page-sub">
            إصدار سندات الصرف والمصروفات اليومية (غاز، كهرباء، صيانة) وسندات القبض اليدوية وترحيلها وطباعتها.
          </p>
        </div>
        <div className="ui-page-actions">
          {canCreate ? (
            <Button onClick={() => setModalOpen(true)} variant="primary">
              + سند قبض / صرف جديد
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
          <CardHeader subtitle="السندات المرحَّلة تُقيد في الصندوق والأستاذ العام فوراً." title="دفتر سندات الخزينة" />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا سندات خزينة مسجلة"
              rows={rows}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setModalOpen(false)} open={modalOpen} title="إصدار سند قبض أو صرف">
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <Select
              label="نوع السند"
              onChange={(e) => setKind(e.target.value as 'receipt' | 'payment')}
              options={[
                { value: 'payment', label: 'سند صرف / مصروف' },
                { value: 'receipt', label: 'سند قبض' },
              ]}
              value={kind}
            />
            <Select
              label="التصنيف"
              onChange={(e) => setSubtype(e.target.value as typeof subtype)}
              options={[
                { value: 'expense', label: 'مصروف تشغيلي' },
                { value: 'party', label: 'عميل / مورد' },
                { value: 'general', label: 'حساب عام' },
              ]}
              value={subtype}
            />
            <Input label="التاريخ" onChange={(e) => setDate(e.target.value)} type="date" value={date} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select
              label="الفرع"
              onChange={(e) => setBranchId(e.target.value)}
              options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
              value={branchId}
            />
            <Select
              label="الصندوق / البنك"
              onChange={(e) => setCashLocationId(e.target.value)}
              options={cashLocations.map((c) => ({ value: c.id, label: c.name }))}
              value={cashLocationId}
            />
            <Select
              label="طريقة الدفع"
              onChange={(e) => setMethod(e.target.value as typeof method)}
              options={[
                { value: 'cash', label: 'نقدي' },
                { value: 'bank_transfer', label: 'تحويل بنكي' },
                { value: 'card', label: 'شبكة / بطاقة' },
              ]}
              value={method}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input
              inputMode="decimal"
              label="المبلغ (ر.س)"
              onChange={(e) => setVoucherAmountText(e.target.value)}
              value={voucherAmountText}
            />
            <Input
              inputMode="decimal"
              label="ضريبة القيمة المضافة إن وجدت"
              onChange={(e) => setVatAmount(e.target.value)}
              value={vatAmount}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="الطرف المرتبط (اختياري)"
              onChange={(e) => setPartyId(e.target.value)}
              options={[{ value: '', label: 'بدون طرف' }, ...parties.map((p) => ({ value: p.id, label: p.name }))]}
              value={partyId}
            />
            <Select
              label="الحساب المقابل في الدليل (اختياري)"
              onChange={(e) => setCounterAccountId(e.target.value)}
              options={[
                { value: '', label: 'تلقائي حسب نوع السند' },
                ...accounts.map((a) => ({ value: a.id, label: `${a.code ?? ''} ${a.nameAr ?? a.name ?? ''}` })),
              ]}
              value={counterAccountId}
            />
          </div>
          <Input label="البيان التفصيلي" onChange={(e) => setDescription(e.target.value)} value={description} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void submitVoucher()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ المسودة'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setVoidTarget(null)} open={Boolean(voidTarget)} title="إبطال سند مالي">
        <div className="grid gap-3">
          <Input label="سبب الإبطال (إلزامي)" onChange={(e) => setVoidReason(e.target.value)} value={voidReason} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setVoidTarget(null)} size="sm">
              تراجع
            </Button>
            <Button disabled={!voidReason.trim()} onClick={() => void confirmVoid()} variant="primary">
              تأكيد الإبطال
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
