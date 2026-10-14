import { describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { DomainError, errorCodes } from '@erp/contracts';

import {
  requestContextStorage,
  type TenantContextValue,
} from '../../../request-context/request-context.js';
import type { AuditService } from '../../platform-services/audit/audit.service.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';
import {
  SECTOR_APP_KEY,
  type SectorAppRequirement,
} from '../decorators/requires-sector-app.decorator.js';

import { SectorLicenceGuard } from './sector-licence.guard.js';

/** «أيٌّ من» — نفس ما يعلنه `VanSalesController`: باقة التوزيع أو باقة المخابز. */
const VAN_SURFACE: SectorAppRequirement = { apps: ['van_sales', 'bakery_distribution'], mode: 'observe' };

function contextWith(
  metadata: Record<string, unknown>,
  request: { method: string; originalUrl: string } = { method: 'GET', originalUrl: '/api/v1/van-sales/dashboard' },
): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
    ...metadata,
  } as unknown as ExecutionContext;
}

function reflectorFor(metadata: Record<string, unknown>): Reflector {
  return {
    getAllAndOverride: vi.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
}

function auditStub(implementation?: () => Promise<string | undefined>) {
  const record = vi.fn(implementation ?? (async () => 'audit-row-id'));
  return { record, service: { record } as unknown as AuditService };
}

function tenantContext(enabledApps: string[]): TenantContextValue {
  return {
    tenantId: 't1',
    tenantCode: 'demo',
    tenantStatus: 'active',
    membershipId: 'm1',
    userId: 'u1',
    permissions: ['van_sales.production.manage'],
    branchScope: null,
    isOwner: true,
    kind: 'staff',
    maxDiscountPct: null,
    maxDiscountAmount: null,
    scopes: [],
    enabledApps,
  };
}

async function withTenant<T>(enabledApps: string[] | null, run: () => Promise<T>): Promise<T> {
  const context = { traceId: 'trace', startTime: 0, ...(enabledApps ? { tenant: tenantContext(enabledApps) } : {}) };
  return requestContextStorage.run(context, run);
}

describe('SectorLicenceGuard', () => {
  it('allows a route that declares no sector app', async () => {
    const audit = auditStub();
    const guard = new SectorLicenceGuard(reflectorFor({}), audit.service);
    await withTenant([], async () => {
      await expect(guard.canActivate(contextWith({}))).resolves.toBe(true);
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('allows a public route without looking at licences', async () => {
    const audit = auditStub();
    const guard = new SectorLicenceGuard(
      reflectorFor({ [IS_PUBLIC_KEY]: true, [SECTOR_APP_KEY]: VAN_SURFACE }),
      audit.service,
    );
    await withTenant([], async () => {
      await expect(guard.canActivate(contextWith({}))).resolves.toBe(true);
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('allows a tenant licensed under any one of the declared apps', async () => {
    for (const enabledApps of [['van_sales'], ['bakery_distribution'], ['van_sales', 'employee_app']]) {
      const audit = auditStub();
      const guard = new SectorLicenceGuard(reflectorFor({ [SECTOR_APP_KEY]: VAN_SURFACE }), audit.service);
      await withTenant(enabledApps, async () => {
        await expect(guard.canActivate(contextWith({}))).resolves.toBe(true);
      });
      expect(audit.record, enabledApps.join(',')).not.toHaveBeenCalled();
    }
  });

  it('observe: lets a read through and writes no audit row (a poll every 30s is not information)', async () => {
    const audit = auditStub();
    const guard = new SectorLicenceGuard(reflectorFor({ [SECTOR_APP_KEY]: VAN_SURFACE }), audit.service);
    await withTenant([], async () => {
      await expect(guard.canActivate(contextWith({}, { method: 'GET', originalUrl: '/api/v1/van-sales/dashboard' })))
        .resolves.toBe(true);
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('observe: lets a write through and measures it in audit_log', async () => {
    const audit = auditStub();
    const guard = new SectorLicenceGuard(reflectorFor({ [SECTOR_APP_KEY]: VAN_SURFACE }), audit.service);
    await withTenant([], async () => {
      await expect(
        guard.canActivate(
          contextWith({}, { method: 'POST', originalUrl: '/api/v1/van-sales/production-batches?draft=1' }),
        ),
      ).resolves.toBe(true);
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    const entry = audit.record.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry.tenantId).toBe('t1');
    expect(entry.actorUserId).toBe('u1');
    expect(entry.membershipId).toBe('m1');
    expect(entry.action).toBe('sector_licence.unlicensed_use');
    expect(entry.entity).toBe('tenant_apps');
    expect(entry.entityId).toBe('van_sales|bakery_distribution');
    const meta = entry.meta as Record<string, unknown>;
    expect(meta.method).toBe('POST');
    // سلسلة الاستعلام لا تدخل التدقيق: المطلوب السطح لا ما كُتب في النموذج.
    expect(meta.path).toBe('/api/v1/van-sales/production-batches');
    expect(meta.mode).toBe('observe');
  });

  it('observe: an audit failure is announced, never turned into a broken request', async () => {
    const audit = auditStub(async () => {
      throw new Error('audit_log unavailable');
    });
    const guard = new SectorLicenceGuard(reflectorFor({ [SECTOR_APP_KEY]: VAN_SURFACE }), audit.service);
    await withTenant([], async () => {
      await expect(
        guard.canActivate(contextWith({}, { method: 'POST', originalUrl: '/api/v1/van-sales/collections' })),
      ).resolves.toBe(true);
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('enforce: refuses 403 ADDON_NOT_LICENSED and writes no audit row', async () => {
    const audit = auditStub();
    const requirement: SectorAppRequirement = { apps: ['bakery_distribution'], mode: 'enforce' };
    const guard = new SectorLicenceGuard(reflectorFor({ [SECTOR_APP_KEY]: requirement }), audit.service);
    let error: unknown;
    await withTenant(['van_sales'], async () => {
      error = await guard.canActivate(contextWith({})).catch((caught: unknown) => caught);
    });
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(errorCodes.ADDON_NOT_LICENSED);
    expect((error as DomainError).status).toBe(403);
    expect((error as DomainError).message).toContain('باقةٍ قطاعية');
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('defaults to enforce: an omitted mode fails closed, not open', async () => {
    const guard = new SectorLicenceGuard(
      reflectorFor({ [SECTOR_APP_KEY]: { apps: ['bakery_distribution'] } satisfies SectorAppRequirement }),
      auditStub().service,
    );
    let error: unknown;
    await withTenant([], async () => {
      error = await guard.canActivate(contextWith({})).catch((caught: unknown) => caught);
    });
    expect((error as DomainError).code).toBe(errorCodes.ADDON_NOT_LICENSED);
  });

  it('is not a sector surface without a tenant context (platform plane, background work)', async () => {
    const audit = auditStub();
    const guard = new SectorLicenceGuard(
      reflectorFor({ [SECTOR_APP_KEY]: { apps: ['bakery_distribution'], mode: 'enforce' } }),
      audit.service,
    );
    await withTenant(null, async () => {
      await expect(guard.canActivate(contextWith({}))).resolves.toBe(true);
    });
    expect(audit.record).not.toHaveBeenCalled();
  });
});
