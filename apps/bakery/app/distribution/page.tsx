'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input } from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
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
  batchItemOption,
  batchOptionLabel,
  mapLoadOrders,
  mapSalesmen,
  salesmanAdvisories,
  salesmanBlockingWarning,
  salesmanLabel,
  type DistributionDashboard,
  type LoadOrderRow,
  type SalesmanRow,
} from '../../lib/distribution-screen';
import { itemLabel, numberText, warehouseLabel, type ItemOption, type WarehouseOption } from '../../lib/lookups';

/** الصلاحية التي يفرضها الخادم على `POST /van-sales/load-orders` وعلى `…/cancel`. */
const LOAD_PERMISSION = 'van_sales.load.manage';
/** وقراءة اللوحة والمندوبين، ومسار تأكيد الاستلام/رفضه. */
const VIEW_PERMISSION = 'van_sales.view';

const selectClass = 'w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink';

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
 *      `apps/api/test/van-sales-stock-acceptance.spec.ts` من طرفه)، ما عدا «بلا صنفٍ وبلا
 *      دفعة» فالشاشة أشدّ من الخادم عمداً: هو يفترض `PROD-<اليوم>-0001` ويشتقّ الصنف منها،
 *      وهي ترفض أن تُنسب حمولةٌ إلى صنفٍ لم يختره المشرف.
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
 * (‏`custody`) وشاشاتها التفصيلية في `apps/staff`، لأنّها تحمل قرارات السياسة المعلّقة
 * (المسؤولية المالية عن العجز وفصله رباعيّ الاتجاه).
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
  const draft = useMemo(
    () => ({
      salesmanId,
      itemId,
      productionBatchNo,
      loadedQty,
      warehouseId,
      vanWarehouseId,
      vehiclePlate,
      notes,
    }),
    [salesmanId, itemId, productionBatchNo, loadedQty, warehouseId, vanWarehouseId, vehiclePlate, notes],
  );
  const verdict = useMemo(() => buildLoadOrderPayload(draft), [draft]);
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
      const fresh = await apiPost<DistributionDashboard>('/van-sales/load-orders', verdict.payload);
      setDashboard(fresh);
      // ‏الاستجابة هي اللوحة كاملة، فأحدث أمرٍ أولُ صفوفها — لا رقمَ مُختلَع من المتصفح.
      setCreated(mapLoadOrders(fresh)[0]);
      setLoadedQty('');
      setNotes('');
      setBatchKey('');
      setProductionBatchNo('');
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
    <section className="grid gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
            التوزيع والأحمال
          </h1>
          <p className="m-0 mt-1 text-[13px] text-muted">
            أمر تحميلٍ لمندوب: يُصرف من المستودع بمناقلة رسمية وتصير البضاعة عهدةً <strong>عند تأكيد
            الاستلام</strong>. والإقفال والاعتماد وتسوية الفرق وحدةٌ أخرى (في `staff`).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="bak-badge">POST /van-sales/load-orders</span>
          <Button disabled={loading || !canView} onClick={() => void load()} size="sm">
            تحديث
          </Button>
        </div>
      </header>

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
              السبب المعتاد: لا تملك `{VIEW_PERMISSION}` أو أنّ الـAPI غير متاح من هذه الواجهة.
              ولا تُعرض أحمالٌ بديلة من المتصفح.
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
          ✅ {actionDone}
        </p>
      ) : null}

      {canManage ? (
        <Card>
          <CardHeader
            subtitle="الحقول كما يقرأها الخادم. ونصوص الرفض نصوصُه حرفاً (مثبّتةٌ في الطرفين) — ما عدا «بلا صنفٍ وبلا دفعة» فهي مرفوضةٌ هنا عمداً قبل الخادم، لأنه يفترض رقم دفعةٍ ويشتقّ الصنف منها."
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
                <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                  المندوب (صاحب العهدة)
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
                      ⚠️ {blocking}
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
                    {numberText(pickedSalesman.custody?.pendingReceipts)} (من `GET /van-sales/salesmen`).
                  </p>
                </div>
              ) : null}

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                  الصنف المحمَّل
                  <select className={selectClass} onChange={(event) => setItemId(event.target.value)} value={itemId}>
                    <option value="">— اختر الصنف —</option>
                    {items.map((row) => (
                      <option key={row.id} value={row.id}>
                        {itemLabel(row)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                  أو اربطه بدفعة إنتاج (يُشتقّ الصنف واللوت منها)
                  <select className={selectClass} onChange={(event) => pickBatch(event.target.value)} value={batchKey}>
                    <option value="">— بلا ربط بدفعة —</option>
                    {batches.map((row) => (
                      <option key={row.id ?? row.batchNo ?? ''} value={row.id ?? ''}>
                        {batchOptionLabel(row)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                  مستودع المصدر (المصروف منه)
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

                <label className="grid gap-1 text-[12.5px] font-bold text-ink">
                  مستودع السيارة (وجهة العهدة)
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
                  رقم الدفعة المُرسلة: <span dir="ltr">{productionBatchNo}</span> — والخادم يتحقّق
                  أنّها دفعةُ هذا المستأجر، ويشتقّ منها الصنف واللوت إن لم يُكتب صنف.
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
                  ✅ أُنشئ أمر التحميل <span dir="ltr">{created.number ?? '—'}</span> — الحالة:{' '}
                  {loadOrderStatusLabel(created.status ?? '')} — المصروف:{' '}
                  <span dir="ltr">{numberText(created.loadedQty)}</span> — بانتظار تأكيد المندوب
                  للاستلام.
                </p>
              ) : null}

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
          {loading ? (
            <p aria-busy="true" className="m-0 text-[13px] text-muted">
              جارٍ تحميل الأحمال…
            </p>
          ) : loadOrders.length === 0 ? (
            <p className="m-0 text-[13px] text-muted">
              لا أمر تحميل بعد{canManage ? ' — أنشئ الأول أعلاه' : ''}. ولا يُعرض هنا رقمٌ
              تجريبيّ.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr className="text-muted">
                    <th className="border-b border-line p-2 text-start font-bold">رقم الأمر</th>
                    <th className="border-b border-line p-2 text-start font-bold">التاريخ</th>
                    <th className="border-b border-line p-2 text-start font-bold">المندوب</th>
                    <th className="border-b border-line p-2 text-start font-bold">الصنف</th>
                    <th className="border-b border-line p-2 text-start font-bold">الدفعة</th>
                    <th className="border-b border-line p-2 text-start font-bold">مصروف</th>
                    <th className="border-b border-line p-2 text-start font-bold">مستلم</th>
                    <th className="border-b border-line p-2 text-start font-bold">الفرق</th>
                    <th className="border-b border-line p-2 text-start font-bold">المتبقي</th>
                    <th className="border-b border-line p-2 text-start font-bold">الحالة</th>
                    <th className="border-b border-line p-2 text-start font-bold">تسوية المخزون</th>
                    <th className="border-b border-line p-2 text-start font-bold">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {loadOrders.map((row) => (
                    <tr key={row.id ?? `${row.number ?? 'load'}-${row.loadDate ?? ''}`}>
                      <td className="border-b border-line p-2" dir="ltr">
                        {row.number ?? '—'}
                      </td>
                      <td className="border-b border-line p-2" dir="ltr">
                        {row.loadDate ?? '—'}
                      </td>
                      <td className="border-b border-line p-2">{row.salesmanName ?? '—'}</td>
                      <td className="border-b border-line p-2">{row.itemName ?? '—'}</td>
                      <td className="border-b border-line p-2" dir="ltr">
                        {row.productionBatchNo ?? '—'}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.loadedQty)}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.receivedQty)}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.discrepancyQty)}
                      </td>
                      <td className="border-b border-line p-2 num" dir="ltr">
                        {numberText(row.remainingQty)}
                      </td>
                      <td className="border-b border-line p-2">
                        <span className="bak-badge">{loadOrderStatusLabel(row.status ?? '')}</span>
                      </td>
                      <td className="border-b border-line p-2">{stockSettlementStatusLabel(row.stockSettlementStatus ?? '')}</td>
                      <td className="border-b border-line p-2">
                        <div className="flex flex-wrap gap-1">
                          {canConfirmReceipt(row) ? (
                            <Button onClick={() => openAction(row, 'confirm')} size="sm" variant="ghost">
                              استلام
                            </Button>
                          ) : null}
                          {canCancelLoadOrder(row) && canManage ? (
                            <Button onClick={() => openAction(row, 'cancel')} size="sm" variant="ghost">
                              إلغاء
                            </Button>
                          ) : null}
                          {canConfirmReceipt(row) ? (
                            <Button onClick={() => openAction(row, 'reject')} size="sm" variant="ghost">
                              رفض
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
          {!loading && pendingReceipt.length > 0 ? (
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
              الاستلام الناقص يسجّل الفرق (`discrepancyQty`) ويُغلق الباقي بمناقلةٍ بنمط
              «عجز» — فلا يبقى شيءٌ معلّقاً في الطريق، والفرق يبقى مفتوحاً حتى تسويته.
            </li>
            <li>
              حدّ البونص (`maxBonusQty`/`maxBonusPct`) يُشتقّ من سياسة المستأجر في الخادم،
              والشاشة لا ترسله ولا تعدّله.
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
              `settle-stock` / `close-transit-difference`): وحدة «إقفال العهدة» في التنقل،
              وشاشاتها التفصيلية في `apps/staff`. والسبب أنّها تحمل قرارات سياسةٍ لم تُتّخذ بعد
              (المسؤولية المالية عن العجز، فصل العجز رباعيّ الاتجاه: مبيع/بونص/مرتجع/تالف)، ولا
              تُقفل عهدةٌ بفرق مخزونٍ غير مسوّى.
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
    </section>
  );
}
