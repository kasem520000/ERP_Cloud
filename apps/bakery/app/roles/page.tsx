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
  type Column,
} from '@erp/ui';
import { apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';

type RoleRow = Record<string, unknown> & {
  id: string;
  name: string;
  description?: string | null;
  permissionCodes?: string[];
  permissions?: Array<string | { code: string }>;
};

type PermissionDto = { code: string; module?: string; description?: string };

function extractCodes(role: RoleRow): string[] {
  if (Array.isArray(role.permissionCodes)) return role.permissionCodes;
  if (Array.isArray(role.permissions)) {
    return role.permissions.map((p) => (typeof p === 'string' ? p : p.code));
  }
  return [];
}

export default function BakeryRolesPage() {
  const { can } = useSession();
  const canManage = can('tenant.role.manage');

  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [permissions, setPermissions] = useState<PermissionDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RoleRow | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCodes, setSelectedCodes] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [rList, pList] = await Promise.all([
        apiList<RoleRow>('/roles'),
        apiList<PermissionDto>('/permissions').catch(() => []),
      ]);
      setRoles(rList);
      setPermissions(pList);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة الأدوار والصلاحيات'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row?: RoleRow) => {
    setEditing(row ?? null);
    setName(row?.name ?? '');
    setDescription(String(row?.description ?? ''));
    setSelectedCodes(new Set(row ? extractCodes(row) : []));
    setModalOpen(true);
  };

  const togglePerm = (code: string) => {
    setSelectedCodes((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
  };

  const saveRole = async () => {
    if (!editing && !name.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const codes = Array.from(selectedCodes);
      if (editing) {
        await apiPost(`/roles/${encodeURIComponent(editing.id)}/permissions`, {
          permissionCodes: codes,
        });
      } else {
        await apiPost('/roles', {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          permissionCodes: codes,
        });
      }
      setModalOpen(false);
      setNotice({ tone: 'ok', text: 'تم حفظ الدور وصلاحياته بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ الدور') });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<RoleRow>[] = [
    { key: 'name', header: 'اسم الدور', cell: (r) => r.name },
    { key: 'desc', header: 'الوصف', cell: (r) => String(r.description ?? '—') },
    {
      key: 'count',
      header: 'عدد الصلاحيات',
      numeric: true,
      cell: (r) => String(extractCodes(r).length),
    },
    {
      key: 'actions',
      header: 'إجراء',
      cell: (r) =>
        canManage ? (
          <Button onClick={() => openEditor(r)} size="sm">
            تعديل الصلاحيات
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
          <h1 className="ui-page-title">الأدوار ومصفوفة الصلاحيات</h1>
          <p className="ui-page-sub">ضبط صلاحيات الكاشير والخباز والمشرف والمحاسب والمندوب بدقة تفصيلية.</p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => openEditor()} variant="primary">
              + دور جديد
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
          <CardHeader subtitle="كل شاشة وإجراء في النظام مرتبط برمز صلاحية مستقل." title="الأدوار المعتمدة" />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا أدوار مخصصة"
              rows={roles}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setModalOpen(false)} open={modalOpen} title={editing ? `صلاحيات دور: ${editing.name}` : 'إنشاء دور جديد'}>
        <div className="grid gap-3">
          {!editing ? (
            <div className="grid gap-2 sm:grid-cols-2">
              <Input label="اسم الدور" onChange={(e) => setName(e.target.value)} value={name} />
              <Input label="الوصف" onChange={(e) => setDescription(e.target.value)} value={description} />
            </div>
          ) : null}
          <div className="max-h-72 overflow-y-auto rounded-xl border border-line bg-surface-2 p-3">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {permissions.map((p) => (
                <label className="flex items-center gap-2 text-[12px]" key={p.code}>
                  <input
                    checked={selectedCodes.has(p.code)}
                    onChange={() => togglePerm(p.code)}
                    type="checkbox"
                  />
                  <span dir="ltr">{p.code}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void saveRole()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ الصلاحيات'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
