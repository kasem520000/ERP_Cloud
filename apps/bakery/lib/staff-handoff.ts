/**
 * 🔗 تسليمُ الجلسة إلى لوحة staff — ولا استنساخَ لمحاسبةٍ هنا.
 *
 * **القرار** (قرارُ المالك رقم ١ لهذه الواجهة، وأكّده في الشريحة ٢٠): الأستاذُ والقيودُ
 * والميزانُ والفتراتُ ومراكزُ التكلفة وحركةُ الصندوق والشيكات والتحويلات — كلّها في
 * ‏`apps/staff` على المحرّك المحاسبيّ نفسه، ولا تُنسخ في واجهة المخابز ولا يُنشأ لها
 * محرّكٌ ثانٍ. وما هنا **رابطٌ يعمل**: يصنع رمزَ تسليمٍ ويُفتح به المسارُ الحقيقيّ في
 * اللوحة، فيكمل المستخدمُ عمله بجلسته هو وصلاحياته هي.
 *
 * **وكيف يُسلَّم** — من `packages/web-core/src/token-bridge.tsx` (‏AUD-08)، لا باختراع:
 * ‏`POST /auth/handoff` (بجلسة المستخدم) يُصدر رمزًا **لمرة واحدة عمره ~٦٠ ثانية لا يحمل
 * صلاحيةً بنفسه**، والعنوانُ يحمل `?handoff=<code>` وحده — فلا `?token=&refresh=` في عنوانٍ
 * يُسجَّل في سجلّات الوسيط و`Referer`. والواجهةُ الهدف تستبدله بجلسةٍ جديدة عبر
 * ‏`POST /auth/handoff/redeem` ثم تُنظّف العنوان بلا إعادة تحميل، والفشلُ مغلقٌ على شاشة
 * الدخول (`/?handoff=failed`). ولذلك يُصنع الرمزُ **عند النقر** لا عند تحميل الشاشة: رمزٌ
 * مُعدٌّ مسبقًا ينتهي قبل أن يُضغط.
 *
 * والمساراتُ أدناه مقاسةٌ على شجرة `apps/staff/app` (لكلٍّ `page.tsx` موجود) — ويثبّت
 * ‏`tests/staff-handoff.spec.ts` الطرفين: فلا مسارَ في القائمة بلا صفحة، والرابطُ لا يحمل
 * رمزَ جلسة.
 */

export type StaffGroup = 'accounting' | 'treasury';

export type StaffDestination = {
  readonly key: string;
  readonly group: StaffGroup;
  readonly labelAr: string;
  /** مسارٌ حقيقيّ في `apps/staff/app` — ويُقاس وجودُه في الاختبار. */
  readonly path: string;
  /** ما الذي يُفتح هناك ولماذا ليس هنا. */
  readonly noteAr: string;
};

export const STAFF_URL_ENV = 'NEXT_PUBLIC_STAFF_URL';

export const STAFF_DESTINATIONS: readonly StaffDestination[] = [
  // ------------------------------------------------------------ المحاسبة التفصيلية
  {
    key: 'ledger',
    group: 'accounting',
    labelAr: 'الأستاذ',
    path: '/accounting/ledger',
    noteAr: 'حركةُ حسابٍ بتفصيل قيوده — ومنه تُقرأ رجلُ «الصندوق/ذمم العملاء» التي كتبها تحصيلُ الخطّ.',
  },
  {
    key: 'journal-entries',
    group: 'accounting',
    labelAr: 'القيود',
    path: '/accounting/journal-entries',
    noteAr: 'القيودُ إنشاءً وتعديلًا وعكسًا — ولا قيدَ يُنشأ من واجهة المخابز أصلًا.',
  },
  {
    key: 'trial-balance',
    group: 'accounting',
    labelAr: 'ميزانُ المراجعة',
    path: '/accounting/trial-balance',
    noteAr: 'توازنُ الطرفين على مستوى المنشأة — تقريرٌ محاسبيٌّ رسميّ لا تقريرُ خطّ.',
  },
  {
    key: 'income-statement',
    group: 'accounting',
    labelAr: 'قائمةُ الدخل',
    path: '/accounting/income-statement',
    noteAr: 'الإيرادُ والمصروفُ والربح من القيود — وأرقامُ الخطّ في /reports قراءةٌ من مستنداته لا بديلٌ منه.',
  },
  {
    key: 'accounts',
    group: 'accounting',
    labelAr: 'شجرةُ الحسابات',
    path: '/accounting/accounts',
    noteAr: 'الحساباتُ وفئاتُها — ومنها الحسابُ المقابل الذي بلا حلٍّ له يبقى سندُ الخطّ مسودة.',
  },
  {
    key: 'periods',
    group: 'accounting',
    labelAr: 'الفتراتُ المالية',
    path: '/accounting/periods',
    noteAr: 'فتحُ الفترة وإغلاقُها — فترحيلُ سندٍ يحتاج فترةً مفتوحة، والإغلاقُ قرارُ محاسب.',
  },
  {
    key: 'cost-centers',
    group: 'accounting',
    labelAr: 'مراكزُ التكلفة',
    path: '/accounting/cost-centers',
    noteAr: 'المراكزُ وربطُها بالحسابات — ونسبةُ إنتاجٍ أو خطٍّ إلى مركزٍ قرارٌ محاسبيّ.',
  },
  {
    key: 'cost-center-statement',
    group: 'accounting',
    labelAr: 'كشفُ مركز التكلفة',
    path: '/accounting/cost-center-statement',
    noteAr: 'ما تجمّع على مركزٍ واحد في فترة — للمحاسب لا لمشرف التوزيع.',
  },
  {
    key: 'expenses',
    group: 'accounting',
    labelAr: 'المصروفات',
    path: '/accounting/expenses',
    noteAr: 'المصروفُ وأنواعُه وقيودُه — ولا يُحمَّل مصروفٌ على خطٍّ من هذه الواجهة.',
  },
  {
    key: 'cash-locations',
    group: 'accounting',
    labelAr: 'مواضعُ النقد (إنشاءً وتعديلًا)',
    path: '/accounting/cash-locations',
    noteAr: 'الصناديقُ والبنوكُ وحساباتُها في الأستاذ — والقراءةُ في /treasury، والإنشاءُ هنا.',
  },
  {
    key: 'payment-methods',
    group: 'accounting',
    labelAr: 'طرقُ الدفع',
    path: '/accounting/payment-methods',
    noteAr: 'الطرقُ وحساباتُها — فطريقةُ دفعٍ بلا حسابٍ مقابل تعني سندًا لا يُرحَّل.',
  },
  // ------------------------------------------------------------ الخزينة (ما يحتاج حكمًا)
  {
    key: 'vouchers',
    group: 'treasury',
    labelAr: 'السنداتُ (إنشاءً وترحيلًا وإلغاءً)',
    path: '/treasury/vouchers',
    noteAr: 'إنشاءُ سندٍ وترحيلُه وإلغاؤه — وكلُّها كتابةٌ في المال لا تُفعل من واجهة الخطّ.',
  },
  {
    key: 'movements',
    group: 'treasury',
    labelAr: 'حركةُ الصندوق',
    path: '/treasury/movements',
    noteAr: 'دفترُ الأستاذ للصندوق (لا جدولَ السندات) — وفيه البيعُ والراتبُ والتحويلُ جنب السند.',
  },
  {
    key: 'transfers',
    group: 'treasury',
    labelAr: 'التحويلاتُ بين موضعين',
    path: '/treasury/transfers',
    noteAr: 'تحويلُ النقد بين صندوقين بإرسالٍ واستلام — فتوريدُ نقد السيارة إلى الصندوق الرئيسيّ هنا.',
  },
  {
    key: 'day-close',
    group: 'treasury',
    labelAr: 'إغلاقاتُ اليومية',
    path: '/treasury/day-close',
    noteAr: 'عدُّ الدرج وفرقُه وقيدُ الإغلاق — وفرقٌ لا يُرحَّل تلقائيًّا ولا يُخفى.',
  },
  {
    key: 'safes',
    group: 'treasury',
    labelAr: 'الصناديق',
    path: '/treasury/safes',
    noteAr: 'الصناديقُ ومسئولوها وأرصدتُها من الخزينة نفسها.',
  },
  {
    key: 'cheques',
    group: 'treasury',
    labelAr: 'الشيكات',
    path: '/treasury/cheques',
    noteAr: 'تحصيلُ الشيك أو ارتدادُه — وانتقالُ حالةٍ يكتب قيدًا، فلا يُفعل من هنا.',
  },
];

export function destinationsOf(group: StaffGroup): StaffDestination[] {
  return STAFF_DESTINATIONS.filter((destination) => destination.group === group);
}

/**
 * عنوانُ اللوحة — ويُقبل `http(s)` مطلقٌ فقط، وبلا شرطةٍ أخيرة. وبلا قيمةٍ يُرجع `null`
 * فيُقال للمستخدم إنّ الرابطَ غير مُهيَّأ بدلَ رابطٍ ميتٍ أو تخمينِ `localhost`.
 */
export function staffBaseUrl(raw: string | undefined = process.env.NEXT_PUBLIC_STAFF_URL): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (!/^https?:\/\//i.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${path}`;
  } catch {
    return null;
  }
}

/** رابطُ التسليم — ‏`?handoff=<code>` وحده: فلا رمزَ جلسةٍ في عنوان (‏AUD-08). */
export function handoffHref(base: string, path: string, code: string): string {
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const separator = cleanPath.includes('?') ? '&' : '?';
  return `${base.replace(/\/+$/, '')}${cleanPath}${separator}handoff=${encodeURIComponent(code)}`;
}

export type HandoffPlan = { href: string } | { problemAr: string };

/**
 * الحكمُ قبل النقر: بلا عنوانٍ مُهيَّأ لا يُصنع رمزٌ (فرمزٌ لا يُستبدل في اللوحة ضياعٌ
 * لرمزٍ لمرةٍ واحدة)، وبلا رمزٍ لا رابط. والخطآن يُقالان بنصٍّ يختلف فلا يُخلط أحدهما بالآخر.
 */
export function handoffPlan(base: string | null, destination: StaffDestination, code: string): HandoffPlan {
  if (!base) {
    return {
      problemAr: `الرابطُ غير مُهيَّأ: ‏${STAFF_URL_ENV} فارغ أو ليس عنوانَ http(s) مطلقًا — فلا يُفتح مسارٌ ولا يُصنع رمز. أضِفها إلى .env ثم أعد تشغيل الواجهة.`,
    };
  }
  if (!code.trim()) {
    return { problemAr: 'لم يصدر رمزُ تسليمٍ بعد — انقر «افتح في اللوحة» ليُصنع الرمزُ ويُفتح المسار.' };
  }
  return { href: handoffHref(base, destination.path, code.trim()) };
}

/** ما يُقال للمستخدم عن آلية التسليم — فلا يظنّ أنّ الرابطَ يُنسخ أو يُعاد استعماله. */
export const HANDOFF_NOTES_AR = [
  'الرابطُ يصنع رمزَ تسليمٍ **لمرةٍ واحدة عمره ~٦٠ ثانية** (‏POST /auth/handoff) ويفتح اللوحة به — فلا رمزَ جلسةٍ في العنوان، ولا يُعاد استعمالُ الرابط: اصنعه من جديد لكلّ فتح.',
  'وتدخل اللوحةَ بجلستك أنت وصلاحياتك هي: فما ترفضه هناك ترفضه نفسها هنا — فالضابطُ الخادمُ ولا علاقةَ له بالواجهة التي جئت منها.',
  'وإن فشل الاستبدالُ (انتهى الرمزُ أو استُعمل) تقع على شاشة دخول اللوحة مع وسمِ `handoff=failed` الذي يفسّر السبب — لا على جلسةٍ جزئية.',
] as const;
