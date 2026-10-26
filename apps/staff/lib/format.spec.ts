import { describe, expect, it } from 'vitest';

import { dateText, moneyText, qtyText } from './format.js';
import { dateTime } from './lookups.js';

describe('admin formatting kit', () => {
  it('formats money from decimal strings', () => {
    expect(moneyText('12.345', 'SAR', 'en-US')).toContain('12.35');
  });
  it('formats quantities without floating point drift', () => {
    expect(qtyText('1.23456')).toBe('1.2346');
  });
  it('formats timestamps and dates in Makkah timezone (Asia/Riyadh, UTC+3)', () => {
    // 22:30 UTC on Oct 25 is 01:30 on Oct 26 in Makkah!
    expect(dateText('2026-10-25T22:30:00.000Z')).toBe('\u20662026-10-26\u2069');
    expect(dateTime('2026-10-25T22:30:00.000Z')).toBe('2026-10-26 01:30');
    expect(dateText('2026-10-26')).toBe('\u20662026-10-26\u2069');
  });
});
