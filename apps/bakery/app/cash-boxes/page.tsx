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
  SegmentedTabs,
  Select,
  type Column,
} from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPatch, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { numberText } from '../../lib/lookups';

type CashLocationRow = Record<string, unknown> & {
  id: string;
  name: string;
  kind: string;
  branchId?: string;
  accountId?: string | null;
  currencyCode?: string;
  balance?: string;
};

type TransferRow = Record<string, unknown> & {
  id: string;
  transferNo?: string;
  fromName?: string;
  toName?: string;
  amount?: string;
  status?: string;
  createdAt?: string;
};

type MovementRow = Record<string, unknown> & {
  id?: string;
  date?: string;
  description?: string;
  debit?: string;
  credit?: string;
  runningBalance?: string;
};

export default function BakeryCashBoxesPage() {
  const { can } = useSession();
  const canManage = can('organization.cashlocation.manage');
  const canTransfer = can('treasury.transfer.manage');

  const [tab, setTab] = useState<'boxes' | 'transfers'>('boxes');
  const [boxes, setBoxes] = useState<CashLocationRow[]>([]);
  const [transfers, setTransfers] = useState<TransferRow[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [accounts, setAccounts] = useState<Array<{ id: string; code?: string; nameAr?: string; name?: string }>>([]);
  const [balances, setBalances] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [boxModal, setBoxModal] = useState(false);
  const [editing, setEditing] = useState<CashLocationRow | null>(null);
  const [branchId, setBranchId] = useState('');
  const [kind, setKind] = useState<'safe' | 'bank'>('safe');
  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [bankName, setBankName] = useState('');
  const [iban, setIban] = useState('');
  const [saving, setSaving] = useState(false);

  const [transferModal, setTransferModal] = useState(false);
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [transferAmountText, setTransferAmountText] = useState('');

  const [movementsModal, setMovementsModal] = useState<{ name: string; rows: MovementRow[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bx, tr, br, acc] = await Promise.all([
        apiList<CashLocationRow>('/cash-locations?limit=200'),
        apiList<TransferRow>('/cash-transfers').catch(() => []),
        apiList<{ id: string; nameAr: string }>('/branches').catch(() => []),
        apiList<{ id: string; code?: string; nameAr?: string; name?: string }>('/accounts').catch(() => []),
      ]);
      setBoxes(bx);
      setTransfers(tr);
      setBranches(br);
      setAccounts(acc);
      setBranchId((prev) => prev || br[0]?.id || '');
      setFromId((prev) => prev || bx[0]?.id || '');
      setToId((prev) => prev || bx[1]?.id || '');

      const balEntries = await Promise.all(
        bx.slice(0, 30).map(async (b) => {
          try {
            const list = await apiList<{ balance?: string }>(`/cash-locations/${encodeURIComponent(b.id)}/balances`);
            return [b.id, String(list[0]?.balance ?? '0')] as const;
          } catch {
            return [b.id, '0'] as const;
          }
        }),
      );
      setBalances(Object.fromEntries(balEntries));
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة الصناديق والحسابات البنكية'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row?: CashLocationRow) => {
    setEditing(row ?? null);
    setKind((row?.kind as 'safe' | 'bank') ?? 'safe');
    setName(row?.name ?? '');
    setBranchId(row?.branchId ?? branches[0]?.id ?? '');
    setAccountId(String(row?.accountId ?? ''));
    setBankName('');
    setIban('');
    setBoxModal(true);
  };

  const saveBox = async () => {
    if (!name.trim() || !branchId) return;
    setSaving(true);
    setNotice(null);
    try {
      const payload: Record<string, unknown> = {
        branchId,
        ...(editing ? {} : { kind }),
        name: name.trim(),
        currencyCode: 'SAR',
        ...(accountId ? { accountId } : {}),
        ...(kind === 'bank' && bankName.trim()
          ? {
              bank: {
                bankName: bankName.trim(),
                ...(iban.trim() ? { iban: iban.trim().toUpperCase() } : {}),
              },
            }
          : {}),
      };
      if (editing) {
        await apiPatch(`/cash-locations/${encodeURIComponent(editing.id)}`, payload);
      } else {
        await apiPost('/cash-locations', payload);
      }
      setBoxModal(false);
      setNotice({ tone: 'ok', text: 'تم حفظ الصندوق / الحساب البنكي بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ الصندوق') });
    } finally {
      setSaving(false);
    }
  };

  const createTransfer = async () => {
    if (!branchId || !fromId || !toId || fromId === toId || !transferAmountText.trim()) {
      setNotice({ tone: 'danger', text: 'اختر صندوقين مختلفين وأدخل مبلغاً صحيحاً للمناقلة.' });
      return;
    }
    setSaving(true);
    try {
      const created = await apiPost<{ id?: string }>('/cash-transfers', {
        branchId,
        fromCashLocationId: fromId,
        toCashLocationId: toId,
        amount: new Decimal(transferAmountText).toString(),
      });
      if (created?.id) {
        await apiPost(`/cash-transfers/${encodeURIComponent(created.id)}/send`, {});
      }
      setTransferModal(false);
      setTransferAmountText('');
      setNotice({ tone: 'ok', text: 'تم إنشاء المناقلة النقدية واعتماد إرسالها.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إنشاء المناقلة النقدية') });
    } finally {
      setSaving(false);
    }
  };

  const receiveTransfer = async (id: string) => {
    try {
      await apiPost(`/cash-transfers/${encodeURIComponent(id)}/receive`, {});
      setNotice({ tone: 'ok', text: 'تم تأكيد استلام المناقلة النقدية وترحيل القيد.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر تأكيد الاستلام') });
    }
  };

  const showMovements = async (box: CashLocationRow) => {
    try {
      const res = await apiData<{ rows?: MovementRow[]; movements?: MovementRow[] } | MovementRow[]>(
        `/cash-locations/${encodeURIComponent(box.id)}/movements?all=1`,
      );
      const list = Array.isArray(res) ? res : (res.rows ?? res.movements ?? []);
      setMovementsModal({ name: box.name, rows: list });
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر قراءة كشف حركة الصندوق') });
    }
  };

  const boxColumns: Column<CashLocationRow>[] = [
    { key: 'name', header: 'اسم الصندوق / البنك', cell: (r) => r.name },
    { key: 'kind', header: 'النوع', cell: (r) => (r.kind === 'bank' ? 'حساب بنكي' : 'صندوق نقدي') },
    {
      key: 'balance',
      header: 'الرصيد الحالي (ر.س)',
      numeric: true,
      cell: (r) => numberText(balances[r.id] ?? '0'),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      cell: (r) => (
        <div className="flex flex-wrap gap-1.5">
          <Button onClick={() => void showMovements(r)} size="sm">
            كشف الحركة
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

  const transferColumns: Column<TransferRow>[] = [
    { key: 'no', header: 'رقم المناقلة', ltr: true, cell: (r) => String(r.transferNo ?? r.id.slice(0, 8)) },
    { key: 'from', header: 'من', cell: (r) => String(r.fromName ?? '—') },
    { key: 'to', header: 'إلى', cell: (r) => String(r.toName ?? '—') },
    { key: 'amount', header: 'المبلغ (ر.س)', numeric: true, cell: (r) => numberText(String(r.amount ?? '0')) },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (
        <Badge status={r.status === 'received' ? 'active' : 'pending'}>{String(r.status ?? '—')}</Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراء',
      cell: (r) =>
        r.status === 'sent' && canTransfer ? (
          <Button onClick={() => void receiveTransfer(r.id)} size="sm" variant="primary">
            تأكيد الاستلام
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
          <h1 className="ui-page-title">الصناديق والحسابات البنكية والمناقلات</h1>
          <p className="ui-page-sub">
            إدارة مواضع النقد والبنوك وأرصدتها الحية وكشف الحركات والمناقلات المالية بينها.
          </p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => openEditor()} variant="primary">
              + صندوق / بنك جديد
            </Button>
          ) : null}
          {canTransfer ? (
            <Button onClick={() => setTransferModal(true)} size="sm">
              + مناقلة نقدية
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
            { key: 'boxes', label: `الصناديق والبنوك (${boxes.length})` },
            { key: 'transfers', label: `المناقلات النقدية (${transfers.length})` },
          ]}
          value={tab}
        />

        <Card>
          <CardHeader subtitle="الأرصدة مقروءة مباشرة من الخادم." title={tab === 'boxes' ? 'مواضع النقد والبنوك' : 'سجل المناقلات'} />
          <CardBody>
            {tab === 'boxes' ? (
              <DataTable
                columns={boxColumns}
                empty="لا صناديق مسجلة"
                rows={boxes}
                rowKey={rowKeyFrom(['id'])}
                state={listState({ loading, error })}
              />
            ) : (
              <DataTable
                columns={transferColumns}
                empty="لا مناقلات نقدية"
                rows={transfers}
                rowKey={rowKeyFrom(['id'])}
                state={listState({ loading, error })}
              />
            )}
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setBoxModal(false)} open={boxModal} title={editing ? 'تعديل موضع نقد' : 'إضافة صندوق أو حساب بنكي'}>
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="الفرع"
              onChange={(e) => setBranchId(e.target.value)}
              options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
              value={branchId}
            />
            {!editing ? (
              <Select
                label="النوع"
                onChange={(e) => setKind(e.target.value as 'safe' | 'bank')}
                options={[
                  { value: 'safe', label: 'صندوق نقدي' },
                  { value: 'bank', label: 'حساب بنكي' },
                ]}
                value={kind}
              />
            ) : null}
          </div>
          <Input label="الاسم" onChange={(e) => setName(e.target.value)} value={name} />
          <Select
            label="حساب الأستاذ المرتبط (اختياري)"
            onChange={(e) => setAccountId(e.target.value)}
            options={[
              { value: '', label: 'الحساب الافتراضي' },
              ...accounts.map((a) => ({ value: a.id, label: `${a.code ?? ''} ${a.nameAr ?? a.name ?? ''}` })),
            ]}
            value={accountId}
          />
          {kind === 'bank' ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input label="اسم البنك" onChange={(e) => setBankName(e.target.value)} value={bankName} />
              <Input label="رقم الآيبان IBAN" onChange={(e) => setIban(e.target.value)} value={iban} />
            </div>
          ) : null}
          <div className="flex justify-end gap-2">
            <Button onClick={() => setBoxModal(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving || !name.trim()} onClick={() => void saveBox()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setTransferModal(false)} open={transferModal} title="مناقلة مالية بين الصناديق والبنوك">
        <div className="grid gap-3">
          <Select
            label="من الصندوق / البنك المصدر"
            onChange={(e) => setFromId(e.target.value)}
            options={boxes.map((b) => ({ value: b.id, label: b.name }))}
            value={fromId}
          />
          <Select
            label="إلى الصندوق / البنك المستلم"
            onChange={(e) => setToId(e.target.value)}
            options={boxes.map((b) => ({ value: b.id, label: b.name }))}
            value={toId}
          />
          <Input
            inputMode="decimal"
            label="المبلغ (ر.س)"
            onChange={(e) => setTransferAmountText(e.target.value)}
            value={transferAmountText}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setTransferModal(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void createTransfer()} variant="primary">
              {saving ? 'جارٍ الإرسال…' : 'إرسال المناقلة'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        onClose={() => setMovementsModal(null)}
        open={Boolean(movementsModal)}
        title={`كشف حركة: ${movementsModal?.name ?? ''}`}
      >
        <DataTable
          columns={[
            { key: 'date', header: 'التاريخ', ltr: true, cell: (r) => String(r.date ?? '').slice(0, 10) || '—' },
            { key: 'desc', header: 'البيان', cell: (r) => String(r.description ?? '—') },
            { key: 'debit', header: 'وارد', numeric: true, cell: (r) => numberText(String(r.debit ?? '0')) },
            { key: 'credit', header: 'منصرف', numeric: true, cell: (r) => numberText(String(r.credit ?? '0')) },
          ]}
          empty="لا حركات مسجلة لهذا الصندوق"
          rows={movementsModal?.rows ?? []}
          rowKey={rowKeyFrom(['id'])}
          state={{ kind: 'ready' }}
        />
      </Modal>
    </section>
  );
}
