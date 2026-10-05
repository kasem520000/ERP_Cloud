import { describe, expect, it } from 'vitest';
import { DomainError } from '@erp/contracts';

import type { RoleScopeValue } from '../../../request-context/request-context.js';

import { assertScope, scopeAuthorises } from './scope-policy.js';

const W1 = '11111111-1111-4111-8111-111111111111';
const W2 = '22222222-2222-4222-8222-222222222222';

function scope(roleId: string, scopeType: RoleScopeValue['scopeType'], scopeId: string): RoleScopeValue {
  return { roleId, scopeType, scopeId };
}

describe('scope policy', () => {
  it('treats a grant without scope rows as tenant-wide', () => {
    expect(scopeAuthorises([], ['r1'], 'warehouse', W1)).toBe(true);
    expect(scopeAuthorises([scope('r1', 'branch', W1)], ['r1'], 'warehouse', W1)).toBe(true);
  });

  it('restricts a scoped grant to its listed scopes', () => {
    const scopes = [scope('r1', 'warehouse', W1)];
    expect(scopeAuthorises(scopes, ['r1'], 'warehouse', W1)).toBe(true);
    expect(scopeAuthorises(scopes, ['r1'], 'warehouse', W2)).toBe(false);
  });

  it('authorises when ANY held role covers the scope (UNION semantics)', () => {
    const scopes = [scope('r1', 'warehouse', W1)];
    expect(scopeAuthorises(scopes, ['r1', 'r2'], 'warehouse', W2)).toBe(true);
    expect(scopeAuthorises(scopes, ['r1'], 'warehouse', W2)).toBe(false);
  });

  it('throws FORBIDDEN naming the uncovered scope', () => {
    try {
      assertScope([scope('r1', 'cash_location', W1)], ['r1'], 'cash_location', W2);
      throw new Error('expected FORBIDDEN');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('FORBIDDEN');
      expect((error as DomainError).message).toBe(`role grant does not cover cash_location ${W2}`);
    }
  });
});
