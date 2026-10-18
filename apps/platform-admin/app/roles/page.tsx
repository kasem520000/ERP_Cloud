'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AccessOverview, FormField, PermissionChoice, TableViewport, ViewNotice } from '@erp/ui/page';
import type { PermissionDto, PlatformDirectoryUser, PlatformRoleMatrixEntry } from '@erp/contracts';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { ApiError, apiData, apiPut } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useQuery } from '../../lib/use-query';

/**
 * مصفوفة الأدوار — `/roles` (P-C3 «الهوية والوصول على المنصة»).
 *
 * The plan calls for «الأدوار الخمسة × رموز console.*». Two things make that matrix real
 * rather than decorative:
 *
 *  1. **The write is a whole role, with a reason.** `PUT /platform/roles/:code/permissions`
 *     replaces one role's set, demands «السبب», and records the difference — what was added
 *     and what was removed — in the platform audit trail.
 *  2. **The API enforces it immediately.** The guard reads the same store this screen writes
 *     (`PlatformRolePermissionsService`), so unchecking `console.audit.view` from
 *     «تشغيل المنصة» closes that door on the next request, not on the next login.
 *
 * The catalogue column is drawn from `GET /platform/permissions` (the registry) and the
 * catalogue *default* comes with each role, so an operator can always see what the code says
 * and what was overridden — and restore it with one button.
 *
 * Labels kept verbatim from the pre-P-C3 console: «أدوار المنصة» · «الرمز» · «الوصف» ·
 * «الحائزون» · «صلاحيات» · the five role names. New ones («الفهرس» · «تجاوز» ·
 * «إرجاع إلى الفهرس» · «حفظ بسببه») are justified in the part document.
 */

type Draft = Record<string, string[]>;

const CONSOLE_PERM_AR: Record<string, string> = {
  'console.tenants.view': 'عرض العملاء والمنشآت',
  'console.tenants.manage': 'إدارة العملاء والتعليق والتفعيل',
  'console.plans.manage': 'إدارة الخطط والتراخيص والاشتراكات',
  'console.subscriptions.manage': 'إدارة اشتراكات المنشآت',
  'console.activation.review': 'مراجعة طلبات تفعيل المنشآت',
  'console.marketplace.manage': 'إدارة تطبيقات سوق الإضافات',
  'console.health.view': 'عرض حالة الخدمات',
  'console.jobs.view': 'عرض المهام والطوابير',
  'console.billing.manage': 'إدارة الفوترة والتحصيل',
  'console.email.view': 'عرض سجل البريد الصادر',
  'console.notifications.manage': 'إدارة إعلانات المنصة',
  'console.backups.manage': 'إدارة نسخ المنصة وطلبات البيانات',
  'console.apikeys.manage': 'إدارة مفاتيح الربط البرمجي',
  'console.webhooks.manage': 'إدارة إشعارات الربط الفورية',
  'console.content.view': 'عرض المحتوى والمسودات',
  'console.leads.view': 'عرض العملاء المحتملين',
  'console.leads.manage': 'إدارة العملاء المحتملين',
  'console.campaigns.manage': 'إدارة الحملات البريدية',
  'console.users.view': 'عرض دليل المستخدمين والجلسات',
  'console.users.manage': 'إدارة المستخدمين وأدوار المنصة و2FA',
  'console.audit.view': 'عرض سجل التدقيق العابر للمنشآت',
  'console.settings.manage': 'إدارة إعدادات المنصة والرايات والحدود',
  'console.support.manage': 'مكتب الدعم الفني والدخول المؤقّت',
  'console.email.manage': 'إدارة البريد والقوالب والحملات',
  'console.jobs.manage': 'إدارة المهام والطوابير والنسخ الاحتياطية',
  'console.analytics.view': 'عرض تحليلات الإيرادات والـ MRR والتسرّب',
  'console.developer.manage': 'إدارة مفاتيح API والويبهوك',
  'console.compliance.manage': 'إدارة الامتثال وطلبات البيانات',
  'console.content.manage': 'إدارة المحتوى والإعلانات والصفحات',
};

const ROLE_DESC_AR: Record<string, string> = {
  platform_owner: 'صلاحيات كاملة لإدارة المنصة والعملاء والخطط والأدوار والإعدادات الحساسة.',
  platform_operations: 'تشغيل المنصة اليومي ومتابعة العملاء والمهام والطوابير والصحة.',
  platform_billing: 'إدارة خطط الأسعار والاشتراكات والفواتير وطلبات التفعيل والتحصيل.',
  platform_support: 'استقبال تذاكر الدعم والمساعدة والرد على العملاء والدخول المؤقّت المشروط بـالسبب.',
  platform_auditor: 'صلاحيات قراءة شاملة لسجل التدقيق والعملاء والمستخدمين لأغراض الرقابة والمراجعة.',
};

const ROLE_NAME_AR: Record<string, string> = {
  platform_owner: 'مالك المنصة',
  platform_operations: 'تشغيل المنصة',
  platform_billing: 'فوترة المنصة',
  platform_support: 'دعم المنصة',
  platform_auditor: 'مدقّق المنصة',
};

export default function PlatformRolesPage() {
  const session = useSession();
  const canManage = session.canConsole('console.users.manage');

  const roles = useQuery<PlatformRoleMatrixEntry[]>(() =>
    apiData<PlatformRoleMatrixEntry[]>('/platform/roles'),
  );
  const permissions = useQuery<PermissionDto[]>(() => apiData<PermissionDto[]>('/platform/permissions'));

  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [filter, setFilter] = useState('');
  const [expandedRole, setExpandedRole] = useState<string | null>(null);

  const catalogue = roles.data ?? [];
  const codes = (permissions.data ?? []).map((entry) => entry.code);

  // Seed the draft from the server state whenever it (re)loads — a matrix that starts as a
  // blank slate would silently mean «no permissions» rather than «what is there now».
  useEffect(() => {
    if (!roles.data) return;
    setDraft(Object.fromEntries(roles.data.map((role) => [role.code, [...role.permissions]])));
  }, [roles.data]);

  function toggle(role: PlatformRoleMatrixEntry, code: string, on: boolean) {
    setDraft((current) => {
      const set = new Set(current[role.code] ?? role.permissions);
      if (on) set.add(code);
      else set.delete(code);
      return { ...current, [role.code]: [...set].sort() };
    });
  }

  function dirty(role: PlatformRoleMatrixEntry): boolean {
    const current = [...(draft[role.code] ?? role.permissions)].sort();
    return current.join('\u0000') !== [...role.permissions].sort().join('\u0000');
  }

  async function save(role: PlatformRoleMatrixEntry, reason: string) {
    setBusy(role.code);
    setError(undefined);
    setNotice(undefined);
    try {
      await apiPut(`/platform/roles/${role.code}/permissions`, {
        permissions: draft[role.code] ?? role.permissions,
        reason,
      });
      setNotice(`حُفظت صلاحيات «${role.nameAr}».`);
      await roles.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر الحفظ');
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <Screen
      title="أدوار المنصة"
      subtitle="راجع صلاحيات تشغيل المنصة ومن يحمل كل دور. أي تعديل يتطلب سبباً ويُحفظ في سجل المراجعة."
      crumbs={['المنصة', 'التشغيل']}
    >
      <AccessOverview
        title="صلاحيات تشغيل المنصة"
        description="اختر دوراً لمراجعة نطاقه. الصلاحيات المحددة هي الفعّالة؛ لا تُطبق تغييرات المسودة حتى تُكتب أسبابها وتُحفظ."
        items={[
          { label: 'الأدوار', value: roles.data?.length ?? '—', hint: roles.status === 'success' ? 'أدوار تشغيل المنصة' : 'بانتظار تحميل الأدوار' },
          { label: 'الصلاحيات', value: permissions.data?.length ?? '—', hint: 'متاحة للمراجعة بحسب الفهرس' },
          { label: 'التعديل', value: canManage ? 'مسموح' : 'عرض فقط', hint: canManage ? 'الحفظ يتطلب سبباً مكتوباً' : 'اطلب دوراً مناسباً من مالك المنصة' },
        ]}
      />
      {error && <p className="alert danger" role="alert">{error}</p>}
      {notice && <p className="alert ok" role="status">{notice}</p>}
      {roles.status === 'loading' && <Loading />}
      {roles.status === 'error' && <ErrorBox message={roles.error} onRetry={roles.reload} />}
      {roles.status === 'forbidden' && <Forbidden />}
      {permissions.status === 'error' && <ErrorBox message={permissions.error} onRetry={permissions.reload} />}
      {permissions.status === 'forbidden' && <Forbidden />}

      {roles.status === 'success' && permissions.status === 'loading' && <Loading />}
      {roles.status === 'success' && permissions.status === 'success' && (
        <FormField label="ابحث في الصلاحيات" hint="يغيّر البحث ما يظهر للمراجعة فقط، ولا يعدّل الصلاحيات المحفوظة.">
          <input className="input" type="search" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="اسم الصلاحية أو رمزها" />
        </FormField>
      )}
      {roles.status === 'success' && permissions.status === 'success' &&
        (catalogue.length === 0 ? (
          <Empty title="لا توجد أدوار" />
        ) : (
          catalogue.map((role) => (
            <RoleMatrix
              key={role.code}
              role={role}
              codes={codes}
              filter={filter}
              expanded={expandedRole === null ? role.code === catalogue[0]?.code : expandedRole === role.code}
              onExpand={() => setExpandedRole((current) => (current ?? catalogue[0]?.code) === role.code ? '' : role.code)}
              draft={draft[role.code] ?? role.permissions}
              canManage={canManage}
              busy={busy === role.code}
              dirty={dirty(role)}
              onToggle={(code, on) => toggle(role, code, on)}
              onSave={(reason) => save(role, reason)}
            />
          ))
        ))}

      <UsersAndHolders />
    </Screen>
  );
}

function RoleMatrix({
  role,
  codes,
  filter,
  expanded,
  onExpand,
  draft,
  canManage,
  busy,
  dirty,
  onToggle,
  onSave,
}: {
  role: PlatformRoleMatrixEntry;
  codes: string[];
  filter: string;
  expanded: boolean;
  onExpand: () => void;
  draft: string[];
  canManage: boolean;
  busy: boolean;
  dirty: boolean;
  onToggle: (code: string, on: boolean) => void;
  onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState('');
  const granted = new Set(draft);
  const catalogued = new Set(role.catalogPermissions);

  const query = filter.trim().toLowerCase();
  const visibleCodes = codes.filter((code) =>
    !query || (CONSOLE_PERM_AR[code] ?? '').toLowerCase().includes(query) || code.toLowerCase().includes(query),
  );

  return (
    <section className="card erp-role-section" aria-label={`دور ${role.nameAr}`}>
      <button
        type="button"
        className="erp-role-trigger"
        aria-expanded={expanded}
        aria-controls={`permissions-${role.code}`}
        onClick={onExpand}
      >
        <span className="erp-role-heading">
          <strong>{role.nameAr}</strong>
          <small>{ROLE_DESC_AR[role.code] ?? role.description}</small>
        </span>
        <span className="erp-role-facts">
          <span>{granted.size} صلاحية</span>
          <span>{role.holderCount} حائز</span>
          <span>{dirty ? 'تغييرات غير محفوظة' : role.overridden ? 'مخصص عن الفهرس' : 'كما في الفهرس'}</span>
          <span aria-hidden="true">{expanded ? '−' : '+'}</span>
        </span>
      </button>
      {expanded && (
        <div id={`permissions-${role.code}`} className="erp-role-content">
          <p className="muted small">اختر الصلاحيات المناسبة لهذا الدور. تظهر التغييرات المقترحة قبل حفظها؛ لن تتبدل أذونات المشغلين حتى تؤكد السبب.</p>
          {visibleCodes.length === 0 ? (
            <ViewNotice state="empty">لا توجد صلاحيات مطابقة للبحث في هذا الدور.</ViewNotice>
          ) : (
            <div className="erp-permission-grid">
              {visibleCodes.map((code) => (
                <PermissionChoice
                  key={code}
                  title={CONSOLE_PERM_AR[code] ?? 'صلاحية إضافية'}
                  checked={granted.has(code)}
                  changed={role.permissions.includes(code) !== granted.has(code)}
                  disabled={!canManage || busy}
                  onChange={(on) => onToggle(code, on)}
                />
              ))}
            </div>
          )}
          {canManage && (
            <div className="erp-role-actions">
              <FormField label="سبب تغيير صلاحيات الدور" hint="اكتب ثلاثة أحرف على الأقل؛ يسجل النظام السبب مع فروق الصلاحيات.">
                <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} placeholder="مثال: تحديث مهام فريق التشغيل" />
              </FormField>
              <div className="erp-page-actions">
                <button className="btn primary" type="button" disabled={!dirty || busy || reason.trim().length < 3} onClick={() => onSave(reason.trim())}>
                  {busy ? 'جارٍ الحفظ…' : 'حفظ صلاحيات الدور'}
                </button>
                <button className="btn" type="button" disabled={busy} onClick={() => {
                  // Restoring the catalogue is itself a write: it clears the override row.
                  for (const code of codes) onToggle(code, catalogued.has(code));
                  setReason('إرجاع إلى الفهرس');
                }}>
                  إرجاع إلى الفهرس
                </button>
                {!dirty && <span className="muted small" role="status">لا تغييرات غير محفوظة</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** «مَن يحمل ماذا» — الجدول الذي كان في صفحة الأدوار قبل P-C3، مع رابطٍ لبطاقة كل حساب. */
function UsersAndHolders() {
  const users = useQuery<PlatformDirectoryUser[]>(() => apiData<PlatformDirectoryUser[]>('/platform/users'));
  const rows = (users.data ?? []).filter((row) => row.platformRoles.length > 0 || row.isPlatformAdmin);

  return (
    <div className="card">
      <h2 style={{ marginTop: 0 }}>مَن يملك صلاحية التشغيل؟</h2>
      <p className="muted small">المشغّلون المرتبطون بأدوار المنصة؛ افتح بطاقة المستخدم لمراجعة تعييناته.</p>
      {users.status === 'loading' && <Loading />}
      {users.status === 'error' && <ErrorBox message={users.error} onRetry={users.reload} />}
      {users.status === 'forbidden' && <Forbidden />}
      {users.status === 'success' &&
        (rows.length === 0 ? (
          <Empty title="لا حائزين" />
        ) : (
          <TableViewport label="مشغلو المنصة وأدوارهم">
            <table>
              <thead>
                <tr>
                  <th>المشغّل</th>
                  <th>البريد</th>
                  <th>الأدوار</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <Link href={`/users/${row.id}`}>{row.fullName}</Link>
                    </td>
                    <td dir="ltr">{row.email}</td>
                    <td>
                      {row.platformRoles.map((code) => (
                        <span key={code} className="badge active" style={{ marginInlineEnd: 4 }}>
                          {ROLE_NAME_AR[code] ?? code}
                        </span>
                      ))}
                      {row.platformRoles.length === 0 && row.isPlatformAdmin && (
                        <span className="badge active">مالك المنصة</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableViewport>
        ))}
    </div>
  );
}
