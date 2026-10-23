import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('Remediation Phase 17 — Cost centers 409 & balances, TB balanced flag, purchase partyId isolation, POS offline sequence/error, maintenance stale drafts, tailoring workflow (R28)', () => {
  let ctx: TestApp;
  let actor: Actor;

  const data = (b: any) => b?.data ?? b;

  const req = (
    method: 'get' | 'post' | 'patch' | 'put' | 'delete',
    path: string,
    body?: unknown,
  ) => api(ctx.server, method, path, { token: actor.token, body });

  let branchId = '';
  let warehouseId = '';
  let cashLocationId = '';
  let periodId = '';
  let customerId = '';
  let supplierId = '';
  let itemId = '';
  let costCenterId = '';

  beforeAll(async () => {
    ctx = await createTestApp('remediation-p17');
    actor = await createActor(ctx, {
      tenantCode: 'rem-p17',
      email: 'owner-p17@example.com',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'parties.view',
        'parties.manage',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.costcenter.manage',
        'accounting.journal.create',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'accounting.opening.manage',
        'accounting.reports.view',
        'reporting.view',
        'sales.offer.manage',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'inventory.view',
        'inventory.adjust',
        'pos.operate',
        'pos.view',
        'settings.maintenance.manage',
        'tenant.settings.manage',
        'tailoring.view',
        'tailoring.manage',
      ],
    });

    const provisioning = ctx.app.get(OrgProvisioningService);
    const defaults = await provisioning.provisionOrgDefaults(actor.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;
    cashLocationId = defaults.cashLocationId;

    const year = new Date().getUTCFullYear();
    await req('post', '/api/v1/fiscal-years', {
      code: `FY${year}`,
      name: `Fiscal Year ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    const periodsRes = await req('get', '/api/v1/fiscal-periods');
    const periodList = (periodsRes.body as any).data ?? [];
    const today = new Date().toISOString().slice(0, 10);
    const activePeriod =
      periodList.find((p: any) => p.startDate <= today && p.endDate >= today) ??
      periodList[0];
    periodId = activePeriod?.id;

    const custRes = await req('post', '/api/v1/parties', {
      code: 'CUST-P17',
      name: 'عميل المرحلة 17',
      kind: 'customer',
    });
    customerId = String(data(custRes.body).id);

    const suppRes = await req('post', '/api/v1/parties', {
      code: 'SUPP-P17',
      name: 'مورد المرحلة 17',
      kind: 'supplier',
    });
    supplierId = String(data(suppRes.body).id);

    const catRes = await req('post', '/api/v1/organization/catalog/categories', {
      code: 'CAT-P17',
      nameAr: 'قسم P17',
    });
    const catId = String(data(catRes.body).id);

    const unitRes = await req('post', '/api/v1/organization/catalog/units', {
      code: 'UNIT-P17',
      nameAr: 'حبة',
    });
    const unitId = String(data(unitRes.body).id);

    const itemRes = await req('post', '/api/v1/organization/catalog/items', {
      sku: 'ITEM-P17',
      nameAr: 'صنف المرحلة 17',
      salePrice: '50.0000',
      purchasePrice: '30.0000',
      categoryId: catId,
      baseUnitId: unitId,
    });
    itemId = String(data(itemRes.body).id);

    // Seed stock for POS sales via stock voucher
    const vRes = await req('post', '/api/v1/inventory/vouchers', {
      branchId,
      warehouseId,
      kind: 'stock_in',
      date: today,
      lines: [{ itemId, qty: '100', unitCost: '30.0000' }],
    });
    await req('post', `/api/v1/inventory/vouchers/${data(vRes.body).id}/post`);
  });

  afterAll(async () => {
    await ctx?.app?.close();
  });

  it('ACC-135: duplicate cost center code returns 409 COST_CENTER_CODE_TAKEN', async () => {
    const res1 = await req('post', '/api/v1/cost-centers', {
      code: 'CC-P17-DUP',
      nameAr: 'مركز تكرار P17',
      branchId,
    });
    expect(res1.status).toBe(201);
    costCenterId = String(data(res1.body).id);

    // Creating with same code should return 409 with COST_CENTER_CODE_TAKEN
    const res2 = await req('post', '/api/v1/cost-centers', {
      code: 'CC-P17-DUP',
      nameAr: 'مركز تكرار آخر',
      branchId,
    });
    expect(res2.status).toBe(409);
    expect((res2.body as any).code).toBe('COST_CENTER_CODE_TAKEN');

    // Updating another cost center to the taken code should return 409
    const res3 = await req('post', '/api/v1/cost-centers', {
      code: 'CC-P17-OTHER',
      nameAr: 'مركز آخر',
      branchId,
    });
    expect(res3.status).toBe(201);
    const otherId = String(data(res3.body).id);

    const res4 = await req('patch', `/api/v1/cost-centers/${otherId}`, {
      code: 'CC-P17-DUP',
    });
    expect(res4.status).toBe(409);
    expect((res4.body as any).code).toBe('COST_CENTER_CODE_TAKEN');
  });

  it('ACC-144: GET /cost-centers?with_balances=1 and ?withBalances=1 return balance fields', async () => {
    // Create dedicated accounts for posting
    const expAccRes = await req('post', '/api/v1/accounts', {
      code: '5100099',
      nameAr: 'مصروف P17 للمركز',
      type: 'expense',
      postable: true,
    });
    const expAccId = String(data(expAccRes.body).id);

    const cashAccRes = await req('post', '/api/v1/accounts', {
      code: '1110099',
      nameAr: 'صندوق P17 للمركز',
      type: 'asset',
      postable: true,
    });
    const cashAccId = String(data(cashAccRes.body).id);

    const today = new Date().toISOString().slice(0, 10);
    const jeRes = await req('post', '/api/v1/journal-entries', {
      branchId,
      fiscalPeriodId: periodId,
      date: today,
      description: 'P17 قيد مركز التكلفة',
      lines: [
        {
          accountId: expAccId,
          debit: '100.0000',
          credit: '0.0000',
          costCenterId,
          description: 'مصروف مركز',
        },
        {
          accountId: cashAccId,
          debit: '0.0000',
          credit: '100.0000',
          description: 'نقد',
        },
      ],
    });
    expect(jeRes.status).toBe(201);

    // Query with snake_case with_balances=1
    const resSnake = await req('get', '/api/v1/cost-centers?with_balances=1');
    expect(resSnake.status).toBe(200);
    const rowsSnake = data(resSnake.body);
    const ccSnake = rowsSnake.find((c: any) => c.id === costCenterId);
    expect(ccSnake).toBeDefined();
    expect(ccSnake.balance).toBeDefined();
    expect(Number(ccSnake.debit)).toBeGreaterThanOrEqual(100);
    expect(Number(ccSnake.balance.debit)).toBeGreaterThanOrEqual(100);

    // Query with camelCase withBalances=1
    const resCamel = await req('get', '/api/v1/cost-centers?withBalances=1');
    expect(resCamel.status).toBe(200);
    const rowsCamel = data(resCamel.body);
    const ccCamel = rowsCamel.find((c: any) => c.id === costCenterId);
    expect(ccCamel).toBeDefined();
    expect(ccCamel.balance).toBeDefined();
    expect(Number(ccCamel.debit)).toBeGreaterThanOrEqual(100);
  });

  it('ACC-139: trial balance flags balanced: false when one-sided opening balance mismatches', async () => {
    // Create an asset account with 1500 opening balance without contra entry
    const accRes = await req('post', '/api/v1/accounts', {
      code: '1160099',
      nameAr: 'P17 حساب أثاث مع رصيد افتتاحي',
      type: 'asset',
      openingBalance: '1500',
      postable: true,
    });
    expect(accRes.status).toBe(201);

    // Request trial balance
    const tbRes = await req('get', '/api/v1/statements/trial-balance');
    expect(tbRes.status).toBe(200);
    const totals = (tbRes.body as any).totals;
    expect(totals).toBeDefined();
    expect(Number(totals.balance)).toBeGreaterThanOrEqual(1500);
    // ACC-139: balanced flag must be false when totals balance is non-zero
    expect(totals.balanced).toBe(false);
  });

  it('ACC-142: purchase auto-journal stamps partyId ONLY on payable account, not VAT or inventory', async () => {
    // Create and post a purchase invoice
    const piRes = await req('post', '/api/v1/purchase-invoices', {
      branchId,
      warehouseId,
      partyId: supplierId,
      kind: 'purchase',
      supplierReferenceNo: 'REF-P17-01',
      supplierReferenceDate: new Date().toISOString().slice(0, 10),
      lines: [
        {
          itemId,
          quantity: '2',
          unitPrice: '30.0000',
          taxRate: '15',
        },
      ],
    });
    expect(piRes.status).toBe(201);
    const piId = String(data(piRes.body).id);

    const postRes = await req('post', `/api/v1/purchase-invoices/${piId}/post`, {
      settlement: 'credit',
    });
    expect(postRes.status).toBe(201);

    // Verify journal entries for this purchase invoice
    const jeRes = await req('get', `/api/v1/journal-entries?limit=5`);
    expect(jeRes.status).toBe(200);
    const entries = data(jeRes.body) ?? [];
    const piEntry = entries.find((e: any) => e.sourceType === 'purchase_invoice' && e.sourceId === piId);
    expect(piEntry).toBeDefined();

    const detailRes = await req('get', `/api/v1/journal-entries/${piEntry.id}`);
    expect(detailRes.status).toBe(200);
    const lines = data(detailRes.body).lines ?? [];
    expect(lines.length).toBeGreaterThanOrEqual(3); // Inventory (debit), VAT (debit), AP (credit)

    for (const l of lines) {
      if (Number(l.credit) > 0) {
        // Payable leg: carries supplier partyId
        expect(l.partyId).toBe(supplierId);
      } else {
        // Inventory and VAT input legs: ACC-142 requires partyId to be null/undefined
        expect(l.partyId).toBeFalsy();
      }
    }
  });

  it('ACC-145 & ACC-146: POS offline sequence mismatch returns conflict; retry success clears error_code', async () => {
    const posPayload = (qty: number, method = 'cash', tendered = '60') => ({
      branchId,
      warehouseId,
      priceIncludesVat: false,
      orderType: 'pos',
      cashCustomerName: 'R28-OFFLINE',
      lines: [{ itemId, quantity: String(qty), unitPrice: '50.0000', taxRate: '15' }],
      payment: { method, cashLocationId, tendered },
      tendered,
    });

    // 1. Initial offline sync
    const syncRes1 = await req('post', '/api/v1/pos/offline-sync', {
      deviceId: 'DEV-P17-01',
      invoices: [
        {
          offlineId: 'OFF-P17-SEQ1',
          sequenceNo: 1,
          createdAt: new Date().toISOString(),
          payload: posPayload(1),
        },
      ],
    });
    expect(syncRes1.status).toBe(201);
    const r1 = data(syncRes1.body).results[0];
    expect(r1.status).toBe('synced');
    expect(r1.offlineId).toBe('OFF-P17-SEQ1');

    // 2. ACC-145: Re-submitting the same offlineId with a different sequenceNo returns sequence mismatch conflict
    const syncRes2 = await req('post', '/api/v1/pos/offline-sync', {
      deviceId: 'DEV-P17-01',
      invoices: [
        {
          offlineId: 'OFF-P17-SEQ1',
          sequenceNo: 10,
          createdAt: new Date().toISOString(),
          payload: posPayload(1),
        },
      ],
    });
    expect(syncRes2.status).toBe(201);
    const r2 = data(syncRes2.body).results[0];
    expect(r2.status).toBe('conflict');
    expect(r2.errorCode).toBe('POS_OFFLINE_ID_SEQUENCE_MISMATCH');

    // 3. ACC-146: Replaying an offline ticket on conflict and verifying successful sync clears errorCode
    const syncRes3 = await req('post', '/api/v1/pos/offline-sync', {
      deviceId: 'DEV-P17-01',
      invoices: [
        {
          offlineId: 'OFF-P17-SEQ2',
          sequenceNo: 2,
          createdAt: new Date().toISOString(),
          payload: posPayload(1, 'card'), // invalid card payment triggers conflict
        },
      ],
    });
    expect(syncRes3.status).toBe(201);
    const r3 = data(syncRes3.body).results[0];
    expect(r3.status).toBe('conflict');

    // Retry with valid cash payment
    const syncRes4 = await req('post', '/api/v1/pos/offline-sync', {
      deviceId: 'DEV-P17-01',
      invoices: [
        {
          offlineId: 'OFF-P17-SEQ2',
          sequenceNo: 2,
          createdAt: new Date().toISOString(),
          payload: posPayload(1, 'cash'),
        },
      ],
    });
    expect(syncRes4.status).toBe(201);
    const r4 = data(syncRes4.body).results[0];
    expect(r4.status).toBe('synced');
    expect(r4.errorCode).toBeFalsy();
  });

  it('ACC-148: invoice maintenance stale drafts preview populates number, status, kind', async () => {
    // Create a draft invoice
    const draftRes = await req('post', '/api/v1/sales/invoices', {
      branchId,
      warehouseId,
      partyId: customerId,
      lines: [{ itemId, quantity: '1', unitPrice: '50.0000', taxRate: '15' }],
    });
    expect(draftRes.status).toBe(201);

    // Call invoice maintenance with staleDraftDays: 0
    const maintRes = await req('post', '/api/v1/settings/invoice-maintenance', {
      mode: 'preview',
      staleDraftDays: 0,
    });
    expect(maintRes.status).toBe(201);
    const findings = (maintRes.body as any).findings ?? (maintRes.body as any).data?.findings;
    expect(findings.staleDrafts).toBeDefined();
    expect(findings.staleDrafts.length).toBeGreaterThanOrEqual(1);

    for (const d of findings.staleDrafts) {
      expect(d.number).toBeTruthy();
      expect(typeof d.number).toBe('string');
      expect(d.status).toBe('draft');
      expect(d.kind).toBe('sale');
    }
  });

  it('UI-047, UI-048 & ACC-150: Tailoring status auto-seeding, payment cashLocation validation and voucher posting', async () => {
    // UI-047: Creating a tailoring invoice without pre-existing statuses auto-seeds them and returns 201
    const tiRes = await req('post', '/api/v1/tailoring/invoices', {
      customerName: 'عميل تفصيل P17',
      partyId: customerId,
      quantity: 1,
      unitPrice: 200,
      notes: 'تفصيل ثوب',
    });
    expect(tiRes.status).toBe(201);
    const ti = data(tiRes.body);
    expect(ti.id).toBeDefined();
    expect(ti.statusName).toBe('مستلم');
    expect(Number(ti.total)).toBe(200);
    // ACC-149: 15% VAT on 200 is 230
    expect(Number(ti.totalWithTax)).toBe(230);

    // ACC-150 / F10: Payment without cashLocationId must be rejected with 422
    const payNoLoc = await req('post', `/api/v1/tailoring/invoices/${ti.id}/payments`, {
      amount: '50.0000',
    });
    expect(payNoLoc.status).toBe(422);

    // ACC-150 / F06: Payment with cashLocationId creates and posts the voucher
    const payRes = await req('post', `/api/v1/tailoring/invoices/${ti.id}/payments`, {
      amount: '50.0000',
      cashLocationId,
      branchId,
      method: 'cash',
    });
    expect(payRes.status).toBe(201);
    const updatedTi = data(payRes.body);
    expect(Number(updatedTi.paidAmount)).toBe(50);
    expect(Number(updatedTi.remainingAmount)).toBe(180);

    const payment = updatedTi.payments[0];
    expect(payment.voucherId).toBeTruthy();

    // Verify voucher is posted with number RV-... and journal entry
    const vchRes = await req('get', `/api/v1/vouchers/${payment.voucherId}`);
    expect(vchRes.status).toBe(200);
    const voucher = data(vchRes.body);
    expect(voucher.status).toBe('posted');
    expect(voucher.number).toMatch(/^RV-/);
    expect(voucher.journalEntryId).toBeTruthy();
  });
});
