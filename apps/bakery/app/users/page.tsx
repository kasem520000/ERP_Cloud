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
import { apiErrorText, apiList, apiPatch, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';

type MemberRow = Record<string, unknown> & {
  id: string;
  email?: string;
  fullName?: string;
  displayName?: string;
  status?: string;
  user?: { email?: string; fullName?: string };
  roles?: Array<{ id: string; name: string }>;
};

export default function BakeryUsersPage() {
  const { can } = useSession();
  const canManage = can('tenant.membership.manage');

  const [rows, setRows] = useState<MemberRow[]>([]);
  const [roles, setRoles] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [roleId, setRoleId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [mList, rList] = await Promise.all([
        apiList<MemberRow>('/memberships'),
        apiList<{ id: string; name: string }>('/roles').catch(() => []),
      ]);
      setRows(mList);
      setRoles(rList);
      setRoleId((prev) => prev || rList[0]?.id || '');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة عضويات المستخدمين'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const inviteMember = async () => {
    if (!email.trim() || !roleId) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/memberships', {
        email: email.trim(),
        ...(fullName.trim() ? { fullName: fullName.trim(), displayName: fullName.trim() } : {}),
        roleIds: [roleId],
      });
      setModalOpen(false);
      setEmail('');
      setFullName('');
      setNotice({ tone: 'ok', text: 'تمت إضافة عضوية المستخدم وربطها بالدور المحدد.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر إضافة المستخدم') });
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row: MemberRow) => {
    const next = row.status === 'suspended' ? 'active' : 'suspended';
    try {
      await apiPatch(`/memberships/${encodeURIComponent(row.id)}`, { status: next });
      setNotice({ tone: 'ok', text: 'تم تحديث حالة عضوية المستخدم.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر تعديل حالة العضوية') });
    }
  };

  const columns: Column<MemberRow>[] = [
    {
      key: 'name',
      header: 'الاسم',
      cell: (r) => r.displayName ?? r.fullName ?? r.user?.fullName ?? '—',
    },
    { key: 'email', header: 'البريد الإلكتروني', ltr: true, cell: (r) => r.email ?? r.user?.email ?? '—' },
    {
      key: 'roles',
      header: 'الأدوار',
      cell: (r) => (r.roles ?? []).map((rl) => rl.name).join('، ') || '—',
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (r) => (
        <Badge status={r.status === 'active' || !r.status ? 'active' : 'rejected'}>
          {r.status === 'active' || !r.status ? 'نشط' : String(r.status)}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: 'إجراء',
      cell: (r) =>
        canManage ? (
          <Button onClick={() => void toggleStatus(r)} size="sm">
            {r.status === 'suspended' ? 'تفعيل' : 'تعليق'}
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
          <h1 className="ui-page-title">المستخدمون والعضويات</h1>
          <p className="ui-page-sub">إدارة حسابات دخول فريق المخبز والمحاسبين والمناديب وتوزيع الأدوار عليهم.</p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => setModalOpen(true)} variant="primary">
              + دعوة مستخدم
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
          <CardHeader subtitle="تخضع إضافة العضويات لسقف المستخدمين المعتمد للمنشأة." title="أعضاء المنشأة" />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا عضويات مسجلة"
              rows={rows}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setModalOpen(false)} open={modalOpen} title="إضافة مستخدم جديد للمنشأة">
        <div className="grid gap-3">
          <Input label="البريد الإلكتروني" onChange={(e) => setEmail(e.target.value)} type="email" value={email} />
          <Input label="الاسم الكامل" onChange={(e) => setFullName(e.target.value)} value={fullName} />
          <Select
            label="الدور الوظيفي"
            onChange={(e) => setRoleId(e.target.value)}
            options={roles.map((r) => ({ value: r.id, label: r.name }))}
            value={roleId}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving || !email.trim()} onClick={() => void inviteMember()} variant="primary">
              {saving ? 'جارٍ الإضافة…' : 'إضافة العضوية'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
