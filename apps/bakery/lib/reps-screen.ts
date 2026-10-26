/**
 * 🧑‍💼 منطق شاشة «المندوبون» — البطاقة الرسمية، بطاقةُ الموظف، حسابُ الدخول، ومستودعُ السيارة.
 *
 * حقيقتان تحكمَان هذه الشاشة، كلتاهما مقاسةٌ في الخادم لا مظنونة:
 *
 * 1. **القائمة كاملةٌ لا نافذة.** ‏`SalesService.listSalesmenWithCustody` تُرجع كلّ بطاقات
 *    المندوبين في المنشأة (`ORDER BY s.active DESC, s.name ASC` **بلا LIMIT**)، ومعها عهدتُهم
 *    الحيّة من `stock_balances` مستودع السيارة وأوامرُ التحميل المفتوحة. فمجاميعُ هذه الشاشة
 *    مجاميعُ **كلّ** المندوبين — بعكس لوحة `/sales` و`/collection` التي تقرأ نافذةً (١٢٠
 *    مستندًا، ٦٠ أمرًا، ٨٠ حركة) وتقول ذلك.
 *
 * 2. **ربطُ حساب الدخول يمرّ بكتّاب المنصّة أنفسهم** (`MembershipsService`, `RolesService`)
 *    فلا يُخترع هنا: لا كلمةُ مرور (الحساب الجديد `invited` ويصله رابطُ التفعيل الرسميّ)،
 *    ولا حسابٌ ثانٍ للشخص الواحد (إن كانت بطاقةُ الموظف تملك عضويةً فُيعاد استعمالها ويُطبَّق
 *    عليها الدورُ والنطاق)، ولا دورٌ موازٍ (دور «مندوب توزيع» يُبحث باسمه ويُنشأ مرّةً واحدة).
 *    ولهذا تقرأ الشاشة **إيصال الخادم** وتقول حقوله كما هي — ومنها أنّ البريد الفعليّ للحساب
 *    قد يختلف عن المُدخل حين أُعيد استعمال حسابٍ قائم.
 *
 * وما **ليس** هنا: إنشاءُ بطاقة مندوب أو تعديلُها (تبقى على المسارَين الرسميَّين
 * `POST/PATCH /sales/salesmen` في `apps/staff` — والرابط العميق إليهما معروض)، ولا نطاقُ
 * الفروع على العضوية: الخادم يُطبّقه عند **إنشاء** العضوية فقط ويتجاهله عند إعادة استعمال
 * حسابٍ قائم (يُطبَّق الدور والحالة فحسب)، فعرضُه هنا وعدٌ بشيءٍ لا يفعله الخادم في الحالة
 * الشائعة — وهو من شؤون الهويّة في شاشة العضويات.
 */
import Decimal from 'decimal.js';

import { formatRequiredPermissionsAr } from './permissions-ar';

/** القراءة محميّةٌ بصلاحية رؤية الخطّ، وربطُ الحساب بعملُ مكتبٍ خلفيّ لا يملكه المندوب. */
export const REPS_VIEW_PERMISSION = 'van_sales.view';
export const LINK_ACCOUNT_PERMISSION = 'sales.salesman.manage';

/** الرابط العميق إلى البطاقة الرسمية في قشرة الموظف — لا نسخةَ ثانية من الكتابة هنا. */
export const STAFF_SALESMEN_PATH = '/sales/salesmen';

/** اسمُ الدور الذي يبحثه الخادم باسمه (ويُنشئه مرّةً واحدة إن غاب). */
export const REP_ROLE_NAME = 'مندوب توزيع';

/** نصوصُ التنبيه والرفض باللغة العربية دون إظهار أكواد الصلاحيات الإنجليزية. */
export const REPS_MESSAGES = {
  salesmanNotFound: 'المندوب غير موجود',
  emailRequired: 'أدخل البريد الإلكتروني لحساب دخول المندوب',
  linkForbidden: formatRequiredPermissionsAr([LINK_ACCOUNT_PERMISSION]),
  viewForbidden: formatRequiredPermissionsAr([REPS_VIEW_PERMISSION]),
} as const;

/**
 * مفردتا الحالة في `@erp/contracts`: `membershipStatusSchema` و`userStatusSchema` كلتاهما
 * ‏`['active','invited','suspended']`. وما يخرج عنها يُعرض خامًا — لا ترجمةَ مخترعة.
 * وأمّا `employeeStatus` فحقلُّ `text` حرّ (بلا تعدادٍ في المخطّط) فيُعرض كما جاء.
 */
export const MEMBERSHIP_STATUS_LABELS: Record<string, string> = {
  active: 'نشط',
  invited: 'مدعوّ — بانتظار التفعيل',
  suspended: 'موقوف',
};

/** نسبةُ العمولة مئويةٌ عند الخادم ومقصوصةٌ إلى 0..100 بأربعة كسور (`rateOrThrow`). */
export const RATE_RANGE_NOTE = 'النسبُ مئوية ويقصّها الخادم بين 0 و100';

export function membershipStatusLabel(status: string | null | undefined): string {
  if (!status) return '—';
  return MEMBERSHIP_STATUS_LABELS[status] ?? status;
}

/** صنفٌ في عهدة المندوب كما جاء من `stock_balances` مستودع سيارته (كميةٌ وقيمةٌ نصّية). */
export interface SalesmanCustodyItem {
  itemId: string;
  itemName: string;
  warehouseName: string;
  quantity: string;
  value: string;
}

export interface SalesmanCustody {
  openLoadOrders: number;
  pendingReceipts: number;
  pendingClosings: number;
  /** ما بقي تحت يده من كلّ أوامر التحميل المفتوحة (مستلم − مبيع − مجاني − مرتجع − تالف − ناقص). */
  custodyQty: string;
  /** النقد المتوقّع ولم يُحصّل بعد (‏`expected_cash − collected_cash`). */
  outstandingCash: string;
  items: SalesmanCustodyItem[];
}

/** ما ينقص البطاقة قبل أن يعمل المندوب فعليًا — حسبه الخادم، ولا يُعاد حسابه هنا. */
export interface SalesmanReadiness {
  hasEmployee: boolean;
  hasLoginAccount: boolean;
  loginActive: boolean;
  hasVanWarehouse: boolean;
  hasVanSalesPermissions: boolean;
}

/**
 * بطاقةُ المندوب الكاملة كما يرجعها `GET /van-sales/salesmen` — بلا حقلٍ مُختلَع، وبأسماء
 * الخادم. و`/distribution` تقرأ من المسار نفسه إسقاطًا أضيق دفاعيًّا (`SalesmanRow` في
 * `distribution-screen.ts`) لصندوق اختيارٍ لا يحتاج إلا الاسمَ والمستودع؛ فالحقيقةُ واحدة
 * (الخادم) ولا يُعاد تعريفُ الحقول هنا لتلائم شاشة.
 */
export interface SalesmanCard {
  id: string;
  name: string;
  active: boolean;
  employeeRef: string | null;
  commissionRate: string;
  collectionCommissionRate: string;
  profitCommissionRate: string;
  tel: string | null;
  mobile: string | null;
  email: string | null;
  notes: string | null;
  employeeId: string | null;
  employeeNo: string | null;
  employeeName: string | null;
  employeeStatus: string | null;
  membershipId: string | null;
  membershipStatus: string | null;
  userEmail: string | null;
  userStatus: string | null;
  roleCount: number;
  permissions: string[];
  warehouseId: string | null;
  warehouseName: string | null;
  warehouseCode: string | null;
  vehiclePlate: string | null;
  custody: SalesmanCustody;
  readiness: SalesmanReadiness;
}

/** إيصال `POST /van-sales/salesmen/:id/account` كما يرجعه الخادم. */
export interface LinkAccountReceipt {
  salesmanId: string;
  salesmanName: string;
  membershipId: string;
  /** البريد **الفعليّ** للحساب — يُقرأ من `users` عبر العضوية، فيختلف عن المُدخل عند إعادة الاستعمال. */
  email: string;
  requestedEmail: string;
  reusedExistingAccount: boolean;
  status: string;
  roleId: string;
  roleName: string;
  employeeLinked: boolean;
  scopedToVanWarehouse: boolean;
  /** الحساب الجديد بلا كلمة مرور: `invited` + ‏`must_change_password` ويرسل رابطَ التفعيل الرسميّ. */
  activationRequired: boolean;
}

export interface LinkAccountDraft {
  salesmanId: string;
  email: string;
  fullName: string;
  restrictToVanWarehouse: boolean;
}

export function emptyLinkDraft(): LinkAccountDraft {
  return { salesmanId: '', email: '', fullName: '', restrictToVanWarehouse: true };
}

/**
 * رقمٌ كما كتبه الخادم: نصٌّ بأربعة كسور، والفراغُ أو الفاسدُ لا يصيران صفرًا — فالصفرُ
 * حقيقةٌ محاسبية (لا عهدة، لا نقد) والفراغُ جهل، والخلطُ بينهما يُري المشرف رقمًا لم يقله أحد.
 */
export function decimalOrNull(value: string | null | undefined): Decimal | null {
  const text = (value ?? '').trim();
  if (text.length === 0) return null;
  try {
    const parsed = new Decimal(text);
    return parsed.isFinite() ? parsed : null;
  } catch {
    return null;
  }
}

/** نسبةٌ مئوية معروضةٌ بلا أصفارٍ زائدة (القيمة لا تتغيّر — التنسيق وحده). */
export function ratePercentText(value: string | null | undefined): string {
  const parsed = decimalOrNull(value);
  if (parsed === null) return '—';
  // الأصفارُ تُقصّ بعد الفاصلة فقط: فقصُّ `0+$` بلا شرطٍ كان يجعل '50' خمسة.
  const fixed = parsed.toFixed(4);
  const trimmed = fixed.includes('.') ? fixed.replace(/0+$/, '').replace(/\.$/, '') : fixed;
  return `${trimmed}٪`;
}

export function salesmanLabel(row: SalesmanCard): string {
  const parts = [row.name];
  if (row.employeeNo) parts.push(`موظف رقم ${row.employeeNo}`);
  if (row.vehiclePlate) parts.push(`لوحة ${row.vehiclePlate}`);
  return parts.join(' — ');
}

/** «لا عهدة مفتوحة» ليست صفرًا مكتوبًا: هي قولٌ بأنّ الخادم لم يُرجع لهذا المندوب أوامر. */
export function hasOpenCustody(row: SalesmanCard): boolean {
  const custody = row.custody;
  if (!custody) return false;
  if (Number(custody.openLoadOrders ?? 0) > 0) return true;
  const quantity = decimalOrNull(custody.custodyQty);
  const cash = decimalOrNull(custody.outstandingCash);
  return (quantity !== null && !quantity.isZero()) || (cash !== null && !cash.isZero());
}

export function custodyHeadline(row: SalesmanCard): string {
  const custody = row.custody;
  if (!custody || !hasOpenCustody(row)) return 'لا عهدة مفتوحة على هذا المندوب';
  const orders = Number(custody.openLoadOrders ?? 0);
  const waiting = [
    Number(custody.pendingReceipts ?? 0) > 0 ? `${custody.pendingReceipts} بانتظار استلامه` : null,
    Number(custody.pendingClosings ?? 0) > 0 ? `${custody.pendingClosings} بانتظار إقفاله` : null,
  ].filter((part): part is string => part !== null);
  return [
    `${orders} أمر تحميل مفتوح${waiting.length > 0 ? ` (${waiting.join('، ')})` : ''}`,
    `${custody.custodyQty} كجم تحت يده`,
    `${custody.outstandingCash} ريال نقدًا لم يُحصّل`,
  ].join(' — ');
}

export function isReadyToWork(row: SalesmanCard): boolean {
  const readiness = row.readiness;
  if (!readiness) return false;
  return (
    Boolean(row.active) &&
    readiness.hasEmployee &&
    readiness.hasLoginAccount &&
    readiness.loginActive &&
    readiness.hasVanWarehouse &&
    readiness.hasVanSalesPermissions
  );
}

export type NoteTone = 'ok' | 'warn' | 'danger';

export interface ReadinessNote {
  tone: NoteTone;
  text: string;
}

/**
 * ما ينقص البطاقة، **مع أثره** لا مع وصفه: كلّ سطرٍ يقول ماذا يتعطّل فعلًا.
 *
 * والأثرُ المذكور مقاسٌ في هذا المستودع لا مُتخيَّل:
 * - بلا بطاقة موظف ⇒ تحميلُ النقص على مديونية الموظف مرفوضٌ عند الخادم بـ422 (شرطُ اعتماد
 *   `salaryDeductionApproved` أن يكون للمندوب موظفٌ وحساب)، فالنقص يبقى معلّقًا للمراجعة.
 * - بلا حساب دخول ⇒ لا مساحةَ عمل له (`GET /van-sales/me` تُشتقّ من عضويّته هو)، فلا يرى
 *   عهدته ولا يُصدر فواتيره ولا يقدّم إقفال ورديته من واجهة المندوب.
 * - بلا مستودع سيارة ⇒ لا عهدةَ تُقاس (العهدُ تُقرأ من `stock_balances` مستودعه)، وربطُ
 *   الحساب لن يقيّده بمستودع (`scopedToVanWarehouse` تبقى false وإن طُلب التقييد).
 * - بلا صلاحيات `van_sales.*` ⇒ حارسُ الصلاحيات يرفض دخوله بـ403 على المسارات كلها.
 */
export function readinessNotes(row: SalesmanCard): ReadinessNote[] {
  const notes: ReadinessNote[] = [];
  const readiness = row.readiness;
  if (!readiness) return notes;

  if (!row.active) {
    notes.push({ tone: 'warn', text: 'البطاقة موقوفة (`active=false`): لا تُعرض في قوائم التحميل عند المندوبين النشطين.' });
  }
  if (!readiness.hasEmployee) {
    notes.push({
      tone: 'danger',
      text: 'بلا بطاقة موظف: تحميلُ النقص على مديونية الموظف مرفوضٌ عند الخادم (٤٢٢) فيبقى النقص معلّقًا للمراجعة، ولا يُربط حسابُ الدخول ببطاقةٍ (`employeeLinked=false`).',
    });
  }
  if (!readiness.hasLoginAccount) {
    notes.push({
      tone: 'danger',
      text: 'بلا حساب دخول: لا مساحةَ عمل له (`GET /van-sales/me` تُشتقّ من عضويّته)، فلا يرى عهدته ولا يُصدر فواتيره ولا يقدّم إقفال ورديته.',
    });
  } else if (!readiness.loginActive) {
    notes.push({
      tone: 'warn',
      text: `حسابُ الدخول غير نشط (${membershipStatusLabel(row.membershipStatus)}): لن يدخل حتى يُفعَّل — والحساب الجديد «invited» بلا كلمة مرور ويصله رابطُ التفعيل الرسميّ.`,
    });
  }
  if (!readiness.hasVanWarehouse) {
    notes.push({
      tone: 'danger',
      text: 'بلا مستودع سيارة: لا عهدةَ تُقاس (تُقرأ من `stock_balances` مستودعه)، وربطُ الحساب لن يقيّده بمستودع وإن طُلب التقييد.',
    });
  }
  if (!readiness.hasVanSalesPermissions) {
    notes.push({
      tone: 'danger',
      text: 'بلا صلاحية `van_sales.*`: حارسُ الصلاحيات يرفضه ٤٠٣ على مسارات الخطّ كلّها — والدورُ يُصلَح من شاشة الأدوار في `apps/staff`.',
    });
  }
  if (notes.length === 0) {
    notes.push({ tone: 'ok', text: 'البطاقة جاهزة: موظفٌ وحسابُ دخولٍ نشط ومستودعُ سيارة وصلاحياتُ الخطّ.' });
  }
  return notes;
}

export interface RepsSummary {
  total: number;
  readyToWork: number;
  missingEmployee: number;
  missingLogin: number;
  loginNotActive: number;
  missingVanWarehouse: number;
  missingPermissions: number;
  inactiveCards: number;
  withOpenCustody: number;
  /** مجموعُ كلِّ المندوبين — والقائمة كاملة (بلا LIMIT) فليس هذا تقديرَ نافذة. */
  custodyQtyTotal: Decimal;
  outstandingCashTotal: Decimal;
  custodyItemsTotal: number;
}

export function repsSummary(rows: SalesmanCard[]): RepsSummary {
  const summary: RepsSummary = {
    total: rows.length,
    readyToWork: 0,
    missingEmployee: 0,
    missingLogin: 0,
    loginNotActive: 0,
    missingVanWarehouse: 0,
    missingPermissions: 0,
    inactiveCards: 0,
    withOpenCustody: 0,
    custodyQtyTotal: new Decimal(0),
    outstandingCashTotal: new Decimal(0),
    custodyItemsTotal: 0,
  };
  for (const row of rows) {
    const readiness = row.readiness;
    if (isReadyToWork(row)) summary.readyToWork += 1;
    if (row.active === false) summary.inactiveCards += 1;
    if (readiness) {
      if (!readiness.hasEmployee) summary.missingEmployee += 1;
      if (!readiness.hasLoginAccount) summary.missingLogin += 1;
      else if (!readiness.loginActive) summary.loginNotActive += 1;
      if (!readiness.hasVanWarehouse) summary.missingVanWarehouse += 1;
      if (!readiness.hasVanSalesPermissions) summary.missingPermissions += 1;
    }
    if (hasOpenCustody(row)) summary.withOpenCustody += 1;
    const quantity = decimalOrNull(row.custody?.custodyQty);
    if (quantity !== null) summary.custodyQtyTotal = summary.custodyQtyTotal.plus(quantity);
    const cash = decimalOrNull(row.custody?.outstandingCash);
    if (cash !== null) summary.outstandingCashTotal = summary.outstandingCashTotal.plus(cash);
    summary.custodyItemsTotal += row.custody?.items?.length ?? 0;
  }
  return summary;
}

/**
 * الحمولة كما يقبلها الخادم: بريدٌ مقصوصٌ ومُصغَّر (وهو ما يفعله الخادم نفسه قبل المقارنة)،
 * واسمٌ يُحذف إن كان فارغًا فيأخذ الخادم اسمَ بطاقة الموظف أو اسمَ المندوب، و`restrictToVanWarehouse`
 * منطقيٌّ صريحٌ دائمًا (فغيابُه عند الخادم يعني «قيِّده» — `!== false` — ويُقال ذلك في الشاشة).
 */
export function buildLinkPayload(draft: LinkAccountDraft): {
  email: string;
  fullName?: string;
  restrictToVanWarehouse: boolean;
} {
  const payload: { email: string; fullName?: string; restrictToVanWarehouse: boolean } = {
    email: draft.email.trim().toLowerCase(),
    restrictToVanWarehouse: draft.restrictToVanWarehouse !== false,
  };
  const fullName = draft.fullName.trim();
  if (fullName.length > 0) payload.fullName = fullName;
  return payload;
}

/** بريدٌ يُشبه البريد — تحذيرٌ لا حظر: فالخادم يقصّ ويُصغّر ولا يفحص الصيغة هنا. */
export function emailLooksValid(text: string): boolean {
  const value = text.trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export interface Verdict {
  blocked: string[];
  warnings: string[];
}

/**
 * القاعدة نفسها التي في `/sales` و`/collection`: **يُحظر فقط ما يحسبه العميل كحساب الخادم
 * تمامًا**، بنصّ الخادم حرفًا؛ وما عداه تحذيرٌ يُقال معه إنّ الحكم النهائيّ للخادم. فحظرٌ
 * مبنيٌّ على ظنٍّ يمنع عملًا صحيحًا، وهو كذبٌ من نوعٍ آخر.
 */
export function linkVerdict(
  draft: LinkAccountDraft,
  row: SalesmanCard | null,
  options: { canLink: boolean },
): Verdict {
  const blocked: string[] = [];
  const warnings: string[] = [];

  if (!row) {
    blocked.push(`${REPS_MESSAGES.salesmanNotFound} (٤٠٤) — اختر مندوبًا من القائمة.`);
  }
  if (draft.email.trim().length === 0) {
    blocked.push(`${REPS_MESSAGES.emailRequired} (٤٢٢).`);
  }
  if (!options.canLink) {
    blocked.push(
      `${REPS_MESSAGES.linkForbidden} (٤٠٣) — ربطُ حسابات الدخول عملُ مكتبٍ خلفيّ؛ والمندوب نفسه ممنوعٌ منه في مواصفة القبول.`,
    );
  }

  if (blocked.length === 0 && !emailLooksValid(draft.email)) {
    warnings.push(
      'البريد لا يبدو صحيحًا (بلا @ ونطاق) — والخادم يقصّه ويُصغّره ثمّ يمرّره إلى كاتب العضويات الرسميّ، فهو الذي يقبله أو يرفضه.',
    );
  }
  if (row) {
    if (row.membershipId) {
      warnings.push(
        `له حسابُ دخولٍ قائم (${row.userEmail ?? '—'}): الخادم **يُعيد استعماله** ويطبّق عليه الدور والحالة والنطاق — فلا يُنشأ حسابٌ ثانٍ للشخص الواحد، وقد يختلف البريدُ الفعليّ للحساب عمّا تكتبه هنا ويُرَدّ عليك في الإيصال.`,
      );
    }
    if (!row.readiness?.hasEmployee) {
      warnings.push(
        'بلا بطاقة موظف: يُنشأ الحساب ولا يُربط ببطاقةٍ (`employeeLinked=false`)، فيبقى تحميلُ النقص على مديونية الموظف مرفوضًا عند الخادم حتى تُربط البطاقة.',
      );
    }
    if (!row.readiness?.hasVanWarehouse) {
      warnings.push(
        'بلا مستودع سيارة على البطاقة: لن يُقيَّد الحساب بمستودع (`scopedToVanWarehouse=false`) وإن طلبتَ التقييد — فقيّد البطاقة بمستودع سيارته أولًا.',
      );
    }
    if (draft.restrictToVanWarehouse === false) {
      warnings.push(
        'ألغيتَ تقييدَ الحساب بمستودع السيارة: فيرى ما تراه صلاحياتُه من المستودعات بلا نطاقٍ يحصره في سيارته — وهذا توسيعُ وصولٍ مقصود، لا إعدادٌ محايد.',
      );
    }
    if (row.active === false) {
      warnings.push('البطاقة موقوفة: ربطُ الحساب لا يُنشّطها — التنشيطُ من البطاقة الرسمية في `apps/staff`.');
    }
    if (!row.readiness?.hasVanSalesPermissions && row.membershipId) {
      warnings.push(
        'حسابُه الحاليّ بلا صلاحية `van_sales.*`: الربطُ يضعه على دور «مندوب توزيع» فيمنحه صلاحياتِ الخطّ — فإن لم يكن هذا مقصودًا فأوقف العملية.',
      );
    }
  }

  return { blocked, warnings };
}

export interface LinkOutcome {
  tone: 'ok' | 'warn';
  headline: string;
  notes: string[];
}

/**
 * قراءةُ الإيصال بحقوله هو — لا باستنتاجٍ من «نجح الطلب»:
 * البريدُ الفعليّ مقابل المطلوب، وإعادةُ الاستعمال، والتفعيلُ المطلوب (بلا كلمة مرور مخترعة)،
 * والنطاقُ على مستودع السيارة، وربطُ بطاقة الموظف.
 */
export function linkOutcome(receipt: LinkAccountReceipt | null | undefined): LinkOutcome | null {
  if (!receipt) return null;
  const notes: string[] = [];
  const emailDiffers =
    Boolean(receipt.email) && Boolean(receipt.requestedEmail) && receipt.email !== receipt.requestedEmail;

  if (receipt.reusedExistingAccount) {
    notes.push(
      emailDiffers
        ? `أُعيد استعمالُ الحساب القائم: البريدُ الفعليّ للحساب «${receipt.email}» لا ما كُتب في الطلب («${receipt.requestedEmail}») — حسابٌ واحد للشخص الواحد.`
        : 'أُعيد استعمالُ الحساب القائم وطُبِّق عليه الدورُ والحالة (لا حسابَ ثانٍ).',
    );
  } else {
    notes.push(`أُنشئت عضويةٌ جديدة عبر كاتب المنصّة الرسميّ على الدور «${receipt.roleName || '—'}».`);
  }
  if (receipt.activationRequired) {
    notes.push(
      `الحساب بحالة «${membershipStatusLabel(receipt.status)}»: **لم تُخترع كلمةُ مرور** — يصل المندوبَ رابطُ التفعيل الرسميّ من منصّة الهويّة ويغيّر كلمة المرور عند أول دخول.`,
    );
  } else {
    notes.push(`الحساب بحالة «${membershipStatusLabel(receipt.status)}» — لا تفعيلَ مطلوب.`);
  }
  notes.push(
    receipt.scopedToVanWarehouse
      ? 'الحساب مقيَّدٌ بمستودع سيارة المندوب (نطاقُ `warehouse` على العضوية) فلا يقرأ عهدةَ سيارةٍ أخرى.'
      : 'الحساب **غير مقيَّدٍ بمستودع**: إمّا أنّ البطاقة بلا مستودع سيارة، أو أنّ التقييد أُلغي في الطلب — فراجع أيّهما قبل أن تُعطيه جهازًا.',
  );
  notes.push(
    receipt.employeeLinked
      ? 'رُبطت بطاقةُ الموظف بعضويّته (`employees.membership_id`).'
      : 'لم تُربط بطاقةُ موظف: البطاقةُ بلا `employee_id`، فتحميلُ النقص على مديونية الموظف يبقى مرفوضًا عند الخادم.',
  );

  return {
    tone: receipt.activationRequired || !receipt.scopedToVanWarehouse || !receipt.employeeLinked ? 'warn' : 'ok',
    headline: `${receipt.salesmanName || 'المندوب'} — عضوية ${receipt.membershipId}`,
    notes,
  };
}
