'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
  type SortState,
} from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { useSubmissionKey } from '@erp/web-core/use-submission-key';
import {
  buildLoadOrderPayload,
  buildReceiptPayload,
  canCancelLoadOrder,
  canConfirmReceipt,
  loadOrderStatusLabel,
} from '@erp/web-van/distribution';

import { DataTable, Notice } from '../../components/data-view';
import { Screen } from '../../components/screen';
import {
  awaitingReceiptRows,
  batchOptionLabel,
  batchItemOption,
  itemRequiresBatch,
  LOAD_ORDER_COLUMNS,
  loadOrderCellText,
  loadOrderViewRows,
  mapLoadOrders,
  mapSalesmen,
  salesmanAdvisories,
  salesmanBlockingWarning,
  salesmanLabel,
  type DistributionDashboard,
  type LoadOrderRow,
  type LoadOrderViewRow,
  type SalesmanRow,
} from '../../lib/distribution-screen';
import {
  itemLabel,
  numberText,
  warehouseLabel,
  type ItemOption,
  type WarehouseOption,
} from '../../lib/lookups';
import { useQuery } from '../../lib/use-query';
import { listState, rowKeyFrom, tableColumns } from '../../lib/ui-kit';

/** الصلاحية التي يفرضها الخادم على `POST /van-sales/load-orders` وعلى `…/cancel`. */
const LOAD_PERMISSION = 'van_sales.load.manage';
/** وقراءة اللوحة والمندوبين، ومسار تأكيد الاستلام/رفضه. */
const VIEW_PERMISSION = 'van_sales.view';

type ActionKind = 'confirm' | 'reject' | 'cancel';

const ACTION_LABELS: Record<ActionKind, string> = {
  confirm: 'تأكيد الاستلام',
  reject: 'رفض الاستلام',
  cancel: 'إلغاء أمر التحميل',
};

const ACTION_ROUTES: Record<ActionKind, (id: string) => string> = {
  confirm: (id) => `/van-sales/load-orders/${id}/confirm-receipt`,
  reject: (id) => `/van-sales/load-orders/${id}/reject-receipt`,
  cancel: (id) => `/van-sales/load-orders/${id}/cancel`,
};

/**
 * 🚚 شاشة التوزيع والأحمال — أمر تحميل، وتأكيد استلامه أو رفضه، وإلغاؤه.
 *
 * ثلاث قواعد أمانة تحكمها (هي نفسها في شاشة الإنتاج):
 *   1. **العقد من الحزمة المشتركة**: `buildLoadOrderPayload` و`buildReceiptPayload` من
 *      `@erp/web-van/distribution` — لا نسخة ثانية هنا. والترتيب ترتيب الخادم: المندوب، ثمّ
 *      الكمية، ثمّ مصدر الصنف. ونصوص الرفض نصوصُ الخادم حرفاً (يقيسها
 *      `apps/api/test/van-sales-stock-acceptance.spec.ts` و`…-load-order-basis.spec.ts` من
 *      طرفه). ومنها §5.1: صنفٌ يُتتبَّع بالدفعات لا تُحمَّل عهدته بلا دفعةٍ مُسمّاة
 *      (‏`VAN_LOAD_ORDER_BATCH_REQUIRED`) — فالخادم لم يعد يختلق `PROD-<اليوم>-0001` عند
 *      غيابها. والشاشة ترفض «بلا صنفٍ وبلا دفعة» و«صنفٌ بالدفعات بلا دفعة» **قبل الإرسال**،
 *      لأنّ حمولةً تُنسب إلى صنفٍ لم يختره المشرف، أو إلى دفعةٍ لم تُسمَّ، عهدةٌ بلا قصد.
 *   2. **لا أرقام مختلَعة**: الجدول صفوف `loadOrders` من `GET /van-sales/dashboard` كما هي
 *      (‏`ORDER BY l.created_at DESC LIMIT 60`)، والغائب `—` لا صفر، والحالة غير المعروفة
 *      تُعرض خاماً. والاستجابة من `POST /van-sales/load-orders` هي **اللوحة كاملة**
 *      (‏`return this.dashboard(tenantId)`)، فأحدث أمرٍ هو `loadOrders[0]` منها — ولا يُخترع
 *      رقمُ أمرٍ في المتصفح أبداً.
 *   3. **الضابط في الخادم**: الصلاحية تُفحص هنا كي لا تُعرض شاشةٌ سيُرفض طلبها، لكن الحكم
 *      هناك — وتأكيد الاستلام يخصّ المندوب صاحب العهدة أو من يملك `van_sales.load.manage`،
 *      فمندوبٌ آخر يُرفض 403 ونصّ رفضه يُعرض كما جاء (`apiErrorText`). إخفاء الزرّ ليس ضبطاً
 *      للوصول، لذا لا تُخفي الشاشة إجراءً إلّا حين يكون مآله 409 مؤكّداً بحسب حالة الصفّ.
 *
 * وما **ليس** هنا: إقفال العهدة واعتماده وتسوية فرق المخزون — وحدةٌ مستقلة في التنقل
 * (‏`custody`) مبنيّة في هذه اللوحة على `/custody` — قرار السياسة اتُّخذ ونُفِّذ؛ والأستاذ
 * وتفصيل القيود وتسوية الرواتب في `apps/staff`، لا هنا.
 *
 * والتنظيم كما في `apps/staff`: غلافُ الشاشة من `Screen`، والطلب من `useQuery`
 * (لا يُرسل طلبٌ بلا صلاحية — والسبب موثّقٌ أدناه)، والتغذيةُ الراجعة من `Notice`،
 * والجدول من `DataTable` عبر `lib/ui-kit.ts`، والقوائم من `Select`.
 */
export default function DistributionPage() {
  const { can } = useSession();
  const canManage = can(LOAD_PERMISSION);
  const canView = can(VIEW_PERMISSION);

  /**
   * اللوحةُ بطلبٍ واحد — ولا يُرسل الطلبُ بلا صلاحيةٍ (٤٠٣ محتوم): فالخادمُ
   * هو الضابط، وهذه الواجهة لا تستطلع رأيه بلا وجه. وحين يُمنح الحسابُ
   * الصلاحيةَ لاحقًا يُعيد `useQuery` الطلبَ بعينه (`canView` في الاعتماديات).
   */
  const dashboard = useQuery<DistributionDashboard | undefined>(
    () => (canView ? apiData<DistributionDashboard>('/van-sales/dashboard') : Promise.resolve(undefined)),
    [canView],
  );
  /** القوائم auxiliary: فشلُ كلٍّ منها يُقال في `lookupWarning` ولا يُسقط الشاشة. */
  const salesmenQuery = useQuery<SalesmanRow[]>(
    () => (canView ? apiList<SalesmanRow>('/van-sales/salesmen') : Promise.resolve([])),
    [canView],
  );
  const itemsQuery = useQuery<ItemOption[]>(
    () => (canView ? apiList<ItemOption>('/organization/catalog/items') : Promise.resolve([])),
    [canView],
  );
  const warehousesQuery = useQuery<WarehouseOption[]>(
    () => (canView ? apiList<WarehouseOption>('/warehouses') : Promise.resolve([])),
    [canView],
  );
  const salesmen = useMemo(() => mapSalesmen(salesmenQuery.data), [salesmenQuery.data]);
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const warehouses = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data]);

  // ‏أمر التحميل الجديد
  const [salesmanId, setSalesmanId] = useState('');
  const [batchKey, setBatchKey] = useState('');
  const [productionBatchNo, setProductionBatchNo] = useState('');
  const [itemId, setItemId] = useState('');
  const [loadedQty, setLoadedQty] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [vanWarehouseId, setVanWarehouseId] = useState('');
  const [notes, setNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [created, setCreated] = useState<LoadOrderRow | undefined>();

  // ‏الإجراء على صفٍّ قائم (استلام/رفض/إلغاء)
  const [actionRow, setActionRow] = useState<LoadOrderRow | undefined>();
  const [actionKind, setActionKind] = useState<ActionKind | undefined>();
  const [receivedQty, setReceivedQty] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | undefined>();
  const [actionDone, setActionDone] = useState<string | undefined>();
  /** فرزُ جدول الأحمال — حالةٌ يملكها العميل لا الخادم (ترتيبُ الخادم هو الافتراضي). */
  const [loadSort, setLoadSort] = useState<SortState>(null);

  const pickedSalesman = salesmen.find((row) => row.id === salesmanId);
  /**
   * 🏷️ بطاقةُ الصنف المختار من `GET /organization/catalog/items` — منها `trackLot` لتقول
   * الشاشة حكم الخادم قبل الإرسال، واسمُه لتقول جملته نفسها. ولا يُرسلان في الحمولة:
   * الخادم يقرأ بطاقته بنفسه.
   */
  const pickedItem = itemId ? (items.find((row) => row.id === itemId) ?? null) : null;
  const draft = useMemo(
    () => ({
      salesmanId,
      itemId,
      itemTrackLot: pickedItem?.trackLot === true,
      itemName: pickedItem ? itemLabel(pickedItem) : '',
      productionBatchNo,
      loadedQty,
      warehouseId,
      vanWarehouseId,
      vehiclePlate,
      notes,
    }),
    [salesmanId, itemId, pickedItem, productionBatchNo, loadedQty, warehouseId, vanWarehouseId, vehiclePlate, notes],
  );
  const verdict = useMemo(() => buildLoadOrderPayload(draft), [draft]);
  // 🔁 مفتاحٌ واحد للنيّة الواحدة: إعادة الإرسال بعد انقطاع الشبكة ترجع بأمر التحميل الأول
  // (فالخادم يفرد `van_load_orders.idempotency_key`) بدل توريدٍ ثانٍ وخصمٍ ثانٍ من المستودع.
  const loadOrderKey = useSubmissionKey('van-load-order', draft);
  const loadOrders = useMemo(
    () => loadOrderViewRows(mapLoadOrders(dashboard.data)),
    [dashboard.data],
  );
  const pendingReceipt = useMemo(() => awaitingReceiptRows(loadOrders), [loadOrders]);
  const batches = dashboard.data?.productionBatches ?? [];

  function pickSalesman(id: string) {
    setSalesmanId(id);
    const rep = salesmen.find((row) => row.id === id);
    // ‏لوحة السيارة ومستودعها من بطاقة المندوب (بيانات الخادم) لا اختراع — وتُملأ الخانة
    // الفارغة فقط، فلا يُكتب فوق ما قصده المشرف.
    const plate = rep?.vehiclePlate ?? '';
    const vanWarehouse = rep?.warehouseId ?? '';
    if (plate) setVehiclePlate((current) => current || plate);
    if (vanWarehouse) setVanWarehouseId((current) => current || vanWarehouse);
  }

  function pickBatch(key: string) {
    setBatchKey(key);
    const batch = batches.find((row) => (row.id ?? '') === key);
    setProductionBatchNo(batch?.batchNo ?? '');
    const fromBatch = batch ? batchItemOption(batch) : null;
    if (fromBatch) setItemId(fromBatch.id);
  }

  function openAction(row: LoadOrderRow, kind: ActionKind) {
    setActionRow(row);
    setActionKind(kind);
    setReceivedQty('');
    setReceiptNotes('');
    setActionReason('');
    setActionError(undefined);
    setActionDone(undefined);
  }

  function closeAction() {
    setActionRow(undefined);
    setActionKind(undefined);
    setActionError(undefined);
  }

  const receiptVerdict = useMemo(() => {
    if (!actionRow || actionKind !== 'confirm') return null;
    return buildReceiptPayload({
      receivedQty,
      notes: receiptNotes,
      loadedQty: actionRow.loadedQty === null || actionRow.loadedQty === undefined ? '' : String(actionRow.loadedQty),
    });
  }, [actionRow, actionKind, receivedQty, receiptNotes]);

  async function submit() {
    if (busy) return;
    setSubmitError(undefined);
    setCreated(undefined);
    if (!verdict.ok) {
      setSubmitError(verdict.message);
      return;
    }
    setBusy(true);
    try {
      const fresh = await apiPost<DistributionDashboard>('/van-sales/load-orders', {
        ...verdict.payload,
        idempotencyKey: loadOrderKey.key(),
      });
      // ‏الاستجابة هي اللوحة كاملة، فأحدث أمرٍ أولُ صفوفها — لا رقمَ مُختلَع
      // من المتصفح — وتُقرأ هنا لبطاقةِ النجاح، والجدولُ يُعاد قراءتُه من
      // الخادم كما يفعل staff بعد كلّ كتابة.
      setCreated(mapLoadOrders(fresh)[0]);
      setLoadedQty('');
      setNotes('');
      setBatchKey('');
      setProductionBatchNo('');
      // نجاحٌ رُصد: التوريد التالي نيّةٌ جديدة ولو تطابق محتواها (توريدان متماثلان في يوم).
      loadOrderKey.reset();
      void dashboard.reload();
    } catch (caught) {
      setSubmitError(apiErrorText(caught, 'تعذّر إنشاء أمر التحميل'));
    } finally {
      setBusy(false);
    }
  }

  async function runAction() {
    if (actionBusy || !actionRow || !actionKind) return;
    const id = actionRow.id;
    if (!id) {
      setActionError('الصفّ بلا معرّف من الخادم — لا يُنفَّذ إجراءٌ على صفٍّ مجهول الهوية.');
      return;
    }
    setActionError(undefined);

    let body: Record<string, unknown> | undefined;
    if (actionKind === 'confirm') {
      if (!receiptVerdict) return;
      if (!receiptVerdict.ok) {
        setActionError(receiptVerdict.message);
        return;
      }
      body = receiptVerdict.payload;
    } else {
      const reason = actionReason.trim();
      body = reason ? { reason } : {};
    }

    setActionBusy(true);
    try {
      // ‏لا يُقرأ رقمٌ من الاستجابة: الجدول يُعاد تحميله من اللوحة، فيكون المعروض ما قاله الخادم.
      await apiPost<unknown>(ACTION_ROUTES[actionKind](id), body);
      setActionDone(
        `${ACTION_LABELS[actionKind]} — أمر التحميل ${actionRow.number ?? id}: نُفِّذ في الخادم، والجدول أدناه من اللوحة المحدَّثة.`,
      );
      closeAction();
      await dashboard.reload();
    } catch (caught) {
      setActionError(apiErrorText(caught, `تعذّر ${ACTION_LABELS[actionKind]}`));
    } finally {
      setActionBusy(false);
    }
  }

  const blocking = pickedSalesman ? salesmanBlockingWarning(pickedSalesman) : null;
  const advisories = pickedSalesman ? salesmanAdvisories(pickedSalesman) : [];

  const lookupWarning = useMemo(() => {
    const missing: string[] = [];
    if (salesmenQuery.status === 'error') missing.push('المندوبين');
    if (itemsQuery.status === 'error') missing.push('الأصناف');
    if (warehousesQuery.status === 'error') missing.push('المستودعات');
    return missing.length > 0
      ? `تعذّر جلب ${missing.join(' و')} — تحتاج صلاحية القراءة أو أنّ الخادم رفض. الشاشة تعرض ما وصلها فقط، ولا أمرَ تحميل بلا مندوب.`
      : undefined;
  }, [salesmenQuery.status, itemsQuery.status, warehousesQuery.status]);

  return (
    <Screen
      actions={
        <>
          <span className="bak-badge">POST /van-sales/load-orders</span>
          <Button
            disabled={dashboard.status === 'loading' || !canView}
            onClick={() => void dashboard.reload()}
            size="sm"
          >
            تحديث
          </Button>
        </>
      }
      subtitle="أمر تحميلٍ لمندوب: يُصرف من المستودع بمناقلة رسمية وتصير البضاعة عهدةً عند تأكيد الاستلام. والإقفال والاعتماد وتسوية الفرق وحدةٌ أخرى (في `staff`)."
      title="التوزيع والأحمال"
    >
      {!canView ? (
        <Card>
          <CardBody>
            <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
              🔒 لا تملك `{VIEW_PERMISSION}` — والخادم يرفض قراءة لوحة التوزيع وقائمة المندوبين.
              ولم يُرسل هذا التطبيق طلباً سيُرفض حتماً، ولا عرض أرقاماً من المتصفح بدلها.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {dashboard.status === 'error' ? (
        <Card>
          <CardBody>
            <p
              className="m-0 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger-ink"
              role="alert"
            >
              تعذّر تحميل بيانات التوزيع: {dashboard.error}
            </p>
            <p className="m-0 mt-2 text-[12.5px] text-muted">
              السبب المعتاد: لا تملك `{VIEW_PERMISSION}` أو أنّ الـAPI غير متاح من هذه الواجهة.
              ولا تُعرض أحمالٌ بديلة من المتصفح.
            </p>
            <Button className="mt-3" onClick={() => void dashboard.reload()} size="sm">
              إعادة المحاولة
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <Notice
        notice={lookupWarning ? { kind: 'warn', text: lookupWarning } : undefined}
      />

      <Notice notice={actionDone ? { kind: 'ok', text: actionDone } : undefined} />

      {created ? (
        <Notice
          notice={{
            kind: 'ok',
            text: `✅ أُنشئ أمر التحميل ${created.number ?? '—'} — الحالة: ${loadOrderStatusLabel(
              created.status ?? '',
            )} — المصروف: ${numberText(created.loadedQty)} — بانتظار تأكيد المندوب للاستلام.`,
          }}
        />
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader
            subtitle="الحقول كما يقرأها الخادم. ونصوص الرفض نصوصُه حرفاً (مثبّتةٌ في الطرفين): «بلا صنفٍ وبلا دفعة» مرفوضةٌ هنا وقبل الإرسال، وصنفٌ يُتتبَّع بالدفعات بلا دفعةٍ مُسمّاة مرفوضٌ هنا وفي الخادم (422 VAN_LOAD_ORDER_BATCH_REQUIRED) — فلم يعد الخادم يفترض رقم دفعةٍ من تاريخ اليوم."
            title="أمر تحميل جديد"
          />
          <CardBody>
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="grid gap-3 md:grid-cols-2">
                <Select
                  label="المندوب (صاحب العهدة)"
                  onChange={(event) => pickSalesman(event.target.value)}
                  options={salesmen.map((row) => ({
                    label: `${salesmanLabel(row)}${row.warehouseName ? ` — ${row.warehouseName}` : ' — بلا مستودع سيارة'}`,
                    value: row.id ?? '',
                  }))}
                  placeholder="— اختر المندوب —"
                  value={salesmanId}
                />

                <Input
                  dir="ltr"
                  hint="صنفٌ واحد لكلّ أمر تحميل — حمولةٌ متعددة الأصناف أوامرٌ متعددة."
                  inputMode="decimal"
                  label="الكمية المحمّلة"
                  onChange={(event) => setLoadedQty(event.target.value)}
                  placeholder="0.0000"
                  value={loadedQty}
                />
              </div>

              {pickedSalesman ? (
                <div className="grid gap-1.5">
                  {blocking ? (
                    <Notice notice={{ kind: 'warn', text: blocking }} />
                  ) : null}
                  {advisories.map((note) => (
                    <p className="m-0 text-[12.5px] text-muted" key={note}>
                      · {note}
                    </p>
                  ))}
                  <p className="m-0 text-[12.5px] text-muted" dir="rtl">
                    عهدته الآن: {numberText(pickedSalesman.custody?.custodyQty)} — أوامر مفتوحة:{' '}
                    {numberText(pickedSalesman.custody?.openLoadOrders)} — بانتظار استلام:{' '}
                    {numberText(pickedSalesman.custody?.pendingReceipts)} (من `GET /van-sales/salesmen`).
                  </p>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <Select
                  label="الصنف المحمَّل"
                  onChange={(event) => setItemId(event.target.value)}
                  options={items.map((row) => ({
                    label: row.trackLot === true ? `${itemLabel(row)} — يتطلّب دفعة إنتاج` : itemLabel(row),
                    value: row.id,
                  }))}
                  placeholder="— اختر الصنف —"
                  value={itemId}
                />

                <Select
                  label="أو اربطه بدفعة إنتاج (يُشتقّ الصنف واللوت منها)"
                  onChange={(event) => pickBatch(event.target.value)}
                  options={batches.map((row) => ({
                    label: batchOptionLabel(row),
                    value: row.id ?? row.batchNo ?? '',
                  }))}
                  placeholder="— بلا ربط بدفعة —"
                  value={batchKey}
                />
              </div>

              {itemRequiresBatch(items, itemId, productionBatchNo) ? (
                <Notice
                  notice={{
                    kind: 'warn',
                    text: '🏷️ هذا الصنف يُتتبَّع بالدفعات: اربطه بدفعة إنتاج من القائمة، وإلا رفضه الخادم (‏422 VAN_LOAD_ORDER_BATCH_REQUIRED) — ولا يُفترض رقمُ دفعةٍ من تاريخ اليوم، لأنه يلتقي برقم أوّل دفعةٍ تُنشأ اليوم نفسها.',
                  }}
                />
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <Select
                  label="مستودع المصدر (المصروف منه)"
                  onChange={(event) => setWarehouseId(event.target.value)}
                  options={warehouses.map((row) => ({
                    label: warehouseLabel(row),
                    value: row.id,
                  }))}
                  placeholder="— يحدده الخادم —"
                  value={warehouseId}
                />

                <Select
                  label="مستودع السيارة (وجهة العهدة)"
                  onChange={(event) => setVanWarehouseId(event.target.value)}
                  options={warehouses.map((row) => ({
                    label: warehouseLabel(row),
                    value: row.id,
                  }))}
                  placeholder="— يشتقّه الخادم من بطاقة المندوب —"
                  value={vanWarehouseId}
                />
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <Input
                  hint="تُملأ من بطاقة المندوب حين تكون الخانة فارغة — ولا تُختلق لوحة."
                  label="لوحة السيارة"
                  onChange={(event) => setVehiclePlate(event.target.value)}
                  value={vehiclePlate}
                />

                <Input label="ملاحظات" onChange={(event) => setNotes(event.target.value)} value={notes} />
              </div>

              {productionBatchNo ? (
                <p className="m-0 text-[12.5px] text-muted">
                  رقم الدفعة المُرسلة: <span dir="ltr">{productionBatchNo}</span> — والخادم يتحقّق
                  أنّها دفعةُ هذا المستأجر، ويشتقّ منها الصنف واللوت إن لم يُكتب صنف.
                </p>
              ) : null}

              {!verdict.ok ? <Notice notice={{ kind: 'warn', text: verdict.message }} /> : null}

              {submitError ? <Notice notice={{ kind: 'danger', text: `رفض الخادم: ${submitError}` }} /> : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button disabled={busy || !verdict.ok} size="sm" type="submit">
                  {busy ? 'جارٍ الإنشاء…' : 'إنشاء أمر التحميل'}
                </Button>
                <span className="text-[12px] text-muted">
                  لا تُرسل الشاشة حدّ البونص ولا سعراً: السياسة والتسعير من الخادم.
                </span>
              </div>
            </form>
          </CardBody>
        </Card>
      ) : null}

      {actionRow && actionKind ? (
        <Card>
          <CardHeader
            subtitle={`أمر التحميل ${actionRow.number ?? actionRow.id ?? '—'} — ${actionRow.itemName ?? '—'} · مصروف ${numberText(actionRow.loadedQty)} · مستلم ${numberText(actionRow.receivedQty)}`}
            title={ACTION_LABELS[actionKind]}
          />
          <CardBody>
            <div className="grid gap-3">
              {actionKind === 'confirm' ? (
                <>
                  <Input
                    dir="ltr"
                    hint="فارغة ⇒ يستعمل الخادم الكمية المحمّلة. والصفر يُكتب صراحةً."
                    inputMode="decimal"
                    label="الكمية المستلمة فعلياً"
                    onChange={(event) => setReceivedQty(event.target.value)}
                    placeholder="فارغة = الكمية المحمّلة"
                    value={receivedQty}
                  />
                  <Input
                    label="ملاحظات الاستلام"
                    onChange={(event) => setReceiptNotes(event.target.value)}
                    value={receiptNotes}
                  />
                  {receiptVerdict?.ok && receiptVerdict.usesLoadedQty ? (
                    <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-3 py-2 text-[12.5px] font-semibold text-warn-ink">
                      تركتَها فارغة ⇒ يستعمل الخادم الكمية المحمّلة (
                      <span dir="ltr">{numberText(actionRow.loadedQty)}</span>) ويكون الفرق صفراً.
                      الفراغ هنا ليس صفراً مكتوباً: لو استلمتَ <strong>صفر</strong> فاكتب 0 صراحةً ليُسجَّل
                      الفرق كاملاً.
                    </p>
                  ) : null}
                  {receiptVerdict && !receiptVerdict.ok ? (
                    <Notice notice={{ kind: 'warn', text: receiptVerdict.message }} />
                  ) : null}
                </>
              ) : (
                <Input
                  hint="اختياري — يكتب الخادم سبباً افتراضياً إن تُرك فارغاً."
                  label="السبب"
                  onChange={(event) => setActionReason(event.target.value)}
                  value={actionReason}
                />
              )}

              {actionError ? <Notice notice={{ kind: 'danger', text: `رفض الخادم: ${actionError}` }} /> : null}

              <div className="flex flex-wrap items-center gap-2">
                <Button
                  disabled={actionBusy || (actionKind === 'confirm' && receiptVerdict?.ok === false)}
                  onClick={() => void runAction()}
                  size="sm"
                >
                  {actionBusy ? 'جارٍ التنفيذ…' : ACTION_LABELS[actionKind]}
                </Button>
                <Button onClick={closeAction} size="sm" variant="ghost">
                  إغلاق
                </Button>
                {actionKind === 'confirm' ? (
                  <span className="text-[12px] text-muted">
                    يؤكّده المندوب صاحب العهدة أو من يملك `{LOAD_PERMISSION}` — وغيرهما يُرفض 403
                    من الخادم.
                  </span>
                ) : null}
              </div>
            </div>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          action={<span className="bak-badge">{loadOrders.length} صف</span>}
          subtitle="آخر 60 أمر تحميل كما يعيدها الخادم (`ORDER BY created_at DESC`) — بلا تلخيصٍ محلي."
          title="الأحمال"
        />
        <CardBody>
          <DataTable<LoadOrderViewRow>
            actions={(row) => [
              ...(canConfirmReceipt(row)
                ? [{ label: 'تأكيد الاستلام', onClick: () => openAction(row, 'confirm') }]
                : []),
              ...(canCancelLoadOrder(row) && canManage
                ? [{ label: 'إلغاء أمر التحميل', onClick: () => openAction(row, 'cancel') }]
                : []),
              ...(canConfirmReceipt(row)
                ? [{ label: 'رفض الاستلام', danger: true, onClick: () => openAction(row, 'reject') }]
                : []),
            ]}
            columns={tableColumns<LoadOrderViewRow>(LOAD_ORDER_COLUMNS, loadOrderCellText)}
            dense
            empty={
              <span className="m-0 text-[13px] text-muted">
                لا أمر تحميل بعد{canManage ? ' — أنشئ الأول أعلاه' : ''}. ولا يُعرض هنا رقمٌ
                تجريبيّ.
              </span>
            }
            onSortChange={setLoadSort}
            pageSize={25}
            rowKey={rowKeyFrom(['id', 'number'])}
            rows={loadOrders}
            sort={loadSort}
            sortable
            state={listState({
              loading: dashboard.status === 'loading',
              error: dashboard.status === 'error' ? dashboard.error : undefined,
            })}
            storageKey="bakery-distribution-load-orders"
          />
          {dashboard.status !== 'loading' && pendingReceipt.length > 0 ? (
            <p className="m-0 mt-3 text-[12.5px] text-muted">
              {pendingReceipt.length} أمرٍ بانتظار استلام المندوب — البضاعة لا تدخل عهدةً رسمية
              قبله.
            </p>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHeader subtitle="ما الذي يفعله الخادم بأمر التحميل — بلا وعودٍ زائدة." title="ماذا يحدث بعد الإنشاء" />
        <CardBody>
          <ul className="m-0 grid gap-2 text-[13px] leading-relaxed text-ink">
            <li>
              يُصرف الصنف من مستودع المصدر بمناقلة رسمية (`stockTransferId`) إلى مستودع السيارة،
              و<strong>لا تدخل البضاعة عهدة المندوب عند الصرف</strong>: تدخلها عند تأكيد الاستلام
              (‏`InventoryService.receiveTransfer` — Dr المخزون / Cr بضاعة تحت التحويل).
            </li>
            <li>
              الاستلام الناقص يسجّل الفرق (`discrepancyQty`) ويُبقي الباقي <strong>في الطريق
              بانتظار قرار</strong> — قِيس حيّاً: مناولة `TR-000001` بقيت `partially_received`
              و2 كجم في الطريق، والصفّ يحمل `awaitingTransitDecision` وحالة تسوية
              `pending_transit_decision`. وحسم الفرق (`close-transit-difference`) وتسويته من وحدة
              «إقفال العهدة»: هذه الشاشة لا تُنهي فرقاً ولا تدّعي إنهاءه.
            </li>
            <li>
              الإلغاء (في `draft`/`pending_receipt`) ورفض الاستلام يُعيدان الكمية إلى مستودع
              المصدر — قِيس حيّاً: بعد إلغاء 5 كجم ورفض 3 كجم عاد الرصيد إلى ما كان ولم يبقَ في
              الطريق إلا فرق الاستلام الناقص. ورفض الخادم إلغاءَ أمرٍ بعد الاستلام (409
              ‏`VAN_LOAD_ORDER_NOT_CANCELLABLE`) هو ما تعكسه `canCancelLoadOrder` هنا.
            </li>
            <li>
              حدّ البونص (`maxBonusQty`/`maxBonusPct`) يُشتقّ من سياسة المستأجر في الخادم،
              والشاشة لا ترسله ولا تعدّله.
            </li>
            <li>
              <strong>لا رقمَ دفعةٍ مُختلَعة (§5.1 منفَّذ):</strong> كان الخادم يكتب على الأمر{' '}
              <code dir="ltr">{'PROD-<اليوم>-0001'}</code> حين لا تُذكر دفعة — وقِيس حيّاً أنّ `VLO-0001`
              حمل `PROD-20261014-0001` مع أنّ في المستأجر <strong>صفراً</strong> من دفعات الإنتاج. ولم
              يكن الرقم «مرجعاً بريئاً»: بادئةُ مولّد دفعات الإنتاج هي نفسها، فأوّلُ دفعةٍ تُنشأ في
              اليوم تحمل ذلك الرقم — ورفضُ الاستلام ينقص `issued_qty` من دفعةٍ لم تصرف شيئاً،
              والبيع يأخذ `unit_cost` دفعةٍ أخرى، ونسبُ اللوت في المناقلة والفاتورة يشير إلى دفعةٍ
              لم تُحمَّل. الآن: إمّا دفعةٌ مُسمّاة وإمّا «بلا دفعة» في العمود، وصنفٌ يُتتبَّع بالدفعات
              يُرفض تحميله بلا دفعة (‏422). وأوامرٌ كُتبت قبل الإصلاح قد تحمل رقماً لا يشير إلى
              دفعةٍ موجودة — تُقرأ كما هي، ولا يُعاد تأريخُ ما سُمّي خطأً.
            </li>
            <li>
              إن كان للمندوب حساب دخول أُرسل إليه إشعار `van_sales_supply_pending_receipt`
              برقم الأمر والكمية.
            </li>
            <li>
              المندوب ليس اسماً حراً: سجلّه مرتبطٌ بموظفٍ وحساب دخول، وصلاحياته يمنحها المدير —
              وبطاقة المندوب في `apps/staff` لا هنا.
            </li>
          </ul>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          subtitle="حدودٌ مقصودة، لا نقصٌ في التنفيذ — ومعها أين يُكمل المشرف."
          title="ما لا تفعله هذه الشاشة"
        />
        <CardBody>
          <ul className="m-0 grid gap-2 text-[13px] leading-relaxed text-ink">
            <li>
              <strong>إقفال العهدة واعتماده وتسوية فرق المخزون</strong> (`submit-closing` / `approve-closing` /
              `settle-stock` / `close-transit-difference`): مبنيّة في وحدة «إقفال العهدة» (‏`/custody`)
              من هذه اللوحة — فصلٌ رباعيّ للعجز (مبيع/بونص/مرتجع/تالف)، وقرار تحميل العجز على
              المندوب لكلّ حالةٍ بعلمٍ صريح، ولا تُقفل عهدةٌ بفرق مخزونٍ غير مسوّى. والأستاذ
              وتفصيل القيود في `apps/staff`.
            </li>
            <li>
              <strong>لا تحرير لأمر تحميل قائم</strong>: الإلغاء (في `draft`/`pending_receipt`) أو رفض
              الاستلام بسبب. تعديل كميةٍ مصروفة يعني كسر المناقلة الرسمية التي سندها.
            </li>
            <li>
              <strong>لا مبيعات ولا تحصيل هنا</strong>: مستندات المبيعات والفواتير والتحصيل وحداتٌ مستقلة في
              التنقل (ولم تُبنَ شاشاتها بعد) — وهذه الشاشة لا تلخّص أرقامها ولا تعرض نقديّةً
              من عند نفسها.
            </li>
            <li>
              <strong>لا حكم محلي على من يحقّ له التأكيد</strong>: الخادم يفحص أنّ المؤكّد هو المندوب صاحب
              العهدة أو حامل `{LOAD_PERMISSION}`، ورفضه (403) يُعرض بنصّه.
            </li>
          </ul>
        </CardBody>
      </Card>
    </Screen>
  );
}
