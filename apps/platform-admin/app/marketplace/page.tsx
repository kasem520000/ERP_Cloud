'use client';

import { useEffect, useRef, useState } from 'react';
import { ContentPanel, TableViewport, WorkflowGuide } from '@erp/ui/page';
import { arabicErrorText } from '@erp/web-core/error-language';

import { Screen } from '../../components/screen';
import { ApiError, apiData, apiPost, apiPut } from '../../lib/api';
import { useSession } from '../../lib/session';

type CatalogApp = {
  code: string;
  nameAr: string;
  nameEn?: string;
  descriptionAr: string;
  icon?: string;
  category?: string;
  monthlyPrice: string;
  isCore: boolean;
  isActive: boolean;
  screens: string[];
};

type AddonRequestRow = {
  id: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  appCode: string;
  appNameAr: string;
  appIcon: string;
  monthlyPrice: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string;
  decisionNote: string;
  requesterLabel: string;
  createdAt: string;
  decidedAt: string | null;
};

type TenantRow = {
  id: string;
  code: string;
  name: string;
};

/**
 * 📊 قياسُ الاستعمال غير المرخّص كما يرجعه `GET /platform/marketplace/unlicensed-usage`.
 * الشكل مرآةُ `UnlicensedUsageView` في `apps/api/src/modules/marketplace/marketplace.service.ts`
 * — فلو تغيّر عقدُ الخادم ظهر الفرق هنا في أول قراءة (‏`undefined` لا جدولٌ فارغ يوهم أنّ أحداً
 * لا يستعمل السطح).
 */
type UnlicensedUsagePath = { method: string; path: string; writes: number };

type UnlicensedUsageRow = {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: string;
  requiredApps: string[];
  writes: number;
  actors: number;
  firstAt: string | null;
  lastAt: string | null;
  topPaths: UnlicensedUsagePath[];
  licence: { state: 'unlicensed' | 'disabled' | 'licensed'; enabledApps: string[]; installedAt: string | null };
  pendingRequest: { appCode: string; status: string; createdAt: string } | null;
  /** أعدادٌ بلا نافذة (كلُّ ما في جداول المنشأة) — بخلاف `writes` المقيّدة بـ`observedDays`. */
  footprint: {
    loadOrders: number;
    documents: number;
    productionBatches: number;
    stockMovements: number;
    lastActivityAt: string | null;
  };
};

type UnlicensedUsage = {
  observedDays: number;
  generatedAt: string;
  windowStartsAt: string;
  modes: string[];
  summary: {
    measuredTenants: number;
    listedTenants: number;
    stillUnlicensed: number;
    licensedSince: number;
    writes: number;
    listedWrites: number;
    actors: number;
    oldestAt: string | null;
    newestAt: string | null;
  };
  truncated: boolean;
  tenants: UnlicensedUsageRow[];
};

/** نوافذُ القياس المعروضة — والافتراضي ما يطلبه الخادم بلا معامل (‏90 يوماً). */
const USAGE_WINDOWS = [30, 90, 365] as const;

export default function PlatformMarketplacePage() {
  const { canConsole } = useSession();
  const canWrite = canConsole('console.marketplace.manage');
  const [tab, setTab] = useState<'requests' | 'tenant_direct' | 'catalog' | 'usage'>('requests');
  const [apps, setApps] = useState<CatalogApp[]>([]);
  const [requests, setRequests] = useState<AddonRequestRow[]>([]);
  const [tenants, setTenants] = useState<TenantRow[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState('');
  const [decisionNotes, setDecisionNotes] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'ok' | 'danger'>('ok');
  const [readErrors, setReadErrors] = useState<{ requests?: string; tenants?: string }>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [usage, setUsage] = useState<UnlicensedUsage | null>(null);
  const [usageDays, setUsageDays] = useState<number>(90);
  const [usageError, setUsageError] = useState('');
  const usageRequest = useRef(0);

  async function reload() {
    setLoading(true);
    const [appResult, requestResult, tenantResult] = await Promise.allSettled([
      apiData<CatalogApp[]>('/platform/marketplace/apps'),
      apiData<AddonRequestRow[]>('/platform/marketplace/requests'),
      apiData<TenantRow[]>('/platform/tenants?limit=100'),
    ]);
    setReadErrors({
      ...(requestResult.status === 'rejected' ? { requests: messageOf(requestResult.reason) } : {}),
      ...(tenantResult.status === 'rejected' ? { tenants: messageOf(tenantResult.reason) } : {}),
    });
    setRequests(requestResult.status === 'fulfilled' && Array.isArray(requestResult.value) ? requestResult.value : []);
    const tenantList = tenantResult.status === 'fulfilled' && Array.isArray(tenantResult.value) ? tenantResult.value : [];
    setTenants(tenantList);
    setSelectedTenantId((current) => tenantList.some((item) => item.id === current) ? current : '');
    setLoading(false);
    if (appResult.status === 'rejected') {
      setApps([]);
      throw appResult.reason;
    }
    const nextApps = appResult.value ?? [];
    setApps(nextApps);
    setDrafts(Object.fromEntries(nextApps.map((app) => [app.code, app.monthlyPrice])));
  }

  /** القراءة المتأخرة لا تستبدل نافذة أحدث؛ خطأ القياس يظهر منفصلاً عن نتيجة صفر. */
  async function loadUsage(days: number) {
    const request = ++usageRequest.current;
    setUsageError('');
    setUsage(null);
    try {
      const view = await apiData<UnlicensedUsage>(`/platform/marketplace/unlicensed-usage?days=${days}`);
      if (request === usageRequest.current) setUsage(view ?? null);
    } catch (error) {
      if (request === usageRequest.current) setUsageError(messageOf(error));
    }
  }

  useEffect(() => {
    reload().catch((error: unknown) => { setMessageTone('danger'); setMessage(messageOf(error)); });
    // القراءة الأولى مع أول رسمٍ فقط (النافذة الابتدائية 90)؛ وتغييرُ النافذة يقرأ صراحةً
    // في مُعالج الزرّ لا في أثرٍ يتتبّعها، فلا قراءةَ مزدوجة عند كل رسم.
    void loadUsage(usageDays);
  }, []);

  async function decide(req: AddonRequestRow, decision: 'approved' | 'rejected') {
    if (busy || !canWrite || req.status !== 'pending') return;
    const note = decisionNotes[req.id]?.trim() || '';
    if (!window.confirm(`${decision === 'approved' ? 'الموافقة وتفعيل' : 'رفض'} باقة «${req.appNameAr}» لمنشأة «${req.tenantName}»؟ ${note ? `الملاحظة: ${note}.` : 'لا ملاحظة مكتوبة.'} سيُسجَّل القرار وقد يُخطر العميل.`)) return;
    setBusy(req.id);
    setMessage('');
    setMessageTone('ok');
    try {
      await apiPost(`/platform/marketplace/requests/${req.id}/decide`, {
        decision,
        note: decisionNotes[req.id]?.trim() || undefined,
      });
      setMessage(
        decision === 'approved'
          ? `تمت الموافقة وتفعيل باقة «${req.appNameAr}» لمنشأة ${req.tenantName} وإرسال إشعار للعميل.`
          : `تم رفض طلب تفعيل باقة «${req.appNameAr}» لمنشأة ${req.tenantName}.`,
      );
      await reload();
    } catch (error) {
      setMessageTone('danger');
      setMessage(messageOf(error));
    } finally {
      setBusy('');
    }
  }

  async function toggleForTenant(code: string, enabled: boolean, nameAr: string) {
    const tenant = tenants.find((item) => item.id === selectedTenantId);
    if (busy || !canWrite || !tenant || !window.confirm(`${enabled ? 'تفعيل' : 'إيقاف'} باقة «${nameAr}» لمنشأة «${tenant.name}» مباشرة دون طلب سابق؟ راجع المنشأة قبل المتابعة.`)) return;
    setBusy(`${selectedTenantId}:${code}`);
    setMessage('');
    setMessageTone('ok');
    try {
      await apiPut(`/platform/marketplace/tenants/${selectedTenantId}/apps/${code}`, { enabled });
      setMessage(`${enabled ? 'فُعّلت' : 'أُوقفت'} باقة «${nameAr}» للمنشأة المحددة.`);
    } catch (error) {
      setMessageTone('danger');
      setMessage(messageOf(error));
    } finally {
      setBusy('');
    }
  }

  async function save(app: CatalogApp, isActive: boolean) {
    const monthlyText = drafts[app.code] ?? app.monthlyPrice;
    if (busy || !canWrite || !validPrice(monthlyText) ||
      !window.confirm(`${isActive === app.isActive ? 'حفظ السعر' : isActive ? 'إعادة بيع الباقة' : 'إيقاف بيع الباقة'} «${app.nameAr}» بسعر ${monthlyText} ر.س شهرياً؟ قد يؤثر هذا القرار في العروض التالية.`)) return;
    setBusy(app.code);
    setMessage('');
    setMessageTone('ok');
    try {
      await apiPut(`/platform/marketplace/apps/${app.code}`, {
        monthlyPrice: drafts[app.code] ?? app.monthlyPrice,
        isActive,
      });
      setMessage(`حُفظت ${app.nameAr}.`);
      await reload();
    } catch (error) {
      setMessageTone('danger');
      setMessage(messageOf(error));
    } finally {
      setBusy('');
    }
  }

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <Screen
      title="سوق الإضافات وطلبات التفعيل"
      subtitle="راجع طلب المنشأة أو قرّر التفعيل المباشر بعد اختيارها، ثم افصل تحديث السعر عن إتاحة الباقة. قياس الاستعمال للقراءة فقط."
      crumbs={['المنصة', 'سوق الإضافات']}
    >
      <WorkflowGuide title="مسار قرار الإضافات" steps={[
        { title: 'تحقّق من النطاق', detail: 'اختر طلب المنشأة أو حدّد المنشأة صراحةً قبل تفعيل مباشر.' },
        { title: 'راجع الأثر', detail: 'افصل سعر الباقة وإتاحتها عن قياس الاستعمال غير المرخّص.' },
        { title: 'أكّد القرار', detail: 'الموافقة والتفعيل والإيقاف وتغيير السعر إجراءات مؤثرة تتطلب تأكيداً.' },
      ]} />
      {message ? <p role="status" className={`alert ${messageTone}`}>{message}</p> : null}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          type="button"
          className={tab === 'requests' ? 'btn primary' : 'btn'}
          onClick={() => setTab('requests')}
        >
          طلبات التفعيل من المنشآت ({loading ? 'جارٍ القراءة' : readErrors.requests ? 'تعذرت القراءة' : `${pendingCount} بانتظار الموافقة`})
        </button>
        <button
          type="button"
          className={tab === 'tenant_direct' ? 'btn primary' : 'btn'}
          onClick={() => setTab('tenant_direct')}
        >
          تفعيل مباشر لمنشأة
        </button>
        <button
          type="button"
          className={tab === 'catalog' ? 'btn primary' : 'btn'}
          onClick={() => setTab('catalog')}
        >
          الكتالوج والأسعار ({apps.length})
        </button>
        <button
          type="button"
          className={tab === 'usage' ? 'btn primary' : 'btn'}
          onClick={() => {
            setTab('usage');
            if (!usage) void loadUsage(usageDays);
          }}
        >
          الاستعمال بلا ترخيص ({usage?.summary.stillUnlicensed ?? '…'})
        </button>
      </div>

      {tab === 'requests' && (
        <ContentPanel title="طلبات تفعيل الإضافات" description="راجع هوية المنشأة والباقة والملاحظة قبل قبول الطلب أو رفضه.">
          {readErrors.requests && <p className="alert danger" role="alert">تعذّر قراءة الطلبات: {readErrors.requests}. لا تعني القائمة الفارغة غياب الطلبات.</p>}
          {loading ? (
            <p className="muted">جارٍ قراءة الطلبات…</p>
          ) : !readErrors.requests && requests.length === 0 ? (
            <p className="muted">لا توجد طلبات تفعيل باقات حالياً.</p>
          ) : readErrors.requests ? null : (
            <TableViewport label="طلبات تفعيل الإضافات">
              <table style={{ minWidth: 920 }}>
                <thead>
                  <tr>
                    <th>المنشأة</th>
                    <th>الباقة المطلوبة</th>
                    <th>مقدم الطلب</th>
                    <th>ملاحظة العميل</th>
                    <th>الحالة</th>
                    <th>رد/ملاحظة المنصة</th>
                    <th>الإجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((req) => (
                    <tr key={req.id}>
                      <td>
                        <strong>{req.tenantName}</strong>
                        <div className="muted" style={{ fontSize: 12 }} dir="ltr">
                          {req.tenantCode}
                        </div>
                      </td>
                      <td>
                        <strong>
                          {req.appIcon} {req.appNameAr}
                        </strong>
                        <div className="muted" style={{ fontSize: 12 }} dir="ltr">
                          {req.appCode} · {Number(req.monthlyPrice).toFixed(2)} SAR
                        </div>
                      </td>
                      <td>{req.requesterLabel}</td>
                      <td>{req.note || '—'}</td>
                      <td>
                        <span className={`chip${req.status === 'pending' ? ' on' : ''}`}>
                          {req.status === 'pending'
                            ? 'بانتظار الموافقة'
                            : req.status === 'approved'
                              ? 'تمت الموافقة'
                              : 'مرفوض'}
                        </span>
                      </td>
                      <td>
                        <input
                          className="input"
                          placeholder="ملاحظة للعميل (اختياري)…"
                          value={decisionNotes[req.id] ?? req.decisionNote ?? ''}
                          onChange={(event) =>
                            setDecisionNotes((curr) => ({ ...curr, [req.id]: event.target.value }))
                          }
                        />
                      </td>
                      <td>
                        <div className="row" style={{ gap: 6 }}>
                          <button
                            className="btn primary"
                            type="button"
                            disabled={!canWrite || Boolean(busy) || req.status !== 'pending'}
                            onClick={() => void decide(req, 'approved')}
                          >
                            موافقة وتفعيل
                          </button>
                          <button
                            className="btn"
                            type="button"
                            disabled={!canWrite || Boolean(busy) || req.status !== 'pending'}
                            onClick={() => void decide(req, 'rejected')}
                          >
                            رفض
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableViewport>
          )}
        </ContentPanel>
      )}

      {tab === 'tenant_direct' && (
        <ContentPanel title="تفعيل مباشر لمنشأة" description="اختَر المنشأة بنفسك؛ لا يحدد النظام أول منشأة تلقائياً. التفعيل أو الإيقاف هنا لا يحتاج طلباً سابقاً.">
          {readErrors.tenants && <p className="alert danger" role="alert">تعذّر قراءة المنشآت: {readErrors.tenants}</p>}
          {loading && <p className="muted">جارٍ قراءة المنشآت والباقات…</p>}
          <label className="field" style={{ maxWidth: 420 }}>
            <span>اختر المنشأة</span>
            <select
              className="input"
              value={selectedTenantId}
              onChange={(event) => setSelectedTenantId(event.target.value)}
            >
              <option value="">اختر المنشأة قبل أي إجراء</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.code})
                </option>
              ))}
            </select>
          </label>
          {selectedTenantId && <p className="alert warn">النطاق الحالي: {tenants.find((item) => item.id === selectedTenantId)?.name}. تغيّر المنشأة لا يغيّر باقة حتى تؤكّد إجراءها.</p>}
          <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
            {apps
              .filter((app) => !app.isCore)
              .map((app) => (
                <article key={app.code} className="card" style={{ display: 'grid', gap: 8 }}>
                  <strong>
                    {app.icon ?? '📦'} {app.nameAr} <span dir="ltr">({app.code})</span>
                  </strong>
                  <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                    {app.descriptionAr}
                  </p>
                  <div className="row" style={{ gap: 6 }}>
                    <button
                      className="btn primary"
                      type="button"
                      disabled={!canWrite || !selectedTenantId || Boolean(busy)}
                      onClick={() => void toggleForTenant(app.code, true, app.nameAr)}
                    >
                      تفعيل للمنشأة
                    </button>
                    <button
                      className="btn"
                      type="button"
                      disabled={!canWrite || !selectedTenantId || Boolean(busy)}
                      onClick={() => void toggleForTenant(app.code, false, app.nameAr)}
                    >
                      إيقاف
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </ContentPanel>
      )}

      {tab === 'usage' && (
        <ContentPanel title="استعمال بلا ترخيص" description="قياس للقراءة قبل قرار سياسة الترخيص؛ لا يغيّر هذا التبويب الباقات أو الحارس.">
          <p className="muted" style={{ margin: 0 }}>يرصد القياس عمليات الكتابة في الفترة المختارة، لا مجرد فتح الصفحات. حجم العمل في الجداول منفصل عن عدد الكتابات المقاسة.</p>

          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="muted">نافذة القياس:</span>
            {USAGE_WINDOWS.map((days) => (
              <button
                key={days}
                type="button"
                className={usageDays === days ? 'btn primary sm' : 'btn sm'}
                onClick={() => {
                  setUsageDays(days);
                  void loadUsage(days);
                }}
              >
                {days} يوماً
              </button>
            ))}
            <button type="button" className="btn sm" onClick={() => void loadUsage(usageDays)}>
              إعادة القراءة
            </button>
          </div>

          {usageError ? <p className="alert danger">تعذّر قراءة القياس: {usageError}</p> : null}

          {!usage && !usageError ? (
            <p className="muted">جارٍ قراءة القياس…</p>
          ) : null}

          {usage ? (
            <>
              <div className="row" style={{ gap: 16, flexWrap: 'wrap' }}>
                <span>
                  الوضع المقيس:{' '}
                  <strong>{usage.modes.length > 0 ? usage.modes.map((mode) => mode === 'observe' ? 'مراقبة' : mode === 'enforce' ? 'تطبيق' : 'وضع غير معروف').join('، ') : '—'}</strong>
                </span>
                <span>
                  منشآتٌ قِيست: <strong>{usage.summary.measuredTenants}</strong>
                </span>
                <span>
                  منها <strong>بلا باقة الآن</strong>: {usage.summary.stillUnlicensed}
                </span>
                <span>
                  فعّلت بعدها: {usage.summary.licensedSince}
                </span>
                <span>
                  كتاباتٌ مقاسة: <strong>{usage.summary.writes}</strong> من{' '}
                  {usage.summary.actors} مستخدماً
                </span>
                <span>
                  أقدم قياس: {whenText(usage.summary.oldestAt)} · أحدثه: {whenText(usage.summary.newestAt)}
                </span>
              </div>

              {usage.truncated ? (
                <p className="alert warn">
                  القائمة مفصّلةٌ لأحدث {usage.summary.listedTenants} منشأةً مقاسة، والملخّص أعلاه
                  يعدّ الكلّ ({usage.summary.measuredTenants}) — فاقرأ «كتاباتٌ مقاسة» من الملخّص لا من
                  مجموع الصفوف.
                </p>
              ) : null}

              {usage.tenants.length === 0 ? (
                <p className="muted">
                  لا استعمالَ غير مرخّص في هذه النافذة — إمّا أنّ كلّ المنشآت المستعملة مرخّصة، أو أنّ
                  أحداً لم يكتب على السطح منذ {usage.observedDays} يوماً.
                </p>
              ) : (
                <TableViewport label="جدول استعمال الإضافات بلا ترخيص">
                  <table style={{ minWidth: 960 }}>
                    <thead>
                      <tr>
                        <th>المنشأة</th>
                        <th>الترخيص الآن</th>
                        <th>كتاباتٌ مقاسة</th>
                        <th>مستخدمون</th>
                        <th>أول / آخر قياس</th>
                        <th>حجم العمل الحقيقي (كلّ الوقت)</th>
                        <th>المسارات</th>
                        <th>طلب تفعيل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {usage.tenants.map((row) => (
                        <tr key={`${row.tenantId}:${row.requiredApps.join('|')}`}>
                          <td>
                            <strong>{row.tenantName}</strong>
                            <div className="muted" style={{ fontSize: 12 }} dir="ltr">
                              {row.tenantCode} · {tenantStatusLabel(row.tenantStatus)}
                            </div>
                            <div className="muted" style={{ fontSize: 12 }} dir="ltr">
                              {row.requiredApps.map((code) => appLabel(code, apps)).join('، ')}
                            </div>
                          </td>
                          <td>{licenceLabel(row.licence.state, row.licence.enabledApps.map((code) => appLabel(code, apps)))}</td>
                          <td>
                            <strong>{row.writes}</strong>
                          </td>
                          <td>{row.actors}</td>
                          <td style={{ fontSize: 12 }}>
                            {whenText(row.firstAt)}
                            <div className="muted">{whenText(row.lastAt)}</div>
                          </td>
                          <td style={{ fontSize: 12 }}>
                            أوامر تحميل {row.footprint.loadOrders} · مستندات {row.footprint.documents} ·
                            دفعات إنتاج {row.footprint.productionBatches}
                            <div className="muted">
                              حركات سيارة {row.footprint.stockMovements} · آخر نشاط{' '}
                              {whenText(row.footprint.lastActivityAt)}
                            </div>
                          </td>
                          <td style={{ fontSize: 12 }}>
                            <details>
                              <summary>{row.topPaths.length} مسارات مقاسة</summary>
                              <div dir="ltr">{row.topPaths.map((pathRow) => (
                                <div key={`${pathRow.method} ${pathRow.path}`}>
                                  {pathRow.method} {pathRow.path.replace('/api/v1', '')} ×{pathRow.writes}
                                </div>
                              ))}</div>
                            </details>
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {row.pendingRequest ? (
                              <>
                                <span>{appLabel(row.pendingRequest.appCode, apps)}</span>
                                <div className="muted">
                                  {row.pendingRequest.status === 'pending'
                                    ? `معلّق منذ ${whenText(row.pendingRequest.createdAt)}`
                                    : `${row.pendingRequest.status === 'approved' ? 'مقبول' : row.pendingRequest.status === 'rejected' ? 'مرفوض' : 'قرار آخر'} · ${whenText(row.pendingRequest.createdAt)}`}
                                </div>
                              </>
                            ) : (
                              <span className="muted">لم تطلب</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </TableViewport>
              )}

              <p className="muted small" style={{ margin: 0 }}>هذه الشاشة تقيس ولا تغيّر سياسة الترخيص؛ إذا احتجت قراراً لمنشأة محددة فارجع إلى «تفعيل مباشر لمنشأة».</p>
            </>
          ) : null}
        </ContentPanel>
      )}

      {tab === 'catalog' && (
        <div className="grid" style={{ gap: 12 }}>
          <ContentPanel title="الكتالوج والأسعار" description="حفظ السعر لا يغيّر إتاحة الباقة، وإيقاف البيع قرار منفصل. راجع السعر الشهري قبل التأكيد.">
            {apps.length === 0 && <p className="muted">{loading ? 'جارٍ قراءة الباقات…' : 'لا باقات متاحة للعرض حالياً؛ تحقق من تنبيه القراءة أعلاه إن ظهر.'}</p>}
          </ContentPanel>
          {apps.map((app) => (
            <article key={app.code} className="card" style={{ display: 'grid', gap: 8 }}>
              <strong>
                {app.icon ?? '📦'} {app.nameAr} <span dir="ltr">({app.code})</span>
              </strong>
              <p className="muted" style={{ margin: 0 }}>
                {app.descriptionAr}
                {app.isCore ? ' · مشحونة مع النظام' : ''}
              </p>
              <label className="field">
                <span>السعر الشهري (SAR)</span>
                <input
                  className="input"
                  dir="ltr"
                  value={drafts[app.code] ?? app.monthlyPrice}
                  inputMode="decimal"
                  disabled={!canWrite}
                  onChange={(event) => setDrafts({ ...drafts, [app.code]: event.target.value })}
                />
              </label>
              {!validPrice(drafts[app.code] ?? app.monthlyPrice) && <p className="alert danger">أدخل سعراً شهرياً صالحاً قبل الحفظ (حتى ٤ منازل عشرية).</p>}
              <span>
                <button
                  className="btn primary"
                  type="button"
                  disabled={!canWrite || Boolean(busy) || !validPrice(drafts[app.code] ?? app.monthlyPrice) || (drafts[app.code] ?? app.monthlyPrice) === app.monthlyPrice}
                  onClick={() => void save(app, app.isActive)}
                >
                  حفظ السعر
                </button>{' '}
                <button
                  className="btn"
                  type="button"
                  disabled={!canWrite || Boolean(busy) || !validPrice(drafts[app.code] ?? app.monthlyPrice)}
                  onClick={() => void save(app, !app.isActive)}
                >
                  {app.isActive ? 'إيقاف البيع' : 'إعادة البيع'}
                </button>
              </span>
            </article>
          ))}
        </div>
      )}
    </Screen>
  );
}

/** تاريخٌ مقروءٌ بلا ادّعاء منطقةٍ زمنية: `ar-SA` كما في بقية لوحة المنصّة. */
function whenText(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('ar-SA');
}

/**
 * حالةُ الترخيص **الآن** لا لحظة القياس — فالفرق تجاري: «فعّلت بعدها» تعني أنّ الصفّ تاريخٌ
 * محض، و«باقةٌ مُطفأة» تعني أنّ قراراً اتُّخذ ثمّ أُوقف، و«لم تطلب» تعني أنّ أحداً لم يطرق الباب.
 */
function appLabel(code: string, apps: CatalogApp[]): string {
  return apps.find((app) => app.code === code)?.nameAr ?? 'باقة غير معرفة في الكتالوج';
}

function tenantStatusLabel(status: string): string {
  return status === 'active' ? 'نشطة' : status === 'suspended' ? 'موقوفة' : status === 'archived' ? 'مؤرشفة' : 'حالة غير معروفة';
}

function licenceLabel(state: UnlicensedUsageRow['licence']['state'], enabledApps: string[]): string {
  if (state === 'licensed') return `✅ مُرخّصة الآن (${enabledApps.join(', ')}) — القياس تاريخ`;
  if (state === 'disabled') return '⏸️ باقةٌ مثبّتة لكنها مُطفأة';
  return '⛔ بلا باقة مفعّلة';
}

function validPrice(value: string): boolean {
  return /^\d{1,8}(\.\d{1,4})?$/.test(value.trim());
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return arabicErrorText(error);
}
