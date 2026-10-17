import Decimal from 'decimal.js';

import { numberText } from './lookups';
import type { ScreenColumn } from './ui-kit';

/**
 * 🏦 منطقُ شاشة الخزينة — ولا رقمَ فيها يُحسب إلا بما يقبله الخادمُ مصدرًا.
 *
 * **لماذا قراءةٌ لا كتابة** (قِيس في `apps/api/src/modules/van-sales/van-sales.service.ts:6953-7027`
 * قبل كتابة سطرٍ هنا): نقدُ الخطّ **يدخل الخزينةَ فعلًا** في مسار التحصيل الرسميّ —
 * ‏`POST /van-sales/collections` يُنشئ سندَ قبضٍ عبر `TreasuryService.createVoucherInTx`
 * (‏`kind: 'receipt'`، `subtype: 'customer'` إن للمستند طرفًا وإلا `'account'`،
 * ‏`method: 'cash'`، `referenceNo` = رقمُ مستند الخطّ، `salesmanId` = معرّفُ **الموظف**
 * خلف البطاقة، `idempotencyKey` = ‏`van-collection-voucher:<documentId>:<key>`) ثم
 * **يُرحِّله** (`postVoucherInTx`) فيكتب القيدَ (Dr الصندوق / Cr ذمم العملاء) ويرفع رصيد
 * الموضع — ولا يبقى مسودةً إلا حين لا يُحلّ حسابٌ مقابل، وعندها يقول المسارُ ذلك صراحةً
 * بدل تغطية الفجوة.
 *
 * فسندُ قبضٍ ثانٍ من هذه الشاشة على النقد نفسه **قبضٌ مزدوج**: مالٌ يدخل الصندوق مرّتين
 * وقيدٌ يتكرّر. ولذلك الشاشةُ تقرأ ما كتبه المسارُ الرسميّ وتُظهر ما فيه من فجوةٍ (سندُ
 * خطٍّ **مسودة** = تحصيلٌ لم يدخل الصندوق ولا الأستاذ)، وما يحتاج حكمًا محاسبيًّا
 * (إنشاءُ سندٍ جديد، ترحيلُه، إلغاؤه، حالةُ شيك، تحويلٌ بين موضعين) يُفتح في لوحة staff
 * بتسليم جلسة — ولا يُستنسخ محرّكٌ خزينةٌ هنا (قرارُ المالك: سطحٌ رقيقٌ فوق API نفسها).
 *
 * ومفتاحُ عدم التكرار هو **الدليلُ** على أنّ السندَ من الخطّ: لا تخمينَ من البيان ولا من
 * المرجع (فسندٌ يدويٌّ قد يحمل رقمَ مستندٍ في `referenceNo`)، بل البادئة التي يكتبها
 * المسارُ نفسه. وأمّا `referenceNo` فيُقرأ **للعرض** (رقمُ مستند الخطّ) لا للحكم.
 */

/** صفٌّ من `GET /vouchers` — والأسماءُ كما ترجعها الخدمة (‏camelCase من `select` دريزل). */
export type VoucherRow = {
  id?: string | null;
  number?: string | null;
  kind?: string | null;
  subtype?: string | null;
  date?: string | null;
  voucherTime?: string | null;
  method?: string | null;
  amount?: string | null;
  currency?: string | null;
  status?: string | null;
  cashLocationId?: string | null;
  partyId?: string | null;
  salesmanId?: string | null;
  referenceNo?: string | null;
  referenceDate?: string | null;
  recipient?: string | null;
  description?: string | null;
  chequeNo?: string | null;
  chequeState?: string | null;
  journalEntryId?: string | null;
  postedAt?: string | null;
  voidedAt?: string | null;
  idempotencyKey?: string | null;
  createdByName?: string | null;
  createdAt?: string | null;
};

/** صفٌّ من `GET /cash-locations` (‏`CashLocationDto` في `@erp/contracts`). */
export type CashLocationRow = {
  id?: string | null;
  name?: string | null;
  kind?: string | null;
  branchId?: string | null;
  currencyCode?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
  notes?: string | null;
  custodianIds?: readonly string[] | null;
};

/** ‏`GET /cash-locations/:id/balances` — و`balance` **كاشٌ مُطابَق**: فالحقيقةُ الأستاذ. */
export type CashBalanceRow = {
  cashLocationId?: string | null;
  currencyCode?: string | null;
  balance?: string | null;
  updatedAt?: string | null;
};

export type ListMeta = { total?: number; limit?: number; offset?: number };

/** الصلاحيتان اللتان يفرضهما الخادم على قراءات هذه الشاشة. */
export const TREASURY_VIEW_PERMISSION = 'treasury.view';
export const CASH_LOCATION_PERMISSION = 'organization.cashlocation.view';

/**
 * سقفُ قائمة السندات في الخادم — ‏`.limit(500)` في `treasury.service.vouchers:272` (قِيس).
 * والقائمةُ **مصفوفةٌ عارية**: بلا غلافٍ وبلا `meta.total` وبلا مجاميع، فمنها لا يُشتقّ
 * إجماليُّ فترة.
 */
export const VOUCHER_SERVER_LIMIT = 500;

/** البادئةُ التي يكتبها مسارُ التحصيل الرسميّ في `idempotencyKey` — وهي دليلُ النسبة. */
export const VAN_COLLECTION_VOUCHER_PREFIX = 'van-collection-voucher:';

/** ما يُقال حين تُلامس القائمةُ سقفَ الخادم — فلا مجموعَ ولا ادّعاءَ اكتمال. */
export const VOUCHER_CAP_NOTE =
  `بلغت القائمةُ سقفَ الخادم (${VOUCHER_SERVER_LIMIT} سند) — فهذه نافذةٌ لا السجلّ كلّه، ولا مجموعَ يُعرض ` +
  'لأنّ مجموعَ نافذةٍ مقطوعة بعنوان «الإجمالي» كذبٌ مقروء. ضيّق المدى (من/إلى) أو ابحث برقم السند.';

export function isLineCollectionVoucher(row: VoucherRow | null): boolean {
  const key = row?.idempotencyKey;
  return typeof key === 'string' && key.startsWith(VAN_COLLECTION_VOUCHER_PREFIX);
}

/** سنداتُ الخطّ من القائمة المعروضة — ونسبتُها بالمفتاح لا بالبيان. */
export function lineVouchers(rows: readonly VoucherRow[]): VoucherRow[] {
  return rows.filter((row) => isLineCollectionVoucher(row));
}

/** رقمُ مستند الخطّ كما كتبه المسارُ في `referenceNo` — للعرض والرابط، لا للحكم. */
export function lineDocumentNumber(row: VoucherRow | null): string | null {
  const reference = row?.referenceNo;
  return typeof reference === 'string' && reference.trim().length > 0 ? reference.trim() : null;
}

/**
 * سنداتُ الخطّ **المسودة** — وهي الفجوةُ التي تُقرأ هنا ولا تُغطّى: فالمسارُ لا يُرحِّل
 * السندَ إلا حين يُحلّ حسابٌ مقابل (ذممُ الطرف أو ملفُّ الترحيل)، وبلا ترحيلٍ لم يدخل
 * المالُ الصندوقَ ولا الأستاذ. وعدُّها هنا يُظهر لمَن يظنّ أنّ «محصَّل» في تقرير الخطّ
 * يعني «في الخزينة» أنّ سندًا ما زال وعدًا.
 */
export function draftLineVouchers(rows: readonly VoucherRow[]): VoucherRow[] {
  return lineVouchers(rows).filter((row) => String(row.status ?? '') === 'draft');
}

export function postedLineVouchers(rows: readonly VoucherRow[]): VoucherRow[] {
  return lineVouchers(rows).filter((row) => String(row.status ?? '') === 'posted');
}

/**
 * مجموعُ **المعروض** — ويرجع `null` حين تُلامس القائمةُ السقفَ فلا يُعرض رقمٌ ناقص
 * بعنوانٍ كامل. والجمعُ بـ`decimal.js` لا بعائمة JS (فالريالُ ليس `0.1 + 0.2`).
 */
export function shownSum(
  rows: readonly VoucherRow[],
  select: (row: VoucherRow) => string | null | undefined,
): { text: string; count: number } | null {
  if (rows.length >= VOUCHER_SERVER_LIMIT) return null;
  let running = new Decimal(0);
  let counted = 0;
  for (const row of rows) {
    const value = select(row);
    if (typeof value !== 'string' || value.trim().length === 0) continue;
    try {
      const parsed = new Decimal(value.trim());
      if (!parsed.isFinite()) continue;
      running = running.plus(parsed);
      counted += 1;
    } catch {
      // رقمٌ لا يُقرأ يُستثنى من الجمع ويُعرض كما هو في الجدول — ولا يُصفر بصمت.
      continue;
    }
  }
  return { text: running.toFixed(2), count: counted };
}

/** عنوانُ المجموع — فيقول إنّه مجموعُ المعروض في هذا المدى لا إجماليَّ السجلّ. */
export function shownSumCaption(rowCount: number, counted: number): string {
  return counted === rowCount
    ? `مجموعُ المعروض في هذا المدى (${counted} سند) — لا إجماليَّ السجلّ: فالخادمُ لا يرجع إجماليًّا هنا`
    : `مجموعُ ${counted} من ${rowCount} سندًا معروضًا — والباقي رقمُه لا يُقرأ فلم يُجمع ولم يُصفر`;
}

export const VOUCHER_KIND_LABELS: Readonly<Record<string, string>> = {
  receipt: 'سند قبض',
  payment: 'سند صرف',
};

export const VOUCHER_SUBTYPE_LABELS: Readonly<Record<string, string>> = {
  customer: 'عميل',
  supplier: 'مورد',
  expense: 'مصروف',
  account: 'حساب',
  salary: 'راتب',
  vat: 'ضريبة',
  other: 'أخرى',
};

export const VOUCHER_METHOD_LABELS: Readonly<Record<string, string>> = {
  cash: 'نقدًا',
  cheque: 'شيك',
  bank_transfer: 'تحويل بنكي',
  card: 'بطاقة',
};

export const VOUCHER_STATUS_LABELS: Readonly<Record<string, string>> = {
  draft: 'مسودة',
  posted: 'مُرحَّل',
  voided: 'ملغى',
};

export const CASH_KIND_LABELS: Readonly<Record<string, string>> = {
  safe: 'صندوق',
  bank: 'بنك',
};

export function voucherKindLabel(row: VoucherRow | null): string {
  const kind = VOUCHER_KIND_LABELS[String(row?.kind ?? '')] ?? String(row?.kind ?? '—');
  const subtype = VOUCHER_SUBTYPE_LABELS[String(row?.subtype ?? '')] ?? String(row?.subtype ?? '');
  return subtype.length > 0 ? `${kind} — ${subtype}` : kind;
}

export function voucherStatusLabel(row: VoucherRow | null): string {
  const status = String(row?.status ?? '');
  return VOUCHER_STATUS_LABELS[status] ?? (status.length > 0 ? status : '—');
}

export function voucherMethodLabel(row: VoucherRow | null): string {
  const method = String(row?.method ?? '');
  return VOUCHER_METHOD_LABELS[method] ?? (method.length > 0 ? method : '—');
}

export function cashLocationLabel(row: CashLocationRow | null): string {
  const name = String(row?.name ?? '').trim();
  const kind = CASH_KIND_LABELS[String(row?.kind ?? '')] ?? String(row?.kind ?? '');
  if (name.length === 0) return '—';
  return kind.length > 0 ? `${name} (${kind})` : name;
}

/**
 * هل الصفُّ مُطابَق؟ — و`updatedAt` هي الدليلُ الوحيد، **وقِيس في القاعدة**: إنشاءُ الموضع
 * يزرع صفَّ الرصيد صفرًا ولا يكتب `updated_at` (‏`cash-locations.service.ts:198-202` وتعليقُه
 * «Seeds the balance row at zero — PHASE_12 writes it, a report reconciles it»، والعمودُ
 * nullable وبلا `created_at`). فصفٌّ بـ`updated_at = NULL` **لم يُطابَق قطّ** وصفرُه مكانٌ
 * محجوزٌ لا قياس — وعرضُه «0.0000» يقول إنّ الصندوقَ فارغٌ وهو لم يُحسب بعد. وهذا ما ظهرت
 * به القاعدةُ المحليّة فعلًا: الموضعان (صندوقٌ وبنك) برصيد `0.0000` و`updated_at = NULL`.
 */
export function isReconciled(row: CashBalanceRow | null | undefined): boolean {
  const at = String(row?.updatedAt ?? '').trim();
  return at.length > 0 && at.toLowerCase() !== 'null';
}

/** لحظةٌ كما أرجعها الخادم، مقروءةً (‏`2026-10-16T21:57:49.185+00` ⇒ `2026-10-16 21:57`) — وبلا قيمةٍ «—». */
export function momentText(value: string | null | undefined): string {
  const text = String(value ?? '').trim();
  if (text.length === 0 || text.toLowerCase() === 'null') return '—';
  return text.replace('T', ' ').slice(0, 16);
}

/**
 * رصيدُ الموضع من صفوف الأرصدة — ولكلّ عملةٍ صفٌّ، فتُعرض العملةُ مع الرقم **إن كان
 * مُطابَقًا**. وبلا صفٍّ يُقال «—» ولا يُخترع صفر (فغيابُ الصفّ يعني أنّ الموضعَ لم يُرصد
 * بعد)، وبصفٍّ لم يُطابَق يُقال ذلك بدل الرقم المزروع.
 */
export function balanceText(
  balances: readonly CashBalanceRow[],
  locationId: string | null | undefined,
): string {
  const rows = balanceRowsOf(balances, locationId);
  if (rows.length === 0) return '—';
  return rows
    .map((row) => {
      const currency = String(row.currencyCode ?? '').trim();
      if (!isReconciled(row)) return currency.length > 0 ? `لم يُطابَق بعد (${currency})` : 'لم يُطابَق بعد';
      return `${numberText(String(row.balance ?? '0'))} ${currency}`.trim();
    })
    .join(' · ');
}

/** صفوفُ الرصيد لموضعٍ بعينه (و`balanceText` و`reconciledAtText` تقرأانها بقاعدةٍ واحدة). */
export function balanceRowsOf(
  balances: readonly CashBalanceRow[],
  locationId: string | null | undefined,
): readonly CashBalanceRow[] {
  if (!locationId) return [];
  return balances.filter((row) => String(row.cashLocationId ?? '') === locationId);
}

/** آخرُ مطابقةٍ لكلّ عملة — وبلا واحدةٍ «—» (فلا تاريخٌ يُخترع لصفٍّ لم يُطابَق). */
export function reconciledAtText(
  balances: readonly CashBalanceRow[],
  locationId: string | null | undefined,
): string {
  const rows = balanceRowsOf(balances, locationId);
  if (rows.length === 0) return '—';
  const moments = rows.map((row) => momentText(row.updatedAt)).filter((text) => text !== '—');
  return moments.length > 0 ? moments.join(' · ') : '—';
}

/** اسمُ الموضع من معرّفه — فالسندُ يحمل المعرّفَ والجدولُ يقرأ الاسم. */
export function locationNameOf(locations: readonly CashLocationRow[], locationId: string | null | undefined): string {
  if (!locationId) return '—';
  const found = locations.find((row) => String(row.id ?? '') === locationId);
  return found ? cashLocationLabel(found) : `${locationId.slice(0, 8)}…`;
}

/** أعمدةُ جدول سندات الخطّ — والرسمُ لـ`DataTable` عبر `tableColumns`. */
export const LINE_VOUCHER_COLUMNS: readonly ScreenColumn[] = [
  { key: 'number', labelAr: 'رقم السند', ltr: true },
  { key: 'date', labelAr: 'التاريخ', ltr: true },
  { key: 'lineDocument', labelAr: 'مستند الخطّ', ltr: true },
  { key: 'amountText', labelAr: 'المبلغ', numeric: true },
  { key: 'locationName', labelAr: 'موضع النقد' },
  { key: 'statusLabel', labelAr: 'الحالة' },
  { key: 'journal', labelAr: 'القيد', ltr: true, defaultHidden: true },
  { key: 'createdByName', labelAr: 'محرر السند' },
];

/** أعمدةُ جدول كلّ سندات المدى. */
export const VOUCHER_COLUMNS: readonly ScreenColumn[] = [
  { key: 'number', labelAr: 'رقم السند', ltr: true },
  { key: 'date', labelAr: 'التاريخ', ltr: true },
  { key: 'kindLabel', labelAr: 'النوع' },
  { key: 'methodLabel', labelAr: 'الطريقة' },
  { key: 'amountText', labelAr: 'المبلغ', numeric: true },
  { key: 'locationName', labelAr: 'موضع النقد' },
  { key: 'statusLabel', labelAr: 'الحالة' },
  { key: 'referenceNo', labelAr: 'المرجع', ltr: true, defaultHidden: true },
  { key: 'recipient', labelAr: 'المستفيد', defaultHidden: true },
  { key: 'description', labelAr: 'البيان', defaultHidden: true },
  { key: 'chequeNo', labelAr: 'رقم الشيك', ltr: true, defaultHidden: true },
  { key: 'journal', labelAr: 'القيد', ltr: true, defaultHidden: true },
  { key: 'createdByName', labelAr: 'محرر السند', defaultHidden: true },
];

/** أعمدةُ جدول مواضع النقد وأرصدها. */
export const CASH_LOCATION_COLUMNS: readonly ScreenColumn[] = [
  { key: 'locationName', labelAr: 'الموضع' },
  { key: 'balanceText', labelAr: 'الرصيد (كاش)' },
  { key: 'reconciledAt', labelAr: 'آخر مطابقة', ltr: true },
  { key: 'currencyCode', labelAr: 'العملة', ltr: true },
  { key: 'defaultLabel', labelAr: 'الافتراضي' },
  { key: 'activeLabel', labelAr: 'نشط' },
  { key: 'custodians', labelAr: 'المسئولون', numeric: true },
];

/**
 * صفوفُ الجدول كما تُعرض — فالحقولُ المشتقة (اسمُ الموضع، تسميةُ الحالة) تُحسب هنا مرةً
 * واحدةً ولا يُعاد حسابُها في كلّ خلية، و`cellText` أدناه قارئٌ واحدٌ لكلّ الجداول الثلاثة.
 */
export function voucherViewRows(
  rows: readonly VoucherRow[],
  locations: readonly CashLocationRow[],
): Record<string, unknown>[] {
  return rows.map((row) => ({
    ...row,
    id: String(row.id ?? ''),
    kindLabel: voucherKindLabel(row),
    methodLabel: voucherMethodLabel(row),
    statusLabel: voucherStatusLabel(row),
    amountText: row.amount ? numberText(String(row.amount)) : '—',
    locationName: locationNameOf(locations, row.cashLocationId),
    lineDocument: isLineCollectionVoucher(row) ? (lineDocumentNumber(row) ?? '—') : '—',
    journal: row.journalEntryId ? String(row.journalEntryId).slice(0, 8) + '…' : '—',
  }));
}

export function cashLocationViewRows(
  locations: readonly CashLocationRow[],
  balances: readonly CashBalanceRow[],
): Record<string, unknown>[] {
  return locations.map((row) => ({
    ...row,
    id: String(row.id ?? ''),
    locationName: cashLocationLabel(row),
    balanceText: balanceText(balances, row.id ?? null),
    reconciledAt: reconciledAtText(balances, row.id ?? null),
    currencyCode: row.currencyCode ?? '—',
    defaultLabel: row.isDefault ? 'نعم' : 'لا',
    activeLabel: row.isActive === false ? 'موقوف' : 'نشط',
    custodians: Array.isArray(row.custodianIds) ? row.custodianIds.length : 0,
  }));
}

/**
 * قارئُ الخلية — القواعدُ الأربع نفسها التي في `reports-screen.cellText` (نصٌّ/رقمٌ/منطقيّ
 * وما عداها «—»). وهنا نسخةُ الشاشة لأنّ تلك مُوقَّعةٌ على صفوف التقرير (`ReportRow`)،
 * وقاعدةُ العرض واحدة: فلا «[object Object]» ولا صفرٌ مكانَ غائب.
 */
export function treasuryCellText(row: Record<string, unknown> | null, column: ScreenColumn): string {
  const value = row ? row[column.key] : null;
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
  if (typeof value === 'number') return column.numeric ? numberText(value) : String(value);
  if (typeof value === 'string') return column.numeric ? numberText(value) : value;
  if (Array.isArray(value)) return value.length > 0 ? String(value.length) : '—';
  return '—';
}

/** نصُّ استعلام السندات — ‏`from`/`to`/`q` كما يسمّيها `treasury.controller` (لا `fromDate`). */
export function vouchersQuery(draft: { fromDate: string; toDate: string; search: string }): string {
  const params = new URLSearchParams();
  const from = draft.fromDate.trim();
  const to = draft.toDate.trim();
  const search = draft.search.trim();
  if (from.length > 0) params.set('from', from);
  if (to.length > 0) params.set('to', to);
  if (search.length > 0) params.set('q', search);
  const query = params.toString();
  return query.length > 0 ? `?${query}` : '';
}

/**
 * ما لا تفعله الشاشة — ويُقال فيها لا في وثيقةٍ بعيدة: فأخطرُ ما في شاشة خزينةٍ أن توحي
 * بأنّها تُدخل مالًا وهي لا تفعل.
 */
export const NO_WRITE_HERE_AR = [
  'لا يُنشأ سندٌ من هنا: فنقدُ الخطّ يدخل الخزينةَ في مسار التحصيل الرسميّ (POST /van-sales/collections) الذي يُنشئ سندَ القبض ويُرحِّله — وسندٌ ثانٍ هنا قبضٌ مزدوج.',
  'ولا يُرحَّل فرقٌ ولا يُحمَّل نقصٌ على أحد: فترحيلُ الفرق وإقفالُ الوردية وتحميلُ النقص على مديونية موظّف تحتاج اعتمادَ الحالة salaryDeductionApproved في مسارها (‏/custody) لا هنا.',
  'ولا قيدَ بلا مستند: فما في الجدول أسطرُ `vouchers` كما أرجعها الخادم، وعمودُ «القيد» هو معرّفُ القيد المرتبط بالسند (لا قيدَ يُنشأ من هذه الشاشة).',
  'والرصيدُ المعروض كاشٌ (‏`cash_location_balances`) والحقيقةُ الأستاذ: فصفُّ الرصيد يُزرع صفرًا عند إنشاء الموضع ولا يُكتب `updated_at` إلا بمطابقة — وبلا مطابقةٍ يُقال «لم يُطابَق بعد» بدل صفرٍ مزروعٍ يوحي أنّ الصندوقَ فارغ. وفي اللوحة `staff` حركةُ الصندوق من الأستاذ نفسه.',
] as const;
