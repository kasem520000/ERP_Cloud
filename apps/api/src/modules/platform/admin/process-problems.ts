import { recordServerProblem, type ServerProblemInput } from './problem-recorder.js';

/**
 * أخطاء العملية نفسها — البند 3: «أي خطأ من جانب السيرفر في كل السيرفرات».
 *
 * فلتر الاستثناءات يرى ما يمرّ في دورة طلب HTTP. أمّا استثناءٌ في مؤقّتٍ أو في طابور
 * أو وعدٌ رُفض بلا `catch` فلا يمرّ على فلتر، وكان مصيره stdout ثم السقوط. هنا يُكتب
 * الصفّ **قبل** الإنهاء، مع مهلةٍ قصيرة لا تُعلّق العملية إن تعطّلت القاعدة.
 *
 * ولا يُغيَّر سلوك الإنهاء: بعد التسجيل يُعاد الرمي/الخروج بالقواعد المعتادة، لأن سجلّاً
 * لا يُصلح عمليةً ساقطة.
 */

let installed = false;

export function installProcessProblemHandlers(source: ServerProblemInput['source'] = 'api'): void {
  if (installed) return;
  installed = true;

  const report = async (kind: string, error: unknown): Promise<void> => {
    const err = error instanceof Error ? error : new Error(String(error));
    await Promise.race([
      recordServerProblem({
        source,
        severity: 'error',
        code: kind,
        message: err.message || kind,
        meta: {
          kind,
          stack: (err.stack ?? '').split('\n').slice(0, 10).join('\n'),
        },
      }),
      new Promise((resolve) => setTimeout(resolve, 750)),
    ]);
  };

  process.on('unhandledRejection', (reason) => {
    void report('unhandledRejection', reason).finally(() => {
      console.error('unhandledRejection', reason);
    });
  });

  process.on('uncaughtException', (error) => {
    void report('uncaughtException', error).finally(() => {
      console.error('uncaughtException', error);
      // السقوط كما كان: العملية في حالةٍ غير موثوقة بعد استثناءٍ غير ملتقط.
      process.exit(1);
    });
  });
}
