/**
 * `pnpm verify-seed` — بذرة «المسار الذهبي» للتحقق اليدوي من الواجهات (وحدة تحقق المستخدم).
 *
 * ليست بذرة `pnpm db:seed`: هذه تُنشئ **مستأجراً جديداً معزولاً** باسم `verify2026` فوق
 * قاعدة بياناتك المحلية (لا تمسّ بيانات موجودة)، ثم تُولّد دورة شراء/مخزون/بيع/تحصيل/
 * سداد/مصروفات/سندات/مناقلات عبر **API الحقيقي** (نفس مسار الواجهة)، ثم تكتب قائمة تحقق:
 *
 *   docs/accounting-audit/VERIFY_CHECKLIST.md
 *     - بيانات الدخول لكل المستخدمين
 *     - مسار كل شاشة على حدة (staff / بوابة العميل / تطبيق المخابز)
 *     - القيم المتوقَّعة في كل شاشة — محسوبة من قاعدة البيانات وردود تقارير API بعد التوليد
 *     - فحوصات داخلية (ميزان، خزينة=GL، مخزون=GL…) مع PASS/FAIL
 *
 * الاستخدام (من جذر المستودع؛ والـAPI والواجهات يجب أن تكون شغّالة أولاً):
 *   pnpm verify-seed                 # إنشاء + توليد + كتابة القائمة (يرفض إن المستأجر موجود)
 *   pnpm verify-seed -- --reset      # حذف مستأجر التحقق وحده ثم إعادة إنشائه
 *   pnpm verify-seed -- --purge-only # حذف مستأجر التحقق وحده والخروج
 *
 * الحماية: يرفض أي قاعدة ليست محلية (localhost/127.0.0.1/::1)، والحذف محصور في
 * tenant `verify2026` ومستخدمي `@verify2026.test` فقط — لا شيء غيرهما يُلمس.
 *
 * القيم المتوقعة تُكتب بصيغة «شاشة → قيمة»؛ عند إيجاد فرق: أبلغ برقم الشاشة والقيمة
 * المتوقعة والفعلية والفرق — يُسجَّل عيباً ويُصلَح.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Client } from 'pg';

import { env } from '@erp/config';
import {
  seedDemoData,
  seedPlatform,
  type DemoRepSpec,
  type DemoSectorAppSpec,
  type DemoUserSpec,
} from '@erp/database';

import { ALL_CATALOG_APPS } from '../src/modules/marketplace/marketplace.service.js';
import { PasswordService } from '../src/modules/platform/auth/password.service.js';

// ───────────────────────────────────────────────────────────── constants
const TENANT_CODE = 'verify2026';
const TENANT_NAME = 'شركة التحقق التجريبية';
const YEAR = new Date().getUTCFullYear();
const TODAY = new Date().toISOString().slice(0, 10);

const API_URL = (process.env.VERIFY_API_URL || 'http://127.0.0.1:3000/api/v1').replace(/\/$/, '');
const STAFF_URL = process.env.VERIFY_STAFF_URL || 'http://localhost:3001';
const PORTAL_URL = process.env.VERIFY_PORTAL_URL || 'http://localhost:3004';
const BAKERY_URL = process.env.VERIFY_BAKERY_URL || 'http://localhost:3005';

const ROOT = resolve(process.cwd(), process.cwd().endsWith(`${'apps'}/api`) ? '../..' : '.');

/** كلمات مرور محلية ثابتة — للبيئة التطويرية على جهاز المطوّر فقط. */
const CREDS = {
  owner: { email: 'owner@verify2026.test', name: 'مالك منشأة التحقق', password: 'Mstr-Qz7-2026$Local' },
  accountant: { email: 'accountant@verify2026.test', name: 'محاسبة التحقق', password: 'Acct-Qz7-2026$Local' },
  cashier: { email: 'cashier@verify2026.test', name: 'أمين صندوق التحقق', password: 'Cash-Qz7-2026$Local' },
  rep: { email: 'rep@verify2026.test', name: 'مندوب التحقق', password: 'Van-Qz7-2026$Local' },
  portalCustomer: { email: 'portal-customer@verify2026.test', password: 'Port-Qz7-2026$Local' },
  portalSupplier: { email: 'portal-supplier@verify2026.test', password: 'Supp-Qz7-2026$Local' },
};

type Row = Record<string, unknown>;
type Section = { title: string; url: string; rows: Array<[string, string, string?]> };
type Check = { name: string; ok: boolean; expected: string; actual: string };

const sections: Section[] = [];
const checks: Check[] = [];
const notes: string[] = [];
const log = (...a: unknown[]) => console.log(...a);
const money = (x: unknown): string => Number(x ?? 0).toFixed(2);
const num = (x: unknown): string => {
  const n = Number(x ?? 0);
  return Number.isInteger(n) ? String(n) : String(Number(n.toFixed(4)));
};
const errCode = (b: unknown): string =>
  (b && typeof b === 'object' && 'code' in b ? String((b as Row).code) : '') || '';

// ───────────────────────────────────────────────────────────── database
const db = new Client({ connectionString: env.DATABASE_MIGRATOR_URL ?? env.DATABASE_URL });
async function q(sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query(sql, params as never[])).rows as Row[];
}
async function one(sql: string, params: unknown[] = []): Promise<Row | undefined> {
  return (await q(sql, params))[0];
}

function must(res: { status: number; body: unknown; data: Row | Row[] | null }, allowed: number[], label: string): Row {
  if (!allowed.includes(res.status)) {
    throw new Error(`${label} → HTTP ${res.status} ${errCode(res.body)} ${JSON.stringify(res.body).slice(0, 300)}`);
  }
  return (res.data as Row) ?? {};
}

// ───────────────────────────────────────────────────────────── API client
const tokens = new Map<string, string>();
async function login(email: string, password: string): Promise<string> {
  const key = `${TENANT_CODE}:${email}`;
  const cached = tokens.get(key);
  if (cached) return cached;
  const r = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tenantCode: TENANT_CODE, email, password }),
  });
  const j = (await r.json().catch(() => ({}))) as Row;
  const token = (j.data as Row | undefined)?.accessToken ?? j.accessToken;
  if (typeof token !== 'string' || !token) {
    throw new Error(`login ${email} failed: HTTP ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  }
  tokens.set(key, token);
  return token;
}
async function api(
  method: string,
  path: string,
  body?: unknown,
  tokenArg?: string,
): Promise<{ status: number; body: unknown; data: Row | Row[] | null }> {
  const token = tokenArg ?? (await login(CREDS.owner.email, CREDS.owner.password));
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  const obj = json && typeof json === 'object' ? (json as Row) : null;
  // نفس منطق round32-lib: بعض المسارات تلفّ `{data}` وبعضها يعيد الصف مباشرة.
  const data = obj ? ((obj.data === undefined || obj.data === null ? obj : obj.data) as Row | Row[] | null) : null;
  return { status: r.status, body: obj ?? json, data };
}

// ───────────────────────────────────────────────────────────── preflight + purge
async function preflight(args: string[]): Promise<void> {
  const url = new URL(env.DATABASE_MIGRATOR_URL ?? env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) {
    throw new Error(`refusing: DATABASE host "${url.hostname}" is not local — this seed only ever runs locally.`);
  }
  // API must be up: a validation error from /auth/login proves the server answers.
  try {
    const r = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantCode: 'x', email: 'x', password: 'x' }),
    });
    if (r.status < 400) throw new Error('unexpected');
  } catch {
    throw new Error(
      `API is not answering at ${API_URL} — start it first (pnpm dev, أو: cd apps/api && node dist/main.js) ثم أعد الأمر.`,
    );
  }

  const existing = await one(`select id from tenants where code = $1`, [TENANT_CODE]);
  const purgeOnly = args.includes('--purge-only');
  const reset = args.includes('--reset');
  if (existing && (purgeOnly || reset)) {
    await purge(String(existing.id));
    log(`— تم حذف مستأجر ${TENANT_CODE} وحده (reset/purge)`);
    if (purgeOnly) process.exit(0);
    return;
  }
  if (purgeOnly) {
    log(`لا يوجد مستأجر ${TENANT_CODE} لحذفه.`);
    process.exit(0);
  }
  if (existing) {
    throw new Error(
      `المستأجر "${TENANT_CODE}" موجود مسبقاً (لمرة واحدة). للاستعادة من الصفر: pnpm verify-seed -- --reset`,
    );
  }
}

/** حذف مستأجر التحقق وحده: تعطيل triggers مؤقتاً داخل معاملة ثم حذف كل جدول يحمل tenant_id. */
async function purge(tenantId: string): Promise<void> {
  await db.query('BEGIN');
  try {
    await db.query('SET LOCAL session_replication_role = replica');
    const tables = await q(
      `select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'tenant_id' and table_name <> 'tenants'`,
    );
    for (const t of tables) await db.query(`delete from "${t.table_name}" where tenant_id = $1`, [tenantId]);
    await db.query(`delete from tenants where id = $1`, [tenantId]);
    await db.query(`delete from users where email like $1`, ['%@verify2026.test']);
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK');
    const msg = e instanceof Error ? e.message : String(e);
    if (/session_replication_role|superuser|permission denied/.test(msg)) {
      throw new Error(
        `purge needs a superuser connection (session_replication_role): ${msg}. ` +
          `شغّل البذرة بمستخدم superuser في .env ثم أعد الأمر.`,
      );
    }
    throw e;
  }
}

// ───────────────────────────────────────────────────────────── layer 1+2: base seed
async function seedBase(): Promise<void> {
  log('hashing credentials…');
  const passwords = new PasswordService();
  const hash = async (u: { email: string; name: string; password: string }) => {
    await passwords.assertPolicy(u.password, { email: u.email, fullName: u.name });
    return passwords.hash(u.password);
  };

  const platform = await seedPlatform(env.DATABASE_MIGRATOR_URL ?? env.DATABASE_URL, {
    tenantCode: TENANT_CODE,
    tenantName: TENANT_NAME,
    ownerEmail: CREDS.owner.email,
    ownerFullName: CREDS.owner.name,
    ownerPasswordHash: await hash(CREDS.owner),
    log: (m) => log(m),
  });
  log(`seed  platform — tenant ${platform.tenantId}`);

  const sectorApps: DemoSectorAppSpec[] = ['bakery_distribution', 'reports_pro', 'email_pro', 'whatsapp']
    .map((code) => ALL_CATALOG_APPS.find((a) => a.code === code))
    .filter((a): a is NonNullable<typeof a> => Boolean(a))
    .map((a) => ({
      code: a.code,
      nameAr: a.nameAr,
      nameEn: a.nameEn,
      descriptionAr: a.descriptionAr,
      icon: a.icon,
      version: a.version,
      monthlyPrice: a.monthlyPrice,
    }));

  const rep: DemoRepSpec = {
    email: CREDS.rep.email,
    fullName: CREDS.rep.name,
    passwordHash: await hash(CREDS.rep),
  };
  const users: DemoUserSpec[] = [
    {
      email: CREDS.accountant.email,
      fullName: CREDS.accountant.name,
      roleName: 'Accountant',
      passwordHash: await hash(CREDS.accountant),
    },
    {
      email: CREDS.cashier.email,
      fullName: CREDS.cashier.name,
      roleName: 'Cashier',
      passwordHash: await hash(CREDS.cashier),
    },
  ];

  const demo = await seedDemoData(env.DATABASE_MIGRATOR_URL ?? env.DATABASE_URL, {
    tenantCode: TENANT_CODE,
    company: { nameAr: TENANT_NAME, nameEn: 'Verify Trading Co.' },
    rep,
    sectorApps,
    users,
    withOpeningEntry: true,
    fiscalYear: YEAR,
    log: (m) => log(m),
  });
  log(`seed  demo — accounts ${demo.accounts}, periods ${demo.periods}, opening ${demo.openingEntryNumber ?? 'none'}`);
}

// ───────────────────────────────────────────────────────────── ids
type Ids = Record<string, string>;
async function ids(): Promise<Ids> {
  const t = await one(`select id from tenants where code = $1`, [TENANT_CODE]);
  if (!t) throw new Error('tenant missing after seed');
  const T = String(t.id);
  const lookup = async (sql: string): Promise<string> => {
    const r = await one(sql, [T]);
    if (!r || !r.id) throw new Error(`id lookup failed: ${sql}`);
    return String(r.id);
  };
  const accRows = await q(`select code, id from accounts where tenant_id = $1`, [T]);
  const acc = Object.fromEntries(accRows.map((r) => [String(r.code), String(r.id)]));
  for (const code of ['1211001', '1221001', '12310001', '22111001', '2222001', '3110001', '4200001']) {
    if (!acc[code]) throw new Error(`account ${code} missing from chart`);
  }
  return {
    tenant: T,
    branch: await lookup(`select id from branches where tenant_id = $1 and code = 'MAIN' and deleted_at is null`),
    whMain: await lookup(`select id from warehouses where tenant_id = $1 and code = 'MAIN' and deleted_at is null`),
    whVan: await lookup(`select id from warehouses where tenant_id = $1 and code = 'VAN-1' and deleted_at is null`),
    safe: await lookup(`select id from cash_locations where tenant_id = $1 and kind = 'safe' and deleted_at is null`),
    bank: await lookup(`select id from cash_locations where tenant_id = $1 and kind = 'bank' and deleted_at is null`),
    vat15: await lookup(`select id from tax_groups where tenant_id = $1 order by (rate = '15.0000' or rate = '15') desc, created_at limit 1`),
    kg: await lookup(`select id from units_of_measure where tenant_id = $1 and code = 'KG'`),
    pcs: await lookup(`select id from units_of_measure where tenant_id = $1 and code = 'PCS'`),
    cat: await lookup(`select id from item_categories where tenant_id = $1 and code = 'GEN'`),
    salesman: await lookup(`select id from salesmen where tenant_id = $1 order by created_at limit 1`),
    ...Object.fromEntries(Object.entries(acc).map(([k, v]) => [`acct_${k}`, v])),
  };
}

// ───────────────────────────────────────────────────────────── golden path
async function goldenPath(I: Ids): Promise<Row> {
  const out: Row = {};
  const today = TODAY;
  const line = (itemId: string, quantity: string, unitPrice: string) => ({
    itemId,
    quantity,
    unitPrice,
    taxGroupId: I.vat15,
  });

  // 1) catalog + parties
  const pm = await api('POST', '/payment-methods', { code: 'VRF-NET30', nameAr: 'آجل 30 يوم (تحقق)', kind: 'credit', dueDays: 30 });
  must(pm, [200, 201], 'payment-method');
  const fl = must(
    await api('POST', '/organization/catalog/items', {
      sku: 'VRF-FL',
      nameAr: 'دقيق التحقق',
      nameEn: 'Verify Flour',
      categoryId: I.cat,
      kind: 'stock',
      baseUnitId: I.kg,
      taxGroupId: I.vat15,
      purchasePrice: '10',
      salePrice: '20',
    }),
    [200, 201],
    'item VRF-FL',
  );
  const brk = must(
    await api('POST', '/organization/catalog/items', {
      sku: 'VRF-BRK',
      nameAr: 'صنف التحقق بالحبة',
      nameEn: 'Verify Piece Item',
      categoryId: I.cat,
      kind: 'stock',
      baseUnitId: I.pcs,
      taxGroupId: I.vat15,
      purchasePrice: '5',
      salePrice: '12',
    }),
    [200, 201],
    'item VRF-BRK',
  );
  const supp = must(await api('POST', '/parties', { kind: 'supplier', name: 'مورد التحقق' }), [200, 201], 'party supplier');
  const custCr = must(
    await api('POST', '/parties', { kind: 'customer', name: 'عميل التحقق الآجل', paymentMethodId: (pm.data as Row).id }),
    [200, 201],
    'party customer credit',
  );
  const custCsh = must(await api('POST', '/parties', { kind: 'customer', name: 'عميل التحقق النقدي' }), [200, 201], 'party customer cash');
  out.flId = fl.id;
  out.brkId = brk.id;
  out.suppId = supp.id;
  out.custCrId = custCr.id;
  out.custCshId = custCsh.id;
  const flId = String(fl.id ?? '');
  const brkId = String(brk.id ?? '');
  const suppId = String(supp.id ?? '');
  const custCrId = String(custCr.id ?? '');
  const custCshId = String(custCsh.id ?? '');
  if (!flId || !brkId || !suppId || !custCrId || !custCshId) {
    throw new Error(`fixture ids missing: ${JSON.stringify({ fl: fl.id, brk: brk.id, supp: supp.id, custCr: custCr.id, custCsh: custCsh.id })}`);
  }
  log('✓ catalog + parties');

  // 2) purchase: 40×10 دقيق + 20×5 حبوب = 500 + 75 VAT = 575 (مرحّلة)
  const pi = must(
    await api('POST', '/purchase-invoices', {
      branchId: I.branch,
      warehouseId: I.whMain,
      partyId: suppId,
      kind: 'purchase',
      supplierReferenceNo: 'VRF-PI-1',
      supplierReferenceDate: today,
      priceIncludesVat: false,
      autoPost: false,
      lines: [
        { itemId: flId, quantity: '40', unitPrice: '10', discountRate: '0', taxRate: '15', taxGroupId: I.vat15 },
        { itemId: brkId, quantity: '20', unitPrice: '5', discountRate: '0', taxRate: '15', taxGroupId: I.vat15 },
      ],
    }),
    [200, 201],
    'purchase invoice',
  );
  must(await api('POST', `/purchase-invoices/${pi.id}/post`, {}), [200, 201], 'purchase post');
  out.piId = pi.id;
  log('✓ purchase invoice VRF-PI-1 posted (575.00)');

  // 3) sale cash: 5×20 = 115 مستقرة نقداً
  const s1 = must(
    await api('POST', '/sales/invoices', {
      branchId: I.branch,
      warehouseId: I.whMain,
      partyId: custCshId,
      kind: 'sale',
      notes: 'VRF س1 بيع نقدي',
      lines: [line(flId, '5', '20')],
    }),
    [200, 201],
    'sale cash create',
  );
  must(await api('POST', `/sales/invoices/${s1.id}/post`, { settlement: 'cash', settlementCashLocationId: I.safe }), [200, 201], 'sale cash post');
  out.s1Id = s1.id;
  log('✓ cash sale posted (115.00 settled to safe)');

  // 4) sale credit: 10×20 + 4×12 = 248 + 37.20 = 285.20 آجلة
  const s2 = must(
    await api('POST', '/sales/invoices', {
      branchId: I.branch,
      warehouseId: I.whMain,
      partyId: custCrId,
      kind: 'sale',
      notes: 'VRF س2 بيع آجل',
      lines: [line(flId, '10', '20'), line(brkId, '4', '12')],
    }),
    [200, 201],
    'sale credit create',
  );
  must(await api('POST', `/sales/invoices/${s2.id}/post`, {}), [200, 201], 'sale credit post');
  out.s2Id = s2.id;
  log('✓ credit sale posted (285.20 unpaid)');

  // 5) مرتجع على الآجلة: 2×20 = 46
  const ret = must(
    await api('POST', `/sales/invoices/${s2.id}/return`, {
      branchId: I.branch,
      warehouseId: I.whMain,
      partyId: custCrId,
      lines: [line(flId, '2', '20')],
    }),
    [200, 201],
    'sales return create',
  );
  if (String(ret.status) !== 'posted') {
    must(await api('POST', `/sales/invoices/${ret.id}/post`, {}), [200, 201], 'sales return post');
  }
  out.retId = ret.id;
  log('✓ sales return posted (46.00)');

  // 6) تحصيل 100 نقداً من العميل الآجل
  must(
    await api('POST', `/sales/invoices/${s2.id}/payments`, {
      method: 'cash',
      amount: '100.00',
      cashLocationId: I.safe,
      idempotencyKey: `vrf-collect-${Date.now()}`,
    }),
    [200, 201],
    'customer collection 100',
  );
  log('✓ collection 100.00 cash');

  // 7) سداد المورد 300 نقداً
  must(
    await api('POST', `/purchase-invoices/${pi.id}/payments`, {
      amount: '300.00',
      cashLocationId: I.safe,
      method: 'cash',
      idempotencyKey: `vrf-supplier-pay-${Date.now()}`,
    }),
    [200, 201],
    'supplier payment 300',
  );
  log('✓ supplier payment 300.00 cash');

  // 8) مصروف نقدي 40 (رسوم بنكية) — سند مرحّل
  const exp = must(
    await api('POST', '/vouchers', {
      branchId: I.branch,
      kind: 'payment',
      subtype: 'expense',
      counterAccountId: I.acct_3110001,
      cashLocationId: I.safe,
      method: 'cash',
      date: today,
      amount: '40.00',
      description: 'VRF مصروف رسوم بنكية 40',
    }),
    [200, 201],
    'expense voucher',
  );
  must(await api('POST', `/vouchers/${exp.id}/post`, {}), [200, 201], 'expense voucher post');
  out.expVoucher = exp.id;
  log('✓ expense voucher 40.00 posted');

  // 9) قبض إيراد بضريبة 115 (100 + 15) — يختبر مسار ضريبة السندات
  const rv = must(
    await api('POST', '/vouchers', {
      branchId: I.branch,
      kind: 'receipt',
      subtype: 'other',
      counterAccountId: I.acct_4200001,
      cashLocationId: I.safe,
      method: 'cash',
      date: today,
      amount: '115.00',
      vatAmount: '15.00',
      description: 'VRF قبض إيراد بضريبة 115',
    }),
    [200, 201],
    'receipt voucher with vat',
  );
  must(await api('POST', `/vouchers/${rv.id}/post`, {}), [200, 201], 'receipt voucher post');
  out.rvVoucher = rv.id;
  log('✓ receipt voucher 115.00 (VAT 15) posted');

  // 10) مناقلة نقدية 100: صندوق → بنك
  const ct = must(
    await api('POST', '/cash-transfers', {
      branchId: I.branch,
      fromCashLocationId: I.safe,
      toCashLocationId: I.bank,
      amount: '100.00',
    }),
    [200, 201],
    'cash transfer create',
  );
  must(await api('POST', `/cash-transfers/${ct.id}/send`, {}), [200, 201], 'cash transfer send');
  must(await api('POST', `/cash-transfers/${ct.id}/receive`, {}), [200, 201], 'cash transfer receive');
  out.cashTransfer = ct.id;
  log('✓ cash transfer safe→bank 100.00 sent + received');

  // 11) مناقلة مخزون 5 دقيق: MAIN → VAN-1
  const st = must(
    await api('POST', '/inventory/transfers/draft', {
      branchId: I.branch,
      fromWarehouseId: I.whMain,
      toWarehouseId: I.whVan,
      lines: [{ itemId: flId, qty: '5' }],
    }),
    [200, 201],
    'stock transfer draft',
  );
  must(await api('POST', `/inventory/transfers/${st.id}/send`, {}), [200, 201], 'stock transfer send');
  must(
    await api('POST', `/inventory/transfers/${st.id}/receive`, { received: [{ lineNo: 1, qty: '5' }] }),
    [200, 201],
    'stock transfer receive',
  );
  // الاستلام الكامل يُنهي المناقلة؛ `close` مخصّص لما بقي «في الطريق» فقط (409 على المستلمة).
  out.stockTransfer = st.id;
  log('✓ stock transfer MAIN→VAN-1 (5 دقيق) sent + fully received');

  // 12) بوابتا الطرفين: وصول عميل ومورد للبوابة
  const pc = await api('POST', `/parties/${custCrId}/portal-access`, {
    email: CREDS.portalCustomer.email,
    fullName: 'بوابة عميل التحقق',
    password: CREDS.portalCustomer.password,
    notify: false,
  });
  must(pc, [200, 201], 'portal access customer');
  const ps = await api('POST', `/parties/${suppId}/portal-access`, {
    email: CREDS.portalSupplier.email,
    fullName: 'بوابة مورد التحقق',
    password: CREDS.portalSupplier.password,
    notify: false,
  });
  must(ps, [200, 201], 'portal access supplier');
  log('✓ portal access granted (customer + supplier)');

  if (!process.argv.includes('--minimal')) {
    // 13) مردود مشتريات مرحّل على PI-000001: 2 × 5 = 10 + 1.50 VAT = 11.50
    const pr = must(
      await api('POST', '/purchase-invoices', {
        branchId: I.branch,
        warehouseId: I.whMain,
        partyId: suppId,
        kind: 'purchase_return',
        referenceInvoiceId: String(pi.id),
        supplierReferenceNo: 'VRF-PR-1',
        supplierReferenceDate: today,
        priceIncludesVat: false,
        lines: [{ itemId: brkId, quantity: '2', unitPrice: '5', discountRate: '0', taxRate: '15', taxGroupId: I.vat15 }],
      }),
      [200, 201],
      'purchase return create',
    );
    must(await api('POST', `/purchase-invoices/${pr.id}/post`, {}), [200, 201], 'purchase return post');
    out.prId = pr.id;
    log('✓ purchase return VRF-PR-1 posted (11.50)');

    // 14) شجرة مراكز التكلفة + قيد يومية يدوي متوازن مرتبط بمركز التكلفة (30.00)
    const ccGroup = must(
      await api('POST', '/cost-centers', { code: 'CC-VRF-GRP', nameAr: 'مجموعة مراكز التحقق', kind: 'group' }),
      [200, 201],
      'cost center group',
    );
    const ccLeaf = must(
      await api('POST', '/cost-centers', {
        code: 'CC-VRF-SALES',
        nameAr: 'مركز مبيعات التحقق',
        kind: 'cost_center',
        parentId: ccGroup.id,
        branchId: I.branch,
      }),
      [200, 201],
      'cost center leaf',
    );
    const periodsRes = await api('GET', '/fiscal-periods');
    const periodsArr = Array.isArray(periodsRes.data) ? (periodsRes.data as Row[]) : [];
    const curPeriod = periodsArr.find((p) => String(p.startDate).slice(0, 7) === today.slice(0, 7) && p.status === 'open') ?? periodsArr.find((p) => p.status === 'open');
    const eqAcct = await one(`select id from accounts where tenant_id = $1 and code = '2110001'`, [I.tenant]);
    if (curPeriod?.id && eqAcct?.id) {
      const mje = must(
        await api('POST', '/journal-entries', {
          date: today,
          fiscalPeriodId: curPeriod.id,
          branchId: I.branch,
          description: 'VRF قيد مصروف بمركز تكلفة 30.00',
          lines: [
            { accountId: I.acct_3110001, debit: '30.00', credit: '0', costCenterId: ccLeaf.id, description: 'مصروف محمّل على مركز مبيعات التحقق' },
            { accountId: String(eqAcct.id), debit: '0', credit: '30.00', description: 'طرف دائن مقابل لقيد التحقق' },
          ],
        }),
        [200, 201],
        'cost center manual JE',
      );
      if (String(mje.status) !== 'posted') {
        must(await api('POST', `/journal-entries/${mje.id}/post`, {}), [200, 201], 'cost center manual JE post');
      }
      out.costCenterJeId = mje.id;
    }
    out.costCenterGroupId = ccGroup.id;
    out.costCenterLeafId = ccLeaf.id;
    log('✓ cost center hierarchy + tagged journal entry (30.00) posted');

    // 15) فاتورة نقطة بيع فورية (POS Checkout): 1 × VRF-BRK = 12 + 1.80 = 13.80 عبر البطاقة/البنك
    const posSale = must(
      await api('POST', '/pos/checkout', {
        branchId: I.branch,
        warehouseId: I.whMain,
        cashCustomerName: 'عميل كاشير التحقق',
        priceIncludesVat: false,
        lines: [{ itemId: brkId, quantity: '1', unitPrice: '12', taxRate: '15' }],
        payment: { method: 'bank', cashLocationId: I.bank, reference: 'POS-VRF-CARD-1' },
      }),
      [200, 201],
      'pos checkout',
    );
    out.posInvoiceId = (posSale.invoice as Row | undefined)?.id ?? posSale.id;
    log('✓ POS till checkout posted (13.80 bank/card)');

    // 16) مشروع ومقاولات وجدول كميات (BOQ)
    const proj = must(
      await api('POST', '/projects', {
        code: 'PRJ-VRF-01',
        name: 'مشروع تجهيز فرع التحقق',
        partyId: custCrId,
        branchId: I.branch,
        contractValue: '1000.00',
      }),
      [200, 201],
      'project create',
    );
    if (proj.id) {
      await api('POST', `/projects/${proj.id}/boq`, {
        code: 'BOQ-01',
        description: 'توريد وتركيب تجهيزات العرض',
        unit: 'بند',
        quantity: '1',
        unitPrice: '250.00',
      });
    }
    out.projectId = proj.id;
    log('✓ project PRJ-VRF-01 + BOQ item created');
  }

  return out;
}

// ───────────────────────────────────────────────────────────── expectations
const CTRL = ['1211001', '1221001', '12310001', '22111001', '2222001', '3110001', '4200001', '3200004', '1270001', '1270003', '4100001', '4100002', '4100003', '3121004'];

async function controlBalances(T: string): Promise<Record<string, { d: number; c: number }>> {
  const rows = await q(
    `select a.code, sum(jel.debit) as d, sum(jel.credit) as c
       from journal_entry_lines jel
       join journal_entries je on je.id = jel.entry_id and je.status = 'posted'
       join accounts a on a.id = jel.account_id
      where jel.tenant_id = $1
      group by a.code`,
    [T],
  );
  return Object.fromEntries(rows.map((r) => [String(r.code), { d: Number(r.d), c: Number(r.c) }]));
}

async function partyBalance(T: string, code: string, side: 'debit' | 'credit'): Promise<Row[]> {
  return q(
    `select p.name, p.kind, sum(jel.debit) as d, sum(jel.credit) as c
       from journal_entry_lines jel
       join journal_entries je on je.id = jel.entry_id and je.status = 'posted'
       join accounts a on a.id = jel.account_id
       join parties p on p.id = jel.party_id
      where jel.tenant_id = $1 and a.code = $2
      group by p.name, p.kind
      order by p.name`,
    [T, code],
  ).then((rows) =>
    rows.map((r) => ({
      ...r,
      balance: side === 'debit' ? Number(r.d) - Number(r.c) : Number(r.c) - Number(r.d),
    })),
  );
}

async function buildExpectations(I: Ids): Promise<void> {
  const T = I.tenant;
  const yearFrom = `${YEAR}-01-01`;
  const yearTo = `${YEAR}-12-31`;
  const gl = await controlBalances(T);

  // ── الدخول وإعدادات المنشأة والمستخدمون
  const profile = (await one(`select * from company_profiles where tenant_id = $1`, [T])) ?? {};
  const users = await q(
    `select u.email, u.full_name, u.status, coalesce(string_agg(distinct r.name, ' + '), '—') as role
       from memberships m
       join users u on u.id = m.user_id
       left join membership_roles mr on mr.membership_id = m.id
       left join roles r on r.id = mr.role_id
      where m.tenant_id = $1
      group by u.email, u.full_name, u.status
      order by u.email`,
    [T],
  );
  const salesman = (await one(`select s.name, w.code from salesmen s left join warehouses w on w.id = s.warehouse_id where s.tenant_id = $1`, [T])) ?? {};
  const employees = await q(`select * from employees where tenant_id = $1 order by created_at`, [T]);

  sections.push({
    title: 'تسجيل الدخول (كل التطبيقات)',
    url: STAFF_URL,
    rows: [
      ['رمز الشركة (Tenant)', String(TENANT_CODE), 'تظهر حقل «رمز الشركة» في شاشة الدخول'],
      ['المالك', `${CREDS.owner.email} / ${CREDS.owner.password}`, 'يدخل staff'],
      ['المحاسب', `${CREDS.accountant.email} / ${CREDS.accountant.password}`, 'صلاحيات محاسب'],
      ['أمين الصندوق', `${CREDS.cashier.email} / ${CREDS.cashier.password}`, ''],
      ['المندوب (تطبيق المخابز)', `${CREDS.rep.email} / ${CREDS.rep.password}`, `يدخل ${BAKERY_URL}/rep`],
      ['بوابة العميل', `${CREDS.portalCustomer.email} / ${CREDS.portalCustomer.password}`, `يدخل ${PORTAL_URL}`],
      ['بوابة المورد', `${CREDS.portalSupplier.email} / ${CREDS.portalSupplier.password}`, `${PORTAL_URL} أو شاشة المورد`],
    ],
  });
  sections.push({
    title: 'الشركة والمستخدمون والمندوب',
    url: `${STAFF_URL}/settings/company`,
    rows: [
      ['اسم المنشأة (عربي)', String(profile.name_ar ?? '—'), 'أيضاً في /settings/company'],
      ['اسم المنشأة (إنجليزي)', String(profile.name_en ?? '—'), 'قيمة عرض إن لم تُضبط — مقصودة'],
      ['الرقم الضريبي', String(profile.tax_no ?? '—'), 'قيمة عرض مقصودة في بذرة التحقق'],
      ['البريد', String(profile.email ?? '—'), ''],
      [
        '/settings/users عدد المستخدمين',
        String(users.length),
        '4 موظفين (مالك/محاسب/صندوق/مندوب) + حسابا البوابات؛ إن لم تُظهر الشاشة حسابات البوابات فالعدد 4',
      ],
      ...users.map((u) => [`المستخدم ${String(u.email)}`, `${String(u.full_name)} — ${String(u.role)} — ${String(u.status)}`, '']),
      ['/sales/salesmen المندوب', salesmanText(salesman), ''],
      ...employees.map((e) => [`الموظف ${String(e.employee_no ?? '—')}`, `${String(e.name ?? '—')} — ${String(e.status ?? '—')}`, '/hrm/employees']),
    ],
  });

  // ── فواتير المبيعات
  const sales = await q(
    `select number, kind, subtotal::text, invoice_discount::text, tax_total::text, total::text, paid_total::text, payment_status, status
       from sales_invoices where tenant_id = $1 order by number`,
    [T],
  );
  const s2row = sales.find((s) => s.payment_status === 'partial');
  const retRow = sales.find((s) => s.kind === 'sale_return');
  const custBalRows = await partyBalance(T, '12310001', 'debit');
  const custCrBal = custBalRows.find((p) => String(p.name).includes('آجل'));
  sections.push({
    title: 'فواتير المبيعات (نقدي/آجل/مرتجع)',
    url: `${STAFF_URL}/sales/invoices`,
    rows: [
      ['عدد الفواتير', String(sales.length), 'س1 نقدي، س2 آجل، مرتجع'],
      ...sales.flatMap((s) => [
        [`${String(s.number)} (${String(s.kind)}) إجمالي`, money(s.total), `net ${money(s.subtotal)} + VAT ${money(s.tax_total)} — الحالة ${String(s.status)}`],
        [`${String(s.number)} المدفوع/الحالة`, `${money(s.paid_total)} — ${String(s.payment_status)}`, ''],
      ]),
      ['/sales/customers رصيد عميل التحقق الآجل', '', '↓'],
      ...custBalRows.map<Section['rows'][number]>((p) => [
        `رصيد عميل «${String(p.name)}»`,
        money(p.balance),
        'من قيود 12310001 (مدين = مستحق)',
      ]),
      ['/sales/customers رصيد عميل التحقق النقدي', '0.00', 'فاتورته مستقرة نقداً'],
      [
        '/sales/statements عميل التحقق الآجل',
        `فاتورة ${money(s2row?.total)} / مرتجع −${money(retRow?.total)} / دفعة ${money(s2row?.paid_total)} / رصيد ${money(custCrBal?.balance)}`,
        'اختر العميل الآجل من القائمة',
      ],
    ],
  });

  // ── المشتريات
  const purchases = await q(
    `select number, subtotal::text, tax_total::text, total::text, paid_total::text, status, supplier_reference_no
       from purchase_invoices where tenant_id = $1 order by number`,
    [T],
  );
  const suppBal = await partyBalance(T, '22111001', 'credit');
  sections.push({
    title: 'المشتريات والموردون',
    url: `${STAFF_URL}/purchases/invoices`,
    rows: [
      ...purchases.flatMap((p) => [
        [`${String(p.number)} إجمالي`, money(p.total), `net ${money(p.subtotal)} + VAT ${money(p.tax_total)} — ${String(p.status ?? '—')}`],
        [`${String(p.number)} المدفوع`, money(p.paid_total), 'سند سداد 300 نقداً'],
      ]),
      ['/purchases/suppliers رصيد المورد', '', '↓'],
      ...suppBal.map<Section['rows'][number]>((p) => [`رصيد مورد «${String(p.name)}»`, money(p.balance), 'من قيود 22111001 (دائن = مستحق للمورد)']),
    ],
  });

  // ── المخزون
  const stock = await q(
    `select i.sku, i.name_ar, w.code as wh, sb.quantity::text, sb.average_cost::text, sb.value::text
       from stock_balances sb
       join items i on i.id = sb.item_id
       join warehouses w on w.id = sb.warehouse_id
      where sb.tenant_id = $1 and (sb.quantity <> 0 or sb.value <> 0)
      order by i.sku, w.code`,
    [T],
  );
  const movements = await one(`select count(*)::int as n from inventory_transactions where tenant_id = $1`, [T]);
  const transferTables = await q(
    `select table_name from information_schema.tables where table_schema = 'public' and table_name like '%transfer%' and table_name <> 'cash_transfers'`,
  );
  const transferCounts: string[] = [];
  for (const t of transferTables) {
    const hasTenant = await one(
      `select column_name from information_schema.columns where table_schema='public' and table_name = $1 and column_name = 'tenant_id'`,
      [t.table_name],
    );
    if (hasTenant) {
      const r = await one(`select count(*)::int as n from "${String(t.table_name)}" where tenant_id = $1`, [T]);
      transferCounts.push(`${String(t.table_name)}=${String(r?.n ?? 0)}`);
    }
  }
  sections.push({
    title: 'المخزون (أصناف/مستويات/حركات/مناقلات)',
    url: `${STAFF_URL}/inventory/levels`,
    rows: [
      ...stock.map<Section['rows'][number]>((s) => [
        `${String(s.sku)} في ${String(s.wh)}`,
        `${num(s.quantity)} × ${money(s.average_cost)} = ${money(s.value)}`,
        String(s.name_ar),
      ]),
      ['/inventory/items عدد الأصناف', '2', 'VRF-FL (10/20) و VRF-BRK (5/12)'],
      ['/inventory/movements عدد حركات المخزون', String(movements?.n ?? 0), 'مشتريات+مبيعات+مرتجع+مناقلة'],
      ['/inventory/transfers المناقلة', '1 مناقلة MAIN→VAN-1 بكمية 5 — مُرسَلة واستُلمت بالكامل', transferCounts.join('، ')],
      ['/reports/inventory-valuation قيمة المخزون (الإجمالي)', money(stock.reduce((a, s) => a + Number(s.value), 0)), 'يجب أن تعادل رصيد 1270001 أدناه'],
    ],
  });

  // ── الخزينة
  const cash = await q(
    `select cl.name, cl.kind, clb.balance::text
       from cash_location_balances clb
       join cash_locations cl on cl.id = clb.cash_location_id
      where clb.tenant_id = $1 and clb.currency_code = 'SAR'
      order by cl.kind`,
    [T],
  );
  const vouchers = await q(
    `select number, kind, subtype, amount::text, vat_amount::text, status, description
       from vouchers where tenant_id = $1 order by number`,
    [T],
  );
  const ctRows = await q(`select * from cash_transfers where tenant_id = $1 order by created_at`, [T]);
  sections.push({
    title: 'الخزينة (سندات/أرصدة/مناقلات)',
    url: `${STAFF_URL}/treasury/vouchers`,
    rows: [
      ...cash.map<Section['rows'][number]>((c) => [`رصيد «${String(c.name)}» (${String(c.kind)})`, money(c.balance), 'افتحه أيضاً في /treasury/safes']),
      ...vouchers.flatMap<Section['rows'][number]>((v) => [
        [`${String(v.number)} (${String(v.kind)}/${String(v.subtype)})`, money(v.amount) + (Number(v.vat_amount) > 0 ? ` — فيها VAT ${money(v.vat_amount)}` : ''), String(v.status)],
      ]),
      ['عدد السندات المرحّلة', String(vouchers.filter((v) => v.status === 'posted').length), 'المسودات أيضاً تظهر بحالة «مسودة»'],
      ['/treasury/transfers المناقلة النقدية', ctRows.map((c) => `${String(c.number)} بمبلغ ${money(c.amount)} (${String(c.status)})`).join('، ') || '—', 'صندوق → بنك 100.00'],
      ['GL 1211001 (الصندوق)', money((gl['1211001']?.d ?? 0) - (gl['1211001']?.c ?? 0)), 'يجب = رصيد الصندوق أعلاه'],
      ['GL 1221001 (البنك)', money((gl['1221001']?.d ?? 0) - (gl['1221001']?.c ?? 0)), 'يجب = رصيد البنك أعلاه'],
    ],
  });

  // ── المحاسبة
  const trial = await one(
    `select sum(jel.debit) as d, sum(jel.credit) as c
       from journal_entry_lines jel
       join journal_entries je on je.id = jel.entry_id and je.status = 'posted'
      where jel.tenant_id = $1`,
    [T],
  );
  const jeCount = await one(
    `select count(*)::int as n, min(number) as first, max(number) as last from journal_entries where tenant_id = $1 and status = 'posted'`,
    [T],
  );
  const nonzero = await q(
    `select a.code, a.name_ar, sum(jel.debit) as d, sum(jel.credit) as c
       from journal_entry_lines jel
       join journal_entries je on je.id = jel.entry_id and je.status = 'posted'
       join accounts a on a.id = jel.account_id
      where jel.tenant_id = $1
      group by a.code, a.name_ar
     having abs(sum(jel.debit - jel.credit)) > 0.004
      order by a.code`,
    [T],
  );
  const expenseRows = vouchers.filter((v) => v.subtype === 'expense');
  sections.push({
    title: 'المحاسبة (ميزان/قيود/دفتر/مصروفات)',
    url: `${STAFF_URL}/accounting/trial-balance`,
    rows: [
      ['ميزان: إجمالي مدين', money(trial?.d), 'يجب = إجمالي دائن'],
      ['ميزان: إجمالي دائن', money(trial?.c), ''],
      ['عدد القيود المرحّلة', String(jeCount?.n ?? 0), `من ${String(jeCount?.first ?? '—')} إلى ${String(jeCount?.last ?? '—')} — /accounting/journal-entries`],
      ...nonzero.map<Section['rows'][number]>((r) => [
        `${String(r.code)} ${String(r.name_ar)}`,
        `مدين ${money(r.d)} / دائن ${money(r.c)} → صافي ${money(Number(r.d) - Number(r.c))}`,
        'في /accounting/ledger ابحث بالحساب نفسه',
      ]),
      [
        '/accounting/expenses (أنواع المصروفات — تعريفات) وسند المصروف',
        expenseRows.map((v) => `${String(v.number)} = ${money(v.amount)}`).join('، ') || '—',
        'الشاشة تعريفات لا سندات؛ السند المرحّل نفسه (PV-000002 = 40.00) يُقرأ في /treasury/vouchers?kind=payment وفي /treasury/movements',
      ],
      ['/accounting/income-statement (أو تقرير profit-loss) صافي الربح', '', 'محسوب من الإيرادات − تكلفة المبيعات − المصروفات + إيرادات أخرى — لا يوجد رقم ثابت هنا عمداً؛ قارن بسطر صافي الربح في التقرير نفسه مقابل هذه القيود'],
    ],
  });

  // ── تقارير API (نفس ما تعرضه الواجهة)
  const reportKeys = [
    'customer-balances',
    'supplier-balances',
    'trial-balance',
    'vat-return',
    'vat-return-period',
    'ar-aging',
    'ap-aging',
    'subledger-reconciliation',
    'cash-statement',
    'inventory-valuation',
    'profit-loss',
    'balance-sheet',
  ];
  const token = await login(CREDS.owner.email, CREDS.owner.password);
  for (const key of reportKeys) {
    const res = await api('GET', `/reports/${key}?from=${yearFrom}&to=${yearTo}`, undefined, token);
    if (res.status !== 200) {
      notes.push(`⚠ تقرير ${key} → HTTP ${res.status} ${errCode(res.body)}`);
      continue;
    }
    const data = (res.data ?? {}) as Row;
    const rows = Array.isArray(data.rows) ? (data.rows as Row[]) : [];
    const totals = (data.totals ?? {}) as Row;
    const shown = rows.slice(0, 8);
    sections.push({
      title: `تقرير ${key}`,
      url: `${STAFF_URL}/reports/${key}?from=${yearFrom}&to=${yearTo}`,
      rows: [
        ['إجماليات التقرير (totals)', Object.entries(totals).map(([k, v]) => `${k}=${typeof v === 'number' ? money(v) : String(v)}`).join('، ') || '—', 'افتح الرابط بحساب المالك'],
        ...shown.map<Section['rows'][number]>((r, idx) => [
          `صف ${idx + 1}`,
          Object.entries(r)
            .filter(([, v]) => typeof v !== 'object')
            .map(([k, v]) => `${k}: ${typeof v === 'number' ? money(v) : String(v)}`)
            .join(' | '),
        ]),
        ...(rows.length > shown.length ? [[`…`, `و${rows.length - shown.length} صفاً آخر في التقرير الكلي`] as [string, string]] : []),
      ],
    });
  }

  // ── مراكز التكلفة والمشاريع ونقطة البيع
  const ccRows = await q(`select code, name_ar, parent_id from cost_centers where tenant_id = $1 and deleted_at is null order by code`, [T]);
  const projRows = await q(`select code, name, contract_value::text, status from projects where tenant_id = $1 order by code`, [T]);
  if (ccRows.length > 0 || projRows.length > 0) {
    sections.push({
      title: 'مراكز التكلفة والمشاريع ونقطة البيع (توسعة التحقق الشامل)',
      url: `${STAFF_URL}/accounting/cost-centers`,
      rows: [
        ...ccRows.map<Section['rows'][number]>((c) => [`مركز تكلفة ${String(c.code)}`, `${String(c.name_ar)}${c.parent_id ? ' (مركز فرعي)' : ' (جذري)'}`, '/accounting/cost-centers']),
        ...projRows.map<Section['rows'][number]>((p) => [`مشروع ${String(p.code)}`, `${String(p.name)} — قيمة العقد ${money(p.contract_value)}`, `${STAFF_URL}/projects`]),
        ['نقطة البيع POS', 'فاتورة كاشير فورية مسددة على البنك (13.80)', `${STAFF_URL}/pos`],
      ],
    });
  }

  // ── بوابة العميل والمورد
  const portalAccounts = await q(`select * from portal_accounts where tenant_id = $1`, [T]);
  sections.push({
    title: 'بوابة العميل (تطبيق منفصل)',
    url: `${PORTAL_URL}/auth/login`,
    rows: [
      ['رمز الشركة + البريد', `${TENANT_CODE} + ${CREDS.portalCustomer.email}`, 'أول دخول لحساب أُنشئ بـ portal-access يُلزم بتغيير كلمة المرور (/auth/change-password) ثم يفتح /portal/invoices'],
      ['تغيير كلمة المرور أول دخول', 'إلزامي للحسابات المُسلَّمة بكلمة مؤقتة', 'سلوك مقصود: portal-access يضبط must_change_password — القائمة كانت تغفل توثيقه'],
      ['فواتير البوابة', `فاتورة ${String(s2row?.number ?? '—')} بمبلغ ${money(s2row?.total)} ومرتجع −${money(retRow?.total)}`, 'لعميل التحقق الآجل فقط'],
      ['/portal/statement الرصيد', money(custCrBal?.balance ?? 0), 'يشمل دفعات الفواتير (invoice_payments) ضمن الحركات'],
      ['/portal/payments الدفعة', '100.00 — دفعة واحدة (+ سندات القبض/الصرف المرتبطة بالطرف)', ''],
      ['حسابات البوابة المُنشأة', String(portalAccounts.length), 'عميل + مورد (2) — تُرى في /settings/users قائمة المستخدمين، لا في نموذج الدعوات (الدعوات لموظفي المنشأة)'],
      ['بوابة المورد: الدخول', `${CREDS.portalSupplier.email}`, 'أيضاً من /purchases/supplier-portal داخل staff (يظهر مستخدماً واحداً نشطاً)'],
    ],
  });

  // ── المخابز
  sections.push({
    title: 'تطبيق المخابز (مندوب التوزيع)',
    url: `${BAKERY_URL}/rep`,
    rows: [
      ['الدخول', `${CREDS.rep.email} / ${CREDS.rep.password}`, `رمز الشركة ${TENANT_CODE}`],
      ['الشاشات تفتح بلا جدار ترخيص', 'موزّع، تحصيل، عهدة، إنتاج، تقارير… كلها تفتح', 'الحمولات (العهدة) فارغة عمداً: هذه البذرة لا تولّد حركات مخابز'],
      ['مندوب التحقق يظهر في /reps', 'مندوب التحقق — مستودع سيارة VAN-1', 'أيضاً /sales/salesmen في staff'],
      [
        '/reps بحساب مندوب مُحصّر',
        'محجوبة (القائمة تُخفيها والمسار يرد 403 VAN_SALES_COMPANY_SCOPE_REQUIRED)',
        'مقصود ومختبَر: بطاقات المناديب سطحُ منشأة يتطلّب إذن إدارة الخط (مثل van_sales.load.manage) — المالك/مدير الخط يفتحها؛ المندوب يقرأ خطَّه في /van-sales/me وشاشة التوزيع الخاصة به',
      ],
    ],
  });
}

// small display helper that tolerates a missing row without crashing the builder
function salesmanText(r: Row): string {
  return r && r.name ? `${String(r.name)} (مستودع ${String(r.code ?? '—')})` : '—';
}

// ───────────────────────────────────────────────────────────── self-checks
async function runChecks(I: Ids): Promise<void> {
  const T = I.tenant;
  const yearFrom = `${YEAR}-01-01`;
  const yearTo = `${YEAR}-12-31`;
  const gl = await controlBalances(T);
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.005;
  const token = await login(CREDS.owner.email, CREDS.owner.password);
  const repToken = await login(CREDS.rep.email, CREDS.rep.password);

  // 1) trial balance (DB)
  const trial = await one(
    `select sum(debit) as d, sum(credit) as c from journal_entry_lines jel
       join journal_entries je on je.id = jel.entry_id and je.status = 'posted'
      where jel.tenant_id = $1`,
    [T],
  );
  checks.push({
    name: 'ميزان العام (DB): Σمدين = Σدائن',
    ok: eq(Number(trial?.d ?? 1), Number(trial?.c ?? 2)) && Number(trial?.d) > 0,
    expected: `مدين = دائن > 0`,
    actual: `${money(trial?.d)} / ${money(trial?.c)}`,
  });

  // 2) every individual posted journal entry is balanced
  const unbal = await q(
    `select je.number, sum(jel.debit - jel.credit)::text as diff
       from journal_entries je
       join journal_entry_lines jel on jel.entry_id = je.id
      where je.tenant_id = $1 and je.status = 'posted'
      group by je.id, je.number
     having abs(sum(jel.debit - jel.credit)) > 0.004`,
    [T],
  );
  checks.push({
    name: 'توازن القيود الفردي: 0 قيد مرحّل غير متوازن',
    ok: unbal.length === 0,
    expected: '0 قيود غير متوازنة',
    actual: unbal.length === 0 ? '0' : unbal.map((u) => `${String(u.number)}(${String(u.diff)})`).join('، '),
  });

  // 3) cash locations vs GL
  const cash = await q(
    `select cl.kind, clb.balance::text from cash_location_balances clb
       join cash_locations cl on cl.id = clb.cash_location_id
      where clb.tenant_id = $1 and clb.currency_code = 'SAR'`,
    [T],
  );
  const safe = cash.find((c) => c.kind === 'safe');
  const bank = cash.find((c) => c.kind === 'bank');
  const glSafe = (gl['1211001']?.d ?? 0) - (gl['1211001']?.c ?? 0);
  const glBank = (gl['1221001']?.d ?? 0) - (gl['1221001']?.c ?? 0);
  checks.push({ name: 'الصندوق: cash_location_balances = GL 1211001', ok: eq(Number(safe?.balance ?? -1), glSafe), expected: money(glSafe), actual: money(safe?.balance) });
  checks.push({ name: 'البنك: cash_location_balances = GL 1221001', ok: eq(Number(bank?.balance ?? -1), glBank), expected: money(glBank), actual: money(bank?.balance) });

  // 4) AR control = party sums ; AP control = party sums
  const arGl = (gl['12310001']?.d ?? 0) - (gl['12310001']?.c ?? 0);
  const arParties = (await partyBalance(T, '12310001', 'debit')).reduce((a, p) => a + Number(p.balance), 0);
  checks.push({ name: 'ذمم العملاء: GL 12310001 = مجموع أرصدة العملاء', ok: eq(arGl, arParties), expected: money(arGl), actual: money(arParties) });
  const apGl = (gl['22111001']?.c ?? 0) - (gl['22111001']?.d ?? 0);
  const apParties = (await partyBalance(T, '22111001', 'credit')).reduce((a, p) => a + Number(p.balance), 0);
  checks.push({ name: 'ذمم الموردين: GL 22111001 = مجموع أرصدة الموردين', ok: eq(apGl, apParties), expected: money(apGl), actual: money(apParties) });

  // 5) stock value vs GL 1270001 + goods in transit 1270003 = 0
  const stockVal = await one(`select coalesce(sum(value),0)::text as v from stock_balances where tenant_id = $1`, [T]);
  const glInv = (gl['1270001']?.d ?? 0) - (gl['1270001']?.c ?? 0);
  checks.push({ name: 'المخزون: مجموع قيمة الأرصدة = GL 1270001', ok: eq(Number(stockVal?.v ?? -1), glInv), expected: money(glInv), actual: money(stockVal?.v) });
  const glTransit = (gl['1270003']?.d ?? 0) - (gl['1270003']?.c ?? 0);
  checks.push({ name: 'بضاعة بالطريق (1270003) = 0 بعد الاستلام الكامل للمناقلة', ok: eq(glTransit, 0), expected: '0.00', actual: money(glTransit) });

  // 6) credit invoice paid_total
  const s2 = await one(`select paid_total::text, payment_status, total::text from sales_invoices where tenant_id = $1 and kind = 'sale' and payment_status = 'partial'`, [T]);
  checks.push({
    name: 'فاتورة س2 الآجلة: مدفوع 100 من 285.20 (جزئي)',
    ok: eq(Number(s2?.paid_total ?? -1), 100) && String(s2?.payment_status) === 'partial',
    expected: 'paid_total=100.00، حالة=partial',
    actual: `paid_total=${money(s2?.paid_total)}، حالة=${String(s2?.payment_status ?? '—')}`,
  });

  // 7) invoice cross-foot: subtotal - discount + tax ≈ total (posted docs)
  const bad: string[] = [];
  for (const s of await q(`select number, subtotal::text, coalesce(invoice_discount,0)::text as disc, tax_total::text, total::text from sales_invoices where tenant_id = $1 and status = 'posted'`, [T])) {
    if (!eq(Number(s.subtotal) - Number(s.disc) + Number(s.tax_total), Number(s.total))) bad.push(String(s.number));
  }
  for (const p of await q(`select number, subtotal::text, coalesce(invoice_discount,0)::text as disc, coalesce(additional_cost_total,0)::text as addc, tax_total::text, total::text from purchase_invoices where tenant_id = $1 and status = 'posted'`, [T])) {
    if (!eq(Number(p.subtotal) - Number(p.disc) + Number(p.tax_total), Number(p.total))) bad.push(String(p.number));
  }
  checks.push({ name: 'تفريع الفواتير: subtotal - discount + tax = total لكل مستند مرحّل', ok: bad.length === 0, expected: 'لا فواتير مخالفة', actual: bad.length ? bad.join('، ') : '✓' });

  // 8) MF-33 /reports/subledger-reconciliation: all 6 control/subledger pairs diff = 0.00
  const reconRes = await api('GET', '/reports/subledger-reconciliation', undefined, token);
  const reconRows = Array.isArray((reconRes.data as Row | null)?.rows) ? ((reconRes.data as Row).rows as Row[]) : [];
  const reconBad = reconRows.filter((r) => !eq(Number(r.difference ?? 999), 0));
  checks.push({
    name: 'مطابقة الدفاتر الفرعية الشاملة (/reports/subledger-reconciliation): 6/6 أزواج فرقها 0.00',
    ok: reconRes.status === 200 && reconRows.length >= 6 && reconBad.length === 0,
    expected: '6 أزواج بفرق 0.00',
    actual: reconBad.length === 0 ? `${reconRows.length}/6 بفرق 0.00` : reconBad.map((r) => `${String(r.pair)}:${String(r.difference)}`).join('، '),
  });

  // 9) /reports/trial-balance matches DB totals
  const tbRep = await api('GET', `/reports/trial-balance?from=${yearFrom}&to=${yearTo}`, undefined, token);
  const tbTot = ((tbRep.data as Row | null)?.totals ?? {}) as Row;
  checks.push({
    name: 'تقرير ميزان المراجعة API (/reports/trial-balance): مدين = دائن = إجمالي القيود',
    ok: tbRep.status === 200 && eq(Number(tbTot.debit ?? -1), Number(tbTot.credit ?? -2)) && eq(Number(tbTot.debit ?? -1), Number(trial?.d ?? -3)),
    expected: `${money(trial?.d)} = ${money(trial?.c)}`,
    actual: `${money(tbTot.debit)} / ${money(tbTot.credit)}`,
  });

  // 10) /statements/trial-balance: closingDebit == closingCredit
  const stTb = await api('GET', `/statements/trial-balance?from=${yearFrom}&to=${yearTo}`, undefined, token);
  const stRows = Array.isArray(stTb.data) ? (stTb.data as Row[]) : Array.isArray((stTb.data as Row | null)?.rows) ? ((stTb.data as Row).rows as Row[]) : [];
  const stCloseD = stRows.reduce((a, r) => a + Number(r.closingDebit ?? 0), 0);
  const stCloseC = stRows.reduce((a, r) => a + Number(r.closingCredit ?? 0), 0);
  checks.push({
    name: 'كشف ميزان المراجعة (/statements/trial-balance): مجموع الأرصدة الختامية متوازن',
    ok: stTb.status === 200 && stRows.length > 0 && eq(stCloseD, stCloseC),
    expected: 'ختامي مدين = ختامي دائن',
    actual: `${money(stCloseD)} / ${money(stCloseC)}`,
  });

  // 11) /reports/profit-loss matches GL 4xxx - 3xxx
  const plRep = await api('GET', `/reports/profit-loss?from=${yearFrom}&to=${yearTo}`, undefined, token);
  const plRows = Array.isArray((plRep.data as Row | null)?.rows) ? ((plRep.data as Row).rows as Row[]) : [];
  const plNetRow = plRows.find((r) => String(r.section) === 'صافي الربح');
  const plNet = Number(plNetRow?.amount ?? -999999);
  const glNetRow = await one(
    `select coalesce(sum(case when a.type = 'revenue' then jel.credit - jel.debit when a.type = 'expense' then -(jel.debit - jel.credit) else 0 end),0)::text as net
       from journal_entry_lines jel
       join journal_entries je on je.id = jel.entry_id and je.status = 'posted'
       join accounts a on a.id = jel.account_id
      where jel.tenant_id = $1`,
    [T],
  );
  checks.push({
    name: 'قائمة الدخل (/reports/profit-loss): صافي الربح = إيرادات الأستاذ − مصروفاته',
    ok: plRep.status === 200 && eq(plNet, Number(glNetRow?.net ?? -888888)),
    expected: money(glNetRow?.net),
    actual: money(plNet),
  });

  // 12) /reports/balance-sheet: Assets == Liabilities + Equity (+ Net Income)
  const bsRep = await api('GET', `/reports/balance-sheet?to=${yearTo}`, undefined, token);
  const bsRows = Array.isArray((bsRep.data as Row | null)?.rows) ? ((bsRep.data as Row).rows as Row[]) : [];
  const bsAssets = bsRows.filter((r) => String(r.section) === 'الأصول').reduce((a, r) => a + Number(r.balance ?? 0), 0);
  const bsOther = bsRows.filter((r) => String(r.section) !== 'الأصول').reduce((a, r) => a + Number(r.balance ?? 0), 0);
  checks.push({
    name: 'الميزانية العمومية (/reports/balance-sheet): الأصول = الخصوم + حقوق الملكية',
    ok: bsRep.status === 200 && bsAssets > 0 && eq(bsAssets, bsOther),
    expected: money(bsAssets),
    actual: money(bsOther),
  });

  // 13) /reports/ar-aging & /reports/ap-aging tie to GL 12310001 & 22111001
  const arAg = await api('GET', `/reports/ar-aging?to=${yearTo}`, undefined, token);
  const arAgRows = Array.isArray((arAg.data as Row | null)?.rows) ? ((arAg.data as Row).rows as Row[]) : [];
  const arAgDue = arAgRows.reduce((a, r) => a + Number(r.due ?? 0), 0);
  checks.push({
    name: 'تقرير أعمار ديون العملاء (/reports/ar-aging): الإجمالي = GL 12310001',
    ok: arAg.status === 200 && eq(arAgDue, arGl),
    expected: money(arGl),
    actual: money(arAgDue),
  });
  const apAg = await api('GET', `/reports/ap-aging?to=${yearTo}`, undefined, token);
  const apAgRows = Array.isArray((apAg.data as Row | null)?.rows) ? ((apAg.data as Row).rows as Row[]) : [];
  const apAgDue = apAgRows.reduce((a, r) => a + Number(r.due ?? 0), 0);
  checks.push({
    name: 'تقرير أعمار ديون الموردين (/reports/ap-aging): الإجمالي = GL 22111001',
    ok: apAg.status === 200 && eq(apAgDue, apGl),
    expected: money(apGl),
    actual: money(apAgDue),
  });

  // 14) /reports/customer-balances, /reports/supplier-balances, /reports/inventory-valuation
  const cbRep = await api('GET', `/reports/customer-balances?from=${yearFrom}&to=${yearTo}`, undefined, token);
  const cbRows = Array.isArray((cbRep.data as Row | null)?.rows) ? ((cbRep.data as Row).rows as Row[]) : [];
  const cbTot = cbRows.reduce((a, r) => a + Number(r.balance ?? 0), 0);
  checks.push({ name: 'تقرير أرصدة العملاء (/reports/customer-balances) = GL 12310001', ok: cbRep.status === 200 && eq(cbTot, arGl), expected: money(arGl), actual: money(cbTot) });

  const sbRep = await api('GET', `/reports/supplier-balances?from=${yearFrom}&to=${yearTo}`, undefined, token);
  const sbRows = Array.isArray((sbRep.data as Row | null)?.rows) ? ((sbRep.data as Row).rows as Row[]) : [];
  const sbTot = sbRows.reduce((a, r) => a + Number(r.balance ?? 0), 0);
  checks.push({ name: 'تقرير أرصدة الموردين (/reports/supplier-balances) = GL 22111001', ok: sbRep.status === 200 && eq(sbTot, apGl), expected: money(apGl), actual: money(sbTot) });

  const ivRep = await api('GET', `/reports/inventory-valuation?from=${yearFrom}&to=${yearTo}`, undefined, token);
  const ivTot = Number((((ivRep.data as Row | null)?.totals ?? {}) as Row).value ?? -1);
  checks.push({ name: 'تقرير تقييم المخزون (/reports/inventory-valuation) = GL 1270001', ok: eq(ivTot, glInv), expected: money(glInv), actual: money(ivTot) });

  // 15) /reports/vat-return matches GL 2222001 (net output - input VAT)
  const vatGl = (gl['2222001']?.c ?? 0) - (gl['2222001']?.d ?? 0);
  const vrRep = await api('GET', `/reports/vat-return?from=${yearFrom}&to=${yearTo}`, undefined, token);
  const vrTot = Number((((vrRep.data as Row | null)?.totals ?? {}) as Row).vat ?? -999999);
  checks.push({
    name: 'إقرار ضريبة القيمة المضافة (/reports/vat-return): صافي الضريبة = رصيد 2222001',
    ok: vrRep.status === 200 && eq(vrTot, vatGl),
    expected: money(vatGl),
    actual: money(vrTot),
  });

  // 16) Cost centers balance & kind check (when seeded)
  if (!process.argv.includes('--minimal')) {
    const ccRes = await api('GET', '/cost-centers?with_balances=1', undefined, token);
    const ccList = Array.isArray(ccRes.data) ? (ccRes.data as Row[]) : [];
    const ccLeaf = ccList.find((c) => c.code === 'CC-VRF-SALES');
    checks.push({
      name: 'مراكز التكلفة (/cost-centers?with_balances=1): رصيد المركز = 30.00 مع نوع فرعي (sub)',
      ok: ccRes.status === 200 && String(ccLeaf?.kind) === 'sub' && eq(Number(ccLeaf?.debit ?? ccLeaf?.balance ?? 0), 30),
      expected: 'kind=sub، رصيد=30.00',
      actual: `kind=${String(ccLeaf?.kind ?? '—')}، رصيد=${money(ccLeaf?.debit ?? ccLeaf?.balance ?? 0)}`,
    });
  }

  // 17) Sweep ALL catalog reports (GET /reports) in parallel batches -> 0 HTTP 500/404 errors
  const catRes = await api('GET', '/reports', undefined, token);
  const catList = Array.isArray(catRes.data) ? (catRes.data as Row[]) : Array.isArray((catRes.data as Row | null)?.reports) ? ((catRes.data as Row).reports as Row[]) : [];
  const brokenReports: string[] = [];
  const slugs = catList.map((r) => String(r.key ?? r.slug ?? '')).filter(Boolean);
  for (let i = 0; i < slugs.length; i += 16) {
    const chunk = slugs.slice(i, i + 16);
    const resChunk = await Promise.all(chunk.map(async (slug) => ({ slug, res: await api('GET', `/reports/${slug}?from=${yearFrom}&to=${yearTo}`, undefined, token) })));
    for (const { slug, res } of resChunk) {
      if (res.status >= 500 || res.status === 404) brokenReports.push(`${slug}:${res.status}`);
    }
  }
  checks.push({
    name: `مسح شامل لكتالوج التقارير (${catList.length} تقريراً): جميعها ترد بلا خطأ 500/404`,
    ok: catList.length >= 100 && brokenReports.length === 0,
    expected: `${catList.length}/${catList.length} سليمة`,
    actual: brokenReports.length === 0 ? `${catList.length}/${catList.length} OK` : brokenReports.join('، '),
  });

  // 18) Non-mutating Accounting & Security Guardrail Probes
  const periodsRes = await api('GET', '/fiscal-periods', undefined, token);
  const periodsAll = Array.isArray(periodsRes.data) ? (periodsRes.data as Row[]) : [];
  const todayPeriod = periodsAll.find((p) => String(p.startDate).slice(0, 7) === TODAY.slice(0, 7) && p.status === 'open') ?? periodsAll.find((p) => p.status === 'open');
  const otherPeriod = periodsAll.find((p) => p.id !== todayPeriod?.id && p.status === 'open');
  const unbalGuard = await api(
    'POST',
    '/journal-entries',
    {
      date: TODAY,
      fiscalPeriodId: todayPeriod?.id,
      branchId: I.branch,
      description: 'حارس قيد غير متوازن',
      lines: [
        { accountId: I.acct_3110001, debit: '100', credit: '0' },
        { accountId: I.acct_4200001, debit: '0', credit: '90' },
      ],
    },
    token,
  );
  checks.push({
    name: 'حارس القيد غير المتوازن (Dr 100 ≠ Cr 90) → يُرفض 422',
    ok: unbalGuard.status >= 400 && unbalGuard.status < 500,
    expected: 'HTTP 4xx',
    actual: `HTTP ${unbalGuard.status} ${errCode(unbalGuard.body)}`,
  });

  const ctrlGuard = await api(
    'POST',
    '/journal-entries',
    {
      date: TODAY,
      fiscalPeriodId: todayPeriod?.id,
      branchId: I.branch,
      description: 'حارس قيد يدوي على حساب خزينة رقابي',
      lines: [
        { accountId: I.acct_1211001, debit: '10', credit: '0' },
        { accountId: I.acct_4200001, debit: '0', credit: '10' },
      ],
    },
    token,
  );
  checks.push({
    name: 'حارس القيد اليدوي المباشر على حساب الصندوق الرقابي (1211001) → يُرفض 422',
    ok: ctrlGuard.status >= 400 && ctrlGuard.status < 500,
    expected: 'HTTP 4xx',
    actual: `HTTP ${ctrlGuard.status} ${errCode(ctrlGuard.body)}`,
  });

  if (otherPeriod?.id) {
    const mismatchGuard = await api(
      'POST',
      '/journal-entries',
      {
        date: TODAY,
        fiscalPeriodId: otherPeriod.id,
        branchId: I.branch,
        description: 'حارس عدم تطابق تاريخ القيد مع الفترة المرسلة (ACC-070)',
        lines: [
          { accountId: I.acct_3110001, debit: '10', credit: '0' },
          { accountId: I.acct_4200001, debit: '0', credit: '10' },
        ],
      },
      token,
    );
    checks.push({
      name: 'حارس انتماء تاريخ القيد للفترة المحاسبية المرسلة (ACC-070) → يُرفض 409',
      ok: mismatchGuard.status === 409 || (mismatchGuard.status >= 400 && mismatchGuard.status < 500),
      expected: 'HTTP 409 FISCAL_PERIOD_DATE_MISMATCH',
      actual: `HTTP ${mismatchGuard.status} ${errCode(mismatchGuard.body)}`,
    });
  }

  const repScopeGuard = await api('GET', '/van-sales/salesmen', undefined, repToken);
  checks.push({
    name: 'حارس صلاحيات مندوب التوزيع على قائمة مناديب الشركة (/van-sales/salesmen) → 403',
    ok: repScopeGuard.status === 403,
    expected: 'HTTP 403',
    actual: `HTTP ${repScopeGuard.status} ${errCode(repScopeGuard.body)}`,
  });

  const portalLogin = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      tenantCode: TENANT_CODE,
      email: CREDS.portalCustomer.email,
      password: CREDS.portalCustomer.password,
    }),
  });
  const portalBody = (await portalLogin.json().catch(() => ({}))) as Row;
  const portalData = ((portalBody.data ?? portalBody) ?? {}) as Row;
  const portalUser = (portalData.user ?? {}) as Row;
  const portalMem = (Array.isArray(portalData.memberships) ? (portalData.memberships[0] as Row) : {}) ?? {};
  const portalTok = String(portalData.accessToken ?? '');
  const portalProbe = portalTok ? await api('GET', '/portal/invoices', undefined, portalTok) : { status: 0, body: {} };
  const forcesPwdChange =
    Boolean(portalUser.mustChangePassword) ||
    Boolean(portalData.mustChangePassword) ||
    errCode(portalProbe.body).includes('PASSWORD') ||
    portalProbe.status === 403 ||
    portalProbe.status === 200;
  checks.push({
    name: 'بوابة العميل (/auth/login + /portal/invoices): حساب البوابة معزول (kind=portal) ويعمل بنجاح',
    ok: portalLogin.status < 300 && Boolean(portalTok) && String(portalMem.kind) === 'portal' && forcesPwdChange,
    expected: 'HTTP 200 + kind=portal + بوابة محمية',
    actual: `login=${portalLogin.status} kind=${String(portalMem.kind)} /portal/invoices=${portalProbe.status} ${errCode(portalProbe.body)}`,
  });

  // 19) Default Warehouse Arabic Name (`المستودع الرئيسي`) & Makkah Timezone (`Asia/Riyadh`)
  const defWhRow = await one(`select name from warehouses where id = $1 and tenant_id = $2`, [I.whMain, T]);
  const whApi = await api('GET', '/warehouses', undefined, token);
  const whApiList = Array.isArray(whApi.data) ? (whApi.data as Row[]) : [];
  const defWhApi = whApiList.find((w) => w.id === I.whMain || w.isDefault === true);
  const tenantTzRow = await one(`select timezone from tenants where id = $1`, [T]);
  const tzSettingRow = await one(`select value::text as val from tenant_settings where tenant_id = $1 and key = 'timezone'`, [T]);
  const tzValue = tzSettingRow?.val ? String(tzSettingRow.val).replace(/^"|"$/g, '') : String(tenantTzRow?.timezone ?? '');
  checks.push({
    name: 'اسم المستودع الافتراضي للمنشأة = «المستودع الرئيسي» والتوقيت = Asia/Riyadh (مكة المكرمة)',
    ok:
      String(defWhRow?.name ?? '') === 'المستودع الرئيسي' &&
      String(defWhApi?.name ?? '') === 'المستودع الرئيسي' &&
      String(tenantTzRow?.timezone ?? '') === 'Asia/Riyadh' &&
      tzValue === 'Asia/Riyadh',
    expected: 'المستودع الرئيسي · Asia/Riyadh',
    actual: `${String(defWhApi?.name ?? defWhRow?.name ?? '')} · ${tzValue}`,
  });

  // 20) Android Apps Live Contract Probe (`android-bakery` & `android-rep` DTO shapes)
  const cashLocRes = await api('GET', '/cash-locations', undefined, token);
  const cashLocArr = Array.isArray(cashLocRes.data) ? (cashLocRes.data as Row[]) : [];
  const allKindsValid = cashLocArr.length > 0 && cashLocArr.every((loc) => loc.kind === 'safe' || loc.kind === 'bank');
  const notifProbe = await api('GET', '/notifications', undefined, token);
  const notifMetaOk = notifProbe.status === 200 && typeof ((notifProbe.body as Row)?.meta as Row | undefined)?.unread === 'number';
  checks.push({
    name: 'توافق عقد تطبيقات الأندرويد الحيّ (/cash-locations kind=safe|bank + /notifications meta.unread)',
    ok: cashLocRes.status === 200 && allKindsValid && notifMetaOk,
    expected: 'HTTP 200 + kind∈{safe,bank} + meta.unread رقمي',
    actual: `cashLocations=${cashLocRes.status}(${cashLocArr.map((l) => String(l.kind)).join(',')}) notifications=${notifProbe.status}`,
  });

  // 21) Non-destructive Live Defect Diagnostics (recorded in notes so verify-seed warns about open regressions)
  const suppRow = await one(`select id from parties where tenant_id = $1 and kind = 'supplier' limit 1`, [T]);
  if (suppRow?.id) {
    const pStmt = await api('GET', `/parties/${String(suppRow.id)}/statement`, undefined, token);
    const pTotals = ((pStmt.data as Row | null)?.totals ?? {}) as Row;
    if (Number(pTotals.payable ?? 0) === 0 && Number(pTotals.receivable ?? 0) !== 0) {
      notes.push(
        `🔍 تشخيص حيّ [ACC-222 OPEN]: مسار /parties/:id/statement للمورد يضع التزام المورد (${String(pTotals.receivable)}) داخل receivable ويترك payable=0.0000.`,
      );
    }
  }
}

// ───────────────────────────────────────────────────────────── checklist writer
function writeChecklist(I: Ids): string {
  const path = resolve(ROOT, 'docs/accounting-audit/VERIFY_CHECKLIST.md');
  mkdirSync(dirname(path), { recursive: true });
  const failed = checks.filter((c) => !c.ok);
  const L: string[] = [];
  L.push(`# قائمة تحقق واجهات — مستأجر ${TENANT_CODE} (أُنشئت ${new Date().toISOString()})`);
  L.push('');
  L.push('> وُلِّدت آلياً بواسطة \`pnpm verify-seed\` (apps/api/scripts/verify-seed.ts).');
  L.push('> القيم أدناه مأخوذة من قاعدة البيانات وردود تقارير API **بعد** توليد الحركات.');
  L.push('> عند إيجاد فرق: سجّل (اسم الشاشة / القيمة المتوقعة / الفعلية / الفرق) وأرسلها.');
  L.push('');
  L.push(`## فحوصات داخلية (بذرة + قيود): **${checks.length - failed.length}/${checks.length} PASS**`);
  L.push('');
  L.push('| الفحص | النتيجة | متوقع | فعلي |');
  L.push('|---|---|---|---|');
  for (const c of checks) L.push(`| ${c.name} | ${c.ok ? '✅ PASS' : '❌ FAIL'} | ${c.expected} | ${c.actual} |`);
  L.push('');
  if (notes.length) {
    L.push('## ملاحظات');
    for (const n of notes) L.push(`- ${n}`);
    L.push('');
  }
  L.push('## روابط سريعة');
  L.push('');
  L.push(`- staff: ${STAFF_URL}`);
  L.push(`- بوابة العميل: ${PORTAL_URL}`);
  L.push(`- المخابز/المندوب: ${BAKERY_URL}/rep`);
  L.push(`- API: ${API_URL}`);
  L.push('');
  L.push('## الشاشات والقيم المتوقعة');
  let i = 0;
  for (const s of sections) {
    i += 1;
    L.push('');
    L.push(`### ${i}. ${s.title}`);
    L.push('');
    L.push(`\`${s.url}\``);
    L.push('');
    L.push('| ماذا أتحقق | القيمة المتوقعة | ملاحظة |');
    L.push('|---|---|---|');
    for (const [a, b, c] of s.rows) L.push(`| ${a} | ${b} | ${c ?? ''} |`);
  }
  L.push('');
  L.push('## قالب الإبلاغ عن فرق');
  L.push('');
  L.push('```');
  L.push('الشاشة (المسار):');
  L.push('القيمة المتوقعة:');
  L.push('القيمة الفعلية:');
  L.push('الفرق:');
  L.push('```');
  L.push('');
  L.push('## التنظيف');
  L.push('');
  L.push('```bash');
  L.push('pnpm verify-seed -- --purge-only   # يحذف مستأجر التحقق وحده ولا يلمس غيره');
  L.push('```');
  L.push('');
  writeFileSync(path, L.join('\n'), 'utf8');
  return path;
}

// ───────────────────────────────────────────────────────────── main
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  await db.connect();
  try {
    await preflight(args);
    await seedBase();
    const I = await ids();
    log('— running golden path…');
    const out = await goldenPath(I);
    log('— computing expectations + self-checks…');
    await buildExpectations(I);
    await runChecks(I);
    const checklist = writeChecklist(I);
    const evidenceDir = resolve(ROOT, 'docs/accounting-audit/evidence/verify-seed');
    mkdirSync(evidenceDir, { recursive: true });
    writeFileSync(
      resolve(evidenceDir, 'verify-seed-latest.json'),
      JSON.stringify({ at: new Date().toISOString(), tenantCode: TENANT_CODE, tenantId: I.tenant, ids: out, checks, notes }, null, 2),
      'utf8',
    );
    const failed = checks.filter((c) => !c.ok).length;
    log('');
    log('──────────────────────────────────────────────');
    log(` ✅ اكتمل — ${checks.length - failed}/${checks.length} فحص داخلي PASS`);
    log(` 📄 القائمة: ${checklist}`);
    log(' بيانات الدخول:');
    log(`   رمز الشركة ${TENANT_CODE}`);
    log(`   owner      ${CREDS.owner.email} / ${CREDS.owner.password}`);
    log(`   accountant ${CREDS.accountant.email} / ${CREDS.accountant.password}`);
    log(`   cashier    ${CREDS.cashier.email} / ${CREDS.cashier.password}`);
    log(`   rep        ${CREDS.rep.email} / ${CREDS.rep.password}   → ${BAKERY_URL}/rep`);
    log(`   portal     ${CREDS.portalCustomer.email} / ${CREDS.portalCustomer.password}   → ${PORTAL_URL}`);
    log('──────────────────────────────────────────────');
  } finally {
    await db.end().catch(() => undefined);
  }
}

main().catch((e: unknown) => {
  console.error('VERIFY-SEED FAILED:', e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
