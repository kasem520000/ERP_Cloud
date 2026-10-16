'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input } from '@erp/ui';
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

const NOTICE_CLASSES: Record<Notice['kind'], string> = {
  ok: 'border-ok-line bg-ok-soft text-ok-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
  warn: 'border-warn-line bg-warn-soft text-warn-ink',
};

const selectClass =
  'w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink';

/** عنوانُ كلّ إجراء كما يُقرأ في قائمة الطابور — لا رقمٌ داخليّ. */
const OPERATION_LABELS: Record<RepOperation, string> = {
  document: 'مستند بيع',
  return: 'مرتجع عميل',
  collection: 'تحصيل من عميل',
  closing: 'إغلاق الوردية',
  receipt: 'تأكيد استلام',
};

/**
 * 📱 تطبيقُ المندوب — `/rep`: مساحةُ عمله وإجراءاتُه، على الهاتف أولًا، متصلًا ومنقطعًا.
 *
 * والقواعدُ التي بُني عليها (وكلُّها مقاسةٌ في الخادم، وتفصيلُها في
 * `docs/BAKERY_APP_PHASE4_HANDOFF.md` §٤):
 *
 * 1. **سطحٌ رقيق**: الحمولةُ من `GET /van-sales/me` (والخادمُ يشتقّ المندوبَ من عضوية
 *    المتّصل فلا يفتح مندوبٌ عهدةَ غيره)، والأجسامُ من بانياتٍ قائمةٍ مقاسة
 *    (‏`buildDocumentPayload`, ‏`buildReturnPayload`, ‏`buildCollectionPayload`,
 *    `buildClosingPayload`, ‏`buildReceiptPayload`)، والأحكامُ المالية من `documentVerdict`
 *    وأحكامُ الطابور من `queueVerdict` — ولا قاعدةَ ولا رقمَ يُعاد حسابُه هنا.
 * 2. **نيّةٌ واحدةٌ مفتاحٌ واحد**: المفتاحُ من متتبّع `useSubmissionKey` (يثبت ما لم تتغيّر
 *    النيّة) ويُخزَّن **مع** الجسم في الطابور فتستعمله كلّ إعادة — والخادمُ يعيد ٢٠١ بلا
 *    أثرٍ ثانٍ (`if (existing) return this.dashboard(…)`).
 * 3. **الإقفالُ والاستلامُ لا يُحفظان منقطعَين**: فمساراهما بلا مفتاحٍ في الجسم، وإعادةٌ
 *    عمياء لإقفالٍ تعيد كتابةَ إعلان الجرد (والخادمُ لا يرفض إلا إذا صارت الحالةُ
 *    ‏`settled`). فالزرّان يُحظران منقطعَين **بسببٍ مقاسٍ معروض**، لا يُخفيان بصمت.
 * 4. **لا رقمَ يُخترع**: الأرقامُ من `totals`/‏`custody` (جدولُ المندوب كلّه) والقوائمُ نوافذُ
 *    يُقال عددُها من `windows`، والمعادلتان تُفحصان (`totalsReconcile`) فإن لم تُغلقا قيل.
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

  if (!canView) {
    return (
      <section className="grid gap-4">
        <Card>
          <CardHeader title="📱 تطبيق المندوب" subtitle="لا صلاحيةَ لقراءة مساحة عمل المندوب." />
          <CardBody>
            <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.danger}`}>
              {REP_QUEUE_MESSAGES.permissionRequired([REP_WORKSPACE_PERMISSION])}
            </p>
          </CardBody>
        </Card>
      </section>
    );
  }

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

  return (
    <section className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
            📱 تطبيقُ المندوب
          </h1>
          <p className="m-0 mt-1 text-[13px] text-muted">
            عهدتُك وأرصدةُ سيارتك الرسمية، توريداتُك بانتظار التأكيد، فواتيرُك وتحصيلاتُك
            وإغلاقُ ورديتك — كلّها من حسابك أنت (فالخادمُ يشتقّ المندوبَ من عضويتك، ولا يفتح
            مندوبٌ عهدةَ غيره). والأرقامُ من جدولك كلّه لا من القائمة المعروضة.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="bak-badge" dir="ltr">
            {online ? 'online' : 'offline'} · GET /van-sales/me
          </span>
          <Button disabled={loading} onClick={() => void load()} size="sm">
            تحديث
          </Button>
        </div>
      </header>

      {!online ? (
        <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.warn}`}>
          📴 لا شبكة: ما يُحفظ هو المستنداتُ والمرتجعاتُ والتحصيلات (بمفاتيح عدم تكرارٍ
          تُخزَّن معها). وأمّا إغلاقُ الوردية وتأكيدُ الاستلام فلا يُحفظان — والسببُ مع كلّ
          زرٍّ منهما.
        </p>
      ) : null}
      {storageError ? (
        <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.danger}`}>
          ⚠️ {storageError} — فلا تُحفظ نيّاتٌ دون اتصال في هذا المتصفّح.
        </p>
      ) : null}
      {loadError ? (
        <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES.danger}`}>
          {loadError}
        </p>
      ) : null}
      {notice ? (
        <p className={`m-0 rounded-[10px] border px-4 py-2.5 text-[13px] font-semibold ${NOTICE_CLASSES[notice.kind]}`}>
          {notice.text}
        </p>
      ) : null}

      {data && !data.isRep ? (
        <Card>
          <CardHeader title="⚠️ حسابك غير مرتبط ببطاقة مندوب" />
          <CardBody>
            <p className="m-0 text-[13px] text-muted">
              {data.message ??
                'حسابك غير مرتبط ببطاقة مندوب توزيع — اطلب من المحاسب ربطك من شاشة المندوبين.'}
            </p>
          </CardBody>
        </Card>
      ) : null}

      {data?.isRep ? (
        <>
          <Card>
            <CardHeader
              title={`${data.salesmanName ?? 'المندوب'}${data.vehiclePlate ? ` — 🚐 ${data.vehiclePlate}` : ''}`}
              subtitle={notes.documents}
            />
            <CardBody>
              {reconcileNote ? (
                <p className={`m-0 mb-3 rounded-[10px] border px-4 py-2.5 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                  🔎 {reconcileNote}
                </p>
              ) : null}
              <div className="m-0 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {cards.map((card) => (
                  <div key={card.key} className="rounded-[10px] border border-line bg-surface p-3">
                    <div className="m-0 text-[11.5px] font-bold text-muted">{card.labelAr}</div>
                    <div className="m-0 mt-1 text-[18px] font-extrabold text-ink" dir="ltr">
                      {card.valueText}
                    </div>
                    <div className="m-0 mt-1 text-[11.5px] text-muted">{card.hintAr}</div>
                  </div>
                ))}
              </div>
            </CardBody>
          </Card>

          {/* 📴 الطابور */}
          <Card>
            <CardHeader
              title="📴 نيّاتُك المحفوظة دون اتصال"
              subtitle={`${queueSummaryLine(counts)} · ${REP_QUEUE_MESSAGES.deviceLine(deviceId)}`}
            />
            <CardBody>
              <div className="flex flex-wrap gap-2">
                <Button disabled={busy || counts.pending === 0} onClick={() => void replayQueue()} size="sm">
                  ♻️ أعد إرسال المعلّق ({counts.pending})
                </Button>
                <Button disabled={busy || counts.synced === 0} onClick={() => void dropSynced()} size="sm" variant="secondary">
                  🧹 احذف ما وصل ({counts.synced})
                </Button>
                <Button disabled={busy} onClick={() => void clearStorage()} size="sm" variant="ghost">
                  مسحُ التخزين المحلّي
                </Button>
              </div>
              {queue.length > 0 ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-muted">
                        <th className="border-b border-line px-2 py-1.5 text-start">النيّة</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">الحالة</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">المسار</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">المفتاح</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">قولُ الخادم</th>
                      </tr>
                    </thead>
                    <tbody>
                      {queue.map((record) => (
                        <tr key={record.offlineId}>
                          <td className="border-b border-line px-2 py-1.5">
                            {OPERATION_LABELS[record.operation]}
                            {record.label ? ` — ${record.label}` : ''}
                          </td>
                          <td className="border-b border-line px-2 py-1.5">
                            {record.status === 'pending'
                              ? '⏳ معلّقة'
                              : record.status === 'synced'
                                ? '✅ وصلت'
                                : '⛔ مرفوضة'}
                            <span className="text-muted"> · محاولات {record.attempts}</span>
                          </td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {record.endpoint}
                          </td>
                          <td className="border-b border-line px-2 py-1.5 text-muted" dir="ltr">
                            {record.idempotencyKey}
                          </td>
                          <td className="border-b border-line px-2 py-1.5 text-muted">
                            {record.lastMessage ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="m-0 mt-3 text-[12.5px] text-muted">{REP_QUEUE_MESSAGES.nothingQueued}</p>
              )}
            </CardBody>
          </Card>

          {/* 🚚 توريداتٌ بانتظار الاستلام */}
          <Card>
            <CardHeader
              title={`🚚 توريداتٌ بانتظار تأكيد استلامك (${data.pendingReceipts.length})`}
              subtitle="قائمةٌ كاملةٌ بلا نافذة (استعلامُها بلا LIMIT) — فكلُّ توريدٍ لك معروض."
            />
            <CardBody>
              {data.pendingReceipts.length === 0 ? (
                <p className="m-0 text-[12.5px] text-muted">لا توريدَ بانتظارك.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-muted">
                        <th className="border-b border-line px-2 py-1.5 text-start">الأمر</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">التاريخ</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">المحمَّل</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">من</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.pendingReceipts.map((row) => (
                        <tr key={row.id}>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {row.number}
                          </td>
                          <td className="border-b border-line px-2 py-1.5">{row.loadDate}</td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {numberText(row.loadedQty)} كجم
                          </td>
                          <td className="border-b border-line px-2 py-1.5">
                            {row.itemName} ← {row.fromWarehouseName}
                          </td>
                          <td className="border-b border-line px-2 py-1.5">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setReceiptTarget(row);
                                setReceiptDraft({ receivedQty: row.loadedQty, notes: '', loadedQty: row.loadedQty });
                              }}
                            >
                              تأكيدُ الاستلام
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {receiptTarget ? (
                <div className="mt-3 grid gap-3 rounded-[10px] border border-line bg-surface p-3">
                  <div className="text-[13px] font-bold text-ink">
                    ✅ تأكيد استلام {receiptTarget.number} (المحمَّل {numberText(receiptTarget.loadedQty)} كجم)
                  </div>
                  {receiptQueueVerdict.blocked.map((line) => (
                    <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                      {line}
                    </p>
                  ))}
                  <Input
                    label="المستلَم فعليًّا (كجم)"
                    value={receiptDraft.receivedQty}
                    onChange={(event) => setReceiptDraft({ ...receiptDraft, receivedQty: event.target.value })}
                  />
                  <Input
                    label="ملاحظات"
                    value={receiptDraft.notes}
                    onChange={(event) => setReceiptDraft({ ...receiptDraft, notes: event.target.value })}
                  />
                  {receiptVerdict.ok ? null : (
                    <p className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                      {receiptVerdict.message}
                    </p>
                  )}
                  {receiptVerdict.ok && receiptVerdict.usesLoadedQty ? (
                    <p className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
                      ستُستعمل الكميةُ المحمَّلة كما هي.
                    </p>
                  ) : null}
                  <div className="flex gap-2">
                    <Button
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
                      size="sm"
                    >
                      تأكيدُ الاستلام
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setReceiptTarget(null)}>
                      إلغاء
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* 🧾 بيع */}
          <Card>
            <CardHeader
              title="🧾 تسجيل بيعٍ وإصدار فاتورة"
              subtitle="الحكمُ الماليّ من `documentVerdict` نفسه (لا نسخةَ منه هنا)، وحكمُ الطابور من `queueVerdict` — والخادمُ هو المُصدر."
            />
            <CardBody>
              {!canInvoice ? (
                <p className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                  {REP_QUEUE_MESSAGES.permissionRequired([REP_PERMISSIONS.invoice])}
                </p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1 text-[12.5px] text-muted">
                    أمرُ التحميل / عهدتك
                    <select
                      className={selectClass}
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
                  <label className="grid gap-1 text-[12.5px] text-muted">
                    العميل (بطاقة) — أو اتركه للعميل النقدي
                    <select
                      className={selectClass}
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
                  {partiesError ? <p className="m-0 text-[12px] text-muted">{partiesError}</p> : null}
                  {!saleDraft.partyId ? (
                    <Input
                      label="اسم العميل النقدي"
                      value={saleDraft.customerName}
                      onChange={(event) => setSaleDraft({ ...saleDraft, customerName: event.target.value })}
                    />
                  ) : null}
                  <Input
                    label="الكمية المباعة (كجم)"
                    value={saleDraft.soldQty}
                    onChange={(event) => setSaleDraft({ ...saleDraft, soldQty: event.target.value })}
                  />
                  <Input
                    label="سعر البيع للكيلو (اختياريّ — وإلا فسعرُ العميل المثبّت)"
                    value={saleDraft.unitPrice}
                    onChange={(event) => setSaleDraft({ ...saleDraft, unitPrice: event.target.value })}
                  />
                  <Input
                    label="كميةٌ مجانية (بونص)"
                    value={saleDraft.bonusQty}
                    onChange={(event) => setSaleDraft({ ...saleDraft, bonusQty: event.target.value })}
                  />
                  <Input
                    label="سببُ البونص (مطلوبٌ إن وُجد)"
                    value={saleDraft.bonusReason}
                    onChange={(event) => setSaleDraft({ ...saleDraft, bonusReason: event.target.value })}
                  />
                  <label className="grid gap-1 text-[12.5px] text-muted">
                    طريقةُ الدفع
                    <select
                      className={selectClass}
                      value={saleDraft.paymentMethod}
                      onChange={(event) =>
                        setSaleDraft({
                          ...saleDraft,
                          paymentMethod: event.target.value as DocumentDraft['paymentMethod'],
                        })
                      }
                    >
                      <option value="cash">نقدي</option>
                      <option value="card">شبكة</option>
                      <option value="credit">آجل</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-[12.5px] text-muted">
                    وضعُ المستند
                    <select
                      className={selectClass}
                      value={saleDraft.invoiceMode}
                      onChange={(event) =>
                        setSaleDraft({
                          ...saleDraft,
                          invoiceMode: event.target.value as DocumentDraft['invoiceMode'],
                        })
                      }
                    >
                      <option value="zatca_tax">فاتورة ضريبية (ZATCA)</option>
                      <option value="internal_delivery">إشعار تسليم داخلي</option>
                    </select>
                  </label>

                  <div className="sm:col-span-2 grid gap-2">
                    {[...saleVerdict.blocked, ...saleQueueVerdict.blocked].map((line) => (
                      <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                        {line}
                      </p>
                    ))}
                    {[...saleVerdict.warnings, ...saleQueueVerdict.warnings].map((line) => (
                      <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
                        {line}
                      </p>
                    ))}
                    <div>
                      <Button
                        disabled={
                          busy ||
                          saleVerdict.blocked.length > 0 ||
                          saleQueueVerdict.blocked.length > 0
                        }
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
                        size="sm"
                      >
                        {busy ? 'جارٍ الإرسال…' : online ? '🧾 إصدار المستند' : '💾 حفظُ النيّة في الطابور'}
                      </Button>
                    </div>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>

          {/* 📄 مستنداتك */}
          <Card>
            <CardHeader title="📄 فواتيرُك ومستنداتُك" subtitle={notes.documents} />
            <CardBody>
              {data.documents.length === 0 ? (
                <p className="m-0 text-[12.5px] text-muted">لا مستنداتَ لك في هذه النافذة.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-muted">
                        <th className="border-b border-line px-2 py-1.5 text-start">الرقم</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">النوع</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">العميل</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">الإجمالي</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">المتبقّي</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.documents.map((row) => (
                        <tr key={row.id}>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {row.number}
                          </td>
                          <td className="border-b border-line px-2 py-1.5">
                            {row.documentKind === 'return' ? '↩️ مرتجع' : row.invoiceMode === 'zatca_tax' ? '🧾 ضريبية' : '📃 تسليم داخلي'}
                          </td>
                          <td className="border-b border-line px-2 py-1.5">{row.customerName || '—'}</td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {numberText(row.total)}
                          </td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {numberText(row.outstanding)}
                          </td>
                          <td className="border-b border-line px-2 py-1.5">
                            <div className="flex gap-1">
                              {row.documentKind === 'sale' && canInvoice ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setReturnDraft({ documentId: row.id, returnedQty: '', reason: '', notes: '' })}
                                >
                                  ↩️ مرتجع
                                </Button>
                              ) : null}
                              {Number(row.outstanding) > 0 && canCollect ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() =>
                                    setCollectionDraft({
                                      ...emptyCollectionDraft(),
                                      documentId: row.id,
                                      collectedAmount: row.outstanding,
                                    })
                                  }
                                >
                                  💵 تحصيل
                                </Button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {returnDraft.documentId ? (
                <div className="mt-3 grid gap-3 rounded-[10px] border border-line bg-surface p-3">
                  <div className="text-[13px] font-bold text-ink">
                    ↩️ مرتجعٌ على {returnable.find((row) => row.id === returnDraft.documentId)?.number ?? returnDraft.documentId}
                  </div>
                  <p className="m-0 text-[12px] text-muted">
                    {returnCeilingText(
                      returnable.find((row) => row.id === returnDraft.documentId) ??
                        returnableDocuments(data.documents)[0] ??
                        ({} as never),
                    )}
                  </p>
                  {returnQueueVerdict.blocked.map((line) => (
                    <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                      {line}
                    </p>
                  ))}
                  {returnQueueVerdict.warnings.map((line) => (
                    <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
                      {line}
                    </p>
                  ))}
                  <Input
                    label="الكمية المرتجعة (كجم)"
                    value={returnDraft.returnedQty}
                    onChange={(event) => setReturnDraft({ ...returnDraft, returnedQty: event.target.value })}
                  />
                  <Input
                    label="السبب"
                    value={returnDraft.reason}
                    onChange={(event) => setReturnDraft({ ...returnDraft, reason: event.target.value })}
                  />
                  <div>
                    <Button
                      size="sm"
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
                      تسجيلُ المرتجع
                    </Button>
                  </div>
                </div>
              ) : null}

              {collectionDraft.documentId ? (
                <div className="mt-3 grid gap-3 rounded-[10px] border border-line bg-surface p-3">
                  <div className="text-[13px] font-bold text-ink">💵 تحصيلُ مديونية</div>
                  {collectionQueueVerdict.blocked.map((line) => (
                    <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                      {line}
                    </p>
                  ))}
                  {collectionQueueVerdict.warnings.map((line) => (
                    <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
                      {line}
                    </p>
                  ))}
                  <Input
                    label="المبلغ المحصَّل"
                    value={collectionDraft.collectedAmount}
                    onChange={(event) => setCollectionDraft({ ...collectionDraft, collectedAmount: event.target.value })}
                  />
                  <div>
                    <Button
                      size="sm"
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
                      تأكيدُ التحصيل
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* 🔒 إغلاق الوردية */}
          <Card>
            <CardHeader title="🔒 إغلاقُ الوردية وتصفيةُ العهدة" subtitle={notes.loadOrders} />
            <CardBody>
              {data.loadOrders.length === 0 ? (
                <p className="m-0 text-[12.5px] text-muted">لا أوامرَ لك في هذه النافذة.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-muted">
                        <th className="border-b border-line px-2 py-1.5 text-start">الأمر</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">الحالة</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">المتوقَّع أن يبقى</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">نقدٌ متبقٍّ</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">ملاحظات الخادم</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">إجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.loadOrders.map((row) => (
                        <tr key={row.id}>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {row.number}
                          </td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {row.status}
                          </td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {numberText(row.expectedRemainingQty)} كجم
                          </td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {numberText(row.outstandingCash)}
                          </td>
                          <td className="border-b border-line px-2 py-1.5 text-muted">
                            {[receiptShortfallText(row), closingShortageText(row), row.stockSettlementNote]
                              .filter((line): line is string => Boolean(line))
                              .join(' · ') || '—'}
                          </td>
                          <td className="border-b border-line px-2 py-1.5">
                            {canClose && row.status === 'loaded' ? (
                              <Button
                                size="sm"
                                variant="secondary"
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
                                تقديمُ الإغلاق
                              </Button>
                            ) : (
                              <span className="text-muted" dir="ltr">
                                {row.status}
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {closingTarget ? (
                <div className="mt-3 grid gap-3 rounded-[10px] border border-line bg-surface p-3">
                  <div className="text-[13px] font-bold text-ink">
                    🔒 تقديمُ إغلاق {closingTarget.number} — المتوقَّع أن يبقى{' '}
                    <span dir="ltr">{numberText(closingTarget.expectedRemainingQty)}</span> كجم
                  </div>
                  {closingQueueVerdict.blocked.map((line) => (
                    <p key={line} className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                      {line}
                    </p>
                  ))}
                  {!online ? (
                    <p className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.warn}`}>
                      {NOT_QUEUEABLE_OPERATIONS.closing.reasonAr}
                    </p>
                  ) : null}
                  <label className="grid gap-1 text-[12.5px] text-muted">
                    دلالةُ العدّ (قرارُ المالك: العددُ للمركبة كلّها)
                    <select
                      className={selectClass}
                      value={countMode}
                      onChange={(event) => setCountMode(event.target.value as 'whole-vehicle' | 'per-order')}
                    >
                      <option value="whole-vehicle">عددُ الصنف في السيارة كلّها (يشتقّ الخادمُ نصيبَ هذا الأمر)</option>
                      <option value="per-order">نصيبُ هذا الأمر وحده</option>
                    </select>
                  </label>
                  <Input
                    label={countMode === 'whole-vehicle' ? 'عددُ المركبة كلّها (كجم)' : 'المتبقّي الفعليّ لهذا الأمر (كجم)'}
                    value={countMode === 'whole-vehicle' ? closingDraft.vehicleCountQty : closingDraft.actualRemainingQty}
                    onChange={(event) =>
                      setClosingDraft(
                        countMode === 'whole-vehicle'
                          ? { ...closingDraft, vehicleCountQty: event.target.value }
                          : { ...closingDraft, actualRemainingQty: event.target.value },
                      )
                    }
                  />
                  {countMode === 'whole-vehicle' ? (
                    <p className="m-0 text-[12px] text-muted">
                      يخصم الخادمُ من عددِ المركبة عهدةَ الأوامر الأخرى الجالسة في السيارة
                      نفسها — وحِمولةُ المندوب لا تحمل تلك العهدة، فالحكمُ للخادم لا لهذه
                      الشاشة.
                    </p>
                  ) : null}
                  <Input
                    label="مرتجعٌ سليم (كجم)"
                    value={closingDraft.returnedQty}
                    onChange={(event) => setClosingDraft({ ...closingDraft, returnedQty: event.target.value })}
                  />
                  <Input
                    label="تالف (كجم)"
                    value={closingDraft.damagedQty}
                    onChange={(event) => setClosingDraft({ ...closingDraft, damagedQty: event.target.value })}
                  />
                  <Input
                    label="سببُ التلف (مطلوبٌ إن كان التالفُ أكثرَ من صفر)"
                    value={closingDraft.damageReason}
                    onChange={(event) => setClosingDraft({ ...closingDraft, damageReason: event.target.value })}
                  />
                  <Input
                    label="نقدٌ محصَّل للوردية"
                    value={closingDraft.collectedCash}
                    onChange={(event) => setClosingDraft({ ...closingDraft, collectedCash: event.target.value })}
                  />
                  <Input
                    label="ملاحظاتُ الإغلاق"
                    value={closingDraft.closingNotes}
                    onChange={(event) => setClosingDraft({ ...closingDraft, closingNotes: event.target.value })}
                  />
                  {closingVerdict.ok ? null : (
                    <p className={`m-0 rounded-[10px] border px-3 py-2 text-[12.5px] font-semibold ${NOTICE_CLASSES.danger}`}>
                      {closingVerdict.message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={
                        busy || !closingVerdict.ok || closingQueueVerdict.blocked.length > 0 || !canClose
                      }
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
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setClosingTarget(null)}>
                      إلغاء
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardBody>
          </Card>

          {/* 📦 أرصدة السيارة */}
          <Card>
            <CardHeader
              title="📦 أرصدةُ أصناف سيارتك (من دفتر المخزون الرسمي)"
              subtitle="كاملةٌ بلا نافذة: فاستعلامُ الأرصدة بلا LIMIT — ولهذا لا مفتاحَ لها في `windows`."
            />
            <CardBody>
              {data.balances.length === 0 ? (
                <p className="m-0 text-[12.5px] text-muted">لا رصيدَ في سيارتك الآن.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-muted">
                        <th className="border-b border-line px-2 py-1.5 text-start">الصنف</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">الكمية</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">القيمة</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">متوسطُ التكلفة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.balances.map((row) => (
                        <tr key={`${row.warehouseId}:${row.itemId}`}>
                          <td className="border-b border-line px-2 py-1.5">
                            {row.itemName} <span className="text-muted" dir="ltr">({row.sku})</span>
                          </td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {row.quantity}
                          </td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {row.value}
                          </td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {row.averageCost}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          {/* 💵 التحصيلات */}
          <Card>
            <CardHeader title="💵 ما حصّلته" subtitle={notes.collections} />
            <CardBody>
              {data.collections.length === 0 ? (
                <p className="m-0 text-[12.5px] text-muted">لا تحصيلَ في هذه النافذة.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-muted">
                        <th className="border-b border-line px-2 py-1.5 text-start">الوقت</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">المبلغ</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">السند</th>
                        <th className="border-b border-line px-2 py-1.5 text-start">السبب</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.collections.map((row) => (
                        <tr key={row.id}>
                          <td className="border-b border-line px-2 py-1.5">{row.collectedAt}</td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {numberText(row.amount)}
                          </td>
                          <td className="border-b border-line px-2 py-1.5" dir="ltr">
                            {row.voucherNumber ?? '—'}{' '}
                            <span className="text-muted">{row.voucherStatus ?? ''}</span>
                          </td>
                          <td className="border-b border-line px-2 py-1.5 text-muted">{row.reason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardBody>
          </Card>

          {/* 🔔 إشعارات */}
          {data.notifications.length > 0 ? (
            <Card>
              <CardHeader title="🔔 إشعارات" subtitle={notes.notifications} />
              <CardBody>
                <ul className="m-0 grid gap-1 text-[12.5px] text-muted" style={{ paddingInlineStart: 18 }}>
                  {data.notifications.map((row) => (
                    <li key={row.id}>
                      <strong>{String(row.payload.title ?? row.type)}</strong>
                      {row.payload.body ? ` — ${String(row.payload.body)}` : ''}
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ) : null}

          <p className="m-0 text-[12px] text-muted">
            قوائمُ هذه الشاشة نوافذُ الخادم: {notes.loadOrders} · {notes.collections} · وأمّا
            الأرصدةُ والتوريداتُ المعلّقة فكاملةٌ (بلا LIMIT في استعلاميهما). وفواتيرُ آجلةٌ
            بلا تحصيلٍ بعد: {unpaidDocuments.length} في هذه النافذة.
          </p>
        </>
      ) : null}
    </section>
  );
}
