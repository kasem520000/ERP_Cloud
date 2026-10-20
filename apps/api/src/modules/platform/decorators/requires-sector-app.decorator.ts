import { SetMetadata } from '@nestjs/common';

/**
 * 🏪 ترخيص الباقات القطاعية على الخادم.
 *
 * الصلاحيات وحدها ليست ترخيصاً: الترحيل `0126` منح أكواد `van_sales.*` للأدوار القائمة،
 * وإخفاء الشاشة في الواجهة (`apps/staff/components/app-shell.tsx`) ليس ضبط وصول — فمنشأةٌ
 * بلا باقة كانت تُجاب 200 على `/van-sales/*`. هذه الزخرفة تقول أيّ باقةٍ تفتح السطح،
 * و`SectorLicenceGuard` (آخر الحراس) ينفّذ.
 */
export const SECTOR_APP_KEY = 'erp:requiredSectorApps';

/** وضع الفحص حين لا تملك المنشأة أيّاً من الباقات المطلوبة. */
export type SectorLicenceMode =
  /** يمرّ الطلب ويُكتب سطرٌ في `audit_log` — قياسٌ قبل القرار التجاري بالفرض. */
  | 'observe'
  /** رفض 403 ‏`ADDON_NOT_LICENSED`. */
  | 'enforce';

export type SectorAppRequirement = {
  /**
   * «أيٌّ من»: يكفي أن تملك المنشأة واحدةً منها. تطبيق المخابز مثلاً يستعمل نفس نقاط
   * نهاية `van-sales`، فـ`bakery_distribution` تفتحها كما تفتحها `van_sales`.
   */
  apps: string[];
  /**
   * الافتراضي **`enforce`** (فشلٌ مقفل): سطحٌ جديد يُفرض من يومه الأول، والسطح القائم الذي
   * لم يُفرض يوماً يعلن `observe` صراحةً بدل أن يُفرض على منشآتٍ تعمل.
   */
  mode?: SectorLicenceMode;
};

export const RequiresSectorApp = (requirement: SectorAppRequirement) =>
  SetMetadata(SECTOR_APP_KEY, requirement);
