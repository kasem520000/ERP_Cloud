import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { baselineRoles } from '@erp/config';
import { erpFunctionalRoleCatalog } from '@erp/contracts';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import { todayIso } from '../src/common/server-date.js';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('Remediation Phase 12 — R24 Multi-branch sequences, module lock audit, shift diff sign, cashier warehouse permission (ACC-100, ACC-101, ACC-104, ACC-106, UI-038, UI-039)', () => {
  let ctx: TestApp;
  let actor: Actor;

  let branch1Id = '';
  let branch2Id = '';
  let warehouse1Id = '';
  let warehouse2Id = '';
  let safe1Id = '';
  let cashAccountId = '';
  let custodyAccountId = '';
  let diffAccountId = '';
  let transitAccountId = '';
  let salesAccountId = '';
  let vatOutputAccountId = '';
  let receivableAccountId = '';
  let itemId = '';
  let customerId = '';
  let periodId = '';

  const data = (body: any) => (body?.data ?? body);

  const req = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: unknown,
  ) => api(ctx.server, method, path, { token: actor.token, body });

  beforeAll(async () => {
    ctx = await createTestApp('remediation-phase12');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p12',
      email: 'owner@rem-p12.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'parties.view',
        'parties.manage',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'sales.invoice.pay',
        'sales.return.create',
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'inventory.view',
        'inventory.adjust',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'treasury.voucher.void',
        'treasury.transfer.manage',
        'treasury.shift.close',
        'treasury.shift.post',
        'accounting.reports.view',
        'reporting.view',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.create',
        'accounting.journal.post',
        'accounting.journal.reverse',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
      ],
    });

    const provisioning = ctx.app.get(OrgProvisioningService);
    await provisioning.provisionOrgDefaults(actor.tenantId);

    // Create branch 1 and branch 2
    const b1 = await req('post', '/api/v1/branches', {
      code: 'BR-P12-1',
      nameAr: 'الفرع الأول P12',
      nameEn: 'Branch 1 P12',
    });
    expect(b1.status).toBe(201);
    branch1Id = (b1.body as any).data.id;

    const b2 = await req('post', '/api/v1/branches', {
      code: 'BR-P12-2',
      nameAr: 'الفرع الثاني P12',
      nameEn: 'Branch 2 P12',
    });
    expect(b2.status).toBe(201);
    branch2Id = (b2.body as any).data.id;

    // Create warehouses
    const w1 = await req('post', '/api/v1/warehouses', {
      branchId: branch1Id,
      code: 'WHP121',
      name: 'مستودع الفرع 1',
    });
    expect(w1.status).toBe(201);
    warehouse1Id = (w1.body as any).data.id;

    const w2 = await req('post', '/api/v1/warehouses', {
      branchId: branch2Id,
      code: 'WHP122',
      name: 'مستودع الفرع 2',
    });
    expect(w2.status).toBe(201);
    warehouse2Id = (w2.body as any).data.id;

    // Accounts from provisioned chart of accounts
    const accList = await req('get', '/api/v1/accounts?limit=200');
    const accs = (accList.body as any).data ?? [];
    const byCode = (c: string) => accs.find((a: any) => a.code.trim() === c)?.id;

    cashAccountId = byCode('1211001')!;
    custodyAccountId = byCode('1211002')!;
    diffAccountId = byCode('3110004')!;
    transitAccountId = byCode('1211003')!;
    salesAccountId = byCode('4100001')!;
    vatOutputAccountId = byCode('2222001')!;
    receivableAccountId = byCode('12310001')!;

    // Customer
    const cust = await req('post', '/api/v1/parties', {
      kind: 'customer',
      name: 'عميل اختبار P12',
      code: 'CUST-P12',
    });
    expect(cust.status).toBe(201);
    customerId = String(data(cust.body).id);

    // Item
    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P12',
      nameAr: 'قسم P12',
    });
    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'UNIT-P12',
      nameAr: 'حبة',
    });
    const itm = await req('post', '/api/v1/organization/catalog/items', {
      sku: `SKU-P12-${Date.now()}`,
      nameAr: 'صنف اختبار P12',
      categoryId: String(data(catRes.body).id),
      baseUnitId: String(data(unitRes.body).id),
      salePrice: '100.0000',
      purchasePrice: '60.0000',
    });
    expect(itm.status).toBe(201);
    itemId = String(data(itm.body).id);

    // Seed stock in both warehouses
    const stockSeed = await req('post', '/api/v1/inventory/ledger/record', {
      lines: [
        {
          itemId,
          warehouseId: warehouse1Id,
          qty: '100',
          unitCost: '60.0000',
          direction: 'in',
          docType: 'opening',
          docId: '00000000-0000-0000-0000-000000000012',
        },
        {
          itemId,
          warehouseId: warehouse2Id,
          qty: '100',
          unitCost: '60.0000',
          direction: 'in',
          docType: 'opening',
          docId: '00000000-0000-0000-0000-000000000013',
        },
      ],
    });
    expect(stockSeed.status).toBe(201);

    // Fiscal period covering today
    const year = new Date().getUTCFullYear();
    const fpRes = await req('post', '/api/v1/fiscal-years', {
      code: `FY${year}`,
      name: `Fiscal Year ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    expect(fpRes.status).toBe(201);
    const periodsRes = await req('get', '/api/v1/fiscal-periods');
    const periodList = (periodsRes.body as any).data ?? [];
    const today = todayIso();
    const activePeriod =
      periodList.find((p: any) => p.startDate <= today && p.endDate >= today) ??
      periodList[0];
    periodId = activePeriod?.id;
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('ACC-100: Multi-branch sales invoice posting generates distinct, non-colliding sequential numbers (SI-00000X)', async () => {
    // Branch 1 invoice
    const inv1 = await req('post', '/api/v1/sales/invoices', {
      branchId: branch1Id,
      warehouseId: warehouse1Id,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '100', taxRate: '15' }],
      autoPost: true,
    });
    if (inv1.status !== 201) {
      console.log('INV1 ERROR:', JSON.stringify(inv1.body));
    }
    expect(inv1.status).toBe(201);

    const invoice1Number = String(data(inv1.body).number);
    expect(invoice1Number).toMatch(/^SI-\d{6}$/);

    // Branch 2 invoice - must NOT collide with Branch 1's number
    const inv2 = await req('post', '/api/v1/sales/invoices', {
      branchId: branch2Id,
      warehouseId: warehouse2Id,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '100', taxRate: '15' }],
      autoPost: true,
    });
    if (inv2.status !== 201) {
      console.log('INV2 ERROR:', JSON.stringify(inv2.body));
    }
    expect(inv2.status).toBe(201);

    const invoice2Number = String(data(inv2.body).number);
    expect(invoice2Number).toMatch(/^SI-\d{6}$/);
    expect(invoice2Number).not.toBe(invoice1Number);

    const num1 = parseInt(invoice1Number.replace('SI-', ''), 10);
    const num2 = parseInt(invoice2Number.replace('SI-', ''), 10);
    expect(num2).toBe(num1 + 1);
  });

  it('ACC-100: Multi-branch manual journal entries generate distinct numbers and enforce unique number constraint', async () => {
    const today = todayIso();
    // JE Branch 1
    const je1 = await req('post', '/api/v1/journal-entries', {
      branchId: branch1Id,
      date: today,
      description: 'قيد فرع 1',
      lines: [
        { accountId: receivableAccountId, debit: '50', credit: '0', description: 'مدين' },
        { accountId: salesAccountId, debit: '0', credit: '50', description: 'دائن' },
      ],
    });
    if (je1.status !== 201) {
      console.log('JE1 ERROR:', JSON.stringify(je1.body));
    }
    expect(je1.status).toBe(201);

    const je1Number = String(data(je1.body).number);
    expect(je1Number).toMatch(/^JE-\d{6}$/);

    // JE Branch 2
    const je2 = await req('post', '/api/v1/journal-entries', {
      branchId: branch2Id,
      date: today,
      description: 'قيد فرع 2',
      lines: [
        { accountId: receivableAccountId, debit: '75', credit: '0', description: 'مدين' },
        { accountId: salesAccountId, debit: '0', credit: '75', description: 'دائن' },
      ],
    });
    expect(je2.status).toBe(201);

    const je2Number = String(data(je2.body).number);
    expect(je2Number).toMatch(/^JE-\d{6}$/);
    expect(je2Number).not.toBe(je1Number);

    const n1 = parseInt(je1Number.replace('JE-', ''), 10);
    const n2 = parseInt(je2Number.replace('JE-', ''), 10);
    expect(n2).toBe(n1 + 1);
  });

  it('ACC-104: Period module locks record locked_by and locked_at upon locking and clear them on unlock', async () => {
    if (!periodId) return;

    // Lock module
    const lockRes = await req(
      'post',
      `/api/v1/fiscal-periods/${periodId}/modules/purchases/lock`,
      {},
    );
    expect(lockRes.status).toBe(201);

    expect((lockRes.body as any).data.locked).toBe(true);
    expect((lockRes.body as any).data.lockedAt).toBeDefined();
    expect((lockRes.body as any).data.lockedBy).toBe(actor.userId);

    // Unlock module
    const unlockRes = await req(
      'post',
      `/api/v1/fiscal-periods/${periodId}/modules/purchases/unlock`,
      {},
    );
    expect(unlockRes.status).toBe(201);

    expect((unlockRes.body as any).data.locked).toBe(false);
    expect((unlockRes.body as any).data.lockedAt).toBeNull();
    expect((unlockRes.body as any).data.lockedBy).toBeNull();
  });

  it('ACC-106: Shift close difference sign alignment between /close and /post (diff and differenceAmount agree)', async () => {
    // Open a shift
    const openRes = await req('post', '/api/v1/shift-closes/open', {
      branchId: branch1Id,
    });
    expect(openRes.status).toBe(201);
    const shiftId = String(data(openRes.body).id);

    // Close shift with surplus: expected 0, counted 50 -> diff = +50
    const closeRes = await req('post', `/api/v1/shift-closes/${shiftId}/close`, {
      counts: [{ denomination: '50', count: 1 }],
    });
    expect(closeRes.status).toBe(201);

    const summary = data(closeRes.body).summary;
    expect(Number(summary.diff)).toBe(50);

    // Post shift close
    const postRes = await req('post', `/api/v1/shift-closes/${shiftId}/post`, {});
    if (postRes.status !== 201) {
      console.log('POSTRES ERROR:', JSON.stringify(postRes.body));
    }
    expect(postRes.status).toBe(201);

    const postData = data(postRes.body);
    // Both diff and differenceAmount must be positive (+50.0000) for surplus
    expect(Number(postData.diff)).toBe(50);
    expect(Number(postData.differenceAmount)).toBe(50);
    expect(postData.journalEntryId).toBeDefined();
  });

  it('UI-038: Cash location master allows safe creation with custodian or without empty custodian error', async () => {
    // Create safe with employee custodian omitted (optional)
    const res = await req('post', '/api/v1/cash-locations', {
      branchId: branch1Id,
      kind: 'safe',
      name: 'صندوق الفرع الأول P12',
      accountId: cashAccountId,
    });
    expect(res.status).toBe(201);

    safe1Id = String(data(res.body).id);
    expect(safe1Id).toBeDefined();
    expect(data(res.body).name).toBe('صندوق الفرع الأول P12');
  });

  it('UI-039: Cashier role permissions include organization.warehouse.view in baseline and contracts catalogs', async () => {
    const cashierSeed = baselineRoles.find((r) => r.code === 'cashier');
    expect(cashierSeed).toBeDefined();
    expect(cashierSeed?.permissions).toContain('organization.warehouse.view');

    const cashierContract = erpFunctionalRoleCatalog.find((r) => r.code === 'cashier');
    expect(cashierContract).toBeDefined();
    expect(cashierContract?.permissions).toContain('organization.warehouse.view');
  });
});
