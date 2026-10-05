'use client';

import { useMemo, useState } from 'react';

import { DataTable, Notice, QueryView } from '../../../components/data-view';
import { Forbidden, Screen } from '../../../components/screen';
import { apiList, apiPost, apiPut } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

type Role = {
  id: string;
  name: string;
  description?: string | null;
  isSystem?: boolean;
  permissionCodes?: string[];
};
type Permission = { code: string; module: string; description: string };

type NoticeState = { kind: 'ok' | 'danger' | 'info' | 'warn'; text: string };

export default function RolesPage() {
  const { me, can } = useSession();
  const roles = useQuery<Role[]>(() => apiList('/roles'), []);
  const registry = useQuery<Permission[]>(() => apiList('/permissions'), []);

  const [notice, setNotice] = useState<NoticeState | undefined>();
  const [busy, setBusy] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');

  const byModule = useMemo(() => {
    const groups = new Map<string, Permission[]>();
    for (const permission of registry.data ?? []) {
      const list = groups.get(permission.module) ?? [];
      list.push(permission);
      groups.set(permission.module, list);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [registry.data]);

  if (!can('tenant.role.manage')) {
    return (
      <Screen title="صلاحيات المستخدمين" subtitle="الأدوار ومجموعات الصلاحيات المرتبطة بها." crumbs={['الإعدادات', 'إعدادات المستخدمين']}>
        <Forbidden />
      </Screen>
    );
  }

  const rows = roles.data ?? [];
  const editing = rows.find((row) => row.id === editingId);

  const startEdit = (row: Role): void => {
    setEditingId(row.id);
    setEditName(row.name);
    setEditDescription(row.description ?? '');
    setSelected(row.permissionCodes ?? []);
    setFilter('');
    setNotice(undefined);
  };

  const run = async (label: string, work: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setNotice(undefined);
    try {
      await work();
      setNotice({ kind: 'ok', text: label });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  const create = (): Promise<void> =>
    run('تم إنشاء الدور.', async () => {
      await apiPost('/roles', { name: name.trim(), ...(description.trim() ? { description: description.trim() } : {}) });
      setName('');
      setDescription('');
      setShowCreate(false);
      roles.reload();
    });

  const saveEdit = (row: Role): Promise<void> =>
    run('تم حفظ الدور وصلاحياته.', async () => {
      const patch: Record<string, unknown> = {};
      if (!row.isSystem && editName.trim() && editName.trim() !== row.name) patch.name = editName.trim();
      if ((editDescription.trim() || null) !== (row.description ?? null)) patch.description = editDescription.trim() || null;
      if (Object.keys(patch).length > 0) await apiPut(`/roles/${row.id}`, patch);
      await apiPost(`/roles/${row.id}/permissions`, { permissionCodes: selected });
      setEditingId(null);
      roles.reload();
    });

  const togglePermission = (code: string): void =>
    setSelected(selected.includes(code) ? selected.filter((item) => item !== code) : [...selected, code]);

  const toggleModule = (codes: string[]): void => {
    const all = codes.every((code) => selected.includes(code));
    setSelected(all ? selected.filter((code) => !codes.includes(code)) : [...new Set([...selected, ...codes])]);
  };

  const matches = (permission: Permission): boolean =>
    !filter.trim() ||
    permission.code.toLowerCase().includes(filter.toLowerCase()) ||
    permission.description.toLowerCase().includes(filter.toLowerCase());

  return (
    <Screen title="صلاحيات المستخدمين" subtitle="الأدوار ومجموعات الصلاحيات المرتبطة بها." crumbs={['الإعدادات', 'إعدادات المستخدمين']}>
      <Notice notice={notice} />

      <section className="card">
        <h2>صلاحياتك الحالية</h2>
        {me?.permissions.includes('*') ? (
          <p className="alert ok">لديك كل الصلاحيات (دور المالك).</p>
        ) : (
          <div className="chips">
            {(me?.permissions ?? []).map((permission) => (
              <span className="chip small" key={permission} dir="ltr">
                {permission}
              </span>
            ))}
          </div>
        )}
      </section>

      <section className="card">
        <div className="row">
          <h2>الأدوار ({rows.length})</h2>
          <button type="button" className="btn primary" disabled={busy} onClick={() => setShowCreate(!showCreate)}>
            {showCreate ? 'إغلاق' : 'دور جديد'}
          </button>
        </div>

        {showCreate && (
          <div className="form-grid">
            <label>
              اسم الدور
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="مثال: مشرف مبيعات" />
            </label>
            <label>
              الوصف
              <input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="اختياري" />
            </label>
            <button type="button" className="btn primary" disabled={busy || !name.trim()} onClick={() => void create()}>
              إنشاء
            </button>
          </div>
        )}

        <QueryView
          query={roles}
          empty="لا توجد أدوار"
          children={(list) => (
            <DataTable
              rows={list}
              rowKey={(row) => row.id}
              columns={[
                { key: 'name', header: 'الدور', cell: (row) => row.name },
                { key: 'description', header: 'الوصف', cell: (row) => <span className="muted">{row.description ?? '—'}</span> },
                { key: 'system', header: 'نظامي', cell: (row) => (row.isSystem ? 'نعم' : '—') },
                { key: 'count', header: 'الصلاحيات', cell: (row) => String(row.permissionCodes?.length ?? 0) },
                {
                  key: 'actions',
                  header: 'إجراءات',
                  cell: (row) => (
                    <button type="button" className="btn sm" disabled={busy} onClick={() => startEdit(row)}>
                      ⚙️ تعديل الصلاحيات
                    </button>
                  ),
                },
              ]}
            />
          )}
        />
      </section>

      {editing && (
        <section className="card">
          <div className="row">
            <h2>صلاحيات: {editing.name}</h2>
            <button type="button" className="btn sm" onClick={() => setEditingId(null)}>
              إلغاء
            </button>
          </div>
          <div className="form-grid">
            <label>
              اسم الدور {editing.isSystem && <span className="muted">(النظامي لا يُعاد تسميته)</span>}
              <input value={editName} disabled={editing.isSystem} onChange={(event) => setEditName(event.target.value)} />
            </label>
            <label>
              الوصف
              <input value={editDescription} onChange={(event) => setEditDescription(event.target.value)} />
            </label>
            <label>
              بحث في الصلاحيات
              <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="code أو وصف" dir="auto" />
            </label>
          </div>
          <QueryView
            query={registry}
            empty="لا يوجد سجل صلاحيات"
            children={() => (
              <div className="form">
                {byModule.map(([module, permissions]) => {
                  const visible = permissions.filter(matches);
                  if (visible.length === 0) return null;
                  const codes = visible.map((item) => item.code);
                  const all = codes.every((code) => selected.includes(code));
                  return (
                    <fieldset key={module}>
                      <legend>
                        {module} ({visible.length})
                        <button type="button" className="btn sm" disabled={busy} onClick={() => toggleModule(codes)}>
                          {all ? 'إلغاء الكل' : 'تحديد الكل'}
                        </button>
                      </legend>
                      {visible.map((permission) => (
                        <label key={permission.code} title={permission.description}>
                          <input type="checkbox" checked={selected.includes(permission.code)} onChange={() => togglePermission(permission.code)} />
                          <span dir="ltr">{permission.code}</span>
                          <span className="muted"> — {permission.description}</span>
                        </label>
                      ))}
                    </fieldset>
                  );
                })}
              </div>
            )}
          />
          <div className="row">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void saveEdit(editing)}>
              حفظ ({selected.length} صلاحية)
            </button>
          </div>
        </section>
      )}
    </Screen>
  );
}
