'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSubmissionKey } from '@erp/web-core/use-submission-key';
import { REP_TOTALS_CLAUSE, windowNote, type DashboardWindows } from '@erp/web-van/windows';
import { Panel } from '@erp/ui';

import { Notice } from '../../../components/data-view';
import { Empty, Screen } from '../../../components/screen';
import { ApiError, apiData, apiPost } from '../../../lib/api';
import { listParties, type Party } from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { Table } from '../../../components/ui/table';

/**
 * تطبيق المندوب — the rep's own workspace.
 *
 * Everything on this page comes from `GET /van-sales/me`, which derives the rep from the
 * caller's own membership (`memberships → employees → salesmen`) and reads the **official**
 * `stock_balances` of his van warehouse. No id is taken from the URL or the body, so one rep
 * cannot open another's custody — and the server enforces the same thing, not just the UI.
 */
// ‏ذيلُ جملة النافذة (`REP_TOTALS_CLAUSE`) من `@erp/web-van/windows`: فالمجاميعُ في هذا
// ‏الوجه `totals` و`custody` لا `summary`، والمفردةُ نصٌّ واحدٌ في الحزمة المشتركة.
const DOCUMENTS_WINDOW_FALLBACK = 'أحدث ١٠٠ مستند (حدُّ نافذة الخادم) — والأرقامُ أعلاه من جدولك كلّه';
const LOAD_ORDERS_WINDOW_FALLBACK = 'أحدث ٥٠ أمر تحميل (حدُّ نافذة الخادم) — والعهدةُ من أوامرك كلّها';
const COLLECTIONS_WINDOW_FALLBACK = 'أحدث ٥٠ حركة تحصيل (حدُّ نافذة الخادم)';
const NOTIFICATIONS_WINDOW_FALLBACK = 'أحدث ٢٠ إشعارًا (حدُّ نافذة الخادم)';

type StockRow = {
  itemId: string;
  itemName: string;
  sku: string;
  warehouseId: string;
  warehouseName: string;
  quantity: string;
  value: string;
  averageCost: string;
};

type PendingReceipt = {
  id: string;
  number: string;
  loadDate: string;
  status: string;
  loadedQty: string;
  receivedQty: string;
  productionBatchNo: string;
  stockTransferId: string | null;
  itemName: string;
  fromWarehouseName: string;
};

type LoadOrder = {
  id: string;
  number: string;
  loadDate: string;
  status: string;
  itemId?: string | null;
  itemName: string;
  productionBatchNo: string;
  loadedQty: string;
  receivedQty: string;
  soldQty: string;
  bonusQty: string;
  returnedQty: string;
  damagedQty: string;
  shortageQty: string;
  shortageValue: string;
  expectedCash: string;
  collectedCash: string;
  outstandingCash: string;
  /** ما يجب أن يبقى في السيارة حسب المستندات قبل الجرد. */
  expectedRemainingQty: string;
  /** ما أعلنه المندوب فعلياً عند تقديم الإغلاق. */
  actualRemainingQty: string;
  discrepancyQty: string;
  discrepancyNotes: string | null;
  closingSubmittedAt: string | null;
  approvedAt: string | null;
  /** تسوية المخزون الرسمية بعد اعتماد المحاسب. */
  stockSettlementStatus?: string;
  stockSettlementNote?: string;
  remainingAction?: 'return_to_main' | 'carry_over' | null;
};

type RepDocument = {
  id: string;
  number: string;
  docDate: string;
  documentKind: string;
  invoiceMode: string;
  paymentMethod: string;
  customerName: string;
  itemName: string;
  soldQty: string;
  bonusQty: string;
  unitPrice: string;
  subtotal: string;
  taxTotal: string;
  total: string;
  paidAmount: string;
  outstanding: string;
  invoiceNumber: string | null;
  invoiceStatus: string | null;
};

type CollectionRow = {
  id: string;
  collectedAt: string;
  amount: string;
  reason: string;
  voucherNumber: string | null;
  voucherStatus: string | null;
};

type RepWorkspace = {
  isRep: boolean;
  salesmanId: string | null;
  salesmanName: string | null;
  warehouseId: string | null;
  vehiclePlate: string | null;
  active: boolean;
  message?: string;
  balances: StockRow[];
  custodyKg: string;
  custodyValue: string;
  pendingReceipts: PendingReceipt[];
  loadOrders: LoadOrder[];
  documents: RepDocument[];
  collections: CollectionRow[];
  /**
   * ‏**وكلُّ أرقام المال هنا صافيةٌ من المرتجعات** (‏`revenue = salesGross − returns −
   * returnsVat`، والذممُ بعد الإشعارات الدائنة)، وأطرافُ المعادلة معروضةٌ معها كي لا يُقرأ
   * رقمٌ صافٍ كأنّ المرتجع لم يحدث. والمعالجةُ في الخادم (`VAN_MONEY_SQL`) ومرجعُها قيودُ
   * المرتجع الرسمية.
   */
  totals: {
    revenue: string;
    salesGross: string;
    cashSales: string;
    creditSales: string;
    collected: string;
    outstanding: string;
    returns: string;
    returnsVat: string;
    returnCount: number;
    returnsWithoutCostCount: number;
  };
  custody: { expectedKg: string; officialKg: string; pendingClosings: number } | null;
  /**
   * نوافذُ القراءة كما يعلنها الخادم: القوائمُ الأربع محدودةٌ بـ`LIMIT` (‏٥٠ أمرًا، ١٠٠
   * مستند، ٥٠ تحصيلًا، ٢٠ إشعارًا) وأمّا الأرقامُ فجمعُ جدول المندوب كلّه. وغيابُ المفتاح
   * يعني «لا أعرف» فتُعرض الجملةُ الاحتياطية — ولا رقمَ مخمَّن. (`balances` و
   * `pendingReceipts` كاملتان في استعلاميهما فلا نافذةَ لهما.)
   */
  windows?: DashboardWindows | null;
  notifications: Array<{
    id: string;
    type: string;
    read: boolean;
    createdAt: string;
    payload: Record<string, unknown>;
  }>;
};

const LOAD_STATUS_AR: Record<string, string> = {
  draft: 'مسودة',
  pending_receipt: 'بانتظار تأكيد استلامك',
  loaded: 'في عهدتك',
  in_route: 'قيد التوزيع',
  pending_closing: 'إغلاق مُقدَّم بانتظار المحاسب',
  /** اعتُمدت الكميات، لكن رصيد سيارتك الرسمي ما زال يختلف عن جردك — العهدة لم تُغلق بعد. */
  pending_stock_settlement: 'معتَمَد الكميات وبانتظار تسوية المخزون',
  settled: 'مُعتمد ومُصفّى ومُسوّى مخزنياً',
  reconciled: 'مُطابَق',
  rejected: 'مرفوض من قبلك (أُعيدت الكمية رسمياً)',
  canceled: 'ملغى من المحاسب',
};

/** حالة تسوية المخزون كما تُعرض للمندوب. */
const SETTLEMENT_STATUS_AR: Record<string, string> = {
  pending_transit_decision: 'فرق استلامك بانتظار قرار المحاسب',
  pending_count_decision: 'فرق جردك بانتظار تسوية المحاسب',
  settled_officially: 'سُوّي رصيد سيارتك رسمياً',
  blocked_missing_accounts: 'تسويتك متوقفة على إعداد حسابات المحاسبة',
};

export default function VanSalesRepPage() {
  const { can } = useSession();
  const [data, setData] = useState<RepWorkspace | null>(null);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'warn'; text: string }>();
  const [busy, setBusy] = useState(false);

  // تأكيد الاستلام
  const [receiptTarget, setReceiptTarget] = useState<PendingReceipt | null>(null);
  const [receiptQty, setReceiptQty] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');

  // إصدار فاتورة بيع
  const [saleLoadOrderId, setSaleLoadOrderId] = useState('');
  const [salePartyId, setSalePartyId] = useState('');
  const [saleWalkIn, setSaleWalkIn] = useState('');
  const [saleQty, setSaleQty] = useState('');
  const [saleBonusQty, setSaleBonusQty] = useState('0');
  const [saleBonusReason, setSaleBonusReason] = useState('');
  const [saleUnitPrice, setSaleUnitPrice] = useState('');
  const [salePayment, setSalePayment] = useState<'cash' | 'card' | 'credit'>('cash');

  // تحصيل مديونية
  const [collectDocId, setCollectDocId] = useState('');
  const [collectAmount, setCollectAmount] = useState('');

  // إغلاق الوردية
  const [closingTarget, setClosingTarget] = useState<LoadOrder | null>(null);
  const [closingReturned, setClosingReturned] = useState('0');
  const [closingDamaged, setClosingDamaged] = useState('0');
  const [closingDamageReason, setClosingDamageReason] = useState('');
  const [closingCash, setClosingCash] = useState('0');
  const [closingActualRemaining, setClosingActualRemaining] = useState('0');
  const [closingNotes, setClosingNotes] = useState('');

  const load = useCallback(async () => {
    const [meRes, custRes] = await Promise.allSettled([
      apiData<RepWorkspace>('/van-sales/me'),
      listParties('customer'),
    ]);
    if (meRes.status === 'fulfilled') setData(meRes.value);
    if (custRes.status === 'fulfilled') setCustomers(custRes.value);
    if (meRes.status === 'rejected') {
      const error = meRes.reason;
      setNotice({
        kind: 'danger',
        text: error instanceof ApiError ? error.message : 'تعذر تحميل مساحة عمل المندوب',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * مفتاحٌ واحدٌ للنيّة الواحدة لا للنقرة الواحدة.
   *
   * كان هنا مولّدٌ يعطي مفتاحاً جديداً **لكلّ نداء** (`Date.now()` + `Math.random()`) تحت تعليقٍ
   * يعد بأنّ إعادة المحاولة ترجع بالنتيجة نفسها — وعدٌ لا يحققه: المفتاح يختلف بين المحاولتين،
   * فعلى شبكة المندوب المتقطّعة تُنشئ إعادةُ الإرسال فاتورةً ثانية وخصماً ثانياً من رصيد سيارته
   * الرسمي وسند قبضٍ ثانياً، ولا يخبره شيءٌ بأنّ الأولى وصلت. والمفتاح الآن بصمةُ المسودة مع رقم
   * محاولةٍ يتغيّر حين تتغيّر الحقول أو حين يُرصد نجاح — فيرجع الخادم بالمستند الأول (فهرسٌ فريد
   * على `van_sales_documents.idempotency_key`). التفصيل والقياس في `@erp/web-core/idempotency`.
   */
  const saleKey = useSubmissionKey('rep-sale', {
    loadOrderId: saleLoadOrderId,
    partyId: salePartyId,
    walkInName: saleWalkIn,
    soldQty: saleQty,
    bonusQty: saleBonusQty,
    bonusReason: saleBonusReason,
    unitPriceText: saleUnitPrice,
    paymentMethod: salePayment,
  });
  const collectKey = useSubmissionKey('rep-collect', {
    documentId: collectDocId,
    collectedText: collectAmount,
  });

  async function run(
    action: () => Promise<unknown>,
    okText: (result: unknown) => string,
    onDone?: () => void,
  ) {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await action();
      await load();
      setNotice({ kind: 'ok', text: okText(result) });
      // نجاحٌ رُصد: الإرسال التالي نيّةٌ جديدة ولو تطابق محتواها (بيعان متماثلان لعميل واحد).
      onDone?.();
    } catch (error) {
      setNotice({
        kind: 'danger',
        text: error instanceof ApiError ? error.message : 'تعذر تنفيذ العملية',
      });
    } finally {
      setBusy(false);
    }
  }

  const openLoads = (data?.loadOrders ?? []).filter(
    (row) => !['settled', 'canceled', 'rejected'].includes(row.status),
  );
  const saleableLoads = (data?.loadOrders ?? []).filter(
    (row) => ['loaded', 'in_route'].includes(row.status) && Number(row.expectedRemainingQty) > 0,
  );

  return (
    <Screen
      title="تطبيق مندوب التوزيع"
      subtitle="عهدتك وأرصدة سيارتك الرسمية، توريداتك بانتظار التأكيد، فواتيرك وتحصيلاتك، وإغلاق ورديتك — كلها من حسابك أنت."
      crumbs={['توزيع المناديب والمخابز', 'تطبيق المندوب']}
      actions={
        <button type="button" className="btn sm" onClick={() => void load()} disabled={busy}>
          تحديث
        </button>
      }
    >
      {notice ? <Notice notice={notice} /> : null}

      {data && !data.isRep ? (
        <Panel title="بطاقة المندوب">
          <Empty title="حسابك غير مرتبط ببطاقة مندوب" detail={data.message} />
        </Panel>
      ) : null}

      {data?.isRep ? (
        <div className="grid gap-4">
          {/* البطاقة والعهدات */}
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>
            <Panel>
              <div className="muted small">المندوب</div>
              <strong>{data.salesmanName}</strong>
              <div className="muted small">
                {data.vehiclePlate ? `${data.vehiclePlate}` : 'بلا لوحة مسجّلة'}
              </div>
            </Panel>
            <Panel>
              <div className="muted small">رصيد سيارتك الرسمي</div>
              <strong style={{ fontSize: 21 }} dir="ltr">
                {data.custodyKg} kg
              </strong>
              <div className="muted small" dir="ltr">
                قيمة: {data.custodyValue} SAR
              </div>
            </Panel>
            <Panel>
              {/**
               * العنوانُ كان «مبيعات اليوم (إجمالي)» وكلا الوصفين غيرُ صحيح: فالرقمُ ليس
               * لليوم (إنّما هو جدولُ المندوب كلّه) وليس إجماليًّا (إنّما صافٍ من
               * المرتجعات منذ إصلاح المجاميع). فصار العنوانُ يقول ما هو الرقم، والسطرُ
               * تحتَه يعرض أطرافَ المعادلة: نقديّ + آجل − مرتجعات − ضريبتُها = الصافي.
               */}
              <div className="muted small">مبيعاتك — صافي المرتجعات</div>
              <strong style={{ fontSize: 21, color: 'var(--ok)' }} dir="ltr">
                {data.totals.revenue}
              </strong>
              <div className="muted small" dir="ltr">
                نقدي {data.totals.cashSales} · آجل {data.totals.creditSales}
                {data.totals.returnCount > 0
                  ? ` − مرتجعات ${data.totals.returns} وضريبتُها ${data.totals.returnsVat}`
                  : ''}
              </div>
            </Panel>
            <Panel>
              <div className="muted small">المحصّل / المتبقي على العملاء</div>
              <strong style={{ fontSize: 21 }} dir="ltr">
                {data.totals.collected}
              </strong>
              <div className="muted small" dir="ltr" style={{ color: 'var(--warn)' }}>
                متبقٍ: {data.totals.outstanding}
              </div>
              {data.totals.returnCount > 0 ? (
                <div className="muted small">
                  بعد خصم {data.totals.returnCount} إشعارٍ دائن لمرتجعاتك
                  {data.totals.returnsWithoutCostCount > 0
                    ? ` (ومنها ${data.totals.returnsWithoutCostCount} بلا تكلفةٍ مُرحّلة)`
                    : ''}
                </div>
              ) : null}
            </Panel>
            <Panel>
              <div className="muted small">حالة العهدة</div>
              <strong style={{ fontSize: 21 }} dir="ltr">
                {data.custody?.expectedKg ?? '0.0000'} kg
              </strong>
              <div className="muted small">
                {data.custody?.pendingClosings
                  ? `${data.custody.pendingClosings} إغلاق بانتظار المحاسب`
                  : 'لا يوجد إغلاق معلّق'}
              </div>
            </Panel>
          </div>

          {/* إشعارات التوريد */}
          {data.notifications.length ? (
            <Panel title="إشعارات">
              <div className="muted small">
                {windowNote(data.windows, 'notifications', NOTIFICATIONS_WINDOW_FALLBACK, {
                  totalsClause: REP_TOTALS_CLAUSE,
                })}
              </div>
              <ul className="muted small" style={{ margin: 0, paddingInlineStart: 18 }}>
                {data.notifications.slice(0, 6).map((row) => (
                  <li key={row.id}>
                    <b>{String(row.payload.title ?? row.type)}</b>
                    {row.payload.body ? ` — ${String(row.payload.body)}` : ''}
                    {!row.read ? ' (جديد)' : ''}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}

          {/* التوريدات بانتظار تأكيدك */}
          <Panel
            title={<>توريدات بانتظار تأكيد استلامك ( {data.pendingReceipts.length} )</>}
            hint={
              <>
                البضاعة المصروفة لك تبقى رسميًّا «تحت التحويل» ولا تدخل رصيد سيارتك إلا بعد تأكيدك. إن وصلك
                أقل من المصروف، سجّل الفرق وسيراجعه المحاسب.
              </>
            }
            flush
          >
            <Table
              bare
              empty={<>لا يوجد توريد بانتظارك.</>}
              columns={[
                {
                  key: 'c0',
                  header: 'رقم الأمر',
                  ltr: true,
                  cell: (row) => (
                    <>
                      <b>{row.number}</b>
                    </>
                  ),
                },
                {
                  key: 'c1',
                  header: 'التاريخ',
                  ltr: true,
                  cell: (row) => row.loadDate,
                },
                {
                  key: 'c2',
                  header: 'من مستودع',
                  cell: (row) => row.fromWarehouseName,
                },
                {
                  key: 'c3',
                  header: 'الصنف',
                  cell: (row) => row.itemName,
                },
                {
                  key: 'c4',
                  header: 'المصروف',
                  ltr: true,
                  cell: (row) => (
                    <>
                      <b>{row.loadedQty} kg</b>
                    </>
                  ),
                },
                {
                  key: 'c5',
                  header: 'دفعة الإنتاج',
                  ltr: true,
                  cell: (row) => row.productionBatchNo,
                },
                {
                  key: 'c6',
                  header: 'إجراء',
                  cell: (row) => (
                    <>
                      <button
                        type="button"
                        className="btn sm primary"
                        disabled={busy || !can('van_sales.view')}
                        onClick={() => {
                          setReceiptTarget(row);
                          setReceiptQty(row.loadedQty);
                          setReceiptNotes('');
                        }}
                      >
                        تأكيد / تسجيل فرق
                      </button>
                    </>
                  ),
                },
              ]}
              rows={data.pendingReceipts}
              rowKey={(row) => row.id}
            />
          </Panel>

          {/* أرصدة سيارتك الرسمية */}
          <Panel title="أرصدة أصناف سيارتك (من دفتر المخزون الرسمي)" flush>
            <Table
              bare
              empty={<>لا يوجد رصيد في سيارتك بعد — أكّد استلام أول توريد.</>}
              columns={[
                {
                  key: 'c0',
                  header: 'الصنف',
                  cell: (row) => row.itemName,
                },
                {
                  key: 'c1',
                  header: 'البطاقة',
                  ltr: true,
                  cell: (row) => row.sku,
                },
                {
                  key: 'c2',
                  header: 'المستودع',
                  cell: (row) => row.warehouseName,
                },
                {
                  key: 'c3',
                  header: 'الرصيد',
                  numeric: true,
                  ltr: true,
                  cell: (row) => (
                    <>
                      <b>{row.quantity}</b>
                    </>
                  ),
                },
                {
                  key: 'c4',
                  header: 'متوسط التكلفة',
                  numeric: true,
                  ltr: true,
                  cell: (row) => row.averageCost,
                },
                {
                  key: 'c5',
                  header: 'القيمة',
                  numeric: true,
                  ltr: true,
                  cell: (row) => row.value,
                },
              ]}
              rows={data.balances}
              rowKey={(row) => `${row.warehouseId}-${row.itemId}`}
            />
          </Panel>

          {/* إصدار فاتورة بيع */}
          <form
            style={{ display: 'grid', gap: 12 }}
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                () =>
                  apiPost('/van-sales/documents', {
                    loadOrderId: saleLoadOrderId,
                    partyId: salePartyId || null,
                    customerName: salePartyId ? undefined : saleWalkIn || undefined,
                    paymentMethod: salePayment,
                    soldQty: saleQty,
                    bonusQty: saleBonusQty || '0',
                    bonusReason: saleBonusReason || undefined,
                    unitPrice: saleUnitPrice || undefined,
                    invoiceMode: 'zatca_tax',
                    idempotencyKey: saleKey.key(),
                  }),
                () => `تم إصدار فاتورة البيع وخصم الكمية من رصيد سيارتك الرسمي.`,
                saleKey.reset,
              );
            }}
          >
            <Panel title="تسجيل بيع وإصدار فاتورة">
              <p className="muted small" style={{ margin: 0 }}>
                تُخصم الكمية المباعة والمجانية من رصيد سيارتك الرسمي، وتُصدر فاتورة مبيعات رسمية مرقّمة
                بالضريبة المستحقة. السعر يلتزم بشريحة العميل المعتمدة — وأي تجاوز يحتاج صلاحية اعتماد من
                الإدارة.
              </p>
              <div className="form-grid">
                <label className="field">
                  <span>العهدة / أمر التحميل *</span>
                  <select
                    className="input"
                    required
                    value={saleLoadOrderId}
                    onChange={(e) => setSaleLoadOrderId(e.target.value)}
                  >
                    <option value="">— اختر —</option>
                    {saleableLoads.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.number} · {row.itemName} · متبقٍ{' '}
                        {Number(row.expectedRemainingQty).toFixed(2)} kg
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const sel = saleableLoads.find((r) => r.id === saleLoadOrderId);
                    if (!sel) return null;
                    const siblings = saleableLoads.filter((r) =>
                      sel.itemId && r.itemId ? r.itemId === sel.itemId : r.itemName === sel.itemName,
                    );
                    if (siblings.length <= 1) return null;
                    const totalKg = siblings.reduce(
                      (s, r) => s + Number(r.expectedRemainingQty || 0),
                      0,
                    );
                    return (
                      <span className="muted small" style={{ color: 'var(--ok, #0f766e)' }}>
                        إجمالي عهدتك المفتوحة من «{sel.itemName}» في السيارة: {totalKg.toFixed(2)} كجم عبر{' '}
                        {siblings.length} أوامر تحميل — متاحٌ للبيع في فاتورة واحدة.
                      </span>
                    );
                  })()}
                </label>
                <label className="field">
                  <span>العميل</span>
                  <select
                    className="input"
                    value={salePartyId}
                    onChange={(e) => setSalePartyId(e.target.value)}
                  >
                    <option value="">— عميل نقدي (بدون بطاقة) —</option>
                    {customers.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                </label>
                {!salePartyId ? (
                  <label className="field">
                    <span>اسم العميل النقدي</span>
                    <input
                      className="input"
                      value={saleWalkIn}
                      onChange={(e) => setSaleWalkIn(e.target.value)}
                      placeholder="مثال: بقالة الحي"
                    />
                  </label>
                ) : null}
                <label className="field">
                  <span>الكمية المباعة *</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    required
                    dir="ltr"
                    value={saleQty}
                    onChange={(e) => setSaleQty(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>سعر الوحدة (اتركه فارغًا لاستخدام شريحة العميل)</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    dir="ltr"
                    value={saleUnitPrice}
                    onChange={(e) => setSaleUnitPrice(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>كمية مجانية / بونص</span>
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    dir="ltr"
                    value={saleBonusQty}
                    onChange={(e) => setSaleBonusQty(e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>سبب البونص</span>
                  <input
                    className="input"
                    value={saleBonusReason}
                    onChange={(e) => setSaleBonusReason(e.target.value)}
                    placeholder="مثال: عرض ترويجي متفق عليه"
                  />
                </label>
                <label className="field">
                  <span>طريقة الدفع</span>
                  <select
                    className="input"
                    value={salePayment}
                    onChange={(e) => setSalePayment(e.target.value as 'cash' | 'card' | 'credit')}
                  >
                    <option value="cash">نقدًا</option>
                    <option value="card">شبكة</option>
                    <option value="credit">آجل (على حساب العميل)</option>
                  </select>
                </label>
              </div>
              <div>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={busy || !can('van_sales.invoice.create')}
                >
                  {busy ? 'جارٍ الإصدار…' : 'اعتماد البيع وإصدار الفاتورة'}
                </button>
              </div>
            </Panel>
          </form>

          {/* سجل الفواتير والتحصيل */}
          <Panel title="فواتيرك ومستنداتك" flush>
            <div className="muted small">
              {windowNote(data.windows, 'documents', DOCUMENTS_WINDOW_FALLBACK, {
                totalsClause: REP_TOTALS_CLAUSE,
              })}
            </div>
            <Table
              bare
              empty={<>لا توجد فواتير بعد.</>}
              columns={[
                {
                  key: 'c0',
                  header: 'رقم المستند',
                  ltr: true,
                  cell: (row) => (
                    <>
                      <b>{row.number}</b>
                    </>
                  ),
                },
                {
                  key: 'c1',
                  header: 'الفاتورة الرسمية',
                  ltr: true,
                  cell: (row) => (
                    <>
                      {row.invoiceNumber ?? '—'}
                      {row.invoiceStatus ? <div className="muted small">{row.invoiceStatus}</div> : null}
                    </>
                  ),
                },
                {
                  key: 'c2',
                  header: 'التاريخ',
                  ltr: true,
                  cell: (row) => row.docDate,
                },
                {
                  key: 'c3',
                  header: 'العميل',
                  cell: (row) => row.customerName,
                },
                {
                  key: 'c4',
                  header: 'مباع / مجاني',
                  ltr: true,
                  cell: (row) => (
                    <>
                      {row.soldQty} / {row.bonusQty}
                      {row.documentKind === 'return' ? ' مرتجع' : ''}
                    </>
                  ),
                },
                {
                  key: 'c5',
                  header: 'الإجمالي',
                  numeric: true,
                  ltr: true,
                  cell: (row) => row.total,
                },
                {
                  key: 'c6',
                  header: 'المدفوع',
                  numeric: true,
                  ltr: true,
                  cell: (row) => row.paidAmount,
                },
                {
                  key: 'c7',
                  header: 'المتبقي',
                  numeric: true,
                  ltr: true,
                  cell: (row) => row.outstanding,
                },
                {
                  key: 'c8',
                  header: 'تحصيل',
                  cell: (row) =>
                    Number(row.outstanding) > 0 ? (
                      <button
                        type="button"
                        className="btn sm"
                        disabled={busy || !can('van_sales.collection.create')}
                        onClick={() => {
                          setCollectDocId(row.id);
                          setCollectAmount(row.outstanding);
                        }}
                      >
                        تحصيل
                      </button>
                    ) : (
                      <span className="muted small">مسدّد</span>
                    ),
                },
              ]}
              rows={data.documents}
              rowKey={(row) => row.id}
            />
          </Panel>

          {/* التحصيلات */}
          <Panel title="ما حصّلته" flush>
            <div className="muted small">
              {windowNote(data.windows, 'collections', COLLECTIONS_WINDOW_FALLBACK, {
                totalsClause: REP_TOTALS_CLAUSE,
              })}
            </div>
            <Table
              bare
              empty={<>لا توجد تحصيلات مسجّلة.</>}
              columns={[
                {
                  key: 'c0',
                  header: 'الوقت',
                  ltr: true,
                  cell: (row) => new Date(row.collectedAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
                },
                {
                  key: 'c1',
                  header: 'المبلغ',
                  numeric: true,
                  ltr: true,
                  cell: (row) => (
                    <>
                      <b>{row.amount}</b>
                    </>
                  ),
                },
                {
                  key: 'c2',
                  header: 'سند القبض الرسمي',
                  ltr: true,
                  cell: (row) => (
                    <>
                      {row.voucherNumber ?? '—'}
                      {row.voucherStatus ? <div className="muted small">{row.voucherStatus}</div> : null}
                    </>
                  ),
                },
                {
                  key: 'c3',
                  header: 'البيان',
                  cell: (row) => row.reason,
                },
              ]}
              rows={data.collections}
              rowKey={(row) => row.id}
            />
          </Panel>

          {/* إغلاق الوردية */}
          <Panel title="إغلاق الوردية وتصفية العهدة" flush>
            <div className="muted small">
              {windowNote(data.windows, 'loadOrders', LOAD_ORDERS_WINDOW_FALLBACK, {
                totalsClause: REP_TOTALS_CLAUSE,
              })}
            </div>
            <Table
              bare
              columns={[
                {
                  key: 'c0',
                  header: 'الأمر',
                  ltr: true,
                  cell: (row) => (
                    <>
                      <b>{row.number}</b>
                    </>
                  ),
                },
                {
                  key: 'c1',
                  header: 'الحالة',
                  cell: (row) => (
                    <>
                      {LOAD_STATUS_AR[row.status] ?? row.status}
                      {row.stockSettlementStatus && row.stockSettlementStatus !== 'not_required' ? (
                        <div className="muted small">
                          {SETTLEMENT_STATUS_AR[row.stockSettlementStatus] ?? row.stockSettlementStatus}
                          {row.remainingAction
                            ? ` · المتبقي: ${
                                row.remainingAction === 'return_to_main'
                                  ? 'أُعيد للمستودع الرئيسي'
                                  : 'بقي عهدة الوردية التالية'
                              }`
                            : ''}
                        </div>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: 'c2',
                  header: 'استلمت',
                  ltr: true,
                  cell: (row) => row.receivedQty,
                },
                {
                  key: 'c3',
                  header: 'بعت',
                  ltr: true,
                  cell: (row) => row.soldQty,
                },
                {
                  key: 'c4',
                  header: 'مجاني',
                  ltr: true,
                  cell: (row) => row.bonusQty,
                },
                {
                  key: 'c5',
                  header: 'متبقٍ بالعهدة',
                  ltr: true,
                  cell: (row) => (
                    <>
                      {Number(row.expectedRemainingQty).toFixed(2)}
                      {Number(row.actualRemainingQty) > 0 || row.status === 'settled' ? (
                        <span className="muted small">
                          {' '}
                          / جرد {Number(row.actualRemainingQty).toFixed(2)}
                        </span>
                      ) : null}
                    </>
                  ),
                },
                {
                  key: 'c6',
                  header: 'نقد متوقع / محصّل',
                  ltr: true,
                  cell: (row) => (
                    <>
                      {row.expectedCash} / {row.collectedCash}
                    </>
                  ),
                },
                {
                  key: 'c7',
                  header: 'إجراء',
                  cell: (row) =>
                    ['loaded', 'in_route'].includes(row.status) ? (
                      <button
                        type="button"
                        className="btn sm primary"
                        disabled={busy || !can('van_sales.closing.submit')}
                        onClick={() => {
                          setClosingTarget(row);
                          setClosingReturned('0');
                          setClosingDamaged('0');
                          setClosingDamageReason('');
                          setClosingCash(row.collectedCash);
                          // لا يُملأ الجرد الفعلي برقم المستندات: فالمندوب يكتب ما عدّه بيده.
                          setClosingActualRemaining('');
                          setClosingNotes('');
                        }}
                      >
                        تقديم إغلاق الوردية
                      </button>
                    ) : (
                      <span className="muted small">
                        {row.status === 'pending_closing'
                          ? 'بانتظار اعتماد المحاسب'
                          : row.status === 'pending_stock_settlement'
                            ? 'اعتُمدت كمياتك وبانتظار تسوية المخزون الرسمية — عهدتك لم تُغلق بعد'
                            : row.status === 'rejected'
                              ? 'رفضتَ استلامه وأُعيدت الكمية رسمياً'
                              : row.status === 'canceled'
                                ? 'أُلغي وأُعيدت كميته إلى المستودع'
                                : '—'}
                      </span>
                    ),
                },
              ]}
              rows={data.loadOrders}
              rowKey={(row) => row.id}
            />
          </Panel>
        </div>
      ) : null}

      {/* نافذة تأكيد الاستلام */}
      {receiptTarget ? (
        <div role="dialog" aria-modal="true" className="modal-backdrop" style={backdropStyle}>
          <Panel
            title={<>تأكيد استلام التوريد {receiptTarget.number}</>}
            hint={
              <>
                المصروف من المستودع الرئيسي: <b dir="ltr">{receiptTarget.loadedQty} kg</b> — الصنف:{' '}
                {receiptTarget.itemName}. أكّد الكمية التي استلمتها فعلًا؛ أي فرق يُسجَّل ويصل المحاسب
                للمراجعة.
              </>
            }
            style={dialogStyle}
          >
            <div className="form-grid">
              <label className="field">
                <span>الكمية المستلمة فعلًا *</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  required
                  dir="ltr"
                  value={receiptQty}
                  onChange={(e) => setReceiptQty(e.target.value)}
                />
              </label>
              <label className="field">
                <span>ملاحظات / سبب الفرق</span>
                <input
                  className="input"
                  value={receiptNotes}
                  onChange={(e) => setReceiptNotes(e.target.value)}
                  placeholder="مثال: كرتونة تالفة أثناء النقل"
                />
              </label>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      apiPost(`/van-sales/load-orders/${receiptTarget.id}/confirm-receipt`, {
                        receivedQty: receiptQty,
                        notes: receiptNotes || undefined,
                      }),
                    () =>
                      Number(receiptQty) < Number(receiptTarget.loadedQty)
                        ? `تم تسجيل استلام ${receiptQty} kg وفرق ${(
                            Number(receiptTarget.loadedQty) - Number(receiptQty)
                          ).toFixed(2)} kg — أُحيل الفرق إلى المحاسب.`
                        : `تم تأكيد استلام ${receiptQty} kg ودخولها رصيد سيارتك الرسمي.`,
                  ).then(() => setReceiptTarget(null))
                }
              >
                {busy ? 'جارٍ التأكيد…' : 'تأكيد الاستلام'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  const reason = window.prompt(
                    `سبب رفض استلام التوريد ${receiptTarget.number} — ستُعاد الكمية رسمياً إلى المستودع المصدر ويصل إشعار للمحاسب:`,
                    receiptNotes || '',
                  );
                  if (reason === null) return;
                  void run(
                    () =>
                      apiPost(`/van-sales/load-orders/${receiptTarget.id}/reject-receipt`, {
                        reason: reason.trim() || undefined,
                      }),
                    () =>
                      `رُفض استلام التوريد ${receiptTarget.number} وأُعيدت الكمية رسمياً إلى المستودع المصدر بقيد من ملف الترحيل.`,
                  ).then(() => setReceiptTarget(null));
                }}
              >
                رفض الاستلام وإعادة الكمية
              </button>
              <button type="button" className="btn" onClick={() => setReceiptTarget(null)}>
                إلغاء
              </button>
            </div>
            <p className="muted small" style={{ margin: 0 }}>
              الرفض يُقفل المناقلة الرسمية بوضع «الإرجاع»: تعود الكمية إلى المستودع المصدر ولا تدخل عهدتك،
              ويصل المحاسبَ إشعار بسبب الرفض.
            </p>
          </Panel>
        </div>
      ) : null}

      {/* نافذة التحصيل */}
      {collectDocId ? (
        <div role="dialog" aria-modal="true" className="modal-backdrop" style={backdropStyle}>
          <Panel
            title="تسجيل تحصيل من العميل"
            hint={
              <>
                يُصدر النظام سند قبض رسمي ويربطه بالفاتورة ويحدّث المبلغ المستحق — لا يُكتفى بتسجيل المبلغ في
                جدول التوزيع.
              </>
            }
          >
            <label className="field">
              <span>المبلغ المحصّل *</span>
              <input
                className="input"
                type="number"
                step="0.01"
                required
                dir="ltr"
                value={collectAmount}
                onChange={(e) => setCollectAmount(e.target.value)}
              />
            </label>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn primary"
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      apiPost('/van-sales/collections', {
                        documentId: collectDocId,
                        collectedAmount: collectAmount,
                        idempotencyKey: collectKey.key(),
                      }),
                    () => `تم تسجيل تحصيل ${collectAmount} ريال وإصدار سند القبض الرسمي.`,
                    collectKey.reset,
                  ).then(() => setCollectDocId(''))
                }
              >
                {busy ? 'جارٍ التسجيل…' : 'تأكيد التحصيل'}
              </button>
              <button type="button" className="btn" onClick={() => setCollectDocId('')}>
                إلغاء
              </button>
            </div>
          </Panel>
        </div>
      ) : null}

      {/* نافذة إغلاق الوردية */}
      {closingTarget ? (
        <div role="dialog" aria-modal="true" className="modal-backdrop" style={backdropStyle}>
          <Panel
            title={<>تقديم إغلاق وردية ( {closingTarget.number} )</>}
            hint={
              <>
                سجّل ما عاد معك سالمًا وما تلف والنقد المحصّل؛ يحسب النظام الفرق بين الرصيد المتوقع والجرد
                الفعلي ويحيل الطلب إلى المحاسب للاعتماد. لا يُغلق الطلب مرتين ولا يُعتمد من قِبل مقدّمه.
              </>
            }
            style={dialogStyle}
          >
            <div className="form-grid">
              <label className="field">
                <span>مرتجع سليم للمستودع</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  dir="ltr"
                  value={closingReturned}
                  onChange={(e) => setClosingReturned(e.target.value)}
                />
              </label>
              <label className="field">
                <span>كمية تالفة</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  dir="ltr"
                  value={closingDamaged}
                  onChange={(e) => setClosingDamaged(e.target.value)}
                />
              </label>
              <label className="field">
                <span>سبب التلف</span>
                <input
                  className="input"
                  value={closingDamageReason}
                  onChange={(e) => setClosingDamageReason(e.target.value)}
                />
              </label>
              <label className="field">
                <span>النقد المحصّل</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  dir="ltr"
                  value={closingCash}
                  onChange={(e) => setClosingCash(e.target.value)}
                />
              </label>
              <label className="field">
                <span>المتبقي الفعلي بالجرد في السيارة *</span>
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  dir="ltr"
                  placeholder="عدّ ما في السيارة ثم اكتب الرقم"
                  value={closingActualRemaining}
                  onChange={(e) => setClosingActualRemaining(e.target.value)}
                />
                <span className="muted small">
                  المتوقع حسب المستندات: {Number(closingTarget.expectedRemainingQty).toFixed(2)} كجم. اكتب ما
                  <b> عددتَه فعلياً</b> — الفرق يظهر للمحاسب عجزاً أو فائضاً ويجب تفسيره في الملاحظات. تركه
                  فارغاً يعني أنك لم تُثبت وجود أي كمية في السيارة.
                </span>
              </label>
              <label className="field">
                <span>ملاحظات الجرد</span>
                <input
                  className="input"
                  value={closingNotes}
                  onChange={(e) => setClosingNotes(e.target.value)}
                />
              </label>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="btn primary"
                disabled={busy || closingActualRemaining.trim() === ''}
                onClick={() =>
                  void run(
                    () =>
                      apiPost(`/van-sales/load-orders/${closingTarget.id}/submit-closing`, {
                        returnedQty: closingReturned,
                        damagedQty: closingDamaged,
                        damageReason: closingDamageReason || undefined,
                        collectedCash: closingCash,
                        actualRemainingQty: closingActualRemaining,
                        closingNotes: closingNotes || undefined,
                      }),
                    () =>
                      'تم تقديم طلب إغلاق الوردية بجردك الفعلي، وهو الآن بانتظار فحص واعتماد المحاسب. إن اختلف رصيد سيارتك الرسمي عن جردك فلن تُغلق عهدتك قبل تسويته رسمياً.',
                  ).then(() => setClosingTarget(null))
                }
              >
                {busy ? 'جارٍ التقديم…' : 'تقديم الإغلاق'}
              </button>
              <button type="button" className="btn" onClick={() => setClosingTarget(null)}>
                إلغاء
              </button>
            </div>
          </Panel>
        </div>
      ) : null}
    </Screen>
  );
}

const backdropStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  zIndex: 50,
};

const dialogStyle: React.CSSProperties = {
  width: 'min(720px, 100%)',
  maxHeight: '90vh',
  overflow: 'auto',
  display: 'grid',
  gap: 12,
};
