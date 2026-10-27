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
import { makkahTodayIso } from '../../lib/server-print';

type EmployeeRow = Record<string, unknown> & {
  id: string;
  employeeNo?: string;
  name: string;
  mobile?: string | null;
  nationalId?: string | null;
  hireDate?: string | null;
  status?: string;
  departmentId?: string | null;
  jobId?: string | null;
  branchId?: string | null;
  salaryComponents?: Record<string, string> | null;
};

export default function BakeryEmployeesPage() {
  const { can } = useSession();
  const canManage = can('hrm.manage');

  const [rows, setRows] = useState<EmployeeRow[]>([]);
  const [departments, setDepartments] = useState<Array<{ id: string; nameAr?: string; name?: string }>>([]);
  const [jobs, setJobs] = useState<Array<{ id: string; nameAr?: string; title?: string }>>([]);
  const [branches, setBranches] = useState<Array<{ id: string; nameAr: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<EmployeeRow | null>(null);
  const [employeeNo, setEmployeeNo] = useState('');
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [nationalId, setNationalId] = useState('');
  const [hireDate, setHireDate] = useState(makkahTodayIso());
  const [departmentId, setDepartmentId] = useState('');
  const [jobId, setJobId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [basicSalary, setBasicSalary] = useState('0');
  const [housing, setHousing] = useState('0');
  const [transport, setTransport] = useState('0');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [emp, dep, jb, br] = await Promise.all([
        apiList<EmployeeRow>('/hrm/employees'),
        apiList<{ id: string; nameAr?: string; name?: string }>('/hrm/departments').catch(() => []),
        apiList<{ id: string; nameAr?: string; title?: string }>('/hrm/jobs').catch(() => []),
        apiList<{ id: string; nameAr: string }>('/branches').catch(() => []),
      ]);
      setRows(emp);
      setDepartments(dep);
      setJobs(jb);
      setBranches(br);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة سجل الموظفين'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row?: EmployeeRow) => {
    setEditing(row ?? null);
    setEmployeeNo(String(row?.employeeNo ?? `EMP-${rows.length + 1}`));
    setName(row?.name ?? '');
    setMobile(String(row?.mobile ?? ''));
    setNationalId(String(row?.nationalId ?? ''));
    setHireDate(String(row?.hireDate ?? makkahTodayIso()).slice(0, 10));
    setDepartmentId(String(row?.departmentId ?? departments[0]?.id ?? ''));
    setJobId(String(row?.jobId ?? jobs[0]?.id ?? ''));
    setBranchId(String(row?.branchId ?? branches[0]?.id ?? ''));
    const comp = row?.salaryComponents ?? {};
    setBasicSalary(comp.basic ?? '0');
    setHousing(comp.housing ?? '0');
    setTransport(comp.transport ?? '0');
    setModalOpen(true);
  };

  const saveEmployee = async () => {
    if (!employeeNo.trim() || !name.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const salaryComponents: Record<string, string> = {
        basic: new Decimal(basicSalary || '0').toString(),
        housing: new Decimal(housing || '0').toString(),
        transport: new Decimal(transport || '0').toString(),
      };
      const payload: Record<string, unknown> = {
        employeeNo: employeeNo.trim(),
        name: name.trim(),
        ...(mobile.trim() ? { mobile: mobile.trim() } : {}),
        ...(nationalId.trim() ? { nationalId: nationalId.trim() } : {}),
        ...(hireDate ? { hireDate } : {}),
        ...(departmentId ? { departmentId } : {}),
        ...(jobId ? { jobId } : {}),
        ...(branchId ? { branchId } : {}),
        salaryComponents,
      };
      if (editing) {
        await apiPatch(`/hrm/employees/${encodeURIComponent(editing.id)}`, payload);
      } else {
        await apiPost('/hrm/employees', payload);
      }
      setModalOpen(false);
      setNotice({ tone: 'ok', text: 'تم حفظ بطاقة الموظف بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ بيانات الموظف') });
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        String(r.employeeNo ?? '').toLowerCase().includes(q) ||
        String(r.mobile ?? '').toLowerCase().includes(q),
    );
  }, [rows, query]);

  const columns: Column<EmployeeRow>[] = [
    { key: 'employeeNo', header: 'الرقم الوظيفي', ltr: true, cell: (r) => String(r.employeeNo ?? '—') },
    { key: 'name', header: 'اسم الموظف', cell: (r) => r.name },
    { key: 'mobile', header: 'الجوال', ltr: true, cell: (r) => String(r.mobile ?? '—') },
    { key: 'hireDate', header: 'تاريخ المباشرة', ltr: true, cell: (r) => String(r.hireDate ?? '').slice(0, 10) || '—' },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (
        <Badge status={r.status === 'active' || !r.status ? 'active' : 'pending'}>
          {r.status === 'active' || !r.status ? 'نشط' : String(r.status)}
        </Badge>
      ),
    },
    {
      key: 'actions',
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
          <h1 className="ui-page-title">الموظفون وشؤون العاملين</h1>
          <p className="ui-page-sub">بطاقات موظفي المخبز والخبّازين والمناديب ومكونات رواتبهم الأساسية.</p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => openEditor()} variant="primary">
              + موظف جديد
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
          <CardHeader subtitle="بحث بالاسم أو الرقم الوظيفي أو الجوال." title={`سجل الموظفين (${filtered.length})`} />
          <CardBody>
            <div className="mb-3 max-w-md">
              <Input label="بحث سريع" onChange={(e) => setQuery(e.target.value)} value={query} />
            </div>
            <DataTable
              columns={columns}
              empty="لا موظفين مسجلين"
              rows={filtered}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setModalOpen(false)} open={modalOpen} title={editing ? 'تعديل بطاقة موظف' : 'إضافة موظف جديد'}>
        <div className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <Input label="الرقم الوظيفي" onChange={(e) => setEmployeeNo(e.target.value)} value={employeeNo} />
            <Input label="الاسم الكامل" onChange={(e) => setName(e.target.value)} value={name} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input label="رقم الجوال" onChange={(e) => setMobile(e.target.value)} value={mobile} />
            <Input label="الهوية / الإقامة" onChange={(e) => setNationalId(e.target.value)} value={nationalId} />
            <Input label="تاريخ المباشرة" onChange={(e) => setHireDate(e.target.value)} type="date" value={hireDate} />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Select
              label="الفرع"
              onChange={(e) => setBranchId(e.target.value)}
              options={[{ value: '', label: 'عام' }, ...branches.map((b) => ({ value: b.id, label: b.nameAr }))]}
              value={branchId}
            />
            <Select
              label="القسم"
              onChange={(e) => setDepartmentId(e.target.value)}
              options={[
                { value: '', label: 'بدون قسم' },
                ...departments.map((d) => ({ value: d.id, label: d.nameAr ?? d.name ?? d.id })),
              ]}
              value={departmentId}
            />
            <Select
              label="الوظيفة"
              onChange={(e) => setJobId(e.target.value)}
              options={[
                { value: '', label: 'بدون مسمى' },
                ...jobs.map((j) => ({ value: j.id, label: j.nameAr ?? j.title ?? j.id })),
              ]}
              value={jobId}
            />
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <Input
              inputMode="decimal"
              label="الراتب الأساسي"
              onChange={(e) => setBasicSalary(e.target.value)}
              value={basicSalary}
            />
            <Input inputMode="decimal" label="بدل السكن" onChange={(e) => setHousing(e.target.value)} value={housing} />
            <Input
              inputMode="decimal"
              label="بدل النقل"
              onChange={(e) => setTransport(e.target.value)}
              value={transport}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving || !name.trim()} onClick={() => void saveEmployee()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
