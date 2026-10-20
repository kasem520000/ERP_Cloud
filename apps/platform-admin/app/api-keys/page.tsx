'use client';

import { Panel } from '@erp/ui';
import { useMemo, useState } from 'react';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { Table, type Column } from '../../components/ui/table';
import { apiData, apiList } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useQuery } from '../../lib/use-query';

/**
 * مفاتيح الـAPI — تكاملٌ رسمي بدل الأبواب الخلفية (P-C11).
 *
 * السؤال الذي تجيب عنه الشاشة: **«من يتكلّم معنا، وبأي سقف، وهل ما زال يستعمل مفتاحه؟»**
 * ولذلك كلُّ صفٍّ يقول نطاقاته وآخر استعمالٍ له وعدد الطلبات المقبولة به — ولا يُخفي شيئاً
 * تحت «تفاصيل»: هذه الأعمدة الأربعة هي القرار.
 *
 * وأربع حقائق تُقال في الشاشة لا في الوثيقة:
 *   * **النصّ الصريح يظهر مرّة واحدة** — بطاقةٌ بعد الإنشاء أو التدوير، ثم لا مكان يعيده.
 *     ومن ضاع منه مفتاحه يُدوّره، ولا يُرسل له أحدٌ مفتاحاً بالبريد.
 *   * **الإبطال بوسم لا حذف**: الصفّ يبقى بحالته وسببه، فالسجلّ يجيب «من أبطل ومتى ولماذا».
 *   * **التدوير يبطل القديم في نفس اللحظة** — لا نافذة يعمل فيها مفتاحان بلا علم أحد.
 *   * **النطاقات تُقرأ من الخادم** (`GET /platform/developer/catalogue`) لا من قائمةٍ مكتوبة
 *     في الشاشة، فإن أضاف الخادم نطاقاً ظهر هنا بلا نشر واجهة.
 */

type Tenant = { id: string; code: string; name: string; status: string };

type ApiKeyRow = {
  id: string;
  tenantId: string;
  name: string;
  prefix: string;
  scopes: string[];
  status: 'active' | 'revoked';
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  revokedReason: string | null;
  createdByLabel: string | null;
  createdAt: string;
  uses: number;
};

type ApiKeyCreated = ApiKeyRow & { secret: string };

type Catalogue = {
  scopes: string[];
  events: string[];
  testEvent: string;
  signature: { header: string; algorithm: string; toleranceSeconds: number };
  retryBackoffSeconds: number[];
};

export default function ApiKeysPage() {
  const { canConsole } = useSession();
  const [tenantId, setTenantId] = useState('');
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['invoices:read']);
  const [days, setDays] = useState('');
  const [reason, setReason] = useState('تدوير دوري كل ٩٠ يوماً');
  const [secret, setSecret] = useState<{ label: string; value: string } | undefined>(undefined);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);

  const allowed = canConsole('console.apikeys.manage');

  const tenants = useQuery(() => apiList<Tenant>('/platform/tenants?limit=200'), []);
  const catalogue = useQuery(() => apiData<Catalogue>('/platform/developer/catalogue'), []);
  const keys = useQuery(
    () => (tenantId ? apiList<ApiKeyRow>(`/platform/tenants/${tenantId}/api-keys`) : Promise.resolve([])),
    [tenantId],
  );

  const tenant = useMemo(
    () => (tenants.data ?? []).find((entry) => entry.id === tenantId),
    [tenants.data, tenantId],
  );

  async function create() {
    if (!tenantId || name.trim().length < 3 || scopes.length === 0) {
      setNotice({ kind: 'danger', text: 'الاسم (٣ محارف على الأقل) ونطاقٌ واحد على الأقل مطلوبان.' });
      return;
    }
    setBusy('create');
    setNotice(undefined);
    try {
      const created = await apiData<ApiKeyCreated>(`/platform/tenants/${tenantId}/api-keys`, {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), scopes, expiresInDays: days ? Number(days) : null }),
      });
      setSecret({ label: `مفتاح «${created.name}»`, value: created.secret });
      setName('');
      keys.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function rotate(row: ApiKeyRow) {
    setBusy(row.id);
    setNotice(undefined);
    try {
      const rotated = await apiData<ApiKeyCreated>(
        `/platform/tenants/${tenantId}/api-keys/${row.id}/rotate`,
        {
          method: 'POST',
          body: JSON.stringify(reason.trim().length >= 5 ? { reason: reason.trim() } : {}),
        },
      );
      setSecret({ label: `بديل مفتاح «${rotated.name}»`, value: rotated.secret });
      keys.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  async function revoke(row: ApiKeyRow) {
    const text = reason.trim().length >= 5 ? reason.trim() : 'إبطال من لوحة المنصة';
    setBusy(row.id);
    setNotice(undefined);
    try {
      await apiData<ApiKeyRow>(`/platform/tenants/${tenantId}/api-keys/${row.id}`, {
        method: 'DELETE',
        body: JSON.stringify({ reason: text }),
      });
      setNotice({ kind: 'ok', text: `أُبطل «${row.name}» — والصفّ باقٍ بسبب الإبطال.` });
      keys.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiMessage(error) });
    } finally {
      setBusy(null);
    }
  }

  /** أعمدةُ المفاتيح — `Table` المشترك: ترويسةٌ لاصقة وفرزٌ وحالةُ فراغ واحدة لكل الشاشات. */
  const keyColumns: Array<Column<ApiKeyRow>> = [
    {
      key: 'name',
      header: 'الاسم',
      grow: true,
      cell: (row) => (
        <>
          <strong>{row.name}</strong>
          <div className="muted">{row.createdByLabel ?? '—'}</div>
        </>
      ),
    },
    { key: 'prefix', header: 'البادئة', ltr: true, cell: (row) => <code>{row.prefix}</code> },
    {
      key: 'scopes',
      header: 'النطاقات',
      cell: (row) =>
        row.scopes.map((scope) => (
          <code key={scope} className="chip">
            {scope}
          </code>
        )),
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (row) => (
        <>
          {row.status === 'active' ? 'نشط' : 'مُبطَل'}
          {row.expiresAt && row.status === 'active' && (
            <div className="muted">ينتهي {row.expiresAt.slice(0, 10)}</div>
          )}
          {row.revokedReason && <div className="muted">{row.revokedReason}</div>}
        </>
      ),
    },
    {
      key: 'lastUsedAt',
      header: 'آخر استخدام',
      cell: (row) => (row.lastUsedAt ? row.lastUsedAt.slice(0, 19).replace('T', ' ') : 'لم يُستعمل بعد'),
    },
    { key: 'uses', header: 'الطلبات', numeric: true, cell: (row) => row.uses },
    {
      key: 'actions',
      header: 'الإجراء',
      cell: (row) =>
        row.status === 'active' ? (
          <div className="row">
            <button className="btn sm" onClick={() => rotate(row)} disabled={busy === row.id}>
              تدوير
            </button>
            <button className="btn danger" onClick={() => revoke(row)} disabled={busy === row.id}>
              إبطال
            </button>
          </div>
        ) : (
          <span className="muted">—</span>
        ),
    },
  ];

  if (!allowed) {
    return (
      <Screen title="مفاتيح الـAPI" subtitle="تكاملٌ رسمي بدل الأبواب الخلفية">
        <Forbidden />
      </Screen>
    );
  }

  return (
    <Screen
      title="مفاتيح الـAPI"
      subtitle="لكل منشأة مفاتيحها: نطاقاتٌ محدّدة، وآخر استخدام، وإبطالٌ يبقى في السجلّ"
      actions={
        <button className="btn" onClick={() => keys.reload()} disabled={!tenantId}>
          تحديث
        </button>
      }
    >
      {notice && <p className={`alert ${notice.kind}`}>{notice.text}</p>}

      {secret && (
        <Panel>
          <strong>النصّ الصريح يظهر مرّة واحدة</strong>
          <p className="muted">
            انسخه الآن وسلّمه لحامله. القاعدة تحفظ البادئة والبصمة فقط — ومن ضاع منه المفتاح يُدوّره ولا ينتظر
            إعادة عرض.
          </p>
          <pre className="code">{secret.value}</pre>
          <p className="muted">
            {secret.label} · البادئة <code>{secret.value.slice(0, 17)}</code>
          </p>
          <button className="btn" onClick={() => setSecret(undefined)}>
            أخفِ النصّ
          </button>
        </Panel>
      )}

      <Panel bodyClassName="grid cols-2">
        <label>
          المنشأة
          <select className="input" value={tenantId} onChange={(event) => setTenantId(event.target.value)}>
            <option value="">— اختر منشأة —</option>
            {(tenants.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ({entry.code}){entry.status !== 'active' ? ` — ${entry.status}` : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="muted">
          {tenant ? (
            <>
              المفاتيح تُصدرها المنصة بصفتها المشغّل، وتعمل على سطح التكامل{' '}
              <code>/api/v1/integration/v1/*</code> بترويسة <code>Authorization: Bearer erp_live_…</code>.
            </>
          ) : (
            'اختر منشأة لعرض مفاتيحها.'
          )}
        </div>
      </Panel>

      {tenantId && (
        <Panel>
          <strong>مفتاح جديد</strong>
          <div className="form-grid">
            <label>
              الاسم (ما ستعرفه به لاحقاً)
              <input
                className="input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="تكامل المستودع"
              />
            </label>
            <label>
              ينتهي بعد (أيام — فارغ = بلا انتهاء)
              <input
                className="input"
                value={days}
                inputMode="numeric"
                onChange={(event) => setDays(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="90"
              />
            </label>
          </div>

          <div className="form-grid">
            <strong>النطاقات — السقف الذي يفتحه المفتاح</strong>
            {(catalogue.data?.scopes ?? []).map((scope) => (
              <label key={scope}>
                <input
                  type="checkbox"
                  checked={scopes.includes(scope)}
                  onChange={(event) =>
                    setScopes((current) =>
                      event.target.checked ? [...current, scope] : current.filter((entry) => entry !== scope),
                    )
                  }
                />
                <code>{scope}</code>
              </label>
            ))}
          </div>

          {catalogue.data && (
            <p className="muted">
              التوقيع للنهايات المشتركة: <code>{catalogue.data.signature.header}</code> —{' '}
              {catalogue.data.signature.algorithm}، ونافذة القبول {catalogue.data.signature.toleranceSeconds}{' '}
              ثانية.
            </p>
          )}

          <button className="btn" onClick={create} disabled={busy === 'create'}>
            {busy === 'create' ? 'جارٍ الإصدار…' : 'أصدر المفتاح'}
          </button>
        </Panel>
      )}

      {tenantId && keys.status === 'loading' && <Loading />}
      {tenantId && keys.status === 'error' && <ErrorBox message={keys.error} onRetry={() => keys.reload()} />}
      {tenantId && keys.status === 'success' && (keys.data ?? []).length === 0 && (
        <Empty title="لا مفاتيح لهذه المنشأة" detail="أصدر أول مفتاح من البطاقة أعلاه." />
      )}

      {tenantId && (keys.data ?? []).length > 0 && (
        <Panel flush title="المفاتيح">
          <Table bare columns={keyColumns} rows={keys.data ?? []} rowKey={(row) => row.id} />
          <label className="grid" style={{ padding: '12px 16px' }}>
            سبب الإبطال/التدوير (٥ محارف على الأقل — يُكتب في التدقيق)
            <input className="input" value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        </Panel>
      )}
    </Screen>
  );
}

function apiMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'detail' in error) {
    const detail = (error as { detail?: string }).detail;
    if (detail) return detail;
  }
  return error instanceof Error ? error.message : String(error);
}
