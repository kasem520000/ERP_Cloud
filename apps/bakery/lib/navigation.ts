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
    status: 'ready',
    href: '/reps',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'sales.salesman.manage',
    planAr:
      'المناديب كما يرجعهم الخادم: البطاقة الرسمية مع بطاقة موظفها وحساب دخولها ومستودع سيارتها ونِسَبها وعهدتها الحيّة (stock_balances مستودع السيارة وأوامر التحميل المفتوحة)، وreadiness الذي حسبه الخادم معروضًا بأثر كلّ نقص لا بأيقونة: بلا موظف ⇒ تحميل النقص على مديونيته مرفوض ٤٢٢، وبلا عضوية ⇒ لا مساحة عمل له (GET /van-sales/me تُشتقّ من عضويّته هو)، وبلا مستودع سيارة ⇒ لا عهدة تُقاس ولا نطاق يحصر دخوله، وبلا van_sales.* ⇒ يرفضه الحارس ٤٠٣. والقائمة كلّ بطاقات المنشأة (استعلام الخادم بلا LIMIT) فمجاميعُها مجاميعُ الكلّ لا تقديرَ نافذة. والكتابة الوحيدة ربطُ حساب الدخول (POST /van-sales/salesmen/:id/account بصلاحية sales.salesman.manage): يمرّ بكتّاب المنصّة (العضويات والأدوار) فلا تُخترع كلمةُ مرور (الحساب الجديد invited ويصله رابطُ التفعيل الرسميّ) ولا حسابٌ ثانٍ للشخص الواحد (العضوية القائمة تُعاد استعمالها ويُقال إنّ البريد الفعليّ قد يختلف عن المطلوب) ولا دورٌ موازٍ («مندوب توزيع» يُبحث باسمه ويُنشأ مرّة)، والنطاقُ على مستودع السيارة افتراضيُّ الخادم وإلغاؤه يُقال توسيعَ وصولٍ مقصودًا. والمسار لا يقبل مفتاحَ عدم تكرار فلا يُرسل إليه مفتاحٌ مخترع. وما ليس هنا: إنشاءُ البطاقة أو تعديلُها ونِسبُ العمولة وربطُ الموظف يدويًّا (POST/PATCH /sales/salesmen في staff)، ونطاقُ الفروع على العضوية (يُطبّقه الخادم عند الإنشاء فقط ويتجاهله عند إعادة الاستعمال)، والأدوارُ وكلماتُ المرور وربطُ الأجهزة (شاشة الأدوار ومنصّة الهويّة، والأجهزة في المرحلة ٤)، وحسابُ مبالغ العمولة (الرواتب في staff).',
    endpoints: ['GET /van-sales/salesmen', 'POST /van-sales/salesmen/:id/account'],
  },
  {
    key: 'sales',
    labelAr: 'فواتير الخطّ',
    icon: '🧾',
    status: 'ready',
    href: '/sales',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.invoice.create',
    planAr:
      'إصدار مستند بيعٍ من عهدة مندوب (POST /van-sales/documents بمفتاح عدم تكرار)، ومرتجعه (سقفُه المبيع + المجانيّ، ولا يُرجع مرتجع)، وطباعة نسختيه من /print-view بمُصيِّرٍ واحدٍ مشترك مع staff (@erp/web-van/document-print): سندٌ واحد بنسختين لا فاتورتان، والأرقام أرقامُ الخادم، ورمز ZATCA من الحمولة الصادرة على الفاتورة وحدها — فإن لم تصدر يُطبع قولٌ صريح بدل رمزٍ زائف. ونصوصُ الرفض قبل الضغط نصوصُ الخادم حرفًا، وما لا يستطيع المتصفح حسابه كحسابه (المتبقي في العهدة بعد كل المستندات المعلّقة، وسقف الائتمان) يُقال تحذيرًا لا حظرًا والحكم النهائي للخادم. ومجاميع اليوم من summary الذي حسبه الخادم، والجدول أحدث ١٢٠ مستندًا كما يحدّدها الخادم — ويُقال ذلك. والتجاوز (سعر/خصم/بونص) يحتاج van_sales.override.approve أو sales.discount.override ويفرضه الخادم 403. وما ليس هنا: الإيصال الحراريّ ٨٠مم والأستاذ وتفصيل القيود وتسعير العملاء (في staff)، وتحميل العهدة (/distribution) وإقفالها (/custody).',
    endpoints: [
      'GET /van-sales/dashboard',
      'POST /van-sales/documents',
      'POST /van-sales/documents/:id/returns',
      'GET /van-sales/documents/:id/print-view',
      'GET /parties',
      'GET /cash-locations',
    ],
  },
  {
    key: 'collection',
    labelAr: 'التحصيل',
    icon: '💵',
    status: 'ready',
    href: '/collection',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.collection.create',
    planAr:
      'قبضُ مديونية عملاء الخطّ بسند قبضٍ رسمي (POST /van-sales/collections بمفتاح عدم تكرار)، وذممُهم مرتّبةً بعمر الدين من نافذة اللوحة (أحدث ١٢٠ مستندًا) بينما ذممُ المنشأة من summary الذي حسبه الخادم — ورقمان لا يُخلطان. والمتبقي (الإجمالي − المدفوع) محسوبٌ هنا بـdecimal.js ويُتحقّق منه الخادم عند السند، وجملةُ «مبلغ التحصيل يتجاوز الرصيد المتبقي» تُبنى بأرقامه نفسها. وبعد كلّ سندٍ تقرأ الشاشة سبب حركة collection_receipt **كما كتبه الخادم** وتقول حالته من كلماته (مُرحَّل / غير مُرحَّل / بدون سند خزينة) — فتحصيلٌ بقي سندُه مسودةً لأنّ حساب ذمم العملاء لم ينحلّ ليس مالًا في الدفاتر، ويُقال ذلك بدل «تمّ التحصيل». وأداةُ مطابقة البيانات القديمة معاينةٌ (dry_run) ما لم يُطلب التنفيذ صراحةً، ومحميّةٌ بـvan_sales.override.approve على الوضعين، ولا تحذف سجلًّا: ما لا يُستكمل بأمان يُتخطّى ويُقال سببُه، والتنفيذ يُستأنف من nextResumeCursor. وما ليس هنا: سندات الخزينة الأخرى وتحويلات الصندوق وأرصدته والأستاذ وتفصيل القيود (في staff)، وإصدار الفواتير (/sales) وإقفال العهدة (/custody).',
    endpoints: [
      'GET /van-sales/dashboard',
      'POST /van-sales/collections',
      'POST /van-sales/legacy-reconciliation',
      'GET /cash-locations',
      'GET /accounts',
    ],
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
    status: 'ready',
    href: '/reports',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.view',
    planAr:
      'تقريرُ الفترة من محرّك التقارير نفسه (GET /van-sales/reports): المدى (fromDate/toDate) يُطبَّق على القوائم الأربع وعلى مجاميع periodTotals وعلى أداء المندوبين repCustodyReport معًا، بتواريخ العمل (load_date للأوامر، doc_date للمستندات، production_date للدفعات) لا بتاريخ الإنشاء — وسجلُّ تسعير العملاء وحده لا يحمل تاريخَ عملٍ في الجدول فيُصفّى بـcreated_at، ويقول الخادم ذلك في filterNotes كما يقول إنّ مرشِّح المندوب لا يُطبَّق على الإنتاج ولا على التسعير فليسا منسوبَين إلى مندوب؛ والشاشة تعرض نصَّ الخادم لا صياغةً ألطف. والفحصُ المسبق للمدى مرآةُ قاعدة الخادم (‏YYYY-MM-DD، ووجودُ التاريخ فـ2026-02-30 يُرفض، والبدايةُ لا تتأخّر عن النهاية) فيُقال قبل الإرسال، والخادم يبقى الحكم (ومندوبُ منشأةٍ أخرى ٤٠٤ «المندوب غير موجود»). وperiodTotals (تدفّقُ الفترة) في بطاقاتٍ منفصلة عن summary (أرقامُ المنشأة كلّها وأرصدةُ اللحظة: رصيدُ المستودع الرئيسي ورصيدُ سيارات التوزيع) ومعها جملةٌ صريحةٌ حين يختلفان — فالرصيدُ ليس تدفّقًا ولا يُجمع معه. ولكلّ قائمةٍ سقفٌ من الخادم (rowCap، وLIMIT السقف+١ في الاستعلام نفسه) وtruncated يُقال، وبجانبه مجموعُ الصفوف المعروضة مقابل مجموع الفترة، والعداداتُ من COUNT(*) على الجدول فلا يُنقصها السقف. والقراءةُ فقط: لا قيدَ يُنشأ ولا نقصَ يُحمَّل على أحد (تحميلُ النقص على مديونية موظف يحتاج اعتمادَ الحالة salaryDeductionApproved وحسابَ مقابلٍ مضبوطًا في مساره لا هنا) ولا تحصيلَ يُسجَّل (في /collection بسندٍ رسمي). وما ليس هنا: الأستاذُ وتفصيلُ القيود والتقاريرُ المحاسبية الرسمية وحسابُ مبالغ العمولة (في apps/staff وتُفتح بتسليم جلسة)، وإصدارُ المستندات ومرتجعاتُها (/sales)، وتحميلُ العهدة (/distribution) وإقفالُها (/custody)، وقائمةُ المناديب للمرشِّح تُقرأ من GET /van-sales/salesmen ولا تُخترع في المتصفح.',
    endpoints: ['GET /van-sales/reports', 'GET /van-sales/salesmen'],
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
    labelAr: 'تطبيق المندوب',
    icon: '📱',
    status: 'ready',
    href: '/rep',
    phaseAr: 'المرحلة 4 — مبنيّة',
    permission: 'van_sales.view',
    /**
     * ما بُني وما بقي — بلا ادّعاءِ ما لم يُنفَّذ: فالشاشةُ تعمل متّصلةً ومنقطعةً بطابورٍ
     * في `vanQueue` (مخزنٌ في قاعدة `erpcloud-pos-offline` نفسها وبهويّة جهازٍ واحدة)،
     * ومفاتيحُ عدم التكرار تُخزَّن مع النيّات فتُعاد بلا مستندٍ مكرَّر. وأمّا **الإقفالُ
     * وتأكيدُ الاستلام فلا يُحفظان منقطعَين** (مساراهما بلا مفتاحٍ في الجسم — مقاس)
     * فيُحظران بسببٍ معروض. والمتبقّي من المرحلة: ‏`manifest` و`service worker` (تثبيتُ
     * التطبيق على الهاتف والعملُ بلا شبكةٍ من أوّل فتح) — والشريحةُ ١٤ج.
     */
    planAr:
      '‏/rep للمندوب على هاتفه: مساحةُ عمله من GET /van-sales/me بأرقام جدولِه كلّه ونوافذِ قوائمه معلَنة، وبيعٌ ومرتجعٌ وتحصيلٌ تُحفظ منقطعةً في طابورٍ بمفاتيح عدم تكرارٍ وتُعاد نيّةً نيّةً إلى مسارها الرسميّ، وإغلاقُ الوردية وتأكيدُ الاستلام متصلَين فقط (فلا مفتاحَ في جسميهما وإعادةٌ عمياء تعيد كتابةَ إعلان الجرد). والمتبقّي: ‏manifest وservice worker.',
    endpoints: [
      'GET /van-sales/me',
      'POST /van-sales/documents',
      'POST /van-sales/documents/:id/returns',
      'POST /van-sales/collections',
      'POST /van-sales/load-orders/:id/submit-closing',
      'POST /van-sales/load-orders/:id/confirm-receipt',
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
