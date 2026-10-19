'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input } from '@erp/ui';
import { apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { numberText } from '../../lib/lookups';
import {
  buildLinkPayload,
  custodyHeadline,
  emptyLinkDraft,
  hasOpenCustody,
  isReadyToWork,
  LINK_ACCOUNT_PERMISSION,
  linkOutcome,
  linkVerdict,
  membershipStatusLabel,
  ratePercentText,
  readinessNotes,
  REPS_MESSAGES,
  REPS_VIEW_PERMISSION,
  repsSummary,
  salesmanLabel,
  type LinkAccountDraft,
  type LinkAccountReceipt,
  type NoteTone,
  type SalesmanCard,
} from '../../lib/reps-screen';

type Notice = { kind: 'ok' | 'danger' | 'warn'; text: string };

const NOTICE_CLASSES: Record<Notice['kind'], string> = {
  ok: 'border-ok-line bg-ok-soft text-ok-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
  warn: 'border-warn-line bg-warn-soft text-warn-ink',
};

const TONE_CLASSES: Record<NoteTone, string> = {
  ok: 'border-ok-line bg-ok-soft text-ok-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
  warn: 'border-warn-line bg-warn-soft text-warn-ink',
};

const selectClass = 'ui-select';

type FilterKey = 'all' | 'incomplete' | 'ready' | 'custody';

const FILTERS: Array<{ key: FilterKey; labelAr: string }> = [
  { key: 'all', labelAr: 'الكلّ' },
  { key: 'incomplete', labelAr: 'ناقصٌ قبل العمل' },
  { key: 'ready', labelAr: 'جاهزٌ للعمل' },
  { key: 'custody', labelAr: 'عليه عهدةٌ مفتوحة' },
];

/**
 * ‍ شاشة «المناديب» — البطاقة الرسمية، بطاقةُ الموظف، حسابُ الدخول، ومستودعُ السيارة.
 *
 * السلسلةُ التي تُقاس هنا: **مندوبٌ بلا موظفٍ وبلا حسابِ دخولٍ وبلا مستودع سيارة لا يعمل**،
 * وكلُّ حلقةٍ ناقصة تُعطّل شيئًا مُسمًّى: فبلا بطاقة موظف يرفض الخادم تحميلَ النقص على
 * مديونيته (٤٢٢)، وبلا عضوية لا مساحةَ عمل له (`GET /van-sales/me` تُشتقّ من عضويّته هو)،
 * وبلا مستودع سيارة لا عهدةَ تُقاس ولا نطاقَ يحصر دخولَه، وبلا `van_sales.*` يرفضه الحارس
 * ٤٠٣. ولهذا تعرض الشاشة `readiness` **كما حسبه الخادم** مع أثر كلّ نقص، لا أيقونةَ صحٍّ
 * أو خطأ.
 *
 * والقراءة هنا **كاملةٌ لا نافذة**: `listSalesmenWithCustody` تُرجع كلّ بطاقات المنشأة
 * (بلا LIMIT) ومعها العهدُ الحيّة من `stock_balances` مستودع السيارة وأوامرُ التحميل
 * المفتوحة — فمجاميعُ هذه الشاشة مجاميعُ الكلّ، بعكس `/sales` و`/collection` اللتين تقرآن
 * نافذةَ اللوحة وتقولان ذلك.
 *
 * والكتابة الوحيدة هنا هي `POST /van-sales/salesmen/:id/account`: تمرّ بكتّاب المنصّة
 * أنفسهم (العضويات والأدوار) فلا تُخترع كلمةُ مرور ولا حسابٌ ثانٍ للشخص الواحد ولا دورٌ
 * موازٍ، والشاشة تقرأ **إيصال الخادم** وتقول حقوله: البريدُ الفعليّ مقابل المطلوب، وإعادةُ
 * الاستعمال، والتفعيلُ المطلوب، والنطاقُ على مستودع السيارة، وربطُ بطاقة الموظف.
 *
 * وما **ليس** هنا: إنشاءُ البطاقة أو تعديلُها أو حذفُها ونِسبُ العمولة وربطُ الموظف يدويًّا
 * (تبقى على `POST/PATCH /sales/salesmen` في `apps/staff` عند `STAFF_SALESMEN_PATH`)،
 * ونطاقُ الفروع على العضوية (يطبّقه الخادم عند الإنشاء فقط ويتجاهله
 * عند إعادة الاستعمال)، والأدوارُ والأجهزة وكلمات المرور (منصّة الهويّة وشاشة الأدوار)،
 * وحسابُ مبالغ العمولة (الرواتب في staff)، وواجهةُ المندوب المحمولة نفسها (المرحلة ٤).
 */
export default function RepsPage() {
  const { can } = useSession();
  const canView = can(REPS_VIEW_PERMISSION);
  const canLink = can(LINK_ACCOUNT_PERMISSION);

  const [reps, setReps] = useState<SalesmanCard[]>([]);
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [expandedId, setExpandedId] = useState<string | undefined>();

  const [draft, setDraft] = useState<LinkAccountDraft>(emptyLinkDraft);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | undefined>();
  const [receipt, setReceipt] = useState<LinkAccountReceipt | null>(null);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const rows = await apiList<SalesmanCard>('/van-sales/salesmen');
      setReps(rows);
    } catch (caught) {
      setLoadError(apiErrorText(caught, 'تعذّر تحميل بطاقات المندوبين'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    void load();
  }, [canView, load]);

  const summary = useMemo(() => repsSummary(reps), [reps]);
  const picked = reps.find((row) => row.id === draft.salesmanId) ?? null;
  const verdict = useMemo(() => linkVerdict(draft, picked, { canLink }), [draft, picked, canLink]);
  const outcome = useMemo(() => linkOutcome(receipt), [receipt]);
  const visible = useMemo(() => {
    if (filter === 'ready') return reps.filter((row) => isReadyToWork(row));
    if (filter === 'incomplete') return reps.filter((row) => !isReadyToWork(row));
    if (filter === 'custody') return reps.filter((row) => hasOpenCustody(row));
    return reps;
  }, [reps, filter]);

  function pickRep(row: SalesmanCard) {
    // لا يُملأ البريد من بطاقة المندوب: فبريدُ البطاقة للتواصل، وبريدُ الحساب القائم يُقرأ من
    // الخادم (`userEmail`) — وملءُ الحقل بعنوانٍ شخصيّ يُنشئ حسابًا حيث لا يريده أحد.
    setDraft((current) => ({ ...current, salesmanId: row.id, email: row.userEmail ?? current.email }));
    setReceipt(null);
  }

  async function submitLink() {
    if (verdict.blocked.length > 0) {
      setNotice({ kind: 'danger', text: verdict.blocked[0] ?? 'تعذّر ربط حساب الدخول' });
      return;
    }
    if (!draft.salesmanId) return;
    setBusy(true);
    setNotice(undefined);
    const payload = buildLinkPayload(draft);
    try {
      /**
       * هذا المسار **لا يقبل مفتاح عدم تكرار** (لا `idempotencyKey` في جسمه ولا في خدمته)، فلا
       * يُرسل إليه مفتاحٌ مخترع. والأمان من التكرار جهتان: الزرُّ معطَّلٌ أثناء الطلب، والخادم
       * نفسه يُعيد استعمال عضوية بطاقة الموظف إن وُجدت — فإعادةُ إرسالٍ متسلسلة تُطبّق الدور
       * والنطاق على الحساب نفسه ولا تُنشئ حسابًا ثانيًا.
       */
      const result = await apiPost<LinkAccountReceipt>(
        `/van-sales/salesmen/${draft.salesmanId}/account`,
        payload,
      );
      setReceipt(result);
      const state = linkOutcome(result);
      setNotice({
        kind: state?.tone === 'ok' ? 'ok' : 'warn',
        text: state
          ? `${state.headline} — ${state.notes[0] ?? ''}`
          : 'رجع الخادم بإيصالٍ بلا حقولٍ مقروءة: حدِّث القائمة واقرأ حالة الحساب فعلًا.',
      });
      setDraft(emptyLinkDraft());
      await load();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذّر ربط حساب الدخول') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">المناديب</h1>
          <p className="ui-page-sub">
            بطاقةُ المندوب الرسمية بما ينقصها قبل أن يعمل: موظفٌ وحسابُ دخولٍ نشط ومستودعُ سيارة وصلاحياتُ
            الخطّ. والكتابةُ الوحيدة هنا ربطُ حساب الدخول عبر كتّاب المنصّة — أمّا البطاقة نفسها فتُنشأ
            وتُعدَّل في <span dir="ltr">apps/staff</span> على .
          </p>
        </div>
        <div className="ui-page-actions">
          <Button disabled={loading || !canView} onClick={() => void load()} size="sm">
            تحديث
          </Button>
        </div>
      </header>
      <div className="ui-screen-body">
        {!canView ? (
          <Card>
            <CardBody>
              <p
                className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}
              >
                لا تملك صلاحيةَ هذا القسم — والخادم يرفض قراءة البطاقات (
                <span dir="ltr">{REPS_MESSAGES.viewForbidden}</span>). ولم يُرسل هذا التطبيق طلبًا سيُرفض
                حتمًا، ولا عرض بطاقاتٍ من المتصفّح بدلها.
              </p>
            </CardBody>
          </Card>
        ) : null}

        {loadError ? (
          <Card>
            <CardBody>
              <p
                className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.danger}`}
                role="alert"
              >
                تعذّر تحميل بطاقات المندوبين: {loadError}
              </p>
              <p className="m-0 mt-2 text-[12.5px] text-muted">
                تحقّق من اتصالك بالشبكة ومن صلاحيتك على المناديب، ثمّ أعد المحاولة — لا تُعرض هنا بطاقاتٌ
                محسوبة في المتصفّح.
              </p>
              <Button className="mt-3" onClick={() => void load()} size="sm">
                إعادة المحاولة
              </Button>
            </CardBody>
          </Card>
        ) : null}

        {notice ? (
          <p
            className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES[notice.kind]}`}
            role={notice.kind === 'danger' ? 'alert' : 'status'}
          >
            {notice.text}
          </p>
        ) : null}

        {canView ? (
          <Card>
            <CardHeader subtitle="القائمة كلّ بطاقات المنشأة — لا عيّنةً من نافذة." title="بطاقات المناديب" />
            <CardBody>
              <dl className="ui-kpi-grid">
                <div className="ui-kpi-cell">
                  <dt className="ui-kpi-label">بطاقات المندوبين</dt>
                  <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                    {summary.total}
                  </dd>
                  <dd className="m-0 text-xs text-muted">
                    {summary.inactiveCards > 0 ? `${summary.inactiveCards} بطاقة موقوفة` : 'كلّها نشطة'}
                  </dd>
                </div>
                <div className="ui-kpi-cell">
                  <dt className="ui-kpi-label">جاهزٌ للعمل فعليًّا</dt>
                  <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                    {summary.readyToWork} / {summary.total}
                  </dd>
                  <dd className="m-0 text-xs text-muted">موظف + حساب نشط + مستودع سيارة + صلاحيات الخطّ</dd>
                </div>
                <div className="ui-kpi-cell">
                  <dt className="ui-kpi-label">بلا حساب دخول</dt>
                  <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                    {summary.missingLogin}
                  </dd>
                  <dd className="m-0 text-xs text-muted">
                    {summary.loginNotActive > 0 ? `و${summary.loginNotActive} حسابُه غير نشط` : '—'}
                  </dd>
                </div>
                <div className="ui-kpi-cell">
                  <dt className="ui-kpi-label">بلا بطاقة موظف</dt>
                  <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                    {summary.missingEmployee}
                  </dd>
                  <dd className="m-0 text-xs text-muted">تحميلُ النقص على المديونية مرفوض ٤٢٢</dd>
                </div>
                <div className="ui-kpi-cell">
                  <dt className="ui-kpi-label">بلا مستودع سيارة</dt>
                  <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                    {summary.missingVanWarehouse}
                  </dd>
                  <dd className="m-0 text-xs text-muted">لا عهدةَ تُقاس ولا نطاقَ للدخول</dd>
                </div>
                <div className="ui-kpi-cell">
                  <dt className="ui-kpi-label">بلا صلاحيات الخطّ</dt>
                  <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                    {summary.missingPermissions}
                  </dd>
                  <dd className="m-0 text-xs text-muted">يرفضهم الحارس ٤٠٣</dd>
                </div>
                <div className="ui-kpi-cell">
                  <dt className="ui-kpi-label">عهدٌ مفتوحة (كجم)</dt>
                  <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                    {summary.custodyQtyTotal.toFixed(4)}
                  </dd>
                  <dd className="m-0 text-xs text-muted">
                    على {summary.withOpenCustody} مندوب — من أوامر التحميل غير المُصفّاة
                  </dd>
                </div>
                <div className="ui-kpi-cell">
                  <dt className="ui-kpi-label">نقدٌ متوقّع لم يُحصّل (ريال)</dt>
                  <dd className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                    {summary.outstandingCashTotal.toFixed(4)}
                  </dd>
                  <dd className="m-0 text-xs text-muted">
                    ‏expected_cash − collected_cash على الأوامر المفتوحة
                  </dd>
                </div>
              </dl>
            </CardBody>
          </Card>
        ) : null}

        {canView ? (
          <Card>
            <CardHeader
              subtitle="بياناتُ البطاقة كما هي في النظام — والنِّسبُ مئويةٌ بين 0 و100."
              title={`البطاقات (${visible.length} من ${reps.length})`}
            />
            <CardBody>
              <div className="mb-3 flex flex-wrap gap-2">
                {FILTERS.map((entry) => (
                  <Button
                    key={entry.key}
                    onClick={() => setFilter(entry.key)}
                    size="sm"
                    variant={filter === entry.key ? 'primary' : 'secondary'}
                  >
                    {entry.labelAr}
                  </Button>
                ))}
              </div>

              {loading && reps.length === 0 ? (
                <p className="m-0 text-[13px] text-muted">يُقرأ المندوبون من الخادم…</p>
              ) : null}

              {!loading && visible.length === 0 ? (
                <p className="m-0 text-[13px] text-muted">
                  لا بطاقة في هذا التصريف. والقائمةُ من الخادم وحده، فلا تُعرض بطاقاتٌ مخزّنة في المتصفّح.
                </p>
              ) : null}

              {visible.length > 0 ? (
                <div className="bak-table-wrap">
                  <table className="bak-table">
                    <thead>
                      <tr>
                        <th>المندوب</th>
                        <th>بطاقة الموظف</th>
                        <th>حساب الدخول</th>
                        <th>مستودع السيارة</th>
                        <th>النِّسب</th>
                        <th>العهدة الحيّة</th>
                        <th>ما ينقصه</th>
                        <th>إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.map((row) => {
                        const notes = readinessNotes(row);
                        const expanded = expandedId === row.id;
                        return (
                          <Fragment key={row.id}>
                            <tr>
                              <td>
                                <div className="font-bold text-ink">{numberText(row.name)}</div>
                                <div className="text-xs text-muted" dir="ltr">
                                  {row.id}
                                </div>
                                {row.vehiclePlate ? (
                                  <div className="text-xs text-muted">لوحة {row.vehiclePlate}</div>
                                ) : null}
                                {row.active === false ? (
                                  <span className="bak-badge mt-1 inline-block">بطاقة موقوفة</span>
                                ) : null}
                              </td>
                              <td>
                                {row.employeeId ? (
                                  <>
                                    <div className="font-semibold text-ink">
                                      {numberText(row.employeeName)}
                                    </div>
                                    <div className="text-xs text-muted">
                                      رقم {numberText(row.employeeNo)} — {numberText(row.employeeStatus)}
                                    </div>
                                  </>
                                ) : (
                                  <span className={`bak-badge ${TONE_CLASSES.danger}`}>بلا بطاقة موظف</span>
                                )}
                                {row.employeeRef ? (
                                  <div className="text-xs text-muted" dir="ltr">
                                    {row.employeeRef}
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                {row.membershipId ? (
                                  <>
                                    <div className="text-[12px]" dir="ltr">
                                      {numberText(row.userEmail)}
                                    </div>
                                    <div className="text-xs text-muted">
                                      العضوية: {membershipStatusLabel(row.membershipStatus)} — المستخدم:{' '}
                                      {membershipStatusLabel(row.userStatus)} — {row.roleCount} دور
                                    </div>
                                  </>
                                ) : (
                                  <span className={`bak-badge ${TONE_CLASSES.danger}`}>بلا حساب دخول</span>
                                )}
                              </td>
                              <td>
                                {row.warehouseId ? (
                                  <>
                                    <div className="font-semibold text-ink">
                                      {numberText(row.warehouseName)}
                                    </div>
                                    <div className="text-xs text-muted" dir="ltr">
                                      {numberText(row.warehouseCode)}
                                    </div>
                                  </>
                                ) : (
                                  <span className={`bak-badge ${TONE_CLASSES.danger}`}>بلا مستودع سيارة</span>
                                )}
                              </td>
                              <td dir="ltr">
                                <div>بيع {ratePercentText(row.commissionRate)}</div>
                                <div>تحصيل {ratePercentText(row.collectionCommissionRate)}</div>
                                <div>ربح {ratePercentText(row.profitCommissionRate)}</div>
                              </td>
                              <td>
                                <div className="text-[12px]">{custodyHeadline(row)}</div>
                                {row.custody?.items?.length ? (
                                  <button
                                    className="mt-1 rounded-[6px] border border-line bg-surface px-2 py-0.5 text-xs font-bold text-ink"
                                    onClick={() => setExpandedId(expanded ? undefined : row.id)}
                                    type="button"
                                  >
                                    {expanded
                                      ? 'إخفاء الأصناف'
                                      : `أصنافُ العهدة (${row.custody.items.length})`}
                                  </button>
                                ) : null}
                              </td>
                              <td>
                                <ul className="m-0 grid list-none gap-1 p-0">
                                  {notes.map((note) => (
                                    <li
                                      className={`rounded-[8px] border px-2 py-1 text-[11.5px] font-semibold ${TONE_CLASSES[note.tone]}`}
                                      key={note.text}
                                    >
                                      {note.text}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                              <td>
                                <Button onClick={() => pickRep(row)} size="sm" variant="secondary">
                                  اختيارٌ للربط
                                </Button>
                              </td>
                            </tr>
                            {expanded && row.custody?.items?.length ? (
                              <tr>
                                <td className="border-b border-line bg-surface p-2" colSpan={8}>
                                  <p className="m-0 text-[12px] font-bold text-ink">
                                    أصنافُ عهدته من <span dir="ltr">stock_balances</span> مستودع سيارته (كميةٌ
                                    وقيمةٌ كما خزّنهما الخادم):
                                  </p>
                                  <div className="mt-2 bak-table-wrap">
                                    <table className="bak-table bak-table--dense">
                                      <thead>
                                        <tr>
                                          <th>الصنف</th>
                                          <th>المستودع</th>
                                          <th>الكمية</th>
                                          <th>القيمة</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {row.custody.items.map((item) => (
                                          <tr key={`${row.id}-${item.itemId}`}>
                                            <td>{numberText(item.itemName)}</td>
                                            <td>{numberText(item.warehouseName)}</td>
                                            <td dir="ltr">{numberText(item.quantity)}</td>
                                            <td dir="ltr">{numberText(item.value)}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {canView ? (
          <Card>
            <CardHeader
              subtitle="محميٌّ بصلاحية ربط الحساب؛ والخادم يرفض على هذا المسار حسابَ المندوب نفسه."
              title="ربطُ حساب دخول بمندوب"
            />
            <CardBody>
              {!canLink ? (
                <p
                  className={`m-0 mb-3 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}
                >
                  لا تملك صلاحيةَ هذا القسم — والخادم يرفض بـ
                  <span dir="ltr">{REPS_MESSAGES.linkForbidden}</span>. وربطُ الحسابات عملُ مكتبٍ خلفيّ لا
                  يملكه المندوب.
                </p>
              ) : null}

              <form
                className="grid gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void submitLink();
                }}
              >
                <label className="field">
                  <span>المندوب</span>
                  <select
                    className={selectClass}
                    disabled={busy || !canLink}
                    onChange={(event) => {
                      const next = reps.find((row) => row.id === event.target.value) ?? null;
                      if (next) pickRep(next);
                      else setDraft((current) => ({ ...current, salesmanId: '' }));
                    }}
                    value={draft.salesmanId}
                  >
                    <option value="">— اختر بطاقة مندوب —</option>
                    {reps.map((row) => (
                      <option key={row.id} value={row.id}>
                        {salesmanLabel(row)}
                        {row.membershipId ? ' (له حساب قائم)' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="text-[11.5px] font-normal text-muted">
                    البطاقة نفسها تُنشأ وتُعدَّل في <span dir="ltr">apps/staff</span> — لا نسخةَ كتابةٍ ثانية
                    هنا.
                  </span>
                </label>

                {picked ? (
                  <p
                    className={`m-0 rounded-[10px] border px-4 py-2.5 text-[12.5px] font-semibold ${TONE_CLASSES[isReadyToWork(picked) ? 'ok' : 'warn']}`}
                  >
                    {custodyHeadline(picked)} —{' '}
                    {isReadyToWork(picked) ? 'البطاقة جاهزة للعمل' : 'البطاقة ناقصة (انظر «ما ينقصه» أعلاه)'}
                  </p>
                ) : null}

                <div className="grid gap-3 sm:grid-cols-2">
                  <Input
                    dir="ltr"
                    hint="يقصّه الخادم ويُصغّره. وإن كانت بطاقة الموظف تملك عضويةً فالحسابُ القائم يُعاد استعماله وقد يختلف بريدُه الفعليّ عمّا تكتبه — ويُردّ عليك في الإيصال."
                    label="بريد حساب الدخول"
                    onChange={(event) => setDraft((current) => ({ ...current, email: event.target.value }))}
                    placeholder="rep@bakery.test"
                    value={draft.email}
                  />
                  <Input
                    hint="اتركه فارغًا فيأخذ الخادم اسمَ بطاقة الموظف أو اسمَ المندوب — ولا يُخترع اسمٌ هنا."
                    label="الاسم المعروض (اختياري)"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, fullName: event.target.value }))
                    }
                    placeholder="الاسم كما في بطاقة الموظف"
                    value={draft.fullName}
                  />
                </div>

                <label className="flex items-start gap-2 text-[12.5px] font-bold text-ink">
                  <input
                    checked={draft.restrictToVanWarehouse}
                    className="mt-1"
                    disabled={busy || !canLink}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, restrictToVanWarehouse: event.target.checked }))
                    }
                    type="checkbox"
                  />
                  <span>
                    حصرُ الحساب بمستودع سيارة المندوب
                    <span className="block text-[11.5px] font-normal text-muted">
                      افتراضيُّ الخادم هو الحصر (يُطبَّق نطاق <span dir="ltr">warehouse</span> على العضوية).
                      وإلغاءُه توسيعُ وصولٍ مقصود، ولا يُطبَّق أصلًا إن كانت البطاقة بلا مستودع سيارة.
                    </span>
                  </span>
                </label>

                {verdict.blocked.length > 0 ? (
                  <ul className="m-0 grid list-none gap-1 p-0">
                    {verdict.blocked.map((text) => (
                      <li
                        className={`rounded-[8px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}
                        key={text}
                      >
                        {text}
                      </li>
                    ))}
                  </ul>
                ) : null}

                {verdict.warnings.length > 0 ? (
                  <ul className="m-0 grid list-none gap-1 p-0">
                    {verdict.warnings.map((text) => (
                      <li
                        className={`rounded-[8px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}
                        key={text}
                      >
                        {text}
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="ui-form-actions">
                  <Button disabled={busy || !canLink} loading={busy} type="submit">
                    ربطُ حساب الدخول
                  </Button>
                  <span className="text-[11.5px] text-muted">
                    لا يُرسل مفتاحُ عدم تكرار: المسار لا يقبله. والزرُّ معطَّلٌ أثناء الطلب، والخادم يُعيد
                    استعمال العضوية القائمة فلا يُنشئ حسابًا ثانيًا عند إعادة الإرسال.
                  </span>
                </div>
              </form>
            </CardBody>
          </Card>
        ) : null}

        {outcome ? (
          <Card>
            <CardHeader
              subtitle="من إيصال النظام لا من «نجح الطلب»: عضويةٌ بلا تفعيلٍ ليست دخولاً جاهزاً، وحسابٌ غير مقيَّدٍ بمستودع ليس حساب مندوب."
              title="نتيجةُ الربط"
            />
            <CardBody>
              <p
                className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-bold ${NOTICE_CLASSES[outcome.tone]}`}
              >
                {outcome.headline}
              </p>
              <ul className="m-0 mt-3 grid list-none gap-2 p-0">
                {outcome.notes.map((text) => (
                  <li
                    className="rounded-[8px] border border-line bg-surface px-3 py-2 text-[12.5px]"
                    key={text}
                  >
                    {text}
                  </li>
                ))}
              </ul>
              <p className="m-0 mt-3 text-[12px] text-muted">
                الدور: {numberText(receipt?.roleName)} — وحالة العضوية:{' '}
                {membershipStatusLabel(receipt?.status ?? null)}. والصلاحياتُ تُمنح من شاشة الأدوار في{' '}
                <span dir="ltr">apps/staff</span>، لا من هنا.
              </p>
            </CardBody>
          </Card>
        ) : null}

        {canView ? (
          <Card>
            <CardHeader subtitle="حدودٌ تُقال ولا تُخفى." title="ما ليس في هذه الشاشة" />
            <CardBody>
              <ul className="m-0 grid list-none gap-2 p-0 text-[12.5px] text-muted">
                <li>
                  إنشاءُ بطاقة مندوب أو تعديلُها أو حذفُها ونِسبُ العمولة وربطُ الموظف يدويًّا:{' '}
                  <span dir="ltr">POST/PATCH /sales/salesmen</span> في <span dir="ltr">apps/staff</span> عند —
                  كاتبٌ واحد للبطاقة.
                </li>
                <li>
                  نطاقُ الفروع على العضوية غير معروض: الخادم يُطبّقه عند <strong>إنشاء</strong> العضوية فقط
                  ويتجاهله عند إعادة استعمال حسابٍ قائم، فعرضُه وعدٌ بشيءٍ لا يفعله في الحالة الشائعة.
                </li>
                <li>
                  لا كلمةُ مرور تُنشأ ولا تُصفَّر هنا: الحسابُ الجديد <span dir="ltr">invited</span> بلا كلمة
                  مرور، ورابطُ التفعيل من منصّة الهويّة — وربطُ الأجهزة وتسليمُ الجلسة في المرحلة ٤ (واجهة
                  المندوب المحمولة).
                </li>
                <li>
                  النِّسبُ المعروضة هي ما خزّنه الخادم على البطاقة؛ أمّا حسابُ مبالغ العمولة فرهنٌ بالرواتب
                  والمبيعات في <span dir="ltr">apps/staff</span> ولا يُحسب هنا.
                </li>
                <li>
                  الأدوارُ وصلاحياتها تُمنح من شاشة الأدوار في <span dir="ltr">apps/staff</span>؛ وهذه الشاشة
                  تقرأ ما اجتمع للعضوية من صلاحياتٍ (<span dir="ltr">permissions</span>) ولا تمنح شيئًا.
                </li>
              </ul>
            </CardBody>
          </Card>
        ) : null}
      </div>
    </section>
  );
}
