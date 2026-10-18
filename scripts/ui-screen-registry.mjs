#!/usr/bin/env node
/** Inventory Next.js App Router entrypoints. Preserve manual review states on regeneration.
 * Run: node scripts/ui-screen-registry.mjs [--check]
 * Dynamic paths are route templates, not assertions that every record state was tested.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = process.cwd();
const dest = join(root, 'docs/ui-redesign/SCREEN_REGISTRY.md');
const apps = ['staff', 'bakery', 'platform-admin', 'marketing', 'customer-portal'];
const columns = ['ID', 'الشاشة', 'التطبيق', 'المسار', 'المصدر', 'المكونات/الاعتماديات المباشرة', 'فحص أولي', 'إعادة هيكلة', 'ربط المحرك', 'فحص بصري', 'تفاعلات', 'RTL/LTR', 'إعادة فحص', 'ملاحظات/عوائق/أدلة'];
const prior = new Map();
if (existsSync(dest)) {
  for (const line of readFileSync(dest, 'utf8').split('\n')) {
    if (!line.startsWith('| UI-')) continue;
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length === columns.length) prior.set(cells[0], cells);
  }
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : /^(page|not-found)\.(tsx|ts|jsx|js)$/.test(entry.name) ? [path] : [];
  });
}
const rows = [];
for (const app of apps) {
  for (const file of walk(join(root, 'apps', app, 'app')).sort()) {
    const source = relative(root, file).split(sep).join('/');
    const parts = relative(join(root, 'apps', app, 'app'), file).split(sep);
    const isNotFound = parts.pop().startsWith('not-found.');
    const route = '/' + parts.filter((part) => !/^\(.*\)$/.test(part) && !part.startsWith('@')).join('/');
    const path = route === '/' ? '/' : route.replace(/\/$/, '');
    const display = isNotFound ? `${path} (404)` : path;
    const id = 'UI-' + createHash('sha256').update(`${app}:${display}`).digest('hex').slice(0, 10).toUpperCase();
    const code = readFileSync(file, 'utf8');
    const deps = [...code.matchAll(/from\s+['"]([^'"]+)['"]/g)]
      .map((match) => match[1])
      .filter((value) => value.includes('components/') || value.startsWith('@erp/ui') || value.includes('lib/navigation'))
      .map((value) => value.replace(/\|/g, '\\|'));
    const component = deps.length ? [...new Set(deps)].join(', ') : 'داخلي / راجع المصدر';
    const old = prior.get(id);
    const values = [id, isNotFound ? '404' : parts.at(-1) || 'الرئيسية', app, display, `\`${source}\``, component,
      ...(old ? old.slice(6) : ['NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED', 'NOT_STARTED',
        code.includes('redirect(') ? 'تحويل؛ لا صفحة مرئية مستقلة' : path.includes('[') ? 'مسار ديناميكي: اختبر سجلًا موجودًا/مفقودًا وحالات التحميل والخطأ' : '—'])];
    rows.push(values);
  }
}
const table = [
  '# سجل شاشات واجهات الويب',
  '',
  '> مولّد من ملفات App Router بواسطة `node scripts/ui-screen-registry.mjs`. لا تغيّر المعرّفات أو المسارات يدوياً؛ يمكن تحديث أعمدة الحالة والملاحظات ثم إعادة التوليد دون فقدها. `--check` يتحقق من تطابق المسارات دون الكتابة. الصف يمثل مساراً لا كل حالات التحميل/الحوار/البيانات؛ حالات الشاشة موثّقة في الخطة. `NOT_STARTED` تعني عدم التحقق. `DONE` في «إعادة فحص» = قبول واجهة هذا المسار بعد استيفاء بواباته المنطبقة، لا شهادة أمنية أو قبولاً لكل التطبيق؛ `RTL_CHECKED_LTR_NA` يعني أن المسار عربي فقط ولا يعلن نظيراً إنجليزياً.',
  '',
  `**الإجمالي: ${rows.length} مدخلاً** (${apps.map((app) => `${app}: ${rows.filter((row) => row[2] === app).length}`).join('، ')}). يتضمن صفحات 404 المخصصة.`,
  '',
  '| ' + columns.join(' | ') + ' |',
  '| ' + columns.map(() => '---').join(' | ') + ' |',
  ...rows.map((row) => '| ' + row.join(' | ') + ' |'),
  '',
].join('\n');
if (process.argv.includes('--check')) {
  if (!existsSync(dest) || readFileSync(dest, 'utf8') !== table) {
    console.error('SCREEN_REGISTRY.md is out of date; run node scripts/ui-screen-registry.mjs');
    process.exitCode = 1;
  } else console.log(`${rows.length} registered routes match App Router`);
} else {
  writeFileSync(dest, table);
  console.log(`Wrote ${rows.length} screen entries`);
}
