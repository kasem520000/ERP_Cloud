#!/usr/bin/env node
/**
 * `pnpm demo:fix-vat -- --tenant demo [--apply]` — تصحيحُ نسبةِ ضريبةٍ كُتبت خطأً في بذرة
 * العرض، **عبر مسارات المنتج** لا بـSQL ولا بهجرةٍ تعيد كتابة التاريخ.
 *
 * العيبُ (قِيس ٢٠٢٦-١٠-١٧، وتفصيلُه في §٢١ب من التقرير): بذرةُ العرض كتبت مجموعةَ
 * «ضريبة القيمة المضافة 15%» بـ`rate = 0.1500` والمحرّك يحسب `rate / 100`
 * (‏`van-sales.service.ts:4627`) ⇒ ضريبةُ فاتورةٍ بـ٦٠٠٫٠٠ كانت **٠٫٩٠** لا ٩٠٫٠٠. وأُصلحت
 * البذرةُ (`15.0000`) وثبّتتها أحكامٌ في `packages/database/src/seed-demo.spec.ts` — لكنّ
 * المنشآتِ المذبورة قبل الإصلاح بقيت على الخطأ، ونسبةُ المجموعة **تُقفل بعد أوّل فاتورة**:
 * ‏`PATCH …/tax-groups/:id` ⇒ ٤٠٩ `TAX_GROUP_RATE_LOCKED` متى أشارت
 * ‏`sales_invoice_lines.tax_group_id` إليها (`catalog.service.ts:879-905`).
 *
 * ولذلك طريقان، والخادمُ هو من يختار بينهما بالقياس لا بالنيّة:
 *
 *   أ) **غير مقفولة** ⇒ `PATCH` بالنسبة الصحيحة مباشرة (قِيس ٢٠٠ على `bakeryco` و`bakery`).
 *   ب) **مقفولة** ⇒ ما أذن به المنتجُ نفسه («Create a new group for a new rate; rename this
 *      one freely»): مجموعةٌ جديدة بالنسبة الصحيحة تحمل حسابَ الضريبة نفسه، وتسميةُ القديمة
 *      بما لا يكذب («… — مجموعة تاريخية بنسبةٍ خاطئة»)، وإعادةُ ربط **الأصناف** بها
 *      (‏`PATCH …/items/:id {taxGroupId}` — والحقلُ في `CatalogItemPatch`).
 *
 * وما **لا** يُلمس أبدًا: الفواتيرُ المُصدَرة. فكلُّ فاتورةٍ خزّنت النسبةَ التي صُدرت بها،
 * وإعادةُ كتابتها تزويرٌ في مستندٍ ضريبيّ — وهذا قرارُ صاحبِ العمل (ب٢٢) وقد اختار
 * «مجموعةٌ جديدة وإعادةُ ربط الأصناف»، لا تصحيحَ التاريخ.
 *
 * والافتراضيُّ **قياسٌ لا كتابة**: بلا `--apply` تُطبع الخطةُ وحدها.
 */
import process from 'node:process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const env = {};
for (const line of readFileSync(path.join(repoRoot, '.env'), 'utf8').split('\n')) {
  if (!/^[A-Z_]+=/.test(line)) continue;
  const at = line.indexOf('=');
  env[line.slice(0, at)] = line.slice(at + 1);
}

const HELP = `
تصحيحُ نسبةِ مجموعة ضريبةٍ كُتبت خطأً في بذرة العرض — عبر مسارات المنتج، وبلا لمسٍ لفاتورة.

  pnpm demo:fix-vat -- --tenant demo             # قياسٌ فقط: اطبع ما سيُفعل
  pnpm demo:fix-vat -- --tenant demo --apply     # نفِّذ
  pnpm demo:fix-vat -- --tenant demo --apply --base http://localhost:3000/api/v1

الخيارات:
  --tenant <code>          رمزُ المنشأة (‏DEMO_TENANT_CODE)
  --owner-email/--owner-password   حسابٌ يملك catalog.taxgroup.manage وcatalog.item.manage
  --base <url>             أساسُ API (‏http://localhost:<PORT|3000>/api/v1)
  --suffix <text>          ما يُلحق باسم المجموعة التاريخية (افتراضيًّا يُشتقّ من نسبتها)
  --apply                  بلا هذا العلم لا تُكتب كتابةٌ واحدة
`;

function parseArgs(argv) {
  const out = { apply: false, help: false };
  const keys = { tenant: 'tenant', 'owner-email': 'ownerEmail', 'owner-password': 'ownerPassword', base: 'base', suffix: 'suffix' };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') continue;
    if (!raw.startsWith('--')) { console.error(`✗ وسيطٌ غير متوقّع: ${raw}`); out.help = true; continue; }
    const name = raw.slice(2);
    if (name === 'apply') { out.apply = true; continue; }
    if (name === 'help') { out.help = true; continue; }
    const key = keys[name];
    if (!key) { console.error(`✗ خيارٌ غير معروف: --${name}`); out.help = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) { console.error(`✗ الخيارُ --${name} يحتاج قيمة`); out.help = true; continue; }
    out[key] = value;
    i += 1;
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) { console.log(HELP); process.exit(0); }

const BASE = (args.base ?? `http://localhost:${process.env.PORT ?? 3000}/api/v1`).replace(/\/+$/, '');
const TENANT = args.tenant ?? env.DEMO_TENANT_CODE ?? 'demo';
const EMAIL = args.ownerEmail ?? env.DEMO_OWNER_EMAIL;
const PASSWORD = args.ownerPassword ?? env.DEMO_OWNER_PASSWORD;
if (!EMAIL || !PASSWORD) { console.error('✗ يلزم --owner-email و--owner-password (أو DEMO_OWNER_* في .env)'); process.exit(2); }

const rows = (value) => (Array.isArray(value) ? value : (value?.data ?? []));
async function call(method, urlPath, body, token) {
  const response = await fetch(BASE + urlPath, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let json = text;
  try { json = JSON.parse(text); } catch { /* نصٌّ خام */ }
  return { status: response.status, json };
}
const reasonOf = (res) => (typeof res.json === 'string' ? res.json.slice(0, 300) : String(res.json?.detail ?? res.json?.title ?? '').slice(0, 300));
const codeOf = (res) => String(res.json?.code ?? '');

/**
 * سمةُ المجموعة التاريخية — وتُقرأ قبل أيّ معالجة.
 *
 * وأُصيبت هذه فعلًا: بعد التنفيذ يحمل الاسمُ القديم «15%» **و**«(0.15%)»، وأوّلُ مطابقةٍ
 * للنسبة في الاسم هي «15%» ⇒ فأداةُ التصحيح رأت المجموعةَ التاريخية نفسها خاطئةً في
 * التشغيل الثاني وكانت ستُعيد تسميتها (والاسمُ يطول في كلّ مرّة) وتُعلن خطةً لا معنى لها
 * (‏«إعادةُ ربط ٠ صنفًا»). فقِيس بالتشغيل الثاني وأُصلح بالسمة: ما عُولج وعُلِّم لا يُعالَج.
 */
const HISTORICAL_MARKER = 'مجموعة تاريخية';

/** النسبةُ التي يقولها الاسم — فالاسمُ هو العقدُ الذي يقرأه المحاسب («15%» ⇒ ١٥). */
function percentInLabel(group) {
  const label = `${group?.nameAr ?? ''} ${group?.nameEn ?? ''}`;
  const said = label.match(/(\d+(?:[.٫]\d+)?)\s*%/);
  return said ? Number(said[1].replace('٫', '.')) : null;
}

const plan = [];
const say = (line) => { console.log(line); };

const login = await call('POST', '/auth/login', { email: EMAIL, password: PASSWORD, tenantCode: TENANT });
if (login.status !== 200) { console.error(`✗ دخول ${EMAIL} على «${TENANT}» → ${login.status}\n  ${reasonOf(login)}`); process.exit(1); }
const token = login.json.data.accessToken;
say(`\n▸ تصحيحُ نسبة الضريبة · tenant=${TENANT} · base=${BASE} · ${args.apply ? '‏--apply (كتابة)' : 'قياسٌ فقط'}`);
say(`✓ دخول ${EMAIL}`);

const groups = rows((await call('GET', '/organization/catalog/tax-groups', undefined, token)).json);
const items = rows((await call('GET', '/organization/catalog/items', undefined, token)).json);
say(`  مجموعاتُ الضريبة: ${groups.length} · الأصناف: ${items.length}`);

for (const group of groups) {
  const said = percentInLabel(group);
  const actual = Number(group.rate);
  if (String(group.nameAr ?? '').includes(HISTORICAL_MARKER)) {
    say(`↻ «${group.nameAr}» — مجموعةٌ تاريخيةٌ عُولجت سابقًا وسِمتُها يمنع إعادةَ معالجتها (تُترك)`);
    continue;
  }
  if (said === null) { say(`↻ «${group.nameAr}» بلا نسبةٍ في الاسم — فلا معيارَ يُقاس عليه (تُترك)`); continue; }
  if (said === actual) { say(`✓ «${group.nameAr}» نسبةُها ${group.rate} مطابقةٌ لاسمها`); continue; }

  say(`\n⚠ «${group.nameAr}» اسمُها يقول ${said}% ورقمُها ${group.rate} ⇒ المحرّك يحسبها ${actual}% (‏rate/100)`);
  const boundItems = items.filter((item) => String(item.taxGroupId ?? '') === String(group.id));
  say(`  مرتبطٌ بها ${boundItems.length} صنفًا: ${boundItems.map((item) => item.sku ?? item.nameAr).join(', ') || '—'}`);

  // (أ) جرِّب التصحيحَ المباشر — فالخادمُ هو من يقول إن كانت مقفولة، لا نحن.
  const patch = await call('PATCH', `/organization/catalog/tax-groups/${group.id}`, { rate: said.toFixed(4) }, token);
  if (patch.status === 200) {
    say(`  ✓ الطريق (أ): النسبةُ صُحّحت مباشرةً → ${said.toFixed(4)} (المجموعةُ غيرُ مقفولة: لا فاتورةَ أشارت إليها)`);
    if (!args.apply) plan.push(`PATCH نسبة «${group.nameAr}» ${group.rate} → ${said.toFixed(4)}`);
    continue;
  }
  if (patch.status !== 409 || codeOf(patch) !== 'TAX_GROUP_RATE_LOCKED') {
    console.error(`  ✗ رفضٌ غير متوقّع → ${patch.status} ${codeOf(patch)}: ${reasonOf(patch)}`);
    process.exit(1);
  }
  say(`  ‏${patch.status} ${codeOf(patch)} — فالمجموعةُ استُعملت في فاتورةٍ ونسبتُها مقفولة (وهذا صحيحٌ لا عيب)`);

  // (ب) الطريقُ الذي أذن به المنتج: مجموعةٌ جديدة بالنسبة الصحيحة، وتسميةُ القديمة بما لا
  //     يكذب، وإعادةُ ربط الأصناف. والفواتيرُ المُصدَرة تبقى بنسبتها المخزّنة — ولا تُلمس.
  const correct = groups.find((candidate) => Number(candidate.rate) === said && String(candidate.id) !== String(group.id));
  const target = correct ?? { nameAr: group.nameAr, nameEn: group.nameEn, rate: said.toFixed(4), vatAccountId: group.vatAccountId };
  say(`  → الطريق (ب): ${correct ? `تُستعمل المجموعةُ القائمة «${correct.nameAr}» (${correct.rate})` : `تُنشأ مجموعةٌ بـ${said.toFixed(4)} على حساب الضريبة نفسه (${group.vatAccountId ?? '—'})`}`);
  const suffix = args.suffix ?? ` — ${HISTORICAL_MARKER} بنسبةٍ خاطئة (${actual}%) لا تُستعمل بعد الآن`;
  say(`  → تسميةُ القديمة: «${group.nameAr}${suffix}»`);
  say(`  → إعادةُ ربط ${boundItems.length} صنفًا بالمجموعة الصحيحة`);
  say('  → ولا فاتورةً مُصدَرة تُمسّ: فكلٌّ منها خزنت نسبتَها، وإعادةُ كتابتها تزويرٌ في مستندٍ ضريبيّ');

  if (!args.apply) {
    plan.push(`إنشاء/استعمال مجموعةٍ بـ${said.toFixed(4)} · تسميةُ «${group.nameAr}» تاريخيةً · إعادةُ ربط ${boundItems.length} صنفًا`);
    continue;
  }

  let targetId = correct?.id ?? null;
  if (!targetId) {
    const created = await call('POST', '/organization/catalog/tax-groups', {
      nameAr: target.nameAr, nameEn: target.nameEn, rate: target.rate, vatAccountId: target.vatAccountId ?? undefined,
    }, token);
    if (created.status !== 200 && created.status !== 201) { console.error(`  ✗ إنشاءُ المجموعة → ${created.status}: ${reasonOf(created)}`); process.exit(1); }
    targetId = created.json?.data?.id ?? created.json?.id ?? null;
    say(`  ✓ أُنشئت المجموعةُ ${targetId}`);
  } else {
    say(`  ↻ المجموعةُ الصحيحة قائمةٌ أصلًا (${targetId})`);
  }

  const renamed = await call('PATCH', `/organization/catalog/tax-groups/${group.id}`, { nameAr: `${group.nameAr}${suffix}` }, token);
  if (renamed.status !== 200) { console.error(`  ✗ إعادةُ التسمية → ${renamed.status}: ${reasonOf(renamed)}`); process.exit(1); }
  say(`  ✓ سُمّيت القديمة «${group.nameAr}${suffix}»`);

  let repointed = 0;
  for (const item of boundItems) {
    const patched = await call('PATCH', `/organization/catalog/items/${item.id}`, { taxGroupId: targetId }, token);
    if (patched.status !== 200) {
      console.error(`  ✗ الصنفُ ${item.sku ?? item.id} → ${patched.status}: ${reasonOf(patched)}`);
      process.exit(1);
    }
    repointed += 1;
    say(`  ✓ الصنفُ ${item.sku ?? item.nameAr} رُبط بالمجموعة الصحيحة`);
  }
  say(`  ✓ أُعيد ربطُ ${repointed} صنفًا`);
}

say('\n— الحالةُ بعد التنفيذ —');
const after = rows((await call('GET', '/organization/catalog/tax-groups', undefined, token)).json);
for (const group of after) say(`  «${group.nameAr}» = ${group.rate}`);
const afterItems = rows((await call('GET', '/organization/catalog/items', undefined, token)).json);
const byGroup = new Map();
for (const item of afterItems) {
  const keyId = String(item.taxGroupId ?? '—');
  byGroup.set(keyId, (byGroup.get(keyId) ?? 0) + 1);
}
for (const [groupId, count] of byGroup) {
  const name = after.find((group) => String(group.id) === groupId)?.nameAr ?? groupId;
  say(`  ${count} صنفًا على «${name}»`);
}

if (!args.apply) {
  say(`\n⚠ لم تُكتب كتابةٌ واحدة (قياس). والخطة: ${plan.length ? plan.join(' · ') : 'لا شيء — فالنسبُ مطابقة'}`);
  say('  وللتنفيذ: --apply');
} else {
  say('\n✓ نُفِّذ عبر مسارات المنتج — والفواتيرُ المُصدَرة لم تُمسّ.');
}
