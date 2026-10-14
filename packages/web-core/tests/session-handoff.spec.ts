import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const read = (name: string) => readFile(new URL(`../src/${name}`, import.meta.url), 'utf8');

/**
 * AUD-08 — جسر الدخول لا يمرّر رموز الجلسة في العنوان.
 *
 * ما كان: `?token=<access>&refresh=<refresh>&tenant=…` ثم حذفها بعد التحميل — والعنوان
 * يكون قد سُجّل في طبقة أمامية. ما نُثبته هنا نصّياً (لا متصفح في هذه المجموعة):
 * الجسر الحالي يقرأ `?handoff=` وحده، ويستبدله بـPOST، وينظّف العنوان **قبل** الطلب.
 *
 * انتقل هذا السبيك مع الكود الذي يفحصه: الجسر (`token-bridge.tsx`) وعميل الجلسة
 * (`api.ts`) صارا في `@erp/web-core` لتستعملهما كل واجهة مستأجرة، والأحكام كما هي بحرفها.
 */
describe('AUD-08 — session handoff (web-core)', () => {
  it('the bridge redeems a single-use code over POST — never a token from the query', async () => {
    const bridge = await read('token-bridge.tsx');
    expect(bridge).toContain("searchParams.get('handoff')");
    expect(bridge).toContain('/auth/handoff/redeem');
    expect(bridge).not.toContain("searchParams.get('token')");
    expect(bridge).not.toContain("searchParams.get('refresh')");

    // التنظيف يسبق طلب الاستبدال: لا يبقى الرمز في المحفوظات حتى لو فشل الطلب.
    const stripAt = bridge.indexOf('searchParams.delete');
    const fetchAt = bridge.indexOf('handoff/redeem');
    expect(stripAt).toBeGreaterThan(-1);
    expect(stripAt).toBeLessThan(fetchAt);

    /**
     * والفشل **مغلق ومُعلَّل**: لا يُرمى المستخدم إلى مسارٍ غير موجود (لا `/login` في
     * `apps/staff` — قُيس 404)، بل إلى المسار الجذري حيث ترسم القشرة شاشة الدخول، ومعها
     * وسمٌ تقرأه الشاشة لتقول إن الرابط منتهٍ بدل الصمت.
     */
    expect(bridge).not.toContain("'/login");
    expect(bridge).toContain("failedRedirect = '/?handoff=failed'");
  });

  it('the session client never builds a token-bearing URL', async () => {
    const api = await read('api.ts');
    expect(api).not.toMatch(/location\.assign\([^)]*accessToken/);
    expect(api).not.toMatch(/\?token=/);
  });
});
