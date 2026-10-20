import { z } from 'zod';

import { paginationQuerySchema } from '../pagination.js';
import { uuidSchema } from '../ids.js';

/**
 * 🧯 سجلّ المشاكل — البند 20 من قائمة العيوب.
 *
 * الشاشة تجيب سؤالاً واحداً لا تجيبه بقية شاشات المنصّة: **«ما الذي يفشل الآن؟»**.
 * الطابور يقول ما لم يُنفَّذ، والبريد يقول ما لم يخرج، والنسخ تقول ما لم يُكتب — لكن
 * المشغّل كان عليه أن يزور أربع شاشات ليعرف أن ثلاث رسائل ارتدّت ونسخةً فشلت.
 *
 * ولذلك هذا العقد **لا يخترع جدولاً**: كل صفٍّ مصدرُه صفٌّ قائم في القاعدة، ويُقدَّم
 * بشكلٍ واحد. `source` يقول من أين جاء، و`href` يقول أين يُصلَح، و`occurredAt` يقول متى.
 *
 * ولا صفَّ يُصنع من فراغ: مصدرٌ لا صفوف له يظهر بصفرٍ في العدّادات ولا يظهر بصفٍّ وهمي.
 */

export const platformProblemSources = ['email', 'einvoice', 'webhook', 'outbox', 'backup'] as const;
export type PlatformProblemSource = (typeof platformProblemSources)[number];

/** العربي هو المعروض؛ والرمز يبقى للاختبار والفلترة. */
export const platformProblemSourceLabels: Record<PlatformProblemSource, string> = {
  email: 'البريد',
  einvoice: 'الفاتورة الإلكترونية',
  webhook: 'الويب هوك',
  outbox: 'الطابور',
  backup: 'النسخ الاحتياطي',
};

export const platformProblemSeverities = ['error', 'warning'] as const;
export type PlatformProblemSeverity = (typeof platformProblemSeverities)[number];

export const platformProblemSourceLabelsEn: Record<PlatformProblemSource, string> = {
  email: 'E-mail',
  einvoice: 'E-invoice',
  webhook: 'Webhook',
  outbox: 'Queue',
  backup: 'Backup',
};

export const platformProblemRowSchema = z.object({
  /** `source:uuid` — مفتاحٌ فريد عبر المصادر، لأن uuid-اتها من جداول مختلفة. */
  key: z.string(),
  source: z.enum(platformProblemSources),
  severity: z.enum(platformProblemSeverities),
  /** سطرٌ واحد يُقرأ في القائمة. */
  title: z.string(),
  /** النصّ الكامل من النظام (قد يكون إنجليزياً كما قاله المزوّد) — يُعرض بجانب شرحٍ عربي. */
  detail: z.string().nullable(),
  /** شرحٌ عربي مختصر لما يعنيه هذا النوع من الفشل وكيف يُصلَح. */
  hint: z.string().nullable(),
  tenantId: uuidSchema.nullable(),
  tenantCode: z.string().nullable(),
  tenantName: z.string().nullable(),
  attempts: z.number().int().nullable(),
  occurredAt: z.string(),
  /** الشاشة التي يُعالَج فيها الصفّ داخل لوحة المنصّة. */
  href: z.string(),
});

export type PlatformProblemRow = z.infer<typeof platformProblemRowSchema>;

export const platformProblemQuerySchema = paginationQuerySchema.extend({
  filter: z.record(z.union([z.string(), z.array(z.string())])).optional(),
});

export type PlatformProblemQueryDto = z.infer<typeof platformProblemQuerySchema>;

/** العدّادات تُحسب على **كل** النتائج لا على الصفحة — وإلا كذب الرقم عند الترقيم. */
export const platformProblemCountsSchema = z.object({
  total: z.number().int(),
  bySource: z.record(z.enum(platformProblemSources), z.number().int()),
  bySeverity: z.record(z.enum(platformProblemSeverities), z.number().int()),
  /** أقدم صفٍّ ما زال قائماً — يقول للمشغّل «منذ متى ونحن في هذه الحال». */
  oldestAt: z.string().nullable(),
});

export type PlatformProblemCounts = z.infer<typeof platformProblemCountsSchema>;

export const platformProblemsResponseSchema = z.object({
  rows: z.array(platformProblemRowSchema),
  meta: z.object({
    total: z.number().int(),
    limit: z.number().int(),
    offset: z.number().int(),
  }),
  counts: platformProblemCountsSchema,
});

export type PlatformProblemsResponse = z.infer<typeof platformProblemsResponseSchema>;
