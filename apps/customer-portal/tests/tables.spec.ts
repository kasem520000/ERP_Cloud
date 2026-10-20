import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const appDir = fileURLToPath(new URL('../app', import.meta.url));

type Source = { relative: string; code: string };

function sources(): Source[] {
  return (readdirSync(appDir, { recursive: true }) as string[])
    .filter((relative) => relative.endsWith('.tsx'))
    .map((relative) => ({
      relative,
      // تعليقات المصدر تُشير إلى `<table>` في الشرح ولا تُنشئه.
      code: readFileSync(join(appDir, relative), 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''),
    }));
}

describe('portal table anatomy', () => {
  /**
   * البوابة لا تمرّ على Tailwind، فجدول `@erp/ui` المشترك لا يُصيَّغ فيها. البديل
   * المحلّي `PortalTable` يُكرّر الشكل نفسه؛ وأيُّ `<table>` مكتوبٍ بخطّ اليد يعود
   * يهدم ذلك الشكل، فيُمنع من المصدر.
   */
  it('never hand-writes a raw <table> in the portal app', () => {
    const offenders = sources()
      .filter((source) => source.code.includes('<table'))
      .map((source) => source.relative);
    expect(offenders).toEqual([]);
  });

  it('routes every portal table through the shared PortalTable', () => {
    const uses = sources().reduce(
      (total, source) => total + (source.code.match(/<PortalTable/g)?.length ?? 0),
      0,
    );
    expect(uses).toBeGreaterThan(7);
  });
});
