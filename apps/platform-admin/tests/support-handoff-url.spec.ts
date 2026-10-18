import { describe, expect, it } from 'vitest';

import { supportHandoffBase } from '../lib/support-handoff-url';

describe('support handoff browser destination', () => {
  it('maps a proxied console host to the staff preview host without a browser port', () => {
    expect(supportHandoffBase({ protocol: 'https:', hostname: '3003-sandbox.e2b.app' })).toBe('https://3001-sandbox.e2b.app');
    expect(supportHandoffBase({ protocol: 'https:', hostname: '3003-sandbox.e2b.dev' })).toBe('https://3001-sandbox.e2b.dev');
  });
  it('keeps a separately configured destination and a local-network port', () => {
    expect(supportHandoffBase({ protocol: 'https:', hostname: 'admin.example.test' }, 'https://staff.example.test/')).toBe('https://staff.example.test');
    expect(supportHandoffBase({ protocol: 'http:', hostname: '192.0.2.4' })).toBe('http://192.0.2.4:3001');
  });
});
