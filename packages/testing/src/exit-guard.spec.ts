import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { detachForcedExitHook, snapshotExitListeners } from './exit-guard.js';

/**
 * العيب الذي يحرسه هذا الملف عاش طويلاً لأنه غير مرئي: `async-exit-hook` (تبعية
 * `embedded-postgres`) يسجّل مستمع `beforeExit` ينفّذ `process.exit(0)`، فيمحو رمز
 * الخروج غير الصفري الذي يضبطه مشغّل الاختبارات. النتيجة: `vitest run` يُبلّغ عن فشل
 * ثم يخرج بـ`0`، و`pnpm verify` و`CI` أخضران واختبارٌ أحمر.
 *
 * فالاختبار يُشغّل عمليتين حقيقيتين — واحدة تحاكي السلوك قبل الإصلاح، وأخرى بعده —
 * ويقارن رمز الخروج. محاكاةُ المكتبة مقصودة: لا نريد اختباراً يحتاج قاعدة بيانات
 * ليثبت أن بوابة الجودة تعمل.
 */
/**
 * الوحدة تُستورد في العملية الابنة من مصدرها (`--experimental-strip-types` في Node 22)
 * لا من `dist`، فلا يشترط الاختبار بناءً مسبقاً.
 */
const guardSource = fileURLToPath(new URL('./exit-guard.ts', import.meta.url));

function exitCodeOf(script: string): number {
  try {
    execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '--eval', script], {
      stdio: 'pipe',
      timeout: 30_000,
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

/** يحاكي `async-exit-hook`: مستمع `beforeExit` يفرض الخروج بصفر، ومستمع `exit` يُنظّف. */
const INSTALL_HOOK = `
  process.on('beforeExit', () => { process.nextTick(process.exit.bind(null, 0)); });
  process.on('exit', () => { throw new Error('تنظيفُ المكتبة لا يجوز أن يرمي عند الخروج'); });
  process.exitCode = 3;
`;

describe('حارس رمز الخروج', () => {
  it('يُثبت العيب: مستمع beforeExit يحوّل الخروج من 3 إلى 0', () => {
    expect(exitCodeOf(INSTALL_HOOK)).toBe(0);
  });

  it('بعد الإزالة يعود رمز الخروج الحقيقي', () => {
    const script = `
      import { detachForcedExitHook, snapshotExitListeners } from ${JSON.stringify(guardSource)};
      const before = snapshotExitListeners();
      ${INSTALL_HOOK}
      const removed = detachForcedExitHook(before);
      if (removed.length !== 2) { console.error('removed=' + JSON.stringify(removed)); process.exit(9); }
      process.exitCode = 3;
    `;
    expect(exitCodeOf(script)).toBe(3);
  });

  it('لا يمسّ مستمعاً كان موجوداً قبل اللقطة (وإنما يُزيل ما أُضيف بعدها)', () => {
    function preexisting(): void {}
    function addedLater(): void {}
    process.on('beforeExit', preexisting);
    try {
      const before = snapshotExitListeners();
      process.on('beforeExit', addedLater);
      const removed = detachForcedExitHook(before);

      expect(process.listeners('beforeExit')).toContain(preexisting);
      expect(process.listeners('beforeExit')).not.toContain(addedLater);
      expect(removed).toEqual(['beforeExit:addedLater']);
    } finally {
      process.removeListener('beforeExit', preexisting);
      process.removeListener('beforeExit', addedLater);
    }
  });
});
