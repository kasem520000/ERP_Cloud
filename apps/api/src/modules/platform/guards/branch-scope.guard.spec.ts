import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '@erp/contracts';

import {
  getRequestContext,
  requestContextStorage,
  type TenantContextValue,
} from '../../../request-context/request-context.js';

import { BranchScopeGuard } from './branch-scope.guard.js';

const BRANCH_IN_SCOPE = '11111111-1111-7111-8111-111111111111';
const BRANCH_OUT_OF_SCOPE = '22222222-2222-7222-8222-222222222222';

function run(headers: Record<string, string>, branchScope: string[] | null): void {
  const reflector = { getAllAndOverride: vi.fn(() => undefined) } as unknown as Reflector;
  const guard = new BranchScopeGuard(reflector);
  const request = { headers } as Record<string, unknown>;
  const context = {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  const tenant: TenantContextValue = {
    tenantId: 't1',
    tenantCode: 'demo',
    tenantStatus: 'active',
    membershipId: 'm1',
    userId: 'u1',
    permissions: [],
    branchScope,
    isOwner: false,
    kind: 'staff',
    maxDiscountPct: null,
    maxDiscountAmount: null,
    scopes: [],
  };

  requestContextStorage.run({ traceId: 'trace', startTime: 0, tenant }, () => {
    expect(guard.canActivate(context)).toBe(true);
    expect(getRequestContext().branchId).toBe(request.branchId);
  });
}

describe('BranchScopeGuard', () => {
  it('passes through when no X-Branch-Id is supplied', () => {
    expect(() => run({}, [BRANCH_IN_SCOPE])).not.toThrow();
  });

  it('accepts a branch inside the membership scope', () => {
    expect(() => run({ 'x-branch-id': BRANCH_IN_SCOPE }, [BRANCH_IN_SCOPE])).not.toThrow();
  });

  it('accepts any branch when the scope is null (= all branches)', () => {
    expect(() => run({ 'x-branch-id': BRANCH_OUT_OF_SCOPE }, null)).not.toThrow();
  });

  it('rejects a branch outside the scope with FORBIDDEN', () => {
    expect(() => run({ 'x-branch-id': BRANCH_OUT_OF_SCOPE }, [BRANCH_IN_SCOPE])).toThrowError(DomainError);
    try {
      run({ 'x-branch-id': BRANCH_OUT_OF_SCOPE }, [BRANCH_IN_SCOPE]);
    } catch (error) {
      expect((error as DomainError).code).toBe('FORBIDDEN');
      expect((error as DomainError).status).toBe(403);
    }
  });

  it('rejects a malformed branch id with VALIDATION_FAILED', () => {
    try {
      run({ 'x-branch-id': 'not-a-uuid' }, null);
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('VALIDATION_FAILED');
    }
  });
});
