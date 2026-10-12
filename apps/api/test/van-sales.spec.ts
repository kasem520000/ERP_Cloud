import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newId, withTenantTx } from '@erp/database';
import { sql } from 'drizzle-orm';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

describe('Factory, Bakery & Van Sales 10-pillar workflow', () => {
  let ctx: TestApp;
  let owner: Actor;
  let salesmanId: string;
  let partyId: string;

  beforeAll(async () => {
    ctx = await createTestApp('van-sales-factory');
    owner = await createActor(ctx, {
      tenantCode: 'bakery-a',
      tenantName: 'مصنع ومخابز الأصالة',
      email: 'owner@bakery-a.test',
      permissions: [...ALL_TENANT_PERMISSIONS, 'sales.view', 'sales.invoice.create'],
      roleNames: ['Admin'],
      isOwner: true,
    });

    salesmanId = newId();
    partyId = newId();
    await withTenantTx(ctx.handle.db, owner.tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active)
        VALUES (${salesmanId}::uuid, ${owner.tenantId}::uuid, 'مندوب التوزيع الأول', true)
      `);
      await tx.execute(sql`
        INSERT INTO parties (id, tenant_id, code, kind, name, tax_no, credit_limit)
        VALUES (${partyId}::uuid, ${owner.tenantId}::uuid, 'CUST-01', 'customer', 'تموينات النور', '300000000000003', 5000)
      `);
    });
  });

  afterAll(async () => {
    await ctx?.close();
  });

  it('runs the full 10-pillar Factory, Van Custody, Invoicing & Pending Closing workflow', async () => {
    // 1. Initial dashboard succeeds
    const dash0 = await api(ctx.server, 'get', '/api/v1/van-sales/dashboard', {
      token: owner.token,
    });
    expect(dash0.status, JSON.stringify(dash0.body)).toBe(200);

    // 2. Record daily factory production batch (500 kg @ 3.80 SAR/kg)
    const prodRes = await api(ctx.server, 'post', '/api/v1/van-sales/production-batches', {
      token: owner.token,
      body: {
        itemName: 'رقائق سمبوسة بلدي طازجة',
        producedQty: '500',
        unitCost: '3.80',
        supervisorName: 'مشرف الإنتاج',
      },
    });
    expect(prodRes.status, JSON.stringify(prodRes.body)).toBe(201);
    const prodData = prodRes.body.data as {
      summary: { totalProducedKg: string; mainWarehouseBalanceKg: string };
      productionBatches: Array<{ batchNo: string }>;
    };
    expect(prodData.summary.totalProducedKg).toBe('500.00');
    expect(prodData.summary.mainWarehouseBalanceKg).toBe('500.00');
    const batchNo = prodData.productionBatches[0]!.batchNo;

    // 3. Configure custom price tier for customer (6.50 SAR/kg, locked)
    const priceRes = await api(ctx.server, 'post', '/api/v1/van-sales/customer-prices', {
      token: owner.token,
      body: {
        partyId,
        priceTierLabel: 'شريحة جملة المخابز — 6.50 ريال',
        unitPrice: '6.50',
        maxBonusPct: '20',
        maxBonusKgPerInvoice: '20',
        creditLimit: '5000',
        paymentTermsDays: 15,
        lockPrice: true,
        maxDiscountPct: '0',
        preferredInvoiceMode: 'zatca_tax',
      },
    });
    expect(priceRes.status, JSON.stringify(priceRes.body)).toBe(201);

    // 4. Issue 150 kg Van Load Order to Sales Rep from production batch
    const loadRes = await api(ctx.server, 'post', '/api/v1/van-sales/load-orders', {
      token: owner.token,
      body: {
        salesmanId,
        productionBatchNo: batchNo,
        vehiclePlate: 'أ ب ج 4521',
        loadedQty: '150',
        maxBonusQty: '20',
        maxBonusPct: '20',
      },
    });
    expect(loadRes.status, JSON.stringify(loadRes.body)).toBe(201);
    const loadData = loadRes.body.data as {
      summary: { mainWarehouseBalanceKg: string; totalLoadedKg: string };
      loadOrders: Array<{ id: string; status: string; remainingQty: string }>;
    };
    expect(loadData.summary.mainWarehouseBalanceKg).toBe('350.00');
    expect(loadData.summary.totalLoadedKg).toBe('150.00');
    const loadOrderId = loadData.loadOrders[0]!.id;

    // 5. Issue Van Sales Document: 100 kg sold + 20 kg bonus
    const docRes = await api(ctx.server, 'post', '/api/v1/van-sales/documents', {
      token: owner.token,
      body: {
        loadOrderId,
        partyId,
        invoiceMode: 'zatca_tax',
        paymentMethod: 'cash',
        soldQty: '100',
        bonusQty: '20',
        bonusReason: 'بونص ترويجي متفق عليه مع العميل',
        unitPrice: '6.50',
        customerBonusConfirmed: true,
      },
    });
    expect(docRes.status, JSON.stringify(docRes.body)).toBe(201);

    // 6. Stage 1: Rep submits end-of-day shift closing with 25 kg damaged -> 5 kg shortage (32.50 SAR)
    const submitClosingRes = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/submit-closing`,
      {
        token: owner.token,
        body: {
          returnedQty: '0',
          damagedQty: '25',
          damageReason: 'تلف أثناء النقل والحرارة — خاضع للفحص الفعلي',
          collectedCash: '747.50',
        },
      },
    );
    expect(submitClosingRes.status, JSON.stringify(submitClosingRes.body)).toBe(201);
    const pendingOrder = (
      submitClosingRes.body.data as {
        loadOrders: Array<{
          id: string;
          status: string;
          shortageQty: string;
          shortageValue: string;
        }>;
      }
    ).loadOrders.find((l) => l.id === loadOrderId)!;
    expect(pendingOrder.status).toBe('pending_closing');
    expect(Number(pendingOrder.shortageQty)).toBe(5);
    expect(Number(pendingOrder.shortageValue)).toBe(32.5);

    // 7. Stage 2: Accountant inspects damaged goods, approves salary deduction & zeroes out custody
    const approveClosingRes = await api(
      ctx.server,
      'post',
      `/api/v1/van-sales/load-orders/${loadOrderId}/approve-closing`,
      {
        token: owner.token,
        body: {
          returnedQty: '0',
          damagedQty: '25',
          collectedCash: '747.50',
          damageInspected: true,
          salaryDeductionApproved: true,
        },
      },
    );
    expect(approveClosingRes.status, JSON.stringify(approveClosingRes.body)).toBe(201);
    const settledOrder = (
      approveClosingRes.body.data as {
        loadOrders: Array<{
          id: string;
          status: string;
          remainingQty: string;
          damageInspected: boolean;
          salaryDeductionApproved: boolean;
        }>;
      }
    ).loadOrders.find((l) => l.id === loadOrderId)!;
    expect(settledOrder.status).toBe('settled');
    expect(Number(settledOrder.remainingQty)).toBe(0);
    expect(settledOrder.damageInspected).toBe(true);
    expect(settledOrder.salaryDeductionApproved).toBe(true);
  });
});
