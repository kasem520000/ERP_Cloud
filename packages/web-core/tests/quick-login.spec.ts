import { describe, expect, it } from 'vitest';

import {
  clearQuickLogin,
  loadQuickLoginSecret,
  maskEmail,
  maskTenantCode,
  saveQuickLogin,
} from '../src/quick-login';

describe('quick-login encrypted vault', () => {
  it('masks email and tenant code without revealing full identity', () => {
    expect(maskEmail('owner@verify2026.test')).toBe('ow•••r@verify2026.test');
    expect(maskEmail('ab@co.sa')).toBe('a•••@co.sa');
    expect(maskTenantCode('verify2026')).toBe('ve•••26');
    expect(maskTenantCode('abc')).toBe('a•••');
  });

  it('encrypts credentials with WebCrypto AES-GCM and decrypts on demand without leaking plaintext', async () => {
    const meta = await saveQuickLogin('staff', {
      tenantCode: 'verify2026',
      email: 'owner@verify2026.test',
      password: 'Mstr-Qz7-2026$SecretPassword!',
    });
    expect(meta).not.toBeNull();
    expect(meta?.maskedEmail).toBe('ow•••r@verify2026.test');
    expect(meta?.maskedTenant).toBe('ve•••26');
    expect(JSON.stringify(meta)).not.toContain('SecretPassword');

    const loaded = await loadQuickLoginSecret('staff');
    expect(loaded).toEqual({
      tenantCode: 'verify2026',
      email: 'owner@verify2026.test',
      password: 'Mstr-Qz7-2026$SecretPassword!',
    });

    await clearQuickLogin('staff');
    const afterClear = await loadQuickLoginSecret('staff');
    expect(afterClear).toBeNull();
  });
});
