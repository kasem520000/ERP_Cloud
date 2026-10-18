'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input } from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { useSubmissionKey } from '@erp/web-core/use-submission-key';
import { buildProductionBatchPayload, estimateComponentCost } from '@erp/web-van/production';

import {
  batchStatusLabel,
  costBasisLabel,
  emptyComponentRows,
  itemLabel,
  mapOfficialStock,
  numberText,
  pickDefaultWarehouse,
  todayIsoDate,
  warehouseLabel,
  type DashboardPayload,
  type ItemOption,
  type ProductionBatchRow,
  type WarehouseOption,
} from '../../lib/production-screen';

/** الصلاحية التي يفرضها الخادم على `POST /van-sales/production-batches`. */
const PRODUCTION_PERMISSION = 'van_sales.production.manage';
/** وقراءة اللوحة (الدفعات والأرصدة الرسمية) تحتاج هذه. */
const VIEW_PERMISSION = 'van_sales.view';

const selectClass =
  'w-full rounded-[8px] border border-line bg-surface px-3 py-2 text-[13px] text-ink';

/**
 * شاشة الإنتاج — أول شاشة أعمال في واجهة المخابز (المرحلة 3).
 *
 * ثلاث قواعد أمانة تحكمها:
 *   1. **العقد من الحزمة المشتركة**: `buildProductionBatchPayload` و`estimateComponentCost`
 * من `@erp/web-van` — لا نسخة ثانية هنا، فالخادم واحد (ومفتاح المكوّن `qty` لا
 *      `quantity`، ودفعةٌ بلا مكوّنات تُرفض قبل الإرسال كما يرفضها الخادم).
 *   2. **لا أرقام مختلَعة**: الجدول صفوف `productionBatches` من `GET /van-sales/dashboard`
 * كما هي، والحقل الغائب `—` لا صفر، والتقدير موسومٌ بأنه إرشادي والفعلي من أمر
 * الإنتاج الرسمي، وقيمةُ تعدادٍ غير معروفة تُعرض خاماً.
 *   3. **الضابط في الخادم**: الصلاحية تُفحص هنا كي لا تُعرض شاشةٌ سيُرفض طلبها، لكن
 * الرفض الحقيقي 401/403/422 من `apps/api` ونصّه يُعرض كما جاء (`apiErrorText`).
 *
 * والاستجابة من `POST /van-sales/production-batches` هي **اللوحة كاملة** (`return
 * this.dashboard(tenantId)` في `van-sales.service.ts`)، فأحدث دفعة هي `productionBatches[0]`
 * منها — ولا يُخترع رقمُ دفعةٍ في المتصفح أبداً.
 */
export default function ProductionPage() {
  const { can } = useSession();
  const canManage = can(PRODUCTION_PERMISSION);
  const canView = can(VIEW_PERMISSION);

  const [dashboard, setDashboard] = useState<DashboardPayload | undefined>();
  const [items, setItems] = useState<ItemOption[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [lookupWarning, setLookupWarning] = useState<string | undefined>();
  const [loadError, setLoadError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  const [itemId, setItemId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [productionDate, setProductionDate] = useState(todayIsoDate());
  const [producedQty, setProducedQty] = useState('');
  const [scrapQty, setScrapQty] = useState('');
  const [scrapReason, setScrapReason] = useState('');
  const [batchNo, setBatchNo] = useState('');
  const [supervisorName, setSupervisorName] = useState('');
  const [notes, setNotes] = useState('');
  const [components, setComponents] = useState(() => emptyComponentRows(2));

  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | undefined>();
  const [created, setCreated] = useState<ProductionBatchRow | undefined>();

  const load = useCallback(async (): Promise<DashboardPayload | undefined> => {
    setLoading(true);
    setLoadError(undefined);
    try {
      const dash = await apiData<DashboardPayload>('/van-sales/dashboard');
      setDashboard(dash);

      // ‏القائمتان auxiliary: فشلهما لا يُسقط الشاشة، بل يُقال صراحةً ماذا ينقص.
      const [itemsResult, warehousesResult] = await Promise.allSettled([
        apiList<ItemOption>('/organization/catalog/items'),
        apiList<WarehouseOption>('/warehouses'),
      ]);
      const missing: string[] = [];
      if (itemsResult.status === 'fulfilled') setItems(itemsResult.value);
      else missing.push('الأصناف');
      if (warehousesResult.status === 'fulfilled') setWarehouses(warehousesResult.value);
      else missing.push('المستودعات');
      setLookupWarning(
        missing.length > 0
          ? `تعذّر جلب ${missing.join(' و')} — تحتاج صلاحية القراءة أو أنّ الخادم رفض. الشاشة تعرض ما وصلها فقط.`
          : undefined,
      );

      setItemId((current) => current || (itemsResult.status === 'fulfilled' ? itemsResult.value[0]?.id ?? '' : ''));
      setWarehouseId((current) => {
        if (current) return current;
        const list = warehousesResult.status === 'fulfilled' ? warehousesResult.value : [];
        return pickDefaultWarehouse(list, dash.mainWarehouseId)?.id ?? '';
      });

      return dash;
    } catch (caught) {
      setLoadError(apiErrorText(caught, 'تعذّر تحميل بيانات الإنتاج'));
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

  const pickedItem = items.find((row) => row.id === itemId);
  const draft = useMemo(
    () => ({
      itemId,
      warehouseId,
      productionDate,
      producedQty,
      scrapQty,
      scrapReason,
      batchNo,
      supervisorName,
      notes,
      itemName: pickedItem?.nameAr ?? pickedItem?.name_ar ?? pickedItem?.name ?? undefined,
      components,
    }),
    [
      itemId,
      warehouseId,
      productionDate,
      producedQty,
      scrapQty,
      scrapReason,
      batchNo,
      supervisorName,
      notes,
      pickedItem,
      components,
    ],
  );

  const verdict = useMemo(() => buildProductionBatchPayload(draft), [draft]);
  // الدفعة حركاتٌ مخزنية وقيود تكلفة، فإعادة الإرسال يجب ألا تُنشئ ثانيةً: المفتاح يثبت
  // ما دامت المسودة كما هي (فردُه `factory_production_batches.idempotency_key` في الخادم).
  const batchKey = useSubmissionKey('van-production-batch', draft);
  const stockRows = useMemo(() => mapOfficialStock(dashboard?.officialStock), [dashboard]);
  const estimate = useMemo(
    () =>
      verdict.ok
        ? estimateComponentCost({
            lines: verdict.lines,
            producedQty: verdict.payload.producedQty,
            stockRows,
            warehouseId,
          })
        : null,
    [verdict, stockRows, warehouseId],
  );

  const batches = dashboard?.productionBatches ?? [];
  const warehouseName = (id?: string | null) => {
    if (!id) return '—';
    const row = warehouses.find((candidate) => candidate.id === id);
    return row ? warehouseLabel(row) : id;
  };

  function setComponentRow(index: number, patch: Partial<{ itemId: string; qty: string }>) {
    setComponents((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  async function submit() {
    if (busy) return;
    setSubmitError(undefined);
    if (!verdict.ok) {
      setSubmitError(verdict.message);
      return;
    }
    setBusy(true);
    try {
      const fresh = await apiPost<DashboardPayload>('/van-sales/production-batches', {
        ...verdict.payload,
        idempotencyKey: batchKey.key(),
      });
      setDashboard(fresh);
      // ‏الاستجابة هي اللوحة كاملة، فأحدث دفعة أولُ صفوفها — لا رقمَ مُختلَع من المتصفح.
      setCreated(fresh.productionBatches?.[0]);
      setComponents(emptyComponentRows(2));
      setBatchNo('');
      setScrapQty('');
      setScrapReason('');
      setProducedQty('');
      setNotes('');
      // نجاحٌ رُصد: الدفعة التالية الجديدة بمحتوىً مطابق دفعةٌ مقصودة لا صدىً للأولى.
      batchKey.reset();
    } catch (caught) {
      setSubmitError(apiErrorText(caught, 'تعذّر تسجيل دفعة الإنتاج'));
    } finally {
      setBusy(false);
    }
  }

  return (
 <section className="grid gap-4">
 <header className="flex flex-wrap items-end justify-between gap-3">
 <div className="min-w-0">
 <h1 className="m-0 text-[22px] font-extrabold leading-tight tracking-tight text-ink">الإنتاج</h1>
 <p className="m-0 mt-1 text-[13px] text-muted">
 دفعة إنتاج بمكوّناتها: تُصرف المواد رسمياً من المستودع ويدخل الناتج الرصيد الرسمي.
 والتكلفة الفعلية من أمر الإنتاج الرسمي لا من رقمٍ يُكتب هنا.
 </p>
 </div>
 <div className="flex items-center gap-2">
 <span className="bak-badge">POST /van-sales/production-batches</span>
 <Button disabled={loading || !canView} onClick={() => void load()} size="sm">
 تحديث
 </Button>
 </div>
 </header>

      {!canView ? (
 <Card>
 <CardBody>
 <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
 لا تملك `{VIEW_PERMISSION}` — والخادم يرفض قراءة لوحة الخطّ (الدفعات والأرصدة
 الرسمية). ولم يُرسل هذا التطبيق طلباً سيُرفض حتماً، ولا عرض أرقاماً من المتصفح
 بدلها.
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
 تعذّر تحميل بيانات الإنتاج: {loadError}
 </p>
 <p className="m-0 mt-2 text-[12.5px] text-muted">
 السبب المعتاد: لا تملك `{VIEW_PERMISSION}` (قراءة اللوحة) أو أنّ الـAPI غير متاح من
 هذه الواجهة. ولا تُعرض أرقامٌ بديلة من المتصفح.
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

      {canManage ? (
 <Card>
 <CardHeader
            subtitle="الحقول كما يقرأها الخادم — والرفض يُقال قبل الإرسال بالنصّ نفسه الذي سيقوله الخادم."
            title="دفعة إنتاج جديدة"
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
 الصنف المنتج
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
 المستودع المُنتَج إليه
 <select
                    className={selectClass}
                    onChange={(event) => setWarehouseId(event.target.value)}
                    value={warehouseId}
                  >
 <option value="">— يحدده الخادم (المستودع الرئيسي) —</option>
                    {warehouses.map((row) => (
 <option key={row.id} value={row.id}>
                        {warehouseLabel(row)}
 </option>
                    ))}
 </select>
 </label>

 <Input
                  dir="ltr"
                  hint="تُترك فارغةً ليُخصَّص رقمٌ تسلسلي رسمي؛ وإن كُتبت صارت رقم دفعة الناتج (اللوت)."
                  label="رقم الدفعة (اختياري)"
                  onChange={(event) => setBatchNo(event.target.value)}
                  value={batchNo}
                />
 <Input
                  dir="ltr"
                  label="تاريخ الإنتاج"
                  onChange={(event) => setProductionDate(event.target.value)}
                  type="date"
                  value={productionDate}
                />
 <Input
                  dir="ltr"
                  hint="الكمية الصالحة للبيع التي تدخل الرصيد الرسمي — لا تشمل الفاقد."
                  inputMode="decimal"
                  label="الكمية المنتجة"
                  onChange={(event) => setProducedQty(event.target.value)}
                  required
                  value={producedQty}
                />
 <Input
                  dir="ltr"
                  inputMode="decimal"
                  label="الفاقد (اختياري)"
                  onChange={(event) => setScrapQty(event.target.value)}
                  value={scrapQty}
                />
 </div>

              {Number(scrapQty || 0) > 0 ? (
 <Input
                  hint="لا يُرحَّل فاقد بلا سبب — الخادم يرفض بـ VAN_PRODUCTION_SCRAP_REASON_REQUIRED."
                  label="سبب الفاقد (إلزامي مع أي كمية فاقد)"
                  onChange={(event) => setScrapReason(event.target.value)}
                  required
                  value={scrapReason}
                />
              ) : null}

 <div className="grid gap-2">
 <div className="flex items-center justify-between gap-2">
 <h2 className="m-0 text-[14px] font-extrabold text-ink">المكوّنات المصروفة</h2>
 <Button
                    onClick={() => setComponents((rows) => [...rows, { itemId: '', qty: '' }])}
                    size="sm"
                    type="button"
                  >
                    + أضف مكوّناً
 </Button>
 </div>
                {components.map((row, index) => (
 <div className="grid gap-2 md:grid-cols-[1fr_160px_auto]" key={index}>
 <select
                      aria-label={`صنف المكوّن ${index + 1}`}
                      className={selectClass}
                      onChange={(event) => setComponentRow(index, { itemId: event.target.value })}
                      value={row.itemId}
                    >
 <option value="">— اختر صنف المكوّن —</option>
                      {items.map((option) => (
 <option key={option.id} value={option.id}>
                          {itemLabel(option)}
 </option>
                      ))}
 </select>
 <input
                      aria-label={`كمية المكوّن ${index + 1}`}
                      className={selectClass}
                      dir="ltr"
                      inputMode="decimal"
                      onChange={(event) => setComponentRow(index, { qty: event.target.value })}
                      placeholder="الكمية"
                      value={row.qty}
                    />
 <Button
                      disabled={components.length <= 1}
                      onClick={() => setComponents((rows) => rows.filter((_, i) => i !== index))}
                      size="sm"
                      type="button"
                      variant="ghost"
                    >
 حذف
 </Button>
 </div>
                ))}
 <p className="m-0 text-[12px] text-muted">
 بلا مكوّنات (أو قائمة مواد مرتبطة بالصنف) يرفض الخادم 422
                  {' VAN_PRODUCTION_INPUT_REQUIRED'} — لأنّ الدفعة تُدخل مخزوناً بلا مصدر ولا
 تكلفة. والوارد من خارج المنشأة موضعه إذن إدخال مخزني رسمي أو تسوية جرد معتمدة.
 </p>
 </div>

 <div className="grid gap-3 md:grid-cols-2">
 <Input
                  label="اسم المشرف (اختياري)"
                  onChange={(event) => setSupervisorName(event.target.value)}
                  value={supervisorName}
                />
 <Input label="ملاحظات (اختياري)" onChange={(event) => setNotes(event.target.value)} value={notes} />
 </div>

              {estimate ? (
 <div className="grid gap-2 rounded-[10px] border border-line bg-surface-2 p-3 text-[13px]">
 <div className="flex flex-wrap items-center gap-3">
 <span className="text-muted">تقدير قيمة المكوّنات (متوسط رسمي):</span>
 <strong className="text-ink">{estimate.totalValue}</strong>
 <span className="text-muted">· تكلفة الكيلو المتوقعة:</span>
 <strong className="text-ink">{estimate.perKg}</strong>
 </div>
 <p className="m-0 text-[12px] text-muted">
 رقمٌ إرشادي قبل الاعتماد — والفعلي هو قيمة ما يُصرف من الرفّ في أمر الإنتاج
 الرسمي، ويظهر في عمود «أساس التكلفة» بعد التسجيل.
 </p>
                  {estimate.unvalued > 0 ? (
 <p className="m-0 rounded-[8px] border border-warn-line bg-warn-soft px-3 py-2 text-[12.5px] font-bold text-warn-ink">
 {estimate.unvalued} من المكوّنات بلا قيمة أو بلا رصيد في المستودع المختار —
 الخادم يرفض الدفعة بـ VAN_PRODUCTION_COST_REQUIRED قبل أن تُصرف أي مادة.
 </p>
                  ) : null}
 </div>
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
                  {submitError}
 </p>
              ) : null}

              {created ? (
 <p className="m-0 rounded-[10px] border border-success-line bg-success-soft px-4 py-2.5 text-[13px] font-semibold text-success-ink">
 سُجّلت الدفعة {created.batchNo ?? ''} — المنتج {numberText(created.producedQty)}،
 وتكلفة الوحدة {numberText(created.unitCost)} ({costBasisLabel(created.costBasis).text})،
 وإجمالي التكلفة {numberText(created.totalCost)}. وهي أول صفٍّ في الجدول أدناه.
 </p>
              ) : null}

 <div>
 <Button disabled={busy} loading={busy} type="submit" variant="primary">
 تسجيل دفعة الإنتاج
 </Button>
 </div>
 </form>
 </CardBody>
 </Card>
      ) : (
 <Card>
 <CardBody>
 <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
 لا تملك `{PRODUCTION_PERMISSION}` — والخادم يرفض التسجيل (403) حتى لو أُرسل
 الطلب. القائمة الجانبية لا تعرض هذه الشاشة لمن لا يملك الصلاحية، وأنت وصلت إليها
 بالعنوان مباشرة، فالتسجيل معطّل هنا صراحةً بدل أن يُرفض بعد الضغط.
 </p>
 </CardBody>
 </Card>
      )}

 <Card>
 <CardHeader
          action={<span className="bak-badge">{batches.length} صف</span>}
          subtitle="آخر 50 دفعة كما يعيدها الخادم من `factory_production_batches` — بلا تلخيصٍ محلي."
          title="الدفعات المسجّلة"
        />
 <CardBody>
          {loading ? (
 <p aria-busy="true" className="m-0 text-[13px] text-muted">
 جارٍ تحميل الدفعات…
 </p>
          ) : batches.length === 0 ? (
 <p className="m-0 text-[13px] text-muted">
 لا دفعة إنتاج بعد{canManage ? ' — سجّل الأولى أعلاه' : ''}. ولا يُعرض هنا رقمٌ
 تجريبيّ.
 </p>
          ) : (
 <div className="bak-table-wrap">
 <table className="bak-table">
 <thead>
 <tr className="text-muted">
 <th className="border-b border-line p-2 text-start font-bold">رقم الدفعة</th>
 <th className="border-b border-line p-2 text-start font-bold">التاريخ</th>
 <th className="border-b border-line p-2 text-start font-bold">الصنف</th>
 <th className="border-b border-line p-2 text-start font-bold">المستودع</th>
 <th className="border-b border-line p-2 text-start font-bold">المنتج</th>
 <th className="border-b border-line p-2 text-start font-bold">الفاقد</th>
 <th className="border-b border-line p-2 text-start font-bold">تكلفة الوحدة</th>
 <th className="border-b border-line p-2 text-start font-bold">أساس التكلفة</th>
 <th className="border-b border-line p-2 text-start font-bold">الحالة</th>
 </tr>
 </thead>
 <tbody>
                  {batches.map((row, index) => {
                    const basis = costBasisLabel(row.costBasis);
                    return (
 <tr key={row.id ?? `${row.batchNo ?? 'batch'}-${index}`}>
 <td className="border-b border-line p-2" dir="ltr">
                          {row.batchNo ?? '—'}
 </td>
 <td className="border-b border-line p-2" dir="ltr">
                          {row.productionDate ?? '—'}
 </td>
 <td className="border-b border-line p-2">{row.itemName ?? '—'}</td>
 <td className="border-b border-line p-2">{warehouseName(row.warehouseId)}</td>
 <td className="border-b border-line p-2 num" dir="ltr">
                          {numberText(row.producedQty)}
 </td>
 <td className="border-b border-line p-2 num" dir="ltr">
                          {numberText(row.scrapQty)}
 </td>
 <td className="border-b border-line p-2 num" dir="ltr">
                          {numberText(row.unitCost)}
 </td>
 <td className="border-b border-line p-2">
 <span className={`bak-badge ${basis.tone === 'ok' ? 'ok' : 'warn'}`}>{basis.text}</span>
 </td>
 <td className="border-b border-line p-2">{batchStatusLabel(row.status)}</td>
 </tr>
                    );
                  })}
 </tbody>
 </table>
 </div>
          )}
 </CardBody>
 </Card>

 <Card>
 <CardHeader subtitle="ما الذي يفعله الخادم بهذه الدفعة — بلا وعودٍ زائدة." title="ماذا يحدث بعد التسجيل" />
 <CardBody>
 <ul className="m-0 grid gap-2 text-[13px] leading-relaxed text-ink">
 <li>
 تُصرف المكوّنات من المستودع المختار ويدخل الناتج الرصيد الرسمي، ويُسجَّل
              `van_stock_movements` بحركة `production_in` — ورقم دفعة الناتج (اللوت) يطابق رقم
 الدفعة حين يُكتب.
 </li>
 <li>
 الفاقد يُسجَّل حركةً مستقلة (`van_damage`) بسببه، <strong>ولا يُحمَّل على تكلفة المنتج
 الجيد</strong>: أمر الإنتاج يُنتج الكمية الصالحة وحدها. وتحميل فاقد المخبز على التكلفة
 قرارُ سياسةٍ لم يُتّخذ بعد — والشاشة لا تدّعيه.
 </li>
 <li>
 التكلفة: الأولوية لأمر التصنيع/الإنتاج الرسمي (`manufacturing_order`) ثم بطاقة
 الصنف أو الإدخال — والعمود يقول أيّها استُعمل.
 </li>
 <li>
 القيد المحاسبي: يُرحَّل <strong>فقط</strong> إن كانت حسابات الإنتاج (مواد خام/منتج تام) مربوطة
 في ملف الترحيل؛ وإلّا فالدفعة محايدة محاسبياً (`ledger_neutral`) بلا قيد — وهذا
 سلوكٌ مقصود ومُوثَّق في `production-orders.service.ts`، لا خلل.
 </li>
 <li>
 ولا يُرسل هذا التطبيق `unitCost` إطلاقاً: التكلفة تُحسب في الخادم، وإرسال رقمٍ
 يدوي يعني إرسال رقمٍ يُتجاهل أو يُلبس تكلفةً ليست فعلية.
 </li>
 </ul>
 </CardBody>
 </Card>
 </section>
  );
}
