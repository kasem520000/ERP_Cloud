import type { EmailProvider } from '@erp/contracts';

import { createMailerFor, type MailerPort } from '../platform-services/notifications/mailer.js';

/**
 * P-C6 — مُصنّع المُسلِّم (نقطة التبديل الواحدة).
 *
 * لماذا واجهةٌ صغيرة بدل استدعاء `createMailerFor` مباشرةً من الخدمة؟
 *
 *   - **الاختبار**: فشل الإرسال ليس حالةً نادرة، بل هو سبب وجود سلّم التراجع. ولا سبيل
 *     لإثبات السلّم (1د · 5د · 30د ثم فشلٌ نهائيّ) بلا مُسلِّمٍ يفشل عند الطلب — فالمصنّع
 *     يُستبدَل في الاختبار بمصنّعٍ يُرجع فاشلاً، وتبقى الخدمة على مسارها الحقيقي.
 *   - **الوضوح**: من يقرأ `EmailModule` يرى من أين يأتي المُسلِّم، فلا يُبحث عنه في مزوّد
 *     صامت (`MAILER`) لا يشير إلى `email_settings`.
 *
 * والمزوّد يأتي من الإعدادات **لكل رسالة**، لا من البيئة مرةً واحدة: ذلك هو معنى «تبديل
 * المزوّد من الشاشة بلا إعادة نشر» (§7.2 من الخطة).
 */
export type EmailMailerFactory = (provider: EmailProvider) => MailerPort;

export const EMAIL_MAILER_FACTORY = 'ERP_EMAIL_MAILER_FACTORY';

export const defaultEmailMailerFactory: EmailMailerFactory = (provider) => createMailerFor(provider);
