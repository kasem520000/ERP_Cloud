#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * `node scripts/ui-registry.mjs` — regenerate `docs/ui-v5/SCREENS.md` from
 * `docs/ui-v5/screens.json`.
 *
 * `screens.json` is the state of the v5 screen-by-screen rebuild: one row per
 * `page.tsx` in every app, with `done`, `rebuilt` and a free-form note. The
 * Markdown file is derived, so it can never drift from the route tree.
 *
 *   node scripts/ui-registry.mjs            # write SCREENS.md
 *   node scripts/ui-registry.mjs --check    # fail when a route is missing
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stateFile = join(root, 'docs/ui-v5/screens.json');
if (!existsSync(stateFile)) {
  console.error('docs/ui-v5/screens.json is missing — run the generator first.');
  process.exit(1);
}
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const appLabel = {
  staff: 'لوحة الموظفين · staff',
  'platform-admin': 'لوحة المنصة · platform-admin',
  'customer-portal': 'بوابة العميل · customer-portal',
  marketing: 'الموقع التسويقي · marketing',
  bakery: 'تطبيق المخابز · bakery',
};
const order = ['staff', 'platform-admin', 'customer-portal', 'marketing', 'bakery'];

let missing = 0;
for (const app of Object.keys(state.apps)) {
  const files = execSync(`find apps/${app}/app -name page.tsx`, { cwd: root }).toString().trim().split('\n').filter(Boolean);
  const routes = new Set(state.apps[app].map((row) => row.route));
  for (const file of files) {
    const route = file.replace(`apps/${app}/app`, '').replace(/\/page\.tsx$/, '') || '/';
    if (!routes.has(route)) {
      console.error(`missing from screens.json: ${app} ${route}`);
      missing += 1;
    }
  }
}
if (missing > 0) {
  console.error(`${missing} route(s) missing — add them before regenerating the document.`);
  process.exit(1);
}

const lines = [];
lines.push('# سجل الشاشات — v5');
lines.push('');
lines.push('> مُولَّد من `docs/ui-v5/screens.json` بالأمر `node scripts/ui-registry.mjs`. لا تُحرّره يدوياً.');
lines.push('');
lines.push(`**الإجمالي:** ${state.totals.all} شاشة · **مكتملة:** ${Object.values(state.apps).flat().filter((r) => r.done).length}`);
lines.push('');
lines.push('المفتاح: `- [x]` الشاشة أُعيد بناؤها/اعتُمدت في v5 · `- [ ]` لم تُعالج بعد · **R** أُعيد بناء هيكلها · **S** طُبّق عليها النظام المشترك وتحقّقت.');
lines.push('');
lines.push('| التطبيق | الشاشات | مكتمل |');
lines.push('| --- | ---: | ---: |');
for (const app of order) {
  const rows = state.apps[app] ?? [];
  lines.push(`| ${appLabel[app]} | ${rows.length} | ${rows.filter((r) => r.done).length} |`);
}
lines.push('');

for (const app of order) {
  const rows = state.apps[app] ?? [];
  if (rows.length === 0) continue;
  lines.push(`## ${appLabel[app]}`);
  lines.push('');
  const groups = new Map();
  for (const row of rows) {
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  for (const [group, items] of groups) {
    lines.push(`### ${group}`);
    lines.push('');
    lines.push('| ✔ | الشاشة | المسار | الملف | المعالجة | ملاحظة |');
    lines.push('| :-: | --- | --- | --- | :-: | --- |');
    for (const row of items.sort((a, b) => a.route.localeCompare(b.route))) {
      const mark = row.done ? 'x' : ' ';
      const kind = row.rebuilt ? 'R' : row.done ? 'S' : '';
      lines.push(`| [${mark}] | ${row.title} | \`${row.route}\` | \`${row.file.replace(`apps/${app}/app/`, '')}\` | ${kind} | ${row.note ?? ''} |`);
    }
    lines.push('');
  }
}
writeFileSync(join(root, 'docs/ui-v5/SCREENS.md'), lines.join('\n'));
console.log(`SCREENS.md written — ${state.totals.all} screens, ${Object.values(state.apps).flat().filter((r) => r.done).length} done.`);
