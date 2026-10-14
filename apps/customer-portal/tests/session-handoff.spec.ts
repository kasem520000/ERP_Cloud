import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { FAILED_LOGIN } from '../components/token-bridge';

const appDir = fileURLToPath(new URL('../app', import.meta.url));

/**
 * AUD-08 — بوابة العميل تستقبل رمز تسليمٍ لمرة واحدة، لا رمز جلسة في العنوان.
 */
describe('AUD-08 — customer-portal session handoff', () => {
  it('the bridge redeems ?handoff= over POST and strips it first', async () => {
    const bridge = await readFile(new URL('../components/token-bridge.tsx', import.meta.url), 'utf8');
    expect(bridge).toContain("searchParams.get('handoff')");
    expect(bridge).toContain('/auth/handoff/redeem');
    expect(bridge).not.toContain("searchParams.get('token')");
    expect(bridge.indexOf('searchParams.delete')).toBeLessThan(bridge.indexOf('handoff/redeem'));
  });

  /**
   * التحويل إلى صفحةٍ لا وجود لها أسوأ من البقاء في المكان: لحظة رفض رمز التسليم هي
   * أسوأ لحظةٍ في الدخول، وكانت البوابة تُكافئها بـ 404 لأنّ مسارات الدخول هنا تحت
   * `app/auth/*` ولا `/login` في الجذر. القياس يثبت الهدف وقت التشغيل (من الثابت
   * المُصدَّر، لا من نصّ المصدر) ويثبت أنّ وراءه صفحةً فعلًا.
   */
  it('aims the failed handoff at a route the portal really has', async () => {
    const bridge = await readFile(new URL('../components/token-bridge.tsx', import.meta.url), 'utf8');
    expect(bridge).not.toMatch(/assign\(\s*['"`]\/login/);
    expect(FAILED_LOGIN).toContain('handoff=failed');

    const pathname = FAILED_LOGIN.split('?')[0] ?? '';
    expect(pathname).toBe('/auth/login');
    expect(existsSync(join(appDir, `${pathname.slice(1)}/page.tsx`)), pathname).toBe(true);
  });

  it('tells the customer the handoff link expired instead of showing a silent form', async () => {
    const page = await import('../app/auth/login/page');

    const failed = renderToStaticMarkup(
      await page.default({ searchParams: Promise.resolve({ handoff: 'failed' }) }),
    );
    expect(failed).toContain('منتهٍ أو مُستعمل سابقاً');
    expect(failed).toContain('alert danger');
    expect(failed).toContain('تسجيل الدخول');

    const plain = renderToStaticMarkup(await page.default({ searchParams: Promise.resolve({}) }));
    expect(plain).toContain('تسجيل الدخول');
    expect(plain).not.toContain('منتهٍ أو مُستعمل سابقاً');
  });

  it('the portal client never puts a token in a URL', async () => {
    const api = await readFile(new URL('../lib/api.ts', import.meta.url), 'utf8');
    expect(api).not.toMatch(/\?token=/);
    expect(api).not.toMatch(/location\.assign\([^)]*token/i);
  });
});
