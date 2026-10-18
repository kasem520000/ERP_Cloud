#!/usr/bin/env node
/** Evidence-based route progress from the registry; never count a changed shell as DONE. */
import { readFileSync } from 'node:fs';

const registry = readFileSync(new URL('../docs/ui-redesign/SCREEN_REGISTRY.md', import.meta.url), 'utf8');
const rows = registry.split('\n')
  .filter((line) => line.startsWith('| UI-'))
  .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));

const expected = Number(registry.match(/\*\*الإجمالي: (\d+) مدخلاً\*\*/)?.[1]);
if (!expected || rows.length !== expected) throw new Error(`Registry total (${expected}) differs from its ${rows.length} rows; regenerate the inventory first.`);
const completed = rows.filter((cells) => cells[12] === 'DONE');
for (const cells of completed) {
  const [id, , app, path] = cells;
  if (!cells.slice(6, 11).every((value) => value === 'DONE') || !['DONE', 'RTL_CHECKED_LTR_NA'].includes(cells[11])) {
    throw new Error(`${id} ${app} ${path}: DONE requires the initial, redesign, engine, visual, interaction and applicable direction gates.`);
  }
}
const count = (index, predicate) => rows.filter((cells) => predicate(cells[index])).length;
console.log(`واجهات المسارات: ${rows.length}`);
console.log(`فحص أولي مُسجّل: ${count(6, (value) => value !== 'NOT_STARTED')}`);
console.log(`فحص بصري مُسجّل: ${count(9, (value) => value !== 'NOT_STARTED')}`);
console.log(`تفاعلات مُختبرة جزئياً أو كلياً: ${count(10, (value) => value !== 'NOT_STARTED')}`);
console.log(`إعادة فحص مُسجّلة: ${count(12, (value) => value !== 'NOT_STARTED')}`);
console.log(`DONE (قبول واجهة المسار): ${completed.length}/${rows.length}`);
for (const cells of completed) console.log(`  ${cells[2]} ${cells[3]}`);
