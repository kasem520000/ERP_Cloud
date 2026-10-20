import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { env } from '@erp/config';
import { DomainError, errorCodes, newId } from '@erp/contracts';
import {
  MARKETPLACE_APPS,
  MarketplaceRuleError,
  assertReviewedApp,
  enabledScreenHrefs,
  gatedScreenHrefs,
  normaliseDomain,
  txtMatches,
  verificationTxt,
  withPlatformAdminTx,
  withTenantTx,
  type DatabaseHandle,
  type DrizzleTx,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { isUniqueViolation } from '../organization/shared/org-support.js';
import { signedContentUrl } from '../platform-services/files/download-token.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * 🏪 قياسُ الاستعمال غير المرخّص: الفعلُ الذي يكتبه `SectorLicenceGuard` في وضع `observe`
 * لكلّ **كتابةٍ** من منشأةٍ بلا باقة (ولا يكتب للقراءات). الاسم نفسه في
 * `apps/api/src/modules/platform/guards/sector-licence.guard.ts` وفي أحكام
 * `apps/api/test/sector-licence-enforcement.spec.ts` — فلو تغيّر هناك تغيّر القياس هنا.
 */
const SECTOR_LICENCE_ACTION = 'sector_licence.unlicensed_use';
/** منشآتٌ تُفصَّل في الاستجابة (الأحدثُ قياساً أولاً)، وما زاد يُعدّ في الملخّص ويُعلن `truncated`. */
const UNLICENSED_USAGE_TENANT_LIMIT = 50;
/** مجموعاتُ (منشأة، فعل، مسار) في تفصيل المسارات — لا صفوفٌ خام. */
const UNLICENSED_USAGE_PATH_LIMIT = 400;
/** مساراتٌ تُعرض لكلّ منشأة. */
const UNLICENSED_USAGE_TOP_PATHS = 5;
/** طلباتُ تفعيلٍ تُقرأ لمطابقتها بالمنشآت المقاسة (الأحدثُ أولاً). */
const UNLICENSED_USAGE_REQUEST_LIMIT = 200;
const UNLICENSED_USAGE_DEFAULT_DAYS = 90;
const UNLICENSED_USAGE_MAX_DAYS = 3650;

export const SECTOR_ADDON_APPS = [
  {
    code: 'van_sales',
    nameAr: 'توزيع المناديب والمخابز',
    nameEn: 'Van Sales & Bakery Distribution',
    descriptionAr:
      'إدارة سيارات ومناديب التوزيع، أوامر التحميل ودفعات الإنتاج اليومية، ضبط البونص المجاني، تعدد أسعار العملاء، والفواتير الضريبية والعادية.',
    icon: '🚚',
    version: '1.0.0',
    monthlyPrice: '129.0000',
    isCore: false,
    category: 'sector' as const,
    screens: ['/van-sales'] as const,
  },
  {
    /**
     * 🥖 باقة المخابز: الإنتاج والتوزيع والمناديب — تطبيقٌ مستقلّ (`apps/bakery` على
     * `bakery.erp.example`) فوق الـ API نفسه وعقود الصلاحيات نفسها، لا محرك محاسبةٍ ولا
     * مخازن ثانيًا. ليست `van_sales` ولا `manufacturing` باسمٍ آخر: الترخيص قرارٌ مستقلّ
     * للمنصة لكلّ منشأة، والشاشات التفصيلية (محاسبة/مشتريات/مخازن) تُفتح بتسليم جلسةٍ
     * إلى `staff` فلا تُعاد كتابتها هنا.
     *
     * `screens` فارغة عن قصد: هذه الباقة لا تحجب شاشةً في `staff` (لا مسار لها فيه)،
     * وترخيصها يُقاس بوجود الكود في `enabledCodes` من `GET /marketplace/apps` — وهو ما
     * تقرأه واجهة المخابز نفسها قبل أن تفتح أيّ مسارٍ من مساراتها.
     */
    code: 'bakery_distribution',
    nameAr: 'المخابز: الإنتاج والتوزيع',
    nameEn: 'Bakery Production & Distribution',
    descriptionAr:
      'تطبيق المخابز المستقلّ: دفعات الإنتاج اليومية بموادها الحقيقية ورفض الدفعة بلا مصدر مواد، جولات التوزيع وسياراته والعهدات، المناديب (مستخدمٌ وموظفٌ وصلاحياتٌ يمنحها المدير)، التحصيل والخزينة وإغلاق اليومية — على المحاسبة والمخازن نفسها.',
    icon: '🥖',
    version: '1.0.0',
    monthlyPrice: '149.0000',
    isCore: false,
    category: 'sector' as const,
    screens: [] as readonly string[],
  },
  {
    code: 'manufacturing',
    nameAr: 'التصنيع والإنتاج',
    nameEn: 'Manufacturing',
    descriptionAr: 'أوامر التصنيع وقوائم المواد (BOM) وتكاليف الإنتاج للمصانع والمعامل والمخابز.',
    icon: '⚙️',
    version: '1.0.0',
    monthlyPrice: '149.0000',
    isCore: false,
    category: 'sector' as const,
    screens: ['/manufacturing/orders', '/inventory/production'] as const,
  },
  {
    code: 'tailoring',
    nameAr: 'التفصيل والخياطة',
    nameEn: 'Tailoring',
    descriptionAr: 'إدارة طلبات التفصيل والمقاسات وخيارات الخياطة والأثواب.',
    icon: '🧵',
    version: '1.0.0',
    monthlyPrice: '99.0000',
    isCore: false,
    category: 'sector' as const,
    screens: ['/tailoring/orders', '/tailoring/options', '/tailoring/types', '/settings/tailoring'] as const,
  },
  {
    code: 'optics',
    nameAr: 'النظارات والبصريات',
    nameEn: 'Optics',
    descriptionAr: 'بيانات فحص النظر والعدسات اليمنى واليسرى وطباعتها في فواتير المبيعات.',
    icon: '👓',
    version: '1.0.0',
    monthlyPrice: '99.0000',
    isCore: false,
    category: 'sector' as const,
    screens: ['/optics/glasses', '/settings/optics'] as const,
  },
  {
    code: 'marina',
    nameAr: 'إدارة المراسي والقوارب',
    nameEn: 'Marina',
    descriptionAr: 'عقود المراسي والتجهيز والمناوبات وربط الفواتير وإغلاق اليومية البحرية.',
    icon: '⚓',
    version: '1.0.0',
    monthlyPrice: '149.0000',
    isCore: false,
    category: 'sector' as const,
    screens: [
      '/marina/contracts',
      '/marina/preparation',
      '/marina/rota',
      '/marina/link-invoices',
      '/marina/day-close',
      '/settings/marina',
    ] as const,
  },
  {
    code: 'projects',
    nameAr: 'إدارة المشاريع والمقاولات',
    nameEn: 'Projects & Contracting',
    descriptionAr: 'المشاريع وعقود المقاولين والمستخلصات ومرتجعات المقاولات ومتابعة التنفيذ.',
    icon: '🏗️',
    version: '1.0.0',
    monthlyPrice: '149.0000',
    isCore: false,
    category: 'sector' as const,
    screens: [
      '/projects',
      '/projects/tasks',
      '/projects/contractor-contract',
      '/projects/contractor-payment',
      '/projects/contracting-return',
      '/projects/offers',
      '/projects/followup',
      '/settings/contracting',
    ] as const,
  },
  {
    /**
     * 📊 باقة التقارير — تُرخَّص السطوح **التحليلية** وحدها (باني التقارير، التقارير المحفوظة،
     * مصمّمها)، ولا تلمس مركز التقارير: تقريرٌ واحد يفتحه كل مستخدمٍ منذ أول يوم ليس بضاعةً
     * جديدة تُباع، وإنما الشاشات التي تُنشئ تقاريرَ لم تكن موجودة.
     *
     * و`custom-reports` (خلف هذه الشاشات) يحمل الحارس في وضع `observe`: كتاباتُ منشأةٍ بلا
     * ترخيص تُقاس في `audit_log` ولا تُرفض، فالقرار في الفرض يُتخذ على بياناتٍ لا على تقدير.
     */
    code: 'reports_pro',
    nameAr: 'مركز التقارير والتحليلات',
    nameEn: 'Reports & Analytics',
    descriptionAr:
      'باني التقارير من حقولك الأصلية والمخصّصة، حفظُ التقارير المشتركة وإعادة تشغيلها، مصمّم أعمدة التقارير، والتصدير إلى Excel وCSV وPDF.',
    icon: '📊',
    version: '1.0.0',
    monthlyPrice: '79.0000',
    isCore: false,
    category: 'sector' as const,
    screens: ['/reports/builder', '/reports/custom', '/support/report-designer'] as const,
  },
  {
    /**
     * ✉️ قناة البريد الإلكتروني — باقةٌ تُرخَّص لأن القناة نفسها هي السطح: مزوّد SMTP وحصةُ
     * إرسالٍ تكلّف المنصة مالاً لكل رسالة. لا شاشة تُحجب هنا (`screens` فارغة): شاشة
     * `/settings/email` تبقى لكل منشأة، والحارس يقيس الكتابات في `observe` بدل أن يقطع
     * الإرسال عن منشأةٍ تعمل اليوم.
     *
     * والقياس هو ما يجعل الباقة قابلةً للفرض لاحقاً: `email_pro` ككودٍ في `tenant_apps`
     * تعني «هذه المنشأة اشترت القناة»، وسطر `sector_licence.unlicensed_use` يعني «هذه
     * منشأة تستعملها بلا شراء» — وعلى البيانات يُبنى قرار الفرض.
     */
    code: 'email_pro',
    nameAr: 'قناة البريد الإلكتروني',
    nameEn: 'Email Channel',
    descriptionAr:
      'إرسال الفواتير والكشوف وتنبيهات النظام عبر SMTP الخاصّ بمنشأتك أو مزوّد المنصة، مع قوالب عربية/إنجليزية لكل حدثٍ وسجلٍّ للرسائل.',
    icon: '✉️',
    version: '1.0.0',
    monthlyPrice: '39.0000',
    isCore: false,
    category: 'sector' as const,
    screens: [] as readonly string[],
  },
  {
    /**
     * 💬 قناة واتساب — نفس المنطق: الرقم والرمز ورسوم المحادثات على المنصة، فالترخيص يعني
     * «هذه المنشأة تملك قناةً» لا «هذه الشاشة مخفيّة». الإرسال يبقى عاملاً في وضع القياس.
     */
    code: 'whatsapp',
    nameAr: 'قناة واتساب للأعمال',
    nameEn: 'WhatsApp Business',
    descriptionAr:
      'إرسال الفواتير وروابط الدفع وتذكيرات التحصيل على واتساب من رقم المنشأة عبر WhatsApp Cloud API، مع سجلّ الرسائل وحالتها.',
    icon: '💬',
    version: '1.0.0',
    monthlyPrice: '49.0000',
    isCore: false,
    category: 'sector' as const,
    screens: [] as readonly string[],
  },
  {
    code: 'employee_app',
    nameAr: 'تطبيق الموظف الذاتي',
    nameEn: 'Employee Self-Service App',
    descriptionAr: 'بوابة الجوال للموظفين لتسجيل الحضور والانصراف وطلبات الإجازة والسلفة والعهدة وكشف الراتب.',
    icon: '📱',
    version: '1.0.0',
    monthlyPrice: '79.0000',
    isCore: false,
    category: 'sector' as const,
    screens: ['/m', '/m/attendance', '/m/requests/new', '/m/approvals', '/m/profile'] as const,
  },
] as const;

export const ALL_CATALOG_APPS = [
  ...MARKETPLACE_APPS.map((app) => ({
    ...app,
    category: (app.isCore ? 'core' : 'integration') as 'core' | 'integration' | 'sector',
  })),
  ...SECTOR_ADDON_APPS,
];

type AppView = {
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  icon: string;
  version: string;
  monthlyPrice: string;
  isCore: boolean;
  isActive: boolean;
  enabled: boolean;
  installedAt: string | null;
  screens: string[];
  category?: 'core' | 'integration' | 'sector';
  requiresApproval?: boolean;
  requestStatus?: 'none' | 'pending' | 'approved' | 'rejected';
  requestNote?: string | null;
  decisionNote?: string | null;
};

export type MarketplaceList = {
  apps: AppView[];
  gatedHrefs: string[];
  enabledHrefs: string[];
  enabledCodes?: string[];
};

export type AddonRequestView = {
  id: string;
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  appCode: string;
  appNameAr: string;
  appIcon: string;
  monthlyPrice: string;
  status: 'pending' | 'approved' | 'rejected';
  note: string;
  decisionNote: string;
  requesterLabel: string;
  createdAt: string;
  decidedAt: string | null;
};

/** مسارٌ قِيست عليه كتاباتٌ غير مرخّصة (‏`meta.method` و`meta.path` من سطر التدقيق). */
export type UnlicensedUsagePathView = {
  method: string;
  path: string;
  writes: number;
};

export type UnlicensedUsageTenantView = {
  tenantId: string;
  tenantCode: string;
  tenantName: string;
  tenantStatus: string;
  /** «أيٌّ من» كما أعلنها المزيّنُ وكتبها الحارس: يكفي واحدةٌ منها لفتح السطح. */
  requiredApps: string[];
  /** عددُ الكتابات المقاسة في الفترة، وعددُ المستخدمين المتمايزين الذين قاموا بها. */
  writes: number;
  actors: number;
  firstAt: string | null;
  lastAt: string | null;
  topPaths: UnlicensedUsagePathView[];
  /**
   * حالةُ الترخيص **الآن** لا لحظة القياس: `licensed` تعني أنّ صفوف التدقيق تاريخٌ وقد حُسم
   * الأمر (فُعّلت الباقة بعدها)، و`disabled` أنّ صفاً موجودٌ لكنه مُطفأ — وهي حالةٌ تختلف
   * تجارياً عن «لم يطلبها أصلاً» لأنّ قراراً اتُّخذ ثمّ أُوقف.
   */
  licence: {
    state: 'unlicensed' | 'disabled' | 'licensed';
    enabledApps: string[];
    installedAt: string | null;
  };
  /** أحدثُ طلب تفعيلٍ لإحدى الباقات المطلوبة — فـ«طلبٌ معلّق منذ أسبوع» هو الإجراءُ المطلوب. */
  pendingRequest: { appCode: string; status: string; createdAt: string } | null;
  /**
   * حجمُ العمل الحقيقي في جداول التوزيع: الطلباتُ تقول «كم مرّةً حاولوا»، وهذه تقول «كم عملاً
   * سيقف لو فُرض الترخيص غداً» — والقرارُ التجاري يحتاج الثانية.
   *
   * وهذه الأعداد **بلا نافذة** (كلُّ ما في جداول المنشأة) بينما `writes` مقيّدةٌ بـ`observedDays`:
   * فالتعرّضُ الذي يُقاس عليه قرارُ الفرض مجموعُه لا آخرُ تسعين يوماً منه، وأمّا الطلبات فنافذتها
   * تُظهر إن كان الاستعمال جارياً أم منتهيًا.
   */
  footprint: {
    loadOrders: number;
    documents: number;
    productionBatches: number;
    stockMovements: number;
    lastActivityAt: string | null;
  };
};

export type UnlicensedUsageView = {
  observedDays: number;
  generatedAt: string;
  windowStartsAt: string;
  /** الأوضاعُ التي كُتبت بها الصفوف في الفترة — ‏`observe` اليوم، و`enforce` تعني أنّ سطراً رُفض. */
  modes: string[];
  summary: {
    /** منشآتٌ قِيست في الفترة كلّها (قبل حدّ التفصيل). */
    measuredTenants: number;
    /** منشآتٌ فُصّلت أدناه. */
    listedTenants: number;
    /** منها بلا باقةٍ مفعّلة الآن — هي محلّ القرار. */
    stillUnlicensed: number;
    /** منها فعّلت الباقة بعد القياس — تاريخٌ لا إجراء. */
    licensedSince: number;
    /** كتاباتُ الفترة كلّها. */
    writes: number;
    /** كتاباتُ المنشآت المفصّلة وحدها — والاثنان يختلفان حين `truncated`. */
    listedWrites: number;
    actors: number;
    oldestAt: string | null;
    newestAt: string | null;
  };
  /** هل فُصّلت كلّ المنشآت المقاسة أم أنّ القائمة مقطوعة عند الحدّ. */
  truncated: boolean;
  tenants: UnlicensedUsageTenantView[];
};

type DomainView = {
  id: string;
  domain: string;
  status: string;
  sslStatus: string;
  txtHost: string;
  txtValue: string;
  verifiedAt: string | null;
};

type BrandingView = {
  logoFileId: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  nameAr: string;
  nameEn: string;
};

type PublicBrand = {
  tenantCode: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
};

@Injectable()
export class MarketplaceService {
  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle) {}

  async listForTenant(tenantId: string): Promise<MarketplaceList> {
    await this.ensureCatalog();
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const apps = await this.listInside(tx, tenantId);
      const enabledCodes = apps.filter((app) => app.enabled).map((app) => app.code);
      const allGatedHrefs = [
        ...new Set([
          ...gatedScreenHrefs(),
          ...ALL_CATALOG_APPS.flatMap((app) => [...app.screens]),
        ]),
      ];
      const allEnabledHrefs = [
        ...new Set([
          ...enabledScreenHrefs(enabledCodes),
          ...ALL_CATALOG_APPS.filter((app) => app.isCore || enabledCodes.includes(app.code)).flatMap((app) => [
            ...app.screens,
          ]),
        ]),
      ];
      return {
        apps,
        gatedHrefs: allGatedHrefs,
        enabledHrefs: allEnabledHrefs,
        enabledCodes,
      };
    });
  }

  async requestActivation(
    tenantId: string,
    userId: string,
    code: string,
    note?: string,
  ): Promise<{ requestId: string; status: string; app: AppView }> {
    const app = this.reviewed(code);
    await this.ensureCatalog();
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const stored = first(await tx.execute(sql`
        SELECT is_active FROM marketplace_apps WHERE code = ${app.code} LIMIT 1
      `));
      if (!stored || !flag(stored.is_active)) {
        throw new DomainError(errorCodes.NOT_FOUND, 'الإضافة غير متاحة في السوق', 404);
      }
      const existingPending = first(await tx.execute(sql`
        SELECT id FROM marketplace_addon_requests
        WHERE tenant_id = ${tenantId}::uuid AND app_code = ${app.code} AND status = 'pending'
        ORDER BY created_at DESC LIMIT 1
      `));
      const reqId = existingPending ? str(existingPending.id) : newId();
      const cleanNote = String(note ?? '').trim().slice(0, 500) || null;
      if (existingPending) {
        await tx.execute(sql`
          UPDATE marketplace_addon_requests
          SET note = COALESCE(${cleanNote}, note), requested_by = ${userId}::uuid, updated_at = now()
          WHERE id = ${reqId}::uuid AND tenant_id = ${tenantId}::uuid
        `);
      } else {
        await tx.execute(sql`
          INSERT INTO marketplace_addon_requests (id, tenant_id, app_code, status, requested_by, note)
          VALUES (${reqId}::uuid, ${tenantId}::uuid, ${app.code}, 'pending', ${userId}::uuid, ${cleanNote})
        `);
      }
      const list = await this.listInside(tx, tenantId);
      const view = list.find((item) => item.code === app.code);
      if (!view) throw new DomainError(errorCodes.NOT_FOUND, 'الإضافة غير متاحة في السوق', 404);
      return { requestId: reqId, status: 'pending', app: view };
    });
  }

  async install(tenantId: string, userId: string, code: string): Promise<AppView> {
    const app = this.reviewed(code);
    /**
     * الباقة القطاعية تُرخَّص بقرار المنصة، لا بصلاحية المستأجر. الشاشة تُخفي زرّ
     * التثبيت أصلًا (`requiresApproval`) وتعرض «طلب تفعيل» — لكن إخفاء الزرّ ليس ضبطًا
     * للوصول، فأيّ حامل `tenant.apps.manage` كان يستطيع تفعيل باقةٍ مدفوعة بطلبٍ واحد.
     * المسار الصحيح: `POST /marketplace/apps/:code/request` ثمّ قرار مالك المنصة في
     * `POST /platform/marketplace/requests/:id/decide` (أو تفعيل المنصة المباشر في
     * `PUT /platform/marketplace/tenants/:tenantId/apps/:code`)، وكلاهما يكتب `tenant_apps`.
     */
    if ('category' in app && app.category === 'sector') {
      throw new DomainError(
        errorCodes.ADDON_REQUIRES_PLATFORM_APPROVAL,
        `باقة «${app.nameAr}» تُرخَّص من المنصة: أرسل طلب تفعيلٍ ويُقرَّر من هناك.`,
        403,
      );
    }
    await this.ensureCatalog();
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const stored = first(await tx.execute(sql`
        SELECT is_active FROM marketplace_apps WHERE code = ${app.code} LIMIT 1
      `));
      if (!stored || !flag(stored.is_active)) {
        throw new DomainError(errorCodes.NOT_FOUND, 'الإضافة غير متاحة في السوق', 404);
      }
      await tx.execute(sql`
        INSERT INTO tenant_apps (id, tenant_id, app_code, is_enabled, settings, installed_at, installed_by)
        VALUES (${newId()}::uuid, ${tenantId}::uuid, ${app.code}, true, '{}'::jsonb, now(), ${userId}::uuid)
        ON CONFLICT (tenant_id, app_code) DO UPDATE
          SET is_enabled = true, updated_at = now()
      `);
      const list = await this.listInside(tx, tenantId);
      const view = list.find((item) => item.code === app.code);
      if (!view) throw new DomainError(errorCodes.NOT_FOUND, 'الإضافة غير متاحة في السوق', 404);
      return view;
    });
  }

  async uninstall(tenantId: string, code: string): Promise<AppView> {
    const app = this.reviewed(code);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const updated = rows(await tx.execute(sql`
        UPDATE tenant_apps
        SET is_enabled = false, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND app_code = ${app.code}
        RETURNING app_code
      `));
      if (!updated[0]) throw new DomainError(errorCodes.NOT_FOUND, 'الإضافة غير مثبّتة', 404);
      const list = await this.listInside(tx, tenantId);
      const view = list.find((item) => item.code === app.code);
      if (!view) throw new DomainError(errorCodes.NOT_FOUND, 'الإضافة غير مثبّتة', 404);
      return view;
    });
  }

  async listDomains(tenantId: string): Promise<DomainView[]> {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const found = rows(await tx.execute(sql`
        SELECT id, domain, status, ssl_status, verification_token, verified_at
        FROM tenant_domains
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        ORDER BY created_at
      `));
      return found.map(toDomain);
    });
  }

  async addDomain(tenantId: string, raw: string): Promise<DomainView> {
    const domain = this.domainOf(raw);
    const token = randomBytes(16).toString('hex');
    try {
      return await withTenantTx(this.database.db, tenantId, async (tx) => {
        const inserted = first(await tx.execute(sql`
          INSERT INTO tenant_domains (id, tenant_id, domain, status, ssl_status, verification_token)
          VALUES (${newId()}::uuid, ${tenantId}::uuid, ${domain}, 'pending', 'manual', ${token})
          RETURNING id, domain, status, ssl_status, verification_token, verified_at
        `));
        if (!inserted) throw new DomainError(errorCodes.INTERNAL, 'تعذر حفظ الدومين', 500);
        return toDomain(inserted);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'هذا الدومين مستخدم', 422, { field: 'domain' });
      }
      throw error;
    }
  }

  async removeDomain(tenantId: string, id: string): Promise<{ id: string }> {
    this.uuid(id);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const removed = rows(await tx.execute(sql`
        UPDATE tenant_domains
        SET deleted_at = now(), updated_at = now()
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        RETURNING id
      `));
      if (!removed[0]) throw new DomainError(errorCodes.NOT_FOUND, 'الدومين غير موجود', 404);
      return { id };
    });
  }

  async verifyDomain(tenantId: string, id: string): Promise<DomainView> {
    this.uuid(id);
    const pending = await withTenantTx(this.database.db, tenantId, async (tx) =>
      first(await tx.execute(sql`
        SELECT id, domain, verification_token
        FROM tenant_domains
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        LIMIT 1
      `)),
    );
    if (!pending) throw new DomainError(errorCodes.NOT_FOUND, 'الدومين غير موجود', 404);
    const challenge = verificationTxt(str(pending.domain), str(pending.verification_token));
    const records = await this.lookupTxt(challenge.host);
    if (!txtMatches(challenge.value, records)) {
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        `لم يُعثر على سجل TXT. أضف ${challenge.host} بالقيمة ${challenge.value}`,
        422,
        { field: 'domain' },
      );
    }
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const updated = first(await tx.execute(sql`
        UPDATE tenant_domains
        SET status = 'active', verified_at = now(), updated_at = now()
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        RETURNING id, domain, status, ssl_status, verification_token, verified_at
      `));
      if (!updated) throw new DomainError(errorCodes.NOT_FOUND, 'الدومين غير موجود', 404);
      return toDomain(updated);
    });
  }

  async branding(tenantId: string): Promise<BrandingView> {
    return withTenantTx(this.database.db, tenantId, async (tx) => this.readBrand(tx, tenantId));
  }

  async saveBranding(
    tenantId: string,
    input: { logoFileId?: unknown; primaryColor?: unknown; secondaryColor?: unknown },
  ): Promise<BrandingView> {
    const primary = colorOf(input.primaryColor, 'primaryColor');
    const secondary = colorOf(input.secondaryColor, 'secondaryColor');
    const logoFileId = optionalUuid(input.logoFileId);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      if (logoFileId) await this.assertLogo(tx, tenantId, logoFileId);
      await tx.execute(sql`
        INSERT INTO tenant_branding (tenant_id, logo_file_id, primary_color, secondary_color, updated_at)
        VALUES (
          ${tenantId}::uuid,
          ${logoFileId}::uuid,
          ${primary},
          ${secondary},
          now()
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
          logo_file_id = EXCLUDED.logo_file_id,
          primary_color = EXCLUDED.primary_color,
          secondary_color = EXCLUDED.secondary_color,
          updated_at = now()
      `);
      return this.readBrand(tx, tenantId);
    });
  }

  /**
   * One active domain, looked up by `app.lookup_host`. The GUC is set only for this
   * statement's transaction, and the policy matches that host alone.
   */
  async resolveHost(rawHost: string): Promise<PublicBrand | null> {
    let host: string;
    try {
      host = normaliseDomain(rawHost);
    } catch {
      return null;
    }
    const found = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.lookup_host', ${host}, true)`);
      return first(await tx.execute(sql`
        SELECT d.tenant_id, t.code AS tenant_code, t.name,
               b.primary_color, b.secondary_color, b.logo_file_id
        FROM tenant_domains d
        JOIN tenants t ON t.id = d.tenant_id
        LEFT JOIN tenant_branding b ON b.tenant_id = d.tenant_id
        WHERE d.domain = ${host} AND d.status = 'active' AND d.deleted_at IS NULL
        LIMIT 1
      `));
    });
    if (!found) return null;
    const tenantId = str(found.tenant_id);
    const logoFileId = str(found.logo_file_id);
    return {
      tenantCode: str(found.tenant_code),
      name: str(found.name),
      primaryColor: str(found.primary_color),
      secondaryColor: str(found.secondary_color),
      logoUrl: logoFileId ? this.logoUrl(tenantId, logoFileId) : '',
    };
  }

  async platformList() {
    await this.ensureCatalog();
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const stored = rows(await tx.execute(sql`
        SELECT code, price_monthly::text AS monthly_price, is_active
        FROM marketplace_apps
        ORDER BY code
      `));
      const byCode = new Map(stored.map((row) => [str(row.code), row]));
      return ALL_CATALOG_APPS.map((app) => {
        const row = byCode.get(app.code);
        return {
          code: app.code,
          nameAr: app.nameAr,
          nameEn: app.nameEn,
          descriptionAr: app.descriptionAr,
          icon: app.icon,
          category: app.category,
          monthlyPrice: moneyText(row?.monthly_price ?? app.monthlyPrice),
          isCore: app.isCore,
          isActive: row ? flag(row.is_active) : true,
          screens: [...app.screens],
        };
      });
    });
  }

  async platformListRequests(status?: string): Promise<AddonRequestView[]> {
    await this.ensureCatalog();
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const found = rows(await tx.execute(sql`
        SELECT r.id::text, r.tenant_id::text, t.code AS tenant_code, t.name AS tenant_name,
               r.app_code, r.status, r.note, r.decision_note,
               COALESCE(u.full_name, u.email, 'مستخدم المنشأة') AS requester_label,
               r.created_at, r.decided_at
        FROM marketplace_addon_requests r
        JOIN tenants t ON t.id = r.tenant_id
        LEFT JOIN users u ON u.id = r.requested_by
        WHERE (${status ?? null}::text IS NULL OR r.status = ${status ?? null})
        ORDER BY CASE r.status WHEN 'pending' THEN 0 ELSE 1 END, r.created_at DESC
        LIMIT 200
      `));
      const prices = rows(await tx.execute(sql`
        SELECT code, price_monthly::text AS monthly_price FROM marketplace_apps
      `));
      const priceMap = new Map(prices.map((row) => [str(row.code), str(row.monthly_price)]));
      const appMap = new Map(ALL_CATALOG_APPS.map((app) => [app.code, app]));
      return found.map((row) => {
        const appCode = str(row.app_code);
        const app = appMap.get(appCode);
        return {
          id: str(row.id),
          tenantId: str(row.tenant_id),
          tenantCode: str(row.tenant_code),
          tenantName: str(row.tenant_name),
          appCode,
          appNameAr: app?.nameAr ?? appCode,
          appIcon: app?.icon ?? '📦',
          monthlyPrice: moneyText(priceMap.get(appCode) ?? app?.monthlyPrice ?? '0'),
          status: (str(row.status) || 'pending') as 'pending' | 'approved' | 'rejected',
          note: str(row.note),
          decisionNote: str(row.decision_note),
          requesterLabel: str(row.requester_label),
          createdAt: iso(row.created_at),
          decidedAt: row.decided_at ? iso(row.decided_at) : null,
        };
      });
    });
  }

  /**
   * باقات منشأةٍ بعينها كما تراها المنصة: المُثبَّت في `tenant_apps` مطعَّماً بكتالوج القطاع
   * وأسعاره المُراجَعة. شاشة تفاصيل العميل في لوحة المنصة كانت تقرأ مساراً غير موجود إطلاقاً،
   * وهذا هو مصدر البيانات الصحيح لها (قراءة على مستوى المنصة، لا على مستوى المنشأة).
   */
  async platformTenantApps(tenantId: string) {
    this.uuid(tenantId);
    await this.ensureCatalog();
    // الأسعار كتالوجٌ عام على مستوى المنصة…
    const prices = rows(
      await withPlatformAdminTx(this.database.db, async (tx) =>
        tx.execute(sql`SELECT code, price_monthly::text AS monthly_price FROM marketplace_apps`),
      ),
    );
    // …أمّا `tenant_apps` فسياسة عزلها `USING (tenant_id = current_setting('app.tenant_id'))` بلا
    // استثناءٍ للمنصة، فلا تُرى صفوفه إلا داخل سياق المنشأة نفسها — وهذا هو النمط المستعمل في
    // بقية هذا الملف عند كتابة `tenant_apps` من مستوى المنصة (الصلاحية يحسمها حارس الكونسول).
    const scope = await withTenantTx(this.database.db, tenantId, async (tx) => {
      const tenant = first(
        await tx.execute(sql`SELECT id::text, code, name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`),
      );
      if (!tenant) throw new DomainError(errorCodes.NOT_FOUND, 'المنشأة غير موجودة', 404);
      const granted = rows(
        await tx.execute(sql`
          SELECT app_code, is_enabled, installed_at
          FROM tenant_apps WHERE tenant_id = ${tenantId}::uuid ORDER BY app_code
        `),
      );
      return { tenant, granted };
    });
    const priceMap = new Map(prices.map((row) => [str(row.code), str(row.monthly_price)]));
    const grantedMap = new Map(scope.granted.map((row) => [str(row.app_code), row]));
    return {
      tenantId,
      tenantCode: str(scope.tenant.code),
      tenantName: str(scope.tenant.name),
      apps: SECTOR_ADDON_APPS.map((app) => {
        const row = grantedMap.get(app.code);
        return {
          code: app.code,
          nameAr: app.nameAr,
          icon: app.icon,
          monthlyPrice: moneyText(priceMap.get(app.code) ?? app.monthlyPrice ?? '0'),
          requiresApproval: true,
          enabled: row ? flag(row.is_enabled) : false,
          installedAt: row ? iso(row.installed_at) : null,
        };
      }),
    };
  }

  /**
   * 📊 الاستعمالُ غير المرخّص للباقات القطاعية — القياسُ الذي يُتّخذ عليه قرارُ الفرض.
   *
   * المصدرُ `audit_log` وحده: الحارسُ يكتب سطراً لكلّ كتابةٍ من منشأةٍ بلا باقة، فهو سجلٌّ بما
   * وقع فعلاً لا تقديرٌ من وجود شاشاتٍ في الواجهة. ومنه تُعرف المنشآت (قراءةٌ على مستوى المنصّة
   * تجيزها سياسة `platform_admin_plane`)، ثمّ تُسأل كلّ منشأةٍ **في سياقها** عمّا لا يُقرأ من
   * المنصّة: ‏`tenant_apps` (سياسةُ عزله `USING (tenant_id = current_setting('app.tenant_id'))`
   * بلا استثناءٍ للمنصّة، كالنمط المستعمل في `platformTenantApps` أعلاه) وحجمُ العمل في جداول
   * التوزيع. والاستعلامُ لكلّ منشأةٍ على حدة لأنّ بديلَه الوحيد كشفُ `tenant_apps` للمنصّة،
   * وهو توسيعُ عزلٍ لا يُفعل لأجل شاشة.
   *
   * والفهرسُ الجزئيّ `audit_log_sector_licence_use_idx` (الهجرة `0130`) هو ما يجعل هذا التجميع
   * عبر المنشآت متناسباً مع صفوف القياس لا مع حجم السجلّ كله.
   */
  async platformUnlicensedUsage(input: { days?: unknown } = {}): Promise<UnlicensedUsageView> {
    const days = usageWindowDays(input.days);
    const since = new Date(Date.now() - days * 86_400_000);

    const measured = await withPlatformAdminTx(this.database.db, async (tx) => {
      const totals = first(
        await tx.execute(sql`
          SELECT count(*)::int AS writes,
                 count(DISTINCT tenant_id)::int AS tenants,
                 count(DISTINCT actor_user_id)::int AS actors,
                 min(created_at) AS oldest_at,
                 max(created_at) AS newest_at
          FROM audit_log
          WHERE action = ${SECTOR_LICENCE_ACTION} AND created_at >= ${since}
        `),
      );
      const modes = rows(
        await tx.execute(sql`
          SELECT DISTINCT meta->>'mode' AS mode
          FROM audit_log
          WHERE action = ${SECTOR_LICENCE_ACTION} AND created_at >= ${since}
          ORDER BY 1
        `),
      );
      const grouped = rows(
        await tx.execute(sql`
          SELECT a.tenant_id::text, t.code AS tenant_code, t.name AS tenant_name, t.status AS tenant_status,
                 a.entity_id AS required_apps,
                 count(*)::int AS writes,
                 count(DISTINCT a.actor_user_id)::int AS actors,
                 min(a.created_at) AS first_at,
                 max(a.created_at) AS last_at
          FROM audit_log a
          JOIN tenants t ON t.id = a.tenant_id
          WHERE a.action = ${SECTOR_LICENCE_ACTION} AND a.created_at >= ${since}
          GROUP BY a.tenant_id, t.code, t.name, t.status, a.entity_id
          ORDER BY max(a.created_at) DESC, a.tenant_id
          LIMIT ${UNLICENSED_USAGE_TENANT_LIMIT + 1}
        `),
      );
      const paths = rows(
        await tx.execute(sql`
          SELECT tenant_id::text, meta->>'method' AS method, meta->>'path' AS path, count(*)::int AS writes
          FROM audit_log
          WHERE action = ${SECTOR_LICENCE_ACTION} AND created_at >= ${since}
          GROUP BY tenant_id, meta->>'method', meta->>'path'
          ORDER BY count(*) DESC, tenant_id
          LIMIT ${UNLICENSED_USAGE_PATH_LIMIT}
        `),
      );
      const requests = rows(
        await tx.execute(sql`
          SELECT r.tenant_id::text, r.app_code, r.status, r.created_at
          FROM marketplace_addon_requests r
          ORDER BY r.created_at DESC
          LIMIT ${UNLICENSED_USAGE_REQUEST_LIMIT}
        `),
      );
      return { totals, modes, grouped, paths, requests };
    });

    const listed = measured.grouped.slice(0, UNLICENSED_USAGE_TENANT_LIMIT);
    const truncated = measured.grouped.length > UNLICENSED_USAGE_TENANT_LIMIT;

    const pathsByTenant = new Map<string, UnlicensedUsagePathView[]>();
    for (const row of measured.paths) {
      const tenantId = str(row.tenant_id);
      const bucket = pathsByTenant.get(tenantId) ?? [];
      bucket.push({ method: str(row.method), path: str(row.path), writes: Number(row.writes ?? 0) });
      pathsByTenant.set(tenantId, bucket);
    }

    const tenants: UnlicensedUsageTenantView[] = [];
    for (const row of listed) {
      const tenantId = str(row.tenant_id);
      const requiredApps = str(row.required_apps)
        .split('|')
        .map((code) => code.trim())
        .filter((code) => code.length > 0);

      const scope = await withTenantTx(this.database.db, tenantId, async (tx) => {
        const granted = rows(
          await tx.execute(sql`
            SELECT app_code, is_enabled, installed_at FROM tenant_apps ORDER BY app_code
          `),
        );
        const footprint = first(
          await tx.execute(sql`
            SELECT (SELECT count(*)::int FROM van_load_orders) AS load_orders,
                   (SELECT count(*)::int FROM van_sales_documents) AS documents,
                   (SELECT count(*)::int FROM factory_production_batches) AS production_batches,
                   (SELECT count(*)::int FROM van_stock_movements) AS stock_movements,
                   (SELECT max(created_at) FROM van_load_orders) AS last_load_at,
                   (SELECT max(created_at) FROM van_sales_documents) AS last_document_at,
                   (SELECT max(created_at) FROM factory_production_batches) AS last_batch_at
          `),
        );
        return { granted, footprint };
      });

      const enabledApps = scope.granted.filter((item) => flag(item.is_enabled)).map((item) => str(item.app_code));
      const requiredRows = scope.granted.filter((item) => requiredApps.includes(str(item.app_code)));
      const state = requiredApps.some((code) => enabledApps.includes(code))
        ? 'licensed'
        : requiredRows.length > 0
          ? 'disabled'
          : 'unlicensed';
      const installedAt =
        requiredRows
          .map((item) => (item.installed_at ? iso(item.installed_at) : ''))
          .filter((text) => text.length > 0)
          .sort()
          .pop() ?? null;
      const request = measured.requests.find(
        (item) => str(item.tenant_id) === tenantId && requiredApps.includes(str(item.app_code)),
      );
      const lastActivityAt =
        [scope.footprint?.last_load_at, scope.footprint?.last_document_at, scope.footprint?.last_batch_at]
          .map((value) => (value ? iso(value) : ''))
          .filter((text) => text.length > 0)
          .sort()
          .pop() ?? null;

      tenants.push({
        tenantId,
        tenantCode: str(row.tenant_code),
        tenantName: str(row.tenant_name),
        tenantStatus: str(row.tenant_status),
        requiredApps,
        writes: Number(row.writes ?? 0),
        actors: Number(row.actors ?? 0),
        firstAt: row.first_at ? iso(row.first_at) : null,
        lastAt: row.last_at ? iso(row.last_at) : null,
        topPaths: (pathsByTenant.get(tenantId) ?? []).slice(0, UNLICENSED_USAGE_TOP_PATHS),
        licence: {
          state,
          enabledApps: enabledApps.filter((code) => requiredApps.includes(code)),
          installedAt,
        },
        pendingRequest: request
          ? {
              appCode: str(request.app_code),
              status: str(request.status) || 'pending',
              createdAt: request.created_at ? iso(request.created_at) : '',
            }
          : null,
        footprint: {
          loadOrders: Number(scope.footprint?.load_orders ?? 0),
          documents: Number(scope.footprint?.documents ?? 0),
          productionBatches: Number(scope.footprint?.production_batches ?? 0),
          stockMovements: Number(scope.footprint?.stock_movements ?? 0),
          lastActivityAt,
        },
      });
    }

    return {
      observedDays: days,
      generatedAt: new Date().toISOString(),
      windowStartsAt: since.toISOString(),
      modes: measured.modes.map((row) => str(row.mode)).filter((mode) => mode.length > 0),
      summary: {
        measuredTenants: Number(measured.totals?.tenants ?? 0),
        listedTenants: tenants.length,
        stillUnlicensed: tenants.filter((tenant) => tenant.licence.state !== 'licensed').length,
        licensedSince: tenants.filter((tenant) => tenant.licence.state === 'licensed').length,
        writes: Number(measured.totals?.writes ?? 0),
        listedWrites: tenants.reduce((sum, tenant) => sum + tenant.writes, 0),
        actors: Number(measured.totals?.actors ?? 0),
        oldestAt: measured.totals?.oldest_at ? iso(measured.totals.oldest_at) : null,
        newestAt: measured.totals?.newest_at ? iso(measured.totals.newest_at) : null,
      },
      truncated,
      tenants,
    };
  }

  async platformDecideRequest(
    requestId: string,
    actorUserId: string | undefined,
    decision: 'approved' | 'rejected',
    decisionNote?: string,
  ) {
    this.uuid(requestId);
    if (decision !== 'approved' && decision !== 'rejected') {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'القرار يجب أن يكون موافقة أو رفض', 422);
    }
    const cleanNote = String(decisionNote ?? '').trim().slice(0, 500) || null;
    const reqRow = await withPlatformAdminTx(this.database.db, async (tx) => {
      const found = first(await tx.execute(sql`
        SELECT id::text, tenant_id::text, app_code, requested_by::text
        FROM marketplace_addon_requests
        WHERE id = ${requestId}::uuid
        LIMIT 1
      `));
      if (!found) throw new DomainError(errorCodes.NOT_FOUND, 'طلب التفعيل غير موجود', 404);
      await tx.execute(sql`
        UPDATE marketplace_addon_requests
        SET status = ${decision},
            decision_note = ${cleanNote},
            decided_by = ${actorUserId ?? null}::uuid,
            decided_at = now(),
            updated_at = now()
        WHERE id = ${requestId}::uuid
      `);
      return found;
    });

    const tenantId = str(reqRow.tenant_id);
    const appCode = str(reqRow.app_code);
    const app = this.reviewed(appCode);

    await withTenantTx(this.database.db, tenantId, async (tx) => {
      if (decision === 'approved') {
        await tx.execute(sql`
          INSERT INTO tenant_apps (id, tenant_id, app_code, is_enabled, settings, installed_at, installed_by)
          VALUES (${newId()}::uuid, ${tenantId}::uuid, ${app.code}, true, '{}'::jsonb, now(), ${actorUserId ?? null}::uuid)
          ON CONFLICT (tenant_id, app_code) DO UPDATE
            SET is_enabled = true, updated_at = now()
        `);
      }
      const members = rows(await tx.execute(sql`
        SELECT id::text AS membership_id
        FROM memberships
        WHERE tenant_id = ${tenantId}::uuid
          AND deleted_at IS NULL
          AND status = 'active'
          AND (is_owner = true OR user_id = ${reqRow.requested_by ? str(reqRow.requested_by) : null}::uuid)
        LIMIT 10
      `));
      const title =
        decision === 'approved'
          ? `تمت الموافقة وتفعيل باقة «${app.nameAr}»`
          : `تحديث بخصوص طلب تفعيل «${app.nameAr}»`;
      const body =
        decision === 'approved'
          ? cleanNote || `تم تفعيل باقة ${app.nameAr} لمنشأتكم من إدارة المنصة وأصبحت متاحة الآن في القائمة الجانبية.`
          : cleanNote || `تم رفض طلب تفعيل باقة ${app.nameAr} من إدارة المنصة.`;
      for (const m of members) {
        await tx.execute(sql`
          INSERT INTO notifications (id, tenant_id, membership_id, type, payload)
          VALUES (
            ${newId()}::uuid,
            ${tenantId}::uuid,
            ${str(m.membership_id)}::uuid,
            ${decision === 'approved' ? 'marketplace_addon_approved' : 'marketplace_addon_rejected'},
            ${JSON.stringify({ title, body, appCode: app.code, href: '/settings/marketplace' })}::jsonb
          )
        `);
      }
    });

    return { id: requestId, status: decision, appCode: app.code, tenantId };
  }

  async platformToggleTenantApp(
    tenantId: string,
    actorUserId: string | undefined,
    code: string,
    enabled: boolean,
  ) {
    this.uuid(tenantId);
    const app = this.reviewed(code);
    await this.ensureCatalog();
    await withTenantTx(this.database.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO tenant_apps (id, tenant_id, app_code, is_enabled, settings, installed_at, installed_by)
        VALUES (${newId()}::uuid, ${tenantId}::uuid, ${app.code}, ${enabled}, '{}'::jsonb, now(), ${actorUserId ?? null}::uuid)
        ON CONFLICT (tenant_id, app_code) DO UPDATE
          SET is_enabled = ${enabled}, updated_at = now()
      `);
    });
    return { tenantId, code: app.code, enabled };
  }

  async platformUpdate(code: string, input: { monthlyPrice?: unknown; isActive?: unknown }) {
    const app = this.reviewed(code);
    const monthly = input.monthlyPrice === undefined ? undefined : decimalText(input.monthlyPrice);
    const active = input.isActive === undefined ? undefined : input.isActive === true;
    if (monthly === undefined && active === undefined) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'لا شيء لتحديثه', 422);
    }
    await this.ensureCatalog();
    return withPlatformAdminTx(this.database.db, async (tx) => {
      if (monthly !== undefined) {
        await tx.execute(sql`
          UPDATE marketplace_apps
          SET price_monthly = ${monthly}::numeric, updated_at = now()
          WHERE code = ${app.code}
        `);
      }
      if (active !== undefined) {
        await tx.execute(sql`
          UPDATE marketplace_apps SET is_active = ${active}, updated_at = now() WHERE code = ${app.code}
        `);
      }
      const row = first(await tx.execute(sql`
        SELECT price_monthly::text AS monthly_price, is_active
        FROM marketplace_apps WHERE code = ${app.code} LIMIT 1
      `));
      return {
        code: app.code,
        nameAr: app.nameAr,
        monthlyPrice: moneyText(row?.monthly_price ?? app.monthlyPrice),
        isActive: row ? flag(row.is_active) : true,
      };
    });
  }

  private reviewed(code: string) {
    const normalized = String(code ?? '').trim().toLowerCase();
    const extended = ALL_CATALOG_APPS.find((item) => item.code === normalized);
    if (extended) return extended;
    try {
      return assertReviewedApp(code);
    } catch (error) {
      if (error instanceof MarketplaceRuleError) {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'إضافة غير مُراجَعة. لا يُثبَّت كود طرف ثالث.', 422, {
          field: 'code',
        });
      }
      throw error;
    }
  }

  private domainOf(raw: string): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'الدومين مطلوب', 422, { field: 'domain' });
    }
    try {
      return normaliseDomain(raw);
    } catch {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'الدومين غير صالح', 422, { field: 'domain' });
    }
  }

  private uuid(value: string) {
    if (!UUID.test(value)) throw new DomainError(errorCodes.NOT_FOUND, 'غير موجود', 404);
  }

  /**
   * Inserts only the reviewed catalog. The platform GUC is required by the write
   * policy; the statement does not read tenant rows.
   */
  private async ensureCatalog() {
    await withPlatformAdminTx(this.database.db, async (tx) => {
      for (const app of ALL_CATALOG_APPS) {
        await tx.execute(sql`
          INSERT INTO marketplace_apps (
            id, code, name_ar, name_en, description_ar, icon, version, price_monthly, is_core, is_active, screens
          ) VALUES (
            ${newId()}::uuid,
            ${app.code},
            ${app.nameAr},
            ${app.nameEn},
            ${app.descriptionAr},
            ${app.icon},
            ${app.version},
            ${app.monthlyPrice}::numeric,
            ${app.isCore},
            true,
            ${JSON.stringify(app.screens)}::jsonb
          )
          ON CONFLICT (code) DO NOTHING
        `);
      }
    });
  }

  private async listInside(tx: DrizzleTx, tenantId: string): Promise<AppView[]> {
    const installed = rows(await tx.execute(sql`
      SELECT app_code, is_enabled, installed_at FROM tenant_apps WHERE tenant_id = ${tenantId}::uuid
    `));
    const prices = rows(await tx.execute(sql`
      SELECT code, price_monthly::text AS monthly_price, is_active FROM marketplace_apps
    `));
    const requests = rows(
      await tx
        .execute(sql`
          SELECT DISTINCT ON (app_code) app_code, status, note, decision_note
          FROM marketplace_addon_requests
          WHERE tenant_id = ${tenantId}::uuid
          ORDER BY app_code, created_at DESC
        `)
        .catch(() => ({ rows: [] })),
    );
    const stores = await this.legacyProviders(tx, tenantId);
    const installByCode = new Map(installed.map((row) => [str(row.app_code), row]));
    const priceByCode = new Map(prices.map((row) => [str(row.code), row]));
    const requestByCode = new Map(requests.map((row) => [str(row.app_code), row]));
    return ALL_CATALOG_APPS.map((app) => {
      const install = installByCode.get(app.code);
      const stored = priceByCode.get(app.code);
      const req = requestByCode.get(app.code);
      const explicit = install ? flag(install.is_enabled) : undefined;
      const enabled = explicit ?? (install === undefined && stores.has(app.code));
      return {
        code: app.code,
        nameAr: app.nameAr,
        nameEn: app.nameEn,
        descriptionAr: app.descriptionAr,
        icon: app.icon,
        version: app.version,
        monthlyPrice: moneyText(stored?.monthly_price ?? app.monthlyPrice),
        isCore: app.isCore,
        isActive: stored ? flag(stored.is_active) : true,
        enabled,
        installedAt: install?.installed_at ? iso(install.installed_at) : null,
        screens: [...app.screens],
        category: app.category,
        requiresApproval: app.category === 'sector',
        requestStatus: enabled
          ? 'approved'
          : ((str(req?.status) || 'none') as 'none' | 'pending' | 'approved' | 'rejected'),
        requestNote: req?.note ? str(req.note) : null,
        decisionNote: req?.decision_note ? str(req.decision_note) : null,
      };
    });
  }

  private async legacyProviders(tx: DrizzleTx, tenantId: string): Promise<Set<string>> {
    const found = rows(await tx.execute(sql`
      SELECT DISTINCT provider
      FROM ecommerce_stores
      WHERE tenant_id = ${tenantId}::uuid AND status = 'active'
    `));
    return new Set(found.map((row) => str(row.provider)));
  }

  private async readBrand(tx: DrizzleTx, tenantId: string): Promise<BrandingView> {
    const brand = first(await tx.execute(sql`
      SELECT logo_file_id, primary_color, secondary_color
      FROM tenant_branding WHERE tenant_id = ${tenantId}::uuid LIMIT 1
    `));
    const profile = first(await tx.execute(sql`
      SELECT name_ar, name_en FROM company_profiles WHERE tenant_id = ${tenantId}::uuid LIMIT 1
    `));
    const tenant = first(await tx.execute(sql`SELECT name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`));
    const logoFileId = str(brand?.logo_file_id);
    return {
      logoFileId,
      logoUrl: logoFileId ? this.logoUrl(tenantId, logoFileId) : '',
      primaryColor: str(brand?.primary_color),
      secondaryColor: str(brand?.secondary_color),
      nameAr: str(profile?.name_ar) || str(tenant?.name),
      nameEn: str(profile?.name_en),
    };
  }

  private async assertLogo(tx: DrizzleTx, tenantId: string, fileId: string) {
    const file = first(await tx.execute(sql`
      SELECT mime, status FROM files
      WHERE id = ${fileId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `));
    if (!file || str(file.status) !== 'ready' || !str(file.mime).startsWith('image/')) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'الشعار يجب أن يكون صورة مرفوعة ومُثبَتة', 422, {
        field: 'logoFileId',
      });
    }
  }

  private logoUrl(tenantId: string, fileId: string): string {
    try {
      return signedContentUrl(fileId, tenantId, env.FILES_DOWNLOAD_URL_TTL_SECONDS);
    } catch {
      return '';
    }
  }

  private async lookupTxt(host: string): Promise<string[]> {
    try {
      const records = await Promise.race([
        resolveTxt(host),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('timeout')), 5_000);
        }),
      ]);
      return records.map((parts) => parts.join(''));
    } catch {
      return [];
    }
  }
}

function toDomain(row: Record<string, unknown>): DomainView {
  const domain = str(row.domain);
  const challenge = verificationTxt(domain, str(row.verification_token));
  return {
    id: str(row.id),
    domain,
    status: str(row.status),
    sslStatus: str(row.ssl_status),
    txtHost: challenge.host,
    txtValue: challenge.value,
    verifiedAt: row.verified_at ? iso(row.verified_at) : null,
  };
}

function colorOf(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (!HEX_COLOR.test(text)) {
    throw new DomainError(errorCodes.VALIDATION_FAILED, 'اللون يجب أن يكون #RRGGBB', 422, { field });
  }
  return text.toLowerCase();
}

function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!UUID.test(text)) {
    throw new DomainError(errorCodes.VALIDATION_FAILED, 'معرّف الشعار غير صالح', 422, { field: 'logoFileId' });
  }
  return text;
}

function decimalText(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(text)) {
    throw new DomainError(errorCodes.VALIDATION_FAILED, 'السعر الشهري رقم عشري', 422, { field: 'monthlyPrice' });
  }
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(4, '0')}`;
}

/**
 * نافذةُ القياس بالأيام. الخاطئُ يُرفض 400 ولا يُقرَّب صامتاً: نافذةٌ لم يطلبها أحد تعني
 * أرقاماً لا يعرف القارئُ حدودها، وهذا أسوأ من خطأٍ معلَن.
 */
function usageWindowDays(value: unknown): number {
  const text = value === null || value === undefined ? '' : String(value).trim();
  if (text === '') return UNLICENSED_USAGE_DEFAULT_DAYS;
  if (!/^[0-9]{1,4}$/.test(text)) {
    throw new DomainError(
      errorCodes.VALIDATION_FAILED,
      `نافذة القياس أيامٌ صحيحة بين 1 و${UNLICENSED_USAGE_MAX_DAYS} — والمُرسل «${text.slice(0, 20)}»`,
      400,
      { field: 'days', message: 'عدد أيامٍ صحيح بين 1 و3650' },
    );
  }
  const days = Number(text);
  if (days < 1 || days > UNLICENSED_USAGE_MAX_DAYS) {
    throw new DomainError(
      errorCodes.VALIDATION_FAILED,
      `نافذة القياس بين يومٍ و${UNLICENSED_USAGE_MAX_DAYS} يوماً — والمُرسل ${days}`,
      400,
      { field: 'days', message: 'عدد أيامٍ صحيح بين 1 و3650' },
    );
  }
  return days;
}

function moneyText(value: unknown): string {
  const text = str(value);
  if (!text) return '0.0000';
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(4, '0').slice(0, 4)}`;
}

function flag(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function rows(result: unknown): Array<Record<string, unknown>> {
  return Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []);
}

function first(result: unknown): Record<string, unknown> | undefined {
  return rows(result)[0];
}
