'use client';

import { useEffect, useState } from 'react';
import { WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { Loading, Screen } from '../../components/screen';
import { apiData, apiPost, apiPut } from '../../lib/api';
import { useSession } from '../../lib/session';

type PlatformAi = {
  provider: string;
  model: string;
  baseUrl: string;
  enabled: boolean;
  defaultMonthlyTokenLimit: number;
  costPerMillionIn: string;
  costPerMillionOut: string;
  hasApiKey: boolean;
};

export default function PlatformAiPage() {
  const { canConsole } = useSession();
  const canWrite = canConsole('console.settings.manage');
  const [settings, setSettings] = useState<PlatformAi>();
  const [provider, setProvider] = useState('local');
  const [model, setModel] = useState('local-grounded');
  const [baseUrl, setBaseUrl] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [tokenLimit, setTokenLimit] = useState('200000');
  const [apiKey, setApiKey] = useState('');
  const [clearKey, setClearKey] = useState(false);
  const [perIn, setPerIn] = useState('0');
  const [perOut, setPerOut] = useState('0');
  const [tenantId, setTenantId] = useState('');
  const [suspended, setSuspended] = useState(true);
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function reload() {
    const next = await apiData<PlatformAi>('/platform/ai/settings');
    setSettings(next);
    setProvider(next.provider);
    setModel(next.model);
    setBaseUrl(next.baseUrl);
    setEnabled(next.enabled);
    setTokenLimit(String(next.defaultMonthlyTokenLimit));
    setPerIn(next.costPerMillionIn);
    setPerOut(next.costPerMillionOut);
    setLoading(false);
  }

  useEffect(() => {
    void reload().catch((error: unknown) => { setLoading(false); setMessage({ kind: 'danger', text: arabicErrorText(error, 'تعذّر تحميل إعدادات المساعد. أعد فتح الصفحة أو حاول لاحقاً.') }); });
  }, []);

  return (
    <Screen
      title="المساعد المحاسبي"
      subtitle="اضبط مزود الخدمة وحدود الاستخدام، ثم أدر إتاحة المساعد لكل منشأة على حدة."
      crumbs={['المنصة', 'المساعد']}
    >
      <WorkflowGuide
        title="إدارة خدمة المساعد بأمان"
        steps={[
          { title: 'راجع إعدادات الخدمة', detail: 'تحقق من المزود والنموذج وحد الاستخدام قبل أي حفظ.' },
          { title: 'حدّد تكلفة الاستخدام', detail: 'تعرض الأسعار تكلفة الإدخال والإخراج لكل مليون وحدة.' },
          { title: 'اضبط وصول المنشأة', detail: 'إيقاف منشأة بعينها إجراء مستقل عن التفعيل العام.' },
        ]}
      />
      {loading && <Loading />}
      {!loading && !settings && (
        <button className="btn" type="button" onClick={() => {
          setLoading(true);
          setMessage(undefined);
          void reload().catch((error: unknown) => { setLoading(false); setMessage({ kind: 'danger', text: arabicErrorText(error, 'تعذّر تحميل إعدادات المساعد.') }); });
        }}>إعادة المحاولة</button>
      )}
      {message ? <p className={`alert ${message.kind}`} role={message.kind === 'danger' ? 'alert' : 'status'}>{message.text}</p> : null}
      <form
        className="erp-panel"
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setMessage(undefined);
          void apiPut('/platform/ai/settings', {
            provider,
            model,
            baseUrl,
            enabled,
            defaultMonthlyTokenLimit: Number(tokenLimit),
            apiKey: apiKey || undefined,
            clearApiKey: clearKey,
            costPerMillionIn: perIn,
            costPerMillionOut: perOut,
          })
            .then(() => {
              setApiKey('');
              setClearKey(false);
              return reload();
            })
            .then(() => setMessage({ kind: 'ok', text: 'حُفظ إعداد المساعد. المفتاح يبقى مشفراً.' }))
            .catch((error: unknown) => setMessage({ kind: 'danger', text: arabicErrorText(error, 'تعذّر حفظ إعدادات المساعد.') }))
            .finally(() => setBusy(false));
        }}
      >
        <div className="erp-panel-header">
          <div className="erp-panel-heading">
            <h2>إعداد الخدمة وحدودها</h2>
            <p>تُطبَّق هذه الخيارات على المنصة. لا يُعرض المفتاح السري بعد حفظه.</p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>المزود</span>
            <select className="input" value={provider} disabled={!canWrite || !settings || busy} onChange={(event) => setProvider(event.target.value)}>
              <option value="local">محلي</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          <label className="field">
            <span>النموذج</span>
            <input className="input" dir="ltr" value={model} disabled={!canWrite || !settings || busy} onChange={(event) => setModel(event.target.value)} />
          </label>
          <label className="field">
            <span>عنوان خدمة النموذج</span>
            <input className="input" dir="ltr" value={baseUrl} disabled={!canWrite || !settings || busy} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.openai.com" />
          </label>
          <label className="field">
            <span>حد الاستخدام الشهري الافتراضي</span>
            <input className="input" dir="ltr" value={tokenLimit} disabled={!canWrite || !settings || busy} onChange={(event) => setTokenLimit(event.target.value)} />
          </label>
          <label className="field">
            <span>مفتاح الربط السري</span>
            <input className="input" dir="ltr" type="password" value={apiKey} disabled={!canWrite || !settings || busy} onChange={(event) => setApiKey(event.target.value)} placeholder={settings?.hasApiKey ? 'محفوظ — اكتب لاستبداله' : 'غير محفوظ'} />
          </label>
          <label className="field">
            <span>التفعيل العام</span>
            <select className="input" value={enabled ? 'on' : 'off'} disabled={!canWrite || !settings || busy} onChange={(event) => setEnabled(event.target.value === 'on')}>
              <option value="on">مفعّل</option>
              <option value="off">متوقف لكل المنشآت</option>
            </select>
          </label>
        </div>
        <div className="form-grid" style={{ marginTop: 12 }}>
          <label className="field">
            <span>تكلفة مليون وحدة إدخال</span>
            <input className="input" dir="ltr" inputMode="decimal" value={perIn} disabled={!canWrite || !settings || busy} onChange={(event) => setPerIn(event.target.value)} />
          </label>
          <label className="field">
            <span>تكلفة مليون وحدة إخراج</span>
            <input className="input" dir="ltr" inputMode="decimal" value={perOut} disabled={!canWrite || !settings || busy} onChange={(event) => setPerOut(event.target.value)} />
          </label>
        </div>
        <label className="field" style={{ marginTop: 12 }}>
          <span>
            <input type="checkbox" checked={clearKey} disabled={!canWrite || !settings || busy} onChange={(event) => setClearKey(event.target.checked)} /> حذف المفتاح المحفوظ
          </span>
        </label>
        <button className="btn primary" type="submit" disabled={!canWrite || busy || !settings}>
          {busy ? 'جارٍ الحفظ…' : 'حفظ'}
        </button>
      </form>

      <form
        className="erp-panel"
        method="post"
        onSubmit={(event) => {
          event.preventDefault();
          setBusy(true);
          setMessage(undefined);
          void apiPost(`/platform/ai/tenants/${tenantId}/suspension`, { suspended })
            .then(() => setMessage({ kind: 'ok', text: suspended ? 'تم إيقاف المساعد لهذه المنشأة.' : 'تم إعادة تفعيل المساعد.' }))
            .catch((error: unknown) => setMessage({ kind: 'danger', text: arabicErrorText(error, 'تعذّر تحديث إتاحة المساعد لهذه المنشأة.') }))
            .finally(() => setBusy(false));
        }}
      >
        <div className="erp-panel-header">
          <div className="erp-panel-heading">
            <h2>إتاحة المساعد لمنشأة محددة</h2>
            <p>هذا القرار يخص منشأة واحدة ولا يغير التفعيل العام أو إعداد مزود الخدمة.</p>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>معرّف المنشأة</span>
            <input className="input" dir="ltr" value={tenantId} disabled={!canWrite || !settings || busy} onChange={(event) => setTenantId(event.target.value)} />
          </label>
          <label className="field">
            <span>الحالة</span>
            <select className="input" value={suspended ? 'off' : 'on'} disabled={!canWrite || !settings || busy} onChange={(event) => setSuspended(event.target.value === 'off')}>
              <option value="off">إيقاف</option>
              <option value="on">تفعيل</option>
            </select>
          </label>
        </div>
        <button className="btn" type="submit" disabled={!canWrite || !settings || busy || !tenantId}>
          تطبيق
        </button>
      </form>
    </Screen>
  );
}
