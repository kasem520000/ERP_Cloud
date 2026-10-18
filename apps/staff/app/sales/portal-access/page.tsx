'use client';

import Link from 'next/link';
import { FormActions, Panel } from '@erp/ui';
import { useState } from 'react';

import { DataTable, QueryView } from '../../../components/data-view';
import { FormFields, type FormValues } from '../../../components/directory';
import { Screen } from '../../../components/screen';
import { apiDelete, apiList, apiPatch, apiPost, ApiError } from '../../../lib/api';
import { listParties, type Party } from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

type PortalAccount = {
  id: string;
  party_id: string;
  party_name: string;
  party_code: string | null;
  status: 'active' | 'suspended';
  invited_at: string;
  last_seen_at: string | null;
  email: string;
  full_name: string;
  user_status: string;
  last_login_at: string | null;
  must_change_password: boolean;
};

const EMPTY: FormValues = { partyId: '', email: '', fullName: '' };

function when(value: string | null) {
  return value
    ? new Date(value).toLocaleString('ar-SA-u-ca-gregory-nu-latn', { dateStyle: 'short', timeStyle: 'short' })
    : '—';
}

export default function PortalAccessPage() {
  const { can } = useSession();
  const manage = can('parties.manage');
  const accounts = useQuery<PortalAccount[]>(() => apiList<PortalAccount>('/portal-access'), []);
  const customers = useQuery<Party[]>(() => listParties('customer'), []);
  const [form, setForm] = useState<FormValues>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string } | null>(null);
  const [issued, setIssued] = useState<{ email: string; password: string } | null>(null);

  async function grant() {
    const partyId = String(form.partyId);
    if (!partyId || !String(form.email).trim()) {
      setNotice({ kind: 'danger', text: 'اختر العميل وأدخل بريداً إلكترونياً.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    setIssued(null);
    try {
      const created = await apiPost<{ email: string; temporaryPassword?: string }>(
        `/parties/${partyId}/portal-access`,
        {
          email: String(form.email).trim(),
          fullName: String(form.fullName).trim() || undefined,
        },
      );
      setForm(EMPTY);
      accounts.reload();
      // The password exists in plaintext exactly once, here. If the user already had a login
      // in this tenant we linked it instead and there is nothing to hand over.
      if (created.temporaryPassword) setIssued({ email: created.email, password: created.temporaryPassword });
      else
        setNotice({
          kind: 'ok',
          text: `تم ربط المستخدم ${created.email} بالعميل. يستخدم كلمة مروره الحالية للدخول.`,
        });
    } catch (error) {
      const message =
        error instanceof ApiError && error.code === 'PORTAL_ACCOUNT_TAKEN'
          ? 'هذا البريد مرتبط بعميل آخر في نفس المنشأة.'
          : error instanceof ApiError && error.code === 'PORTAL_ACCOUNT_EXISTS'
            ? 'هذا البريد لديه وصول بالفعل لهذا العميل.'
            : error instanceof Error
              ? error.message
              : 'تعذّر إنشاء الوصول';
      setNotice({ kind: 'danger', text: message });
    } finally {
      setBusy(false);
    }
  }

  async function toggle(row: PortalAccount) {
    setNotice(null);
    try {
      await apiPatch(`/portal-access/${row.id}`, {
        status: row.status === 'active' ? 'suspended' : 'active',
      });
      accounts.reload();
      setNotice({
        kind: 'ok',
        text: row.status === 'active' ? `تم إيقاف وصول ${row.email}.` : `تم تفعيل وصول ${row.email}.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof Error ? error.message : 'تعذّر تغيير الحالة' });
    }
  }

  async function revoke(row: PortalAccount) {
    if (!globalThis.confirm(`إلغاء وصول ${row.email} إلى بوابة العميل ${row.party_name}؟`)) return;
    setNotice(null);
    try {
      await apiDelete(`/portal-access/${row.id}`);
      accounts.reload();
      setNotice({ kind: 'ok', text: `تم إلغاء وصول ${row.email}.` });
    } catch (error) {
      setNotice({ kind: 'danger', text: error instanceof Error ? error.message : 'تعذّر إلغاء الوصول' });
    }
  }

  return (
    <Screen
      title="وصول العملاء للبوابة"
      subtitle="امنح عميلك حساب دخول إلى بوابة العملاء ليطّلع على فواتيره وكشف حسابه ومدفوعاته فقط — بدون أي صلاحية على النظام."
      crumbs={['المبيعات', 'أخرى']}
      actions={
        <Link className="btn" href="/sales/customers">
          بطاقة عميل
        </Link>
      }
    >
      {notice ? (
        <p
          className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${
            notice.kind === 'ok'
              ? 'border-ok-line bg-ok-soft text-ok-ink'
              : notice.kind === 'danger'
                ? 'border-danger-line bg-danger-soft text-danger-ink'
                : 'border-line bg-surface-2 text-ink'
          }`}
          role={notice.kind === 'danger' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      ) : null}

      {issued ? (
        <Panel hint="تُعرض مرة واحدة، ويُطلب تغييرها عند أول دخول." title="بيانات الدخول المؤقتة">
          <p className="alert warn">
            كلمة المرور المؤقتة تظهر مرة واحدة فقط — انسخها وسلّمها للعميل الآن. سيُطلب منه تغييرها عند أول
            دخول.
          </p>
          <dl className="m-0 grid gap-2 text-[13px]">
            <div className="flex flex-wrap items-baseline gap-2">
              <dt className="text-muted">البريد</dt>
              <dd className="m-0 font-bold" dir="ltr">
                {issued.email}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <dt className="text-muted">كلمة المرور المؤقتة</dt>
              <dd className="m-0 font-bold" dir="ltr" style={{ fontFamily: 'monospace', fontSize: 18 }}>
                {issued.password}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline gap-2">
              <dt className="text-muted">رابط البوابة</dt>
              <dd className="m-0">تطبيق بوابة العملاء</dd>
            </div>
          </dl>
          <div className="toolbar">
            <button
              className="btn"
              type="button"
              onClick={() => globalThis.navigator.clipboard?.writeText(issued.password)}
            >
              نسخ كلمة المرور
            </button>
            <button className="btn" type="button" onClick={() => setIssued(null)}>
              إخفاء
            </button>
          </div>
        </Panel>
      ) : null}

      {manage ? (
        <Panel hint="الحساب يرى فواتيره وكشف حسابه ومدفوعاته فقط." title="منح وصول جديد">
          <FormFields
            fields={[
              {
                name: 'partyId',
                label: 'العميل',
                type: 'select',
                required: true,
                options: (customers.data ?? []).map((party) => ({
                  id: party.id,
                  label: party.code ? `${party.code} — ${party.name}` : party.name,
                })),
              },
              { name: 'email', label: 'البريد الإلكتروني للدخول', ltr: true, required: true },
              { name: 'fullName', label: 'اسم المستخدم (اختياري)' },
            ]}
            values={form}
            onChange={setForm}
          />
          <FormActions>
            <button className="btn primary" type="button" onClick={grant} disabled={busy}>
              {busy ? 'جارٍ الإنشاء…' : 'إنشاء وصول'}
            </button>
          </FormActions>
        </Panel>
      ) : null}

      <Panel flush hint="الحالة والإيقاف والإلغاء تخصّ حساب البوابة وحده." title="الحسابات الممنوحة">
        <QueryView
          query={accounts}
          empty="لا يوجد عملاء لديهم وصول للبوابة"
          emptyDetail="امنح أول وصول من النموذج أعلاه."
        >
          {(rows) => (
            <DataTable
              rowKey={(row: PortalAccount) => row.id}
              rows={rows}
              columns={[
                { key: 'party', header: 'العميل', cell: (row: PortalAccount) => row.party_name },
                { key: 'email', header: 'البريد', align: 'ltr', cell: (row: PortalAccount) => row.email },
                { key: 'name', header: 'الاسم', cell: (row: PortalAccount) => row.full_name || '—' },
                {
                  key: 'status',
                  header: 'الحالة',
                  cell: (row: PortalAccount) => (
                    <span className={`badge ${row.status === 'active' ? 'active' : 'planned'}`}>
                      {row.status === 'active' ? 'نشط' : 'موقوف'}
                    </span>
                  ),
                },
                {
                  key: 'temp',
                  header: 'كلمة مرور مؤقتة',
                  cell: (row: PortalAccount) => (row.must_change_password ? 'لم تُغيّر بعد' : '—'),
                },
                { key: 'login', header: 'آخر دخول', cell: (row: PortalAccount) => when(row.last_login_at) },
                {
                  key: 'seen',
                  header: 'آخر زيارة للبوابة',
                  cell: (row: PortalAccount) => when(row.last_seen_at),
                },
                {
                  key: 'actions',
                  header: '',
                  cell: (row: PortalAccount) =>
                    manage ? (
                      <span className="toolbar">
                        <button className="btn sm" type="button" onClick={() => toggle(row)}>
                          {row.status === 'active' ? 'إيقاف' : 'تفعيل'}
                        </button>
                        <button className="btn sm danger" type="button" onClick={() => revoke(row)}>
                          إلغاء
                        </button>
                      </span>
                    ) : null,
                },
              ]}
            />
          )}
        </QueryView>
      </Panel>
    </Screen>
  );
}
