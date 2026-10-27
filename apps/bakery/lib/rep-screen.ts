/**
 * 📱 شاشةُ المندوب (`/rep`) — منطقٌ نقيّ: إسقاطاتُ الحمولة، وفحصُ أرقامها، وربطُ الطابور.
 *
 * **وما ليس هنا**: أنواعُ الحمولة (في `@erp/web-van/rep-workspace` — عقدُ الشبكة المشترك مع
 * شاشة الطاقم)، وأجسامُ الإجراءات (في `buildDocumentPayload`/‏`buildReturnPayload` من
 * `sales-screen`، و`buildCollectionPayload` من `collection-screen`، و`buildClosingPayload` من
 * `@erp/web-van/custody`، و`buildReceiptPayload` من `@erp/web-van/distribution`)، والأحكامُ
 * المالية (`documentVerdict`, ‏`returnVerdict`, ‏`collectionVerdict`) وأحكامُ الطابور
 * (‏`queueVerdict` في `rep-queue`). فكلُّ تلك موجودةٌ ومقاسةٌ في مواضعها، ونسخةٌ ثانيةٌ منها
 * هنا هي بالضبط ما أخرج عيوبَ المجاميع المتباعدة في الخادم.
 *
 * **وما هنا** ثلاثةُ أشياء لا يملكها أحدٌ غير هذا الوجه:
 *
 * 1. **جملُ النوافذ** بمفردة المندوب (`totals` لا `summary`) وباحتياطياتٍ صادقة.
 * 2. **فحصُ أرقام الخادم** (`totalsReconcile`): المعادلتان تُغلقان أو يُقال إنّهما لا
 *    تُغلقان — تدقيقٌ لا زينة.
 * 3. **قراءاتٌ من حقول الخادم** لا حسابٌ عليها: فما يُباع منه وما يُرجَع منه بنصوص الخادم،
 *    ونقصُ الاستلام من `discrepancyQty` (وهو `max(0, loaded − received)` كما يكتبه
 *    `confirmReceipt` — **لا فرقُ الجرد**، فذاك من `shortageQty` بعد الإقفال).
 */
import { Decimal } from 'decimal.js';
import {
  REP_TOTALS_CLAUSE,
  windowNote,
  type DashboardWindows,
} from '@erp/web-van/windows';
import type {
  RepDocumentRow,
  RepLoadOrderRow,
  RepTotals,
  RepWorkspace,
} from '@erp/web-van/rep-workspace';

import { numberText } from './lookups';
import { buildQueueIdempotencyKey, endpointFor, isQueueable, type RepOperation } from './rep-queue';
import { decimalOrNull } from './sales-screen';

export { REP_WORKSPACE_PERMISSION } from '@erp/web-van/rep-workspace';
export type {
  RepBalanceRow,
  RepCollectionRow,
  RepCustody,
  RepDocumentRow,
  RepLoadOrderRow,
  RepNotification,
  RepPendingReceipt,
  RepTotals,
  RepWorkspace,
  RepWindows,
} from '@erp/web-van/rep-workspace';

/** جملُ النوافذ الاحتياطية: تُعرض حين لا يقول الخادم كم في الجدول — فلا رقمَ مخمَّن. */
export const REP_WINDOW_FALLBACKS = {
  loadOrders: 'أحدث ٥٠ أمر تحميل (حدُّ نافذة الخادم) — والعهدةُ من أوامرك كلّها',
  documents: 'أحدث ١٠٠ مستند (حدُّ نافذة الخادم) — والأرقامُ من جدولك كلّه',
  collections: 'أحدث ٥٠ حركة تحصيل (حدُّ نافذة الخادم)',
  notifications: 'أحدث ٢٠ إشعارًا (حدُّ نافذة الخادم)',
} as const;

export type RepWindowNotes = Record<keyof typeof REP_WINDOW_FALLBACKS, string>;

/** جملُ النوافذ الأربع — من `@erp/web-van/windows` وبمفردة المندوب. */
export function repWindowNotes(workspace: RepWorkspace | null): RepWindowNotes {
  const windows = (workspace?.windows ?? null) as DashboardWindows | null;
  return {
    loadOrders: windowNote(windows, 'loadOrders', REP_WINDOW_FALLBACKS.loadOrders, {
      totalsClause: REP_TOTALS_CLAUSE,
    }),
    documents: windowNote(windows, 'documents', REP_WINDOW_FALLBACKS.documents, {
      totalsClause: REP_TOTALS_CLAUSE,
    }),
    collections: windowNote(windows, 'collections', REP_WINDOW_FALLBACKS.collections, {
      totalsClause: REP_TOTALS_CLAUSE,
    }),
    notifications: windowNote(windows, 'notifications', REP_WINDOW_FALLBACKS.notifications, {
      totalsClause: REP_TOTALS_CLAUSE,
    }),
  };
}

function zero(value: string | number | null | undefined): Decimal {
  return decimalOrNull(value) ?? new Decimal(0);
}

/**
 * 🔎 فحصُ المعادلتين على أرقام الخادم — **تدقيقٌ لا زينة**.
 *
 * فالشاشةُ تعرض إيرادًا صافيًا وأطرافَه؛ وإن لم تُغلق المعادلةُ (حمولةٌ مبتورة، أو حقلٌّ
 * ناقصٌ من خادمٍ أقدم، أو خطأُ جمع) فالصمتُ يعني عرضَ رقمٍ لا يُعرف ممّا صُنع. وتُعاد
 * الجملةُ لتحذيرٍ معروض، أو `null` حين تُغلق المعادلتان.
 */
export function totalsReconcile(totals: RepTotals | null | undefined): string | null {
  if (!totals) return 'لم يرجع الخادم مجاميعَ المندوب — فلا أرقامَ تُعرض ولا صفرَ يُختلع.';
  const byGross = zero(totals.salesGross).minus(zero(totals.returns)).minus(zero(totals.returnsVat));
  const byTender = zero(totals.cashSales)
    .plus(zero(totals.creditSales))
    .minus(zero(totals.returns))
    .minus(zero(totals.returnsVat));
  const revenue = zero(totals.revenue);
  if (!byGross.equals(revenue) || !byTender.equals(revenue))
    return (
      `أرقامُ الخادم لا تُغلق المعادلة: الإيرادُ ${revenue.toFixed(2)} بينما إجماليُّ المبيعات ناقصًا ` +
      `المرتجعات وضريبتَها ${byGross.toFixed(2)} ونقديّ + آجل ناقصًا المرتجعات ${byTender.toFixed(2)} — ` +
      'لا تعتمد هذه البطاقة وراجع المحاسب.'
    );
  return null;
}

export type HeadlineCard = {
  key: string;
  labelAr: string;
  valueText: string;
  /** سطرٌ تحت الرقم — أطرافُ المعادلة أو ما يوضّح أنّ الرقمَ ليس ما يبدو. */
  hintAr: string;
};

/**
 * البطاقاتُ الأربع في رأس الشاشة. والعنوانُ يقول ما هو الرقمُ فعلًا: فالإيرادُ **صافي
 * المرتجعات** ومن **جدول المندوب كلّه** — لا «اليوم» ولا «الإجمالي»، وكلا الوصفين كان
 * كذبًا في شاشةٍ قائمة وأُصلح في الشريحة ١٣هـ.
 */
export function repHeadlineCards(workspace: RepWorkspace): HeadlineCard[] {
  const totals = workspace.totals ?? null;
  const custody = workspace.custody ?? null;
  const hasReturns = (totals?.returnCount ?? 0) > 0;
  return [
    {
      key: 'custodyBalance',
      labelAr: 'رصيدُ سيارتك الرسميّ',
      valueText: `${workspace.custodyKg} كجم`,
      hintAr: `قيمته ${workspace.custodyValue} ريال — من دفتر المخزون الرسميّ (كاملٌ بلا نافذة).`,
    },
    {
      key: 'revenue',
      labelAr: 'مبيعاتك — صافي المرتجعات',
      valueText: totals ? numberText(totals.revenue) : '—',
      hintAr: totals
        ? `نقديّ ${numberText(totals.cashSales)} · آجل ${numberText(totals.creditSales)}` +
          (hasReturns
            ? ` − مرتجعات ${numberText(totals.returns)} وضريبتُها ${numberText(totals.returnsVat)}`
            : '')
        : 'لم يرجع الخادم مجاميعَ المندوب.',
    },
    {
      key: 'collected',
      labelAr: 'المحصَّل / المتبقّي على العملاء',
      valueText: totals ? numberText(totals.collected) : '—',
      hintAr: totals
        ? `متبقٍّ ${numberText(totals.outstanding)}` +
          (hasReturns
            ? ` — بعد خصم ${totals.returnCount} إشعارٍ دائن لمرتجعاتك` +
              (totals.returnsWithoutCostCount > 0
                ? ` (ومنها ${totals.returnsWithoutCostCount} بلا تكلفةٍ مُرحّلة)`
                : '')
            : '')
        : 'لم يرجع الخادم مجاميعَ المندوب.',
    },
    {
      key: 'custodyState',
      labelAr: 'حالةُ العهدة',
      valueText: `${custody?.expectedKg ?? '0.0000'} كجم`,
      hintAr: custody
        ? custody.pendingClosings > 0
 ? `${custody.pendingClosings} إغلاق بانتظار المحاسب — والرصيدُ الرسميّ ${custody.officialKg} كجم`
 : `لا إغلاقَ معلّق — والرصيدُ الرسميّ ${custody.officialKg} كجم`
        : 'لا عهدةَ مفتوحة.',
    },
  ];
}

/**
 * أوامرٌ يُباع منها الآن: حالتُها `loaded` أو `in_route` (بعد أوّل عملية بيع يبقى الأمر
 * مفتوحًا في حالة `in_route` ما دام فيه متبقٍّ) وفيها متبقٍّ **بحسب الخادم**
 * (‏`expectedRemainingQty`). والأوامرُ المصفّاة/الملغاة/بانتظار الاستلام خارجها.
 */
export function saleableLoadOrders(rows: readonly RepLoadOrderRow[]): RepLoadOrderRow[] {
  return rows.filter(
    (row) =>
      (row.status === 'loaded' || row.status === 'in_route') &&
      zero(row.expectedRemainingQty).gt(0),
  );
}

/**
 * إجمالي العهدة المفتوحة القابلة للبيع لنفس الصنف في سيارة المندوب عبر أوامر التحميل المفتوحة:
 * فإذا بقي 55 كجم من أمر سابق واستلم المندوب 50 كجم بأمر جديد صار إجمالي المتاح للبيع 105 كجم.
 */
export function itemOpenCustodySummary(
  rows: readonly RepLoadOrderRow[],
  selected: RepLoadOrderRow | null | undefined,
): { totalKg: string; orderCount: number } | null {
  if (!selected) return null;
  const open = saleableLoadOrders(rows).filter((row) =>
    selected.itemId && row.itemId
      ? row.itemId === selected.itemId
      : row.itemName === selected.itemName,
  );
  if (open.length === 0) return null;
  const sum = open.reduce((acc, row) => acc.plus(zero(row.expectedRemainingQty)), zero('0'));
  return { totalKg: sum.toFixed(2), orderCount: open.length };
}

/** مستنداتٌ يُرجَع منها: صفوفُ البيع وحدها (فالخادمُ يرفض مرتجعَ مرتجع). */
export function returnableDocuments(rows: readonly RepDocumentRow[]): RepDocumentRow[] {
  return rows.filter((row) => row.documentKind === 'sale');
}

/**
 * سقفُ المرتجع **حدٌّ أعلى** (`sold + bonus`) لا رقمًا نهائيًّا: فحمولةُ المندوب لا تحمل
 * ‏`referenceDocumentId` ولا سجلَّ مرتجعات كلّ مستند، وما أُرجع فعلًا يجمعه الخادم. ولهذا
 * يُعرض تحذيرًا لا حظرًا — والحكمُ له (و`returnVerdict` في `sales-screen` يقول الشيء نفسه).
 */
export function returnCeilingText(doc: RepDocumentRow): string {
  const ceiling = zero(doc.soldQty).plus(zero(doc.bonusQty));
  return `${ceiling.toFixed(2)} كجم حدٌّ أعلى (المبيع + المجانيّ) — ويخصم الخادمُ ما أُرجع على هذا المستند سابقًا.`;
}

/**
 * ⚠️ نقصُ **الاستلام** — من حقلّ الخادم `discrepancyQty` (وهو `max(0, loaded − received)`
 * كما يكتبه `confirmReceipt`) وحالةِ التسوية، لا من حسابٍ محليّ. وليس فرقَ الجرد: فذاك
 * ‏`closingShortageText`.
 */
export function receiptShortfallText(row: RepLoadOrderRow): string | null {
  const shortfall = zero(row.discrepancyQty);
  if (shortfall.lte(0)) return null;
  const pending = row.stockSettlementStatus === 'pending_transit_decision';
  return (
    `نقصَ عند الاستلام ${shortfall.toFixed(2)} كجم (المحمَّل ${zero(row.loadedQty).toFixed(2)} − ` +
    `المستلَم ${zero(row.receivedQty).toFixed(2)})` +
    (pending
      ? ' — فرقٌ بلا قرارٍ بعد: بانتظار المحاسب (`pending_transit_decision`)، ولا يُشطب تلقائيًّا.'
      : row.stockSettlementNote
        ? ` — قولُ الخادم: ${row.stockSettlementNote}`
        : '.')
  );
}

/**
 * 🧮 العجزُ **المُعلن عند الإقفال** — من حقلي الخادم `shortageQty` و`shortageValue`
 * (وبعد اعتماد المحاسب تُقرأ ملاحظتُه كما كتبها). ولا يُحسب هنا من
 * ‏`expected − actual`: فالخادمُ يشتقّه عند الإقفال، وإعادةُ اشتقاقه في العميل نسخةٌ ثانيةٌ
 * من قاعدةٍ مالية.
 */
export function closingShortageText(row: RepLoadOrderRow): string | null {
  const shortage = zero(row.shortageQty);
  if (shortage.lte(0)) return null;
  return (
    `عجزٌ مُعلن ${shortage.toFixed(2)} كجم بقيمة ${zero(row.shortageValue).toFixed(2)} ريال — ` +
    (row.approvedAt
      ? `اعتُمد${row.stockSettlementNote ? ` وقولُ الخادم: ${row.stockSettlementNote}` : ''}.`
      : 'لا يُشطب تلقائيًّا: إمّا مديونيةُ موظّفٍ بتفويضٍ صريحٍ لكلّ حالة، أو تسويةُ مخزون.')
  );
}

/**
 * 🔑 الجسمُ **بمفتاحه**: الجسمُ المُعاد هو ما يُرسل أو يُحفظ في الطابور — فلا يُبنى الجسمُ
 * مرّتين فيختلفا، والمفتاحُ يُبنى من الجسم **بلا مفتاح** (وإلا دخلت بصمتُه في نفسها).
 *
 * ‏- بلا `key`: يُبنى مفتاحٌ جديد (نيّةٌ جديدة). ويُستعمل في الاختبارات وفي حفظ نيّةٍ لم
 *   يمرّ لها متتبّع.
 * ‏- وبـ`key`: يُستعمل كما هو — وهو ما تفعله الشاشة بمتتبّع `useSubmissionKey` (‏`key(body)`)
 *   كي تبقى **النيّةُ الواحدةُ مفتاحًا واحدًا** بين نقرتين (فمفتاحٌ جديدٌ لكلّ نقرة =
 *   مستندٌ مكرّر، وهذا هو درسُ الشريحة ٨)، وكي يُخزَّن المفتاحُ نفسه مع النيّة في الطابور
 *   فتستعمله كلّ إعادة.
 *
 * ويُرفض بناءُ مفتاحٍ لعمليّةٍ غير قابلةٍ للحفظ (الإقفالُ والاستلام): فمساراهما لا يقبلان
 * مفتاحًا في الجسم، ومفتاحٌ لا يقرؤه الخادمُ أمانٌ زائف.
 */
export function bodyWithIdempotencyKey(
  operation: RepOperation,
  body: Record<string, unknown>,
  key?: string,
): Record<string, unknown> {
  if (!isQueueable(operation))
    throw new Error(
      `لا يُبنى مفتاحُ عدم تكرارٍ لـ${operation}: فمسارُه لا يقبل مفتاحًا في جسمه ولا يُحفظ في الطابور.`,
    );
  return { ...body, idempotencyKey: key ?? buildQueueIdempotencyKey(operation, body) };
}

/** المسارُ الرسميّ لإجراءٍ — من `rep-queue` (ولا مساراتَ ثانيةً في هذا الوجه). */
export function actionEndpoint(operation: RepOperation, targetId?: string | null): string {
  return endpointFor(operation, targetId);
}
