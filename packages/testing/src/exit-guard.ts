/**
 * حارسُ رمز الخروج: لا تُحوَّل اختباراتٌ حمراء إلى «نجاح».
 *
 * القصة، لأنها أخطر مما تبدو: `embedded-postgres` (قاعدة الاختبارات) يعتمد على
 * `async-exit-hook`، وهذا يسجّل مستمعاً على `beforeExit` ينفّذ `process.exit(0)`.
 * و`beforeExit` يُطلق عند **فراغ حلقة الأحداث** — أي في اللحظة التي يوشك فيها Node على
 * الخروج بالرمز الذي ضبطه المشغّل. فيُستبدَل رمز الخروج بـ`0` في كل تشغيلٍ يبدأ قاعدة
 * اختبار مضمّنة، أي كل اختبارات `apps/api`.
 *
 * الأثر المقيس: `vitest run` أبلغ عن `Tests 1 failed | 1913 passed` ثم خرج بـ`0`، فمرّ
 * `pnpm verify` و`CI` أخضرَين واختبارٌ أحمر. أي أن **بوابة الجودة كانت معطّلة بصمت**،
 * وكل «CI أخضر» قبل هذا الإصلاح يعني «لم ينفجر شيء» لا «كل الاختبارات مرّت».
 *
 * العلاج: نحتفظ بسلوك التنظيف (نحن نُغلق الخادم صراحةً في teardown) ونُزيل المستمع
 * الدخيل الذي فُرض على العملية. والتقاط اللقطة قبل الاستيراد يجعل الإزالة محدّدة:
 * لا نمسّ مستمعاً لم نُضِفه.
 */

/**
 * اللقطة تشمل الحدثين اللذين تُسجّل عليهما المكتبة: `beforeExit` (هو الذي يمحو رمز
 * الخروج) و`exit` (تنظيفها المتزامن، وهو الذي يرمي `done is not a function` بعد إزالة
 * الأول — عيبٌ ثانٍ كان مخفيّاً خلف الخروج القسري).
 */
export function snapshotExitListeners(): {
  beforeExit: Array<(...args: unknown[]) => void>;
  exit: Array<(...args: unknown[]) => void>;
} {
  return {
    beforeExit: process.listeners('beforeExit') as Array<(...args: unknown[]) => void>,
    exit: process.listeners('exit') as Array<(...args: unknown[]) => void>,
  };
}

/** اسمٌ قديم محفوظ للتوافق مع النداءات السابقة. */
export function snapshotBeforeExit(): Array<(...args: unknown[]) => void> {
  return snapshotExitListeners().beforeExit;
}

/**
 * يُزيل كل مستمع `beforeExit` أُضيف بعد اللقطة — وبالتحديد مستمع `async-exit-hook`
 * الذي يفرض `exit(0)`.
 *
 * ويُبقى مستمع `exit` كما هو: ذاك لا يغيّر رمز الخروج (‏`exit: false` فيه)، وإزالته
 * تعطّل تنظيف المكتبة على الإشارات.
 */
export function detachForcedExitHook(before: ReturnType<typeof snapshotExitListeners>): string[] {
  const removed: string[] = [];

  for (const listener of process.listeners('beforeExit') as Array<(...args: unknown[]) => void>) {
    if (before.beforeExit.includes(listener)) continue;
    process.removeListener('beforeExit', listener);
    removed.push(`beforeExit:${listener.name || 'anonymous'}`);
  }

  // تنظيف المكتبة عند `exit` يُستدعى بلا وسيطٍ فيرمي؛ وإغلاق الخادم نتولّاه صراحةً في
  // `stop()` من teardown، فلا حاجة إلى مستمعها.
  for (const listener of process.listeners('exit') as Array<(...args: unknown[]) => void>) {
    if (before.exit.includes(listener)) continue;
    process.removeListener('exit', listener);
    removed.push(`exit:${listener.name || 'anonymous'}`);
  }

  return removed;
}
