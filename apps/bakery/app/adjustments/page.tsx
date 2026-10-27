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
import { makkahTodayIso } from '../../lib/server-print';

type HrmAdjustmentRow = Record<string, unknown> & {
  id: string;
  employeeId?: string;
  employeeName?: string;
  typeName?: string;
  valueText?: string;
  amount?: string;
  startsOn?: string;
  status?: string;
  reason?: string | null;
};

export default function BakeryAdjustmentsPage() {
  const { can } = useSession();
  const canManage = can('hrm.manage');
  const canApprove = can('hrm.adjust.approve');

  const [rows, setRows] = useState<HrmAdjustmentRow[]>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [types, setTypes] = useState<Array<{ id: string; nameAr?: string; name?: string }>>([]);
  const [cashLocations, setCashLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [employeeId, setEmployeeId] = useState('');
  const [typeId, setTypeId] = useState('');
  const [valueText, setValueText] = useState('');
  const [startsOn, setStartsOn] = useState(makkahTodayIso());
  const [subFromSalary, setSubFromSalary] = useState(true);
  const [cashLocationId, setCashLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [adj, emp, tp, cl] = await Promise.all([
        apiList<HrmAdjustmentRow>('/hrm/adjustments'),
        apiList<{ id: string; name: string }>('/hrm/employees').catch(() => []),
        apiList<{ id: string; nameAr?: string; name?: string }>('/hrm/adjustment-types').catch(() => []),
        apiList<{ id: string; name: string }>('/cash-locations?limit=200').catch(() => []),
      ]);
      setRows(adj);
      setEmployees(emp);
      setTypes(tp);
      setCashLocations(cl);
      setEmployeeId((prev) => prev || emp[0]?.id || '');
      setTypeId((prev) => prev || tp[0]?.id || '');
      setCashLocationId((prev) => prev || cl[0]?.id || '');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة المكافآت والخصومات'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const submitAdjustment = async () => {
    if (!employeeId || !typeId || !valueText.trim()) {
      setNotice({ tone: 'danger', text: 'الموظف والنوع والمبلغ حقول إلزامية.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/hrm/adjustments', {
        employeeId,
        typeId,
        valueText: new Decimal(valueText).toString(),
        startsOn,
        subFromSalary,
        ...(!subFromSalary && cashLocationId ? { paymentMethod: 'cash', cashLocationId } : {}),
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setModalOpen(false);
      setValueText('');
      setReason('');
      setNotice({ tone: 'ok', text: 'تم تسجيل البند المالي للموظف بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر تسجيل البند') });
    } finally {
      setSaving(false);
    }
  };

  const approveRow = async (id: string) => {
    try {
      await apiPost(`/hrm/adjustments/${encodeURIComponent(id)}/approve`, {});
      setNotice({ tone: 'ok', text: 'تم اعتماد البند ليدخل في مسير الرواتب.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر اعتماد البند') });
    }
  };

  const columns: Column<HrmAdjustmentRow>[] = [
    {
      key: 'emp',
      header: 'الموظف',
      cell: (r) => r.employeeName ?? employees.find((e) => e.id === r.employeeId)?.name ?? '—',
    },
    { key: 'type', header: 'النوع', cell: (r) => String(r.typeName ?? '—') },
    {
      key: 'val',
      header: 'القيمة (ر.س)',
      numeric: true,
      cell: (r) => numberText(String(r.valueText ?? r.amount ?? '0')),
    },
    { key: 'startsOn', header: 'تاريخ السريان', ltr: true, cell: (r) => String(r.startsOn ?? '').slice(0, 10) || '—' },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (
        <Badge status={r.status === 'approved' ? 'active' : 'pending'}>
          {r.status === 'approved' ? 'معتمد' : String(r.status ?? 'بانتظار الاعتماد')}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراء',
      cell: (r) =>
        r.status !== 'approved' && canApprove ? (
          <Button onClick={() => void approveRow(r.id)} size="sm" variant="primary">
            اعتماد
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
          <h1 className="ui-page-title">المكافآت والخصومات والسُّلَف</h1>
          <p className="ui-page-sub">إدارة الإضافات والاستقطاعات الشهرية للموظفين واعتمادها قبل إعداد مسير الرواتب.</p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => setModalOpen(true)} variant="primary">
              + تسجيل مكافأة / خصم
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
          <CardHeader subtitle="البنود المعتمدة تُدرج تلقائياً في مسير الرواتب الشهري." title="سجل التسويات الوظيفية" />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا مكافآت أو خصومات مسجلة"
              rows={rows}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setModalOpen(false)} open={modalOpen} title="تسجيل مكافأة أو خصم لموظف">
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Select
              label="الموظف"
              onChange={(e) => setEmployeeId(e.target.value)}
              options={employees.map((em) => ({ value: em.id, label: em.name }))}
              value={employeeId}
            />
            <Select
              label="نوع البند"
              onChange={(e) => setTypeId(e.target.value)}
              options={types.map((t) => ({ value: t.id, label: t.nameAr ?? t.name ?? t.id }))}
              value={typeId}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Input inputMode="decimal" label="المبلغ (ر.س)" onChange={(e) => setValueText(e.target.value)} value={valueText} />
            <Input label="تاريخ السريان" onChange={(e) => setStartsOn(e.target.value)} type="date" value={startsOn} />
          </div>
          <label className="flex items-center gap-2 text-[12.5px] font-semibold">
            <input checked={subFromSalary} onChange={(e) => setSubFromSalary(e.target.checked)} type="checkbox" />
            تسوية مع مسير الراتب الشهري (إلغاء التحديد للصرف الفوري من الصندوق)
          </label>
          {!subFromSalary ? (
            <Select
              label="الصندوق الدافع"
              onChange={(e) => setCashLocationId(e.target.value)}
              options={cashLocations.map((c) => ({ value: c.id, label: c.name }))}
              value={cashLocationId}
            />
          ) : null}
          <Input label="السبب / الملاحظات" onChange={(e) => setReason(e.target.value)} value={reason} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void submitAdjustment()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
