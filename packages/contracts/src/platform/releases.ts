import { z } from 'zod';

/**
 * 🗜️ تحديث المنصّة عبر حزمة ZIP — العقد.
 *
 * **ما هذه الحزمة، وما ليست.** ليست شيفرةً تُنفَّذ: الخادم لا يفكّ ضغطاً إلى القرص ولا
 * يستورد وحدةً ولا يشغّل سكربتاً من أرشيفٍ رفعه إنسان. الحزمة **بيانُ إصدار** يبنيه خطّ
 * النشر (‏`deploy/`) ويصف ما سيُنشر: رقم الإصدار، وقناة النشر، وما الجديد، وقائمة الملفات
 * التي يحملها. والخادم يفعل بها ثلاثة أشياء فقط:
 *
 *   1. **يفحصها**: بنية ZIP صحيحة، و`release.json` في الجذر، ولا مسار يخرج من الأرشيف
 *      (‏`..` أو مسار مطلق أو حرف `\`)، ولا ملفّ تنفيذي أو سكربت، ولا قيد مشفّر،
 *      والحجم والعدد والمدى داخل الحدود.
 *   2. **يُثبّتها**: بصمة `sha256` وحجمٌ وعددُ مدخلاتٍ وسطورُ بيانٍ في سجلّ `platform_releases`،
 *      فما نُشر يُعرف بأرقامه لا برواية من نشره.
 *   3. **يُعلنها**: الإصدار «الحالي» يقرؤه كل مستخدمٍ في شاشته «حول النظام» — لأن سؤال
 *      «أيُّ إصدارٍ أعمل عليه؟» يُسأل للدعم في كل تذكرة.
 *
 * ولهذا لا تُخزَّن بايتات الحزمة عندنا: تخزينُ أرشيفاتٍ قابلة للتنفيذ على جهاز الـAPI
 * دينٌ أمنيّ بلا مقابل — يكفي أن يُقاس ويتطابق. (النسخ الاحتياطي شيء آخر: ذاك بياناتُ
 * العميل ومصيره الاستعادة، وهذا بيانُ نشر.)
 */

// ───────────────────────────────────────────────────────────── الحدود

/**
 * حدود الحزمة. والأرقام ليست اعتباطاً:
 *  - `maxBytes` 8 MiB: أكبر من أي بيانِ نشرٍ فعليٍّ ومن أيقوناتٍ معه، وأصغر بكثير من أن
 *    يكون ناقلَ بياناتِ عميل؛ وحدُّ جسم الطلب في الحافة (1 MiB) يبقى ساريًا على الـJSON
 *    الذي يحمل المحتوى مُرمَّزاً بـbase64 (‏≈5.3 MiB من الأرشيف بعد فكّ الترميز — وهذا
 *    سقفُ ما يقبله المسار فعلاً، والقيمة هنا تشرح النيّة).
 *  - `maxEntries` 500: منشورٌ إلكتروني فيه 3000 صورةٍ ليس بيانَ إصدار.
 *  - `maxEntryBytes` 4 MiB: ملفٌّ واحد أكبر من الحزمة كلها يعني حزمةً واحدة أعلى السقف.
 *  - `maxNotes` 2000 و`maxHighlights` 10 × 200: ما يُقرأ في شاشةٍ لا مقالاً.
 */
export const platformReleaseLimits = {
  maxBytes: 8 * 1024 * 1024,
  maxEntries: 500,
  maxEntryBytes: 4 * 1024 * 1024,
  maxNotes: 2000,
  maxHighlights: 10,
  maxHighlightLength: 200,
} as const;

/** قنوات النشر: المستقرّ يصل للجميع، والتجريبيّ لمن اختار أن يجرّب أولاً. */
export const platformReleaseChannels = ['stable', 'beta'] as const;
export type PlatformReleaseChannel = (typeof platformReleaseChannels)[number];

/** حالة الحزمة في السجلّ: مقبولة · مرفوضة (سببُ الرفض محفوظ) · مسحوبة (تراجع). */
export const platformReleaseStatuses = ['accepted', 'rejected', 'revoked'] as const;
export type PlatformReleaseStatus = (typeof platformReleaseStatuses)[number];

/**
 * امتداداتٌ لا تُقبل في حزمة تحديث — وما وراءها من محتوى لا يُقبل أيضاً.
 *
 * القاعدة أوسع من القائمة: كل امتدادٍ قابلٍ للتنفيذ يُرفض، والقائمة تسمّي الشائع كي
 * يقرأ الرافضُ سبباً مفهوماً. والملفّات بلا امتداد تُقبل (‏`LICENSE`، `CHANGELOG`).
 */
export const releaseForbiddenExtensions = [
  'exe', 'dll', 'so', 'dylib', 'bin', 'com', 'bat', 'cmd', 'ps1', 'psm1', 'sh', 'bash', 'zsh',
  'vbs', 'vbe', 'js', 'mjs', 'cjs', 'jar', 'war', 'msi', 'apk', 'ipa', 'deb', 'rpm', 'pkg',
  'scr', 'hta', 'cpl', 'lnk', 'reg', 'php', 'py', 'rb', 'pl',
] as const;

// ───────────────────────────────────────────────────────────── البيان

/**
 * `release.json` في جذر الحزمة. صيغة الإصدار `YYYY.M.P` أو `X.Y.Z` مع لاحقةٍ اختيارية —
 * والصيغة تُفحص لأن الإصدار يُقارَن ويُعرَض، و«v2-final-final» ليس إصداراً.
 */
export const releaseManifestSchema = z
  .object({
    version: z
      .string()
      .trim()
      .min(3)
      .max(40)
      .regex(/^\d+(\.\d+){1,3}(-[0-9A-Za-z.]+)?$/, 'صيغة الإصدار غير صالحة (مثال: 2026.10.2)'),
    channel: z.enum(platformReleaseChannels).default('stable'),
    notes: z.string().trim().min(1).max(platformReleaseLimits.maxNotes),
    highlights: z
      .array(z.string().trim().min(1).max(platformReleaseLimits.maxHighlightLength))
      .max(platformReleaseLimits.maxHighlights)
      .default([]),
    /** أقلّ إصدارٍ يمكن التحديث منه مباشرةً — لمن يقرأ «هل أقفز من هنا؟». */
    minFromVersion: z
      .string()
      .trim()
      .regex(/^\d+(\.\d+){1,3}(-[0-9A-Za-z.]+)?$/)
      .optional(),
  })
  .strict();
export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;

// ───────────────────────────────────────────────────────────── الطلبات

/**
 * الرفع: اسم الملف ومحتواه مُرمَّزاً بـbase64، وسببٌ مكتوب.
 *
 * ولماذا base64 في JSON لا `multipart/form-data`؟ لأن الحافة تفرض سقف جسمٍ واحداً
 * (`BODY_LIMIT_BYTES`) وتحوّل أخطاء المُحلّل إلى `413` بعقدٍ واحد — وفتحُ مُحلّلٍ ثانٍ
 * لأرشيفٍ هو بالضبط ما يُوسّع سطح الهجوم بدل أن يُضيِّقه.
 */
export const platformReleaseUploadSchema = z
  .object({
    filename: z.string().trim().min(1).max(200),
    contentBase64: z.string().min(1).max(Math.ceil((platformReleaseLimits.maxBytes * 4) / 3) + 8),
    /**
     * بصمة `sha256` كما حسبها من بنى الحزمة — **خارج الأرشيف** لأن البصمة داخل البيان
     * مستحيلة: كتابتها فيه تغيّر بايتاته فتغيّر بصمته. تُقارَن بما يحسبه الخادم، فلا
     * يُقبل ملفٌّ انحرف بين البناء والرفع (نقلٌ ناقص، أو اعتراضٌ في الطريق).
     */
    checksum: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/, 'بصمة sha256 يجب أن تكون 64 حرفاً سادس عشرياً')
      .optional(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type PlatformReleaseUpload = z.infer<typeof platformReleaseUploadSchema>;

/**
 * سببُ الفعل — واحدٌ للإعلان (`promote`) والسحب (`revoke`): كلاهما يغيّر ما يراه كل
 * مستخدمٍ في المنصّة، ولا معنى لفعلٍ كهذا بلا جملةٍ تقول لماذا.
 */
export const platformReleaseReasonSchema = z
  .object({
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type PlatformReleaseReason = z.infer<typeof platformReleaseReasonSchema>;

// ───────────────────────────────────────────────────────────── الردود

export type PlatformRelease = {
  id: string;
  /** رقم الإصدار من البيان — و`null` في حزمةٍ مرفوضةٍ قبل قراءة بيانها. */
  version: string | null;
  channel: PlatformReleaseChannel;
  status: PlatformReleaseStatus;
  notes: string;
  highlights: string[];
  minFromVersion: string | null;
  filename: string;
  bytes: number;
  entries: number;
  /** `sha256` لما حسبه الخادم من البايتات المستلمة. */
  checksum: string;
  /**
   * هل أعلن الرافع بصمةً **وطابقت** المحسوب؟ `false` لا تعني حزمةً سيئة: تعني أنّ الرفع
   * لم يعلن بصمة (أو أعلنها ولم يطابق فأُعيد بـ422 ولم يُكتب صفّ).
   */
  checksumVerified: boolean;
  /** الملفّات كما في الأرشيف (محدودة العدد) — «ماذا في هذه الحزمة؟» بلا تنزيلها. */
  files: string[];
  reason: string;
  /** رمز الرفض — للفرز والتصفية في الشاشة (`null` في المقبولة). */
  rejectionCode: ReleaseRejectionCode | null;
  rejectedReason: string | null;
  isCurrent: boolean;
  uploadedAt: string;
  uploadedBy: string | null;
  revokedAt: string | null;
};

export type PlatformReleaseList = {
  releases: PlatformRelease[];
  /** الإصدار المعروض للمستأجرين الآن — `null` قبل أول حزمة مقبولة. */
  current: PlatformRelease | null;
};

/** ما يراه المستخدم في شاشته «حول النظام» — بلا بصمةٍ ولا اسم ملفّ. */
export type TenantReleaseInfo = {
  version: string;
  channel: PlatformReleaseChannel;
  notes: string;
  highlights: string[];
  publishedAt: string;
} | null;

/** رفضُ حزمةٍ لا يرمي 500: يُعاد بـ422 مع سببٍ يقرأه من رفعها. */
export const releaseRejectionCodes = [
  'EMPTY_BUNDLE',
  'TOO_LARGE',
  'NOT_A_ZIP',
  'BAD_ARCHIVE',
  'ENCRYPTED_ENTRY',
  'UNSAFE_PATH',
  'TOO_MANY_ENTRIES',
  'ENTRY_TOO_LARGE',
  'FORBIDDEN_FILE',
  'MISSING_MANIFEST',
  'BAD_MANIFEST',
  'CHECKSUM_MISMATCH',
] as const;
export type ReleaseRejectionCode = (typeof releaseRejectionCodes)[number];

/** أسباب الرفض بالعربية — الرسالة تُعرض كما هي في الشاشة. */
export const releaseRejectionMessages: Record<ReleaseRejectionCode, string> = {
  EMPTY_BUNDLE: 'الحزمة فارغة',
  TOO_LARGE: 'حجم الحزمة يتجاوز الحدّ المسموح',
  NOT_A_ZIP: 'الملف ليس أرشيف ZIP صالحاً',
  BAD_ARCHIVE: 'بنية الأرشيف تالفة أو غير مكتملة',
  ENCRYPTED_ENTRY: 'الأرشيف مشفّر — لا يمكن فحص محتواه قبل قبوله',
  UNSAFE_PATH: 'الأرشيف يحمل مساراً يخرج عن جذره (.. أو مسار مطلق)',
  TOO_MANY_ENTRIES: 'عدد ملفات الأرشيف يتجاوز الحدّ',
  ENTRY_TOO_LARGE: 'أحد ملفات الأرشيف يتجاوز الحدّ',
  FORBIDDEN_FILE: 'الأرشيف يحمل ملفاً قابلاً للتنفيذ أو سكربتاً — لا تُقبل الشيفرة في حزمة تحديث',
  MISSING_MANIFEST: 'الأرشيف لا يحمل release.json في جذره',
  BAD_MANIFEST: 'بيان الإصدار (release.json) غير صالح',
  CHECKSUM_MISMATCH: 'بصمة sha256 في البيان لا تطابق بصمة الحزمة',
};
