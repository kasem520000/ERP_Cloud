/**
 * P-M2 — الوحدات الثمانية المعروضة في الموقع، ومنظومة واجهات السحابة وتطبيقات الأندرويد.
 *
 * **المصدر هو شجرة `apps/staff` ومسارات المستودع الحقيقية** لا قائمةٌ مخترعة: كل تسمية ورمز من
 * `apps/staff/lib/navigation.ts` أو من مجلّد التطبيق الفعلي في المستودع (`apps/bakery`,
 * `packages/web-van`, `apps/android-bakery`, `apps/android-rep`, `apps/portal`).
 */

export type SiteModule = {
  key: string;
  icon: string;
  /** التسمية العربية كما في `apps/staff/lib/navigation.ts` حرفياً. */
  labelAr: string;
  labelEn: string;
  /** مسار الشاشة في تطبيق العمل — يُظهر أن الوحدة موجودة فعلاً لا وصفاً تسويقياً. */
  staffHref: string;
  /** سطرٌ واحد يقول ما تفعله الوحدة (نصّ التسمية من الشجرة، والشرح من دليل الاستخدام). */
  blurbAr: string;
  blurbEn: string;
  /** ملف+سطر تسمية الوحدة في الشجرة — بوابة «المصدر بالسطر» في هذا المستودع. */
  source: string;
};

export type CloudSurfaceItem = {
  key: string;
  icon: string;
  badgeAr: string;
  badgeEn: string;
  labelAr: string;
  labelEn: string;
  blurbAr: string;
  blurbEn: string;
  source: string;
};

export const siteModules: readonly SiteModule[] = [
  {
    key: 'accounting',
    icon: '📊',
    labelAr: 'المحاسبة',
    labelEn: 'Accounting',
    staffHref: '/accounting/accounts',
    blurbAr:
      'دليل حسابات سعودي شجري، قيود مزدوجة وأرصدة افتتاحية متوازنة، مراكز تكلفة، أصول ثابتة، إقرارات ضريبية، وميزان مراجعة وقوائم ختامية متطابقة.',
    blurbEn:
      'Saudi chart of accounts, double-entry & balanced opening entries, cost centers, fixed assets, VAT returns, and audit-ready financial statements.',
    source: 'apps/staff/lib/navigation.ts#accounting',
  },
  {
    key: 'treasury',
    icon: '🏦',
    labelAr: 'الخزينة',
    labelEn: 'Treasury',
    staffHref: '/treasury/movements',
    blurbAr:
      'صناديق نقد وحسابات بنكية، سندات قبض وصرف وتحويلات، شيكات وتسويات بنكية، وإقفال يومية الصندوق بأرصدته الفعلية.',
    blurbEn:
      'Cash safes and bank accounts, receipt & payment vouchers, transfers, cheques, bank reconciliation, and daily till closing.',
    source: 'apps/staff/lib/navigation.ts#treasury',
  },
  {
    key: 'inventory',
    icon: '🏭',
    labelAr: 'المستودعات',
    labelEn: 'Inventory',
    staffHref: '/inventory/items',
    blurbAr:
      'مستودعات متعددة تبدأ بـ«المستودع الرئيسي»، أصناف ووحدات وباركود ودفعات صلاحية وأرقام تسلسلية، تحويلات مخزنية، جرد فعلي، وأوامر إنتاج.',
    blurbEn:
      'Multi-warehouse stock starting with a pre-provisioned main warehouse, barcodes, batches & serials, transfers, stock counts, and production orders.',
    source: 'apps/staff/lib/navigation.ts#inventory',
  },
  {
    key: 'purchases',
    icon: '🛒',
    labelAr: 'المشتريات',
    labelEn: 'Purchases',
    staffHref: '/purchases/orders',
    blurbAr:
      'طلبات وأوامر شراء، استلام مخزني، فواتير ومردودات مشتريات بخصم الصافي ومراكز التكلفة، وكشوف وأعمار ذمم الموردين.',
    blurbEn:
      'Purchase requisitions & orders, goods receipts, net-method supplier invoices & returns with cost centers, and AP aging.',
    source: 'apps/staff/lib/navigation.ts#purchases',
  },
  {
    key: 'sales',
    icon: '🧾',
    labelAr: 'المبيعات',
    labelEn: 'Sales',
    staffHref: '/sales/invoices',
    blurbAr:
      'عروض أسعار، فواتير نقدية وآجلة ومردودات، شاشة كاشير سريعة (POS)، مبيعات مناديب التوزيع، وبوابة عملاء لكشف الحساب.',
    blurbEn:
      'Quotations, cash & credit invoices, returns, fast POS cashier, van-sales distribution, and customer statement portal.',
    source: 'apps/staff/lib/navigation.ts#sales',
  },
  {
    key: 'hrm',
    icon: '👥',
    labelAr: 'الموظفين والرواتب',
    labelEn: 'HR & Payroll',
    staffHref: '/hrm/employees',
    blurbAr:
      'ملفات الموظفين، حركات وظيفية، حضور وانصراف، مسيّرات رواتب شهرية بترحيلها المحاسبي، وسلف وخصومات وكشف حساب موظف.',
    blurbEn:
      'Employee records, HR movements, attendance, monthly payroll runs with GL posting, advances, deductions, and employee ledgers.',
    source: 'apps/staff/lib/navigation.ts#hrm',
  },
  {
    key: 'marina',
    icon: '⛵',
    labelAr: 'إدارة المراسي',
    labelEn: 'Marina',
    staffHref: '/marina/berths',
    blurbAr: 'مراسي وعقود إيجار دورية، فواتير خدمة وتأجير، تحضير المراكب، ومتابعة إشغال موسمية.',
    blurbEn: 'Berths, recurring contracts, service & rental invoices, vessel preparation, and seasonal occupancy.',
    source: 'apps/staff/lib/navigation.ts#marina',
  },
  {
    key: 'projects',
    icon: '🏗️',
    labelAr: 'إدارة المشاريع',
    labelEn: 'Projects',
    staffHref: '/projects/list',
    blurbAr: 'مشاريع بميزانياتها وجداول كمياتها، مستخلصات إنجاز ومقاولون من الباطن، وربحية دقيقة لكل مشروع.',
    blurbEn: 'Projects with BOQ budgets, progress claims, subcontractor contracts & payments, and per-project margin.',
    source: 'apps/staff/lib/navigation.ts#projects',
  },
];

/**
 * واجهات المنظومة السحابية وتطبيقات الجوال الفعلية في المستودع — ستّ أسطح مترابطة على خادمٍ واحد.
 */
export const cloudSurfaces: readonly CloudSurfaceItem[] = [
  {
    key: 'staff-web',
    icon: '🌐',
    badgeAr: 'تطبيق ويب شامل',
    badgeEn: 'Web Back-Office',
    labelAr: 'لوحة المنشأة والمحاسبة الشاملة',
    labelEn: 'Tenant ERP & Accounting Suite',
    blurbAr:
      'واجهة الإدارة الكاملة للمحاسبين والمديرين والكاشير: الفواتير بشريط إتمام ثابت بلا تمرير، التقارير الختامية، والصلاحيات متعددة الفروع.',
    blurbEn:
      'Full back-office workspace for accountants, managers and cashiers: ergonomic zero-scroll invoicing, POS, financial reports and multi-branch RBAC.',
    source: 'apps/staff/app/page.tsx',
  },
  {
    key: 'bakery-web',
    icon: '🥖',
    badgeAr: 'تشغيل تخصصي',
    badgeEn: 'Bakery & POS Web',
    labelAr: 'نظام تشغيل المخابز ونقاط البيع',
    labelEn: 'Bakery Production & POS Workspace',
    blurbAr:
      'واجهة مخصصة لخطوط العجن والإنتاج، تسليم عهد المناديب، تسوية التوالف والجرد، ونقاط البيع المباشرة مع انتقال فوري للأستاذ العام.',
    blurbEn:
      'Dedicated workspace for dough & production batches, van custody dispatch, spoilage adjustments, POS, and instant single-use handoff to the GL.',
    source: 'apps/bakery/app/page.tsx',
  },
  {
    key: 'van-web',
    icon: '🚚',
    badgeAr: 'ميداني · يعمل بلا اتصال',
    badgeEn: 'Offline-First PWA',
    labelAr: 'واجهة المندوب الميداني (Van Sales PWA)',
    labelEn: 'Field Van-Sales Progressive Web App',
    blurbAr:
      'بيع من المركبة، مرتجعات، تحصيل ذمم نقدي وشبكي، إقفال رحلة يومي، وطابور مزامنة يحفظ الفواتير عند انقطاع الشبكة.',
    blurbEn:
      'Truck-side invoicing, returns, cash & card collections, trip reconciliation, and an idempotent offline sync queue.',
    source: 'packages/web-van/src/index.ts',
  },
  {
    key: 'android-bakery',
    icon: '📱',
    badgeAr: 'تطبيق أندرويد أصيل',
    badgeEn: 'Native Android APK',
    labelAr: 'تطبيق الأندرويد للإدارة والمخابز والكاشير',
    labelEn: 'Android Bakery, POS & ERP App',
    blurbAr:
      'تطبيق Kotlin/Compose أصيل يدعم الكاشير والفواتير والمشتريات والمستودعات والخزينة والرواتب ومساعد الذكاء الاصطناعي والطباعة الحرارية بلوتوث.',
    blurbEn:
      'Native Jetpack Compose Android app covering POS, sales & purchase invoices, stock, treasury, payroll, AI assistant, and ESC/POS Bluetooth printing.',
    source: 'apps/android-bakery/app/src/main/java/com/erpcloud/bakery/MainActivity.kt',
  },
  {
    key: 'android-rep',
    icon: '📱',
    badgeAr: 'تطبيق أندرويد للمناديب',
    badgeEn: 'Native Rep APK',
    labelAr: 'تطبيق الأندرويد للمندوب الميداني',
    labelEn: 'Android Field Representative App',
    blurbAr:
      'مصمم لشاشات الجوال بيدٍ واحدة: طابور عمل دون اتصال بمفاتيح منع التكرار، دخول بالبصمة، وطباعة فواتير حرارية بترميز زاتكا QR.',
    blurbEn:
      'One-handed mobile app for distribution reps with biometric sign-in, offline queue replay, and ZATCA QR thermal receipt printing.',
    source: 'apps/android-rep/app/src/main/java/com/erpcloud/rep/MainActivity.kt',
  },
  {
    key: 'portal-ai',
    icon: '✨',
    badgeAr: 'بوابة عملاء + ذكاء اصطناعي',
    badgeEn: 'Portal & AI Copilot',
    labelAr: 'بوابة العملاء ومساعد الذكاء الاصطناعي',
    labelEn: 'Customer Self-Service Portal & AI Copilot',
    blurbAr:
      'بوابة مستقلة لعملائك لاستعراض الفواتير وكشف الحساب وتذاكر الدعم، مع مساعد ذكي يقرأ مؤشرات منشأتك بصلاحياتك وتنبيهات فورية.',
    blurbEn:
      'Dedicated customer portal for statements, orders and support tickets, paired with a read-safe, permission-scoped financial AI Copilot.',
    source: 'apps/customer-portal/app/portal/page.tsx',
  },
];

/** «كيف تبدأ في خمس خطوات» — خطواتٌ من تدفّق الاشتراك الحقيقي لا من شعارات. */
export const onboardingSteps = [
  {
    titleAr: 'أنشئ المنشأة',
    titleEn: 'Create the workspace',
    bodyAr: 'الاسم والرمز والعملة وتوقيت مكة المكرمة — تتهيأ في دقيقتين.',
    bodyEn: 'Name, code, currency and Makkah timezone — provisioned in two minutes.',
  },
  {
    titleAr: 'فرعك و«المستودع الرئيسي» جاهزان',
    titleEn: 'Branch & main warehouse ready',
    bodyAr: 'يُنشأ فرعك ومستودعك الرئيسي وصندوقك تلقائياً، وأضف ما شئت من الفروع.',
    bodyEn: 'Your main branch, Arabic main warehouse and safe ship ready; add more anytime.',
  },
  {
    titleAr: 'ادعُ فريقك ومناديبك',
    titleEn: 'Invite staff & field reps',
    bodyAr: 'أدوارٌ جاهزة للمدير والمحاسب والكاشير والمندوب عبر الويب والأندرويد.',
    bodyEn: 'Ready roles for managers, accountants, cashiers and reps across web and Android.',
  },
  {
    titleAr: 'دليل حساباتك السعودي مهيّأ',
    titleEn: 'Saudi chart of accounts ready',
    bodyAr: 'شجرة الحسابات ومجموعات الضريبة جاهزة فوراً، أو استورد دليلك وأرصدتك الافتتاحية.',
    bodyEn: 'Saudi COA and VAT groups ship pre-seeded, or import your own chart and opening balances.',
  },
  {
    titleAr: 'أصدر واطبع أول فاتورة',
    titleEn: 'Issue & print your first invoice',
    bodyAr: 'فاتورةٌ إلكترونية بترميز زاتكا QR تُرحَّل وتُطبع حرارياً في ثوانٍ.',
    bodyEn: 'A ZATCA QR e-invoice posted to the ledger and printed thermally in seconds.',
  },
];

/** قسم الفاتورة الإلكترونية — الأهمّ سعودياً (الخطّة §4). */
export const einvoicingPoints = [
  {
    titleAr: 'ترميز QR متوافق مع زاتكا بتوقيت مكة',
    titleEn: 'ZATCA TLV QR on Makkah time',
    bodyAr: 'رمزٌ مشفَّر وفق مواصفة الهيئة يُقرأ من الفاتورة الورقية والحرارية ويُتحقَّق منه بلا حساب.',
    bodyEn: 'TLV-encoded QR code readable from A4 or thermal receipts and verifiable online without an account.',
  },
  {
    titleAr: 'ربطٌ مع منصة فاتورة وطباعة حرارية',
    titleEn: 'Fatoora integration & ESC/POS printing',
    bodyAr: 'بيانات المنشأة الضريبية، توقيعٌ وترقيمٌ تسلسلي، وطباعةٌ فورية عبر المتصفح أو طابعات البلوتوث في الأندرويد.',
    bodyEn: 'Tax profile, sequential numbering, Fatoora submission, and instant browser or Android Bluetooth thermal printing.',
  },
  {
    titleAr: 'تحقّقٌ عام من أي فاتورة',
    titleEn: 'Public invoice verification',
    bodyAr: 'أدخل رقم الفاتورة أو امسح رمز QR على هذا الموقع لتتأكّد من صحتها ومصدرها فوراً.',
    bodyEn: 'Enter the invoice number or scan the QR payload on this site to confirm authenticity immediately.',
  },
];
