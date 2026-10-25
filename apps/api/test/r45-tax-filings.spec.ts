import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwnerClient } from '@erp/testing';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';

import { ALL_ORGANIZATION_PERMISSIONS, ALL_PLATFORM_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * MF-18 / r45 / D11 — دورة الإقرار الضريبي: `vat_filings` (تجميد + تسوية + قفل الفترة).
 *
 *   • AC1: إقرار مقدَّم لا يتغيّر بمستند لاحق بتاريخ داخله — التقرير المعاد تشغيله بعد
 *     التقديم يطابق اللقطة حرفاً بحرف، وأي مستند داخل الفترة (فاتورة اليوم / قيد مؤرَّخ)
 *     يُرفض `FISCAL_PERIOD_CLOSED`، وإعادة فتح الفترة `VAT_FILING_EXISTS`.
 *   • AC2: وعاء المبيعات = الفواتير المرحَّلة − المردودات − الإشعارات الدائنة **بالتصنيف
 *     الصحيح** (بنود النموذج: خاضع/معفى…). اللقطة المجمَّدة = التقرير نفسه بمصدر واحد —
 *     وإذا كان التقرير الدوري يغفل الإشعارات الدائنة فلا يصلح أساس إقرار مجمَّد (RED هنا).
 *   • AC3: تطابق 2222001 لحظة التقديم — الرصيد قبل = صافي الإقرار، والتسوية تصفّره وتنقله
 *     إلى «ضريبة مستحقة الدفع» (2222003) أو «ضريبة مستردة» (1280001) بالسالب.
 *   • صافي = 0 → بلا قيد · نفس النطاق/تداخل نطاقين → 409 · بلا `accounting.period.close` → 403.
 *   • قيد التسوية ليس حدثاً ضريياً (`is_vat=false`) — وإلا خالف تقرير ما بعد التقديم اللقطة
 *     (يظهر ضمن «سندات الصرف»).
 *
 * المبلغات مستقلة عن الكود: خاضع 100 − مردود 10 − إشعار دائن 10 = 80 · ضريبة 15 − 1.5 − 1.5
 * = 12.00 · معفى 40 · الحساب على حساب (لا استيراد للصيغة المُختبَرة).
 * البيئة: psql ليس في PATH بعد re-clone ⇐ كل الاستعلامات `withOwnerClient`.
 * الخطة: `docs/accounting-audit/plans/r45-tax-filings.md`.
 */
describe('MF-18 / r45 — دورة الإقرار الضريبي (vat_filings)', () => {
  let ctxA: TestApp;
  let actorA: Actor;
  let clerkA: Actor;
  let ctxB: TestApp;
  let actorB: Actor;

  const data = (body: Record<string, unknown>) => (body.data ?? body) as Record<string, unknown>;
  const clientFor = (ctx: TestApp, actor: Actor) => {
    const post = (path: string, body: Record<string, unknown> = {}) =>
      api(ctx.server, 'post', `/api/v1${path}`, { token: actor.token, body });
    const get = (path: string) => api(ctx.server, 'get', `/api/v1${path}`, { token: actor.token });
    return { post, get };
  };

  // ── نطاق الشهر (من/إلى) — نفس معامِلات تقرير `vat-return-period` ─────────────
  const monthRange = (offset = 0) => {
    const now = new Date();
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { from: iso(start), to: iso(end), month: iso(start).slice(0, 7) };
  };
  const CURRENT = monthRange(0);
  const NEXT = monthRange(1);

  type Client = ReturnType<typeof clientFor>;
  type Report = { rows: Array<Record<string, string>>; grandTotal: Array<{ key: string; amount: string }> };

  const vatReport = async (client: Client, range: { from: string; to: string }) => {
    const response = await client.get(`/reports/vat-return-period?from=${range.from}&to=${range.to}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return response.body as Report;
  };
  const netOf = (report: Report) => Number(report.grandTotal.find((card) => card.key === 's_net_vat')?.amount ?? '0');
  const bucket = (report: Report, line: string) => report.rows.find((row) => row.line === line);

  const glVatBalance = (ctx: TestApp, actor: Actor, code: string) =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        `SELECT coalesce(sum(l.credit - l.debit), 0)::text AS balance
         FROM journal_entry_lines l
         JOIN journal_entries e ON e.id = l.entry_id
         JOIN accounts a ON a.id = l.account_id
         WHERE l.tenant_id = $1 AND a.code = $2 AND e.status = 'posted'`,
        [actor.tenantId, code],
      );
      return Number((result.rows[0] as { balance: string }).balance);
    });

  const accountByCode = (ctx: TestApp, actor: Actor, code: string) =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(`SELECT id, name_ar FROM accounts WHERE tenant_id = $1 AND code = $2`, [
        actor.tenantId,
        code,
      ]);
      return (result.rows[0] ?? null) as { id: string; name_ar: string } | null;
    });

  const filingCount = (ctx: TestApp, actor: Actor) =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(`SELECT count(*)::int AS total FROM vat_filings WHERE tenant_id = $1`, [
        actor.tenantId,
      ]);
      return (result.rows[0] as { total: number }).total;
    });

  const filingSnapshot = (ctx: TestApp, actor: Actor, id: string) =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        `SELECT net_vat, journal_entry_id, snapshot FROM vat_filings WHERE tenant_id = $1 AND id = $2`,
        [actor.tenantId, id],
      );
      const row = result.rows[0] as
        | { net_vat: string; journal_entry_id: string | null; snapshot: { rows: Array<Record<string, string>> } }
        | undefined;
      if (!row) return null;
      return { netVat: Number(row.net_vat), journalEntryId: row.journal_entry_id, snapshotRows: row.snapshot.rows };
    });

  const journalLegs = (ctx: TestApp, actor: Actor, entryId: string) =>
    withOwnerClient(ctx.db.ownerUrl, async (client) => {
      const result = await client.query(
        `SELECT a.code, coalesce(sum(l.debit), 0)::text AS debit, coalesce(sum(l.credit), 0)::text AS credit
           FROM journal_entry_lines l JOIN accounts a ON a.id = l.account_id
          WHERE l.tenant_id = $1 AND l.entry_id = $2 GROUP BY a.code ORDER BY a.code`,
        [actor.tenantId, entryId],
      );
      return result.rows as Array<{ code: string; debit: string; credit: string }>;
    });

  /** مستأجر قياسي: تبويبات + سنة مالية + صنف مخزني + بضاعة افتتاحية. */
  const provision = async (ctx: TestApp, actor: Actor, sku: string) => {
    const { post } = clientFor(ctx, actor);
    const defaults = await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(actor.tenantId);
    const year = new Date().getUTCFullYear();
    const fiscalYear = await post('/fiscal-years', {
      name: `FY${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year + 1}-12-31`,
    });
    expect(fiscalYear.status, JSON.stringify(fiscalYear.body)).toBe(201);
    const unitId = String(data((await post('/organization/catalog/units', { code: `U-${sku}`, nameAr: 'حبة' })).body).id);
    const categoryId = String(
      data((await post('/organization/catalog/categories', { code: `C-${sku}`, nameAr: 'عام' })).body).id,
    );
    const itemId = String(
      data(
        (
          await post('/organization/catalog/items', {
            sku,
            nameAr: `صنف ${sku}`,
            categoryId,
            baseUnitId: unitId,
            kind: 'stock',
            salePrice: '100.0000',
          })
        ).body,
      ).id,
    );
    const opening = await post('/inventory/ledger/record', {
      lines: [
        {
          itemId,
          warehouseId: defaults.warehouseId,
          qty: '500',
          unitCost: '40',
          direction: 'in',
          docType: 'opening',
          docId: '00000000-0000-4000-8000-000000000045',
        },
      ],
    });
    expect([200, 201], JSON.stringify(opening.body)).toContain(opening.status);
    return { branchId: defaults.branchId as string, warehouseId: defaults.warehouseId as string, itemId };
  };

  // ══════════════════ المستأجر A — المسار الأساسي والحراس ══════════════════
  let A!: Client;
  let branchA = '';
  let warehouseA = '';
  let itemA = '';

  const sale = async (qty: string, taxRate: string) => {
    const response = await A.post('/sales/invoices', {
      branchId: branchA,
      warehouseId: warehouseA,
      cashCustomerName: 'عميل نقدي',
      autoPost: true,
      lines: [{ itemId: itemA, quantity: qty, unitPrice: '100.0000', taxRate }],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return data(response.body) as { id: string; taxTotal: string };
  };

  beforeAll(async () => {
    ctxA = await createTestApp('r45-tax-a');
    actorA = await createActor(ctxA, {
      tenantCode: 'r45-tax-a',
      email: 'owner@r45a.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'inventory.view',
        'inventory.adjust',
        'sales.view',
        'sales.invoice.create',
        'sales.invoice.post',
        'sales.return.create',
        'sales.adjustment.create',
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'parties.view',
        'parties.manage',
        'reporting.view',
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
        'organization.postingprofile.manage',
      ],
    });
    clerkA = await createActor(ctxA, {
      tenantId: actorA.tenantId,
      tenantCode: 'r45-tax-a',
      email: 'clerk@r45a.test',
      permissions: ['reporting.view', 'accounting.period.view'],
    });
    const setup = await provision(ctxA, actorA, 'R45A');
    branchA = setup.branchId;
    warehouseA = setup.warehouseId;
    itemA = setup.itemId;
    A = clientFor(ctxA, actorA);
  }, 300_000);

  afterAll(async () => {
    await ctxA?.close();
    await ctxB?.close();
  });

  let filedAId = '';

  it('AC2+AC3: التصنيف الصحيح ثم التقديم يجمّد ويوصّل ويقفل', async () => {
    // تجزئة الشهر: خاضع 100 (ضريبة 15) + معفى/صفرية 40 (0) + مردود 10 (ضريبة 1.5)
    //   + إشعار دائن 11.5 على الفاتورة الخاضعة (= 10 وعاء + 1.5 ضريبة).
    const taxed = await sale('1', '15');
    const zeroSale = await A.post('/sales/invoices', {
      branchId: branchA,
      warehouseId: warehouseA,
      cashCustomerName: 'عميل معفى',
      autoPost: true,
      lines: [{ itemId: itemA, quantity: '1', unitPrice: '40.0000', taxRate: '0' }],
    });
    expect(zeroSale.status, JSON.stringify(zeroSale.body)).toBe(201);
    const returned = await A.post(`/sales/invoices/${taxed.id}/return`, {
      branchId: branchA,
      warehouseId: warehouseA,
      cashCustomerName: 'عميل نقدي',
      autoPost: true,
      lines: [{ itemId: itemA, quantity: '1', unitPrice: '10.0000', taxRate: '15' }],
    });
    expect(returned.status, JSON.stringify(returned.body)).toBe(201);
    const note = await A.post(`/sales/invoices/${taxed.id}/adjustment-notes`, {
      branchId: branchA,
      kind: 'credit',
      reason: 'خصم عيب',
      amount: '11.5000',
    });
    expect(note.status, JSON.stringify(note.body)).toBe(201);
    const notePosted = await A.post(`/sales/adjustment-notes/${data(note.body).id as string}/post`, {});
    expect(notePosted.status, JSON.stringify(notePosted.body)).toBe(201);

    const report = await vatReport(A, CURRENT);
    // حساب مستقل: خاضع 100 − مردود 10 − إشعار دائن 10 = 80 · الضريبة 15 − 1.5 − 1.5 = 12.00
    expect(bucket(report, 'المبيعات الخاضعة للنسبة الأساسية')?.net, 'AC2: الوعاء بعد المردود والإشعار').toBe('80.00');
    expect(bucket(report, 'المبيعات الخاضعة للنسبة الأساسية')?.vat).toBe('12.00');
    expect(bucket(report, 'المبيعات المعفاة')?.net).toBe('40.00');
    expect(netOf(report), 'صافي الإقرار قبل التقديم = 12.00').toBeCloseTo(12, 2);
    expect(await glVatBalance(ctxA, actorA, '2222001'), 'AC3 قبل التقديم: الرصيد = الصافي').toBeCloseTo(12, 2);

    const filed = await A.post('/tax/filings', { from: CURRENT.from, to: CURRENT.to });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    const body = data(filed.body);
    filedAId = String(body.id);
    expect(Number(body.netVat)).toBeCloseTo(12, 2);
    expect(body.journalEntryId, 'صافي غير صفر ⇒ قيد تسوية').toBeTruthy();
    expect((body.closedPeriodIds as string[]).length).toBeGreaterThan(0);

    const stored = await filingSnapshot(ctxA, actorA, filedAId);
    expect(stored).not.toBeNull();
    expect(stored!.netVat).toBeCloseTo(12, 2);
    expect(stored!.snapshotRows.length, 'لقطة البنود محفوظة').toBeGreaterThanOrEqual(5);

    const legs = await journalLegs(ctxA, actorA, String(body.journalEntryId));
    const vat = legs.find((row) => row.code === '2222001');
    const payable = legs.find((row) => row.code === '2222003');
    expect(vat, 'قيد التسوية يدين 2222001').toBeTruthy();
    expect(Number(vat!.debit)).toBeCloseTo(12, 2);
    expect(payable, 'حساب «ضريبة مستحقة الدفع» 2222003 يُنشأ عند أول تسوية').toBeTruthy();
    expect(Number(payable!.credit)).toBeCloseTo(12, 2);

    expect(await glVatBalance(ctxA, actorA, '2222001'), 'AC3 بعد التقديم: 2222001 = 0').toBeCloseTo(0, 2);
    expect(await glVatBalance(ctxA, actorA, '2222003'), 'ذمة الضريبة = الصافي').toBeCloseTo(12, 2);
  }, 240_000);

  it('AC1: تقرير ما بعد التقديم يطابق اللقطة حرفاً بحرف ثم أي مستند داخل الفترة يُرفض', async () => {
    const rerun = await vatReport(A, CURRENT);
    const stored = await filingSnapshot(ctxA, actorA, filedAId);
    expect(stored).not.toBeNull();
    // مقارنة مستقلة عن ترتيب مفاتيح jsonb (يُعاد ترتيبها عند القراءة) — المضمون سطرًا
    // سطرًا هو المطلوب: لو كان قيد التسوية حدثاً ضريياً (is_vat) لظهر ضمن «سندات
    // الصرف» وخالفت إعادة التشغيل اللقطة.
    const stable = (rows: Array<Record<string, string>>) =>
      JSON.stringify(rows.map((row) => Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))));
    expect(stable(rerun.rows), 'AC1: إعادة التشغيل = اللقطة (ويدل على is_vat=false)').toBe(stable(stored!.snapshotRows));

    // مستند لاحق بتاريخ داخل الفترة المقدَّمة (فاتورة اليوم!) → يُرفض
    const late = await A.post('/sales/invoices', {
      branchId: branchA,
      warehouseId: warehouseA,
      cashCustomerName: 'عميل متأخر',
      autoPost: true,
      lines: [{ itemId: itemA, quantity: '1', unitPrice: '100.0000', taxRate: '15' }],
    });
    if (late.status === 201) {
      const posted = await A.post(`/sales/invoices/${data(late.body).id as string}/post`, {});
      expect(posted.status, 'POST لفاتورة داخل فترة مُقفلة').toBe(409);
      expect(posted.body.code).toBe('FISCAL_PERIOD_CLOSED');
    } else {
      expect(late.status, 'autoPost داخل فترة مُقفلة').toBe(409);
      expect(late.body.code).toBe('FISCAL_PERIOD_CLOSED');
    }

    // قيد مؤرَّخ داخل الفترة المقدَّمة → يُرفض (وثيقة تاريخها داخلها)
    const cash = await accountByCode(ctxA, actorA, '1211001');
    const revenue = await accountByCode(ctxA, actorA, '4100001');
    expect(cash, 'حساب الصندوق من تهيئة المستأجر').not.toBeNull();
    expect(revenue, 'حساب الإيراد من تهيئة المستأجر').not.toBeNull();
    const lateJournal = await A.post('/journal-entries', {
      date: `${CURRENT.from.slice(0, 8)}15`,
      description: 'قيد داخل فترة مقدَّمة',
      lines: [
        { accountId: cash!.id, debit: '1.0000', credit: '0' },
        { accountId: revenue!.id, debit: '0', credit: '1.0000' },
      ],
    });
    expect(lateJournal.status, 'قيد بتاريخ داخل الفترة').toBe(409);
    expect(lateJournal.body.code).toBe('FISCAL_PERIOD_CLOSED');

    // إعادة فتح الفترة المقدَّمة → ممنوعة
    const list = await A.get('/tax/filings');
    const rows = (Array.isArray(data(list.body)) ? data(list.body) : (data(list.body).rows as unknown)) as Array<
      Record<string, unknown>
    >;
    const current = rows.find((row) => String(row.periodFrom ?? row.period_from ?? '').startsWith(CURRENT.month));
    expect(current, 'الإقرار في القائمة').toBeTruthy();
    const reopen = await A.post(`/fiscal-periods/${String(current!.closedPeriodIds?.[0] ?? current!.closed_period_ids?.[0])}/reopen`, {
      reason: 'محاولة بعد إقرار',
    });
    expect(reopen.status, 'حارس إعادة الفتح').toBe(409);
    expect(reopen.body.code).toBe('VAT_FILING_EXISTS');
  }, 180_000);

  it('حارس التكرار: نفس النطاق المقدَّم → 409', async () => {
    const same = await A.post('/tax/filings', { from: CURRENT.from, to: CURRENT.to });
    expect(same.status).toBe(409);
    expect(same.body.code).toBe('VAT_FILING_ALREADY_FILED');
  });

  it('صافي = 0: تجميد وإقفال بلا قيد', async () => {
    const empty = await vatReport(A, NEXT);
    expect(netOf(empty), 'لا وثائق في الشهر التالي').toBeCloseTo(0, 2);
    const filed = await A.post('/tax/filings', { from: NEXT.from, to: NEXT.to });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    const body = data(filed.body);
    expect(Number(body.netVat)).toBeCloseTo(0, 2);
    expect(body.journalEntryId, 'لا قيد عند صفر').toBeNull();
    expect((body.closedPeriodIds as string[]).length).toBeGreaterThan(0);
    expect(await filingCount(ctxA, actorA)).toBe(2);
  }, 120_000);

  it('حارس التداخل: نطاق يضمّ شهرين مقدَّمين → 409', async () => {
    const overlap = await A.post('/tax/filings', { from: CURRENT.from, to: NEXT.to });
    expect(overlap.status, 'شهر ضمن نطاق أقدم منه = تسوية مزدوجة محظورة').toBe(409);
    expect(overlap.body.code).toBe('VAT_FILING_ALREADY_FILED');
  });

  it('الصلاحيات والقائمة: بلا accounting.period.close → 403 · قارئ يرى القائمة والتفاصيل', async () => {
    const clerk = clientFor(ctxA, clerkA);
    const forbidden = await clerk.post('/tax/filings', { from: CURRENT.from, to: CURRENT.to });
    expect(forbidden.status).toBe(403);

    const list = await clerk.get('/tax/filings');
    expect(list.status).toBe(200);
    const rows = (Array.isArray(data(list.body)) ? data(list.body) : (data(list.body).rows as unknown)) as Array<
      Record<string, unknown>
    >;
    expect(rows.length).toBe(2);

    const detail = await clerk.get(`/tax/filings/${String(rows[0].id)}`);
    expect(detail.status).toBe(200);
    const snapshot = data(detail.body).snapshot as { rows: Array<unknown> };
    expect(snapshot.rows.length).toBeGreaterThanOrEqual(5);
  });

  // ══════════════════ المستأجر B — الحالة السالبة (ضريبة مستردة) ══════════════
  it('AC3 بالسالب: مشتريات خاضعة تفوق → تسوية على «ضريبة مستردة» 1280001', async () => {
    ctxB = await createTestApp('r45-tax-b');
    actorB = await createActor(ctxB, {
      tenantCode: 'r45-tax-b',
      email: 'owner@r45b.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'catalog.item.view',
        'catalog.item.manage',
        'catalog.category.manage',
        'catalog.unit.manage',
        'inventory.view',
        'inventory.adjust',
        'purchase.view',
        'purchase.invoice.create',
        'purchase.invoice.post',
        'parties.view',
        'parties.manage',
        'reporting.view',
        'accounting.account.view',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.period.reopen',
      ],
    });
    const client = clientFor(ctxB, actorB);
    const setup = await provision(ctxB, actorB, 'R45B');
    const supplier = await client.post('/parties', { kind: 'supplier', name: 'مورّد الإقرار' });
    expect(supplier.status).toBe(201);

    const draft = await client.post('/purchase-invoices', {
      branchId: setup.branchId,
      warehouseId: setup.warehouseId,
      partyId: data(supplier.body).id,
      lines: [{ itemId: setup.itemId, quantity: '10', unitPrice: '100.0000', taxRate: '15' }],
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const posted = await client.post(`/purchase-invoices/${data(draft.body).id as string}/post`, {});
    expect(posted.status, JSON.stringify(posted.body)).toBe(201);

    const report = await vatReport(client, CURRENT);
    expect(netOf(report), 'صافي = ضريبة المدخلات 150 سالباً').toBeCloseTo(-150, 2);
    expect(await glVatBalance(ctxB, actorB, '2222001'), '2222001 مدين 150').toBeCloseTo(-150, 2);

    const filed = await client.post('/tax/filings', { from: CURRENT.from, to: CURRENT.to });
    expect(filed.status, JSON.stringify(filed.body)).toBe(201);
    const body = data(filed.body);
    expect(Number(body.netVat)).toBeCloseTo(-150, 2);
    expect(body.journalEntryId).toBeTruthy();

    const legs = await journalLegs(ctxB, actorB, String(body.journalEntryId));
    const vat = legs.find((row) => row.code === '2222001');
    const refund = legs.find((row) => row.code === '1280001');
    expect(vat, 'التسوية تدائن 2222001 في حالة الاسترداد').toBeTruthy();
    expect(Number(vat!.credit)).toBeCloseTo(150, 2);
    expect(refund, 'حساب «ضريبة مستردة» 1280001 يُنشأ عند أول استرداد').toBeTruthy();
    expect(Number(refund!.debit)).toBeCloseTo(150, 2);

    expect(await glVatBalance(ctxB, actorB, '2222001')).toBeCloseTo(0, 2);
    const refundable = await accountByCode(ctxB, actorB, '1280001');
    expect(refundable).not.toBeNull();
    const refundBalance = await withOwnerClient(ctxB.db.ownerUrl, async (dbClient) => {
      const result = await dbClient.query(
        `SELECT coalesce(sum(l.debit - l.credit), 0)::text AS balance
           FROM journal_entry_lines l JOIN journal_entries e ON e.id = l.entry_id
          WHERE l.tenant_id = $1 AND l.account_id = $2 AND e.status = 'posted'`,
        [actorB.tenantId, refundable!.id],
      );
      return Number((result.rows[0] as { balance: string }).balance);
    });
    expect(refundBalance, 'ضريبة مستردة = 150').toBeCloseTo(150, 2);
  }, 300_000);
});
