import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * وكيل `/api/v1` من كل واجهة إلى الـAPI.
 *
 * العيب الذي يمنعه هذا الملف: كان الافتراضي `http://127.0.0.1:${PORT}`، و`PORT` هو منفذ
 * **الواجهة** عند PM2/`next start` ⇒ توكّل الواجهة إلى نفسها، فيفشل كل نداء API بـ404
 * محلي ويبدو العطل وكأنه في الخادم. والاختبار يثبت الحالتين:
 *   • بلا `API_PROXY_TARGET` يبقى الهدف منفذ الـAPI (3000) حتى لو كان `PORT=3001`.
 *   • وبوجود `API_PROXY_TARGET` يُحترم حرفياً.
 * ثم يفحص الملفات الخمسة نصّاً، فلا يعود أحدها إلى `process.env.PORT`.
 */

process.env.PORT = '3001';
delete process.env.API_PROXY_TARGET;

const { default: staffConfig } = await import('../next.config.mjs');

afterEach(() => {
  delete process.env.API_PROXY_TARGET;
  vi.resetModules();
});

type Rewrite = { source: string; destination: string };

/** يُقيّم `next.config.mjs` في عملية Node جديدة ببيئةٍ معدَّلة، ويُعيد قواعد `rewrites()`. */
function rewritesInFreshProcess(env: Record<string, string>): Rewrite[] {
  const configUrl = new URL('../next.config.mjs', import.meta.url).href;
  const script = `
    const mod = await import(${JSON.stringify(configUrl)});
    process.stdout.write(JSON.stringify(await mod.default.rewrites()));
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return JSON.parse(output) as Rewrite[];
}

describe('web → API proxy target', () => {
  it('defaults to the API port even when the app itself runs on another port', async () => {
    const rules = await staffConfig.rewrites();
    const apiRule = rules.find((rule: { source: string }) => rule.source === '/api/v1/:path*');
    expect(apiRule?.destination).toBe('http://127.0.0.1:3000/api/v1/:path*');
    expect(rules.find((rule: { source: string }) => rule.source === '/api/health/:path*')?.destination).toBe(
      'http://127.0.0.1:3000/health/:path*',
    );
  });

  it('honours an explicit API_PROXY_TARGET (and trims a trailing slash)', () => {
    // عمليةٌ مستقلة: `next.config.mjs` وحدة ESM واحدة تُقيَّم مرة واحدة لكل عملية، فإعادة
    // الاستيراد بمساعد `?explicit` تعمل في Vite وحده ويفشل عليها `tsc --noEmit`
    // (‏TS2307). التقييم في عمليةٍ جديدة يختبر الملف كما يراه Next في البناء تماماً.
    const rules = rewritesInFreshProcess({ API_PROXY_TARGET: 'http://api.internal:8080/' });
    expect(rules.find((rule) => rule.source === '/api/v1/:path*')?.destination).toBe(
      'http://api.internal:8080/api/v1/:path*',
    );
  });

  it('no surface derives the API target from its own PORT', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    for (const app of ['staff', 'customer-portal', 'marketing', 'platform-admin', 'bakery']) {
      const source = readFileSync(`${root}apps/${app}/next.config.mjs`, 'utf8');
      const declaration = /const apiTarget = .*;/.exec(source)?.[0] ?? '';
      expect(declaration, app).toContain("'http://127.0.0.1:3000'");
      expect(declaration, app).not.toContain('process.env.PORT');
    }
  });
});
