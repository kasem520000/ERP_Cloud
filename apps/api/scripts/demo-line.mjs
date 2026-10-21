#!/usr/bin/env node
/**
 * `pnpm demo:line` — يومُ خطٍّ كامل في منشأة العرض، **عبر نقاط النهاية نفسها التي تستعملها
 * الشاشات** لا بـSQL مباشر.
 *
 * لماذا HTTP لا إدراجٌ في القاعدة؟ لأنّ الإدراج اليدويّ هو بالضبط ما ولّد الصفوفَ
 * المفبركة التي تُمسح الآن بـ`pnpm db:demo-repair` (‏`unit_cost=3.80` و`BATCH-DEFAULT`
 * و«رقائق سمبوسة»): صفوفٌ تملأ الشاشةَ ولا يعرفها محرّكُ المخزون ولا الأستاذ. وهنا يمرّ
 * كلّ شيء من حراس المنتج نفسها — سياسةُ عهدة، وقائمةُ مواد، وترحيلُ قيود، وسندُ قبضٍ
 * رسمي — فما يظهر في الشاشات بعدها **نتيجةُ منتجٍ** لا ديكور.
 *
 * السلسلة (وكلُّ خطوةٍ تُطبع بحالتها ورسالة الخادم عند الرفض):
 *
 *   تصنيفان ← صنفان (دقيقٌ وخبز) ← رصيدُ دقيقٍ افتتاحيٌّ بجردٍ مُرحَّل ← دفعةُ إنتاجٍ
 *   بمكوّنات (٥٠٠ كجم خبز من ٣٥٠ كجم دقيق) ← أمرُ تحميلٍ إلى السيارة (٢٠٠ كجم) ← تأكيدُ
 *   استلام **المندوب** ← فاتورةُ نقدٍ (٦٠ كجم) وفاتورةُ آجل (٤٠ كجم) ← تحصيلُ الآجل
 *   (وهو ما يُنشئ سندَ القبض **ويرحّله** في `collectCustomerDebt`) ← إقفالُ الوردية بعدّ
 *   المركبة ← اعتمادُ الإقفال.
 *
 * والتكرارُ آمن: التصنيفاتُ والأصنافُ والأطراف تُبحث برمزها فتُستعمل القائمةُ منها، وما
 * يقبل مفتاحَ عدم تكرار (دفعةُ الإنتاج، أمرُ التحميل، المستند، التحصيل) يُرسل بمفتاحٍ
 * مشتقٍّ من `--tag` (افتراضيًّا تاريخُ اليوم) فلا يُنشئ نسخةً ثانية، وأمرُ التحميل **لا
 * يُعاد إرسال إقفاله أبدًا** بل تُقرأ حالتُه ويُنفَّذ منها ما ينقص فقط (فلا مفتاحَ عدم
 * تكرار لـ`submit-closing`، وإعادتُه عمياءً تُنشئ إقفالين).
 *
 * ولا يحذف السكربت شيئًا، ولا يلمس منشأةً غير المنشأة المطلوبة، ولا يُنشئ حسابَ مستخدم:
 * فالمندوبُ والمالك من بذرة `pnpm db:seed` (‏`DEMO_OWNER_*` و`DEMO_REP_*`).
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadEnvFiles } from '../../../scripts/dotenv.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
loadEnvFiles(repoRoot);

const HELP = `
pnpm demo:line — يومُ خطٍّ كامل في منشأة العرض عبر API نفسه (لا SQL مباشر).

الاستعمال:
  pnpm demo:line                       # سلسلةُ اليوم (مفاتيحُ عدم التكرار بتاريخ اليوم)
  pnpm demo:line -- --tag 2            # يومٌ ثانٍ مستقل (مفاتيحُ …:2)
  pnpm demo:line -- --report-only      # بلا كتابة: اطبع ما في المنشأة الآن
  pnpm demo:line -- --base http://localhost:3000/api/v1

الخيارات:
  --base <url>            أساسُ API (افتراضيًّا http://localhost:<PORT|3000>/api/v1)
  --tenant <code>         رمزُ المنشأة (افتراضيًّا DEMO_TENANT_CODE)
  --owner-email/--owner-password        (افتراضيًّا DEMO_OWNER_*)
  --rep-email/--rep-password            (افتراضيًّا DEMO_REP_*)
  --tag <text>            وسمُ التشغيل — يدخل في مفاتيح عدم التكرار وأرقام الدفعات
  --qty-loaded <n>        كجم التحميل (٢٠٠) · --qty-cash <n> كجم النقد (٦٠)
  --qty-credit <n>        كجم الآجل (٤٠)  · --qty-produced <n> كجم الإنتاج (٥٠٠)
  --qty-flour <n>         كجم الدقيق الافتتاحي (١٠٠٠) · --price-sale <n> سعر البيع (١٠)
  --report-only           لا يكتب شيئًا
  --remaining-action <x>  مصيرُ متبقّي السيارة عند الاعتماد: «carry_over» (افتراضيّ —
                          عهدةُ الوردية التالية) أو «return_to_main» (إرجاعٌ للمستودع
                          الرئيسيّ، وهو مسارٌ فيه عيبُ تقييمٍ مقاسٌ — بندُ ب٢٣)
  --no-settle-stock       لا تُفوّض بترحيل مستند الجرد الرسميّ (فيبقى مسودةً وتبقى العهدة
                          معلّقة — وهو ما يريده من يريد رؤيةَ حالة «لم تكتمل التسوية»)
  --allow-mismatched-vat  أنشئ المستندات ولو كانت نسبةُ مجموعة الضريبة تخالف اسمها
                          (افتراضيًّا **يُرفض**: ففاتورةٌ بضريبةٍ مخالفةٍ لاسم المجموعة
                          بياناتٌ لا تصلح للعرض — وهو عيبُ البذرة الذي قِيس في ب٢٢)
  --help                  هذه الرسالة

ولا يُنفَّذ الإقفالُ إلا بعدّ المركبة بما يطابق المتوقّع (بلا عجزٍ ولا زيادة) — فمن أراد
أن يرى مسارَ العجز (تحميلُ النقص على مديونية الموظّف) فليُغيّر العددَ في الشاشة نفسها،
لأنّ ذلك المسار يحتاج اعتمادَ الحالة salaryDeductionApproved وهو قرارُ صاحبِ العمل.
`;

/** وسائطُ السطر — بلا مكتبة، وبلا اختصارٍ غامض. */
function parseArgs(argv) {
  const out = { tag: null, reportOnly: false, help: false };
  const aliases = {
    base: 'base', tenant: 'tenant', tag: 'tag',
    'owner-email': 'ownerEmail', 'owner-password': 'ownerPassword',
    'rep-email': 'repEmail', 'rep-password': 'repPassword',
    'qty-loaded': 'qtyLoaded', 'qty-cash': 'qtyCash', 'qty-credit': 'qtyCredit',
    'qty-produced': 'qtyProduced', 'qty-flour': 'qtyFlour', 'qty-components': 'qtyComponents',
    'remaining-action': 'remainingAction',
    'price-sale': 'priceSale', 'price-flour': 'priceFlour',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') continue; // ‏pnpm يمرّر الفاصل نفسه أحيانًا
    if (!raw.startsWith('--')) { console.error(`✗ وسيطٌ غير متوقّع: ${raw}`); out.help = true; continue; }
    const name = raw.slice(2);
    if (name === 'help') { out.help = true; continue; }
    if (name === 'report-only') { out.reportOnly = true; continue; }
    if (name === 'allow-mismatched-vat') { out.allowMismatchedVat = true; continue; }
    if (name === 'no-settle-stock') { out.noSettleStock = true; continue; }
    const key = aliases[name];
    if (!key) { out.help = true; console.error(`✗ خيارٌ غير معروف: --${name}`); continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      out.help = true;
      console.error(`✗ الخيارُ --${name} يحتاج قيمة`);
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.allowMismatchedVat === undefined) args.allowMismatchedVat = false;
if (args.help) { console.log(HELP); process.exit(args.help ? 0 : 2); }

const BASE = (args.base ?? process.env.API_BASE_URL ?? `http://localhost:${process.env.PORT ?? 3000}/api/v1`).replace(/\/+$/, '');
const TENANT = args.tenant ?? process.env.DEMO_TENANT_CODE ?? 'demo';
const OWNER = { email: args.ownerEmail ?? process.env.DEMO_OWNER_EMAIL, password: args.ownerPassword ?? process.env.DEMO_OWNER_PASSWORD };
const REP = { email: args.repEmail ?? process.env.DEMO_REP_EMAIL, password: args.repPassword ?? process.env.DEMO_REP_PASSWORD };
const TAG = args.tag ?? new Date().toISOString().slice(0, 10);
const Q = {
  flour: args.qtyFlour ?? '1000',
  produced: args.qtyProduced ?? '500',
  components: args.qtyComponents ?? '350',
  loaded: args.qtyLoaded ?? '200',
  cash: args.qtyCash ?? '60',
  credit: args.qtyCredit ?? '40',
};
// ‏`UNIT_PRICES` لا `PRICE`: فقاعدةُ الـlint تحظر أيّ معرّفٍ اسمه `price|amount|total|balance|cost|rate`
// في موضع قيمة (‏`eslint.config.mjs:20`) — والقيمُ هنا **نصوصٌ عشرية** لا أرقام، لكنّ الاسمَ وحده يكفي.
const UNIT_PRICES = { sale: args.priceSale ?? '10.0000', flour: args.priceFlour ?? '4.0000' };
const NOTE = `عرض تجريبي — demo:line:${TAG}`;

if (!OWNER.email || !OWNER.password) { console.error('✗ ينقص DEMO_OWNER_EMAIL/DEMO_OWNER_PASSWORD (أو --owner-email/--owner-password)'); process.exit(2); }
if (!REP.email || !REP.password) { console.error('✗ ينقص DEMO_REP_EMAIL/DEMO_REP_PASSWORD (أو --rep-email/--rep-password)'); process.exit(2); }

/** ‏`{data:…}` أو مصفوفةٌ عارية — والخادمُ يستعمل الاثنين (فـ`/vouchers` مصفوفةٌ مثلًا). */
const payload = (json) => (json && typeof json === 'object' && 'data' in json ? json.data : json);
const rows = (value) => (Array.isArray(value) ? value : (value?.data ?? []));
const dec = (value) => Number(String(value ?? '0').replace(/,/g, ''));
const money = (value) => (Number.isFinite(dec(value)) ? dec(value).toFixed(4) : '—');
const key = (...parts) => `demo-line:${TAG}:${parts.join(':')}`;

async function call(method, urlPath, body, token) {
  const response = await fetch(BASE + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = text;
  try { json = JSON.parse(text); } catch { /* نصٌّ خام — يُطبع كما هو */ }
  return { status: response.status, json };
}

/** رسالةُ الخادم كما كتبها (عربيةٌ في هذا المنتج) — فلا يُستبدل بها نصٌّ من عندنا. */
function reasonOf(res) {
  const body = res.json;
  if (typeof body === 'string') return body.slice(0, 400);
  const fields = Array.isArray(body?.errors) ? body.errors.map((e) => `${e.field}: ${e.message}`).join(' · ') : '';
  return [body?.detail ?? body?.message ?? body?.title ?? 'بلا تفصيل', fields].filter(Boolean).join(' | ').slice(0, 500);
}

let failures = 0;
function fail(label, res) {
  failures += 1;
  console.error(`\n✗ ${label} → ${res.status}\n  ${reasonOf(res)}`);
}

async function login(who, credentials) {
  const res = await call('POST', '/auth/login', { email: credentials.email, password: credentials.password, tenantCode: TENANT });
  if (res.status !== 200 && res.status !== 201) {
    console.error(`✗ دخول ${who} (${credentials.email}) → ${res.status}\n  ${reasonOf(res)}`);
    process.exit(1);
  }
  const session = payload(res.json);
  console.log(`✓ دخول ${who}: ${credentials.email}`);
  return session.accessToken;
}

/** ‏GET يقرأ وحده — والفشلُ فيه يُطبع ولا يُسقط السكربت (فقراءةٌ ناقصةٌ ليست كتابةً فاسدة). */
async function read(label, urlPath, token) {
  const res = await call('GET', urlPath, undefined, token);
  if (res.status !== 200) { fail(`قراءة ${label}`, res); return null; }
  return payload(res.json);
}

/**
 * كتابةٌ بمفتاح عدم تكرار حيث يقبله الخادم: فإن كان السجلُّ موجودًا أرجع الخادمُ السجلَّ
 * نفسه (لا نسخةً ثانية) — وهذا ما يجعل إعادةَ التشغيل آمنةً بلا فحصٍ من عندنا.
 */
async function write(label, method, urlPath, body, token, accepted = [200, 201]) {
  const res = await call(method, urlPath, body, token);
  if (!accepted.includes(res.status)) { fail(label, res); return null; }
  const created = res.status === 201;
  console.log(`${created ? '✓' : '↻'} ${label} → ${res.status}${created ? '' : ' (قائمٌ أصلًا/بلا إنشاء)'}`);
  return payload(res.json);
}

const state = {
  kgUnit: null, vatGroup: null, mainWarehouse: null, vanWarehouse: null, safe: null,
  rawCategory: null, bakeryCategory: null, flour: null, bread: null,
  cashier: null, wholesaler: null, salesman: null, batch: null, loadOrder: null,
  cashDocument: null, creditDocument: null, collection: null, closing: null, approval: null,
};

/**
 * المرجعيات: وحدةُ الكيلو، ومجموعةُ الضريبة ١٥٪، والمستودعان، والصندوق.
 * وكلُّها من بذرة `db:seed` — فما يُنشأ هنا أصنافٌ وأطرافٌ وحركات، لا بنيةٌ تحتية.
 */
async function loadReferences(ownerToken) {
  const units = rows(await read('الوحدات', '/organization/catalog/units', ownerToken));
  state.kgUnit = units.find((u) => String(u.code).toUpperCase() === 'KG')?.id ?? units[0]?.id ?? null;
  if (!state.kgUnit) { console.error('✗ لا وحدةَ قياس في المنشأة — فلا صنفَ يُنشأ'); process.exit(1); }

  const groups = rows(await read('مجموعات الضريبة', '/organization/catalog/tax-groups', ownerToken));
  const vat = groups.find((g) => dec(g.rate) > 0) ?? null;
  state.vatGroup = vat?.id ?? null;

  /**
   * حارسُ النسبة: المحرّك يحسب `subtotal × rate / 100` (‏`van-sales.service.ts:4627`) فـ`rate`
   * **مئوية**، وبذرةُ العرض كانت تكتب `0.1500` لمجموعةٍ اسمها «15%» ⇒ فاتورةُ ٦٠٠ خرجت
   * بضريبة ٠٫٩٠ (قِيس). والنسبةُ تُقفل بعد أوّل استعمال (`TAX_GROUP_RATE_LOCKED` — وقِيس
   * ٤٠٩ على منشأة `demo`)، فمن ينشئ مستنداتٍ هنا بمجموعةٍ مخالفةٍ لاسمها يكتب بياناتٍ لا تصلح
   * للعرض ولا يُصلحها لاحقًا. ولذلك **يُرفض** التشغيل إلا بـ`--allow-mismatched-vat`.
   */
  if (vat) {
    const said = Number(String(vat.nameAr ?? vat.nameEn ?? '').match(/(\d+(?:[.٫]\d+)?)\s*%/)?.[1]?.replace('٫', '.') ?? Number.NaN);
    const is = dec(vat.rate);
    if (Number.isFinite(said) && said !== is) {
      console.error(`\n✗ مجموعةُ الضريبة «${vat.nameAr}» اسمُها يقول ${said}% ورقمُها ${vat.rate} ⇒ المحرّك يحسبها ${is}% (‏rate/100).`);
      console.error('  السببُ بذرةُ العرض القديمة (‏`packages/database/src/seed-demo.ts` — صارت `15.0000` ومعه حكمٌ يثبّتها).');
      console.error('  فإن كانت المنشأةُ **لم تُصدِر فاتورةً بعد**: ‏PATCH /organization/catalog/tax-groups/:id ‏{rate:"15.0000"} (يقبله الخادم).');
      console.error('  وإن كانت أصدرت: فالنسبةُ مقفولة (‏TAX_GROUP_RATE_LOCKED) والطريقُ مجموعةٌ جديدةٌ بالنسبة الصحيحة وإعادةُ ربط الأصناف بها (قرارُ صاحبِ العمل — بندُ ب٢٢).');
      if (!args.allowMismatchedVat) {
        console.error('\n✗ لا تُنشأ مستنداتٌ بضريبةٍ تخالف اسمَ مجموعتها. ولمواصلةٍ مع العلم بالخطأ: --allow-mismatched-vat');
        process.exit(2);
      }
      console.error('  ⚠ --allow-mismatched-vat: فتُستعمل النسبةُ كما هي والمستنداتُ تحملها.');
    }
  }

  const warehouses = rows(await read('المستودعات', '/warehouses', ownerToken));
  state.mainWarehouse = warehouses.find((w) => String(w.code).toUpperCase() === 'MAIN') ?? warehouses.find((w) => w.isDefault) ?? null;
  state.vanWarehouse = warehouses.find((w) => String(w.code).toUpperCase().startsWith('VAN')) ?? null;
  if (!state.mainWarehouse) { console.error('✗ لا مستودعَ رئيسيًّا في المنشأة'); process.exit(1); }
  if (!state.vanWarehouse) { console.error('✗ لا مستودعَ سيارةٍ (VAN-*) — فبذرةُ المندوب لم تُنشئه؟ ‏(pnpm db:seed)'); process.exit(1); }

  const locations = rows(await read('مواضع النقد', '/cash-locations?limit=50', ownerToken));
  state.safe = locations.find((l) => l.kind === 'safe') ?? null;

  console.log(`  الوحدة=${state.kgUnit.slice(0, 8)}… الضريبة=${state.vatGroup ? `${state.vatGroup.slice(0, 8)}…` : 'لا مجموعة (فلا ضريبة)'} المستودع=${state.mainWarehouse.code} السيارة=${state.vanWarehouse.code} الصندوق=${state.safe ? state.safe.name : 'لا صندوق'}`);
}

/** الأصنافُ والأطراف: تُبحث برمزها فتُستعمل القائمة، وإلا أُنشئت. */
async function ensureCatalog(ownerToken) {
  const categories = rows(await read('التصنيفات', '/organization/catalog/categories', ownerToken));
  console.log(`  التصنيفاتُ القائمة: ${categories.map((c) => `${c.code ?? ''}/${c.nameAr ?? c.name ?? ''}`).join(' · ') || 'لا شيء'}`);
  state.rawCategory = categories.find((c) => (c.nameAr ?? c.name ?? '').includes('مواد')) ?? null;
  state.bakeryCategory = categories.find((c) => (c.nameAr ?? c.name ?? '').includes('مخبوز')) ?? null;
  if (!state.rawCategory) {
    state.rawCategory = await write('تصنيف: مواد أولية', 'POST', '/organization/catalog/categories', { code: 'RAW-MATERIAL', nameAr: 'مواد أولية', nameEn: 'Raw Materials' }, ownerToken);
  } else console.log('↻ تصنيف «مواد أولية» قائم');
  if (!state.bakeryCategory) {
    state.bakeryCategory = await write('تصنيف: مخبوزات', 'POST', '/organization/catalog/categories', { code: 'BAKERY', nameAr: 'مخبوزات', nameEn: 'Bakery' }, ownerToken);
  } else console.log('↻ تصنيف «مخبوزات» قائم');
  if (!state.rawCategory || !state.bakeryCategory) process.exit(1);

  const items = rows(await read('الأصناف', '/organization/catalog/items', ownerToken));
  state.flour = items.find((i) => i.sku === 'FL-001') ?? null;
  state.bread = items.find((i) => i.sku === 'BR-001') ?? null;
  if (!state.flour) {
    state.flour = await write('صنف: دقيق أبيض (FL-001)', 'POST', '/organization/catalog/items', {
      sku: 'FL-001', nameAr: 'دقيق أبيض', nameEn: 'Wheat Flour', kind: 'stock',
      categoryId: state.rawCategory.id, baseUnitId: state.kgUnit,
      purchasePrice: UNIT_PRICES.flour, salePrice: '0.0000', taxGroupId: state.vatGroup,
    }, ownerToken);
  } else console.log('↻ الصنف FL-001 قائم');
  if (!state.bread) {
    state.bread = await write('صنف: خبز عربي (BR-001)', 'POST', '/organization/catalog/items', {
      sku: 'BR-001', nameAr: 'خبز عربي', nameEn: 'Arabic Bread', kind: 'stock',
      categoryId: state.bakeryCategory.id, baseUnitId: state.kgUnit,
      purchasePrice: '0.0000', salePrice: UNIT_PRICES.sale, taxGroupId: state.vatGroup,
    }, ownerToken);
  } else console.log('↻ الصنف BR-001 قائم');
  if (!state.flour || !state.bread) process.exit(1);

  const parties = rows(await read('الأطراف', '/parties?kind=customer', ownerToken));
  state.cashier = parties.find((p) => p.code === 'CUST-BAQALA') ?? null;
  state.wholesaler = parties.find((p) => p.code === 'CUST-WAHDA') ?? null;
  if (!state.cashier) {
    state.cashier = await write('عميل: بقالة الحيّ (نقد)', 'POST', '/parties', {
      code: 'CUST-BAQALA', kind: 'customer', name: 'بقالة الحيّ', legalName: 'مؤسسة بقالة الحيّ', phone: '+966501112222',
    }, ownerToken);
  } else console.log('↻ العميل CUST-BAQALA قائم');
  if (!state.wholesaler) {
    state.wholesaler = await write('عميل: سوبرماركت الوحدة (آجل)', 'POST', '/parties', {
      code: 'CUST-WAHDA', kind: 'customer', name: 'سوبرماركت الوحدة', legalName: 'شركة سوبرماركت الوحدة', taxNo: '300111222333339',
    }, ownerToken);
  } else console.log('↻ العميل CUST-WAHDA قائم');
  if (!state.cashier || !state.wholesaler) process.exit(1);
}

/** رصيدُ الدقيق: جردٌ افتتاحيٌّ مُرحَّل (فبلا تكلفةٍ مقيسة ترفض دفعةُ الإنتاج: «الموادُّ غير مُقيَّمة»). */
async function ensureFlourStock(ownerToken) {
  const levels = rows(await read('أرصدة المخزون', '/inventory/levels', ownerToken));
  const have = levels.filter((l) => String(l.itemId) === String(state.flour.id));
  const onHand = have.reduce((sum, l) => sum + dec(l.quantity ?? l.onHand ?? l.balance ?? 0), 0);
  /**
   * الجردُ **عدٌّ لا إضافة**: ‏`countedQty` هي ما وُجد فعلًا، والخادمُ يكتب الفرق. فمن أعاد
   * إرسال «١٠٠٠ كجم» بعد أن صرف الإنتاجُ ٣٥٠ كجم صنع **فائضًا مفبركًا** بـ٣٥٠ كجم وقيدًا
   * يُرحَّل معه — وأُصيب هذا فعلًا في التشغيل الثاني (قِيس: الدقيقُ عاد ١٠٠٠ بعد ٦٥٠، و
   * ‏`ADJ-000002` بقيد `JE-000008`). ولذلك لا يُرسل الجردُ إلا والرصيدُ **صفرٌ** (افتتاحيٌّ
   * حقًّا)، وأيُّ رصيدٍ قائمٍ يعني أنّ الافتتاحَ صار ولا يُعاد.
   */
  if (onHand > 0) {
    console.log(`↻ للدقيق رصيدٌ قائم (${onHand} كجم) — فلا جردَ افتتاحيًّا ثانيًا (والجردُ عدٌّ لا إضافة: فإعادته بعد صرف الإنتاج تفبرك فائضًا)`);
    return;
  }
  const adjustment = await write(`جرد: رصيدُ دقيقٍ افتتاحيّ (${Q.flour} كجم @ ${UNIT_PRICES.flour})`, 'POST', '/inventory/adjustments', {
    branchId: state.mainWarehouse.branchId, warehouseId: state.mainWarehouse.id,
    reason: `رصيد افتتاحي للعرض التجريبي — ${NOTE}`,
    lines: [{ itemId: state.flour.id, countedQty: Q.flour, unitId: state.kgUnit, unitCost: UNIT_PRICES.flour, note: NOTE }],
  }, ownerToken);
  if (!adjustment) return;
  await write('ترحيل الجرد', 'POST', `/inventory/adjustments/${adjustment.id}/post`, { approved: true }, ownerToken);
}

/** دفعةُ الإنتاج: ٥٠٠ كجم خبز من ٣٥٠ كجم دقيق — وبلا مكوّنات ترفض (‏`VAN_PRODUCTION_INPUT_REQUIRED`). */
async function ensureProductionBatch(ownerToken) {
  state.batch = await write(`دفعة إنتاج: ${Q.produced} كجم خبز من ${Q.components} كجم دقيق`, 'POST', '/van-sales/production-batches', {
    batchNo: `BATCH-DEMO-${TAG}`, itemId: state.bread.id, warehouseId: state.mainWarehouse.id,
    productionDate: new Date().toISOString().slice(0, 10), producedQty: Q.produced,
    components: [{ itemId: state.flour.id, qty: Q.components, unitId: state.kgUnit }],
    supervisorName: 'مشرف الإنتاج', notes: NOTE, idempotencyKey: key('batch'),
  }, ownerToken);
}

/** بطاقةُ المندوب: من `salesmen` (لا من العضوية) — فأمرُ التحميل يُعلَّق بها. */
async function findSalesman(ownerToken) {
  const salesmen = rows(await read('المندوبون', '/van-sales/salesmen', ownerToken));
  state.salesman = salesmen.find((s) => String(s.warehouseId) === String(state.vanWarehouse.id)) ?? salesmen[0] ?? null;
  if (!state.salesman) { console.error('✗ لا بطاقةَ مندوب في المنشأة — ‏pnpm db:seed (DEMO_REP_*)'); process.exit(1); }
  console.log(`  بطاقةُ المندوب: ${state.salesman.name ?? state.salesman.salesmanName ?? state.salesman.id}`);
}

/**
 * مساحةُ عمل المندوب (`GET /van-sales/me`) — وهي **مصدرُ السجلّات** هنا: فكلُّ كتابةٍ في
 * ‏`van-sales` تُرجع مساحةَ العمل المُحدَّثة (‏`{policy, officialStock, postingReadiness,
 * windows…}`) لا السجلَّ المُنشأ (قِيس). فمن يقرأ `id` من ردّ الإنشاء يقرأ `undefined` ثمّ
 * يرسله في الخطوة التالية فيرفضه الخادم بـ«يجب اختيار أمر التحميل».
 */
async function repWorkspace(repToken, label) {
  const workspace = await read(label ?? 'مساحةُ عمل المندوب', '/van-sales/me', repToken);
  if (!workspace) process.exit(1);
  return workspace;
}

/** أمرُ التحميل ثمّ تأكيدُ استلام المندوب — فالحالةُ تُقرأ قبل كلّ خطوة (ولا إعادةَ عمياء). */
async function ensureLoadAndReceipt(ownerToken, repToken) {
  const batchNo = `BATCH-DEMO-${TAG}`;
  await write(`أمر تحميل: ${Q.loaded} كجم إلى ${state.vanWarehouse.code}`, 'POST', '/van-sales/load-orders', {
    salesmanId: state.salesman.id, branchId: state.mainWarehouse.branchId,
    warehouseId: state.mainWarehouse.id, vanWarehouseId: state.vanWarehouse.id,
    itemId: state.bread.id, vehiclePlate: state.salesman.vehiclePlate ?? undefined,
    productionBatchNo: batchNo, loadedQty: Q.loaded, notes: NOTE,
    idempotencyKey: key('load'),
  }, ownerToken);

  const orderOf = (workspace) => rows(workspace.loadOrders).find((order) => order.productionBatchNo === batchNo) ?? null;
  state.loadOrder = orderOf(await repWorkspace(repToken, 'أمر التحميل من مساحة المندوب'));
  if (!state.loadOrder) { console.error(`✗ أمرُ تحميل الدفعة ${batchNo} لم يظهر في مساحة المندوب`); process.exit(1); }
  console.log(`  أمرُ التحميل ${state.loadOrder.number} بحالة «${state.loadOrder.status}» · مُحمَّل ${state.loadOrder.loadedQty} كجم`);

  if (String(state.loadOrder.status) === 'pending_receipt') {
    await write('تأكيد استلام المندوب', 'POST', `/van-sales/load-orders/${state.loadOrder.id}/confirm-receipt`, {
      receivedQty: state.loadOrder.loadedQty, notes: NOTE,
    }, repToken);
    state.loadOrder = orderOf(await repWorkspace(repToken, 'أمر التحميل بعد الاستلام'));
  } else {
    console.log(`↻ الاستلامُ محسومٌ أصلًا (الحالةُ «${state.loadOrder.status}») — فلا إعادة`);
  }
  const custody = (await repWorkspace(repToken, 'العهدة بعد الاستلام')).custody ?? {};
  console.log(`  العهدةُ الرسمية: ${custody.officialKg ?? '—'} كجم (المتوقّع ${custody.expectedKg ?? '—'})`);
}

/** مستندَا البيع: نقدٌ وآجل — والآجل هو ما يُحصَّل بعده فيصير سندُ قبضٍ مُرحَّل. */
async function ensureDocuments(repToken) {
  const invoiceMode = state.vatGroup ? 'zatca_tax' : 'internal_delivery';
  await write(`فاتورة نقد: ${Q.cash} كجم لـ«${state.cashier.name}»`, 'POST', '/van-sales/documents', {
    loadOrderId: state.loadOrder.id, partyId: state.cashier.id, itemId: state.bread.id,
    invoiceMode, paymentMethod: 'cash', cashLocationId: state.safe?.id ?? null,
    soldQty: Q.cash, unitPrice: UNIT_PRICES.sale, notes: NOTE, idempotencyKey: key('doc-cash'),
  }, repToken);
  await write(`فاتورة آجل: ${Q.credit} كجم لـ«${state.wholesaler.name}»`, 'POST', '/van-sales/documents', {
    loadOrderId: state.loadOrder.id, partyId: state.wholesaler.id, itemId: state.bread.id,
    invoiceMode, paymentMethod: 'credit', soldQty: Q.credit, unitPrice: UNIT_PRICES.sale,
    notes: NOTE, idempotencyKey: key('doc-credit'),
  }, repToken);

  // والسجلّان من مساحة المندوب (لا من ردّي الإنشاء) — فيُطابق كلّ مستندٍ بعميله وطريقة دفعه.
  const workspace = await repWorkspace(repToken, 'المستندان من مساحة المندوب');
  const documents = rows(workspace.documents);
  state.cashDocument = documents.find((doc) => doc.paymentMethod === 'cash' && String(doc.customerName ?? '') === String(state.cashier.name ?? '')) ?? null;
  state.creditDocument = documents.find((doc) => doc.paymentMethod === 'credit' && String(doc.customerName ?? '') === String(state.wholesaler.name ?? '')) ?? null;
  for (const [label, doc] of [['النقد', state.cashDocument], ['الآجل', state.creditDocument]]) {
    if (!doc) { console.error(`✗ مستندُ ${label} لم يظهر في مساحة المندوب`); continue; }
    console.log(`  مستندُ ${label}: ${doc.number} · فاتورة ${doc.invoiceNumber ?? '—'} (${doc.invoiceStatus ?? '—'}) · ${doc.soldQty} كجم · إجمالي ${doc.total} منها ضريبة ${doc.taxTotal} · متبقٍّ ${doc.outstanding}`);
  }
}

/**
 * التحصيل — وهنا يُكتب سندُ القبض **ويُرحَّل** (`collectCustomerDebt`): ‏`kind:'receipt'`
 * و`idempotencyKey:'van-collection-voucher:<documentId>:<key>'`. فالمبلغُ من المستند نفسه
 * (لا رقمٌ من عندنا) حتى لا يُحصَّل أكثرُ من المستحقّ.
 */
async function ensureCollection(repToken) {
  const due = state.creditDocument?.outstanding ?? null;
  if (due === null || dec(due) <= 0) {
    console.log(`↻ لا مستحقَّ على الآجل (‏outstanding=${due ?? '—'}) — فلا تحصيلَ يُرسل ولا مبلغَ يُخمَّن`);
    return;
  }
  state.collection = await write(`تحصيل الآجل: ${money(due)} من «${state.creditDocument.customerName}»`, 'POST', '/van-sales/collections', {
    documentId: state.creditDocument.id, collectedAmount: String(due), cashLocationId: state.safe?.id ?? undefined,
    notes: NOTE, idempotencyKey: key('collection'),
  }, repToken);
}

/** الإقفالُ بعدّ المركبة، ثمّ الاعتماد — وتُقرأ الحالةُ قبل كلّ خطوة فلا يُعاد إقفالٌ قائم. */
async function ensureClosing(repToken, ownerToken) {
  const batchNo = `BATCH-DEMO-${TAG}`;
  const orderOf = (workspace) => rows(workspace.loadOrders).find((order) => order.productionBatchNo === batchNo) ?? null;

  let workspace = await repWorkspace(repToken, 'العهدة قبل الإقفال');
  let order = orderOf(workspace);
  // العددُ من العهدة الرسمية المقاسة (`custody.officialKg`) لا من طرحٍ عندنا: فالخادمُ يعرف
  // ما بِيع وما أُرجع، وعدُّ المركبة بما يطابقها يعني «بلا عجزٍ ولا زيادة». وأمّا مسارُ
  // العجز (تحميلُ النقص على مديونية الموظّف) فيحتاج اعتمادَ الحالة `salaryDeductionApproved`
  // وهو قرارُ صاحبِ العمل — فلا يُفتعل هنا.
  const counted = workspace.custody?.officialKg ?? null;
  console.log(`  العهدةُ الرسمية قبل الإقفال: ${counted ?? '—'} كجم · الحالةُ «${order?.status ?? '—'}»`);
  if (counted === null) { console.error('✗ لا عهدةَ مقاسة — فلا عددَ يُرسل (ولا يُخمَّن)'); return; }

  if (['loaded', 'in_route'].includes(String(order?.status))) {
    await write(`إقفالُ الوردية: عدُّ المركبة ${counted} كجم (بلا عجز)`, 'POST', `/van-sales/load-orders/${order.id}/submit-closing`, {
      vehicleCountQty: String(counted), closingNotes: NOTE,
    }, repToken);
  } else {
    // ‏`submit-closing` **بلا مفتاح عدم تكرار** — فإعادتُه عمياءً تُنشئ إقفالين (قاعدةُ بيت).
    console.log(`↻ الحالةُ «${order?.status ?? '—'}» — فلا إقفالَ يُرسل (وإعادةُ submit-closing عمياءً تُنشئ إقفالين)`);
  }

  workspace = await repWorkspace(repToken, 'الحالة بعد الإقفال');
  order = orderOf(workspace);
  console.log(`  بعد الإقفال: «${order?.status ?? '—'}» · عجز ${order?.shortageQty ?? '—'} كجم بقيمة ${order?.shortageValue ?? '—'} · نقدٌ متوقّع ${order?.expectedCash ?? '—'} ومحصّل ${order?.collectedCash ?? '—'}`);

  if (String(order?.status) === 'pending_closing') {
    /**
     * الاعتمادُ يحتاج قرارين صريحين لا يُخمَّنان:
     *  - ‏`remainingAction`: مصيرُ ما عاد في السيارة (‏`return_to_main` إرجاعٌ رسميٌّ للمستودع
     *    الرئيسيّ، أو `carry_over` عهدةُ الوردية التالية) — وهو **إلزاميٌّ عند وجود متبقٍّ**
     *    (قِيس: بلاهُ ٤٢٢ «لا تُغلق العهدة مع بقاء كمية بلا قرار»).
     *  - ‏`settleStockAdjustment`: تفويضٌ بترحيل مستند الجرد الرسميّ، وبدونه يبقى مسودةً
     *    وتبقى العهدةُ معلّقة.
     * وكلاهما هنا اختيارُ عرضٍ لا سياسة: فمسارُ العجز (تحميلُ النقص على مديونية الموظّف)
     * لم يُفتعل — والعددُ يطابق العهدة (`shortageQty = 0` قِيس).
     */
    /**
     * الافتراضيُّ `carry_over` لا `return_to_main` — ولسببٍ مقاسٍ لا ذوقٍ (بندُ ب٢٣): في
     * منشأة `bakeryco` أرجع `return_to_main` المئةَ كيلو الباقية **كميةً بلا قيمة**، فنزل
     * متوسطُ تكلفة الخبز في المستودع الرئيسيّ من ٢٫٨٠٠٠ إلى ٢٫١٠٠٠ وبقيت القيمةُ ٨٤٠
     * لـ٤٠٠ كجم (والصحيحُ ١١٢٠ = إنتاج ١٤٠٠ − تكلفةُ مبيعات ٢٨٠)، أي أنّ ٢٨٠ ريالًا من
     * قيمة المخزون لم ترجع، ولا قيدَ في الأستاذ لتلك العودة (‏`journal_entries` تنتهي عند
     * ‏`JE-000008` وليس بينها تسويةُ الإقفال). فـ`carry_over` (بقاءُ المتبقّي عهدةَ الوردية
     * التالية) لا يمرّ في ذلك المسار ويُبقي القيمةَ محفوظة — وهو كذلك واقعُ المخابز: فالسيارةُ
     * لا تُفرَّغ كلّ ليلة. ومن أراد قياسَ المسار الآخر فـ`--remaining-action return_to_main`.
     */
    const remainingAction = args.remainingAction === 'return_to_main' ? 'return_to_main' : 'carry_over';
    const body = { remainingAction, notes: NOTE };
    if (!args.noSettleStock) body.settleStockAdjustment = true;
    console.log(`  قرارُ الاعتماد: مصيرُ المتبقّي «${remainingAction}» · ترحيلُ مستند الجرد ${args.noSettleStock ? 'غير مُفوّض (يبقى مسودة)' : 'مُفوّض'}`);
    state.approval = await write('اعتمادُ الإقفال (المالك)', 'POST', `/van-sales/load-orders/${order.id}/approve-closing`, body, ownerToken);
    order = orderOf(await repWorkspace(repToken, 'الحالة بعد الاعتماد'));
    console.log(`  بعد الاعتماد: «${order?.status ?? '—'}»`);
  } else {
    console.log(`↻ الحالةُ «${order?.status ?? '—'}» — فلا اعتمادَ يُرسل`);
  }
  state.loadOrder = order;
}

/** الخاتمة: ما صار في الشاشات — بالأرقام التي تقرأها الشاشات نفسها. */
async function report(ownerToken, repToken) {
  const today = new Date().toISOString().slice(0, 10);
  const vouchers = rows(await read('السندات', `/vouchers?from=${today}&to=${today}`, ownerToken)) ?? [];
  const line = vouchers.filter((v) => String(v.idempotencyKey ?? '').startsWith('van-collection-voucher:'));
  const levels = rows(await read('أرصدة المخزون', '/inventory/levels', ownerToken));
  console.log('\n────────── ما صار في المنشأة ──────────');
  // وفي `--report-only` لم تُنشأ الأصنافُ في هذه الجلسة — فتُقرأ من الفهرس بالرمز حتى لا
  // يخرج التقريرُ بـ«—» وهو يملك أن يقرأ (وقِيس: كان كذلك).
  if (!state.flour || !state.bread) {
    const items = rows(await read('الأصناف', '/organization/catalog/items', ownerToken));
    state.flour = state.flour ?? items.find((item) => item.sku === 'FL-001') ?? null;
    state.bread = state.bread ?? items.find((item) => item.sku === 'BR-001') ?? null;
  }
  const warehouseCode = (id) => (String(id) === String(state.mainWarehouse?.id) ? state.mainWarehouse?.code
    : (String(id) === String(state.vanWarehouse?.id) ? state.vanWarehouse?.code : String(id).slice(0, 8)));
  for (const [label, item] of [['دقيق', state.flour], ['خبز', state.bread]]) {
    const itemLevels = levels.filter((l) => String(l.itemId) === String(item?.id));
    const parts = itemLevels.map((l) => `${warehouseCode(l.warehouseId)} ${money(l.quantity)} كجم بقيمة ${money(l.value)} (متوسط ${money(l.averageCost)})`);
    const totalValue = itemLevels.reduce((s, l) => s + dec(l.value ?? 0), 0);
    console.log(`${label}: ${parts.join(' · ') || '—'} · القيمةُ الإجمالية ${money(totalValue)}`);
  }
  console.log(`السندات اليوم: ${vouchers.length} — منها سنداتُ الخطّ (بمفتاح van-collection-voucher:) ${line.length}${line.length ? ` · المُرحَّلة ${line.filter((v) => String(v.status) === 'posted').length} · المسودة ${line.filter((v) => String(v.status) === 'draft').length}` : ''}`);
  for (const voucher of line.slice(0, 4)) {
    console.log(`  سند ${voucher.number ?? voucher.id} · ${voucher.kind ?? ''}/${voucher.status ?? ''} · ${money(voucher.amount)} · مرجعُه ${voucher.referenceNo ?? '—'}`);
  }
  const locations = rows(await read('مواضع النقد', '/cash-locations?limit=50', ownerToken));
  for (const location of locations) {
    const balances = rows(await read(`رصيد ${location.name}`, `/cash-locations/${location.id}/balances`, ownerToken));
    console.log(`موضعُ النقد «${location.name}» (${location.kind}): ${balances.map((b) => `${money(b.balance)} ${b.currencyCode}${b.updatedAt ? ` · طوبق ${String(b.updatedAt).replace('T', ' ').slice(0, 16)}` : ' · **لم يُطابَق بعد**'}`).join(' | ') || '—'}`);
  }
  const board = await read('لوحة المالك', '/van-sales/dashboard', ownerToken);
  if (board) {
    const summary = board.summary ?? board;
    const picked = ['totalRevenueSar', 'totalCollectedCashSar', 'remainingInVansKg', 'pendingClosingsCount', 'anomalyCount']
      .filter((k) => summary?.[k] !== undefined).map((k) => `${k}=${money(summary[k])}`);
    console.log(`لوحةُ المالك: ${picked.join(' · ') || JSON.stringify(summary).slice(0, 200)}`);
  }
  // والمندوبُ **لا** يقرأ لوحة المنشأة (‏٤٠٣ `VAN_SALES_COMPANY_SCOPE_REQUIRED` — تحجيمُ ١٩
  // يعمل كما صُمّم)، فمساحتُه هو `GET /van-sales/me`.
  const mine = await read('مساحة المندوب', '/van-sales/me', repToken);
  if (mine) {
    const totals = mine.totals ?? {};
    console.log(`مساحةُ المندوب: إيراد ${totals.revenue ?? '—'} · نقد ${totals.cashSales ?? '—'} · آجل ${totals.creditSales ?? '—'} · محصّل ${totals.collected ?? '—'} · قائم ${totals.outstanding ?? '—'} · عهدة ${mine.custody?.officialKg ?? '—'} كجم · إقفالاتٌ معلّقة ${mine.custody?.pendingClosings ?? '—'}`);
  }
  console.log(`\nالشاشات: /treasury (سنداتُ الخطّ وموضعُ النقد) · /sales · /collection · /custody · /distribution · /production · /reports · /rep`);
}

async function main() {
  console.log(`\n▸ day-line demo · base=${BASE} · tenant=${TENANT} · tag=${TAG}${args.reportOnly ? ' · report-only' : ''}\n`);
  const ownerToken = await login('المالك', OWNER);
  const repToken = await login('المندوب', REP);

  await loadReferences(ownerToken);
  await findSalesman(ownerToken);
  if (args.reportOnly) { await report(ownerToken, repToken); return; }

  await ensureCatalog(ownerToken);
  await ensureFlourStock(ownerToken);
  await ensureProductionBatch(ownerToken);
  await ensureLoadAndReceipt(ownerToken, repToken);
  if (state.loadOrder) {
    await ensureDocuments(repToken);
    if (state.creditDocument) await ensureCollection(repToken);
    await ensureClosing(repToken, ownerToken);
  }
  await report(ownerToken, repToken);

  if (failures > 0) {
    console.error(`\n✗ ${failures} خطوةً رفضها الخادم — ورسائلُه مطبوعةٌ أعلاه كما هي (لا تُخفى ولا تُخمَّن).`);
    process.exit(1);
  }
  console.log('\n✓ السلسلةُ كاملة — وما كُتب نتيجةُ حراس المنتج لا إدراجٌ يدويّ.');
}

await main();
