import { isKnownPermissionCode } from '@erp/contracts';

/**
 * خريطة وحدات واجهة المخابز — والكتالوج **حالةٌ مقاسة** لا زينة.
 *
 * قاعدتان تمنعان القشرة التجميلية:
 *   1. `ready` ⇔ للشاشة صفحةٌ فعلًا تحت `app/` — ويقيس `tests/navigation.spec.ts` الطرفين:
 *      فلا تُعلَن شاشةٌ جاهزة بلا صفحة، ولا تُبنى صفحةٌ بلا إعلان.
 *   2. `planned` ⇒ **بلا `href`**: لا رابط لمسطرٍ لم يُبنَ (الرابط الميت كذب)، والقائمة
 *      تعرضه نصّاً بمرحلته ونقاطه التي سيستعملها.
 *
 * وكلّ `permission` هنا رمزٌ من سجلّ العقود (`isKnownPermissionCode` يقيسه السبيك)، وهو
 * ما يفرضه **الخادم** (`@RequiresPermission`) — فالقائمة تُصفّى به كي لا تعرض ما سيُرفض،
 * لا لكي يكون هو الضابط. والضوابط الحقيقية: صلاحيات API + ترخيص الباقة (`lib/licence.ts`).
 *
 * ونقاط الخادم أدناه من `apps/api/src/modules/van-sales/van-sales.controller.ts` ووحدات
 * الخزينة كما هي — لا مسارات مُختلَعة: هذه الواجهة سطحٌ فوق API نفسها ولا محرّك ثانٍ فيها.
 */
export type ModuleStatus = 'ready' | 'planned';

export type BakeryModule = {
  readonly key: string;
  readonly labelAr: string;
  readonly icon: string;
  readonly status: ModuleStatus;
  /** مسار الشاشة حين تكون مبنيّة — ولا مسار لمخطَّطة. */
  readonly href?: string;
  readonly phaseAr: string;
  readonly planAr: string;
  readonly permission?: string;
  /**
   * شاشةٌ لدورين: تُعرض لمن يملك **أيّاً** من هذه الرموز. فإقفال العهدة يقدمه المندوب
   * (`van_sales.closing.submit`) ويعتمده المحاسب (`van_sales.closing.approve`) — وإعلان رمزٍ
   * واحد يحجب الشاشة عن أحدهما وهو يملك إجراءها فعلاً في الخادم.
   */
  readonly anyPermissions?: readonly string[];
  readonly endpoints: readonly string[];
};

export const BAKERY_MODULES: readonly BakeryModule[] = [
  {
    key: 'overview',
    labelAr: 'نظرة اليوم',
    icon: '🥖',
    status: 'ready',
    href: '/',
    phaseAr: 'المرحلة 2 — مبنيّة',
    planAr:
      'حالة الترخيص، والهوية، وخريطة الوحدات: ما يعمل الآن وما لم يُبنَ بعد. لا أرقام مُختلَقة ولا بلاطات فارغة تدّعي بيانات.',
    endpoints: ['GET /me'],
  },
  {
    key: 'production',
    labelAr: 'الإنتاج',
    icon: '🏭',
    status: 'ready',
    href: '/production',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.production.manage',
    planAr:
      'دفعة إنتاج بمكوّناتها: تقديرٌ إرشادي من المتوسط الرسمي قبل الاعتماد، ورفضٌ سابق للإرسال بالنصّ الذي سيقوله الخادم، وجدولُ الدفعات كما يعيده الخادم (بلا تلخيصٍ محلي). وبلا مكوّنات يرفض الخادم 422 (VAN_PRODUCTION_INPUT_REQUIRED)، والفاقد بلا سبب مرفوض، ولا تُرسل الشاشة unitCost.',
    endpoints: ['POST /van-sales/production-batches', 'GET /van-sales/dashboard', 'GET /organization/catalog/items', 'GET /warehouses'],
  },
  {
    key: 'distribution',
    labelAr: 'التوزيع والأحمال',
    icon: '🚚',
    status: 'ready',
    href: '/distribution',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.load.manage',
    planAr:
      'أمر تحميلٍ لصنفٍ واحد من مستودع المصدر إلى عهدة المندوب (بمناقلة رسمية)، وتأكيد الاستلام أو رفضه، وإلغاء الأمر في draft/pending_receipt. ورفضٌ سابق للإرسال بالنصّ الذي سيقوله الخادم (المندوب ثمّ الكمية ثمّ مصدر الصنف)، وجدولُ الأحمال كما يعيده الخادم، والحالة غير المعروفة تُعرض خاماً. وإقفال العهدة واعتماده وتسوية فرق المخزون وإغلاق فرق العبور **ليست هنا** — وحدة «إقفال العهدة» (/custody) تبنيها، والأستاذ وتفصيل القيود في staff.',
    endpoints: [
      'POST /van-sales/load-orders',
      'POST /van-sales/load-orders/:id/confirm-receipt',
      'POST /van-sales/load-orders/:id/reject-receipt',
      'POST /van-sales/load-orders/:id/cancel',
      'GET /van-sales/dashboard',
      'GET /van-sales/salesmen',
      'GET /organization/catalog/items',
      'GET /warehouses',
    ],
  },
  {
    key: 'reps',
    labelAr: 'المناديب',
    icon: '🧑\u200d💼',
    status: 'planned',
    phaseAr: 'المرحلة 3',
    permission: 'sales.salesman.manage',
    planAr:
      'المناديب: بطاقة مندوب ← حساب مستخدم ← ربط الموظف ← حصر الدخول بمستودع حمله. والصلاحيات يمنحها المدير (دور «مندوب توزيع»)، فلا مندوبَ بلا موظفٍ ولا مستخدمٍ حقيقيّين.',
    endpoints: ['GET /van-sales/salesmen', 'POST /sales/salesmen', 'POST /van-sales/salesmen/:id/account'],
  },
  {
    key: 'sales',
    labelAr: 'فواتير الخطّ',
    icon: '🧾',
    status: 'planned',
    phaseAr: 'المرحلة 3',
    permission: 'van_sales.invoice.create',
    planAr:
      'فواتير التوزيع ومرتجعاتها وطباعة السند: سندٌ واحد بنسختين لا فاتورتان، ولا QR مُختلَق قبل الإصدار الإلكتروني.',
    endpoints: [
      'POST /van-sales/documents',
      'POST /van-sales/documents/:id/returns',
      'GET /van-sales/documents/:id/print-view',
    ],
  },
  {
    key: 'collection',
    labelAr: 'التحصيل',
    icon: '💵',
    status: 'planned',
    phaseAr: 'المرحلة 3',
    permission: 'van_sales.collection.create',
    planAr:
      'التحصيل النقديّ والآجل من عملاء الخطّ، وتسوية الأرصدة القديمة باعتمادٍ صريح (van_sales.override.approve).',
    endpoints: ['POST /van-sales/collections', 'POST /van-sales/legacy-reconciliation'],
  },
  {
    key: 'custody',
    labelAr: 'إقفال العهدة',
    icon: '📋',
    status: 'ready',
    href: '/custody',
    phaseAr: 'المرحلة 3 — مبنيّة',
    anyPermissions: ['van_sales.closing.submit', 'van_sales.closing.approve'],
    planAr:
      'إقفال الحمولة: جردٌ فعليّ، فصلٌ رباعيّ لا يُدمج (مرتجع سليم/تالف/عجز/متبقٍ)، قرارُ فرق العبور، ثمّ التسوية الرسمية بمستند الجرد. وسياسة تقييم العجز تُقرأ وتُكتب هنا (PUT /van-sales/policy بصلاحية van_sales.override.approve)، وتحميل العجز على المندوب قرارٌ **لكلّ حالة**: بلا علمٍ صريح لا يُرحَّل قيد، ومع العلم تُعرض الكمية والقيمة والأساس والطرفان ومانعُ الاعتماد قبل الضغط — فالخادم يرحّل مديونية موظف (مدينٌ حسابُه في الدليل) ويرفض 422 إن نقص حسابٌ، ولا تُغلق عهدةٌ بفرق مخزونٍ غير مُسوّى. والأستاذ وتفصيل القيود في staff.',
    endpoints: [
      'POST /van-sales/load-orders/:id/submit-closing',
      'POST /van-sales/load-orders/:id/approve-closing',
      'POST /van-sales/load-orders/:id/settle-stock',
      'POST /van-sales/load-orders/:id/close-transit-difference',
      'GET /van-sales/policy',
      'PUT /van-sales/policy',
      'GET /van-sales/dashboard',
    ],
  },
  {
    key: 'treasury',
    labelAr: 'الخزينة',
    icon: '🏦',
    status: 'planned',
    phaseAr: 'المرحلة 3',
    permission: 'treasury.voucher.create',
    planAr:
      'توريد نقدية الخطّ إلى الخزينة بسندٍ رسمي؛ ولا قيدَ يُنشأ من هذه الواجهة بلا مستند، ولا يُرحَّل فرقٌ تلقائياً.',
    endpoints: ['GET /treasury/vouchers', 'POST /treasury/vouchers', 'POST /treasury/vouchers/:id/post'],
  },
  {
    key: 'reports',
    labelAr: 'تقارير الخطّ',
    icon: '📈',
    status: 'planned',
    phaseAr: 'المرحلة 3',
    permission: 'van_sales.view',
    planAr:
      'مبيعات المندوب ومرتجعه وهالكه وتحصيله — من محرّك التقارير نفسه، لا من حسابٍ موازٍ داخل هذه الواجهة.',
    endpoints: ['GET /van-sales/reports', 'GET /van-sales/dashboard'],
  },
  {
    key: 'accounting',
    labelAr: 'المحاسبة التفصيلية (في اللوحة)',
    icon: '🔗',
    status: 'planned',
    phaseAr: 'المرحلة 3',
    planAr:
      'الأستاذ والمشتريات والمخزون والرواتب تبقى في لوحة staff وتُفتح بتسليم جلسة (handoff) — لا تُستنسخ هنا ولا يُنشأ محرّك محاسبيّ ثانٍ.',
    endpoints: ['POST /auth/handoff/redeem', 'GET /me'],
  },
  {
    key: 'rep-app',
    labelAr: 'واجهة المندوب المحمولة',
    icon: '📱',
    status: 'planned',
    phaseAr: 'المرحلة 4',
    permission: 'van_sales.view',
    planAr:
      '‏/rep تطبيق PWA للهاتف: عملٌ بلا اتصال بطابورٍ ومفاتيح idempotency، ومزامنةٌ عند العودة، وربطُ الجهاز — على القشرة المشتركة نفسها (offline-db/sync-engine في @erp/web-core).',
    endpoints: [
      'POST /van-sales/documents',
      'POST /van-sales/collections',
      'POST /van-sales/load-orders/:id/submit-closing',
    ],
  },
];

export function readyModules(modules: readonly BakeryModule[] = BAKERY_MODULES): readonly BakeryModule[] {
  return modules.filter((module) => module.status === 'ready');
}

/**
 * ما يُعرض لهذا المستخدم: كلّ وحدةٍ تعلن صلاحيةً تُعرض فقط لمن يملكها (فلا تُعرض شاشةٌ
 * سيرفضها الخادم)، وما لا يعلن صلاحيةً (النظرة العامة، وخطة العمل) يُعرض للجميع.
 */
export function visibleModules(
  can: (permission?: string) => boolean,
  modules: readonly BakeryModule[] = BAKERY_MODULES,
): readonly BakeryModule[] {
  return modules.filter((module) => {
    if (module.permission) return can(module.permission);
    if (module.anyPermissions?.length) return module.anyPermissions.some((code) => can(code));
    return true;
  });
}

/** مطابقة بحدّ المقطع (`/production` و`/production/9` نعم، و`/production-x` لا). */
export function moduleForPath(
  pathname: string,
  modules: readonly BakeryModule[] = BAKERY_MODULES,
): BakeryModule | undefined {
  return modules.find((module) => {
    const href = module.href;
    if (!href) return false;
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  });
}

/**
 * فحصٌ ذاتيّ للكتالوج: كلّ صلاحيةٍ معلنة رمزٌ حقيقيّ في سجلّ العقود. ويُستعمل في السبيك
 * ويُستطيع أيّ بناءٍ أن يستدعيه — والكتالوج الذي يخترع رمزاً يعرض شاشةً لا وجود لها.
 */
export function unknownPermissionCodes(modules: readonly BakeryModule[] = BAKERY_MODULES): string[] {
  return modules
    .flatMap((module) => [module.permission ?? null, ...(module.anyPermissions ?? [])])
    .filter((permission): permission is string => typeof permission === 'string')
    .filter((permission) => !isKnownPermissionCode(permission));
}
