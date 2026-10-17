import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { sql } from 'drizzle-orm';
import {
  FABRICATED,
  applyRepairs,
  newId,
  planRepairs,
  withTenantTx,
  writeBackup,
  type RepairPlan,
} from '@erp/database';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { createActor, type Actor } from './fixtures.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * 🧰 `pnpm db:demo-repair` — إصلاحُ الصفوفِ التي كتبتها القيمُ الافتراضيةُ المفبركة قبل
 * الهجرة `0131_van_sales_honest_defaults.sql`.
 *
 * ولماذا اختبارٌ على قاعدةٍ حقيقية: فالأداةُ تكتب في أرقامٍ محاسبيةٍ قائمة، والأحكامُ التي
 * يجب أن تصمد ليست «هل تُصلَح الصفوف؟» بل **أيُّها لا يُلمس**:
 *
 *   • صفٌّ يحمل ٣٫٨٠ **بعد** تطبيق الهجرة ليس مفبركًا بالضرورة — فهو رقمٌ كتبه مسارٌ
 *     حيّ. والحدُّ (`created_at < applied_at`) هو الدليلُ الوحيد على أنّ المخططَ كتبه لا
 *     العمل، ومن دونه تصير الأداةُ تمحو تكاليفَ حقيقية.
 *   • صفُّ **بيعٍ** يحمل ٣٫٨٠ قبل الهجرة يُترك: فمسارُ البيع يُسمّي العمودَ صراحةً
 *     (‏`van-sales.service.ts:4921,4940`) وقد تكون ٣٫٨٠ تكلفةَ الصنف الحقيقية — وهذا
 *     الاحتمالُ بعينه هو ما أخفى العيبَ في تثبيت القبول (‏`items.purchase_price = 3.80`).
 *   • مرتجعٌ بلا إشعارٍ دائنٍ مُرحَّل تكلفتُه **مجهولة** ⇒ صفرٌ صادق، لا رقمٌ مخترع.
 *   • اسمُ صنفٍ مفبرك في دفعة إنتاجٍ بلا `item_id` يُترك: فالعمودُ `NOT NULL` (قِيس) فلا
 *     يُفرَّغ بصدق، واستبدالُه باسمٍ آخر اختراعٌ ثانٍ.
 *   • الكتابةُ معاملةٌ واحدة: فإن تغيّر صفٌّ بين القياس والكتابة (خادمٌ قائمٌ يعمل) تُلفّ
 *     الخطةُ كلّها ولا يُصلَح نصفُ حالة.
 *
 * والمثبّتاتُ هنا تُحاكي قاعدةً هاجرت قبل `0131`: تُدرج الصفوفَ ثم **تُعيد تاريخَ
 * إنشائها** إلى ما قبل `applied_at` — فالاختبارُ يمرّ على الشرط الحقيقيّ لا على شرطٍ
 * مُخفَّف. وقاعدةُ الاختبار مُرحَّلةٌ كلّها، فللهجرة `applied_at` حقيقية تُقرأ من
 * `erp_migrations`.
 */
describe('demo-repair — fabricated defaults are repaired, and what cannot be proven is left alone', () => {
  let ctx: TestApp;
  let owner: Actor;
  let client: Client;

  let tenantCode: string;
  let branchId: string;
  let warehouseId: string;
  let itemId: string;
  let salesmanId: string;
  let loadFab: string;
  let loadReal: string;
  let invoiceSale: string;
  let invoiceCredit: string;
  let returnWithCredit: string;
  let returnNoCredit: string;
  let returnAfterCutoff: string;
  let saleWith380: string;
  let saleWithBatchCode: string;
  let batchNamedItem: string;
  let batchNoItem: string;
  let batchInconsistent: string;
  let batchConsistent: string;
  /** أمرُ تحميلٍ يُدرَج في الحكم ١١ — والشاهدُ في الحكم ١٢ على أنّ المعاملةَ لُفّت. */
  let rollbackLoad: string;

  /** تاريخُ ما قبل الهجرة — يُقرأ من `erp_migrations` ولا يُخترع. */
  let cutoff: string;

  const valueOf = async (table: string, column: string, id: string): Promise<string | null> => {
    const result = await client.query<{ v: string | null }>(
      `SELECT ${column}::text AS v FROM ${table} WHERE id = $1::uuid`,
      [id],
    );
    return result.rows[0]?.v ?? null;
  };

  beforeAll(async () => {
    ctx = await createTestApp('demo-repair');
    tenantCode = 'repair-bakery';
    owner = await createActor(ctx, {
      tenantCode,
      tenantName: 'مخابز إصلاح البيانات',
      email: 'owner@repair.test',
      permissions: ['van_sales.view'],
      roleNames: ['Owner'],
      isOwner: true,
    });

    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(owner.tenantId);
    branchId = defaults.branchId;
    warehouseId = defaults.warehouseId;

    const tenantId = owner.tenantId;
    itemId = newId();
    salesmanId = newId();
    loadFab = newId();
    loadReal = newId();
    invoiceSale = newId();
    invoiceCredit = newId();
    returnWithCredit = newId();
    returnNoCredit = newId();
    returnAfterCutoff = newId();
    saleWith380 = newId();
    saleWithBatchCode = newId();
    batchNamedItem = newId();
    batchNoItem = newId();
    batchInconsistent = newId();
    batchConsistent = newId();
    const categoryId = newId();
    const unitId = newId();
    const employeeId = newId();

    await withTenantTx(ctx.handle.db, tenantId, async (tx) => {
      await tx.execute(sql`
        INSERT INTO item_categories (id, tenant_id, code, name_ar)
        VALUES (${categoryId}::uuid, ${tenantId}::uuid, 'CAT-REPAIR', 'منتجات المخبز')
      `);
      await tx.execute(sql`
        INSERT INTO units_of_measure (id, tenant_id, code, name_ar, name_en)
        VALUES (${unitId}::uuid, ${tenantId}::uuid, 'KG', 'كيلوجرام', 'Kilogram')
      `);
      /** الصنفُ الذي يُصلَح منه اسمُ الدفعة — واسمُه الحقيقيّ ليس النصَّ المفبرك. */
      await tx.execute(sql`
        INSERT INTO items (id, tenant_id, sku, name_ar, category_id, base_unit_id, kind, purchase_price, sale_price, track_lot)
        VALUES (${itemId}::uuid, ${tenantId}::uuid, 'SKU-REPAIR', 'خبز عربي كبير', ${categoryId}::uuid, ${unitId}::uuid, 'stock', 4, 10, false)
      `);
      await tx.execute(sql`
        INSERT INTO employees (id, tenant_id, employee_no, name, branch_id, membership_id, status)
        VALUES (${employeeId}::uuid, ${tenantId}::uuid, 'EMP-REPAIR', 'مندوب الإصلاح', ${branchId}::uuid, ${owner.membershipId}::uuid, 'active')
      `);
      await tx.execute(sql`
        INSERT INTO salesmen (id, tenant_id, name, active, employee_id, warehouse_id)
        VALUES (${salesmanId}::uuid, ${tenantId}::uuid, 'مندوب الإصلاح', true, ${employeeId}::uuid, ${warehouseId}::uuid)
      `);
      await tx.execute(sql`
        INSERT INTO van_load_orders
          (id, tenant_id, branch_id, number, salesman_id, warehouse_id, load_date, status,
           batch_code, loaded_qty, created_at)
        VALUES
          (${loadFab}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'VLO-FAB', ${salesmanId}::uuid,
           ${warehouseId}::uuid, DATE '2026-05-01', 'loaded', ${FABRICATED.batchCode}, 20, now()),
          (${loadReal}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'VLO-REAL', ${salesmanId}::uuid,
           ${warehouseId}::uuid, DATE '2026-05-01', 'loaded', 'BATCH-2026-05-01', 20, now())
      `);
      /** الإشعارُ الدائن — ومصدرُ تكلفةِ المرتجع هو `cost_total` على سطوره. */
      await tx.execute(sql`
        INSERT INTO sales_invoices (id, tenant_id, branch_id, kind, number, currency, subtotal, tax_total, total, cost_total, created_at)
        VALUES
          (${invoiceSale}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'sale', 'INV-1', 'SAR', 60, 0, 60, 24, now()),
          (${invoiceCredit}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'credit_note', 'CN-1', 'SAR', 20, 0, 20, 15.20, now())
      `);
      await tx.execute(sql`
        UPDATE sales_invoices SET reference_invoice_id = ${invoiceSale}::uuid WHERE id = ${invoiceCredit}::uuid
      `);
      await tx.execute(sql`
        INSERT INTO sales_invoice_lines (id, tenant_id, invoice_id, line_no, item_id, quantity, unit_price, total, cost_total)
        VALUES (${newId()}::uuid, ${tenantId}::uuid, ${invoiceCredit}::uuid, 1, ${itemId}::uuid, 2, 10, 20, 15.20)
      `);
      await tx.execute(sql`
        INSERT INTO van_sales_documents
          (id, tenant_id, branch_id, number, salesman_id, load_order_id, doc_date, document_kind,
           invoice_mode, payment_method, sold_qty, unit_price, subtotal, total, paid_amount,
           unit_cost, batch_code, sales_invoice_id, reference_document_id, created_at)
        VALUES
          (${returnWithCredit}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'VSD-R1', ${salesmanId}::uuid,
           ${loadFab}::uuid, DATE '2026-05-02', 'return', 'normal', 'credit', 2, 10, 20, 20, 0,
           ${FABRICATED.unitCost}::numeric, ${FABRICATED.batchCode}, ${invoiceCredit}::uuid, ${saleWithBatchCode}::uuid, now()),
          (${returnNoCredit}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'VSD-R2', ${salesmanId}::uuid,
           ${loadFab}::uuid, DATE '2026-05-02', 'return', 'normal', 'credit', 3, 10, 30, 30, 0,
           ${FABRICATED.unitCost}::numeric, 'BATCH-2026-05-01', NULL, NULL, now()),
          (${returnAfterCutoff}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'VSD-R3', ${salesmanId}::uuid,
           ${loadReal}::uuid, DATE '2026-05-03', 'return', 'normal', 'credit', 1, 10, 10, 10, 0,
           ${FABRICATED.unitCost}::numeric, 'BATCH-2026-05-01', NULL, NULL, now()),
          (${saleWith380}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'VSD-S1', ${salesmanId}::uuid,
           ${loadFab}::uuid, DATE '2026-05-02', 'sale', 'normal', 'credit', 5, 10, 50, 50, 20,
           ${FABRICATED.unitCost}::numeric, 'BATCH-2026-05-01', ${invoiceSale}::uuid, NULL, now()),
          (${saleWithBatchCode}::uuid, ${tenantId}::uuid, ${branchId}::uuid, 'VSD-S2', ${salesmanId}::uuid,
           ${loadFab}::uuid, DATE '2026-05-02', 'sale', 'normal', 'credit', 6, 10, 60, 60, 10,
           4.0000::numeric, ${FABRICATED.batchCode}, ${invoiceSale}::uuid, NULL, now())
      `);
      await tx.execute(sql`
        INSERT INTO factory_production_batches
          (id, tenant_id, batch_no, item_name, item_id, warehouse_id, produced_qty, issued_qty,
           unit_cost, total_cost, status, created_at)
        VALUES
          (${batchNamedItem}::uuid, ${tenantId}::uuid, 'FPB-1', ${FABRICATED.itemName}, ${itemId}::uuid,
           ${warehouseId}::uuid, 100, 20, 4.0000, 400.0000, 'closed', now()),
          (${batchNoItem}::uuid, ${tenantId}::uuid, 'FPB-2', ${FABRICATED.itemName}, NULL,
           ${warehouseId}::uuid, 50, 0, 5.0000, 250.0000, 'closed', now()),
          (${batchInconsistent}::uuid, ${tenantId}::uuid, 'FPB-3', 'دفعةُ خبزٍ حقيقية', ${itemId}::uuid,
           ${warehouseId}::uuid, 10, 0, ${FABRICATED.unitCost}::numeric, 100.0000, 'closed', now()),
          (${batchConsistent}::uuid, ${tenantId}::uuid, 'FPB-4', 'دفعةُ خبزٍ حقيقية', ${itemId}::uuid,
           ${warehouseId}::uuid, 10, 0, ${FABRICATED.unitCost}::numeric, 38.0000, 'closed', now())
      `);
    });

    client = new Client({ connectionString: ctx.db.ownerUrl });
    await client.connect();
    const migration = await client.query<{ applied_at: string }>(
      `SELECT applied_at::text FROM erp_migrations WHERE name LIKE '0131%' ORDER BY applied_at LIMIT 1`,
    );
    cutoff = migration.rows[0]?.applied_at ?? '';
    expect(cutoff, 'the test database must be migrated past 0131').not.toBe('');

    // —— «هاجرت قبل ٠١٣١»: تُعاد تواريخُ الإنشاء إلى ما قبل تطبيق الهجرة، فيصير الحدُّ هو
    //    الدليلَ المُختبَر لا تاريخَ الإدراج. والصفوفُ التي تبقى بعد الحدّ (‏`returnAfterCutoff`
    //    و`loadReal`) تبقى عمدًا — فهي الشاهدُ على أنّ ما بعد الهجرة لا يُلمس.
    await client.query('BEGIN');
    for (const [table, ids] of [
      ['van_load_orders', [loadFab]],
      ['van_sales_documents', [saleWith380, saleWithBatchCode, returnWithCredit, returnNoCredit]],
      ['factory_production_batches', [batchNamedItem, batchNoItem, batchInconsistent, batchConsistent]],
    ] as const) {
      for (const id of ids) {
        await client.query(
          `UPDATE ${table} SET created_at = $2::timestamptz - interval '2 days' WHERE id = $1::uuid`,
          [id, cutoff],
        );
      }
    }
    await client.query('COMMIT');
  }, 240_000);

  afterAll(async () => {
    await client?.end();
    await ctx?.close();
  });

  it('١. القياسُ وحده لا يكتب: فـ`planRepairs` ترجع خطةً وتترك القاعدةَ كما هي', async () => {
    const plan = await planRepairs(client);
    expect(plan.cutoff).toBe(cutoff);
    expect(plan.repairs.length).toBeGreaterThan(0);

    expect(await valueOf('van_sales_documents', 'unit_cost', returnWithCredit)).toBe('3.8000');
    expect(await valueOf('van_sales_documents', 'batch_code', saleWithBatchCode)).toBe(FABRICATED.batchCode);
    expect(await valueOf('factory_production_batches', 'item_name', batchNamedItem)).toBe(FABRICATED.itemName);
  });

  it('٢. تكلفةُ المرتجع تُشتقّ من إشعاره الدائن: ‏cost_total ÷ quantity = ٧٫٦٠٠٠', async () => {
    const plan = await planRepairs(client);
    const repair = plan.repairs.find((row) => row.id === returnWithCredit && row.category === 'return-unit-cost');
    expect(repair, 'the fabricated return must be planned').toBeDefined();
    expect(repair?.before).toBe('3.8000');
    expect(repair?.after).toBe('7.6000'); // ‏15.20 ÷ 2 — وهي الطريقةُ التي يكتبها المسارُ الرسميّ اليوم
    expect(repair?.tenantCode).toBe(tenantCode);
  });

  it('٣. مرتجعٌ بلا إشعارٍ دائن ⇒ صفرٌ صادق، ويُعدّ في «لا يُكتشف»', async () => {
    const plan = await planRepairs(client);
    const repair = plan.repairs.find((row) => row.id === returnNoCredit && row.category === 'return-unit-cost');
    expect(repair?.after).toBe('0.0000');
    const reported = plan.reportOnly.find((row) => row.key === 'return-cost-undiscoverable');
    expect(reported?.count).toBe(1);
  });

  it('٤. ما لا يُثبت المخططُ فبركتَه لا يُلمس: مرتجعٌ بعد الحدّ، وصفُّ بيعٍ بـ٣٫٨٠', async () => {
    const plan = await planRepairs(client);
    const ids = plan.repairs.map((row) => row.id);
    // ‏٣٫٨٠ بعد `0131` رقمٌ كتبه مسارٌ حيّ — فلا دليلَ على أنّ المخططَ اختلقه.
    expect(ids).not.toContain(returnAfterCutoff);
    // وصفُّ البيع: المسارُ يُسمّي `unit_cost` صراحةً فقد تكون ٣٫٨٠ تكلفةَ الصنف الحقيقية.
    expect(ids).not.toContain(saleWith380);
    expect(plan.reportOnly.find((row) => row.key === 'sale-unit-cost-3.80')?.count).toBe(1);
    // ودفعةُ الإنتاج المتّسقة (‏10 × 3.80 = 38.00) تُعدّ ولا تُصلَح.
    expect(plan.reportOnly.find((row) => row.key === 'batch-unit-cost-3.80')?.count).toBe(2);
    expect(ids).not.toContain(batchConsistent);
  });

  it('٥. `batch_code` المفبركة تُفرَّغ في أمرَي التحميل والمستندات، والحقيقية تُترك', async () => {
    const plan = await planRepairs(client);
    const load = plan.repairs.find((row) => row.id === loadFab && row.category === 'load-batch-code');
    expect(load?.after).toBeNull();
    expect(plan.repairs.some((row) => row.id === loadReal)).toBe(false);
    expect(plan.repairs.filter((row) => row.category === 'document-batch-code').map((row) => row.id).sort()).toEqual(
      [returnWithCredit, saleWithBatchCode].sort(),
    );
  });

  it('٦. اسمُ الصنف المفبرك يُستبدل باسم الصنف المربوط، وبلا `item_id` يُترك ويُعدّ', async () => {
    const plan = await planRepairs(client);
    const named = plan.repairs.find((row) => row.id === batchNamedItem);
    expect(named?.after).toBe('خبز عربي كبير');
    expect(plan.repairs.some((row) => row.id === batchNoItem)).toBe(false);
    expect(plan.reportOnly.find((row) => row.key === 'batch-item-name-undiscoverable')?.count).toBe(1);
  });

  it('٧. تناقضُ تكلفةِ الدفعة مغلقٌ افتراضيًّا، ويُفتح بـ`fixBatchCost` وحدها', async () => {
    const closed = await planRepairs(client);
    expect(closed.repairs.some((row) => row.category === 'batch-unit-cost-inconsistent')).toBe(false);

    const open = await planRepairs(client, { fixBatchCost: true });
    const repair = open.repairs.find((row) => row.id === batchInconsistent && row.category === 'batch-unit-cost-inconsistent');
    expect(repair?.before).toBe('3.8000');
    expect(repair?.after).toBe('10.0000'); // ‏100.0000 ÷ 10 — من أرقامِ الصفّ نفسه
    expect(open.repairs.some((row) => row.id === batchConsistent)).toBe(false);
  });

  it('٨. `--tenant` يُضيّق: رمزُ المنشأة يجد صفوفَها، ورمزٌ آخر لا يجد شيئًا', async () => {
    const scoped = await planRepairs(client, { tenantCode });
    expect(scoped.repairs.length).toBeGreaterThan(0);
    expect(scoped.repairs.every((row) => row.tenantCode === tenantCode)).toBe(true);

    const other = await planRepairs(client, { tenantCode: 'tenant-that-does-not-exist' });
    expect(other.repairs).toEqual([]);
  });

  it('٩. النسخةُ الاحتياطية تُكتب قبل التطبيق وتحمل القيمَ القديمة', () => {
    const dir = mkdtempSync(join(tmpdir(), 'demo-repair-'));
    try {
      const plan: RepairPlan = { cutoff, repairs: [], reportOnly: [] };
      // خطةٌ حقيقية صغيرة: صفٌّ واحد يكفي لإثبات أنّ «قبل» محفوظ.
      plan.repairs.push({
        category: 'return-unit-cost',
        table: 'van_sales_documents',
        column: 'unit_cost',
        id: returnWithCredit,
        tenantCode,
        reference: 'VSD-R1',
        createdAt: '2026-05-02',
        before: '3.8000',
        after: '7.6000',
        reasonAr: 'من الإشعار الدائن',
        backup: { unit_cost: '3.8000' },
      });
      const path = writeBackup(plan, dir);
      const written = JSON.parse(readFileSync(path, 'utf8')) as {
        migrationCutoff: string;
        repairs: { before: string; backup: Record<string, unknown> }[];
      };
      expect(written.migrationCutoff).toBe(cutoff);
      expect(written.repairs[0]?.before).toBe('3.8000');
      expect(written.repairs[0]?.backup).toEqual({ unit_cost: '3.8000' });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('١٠. الكتابةُ تصلح ما خُطّط، وتشغيلٌ ثانٍ لا يجد شيئًا (الأداةُ عادّة)', async () => {
    const plan = await planRepairs(client);
    const result = await applyRepairs(client, plan);
    expect(result.failed).toBeNull();
    expect(result.applied).toBe(plan.repairs.length);

    expect(await valueOf('van_sales_documents', 'unit_cost', returnWithCredit)).toBe('7.6000');
    expect(await valueOf('van_sales_documents', 'unit_cost', returnNoCredit)).toBe('0.0000');
    expect(await valueOf('van_sales_documents', 'batch_code', saleWithBatchCode)).toBeNull();
    expect(await valueOf('van_load_orders', 'batch_code', loadFab)).toBeNull();
    expect(await valueOf('factory_production_batches', 'item_name', batchNamedItem)).toBe('خبز عربي كبير');

    // وما تُرك عمدًا بقي كما هو.
    expect(await valueOf('van_sales_documents', 'unit_cost', saleWith380)).toBe('3.8000');
    expect(await valueOf('van_sales_documents', 'unit_cost', returnAfterCutoff)).toBe('3.8000');
    expect(await valueOf('factory_production_batches', 'item_name', batchNoItem)).toBe(FABRICATED.itemName);
    expect(await valueOf('van_load_orders', 'batch_code', loadReal)).toBe('BATCH-2026-05-01');
    // وربحُ المرتجع لم يُلمس: فصفُّ المرتجع يحمل صفرًا بالتصميم ولا يُشتقّ من `unit_cost`.
    expect(await valueOf('van_sales_documents', 'net_profit', returnWithCredit)).toBe('0.0000');

    const second = await planRepairs(client);
    expect(second.repairs).toEqual([]);
  });

  it('١١. صفٌّ تغيّر بين القياس والكتابة ⇒ تُلفّ المعاملةُ كلّها ولا يُصلَح نصفُ حالة', async () => {
    // صفٌّ مفبركٌ جديد يُخطَّط **قبل** الصفّ الذي سيفشل (فئةُ أوامر التحميل تأتي قبل فئةِ
    // تكلفة الدفعة في الخطة) — فلو كُتب ثم لُفّ، كان الدليلُ أنّ المعاملةَ واحدة.
    rollbackLoad = newId();
    await client.query(
      `INSERT INTO van_load_orders (id, tenant_id, branch_id, number, salesman_id, warehouse_id,
                                    load_date, status, batch_code, loaded_qty, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'VLO-ROLLBACK', $4::uuid, $5::uuid,
               DATE '2026-05-01', 'loaded', $6, 10, $7::timestamptz - interval '2 days')`,
      [rollbackLoad, owner.tenantId, branchId, salesmanId, warehouseId, FABRICATED.batchCode, cutoff],
    );

    const before = await planRepairs(client, { fixBatchCost: true });
    expect(before.repairs.map((row) => row.id)).toContain(rollbackLoad);
    expect(before.repairs.map((row) => row.id)).toContain(batchInconsistent);
    expect(before.repairs.findIndex((row) => row.id === rollbackLoad))
      .toBeLessThan(before.repairs.findIndex((row) => row.id === batchInconsistent));

    // خادمٌ قائمٌ يكتب على صفّ الدفعة بعد القياس — فتصير قيمةُ «قبل» في الخطة كاذبة.
    await client.query(
      `UPDATE factory_production_batches SET unit_cost = 12.5000, total_cost = 125.0000 WHERE id = $1::uuid`,
      [batchInconsistent],
    );

    const result = await applyRepairs(client, before);
    expect(result.failed?.id).toBe(batchInconsistent);
    expect(result.applied).toBe(0);
    // والدليلُ على اللفّ: أمرُ التحميل الذي **نجحت** كتابتُه داخل المعاملة عاد كما كان.
    expect(await valueOf('van_load_orders', 'batch_code', rollbackLoad)).toBe(FABRICATED.batchCode);
    expect(await valueOf('factory_production_batches', 'unit_cost', batchInconsistent)).toBe('12.5000');
  });

  it('١٢. حارسُ الكتابة يعضّ في فئةِ المرتجع أيضًا — وتُلفّ الخطةُ كلّها', async () => {
    // تخريبٌ سابقٌ لهذا الحكم (إزالةُ `AND unit_cost = $3::numeric` من كتابة المرتجع)
    // **مرّ بلا فشل**: فحكمُ ١١ يُخرّب صفَّ دفعةِ إنتاج، والحارسُ مكرَّرٌ لكلّ فئة — ومن
    // هنا صفُّ مرتجعٍ يُخترق حارسُه صراحةً.
    const freshReturn = newId();
    await client.query(
      `INSERT INTO van_sales_documents
         (id, tenant_id, branch_id, number, salesman_id, load_order_id, doc_date, document_kind,
          invoice_mode, payment_method, sold_qty, unit_price, subtotal, total, paid_amount,
          unit_cost, sales_invoice_id, created_at)
       VALUES ($1::uuid, $2::uuid, $3::uuid, 'VSD-GUARD', $4::uuid, $5::uuid, DATE '2026-05-02',
               'return', 'normal', 'credit', 2, 10, 20, 20, 0, $6::numeric, $7::uuid,
               $8::timestamptz - interval '2 days')`,
      [freshReturn, owner.tenantId, branchId, salesmanId, loadFab, FABRICATED.unitCost, invoiceCredit, cutoff],
    );

    const plan = await planRepairs(client);
    const planned = plan.repairs.map((row) => `${row.table}.${row.column}:${row.id}`).sort();
    expect(planned).toContain(`van_sales_documents.unit_cost:${freshReturn}`);
    expect(plan.repairs.find((row) => row.id === freshReturn)?.after).toBe('7.6000');

    // كاتبٌ آخر يرفع التكلفةَ بعد القياس — فقيمةُ «قبل» في الخطة صارت كاذبة.
    await client.query(`UPDATE van_sales_documents SET unit_cost = 5.0000 WHERE id = $1::uuid`, [freshReturn]);

    const result = await applyRepairs(client, plan);
    expect(result.failed?.id).toBe(freshReturn);
    expect(result.failed?.category).toBe('return-unit-cost');
    expect(result.applied).toBe(0);
    expect(await valueOf('van_sales_documents', 'unit_cost', freshReturn)).toBe('5.0000');

    // والدليلُ على اللفّ: أمرُ التحميل المفبرك — وهو **قبل** المرتجع في الخطة فقد كُتب داخل
    // المعاملة ثم لُفّ — ما زال يحمل علامته. وإعادةُ القياس تجد الصفوفَ نفسها ما عدا الصفَّ
    // المُخترَق: فقيمته تغيّرت فلم يعد مطابقًا لعلامة ٣٫٨٠ (وهذا قصورُ العلامة لا إصلاحٌ).
    expect(await valueOf('van_load_orders', 'batch_code', rollbackLoad)).toBe(FABRICATED.batchCode);
    const replanned = (await planRepairs(client)).repairs.map((row) => `${row.table}.${row.column}:${row.id}`).sort();
    expect(replanned).toEqual(
      planned.filter((key) => key !== `van_sales_documents.unit_cost:${freshReturn}`),
    );
  });

  it('١٣. قاعدةٌ لم تُطبَّق فيها `0131` تُرفض — فالافتراضيّات ما زالت حيّة', async () => {
    // لا تُحذف هجرةٌ من قاعدةِ الاختبار؛ فالفحصُ على نسخةٍ من الشرط: أداةٌ تُخطّط بلا حدٍّ
    //     تُصلح صفوفًا سيعيد المخططُ فبركتَها في الإدراج التالي.
    const fake = {
      query: async <T>(text: string): Promise<{ rows: T[]; rowCount: number | null }> => {
        if (text.includes('erp_migrations')) return { rows: [] as T[], rowCount: 0 };
        return client.query<T>(text);
      },
    };
    await expect(planRepairs(fake)).rejects.toThrow(/0131_van_sales_honest_defaults\.sql is not applied/);
  });
});
