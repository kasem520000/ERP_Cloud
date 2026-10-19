'use client';

import { useMemo, useState } from 'react';
import { ContactRound } from 'lucide-react';
import { Panel } from '@erp/ui';

import { CommentsPanel } from '../../../components/comments-panel';
import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { apiDelete, apiList, apiPatch, apiPost, ApiError } from '../../../lib/api';
import { branchOptions, listBranches, money, shortDate, type Branch } from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

/**
 * تعريف موظف — `Form_WPF/frmEmployees.xaml` («تعريف موظف»).
 *
 * The window is a card of five regions over the grid «قائمة الموظفين»:
 *
 *   • «بيانات الموظف الأساسية» — اسم الموظف · رقم الحساب · الإدارة · القسم · الوظيفة ·
 * الحالة · تاريخ الميلاد · تاريخ التعيين · رقم التأمينات · الحالة الاجتماعية ·
 * الجنسية · النوع (ذكر/أنثى) · رقم الهاتف · رقم الموبايل · البريد الإلكتروني
 *   • «الرواتب والمستحقات» — الراتب الأساسي · بدل سكن · بدل مواصلات · طعام · طبي ·
 * مكافأة ثابتة · أخرى · إجمالي الرواتب والمستحقات
 *   • «البيانات التكميلية» — العنوان · رقم الهوية · رقم الحساب البنكي · اسم البنك · ملاحظات
 *   • «صورة الموظف» / «فروع الموظف» — deferred, see `PHASE_08_HRM.md` §10
 *   • the action bar — ` إضافة جديد · حفظ · جديد · حذف · طباعة · خروج`
 *     with the navigator `⏮ أول · ◀ السابق · التالي ▶ · ⏭ الأخير` and «السجل:» beside it.
 *
 * `CalculateTotalSalary()` recomputes «إجمالي الرواتب والمستحقات» on every keystroke, and
 * so does this screen; `BtnSave_Click` refuses an empty name («يجب إدخال اسم الموظف»)
 * and `BtnDelete_Click` refuses an employee with a user or with invoices. All three
 * sentences are the window's own, and they come back from the API unchanged.
 */
type EmployeeCard = {
  id: string;
  employeeNo: string;
  name: string;
  branchId?: string | null;
  departmentId?: string | null;
  jobId?: string | null;
  status: string;
  statusLabel?: string;
  hireDate?: string | null;
  birthDate?: string | null;
  insuranceNo?: string | null;
  nationalId?: string | null;
  iqamaExpiresOn?: string | null;
  insuranceExpiresOn?: string | null;
  gosiScheme?: string | null;
  maritalStatus?: string | null;
  nationality?: string | null;
  gender?: string | null;
  phone?: string | null;
  mobile?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  accountCode?: string | null;
  employeeAccountId?: string | null;
  salaryComponents?: Record<string, string>;
  bank?: Record<string, string | undefined> | null;
  departmentName?: string | null;
  managementId?: string | null;
  managementName?: string | null;
  sectionId?: string | null;
  sectionName?: string | null;
  jobName?: string | null;
  totalSalary?: string;
  photoFileId?: string | null;
  branches?: Array<{ branchId: string; branchName?: string | null; branchCode?: string | null }>;
};

type Department = {
  id: string;
  code: string;
  name: string;
  parentId?: string | null;
  kind?: 'management' | 'section';
  parentName?: string | null;
  employeeCount?: number;
  sectionCount?: number;
};
type Job = { id: string; code: string; name: string };

/** «الرواتب والمستحقات» — the window's seven rows, in its own order. */
const SALARY_ROWS: Array<{ key: string; label: string }> = [
  { key: 'basic', label: 'الراتب الأساسي' },
  { key: 'housing', label: 'بدل سكن' },
  { key: 'transport', label: 'بدل مواصلات' },
  { key: 'food', label: 'طعام' },
  { key: 'medical', label: 'طبي' },
  { key: 'fixedBonus', label: 'مكافأة ثابتة' },
  { key: 'other', label: 'أخرى' },
];

/** «الحالة» — `cmbStatus` reads a `States` lookup; the cloud names the three it holds. */
const STATUS_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'active', label: 'نشط' },
  { id: 'suspended', label: 'موقوف' },
  { id: 'terminated', label: 'منتهي الخدمة' },
];
const MARITAL_OPTIONS = ['أعزب', 'متزوج', 'مطلق', 'أرمل'];

const BLANK = {
  id: '',
  employeeNo: '',
  name: '',
  branchId: '',
  managementId: '',
  departmentId: '',
  jobId: '',
  status: 'active',
  hireDate: '',
  birthDate: '',
  insuranceNo: '',
  nationalId: '',
  iqamaExpiresOn: '',
  insuranceExpiresOn: '',
  gosiScheme: '',
  bankCode: '',
  maritalStatus: '',
  nationality: '',
  gender: 'male',
  phone: '',
  mobile: '',
  email: '',
  address: '',
  notes: '',
  accountCode: '',
  iban: '',
  bankNo: '',
  bankName: '',
  photoFileId: '',
  branchIds: [] as string[],
  salary: {
    basic: '',
    housing: '',
    transport: '',
    food: '',
    medical: '',
    fixedBonus: '',
    other: '',
  } as Record<string, string>,
};

type Form = typeof BLANK;

export default function EmployeesPage() {
  const { can } = useSession();
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const [form, setForm] = useState<Form>({ ...BLANK, salary: { ...BLANK.salary } });
  const [cursor, setCursor] = useState(-1);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();

  const employees = useQuery<EmployeeCard[]>(
    () => apiList<EmployeeCard>(`/hrm/employees${term ? `?q=${encodeURIComponent(term)}` : ''}`),
    [term],
  );
  const departments = useQuery<Department[]>(() => apiList<Department>('/hrm/departments'), []);
  const jobs = useQuery<Job[]>(() => apiList<Job>('/hrm/jobs'), []);
  const branches = useQuery<Branch[]>(() => listBranches(), []);

  const deptRows = departments.data ?? [];
  const managements = deptRows.filter((row) => row.kind === 'management');
  const sections = useMemo(
    () => deptRows.filter((row) => row.parentId === (form.managementId || '\x00')),
    [deptRows, form.managementId],
  );
  const rows = employees.data ?? [];
  const canManage = can('hrm.manage');
  const editing = form.id !== '';

  // «إجمالي الرواتب والمستحقات» — `CalculateTotalSalary()`, on every change.
  const salaryTotal = SALARY_ROWS.reduce((sum, row) => sum + Number(form.salary[row.key] || 0), 0);

  const reload = () => {
    employees.reload();
    departments.reload();
  };

  const fail = (error: unknown) => {
    const caught = error instanceof ApiError ? error : undefined;
    setMessage({
      kind: 'danger',
      text: caught ? `${caught.message}${caught.detail ? ` — ${caught.detail}` : ''}` : String(error),
    });
  };

  const openCard = (row: EmployeeCard) => {
    setForm({
      id: row.id,
      employeeNo: row.employeeNo,
      name: row.name,
      branchId: row.branchId ?? '',
      managementId: row.managementId ?? '',
      departmentId: row.departmentId ?? '',
      jobId: row.jobId ?? '',
      status: row.status,
      hireDate: row.hireDate ? String(row.hireDate).slice(0, 10) : '',
      birthDate: row.birthDate ? String(row.birthDate).slice(0, 10) : '',
      insuranceNo: row.insuranceNo ?? '',
      nationalId: row.nationalId ?? '',
      iqamaExpiresOn: row.iqamaExpiresOn ? String(row.iqamaExpiresOn).slice(0, 10) : '',
      insuranceExpiresOn: row.insuranceExpiresOn ? String(row.insuranceExpiresOn).slice(0, 10) : '',
      gosiScheme: row.gosiScheme ?? '',
      maritalStatus: row.maritalStatus ?? '',
      nationality: row.nationality ?? '',
      gender: row.gender ?? 'male',
      phone: row.phone ?? '',
      mobile: row.mobile ?? '',
      email: row.email ?? '',
      address: row.address ?? '',
      notes: row.notes ?? '',
      accountCode: row.accountCode ?? '',
      iban: row.bank?.iban ?? '',
      bankCode: row.bank?.bankCode ?? '',
      bankNo: row.bank?.bankNo ?? '',
      bankName: row.bank?.bankName ?? '',
      photoFileId: row.photoFileId ?? '',
      branchIds: row.branches?.map((b) => b.branchId) ?? [],
      salary: { ...BLANK.salary, ...(row.salaryComponents ?? {}) },
    });
    setCursor(rows.findIndex((entry) => entry.id === row.id));
    setMessage(undefined);
  };

  /** ⏮ أول · ◀ السابق · التالي ▶ · ⏭ الأخير — the window's navigator, over the list. */
  const navigate = (where: 'first' | 'previous' | 'next' | 'last') => {
    if (!rows.length) return;
    const index =
      where === 'first'
        ? 0
        : where === 'last'
          ? rows.length - 1
          : Math.min(Math.max(cursor + (where === 'next' ? 1 : -1), 0), rows.length - 1);
    const row = rows[index];
    if (row) openCard(row);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const salary = Object.fromEntries(
      Object.entries(form.salary).filter(([, value]) => value !== '' && Number(value) !== 0),
    );
    const body = {
      employeeNo: form.employeeNo.trim(),
      name: form.name.trim(),
      branchId: form.branchId || null,
      // No قسم chosen means the employee belongs to the إدارة itself — the card stores one
      // org unit, and «الإدارة» is read back from it.
      departmentId: form.departmentId || form.managementId || null,
      jobId: form.jobId || null,
      status: form.status,
      hireDate: form.hireDate || null,
      birthDate: form.birthDate || null,
      insuranceNo: form.insuranceNo || null,
      nationalId: form.nationalId || null,
      iqamaExpiresOn: form.iqamaExpiresOn || null,
      insuranceExpiresOn: form.insuranceExpiresOn || null,
      gosiScheme: form.gosiScheme || null,
      maritalStatus: form.maritalStatus || null,
      nationality: form.nationality || null,
      gender: form.gender || null,
      phone: form.phone || null,
      mobile: form.mobile || null,
      email: form.email || null,
      address: form.address || null,
      notes: form.notes || null,
      salaryComponents: salary,
      bank: {
        iban: form.iban || undefined,
        bankNo: form.bankNo || undefined,
        bankName: form.bankName || undefined,
        bankCode: form.bankCode || undefined,
      },
      photoFileId: form.photoFileId || null,
      branchIds: form.branchIds,
    };
    try {
      if (editing) await apiPatch(`/hrm/employees/${form.id}`, body);
      else await apiPost('/hrm/employees', body);
      setMessage({ kind: 'ok', text: editing ? 'تم الحفظ بنجاح' : 'تم الحفظ بنجاح' });
      setForm({ ...BLANK, salary: { ...BLANK.salary } });
      setCursor(-1);
      reload();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (row: EmployeeCard) => {
    if (!window.confirm(`هل أنت متأكد من حذف هذا الموظف؟ — ${row.name}`)) return;
    setBusy(true);
    setMessage(undefined);
    try {
      await apiDelete(`/hrm/employees/${row.id}`);
      setMessage({ kind: 'ok', text: 'تم الحذف' });
      if (form.id === row.id) setForm({ ...BLANK, salary: { ...BLANK.salary } });
      reload();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const statusLabel = (value: string) => STATUS_OPTIONS.find((entry) => entry.id === value)?.label ?? value;

  /** صورة الموظف — `frmEmployees.xaml` L195 `imgPersonal` + `btnImgAdd`/`btnImgDelete`: presign → PUT → finalize مع entity=employee */
  const uploadPhoto = async (file: File) => {
    setBusy(true);
    setMessage(undefined);
    try {
      const presigned = await apiPost<{
        fileId: string;
        uploadUrl: string;
        requiredHeaders: Record<string, string>;
      }>('/files/presign', {
        name: file.name,
        mime: file.type || 'image/jpeg',
        sizeBytes: file.size,
        entity: form.id ? 'employee' : undefined,
        entityId: form.id || undefined,
      });
      const put = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { ...presigned.requiredHeaders, 'Content-Type': file.type || 'image/jpeg' },
      });
      if (!put.ok) throw new Error(`فشل رفع الصورة: ${put.status}`);
      const finalized = await apiPost<{ id: string }>(
        `/files/${presigned.fileId}/finalize`,
        form.id ? { entity: 'employee', entityId: form.id } : {},
      );
      setForm((prev) => ({ ...prev, photoFileId: finalized.id }));
      setMessage({ kind: 'ok', text: 'تم رفع الصورة' });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="تعريف موظف"
      subtitle="بطاقة الموظف: بياناته الأساسية ورواتبه، ثم قائمة الموظفين للتنقّل والبحث."
      crumbs={['الموظفين والرواتب', 'التعاريف']}
      kpis={[
        { label: 'عدد الموظفين', value: rows.length, hint: 'في القائمة الحالية' },
        {
          label: 'على رأس العمل',
          value: rows.filter((row) => row.status === 'active').length,
          hint: 'حالتهم نشطة',
          tone: 'up',
        },
        {
          label: 'إجمالي الرواتب',
          value: money(rows.reduce((sum, row) => sum + Number(row.totalSalary ?? 0), 0)),
          hint: 'شهرياً، لكل الموظفين',
        },
        {
          label: 'بلا حساب محاسبي',
          value: rows.filter((row) => !row.accountCode).length,
          hint: 'يُخصَّص عند أول ترحيل',
          tone: rows.some((row) => !row.accountCode) ? 'warn' : 'up',
        },
      ]}
      actions={
        <>
          <button className="btn" type="button" onClick={reload} disabled={employees.status === 'loading'}>
            تحديث
          </button>
          <button className="btn" type="button" onClick={() => navigate('first')} disabled={!rows.length}>
            أول
          </button>
          <button className="btn" type="button" onClick={() => navigate('previous')} disabled={cursor <= 0}>
            السابق
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => navigate('next')}
            disabled={cursor < 0 || cursor >= rows.length - 1}
          >
            التالي
          </button>
          <button className="btn" type="button" onClick={() => navigate('last')} disabled={!rows.length}>
            الأخير
          </button>
        </>
      }
    >
      {message && <p className={`alert ${message.kind}`}>{message.text}</p>}

      {canManage ? (
        <form onSubmit={submit}>
          <Panel title={<>{editing ? `تعديل — ${form.name}` : 'إضافة جديد'}</>}>
            <h3>بيانات الموظف الأساسية</h3>
            <div className="form-grid">
              <label className="field">
                <span>رقم الموظف *</span>
                <input
                  className="input"
                  dir="ltr"
                  value={form.employeeNo}
                  onChange={(event) => setForm({ ...form, employeeNo: event.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>اسم الموظف *</span>
                <input
                  className="input"
                  value={form.name}
                  onChange={(event) => setForm({ ...form, name: event.target.value })}
                  required
                />
              </label>
              <label className="field">
                <span>رقم الحساب</span>
                <input
                  className="input"
                  dir="ltr"
                  value={editing ? (form.accountCode ?? '') : ''}
                  readOnly
                  placeholder="يُخصَّص تلقائياً"
                />
              </label>
              <label className="field">
                <span>الإدارة</span>
                <select
                  className="input"
                  value={form.managementId}
                  onChange={(event) =>
                    setForm({ ...form, managementId: event.target.value, departmentId: '' })
                  }
                >
                  <option value="">اختر...</option>
                  {managements.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>القسم</span>
                <select
                  className="input"
                  value={form.departmentId}
                  onChange={(event) => setForm({ ...form, departmentId: event.target.value })}
                  disabled={!form.managementId}
                >
                  <option value="">
                    {form.managementId ? 'بدون (الإدارة نفسها)' : 'اختر الإدارة أولاً'}
                  </option>
                  {sections.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>الوظيفة</span>
                <select
                  className="input"
                  value={form.jobId}
                  onChange={(event) => setForm({ ...form, jobId: event.target.value })}
                >
                  <option value="">اختر...</option>
                  {(jobs.data ?? []).map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>الحالة</span>
                <select
                  className="input"
                  value={form.status}
                  onChange={(event) => setForm({ ...form, status: event.target.value })}
                >
                  {STATUS_OPTIONS.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>تاريخ الميلاد</span>
                <input
                  className="input"
                  type="date"
                  value={form.birthDate}
                  onChange={(event) => setForm({ ...form, birthDate: event.target.value })}
                />
              </label>
              <label className="field">
                <span>تاريخ التعيين</span>
                <input
                  className="input"
                  type="date"
                  value={form.hireDate}
                  onChange={(event) => setForm({ ...form, hireDate: event.target.value })}
                />
              </label>
              <label className="field">
                <span>رقم التأمينات</span>
                <input
                  className="input"
                  dir="ltr"
                  value={form.insuranceNo}
                  onChange={(event) => setForm({ ...form, insuranceNo: event.target.value })}
                />
              </label>
              <label className="field">
                <span>انتهاء الإقامة</span>
                <input
                  className="input"
                  type="date"
                  value={form.iqamaExpiresOn}
                  onChange={(event) => setForm({ ...form, iqamaExpiresOn: event.target.value })}
                />
              </label>
              <label className="field">
                <span>انتهاء التأمين</span>
                <input
                  className="input"
                  type="date"
                  value={form.insuranceExpiresOn}
                  onChange={(event) => setForm({ ...form, insuranceExpiresOn: event.target.value })}
                />
              </label>
              <label className="field">
                <span>نظام التأمينات</span>
                <select
                  className="input"
                  value={form.gosiScheme}
                  onChange={(event) => setForm({ ...form, gosiScheme: event.target.value })}
                >
                  <option value="">تلقائي من تاريخ التعيين</option>
                  <option value="old">قديم (قبل 3 يوليو 2024)</option>
                  <option value="new">جديد</option>
                </select>
              </label>
              <label className="field">
                <span>الحالة الاجتماعية</span>
                <input
                  className="input"
                  list="marital-statuses"
                  value={form.maritalStatus}
                  onChange={(event) => setForm({ ...form, maritalStatus: event.target.value })}
                />
                <datalist id="marital-statuses">
                  {MARITAL_OPTIONS.map((value) => (
                    <option key={value} value={value} />
                  ))}
                </datalist>
              </label>
              <label className="field">
                <span>الجنسية</span>
                <input
                  className="input"
                  value={form.nationality}
                  onChange={(event) => setForm({ ...form, nationality: event.target.value })}
                />
              </label>
              <div className="field">
                <span>النوع</span>
                <div className="toolbar">
                  <label className="check">
                    <input
                      type="radio"
                      name="gender"
                      checked={form.gender === 'male'}
                      onChange={() => setForm({ ...form, gender: 'male' })}
                    />
                    ذكر
                  </label>
                  <label className="check">
                    <input
                      type="radio"
                      name="gender"
                      checked={form.gender === 'female'}
                      onChange={() => setForm({ ...form, gender: 'female' })}
                    />
                    أنثى
                  </label>
                </div>
              </div>
              <label className="field">
                <span>رقم الهاتف</span>
                <input
                  className="input"
                  dir="ltr"
                  value={form.phone}
                  onChange={(event) => setForm({ ...form, phone: event.target.value })}
                />
              </label>
              <label className="field">
                <span>رقم الموبايل</span>
                <input
                  className="input"
                  dir="ltr"
                  value={form.mobile}
                  onChange={(event) => setForm({ ...form, mobile: event.target.value })}
                />
              </label>
              <label className="field">
                <span>البريد الإلكتروني</span>
                <input
                  className="input"
                  dir="ltr"
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </label>
              <label className="field">
                <span>الفرع</span>
                <select
                  className="input"
                  value={form.branchId}
                  onChange={(event) => setForm({ ...form, branchId: event.target.value })}
                >
                  <option value="">كل الفروع</option>
                  {branchOptions(branches.data ?? []).map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <h3>الرواتب والمستحقات</h3>
            <div className="form-grid">
              {SALARY_ROWS.map((row) => (
                <label className="field" key={row.key}>
                  <span>{row.label}</span>
                  <input
                    className="input"
                    dir="ltr"
                    type="number"
                    min="0"
                    step="0.01"
                    value={form.salary[row.key] ?? ''}
                    onChange={(event) =>
                      setForm({ ...form, salary: { ...form.salary, [row.key]: event.target.value } })
                    }
                  />
                </label>
              ))}
              <label className="field">
                <span>إجمالي الرواتب والمستحقات</span>
                <input className="input" dir="ltr" value={salaryTotal.toFixed(2)} readOnly />
              </label>
            </div>

            <h3>البيانات التكميلية</h3>
            <div className="form-grid">
              <label className="field">
                <span>العنوان</span>
                <input
                  className="input"
                  value={form.address}
                  onChange={(event) => setForm({ ...form, address: event.target.value })}
                />
              </label>
              <label className="field">
                <span>رقم الهوية</span>
                <input
                  className="input"
                  dir="ltr"
                  value={form.nationalId}
                  onChange={(event) => setForm({ ...form, nationalId: event.target.value })}
                />
              </label>
              <label className="field">
                <span>رقم الحساب البنكي</span>
                <input
                  className="input"
                  dir="ltr"
                  value={form.bankNo}
                  onChange={(event) => setForm({ ...form, bankNo: event.target.value })}
                />
              </label>
              <label className="field">
                <span>اسم البنك</span>
                <input
                  className="input"
                  value={form.bankName}
                  onChange={(event) => setForm({ ...form, bankName: event.target.value })}
                />
              </label>
              <label className="field">
                <span>الآيبان</span>
                <input
                  className="input"
                  dir="ltr"
                  value={form.iban}
                  onChange={(event) => setForm({ ...form, iban: event.target.value })}
                />
              </label>
              <label className="field">
                <span>رمز البنك</span>
                <input
                  className="input"
                  dir="ltr"
                  value={form.bankCode}
                  onChange={(event) => setForm({ ...form, bankCode: event.target.value.toUpperCase() })}
                />
              </label>
              <label className="field">
                <span>ملاحظات</span>
                <input
                  className="input"
                  value={form.notes}
                  onChange={(event) => setForm({ ...form, notes: event.target.value })}
                />
              </label>
            </div>

            <h3>صورة الموظف — frmEmployees.xaml L195 imgPersonal</h3>
            <div className="form-grid">
              <div className="field">
                <span>الصورة الحالية</span>
                {form.photoFileId ? (
                  <div className="toolbar">
                    <span className="badge">{form.photoFileId.slice(0, 8)}…</span>
                    <button
                      className="btn small"
                      type="button"
                      onClick={() => setForm({ ...form, photoFileId: '' })}
                    >
                      إزالة
                    </button>
                  </div>
                ) : (
                  <span className="hint">لا توجد صورة — btnImgAdd / btnImgDelete</span>
                )}
              </div>
              <label className="field">
                <span>رفع صورة جديدة</span>
                <input
                  className="input"
                  type="file"
                  accept="image/*"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void uploadPhoto(file);
                  }}
                />
              </label>
            </div>

            <h3>فروع الموظف — frmEmployees.xaml L172 EmpBranches</h3>
            <div className="form-grid">
              <div className="field" style={{ gridColumn: '1 / -1' }}>
                <span>الفروع الإضافية (بجانب الفرع الأساسي)</span>
                <div className="toolbar" style={{ flexWrap: 'wrap' }}>
                  {(branches.data ?? []).map((branch) => (
                    <label key={branch.id} className="check">
                      <input
                        type="checkbox"
                        checked={form.branchIds.includes(branch.id)}
                        onChange={(event) => {
                          setForm((prev) => ({
                            ...prev,
                            branchIds: event.target.checked
                              ? [...prev.branchIds, branch.id]
                              : prev.branchIds.filter((id) => id !== branch.id),
                          }));
                        }}
                      />
                      {branch.nameAr ?? branch.name_ar ?? branch.id}
                    </label>
                  ))}
                </div>
                <p className="hint">
                  الفرع الأساسي يُحدد في «بيانات الموظف الأساسية»؛ هذه الفروع الإضافية تُخزن في EmpBranches —
                  employee_branches.
                </p>
              </div>
            </div>

            <div className="toolbar">
              <button className="btn primary" type="submit" disabled={busy}>
                حفظ
              </button>
              <button
                className="btn"
                type="button"
                onClick={() => setForm({ ...BLANK, salary: { ...BLANK.salary } })}
              >
                جديد
              </button>
              {editing && (
                <button
                  className="btn danger"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    const row = rows.find((entry) => entry.id === form.id);
                    if (row) void remove(row);
                  }}
                >
                  حذف الموظف
                </button>
              )}
            </div>
            {editing && form.id ? <CommentsPanel entityType="employee" entityId={form.id} /> : null}
            <p className="hint">
              اضغط Enter في خانة البحث للبحث عن موظف بالاسم — «اسم الموظف:» في نافذة الديسكتوب.
            </p>
          </Panel>
        </form>
      ) : (
        <section className="card">
          <p className="hint">
            عرض البيانات متاح لكل من يملك صلاحية العرض؛ التحرير يتطلب صلاحية إدارة الموظفين.
          </p>
        </section>
      )}

      <Panel title="قائمة الموظفين" flush>
        <div className="toolbar">
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="اسم الموظف:"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setTerm(search);
            }}
          />
          <button className="btn" type="button" onClick={() => setTerm(search)}>
            بحث
          </button>
          {term && (
            <button
              className="btn"
              type="button"
              onClick={() => {
                setSearch('');
                setTerm('');
              }}
            >
              مسح
            </button>
          )}
        </div>

        {employees.status === 'loading' && <Loading rows={4} />}
        {employees.status === 'forbidden' && <Forbidden />}
        {employees.status === 'error' && <ErrorBox message={employees.error} onRetry={employees.reload} />}
        {employees.status === 'success' &&
          (rows.length === 0 ? (
            <Empty
              title="لا يوجد موظفون"
              detail={term ? 'لا نتائج للبحث الحالي.' : 'أضف بطاقات الموظفين ليمكن احتساب الرواتب.'}
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الاسم</th>
                    <th>إجمالي المرتب</th>
                    <th>الإدارة</th>
                    <th>القسم</th>
                    <th>الوظيفة</th>
                    <th>رقم الحساب</th>
                    <th>الموبايل</th>
                    <th>التعيين</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      style={row.id === form.id ? { background: 'var(--surface-2, #f6f7fb)' } : undefined}
                    >
                      <td dir="ltr">{row.employeeNo}</td>
                      <td>{row.name}</td>
                      <td dir="ltr">{money(row.totalSalary ?? '0')}</td>
                      <td>{row.managementName ?? '—'}</td>
                      <td>{row.sectionName ?? '—'}</td>
                      <td>{row.jobName ?? '—'}</td>
                      <td dir="ltr">{row.accountCode ?? '—'}</td>
                      <td dir="ltr">{row.mobile ?? '—'}</td>
                      <td dir="ltr">{shortDate(row.hireDate)}</td>
                      <td>{row.statusLabel ?? statusLabel(row.status)}</td>
                      <td>
                        <button className="btn small" type="button" onClick={() => openCard(row)}>
                          <ContactRound size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </Panel>
    </Screen>
  );
}
