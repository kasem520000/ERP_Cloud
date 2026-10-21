import { createHash } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PasswordBreachChecker } from './password-breach.js';

const sha1 = (password: string): string => createHash('sha1').update(password, 'utf8').digest('hex').toUpperCase();

/**
 * 🔐 k-anonymity: ما يُرسَل هو خمسة أحرف من بصمة SHA-1 — لا كلمة المرور ولا بصمتها.
 *
 * كل اختبار هنا يقيس سلوكاً يمكن أن يكذب في الإنتاج: ردٌّ بحجمٍ ثابت لا يعني «نظيف»،
 * ومزوّدٌ ساقط لا يعني «مسرَّب»، وقاطعٌ مفتوح لا يعني أن الفحص يعمل. والخادم المحلّي
 * يُستعمل في اختبارٍ واحد ليمرّ الطلب من `fetch` حقيقية، والباقي بحقن `fetch` كي تُقاس
 * المهلة والقاطع بلا انتظارٍ حقيقي.
 */
describe('PasswordBreachChecker — فحص التسريبات بنمط k-anonymity', () => {
  const password = 'Correct&Horse9!2026';
  const digest = sha1(password);
  const prefix = digest.slice(0, 5);
  const suffix = digest.slice(5);

  let server: Server;
  let endpoint: string;
  let requested: string[] = [];
  let reply = '';

  beforeAll(async () => {
    server = createServer((request, response) => {
      requested.push(request.url ?? '');
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end(reply);
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (typeof address === 'string' || address === null) throw new Error('no port');
    endpoint = `http://127.0.0.1:${address.port}/range/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('sends only the first five hash characters over the wire', async () => {
    requested = [];
    reply = `${suffix}:3\r\n`;
    const checker = new PasswordBreachChecker({ mode: 'enforce', endpoint, timeoutMs: 2_000 });

    const verdict = await checker.check(password);

    expect(verdict).toEqual({ status: 'breached', count: 3 });
    expect(requested).toEqual([`/range/${prefix}`]);
    // لا كلمة مرور ولا بصمة كاملة في أي شيء أُرسل.
    const wire = requested.join(' ');
    expect(wire).not.toContain(password);
    expect(wire).not.toContain(digest);
  });

  it('compares the suffix case-insensitively and ignores padding rows', async () => {
    requested = [];
    reply = `${suffix.toLowerCase()}:4\r\n${'0'.repeat(35)}:0\r\nnot-a-row\r\n`;
    const checker = new PasswordBreachChecker({ mode: 'enforce', endpoint, timeoutMs: 2_000 });

    await expect(checker.check(password)).resolves.toEqual({ status: 'breached', count: 4 });
    expect(checker.snapshot().breached).toBe(1);
  });

  it('reads a range with no matching suffix as clean, not as unknown', async () => {
    requested = [];
    reply = `${'F'.repeat(35)}:9\r\n${'A'.repeat(35)}:0\r\n`;
    const checker = new PasswordBreachChecker({ mode: 'enforce', endpoint, timeoutMs: 2_000 });

    await expect(checker.check(password)).resolves.toEqual({ status: 'clean', count: 0 });
    const snapshot = checker.snapshot();
    expect(snapshot.checked).toBe(1);
    expect(snapshot.breached).toBe(0);
    expect(snapshot.unavailable).toBe(0);
  });

  it('never calls the provider in off mode', async () => {
    let calls = 0;
    const checker = new PasswordBreachChecker({
      mode: 'off',
      endpoint,
      fetchImpl: (async () => {
        calls += 1;
        return new Response('', { status: 200 });
      }) as typeof fetch,
    });

    await expect(checker.check(password)).resolves.toEqual({ status: 'unknown', reason: 'disabled' });
    expect(calls).toBe(0);
    expect(checker.snapshot().enabled).toBe(false);
  });

  it('returns unknown — not clean — when the provider cannot be reached', async () => {
    const checker = new PasswordBreachChecker({
      mode: 'enforce',
      endpoint,
      fetchImpl: (async () => {
        throw new Error('ECONNREFUSED');
      }) as typeof fetch,
    });

    const verdict = await checker.check(password);
    expect(verdict).toEqual({ status: 'unknown', reason: 'unavailable' });
    const snapshot = checker.snapshot();
    expect(snapshot.checked).toBe(0);
    expect(snapshot.unavailable).toBe(1);
    expect(snapshot.lastError).toContain('ECONNREFUSED');
  });

  it('treats a non-2xx answer as unavailable and keeps the failure string short', async () => {
    const checker = new PasswordBreachChecker({
      mode: 'enforce',
      endpoint,
      fetchImpl: (async () => new Response('boom', { status: 503 })) as typeof fetch,
    });

    await expect(checker.check(password)).resolves.toEqual({ status: 'unknown', reason: 'unavailable' });
    const snapshot = checker.snapshot();
    expect(snapshot.lastError).toContain('503');
    expect((snapshot.lastError ?? '').length).toBeLessThanOrEqual(200);
  });

  it('opens the circuit after three failures, then retries when the window closes', async () => {
    let now = 1_000_000;
    let calls = 0;
    let fail = true;
    const checker = new PasswordBreachChecker({
      mode: 'enforce',
      endpoint,
      circuitMs: 30_000,
      now: () => now,
      fetchImpl: (async () => {
        calls += 1;
        if (fail) throw new Error('offline');
        return new Response(`${suffix}:1\r\n`, { status: 200 });
      }) as typeof fetch,
    });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(checker.check(password)).resolves.toMatchObject({ status: 'unknown' });
    }
    expect(calls).toBe(3);
    expect(checker.snapshot().circuitOpenUntil).toBe(now + 30_000);

    // والقاطع مفتوح: لا نداء جديد، والعودة `unknown` لا `clean`.
    await expect(checker.check(password)).resolves.toEqual({ status: 'unknown', reason: 'unavailable' });
    expect(calls).toBe(3);

    // بعد النافذة يُعاد النداء، وينجح، فيُصفَّر العدّاد ويُغلق القاطع.
    now += 30_001;
    fail = false;
    await expect(checker.check(password)).resolves.toEqual({ status: 'breached', count: 1 });
    expect(calls).toBe(4);
    const snapshot = checker.snapshot();
    expect(snapshot.circuitOpenUntil).toBeNull();
    expect(snapshot.consecutiveFailures).toBe(0);
  });

  it('serves the same prefix from cache within the TTL and refreshes after it', async () => {
    let now = 5_000_000;
    let calls = 0;
    const checker = new PasswordBreachChecker({
      mode: 'enforce',
      endpoint,
      cacheTtlMs: 60_000,
      now: () => now,
      fetchImpl: (async () => {
        calls += 1;
        return new Response(`${'B'.repeat(35)}:2\r\n`, { status: 200 });
      }) as typeof fetch,
    });

    await checker.check(password);
    await checker.check(password);
    expect(calls).toBe(1);
    expect(checker.snapshot().cacheEntries).toBe(1);

    now += 60_001;
    await checker.check(password);
    expect(calls).toBe(2);
  });

  it('gives up on a hung provider instead of holding the request open', async () => {
    const hangingFetch = ((_url: string, init?: { signal?: AbortSignal }) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as typeof fetch;

    const checker = new PasswordBreachChecker({
      mode: 'enforce',
      endpoint,
      timeoutMs: 20,
      fetchImpl: hangingFetch,
    });

    await expect(checker.check(password)).resolves.toEqual({ status: 'unknown', reason: 'unavailable' });
    expect(checker.snapshot().unavailable).toBe(1);
  });

  it('keeps a snapshot that carries counters, never password material', async () => {
    requested = [];
    reply = `${suffix}:1\r\n`;
    const checker = new PasswordBreachChecker({ mode: 'enforce', endpoint, timeoutMs: 2_000 });
    await checker.check(password);

    const serialised = JSON.stringify(checker.snapshot());
    expect(serialised).not.toContain(password);
    expect(serialised).not.toContain(digest);
    expect(serialised).not.toContain(prefix);
    expect(checker.snapshot().mode).toBe('enforce');
  });
});
