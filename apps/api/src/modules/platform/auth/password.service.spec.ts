import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import { DomainError } from '@erp/contracts';

import { PasswordBreachChecker } from './password-breach.js';
import { PasswordService } from './password.service.js';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with the frozen Argon2id parameters (PROJECT_CONTRACT §9: m=64 MiB, t=3, p=4)', async () => {
    const hash = await service.hash('Tr0ubador&Horse9');

    // PHC string format: $argon2id$v=19$m=<KiB>,t=<iterations>,p=<lanes>$<salt>$<digest>
    expect(hash.startsWith('$argon2id$')).toBe(true);
    const params = hash.split('$')[3] ?? '';
    expect(params).toContain('m=65536');
    expect(params).toContain('t=3');
    expect(params).toContain('p=4');
  }, 60_000);

  it('verifies a correct password and rejects a wrong one', async () => {
    const hash = await service.hash('Tr0ubador&Horse9');

    await expect(service.verify(hash, 'Tr0ubador&Horse9')).resolves.toBe(true);
    await expect(service.verify(hash, 'Tr0ubador&Horse8')).resolves.toBe(false);
  }, 60_000);

  it('produces a different hash per call (random salt) and never stores the plaintext', async () => {
    const first = await service.hash('Tr0ubador&Horse9');
    const second = await service.hash('Tr0ubador&Horse9');

    expect(first).not.toBe(second);
    expect(first).not.toContain('Tr0ubador');
  }, 60_000);

  it('treats a missing hash (invited user) as a failed verification', async () => {
    await expect(service.verify(null, 'anything')).resolves.toBe(false);
    await expect(service.verify('not-a-phc-string', 'anything')).resolves.toBe(false);
  });

  it('enforces the policy before hashing', async () => {
    await expect(service.assertPolicy('short')).rejects.toThrow(/password policy/i);
    await expect(service.assertPolicy('Tr0ubador&Horse9')).resolves.toBeUndefined();
  });

  /**
   * الفحص الخارجي لا يُنادَى عن كلمةٍ ساقطةٍ محلّياً: الترتيب يوفّر نداءً لكل محاولةٍ
   * سخيفة، وهو فرقٌ يُقاس بعدّاد `fetch` لا بالوصف.
   */
  it('skips the breach lookup when the local rules already refuse the password', async () => {
    let calls = 0;
    const checker = new PasswordBreachChecker({
      mode: 'enforce',
      endpoint: 'https://range.test/',
      fetchImpl: (async () => {
        calls += 1;
        return new Response('', { status: 200 });
      }) as typeof fetch,
    });
    const guarded = new PasswordService(checker);

    await expect(guarded.assertPolicy('short')).rejects.toThrow(/password policy/i);
    expect(calls).toBe(0);
  });

  it('refuses a password found in the breach range when the mode is enforce', async () => {
    const candidate = 'Tr0ubador&Horse9';
    const suffix = createHash('sha1').update(candidate, 'utf8').digest('hex').toUpperCase().slice(5);
    const checker = new PasswordBreachChecker({
      mode: 'enforce',
      endpoint: 'https://range.test/',
      fetchImpl: (async () => new Response(`${suffix}:42\r\n${'A'.repeat(35)}:0\r\n`, { status: 200 })) as typeof fetch,
    });

    // الرسالة العامة واحدة، والسبب الحقيقي في `details` — وهو ما يعرضه العميل تحت الحقل.
    const failure = await new PasswordService(checker).assertPolicy(candidate).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(DomainError);
    const details = (failure as DomainError).details as Array<{ field: string; message: string }>;
    expect(details[0]?.field).toBe('new');
    expect(details[0]?.message).toMatch(/data breaches \(42 times\)/);
  });

  it('lets the same password through in warn mode but keeps counting it', async () => {
    const candidate = 'Tr0ubador&Horse9';
    const suffix = createHash('sha1').update(candidate, 'utf8').digest('hex').toUpperCase().slice(5);
    const checker = new PasswordBreachChecker({
      mode: 'warn',
      endpoint: 'https://range.test/',
      fetchImpl: (async () => new Response(`${suffix}:7\n`, { status: 200 })) as typeof fetch,
    });

    await expect(new PasswordService(checker).assertPolicy(candidate)).resolves.toBeUndefined();
    expect(checker.snapshot().breached).toBe(1);
  });
});
