import { hasVanSalesCompanyScope, isKnownPermissionCode } from '@erp/contracts';

/**
 * خريطة وحدات ومجموعات واجهة المخابز الشاملة — متطابقة بنيويًّا ووظيفيًّا مع تطبيق
 * المخابز على أندرويد (١٣ مجموعةً جانبية و٤١ شاشةً عاملة على نفس محرّك API الرسمي).
 */
export type ModuleStatus = 'ready' | 'planned';

export type BakeryGroupKey =
  | 'home'
  | 'sales-group'
  | 'purchases-group'
  | 'inventory-group'
  | 'distribution-group'
  | 'production-group'
  | 'accounting-group'
  | 'catalog-group'
  | 'parties-group'
  | 'hrm-group'
  | 'ai-tax-group'
  | 'reports-group'
  | 'admin-group';

export type BakeryGroup = {
  readonly key: BakeryGroupKey;
  readonly labelAr: string;
};

export const BAKERY_GROUPS: readonly BakeryGroup[] = [
  { key: 'home', labelAr: 'الرئيسيّة' },
  { key: 'sales-group', labelAr: 'المبيعات' },
  { key: 'purchases-group', labelAr: 'المشتريات' },
  { key: 'inventory-group', labelAr: 'المستودعات' },
  { key: 'distribution-group', labelAr: 'التوزيع والمندوبين' },
  { key: 'production-group', labelAr: 'الإنتاج' },
  { key: 'accounting-group', labelAr: 'المحاسبة والمصروفات' },
  { key: 'catalog-group', labelAr: 'الكتالوج' },
  { key: 'parties-group', labelAr: 'الأطراف' },
  { key: 'hrm-group', labelAr: 'الموظفون' },
  { key: 'ai-tax-group', labelAr: 'الذكاء الاصطناعي والضرائب' },
  { key: 'reports-group', labelAr: 'التقارير' },
  { key: 'admin-group', labelAr: 'الإدارة والإعدادات' },
];

export type BakeryModule = {
  readonly key: string;
  readonly groupKey: BakeryGroupKey;
  readonly labelAr: string;
  readonly icon: string;
  readonly status: ModuleStatus;
  readonly href?: string;
  readonly phaseAr: string;
  readonly summaryAr: string;
  readonly planAr: string;
  readonly permission?: string;
  readonly anyPermissions?: readonly string[];
  readonly companyScope?: boolean;
  readonly endpoints: readonly string[];
};

export const BAKERY_MODULES: readonly BakeryModule[] = [
  // 1. الرئيسيّة
  {
    key: 'overview',
    groupKey: 'home',
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

  // 2. المبيعات
  {
    key: 'pos',
    groupKey: 'sales-group',
    labelAr: 'نقاط البيع',
    icon: '',
    status: 'ready',
    href: '/pos',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'pos.view',
    summaryAr:
      'شاشةُ كاشير سريعة للمخبز والمعرض: اختيارُ الأصناف وطرق الدفع وفتحُ الوردية وطباعةُ إيصال الكاشير الحراري فورًا.',
    planAr:
      'نقطة البيع المباشرة فوق حزمة بيانات نقطة البيع وإتمام البيع وفتح الوردية وطباعة إيصال الكاشير الرسمي 80 مم.',
    endpoints: [
      'GET /pos/offline-data',
      'POST /pos/checkout',
      'POST /shift-closes/open',
      'GET /reports/print/invoices/:id',
    ],
  },
  {
    key: 'sales-invoices',
    groupKey: 'sales-group',
    labelAr: 'فواتير المبيعات',
    icon: '',
    status: 'ready',
    href: '/sales-invoices',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'sales.view',
    summaryAr:
      'إنشاءُ فواتير المبيعات الضريبية وترحيلُها نقدًا أو آجلًا وتسجيلُ مرتجعاتها وطباعتُها بالقالب الرسمي المعتمد.',
    planAr:
      'إدارة فواتير المبيعات الكاملة مع نسبة الخصم ومركز التكلفة والترحيل والمرتجعات والإبطال والطباعة الحرارية أو الورقية.',
    endpoints: [
      'GET /sales/invoices',
      'POST /sales/invoices',
      'POST /sales/invoices/:id/post',
      'POST /sales/invoices/:id/return',
      'POST /sales/invoices/:id/void',
      'GET /reports/print/invoices/:id',
    ],
  },
  {
    key: 'prices',
    groupKey: 'sales-group',
    labelAr: 'تسعير العملاء',
    icon: '',
    status: 'ready',
    href: '/prices',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.pricing.manage',
    companyScope: true,
    summaryAr:
      'تحديدُ أسعار البيع الخاصّة لكلّ عميلٍ وصنف مع سقف الخصم والكميات المجانية وتثبيتِ السعر لمنع التجاوز غير المعتمد.',
    planAr:
      'إدارة تسعير عملاء الخطّ وسقوف الخصم والكميات المجانية عبر مسار تسعير العملاء وقراءة السجل الحي من لوحة الخط.',
    endpoints: [
      'GET /van-sales/dashboard',
      'POST /van-sales/customer-prices',
      'GET /parties',
      'GET /organization/catalog/items',
    ],
  },
  {
    key: 'sales-registry',
    groupKey: 'sales-group',
    labelAr: 'سجل المبيعات والمناديب',
    icon: '',
    status: 'ready',
    href: '/sales-registry',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'sales.view',
    summaryAr:
      'سجلُّ المبيعات الموحَّد وبطاقاتُ مناديب المبيعات ونِسَب عمولاتهم مع البحث الفوري والفرز والطباعة الرسمية.',
    planAr:
      'عرض سجل فواتير المبيعات وبطاقات مناديب المبيعات مع تعديل نسب العمولة وربط المستودعات والطباعة الرسمية.',
    endpoints: [
      'GET /sales/invoices',
      'GET /sales/salesmen',
      'POST /sales/salesmen',
      'PATCH /sales/salesmen/:id',
    ],
  },

  // 3. المشتريات
  {
    key: 'purchases',
    groupKey: 'purchases-group',
    labelAr: 'المشتريات',
    icon: '',
    status: 'ready',
    href: '/purchases',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'purchase.view',
    summaryAr:
      'فواتيرُ مشتريات الدقيق والموادّ الخام بطريقة الصافي للخصم مع الترحيل للمخزون والأستاذ ومرتجعات المشتريات والطباعة.',
    planAr:
      'إدارة فواتير المشتريات ومرتجعاتها بطريقة الصافي المعتمدة محاسبياً مع الترحيل والإبطال والطباعة الرسمية.',
    endpoints: [
      'GET /purchase-invoices',
      'POST /purchase-invoices',
      'POST /purchase-invoices/:id/post',
      'POST /purchase-invoices/:id/void',
      'GET /reports/print/purchase-invoices/:id',
    ],
  },

  // 4. المستودعات
  {
    key: 'inventory',
    groupKey: 'inventory-group',
    labelAr: 'أرصدة وحركة المخزون',
    icon: '',
    status: 'ready',
    href: '/inventory',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'inventory.view',
    summaryAr:
      'أرصدةُ الأصناف في المستودع الرئيسي ومستودعات السيارات وحركةُ الوارد والمنصرف وبطاقةُ الصنف التفصيلية بالتاريخ.',
    planAr:
      'قراءة أرصدة المخزون وحركة الأصناف وبطاقة الصنف التفصيلية مصفّاةً بالمستودع والصنف والفترة الزمنية.',
    endpoints: [
      'GET /inventory/levels',
      'GET /inventory/movements',
      'GET /inventory/item-card',
      'GET /warehouses',
    ],
  },
  {
    key: 'inventory-vouchers',
    groupKey: 'inventory-group',
    labelAr: 'سندات المخزون',
    icon: '',
    status: 'ready',
    href: '/inventory-vouchers',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'inventory.view',
    summaryAr:
      'سنداتُ بضاعة أول المدة والإدخال والإخراج المخزني مع اعتماد الترحيل المحاسبي المتوازن أو إبطال السند بسببٍ موثَّق.',
    planAr:
      'إنشاء وترحيل وإبطال السندات المخزنية (أول المدة، إدخال، إخراج) مع التوازن المحاسبي التلقائي لرصيد أول المدة.',
    endpoints: [
      'GET /inventory/vouchers',
      'POST /inventory/vouchers',
      'POST /inventory/vouchers/:id/post',
      'POST /inventory/vouchers/:id/void',
    ],
  },
  {
    key: 'counts',
    groupKey: 'inventory-group',
    labelAr: 'الجرد والتسويات',
    icon: '',
    status: 'ready',
    href: '/counts',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'inventory.view',
    summaryAr:
      'محاضرُ الجرد الفعلي وتسوياتُ فروقات المخزون بالزيادة أو العجز مع ترحيل القيد المالي وحفظِ سبب التسوية.',
    planAr:
      'تسجيل مسودات تسويات الجرد المخزني ومقارنة الرصيد الدفتري بالفعلي وترحيل التسوية إلى دفتر المخزون والأستاذ.',
    endpoints: [
      'GET /inventory/adjustments',
      'POST /inventory/adjustments',
      'POST /inventory/adjustments/:id/post',
      'GET /inventory/levels',
    ],
  },

  // 5. التوزيع والمندوبين
  {
    key: 'distribution',
    groupKey: 'distribution-group',
    labelAr: 'التوزيع والأحمال',
    icon: '',
    status: 'ready',
    href: '/distribution',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.load.manage',
    summaryAr:
      'أمرُ تحميلٍ لصنفٍ من المستودع إلى عهدة المندوب بمناقلةٍ رسمية، ثمّ تأكيدُ الاستلام أو رفضُه، وإلغاءُ الأمر قبل انطلاقه.',
    planAr:
      'أمر تحميلٍ لصنفٍ واحد من مستودع المصدر إلى عهدة المندوب (بمناقلة رسمية)، وتأكيد الاستلام أو رفضه، وإلغاء الأمر في draft/pending_receipt.',
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
    groupKey: 'distribution-group',
    labelAr: 'المناديب',
    icon: '\u200d',
    status: 'ready',
    href: '/reps',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'sales.salesman.manage',
    summaryAr:
      'بطاقاتُ المناديب بعهدة كلّ منهم الحيّة وجاهزيته (موظفٌ وحسابُ دخول ومستودعُ سيارة)، وربطُ حساب الدخول لبطاقةٍ بلا حساب.',
    planAr:
      'المناديب كما يرجعهم الخادم: البطاقة الرسمية مع بطاقة موظفها وحساب دخولها ومستودع سيارتها ونِسَبها وعهدتها الحيّة وأوامر التحميل المفتوحة.',
    companyScope: true,
    endpoints: ['GET /van-sales/salesmen', 'POST /van-sales/salesmen/:id/account'],
  },
  {
    key: 'sales',
    groupKey: 'distribution-group',
    labelAr: 'فواتير الخطّ',
    icon: '',
    status: 'ready',
    href: '/sales',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.invoice.create',
    summaryAr:
      'إصدارُ مستند بيعٍ من عهدة المندوب نقدًا أو آجلًا، ومرتجعُه بحدِّ ما بِيع، وطباعةُ مستندٍ واحد بنسختين.',
    planAr:
      'إصدار مستند بيعٍ من عهدة مندوب بمفتاح عدم تكرار، ومرتجعه بسقف المبيع والمجانيّ، وطباعة نسختيه بمُصيِّرٍ واحدٍ مشترك.',
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
    key: 'custody',
    groupKey: 'distribution-group',
    labelAr: 'إقفال العهدة',
    icon: '',
    status: 'ready',
    href: '/custody',
    phaseAr: 'المرحلة 3 — مبنيّة',
    anyPermissions: ['van_sales.closing.submit', 'van_sales.closing.approve'],
    summaryAr:
      'إقفالُ حمولة المندوب بجردٍ فعليّ وفصلٍ رباعيّ (مرتجعٌ سليم وتالف وعجز ومتبقٍّ)، ثمّ اعتمادُ الإقفال وتسويتُه رسميًا.',
    planAr:
      'إقفال الحمولة: جردٌ فعليّ، فصلٌ رباعيّ لا يُدمج (مرتجع سليم/تالف/عجز/متبقٍ)، قرارُ فرق العبور، ثمّ التسوية الرسمية بمستند الجرد.',
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
    key: 'collection',
    groupKey: 'distribution-group',
    labelAr: 'التحصيل',
    icon: '',
    status: 'ready',
    href: '/collection',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.collection.create',
    summaryAr:
      'قبضُ مديونية عملاء الخطّ بسند قبضٍ رسمي، وذممُهم مرتّبةً بعمر الدين، وحالةُ كلّ سندٍ كما يقولها الخادم.',
    planAr:
      'قبضُ مديونية عملاء الخطّ بسند قبضٍ رسمي بمفتاح عدم تكرار، وذممُهم مرتّبةً بعمر الدين من نافذة اللوحة بينما ذممُ المنشأة من الملخص الذي حسبه الخادم.',
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
    key: 'policy',
    groupKey: 'distribution-group',
    labelAr: 'سياسة العجز والتقييم',
    icon: '',
    status: 'ready',
    href: '/policy',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.view',
    companyScope: true,
    summaryAr:
      'ضبطُ طريقة تقييم عجز المناديب (سعر البيع أو التكلفة) وفحصُ جاهزية الحسابات المحاسبية لتحميل العجز على ذمّة المندوب.',
    planAr:
      'قراءة وتحديث سياسة تقييم العجز وفحص جاهزية حساب الموظف وحساب المقابل لكلّ مندوب توزيع قبل اعتماد التسويات.',
    endpoints: ['GET /van-sales/policy', 'PUT /van-sales/policy', 'GET /van-sales/salesmen'],
  },
  {
    key: 'reports',
    groupKey: 'distribution-group',
    labelAr: 'تقارير الخطّ',
    icon: '',
    status: 'ready',
    href: '/reports',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.view',
    summaryAr:
      'تقريرُ الفترة: الإنتاجُ والتحميلُ والمبيعاتُ والمرتجعاتُ وتسعيرُ العملاء وأداءُ المناديب، بمجاميعَ من الخادم ونوافذَ معلَنة.',
    planAr:
      'تقريرُ الفترة من محرّك التقارير نفسه (GET /van-sales/reports): المدى يُطبَّق على القوائم والمجاميع وأداء المندوبين معًا.',
    companyScope: true,
    endpoints: ['GET /van-sales/reports', 'GET /van-sales/salesmen'],
  },
  {
    key: 'rep-app',
    groupKey: 'distribution-group',
    labelAr: 'تطبيق المندوب',
    icon: '',
    status: 'ready',
    href: '/rep',
    phaseAr: 'المرحلة 4 — مبنيّة',
    permission: 'van_sales.view',
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

  // 6. الإنتاج
  {
    key: 'production',
    groupKey: 'production-group',
    labelAr: 'الإنتاج',
    icon: '',
    status: 'ready',
    href: '/production',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'van_sales.production.manage',
    summaryAr:
      'تسجيلُ دفعة الإنتاج اليومية بمكوّناتها المصروفة وفاقدها بسببه، وجدولُ الدفعات كما يرجع من الخادم بلا تلخيصٍ محليّ.',
    planAr:
      'دفعة إنتاج بمكوّناتها: تقديرٌ إرشادي من المتوسط الرسمي قبل الاعتماد، ورفضٌ سابق للإرسال بالنصّ الذي سيقوله الخادم.',
    companyScope: true,
    endpoints: [
      'POST /van-sales/production-batches',
      'GET /van-sales/dashboard',
      'GET /organization/catalog/items',
      'GET /warehouses',
    ],
  },

  // 7. المحاسبة والمصروفات
  {
    key: 'cash-boxes',
    groupKey: 'accounting-group',
    labelAr: 'الصناديق والبنوك',
    icon: '',
    status: 'ready',
    href: '/cash-boxes',
    phaseAr: 'المرحلة 3 — مبنيّة',
    anyPermissions: ['organization.cashlocation.view', 'treasury.view'],
    summaryAr:
      'إدارةُ الخزائن النقدية والحسابات البنكية وأرصدتها الحية وكشفُ حركاتها والمناقلاتُ المالية بين الصناديق والبنوك.',
    planAr:
      'قراءة وإنشاء وتعديل الصناديق والحسابات البنكية وكشف حركاتها ومطابقة أرصدتها والمناقلات النقدية.',
    endpoints: [
      'GET /cash-locations',
      'POST /cash-locations',
      'PATCH /cash-locations/:id',
      'GET /cash-locations/:id/balances',
      'GET /cash-locations/:id/movements',
      'GET /cash-transfers',
      'POST /cash-transfers',
    ],
  },
  {
    key: 'treasury-vouchers',
    groupKey: 'accounting-group',
    labelAr: 'سندات القبض والصرف',
    icon: '',
    status: 'ready',
    href: '/treasury-vouchers',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'treasury.view',
    summaryAr:
      'إصدارُ سندات القبض وسندات الصرف والمصروفات التشغيلية وترحيلُها إلى الصندوق والأستاذ العام مع طباعة السند الرسمي.',
    planAr:
      'إنشاء وترحيل وإبطال سندات القبض والصرف والمصروفات التشغيلية مع ربط الطرف أو الحساب المقابل والطباعة.',
    endpoints: [
      'GET /vouchers',
      'POST /vouchers',
      'POST /vouchers/:id/post',
      'POST /vouchers/:id/void',
      'GET /reports/print/vouchers/:id',
    ],
  },
  {
    key: 'treasury',
    groupKey: 'accounting-group',
    labelAr: 'خزينة الخطّ',
    icon: '',
    status: 'ready',
    href: '/treasury',
    phaseAr: 'المرحلة 3 — مبنيّة',
    anyPermissions: ['treasury.view', 'organization.cashlocation.view'],
    summaryAr:
      'ما دخل الخزينةَ من نقد الخطّ: سنداتُ القبض التي أنشأها مسارُ التحصيل وحالتها (مُرحّلة أم مسودة)، ومواضعُ النقد وأرصدتُها.',
    planAr:
      'قراءةُ ما كتبه مسارُ الخطّ في الخزينة، بلا مدخلِ مالٍ ثانٍ: سنداتُ القبض التي يُنشئها ويُرحِّلها مسار التحصيل، ومواضعُ النقد وأرصدةُ كلٍّ منها.',
    endpoints: [
      'GET /vouchers',
      'GET /cash-locations',
      'GET /cash-locations/:id/balances',
      'POST /auth/handoff',
    ],
  },
  {
    key: 'accounting',
    groupKey: 'accounting-group',
    labelAr: 'المحاسبة التفصيلية (في اللوحة)',
    icon: '',
    status: 'ready',
    href: '/accounting',
    phaseAr: 'المرحلة 3 — مبنيّة',
    anyPermissions: ['accounting.reports.view', 'accounting.account.view', 'accounting.period.view'],
    summaryAr:
      'الأستاذُ والقيودُ وميزانُ المراجعة وقائمةُ الدخل والخزينة في اللوحة الإدارية، وتُفتح من هنا بجلسةٍ آمنةٍ باسمك وصلاحياتك.',
    planAr:
      'رابطٌ يعمل لا شاشةٌ تُقلّد الأستاذ: تسليم جلسة آمن عبر POST /auth/handoff إلى شاشات المحاسبة التفصيلية في اللوحة.',
    endpoints: ['POST /auth/handoff', 'GET /me'],
  },

  // 8. الكتالوج
  {
    key: 'items',
    groupKey: 'catalog-group',
    labelAr: 'الأصناف والمنتجات',
    icon: '',
    status: 'ready',
    href: '/items',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'catalog.item.view',
    summaryAr:
      'تعريفُ أصناف المخبز والموادّ الخام بأسعار البيع والتكلفة والباركود والفئة والوحدة ومجموعة ضريبة القيمة المضافة.',
    planAr:
      'عرض وإنشاء وتعديل أصناف الكتالوج مع ربط الفئة والوحدة والمجموعة الضريبية وأسعار البيع والتكلفة.',
    endpoints: [
      'GET /organization/catalog/items',
      'POST /organization/catalog/items',
      'PATCH /organization/catalog/items/:id',
      'GET /organization/catalog/tax-groups',
    ],
  },
  {
    key: 'categories',
    groupKey: 'catalog-group',
    labelAr: 'فئات الأصناف',
    icon: '',
    status: 'ready',
    href: '/categories',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'catalog.category.view',
    summaryAr:
      'تنظيمُ منتجات المخبز والموادّ الأولية في مجموعاتٍ وفئاتٍ واضحة لتسهيل الفلترة والتسعير والتقارير.',
    planAr: 'قراءة وإنشاء وتعديل مجموعات وفئات الأصناف في الكتالوج الموحّد للمنشأة.',
    endpoints: [
      'GET /organization/catalog/categories',
      'POST /organization/catalog/categories',
      'PATCH /organization/catalog/categories/:id',
    ],
  },
  {
    key: 'units',
    groupKey: 'catalog-group',
    labelAr: 'وحدات القياس',
    icon: '',
    status: 'ready',
    href: '/units',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'catalog.unit.view',
    summaryAr:
      'إدارةُ وحدات القياس المعتمدة في الإنتاج والبيع والمستودعات كالكيلوجرام والكيس والكرتون والربطة.',
    planAr: 'قراءة وإنشاء وتعديل وحدات القياس المعتمدة في الكتالوج والمخزون.',
    endpoints: [
      'GET /organization/catalog/units',
      'POST /organization/catalog/units',
      'PATCH /organization/catalog/units/:id',
    ],
  },

  // 9. الأطراف
  {
    key: 'parties',
    groupKey: 'parties-group',
    labelAr: 'العملاء والموردون',
    icon: '',
    status: 'ready',
    href: '/parties',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'parties.view',
    summaryAr:
      'سجلُّ العملاء والموردين مع الرقم الضريبي والعنوان الوطني وسقف الائتمان وكشف الرصيد الحيّ لكلّ طرف.',
    planAr:
      'عرض وإنشاء وتعديل بيانات العملاء والموردين مع العنوان الوطني للعميل الضريبي وفحص الرصيد المفتوح.',
    endpoints: ['GET /parties', 'POST /parties', 'PUT /parties/:id', 'GET /parties/:id/balance'],
  },

  // 10. الموظفون
  {
    key: 'employees',
    groupKey: 'hrm-group',
    labelAr: 'الموظفون',
    icon: '',
    status: 'ready',
    href: '/employees',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'hrm.view',
    summaryAr:
      'بطاقاتُ موظفي المخبز والخبّازين والسائقين مع القسم والوظيفة والراتب الأساسي وحالة العمل في المنشأة.',
    planAr: 'قراءة وإنشاء وتعديل بطاقات الموظفين والأقسام والوظائف والرواتب الأساسية.',
    endpoints: [
      'GET /hrm/employees',
      'POST /hrm/employees',
      'PATCH /hrm/employees/:id',
      'GET /hrm/departments',
      'GET /hrm/jobs',
    ],
  },
  {
    key: 'adjustments',
    groupKey: 'hrm-group',
    labelAr: 'المكافآت والخصومات',
    icon: '',
    status: 'ready',
    href: '/adjustments',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'hrm.view',
    summaryAr:
      'تسجيلُ البدلات والمكافآت والخصومات والسُّلَف الشهرية على الموظفين واعتمادُها لتدخل في مسير الرواتب.',
    planAr: 'قراءة وإنشاء واعتماد الإضافات والاستقطاعات المالية للموظفين حسب أنواع البدلات المعتمدة.',
    endpoints: [
      'GET /hrm/adjustments',
      'POST /hrm/adjustments',
      'POST /hrm/adjustments/:id/approve',
      'GET /hrm/adjustment-types',
    ],
  },
  {
    key: 'payroll',
    groupKey: 'hrm-group',
    labelAr: 'مسيرات الرواتب',
    icon: '',
    status: 'ready',
    href: '/payroll',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'hrm.view',
    summaryAr:
      'إعدادُ مسير الرواتب الشهري وترحيلُ استحقاقاته المحاسبية وصرفُ الرواتب من الصندوق أو الحساب البنكي.',
    planAr: 'عرض وإنشاء وترحيل ودفع مسيرات الرواتب الشهرية للموظفين مع قيود الاستحقاق والصرف.',
    endpoints: [
      'GET /hrm/payroll/runs',
      'POST /hrm/payroll/runs',
      'POST /hrm/payroll/runs/:id/post',
      'POST /hrm/payroll/runs/:id/pay',
    ],
  },
  {
    key: 'employee-account',
    groupKey: 'hrm-group',
    labelAr: 'كشف حساب موظف',
    icon: '',
    status: 'ready',
    href: '/employee-account',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'hrm.view',
    summaryAr:
      'كشفُ حسابٍ تفصيليّ لذمّة الموظف أو المندوب يعرض الرواتب والسُّلَف وتسويات العجز والمدفوعات بالفترة.',
    planAr: 'استخراج كشف الحساب التفصيلي للموظف وسجل أذون صرف الرواتب خلال الفترة المحددة.',
    endpoints: ['GET /hrm/employee-statement', 'GET /hrm/salary-payments', 'GET /hrm/employees'],
  },

  // 11. الذكاء الاصطناعي والضرائب
  {
    key: 'ai-assistant',
    groupKey: 'ai-tax-group',
    labelAr: 'المساعد الذكي',
    icon: '',
    status: 'ready',
    href: '/ai-assistant',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'ai.assistant.use',
    summaryAr:
      'مساعدٌ محاسبيٌّ ذكيّ يجيب عن أسئلتك حول المبيعات والمخزون والذمم ويعرض تنبيهات اليوم الذكية لمنشأتك.',
    planAr: 'محادثة المساعد الذكي وقراءة المحادثات السابقة وتوليد التنبيهات والاقتراحات التشغيلية اليومية.',
    endpoints: ['POST /ai/chat', 'GET /ai/conversations', 'GET /ai/suggestions', 'POST /ai/suggest'],
  },
  {
    key: 'ai-settings',
    groupKey: 'ai-tax-group',
    labelAr: 'إعدادات الذكاء الاصطناعي',
    icon: '',
    status: 'ready',
    href: '/ai-settings',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'ai.settings.manage',
    summaryAr:
      'تفعيلُ خدمة المساعد الذكي للمنشأة واختيارُ المزوّد والنموذج والسقف الشهري وفحصُ الاتصال مباشرةً.',
    planAr: 'قراءة وحفظ إعدادات مزوّد الذكاء الاصطناعي للمنشأة واختبار جاهزية المفتاح والاتصال.',
    endpoints: ['GET /ai/settings', 'PUT /ai/settings', 'POST /ai/settings/test'],
  },
  {
    key: 'tax-filings',
    groupKey: 'ai-tax-group',
    labelAr: 'الفوترة الإلكترونية والضرائب',
    icon: '',
    status: 'ready',
    href: '/tax-filings',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'einvoice.view',
    summaryAr:
      'متابعةُ الفواتير الضريبية المرفوعة وسلسلة التشفير ومزامنةُ الفواتير المرحَّلة وإعادةُ إرسال المتعثّر منها.',
    planAr: 'مراقبة سجل الفواتير الضريبية المرفوعة وسلسلة التشفير ومزامنة الفواتير وإعادة محاولة المرفوض.',
    endpoints: [
      'GET /einvoice/filings',
      'GET /einvoice/chain',
      'POST /einvoice/sync',
      'POST /einvoice/submissions/:id/retry',
    ],
  },

  // 12. التقارير
  {
    key: 'system-reports',
    groupKey: 'reports-group',
    labelAr: 'التقارير المالية والمخزنية',
    icon: '',
    status: 'ready',
    href: '/system-reports',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'reporting.view',
    summaryAr:
      'فهرسُ التقارير المحاسبية والضريبية والمخزنية الشاملة مع الفلترة بالتاريخ والفرع والطباعة الرسمية المباشرة.',
    planAr: 'تشغيل جميع تقارير النظام الرسمية من فهرس التقارير الموحد وطباعتها بقالب التقرير المعتمد.',
    endpoints: ['GET /reports', 'GET /reports/:key', 'GET /reports/print/:key'],
  },

  // 13. الإدارة والإعدادات
  {
    key: 'org',
    groupKey: 'admin-group',
    labelAr: 'المنشأة والفروع والمستودعات',
    icon: '',
    status: 'ready',
    href: '/org',
    phaseAr: 'المرحلة 3 — مبنيّة',
    anyPermissions: [
      'organization.companyprofile.view',
      'organization.branch.view',
      'organization.warehouse.view',
    ],
    summaryAr:
      'بياناتُ المنشأة والرقم الضريبي والعنوان الوطني وإدارةُ الفروع والمستودعات بما فيها المستودع الرئيسي.',
    planAr: 'عرض وتحديث ملف المنشأة والفروع والمستودعات مع تعريب المستودع الرئيسي في الواجهة.',
    endpoints: [
      'GET /company-profile',
      'GET /branches',
      'POST /branches',
      'GET /warehouses',
      'POST /warehouses',
    ],
  },
  {
    key: 'users',
    groupKey: 'admin-group',
    labelAr: 'المستخدمون والعضويات',
    icon: '',
    status: 'ready',
    href: '/users',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'tenant.membership.manage',
    summaryAr:
      'دعوةُ المستخدمين الجدد وإدارةُ عضوياتهم وأدوارهم الوظيفية وحالة تفعيلهم وسقوف الخصم المسموحة لهم.',
    planAr: 'عرض ودعوة وتعديل عضويات المستخدمين في المنشأة وإسناد الأدوار الوظيفية لهم.',
    endpoints: [
      'GET /memberships',
      'POST /memberships',
      'PATCH /memberships/:id',
      'GET /memberships/assignable-roles',
    ],
  },
  {
    key: 'roles',
    groupKey: 'admin-group',
    labelAr: 'الأدوار والصلاحيات',
    icon: '',
    status: 'ready',
    href: '/roles',
    phaseAr: 'المرحلة 3 — مبنيّة',
    permission: 'tenant.role.manage',
    summaryAr:
      'إنشاءُ الأدوار المخصّصة وضبطُ مصفوفة الصلاحيات الدقيقة لكلّ وظيفة في المخبز والمبيعات والمحاسبة.',
    planAr: 'عرض الأدوار النظامية والمخصصة وإنشاء أدوار جديدة وتحديث مصفوفة أذوناتها من سجل الصلاحيات.',
    endpoints: ['GET /roles', 'POST /roles', 'POST /roles/:id/permissions', 'GET /permissions'],
  },
  {
    key: 'support',
    groupKey: 'admin-group',
    labelAr: 'الدعم الفنّي والمساعدة',
    icon: '',
    status: 'ready',
    href: '/support',
    phaseAr: 'المرحلة 3 — مبنيّة',
    summaryAr:
      'تذاكرُ الدعم الفنّي ومحادثاتُها المباشرة مع فريق المنصّة، بالإضافة إلى مقالات الإرشاد والأسئلة الشائعة.',
    planAr: 'إنشاء ومتابعة تذاكر الدعم الفني والرد عليها وتصفح مقالات مركز المساعدة والأسئلة الشائعة.',
    endpoints: [
      'GET /support/tickets',
      'POST /support/tickets',
      'POST /support/tickets/:id/reply',
      'GET /public/help',
      'GET /public/faq',
    ],
  },
  {
    key: 'notifications',
    groupKey: 'admin-group',
    labelAr: 'الإشعارات',
    icon: '',
    status: 'ready',
    href: '/notifications',
    phaseAr: 'المرحلة 3 — مبنيّة',
    summaryAr:
      'مركزُ تنبيهات المنشأة لمتابعة التوريدات والاعتمادات والرسائل التشغيلية مع إمكانية تعليمها كمقروءة.',
    planAr: 'قراءة جميع إشعارات المستخدم وتصفيتها بالحالة وتعليم الإشعارات الفردية أو الكل كمقروء.',
    endpoints: ['GET /notifications', 'POST /notifications/:id/read'],
  },
  {
    key: 'printers',
    groupKey: 'admin-group',
    labelAr: 'إعدادات الطباعة',
    icon: '',
    status: 'ready',
    href: '/printers',
    phaseAr: 'المرحلة 3 — مبنيّة',
    summaryAr:
      'ضبطُ مقاس الورق الافتراضي لإيصالات الكاشير الحرارية وفواتير الضريبة ومعاينةُ الطباعة التجريبية المباشرة.',
    planAr: 'إعداد تفضيلات الطباعة الحرارية 80 مم و58 مم وورق A4 وعدد النسخ الافتراضي مع معاينة تجريبية.',
    endpoints: ['GET /company-profile'],
  },
  {
    key: 'change-password',
    groupKey: 'admin-group',
    labelAr: 'تغيير كلمة المرور',
    icon: '',
    status: 'ready',
    href: '/change-password',
    phaseAr: 'المرحلة 3 — مبنيّة',
    summaryAr:
      'تحديثُ كلمة مرور حسابك الشخصي بأمان مع التحقّق من كلمة المرور الحالية وتأكيد الكلمة الجديدة فورًا.',
    planAr: 'تغيير كلمة المرور للحساب الحالي عبر مسار المصادقة الرسمي في الخادم.',
    endpoints: ['POST /auth/change-password'],
  },
];

export function readyModules(modules: readonly BakeryModule[] = BAKERY_MODULES): readonly BakeryModule[] {
  return modules.filter((module) => module.status === 'ready');
}

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

export function groupedVisibleModules(
  can: (permission?: string) => boolean,
  modules: readonly BakeryModule[] = BAKERY_MODULES,
  options: { repScoped?: boolean; query?: string } = {},
): Array<{ group: BakeryGroup; items: BakeryModule[] }> {
  const visible = visibleModules(can, modules, { repScoped: options.repScoped });
  const q = (options.query ?? '').trim().toLowerCase();
  const filtered = q
    ? visible.filter(
        (m) =>
          m.labelAr.toLowerCase().includes(q) ||
          m.summaryAr.toLowerCase().includes(q) ||
          m.key.toLowerCase().includes(q),
      )
    : visible;
  return BAKERY_GROUPS.map((group) => ({
    group,
    items: filtered.filter((m) => m.groupKey === group.key),
  })).filter((entry) => entry.items.length > 0);
}

/**
 * مطابقة المسار بحدّ المقطع مع اختيار المسار الأطول عند تداخل البادئات.
 */
export function moduleForPath(
  pathname: string,
  modules: readonly BakeryModule[] = BAKERY_MODULES,
): BakeryModule | undefined {
  const matches = modules.filter((module) => {
    const href = module.href;
    if (!href) return false;
    if (href === '/') return pathname === '/';
    return pathname === href || pathname.startsWith(`${href}/`);
  });
  return matches.sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0];
}

export function unknownPermissionCodes(modules: readonly BakeryModule[] = BAKERY_MODULES): string[] {
  return modules
    .flatMap((module) => [module.permission ?? null, ...(module.anyPermissions ?? [])])
    .filter((permission): permission is string => typeof permission === 'string')
    .filter((permission) => !isKnownPermissionCode(permission));
}
