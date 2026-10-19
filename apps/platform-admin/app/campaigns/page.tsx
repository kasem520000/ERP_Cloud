'use client';

/**
 * P-M7 — شاشة الحملات البريدية (`docs/roadmap/MARKETING_SITE_PLAN.md` §5، السطر P-M7).
 *
 * شاشةٌ واحدة بتبويبين، لأن سؤالَي المشغّل متجاوران:
 *
 *   1. **الحملات** — «ماذا نرسل، ولمن، وماذا جرى؟»: مسوّدةٌ تُكتب (اسمٌ وعنوانٌ ونصٌّ وشريحة)،
 *      ثم جدولةٌ أو إرسالٌ الآن، ثم تقريرٌ من أربعة أقسام: مجاميعُ (أُرسل · فُتح · نُقر ·
 *      أُلغي اشتراك)، وروابطُ مرتّبةٌ بعدد نقراتها، وصفٌّ **لكل مستلم** بحالته وسببها، وأثرٌ
 *      زمنيّ لكل حدث. ولا رقمَ في هذه الشاشة يُحسب في المتصفّح — كلها من الـAPI.
 *   2. **الشرائح** — «كم سيصل؟»: أعدادٌ حقيقية تُقرأ من الجداول الآن، وعن كل شريحة: أهي
 *      **أشخاص** (تسويقٌ بموافقة صريحة) أم **حسابات** (رسالة خدمةٍ لأصحاب تراخيص). والفرق
 *      ليس تصنيفاً إدارياً بل أساس الامتثال — ولهذا يُعرَض في الشاشة لا في التوثيق وحده.
 *
 * وخمسة قرارات ظاهرة هنا:
 *
 *   * **الأزرار تحترم الحالة**: حملةٌ بدأ إرسالها لا يُعرَض لها تعديلٌ ولا إلغاء (الـAPI يرفضهما
 *     بـ`CAMPAIGN_LOCKED`) — والشاشة لا تعرض ما سيُرفَض.
 *   * **الإلغاء يطلب سبباً**: «لماذا أُلغيت؟» سؤالٌ يُسأل بعد شهرين، والسبب يُخزَّن ويُعرَض.
 *   * **الإرسال لا يقع بضغطةٍ عابرة**: «أرسل الآن» يطلب تأكيداً بالعدد المعروض («سيصل إلى ن»).
 *   * **التحذير قبل الإرسال**: شريحةٌ فارغة تُنبَّه في الاختيار نفسه، فلا يُكتب نصٌّ لشريحةٍ
 *     لا أحد فيها.
 *   * **الرمز يحكم الشاشة**: `console.campaigns.manage` وحده يفتحها — والـAPI هو الحاكم لا الشريحة.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  campaignSegments,
  campaignSegmentLabelsAr,
  campaignStatuses,
  campaignStatusLabelsAr,
  type CampaignLocale,
  type CampaignReport,
  type CampaignSegment,
  type CampaignSegmentInfo,
  type CampaignStatus,
  type CampaignView,
} from '@erp/contracts';
import { Panel } from '@erp/ui';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { Table, type Column } from '../../components/ui/table';
import { Tabs } from '../../components/ui';
import { ApiError, apiData, apiPatch, apiPost } from '../../lib/api';
import { useSession } from '../../lib/session';
import { useQuery } from '../../lib/use-query';

type ListPayload = {
  data: CampaignView[];
  meta: { total: number; limit: number; offset: number };
  counts: Record<CampaignStatus, number>;
};

const STATUS_TONE: Record<CampaignStatus, string> = {
  draft: 'tag',
  scheduled: 'tag platform',
  sending: 'tag tenant',
  sent: 'tag ok',
  canceled: 'tag danger',
};

export default function CampaignsPage() {
  const { canConsole } = useSession();
  const canManage = canConsole('console.campaigns.manage');
  const [tab, setTab] = useState<'campaigns' | 'segments'>('campaigns');

  return (
    <Screen
      title="الحملات البريدية"
      subtitle="من نراسل، بماذا، وماذا فعلوا بالرسالة — والشرائح وأعدادها في تبويبٍ ثانٍ."
      crumbs={['لوحة المنصّة', 'العملاء', 'الحملات البريدية']}
    >
      <Tabs
        items={[
          { id: 'campaigns', label: 'الحملات' },
          { id: 'segments', label: 'الشرائح' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'campaigns' ? <Campaigns canManage={canManage} /> : <Segments />}
    </Screen>
  );
}

// ═══════════════════════════════════════════════════ الشرائح

function Segments() {
  const segments = useQuery<CampaignSegmentInfo[]>(
    () => apiData<CampaignSegmentInfo[]>('/platform/campaigns/segments'),
    [],
  );

  if (segments.status === 'loading') return <Loading rows={4} />;
  if (segments.status === 'forbidden') return <Forbidden />;
  if (segments.status === 'error') return <ErrorBox message={segments.error} onRetry={segments.reload} />;

  const segmentColumns: Array<Column<CampaignSegmentInfo>> = [
    { key: 'label', header: 'الشريحة', grow: true, cell: (segment) => segment.labelAr },
    {
      key: 'audience',
      header: 'الجمهور',
      cell: (segment) => (
        <span className={segment.audience === 'people' ? 'tag ok' : 'tag platform'}>
          {segment.audience === 'people' ? 'أشخاص' : 'حسابات'}
        </span>
      ),
    },
    { key: 'count', header: 'العدد', numeric: true, cell: (segment) => segment.count },
    {
      key: 'definition',
      header: 'التعريف',
      cell: (segment) => (
        <>
          <div className="muted">{segment.descriptionAr}</div>
          {segment.warningAr ? <div className="alert danger">{segment.warningAr}</div> : null}
        </>
      ),
    },
  ];

  return (
    <Panel
      flush
      title="الشرائح وأعدادها الآن"
      hint={
        <>
          الأعداد تُقرأ من الجداول لحظة العرض — لا تقدير. و«أشخاص» تعني موافقةً تسويقية صريحة (استمارةٌ موافقة
          أو اشتراكٌ مؤكَّد)، و«حسابات» تعني أصحاب تراخيص تُرسَل إليهم رسالة خدمة.
        </>
      }
    >
      <Table bare columns={segmentColumns} rows={segments.data ?? []} rowKey={(segment) => segment.segment} />
    </Panel>
  );
}

// ═══════════════════════════════════════════════════ الحملات

function Campaigns({ canManage }: { canManage: boolean }) {
  const [status, setStatus] = useState<CampaignStatus | ''>('');
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (applied) params.set('q', applied);
    const value = params.toString();
    return value ? `?${value}` : '';
  }, [status, applied]);

  const list = useQuery<ListPayload>(
    () => apiData<ListPayload>(`/platform/campaigns${queryString}`),
    [queryString],
  );
  const segments = useQuery<CampaignSegmentInfo[]>(
    () => apiData<CampaignSegmentInfo[]>('/platform/campaigns/segments'),
    [],
  );

  if (list.status === 'loading') return <Loading rows={5} />;
  if (list.status === 'forbidden') return <Forbidden />;
  if (list.status === 'error') return <ErrorBox message={list.error} onRetry={list.reload} />;

  const payload = list.data!;

  const campaignColumns: Array<Column<CampaignView>> = [
    {
      key: 'name',
      header: 'الحملة',
      grow: true,
      cell: (campaign) => (
        <>
          {campaign.name}
          <div className="muted">{campaign.subject}</div>
        </>
      ),
    },
    { key: 'segment', header: 'الشريحة', cell: (campaign) => campaign.segmentLabelAr },
    {
      key: 'status',
      header: 'الحالة',
      cell: (campaign) => <span className={STATUS_TONE[campaign.status]}>{campaign.statusLabelAr}</span>,
    },
    {
      key: 'when',
      header: 'الموعد',
      cell: (campaign) => formatDate(campaign.scheduledAt ?? campaign.createdAt),
    },
    { key: 'recipients', header: 'المستلمون', numeric: true, cell: (campaign) => campaign.totals.recipients },
    { key: 'sent', header: 'أُرسل', numeric: true, cell: (campaign) => campaign.totals.sent },
    { key: 'opened', header: 'فُتح', numeric: true, cell: (campaign) => campaign.totals.opened },
    { key: 'clicked', header: 'نُقر', numeric: true, cell: (campaign) => campaign.totals.clicked },
    {
      key: 'unsub',
      header: 'ألغى الاشتراك',
      numeric: true,
      cell: (campaign) => campaign.totals.unsubscribed,
    },
    {
      key: 'report',
      header: '',
      cell: (campaign) => (
        <button
          className="btn sm"
          type="button"
          onClick={() => setOpenId(openId === campaign.id ? null : campaign.id)}
        >
          {openId === campaign.id ? 'إغلاق' : 'التقرير'}
        </button>
      ),
    },
  ];

  return (
    <>
      <Panel bodyClassName="grid">
        <div className="toolbar">
          <select
            className="input"
            value={status}
            onChange={(event) => setStatus(event.target.value as CampaignStatus | '')}
          >
            <option value="">كل الحالات</option>
            {campaignStatuses.map((key) => (
              <option key={key} value={key}>
                {campaignStatusLabelsAr[key]} ({payload.counts[key] ?? 0})
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="بحث: اسم الحملة أو عنوانها"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') setApplied(search.trim());
            }}
          />
          <button className="btn" type="button" onClick={() => setApplied(search.trim())}>
            ابحث
          </button>
          {applied ? (
            <button
              className="btn sm"
              type="button"
              onClick={() => {
                setSearch('');
                setApplied('');
              }}
            >
              مسح البحث
            </button>
          ) : null}
          {canManage ? (
            <button className="btn" type="button" onClick={() => setComposing(!composing)}>
              {composing ? 'إغلاق المسوّدة' : 'حملة جديدة'}
            </button>
          ) : null}
        </div>
        <div className="toolbar">
          {campaignStatuses.map((key) => (
            <span className={STATUS_TONE[key]} key={key}>
              {campaignStatusLabelsAr[key]}: {payload.counts[key] ?? 0}
            </span>
          ))}
          <span className="muted">
            المعروض: {payload.data.length} من {payload.meta.total}
          </span>
        </div>
      </Panel>

      {composing && canManage ? (
        <Composer
          segments={segments.data ?? []}
          onCreated={(campaign) => {
            setComposing(false);
            setOpenId(campaign.id);
            list.reload();
          }}
          onCancel={() => setComposing(false)}
        />
      ) : null}

      {payload.data.length === 0 ? (
        <Empty
          title="لا حملات بهذه المرشّحات"
          detail={
            canManage
              ? 'ابدأ بحملة جديدة: نصٌّ وشريحة، ثم جدولة أو إرسالٌ الآن.'
              : 'حملات المنصّة تُدار بصلاحية الإرسال.'
          }
        />
      ) : (
        <Panel flush title="الحملات">
          <Table bare columns={campaignColumns} rows={payload.data} rowKey={(campaign) => campaign.id} />
        </Panel>
      )}

      {openId ? (
        <CampaignCard
          campaignId={openId}
          canManage={canManage}
          onChanged={() => {
            list.reload();
          }}
        />
      ) : null}
    </>
  );
}

// ═══════════════════════════════════════════════════ إنشاء حملة

function Composer({
  segments,
  onCreated,
  onCancel,
}: {
  segments: CampaignSegmentInfo[];
  onCreated: (campaign: CampaignView) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState(
    'مرحباً،\n\nنصٌّ قصير يقول لماذا نكتب، ورابطٌ للتفاصيل: https://demo.test',
  );
  const [segment, setSegment] = useState<CampaignSegment>('leads');
  const [locale, setLocale] = useState<CampaignLocale>('ar');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = segments.find((entry) => entry.segment === segment);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const created = await apiPost<CampaignView>('/platform/campaigns', {
        name: name.trim(),
        subject: subject.trim(),
        body: body.trim(),
        segment,
        locale,
      });
      onCreated(created);
    } catch (failure) {
      setError(failure instanceof ApiError ? (failure.detail ?? failure.message) : 'تعذّر إنشاء الحملة');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="حملة جديدة"
      hint="تُحفظ مسوّدةً: تُراجَع ثم تُجدَّل أو تُرسل."
      bodyClassName="grid"
      aria-label="مسوّدة حملة جديدة"
    >
      {error ? <p className="alert danger">{error}</p> : null}

      <div className="grid cols-2">
        <label className="field">
          <span>اسم الحملة (داخلي)</span>
          <input
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="مثال: عرض أكتوبر"
          />
        </label>
        <label className="field">
          <span>عنوان الرسالة (كما يقرأه المستلم)</span>
          <input
            className="input"
            value={subject}
            onChange={(event) => setSubject(event.target.value)}
            placeholder="أهلاً {{name}} — عرضٌ لفروعك"
          />
        </label>
      </div>

      <label className="field">
        <span>
          النصّ — المتغيّرات: {'{{name}}'} و{'{{company}}'} و{'{{email}}'}، والروابط: https://… أو
          [عنوان](https://…)
        </span>
        <textarea className="input" rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
      </label>

      <div className="grid cols-2">
        <label className="field">
          <span>الشريحة</span>
          <select
            className="input"
            value={segment}
            onChange={(event) => setSegment(event.target.value as CampaignSegment)}
          >
            {campaignSegments.map((key) => {
              const info = segments.find((entry) => entry.segment === key);
              return (
                <option key={key} value={key}>
                  {campaignSegmentLabelsAr[key]} — {info ? info.count : 0} مستلماً
                </option>
              );
            })}
          </select>
        </label>
        <label className="field">
          <span>لغة الرسالة</span>
          <select
            className="input"
            value={locale}
            onChange={(event) => setLocale(event.target.value as CampaignLocale)}
          >
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </label>
      </div>

      {chosen ? (
        <p className="muted">
          {chosen.descriptionAr}
          {chosen.warningAr ? <span className="tag danger">{chosen.warningAr}</span> : null}
        </p>
      ) : null}

      <p className="muted">
        رابط إلغاء الاشتراك يُضاف تلقائياً في كل رسالة (`List-Unsubscribe` وزرُّ نقرةٍ واحدة)، ولا يُمكن أن
        يُرسل نصٌّ بلا طريقٍ للخروج.
      </p>

      <div className="toolbar">
        <button
          className="btn"
          type="button"
          disabled={busy || name.trim().length < 3 || subject.trim().length < 3}
          onClick={submit}
        >
          {busy ? '…جارٍ الحفظ' : 'احفظ المسوّدة'}
        </button>
        <button className="btn sm" type="button" onClick={onCancel}>
          إلغاء
        </button>
      </div>
    </Panel>
  );
}

// ═══════════════════════════════════════════════════ بطاقة الحملة والتقرير

function CampaignCard({
  campaignId,
  canManage,
  onChanged,
}: {
  campaignId: string;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [at, setAt] = useState('');
  const [testTo, setTestTo] = useState('');
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ subject: '', body: '' });

  const report = useQuery<CampaignReport>(
    () => apiData<CampaignReport>(`/platform/campaigns/${campaignId}/report`),
    [campaignId],
  );

  const refresh = useCallback(() => {
    report.reload();
    onChanged();
  }, [report, onChanged]);

  if (report.status === 'loading') return <Loading rows={4} />;
  if (report.status === 'forbidden') return <Forbidden />;
  if (report.status === 'error') return <ErrorBox message={report.error} onRetry={report.reload} />;

  const { campaign, totals, messages, events, links } = report.data!;
  const linkColumns: Array<Column<CampaignReport['links'][number]>> = [
    { key: 'url', header: 'الوجهة', grow: true, cell: (link) => <bdi>{link.url}</bdi> },
    { key: 'clicks', header: 'النقرات', numeric: true, cell: (link) => link.clicks },
  ];

  const messageColumns: Array<Column<CampaignReport['messages'][number]>> = [
    { key: 'email', header: 'البريد', ltr: true, cell: (message) => <bdi>{message.email}</bdi> },
    {
      key: 'name',
      header: 'الاسم',
      cell: (message) => message.fullName ?? message.companyName ?? '—',
    },
    {
      key: 'status',
      header: 'الحالة',
      cell: (message) => (
        <span
          className={
            message.status === 'sent' ? 'tag ok' : message.status === 'failed' ? 'tag danger' : 'tag'
          }
        >
          {message.statusLabelAr}
        </span>
      ),
    },
    {
      key: 'detail',
      header: 'السبب',
      cell: (message) => <span className="muted">{message.detail ?? '—'}</span>,
    },
    {
      key: 'sent',
      header: 'أُرسلت',
      cell: (message) => (message.sentAt ? formatDate(message.sentAt) : '—'),
    },
    {
      key: 'opened',
      header: 'فُتحت',
      cell: (message) => (message.openedAt ? formatDate(message.openedAt) : '—'),
    },
    { key: 'clicks', header: 'النقرات', numeric: true, cell: (message) => message.clickCount },
    {
      key: 'lastClick',
      header: 'آخر نقرة',
      cell: (message) => (message.lastClickedUrl ? <bdi>{message.lastClickedUrl}</bdi> : '—'),
    },
  ];

  const locked =
    campaign.status === 'sent' || campaign.status === 'canceled' || campaign.status === 'sending';

  const act = async (run: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await run();
      setNotice(done ?? null);
      refresh();
    } catch (failure) {
      setError(failure instanceof ApiError ? (failure.detail ?? failure.message) : 'تعذّر تنفيذ الطلب');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={campaign.name}
      hint={
        <>
          {campaign.subject} · {campaign.segmentLabelAr} ·{' '}
          <span className={STATUS_TONE[campaign.status]}>{campaign.statusLabelAr}</span>
          {campaign.createdByLabel ? <> · أنشأها: {campaign.createdByLabel}</> : null}
          {campaign.scheduledAt ? <> · الموعد: {formatDate(campaign.scheduledAt)}</> : null}
          {campaign.finishedAt ? <> · انتهت: {formatDate(campaign.finishedAt)}</> : null}
        </>
      }
      bodyClassName="grid"
      aria-label={`حملة ${campaign.name}`}
    >
      {error ? <p className="alert danger">{error}</p> : null}
      {notice ? <p className="alert ok">{notice}</p> : null}
      {campaign.canceledReason ? <p className="muted">سبب الإلغاء: {campaign.canceledReason}</p> : null}

      <div className="grid cols-2">
        <Panel title="النصّ كما سيخرج">
          <pre className="muted" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
            {campaign.body}
          </pre>
          <p className="muted">
            المتغيّرات: {campaign.variables.length > 0 ? campaign.variables.join(' · ') : 'لا متغيّرات'}
          </p>
          <p className="muted">
            الروابط:{' '}
            {campaign.hyperlinks.length === 0
              ? 'لا روابط'
              : campaign.hyperlinks.map((url) => (
                  <span className="tag" key={url}>
                    <bdi>{url}</bdi>
                  </span>
                ))}
          </p>
        </Panel>

        <Panel title="الأرقام">
          <dl className="kv">
            <dt>المستلمون</dt>
            <dd>{totals.recipients}</dd>
            <dt>أُرسل</dt>
            <dd>{totals.sent}</dd>
            <dt>فشل</dt>
            <dd>{totals.failed}</dd>
            <dt>لم تُرسل</dt>
            <dd>{totals.skipped}</dd>
            <dt>فُتح</dt>
            <dd>{totals.opened}</dd>
            <dt>نُقر</dt>
            <dd>{totals.clicked}</dd>
            <dt>ألغى الاشتراك</dt>
            <dd>{totals.unsubscribed}</dd>
          </dl>
          <p className="muted">
            الفتح يُقاس ببكسلٍ في نسخة HTML، ومن يُغلق تحميل الصور لا يُحتسب — فالرقم حدٌّ أدنى لا حدٌّ أعلى.
            والنقر أدقّ منه: يمرّ بنا كل من ضغط.
          </p>
        </Panel>
      </div>

      {canManage ? (
        <Panel title="الإرسال" bodyClassName="grid">
          {locked ? (
            <p className="muted">
              {campaign.status === 'sent'
                ? 'أُرسلت — لا تعديل ولا إلغاء بعد الإرسال: ما خرج لا يُستدعى.'
                : campaign.status === 'canceled'
                  ? 'ملغاة — البقية لم تُرسل بسبب الإلغاء.'
                  : 'قيد الإرسال…'}
            </p>
          ) : (
            <>
              <div className="toolbar">
                <label className="field">
                  <span>موعد الإرسال (اتركه فارغاً للإرسال الآن)</span>
                  <input
                    className="input"
                    type="datetime-local"
                    value={at}
                    onChange={(event) => setAt(event.target.value)}
                  />
                </label>
                <button
                  className="btn"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () =>
                        apiPost(`/platform/campaigns/${campaign.id}/schedule`, {
                          scheduledAt: at ? new Date(at).toISOString() : null,
                        }),
                      at ? 'جُدولت الحملة.' : 'بدأ الإرسال.',
                    )
                  }
                >
                  {busy ? '…' : at ? 'جدولة' : 'أرسل الآن'}
                </button>
                <button className="btn sm" type="button" disabled={busy} onClick={() => setEditing(!editing)}>
                  {editing ? 'إغلاق التعديل' : 'تعديل النصّ'}
                </button>
              </div>

              {editing ? (
                <>
                  <label className="field">
                    <span>العنوان</span>
                    <input
                      className="input"
                      value={draft.subject || campaign.subject}
                      onChange={(event) => setDraft({ ...draft, subject: event.target.value })}
                    />
                  </label>
                  <label className="field">
                    <span>النصّ</span>
                    <textarea
                      className="input"
                      rows={6}
                      value={draft.body || campaign.body}
                      onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    />
                  </label>
                  <div className="toolbar">
                    <button
                      className="btn"
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () =>
                            apiPatch(`/platform/campaigns/${campaign.id}`, {
                              subject: draft.subject || campaign.subject,
                              body: draft.body || campaign.body,
                            }),
                          'حُفظ التعديل.',
                        )
                      }
                    >
                      احفظ
                    </button>
                    <button className="btn sm" type="button" onClick={() => setEditing(false)}>
                      تراجع
                    </button>
                  </div>
                </>
              ) : null}

              <div className="toolbar">
                <label className="field">
                  <span>أرسل نسخة اختبار إلى</span>
                  <input
                    className="input"
                    type="email"
                    placeholder="qa@example.test"
                    value={testTo}
                    onChange={(event) => setTestTo(event.target.value)}
                  />
                </label>
                <button
                  className="btn sm"
                  type="button"
                  disabled={busy || testTo.trim().length < 5}
                  onClick={() =>
                    act(
                      () => apiPost(`/platform/campaigns/${campaign.id}/send-test`, { to: testTo.trim() }),
                      'أُرسلت نسخة اختبار (بلا رمز زحف، فلا تُكتب في التقرير).',
                    )
                  }
                >
                  أرسل اختباراً
                </button>
              </div>

              <div className="toolbar">
                <label className="field">
                  <span>سبب الإلغاء (مطلوب للإلغاء)</span>
                  <input
                    className="input"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="مثال: تغيّر العرض"
                  />
                </label>
                <button
                  className="btn sm"
                  type="button"
                  disabled={busy || reason.trim().length < 3}
                  onClick={() =>
                    act(
                      () => apiPost(`/platform/campaigns/${campaign.id}/cancel`, { reason: reason.trim() }),
                      'أُلغيت الحملة.',
                    )
                  }
                >
                  إلغاء الحملة
                </button>
                <button
                  className="btn sm"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    act(
                      () => apiPost(`/platform/campaigns/${campaign.id}/dispatch`, {}),
                      'نُفِّذت دفعة إرسال.',
                    )
                  }
                >
                  دفعة إرسال (استئناف)
                </button>
              </div>
            </>
          )}
        </Panel>
      ) : (
        <p className="muted">قراءةٌ فقط: الكتابة والإرسال والإلغاء تحتاج `console.campaigns.manage`.</p>
      )}

      <Panel flush title="الروابط المُتتبَّعة">
        {links.length === 0 ? (
          <p className="muted">لا نقرةَ مسجّلة بعد.</p>
        ) : (
          <Table bare columns={linkColumns} rows={links} rowKey={(link) => link.url} />
        )}
      </Panel>

      <Panel flush title={<>المستلمون ( {messages.length} )</>}>
        {messages.length === 0 ? (
          <p className="muted">
            {campaign.status === 'scheduled' ? 'لم يُرسل بعد — الرسائل تُنشأ لحظة الإرسال.' : 'لا مستلمين.'}
          </p>
        ) : (
          <Table bare columns={messageColumns} rows={messages} rowKey={(message) => message.id} />
        )}
      </Panel>

      <Panel title="الأثر">
        {events.length === 0 ? (
          <p className="muted">لا أحداث بعد.</p>
        ) : (
          <ol className="timeline">
            {events.map((event) => (
              <li key={event.id}>
                <span className="tag">{event.kindLabelAr}</span>{' '}
                {event.email ? <bdi>{event.email}</bdi> : null}{' '}
                {event.url ? <bdi className="muted">{event.url}</bdi> : null}
                {event.detail ? <span className="muted"> — {event.detail}</span> : null}
                <span className="muted"> · {formatDate(event.at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </Panel>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('ar-SA-u-ca-gregory-nu-latn', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
