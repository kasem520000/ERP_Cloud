import { describe, expect, it } from 'vitest';
import { apiKeyScopes, webhookEvents } from '@erp/contracts';

import { EVENT_LABELS, SCOPE_LABELS, eventLabel, scopeLabel } from '../lib/developer-language';

describe('developer catalogue Arabic presentation', () => {
  it('names every currently supported key scope and webhook event', () => {
    expect(Object.keys(SCOPE_LABELS).sort()).toEqual([...apiKeyScopes].sort());
    expect(Object.keys(EVENT_LABELS).sort()).toEqual([...webhookEvents].sort());
    for (const code of apiKeyScopes) expect(scopeLabel(code)).toMatch(/[\u0600-\u06ff]/);
    for (const code of webhookEvents) expect(eventLabel(code)).toMatch(/[\u0600-\u06ff]/);
  });

  it('keeps future catalogue codes out of the primary label', () => {
    expect(scopeLabel('future:read')).toBe('نطاق إضافي');
    expect(eventLabel('future.created')).toBe('حدث إضافي');
  });
});
