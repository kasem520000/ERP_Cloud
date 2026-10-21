'use client';

import { Panel } from '@erp/ui';
import { useEffect, useMemo, useState } from 'react';

import { Notice, QueryView } from '../../../components/data-view';
import { Forbidden, Screen } from '../../../components/screen';
import { apiErrorText, apiList, apiPost, apiPut } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';
import { PERMISSION_MODULE_AR, describePermissionAr } from '../../../lib/permissions-ar';

type Role = {
  id: string;
  name: string;
  description?: string | null;
  isSystem?: boolean;
  permissionCodes?: string[];
  permissions?: string[];
};

type Permission = {
  code: string;
  name?: string;
  module?: string;
  description?: string;
};

/** الأدوار النظامية الثلاثة — أسماء عربية بلا لفظ إنجليزي بين قوسين. */
const ROLE_NAME_AR: Record<string, string> = {
  Owner: 'مالك الحساب',
  Accountant: 'محاسب',
  Cashier: 'أمين صندوق',
};

/**
 * وصف الدور النظامي يأتي من الـAPI بالإنجليزية؛ نعرض الوصف العربي المعتمد
 * ونُبقي نص الـAPI للدور المخصص فقط (لأنه من تحرير المستخدم).
 */
const ROLE_DESCRIPTION_AR: Record<string, string> = {
  Owner: 'صلاحية كاملة على المنشأة، بما فيها الإعدادات وإدارة المستخدمين والصلاحيات.',
  Accountant: 'المحاسبة والعملاء والموردون والمخزون؛ دون إدارة المنشأة أو المستخدمين.',
  Cashier: 'عمليات الكاشير والخزينة؛ قراءة الكتالوج والبحث عن العملاء فقط.',
};

function roleName(role: { name: string }): string {
  return ROLE_NAME_AR[role.name] ?? role.name;
}

export default function RolesPage() {
  const { can, me } = useSession();
  const roles = useQuery<Role[]>(() => apiList<Role>('/roles'), []);
  const permissions = useQuery<Permission[]>(() => apiList<Permission>('/permissions'), []);

  const [selected, setSelected] = useState<Role | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string } | undefined>();

  // Filter out deprecated `platform.*` aliases so each permission appears once in its canonical form.
  const canonicalPermissions = useMemo(
    () =>
      (permissions.data ?? []).filter(
        (permission) => !permission.code.startsWith('platform.') && !permission.code.startsWith('console.'),
      ),
    [permissions.data],
  );

  const grouped = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    const q = searchQuery.trim().toLowerCase();
    for (const permission of canonicalPermissions) {
      const info = describePermissionAr(permission.code, permission.module);
      if (
        q &&
        !info.title.toLowerCase().includes(q) &&
        !info.detail.toLowerCase().includes(q) &&
        !info.moduleAr.toLowerCase().includes(q) &&
        !permission.code.toLowerCase().includes(q)
      ) {
        continue;
      }
      const key = permission.module ?? permission.code.split('.')[0] ?? 'other';
      groups.set(key, [...(groups.get(key) ?? []), permission]);
    }
    return [...groups.entries()];
  }, [canonicalPermissions, searchQuery]);

  // Keep `selected` synchronised when roles first load or reload
  useEffect(() => {
    if (!roles.data || roles.data.length === 0) return;
    if (!selected) {
      const first = roles.data[0]!;
      pickRole(first);
      return;
    }
    const updated = roles.data.find((r) => r.id === selected.id);
    if (updated) {
      setSelected(updated);
    }
  }, [roles.data]);

  if (!can('tenant.role.manage')) {
    return (
      <Screen title="الأدوار والصلاحيات" crumbs={['الإعدادات']}>
        <Forbidden />
      </Screen>
    );
  }

  const active = selected ?? roles.data?.[0] ?? null;
  const isOwnerRole = active?.name.trim().toLowerCase() === 'owner';
  const isSystemNonOwner = Boolean(active?.isSystem && !isOwnerRole);
  const canEditActivePermissions = Boolean(
    active && !isOwnerRole && (!active.isSystem || Boolean(me?.membership.isOwner)),
  );

  function pickRole(role: Role) {
    setSelected(role);
    const rawCodes = role.permissionCodes ?? role.permissions ?? [];
    const normalized = rawCodes.map((code) =>
      code.startsWith('platform.') ? `tenant.${code.slice('platform.'.length)}` : code,
    );
    setChecked(new Set(normalized));
    setEditName(role.name);
    setEditDesc(role.description ?? '');
    setNotice(undefined);
  }

  function toggle(code: string) {
    if (!canEditActivePermissions) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  }

  function toggleModuleGroup(items: Permission[], selectAll: boolean) {
    if (!canEditActivePermissions) return;
    setChecked((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (selectAll) next.add(item.code);
        else next.delete(item.code);
      }
      return next;
    });
  }

  async function createRole(event: React.FormEvent) {
    event.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const created = await apiPost<Role>('/roles', {
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        permissionCodes: [],
      });
      setNewName('');
      setNewDesc('');
      setNotice({
        kind: 'ok',
        text: `تم إنشاء الدور «${created.name}» بنجاح. يمكنك الآن تحديد صلاحياته وحفظها.`,
      });
      roles.reload();
      pickRole(created);
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function cloneRoleAsCustom(source: Role) {
    setBusy(true);
    setNotice(undefined);
    try {
      const codes = (source.permissionCodes ?? source.permissions ?? []).map((code) =>
        code.startsWith('platform.') ? `tenant.${code.slice('platform.'.length)}` : code,
      );
      const copyName = `${roleName(source)} — مخصص`;
      const created = await apiPost<Role>('/roles', {
        name: copyName,
        description: source.description ?? 'نسخة مخصصة قابلة للتعديل',
        permissionCodes: codes,
      });
      setNotice({ kind: 'ok', text: `تم نسخ الصلاحيات إلى الدور الجديد «${created.name}».` });
      roles.reload();
      pickRole(created);
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function savePermissions() {
    if (!active) return;
    setBusy(true);
    setNotice(undefined);
    try {
      const permissionCodes = [...checked];
      let saved: Role;
      if (!active.isSystem) {
        saved = await apiPut<Role>(`/roles/${active.id}`, {
          name: editName.trim() || active.name,
          description: editDesc.trim() || null,
          permissionCodes,
        });
      } else {
        saved = await apiPost<Role>(`/roles/${active.id}/permissions`, {
          permissionCodes,
        });
      }
      setSelected(saved);
      setChecked(new Set(saved.permissionCodes ?? saved.permissions ?? permissionCodes));
      setNotice({
        kind: 'ok',
        text: `تم حفظ تعديلات وصلاحيات الدور «${roleName(saved)}» (${permissionCodes.length} صلاحية).`,
      });
      roles.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="الأدوار والصلاحيات"
      subtitle="إدارة الأدوار الوظيفية وتحديد صلاحيات الوصول لكل وحدة وشاشة باللغة العربية."
      crumbs={['الإعدادات', 'الأدوار والصلاحيات']}
    >
      <Notice notice={notice} />

      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <Panel
          title="إنشاء دور وظيفي جديد"
          hint={
            <>
              أنشئ دوراً مخصصاً (مثل: مدير مبيعات، أمين مستودع، مدقق حسابات) ثم حدد صلاحياته من القائمة
              المقابلة.
            </>
          }
          flush
        >
          <form className="form" onSubmit={createRole}>
            <div className="form-grid">
              <label className="field">
                <span>اسم الدور *</span>
                <input
                  className="input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  required
                  placeholder="مثال: مشرف مبيعات"
                />
              </label>
              <label className="field">
                <span>الوصف الوظيفي</span>
                <input
                  className="input"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="وصف مختصر لمهام الدور"
                />
              </label>
            </div>
            <div className="toolbar">
              <button className="btn primary" type="submit" disabled={busy}>
                + إضافة الدور
              </button>
            </div>
          </form>
        </Panel>

        <Panel title="الأدوار المسجلة في المنشأة" hint="اختر دوراً لتظهر صلاحياته في اللوحة أسفله." flush>
          <QueryView query={roles} empty="لا توجد أدوار مسجلة.">
            {(rows) => (
              <div>
                {rows.map((role) => {
                  const isActive = active?.id === role.id;
                  const count = (role.permissionCodes ?? role.permissions ?? []).length;
                  const description = ROLE_DESCRIPTION_AR[role.name] ?? role.description;
                  return (
                    <button
                      key={role.id}
                      type="button"
                      className={`list-row${isActive ? ' active' : ''}`}
                      onClick={() => pickRole(role)}
                    >
                      <span
                        className="row"
                        style={{ justifyContent: 'space-between', alignItems: 'baseline' }}
                      >
                        <span className="list-title">{roleName(role)}</span>
                        <span className={`badge ${role.isSystem ? 'neutral' : 'active'}`}>
                          {role.isSystem ? 'دور نظامي' : 'دور مخصص'}
                        </span>
                      </span>
                      {description ? <span className="list-sub">{description}</span> : null}
                      <span className="list-sub">{`${count} من الصلاحيات`}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </QueryView>
        </Panel>
      </div>

      <Panel
        title={`صلاحيات الدور: ${active ? roleName(active) : 'اختر دوراً'}`}
        hint={
          <>
            محدد حالياً: <strong>{checked.size}</strong> من أصل <strong>{canonicalPermissions.length}</strong>{' '}
            صلاحية
          </>
        }
        actions={
          active ? (
            <div className="toolbar">
              {isOwnerRole ? (
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() => void cloneRoleAsCustom(active)}
                >
                  نسخ إلى دور مخصص قابل للتعديل
                </button>
              ) : (
                <>
                  <button
                    className="btn sm"
                    type="button"
                    disabled={busy || !canEditActivePermissions}
                    onClick={() => setChecked(new Set(canonicalPermissions.map((p) => p.code)))}
                  >
                    تحديد الكل
                  </button>
                  <button
                    className="btn sm"
                    type="button"
                    disabled={busy || !canEditActivePermissions}
                    onClick={() => setChecked(new Set())}
                  >
                    إلغاء الكل
                  </button>
                  <button
                    className="btn primary"
                    type="button"
                    disabled={busy || !canEditActivePermissions}
                    onClick={() => void savePermissions()}
                  >
                    {busy ? 'جاري الحفظ...' : 'حفظ التعديلات'}
                  </button>
                </>
              )}
            </div>
          ) : null
        }
      >
        {isOwnerRole && (
          <div className="alert info">
            <span>
              دور <strong>مالك الحساب (Owner)</strong> يمتلك كافة صلاحيات المنشأة تلقائياً ولا يمكن تقليص
              صلاحياته حمايةً للحساب. لإنشاء دور مشابه بصلاحيات مخصصة، اضغط على «نسخ إلى دور مخصص قابل
              للتعديل».
            </span>
          </div>
        )}

        {isSystemNonOwner && !me?.membership.isOwner && (
          <div className="alert warn">
            <span>تعديل الأدوار النظامية متاح لمالك الحساب فقط. يمكنك إنشاء وتعديل الأدوار المخصصة.</span>
          </div>
        )}

        {active && !active.isSystem && (
          <div
            className="form-grid"
            style={{ padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 10 }}
          >
            <label className="field" style={{ marginBottom: 0 }}>
              <span>اسم الدور المخصص</span>
              <input
                className="input"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                disabled={busy}
              />
            </label>
            <label className="field" style={{ marginBottom: 0 }}>
              <span>وصف الدور</span>
              <input
                className="input"
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                disabled={busy}
                placeholder="وصف اختياري"
              />
            </label>
          </div>
        )}

        <label className="field" style={{ marginBottom: 4 }}>
          <span>بحث في الصلاحيات</span>
          <input
            className="input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ابحث باسم الصلاحية بالعربية أو اسم الوحدة..."
          />
        </label>

        <QueryView query={permissions} empty="لا توجد صلاحيات مسجلة.">
          {() => (
            <div className="grid" style={{ maxHeight: '62vh', overflowY: 'auto', paddingInlineEnd: 4 }}>
              {grouped.map(([mod, list]) => {
                const moduleTitle = PERMISSION_MODULE_AR[mod] ?? 'صلاحيات أخرى';
                const selectedInGroup = list.filter((p) => checked.has(p.code)).length;
                const allSelectedInGroup = list.length > 0 && selectedInGroup === list.length;

                return (
                  <div
                    key={mod}
                    style={{ display: 'grid', gap: 8, paddingTop: 12, borderTop: '1px solid var(--line)' }}
                  >
                    <div
                      className="row"
                      style={{
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        marginBottom: 8,
                        paddingBottom: 6,
                        borderBottom: '1px solid var(--line)',
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: 14 }}>{moduleTitle}</strong>
                        <span className="badge neutral" style={{ marginInlineStart: 8 }}>
                          {selectedInGroup} / {list.length}
                        </span>
                      </div>
                      {canEditActivePermissions && (
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => toggleModuleGroup(list, !allSelectedInGroup)}
                        >
                          {allSelectedInGroup ? 'إلغاء تحديد القسم' : 'تحديد القسم بالكامل'}
                        </button>
                      )}
                    </div>

                    <div className="grid cols-2" style={{ gap: 8 }}>
                      {list.map((permission) => {
                        const info = describePermissionAr(permission.code, permission.module);
                        const isChecked = checked.has(permission.code);
                        return (
                          <label
                            key={permission.code}
                            style={{
                              display: 'flex',
                              gap: 10,
                              alignItems: 'flex-start',
                              padding: '8px 10px',
                              borderRadius: 8,
                              border: `1px solid ${isChecked ? 'var(--brand-line)' : 'var(--line)'}`,
                              background: isChecked ? 'var(--brand-soft)' : 'var(--surface)',
                              cursor: canEditActivePermissions ? 'pointer' : 'default',
                              opacity: canEditActivePermissions || isChecked ? 1 : 0.75,
                            }}
                          >
                            <input
                              type="checkbox"
                              checked={isChecked}
                              disabled={!canEditActivePermissions}
                              onChange={() => toggle(permission.code)}
                              style={{ marginTop: 3, width: 16, height: 16, accentColor: 'var(--brand)' }}
                            />
                            <span style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                              <strong style={{ fontSize: 13 }}>{info.title}</strong>
                              {info.detail ? (
                                <small className="muted" style={{ fontSize: 11.5, lineHeight: 1.4 }}>
                                  {info.detail}
                                </small>
                              ) : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </QueryView>
      </Panel>
    </Screen>
  );
}
