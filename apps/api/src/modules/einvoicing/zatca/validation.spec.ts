import { describe, expect, it } from 'vitest';

import { isValidSellerVat, normalizeVatNumber } from './validation.js';

describe('zatca validation — BR-KSA-44', () => {
  it('accepts a 15-digit number that starts and ends with 3', () => {
    expect(normalizeVatNumber('311111111111113')).toBe('311111111111113');
    expect(normalizeVatNumber(' 310000000000003 ')).toBe('310000000000003');
    expect(normalizeVatNumber('310-000-000-000-003')).toBe('310000000000003');
    expect(isValidSellerVat('310000000000003')).toBe(true);
  });

  it('rejects a wrong length, a wrong first digit or a wrong last digit', () => {
    expect(normalizeVatNumber('310000000000012')).toBeNull(); // ينتهي بـ2
    expect(normalizeVatNumber('210000000000003')).toBeNull(); // يبدأ بـ2
    expect(normalizeVatNumber('31000000000003')).toBeNull(); // 14 خانة
    expect(normalizeVatNumber('3100000000000003')).toBeNull(); // 16 خانة
    expect(normalizeVatNumber('31000000000O003')).toBeNull(); // حرف O
  });

  it('treats an empty number as "no VAT" — a simplified invoice, not an error', () => {
    expect(normalizeVatNumber('')).toBeNull();
    expect(normalizeVatNumber(undefined)).toBeNull();
    expect(normalizeVatNumber(null)).toBeNull();
    expect(isValidSellerVat(null)).toBe(false);
  });
});
