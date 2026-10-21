#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * `node scripts/seed-content.mjs` — publish the demo marketing content pages.
 *
 * The marketing site renders every editorial page (`/blog/*`, `/help/*`, `/cases/*`,
 * `/changelog/*`, `/legal/*`) from the platform content system. On a fresh database that
 * table is empty, so those routes 404 and the home page's hero experiment probes
 * `/public/content/home` on every visit (404 in the network panel). This script seeds a
 * small, bilingual, *sample* dataset so the screens can be reviewed with real CMS data:
 *
 *   legal      terms · privacy · cookies
 *   post       cloud-erp-launch
 *   help       getting-started
 *   case       bakery-rollout
 *   changelog  whats-new-october
 *   page       home            (no blocks — it exists so the hero-variant probe is a 200)
 *
 * It writes through the public API as the platform administrator (`PLATFORM_ADMIN_*`), so
 * created pages get real versions/audit rows. It is idempotent: an existing slug is updated
 * (title, summary, blocks) and published only when it is not already published.
 *
 * The text is deliberately marked as demo copy: it is not a binding legal document.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(join(root, '.env'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() && !line.startsWith('#'))
    .map((line) => {
      const index = line.indexOf('=');
      return [line.slice(0, index).trim(), line.slice(index + 1).trim()];
    }),
);

const apiBase = env.API_BASE_URL ?? 'http://127.0.0.1:3000/api/v1';

/** Blocks are `[kind, arabic payload, english payload?]`; positions are assigned in order. */
const blocks = (list) =>
  list.map(([kind, ar, en], position) => ({
    position,
    kind,
    content: en ? { ar, en } : { ar },
  }));

const PAGES = [
  {
    slug: 'home',
    kind: 'page',
    titleAr: 'الرئيسية',
    titleEn: 'Home',
    summaryAr: 'صفحة البطل في الموقع التسويقي؛ نسخ أ/ب التجريبية تُسحب من هنا.',
    summaryEn: 'The marketing home page; A/B hero variants are managed from here.',
    blocks: [],
  },
  {
    slug: 'terms',
    kind: 'legal',
    titleAr: 'شروط الاستخدام',
    titleEn: 'Terms of use',
    summaryAr: 'شروط استخدام منصة ERP السحابية في بيئة العرض التجريبية.',
    summaryEn: 'Terms of use for the ERP Cloud demo environment.',
    category: 'قانوني',
    authorName: 'فريق المنصة',
    blocks: blocks([
      [
        'text',
        {
          text: 'هذه صفحة نموذجية داخل بيئة العرض التجريبية، ولا تُعدّ نصًا قانونيًا ملزمًا. الغرض منها التحقق من عرض صفحات المحتوى القانوني وتنسيقها في اللغتين.',
        },
        {
          text: 'This is a sample page inside the demo environment and is not a binding legal document. Its purpose is to verify the layout of legal content in both languages.',
        },
      ],
      ['heading', { text: 'استخدام الخدمة', level: 3 }, { text: 'Using the service', level: 3 }],
      [
        'list',
        {
          items: [
            'استخدم الحساب باسم الجهة المصرّح لها فقط.',
            'لا تشارك بيانات الدخول مع أي طرف آخر.',
            'أبلغ فريق الدعم فورًا عند أي استخدام غير مصرّح به.',
          ],
          ordered: false,
        },
        {
          items: [
            'Use the account only on behalf of the authorised entity.',
            'Do not share sign-in credentials with anyone else.',
            'Report any unauthorised use to support immediately.',
          ],
          ordered: false,
        },
      ],
      [
        'text',
        { text: 'لأسئلة الشروط تواصل مع فريق المنصة من صفحة «تواصل معنا».' },
        { text: 'For questions about these terms, contact the platform team from the “Contact” page.' },
      ],
    ]),
  },
  {
    slug: 'privacy',
    kind: 'legal',
    titleAr: 'سياسة الخصوصية',
    titleEn: 'Privacy policy',
    summaryAr: 'كيف تُعالَج بيانات الحساب والفواتير داخل بيئة العرض.',
    summaryEn: 'How account and invoice data are handled inside the demo environment.',
    category: 'قانوني',
    authorName: 'فريق المنصة',
    blocks: blocks([
      [
        'text',
        {
          text: 'صفحة نموذجية توضّح بنية سياسة الخصوصية: ما نجمعه، ولماذا، وكيف يُحمى. البيانات في هذه البيئة تجريبية بالكامل.',
        },
        {
          text: 'A sample page showing the shape of a privacy policy: what is collected, why, and how it is protected. All data in this environment is demo data.',
        },
      ],
      [
        'list',
        {
          items: [
            'بيانات الحساب: الاسم والبريد والدور.',
            'البيانات المحاسبية: الفواتير والقيود المرفوعة من التطبيقات.',
            'سجلات الاستخدام: لتشخيص الأخطاء وتحسين الاعتمادية.',
          ],
          ordered: false,
        },
        {
          items: [
            'Account data: name, email address and role.',
            'Accounting data: invoices and entries posted through the apps.',
            'Usage logs: to diagnose errors and improve reliability.',
          ],
          ordered: false,
        },
      ],
      [
        'text',
        { text: 'لا تُستخدم بيانات الشركة التجريبية لأي غرض تسويقي، ولا تُشارك مع أطراف خارجية.' },
        {
          text: 'Demo company data is not used for marketing and is not shared with third parties.',
        },
      ],
    ]),
  },
  {
    slug: 'cookies',
    kind: 'legal',
    titleAr: 'ملفات الارتباط',
    titleEn: 'Cookies',
    summaryAr: 'ما تخزّنه المنصة في المتصفح ولماذا.',
    summaryEn: 'What the platform stores in the browser, and why.',
    category: 'قانوني',
    authorName: 'فريق المنصة',
    blocks: blocks([
      [
        'text',
        {
          text: 'تستخدم المنصة تخزينًا محليًا محدودًا لإبقاء الجلسة وتفضيل اللغة والمظهر، مع لافتة موافقة على القياس.',
        },
        {
          text: 'The platform uses limited local storage to keep the session and the language and theme preferences, with a consent banner for analytics.',
        },
      ],
      [
        'list',
        {
          items: [
            'الجلسة: رموز الدخول اللازمة لاستمرار تسجيل الدخول.',
            'التفضيلات: اللغة والمظهر.',
            'القياس: لا يُفعّل قبل الموافقة، ويمكن تغييره من التذييل.',
          ],
          ordered: false,
        },
        {
          items: [
            'Session: the tokens needed to stay signed in.',
            'Preferences: language and theme.',
            'Analytics: not enabled before consent, and can be changed from the footer.',
          ],
          ordered: false,
        },
      ],
    ]),
  },
  {
    slug: 'cloud-erp-launch',
    kind: 'post',
    titleAr: 'كيف نبني محاسبةً سحابية تعمل بالعربية أولًا',
    titleEn: 'Building a cloud ledger that is Arabic-first',
    summaryAr:
      'قرارات التصميم التي تجعل القيود والفواتير مقروءة في الاتجاهين، بلا تنازل عن الدقة.',
    summaryEn:
      'Design decisions that keep entries and invoices readable in both directions without compromising precision.',
    category: 'هندسة',
    authorName: 'فريق المنتج',
    blocks: blocks([
      [
        'heading',
        { text: 'لماذا العربية أولًا؟', level: 2 },
        { text: 'Why Arabic first?', level: 2 },
      ],
      [
        'text',
        {
          text: 'بُني نظام المحاسبة ليقرأ الأرقام والاتجاه معًا: الأرقام تُنسّق بفاصل آلاف واضح، والنصوص تتبع اتجاه الصفحة، والجداول تحافظ على محاذاة مالية ثابتة. هذا ليس ترفًا؛ القيد الذي يُقرأ خطأً يُرحَّل خطأً.',
        },
        {
          text: 'The ledger was designed to read numbers and direction together: figures use a clear thousands separator, text follows the page direction, and tables keep a stable financial alignment. A misread entry is a mis-posted entry.',
        },
      ],
      [
        'quote',
        { text: 'الاتجاه الصحيح ليس ميزةً بصرية، بل شرطُ دقة.', source: 'فريق التصميم' },
        {
          text: 'Correct direction is not a visual feature; it is a correctness requirement.',
          source: 'Design team',
        },
      ],
      [
        'list',
        {
          items: [
            'خصائص منطقية للهوامش والحدود بدل left/right.',
            'أرقام بخط Inter داخل جملة عربية.',
            'ترقيم صفحات ثابت العرض.',
            'مراجعة كل شاشة في الاتجاهين.',
          ],
          ordered: false,
        },
        {
          items: [
            'Logical margin and border properties instead of left/right.',
            'Inter numerals inside Arabic sentences.',
            'Fixed-width pagination.',
            'Every screen reviewed in both directions.',
          ],
          ordered: false,
        },
      ],
    ]),
  },
  {
    slug: 'getting-started',
    kind: 'help',
    titleAr: 'البدء في خمس دقائق',
    titleEn: 'Getting started in five minutes',
    summaryAr: 'من تسجيل الدخول إلى أول فاتورة مرحّلة.',
    summaryEn: 'From sign-in to your first posted invoice.',
    category: 'البداية',
    authorName: 'فريق الدعم',
    blocks: blocks([
      [
        'text',
        {
          text: 'افتح لوحة الموظفين، أنشئ عميلًا، ثم أضف فاتورة مبيعات. بعد الحفظ رحّل الفاتورة ليظهر أثرها في دفتر اليومية.',
        },
        {
          text: 'Open the staff panel, create a customer, then add a sales invoice. Post it to see its effect in the journal.',
        },
      ],
      [
        'list',
        {
          items: [
            'سجّل الدخول إلى لوحة الموظفين.',
            'أضف عميلًا من شاشة العملاء.',
            'أنشئ فاتورة واحفظها كمسودة.',
            'راجع الإجماليات ثم رحّل الفاتورة.',
          ],
          ordered: true,
        },
        {
          items: [
            'Sign in to the staff panel.',
            'Add a customer from the customers screen.',
            'Create an invoice and save it as a draft.',
            'Review the totals, then post the invoice.',
          ],
          ordered: true,
        },
      ],
      [
        'faq',
        {
          items: [
            {
              question: 'هل يمكن التراجع عن الترحيل؟',
              answer:
                'الترحيل قرار مالي؛ للتصحيح يُستخدم إشعار دائن أو مدين مرتبط بالفاتورة، لا حذف القيد.',
            },
            {
              question: 'أين أرى أثر الفاتورة؟',
              answer: 'في دفتر اليومية ولوحة القيادة وميزان المراجعة، بحسب صلاحية الحساب.',
            },
          ],
        },
        {
          items: [
            {
              question: 'Can posting be undone?',
              answer:
                'Posting is a financial decision; corrections use a credit or debit note linked to the invoice, never deleting the entry.',
            },
            {
              question: 'Where do I see the effect?',
              answer: 'In the journal, the dashboard and the trial balance, subject to account permissions.',
            },
          ],
        },
      ],
    ]),
  },
  {
    slug: 'bakery-rollout',
    kind: 'case_study',
    titleAr: 'كيف ربطت مخبزًا بثلاثة مناديب في أسبوع',
    titleEn: 'Connecting a bakery to three salesmen in one week',
    summaryAr: 'تحميل وبيع وتحصيل من الجوال، مع عهدةٍ واضحة لكل مندوب.',
    summaryEn: 'Loading, selling and collecting from a phone, with a clear float per salesman.',
    category: 'حالات',
    authorName: 'فريق المنتج',
    blocks: blocks([
      ['heading', { text: 'التحدي', level: 2 }, { text: 'The challenge', level: 2 }],
      [
        'text',
        {
          text: 'كانت المبيعات تُكتب على ورق، وتُجمع في نهاية اليوم بفروق غير مفسّرة. طُبّق تطبيق المندوب على تحميلٍ يومي من المخبز، مع رفض الخادم لأي بيع من خارج العهدة.',
        },
        {
          text: 'Sales were written on paper and reconciled at the end of the day, with unexplained differences. The salesman app was tied to a daily load from the bakery, and the server rejects any sale outside the float.',
        },
      ],
      [
        'list',
        {
          items: [
            'عهدة يومية لكل مندوب مرتبطة بأمر تحميل.',
            'تسعير بيع بالكيلو وحسم حدود العهدة.',
            'ترحيل تلقائي للتحصيل النقدي إلى الصندوق.',
            'مراجعة الفروق من تقرير واحد.',
          ],
          ordered: false,
        },
        {
          items: [
            'A daily float per salesman, linked to a load order.',
            'Per-kilo pricing with float limits enforced.',
            'Automatic posting of cash collections to the cash box.',
            'Differences reviewed from a single report.',
          ],
          ordered: false,
        },
      ],
      [
        'quote',
        {
          text: 'أول أسبوع بلا ورقةٍ واحدة. الفرق الوحيد أنه صار مرئيًا قبل نهاية اليوم.',
          source: 'مدير العمليات',
        },
        {
          text: 'The first week without a single sheet of paper. The only difference is that it is now visible before the end of the day.',
          source: 'Operations manager',
        },
      ],
    ]),
  },
  {
    slug: 'whats-new-october',
    kind: 'changelog',
    titleAr: 'تحديثات أكتوبر: وضوح الجداول والاتجاهين',
    titleEn: 'October updates: clearer tables in both directions',
    summaryAr: 'ترقيم صفحات، إطار جدول ثابت، ومراجعة RTL/LTR.',
    summaryEn: 'Pagination, a stable table frame, and an RTL/LTR review.',
    category: 'إصدارات',
    authorName: 'فريق المنتج',
    blocks: blocks([
      ['heading', { text: 'أكتوبر 2026', level: 2 }, { text: 'October 2026', level: 2 }],
      [
        'list',
        {
          items: [
            'ترقيم صفحات موحّد للجداول الكبيرة مع بقاء شريط التنقّل ظاهرًا.',
            'إصلاح تعارض `.grid` مع أدوات Tailwind في لوحة الموظفين.',
            'مراجعة اتجاه كل الشاشات في العربية والإنجليزية.',
          ],
          ordered: false,
        },
        {
          items: [
            'Unified pagination for large tables, with the pager always visible.',
            'Fixed the `.grid`/Tailwind utility conflict in the staff panel.',
            'Every screen reviewed in Arabic and English directions.',
          ],
          ordered: false,
        },
      ],
    ]),
  },
];

// ───────────────────────────────────────────────────────────────────────────── auth

const loginResponse = await fetch(`${apiBase}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: env.PLATFORM_ADMIN_EMAIL,
    password: env.PLATFORM_ADMIN_PASSWORD,
    tenantCode: 'platform',
  }),
});
const login = await loginResponse.json().catch(() => null);
const token = login?.data?.accessToken ?? login?.accessToken;
if (!loginResponse.ok || !token) {
  throw new Error(
    `platform admin login failed (${loginResponse.status}): ${JSON.stringify(login).slice(0, 300)}`,
  );
}

const call = async (path, { method = 'GET', body } = {}) => {
  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!response.ok) throw new Error(`${method} ${path} → ${response.status} ${text.slice(0, 300)}`);
  return parsed?.data ?? parsed;
};

// ───────────────────────────────────────────────────────────────────────────── seed

const force = process.argv.includes('--force');
const existing = await call('/platform/content/pages?limit=100');
const bySlug = new Map((Array.isArray(existing) ? existing : []).map((page) => [page.slug, page]));

/** Stable JSON: `jsonb` returns keys sorted, so a plain stringify would always differ. */
const stable = (value) => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
};

/** Blocks as the editor stores them (ids/positions dropped) — used to skip no-op writes. */
const shapeOf = (list) =>
  stable(list.map((block) => [block.kind, block.content?.ar ?? null, block.content?.en ?? null]));

const samePage = (detail, fields) =>
  detail.titleAr === fields.titleAr &&
  (detail.titleEn ?? null) === (fields.titleEn ?? null) &&
  (detail.summaryAr ?? null) === (fields.summaryAr ?? null) &&
  (detail.summaryEn ?? null) === (fields.summaryEn ?? null) &&
  (detail.category ?? null) === (fields.category ?? null) &&
  (detail.authorName ?? null) === (fields.authorName ?? null) &&
  shapeOf(detail.blocks) === shapeOf(fields.blocks ?? []);

let created = 0;
let updated = 0;
let published = 0;
let skipped = 0;

for (const page of PAGES) {
  const fields = {
    titleAr: page.titleAr,
    ...(page.titleEn ? { titleEn: page.titleEn } : {}),
    ...(page.summaryAr ? { summaryAr: page.summaryAr } : {}),
    ...(page.summaryEn ? { summaryEn: page.summaryEn } : {}),
    ...(page.category ? { category: page.category } : {}),
    ...(page.authorName ? { authorName: page.authorName } : {}),
    blocks: page.blocks,
  };

  const current = bySlug.get(page.slug);
  let id;
  if (current) {
    const detail = await call(`/platform/content/pages/${current.id}`);
    if (!force && detail.status === 'published' && samePage(detail, fields)) {
      skipped += 1;
      console.log(`  ${page.slug.padEnd(20)} ${page.kind.padEnd(11)} unchanged`);
      continue;
    }
    await call(`/platform/content/pages/${current.id}`, {
      method: 'PATCH',
      body: { ...fields, note: 'بذرة محتوى العرض التجريبي' },
    });
    id = current.id;
    updated += 1;
  } else {
    const fresh = await call('/platform/content/pages', {
      method: 'POST',
      body: {
        slug: page.slug,
        kind: page.kind,
        defaultLocale: 'ar',
        status: 'draft',
        ...fields,
      },
    });
    id = fresh.id;
    created += 1;
  }

  await call(`/platform/content/pages/${id}/publish`, { method: 'POST', body: {} });
  published += 1;
  console.log(`  ${page.slug.padEnd(20)} ${page.kind.padEnd(11)} ${current ? 'updated' : 'created'}`);
}

console.log(
  `content pages: ${created} created · ${updated} updated · ${published} published · ${skipped} unchanged`,
);
