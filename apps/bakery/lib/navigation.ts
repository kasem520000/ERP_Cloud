import { hasVanSalesCompanyScope, isKnownPermissionCode } from '@erp/contracts';

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
  /**
   * سطرٌ **للعميل** لا للمهندس: ما تفعله الوحدة بلغة العمل، بلا مسارات API ولا أسماء ملفاتٍ
   * ولا أرقام شرائح ولا مصطلحاتٍ داخلية. وتثبّت `tests/navigation.spec.ts` أنّها كذلك
   * (فالواجهةُ كانت تعرض `planAr` كاملًا — وفيه «خطأُ الشريحة ١٣أ» و`decimal.js` و`tests/…`
   * وأسماءُ ملفات — وهذا ما شكا منه صاحبُ العمل: «بياناتٌ تظهر في الشاشات لا تصلح للإنتاج»).
   */
  readonly summaryAr: string;
  /** السجلُّ الهندسيّ: لماذا صُمّمت الوحدةُ هكذا، وما لا تفعله، وأدلّةُ القياس. يُعرض مطويًّا. */
  readonly planAr: string;
  readonly permission?: string;
  /**
   * شاشةٌ لدورين: تُعرض لمن يملك **أيّاً** من هذه الرموز. فإقفال العهدة يقدمه المندوب
   * (`van_sales.closing.submit`) ويعتمده المحاسب (`van_sales.closing.approve`) — وإعلان رمزٍ
   * واحد يحجب الشاشة عن أحدهما وهو يملك إجراءها فعلاً في الخادم.
   */
  readonly anyPermissions?: readonly string[];
  /**
   * شاشةٌ تقرأ الخطَّ على مستوى المنشأة — أي تنادي `GET /van-sales/dashboard` أو
   * `GET /van-sales/reports` أو `GET /van-sales/salesmen`. وهذه تُرفض ٤٠٣
   * (‏`VAN_SALES_COMPANY_SCOPE_REQUIRED`) على **مندوبٍ محصور**: من له بطاقةُ `salesmen`
   * مربوطةٌ بعضويته وليس معه إذنُ إدارةِ الخطّ (قِيس على خادمٍ قائم: المندوبُ ٤٠٣ في
   * الثلاثة، والمالكُ ومديرُ الخطّ ٢٠٠). والعلمُ هنا كي لا تُعرض للمندوب ثمانيةُ روابطَ
   * تُرفض — والحجبُ راحةٌ لا ضابط، فالضابطُ الخادم.
   */
  readonly companyScope?: boolean;
  readonly endpoints: readonly string[];
};

export const BAKERY_MODULES: readonly BakeryModule[] = [
  {
    key: 'overview',
    labelAr: 'نظرة اليوم',
 icon: '',
    status: 'ready',
    href: '/',
    phaseAr: 'المرحلة 2 — مبنيّة',
    summaryAr:
      'حالةُ الترخيص وهويةُ المنشأة وخريطةُ الوحدات، مع أرقام الخطّ كما يرجعها الخادم: ما يعمل الآن وما لم يُبنَ بعد.',
    planAr:
      'حالة الترخيص، والهوية، وخريطة الوحدات: ما يعمل الآن وما لم يُبنَ بعد. لا أرقام مُختلَقة ولا بلاطات فارغة تدّعي بيانات.',
    endpoints: ['GET /me'],
  },
  {
    key: 'production',
    labelAr: 'الإنتاج',
 icon: '',
    status: 'ready',
    href: '/production',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.production.manage',
    summaryAr:
      'تسجيلُ دفعة الإنتاج اليومية بمكوّناتها المصروفة وفاقدها بسببه، وجدولُ الدفعات كما يرجع من الخادم بلا تلخيصٍ محليّ.',
    planAr:
      'دفعة إنتاج بمكوّناتها: تقديرٌ إرشادي من المتوسط الرسمي قبل الاعتماد، ورفضٌ سابق للإرسال بالنصّ الذي سيقوله الخادم، وجدولُ الدفعات كما يعيده الخادم (بلا تلخيصٍ محلي). وبلا مكوّنات يرفض الخادم 422 (VAN_PRODUCTION_INPUT_REQUIRED)، والفاقد بلا سبب مرفوض، ولا تُرسل الشاشة unitCost.',
    companyScope: true,
    endpoints: ['POST /van-sales/production-batches', 'GET /van-sales/dashboard', 'GET /organization/catalog/items', 'GET /warehouses'],
  },
  {
    key: 'distribution',
    labelAr: 'التوزيع والأحمال',
 icon: '',
    status: 'ready',
    href: '/distribution',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.load.manage',
    summaryAr:
      'أمرُ تحميلٍ لصنفٍ من المستودع إلى عهدة المندوب بمناقلةٍ رسمية، ثمّ تأكيدُ الاستلام أو رفضُه، وإلغاءُ الأمر قبل انطلاقه.',
    planAr:
      'أمر تحميلٍ لصنفٍ واحد من مستودع المصدر إلى عهدة المندوب (بمناقلة رسمية)، وتأكيد الاستلام أو رفضه، وإلغاء الأمر في draft/pending_receipt. ورفضٌ سابق للإرسال بالنصّ الذي سيقوله الخادم (المندوب ثمّ الكمية ثمّ مصدر الصنف)، وجدولُ الأحمال كما يعيده الخادم، والحالة غير المعروفة تُعرض خاماً. وإقفال العهدة واعتماده وتسوية فرق المخزون وإغلاق فرق العبور **ليست هنا** — وحدة «إقفال العهدة» (/custody) تبنيها، والأستاذ وتفصيل القيود في staff.',
    companyScope: true,
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
 icon: '\u200d',
    status: 'ready',
    href: '/reps',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'sales.salesman.manage',
    summaryAr:
      'بطاقاتُ المناديب بعهدة كلّ منهم الحيّة وجاهزيته (موظفٌ وحسابُ دخول ومستودعُ سيارة)، وربطُ حساب الدخول لبطاقةٍ بلا حساب.',
    planAr:
      'المناديب كما يرجعهم الخادم: البطاقة الرسمية مع بطاقة موظفها وحساب دخولها ومستودع سيارتها ونِسَبها وعهدتها الحيّة وأوامر التحميل المفتوحة، وحالة الجاهزية التي حسبها الخادم معروضةً بأثر كلّ نقص: بلا موظف تحميل النقص على مديونيته مرفوض، وبلا عضوية لا مساحة عمل له، وبلا مستودع سيارة لا عهدة تُقاس ولا نطاق يحصر دخوله، وبلا صلاحيات التوزيع يُرفض الوصول. والقائمة تشمل كلّ بطاقات المنشأة فمجاميعُها مجاميعُ الكلّ. والكتابة الوحيدة هنا ربطُ حساب الدخول بصلاحية «إدارة المناديب وربط حسابات الدخول» عبر مسار العضويات والأدوار الرسمي.',
    companyScope: true,
    endpoints: ['GET /van-sales/salesmen', 'POST /van-sales/salesmen/:id/account'],
  },
  {
    key: 'sales',
    labelAr: 'فواتير الخطّ',
 icon: '',
    status: 'ready',
    href: '/sales',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.invoice.create',
    summaryAr:
      'إصدارُ مستند بيعٍ من عهدة المندوب نقدًا أو آجلًا، ومرتجعُه بحدِّ ما بِيع، وطباعةُ مستندٍ واحد بنسختين.',
    planAr:
      'إصدار مستند بيعٍ من عهدة مندوب بمفتاح عدم تكرار، ومرتجعه بسقف المبيع والمجانيّ، وطباعة نسختيه بمُصيِّرٍ واحدٍ مشترك: سندٌ واحد بنسختين لا فاتورتان، والأرقام أرقامُ الخادم، ورمز الفاتورة الضريبية من الحمولة الصادرة على الفاتورة وحدها. والتجاوز (سعر أو خصم أو بونص) يحتاج صلاحية «اعتماد التجاوزات وسياسة التوزيع» أو «تجاوز سقف الخصم المعتمد» ويفرضه الخادم.',
    companyScope: true,
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
 icon: '',
    status: 'ready',
    href: '/collection',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.collection.create',
    summaryAr:
      'قبضُ مديونية عملاء الخطّ بسند قبضٍ رسمي، وذممُهم مرتّبةً بعمر الدين، وحالةُ كلّ سندٍ كما يقولها الخادم.',
    planAr:
      'قبضُ مديونية عملاء الخطّ بسند قبضٍ رسمي بمفتاح عدم تكرار، وذممُهم مرتّبةً بعمر الدين من نافذة اللوحة بينما ذممُ المنشأة من الملخص الذي حسبه الخادم. وبعد كلّ سندٍ تقرأ الشاشة حالة الترحيل كما كتبها الخادم (مُرحَّل / غير مُرحَّل / بدون سند خزينة). وأداةُ مطابقة البيانات القديمة تعمل بوضع المعاينة ما لم يُطلب التنفيذ صراحةً، وهي محميّةٌ بصلاحية «اعتماد التجاوزات وسياسة التوزيع».',
    companyScope: true,
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
 icon: '',
    status: 'ready',
    href: '/custody',
    phaseAr: 'المرحلة 3 — مبنيّة',
    anyPermissions: ['van_sales.closing.submit', 'van_sales.closing.approve'],
    summaryAr:
      'إقفالُ حمولة المندوب بجردٍ فعليّ وفصلٍ رباعيّ (مرتجعٌ سليم وتالف وعجز ومتبقٍّ)، ثمّ اعتمادُ الإقفال وتسويتُه رسميًا.',
    planAr:
      'إقفال الحمولة: جردٌ فعليّ، فصلٌ رباعيّ لا يُدمج (مرتجع سليم/تالف/عجز/متبقٍ)، قرارُ فرق العبور، ثمّ التسوية الرسمية بمستند الجرد. وسياسة تقييم العجز تُقرأ وتُكتب هنا بصلاحية «اعتماد التجاوزات وسياسة التوزيع»، وتحميل العجز على المندوب قرارٌ صريح لكلّ حالة.',
    companyScope: true,
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
 icon: '',
    status: 'ready',
    href: '/treasury',
    phaseAr: 'المرحلة 3 — مبنيّة',
    /**
     * الرمزُ المعلن كان `treasury.voucher.create` — أي أنّ الشاشةَ كانت ستُحجب عمّن يقرأ
     * الخزينة ولا يُنشئ سندًا، وهو عكسُ ما تفعله الشاشة (قراءةٌ فقط). والصحيحُ أنّها تُعرض
     * لمن يملك **أيًّا** من رمزَي القراءة: فالسنداتُ تحتاج `treasury.view` ومواضعُ النقد
     * تحتاج `organization.cashlocation.view`، والشاشةُ تعرض ما وصلها وتقول ما نقص
     * (‏`Promise.allSettled`) بدل أن تسقط كلُّها لرمزٍ واحد.
     */
    anyPermissions: ['treasury.view', 'organization.cashlocation.view'],
    summaryAr:
      'ما دخل الخزينةَ من نقد الخطّ: سنداتُ القبض التي أنشأها مسارُ التحصيل وحالتها (مُرحّلة أم مسودة)، ومواضعُ النقد وأرصدتُها.',
    planAr:
      'قراءةُ ما كتبه مسارُ الخطّ في الخزينة، بلا مدخلِ مالٍ ثانٍ: سنداتُ القبض التي يُنشئها ويُرحِّلها مسار التحصيل، ومواضعُ النقد وأرصدةُ كلٍّ منها. والمسودةُ منها تُعدّ فجوةً وتُعرض صراحةً لأنّ المال لا يدخل الصندوق ولا الأستاذ إلا بعد الترحيل. وما يحتاج حكماً محاسبياً تفصيلياً يُفتح في لوحة الإدارة بتسليم الجلسة.',
    endpoints: ['GET /vouchers', 'GET /cash-locations', 'GET /cash-locations/:id/balances', 'POST /auth/handoff'],
  },
  {
    key: 'reports',
    labelAr: 'تقارير الخطّ',
 icon: '',
    status: 'ready',
    href: '/reports',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.view',
    summaryAr:
      'تقريرُ الفترة: الإنتاجُ والتحميلُ والمبيعاتُ والمرتجعاتُ وتسعيرُ العملاء وأداءُ المناديب، بمجاميعَ من الخادم ونوافذَ معلَنة.',
    planAr:
      'تقريرُ الفترة من محرّك التقارير نفسه (GET /van-sales/reports): المدى (fromDate/toDate) يُطبَّق على القوائم الأربع وعلى مجاميع periodTotals وعلى أداء المندوبين repCustodyReport معًا، بتواريخ العمل (load_date للأوامر، doc_date للمستندات، production_date للدفعات) لا بتاريخ الإنشاء — وسجلُّ تسعير العملاء وحده لا يحمل تاريخَ عملٍ في الجدول فيُصفّى بـcreated_at، ويقول الخادم ذلك في filterNotes كما يقول إنّ مرشِّح المندوب لا يُطبَّق على الإنتاج ولا على التسعير فليسا منسوبَين إلى مندوب؛ والشاشة تعرض نصَّ الخادم لا صياغةً ألطف. والفحصُ المسبق للمدى مرآةُ قاعدة الخادم (‏YYYY-MM-DD، ووجودُ التاريخ فـ2026-02-30 يُرفض، والبدايةُ لا تتأخّر عن النهاية) فيُقال قبل الإرسال، والخادم يبقى الحكم (ومندوبُ منشأةٍ أخرى ٤٠٤ «المندوب غير موجود»). وperiodTotals (تدفّقُ الفترة) في بطاقاتٍ منفصلة عن summary (أرقامُ المنشأة كلّها وأرصدةُ اللحظة: رصيدُ المستودع الرئيسي ورصيدُ سيارات التوزيع) ومعها جملةٌ صريحةٌ حين يختلفان — فالرصيدُ ليس تدفّقًا ولا يُجمع معه. ولكلّ قائمةٍ سقفٌ من الخادم (rowCap، وLIMIT السقف+١ في الاستعلام نفسه) وtruncated يُقال، وبجانبه مجموعُ الصفوف المعروضة مقابل مجموع الفترة، والعداداتُ من COUNT(*) على الجدول فلا يُنقصها السقف. والقراءةُ فقط: لا قيدَ يُنشأ ولا نقصَ يُحمَّل على أحد (تحميلُ النقص على مديونية موظف يحتاج اعتمادَ الحالة salaryDeductionApproved وحسابَ مقابلٍ مضبوطًا في مساره لا هنا) ولا تحصيلَ يُسجَّل (في /collection بسندٍ رسمي). وما ليس هنا: الأستاذُ وتفصيلُ القيود والتقاريرُ المحاسبية الرسمية وحسابُ مبالغ العمولة (في apps/staff وتُفتح بتسليم جلسة)، وإصدارُ المستندات ومرتجعاتُها (/sales)، وتحميلُ العهدة (/distribution) وإقفالُها (/custody)، وقائمةُ المناديب للمرشِّح تُقرأ من GET /van-sales/salesmen ولا تُخترع في المتصفح.',
    companyScope: true,
    endpoints: ['GET /van-sales/reports', 'GET /van-sales/salesmen'],
  },
  {
    key: 'accounting',
    labelAr: 'المحاسبة التفصيلية (في اللوحة)',
 icon: '',
    status: 'ready',
    href: '/accounting',
    phaseAr: 'المرحلة 3 — مبنيّة',
    /**
     * بلا `permission` مفردة: فالشاشةُ لا تنادي نقطةً محاسبيةً أصلًا (‏POST /auth/handoff
     * متاحٌ لأيّ عضوٍ نشط) — وإنّما تُعرض لمن يملك قراءةً محاسبيةً واحدةً على الأقلّ، لأنّ
     * الوجهاتِ في اللوحة تفرض أذوناتها. ومَن لا يملك شيئًا منها لا يُحجب عنه الرابطُ بصدقٍ
     * زائف: بل تُقول له الشاشةُ صراحةً إنّه سيرى هناك ما تملكه جلستُه فقط.
     */
    anyPermissions: ['accounting.reports.view', 'accounting.account.view', 'accounting.period.view'],
    summaryAr:
      'الأستاذُ والقيودُ وميزانُ المراجعة وقائمةُ الدخل والخزينة في اللوحة الإدارية، وتُفتح من هنا بجلسةٍ آمنةٍ باسمك وصلاحياتك.',
    planAr:
      'رابطٌ يعمل لا شاشةٌ تُقلّد الأستاذ: أحدَ عشرَ مسارًا حقيقيًّا في apps/staff/app/accounting (الأستاذ، القيود، ميزانُ المراجعة، قائمةُ الدخل، شجرةُ الحسابات، الفتراتُ المالية، مراكزُ التكلفة وكشفُها، المصروفات، مواضعُ النقد، طرقُ الدفع) وستّةٌ في treasury (السندات، حركةُ الصندوق، التحويلات، إغلاقاتُ اليومية، الصناديق، الشيكات) — ولكلٍّ page.tsx موجودٌ ويُقاس في tests/staff-handoff.spec.ts فلا رابطَ ميت. والآليّةُ من web-core نفسها (‏AUD-08) لا اختراعٌ هنا: POST /auth/handoff يصنع عند **النقر** رمزًا لمرةٍ واحدة عمره نحو ٦٠ ثانية لا يحمل صلاحيةً بنفسه، والعنوانُ يحمل ?handoff=<code> وحده (فلا token ولا refresh في عنوانٍ يُسجَّل في سجلّات الوسيط وReferer)، ولوحةُ staff تستبدله بجلسةٍ عبر POST /auth/handoff/redeem ثم تُنظّف العنوان، والفشلُ مغلقٌ على شاشة دخولها بوسمِ handoff=failed. وتدخل بجلستك أنت وصلاحياتك هي — فالضابطُ الخادمُ في الطرفَين وهذه الواجهةُ لا تمنح ولا ترفع. وبلا NEXT_PUBLIC_STAFF_URL مُهيَّأ (‏http(s) مطلق) لا يُصنع رمزٌ ولا يُعرض رابط: فيُقال أيُّ متغيّرٍ ينقص. ولا أستاذَ ولا قيدَ ولا ميزانَ ولا محرّكَ محاسبةٍ ثانٍ في واجهة المخابز، وأرقامُ الخطّ نفسها في /reports و/treasury.',
    endpoints: ['POST /auth/handoff', 'GET /me'],
  },
  {
    key: 'rep-app',
    labelAr: 'تطبيق المندوب',
 icon: '',
    status: 'ready',
    href: '/rep',
    phaseAr: 'المرحلة 4 — مبنيّة',
    permission: 'van_sales.view',
    /**
     * ما بُني وما بقي — بلا ادّعاءِ ما لم يُنفَّذ: فالشاشةُ تعمل متّصلةً ومنقطعةً بطابورٍ
     * في `vanQueue` (مخزنٌ في قاعدة `erpcloud-pos-offline` نفسها وبهويّة جهازٍ واحدة)،
     * ومفاتيحُ عدم التكرار تُخزَّن مع النيّات فتُعاد بلا مستندٍ مكرَّر. وأمّا **الإقفالُ
     * وتأكيدُ الاستلام فلا يُحفظان منقطعَين** (مساراهما بلا مفتاحٍ في الجسم — مقاس)
     * فيُحظران بسببٍ معروض. و‏PWA اكتملت في ١٤ج: ‏`public/manifest.webmanifest` و`sw.js`
     * وأيقونةٌ و`components/service-worker-register.tsx` — فلا «متبقٍّ» يُدّعى هنا.
     */
    summaryAr:
      'مساحةُ المندوب على هاتفه: عهدتُه ومبيعاتُه وتحصيلُه وإقفالُ ورديته، وتحفظُ أعمالَه عند انقطاع الاتصال وتُعيدها نيّةً نيّة.',
    planAr:
      '‏/rep للمندوب على هاتفه: مساحةُ عمله من GET /van-sales/me بأرقام جدولِه كلّه ونوافذِ قوائمه معلَنة، وبيعٌ ومرتجعٌ وتحصيلٌ تُحفظ منقطعةً في طابورٍ بمفاتيح عدم تكرارٍ وتُعاد نيّةً نيّةً إلى مسارها الرسميّ، وإغلاقُ الوردية وتأكيدُ الاستلام متصلَين فقط (فلا مفتاحَ في جسميهما وإعادةٌ عمياء تعيد كتابةَ إعلان الجرد). و‏PWA كاملةٌ منذ ١٤ج: ‏manifest.webmanifest وsw.js وأيقونةٌ وتسجيلُ العامل (والقشرةُ تُخزَّن والمالُ لا يُخزَّن).',
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
/**
 * هل هذا المتّصلُ مندوبًا محصورًا؟ — بطاقةُ مندوبٍ **بلا** إذنِ إدارةِ الخطّ.
 *
 * والطرفان من الخادم لا من التخمين: فـ`isRep` من `GET /van-sales/me` (الذي يقرأ السلسلة
 * `memberships → employees → salesmen`) والأذوناتُ من `GET /me`. ولا يُكتفى بالأذونات
 * وحدها لأنّ مستخدمًا بلا بطاقة (كاتبُ مكتبٍ يملك `van_sales.view` وحدها) **لا يُحجب**
 * في الخادم، فحجبُه هنا سيكون كذبًا في الجهة الأخرى: شاشةٌ تعمل ولا تُعرض.
 */
export function isRepScoped(isRep: boolean, granted: readonly string[]): boolean {
  return isRep && !hasVanSalesCompanyScope(granted);
}

export function visibleModules(
  can: (permission?: string) => boolean,
  modules: readonly BakeryModule[] = BAKERY_MODULES,
  options: { repScoped?: boolean } = {},
): readonly BakeryModule[] {
  return modules.filter((module) => {
    if (options.repScoped && module.companyScope) return false;
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
