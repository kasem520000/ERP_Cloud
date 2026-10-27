'use client';

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

type PayrollRunRow = Record<string, unknown> & {
  id: string;
  yearMonth?: string;
  period?: string;
  status?: string;
  totalNet?: string;
  netTotal?: string;
  employeeCount?: number;
};

export default function BakeryPayrollPage() {
  const { can } = useSession();
  const canManage = can('hrm.manage');
  const canPost = can('hrm.payroll.post');

  const [rows, setRows] = useState<PayrollRunRow[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [cashLocations, setCashLocations] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [yearMonth, setYearMonth] = useState(makkahTodayIso().slice(0, 7));
  const [payTarget, setPayTarget] = useState<PayrollRunRow | null>(null);
  const [branchId, setBranchId] = useState('');
  const [cashLocationId, setCashLocationId] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank_transfer'>('bank_transfer');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [runs, br, cl] = await Promise.all([
        apiList<PayrollRunRow>('/hrm/payroll/runs'),
        apiList<{ id: string; nameAr: string }>('/branches').catch(() => []),
        apiList<{ id: string; name: string }>('/cash-locations?limit=200').catch(() => []),
      ]);
      setRows(runs);
      setBranches(br);
      setCashLocations(cl);
      setBranchId((prev) => prev || br[0]?.id || '');
      setCashLocationId((prev) => prev || cl[0]?.id || '');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة مسيرات الرواتب'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const createRun = async () => {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(yearMonth.trim())) {
      setNotice({ tone: 'danger', text: 'أدخل الشهر بصيغة YYYY-MM مثل 2026-10.' });
      return;
    }
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/hrm/payroll/runs', { yearMonth: yearMonth.trim() });
      setCreateOpen(false);
      setNotice({ tone: 'ok', text: 'تم إعداد مسودة مسير الرواتب بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إنشاء مسير الرواتب') });
    } finally {
      setSaving(false);
    }
  };

  const postRun = async (id: string) => {
    try {
      await apiPost(`/hrm/payroll/runs/${encodeURIComponent(id)}/post`, branchId ? { branchId } : {});
      setNotice({ tone: 'ok', text: 'تم ترحيل استحقاق مسير الرواتب إلى الأستاذ العام.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر ترحيل المسير') });
    }
  };

  const payRun = async () => {
    if (!payTarget || !branchId || !cashLocationId) return;
    setSaving(true);
    try {
      await apiPost(`/hrm/payroll/runs/${encodeURIComponent(payTarget.id)}/pay`, {
        branchId,
        cashLocationId,
        method,
      });
      setPayTarget(null);
      setNotice({ tone: 'ok', text: 'تم صرف مسير الرواتب وتقييد السداد بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر صرف المسير') });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<PayrollRunRow>[] = [
    { key: 'ym', header: 'شهر المسير', ltr: true, cell: (r) => String(r.yearMonth ?? r.period ?? '—') },
    { key: 'count', header: 'عدد الموظفين', numeric: true, cell: (r) => String(r.employeeCount ?? '—') },
    {
      key: 'net',
      header: 'صافي الرواتب (ر.س)',
      numeric: true,
      cell: (r) => numberText(String(r.totalNet ?? r.netTotal ?? '0')),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (
        <Badge status={r.status === 'paid' ? 'active' : r.status === 'posted' ? 'pending' : 'pending'}>
          {r.status === 'paid' ? 'مصروف' : r.status === 'posted' ? 'مرحَّل' : 'مسودة'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراءات',
      cell: (r) => (
        <div className="flex gap-1.5">
          {r.status === 'draft' && canPost ? (
            <Button onClick={() => void postRun(r.id)} size="sm" variant="primary">
              ترحيل الاستحقاق
            </Button>
          ) : null}
          {r.status === 'posted' && canPost ? (
            <Button onClick={() => setPayTarget(r)} size="sm" variant="primary">
              صرف الرواتب
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
          <h1 className="ui-page-title">مسيرات الرواتب الشهرية</h1>
          <p className="ui-page-sub">إعداد مسير الشهر وترحيل قيد الاستحقاق وصرف الرواتب من الصندوق أو البنك.</p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => setCreateOpen(true)} variant="primary">
              + مسير رواتب جديد
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
          <CardHeader subtitle="كل مسير يمر بمسودة ثم ترحيل الاستحقاق ثم الصرف الفعلي." title="سجل مسيرات الرواتب" />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا مسيرات رواتب مسجلة"
              rows={rows}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setCreateOpen(false)} open={createOpen} title="إنشاء مسير رواتب شهري">
        <div className="grid gap-3">
          <Input
            label="الشهر (YYYY-MM)"
            onChange={(e) => setYearMonth(e.target.value)}
            placeholder="2026-10"
            value={yearMonth}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setCreateOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void createRun()} variant="primary">
              {saving ? 'جارٍ الإنشاء…' : 'إنشاء المسير'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setPayTarget(null)} open={Boolean(payTarget)} title="صرف مسير الرواتب">
        <div className="grid gap-3">
          <Select
            label="الفرع"
            onChange={(e) => setBranchId(e.target.value)}
            options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
            value={branchId}
          />
          <Select
            label="الصندوق / البنك الدافع"
            onChange={(e) => setCashLocationId(e.target.value)}
            options={cashLocations.map((c) => ({ value: c.id, label: c.name }))}
            value={cashLocationId}
          />
          <Select
            label="طريقة الصرف"
            onChange={(e) => setMethod(e.target.value as typeof method)}
            options={[
              { value: 'bank_transfer', label: 'تحويل بنكي / مدد' },
              { value: 'cash', label: 'نقدي من الصندوق' },
            ]}
            value={method}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setPayTarget(null)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void payRun()} variant="primary">
              {saving ? 'جارٍ الصرف…' : 'تأكيد الصرف'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
