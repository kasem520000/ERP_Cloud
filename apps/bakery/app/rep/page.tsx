'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import {
  clearSyncedVanQueue,
  enqueueVanOperation,
  getOrCreateDeviceId,
  listVanQueue,
  resetOfflineStorage,
  updateVanQueueRecord,
  type VanQueueRecord,
} from '@erp/web-core/offline-db';
import { useSession } from '@erp/web-core/session';
import { useSubmissionKey } from '@erp/web-core/use-submission-key';
import { buildClosingPayload, type ClosingDraft, type CustodyQuantities } from '@erp/web-van/custody';
import { buildReceiptPayload, type ReceiptDraft } from '@erp/web-van/distribution';
import type { RepLoadOrderRow, RepPendingReceipt, RepWorkspace } from '@erp/web-van/rep-workspace';

import {
  buildCollectionPayload,
  emptyCollectionDraft,
  type CollectionDraft,
} from '../../lib/collection-screen';
import { numberText, partyLabel, type PartyOption } from '../../lib/lookups';
import {
  classifyReplay,
  countQueue,
  isQueueable,
  NOT_QUEUEABLE_OPERATIONS,
  queueSummaryLine,
  queueVerdict,
  REP_PERMISSIONS,
  REP_QUEUE_MESSAGES,
  syncPlan,
  type RepOperation,
} from '../../lib/rep-queue';
import {
  actionEndpoint,
  bodyWithIdempotencyKey,
  closingShortageText,
  receiptShortfallText,
  repHeadlineCards,
  repWindowNotes,
  returnableDocuments,
  returnCeilingText,
  saleableLoadOrders,
  totalsReconcile,
  REP_WORKSPACE_PERMISSION,
} from '../../lib/rep-screen';
import {
  buildDocumentPayload,
  buildReturnPayload,
  documentVerdict,
  emptyDocumentDraft,
  type DocumentDraft,
  type ReturnDraft,
} from '../../lib/sales-screen';

type Notice = { kind: 'ok' | 'danger' | 'warn'; text: string };

/**
 * الألوانُ والحجومُ في `globals.css` (طبقةُ `.rep-*`) لا في أصنافٍ مكتوبةٍ هنا: فـ`data-tone`
 * يحمل المعنى (‏ok/warn/danger) والـCSS يقرّر كيف يبدو — ولو كُتبت الأصنافُ في الصفحة لصار
 * لكلّ شاشةٍ ذوقٌ ولضاع الحدُّ الأدنى لهدف اللمس وخطُّ الإدخال ١٦px بينها.
 */

/** عنوانُ كلّ إجراء كما يُقرأ في قائمة الطابور — لا رقمٌ داخليّ. */
const OPERATION_LABELS: Record<RepOperation, string> = {
  document: 'مستند بيع',
  return: 'مرتجع عميل',
  collection: 'تحصيل من عميل',
  closing: 'إغلاق الوردية',
  receipt: 'تأكيد استلام',
};

/**
 * تطبيقُ المندوب — `/rep`: مساحةُ عمله وإجراءاتُه، على الهاتف أولًا، متصلًا ومنقطعًا.
 *
 * والقواعدُ التي بُني عليها (وكلُّها مقاسةٌ في الخادم، وتفصيلُها في
 * `docs/BAKERY_APP_PHASE4_HANDOFF.md` §٤):
 *
 * 1. **سطحٌ رقيق**: الحمولةُ من `GET /van-sales/me` (والخادمُ يشتقّ المندوبَ من عضوية
 * المتّصل فلا يفتح مندوبٌ عهدةَ غيره)، والأجسامُ من بانياتٍ قائمةٍ مقاسة
 *    (‏`buildDocumentPayload`, ‏`buildReturnPayload`, ‏`buildCollectionPayload`,
 *    `buildClosingPayload`, ‏`buildReceiptPayload`)، والأحكامُ المالية من `documentVerdict`
 * وأحكامُ الطابور من `queueVerdict` — ولا قاعدةَ ولا رقمَ يُعاد حسابُه هنا.
 * 2. **نيّةٌ واحدةٌ مفتاحٌ واحد**: المفتاحُ من متتبّع `useSubmissionKey` (يثبت ما لم تتغيّر
 * النيّة) ويُخزَّن **مع** الجسم في الطابور فتستعمله كلّ إعادة — والخادمُ يعيد ٢٠١ بلا
 * أثرٍ ثانٍ (`if (existing) return this.dashboard(…)`).
 * 3. **الإقفالُ والاستلامُ لا يُحفظان منقطعَين**: فمساراهما بلا مفتاحٍ في الجسم، وإعادةٌ
 * عمياء لإقفالٍ تعيد كتابةَ إعلان الجرد (والخادمُ لا يرفض إلا إذا صارت الحالةُ
 *    ‏`settled`). فالزرّان يُحظران منقطعَين **بسببٍ مقاسٍ معروض**، لا يُخفيان بصمت.
 * 4. **لا رقمَ يُخترع**: الأرقامُ من `totals`/‏`custody` (جدولُ المندوب كلّه) والقوائمُ نوافذُ
 * يُقال عددُها من `windows`، والمعادلتان تُفحصان (`totalsReconcile`) فإن لم تُغلقا قيل.
 */
export default function RepAppPage() {
  const { can } = useSession();
  const canView = can(REP_WORKSPACE_PERMISSION);
  const canInvoice = can(REP_PERMISSIONS.invoice);
  const canCollect = can(REP_PERMISSIONS.collection);
  const canClose = can(REP_PERMISSIONS.closing);

  const [data, setData] = useState<RepWorkspace | null>(null);
  const [parties, setParties] = useState<PartyOption[]>([]);
  const [partiesError, setPartiesError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | undefined>();
  const [online, setOnline] = useState(true);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [queue, setQueue] = useState<VanQueueRecord[]>([]);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [saleDraft, setSaleDraft] = useState<DocumentDraft>(emptyDocumentDraft());
  const [returnDraft, setReturnDraft] = useState<ReturnDraft>({
    documentId: '',
    returnedQty: '',
    reason: '',
    notes: '',
  });
  const [collectionDraft, setCollectionDraft] = useState<CollectionDraft>(emptyCollectionDraft());
  const [closingTarget, setClosingTarget] = useState<RepLoadOrderRow | null>(null);
  const [countMode, setCountMode] = useState<'whole-vehicle' | 'per-order'>('whole-vehicle');
  const [closingDraft, setClosingDraft] = useState<ClosingDraft>({
    returnedQty: '',
    damagedQty: '',
    damageReason: '',
    collectedCash: '',
    actualRemainingQty: '',
    vehicleCountQty: '',
    otherCustodyInVanQty: '',
    closingNotes: '',
  });
  const [receiptTarget, setReceiptTarget] = useState<RepPendingReceipt | null>(null);
  const [receiptDraft, setReceiptDraft] = useState<ReceiptDraft>({
    receivedQty: '',
    notes: '',
    loadedQty: '0',
  });

  const saleKey = useSubmissionKey('rep-document');
  const returnKey = useSubmissionKey('rep-return');
  const collectionKey = useSubmissionKey('rep-collection');

  const notes = useMemo(() => repWindowNotes(data), [data]);
  const cards = useMemo(() => (data ? repHeadlineCards(data) : []), [data]);
  const reconcileNote = useMemo(() => totalsReconcile(data?.totals ?? null), [data]);
  const saleable = useMemo(() => saleableLoadOrders(data?.loadOrders ?? []), [data]);
  const returnable = useMemo(() => returnableDocuments(data?.documents ?? []), [data]);
  const unpaidDocuments = useMemo(
    () => (data?.documents ?? []).filter((row) => Number(row.outstanding) > 0 && row.documentKind === 'sale'),
    [data],
  );
  const counts = useMemo(() => countQueue(queue), [queue]);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await listVanQueue());
      setStorageError(null);
    } catch (error) {
      // ‏تخزينُ المتصفّح قد يكون ممنوعًا (وضعٌ خاصّ، أو مساحةٌ ممتلئة) — فيُقال ولا يُخفى:
      // ‏فطابورٌ لا يُكتب يعني أنّ «حُفظ» كذب.
      setStorageError(apiErrorText(error, 'تعذّر قراءة طابور التخزين المحلّي في هذا المتصفّح'));
    }
  }, []);

  const load = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    setLoadError(null);
    try {
      const workspace = await apiData<RepWorkspace>('/van-sales/me');
      setData(workspace);
    } catch (error) {
      setLoadError(apiErrorText(error, 'تعذّر قراءة مساحة عملك'));
    } finally {
      setLoading(false);
    }
    try {
      setParties(await apiList<PartyOption>('/parties?kind=customer'));
      setPartiesError(null);
    } catch (error) {
      setPartiesError(apiErrorText(error, 'تعذّر قراءة بطاقات العملاء'));
    }
  }, [canView]);

  useEffect(() => {
    const update = () => setOnline(typeof navigator === 'undefined' ? true : navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  useEffect(() => {
    void load();
    void refreshQueue();
    getOrCreateDeviceId()
      .then(setDeviceId)
      .catch(() => setDeviceId(null));
  }, [load, refreshQueue]);

  /**
   * حفظُ نيّةٍ في الطابور. والمفتاحُ **يُخزَّن مع الجسم** فتستعمله كلّ إعادة — وهذا ما يجعل
   * الإعادةَ آمنةً بلا مستندٍ مكرَّر.
   */
  const enqueue = useCallback(
    async (operation: RepOperation, body: Record<string, unknown>, targetId: string | null, labelAr: string) => {
      if (!isQueueable(operation)) return false;
      try {
        await enqueueVanOperation({
          operation,
          endpoint: actionEndpoint(operation, targetId),
          body,
          idempotencyKey: String(body.idempotencyKey ?? ''),
          label: labelAr,
          ...(deviceId ? { deviceId } : {}),
        });
        await refreshQueue();
        return true;
      } catch (error) {
        setStorageError(apiErrorText(error, 'تعذّر حفظ النيّة في التخزين المحلّي'));
        return false;
      }
    },
    [deviceId, refreshQueue],
  );

  /**
   * إرسالٌ واحدٌ لكلّ الإجراءات: حكمٌ قبل الإرسال (طابورٌ وصلاحية)، ثمّ إمّا الخادمُ أو
   * الطابور، وتصنيفُ النتيجة كما يصنّفها `classifyReplay` (فخطأُ الشبكة يُبقي النيّةَ
   * معلّقة ولا يرفضها محليًّا).
   */
  const submit = useCallback(
    async (input: {
      operation: RepOperation;
      body: Record<string, unknown>;
      targetId?: string | null;
      labelAr: string;
      successAr: string;
      after?: () => void;
    }) => {
      const { operation, body, targetId = null, labelAr, successAr, after } = input;
      const verdict = queueVerdict({ online, operation, can, targetId });
      if (verdict.blocked.length > 0) {
        setNotice({ kind: 'danger', text: verdict.blocked.join(' · ') });
        return;
      }
      setBusy(true);
      try {
        if (!online && isQueueable(operation)) {
          const stored = await enqueue(operation, body, targetId, labelAr);
          setNotice(
            stored
              ? { kind: 'warn', text: REP_QUEUE_MESSAGES.storedOffline(labelAr) }
              : { kind: 'danger', text: 'لا شبكة، وتعذّر حفظُ النيّة محليًّا — فلم تُسجَّل. أعد المحاولة.' },
          );
          return;
        }
        await apiPost(actionEndpoint(operation, targetId), body);
        setNotice({ kind: 'ok', text: successAr });
        after?.();
        await load();
        await refreshQueue();
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        const outcome = classifyReplay({
          status: apiError?.status ?? null,
          code: apiError?.code ?? null,
          detail: apiError ? apiErrorText(apiError) : null,
        });
        // ‏خطأُ شبكةٍ على نيّةٍ قابلةٍ للحفظ ⇒ تُحفظ ولا تضيع (وهذا هو معنى الطابور).
        if (outcome.nextStatus === 'pending' && isQueueable(operation)) {
          const stored = await enqueue(operation, body, targetId, labelAr);
          setNotice({
            kind: stored ? 'warn' : 'danger',
            text: stored
              ? `تعذّر الوصول إلى الخادم (${outcome.reasonAr}) — حُفظت النيّةُ في الطابور وستُرسل بمفتاحها نفسه.`
              : `تعذّر الوصول إلى الخادم وتعذّر حفظُ النيّة محليًّا — فلم تُسجَّل. ${outcome.reasonAr}`,
          });
          return;
        }
        setNotice({ kind: 'danger', text: outcome.reasonAr });
      } finally {
        setBusy(false);
      }
    },
    [can, enqueue, load, online, refreshQueue],
  );

  const replayQueue = useCallback(async () => {
    const plan = syncPlan(queue);
    if (plan.length === 0) {
      setNotice({ kind: 'warn', text: 'لا نيّاتٍ معلّقة في الطابور.' });
      return;
    }
    if (!online) {
      setNotice({ kind: 'warn', text: 'لا شبكة بعد — فالطابورُ ينتظر عودة الاتصال ولا يُرسل عمياءً.' });
      return;
    }
    setBusy(true);
    let sent = 0;
    let refused = 0;
    for (const record of plan) {
      try {
        await apiPost(record.endpoint, record.body);
        await updateVanQueueRecord(record.offlineId, {
          status: 'synced',
          attempts: record.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastStatusCode: 201,
          lastErrorCode: null,
          lastMessage: 'وصلت النيّةُ إلى الخادم.',
        });
        sent += 1;
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null;
        const outcome = classifyReplay({
          status: apiError?.status ?? null,
          code: apiError?.code ?? null,
          detail: apiError ? apiErrorText(apiError) : null,
        });
        await updateVanQueueRecord(record.offlineId, {
          status: outcome.nextStatus,
          attempts: record.attempts + 1,
          lastAttemptAt: new Date().toISOString(),
          lastStatusCode: apiError?.status ?? null,
          lastErrorCode: apiError?.code ?? null,
          lastMessage: outcome.reasonAr,
        });
        if (outcome.nextStatus === 'refused') refused += 1;
        // ‏والشبكةُ ما زالت مقطوعةً ⇒ لا فائدةَ من إكمال الدورة على بقية النيّات.
        if (outcome.nextStatus === 'pending') break;
      }
    }
    await refreshQueue();
    await load();
    setNotice({
      kind: refused > 0 ? 'warn' : 'ok',
      text: `أُعيد إرسال ${sent} نيّة${refused > 0 ? `، و${refused} رفضها الخادمُ برسالته المعروضة في القائمة` : ''}.`,
    });
    setBusy(false);
  }, [load, online, queue, refreshQueue]);

  const dropSynced = useCallback(async () => {
    const removed = await clearSyncedVanQueue();
    await refreshQueue();
    setNotice({ kind: 'ok', text: `حُذفت ${removed} نيّةً وصلت إلى الخادم. والمرفوضُ يبقى حتى تقرّر فيه.` });
  }, [refreshQueue]);

  const clearStorage = useCallback(async () => {
    const result = await resetOfflineStorage();
    if (!result.cleared) {
      setNotice({
        kind: 'danger',
        text: `لم يُمسح التخزين: في الطابور ${result.pendingVanQueue} نيّةً لم تصل إلى الخادم بعد. فأعِد إرسالَها أولًا — فالمسحُ يُنسيها ولا يُسجّلها.`,
      });
      return;
    }
    setQueue([]);
    setDeviceId(await getOrCreateDeviceId().catch(() => null));
    setNotice({ kind: 'ok', text: 'مُسح التخزينُ المحلّي (وبقيت هويّةُ الجهاز إن وُجدت).' });
  }, []);

  const salePayload = buildDocumentPayload(saleDraft);
  const saleVerdict = documentVerdict(saleDraft, { canOverride: false });
  const saleQueueVerdict = queueVerdict({ online, operation: 'document', can, targetId: saleDraft.loadOrderId });
  const returnPayload = buildReturnPayload(returnDraft);
  const returnQueueVerdict = queueVerdict({
    online,
    operation: 'return',
    can,
    targetId: returnDraft.documentId,
  });
  const collectionPayload = buildCollectionPayload(collectionDraft);
  const collectionQueueVerdict = queueVerdict({
    online,
    operation: 'collection',
    can,
    targetId: collectionDraft.documentId,
  });
  const closingQuantities: CustodyQuantities = {
    loadedQty: closingTarget?.loadedQty ?? '0',
    receivedQty: closingTarget?.receivedQty ?? '0',
    soldQty: closingTarget?.soldQty ?? '0',
    bonusQty: closingTarget?.bonusQty ?? '0',
  };
  const closingVerdict = buildClosingPayload(
    {
      ...closingDraft,
      // ‏دلالةُ العدّ (قرارُ المالك ٩): حقلٌ واحدٌ لا اثنان — وجمعهما يرفضه الخادم ٤٢٢.
      actualRemainingQty: countMode === 'per-order' ? closingDraft.actualRemainingQty : '',
      vehicleCountQty: countMode === 'whole-vehicle' ? closingDraft.vehicleCountQty : '',
    },
    closingQuantities,
  );
  const closingQueueVerdict = queueVerdict({
    online,
    operation: 'closing',
    can,
    targetId: closingTarget?.id ?? null,
  });
  const receiptVerdict = buildReceiptPayload({
    ...receiptDraft,
    loadedQty: receiptTarget?.loadedQty ?? '0',
  });
  const receiptQueueVerdict = queueVerdict({
    online,
    operation: 'receipt',
    can,
    targetId: receiptTarget?.id ?? null,
  });

  if (!canView) {
    return (
 <section className="rep-page">
 <div className="rep-card">
 <h1 className="rep-card-title">تطبيقُ المندوب</h1>
 <p className="rep-card-sub">لا صلاحيةَ لقراءة مساحة عمل المندوب في هذا الحساب.</p>
 <p className="rep-note" data-tone="danger">
            {REP_QUEUE_MESSAGES.permissionRequired([REP_WORKSPACE_PERMISSION])}
 </p>
 </div>
 </section>
    );
  }

  return (
 <section className="rep-page">
      {/**
        * شريطُ الحالة اللاصق: ما يحتاج المندوبُ رؤيتَه **بلا تمرير** — من هو، وهل الشبكة
        * قائمة، وكم نيّةً في الطابور. فحالةُ الشبكة هي التي تقرّر ما يحدث عند الضغط (إرسالٌ أم حفظ)،
        * وإخفاؤُها يعني أن يضغط وهو لا يدري أنّ بيعه سيُحفظ محليًّا.
        */}
 <div className="rep-statusbar">
 <div className="rep-statusbar-id">
 <strong>{data?.isRep ? (data.salesmanName ?? 'المندوب') : 'تطبيقُ المندوب'}</strong>
 <small>
            {data?.isRep && data.vehiclePlate ? `🚐 ${data.vehiclePlate} · ` : ''}
 رصيدُ السيارة <span className="rep-num">{data?.custodyKg ?? '—'}</span> كجم · قيمة{' '}
 <span className="rep-num">{data?.custodyValue ?? '—'}</span>
 </small>
 </div>
 <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
 <span className="rep-pill" data-tone={online ? 'ok' : 'warn'}>
            {online ? '🟢 متصل' : '📴 دون اتصال'}
 </span>
 <span
            className="rep-pill"
            data-tone={counts.refused > 0 ? 'danger' : counts.pending > 0 ? 'warn' : 'ok'}
          >
 📥<span className="rep-num">{counts.pending}</span> معلّق
            {counts.refused > 0 ? (
 <>
                {' '}
                · <span className="rep-num">{counts.refused}</span> مرفوض
 </>
            ) : null}
 </span>
 <button type="button" className="rep-pill" onClick={() => void load()} disabled={loading}>
            {loading ? '⟳ …' : '⟳ تحديث'}
 </button>
 </div>
 </div>

      {!online ? (
 <p className="rep-note" data-tone="warn">
 📴لا شبكة: ما يُحفظ هو المستنداتُ والمرتجعاتُ والتحصيلات (بمفاتيح عدم تكرارٍ تُخزَّن
 معها فتُعاد بلا مستندٍ مكرَّر). وأمّا إغلاقُ الوردية وتأكيدُ الاستلام فلا يُحفظان —
 والسببُ معروضٌ عند كلّ زرٍّ منهما.
 </p>
      ) : null}
      {storageError ? (
 <p className="rep-note" data-tone="danger">
           ⚠️{storageError} — فلا تُحفظ نيّاتٌ دون اتصال في هذا المتصفّح.
 </p>
      ) : null}
      {loadError ? (
 <p className="rep-note" data-tone="danger">{loadError}</p>
      ) : null}
      {notice ? (
 <p className="rep-note" data-tone={notice.kind}>{notice.text}</p>
      ) : null}

      {/* The page title lives in the app chrome; the document still needs one real heading. */}
      <h1 className="sr-only">تطبيق المندوب</h1>

      {data && !data.isRep ? (
 <div className="rep-card">
 <h2 className="rep-card-title">⚠️ حسابك غير مرتبط ببطاقة مندوب</h2>
 <p className="rep-note" data-tone="warn">
            {data.message ??
              'حسابك غير مرتبط ببطاقة مندوب توزيع — اطلب من المحاسب ربطك من شاشة المندوبين.'}
 </p>
 </div>
      ) : null}

      {data?.isRep ? (
 <>
          {/* البطاقاتُ الأربع + فحصُ المعادلتين */}
 <div className="rep-card">
 <div>
 <h2 className="rep-card-title">يومُك بأرقام الخادم</h2>
 <p className="rep-card-sub">{notes.documents}</p>
 </div>
            {reconcileNote ? (
 <p className="rep-note" data-tone="danger">🔎 {reconcileNote}</p>
            ) : null}
 <div className="rep-tiles">
              {cards.map((card) => (
 <div key={card.key} className="rep-tile">
 <span className="rep-tile-label">{card.labelAr}</span>
 <span className="rep-tile-value">{card.valueText}</span>
 <span className="rep-tile-hint">{card.hintAr}</span>
 </div>
              ))}
 </div>
 </div>

          {/* الطابور */}
 <div className="rep-card">
 <div>
 <h2 className="rep-card-title">📴 نيّاتُك المحفوظة دون اتصال</h2>
 <p className="rep-card-sub">
                {queueSummaryLine(counts)} · {REP_QUEUE_MESSAGES.deviceLine(deviceId)}
 </p>
 </div>
 <div className="rep-actions">
 <button
                type="button"
                className="rep-btn"
                data-variant="primary"
                disabled={busy || counts.pending === 0}
                onClick={() => void replayQueue()}
              >
 ♻️أعد إرسال المعلّق (<span className="rep-num">{counts.pending}</span>)
 </button>
 <button
                type="button"
                className="rep-btn"
                disabled={busy || counts.synced === 0}
                onClick={() => void dropSynced()}
              >
 🧹احذف ما وصل (<span className="rep-num">{counts.synced}</span>)
 </button>
 <button
                type="button"
                className="rep-btn"
                data-variant="danger"
                disabled={busy}
                onClick={() => void clearStorage()}
              >
 مسحُ التخزين المحلّي
 </button>
 </div>
            {queue.length > 0 ? (
 <div className="rep-rows">
                {queue.map((record) => (
 <div key={record.offlineId} className="rep-row">
 <div className="rep-row-main">
 <span>
                        {OPERATION_LABELS[record.operation]}
                        {record.label ? ` — ${record.label}` : ''}
 </span>
 <span
                        className="rep-pill"
                        data-tone={
                          record.status === 'synced' ? 'ok' : record.status === 'refused' ? 'danger' : 'warn'
                        }
                      >
                        {record.status === 'pending' ? '⏳ معلّقة' : record.status === 'synced' ? ' وصلت' : ' مرفوضة'}
 </span>
 </div>
 <div className="rep-row-meta">
 <span>
 محاولات <span className="rep-num">{record.attempts}</span>
 </span>
 <span className="rep-num">{record.endpoint}</span>
 </div>
 <div className="rep-row-meta">
 <span className="rep-num" title="مفتاحُ عدم التكرار — يُخزَّن مع النيّة فتُعاد بلا تكرار">
                         🔑{record.idempotencyKey}
 </span>
 </div>
                    {record.lastMessage ? (
 <p
                        className="rep-note"
                        data-tone={record.status === 'refused' ? 'danger' : undefined}
                      >
                        {record.lastMessage}
 </p>
                    ) : null}
 </div>
                ))}
 </div>
            ) : (
 <p className="rep-empty">{REP_QUEUE_MESSAGES.nothingQueued}</p>
            )}
 </div>

          {/* توريداتٌ بانتظار الاستلام */}
 <div className="rep-card">
 <div>
 <h2 className="rep-card-title">
 🚚توريداتٌ بانتظار تأكيد استلامك (<span className="rep-num">{data.pendingReceipts.length}</span>)
 </h2>
 <p className="rep-card-sub">
 قائمةٌ كاملةٌ بلا نافذة (استعلامُها بلا LIMIT) — فكلُّ توريدٍ لك معروض.
 </p>
 </div>
            {data.pendingReceipts.length === 0 ? (
 <p className="rep-empty">لا توريدَ بانتظارك.</p>
            ) : (
 <div className="rep-rows">
                {data.pendingReceipts.map((row) => (
 <div key={row.id} className="rep-row">
 <div className="rep-row-main">
 <span className="rep-num">{row.number}</span>
 <span className="rep-pill" data-tone="warn">
 محمَّل <span className="rep-num">{numberText(row.loadedQty)}</span> كجم
 </span>
 </div>
 <div className="rep-row-meta">
 <span>{row.loadDate}</span>
 <span>
                        {row.itemName} ← {row.fromWarehouseName}
 </span>
 </div>
 <div className="rep-row-actions">
 <button
                        type="button"
                        className="rep-btn"
                        onClick={() => {
                          setReceiptTarget(row);
                          setReceiptDraft({ receivedQty: row.loadedQty, notes: '', loadedQty: row.loadedQty });
                        }}
                      >
 ✅تأكيدُ الاستلام
 </button>
 </div>
 </div>
                ))}
 </div>
            )}

            {receiptTarget ? (
 <div className="rep-card" style={{ background: 'var(--inset)' }}>
 <h3 className="rep-card-title">
 ✅تأكيدُ استلام {receiptTarget.number} (المحمَّل{' '}
 <span className="rep-num">{numberText(receiptTarget.loadedQty)}</span> كجم)
 </h3>
                {receiptQueueVerdict.blocked.map((line) => (
 <p key={line} className="rep-note" data-tone="danger">{line}</p>
                ))}
 <div className="rep-fields">
 <label className="rep-field">
 <span>المستلَم فعليًّا (كجم)</span>
 <input
                      inputMode="decimal"
                      className="rep-num"
                      value={receiptDraft.receivedQty}
                      onChange={(event) => setReceiptDraft({ ...receiptDraft, receivedQty: event.target.value })}
                    />
 </label>
 <label className="rep-field">
 <span>ملاحظات</span>
 <input
                      value={receiptDraft.notes}
                      onChange={(event) => setReceiptDraft({ ...receiptDraft, notes: event.target.value })}
                    />
 </label>
 </div>
                {receiptVerdict.ok ? null : (
 <p className="rep-note" data-tone="danger">{receiptVerdict.message}</p>
                )}
                {receiptVerdict.ok && receiptVerdict.usesLoadedQty ? (
 <p className="rep-note" data-tone="warn">ستُستعمل الكميةُ المحمَّلة كما هي.</p>
                ) : null}
 <div className="rep-actions">
 <button
                    type="button"
                    className="rep-btn"
                    data-variant="primary"
                    disabled={busy || !receiptVerdict.ok || receiptQueueVerdict.blocked.length > 0}
                    onClick={() =>
                      void submit({
                        operation: 'receipt',
                        body: receiptVerdict.ok ? (receiptVerdict.payload as Record<string, unknown>) : {},
                        targetId: receiptTarget.id,
                        labelAr: receiptTarget.number,
                        successAr: `تم تأكيد استلام ${receiptDraft.receivedQty} كجم ودخولها رصيدَ سيارتك الرسميّ.`,
                        after: () => {
                          setReceiptTarget(null);
                          setReceiptDraft({ receivedQty: '', notes: '', loadedQty: '0' });
                        },
                      })
                    }
                  >
 تأكيدُ الاستلام
 </button>
 <button type="button" className="rep-btn" onClick={() => setReceiptTarget(null)}>
 إلغاء
 </button>
 </div>
 </div>
            ) : null}
 </div>

          {/* بيع */}
 <div className="rep-card">
 <div>
 <h2 className="rep-card-title">🧾 تسجيل بيعٍ وإصدار فاتورة</h2>
 <p className="rep-card-sub">
 الحكمُ الماليّ من `documentVerdict` نفسه وحكمُ الطابور من `queueVerdict` — والخادمُ
 هو المُصدر، فالمنعُ هنا قولٌ لا ضبط.
 </p>
 </div>
            {!canInvoice ? (
 <p className="rep-note" data-tone="danger">
                {REP_QUEUE_MESSAGES.permissionRequired([REP_PERMISSIONS.invoice])}
 </p>
            ) : (
 <>
 <div className="rep-fields">
 <label className="rep-field">
 <span>أمرُ التحميل / عهدتك</span>
 <select
                      value={saleDraft.loadOrderId}
                      onChange={(event) => setSaleDraft({ ...saleDraft, loadOrderId: event.target.value })}
                    >
 <option value="">اختر أمرًا</option>
                      {saleable.map((row) => (
 <option key={row.id} value={row.id}>
                          {row.number} — متبقٍّ {numberText(row.expectedRemainingQty)} كجم ({row.itemName})
 </option>
                      ))}
 </select>
 </label>
 <label className="rep-field">
 <span>العميل (بطاقة) — أو اتركه للعميل النقدي</span>
 <select
                      value={saleDraft.partyId}
                      onChange={(event) => setSaleDraft({ ...saleDraft, partyId: event.target.value })}
                    >
 <option value="">بلا بطاقة (عميل نقدي)</option>
                      {parties.map((row) => (
 <option key={row.id} value={row.id}>
                          {partyLabel(row)}
 </option>
                      ))}
 </select>
 </label>
                  {partiesError ? <p className="rep-note" data-tone="warn">{partiesError}</p> : null}
                  {!saleDraft.partyId ? (
 <label className="rep-field">
 <span>اسم العميل النقدي</span>
 <input
                        value={saleDraft.customerName}
                        onChange={(event) => setSaleDraft({ ...saleDraft, customerName: event.target.value })}
                      />
 </label>
                  ) : null}
 <label className="rep-field">
 <span>الكمية المباعة (كجم)</span>
 <input
                      inputMode="decimal"
                      className="rep-num"
                      value={saleDraft.soldQty}
                      onChange={(event) => setSaleDraft({ ...saleDraft, soldQty: event.target.value })}
                    />
 </label>
 <label className="rep-field">
 <span>سعرُ البيع للكيلو (اختياريّ — وإلا فسعرُ العميل المثبّت)</span>
 <input
                      inputMode="decimal"
                      className="rep-num"
                      value={saleDraft.unitPrice}
                      onChange={(event) => setSaleDraft({ ...saleDraft, unitPrice: event.target.value })}
                    />
 </label>
 <label className="rep-field">
 <span>كميةٌ مجانية (بونص)</span>
 <input
                      inputMode="decimal"
                      className="rep-num"
                      value={saleDraft.bonusQty}
                      onChange={(event) => setSaleDraft({ ...saleDraft, bonusQty: event.target.value })}
                    />
 </label>
 <label className="rep-field">
 <span>سببُ البونص (مطلوبٌ إن وُجد)</span>
 <input
                      value={saleDraft.bonusReason}
                      onChange={(event) => setSaleDraft({ ...saleDraft, bonusReason: event.target.value })}
                    />
 </label>
 <label className="rep-field">
 <span>طريقةُ الدفع</span>
 <select
                      value={saleDraft.paymentMethod}
                      onChange={(event) =>
                        setSaleDraft({ ...saleDraft, paymentMethod: event.target.value as DocumentDraft['paymentMethod'] })
                      }
                    >
 <option value="cash">نقدي</option>
 <option value="card">شبكة</option>
 <option value="credit">آجل</option>
 </select>
 </label>
 <label className="rep-field">
 <span>وضعُ المستند</span>
 <select
                      value={saleDraft.invoiceMode}
                      onChange={(event) =>
                        setSaleDraft({ ...saleDraft, invoiceMode: event.target.value as DocumentDraft['invoiceMode'] })
                      }
                    >
 <option value="zatca_tax">فاتورة ضريبية (ZATCA)</option>
 <option value="internal_delivery">إشعار تسليم داخلي</option>
 </select>
 </label>
 </div>

                {[...saleVerdict.blocked, ...saleQueueVerdict.blocked].map((line) => (
 <p key={line} className="rep-note" data-tone="danger">{line}</p>
                ))}
                {[...saleVerdict.warnings, ...saleQueueVerdict.warnings].map((line) => (
 <p key={line} className="rep-note" data-tone="warn">{line}</p>
                ))}
 <div className="rep-actions">
 <button
                    type="button"
                    className="rep-btn"
                    data-variant="primary"
                    disabled={busy || saleVerdict.blocked.length > 0 || saleQueueVerdict.blocked.length > 0}
                    onClick={() => {
                      const key = saleKey.key(salePayload);
                      void submit({
                        operation: 'document',
                        body: bodyWithIdempotencyKey('document', salePayload as Record<string, unknown>, key),
                        labelAr: `${saleDraft.soldQty} كجم`,
                        successAr: 'صدر مستندُ البيع وخُصمت الكميةُ من رصيد سيارتك الرسميّ.',
                        after: () => {
                          setSaleDraft(emptyDocumentDraft());
                          saleKey.reset();
                        },
                      });
                    }}
                  >
                    {busy ? 'جارٍ الإرسال…' : online ? '🧾 إصدار المستند' : '💾 حفظُ النيّة في الطابور'}
 </button>
 </div>
 </>
            )}
 </div>

          {/* مستنداتك */}
 <div className="rep-card">
 <div>
 <h2 className="rep-card-title">📄 فواتيرُك ومستنداتُك</h2>
 <p className="rep-card-sub">{notes.documents}</p>
 </div>
            {data.documents.length === 0 ? (
 <p className="rep-empty">لا مستنداتَ لك في هذه النافذة.</p>
            ) : (
 <div className="rep-rows">
                {data.documents.map((row) => (
 <div key={row.id} className="rep-row">
 <div className="rep-row-main">
 <span className="rep-num">{row.number}</span>
 <span
                        className="rep-pill"
                        data-tone={row.documentKind === 'return' ? 'warn' : Number(row.outstanding) > 0 ? 'danger' : 'ok'}
                      >
                        {row.documentKind === 'return'
                          ? '↩ مرتجع'
                          : row.invoiceMode === 'zatca_tax'
                            ? '🧾 ضريبية'
                            : '📃 تسليم داخلي'}
 </span>
 </div>
 <div className="rep-row-meta">
 <span>{row.customerName || 'بلا اسم'}</span>
 <span>{row.docDate}</span>
 <span>
 الإجمالي <span className="rep-num">{numberText(row.total)}</span>
 </span>
 <span>
 المتبقّي <span className="rep-num">{numberText(row.outstanding)}</span>
 </span>
 </div>
 <div className="rep-row-actions">
                      {row.documentKind === 'sale' && canInvoice ? (
 <button
                          type="button"
                          className="rep-btn"
                          onClick={() => setReturnDraft({ documentId: row.id, returnedQty: '', reason: '', notes: '' })}
                        >
                          ↩ مرتجع
 </button>
                      ) : null}
                      {Number(row.outstanding) > 0 && canCollect ? (
 <button
                          type="button"
                          className="rep-btn"
                          onClick={() =>
                            setCollectionDraft({
                              ...emptyCollectionDraft(),
                              documentId: row.id,
                              collectedAmount: row.outstanding,
                            })
                          }
                        >
 💵تحصيل
 </button>
                      ) : null}
 </div>
 </div>
                ))}
 </div>
            )}

            {returnDraft.documentId ? (
 <div className="rep-card" style={{ background: 'var(--inset)' }}>
 <h3 className="rep-card-title">
                  ↩ مرتجعٌ على{' '}
                  {returnable.find((row) => row.id === returnDraft.documentId)?.number ?? returnDraft.documentId}
 </h3>
 <p className="rep-card-sub">
                  {returnCeilingText(
                    returnable.find((row) => row.id === returnDraft.documentId) ??
                      returnableDocuments(data.documents)[0] ??
                      ({} as never),
                  )}
 </p>
                {returnQueueVerdict.blocked.map((line) => (
 <p key={line} className="rep-note" data-tone="danger">{line}</p>
                ))}
                {returnQueueVerdict.warnings.map((line) => (
 <p key={line} className="rep-note" data-tone="warn">{line}</p>
                ))}
 <div className="rep-fields">
 <label className="rep-field">
 <span>الكمية المرتجعة (كجم)</span>
 <input
                      inputMode="decimal"
                      className="rep-num"
                      value={returnDraft.returnedQty}
                      onChange={(event) => setReturnDraft({ ...returnDraft, returnedQty: event.target.value })}
                    />
 </label>
 <label className="rep-field">
 <span>السبب</span>
 <input
                      value={returnDraft.reason}
                      onChange={(event) => setReturnDraft({ ...returnDraft, reason: event.target.value })}
                    />
 </label>
 </div>
 <div className="rep-actions">
 <button
                    type="button"
                    className="rep-btn"
                    data-variant="primary"
                    disabled={busy || returnQueueVerdict.blocked.length > 0 || !returnDraft.returnedQty}
                    onClick={() => {
                      const key = returnKey.key(returnPayload);
                      void submit({
                        operation: 'return',
                        body: bodyWithIdempotencyKey('return', returnPayload as Record<string, unknown>, key),
                        targetId: returnDraft.documentId,
                        labelAr: `${returnDraft.returnedQty} كجم`,
                        successAr: 'سُجِّل المرتجعُ وعادت البضاعةُ إلى رصيد سيارتك الرسميّ بإشعارٍ دائن.',
                        after: () => {
                          setReturnDraft({ documentId: '', returnedQty: '', reason: '', notes: '' });
                          returnKey.reset();
                        },
                      });
                    }}
                  >
                    {online ? 'تسجيلُ المرتجع' : '💾 حفظُ المرتجع في الطابور'}
 </button>
 <button
                    type="button"
                    className="rep-btn"
                    onClick={() => setReturnDraft({ documentId: '', returnedQty: '', reason: '', notes: '' })}
                  >
 إلغاء
 </button>
 </div>
 </div>
            ) : null}

            {collectionDraft.documentId ? (
 <div className="rep-card" style={{ background: 'var(--inset)' }}>
 <h3 className="rep-card-title">💵 تحصيلُ مديونية</h3>
                {collectionQueueVerdict.blocked.map((line) => (
 <p key={line} className="rep-note" data-tone="danger">{line}</p>
                ))}
                {collectionQueueVerdict.warnings.map((line) => (
 <p key={line} className="rep-note" data-tone="warn">{line}</p>
                ))}
 <div className="rep-fields">
 <label className="rep-field">
 <span>المبلغ المحصَّل</span>
 <input
                      inputMode="decimal"
                      className="rep-num"
                      value={collectionDraft.collectedAmount}
                      onChange={(event) => setCollectionDraft({ ...collectionDraft, collectedAmount: event.target.value })}
                    />
 </label>
 </div>
 <div className="rep-actions">
 <button
                    type="button"
                    className="rep-btn"
                    data-variant="primary"
                    disabled={busy || collectionQueueVerdict.blocked.length > 0 || !collectionDraft.collectedAmount}
                    onClick={() => {
                      const key = collectionKey.key(collectionPayload);
                      void submit({
                        operation: 'collection',
                        body: bodyWithIdempotencyKey('collection', collectionPayload as Record<string, unknown>, key),
                        labelAr: `${collectionDraft.collectedAmount} ريال`,
                        successAr: 'سُجِّل التحصيلُ وأُصدر سندُ القبض الرسميّ.',
                        after: () => {
                          setCollectionDraft(emptyCollectionDraft());
                          collectionKey.reset();
                        },
                      });
                    }}
                  >
                    {online ? 'تأكيدُ التحصيل' : '💾 حفظُ التحصيل في الطابور'}
 </button>
 <button type="button" className="rep-btn" onClick={() => setCollectionDraft(emptyCollectionDraft())}>
 إلغاء
 </button>
 </div>
 </div>
            ) : null}
 </div>

          {/* إغلاق الوردية */}
 <div className="rep-card">
 <div>
 <h2 className="rep-card-title">🔒 إغلاقُ الوردية وتصفيةُ العهدة</h2>
 <p className="rep-card-sub">{notes.loadOrders}</p>
 </div>
            {data.loadOrders.length === 0 ? (
 <p className="rep-empty">لا أوامرَ لك في هذه النافذة.</p>
            ) : (
 <div className="rep-rows">
                {data.loadOrders.map((row) => {
                  const serverNotes = [receiptShortfallText(row), closingShortageText(row), row.stockSettlementNote]
                    .filter((line): line is string => Boolean(line));
                  return (
 <div key={row.id} className="rep-row">
 <div className="rep-row-main">
 <span className="rep-num">{row.number}</span>
 <span
                          className="rep-pill"
                          data-tone={
                            row.status === 'settled'
                              ? 'ok'
                              : row.status === 'pending_closing'
                                ? 'warn'
                                : row.status === 'loaded'
                                  ? undefined
                                  : 'danger'
                          }
                        >
                          {row.status}
 </span>
 </div>
 <div className="rep-row-meta">
 <span>{row.itemName}</span>
 <span>
 المتوقَّع أن يبقى <span className="rep-num">{numberText(row.expectedRemainingQty)}</span> كجم
 </span>
 <span>
 نقدٌ متبقٍّ <span className="rep-num">{numberText(row.outstandingCash)}</span>
 </span>
 </div>
                      {serverNotes.length > 0 ? (
 <p className="rep-note" data-tone="warn">{serverNotes.join(' · ')}</p>
                      ) : null}
 <div className="rep-row-actions">
                        {canClose && row.status === 'loaded' ? (
 <button
                            type="button"
                            className="rep-btn"
                            onClick={() => {
                              setClosingTarget(row);
                              setClosingDraft({
                                returnedQty: row.returnedQty,
                                damagedQty: row.damagedQty,
                                damageReason: '',
                                collectedCash: row.collectedCash,
                                actualRemainingQty: '',
                                vehicleCountQty: '',
                                otherCustodyInVanQty: '',
                                closingNotes: '',
                              });
                            }}
                          >
 🔒تقديمُ الإغلاق
 </button>
                        ) : null}
 </div>
 </div>
                  );
                })}
 </div>
            )}

            {closingTarget ? (
 <div className="rep-card" style={{ background: 'var(--inset)' }}>
 <h3 className="rep-card-title">
 🔒تقديمُ إغلاق {closingTarget.number} — المتوقَّع أن يبقى{' '}
 <span className="rep-num">{numberText(closingTarget.expectedRemainingQty)}</span> كجم
 </h3>
                {closingQueueVerdict.blocked.map((line) => (
 <p key={line} className="rep-note" data-tone="danger">{line}</p>
                ))}
                {!online ? (
 <p className="rep-note" data-tone="warn">{NOT_QUEUEABLE_OPERATIONS.closing.reasonAr}</p>
                ) : null}
 <div className="rep-fields">
 <label className="rep-field">
 <span>دلالةُ العدّ (قرارُ المالك: العددُ للمركبة كلّها)</span>
 <select
                      value={countMode}
                      onChange={(event) => setCountMode(event.target.value as 'whole-vehicle' | 'per-order')}
                    >
 <option value="whole-vehicle">عددُ الصنف في السيارة كلّها (يشتقّ الخادمُ نصيبَ هذا الأمر)</option>
 <option value="per-order">نصيبُ هذا الأمر وحده</option>
 </select>
 </label>
 <label className="rep-field">
 <span>
                      {countMode === 'whole-vehicle' ? 'عددُ المركبة كلّها (كجم)' : 'المتبقّي الفعليّ لهذا الأمر (كجم)'}
 </span>
 <input
                      inputMode="decimal"
                      className="rep-num"
                      value={countMode === 'whole-vehicle' ? closingDraft.vehicleCountQty : closingDraft.actualRemainingQty}
                      onChange={(event) =>
                        setClosingDraft(
                          countMode === 'whole-vehicle'
                            ? { ...closingDraft, vehicleCountQty: event.target.value }
                            : { ...closingDraft, actualRemainingQty: event.target.value },
                        )
                      }
                    />
 </label>
 <label className="rep-field">
 <span>مرتجعٌ سليم (كجم)</span>
 <input
                      inputMode="decimal"
                      className="rep-num"
                      value={closingDraft.returnedQty}
                      onChange={(event) => setClosingDraft({ ...closingDraft, returnedQty: event.target.value })}
                    />
 </label>
 <label className="rep-field">
 <span>تالف (كجم)</span>
 <input
                      inputMode="decimal"
                      className="rep-num"
                      value={closingDraft.damagedQty}
                      onChange={(event) => setClosingDraft({ ...closingDraft, damagedQty: event.target.value })}
                    />
 </label>
 <label className="rep-field">
 <span>سببُ التلف (مطلوبٌ إن كان التالفُ أكثرَ من صفر)</span>
 <input
                      value={closingDraft.damageReason}
                      onChange={(event) => setClosingDraft({ ...closingDraft, damageReason: event.target.value })}
                    />
 </label>
 <label className="rep-field">
 <span>نقدٌ محصَّل للوردية</span>
 <input
                      inputMode="decimal"
                      className="rep-num"
                      value={closingDraft.collectedCash}
                      onChange={(event) => setClosingDraft({ ...closingDraft, collectedCash: event.target.value })}
                    />
 </label>
 <label className="rep-field">
 <span>ملاحظاتُ الإغلاق</span>
 <input
                      value={closingDraft.closingNotes}
                      onChange={(event) => setClosingDraft({ ...closingDraft, closingNotes: event.target.value })}
                    />
 </label>
 </div>
                {countMode === 'whole-vehicle' ? (
 <p className="rep-note" data-tone="warn">
 يخصم الخادمُ من عددِ المركبة عهدةَ الأوامر الأخرى الجالسة في السيارة نفسها —
 وحمولةُ المندوب لا تحمل تلك العهدة، فالحكمُ له لا لهذه الشاشة.
 </p>
                ) : null}
                {closingVerdict.ok ? null : (
 <p className="rep-note" data-tone="danger">{closingVerdict.message}</p>
                )}
 <div className="rep-actions">
 <button
                    type="button"
                    className="rep-btn"
                    data-variant="primary"
                    disabled={busy || !closingVerdict.ok || closingQueueVerdict.blocked.length > 0 || !canClose}
                    onClick={() =>
                      void submit({
                        operation: 'closing',
                        body: closingVerdict.ok ? (closingVerdict.payload as Record<string, unknown>) : {},
                        targetId: closingTarget.id,
                        labelAr: closingTarget.number,
                        successAr: 'قُدِّم إعلانُ الإغلاق إلى المحاسب — ولا يُشطب فرقٌ بلا اعتماده.',
                        after: () => setClosingTarget(null),
                      })
                    }
                  >
 تقديمُ الإغلاق
 </button>
 <button type="button" className="rep-btn" onClick={() => setClosingTarget(null)}>
 إلغاء
 </button>
 </div>
 </div>
            ) : null}
 </div>

          {/* أرصدة السيارة */}
 <div className="rep-card">
 <div>
 <h2 className="rep-card-title">📦 أرصدةُ أصناف سيارتك (من دفتر المخزون الرسمي)</h2>
 <p className="rep-card-sub">
 كاملةٌ بلا نافذة: فاستعلامُ الأرصدة بلا LIMIT — ولهذا لا مفتاحَ لها في `windows`.
 </p>
 </div>
            {data.balances.length === 0 ? (
 <p className="rep-empty">لا رصيدَ في سيارتك الآن.</p>
            ) : (
 <div className="rep-rows">
                {data.balances.map((row) => (
 <div key={`${row.warehouseId}:${row.itemId}`} className="rep-row">
 <div className="rep-row-main">
 <span>{row.itemName}</span>
 <span className="rep-pill">
 <span className="rep-num">{row.quantity}</span> كجم
 </span>
 </div>
 <div className="rep-row-meta">
 <span className="rep-num">{row.sku}</span>
 <span>
 القيمة <span className="rep-num">{row.value}</span>
 </span>
 <span>
 متوسطُ التكلفة <span className="rep-num">{row.averageCost}</span>
 </span>
 </div>
 </div>
                ))}
 </div>
            )}
 </div>

          {/* التحصيلات */}
 <div className="rep-card">
 <div>
 <h2 className="rep-card-title">💵 ما حصّلته</h2>
 <p className="rep-card-sub">{notes.collections}</p>
 </div>
            {data.collections.length === 0 ? (
 <p className="rep-empty">لا تحصيلَ في هذه النافذة.</p>
            ) : (
 <div className="rep-rows">
                {data.collections.map((row) => (
 <div key={row.id} className="rep-row">
 <div className="rep-row-main">
 <span className="rep-num">{numberText(row.amount)}</span>
 <span className="rep-pill" data-tone={row.voucherStatus === 'posted' ? 'ok' : 'warn'}>
                        {row.voucherNumber ?? 'بلا سند'} {row.voucherStatus ?? ''}
 </span>
 </div>
 <div className="rep-row-meta">
 <span>{row.collectedAt}</span>
 <span>{row.reason || '—'}</span>
 </div>
 </div>
                ))}
 </div>
            )}
 </div>

          {/* إشعارات */}
          {data.notifications.length > 0 ? (
 <div className="rep-card">
 <div>
 <h2 className="rep-card-title">🔔 إشعارات</h2>
 <p className="rep-card-sub">{notes.notifications}</p>
 </div>
 <div className="rep-rows">
                {data.notifications.map((row) => (
 <div key={row.id} className="rep-row">
 <div className="rep-row-main">
 <span>{String(row.payload.title ?? row.type)}</span>
 <span className="rep-pill" data-tone={row.read ? undefined : 'warn'}>
                        {row.read ? 'مقروء' : 'جديد'}
 </span>
 </div>
                    {row.payload.body ? (
 <div className="rep-row-meta">
 <span>{String(row.payload.body)}</span>
 </div>
                    ) : null}
 </div>
                ))}
 </div>
 </div>
          ) : null}

 <p className="rep-card-sub">
 قوائمُ هذه الشاشة نوافذُ الخادم: {notes.loadOrders} · وأمّا الأرصدةُ والتوريداتُ
 المعلّقة فكاملةٌ (بلا LIMIT في استعلاميهما). وفواتيرُ آجلةٌ بلا تحصيلٍ بعد:{' '}
 <span className="rep-num">{unpaidDocuments.length}</span> في هذه النافذة.
 </p>
 </>
      ) : null}
 </section>
  );
}
