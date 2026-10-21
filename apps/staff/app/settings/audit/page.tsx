'use client';

import { Panel, formatDateTime } from '@erp/ui';
import { ArrowDownLeft, ArrowUpRight, Search, UserRound } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { Table } from '../../../components/ui/table';
import { apiData } from '../../../lib/api';
import { useQuery } from '../../../lib/use-query';

/**
 * سجلّ المستخدمين — البند 6 من قائمة 20 أكتوبر.
 *
 * كان السجلّ يقول `create` و`sales/invoices` و«3 حقول»: بياناتٌ صحيحة لا يقرأها إلّا من
 * يعرف أسماء الجداول بالإنجليزية. والشاشة الآن تجيب السؤال الذي يُسأل فعلاً:
 *
 *   **«من فعل ماذا، ومتى، وبأيّ رقم؟»** — «أنشأ فاتورة مبيعات SI-000008»، «عدّل صنف
 *   «شاي أحمر» — السعر»، «دخل إلى النظام من 41.…».
 *
 * والمصدر هو نفسه `GET /audit-log` بلا تغيير في العقد: `action` و`entity` و`after` و
 * `meta.path`. والترجمة كلها في هذه الشاشة، لأن الاسم الإنجليزي للجدول قرارُ تطويرٍ لا
 * قرارُ محاسب.
 */

type AuditRow = {
  id: string;
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  createdAt?: string;
};

/** الأفعال كما تُكتب في الخادم — ومعها الفعل الماضي العربي المناسب. */
const VERB: Record<string, string> = {
  create: 'أنشأ',
  update: 'عدّل',
  delete: 'حذف',
  'delete-soft': 'حذف (منطقي)',
  restore: 'استرجع',
  post: 'رحّل',
  void: 'ألغى',
  login: 'دخل',
  logout: 'خرج',
  refresh: 'جدّد الجلسة',
  'password-change': 'غيّر كلمة المرور',
  export: 'صدّر',
  import: 'استورد',
  approve: 'اعتمد',
  reject: 'رفض',
  submit: 'قدّم',
  cancel: 'ألغى',
  send: 'أرسل',
  install: 'ثبّت',
  uninstall: 'أزال',
  assign: 'أسند',
  revoke: 'سحب',
};

/**
 * الاسم العربي لكل مسار عمل. المفتاح هو `meta.path` (بلا معرّف) لأن الخادم يكتبه من
 * المسار الحقيقي؛ والمفتاح الثاني `entity` يغطي الصفوف الأقدم التي كُتبت قبل ذلك.
 */
const SUBJECT: Record<string, string> = {
  'sales/invoices': 'فاتورة مبيعات',
  'sales/returns': 'مردود مبيعات',
  'sales/quotations': 'عرض سعر',
  'sales/customers': 'عميل',
  'sales/salesmen': 'مندوب',
  'sales/adjustment-notes': 'إشعار تسوية',
  'sales/cash-customers': 'عميل نقدي',
  'sales/pos': 'فاتورة نقطة بيع',
  'purchases/invoices': 'فاتورة مشتريات',
  'purchases/returns': 'مردود مشتريات',
  'purchases/suppliers': 'مورد',
  'purchases/orders': 'أمر شراء',
  'purchases/quotations': 'عرض سعر مورد',
  'inventory/items': 'صنف',
  'inventory/vouchers': 'سند مخزني',
  'inventory/warehouses': 'مستودع',
  'inventory/transfers': 'تحويل مخزني',
  'inventory/categories': 'مجموعة أصناف',
  'inventory/units': 'وحدة قياس',
  'accounting/journal-entries': 'قيد يومية',
  'accounting/accounts': 'حساب',
  'accounting/parties': 'حساب طرف',
  'accounting/cost-centers': 'مركز تكلفة',
  'accounting/payment-methods': 'طريقة دفع',
  'treasury/vouchers': 'سند',
  'treasury/receipts': 'سند قبض',
  'treasury/payments': 'سند صرف',
  'treasury/cash-locations': 'خزينة',
  'hrm/employees': 'موظف',
  'hrm/payroll-runs': 'مسيّر رواتب',
  'hrm/leaves': 'طلب إجازة',
  'projects/projects': 'مشروع',
  'crm/leads': 'عميل محتمل',
  'settings/users': 'مستخدم',
  'settings/roles': 'دور',
  'settings/branches': 'فرع',
  'settings/company': 'بطاقة المنشأة',
  'settings/company-profile': 'بطاقة المنشأة',
  'platform/tenants': 'مستأجر',
  'platform/plans': 'خطة اشتراك',
  'einvoice/settings': 'إعدادات الفاتورة الإلكترونية',
  einvoice: 'فاتورة إلكترونية',
  auth: 'جلسة دخول',
  files: 'ملف',
  'marketplace/apps': 'تطبيق من السوق',
  'notifications/rules': 'قاعدة تنبيه',
};

/** أسماء الحقول كما يراها المحاسب — للفرق قبل/بعد. */
const FIELD: Record<string, string> = {
  number: 'الرقم',
  code: 'الرمز',
  name: 'الاسم',
  nameAr: 'الاسم العربي',
  nameEn: 'الاسم الإنجليزي',
  fullName: 'الاسم الكامل',
  email: 'البريد',
  phone: 'الهاتف',
  status: 'الحالة',
  notes: 'الملاحظات',
  note: 'الملاحظة',
  total: 'الإجمالي',
  subtotal: 'المجموع قبل الضريبة',
  taxAmount: 'الضريبة',
  discount: 'الخصم',
  paidAmount: 'المدفوع',
  currency: 'العملة',
  date: 'التاريخ',
  dueDate: 'تاريخ الاستحقاق',
  partyId: 'الحساب',
  customerId: 'العميل',
  supplierId: 'المورد',
  warehouseId: 'المستودع',
  branchId: 'الفرع',
  tenantId: 'المنشأة',
  price: 'السعر',
  cost: 'التكلفة',
  quantity: 'الكمية',
  unitId: 'الوحدة',
  vatNo: 'الرقم الضريبي',
  crNo: 'السجل التجاري',
  address: 'العنوان',
  city: 'المدينة',
  street: 'الشارع',
  postalCode: 'الرمز البريدي',
  active: 'مفعّل',
  isActive: 'مفعّل',
  permissions: 'الصلاحيات',
  roleId: 'الدور',
  accountId: 'الحساب',
  taxRate: 'نسبة الضريبة',
  rate: 'النسبة',
};

const META_LABEL: Record<string, string> = {
  method: 'الطريقة',
  path: 'المسار',
  status: 'الحالة',
  ip: 'العنوان',
  traceId: 'التتبّع',
  outcome: 'النتيجة',
  errorCode: 'رمز الخطأ',
  userAgent: 'المتصفح',
};

type Change = { field: string; before: string; after: string };

const scalar = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
};

/** كل حقلٍ تغيّر فعلاً بين `before` و`after` — لا قائمةٌ بحقول الكيان كلها. */
function changesOf(row: AuditRow): Change[] {
  const before = row.before ?? {};
  const after = row.after ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => ({ field: key, before: scalar(before[key]), after: scalar(after[key]) }));
}

/** أعلى الملف/الكيان: أول قيمةٍ مقروءة من `after` ثم `before` ثم المعرّف. */
function identifierOf(row: AuditRow): string | null {
  const after = row.after ?? {};
  const before = row.before ?? {};
  for (const key of ['number', 'code', 'reference', 'nameAr', 'fullName', 'name', 'title']) {
    const value = after[key] ?? before[key];
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  const id = (after.id as string | undefined) ?? row.entityId ?? null;
  return id ? id.slice(0, 8) : null;
}

/** المسار الحقيقي للعملية: `meta.path` يكتبه الخادم من `originalUrl` فيُعرف الجمع من المفرد. */
function collectionOf(row: AuditRow): string {
  const path = typeof row.meta?.path === 'string' ? row.meta.path : '';
  if (path.length > 0) {
    const segments = path.split('/').filter(Boolean);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}/i;
    return segments
      .filter((segment, index) => !(index > 0 && uuid.test(segment)))
      .slice(0, 2)
      .join('/');
  }
  return row.entity;
}

function subjectOf(row: AuditRow): string {
  const collection = collectionOf(row);
  if (SUBJECT[collection]) return SUBJECT[collection]!;
  const head = collection.split('/')[0] ?? collection;
  if (SUBJECT[head]) return SUBJECT[head]!;
  if (SUBJECT[row.entity]) return SUBJECT[row.entity]!;
  return 'سجل';
}

function fieldLabel(field: string): string {
  return FIELD[field] ?? field;
}

/**
 * الجملة العربية الكاملة — هي العمود الأول في الجدول، لا «اسم جدول + فعل».
 *
 * والقاعدة: لا جملة بلا فاعل. `actorLabel` موجود في كل صفٍّ (يُحلّ في الخادم من العضوية)،
 * وإن غاب لعضوٍ محذوف يُقال «مستخدم محذوف» بدل صمتٍ يوهم أن أحداً لم يفعل.
 */
function sentenceOf(row: AuditRow): string {
  if (row.action === 'login') {
    return 'دخل إلى النظام';
  }
  if (row.action === 'logout') return 'خرج من النظام';
  if (row.action === 'refresh') return 'جدّد الجلسة';
  if (row.action === 'password-change') return 'غيّر كلمة المرور';

  const verb = VERB[row.action] ?? row.action;
  const subject = subjectOf(row);
  const identifier = identifierOf(row);
  const changes = changesOf(row);

  if (row.action === 'update' && changes.length > 0) {
    const fields = changes
      .slice(0, 3)
      .map((change) => `«${fieldLabel(change.field)}»`)
      .join('، ');
    const more = changes.length > 3 ? ` و${changes.length - 3} حقولٍ أخرى` : '';
    return `${verb} ${subject}${identifier ? ` ${identifier}` : ''} — ${fields}${more}`;
  }

  return `${verb} ${subject}${identifier ? ` ${identifier}` : ''}`;
}

function actorOf(row: AuditRow): string {
  if (row.actorLabel && row.actorLabel.trim().length > 0) return row.actorLabel;
  if (row.actorUserId) return `مستخدم ${row.actorUserId.slice(0, 8)}`;
  return 'مستخدم غير معروف';
}

function metaOf(row: AuditRow): Record<string, unknown> {
  return (row.meta ?? {}) as Record<string, unknown>;
}

export default function TenantAuditPage() {
  const audit = useQuery<AuditRow[] | { items?: AuditRow[]; data?: AuditRow[] }>(
    () => apiData('/audit-log?limit=200'),
    [],
  );
  const [selected, setSelected] = useState<AuditRow | null>(null);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');

  const rows: AuditRow[] = Array.isArray(audit.data)
    ? audit.data
    : ((audit.data as { items?: AuditRow[] })?.items ?? []);

  const actions = useMemo(() => [...new Set(rows.map((row) => row.action))].sort(), [rows]);
  const filtered = useMemo(() => {
    const needle = search.trim();
    return rows.filter((row) => {
      if (action && row.action !== action) return false;
      if (!needle) return true;
      const haystack = [sentenceOf(row), actorOf(row), row.entity, row.entityId ?? '', JSON.stringify(row.after ?? {})]
        .join(' ')
        .toLowerCase();
      return haystack.includes(needle.toLowerCase());
    });
  }, [rows, action, search]);

  const selectedMeta = selected ? metaOf(selected) : {};
  const selectedChanges = selected ? changesOf(selected) : [];

  return (
    <Screen
      title="سجلّ المستخدمين"
      subtitle="سجلٌّ غير قابل للتعديل لكل عملية: من فعلها، وماذا كانت، ومتى — بالعربية وبأرقام المستندات."
      crumbs={['الإعدادات', 'التدقيق']}
      actions={
        <button className="btn" type="button" onClick={audit.reload}>
          تحديث
        </button>
      }
    >
      {audit.status === 'loading' && <Loading />}
      {audit.status === 'forbidden' && <Forbidden />}
      {audit.status === 'error' && <ErrorBox message={audit.error} onRetry={audit.reload} />}
      {audit.status === 'success' &&
        (rows.length === 0 ? (
          <Empty
            title="لا توجد سجلات بعد"
            detail="سيُكتب هنا أول إجراء مؤثر: حفظ فاتورة، تعديل إعداد، منح صلاحية."
          />
        ) : (
          <>
            <Panel className="tight no-print">
              <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end', gap: 12 }}>
                <label className="field" style={{ minWidth: 260, flex: 1 }}>
                  <span>بحث في الأحداث</span>
                  <div className="row" style={{ alignItems: 'center', gap: 6 }}>
                    <Search size={15} aria-hidden />
                    <input
                      className="input"
                      value={search}
                      onChange={(event) => setSearch(event.target.value)}
                      placeholder="اسم المنفّذ، رقم فاتورة، كلمة…"
                    />
                  </div>
                </label>
                <label className="field" style={{ minWidth: 190 }}>
                  <span>نوع العملية</span>
                  <select className="input" value={action} onChange={(event) => setAction(event.target.value)}>
                    <option value="">كل العمليات</option>
                    {actions.map((entry) => (
                      <option key={entry} value={entry}>
                        {VERB[entry] ?? entry}
                      </option>
                    ))}
                  </select>
                </label>
                <span className="muted small" style={{ paddingBottom: 8 }}>
                  {filtered.length} من {rows.length} حدثاً
                </span>
              </div>
            </Panel>

            <Panel title="الأحداث" hint="اختر صفاً لقراءة التفاصيل والفرق قبل/بعد" flush>
              <Table
                bare
                activeKey={selected?.id}
                onRowClick={(row) => setSelected((current) => (current?.id === row.id ? null : row))}
                columns={[
                  {
                    key: 'when',
                    header: 'الوقت',
                    ltr: true,
                    width: 150,
                    cell: (row) => (
                      <span className="whitespace-nowrap text-[12px]">
                        {row.createdAt ? formatDateTime(row.createdAt) : '—'}
                      </span>
                    ),
                  },
                  {
                    key: 'what',
                    header: 'ماذا جرى',
                    cell: (row) => (
                      <span className="audit-sentence">
                        {sentenceOf(row)}
                        {row.meta?.outcome === 'failure' ? <span className="badge failed">فشل</span> : null}
                      </span>
                    ),
                  },
                  {
                    key: 'who',
                    header: 'المنفّذ',
                    cell: (row) => (
                      <span className="row" style={{ alignItems: 'center', gap: 6 }}>
                        <UserRound size={13} aria-hidden />
                        {actorOf(row)}
                      </span>
                    ),
                  },
                  {
                    key: 'where',
                    header: 'من أين',
                    ltr: true,
                    cell: (row) => (
                      <span className="muted small" dir="ltr">
                        {String(selectedMetaIp(row) ?? '—')}
                      </span>
                    ),
                  },
                ]}
                rows={filtered}
                rowKey={(row) => row.id}
              />
            </Panel>

            {selected ? (
              <Panel
                title="تفاصيل الحدث"
                hint={selected.entityId ? `السجل ${selected.entityId}` : 'حدثٌ بلا معرّف مرتبط'}
              >
                <div className="audit-detail-head">
                  {selected.action === 'login' || selected.action === 'logout' ? (
                    <UserRound size={20} aria-hidden />
                  ) : selected.action === 'delete' ? (
                    <ArrowDownLeft size={20} aria-hidden />
                  ) : (
                    <ArrowUpRight size={20} aria-hidden />
                  )}
                  <div>
                    <p className="audit-detail-sentence">{sentenceOf(selected)}</p>
                    <p className="muted small" style={{ margin: 0 }}>
                      {selected.actorLabel ?? actorOf(selected)}
                      {selected.createdAt ? ` · ${formatDateTime(selected.createdAt)}` : ''}
                    </p>
                  </div>
                </div>

                {selectedChanges.length === 0 ? (
                  <p className="muted small">
                    لا فرق محفوظاً لهذا الحدث — أحداث الدخول والتصدير تحمل بياناتها الوصفية وحدها.
                  </p>
                ) : (
                  <Table
                    bare
                    columns={[
                      { key: 'f', header: 'الحقل', cell: (row) => fieldLabel(row.field) },
                      {
                        key: 'b',
                        header: 'قبل',
                        ltr: true,
                        cell: (row) => <span className="audit-before">{row.before}</span>,
                      },
                      {
                        key: 'a',
                        header: 'بعد',
                        ltr: true,
                        cell: (row) => <span className="audit-after">{row.after}</span>,
                      },
                    ]}
                    rows={selectedChanges}
                    rowKey={(row) => row.field}
                  />
                )}

                <div className="audit-meta">
                  {Object.entries(META_LABEL)
                    .filter(([key]) => selectedMeta[key] !== undefined && selectedMeta[key] !== null)
                    .map(([key, label]) => (
                      <span key={key} className="muted small">
                        {label}: <span dir="ltr">{String(selectedMeta[key])}</span>
                      </span>
                    ))}
                </div>
              </Panel>
            ) : null}
          </>
        ))}
    </Screen>
  );
}

function selectedMetaIp(row: AuditRow): unknown {
  return metaOf(row).ip ?? metaOf(row).clientIp ?? '—';
}
