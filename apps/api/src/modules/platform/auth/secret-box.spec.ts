import { describe, expect, it } from 'vitest';

import { openSecret, sealSecret } from './secret-box.js';

const KEY = 'unit-test-data-encryption-key';

describe('secret-box', () => {
  it('round-trips a secret', () => {
    const sealed = sealSecret('my totp secret', KEY);
    expect(openSecret(sealed, KEY).toString('utf8')).toBe('my totp secret');
  });

  it('produces a fresh IV per seal, so identical plaintexts differ', () => {
    expect(sealSecret('same', KEY)).not.toBe(sealSecret('same', KEY));
  });

  it('refuses a wrong key', () => {
    const sealed = sealSecret('payload', KEY);
    expect(() => openSecret(sealed, 'another-key')).toThrow();
  });

  it('refuses tampered ciphertext and malformed envelopes', () => {
    const sealed = sealSecret('payload', KEY);
    const [, iv, tag, data] = sealed.split(':');
    const flipped = Buffer.from(data, 'base64');
    flipped[0] ^= 0xff;
    expect(() => openSecret(`v1:${iv}:${tag}:${flipped.toString('base64')}`, KEY)).toThrow();
    expect(() => openSecret('not-an-envelope', KEY)).toThrow();
    expect(() => openSecret('v2:aa:bb:cc', KEY)).toThrow();
  });
});
