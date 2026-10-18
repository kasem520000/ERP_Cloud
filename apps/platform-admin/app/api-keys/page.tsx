'use client';

import { useMemo, useState } from 'react';
import { ContentPanel, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { apiData, apiList } from '../../lib/api';
import { scopeLabel } from '../../lib/developer-language';
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
    () => tenantId
      ? apiList<ApiKeyRow>(`/platform/tenants/${tenantId}/api-keys`).then((rows) => ({ tenantId, rows }))
      : Promise.resolve({ tenantId, rows: [] as ApiKeyRow[] }),
    [tenantId],
  );
  // Do not display a previous tenant's rows during the next tenant's request.
  const rows = keys.data?.tenantId === tenantId ? keys.data.rows : [];

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
    if (!window.confirm(`تدوير مفتاح «${row.name}»؟ سيُبطل المفتاح السابق فوراً وقد تتوقف التطبيقات حتى تستلم البديل. لن يظهر النص الجديد إلا مرة واحدة.`)) return;
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
    if (!window.confirm(`إبطال مفتاح «${row.name}» نهائياً؟ ستتوقف الطلبات التي تستخدمه. السبب: ${text}`)) return;
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

  if (!allowed) {
    return (
      <Screen title="مفاتيح التكامل" subtitle="إدارة وصول الأنظمة المتصلة بالمنشأة">
        <Forbidden />
      </Screen>
    );
  }

  return (
    <Screen
      title="مفاتيح التكامل"
      subtitle="اختر المنشأة، راجع نطاقات كل مفتاح واستعماله، ثم أصدر أو دوّر بعد التحقق من الجهة المستلمة."
      actions={
        <button className="btn" onClick={() => keys.reload()} disabled={!tenantId}>
          تحديث
        </button>
      }
    >
      <WorkflowGuide title="دورة حياة مفتاح التكامل" steps={[
        { title: 'حدّد المنشأة', detail: 'الاختيار يعرض مفاتيح المنشأة فقط؛ تأكد من الاسم قبل إصدار أي مفتاح.' },
        { title: 'اختر أقل الصلاحيات', detail: 'راجع النطاقات والانتهاء واسم التكامل؛ إصدار المفتاح عملية فعلية.' },
        { title: 'سلّم وراقب', detail: 'احفظ النص الذي يظهر مرة واحدة، ثم راجع آخر استخدام قبل التدوير أو الإبطال.' },
      ]} />
      {notice && <p className={`alert ${notice.kind}`} role={notice.kind === 'danger' ? 'alert' : 'status'}>{notice.text}</p>}

      {secret && (
        <ContentPanel title="مفتاح جديد: يظهر النص مرة واحدة" description="لا تغادر الشاشة قبل تسليم المفتاح بطريقة آمنة للجهة المخوّلة.">
          <p className="muted">
            انسخه الآن وسلّمه لحامله. القاعدة تحفظ البادئة والبصمة فقط — ومن ضاع منه المفتاح
            يُدوّره ولا ينتظر إعادة عرض.
          </p>
          <pre className="code" dir="ltr" style={{ overflowX: 'auto' }}>{secret.value}</pre>
          <p className="muted">
            {secret.label} · البادئة <code>{secret.value.slice(0, 17)}</code>
          </p>
          <button className="btn" onClick={() => setSecret(undefined)}>
            أخفِ النصّ
          </button>
        </ContentPanel>
      )}

      <ContentPanel title="المنشأة والوجهة" description="كل مفتاح يخص منشأة واحدة، ولا يمنح صلاحية إدارة المنصة.">
        <div className="grid cols-2"><label>
          المنشأة
          <select value={tenantId} onChange={(event) => { setSecret(undefined); setNotice(undefined); setTenantId(event.target.value); }}>
            <option value="">— اختر منشأة —</option>
            {(tenants.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} ({entry.code}){entry.status !== 'active' ? ' — غير نشطة' : ''}
              </option>
            ))}
          </select>
        </label>
        <div className="muted">
          {tenant ? (
            <>
              تصدر المنصة مفتاحاً خاصاً بهذه المنشأة؛ لا ترسله في بريد أو تذكرة دعم. راجع اسمها ونطاقات المفتاح قبل مشاركته مع نظامها.
            </>
          ) : (
            'اختر منشأة لعرض مفاتيحها.'
          )}
        </div>
        </div>
      </ContentPanel>

      {tenantId && (
        <ContentPanel title="إصدار مفتاح جديد" description="إصدار المفتاح يمنح وصولاً فعلياً. اختر النطاقات التي يحتاجها التكامل فقط.">
          <div className="form-grid">
            <label>
              الاسم (ما ستعرفه به لاحقاً)
              <input value={name} onChange={(event) => setName(event.target.value)} placeholder="تكامل المستودع" />
            </label>
            <label>
              ينتهي بعد (أيام — فارغ = بلا انتهاء)
              <input
                value={days}
                inputMode="numeric"
                onChange={(event) => setDays(event.target.value.replace(/[^0-9]/g, ''))}
                placeholder="90"
              />
            </label>
          </div>

          <div className="form-grid">
            <strong>الصلاحيات الممنوحة للمفتاح</strong>
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
                <span title={scope}>{scopeLabel(scope)}</span>
              </label>
            ))}
          </div>
          <details className="muted small"><summary>الرموز الفنية للصلاحيات</summary><p dir="ltr">{catalogue.data?.scopes.join(' · ')}</p></details>

          <button className="btn" onClick={create} disabled={busy === 'create' || catalogue.status !== 'success'}>
            {busy === 'create' ? 'جارٍ الإصدار…' : 'أصدر المفتاح'}
          </button>
        </ContentPanel>
      )}

      {tenants.status === 'loading' && <Loading rows={2} />}
      {tenants.status === 'error' && <ErrorBox message={tenants.error} onRetry={tenants.reload} />}
      {tenants.status === 'forbidden' && <Forbidden />}
      {catalogue.status === 'error' && <ErrorBox message={catalogue.error} onRetry={catalogue.reload} />}
      {catalogue.status === 'forbidden' && <Forbidden />}
      {tenantId && keys.status === 'loading' && <Loading />}
      {tenantId && keys.status === 'error' && <ErrorBox message={keys.error} onRetry={() => keys.reload()} />}
      {tenantId && keys.status === 'forbidden' && <Forbidden />}
      {tenantId && keys.status === 'success' && rows.length === 0 && (
        <Empty title="لا مفاتيح لهذه المنشأة" detail="أصدر أول مفتاح من البطاقة أعلاه." />
      )}

      {tenantId && rows.length > 0 && (
        <ContentPanel title={`مفاتيح المنشأة (${rows.length})`} description="تحقق من الحالة وآخر استخدام وعدد الطلبات قبل أي تغيير. على الهاتف اسحب الجدول لعرض جميع الأعمدة.">
          <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>الاسم</th>
                <th>البادئة</th>
                <th>النطاقات</th>
                <th>الحالة</th>
                <th>آخر استخدام</th>
                <th>الطلبات</th>
                <th>الإجراء</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.name}</strong>
                    <div className="muted">{row.createdByLabel ?? '—'}</div>
                  </td>
                  <td>
                    <code>{row.prefix}</code>
                  </td>
                  <td>
                    {row.scopes.map((scope) => (
                      <span key={scope} className="chip" title={scope}>
                        {scopeLabel(scope)}
                      </span>
                    ))}
                  </td>
                  <td>
                    {row.status === 'active' ? 'نشط' : 'مُبطَل'}
                    {row.expiresAt && row.status === 'active' && (
                      <div className="muted">ينتهي {row.expiresAt.slice(0, 10)}</div>
                    )}
                    {row.revokedReason && <div className="muted">{row.revokedReason}</div>}
                  </td>
                  <td>{row.lastUsedAt ? row.lastUsedAt.slice(0, 19).replace('T', ' ') : 'لم يُستعمل بعد'}</td>
                  <td>{row.uses}</td>
                  <td>
                    {row.status === 'active' ? (
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
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
          <label className="grid">
            سبب الإبطال/التدوير (٥ محارف على الأقل — يُكتب في التدقيق)
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
        </ContentPanel>
      )}
    </Screen>
  );
}

function apiMessage(error: unknown): string {
  return arabicErrorText(error, 'تعذّر تحديث مفاتيح التكامل. أعد المحاولة بعد التحقق من البيانات.');
}
