'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { PermissionDto, PlatformDirectoryUser, PlatformRoleMatrixEntry } from '@erp/contracts';
import { Panel } from '@erp/ui';

import { Empty, ErrorBox, Loading, Screen } from '../../components/screen';
import { Table, type Column } from '../../components/ui/table';
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
 * Layout (this revision): the five role cards stacked 31 chips each produced a page that was
 * 2 500 px of repeated grids — the same 31 permissions drawn five times, so comparing roles
 * or even finishing one role meant scrolling through the others. It is now a master–detail:
 * the roles are a compact rail on the side (name, holders, override state), and the selected
 * role's permissions are one aligned table grouped by the area of the console they govern.
 * The catalogue column stays visible next to the switch, because «ما ينصّ عليه الفهرس» and
 * «ما صار فعّالًا» is exactly the comparison the screen exists to make.
 */

type Draft = Record<string, string[]>;

const CONSOLE_PERM_AR: Record<string, string> = {
  'console.tenants.view': 'عرض العملاء والمنشآت',
  'console.tenants.manage': 'إدارة العملاء والتعليق والتفعيل',
  'console.plans.manage': 'إدارة الخطط والباقات',
  'console.subscriptions.manage': 'إدارة الاشتراكات والتجديد والإلغاء',
  'console.billing.manage': 'عمليات الفوترة والتحصيل والتذكير',
  'console.activation.review': 'مراجعة طلبات التفعيل',
  'console.users.view': 'عرض دليل المستخدمين والجلسات',
  'console.users.manage': 'إدارة المستخدمين وأدوار المنصة و2FA',
  'console.audit.view': 'عرض سجل التدقيق العابر للمنشآت',
  'console.settings.manage': 'إدارة إعدادات المنصة والرايات والحدود',
  'console.health.view': 'عرض صحة النظام والجاهزية',
  'console.jobs.view': 'عرض صحة الطوابير والـ outbox',
  'console.jobs.manage': 'إدارة المهام والنسخ الاحتياطية ومدير الملفات',
  'console.backups.manage': 'تشغيل النسخ الاحتياطية وسياسة الاحتفاظ',
  'console.releases.view': 'عرض سجل الإصدارات وملاحظات التحديث',
  'console.releases.manage': 'إدارة الإصدارات ونشر التحديثات',
  'console.support.manage': 'مكتب الدعم الفني والدخول المؤقّت',
  'console.content.view': 'عرض محتوى الموقع والصفحات والقوائم',
  'console.content.manage': 'إدارة المحتوى والإعلانات والصفحات',
  'console.campaigns.manage': 'إدارة الحملات التسويقية وإرسالها',
  'console.email.view': 'عرض سجل البريد الصادر',
  'console.email.manage': 'إدارة البريد والقوالب والحملات',
  'console.notifications.manage': 'إشعارات المنصة وإعلاناتها',
  'console.leads.view': 'عرض العملاء المتوقّعين والمشتركين',
  'console.leads.manage': 'إدارة العملاء المتوقّعين وتحويلهم',
  'console.analytics.view': 'عرض تحليلات الإيرادات والـ MRR والتسرّب',
  'console.apikeys.manage': 'إدارة مفاتيح API للمنشآت',
  'console.webhooks.manage': 'إدارة الويب هوك وإعادة المحاولات',
  'console.marketplace.manage': 'تسعير تطبيقات السوق وتفعيلها',
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

/** Permission groups, in the order an operator reads the console. Every code lands in one. */
const GROUPS: Array<{ key: string; label: string; match: (code: string) => boolean }> = [
  {
    key: 'tenants',
    label: 'العملاء والاشتراكات',
    match: (code) => /^console\.(tenants|plans|subscriptions|billing|activation)\./.test(code),
  },
  {
    key: 'people',
    label: 'المستخدمون والرقابة',
    match: (code) => /^console\.(users|audit|settings)\./.test(code),
  },
  {
    key: 'ops',
    label: 'التشغيل والصحة والدعم',
    match: (code) => /^console\.(health|jobs|backups|releases|support)\./.test(code),
  },
  {
    key: 'growth',
    label: 'التسويق والمحتوى',
    match: (code) => /^console\.(content|campaigns|email|notifications|leads)\./.test(code),
  },
  {
    key: 'platform',
    label: 'التحليلات والتكامل',
    match: (code) => /^console\.(analytics|apikeys|webhooks|marketplace)\./.test(code),
  },
];

export default function PlatformRolesPage() {
  const session = useSession();
  const canManage = session.canConsole('console.users.manage');

  const roles = useQuery<PlatformRoleMatrixEntry[]>(() =>
    apiData<PlatformRoleMatrixEntry[]>('/platform/roles'),
  );
  const permissions = useQuery<PermissionDto[]>(() => apiData<PermissionDto[]>('/platform/permissions'));

  const [draft, setDraft] = useState<Draft>({});
  const [selectedCode, setSelectedCode] = useState<string | undefined>();
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [reason, setReason] = useState('');

  const catalogue = roles.data ?? [];
  const codes = useMemo(() => (permissions.data ?? []).map((entry) => entry.code), [permissions.data]);
  const selected = catalogue.find((role) => role.code === selectedCode) ?? catalogue[0];

  // Seed the draft from the server state whenever it (re)loads — a matrix that starts as a
  // blank slate would silently mean «no permissions» rather than «what is there now».
  useEffect(() => {
    if (!roles.data) return;
    setDraft(Object.fromEntries(roles.data.map((role) => [role.code, [...role.permissions]])));
  }, [roles.data]);

  function toggle(roleCode: string, code: string, on: boolean) {
    setDraft((current) => {
      const set = new Set(current[roleCode] ?? []);
      if (on) set.add(code);
      else set.delete(code);
      return { ...current, [roleCode]: [...set].sort() };
    });
  }

  function dirty(role: PlatformRoleMatrixEntry): boolean {
    const current = [...(draft[role.code] ?? [])].sort();
    return current.join('\u0000') !== [...role.permissions].sort().join('\u0000');
  }

  async function save(role: PlatformRoleMatrixEntry, why: string) {
    setBusy(role.code);
    setError(undefined);
    setNotice(undefined);
    try {
      await apiPut(`/platform/roles/${role.code}/permissions`, {
        permissions: draft[role.code] ?? [],
        reason: why,
      });
      setNotice(`حُفظت صلاحيات «${role.nameAr}».`);
      setReason('');
      await roles.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر الحفظ');
    } finally {
      setBusy(undefined);
    }
  }

  const dirtyCount = catalogue.filter((role) => dirty(role)).length;

  return (
    <Screen
      title="أدوار المنصة"
      subtitle="الأدوار الخمسة × رموز اللوحة — ما ينصّ عليه الفهرس، وما صار فعّالًا. اختر دوراً لعرض صلاحياته."
      crumbs={['المنصة', 'التشغيل']}
      actions={
        dirtyCount > 0 ? (
          <span className="tag tenant">{`${dirtyCount} دور فيه تغييرات غير محفوظة`}</span>
        ) : undefined
      }
    >
      {error && <p className="alert danger">{error}</p>}
      {notice && <p className="alert ok">{notice}</p>}
      {roles.status === 'loading' && <Loading />}
      {roles.status === 'error' && <ErrorBox message={roles.error} onRetry={roles.reload} />}

      {roles.status === 'success' &&
        (catalogue.length === 0 ? (
          <Empty title="لا توجد أدوار" />
        ) : selected ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,280px)_minmax(0,1fr)] items-start">
            {/* ------------------------------------------------ role rail */}
            <Panel flush aria-label="أدوار المنصة" bodyClassName="p-1">
              <ul className="m-0 list-none divide-y divide-[var(--line)] p-0">
                {catalogue.map((role) => {
                  const active = role.code === selected.code;
                  const pending = dirty(role);
                  return (
                    <li key={role.code}>
                      <button
                        type="button"
                        onClick={() => setSelectedCode(role.code)}
                        aria-current={active ? 'true' : undefined}
                        className={`flex w-full flex-col gap-1 border-0 bg-transparent px-3 py-2.5 text-start transition-colors ${
                          active ? 'rounded-[10px] bg-[var(--brand-soft)]' : 'hover:bg-[var(--surface-2)]'
                        }`}
                      >
                        <span className="flex w-full items-center justify-between gap-2">
                          <span
                            className={`text-[13.5px] ${active ? 'font-extrabold text-[var(--brand)]' : 'font-bold'}`}
                          >
                            {ROLE_NAME_AR[role.code] ?? role.nameAr}
                          </span>
                          {pending ? (
                            <span
                              className="size-1.5 flex-none rounded-full bg-[var(--warn)]"
                              aria-label="تغييرات غير محفوظة"
                            />
                          ) : null}
                        </span>
                        <span className="flex w-full items-center justify-between gap-2 text-[11.5px] text-muted">
                          <span>عدد الصلاحيات المفعّلة</span>
                          <span className="flex-none tabular-nums">
                            {role.permissions.length}/{codes.length}
                          </span>
                        </span>
                        <span className="flex w-full items-center gap-1.5 text-xs">
                          <span className={`tag ${role.overridden ? 'tenant' : 'default'}`}>
                            {role.overridden ? 'تجاوز مسجَّل' : 'كما في الفهرس'}
                          </span>
                          <span className="text-muted">{role.holderCount} حائز</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Panel>

            {/* ------------------------------------------------ permission matrix */}
            <div className="grid gap-4">
              <Panel>
                <header className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="m-0 flex flex-wrap items-center gap-2 text-[16px] font-bold">
                      {ROLE_NAME_AR[selected.code] ?? selected.nameAr}
                    </h2>
                    <p className="m-0 mt-1 max-w-2xl text-[12.5px] leading-relaxed text-muted">
                      {ROLE_DESC_AR[selected.code] ?? selected.description}
                    </p>
                  </div>
                  <span className={`tag ${selected.overridden ? 'tenant' : 'default'}`}>
                    {selected.overridden ? 'تجاوز مسجَّل' : 'كما في الفهرس'}
                  </span>
                </header>

                <div className="mt-3 grid gap-4">
                  {GROUPS.map((group) => {
                    const groupCodes = codes.filter(group.match);
                    if (groupCodes.length === 0) return null;
                    return (
                      <div key={group.key}>
                        <p className="m-0 mb-1.5 text-xs font-bold uppercase tracking-[0.06em] text-muted">
                          {group.label}
                        </p>
                        <ul className="m-0 grid list-none gap-x-4 gap-y-0 p-0 sm:grid-cols-2">
                          {groupCodes.map((code) => {
                            const on = (draft[selected.code] ?? []).includes(code);
                            const inCatalogue = selected.catalogPermissions.includes(code);
                            const override = inCatalogue !== on;
                            return (
                              <li key={code} className="border-b border-[var(--line)] last:border-b-0">
                                <label className="checkbox flex cursor-pointer items-center gap-2.5 py-[7px]">
                                  <input
                                    type="checkbox"
                                    className="flex-none"
                                    checked={on}
                                    disabled={!canManage || busy === selected.code}
                                    onChange={(event) => toggle(selected.code, code, event.target.checked)}
                                  />
                                  <span
                                    className={`min-w-0 flex-1 truncate text-[12.5px] ${on ? 'font-semibold text-[var(--text)]' : 'text-muted'}`}
                                  >
                                    {CONSOLE_PERM_AR[code] ?? 'صلاحية تشغيلية'}
                                  </span>
                                  {override ? (
                                    <span className={`tag flex-none ${on ? 'tenant' : 'danger'}`}>
                                      {on ? '+ تجاوز' : '− عن الفهرس'}
                                    </span>
                                  ) : null}
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    );
                  })}
                </div>

                {canManage ? (
                  <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-[var(--line)] pt-3">
                    <label className="field" style={{ margin: 0, minWidth: 240, flex: 1 }}>
                      <span>سبب التغيير (٣ أحرف على الأقل)</span>
                      <input
                        className="input"
                        value={reason}
                        placeholder="مثال: نقل صلاحية التدقيق إلى المدقّق"
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={!dirty(selected) || busy === selected.code || reason.trim().length < 3}
                      onClick={() => void save(selected, reason.trim())}
                    >
                      {busy === selected.code ? 'جارٍ الحفظ…' : 'حفظ مجموعة هذا الدور'}
                    </button>
                    <button
                      className="btn"
                      type="button"
                      disabled={busy === selected.code}
                      onClick={() => {
                        // Restoring the catalogue is itself a write: it clears the override row.
                        for (const code of codes)
                          toggle(selected.code, code, selected.catalogPermissions.includes(code));
                        setReason('إرجاع إلى الفهرس');
                      }}
                    >
                      إرجاع إلى الفهرس
                    </button>
                    {!dirty(selected) ? (
                      <span className="text-[12px] text-muted">لا تغييرات غير محفوظة</span>
                    ) : null}
                  </div>
                ) : (
                  <p className="m-0 mt-3 border-t border-[var(--line)] pt-3 text-[12px] text-muted">
                    القراءة متاحة؛ التعديل يحتاج صلاحية <span dir="ltr">console.users.manage</span>.
                  </p>
                )}
              </Panel>
            </div>
          </div>
        ) : null)}

      <UsersAndHolders />
    </Screen>
  );
}

/** «مَن يحمل ماذا» — الجدول الذي كان في صفحة الأدوار قبل P-C3، مع رابطٍ لبطاقة كل حساب. */
function UsersAndHolders() {
  const users = useQuery<PlatformDirectoryUser[]>(() => apiData<PlatformDirectoryUser[]>('/platform/users'));
  const rows = (users.data ?? []).filter((row) => row.platformRoles.length > 0 || row.isPlatformAdmin);

  const columns: Array<Column<PlatformDirectoryUser>> = [
    {
      key: 'name',
      header: 'المشغّل',
      grow: true,
      cell: (row) => <Link href={`/users/${row.id}`}>{row.fullName}</Link>,
    },
    { key: 'email', header: 'البريد', ltr: true, cell: (row) => row.email },
    {
      key: 'roles',
      header: 'الأدوار',
      cell: (row) => (
        <>
          {row.platformRoles.map((code) => (
            <span key={code} className="badge active" style={{ marginInlineEnd: 4 }}>
              {ROLE_NAME_AR[code] ?? code}
            </span>
          ))}
          {row.platformRoles.length === 0 && row.isPlatformAdmin && (
            <span className="badge active">مالك المنصة</span>
          )}
        </>
      ),
    },
  ];

  return (
    <Panel title="الحائزون" flush>
      {users.status === 'loading' && <Loading />}
      {users.status === 'error' && <ErrorBox message={users.error} onRetry={users.reload} />}
      {users.status === 'success' &&
        (rows.length === 0 ? (
          <Empty title="لا حائزين" />
        ) : (
          <Table bare columns={columns} rows={rows} rowKey={(row) => row.id} />
        ))}
    </Panel>
  );
}
