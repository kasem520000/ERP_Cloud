import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { DEFAULT_FAILED_REDIRECT, HANDOFF_FAILED_MARKER, handoffAction } from '../src/token-bridge';

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
 *
 * وما كان نصّياً وصار **مقيساً**: قرارُ العنوان (`handoffAction`) دالّةٌ صافية، فحكمُ
 * «لا يُستبدل وسمُ الفشل رمزاً» يُنفَّذ ويُفحص بدل أن يُقرأ في النصّ.
 */
describe('AUD-08 — session handoff (web-core)', () => {
  it('reads exactly one handoff code from the address — and never a token', () => {
    expect(handoffAction('?handoff=abc123')).toEqual({ kind: 'redeem', code: 'abc123' });
    expect(handoffAction('?handoff=abc123&utm=x')).toEqual({ kind: 'redeem', code: 'abc123' });
    expect(handoffAction('')).toEqual({ kind: 'none' });
    expect(handoffAction('?token=access&refresh=refresh')).toEqual({ kind: 'none' });
  });

  /**
   * 🚦 حلقة إعادة التحميل: هدفُ الفشل يحمل `?handoff=failed`، ولو عُومل `failed` رمزاً
   * لصار المسار: استبدال ← رفض ← تحويل إلى العنوان نفسه ← استبدال ← … بلا نهاية، وبنداءٍ
   * خاسر للخادم في كلّ دورة (وهذا كان قائماً في الجسر وفي نسخة بوابة العميل معاً).
   * الشاشة ترسم الوسم، والجسر لا يستبدله.
   */
  it('treats its own failure marker as a marker, not as a code — so the failure target cannot loop', () => {
    const target = new URL(DEFAULT_FAILED_REDIRECT, 'https://bakery.erp.example');
    expect(target.searchParams.get('handoff')).toBe(HANDOFF_FAILED_MARKER);
    expect(handoffAction(target.search)).toEqual({ kind: 'failed' });
    expect(HANDOFF_FAILED_MARKER).toBe('failed');
  });

  it('the bridge redeems a single-use code over POST — never a token from the query', async () => {
    const bridge = await read('token-bridge.tsx');
    expect(bridge).toContain("new URLSearchParams(search).get('handoff')");
    expect(bridge).toContain("if (action.kind !== 'redeem') return;");
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
    expect(bridge).toContain('failedRedirect = DEFAULT_FAILED_REDIRECT');
  });

  it('the session client never builds a token-bearing URL', async () => {
    const api = await read('api.ts');
    expect(api).not.toMatch(/location\.assign\([^)]*accessToken/);
    expect(api).not.toMatch(/\?token=/);
  });
});
