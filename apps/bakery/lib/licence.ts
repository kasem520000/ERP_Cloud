/**
 * 🏪 ترخيص باقة المخابز — القرار وحده، دالّةً صافيةً تُقاس بلا جلسة ولا شبكة.
 *
 * الباقة `bakery_distribution` **قطاعية** (`category: 'sector'`) في كتالوج السوق، وتبعاً لذلك:
 *   • تفعيلها قرارُ منصّةٍ لا قرارُ مستأجر — `POST /marketplace/apps/:code/request` ثمّ
 *     `POST /platform/marketplace/requests/:id/decide` (أو تمكينٌ مباشر من لوحة المنصة)،
 *   • و`POST /marketplace/apps/:code/install` عليها يُرفض **403**
 *     ‏`ADDON_REQUIRES_PLATFORM_APPROVAL` (قُيس في `apps/api/test/marketplace-sector-licensing.spec.ts`).
 *
 * ومصدرُ الحقيقة هنا `enabledApps` من `GET /me`، لا كتالوج السوق: الكتالوج يحتاج
 * `tenant.view` ولا يملكه مندوبُ توزيع، والترخيصُ يجب أن يعرفه كلّ عضوٍ في المنشأة —
 * وإلّا صار الباب إمّا مفتوحاً بلا فحص (فشلٌ مفتوح) أو مُقفلاً في وجه من لا علاقة له
 * بصلاحية الكتالوج. والحقل أُضيف إلى `/me` في المرحلة 2 نفسها وقيس قبل/بعد الاعتماد.
 *
 * والاتجاه عند الشكّ **مغلق**: `unknown` (الخادم لم يُعِد الحقل) لا تُعامل معاملة
 * «مرخَّص» — الواجهة تقول «تعذّر التأكّد» وتعرض إعادة المحاولة بدل أن تعمل نصف عمل.
 */

/** كود الباقة كما هو في كتالوج السوق (`SECTOR_ADDON_APPS`) وفي `tenant_apps.app_code`. */
export const BAKERY_APP_CODE = 'bakery_distribution';

export type LicenceVerdict = 'loading' | 'licensed' | 'unlicensed' | 'unknown';

export type LicenceFacts = {
  /** هل حُلَّت الجلسة وعُرفت الهوية؟ */
  authenticated: boolean;
  /** ‏`enabledApps` من `/me` — ‏`undefined`/`null` يعني أنّ الخادم لم يقل. */
  enabledApps?: string[] | null;
};

export function licenceVerdict({ authenticated, enabledApps }: LicenceFacts): LicenceVerdict {
  if (!authenticated) return 'loading';
  if (!Array.isArray(enabledApps)) return 'unknown';
  return enabledApps.includes(BAKERY_APP_CODE) ? 'licensed' : 'unlicensed';
}

export type LicenceCopy = { title: string; body: string; steps: readonly string[] };

/**
 * نصّ الرفض — ولا نسخة لـ `licensed`/`loading` لأنّهما لا يرسمان جداراً: فلو وُجد نصّ
 * «مرخَّص» هنا لاستُعمل يوماً في ادّعاء ترخيصٍ لم يُتحقّق منه.
 */
export const LICENCE_COPY: Record<'unlicensed' | 'unknown', LicenceCopy> = {
  unlicensed: {
    title: 'باقة المخابز غير مرخَّصة لهذه المنشأة',
    body: 'هذه الواجهة ترفض العمل بلا ترخيص بدل أن تعمل ناقصة: لا دفعة إنتاج ولا حمولة ولا تحصيل حتى تُفعَّل الباقة القطاعية للمنشأة. والتفعيل قرارُ منصّة، فلا يستطيع مدير المنشأة تفعيلها بنفسه من السوق.',
    steps: [
 'من لوحة التحكم (staff): الإعدادات سوق الإضافات «المخابز: الإنتاج والتوزيع» طلب التفعيل.',
 'يصل الطلب إلى مالك المنصة ويقرّه من لوحة المنصة السوق الطلبات المعلقة.',
      'بعد القرار تُفتح هذه الواجهة عند أول إقلاع: الترخيص يُقرأ من GET /me ولا يُخبَّأ في المتصفح.',
    ],
  },
  unknown: {
    title: 'تعذّر التأكّد من ترخيص الباقة',
    body: 'الخادم لم يُعِد enabledApps في GET /me، والواجهة لا تفترض الترخيص ولا تنفيه. السبب المعتاد نسخة API أقدم من هذه الواجهة.',
    steps: [
      'أعد المحاولة بعد تحديث الخادم (apps/api نفسها نسخة المستودع).',
      'إن استمرّ فالخلل في الخادم لا في هذه الواجهة، ولا يُحلّ بإعادة الدخول.',
    ],
  },
};
