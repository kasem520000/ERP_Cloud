'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input, Table } from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { useSubmissionKey } from '@erp/web-core/use-submission-key';
import {
  buildLoadOrderPayload,
  buildReceiptPayload,
  canCancelLoadOrder,
  canConfirmReceipt,
  loadOrderStatusLabel,
  stockSettlementStatusLabel,
} from '@erp/web-van/distribution';

import {
  awaitingReceiptRows,
  batchCellText,
  batchItemOption,
  batchOptionLabel,
  itemRequiresBatch,
  mapLoadOrders,
  mapSalesmen,
  salesmanAdvisories,
  salesmanBlockingWarning,
  salesmanLabel,
  type DistributionDashboard,
  type LoadOrderRow,
  type SalesmanRow,
} from '../../lib/distribution-screen';
import {
  itemLabel,
  numberText,
  warehouseLabel,
  type ItemOption,
  type WarehouseOption,
} from '../../lib/lookups';

/** الصلاحية التي يفرضها الخادم على `POST /van-sales/load-orders` وعلى `…/cancel`. */
const LOAD_PERMISSION = 'van_sales.load.manage';
/** وقراءة اللوحة والمندوبين، ومسار تأكيد الاستلام/رفضه. */
const VIEW_PERMISSION = 'van_sales.view';

const selectClass = 'ui-select';

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
 * شاشة التوزيع والأحمال — أمر تحميل، وتأكيد استلامه أو رفضه، وإلغاؤه.
 *
 * ثلاث قواعد أمانة تحكمها (هي نفسها في شاشة الإنتاج):
 *   1. **العقد من الحزمة المشتركة**: `buildLoadOrderPayload` و`buildReceiptPayload` من
 *      `@erp/web-van/distribution` — لا نسخة ثانية هنا. والترتيب ترتيب الخادم: المندوب، ثمّ
 * الكمية، ثمّ مصدر الصنف. ونصوص الرفض نصوصُ الخادم حرفاً (يقيسها
 *      `apps/api/test/van-sales-stock-acceptance.spec.ts` و`…-load-order-basis.spec.ts` من
 * طرفه). ومنها §5.1: صنفٌ يُتتبَّع بالدفعات لا تُحمَّل عهدته بلا دفعةٍ مُسمّاة
 *      (‏`VAN_LOAD_ORDER_BATCH_REQUIRED`) — فالخادم لم يعد يختلق `PROD-<اليوم>-0001` عند
 * غيابها. والشاشة ترفض «بلا صنفٍ وبلا دفعة» و«صنفٌ بالدفعات بلا دفعة» **قبل الإرسال**،
 * لأنّ حمولةً تُنسب إلى صنفٍ لم يختره المشرف، أو إلى دفعةٍ لم تُسمَّ، عهدةٌ بلا قصد.
 *   2. **لا أرقام مختلَعة**: الجدول صفوف `loadOrders` من `GET /van-sales/dashboard` كما هي
 *      (‏`ORDER BY l.created_at DESC LIMIT 60`)، والغائب `—` لا صفر، والحالة غير المعروفة
 * تُعرض خاماً. والاستجابة من `POST /van-sales/load-orders` هي **اللوحة كاملة**
 *      (‏`return this.dashboard(tenantId)`)، فأحدث أمرٍ هو `loadOrders[0]` منها — ولا يُخترع
 * رقمُ أمرٍ في المتصفح أبداً.
 *   3. **الضابط في الخادم**: الصلاحية تُفحص هنا كي لا تُعرض شاشةٌ سيُرفض طلبها، لكن الحكم
 * هناك — وتأكيد الاستلام يخصّ المندوب صاحب العهدة أو من يملك `van_sales.load.manage`،
 * فمندوبٌ آخر يُرفض 403 ونصّ رفضه يُعرض كما جاء (`apiErrorText`). إخفاء الزرّ ليس ضبطاً
 * للوصول، لذا لا تُخفي الشاشة إجراءً إلّا حين يكون مآله 409 مؤكّداً بحسب حالة الصفّ.
 *
 * وما **ليس** هنا: إقفال العهدة واعتماده وتسوية فرق المخزون — وحدةٌ مستقلة في التنقل
 * (‏`custody`) مبنيّة في هذه اللوحة على `/custody` — قرار السياسة اتُّخذ ونُفِّذ؛ والأستاذ
 * وتفصيل القيود وتسوية الرواتب في `apps/staff`، لا هنا.
 */
export default function DistributionPage() {
  const { can } = useSession();
  const canManage = can(LOAD_PERMISSION);
  const canView = can(VIEW_PERMISSION);

  const [dashboard, setDashboard] = useState<DistributionDashboard | undefined>();
  const [salesmen, setSalesmen] = useState<SalesmanRow[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [lookupWarning, setLookupWarning] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

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

  const load = useCallback(async (): Promise<DistributionDashboard | undefined> => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const dash = await apiData<DistributionDashboard>('/van-sales/dashboard');
      setDashboard(dash);

      // ‏القوائم auxiliary: فشلها لا يُسقط الشاشة، بل يُقال صراحةً ماذا ينقص.
      const [salesmenResult, itemsResult, warehousesResult] = await Promise.allSettled([
        apiList<SalesmanRow>('/van-sales/salesmen'),
        apiList<ItemOption>('/organization/catalog/items'),
        apiList<WarehouseOption>('/warehouses'),
      ]);
      const missing: string[] = [];
      if (salesmenResult.status === 'fulfilled') setSalesmen(mapSalesmen(salesmenResult.value));
      else missing.push('المندوبين');
      if (itemsResult.status === 'fulfilled') setItems(itemsResult.value);
      else missing.push('الأصناف');
      if (warehousesResult.status === 'fulfilled') setWarehouses(warehousesResult.value);
      else missing.push('المستودعات');
      setLookupWarning(
        missing.length > 0
          ? `تعذّر جلب ${missing.join(' و')} — تحتاج صلاحية القراءة أو أنّ الخادم رفض. الشاشة تعرض ما وصلها فقط، ولا أمرَ تحميل بلا مندوب.`
          : undefined,
      );
      return dash;
    } catch (caught) {
      setLoadError(apiErrorText(caught, 'تعذّر تحميل بيانات التوزيع'));
      return undefined;
    } finally {
      setLoading(false);
    }
  }, []);

  // ‏بلا `van_sales.view` لا يُرسل طلبٌ سيُرفض حتماً (403): يُقال للمستخدم سببُ الفراغ.
  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    void load();
  }, [canView, load]);

  const pickedSalesman = salesmen.find((row) => row.id === salesmanId);
  /**
   * بطاقةُ الصنف المختار من `GET /organization/catalog/items` — منها `trackLot` لتقول
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
    [
      salesmanId,
      itemId,
      pickedItem,
      productionBatchNo,
      loadedQty,
      warehouseId,
      vanWarehouseId,
      vehiclePlate,
      notes,
    ],
  );
  const verdict = useMemo(() => buildLoadOrderPayload(draft), [draft]);
  // مفتاحٌ واحد للنيّة الواحدة: إعادة الإرسال بعد انقطاع الشبكة ترجع بأمر التحميل الأول
  // (فالخادم يفرد `van_load_orders.idempotency_key`) بدل توريدٍ ثانٍ وخصمٍ ثانٍ من المستودع.
  const loadOrderKey = useSubmissionKey('van-load-order', draft);
  const loadOrders = useMemo(() => mapLoadOrders(dashboard), [dashboard]);
  const pendingReceipt = useMemo(() => awaitingReceiptRows(loadOrders), [loadOrders]);
  const batches = dashboard?.productionBatches ?? [];

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
      loadedQty:
        actionRow.loadedQty === null || actionRow.loadedQty === undefined ? '' : String(actionRow.loadedQty),
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
      setDashboard(fresh);
      // ‏الاستجابة هي اللوحة كاملة، فأحدث أمرٍ أولُ صفوفها — لا رقمَ مُختلَع من المتصفح.
      setCreated(mapLoadOrders(fresh)[0]);
      setLoadedQty('');
      setNotes('');
      setBatchKey('');
      setProductionBatchNo('');
      // نجاحٌ رُصد: التوريد التالي نيّةٌ جديدة ولو تطابق محتواها (توريدان متماثلان في يوم).
      loadOrderKey.reset();
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
      await load();
    } catch (caught) {
      setActionError(apiErrorText(caught, `تعذّر ${ACTION_LABELS[actionKind]}`));
    } finally {
      setActionBusy(false);
    }
  }

  const blocking = pickedSalesman ? salesmanBlockingWarning(pickedSalesman) : null;
  const advisories = pickedSalesman ? salesmanAdvisories(pickedSalesman) : [];

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">التوزيع والأحمال</h1>
          <p className="ui-page-sub">
            أمر تحميلٍ لمندوب: يُصرف من المستودع بمناقلة رسمية وتصير البضاعة عهدةً{' '}
            <strong>عند تأكيد الاستلام</strong>. والإقفال والاعتماد وتسوية الفرق وحدةٌ أخرى (في `staff`).
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
              <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
                لا تملك صلاحيةَ هذا القسم — والخادم يرفض قراءة لوحة التوزيع وقائمة المندوبين. ولم يُرسل هذا
                التطبيق طلباً سيُرفض حتماً، ولا عرض أرقاماً من المتصفح بدلها.
              </p>
            </CardBody>
          </Card>
        ) : null}

        {loadError ? (
          <Card>
            <CardBody>
              <p
                className="m-0 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger-ink"
                role="alert"
              >
                تعذّر تحميل بيانات التوزيع: {loadError}
              </p>
              <p className="m-0 mt-2 text-[12.5px] text-muted">
                تحقّق من اتصالك بالشبكة ومن صلاحيتك على التوزيع، ثمّ أعد المحاولة — لا تُعرض هنا أحمالٌ محسوبة
                في المتصفّح.
              </p>
              <Button className="mt-3" onClick={() => void load()} size="sm">
                إعادة المحاولة
              </Button>
            </CardBody>
          </Card>
        ) : null}

        {lookupWarning ? (
          <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
            {lookupWarning}
          </p>
        ) : null}

        {actionDone ? (
          <p className="m-0 rounded-[10px] border border-ok-line bg-ok-soft px-4 py-2.5 text-[13px] font-semibold text-ok-ink">
            {actionDone}
          </p>
        ) : null}

        {canManage ? (
          <Card>
            <CardHeader
              subtitle="بياناتُ أمر التحميل: المندوب والمستودع والصنف والكمية. ولا يُقبل صنفٌ يُتتبَّع بالدفعات بلا رقم دفعة صريح — يُقال ذلك قبل الإرسال، والنظام يتحقّق منه أيضاً."
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
                  <label className="field">
                    <span>المندوب (صاحب العهدة)</span>
                    <select
                      className={selectClass}
                      onChange={(event) => pickSalesman(event.target.value)}
                      value={salesmanId}
                    >
                      <option value="">— اختر المندوب —</option>
                      {salesmen.map((row) => (
                        <option key={row.id} value={row.id ?? ''}>
                          {salesmanLabel(row)}
                          {row.warehouseName ? ` — ${row.warehouseName}` : ' — بلا مستودع سيارة'}
                        </option>
                      ))}
                    </select>
                  </label>

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
                      <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-3 py-2 text-[12.5px] font-semibold text-warn-ink">
                        {blocking}
                      </p>
                    ) : null}
                    {advisories.map((note) => (
                      <p key={note} className="m-0 text-[12.5px] text-muted">
                        · {note}
                      </p>
                    ))}
                    <p className="m-0 text-[12.5px] text-muted" dir="rtl">
                      عهدته الآن: {numberText(pickedSalesman.custody?.custodyQty)} — أوامر مفتوحة:{' '}
                      {numberText(pickedSalesman.custody?.openLoadOrders)} — بانتظار استلام:{' '}
                      {numberText(pickedSalesman.custody?.pendingReceipts)} (من بطاقة المندوب).
                    </p>
                  </div>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="field">
                    <span>الصنف المحمَّل</span>
                    <select
                      className={selectClass}
                      onChange={(event) => setItemId(event.target.value)}
                      value={itemId}
                    >
                      <option value="">— اختر الصنف —</option>
                      {items.map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.trackLot === true ? `${itemLabel(row)} — يتطلّب دفعة إنتاج` : itemLabel(row)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>أو اربطه بدفعة إنتاج (يُشتقّ الصنف واللوت منها)</span>
                    <select
                      className={selectClass}
                      onChange={(event) => pickBatch(event.target.value)}
                      value={batchKey}
                    >
                      <option value="">— بلا ربط بدفعة —</option>
                      {batches.map((row) => (
                        <option key={row.id ?? row.batchNo ?? ''} value={row.id ?? ''}>
                          {batchOptionLabel(row)}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {itemRequiresBatch(items, itemId, productionBatchNo) ? (
                  <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[12.5px] font-semibold text-warn-ink">
                    هذا الصنف يُتتبَّع بالدفعات: اربطه بدفعة إنتاج من القائمة، وإلا رفضه الخادم (‏422{' '}
                    <span dir="ltr">VAN_LOAD_ORDER_BATCH_REQUIRED</span>) — ولا يُفترض رقمُ دفعةٍ من تاريخ
                    اليوم، لأنه يلتقي برقم أوّل دفعةٍ تُنشأ اليوم نفسها.
                  </p>
                ) : null}

                <div className="grid gap-3 md:grid-cols-2">
                  <label className="field">
                    <span>مستودع المصدر (المصروف منه)</span>
                    <select
                      className={selectClass}
                      onChange={(event) => setWarehouseId(event.target.value)}
                      value={warehouseId}
                    >
                      <option value="">— يحدده الخادم —</option>
                      {warehouses.map((row) => (
                        <option key={row.id} value={row.id}>
                          {warehouseLabel(row)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>مستودع السيارة (وجهة العهدة)</span>
                    <select
                      className={selectClass}
                      onChange={(event) => setVanWarehouseId(event.target.value)}
                      value={vanWarehouseId}
                    >
                      <option value="">— يشتقّه الخادم من بطاقة المندوب —</option>
                      {warehouses.map((row) => (
                        <option key={row.id} value={row.id}>
                          {warehouseLabel(row)}
                        </option>
                      ))}
                    </select>
                  </label>
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
                    رقم الدفعة المُرسلة: <span dir="ltr">{productionBatchNo}</span> — والخادم يتحقّق أنّها
                    دفعةُ هذا المستأجر، ويشتقّ منها الصنف واللوت إن لم يُكتب صنف.
                  </p>
                ) : null}

                {!verdict.ok ? (
                  <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
                    {verdict.message}
                  </p>
                ) : null}

                {submitError ? (
                  <p
                    className="m-0 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger-ink"
                    role="alert"
                  >
                    رفض الخادم: {submitError}
                  </p>
                ) : null}

                {created ? (
                  <p className="m-0 rounded-[10px] border border-ok-line bg-ok-soft px-4 py-2.5 text-[13px] font-semibold text-ok-ink">
                    أُنشئ أمر التحميل <span dir="ltr">{created.number ?? '—'}</span> — الحالة:{' '}
                    {loadOrderStatusLabel(created.status ?? '')} — المصروف:{' '}
                    <span dir="ltr">{numberText(created.loadedQty)}</span> — بانتظار تأكيد المندوب للاستلام.
                  </p>
                ) : null}

                <div className="ui-form-actions">
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
                      hint="فارغة يستعمل الخادم الكمية المحمّلة. والصفر يُكتب صراحةً."
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
                        تركتَها فارغة يستعمل الخادم الكمية المحمّلة (
                        <span dir="ltr">{numberText(actionRow.loadedQty)}</span>) ويكون الفرق صفراً. الفراغ
                        هنا ليس صفراً مكتوباً: لو استلمتَ <strong>صفر</strong> فاكتب 0 صراحةً ليُسجَّل الفرق
                        كاملاً.
                      </p>
                    ) : null}
                    {receiptVerdict && !receiptVerdict.ok ? (
                      <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-3 py-2 text-[12.5px] font-semibold text-warn-ink">
                        {receiptVerdict.message}
                      </p>
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

                {actionError ? (
                  <p
                    className="m-0 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-2.5 text-[13px] font-semibold text-danger-ink"
                    role="alert"
                  >
                    رفض الخادم: {actionError}
                  </p>
                ) : null}

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
                      يؤكّده المندوب صاحب العهدة أو من يملك صلاحية الأحمال — وغيرهما يُرفض من الخادم.
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
            subtitle="أحدث ٦٠ أمر تحميل، مرتّبةً من الأحدث."
            title="الأحمال"
          />
          <CardBody>
            {loading ? (
              <p aria-busy="true" className="m-0 text-[13px] text-muted">
                جارٍ تحميل الأحمال…
              </p>
            ) : loadOrders.length === 0 ? (
              <p className="m-0 text-[13px] text-muted">
                لا أمر تحميل بعد{canManage ? ' — أنشئ الأول أعلاه' : ''}. ولا يُعرض هنا رقمٌ تجريبيّ.
              </p>
            ) : (
              <div className="bak-table-wrap">
                <Table
                  columns={[
                    {
                      key: 'c0',
                      header: 'رقم الأمر',
                      ltr: true,
                      cell: (row) => row.number ?? '—',
                    },
                    {
                      key: 'c1',
                      header: 'التاريخ',
                      ltr: true,
                      cell: (row) => row.loadDate ?? '—',
                    },
                    {
                      key: 'c2',
                      header: 'المندوب',
                      cell: (row) => row.salesmanName ?? '—',
                    },
                    {
                      key: 'c3',
                      header: 'الصنف',
                      cell: (row) => row.itemName ?? '—',
                    },
                    {
                      key: 'c4',
                      header: 'الدفعة',
                      ltr: true,
                      cell: (row) => batchCellText(row),
                    },
                    {
                      key: 'c5',
                      header: 'مصروف',
                      numeric: true,
                      ltr: true,
                      cell: (row) => numberText(row.loadedQty),
                    },
                    {
                      key: 'c6',
                      header: 'مستلم',
                      numeric: true,
                      ltr: true,
                      cell: (row) => numberText(row.receivedQty),
                    },
                    {
                      key: 'c7',
                      header: 'الفرق',
                      numeric: true,
                      ltr: true,
                      cell: (row) => numberText(row.discrepancyQty),
                    },
                    {
                      key: 'c8',
                      header: 'المتبقي',
                      numeric: true,
                      ltr: true,
                      cell: (row) => numberText(row.remainingQty),
                    },
                    {
                      key: 'c9',
                      header: 'الحالة',
                      cell: (row) => loadOrderStatusLabel(row.status ?? ''),
                    },
                    {
                      key: 'c10',
                      header: 'تسوية المخزون',
                      cell: (row) => stockSettlementStatusLabel(row.stockSettlementStatus ?? ''),
                    },
                    {
                      key: 'c11',
                      header: 'إجراء',
                      cell: (row) => (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {canConfirmReceipt(row) ? (
                            <span className="text-[11.5px] font-medium text-muted">
                              بانتظار استلام المندوب
                            </span>
                          ) : null}
                          {canCancelLoadOrder(row) && canManage ? (
                            <Button onClick={() => openAction(row, 'cancel')} size="sm" variant="ghost">
                              إلغاء
                            </Button>
                          ) : null}
                        </div>
                      ),
                    },
                  ]}
                  rows={loadOrders}
                  rowKey={(row) => row.id ?? `${row.number ?? 'load'}-${row.loadDate ?? ''}`}
                />
              </div>
            )}
            {!loading && pendingReceipt.length > 0 ? (
              <p className="m-0 mt-3 text-[12.5px] text-muted">
                {pendingReceipt.length} أمرٍ بانتظار استلام المندوب — البضاعة لا تدخل عهدةً رسمية قبله.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            subtitle="ما يحدث فعلياً عند إنشاء أمر التحميل — بلا وعودٍ زائدة."
            title="ماذا يحدث بعد الإنشاء"
          />
          <CardBody>
            <ul className="m-0 grid gap-2 text-[13px] leading-relaxed text-ink">
              <li>
                يُصرف الصنف من مستودع المصدر بمناقلة رسمية (`stockTransferId`) إلى مستودع السيارة، و
                <strong>لا تدخل البضاعة عهدة المندوب عند الصرف</strong>: تدخلها عند تأكيد الاستلام
                (‏`InventoryService.receiveTransfer` — Dr المخزون / Cr بضاعة تحت التحويل).
              </li>
              <li>
                الاستلام الناقص يسجّل الفرق (`discrepancyQty`) ويُبقي الباقي{' '}
                <strong>في الطريق بانتظار قرار</strong> — قِيس حيّاً: مناولة `TR-000001` بقيت
                `partially_received` و2 كجم في الطريق، والصفّ يحمل `awaitingTransitDecision` وحالة تسوية
                `pending_transit_decision`. وحسم الفرق (`close-transit-difference`) وتسويته من وحدة «إقفال
                العهدة»: هذه الشاشة لا تُنهي فرقاً ولا تدّعي إنهاءه.
              </li>
              <li>
                الإلغاء (في `draft`/`pending_receipt`) ورفض الاستلام يُعيدان الكمية إلى مستودع المصدر — قِيس
                حيّاً: بعد إلغاء 5 كجم ورفض 3 كجم عاد الرصيد إلى ما كان ولم يبقَ في الطريق إلا فرق الاستلام
                الناقص. ورفض الخادم إلغاءَ أمرٍ بعد الاستلام (409 ‏`VAN_LOAD_ORDER_NOT_CANCELLABLE`) هو ما
                تعكسه `canCancelLoadOrder` هنا.
              </li>
              <li>
                حدّ البونص (`maxBonusQty`/`maxBonusPct`) يُشتقّ من سياسة المستأجر في الخادم، والشاشة لا ترسله
                ولا تعدّله.
              </li>
              <li>
                <strong>لا رقمَ دفعةٍ مُختلَعاً (§5.1 منفَّذ):</strong> كان الخادم يكتب على الأمر{' '}
                <code dir="ltr">{'PROD-<اليوم>-0001'}</code> حين لا تُذكر دفعة — وقِيس حيّاً أنّ `VLO-0001`
                حمل `PROD-20261014-0001` مع أنّ في المستأجر <strong>صفراً</strong> من دفعات الإنتاج. ولم يكن
                الرقم «مرجعاً بريئاً»: بادئةُ مولّد دفعات الإنتاج هي نفسها، فأوّلُ دفعةٍ تُنشأ في اليوم تحمل
                ذلك الرقم — ورفضُ الاستلام ينقص `issued_qty` من دفعةٍ لم تصرف شيئاً، والبيع يأخذ `unit_cost`
                دفعةٍ أخرى، ونسبُ اللوت في المناقلة والفاتورة يشير إلى دفعةٍ لم تُحمَّل. الآن: إمّا دفعةٌ
                مُسمّاة وإمّا «بلا دفعة» في العمود، وصنفٌ يُتتبَّع بالدفعات يُرفض تحميله بلا دفعة (‏422).
                وأوامرٌ كُتبت قبل الإصلاح قد تحمل رقماً لا يشير إلى دفعةٍ موجودة — تُقرأ كما هي، ولا يُعاد
                تأريخُ ما سُمّي خطأً.
              </li>
              <li>
                إن كان للمندوب حساب دخول أُرسل إليه إشعار فوري بانتظار استلام الحمولة برقم الأمر
                والكمية.
              </li>
              <li>
                المندوب ليس اسماً حراً: سجلّه مرتبطٌ بموظفٍ وحساب دخول، وصلاحياته يمنحها المدير — وبطاقة
                المندوب تُدار من لوحة الإدارة والمبيعات.
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
                <strong>إقفال العهدة واعتماده وتسوية فرق المخزون</strong>: متاحة في وحدة «إقفال
                العهدة» من هذه اللوحة — فصلٌ رباعيّ للعجز (مبيع/بونص/مرتجع/تالف)، وقرار تحميل
                العجز على المندوب لكلّ حالةٍ بعلمٍ صريح، ولا تُقفل عهدةٌ بفرق مخزونٍ غير مسوّى. والأستاذ
                وتفصيل القيود في لوحة الإدارة والمحاسبة.
              </li>
              <li>
                <strong>لا تحرير لأمر تحميل قائم</strong>: المتاح هو الإلغاء (للمسودة أو بانتظار الاستلام) أو رفض
                الاستلام بسبب. تعديل كميةٍ مصروفة يعني كسر المناقلة الرسمية التي سندها.
              </li>
              <li>
                <strong>لا مبيعات ولا تحصيل هنا</strong>: مستندات المبيعات والفواتير والتحصيل وحداتٌ مستقلة في
                القائمة الجانبية («المبيعات والفواتير» و«التحصيل وسداد الآجل»)، وهذه الشاشة مخصّصة لحركات التحميل والخطوط.
              </li>
              <li>
                <strong>تأكيد الاستلام ورفضه حقٌّ حصري للمندوب صاحب العهدة</strong>: لا تُظهر شاشة الإدارة زرّ
                تأكيد أو رفض الاستلام، والخادم يرفض (403) أي محاولة لتأكيد أو رفض استلام عهدة مندوب له حساب دخول من
                غير حسابه الشخصي. وللإدارة إلغاء أمر التحميل قبل الاستلام فقط.
              </li>
            </ul>
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
