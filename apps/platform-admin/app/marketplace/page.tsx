'use client';

import { useEffect, useState } from 'react';

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
  const [busy, setBusy] = useState('');
  const [usage, setUsage] = useState<UnlicensedUsage | null>(null);
  const [usageDays, setUsageDays] = useState<number>(90);
  const [usageError, setUsageError] = useState('');

  async function reload() {
    const [nextApps, nextReqs, nextTenants] = await Promise.all([
      apiData<CatalogApp[]>('/platform/marketplace/apps'),
      apiData<AddonRequestRow[]>('/platform/marketplace/requests').catch(() => []),
      apiData<TenantRow[]>('/platform/tenants?limit=100').catch(() => []),
    ]);
    setApps(nextApps ?? []);
    setRequests(Array.isArray(nextReqs) ? nextReqs : []);
    const tenantList = Array.isArray(nextTenants) ? nextTenants : [];
    setTenants(tenantList);
    if (!selectedTenantId && tenantList[0]?.id) {
      setSelectedTenantId(tenantList[0].id);
    }
    setDrafts(Object.fromEntries((nextApps ?? []).map((app) => [app.code, app.monthlyPrice])));
  }

  /**
   * قراءةُ القياس. الخطأ **لا يُبتلع** (‏`.catch(() => [])` كما في الجدولين أعلاه): قياسٌ فشل
   * وقائمةٌ فارغة تُظهران الشيء نفسه لصاحب القرار — «لا أحد يستعمل السطح» — والفرقُ بينهما
   * قرارٌ تجاريّ يُتّخذ على وهم.
   */
  async function loadUsage(days: number) {
    setUsageError('');
    try {
      const view = await apiData<UnlicensedUsage>(`/platform/marketplace/unlicensed-usage?days=${days}`);
      setUsage(view ?? null);
    } catch (error) {
      setUsage(null);
      setUsageError(messageOf(error));
    }
  }

  useEffect(() => {
    reload().catch((error: unknown) => setMessage(messageOf(error)));
    // القراءة الأولى مع أول رسمٍ فقط (النافذة الابتدائية 90)؛ وتغييرُ النافذة يقرأ صراحةً
    // في مُعالج الزرّ لا في أثرٍ يتتبّعها، فلا قراءةَ مزدوجة عند كل رسم.
    void loadUsage(usageDays);
  }, []);

  async function decide(req: AddonRequestRow, decision: 'approved' | 'rejected') {
    setBusy(req.id);
    setMessage('');
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
      setMessage(messageOf(error));
    } finally {
      setBusy('');
    }
  }

  async function toggleForTenant(code: string, enabled: boolean, nameAr: string) {
    if (!selectedTenantId) return;
    setBusy(`${selectedTenantId}:${code}`);
    setMessage('');
    try {
      await apiPut(`/platform/marketplace/tenants/${selectedTenantId}/apps/${code}`, { enabled });
      setMessage(`${enabled ? 'فُعّلت' : 'أُوقفت'} باقة «${nameAr}» للمنشأة المحددة.`);
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setBusy('');
    }
  }

  async function save(app: CatalogApp, isActive: boolean) {
    setBusy(app.code);
    setMessage('');
    try {
      await apiPut(`/platform/marketplace/apps/${app.code}`, {
        monthlyPrice: drafts[app.code] ?? app.monthlyPrice,
        isActive,
      });
      setMessage(`حُفظت ${app.nameAr}.`);
      await reload();
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setBusy('');
    }
  }

  const pendingCount = requests.filter((r) => r.status === 'pending').length;

  return (
    <Screen
      title="سوق الإضافات وطلبات التفعيل"
      subtitle="مراجعة واعتماد طلبات تفعيل الباقات القطاعية للمنشآت، أو تفعيل/إيقاف أي باقة مباشرة لمنشأة، وتسعير الكتالوج."
      crumbs={['المنصة', 'سوق الإضافات']}
    >
      {message ? <p className="alert ok">{message}</p> : null}

      <div className="row" style={{ gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
        <button
          type="button"
          className={tab === 'requests' ? 'btn primary' : 'btn'}
          onClick={() => setTab('requests')}
        >
          📩 طلبات التفعيل من المنشآت ({pendingCount} بانتظار الموافقة)
        </button>
        <button
          type="button"
          className={tab === 'tenant_direct' ? 'btn primary' : 'btn'}
          onClick={() => setTab('tenant_direct')}
        >
          🏢 تفعيل/إيقاف مباشر لمنشأة
        </button>
        <button
          type="button"
          className={tab === 'catalog' ? 'btn primary' : 'btn'}
          onClick={() => setTab('catalog')}
        >
          💰 كتالوج وأسعار الباقات ({apps.length})
        </button>
        <button
          type="button"
          className={tab === 'usage' ? 'btn primary' : 'btn'}
          onClick={() => {
            setTab('usage');
            if (!usage) void loadUsage(usageDays);
          }}
        >
          📊 الاستعمال بلا ترخيص ({usage?.summary.stillUnlicensed ?? '…'})
        </button>
      </div>

      {tab === 'requests' && (
        <section className="card">
          <h2 style={{ marginTop: 0 }}>طلبات تفعيل الإضافات والباقات القطاعية</h2>
          {requests.length === 0 ? (
            <p className="muted">لا توجد طلبات تفعيل باقات حالياً.</p>
          ) : (
            <div className="table-wrap">
              <table>
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
                            disabled={!canWrite || busy === req.id}
                            onClick={() => void decide(req, 'approved')}
                          >
                            موافقة وتفعيل
                          </button>
                          <button
                            className="btn"
                            type="button"
                            disabled={!canWrite || busy === req.id}
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
            </div>
          )}
        </section>
      )}

      {tab === 'tenant_direct' && (
        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ marginTop: 0 }}>تفعيل أو إيقاف باقة مباشرة لأي منشأة</h2>
          <label className="field" style={{ maxWidth: 420 }}>
            <span>اختر المنشأة</span>
            <select
              className="input"
              value={selectedTenantId}
              onChange={(event) => setSelectedTenantId(event.target.value)}
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.code})
                </option>
              ))}
            </select>
          </label>
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
                      disabled={!canWrite || !selectedTenantId || busy === `${selectedTenantId}:${app.code}`}
                      onClick={() => void toggleForTenant(app.code, true, app.nameAr)}
                    >
                      تفعيل للمنشأة
                    </button>
                    <button
                      className="btn"
                      type="button"
                      disabled={!canWrite || !selectedTenantId || busy === `${selectedTenantId}:${app.code}`}
                      onClick={() => void toggleForTenant(app.code, false, app.nameAr)}
                    >
                      إيقاف
                    </button>
                  </div>
                </article>
              ))}
          </div>
        </section>
      )}

      {tab === 'usage' && (
        <section className="card" style={{ display: 'grid', gap: 12 }}>
          <h2 style={{ marginTop: 0 }}>📊 مَنْ يستعمل سطحاً قطاعياً بلا باقة — القياس قبل قرار الفرض</h2>
          <p className="muted" style={{ margin: 0 }}>
            المصدر <code dir="ltr">audit_log</code>: حارسُ الترخيص يكتب سطراً لكلّ <strong>كتابةٍ</strong> من
            منشأةٍ بلا باقة (ولا يكتب للقراءات، فلوحةٌ تُستطلع كل ثلاثين ثانية ليست استعمالاً جديداً).
            والجدول يجمع لكلّ منشأة: كم مرّةً كتبت، ومَن كتب، ومتى، وأيَّ مساراتٍ بلغت — ثمّ يسأل
            المنشأة في سياقها عن حجم العمل الحقيقي في جداول التوزيع، لأنّ «كم عملاً سيقف لو فُرض
            الترخيص غداً» هو الرقم التجاري، لا عدد الطلبات.
          </p>

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
              🔄 إعادة القراءة
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
                  <strong dir="ltr">{usage.modes.length > 0 ? usage.modes.join(', ') : '—'}</strong>
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
                <div className="table-wrap">
                  <table>
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
                              {row.tenantCode} · {row.tenantStatus}
                            </div>
                            <div className="muted" style={{ fontSize: 12 }} dir="ltr">
                              {row.requiredApps.join(' | ')}
                            </div>
                          </td>
                          <td>{licenceLabel(row.licence.state, row.licence.enabledApps)}</td>
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
                          <td style={{ fontSize: 12 }} dir="ltr">
                            {row.topPaths.map((pathRow) => (
                              <div key={`${pathRow.method} ${pathRow.path}`}>
                                {pathRow.method} {pathRow.path.replace('/api/v1', '')} ×{pathRow.writes}
                              </div>
                            ))}
                          </td>
                          <td style={{ fontSize: 12 }}>
                            {row.pendingRequest ? (
                              <>
                                <span dir="ltr">{row.pendingRequest.appCode}</span>
                                <div className="muted">
                                  {row.pendingRequest.status === 'pending'
                                    ? `معلّق منذ ${whenText(row.pendingRequest.createdAt)}`
                                    : `${row.pendingRequest.status} · ${whenText(row.pendingRequest.createdAt)}`}
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
                </div>
              )}

              <p className="muted small" style={{ margin: 0 }}>
                هذه الشاشة <strong>قياسٌ لا قرار</strong>: لا تُغيّر وضع الحارس. القلبُ من{' '}
                <code dir="ltr">observe</code> إلى <code dir="ltr">enforce</code> تعديلٌ في
                الزخرفة <code dir="ltr">@RequiresSectorApp</code> على وحدة <code dir="ltr">van-sales</code>{' '}
                في الـ API، وهو قرارُ مالكٍ يحتاج تحصينَ المنشآت القائمة (أو لا يحتاج) — وأمّا الترخيص
                لمنشأةٍ بعينها فزرُّه في تبويب «تفعيل/إيقاف مباشر لمنشأة» أعلاه.
              </p>
            </>
          ) : null}
        </section>
      )}

      {tab === 'catalog' && (
        <div className="grid" style={{ gap: 12 }}>
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
                  disabled={!canWrite}
                  onChange={(event) => setDrafts({ ...drafts, [app.code]: event.target.value })}
                />
              </label>
              <span>
                <button
                  className="btn primary"
                  type="button"
                  disabled={!canWrite || busy === app.code}
                  onClick={() => void save(app, app.isActive)}
                >
                  حفظ السعر
                </button>{' '}
                <button
                  className="btn"
                  type="button"
                  disabled={!canWrite || busy === app.code}
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
function licenceLabel(state: UnlicensedUsageRow['licence']['state'], enabledApps: string[]): string {
  if (state === 'licensed') return `✅ مُرخّصة الآن (${enabledApps.join(', ')}) — القياس تاريخ`;
  if (state === 'disabled') return '⏸️ باقةٌ مثبّتة لكنها مُطفأة';
  return '⛔ بلا باقة مفعّلة';
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'تعذر إكمال الطلب';
}
