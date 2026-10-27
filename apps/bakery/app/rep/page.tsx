'use client';

import { KpiStrip, Panel } from '@erp/ui';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
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
import {
  buildReceiptPayload,
  loadOrderStatusLabel,
  type ReceiptDraft,
} from '@erp/web-van/distribution';
import { openVanDocumentPrintWindow, type VanDocumentPrintView } from '@erp/web-van/document-print';
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
  itemOpenCustodySummary,
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

export type RepSectionKey =
  | 'overview'
  | 'receipts'
  | 'sale'
  | 'returns'
  | 'collection'
  | 'documents'
  | 'custody'
  | 'closing'
  | 'queue';

type RepNavGroup = {
  titleAr: string;
  items: Array<{
    key: RepSectionKey;
    labelAr: string;
    subtitleAr: string;
  }>;
};

const REP_NAV_GROUPS: readonly RepNavGroup[] = [
  {
    titleAr: 'العمليات اليومية',
    items: [
      { key: 'overview', labelAr: 'ملخص الوردية', subtitleAr: 'المؤشرات والوصول السريع' },
      { key: 'receipts', labelAr: 'استلام التوريدات', subtitleAr: 'تأكيد استلام الأحمال' },
      { key: 'sale', labelAr: 'فاتورة بيع جديدة', subtitleAr: 'بيع نقدي أو آجل من العهدة' },
      { key: 'returns', labelAr: 'مرتجع مبيعات', subtitleAr: 'إرجاع عميل بإشعار دائن' },
      { key: 'collection', labelAr: 'تحصيل الذمم', subtitleAr: 'سندات القبض وسجل التحصيل' },
      { key: 'closing', labelAr: 'إقفال الوردية', subtitleAr: 'الجرد الفعلي وتصفية العهدة' },
    ],
  },
  {
    titleAr: 'السجلات والعهدة',
    items: [
      { key: 'documents', labelAr: 'الفواتير والطباعة', subtitleAr: 'سجل المستندات وطباعة النسختين' },
      { key: 'custody', labelAr: 'أرصدة وأوامر السيارة', subtitleAr: 'رصيد الأصناف وأوامر التحميل' },
    ],
  },
  {
    titleAr: 'المزامنة والتنبيهات',
    items: [
      { key: 'queue', labelAr: 'المزامنة والإشعارات', subtitleAr: 'طابور عدم الاتصال والتنبيهات' },
    ],
  },
];

const VALID_SECTIONS = new Set<RepSectionKey>([
  'overview',
  'receipts',
  'sale',
  'returns',
  'collection',
  'documents',
  'custody',
  'closing',
  'queue',
]);

function parseSection(raw: string | null): RepSectionKey {
  if (raw === 'return') return 'returns';
  if (raw && VALID_SECTIONS.has(raw as RepSectionKey)) {
    return raw as RepSectionKey;
  }
  return 'overview';
}

const OPERATION_LABELS: Record<RepOperation, string> = {
  document: 'مستند بيع',
  return: 'مرتجع عميل',
  collection: 'تحصيل من عميل',
  closing: 'إغلاق الوردية',
  receipt: 'تأكيد استلام',
};

function RepWorkspaceInner() {
  const { can } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeSection = parseSection(searchParams?.get('section') ?? null);

  const canView = can(REP_WORKSPACE_PERMISSION);
  const canInvoice = can(REP_PERMISSIONS.invoice);
  const canCollect = can(REP_PERMISSIONS.collection);
  const canClose = can(REP_PERMISSIONS.closing);

  const [drawerOpen, setDrawerOpen] = useState(false);
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
  const [printingId, setPrintingId] = useState<string | null>(null);

  const [docFilter, setDocFilter] = useState<'all' | 'sale' | 'return' | 'unpaid'>('all');
  const [docSearch, setDocSearch] = useState('');

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

  const navigateSection = useCallback(
    (next: RepSectionKey) => {
      setDrawerOpen(false);
      const url = next === 'overview' ? '/rep' : `/rep?section=${next}`;
      router.replace(url, { scroll: false });
    },
    [router],
  );

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
  const unreadNotifications = useMemo(
    () => (data?.notifications ?? []).filter((n) => !n.read).length,
    [data],
  );

  const filteredDocuments = useMemo(() => {
    const all = data?.documents ?? [];
    const q = docSearch.trim().toLowerCase();
    return all.filter((row) => {
      if (docFilter === 'sale' && row.documentKind !== 'sale') return false;
      if (docFilter === 'return' && row.documentKind !== 'return') return false;
      if (docFilter === 'unpaid' && !(row.documentKind === 'sale' && Number(row.outstanding) > 0)) {
        return false;
      }
      if (!q) return true;
      return (
        row.number.toLowerCase().includes(q) ||
        (row.customerName ?? '').toLowerCase().includes(q) ||
        (row.itemName ?? '').toLowerCase().includes(q)
      );
    });
  }, [data, docFilter, docSearch]);

  const refreshQueue = useCallback(async () => {
    try {
      setQueue(await listVanQueue());
      setStorageError(null);
    } catch (error) {
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

  const enqueue = useCallback(
    async (
      operation: RepOperation,
      body: Record<string, unknown>,
      targetId: string | null,
      labelAr: string,
    ) => {
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

  const handlePrintDocument = useCallback(async (docId: string) => {
    setPrintingId(docId);
    try {
      const view = await apiData<VanDocumentPrintView>(
        `/van-sales/documents/${encodeURIComponent(docId)}/print-view?copies=2`,
      );
      openVanDocumentPrintWindow(view);
    } catch (error) {
      setNotice({
        kind: 'danger',
        text: apiErrorText(error, 'تعذّر جلب نسخة الطباعة من الخادم'),
      });
    } finally {
      setPrintingId(null);
    }
  }, []);

  const handleShareShiftSummary = useCallback(async () => {
    if (!data?.isRep) return;
    const lines = [
      `ملخص وردية المندوب: ${data.salesmanName ?? '—'}`,
      ...(data.vehiclePlate ? [`السيارة: ${data.vehiclePlate}`] : []),
      `رصيد السيارة: ${data.custodyKg} كجم (القيمة ${data.custodyValue})`,
      `صافي المبيعات: ${data.totals?.revenue ?? '0.00'} (نقدي ${data.totals?.cashSales ?? '0.00'} · آجل ${data.totals?.creditSales ?? '0.00'})`,
      `النقد المحصّل: ${data.totals?.collected ?? '0.00'}`,
      `المتبقي على العملاء: ${data.totals?.outstanding ?? '0.00'}`,
      ...(counts.pending > 0 ? [`نيّات معلّقة دون اتصال: ${counts.pending}`] : []),
    ];
    const summary = lines.join('\n');
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'ملخص وردية المندوب', text: summary });
      } else if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(summary);
        setNotice({ kind: 'ok', text: 'تم نسخ ملخص الوردية إلى الحافظة لمشاركته مع الإدارة.' });
      }
    } catch {
      // تجاهل إلغاء نافذة المشاركة من المستخدم
    }
  }, [counts.pending, data]);

  const salePayload = buildDocumentPayload(saleDraft);
  const saleVerdict = documentVerdict(saleDraft, { canOverride: false });
  const saleQueueVerdict = queueVerdict({
    online,
    operation: 'document',
    can,
    targetId: saleDraft.loadOrderId,
  });
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

  const badgeForSection = useCallback(
    (key: RepSectionKey): { count: number; tone?: 'ok' | 'warn' | 'danger' } | null => {
      if (key === 'receipts' && (data?.pendingReceipts.length ?? 0) > 0) {
        return { count: data?.pendingReceipts.length ?? 0, tone: 'warn' };
      }
      if (key === 'collection' && unpaidDocuments.length > 0) {
        return { count: unpaidDocuments.length, tone: 'danger' };
      }
      if (key === 'queue') {
        const queueBadgeSum = counts.pending + counts.refused + unreadNotifications;
        if (queueBadgeSum > 0) {
          return {
            count: queueBadgeSum,
            tone: counts.refused > 0 ? 'danger' : 'warn',
          };
        }
      }
      if (key === 'custody' && (data?.balances.length ?? 0) > 0) {
        return { count: data?.balances.length ?? 0, tone: 'ok' };
      }
      return null;
    },
    [counts.pending, counts.refused, data, unpaidDocuments.length, unreadNotifications],
  );

  const renderNavMenu = (inDrawer: boolean) => (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <strong style={{ fontSize: 15, display: 'block' }}>
            {data?.salesmanName ?? 'قائمة المندوب'}
          </strong>
          <small style={{ fontSize: 11.5, color: 'var(--muted)' }}>
            {data?.vehiclePlate ? `المركبة ${data.vehiclePlate}` : 'أقسام العمل الميداني'}
          </small>
        </div>
        {inDrawer ? (
          <button type="button" className="rep-pill" onClick={() => setDrawerOpen(false)}>
            إغلاق ✕
          </button>
        ) : null}
      </div>

      {REP_NAV_GROUPS.map((group) => (
        <div key={group.titleAr}>
          <p className="rep-nav-group-title">{group.titleAr}</p>
          <div className="rep-nav-list">
            {group.items.map((item) => {
              const badge = badgeForSection(item.key);
              const active = activeSection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className="rep-nav-btn"
                  data-active={active ? 'true' : 'false'}
                  onClick={() => navigateSection(item.key)}
                >
                  <span>{item.labelAr}</span>
                  {badge ? (
                    <span className="rep-pill" data-tone={badge.tone}>
                      <span className="rep-num">{badge.count}</span>
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );

  if (!canView) {
    return (
      <section className="rep-page">
        <Panel
          title="تطبيقُ المندوب"
          hint="لا صلاحيةَ لقراءة مساحة عمل المندوب في هذا الحساب."
          bodyClassName="grid gap-2.5"
        >
          <p className="rep-note" data-tone="danger">
            {REP_QUEUE_MESSAGES.permissionRequired([REP_WORKSPACE_PERMISSION])}
          </p>
        </Panel>
      </section>
    );
  }

  return (
    <section className="rep-page">
      {drawerOpen ? (
        <>
          <div
            aria-hidden="true"
            className="rep-drawer-backdrop"
            onClick={() => setDrawerOpen(false)}
          />
          <aside aria-label="القائمة الجانبية لتطبيق المندوب" className="rep-drawer-sheet">
            {renderNavMenu(true)}
          </aside>
        </>
      ) : null}

      <div className="rep-statusbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <button
            type="button"
            className="rep-pill"
            aria-label="فتح القائمة الجانبية للمندوب"
            onClick={() => setDrawerOpen(true)}
          >
            ☰ القائمة
          </button>
          <div className="rep-statusbar-id">
            <strong>{data?.isRep ? (data.salesmanName ?? 'المندوب') : 'تطبيقُ المندوب'}</strong>
            <small>
              {data?.isRep && data.vehiclePlate ? `${data.vehiclePlate} · ` : ''}
              رصيدُ السيارة <span className="rep-num">{data?.custodyKg ?? '—'}</span> كجم · قيمة{' '}
              <span className="rep-num">{data?.custodyValue ?? '—'}</span>
            </small>
          </div>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          <span className="rep-pill" data-tone={online ? 'ok' : 'warn'}>
            {online ? 'متصل' : 'دون اتصال'}
          </span>
          <button
            type="button"
            className="rep-pill"
            data-tone={counts.refused > 0 ? 'danger' : counts.pending > 0 ? 'warn' : 'ok'}
            onClick={() => navigateSection('queue')}
          >
            <span className="rep-num">{counts.pending}</span> معلّق
            {counts.refused > 0 ? (
              <>
                {' '}
                · <span className="rep-num">{counts.refused}</span> مرفوض
              </>
            ) : null}
          </button>
          <button type="button" className="rep-pill" onClick={() => void load()} disabled={loading}>
            {loading ? '⟳ …' : '⟳ تحديث'}
          </button>
        </div>
      </div>

      {!online ? (
        <p className="rep-note" data-tone="warn">
          لا شبكة: ما يُحفظ هو المستنداتُ والمرتجعاتُ والتحصيلات (بمفاتيح عدم تكرارٍ تُخزَّن معها فتُعاد بلا
          مستندٍ مكرَّر). وأمّا إغلاقُ الوردية وتأكيدُ الاستلام فلا يُحفظان — والسببُ معروضٌ عند كلّ زرٍّ
          منهما.
        </p>
      ) : null}
      {storageError ? (
        <p className="rep-note" data-tone="danger">
          {storageError} — فلا تُحفظ نيّاتٌ دون اتصال في هذا المتصفّح.
        </p>
      ) : null}
      {loadError ? (
        <p className="rep-note" data-tone="danger">
          {loadError}
        </p>
      ) : null}
      {notice ? (
        <p className="rep-note" data-tone={notice.kind}>
          {notice.text}
        </p>
      ) : null}

      <h1 className="sr-only">تطبيق المندوب</h1>

      {data && !data.isRep ? (
        <Panel title="حسابك غير مرتبط ببطاقة مندوب" bodyClassName="grid gap-2.5">
          <p className="rep-note" data-tone="warn">
            {data.message ?? 'حسابك غير مرتبط ببطاقة مندوب توزيع — اطلب من المحاسب ربطك من شاشة المندوبين.'}
          </p>
        </Panel>
      ) : null}

      {data?.isRep ? (
        <>
          {/* شريط تنقّل سريع للجوال أعلى المحتوى */}
          <div className="rep-tab-strip" role="navigation" aria-label="أقسام تطبيق المندوب السريعة">
            {REP_NAV_GROUPS.flatMap((g) => g.items).map((item) => {
              const active = activeSection === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  className="rep-pill"
                  data-tone={active ? 'ok' : undefined}
                  onClick={() => navigateSection(item.key)}
                >
                  {item.labelAr}
                </button>
              );
            })}
          </div>

          <div className="rep-workspace-layout">
            {/* القائمة الجانبية الثابتة على الشاشات الكبيرة */}
            <aside aria-label="أقسام تطبيق المندوب" className="rep-side-panel">
              {renderNavMenu(false)}
            </aside>

            <div style={{ display: 'grid', gap: 12, minWidth: 0 }}>
              {/* ═══════════════ ١) شاشة ملخص الوردية (الرئيسية) ═══════════════ */}
              {activeSection === 'overview' ? (
                <>
                  <div className="rep-section-head">
                    <h2>ملخص الوردية والعمليات السريعة</h2>
                    <button type="button" className="rep-pill" onClick={() => void handleShareShiftSummary()}>
                      مشاركة / نسخ ملخص الوردية
                    </button>
                  </div>

                  <KpiStrip
                    items={cards.map((card) => ({
                      label: card.labelAr,
                      value: <span className="rep-num">{card.valueText}</span>,
                      hint: card.hintAr,
                    }))}
                  />

                  {reconcileNote ? (
                    <p className="rep-note" data-tone="danger">
                      {reconcileNote}
                    </p>
                  ) : null}

                  {data.pendingReceipts.length > 0 ? (
                    <p className="rep-note" data-tone="warn">
                      لديك <span className="rep-num">{data.pendingReceipts.length}</span> توريد بانتظار تأكيد
                      استلامك قبل بدء البيع منه.{' '}
                      <button
                        type="button"
                        className="rep-pill"
                        data-tone="warn"
                        onClick={() => navigateSection('receipts')}
                      >
                        افتح استلام التوريدات
                      </button>
                    </p>
                  ) : null}

                  <Panel
                    title="الوصول السريع لأقسام العمل"
                    hint="اختر العملية المطلوبة للانتقال إلى شاشتها المخصّصة مباشرة."
                    bodyClassName="grid gap-2.5"
                  >
                    <div className="rep-quick-grid">
                      <button
                        type="button"
                        className="rep-quick-card"
                        onClick={() => navigateSection('sale')}
                      >
                        <div>
                          <strong>فاتورة بيع جديدة</strong>
                          <small>إصدار بيع نقدي أو آجل من عهدة السيارة</small>
                        </div>
                        <span className="rep-pill" data-tone="ok">
                          <span className="rep-num">{saleable.length}</span> أمر متاح
                        </span>
                      </button>

                      <button
                        type="button"
                        className="rep-quick-card"
                        onClick={() => navigateSection('receipts')}
                      >
                        <div>
                          <strong>استلام التوريدات</strong>
                          <small>تأكيد استلام الأحمال الصادرة لك</small>
                        </div>
                        <span
                          className="rep-pill"
                          data-tone={data.pendingReceipts.length > 0 ? 'warn' : undefined}
                        >
                          <span className="rep-num">{data.pendingReceipts.length}</span> بانتظارك
                        </span>
                      </button>

                      <button
                        type="button"
                        className="rep-quick-card"
                        onClick={() => navigateSection('collection')}
                      >
                        <div>
                          <strong>تحصيل الذمم</strong>
                          <small>قبض مديونيات العملاء بسندات رسمية</small>
                        </div>
                        <span
                          className="rep-pill"
                          data-tone={unpaidDocuments.length > 0 ? 'danger' : 'ok'}
                        >
                          <span className="rep-num">{unpaidDocuments.length}</span> فاتورة آجلة
                        </span>
                      </button>

                      <button
                        type="button"
                        className="rep-quick-card"
                        onClick={() => navigateSection('returns')}
                      >
                        <div>
                          <strong>مرتجع مبيعات</strong>
                          <small>إرجاع بضاعة من عميل بإشعار دائن</small>
                        </div>
                        <span className="rep-pill">
                          <span className="rep-num">{returnable.length}</span> قابلة للإرجاع
                        </span>
                      </button>

                      <button
                        type="button"
                        className="rep-quick-card"
                        onClick={() => navigateSection('documents')}
                      >
                        <div>
                          <strong>الفواتير والطباعة</strong>
                          <small>استعراض المستندات وطباعة النسختين</small>
                        </div>
                        <span className="rep-pill">
                          <span className="rep-num">{data.documents.length}</span> مستند
                        </span>
                      </button>

                      <button
                        type="button"
                        className="rep-quick-card"
                        onClick={() => navigateSection('custody')}
                      >
                        <div>
                          <strong>أرصدة وأوامر السيارة</strong>
                          <small>جرد الأصناف الحي وأوامر التحميل</small>
                        </div>
                        <span className="rep-pill" data-tone="ok">
                          <span className="rep-num">{data.custodyKg}</span> كجم
                        </span>
                      </button>

                      <button
                        type="button"
                        className="rep-quick-card"
                        onClick={() => navigateSection('closing')}
                      >
                        <div>
                          <strong>إقفال الوردية</strong>
                          <small>تقديم الجرد الفعلي وتصفية العهدة</small>
                        </div>
                        <span className="rep-pill">
                          <span className="rep-num">{data.custody?.pendingClosings ?? 0}</span> معلّق
                        </span>
                      </button>

                      <button
                        type="button"
                        className="rep-quick-card"
                        onClick={() => navigateSection('queue')}
                      >
                        <div>
                          <strong>المزامنة والإشعارات</strong>
                          <small>طابور عدم الاتصال وتنبيهات الإدارة</small>
                        </div>
                        <span
                          className="rep-pill"
                          data-tone={counts.refused > 0 ? 'danger' : counts.pending > 0 ? 'warn' : 'ok'}
                        >
                          <span className="rep-num">{counts.pending}</span> معلّق
                        </span>
                      </button>
                    </div>
                  </Panel>

                  <p className="rep-note">
                    قوائمُ هذه الشاشة من الخادم: {notes.loadOrders} · والأرصدةُ والتوريداتُ المعلّقة كاملة.
                    وفواتيرُ آجلةٌ بلا تحصيلٍ بعد: <span className="rep-num">{unpaidDocuments.length}</span>{' '}
                    في هذه النافذة.
                  </p>
                </>
              ) : null}

              {/* ═══════════════ ٢) شاشة استلام التوريدات ═══════════════ */}
              {activeSection === 'receipts' ? (
                <>
                  <div className="rep-section-head">
                    <h2>استلام التوريدات المحمّلة</h2>
                    <button type="button" className="rep-pill" onClick={() => navigateSection('overview')}>
                      ← ملخص الوردية
                    </button>
                  </div>

                  <Panel
                    title={
                      <>
                        توريداتٌ بانتظار تأكيد استلامك (
                        <span className="rep-num">{data.pendingReceipts.length}</span>)
                      </>
                    }
                    hint="كلُّ توريدٍ لك معروض — لا سقفَ على عدد الصفوف."
                    bodyClassName="grid gap-2.5"
                  >
                    {data.pendingReceipts.length === 0 ? (
                      <p className="rep-empty">لا توريدَ بانتظارك حالياً.</p>
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
                                {row.itemName} · {row.fromWarehouseName}
                              </span>
                            </div>
                            <div className="rep-row-actions">
                              <button
                                type="button"
                                className="rep-btn"
                                data-variant="primary"
                                onClick={() => {
                                  setReceiptTarget(row);
                                  setReceiptDraft({
                                    receivedQty: row.loadedQty,
                                    notes: '',
                                    loadedQty: row.loadedQty,
                                  });
                                }}
                              >
                                تأكيدُ الاستلام
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {receiptTarget ? (
                      <Panel
                        title={
                          <>
                            تأكيدُ استلام {receiptTarget.number} (المحمَّل{' '}
                            <span className="rep-num">{numberText(receiptTarget.loadedQty)}</span> كجم)
                          </>
                        }
                        style={{ background: 'var(--inset)' }}
                        bodyClassName="grid gap-2.5"
                      >
                        {receiptQueueVerdict.blocked.map((line) => (
                          <p key={line} className="rep-note" data-tone="danger">
                            {line}
                          </p>
                        ))}
                        <div className="rep-fields">
                          <label className="rep-field">
                            <span>المستلَم فعليًّا (كجم)</span>
                            <input
                              inputMode="decimal"
                              className="rep-num"
                              value={receiptDraft.receivedQty}
                              onChange={(event) =>
                                setReceiptDraft({ ...receiptDraft, receivedQty: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>ملاحظات</span>
                            <input
                              className="input"
                              value={receiptDraft.notes}
                              onChange={(event) =>
                                setReceiptDraft({ ...receiptDraft, notes: event.target.value })
                              }
                            />
                          </label>
                        </div>
                        {receiptVerdict.ok ? null : (
                          <p className="rep-note" data-tone="danger">
                            {receiptVerdict.message}
                          </p>
                        )}
                        {receiptVerdict.ok && receiptVerdict.usesLoadedQty ? (
                          <p className="rep-note" data-tone="warn">
                            ستُستعمل الكميةُ المحمَّلة كما هي.
                          </p>
                        ) : null}
                        <div className="rep-actions">
                          <button
                            type="button"
                            className="rep-btn"
                            data-variant="primary"
                            disabled={
                              busy || !receiptVerdict.ok || receiptQueueVerdict.blocked.length > 0
                            }
                            onClick={() =>
                              void submit({
                                operation: 'receipt',
                                body: receiptVerdict.ok
                                  ? (receiptVerdict.payload as Record<string, unknown>)
                                  : {},
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
                          <button
                            type="button"
                            className="rep-btn"
                            onClick={() => setReceiptTarget(null)}
                          >
                            إلغاء
                          </button>
                        </div>
                      </Panel>
                    ) : null}
                  </Panel>
                </>
              ) : null}

              {/* ═══════════════ ٣) شاشة فاتورة بيع جديدة ═══════════════ */}
              {activeSection === 'sale' ? (
                <>
                  <div className="rep-section-head">
                    <h2>إصدار فاتورة بيع جديدة</h2>
                    <button type="button" className="rep-pill" onClick={() => navigateSection('documents')}>
                      سجل الفواتير والطباعة ←
                    </button>
                  </div>

                  <Panel
                    title="تسجيل بيعٍ وإصدار فاتورة"
                    hint="العميل والصنف والكمية؛ الخادم يتحقق من الأهلية والرصيد قبل الحفظ."
                    bodyClassName="grid gap-2.5"
                  >
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
                              className="input"
                              value={saleDraft.loadOrderId}
                              onChange={(event) =>
                                setSaleDraft({ ...saleDraft, loadOrderId: event.target.value })
                              }
                            >
                              <option value="">اختر أمرًا</option>
                              {saleable.map((row) => (
                                <option key={row.id} value={row.id}>
                                  {row.number} — متبقٍّ {numberText(row.expectedRemainingQty)} كجم (
                                  {row.itemName})
                                </option>
                              ))}
                            </select>
                          </label>
                          {(() => {
                            const selectedRow = saleable.find((r) => r.id === saleDraft.loadOrderId);
                            const summary = itemOpenCustodySummary(data.loadOrders, selectedRow);
                            if (!summary || summary.orderCount <= 1) return null;
                            return (
                              <p className="rep-note" data-tone="ok">
                                إجمالي عهدتك المفتوحة من «{selectedRow?.itemName}» في السيارة:{' '}
                                <span className="rep-num">{summary.totalKg}</span> كجم عبر{' '}
                                {summary.orderCount} أوامر تحميل مفتوحة — يمكنك البيع حتى كامل الكمية في
                                فاتورة واحدة.
                              </p>
                            );
                          })()}
                          <label className="rep-field">
                            <span>العميل (بطاقة) — أو اتركه للعميل النقدي</span>
                            <select
                              className="input"
                              value={saleDraft.partyId}
                              onChange={(event) =>
                                setSaleDraft({ ...saleDraft, partyId: event.target.value })
                              }
                            >
                              <option value="">بلا بطاقة (عميل نقدي)</option>
                              {parties.map((row) => (
                                <option key={row.id} value={row.id}>
                                  {partyLabel(row)}
                                </option>
                              ))}
                            </select>
                          </label>
                          {partiesError ? (
                            <p className="rep-note" data-tone="warn">
                              {partiesError} — البيعُ النقديّ باسم العميل يعمل بلا بطاقة، وبطاقاتُ الآجل
                              تحتاج صلاحيةَ قراءة العملاء في حسابك.
                            </p>
                          ) : null}
                          {!saleDraft.partyId ? (
                            <label className="rep-field">
                              <span>اسم العميل النقدي</span>
                              <input
                                className="input"
                                value={saleDraft.customerName}
                                onChange={(event) =>
                                  setSaleDraft({ ...saleDraft, customerName: event.target.value })
                                }
                              />
                            </label>
                          ) : null}
                          <label className="rep-field">
                            <span>الكمية المباعة (كجم)</span>
                            <input
                              inputMode="decimal"
                              className="rep-num"
                              value={saleDraft.soldQty}
                              onChange={(event) =>
                                setSaleDraft({ ...saleDraft, soldQty: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>سعرُ البيع للكيلو (اختياريّ — وإلا فسعرُ العميل المثبّت)</span>
                            <input
                              inputMode="decimal"
                              className="rep-num"
                              value={saleDraft.unitPrice}
                              onChange={(event) =>
                                setSaleDraft({ ...saleDraft, unitPrice: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>كميةٌ مجانية (بونص)</span>
                            <input
                              inputMode="decimal"
                              className="rep-num"
                              value={saleDraft.bonusQty}
                              onChange={(event) =>
                                setSaleDraft({ ...saleDraft, bonusQty: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>سببُ البونص (مطلوبٌ إن وُجد)</span>
                            <input
                              className="input"
                              value={saleDraft.bonusReason}
                              onChange={(event) =>
                                setSaleDraft({ ...saleDraft, bonusReason: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>طريقةُ الدفع</span>
                            <select
                              className="input"
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
                          <label className="rep-field">
                            <span>وضعُ المستند</span>
                            <select
                              className="input"
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
                        </div>

                        {[...saleVerdict.blocked, ...saleQueueVerdict.blocked].map((line) => (
                          <p key={line} className="rep-note" data-tone="danger">
                            {line}
                          </p>
                        ))}
                        {[...saleVerdict.warnings, ...saleQueueVerdict.warnings].map((line) => (
                          <p key={line} className="rep-note" data-tone="warn">
                            {line}
                          </p>
                        ))}
                        <div className="rep-actions">
                          <button
                            type="button"
                            className="rep-btn"
                            data-variant="primary"
                            disabled={
                              busy ||
                              saleVerdict.blocked.length > 0 ||
                              saleQueueVerdict.blocked.length > 0
                            }
                            onClick={() => {
                              const key = saleKey.key(salePayload);
                              void submit({
                                operation: 'document',
                                body: bodyWithIdempotencyKey(
                                  'document',
                                  salePayload as Record<string, unknown>,
                                  key,
                                ),
                                labelAr: `${saleDraft.soldQty} كجم`,
                                successAr: 'صدر مستندُ البيع وخُصمت الكميةُ من رصيد سيارتك الرسميّ.',
                                after: () => {
                                  setSaleDraft(emptyDocumentDraft());
                                  saleKey.reset();
                                },
                              });
                            }}
                          >
                            {busy ? 'جارٍ الإرسال…' : online ? 'إصدار المستند' : 'حفظُ النيّة في الطابور'}
                          </button>
                        </div>
                      </>
                    )}
                  </Panel>
                </>
              ) : null}

              {/* ═══════════════ ٤) شاشة مرتجع مبيعات ═══════════════ */}
              {activeSection === 'returns' ? (
                <>
                  <div className="rep-section-head">
                    <h2>تسجيل مرتجع مبيعات</h2>
                    <button type="button" className="rep-pill" onClick={() => navigateSection('documents')}>
                      عرض الفواتير ←
                    </button>
                  </div>

                  <Panel
                    title="إشعار دائن وإرجاع بضاعة إلى السيارة"
                    hint="اختر الفاتورة الأصلية وحدّد الكمية المرتجعة والسبب؛ تعود الكمية السليمة إلى رصيد سيارتك الرسمي."
                    bodyClassName="grid gap-2.5"
                  >
                    {!canInvoice ? (
                      <p className="rep-note" data-tone="danger">
                        {REP_QUEUE_MESSAGES.permissionRequired([REP_PERMISSIONS.invoice])}
                      </p>
                    ) : returnable.length === 0 ? (
                      <p className="rep-empty">لا توجد فواتير بيع قابلة للإرجاع في هذه النافذة.</p>
                    ) : (
                      <>
                        <div className="rep-fields">
                          <label className="rep-field">
                            <span>فاتورة البيع الأصلية</span>
                            <select
                              className="input"
                              value={returnDraft.documentId}
                              onChange={(event) =>
                                setReturnDraft({ ...returnDraft, documentId: event.target.value })
                              }
                            >
                              <option value="">اختر الفاتورة</option>
                              {returnable.map((row) => (
                                <option key={row.id} value={row.id}>
                                  {row.number} — {row.customerName || 'عميل نقدي'} ({numberText(row.soldQty)}{' '}
                                  كجم)
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="rep-field">
                            <span>الكمية المرتجعة (كجم)</span>
                            <input
                              inputMode="decimal"
                              className="rep-num"
                              value={returnDraft.returnedQty}
                              onChange={(event) =>
                                setReturnDraft({ ...returnDraft, returnedQty: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>سبب المرتجع</span>
                            <input
                              className="input"
                              value={returnDraft.reason}
                              onChange={(event) =>
                                setReturnDraft({ ...returnDraft, reason: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>ملاحظات إضافية</span>
                            <input
                              className="input"
                              value={returnDraft.notes}
                              onChange={(event) =>
                                setReturnDraft({ ...returnDraft, notes: event.target.value })
                              }
                            />
                          </label>
                        </div>

                        {returnDraft.documentId ? (
                          <p className="rep-note" data-tone="warn">
                            {returnCeilingText(
                              returnable.find((row) => row.id === returnDraft.documentId) ?? returnable[0]!,
                            )}
                          </p>
                        ) : null}

                        {returnQueueVerdict.blocked.map((line) => (
                          <p key={line} className="rep-note" data-tone="danger">
                            {line}
                          </p>
                        ))}
                        {returnQueueVerdict.warnings.map((line) => (
                          <p key={line} className="rep-note" data-tone="warn">
                            {line}
                          </p>
                        ))}
                        <div className="rep-actions">
                          <button
                            type="button"
                            className="rep-btn"
                            data-variant="primary"
                            disabled={
                              busy ||
                              !returnDraft.documentId ||
                              !returnDraft.returnedQty ||
                              returnQueueVerdict.blocked.length > 0
                            }
                            onClick={() => {
                              const key = returnKey.key(returnPayload);
                              void submit({
                                operation: 'return',
                                body: bodyWithIdempotencyKey(
                                  'return',
                                  returnPayload as Record<string, unknown>,
                                  key,
                                ),
                                targetId: returnDraft.documentId,
                                labelAr: `${returnDraft.returnedQty} كجم`,
                                successAr:
                                  'سُجِّل المرتجعُ وعادت البضاعةُ إلى رصيد سيارتك الرسميّ بإشعارٍ دائن.',
                                after: () => {
                                  setReturnDraft({
                                    documentId: '',
                                    returnedQty: '',
                                    reason: '',
                                    notes: '',
                                  });
                                  returnKey.reset();
                                },
                              });
                            }}
                          >
                            {online ? 'تسجيلُ المرتجع' : 'حفظُ المرتجع في الطابور'}
                          </button>
                        </div>
                      </>
                    )}
                  </Panel>
                </>
              ) : null}

              {/* ═══════════════ ٥) شاشة تحصيل الذمم وسجل التحصيلات ═══════════════ */}
              {activeSection === 'collection' ? (
                <>
                  <div className="rep-section-head">
                    <h2>تحصيل ذمم العملاء وسجل السندات</h2>
                    <button type="button" className="rep-pill" onClick={() => navigateSection('overview')}>
                      ← ملخص الوردية
                    </button>
                  </div>

                  <Panel
                    title={
                      <>
                        تحصيلُ مديونية عميل (<span className="rep-num">{unpaidDocuments.length}</span> فاتورة
                        آجلة مفتوحة)
                      </>
                    }
                    hint="اختر الفاتورة الآجلة وأدخل المبلغ المحصّل لإصدار سند قبض رسمي."
                    bodyClassName="grid gap-2.5"
                  >
                    {!canCollect ? (
                      <p className="rep-note" data-tone="danger">
                        {REP_QUEUE_MESSAGES.permissionRequired([REP_PERMISSIONS.collection])}
                      </p>
                    ) : (
                      <>
                        <div className="rep-fields">
                          <label className="rep-field">
                            <span>الفاتورة الآجلة</span>
                            <select
                              className="input"
                              value={collectionDraft.documentId}
                              onChange={(event) => {
                                const doc = unpaidDocuments.find((d) => d.id === event.target.value);
                                setCollectionDraft({
                                  ...collectionDraft,
                                  documentId: event.target.value,
                                  collectedAmount: doc?.outstanding ?? collectionDraft.collectedAmount,
                                });
                              }}
                            >
                              <option value="">اختر فاتورة للتحصيل</option>
                              {unpaidDocuments.map((row) => (
                                <option key={row.id} value={row.id}>
                                  {row.number} — {row.customerName || 'عميل'} (متبقٍّ{' '}
                                  {numberText(row.outstanding)})
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="rep-field">
                            <span>المبلغ المحصَّل</span>
                            <input
                              inputMode="decimal"
                              className="rep-num"
                              value={collectionDraft.collectedAmount}
                              onChange={(event) =>
                                setCollectionDraft({
                                  ...collectionDraft,
                                  collectedAmount: event.target.value,
                                })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>ملاحظة / بيان السند</span>
                            <input
                              className="input"
                              value={collectionDraft.notes}
                              onChange={(event) =>
                                setCollectionDraft({ ...collectionDraft, notes: event.target.value })
                              }
                            />
                          </label>
                        </div>

                        {collectionQueueVerdict.blocked.map((line) => (
                          <p key={line} className="rep-note" data-tone="danger">
                            {line}
                          </p>
                        ))}
                        {collectionQueueVerdict.warnings.map((line) => (
                          <p key={line} className="rep-note" data-tone="warn">
                            {line}
                          </p>
                        ))}
                        <div className="rep-actions">
                          <button
                            type="button"
                            className="rep-btn"
                            data-variant="primary"
                            disabled={
                              busy ||
                              !collectionDraft.documentId ||
                              !collectionDraft.collectedAmount ||
                              collectionQueueVerdict.blocked.length > 0
                            }
                            onClick={() => {
                              const key = collectionKey.key(collectionPayload);
                              void submit({
                                operation: 'collection',
                                body: bodyWithIdempotencyKey(
                                  'collection',
                                  collectionPayload as Record<string, unknown>,
                                  key,
                                ),
                                labelAr: `${collectionDraft.collectedAmount} ريال`,
                                successAr: 'سُجِّل التحصيلُ وأُصدر سندُ القبض الرسميّ.',
                                after: () => {
                                  setCollectionDraft(emptyCollectionDraft());
                                  collectionKey.reset();
                                },
                              });
                            }}
                          >
                            {online ? 'تأكيدُ التحصيل' : 'حفظُ التحصيل في الطابور'}
                          </button>
                        </div>
                      </>
                    )}
                  </Panel>

                  <Panel title="سجل ما حصّلته" hint={<>{notes.collections}</>} bodyClassName="grid gap-2.5">
                    {data.collections.length === 0 ? (
                      <p className="rep-empty">لا تحصيلَ في هذه النافذة.</p>
                    ) : (
                      <div className="rep-rows">
                        {data.collections.map((row) => (
                          <div key={row.id} className="rep-row">
                            <div className="rep-row-main">
                              <span className="rep-num">{numberText(row.amount)}</span>
                              <span
                                className="rep-pill"
                                data-tone={row.voucherStatus === 'posted' ? 'ok' : 'warn'}
                              >
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
                  </Panel>
                </>
              ) : null}

              {/* ═══════════════ ٦) شاشة الفواتير والمرتجعات والطباعة ═══════════════ */}
              {activeSection === 'documents' ? (
                <>
                  <div className="rep-section-head">
                    <h2>فواتيرك ومستنداتك والطباعة</h2>
                    <button type="button" className="rep-pill" onClick={() => navigateSection('sale')}>
                      + فاتورة بيع جديدة
                    </button>
                  </div>

                  <Panel
                    title="سجل الفواتير والمرتجعات"
                    hint={<>{notes.documents}</>}
                    bodyClassName="grid gap-2.5"
                  >
                    <div className="rep-fields">
                      <label className="rep-field">
                        <span>بحث بالرقم أو العميل أو الصنف</span>
                        <input
                          className="input"
                          placeholder="ابحث…"
                          value={docSearch}
                          onChange={(event) => setDocSearch(event.target.value)}
                        />
                      </label>
                      <label className="rep-field">
                        <span>تصفية المستندات</span>
                        <select
                          className="input"
                          value={docFilter}
                          onChange={(event) =>
                            setDocFilter(event.target.value as 'all' | 'sale' | 'return' | 'unpaid')
                          }
                        >
                          <option value="all">الكل ({data.documents.length})</option>
                          <option value="sale">فواتير البيع فقط</option>
                          <option value="return">المرتجعات فقط</option>
                          <option value="unpaid">آجل غير مسدّد ({unpaidDocuments.length})</option>
                        </select>
                      </label>
                    </div>

                    {filteredDocuments.length === 0 ? (
                      <p className="rep-empty">لا مستنداتَ مطابقة في هذه النافذة.</p>
                    ) : (
                      <div className="rep-rows">
                        {filteredDocuments.map((row) => (
                          <div key={row.id} className="rep-row">
                            <div className="rep-row-main">
                              <span className="rep-num">{row.number}</span>
                              <span
                                className="rep-pill"
                                data-tone={
                                  row.documentKind === 'return'
                                    ? 'warn'
                                    : Number(row.outstanding) > 0
                                      ? 'danger'
                                      : 'ok'
                                }
                              >
                                {row.documentKind === 'return'
                                  ? 'مرتجع'
                                  : row.invoiceMode === 'zatca_tax'
                                    ? 'ضريبية'
                                    : 'تسليم داخلي'}
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
                              <button
                                type="button"
                                className="rep-btn"
                                disabled={printingId === row.id}
                                onClick={() => void handlePrintDocument(row.id)}
                              >
                                {printingId === row.id ? 'جارٍ التحضير…' : 'طباعة السند'}
                              </button>
                              {row.documentKind === 'sale' && canInvoice ? (
                                <button
                                  type="button"
                                  className="rep-btn"
                                  onClick={() => {
                                    setReturnDraft({
                                      documentId: row.id,
                                      returnedQty: '',
                                      reason: '',
                                      notes: '',
                                    });
                                    navigateSection('returns');
                                  }}
                                >
                                  مرتجع
                                </button>
                              ) : null}
                              {Number(row.outstanding) > 0 && canCollect ? (
                                <button
                                  type="button"
                                  className="rep-btn"
                                  onClick={() => {
                                    setCollectionDraft({
                                      ...emptyCollectionDraft(),
                                      documentId: row.id,
                                      collectedAmount: row.outstanding,
                                    });
                                    navigateSection('collection');
                                  }}
                                >
                                  تحصيل
                                </button>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                </>
              ) : null}

              {/* ═══════════════ ٧) شاشة أرصدة وأوامر السيارة ═══════════════ */}
              {activeSection === 'custody' ? (
                <>
                  <div className="rep-section-head">
                    <h2>أرصدة السيارة وأوامر التحميل</h2>
                    <button type="button" className="rep-pill" onClick={() => navigateSection('closing')}>
                      إقفال الوردية ←
                    </button>
                  </div>

                  <Panel
                    title="أرصدةُ أصناف سيارتك (من دفتر المخزون الرسمي)"
                    hint="كلُّ أرصدة أصناف سيارتك معروضة — لا سقفَ على عدد الصفوف."
                    bodyClassName="grid gap-2.5"
                  >
                    {data.balances.length === 0 ? (
                      <p className="rep-empty">لا رصيدَ في سيارتك الآن.</p>
                    ) : (
                      <div className="rep-rows">
                        {data.balances.map((row) => (
                          <div key={`${row.warehouseId}:${row.itemId}`} className="rep-row">
                            <div className="rep-row-main">
                              <span>{row.itemName}</span>
                              <span className="rep-pill" data-tone="ok">
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
                  </Panel>

                  <Panel
                    title="سجل أوامر التحميل والعهدة"
                    hint={<>{notes.loadOrders}</>}
                    bodyClassName="grid gap-2.5"
                  >
                    {data.loadOrders.length === 0 ? (
                      <p className="rep-empty">لا أوامرَ لك في هذه النافذة.</p>
                    ) : (
                      <div className="rep-rows">
                        {data.loadOrders.map((row) => {
                          const serverNotes = [
                            receiptShortfallText(row),
                            closingShortageText(row),
                            row.stockSettlementNote,
                          ].filter((line): line is string => Boolean(line));
                          return (
                            <div key={row.id} className="rep-row">
                              <div className="rep-row-main">
                                <span className="rep-num">{row.number}</span>
                                <span
                                  className="rep-pill"
                                  data-tone={
                                    row.status === 'settled'
                                      ? 'ok'
                                      : row.status === 'pending_closing' ||
                                          row.status === 'pending_stock_settlement'
                                        ? 'warn'
                                        : row.status === 'loaded' || row.status === 'in_route'
                                          ? undefined
                                          : 'danger'
                                  }
                                >
                                  {loadOrderStatusLabel(row.status)}
                                </span>
                              </div>
                              <div className="rep-row-meta">
                                <span>{row.itemName}</span>
                                <span>
                                  المتوقَّع أن يبقى{' '}
                                  <span className="rep-num">{numberText(row.expectedRemainingQty)}</span> كجم
                                </span>
                                <span>
                                  نقدٌ متبقٍّ <span className="rep-num">{numberText(row.outstandingCash)}</span>
                                </span>
                              </div>
                              {serverNotes.length > 0 ? (
                                <p className="rep-note" data-tone="warn">
                                  {serverNotes.join(' · ')}
                                </p>
                              ) : null}
                              <div className="rep-row-actions">
                                {canClose && (row.status === 'loaded' || row.status === 'in_route') ? (
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
                                      navigateSection('closing');
                                    }}
                                  >
                                    تقديمُ الإغلاق
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </Panel>
                </>
              ) : null}

              {/* ═══════════════ ٨) شاشة إقفال الوردية وتصفية العهدة ═══════════════ */}
              {activeSection === 'closing' ? (
                <>
                  <div className="rep-section-head">
                    <h2>إقفال الوردية وتصفية العهدة</h2>
                    <button type="button" className="rep-pill" onClick={() => navigateSection('custody')}>
                      أرصدة السيارة ←
                    </button>
                  </div>

                  <Panel
                    title="إغلاقُ الوردية وتصفيةُ العهدة"
                    hint="اختر أمر التحميل المفتوح وأدخل الجرد الفعلي والمرتجع والتالف والنقد المورَّد."
                    bodyClassName="grid gap-2.5"
                  >
                    {data.loadOrders.filter((r) => r.status === 'loaded' || r.status === 'in_route').length ===
                    0 ? (
                      <p className="rep-empty">لا توجد أوامر تحميل مفتوحة بانتظار الإقفال حالياً.</p>
                    ) : (
                      <div className="rep-rows">
                        {data.loadOrders
                          .filter((r) => r.status === 'loaded' || r.status === 'in_route')
                          .map((row) => (
                            <div key={row.id} className="rep-row">
                              <div className="rep-row-main">
                                <span className="rep-num">{row.number}</span>
                                <span className="rep-pill">{loadOrderStatusLabel(row.status)}</span>
                              </div>
                              <div className="rep-row-meta">
                                <span>{row.itemName}</span>
                                <span>
                                  المتوقَّع أن يبقى{' '}
                                  <span className="rep-num">{numberText(row.expectedRemainingQty)}</span> كجم
                                </span>
                                <span>
                                  نقدٌ متبقٍّ <span className="rep-num">{numberText(row.outstandingCash)}</span>
                                </span>
                              </div>
                              <div className="rep-row-actions">
                                {canClose ? (
                                  <button
                                    type="button"
                                    className="rep-btn"
                                    data-variant={closingTarget?.id === row.id ? 'primary' : undefined}
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
                                    {closingTarget?.id === row.id ? 'محدّد للإغلاق ✓' : 'تقديمُ الإغلاق'}
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                      </div>
                    )}

                    {closingTarget ? (
                      <Panel
                        title={
                          <>
                            تقديمُ إغلاق {closingTarget.number} — المتوقَّع أن يبقى{' '}
                            <span className="rep-num">{numberText(closingTarget.expectedRemainingQty)}</span>{' '}
                            كجم
                          </>
                        }
                        style={{ background: 'var(--inset)' }}
                        bodyClassName="grid gap-2.5"
                      >
                        {closingQueueVerdict.blocked.map((line) => (
                          <p key={line} className="rep-note" data-tone="danger">
                            {line}
                          </p>
                        ))}
                        {!online ? (
                          <p className="rep-note" data-tone="warn">
                            {NOT_QUEUEABLE_OPERATIONS.closing.reasonAr}
                          </p>
                        ) : null}
                        <div className="rep-fields">
                          <label className="rep-field">
                            <span>دلالةُ العدّ (قرارُ المالك: العددُ للمركبة كلّها)</span>
                            <select
                              className="input"
                              value={countMode}
                              onChange={(event) =>
                                setCountMode(event.target.value as 'whole-vehicle' | 'per-order')
                              }
                            >
                              <option value="whole-vehicle">
                                عددُ الصنف في السيارة كلّها (يشتقّ الخادمُ نصيبَ هذا الأمر)
                              </option>
                              <option value="per-order">نصيبُ هذا الأمر وحده</option>
                            </select>
                          </label>
                          <label className="rep-field">
                            <span>
                              {countMode === 'whole-vehicle'
                                ? 'عددُ المركبة كلّها (كجم)'
                                : 'المتبقّي الفعليّ لهذا الأمر (كجم)'}
                            </span>
                            <input
                              inputMode="decimal"
                              className="rep-num"
                              value={
                                countMode === 'whole-vehicle'
                                  ? closingDraft.vehicleCountQty
                                  : closingDraft.actualRemainingQty
                              }
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
                              onChange={(event) =>
                                setClosingDraft({ ...closingDraft, returnedQty: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>تالف (كجم)</span>
                            <input
                              inputMode="decimal"
                              className="rep-num"
                              value={closingDraft.damagedQty}
                              onChange={(event) =>
                                setClosingDraft({ ...closingDraft, damagedQty: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>سببُ التلف (مطلوبٌ إن كان التالفُ أكثرَ من صفر)</span>
                            <input
                              className="input"
                              value={closingDraft.damageReason}
                              onChange={(event) =>
                                setClosingDraft({ ...closingDraft, damageReason: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>نقدٌ محصَّل للوردية</span>
                            <input
                              inputMode="decimal"
                              className="rep-num"
                              value={closingDraft.collectedCash}
                              onChange={(event) =>
                                setClosingDraft({ ...closingDraft, collectedCash: event.target.value })
                              }
                            />
                          </label>
                          <label className="rep-field">
                            <span>ملاحظاتُ الإغلاق</span>
                            <input
                              className="input"
                              value={closingDraft.closingNotes}
                              onChange={(event) =>
                                setClosingDraft({ ...closingDraft, closingNotes: event.target.value })
                              }
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
                          <p className="rep-note" data-tone="danger">
                            {closingVerdict.message}
                          </p>
                        )}
                        <div className="rep-actions">
                          <button
                            type="button"
                            className="rep-btn"
                            data-variant="primary"
                            disabled={
                              busy ||
                              !closingVerdict.ok ||
                              closingQueueVerdict.blocked.length > 0 ||
                              !canClose
                            }
                            onClick={() =>
                              void submit({
                                operation: 'closing',
                                body: closingVerdict.ok
                                  ? (closingVerdict.payload as Record<string, unknown>)
                                  : {},
                                targetId: closingTarget.id,
                                labelAr: closingTarget.number,
                                successAr: 'قُدِّم إعلانُ الإغلاق إلى المحاسب — ولا يُشطب فرقٌ بلا اعتماده.',
                                after: () => setClosingTarget(null),
                              })
                            }
                          >
                            تقديمُ الإغلاق
                          </button>
                          <button
                            type="button"
                            className="rep-btn"
                            onClick={() => setClosingTarget(null)}
                          >
                            إلغاء
                          </button>
                        </div>
                      </Panel>
                    ) : null}
                  </Panel>
                </>
              ) : null}

              {/* ═══════════════ ٩) شاشة المزامنة وطابور عدم الاتصال والإشعارات ═══════════════ */}
              {activeSection === 'queue' ? (
                <>
                  <div className="rep-section-head">
                    <h2>المزامنة دون اتصال والإشعارات</h2>
                    <button type="button" className="rep-pill" onClick={() => navigateSection('overview')}>
                      ← ملخص الوردية
                    </button>
                  </div>

                  <Panel
                    title="نيّاتُك المحفوظة دون اتصال"
                    hint={
                      <>
                        {queueSummaryLine(counts)} · {REP_QUEUE_MESSAGES.deviceLine(deviceId)}
                      </>
                    }
                    bodyClassName="grid gap-2.5"
                  >
                    <div className="rep-actions">
                      <button
                        type="button"
                        className="rep-btn"
                        data-variant="primary"
                        disabled={busy || counts.pending === 0}
                        onClick={() => void replayQueue()}
                      >
                        أعد إرسال المعلّق (<span className="rep-num">{counts.pending}</span>)
                      </button>
                      <button
                        type="button"
                        className="rep-btn"
                        disabled={busy || counts.synced === 0}
                        onClick={() => void dropSynced()}
                      >
                        احذف ما وصل (<span className="rep-num">{counts.synced}</span>)
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
                                  record.status === 'synced'
                                    ? 'ok'
                                    : record.status === 'refused'
                                      ? 'danger'
                                      : 'warn'
                                }
                              >
                                {record.status === 'pending'
                                  ? 'معلّقة'
                                  : record.status === 'synced'
                                    ? 'وصلت'
                                    : 'مرفوضة'}
                              </span>
                            </div>
                            <div className="rep-row-meta">
                              <span>
                                محاولات <span className="rep-num">{record.attempts}</span>
                              </span>
                              <span className="rep-num">{record.endpoint}</span>
                            </div>
                            <div className="rep-row-meta">
                              <span
                                className="rep-num"
                                title="مفتاحُ عدم التكرار — يُخزَّن مع النيّة فتُعاد بلا تكرار"
                              >
                                {record.idempotencyKey}
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
                  </Panel>

                  <Panel
                    title="إشعارات وتنبيهات الإدارة"
                    hint={<>{notes.notifications}</>}
                    bodyClassName="grid gap-2.5"
                  >
                    {data.notifications.length === 0 ? (
                      <p className="rep-empty">لا إشعارات جديدة في هذه النافذة.</p>
                    ) : (
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
                    )}
                  </Panel>
                </>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}

export default function RepAppPage() {
  return (
    <Suspense>
      <RepWorkspaceInner />
    </Suspense>
  );
}
