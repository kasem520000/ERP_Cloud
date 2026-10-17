'use client';

import { useEffect, useMemo, useState } from 'react';
import { Button, Card, CardBody, CardHeader, Input, Select, type SortState } from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';
import { useSubmissionKey } from '@erp/web-core/use-submission-key';
import { buildProductionBatchPayload, estimateComponentCost } from '@erp/web-van/production';

import { DataTable, Notice } from '../../components/data-view';
import { Screen } from '../../components/screen';
import {
  BATCH_COLUMNS,
  batchCellText,
  batchViewRows,
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
  type ProductionBatchViewRow,
  type WarehouseOption,
} from '../../lib/production-screen';
import { useQuery } from '../../lib/use-query';
import { listState, rowKeyFrom, tableColumns } from '../../lib/ui-kit';

/** الصلاحية التي يفرضها الخادم على `POST /van-sales/production-batches`. */
const PRODUCTION_PERMISSION = 'van_sales.production.manage';
/** وقراءة اللوحة (الدفعات والأرصدة الرسمية) تحتاج هذه. */
const VIEW_PERMISSION = 'van_sales.view';

/**
 * 🏭 شاشة الإنتاج — أول شاشة أعمال في واجهة المخابز (المرحلة 3).
 *
 * ثلاث قواعد أمانة تحكمها:
 *   1. **العقد من الحزمة المشتركة**: `buildProductionBatchPayload` و`estimateComponentCost`
 *      من `@erp/web-van` — لا نسخة ثانية هنا، فالخادم واحد (ومفتاح المكوّن `qty` لا
 *      `quantity`، ودفعةٌ بلا مكوّنات تُرفض قبل الإرسال كما يرفضها الخادم).
 *   2. **لا أرقام مختلَعة**: الجدول صفوف `productionBatches` من `GET /van-sales/dashboard`
 *      كما هي، والحقل الغائب `—` لا صفر، والتقدير موسومٌ بأنه إرشادي والفعلي من أمر
 *      الإنتاج الرسمي، وقيمةُ تعدادٍ غير معروفة تُعرض خاماً.
 *   3. **الضابط في الخادم**: الصلاحية تُفحص هنا كي لا تُعرض شاشةٌ سيُرفض طلبها، لكن
 *      الرفض الحقيقي 401/403/422 من `apps/api` ونصّه يُعرض كما جاء (`apiErrorText`).
 *
 * والاستجابة من `POST /van-sales/production-batches` هي **اللوحة كاملة** (`return
 * this.dashboard(tenantId)` في `van-sales.service.ts`)، فأحدث دفعة هي `productionBatches[0]`
 * منها — ولا يُخترع رقمُ دفعةٍ في المتصفح أبداً.
 *
 * والتنظيم كما في `apps/staff`: غلافُ الشاشة من `Screen`، والطلب من `useQuery`
 * (لا يُرسل طلبٌ بلا صلاحية — والسبب موثّقٌ أدناه)، والتغذيةُ الراجعة من `Notice`،
 * والجداول من `DataTable` عبر `lib/ui-kit.ts`، والقوائم من `Select` — ولا صنفَ
 * `selectClass` ولا نسخةَ تنبيهٍ تُنسخ في كلّ صفحة.
 */
export default function ProductionPage() {
  const { can } = useSession();
  const canManage = can(PRODUCTION_PERMISSION);
  const canView = can(VIEW_PERMISSION);

  /**
   * اللوحةُ بطلبٍ واحد — ولا يُرسل الطلبُ بلا صلاحيةٍ (٤٠٣ محتوم): فالخادمُ
   * هو الضابط، وهذه الواجهة لا تستطلع رأيه بلا وجه. وحين يُمنح الحسابُ
   * الصلاحيةَ لاحقًا يُعيد `useQuery` الطلبَ بعينه (`canView` في الاعتماديات).
   */
  const dashboard = useQuery<DashboardPayload | undefined>(
    () => (canView ? apiData<DashboardPayload>('/van-sales/dashboard') : Promise.resolve(undefined)),
    [canView],
  );
  /**
   * القائمتان auxiliary: فشلهما لا يُسقط الشاشة، بل يُقال صراحةً ماذا ينقص
   * (`lookupWarning` أدناه) — ولذلك كلٌّ منهما كَيْنَها الخاص بلا مشاركةٍ في
   * حالةٍ واحدة.
   */
  const itemsQuery = useQuery<ItemOption[]>(
    () => (canView ? apiList<ItemOption>('/organization/catalog/items') : Promise.resolve([])),
    [canView],
  );
  const warehousesQuery = useQuery<WarehouseOption[]>(
    () => (canView ? apiList<WarehouseOption>('/warehouses') : Promise.resolve([])),
    [canView],
  );
  const items = useMemo(() => itemsQuery.data ?? [], [itemsQuery.data]);
  const warehouses = useMemo(() => warehousesQuery.data ?? [], [warehousesQuery.data]);

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
  /** فرزُ جدول الدفعات — حالةٌ يملكها العميل لا الخادم (ترتيبُ الخادم هو الافتراضي). */
  const [batchSort, setBatchSort] = useState<SortState>(null);

  // ‏الافتراضاتُ تُملأ من الخادم ولا تُكتَب فوق اختيارٍ سبق للمستخدم — كما كان
  // في `load()` اليدويّة: الأصناف تقترح الأول، والمستودع الافتراضيّ ثمّ الرئيسيّ.
  useEffect(() => {
    setItemId((current) => current || items[0]?.id || '');
  }, [items]);
  useEffect(() => {
    setWarehouseId((current) => {
      if (current) return current;
      return pickDefaultWarehouse(warehouses, dashboard.data?.mainWarehouseId)?.id ?? '';
    });
  }, [warehouses, dashboard.data]);

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
  // 🔁 الدفعة حركاتٌ مخزنية وقيود تكلفة، فإعادة الإرسال يجب ألا تُنشئ ثانيةً: المفتاح يثبت
  // ما دامت المسودة كما هي (فردُه `factory_production_batches.idempotency_key` في الخادم).
  const batchKey = useSubmissionKey('van-production-batch', draft);
  const stockRows = useMemo(
    () => mapOfficialStock(dashboard.data?.officialStock),
    [dashboard.data],
  );
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

  const batches = batchViewRows(dashboard.data?.productionBatches, warehouses);

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
      // ‏الاستجابة هي اللوحة كاملة، فأحدث دفعة أولُ صفوفها — لا رقمَ مُختلَع من المتصفح.
      setCreated(fresh.productionBatches?.[0]);
      setComponents(emptyComponentRows(2));
      setBatchNo('');
      setScrapQty('');
      setScrapReason('');
      setProducedQty('');
      setNotes('');
      // ‏والجدولُ يُعاد قراءتُه من الخادم (كما يفعل staff بعد كلّ كتابة): فالبطاقةُ
      // أعلاه من الاستجابة، والجدولُ من طلبٍ مستقلّ — فلا ذاكرةَ متصفحيةً تُقدَّم
      // كحقيقةِ خادم.
      void dashboard.reload();
      // نجاحٌ رُصد: الدفعة التالية الجديدة بمحتوىً مطابق دفعةٌ مقصودة لا صدىً للأولى.
      batchKey.reset();
    } catch (caught) {
      setSubmitError(apiErrorText(caught, 'تعذّر تسجيل دفعة الإنتاج'));
    } finally {
      setBusy(false);
    }
  }

  const lookupWarning = useMemo(() => {
    const missing: string[] = [];
    if (itemsQuery.status === 'error') missing.push('الأصناف');
    if (warehousesQuery.status === 'error') missing.push('المستودعات');
    return missing.length > 0
      ? `تعذّر جلب ${missing.join(' و')} — تحتاج صلاحية القراءة أو أنّ الخادم رفض. الشاشة تعرض ما وصلها فقط.`
      : undefined;
  }, [itemsQuery.status, warehousesQuery.status]);

  return (
    <Screen
      actions={
        <>
          <span className="bak-badge">POST /van-sales/production-batches</span>
          <Button
            disabled={dashboard.status === 'loading' || !canView}
            onClick={() => void dashboard.reload()}
            size="sm"
          >
            تحديث
          </Button>
        </>
      }
      subtitle="دفعة إنتاج بمكوّناتها: تُصرف المواد رسمياً من المستودع ويدخل الناتج الرصيد الرسمي. والتكلفة الفعلية من أمر الإنتاج الرسمي لا من رقمٍ يُكتب هنا."
      title="الإنتاج"
    >
      {!canView ? (
        <Card>
          <CardBody>
            <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
              🔒 لا تملك `{VIEW_PERMISSION}` — والخادم يرفض قراءة لوحة الخطّ (الدفعات والأرصدة
              الرسمية). ولم يُرسل هذا التطبيق طلباً سيُرفض حتماً، ولا عرض أرقاماً من المتصفح
              بدلها.
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
              تعذّر تحميل بيانات الإنتاج: {dashboard.error}
            </p>
            <p className="m-0 mt-2 text-[12.5px] text-muted">
              السبب المعتاد: لا تملك `{VIEW_PERMISSION}` (قراءة اللوحة) أو أنّ الـAPI غير متاح من
              هذه الواجهة. ولا تُعرض أرقامٌ بديلة من المتصفح.
            </p>
            <Button className="mt-3" onClick={() => void dashboard.reload()} size="sm">
              إعادة المحاولة
            </Button>
          </CardBody>
        </Card>
      ) : null}

      <Notice
        notice={
          lookupWarning
            ? { kind: 'warn', text: lookupWarning }
            : undefined
        }
      />

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
                <Select
                  label="الصنف المنتج"
                  onChange={(event) => setItemId(event.target.value)}
                  options={items.map((row) => ({ label: itemLabel(row), value: row.id }))}
                  placeholder="— اختر الصنف —"
                  value={itemId}
                />

                <Select
                  hint="يحدده الخادم (المستودع الرئيسي) حين تُترك فارغة"
                  label="المستودع المُنتَج إليه"
                  onChange={(event) => setWarehouseId(event.target.value)}
                  options={warehouses.map((row) => ({
                    label: warehouseLabel(row),
                    value: row.id,
                  }))}
                  placeholder="— يحدده الخادم (المستودع الرئيسي) —"
                  value={warehouseId}
                />

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
                    <Select
                      aria-label={`صنف المكوّن ${index + 1}`}
                      onChange={(event) => setComponentRow(index, { itemId: event.target.value })}
                      options={items.map((option) => ({
                        label: itemLabel(option),
                        value: option.id,
                      }))}
                      placeholder="— اختر صنف المكوّن —"
                      value={row.itemId}
                    />
                    <Input
                      aria-label={`كمية المكوّن ${index + 1}`}
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
                      ⚠️ {estimate.unvalued} من المكوّنات بلا قيمة أو بلا رصيد في المستودع المختار —
                      الخادم يرفض الدفعة بـ VAN_PRODUCTION_COST_REQUIRED قبل أن تُصرف أي مادة.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {!verdict.ok ? (
                <Notice notice={{ kind: 'warn', text: verdict.message }} />
              ) : null}

              {submitError ? <Notice notice={{ kind: 'danger', text: submitError }} /> : null}

              {created ? (
                <Notice
                  notice={{
                    kind: 'ok',
                    text: `✅ سُجّلت الدفعة ${created.batchNo ?? ''} — المنتج ${numberText(
                      created.producedQty,
                    )}، وتكلفة الوحدة ${numberText(created.unitCost)} (${costBasisLabel(
                      created.costBasis,
                    ).text})، وإجمالي التكلفة ${numberText(created.totalCost)}. وهي أول صفٍّ في الجدول أدناه.`,
                  }}
                />
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
              🔒 لا تملك `{PRODUCTION_PERMISSION}` — والخادم يرفض التسجيل (403) حتى لو أُرسل
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
          <DataTable<ProductionBatchViewRow>
            columns={tableColumns<ProductionBatchViewRow>(BATCH_COLUMNS, batchCellText)}
            dense
            empty={
              <span className="m-0 text-[13px] text-muted">
                لا دفعة إنتاج بعد{canManage ? ' — سجّل الأولى أعلاه' : ''}. ولا يُعرض هنا رقمٌ
                تجريبيّ.
              </span>
            }
            onSortChange={setBatchSort}
            pageSize={25}
            rowKey={rowKeyFrom(['id', 'batchNo'])}
            rows={batches}
            sort={batchSort}
            sortable
            state={listState({
              loading: dashboard.status === 'loading',
              error: dashboard.status === 'error' ? dashboard.error : undefined,
            })}
            storageKey="bakery-production-batches"
          />
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
    </Screen>
  );
}
