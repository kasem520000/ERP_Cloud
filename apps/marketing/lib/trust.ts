/**
 * `/trust`: visitor-facing claims are plain language; `source` is an internal review trail.
 * Every point must keep a real implementation/test reference (checked in verify.spec.ts).
 * File paths are not public evidence or links, and are intentionally not rendered in HTML.
 */
export type TrustPoint = {
  titleAr: string;
  bodyAr: string;
  /** Internal implementation reference; never render on the public page. */
  source: string;
};

export type TrustAxis = {
  key: string;
  titleAr: string;
  leadAr: string;
  points: TrustPoint[];
};

export const trustAxes: readonly TrustAxis[] = [
  {
    key: 'encryption',
    titleAr: 'حماية الحساب والبيانات',
    leadAr: 'خطوات محددة لحماية بيانات الدخول وأسرار الربط، لا وعد بأن أي نظام لا يمكن اختراقه.',
    points: [
      {
        titleAr: 'أسرار الربط مشفّرة عند التخزين',
        bodyAr: 'تُشفّر أسرار التوقيع والربط الضريبي والبريد والتحقق الإضافي قبل تخزينها، وتُحجب قيمها في السجلات التشغيلية.',
        source: 'apps/api/src/modules/platform/auth/secret-box.ts',
      },
      {
        titleAr: 'كلمات المرور لا تُحفظ كنص مقروء',
        bodyAr: 'تُحفظ كلمات المرور بتجزئة لا يمكن فكّها إلى النص الأصلي، مع حد أدنى للطول وفحص لقوائم كلمات المرور المسرّبة.',
        source: 'apps/api/src/modules/platform/auth/password.service.ts · apps/api/src/modules/platform/auth/password-policy.ts',
      },
      {
        titleAr: 'جلسات دخول قابلة للإبطال',
        bodyAr: 'رمز الدخول قصير العمر، ويتغيّر رمز تجديد الجلسة عند استخدامه. إذا أُعيد استعمال رمز قديم، تُبطل الجلسات المرتبطة به.',
        source: 'apps/api/src/modules/platform/auth/auth.service.ts',
      },
      {
        titleAr: 'خطوة تحقق إضافية عند تفعيلها',
        bodyAr: 'يمكن للمستخدم تفعيل التحقق بخطوتين لحسابه. هذه ميزة اختيارية وليست مفعّلة تلقائياً لكل مستخدم.',
        source: 'apps/api/src/modules/platform/auth/mfa.service.ts',
      },
      {
        titleAr: 'حدود لطلبات الدخول الحساسة',
        bodyAr: 'تُطبّق قيود على تكرار محاولات الدخول وبعض العمليات الحساسة، مع تحديد الجهات المسموح لها بالوصول إلى واجهة الخدمة.',
        source: 'apps/api/src/bootstrap.ts · apps/api/src/modules/platform/guards/rate-limit.guard.ts',
      },
    ],
  },
  {
    key: 'isolation',
    titleAr: 'عزل بيانات المنشآت',
    leadAr: 'لا تعتمد حدود الوصول على إخفاء الصفوف في الشاشة وحدها؛ تُفحص الصلاحية ونطاق المنشأة في الخدمة وقاعدة البيانات.',
    points: [
      {
        titleAr: 'حاجز على مستوى قاعدة البيانات',
        bodyAr: 'تُقيّد قراءة سجلات المنشأة بسياقها داخل قاعدة البيانات، حتى لا يكفي نسيان شرط المنشأة في استعلام واحد لعبور البيانات.',
        source: 'packages/database/src/rls.ts#rlsProtectedTables · packages/database/migrations/0000_platform_identity.sql',
      },
      {
        titleAr: 'فحص الصلاحيات قبل القراءة',
        bodyAr: 'تُراجع صلاحية الطلب في الخدمة، ثم يُطبّق قيد المنشأة في قاعدة البيانات؛ وهما مستويان منفصلان من التحقق.',
        source: 'apps/api/src/modules/platform/guards/permissions.guard.ts · packages/database/src/rls.ts',
      },
      {
        titleAr: 'وصول المنصة له نطاق مختلف',
        bodyAr: 'الوصول الإداري عبر المنشآت مخصّص للوحة المنصة وبسياق محدود بالمعاملة، وتُسجّل إجراءاته في سجل التدقيق.',
        source: 'packages/database/src/client.ts · apps/api/src/modules/platform-services/audit/audit.service.ts',
      },
      {
        titleAr: 'اختبارات لعبور الحدود',
        bodyAr: 'توجد اختبارات تحاول الوصول بين منشأتين وبين واجهات الموظف والعميل والمنصة. نجاحها لا يغني عن مراجعة تشغيلية مستقلة.',
        source: 'apps/api/test/isolation.spec.ts · isolation-organization.spec.ts · surface-isolation.spec.ts',
      },
    ],
  },
  {
    key: 'backups',
    titleAr: 'النسخ والاستعادة وأثر التغيير',
    leadAr: 'نميّز بين وجود ملف نسخة وبين التحقق من قابليته للقراءة، ونوضح حدود الاحتفاظ والحذف.',
    points: [
      {
        titleAr: 'قياس ملف النسخة بعد إنشائه',
        bodyAr: 'بعد كتابة النسخة يُقاس حجم الملف وبصمته من المخزن، ويُقيّد تنزيله من لوحة المنصة برابط مؤقت.',
        source: 'packages/contracts/src/platform/backups.ts · apps/api/src/modules/backups/platform-backups.service.ts',
      },
      {
        titleAr: 'فحص سلامة واستعادة تجريبية',
        bodyAr: 'يمكن فحص الملف ومقارنة بصمته وإجراء استعادة تجريبية لا تستبدل بياناتك؛ يعرض الفحص إن كان سليماً أو مختلفاً أو غير مقروء.',
        source: 'packages/contracts/src/platform/backups.ts',
      },
      {
        titleAr: 'معاينة قبل تطبيق سياسة الاحتفاظ',
        bodyAr: 'يمكن معاينة الملفات والسجلات التي ستتأثر بسياسة الاحتفاظ قبل تنفيذها؛ التطبيق خطوة منفصلة ومسجّلة.',
        source: 'packages/contracts/src/platform/backups.ts',
      },
      {
        titleAr: 'أثر تدقيق للمراجعة',
        bodyAr: 'سجل التدقيق مصمم لتوثيق الأفعال، ولا تسمح صلاحيات الخدمة المعتادة بتعديل صفوفه أو حذفها. لا يعني ذلك احتفاظاً أبدياً مضموناً.',
        source: 'packages/database/migrations/0001_platform_services.sql · packages/contracts/src/platform/backups.ts',
      },
      {
        titleAr: 'طلبات محو الهوية مع بيان الأثر',
        bodyAr: 'يعالج طلب المحو حقول الهوية الحية والجلسات والعضويات، ويبيّن ما يبقى في سجلات التدقيق بدلاً من الوعد بمحو لا يمكن التحقق منه.',
        source: 'apps/api/src/modules/backups/platform-backups.service.ts',
      },
    ],
  },
  {
    key: 'zatca',
    titleAr: 'الفاتورة الإلكترونية السعودية',
    leadAr: 'يختلف إنشاء رمز فاتورة قابل للقراءة عن إرسالها وقبولها رسمياً لدى هيئة الزكاة والضريبة والجمارك.',
    points: [
      {
        titleAr: 'رمز الفاتورة بحسب بياناتها',
        bodyAr: 'يحمل الرمز بيانات البائع والضريبة والإجمالي والتاريخ، ولا تُضاف بيانات توقيع إلا عندما تكون الفاتورة موقّعة فعلاً.',
        source: 'apps/api/src/modules/einvoicing/zatca/qr.ts',
      },
      {
        titleAr: 'فحص قبل محاولة الإرسال',
        bodyAr: 'تُفحص بيانات المنشأة وبنود الفاتورة قبل الإرسال، ويُعرض ما يحتاج إلى تصحيح بدلاً من إخفاء سبب عدم الجاهزية.',
        source: 'apps/api/src/modules/einvoicing/zatca/compliance-check.ts',
      },
      {
        titleAr: 'قراءة الرمز ليست اعتماداً رسمياً',
        bodyAr: 'يمكن قراءة بيانات الرمز في صفحة التحقق. أما التحقق الرسمي من الفاتورة فيكون عبر تطبيق «فاتورة» التابع للهيئة.',
        source: 'packages/contracts/src/zatca-qr.ts · apps/marketing/lib/verify.ts',
      },
      {
        titleAr: 'الإرسال يتطلب إعداد الربط',
        bodyAr: 'بلا شهادة ربط لا يتم إرسال الفاتورة فعلياً إلى الهيئة. حالة «مهيّأة» لا تعني قبولاً أو تخليصاً رسمياً.',
        source: 'apps/api/src/modules/einvoicing/einvoicing.service.ts',
      },
    ],
  },
];

/** Public limits are part of the claim, not a footnote. */
export const trustLimitsAr: readonly string[] = [
  'لا نعلن شهادة أمنية مستقلة مثل ISO 27001 أو SOC 2 أو PCI؛ لا تُفسَّر الإجراءات المذكورة أعلاه على أنها اعتماد.',
  'لا نعد بنسبة توفّر أو زمن استجابة تعاقدي في هذه الصفحة. راجع نطاق الخدمة والاتفاق المكتوب قبل اتخاذ قرار الاعتماد.',
  'لا يعني إنشاء رمز الفاتورة إرسالها أو اعتمادها من الهيئة. الإرسال مرتبط بإعداد شهادة الربط والتحقق الرسمي عبر تطبيق الهيئة.',
  'منطقة الاستضافة وترتيبات النسخ والاستعادة تُحدَّد في الاتفاق المكتوب؛ لا تفترض منطقة بيانات أو استعادة عند لحظة بعينها من هذا الوصف.',
  'لا تغطي هذه الصفحة متطلبات الفوترة المصرية. ولتفاصيل مزوّدي الخدمة ومعالجة البيانات، راجع العقد وسياسة الخصوصية بدلاً من افتراض عدم وجود أطراف أخرى.',
];

export const TRUST_PATH = '/trust';
