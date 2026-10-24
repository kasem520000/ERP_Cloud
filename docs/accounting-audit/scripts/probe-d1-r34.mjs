/**
 * R34 / MISSING_FEATURES D1 — استكشاف حيّ على بيئة verify2026 (API:3000) يتحقق من:
 *   ACC-105: اشتقاق due_date (حقل مباشر + أيام الطريقة)، شرائح الأعمار من الاستحقاق،
 *   الحظر الائتماني422 (والنقد كلياً يمر)، تعبئة الاستحقاق لفواتير البذور القائمة.
 * التشغيل: node docs/accounting-audit/scripts/probe-d1-r34.mjs
 */
const API = process.env.API_URL ?? 'http://127.0.0.1:3000/api/v1';
const CREDS = { tenantCode: 'verify2026', email: 'owner@verify2026.test', password: 'Mstr-Qz7-2026$Local' };
const iso = (d) => d.toISOString().slice(0, 10);
const plus = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
const results = [];
let failures = 0;
const check = (id, ok, detail) => { results.push(`${ok ? 'PASS' : 'FAIL'} ${id} — ${detail}`); if (!ok) failures++; };
let token = '';
const call = async (method, path, body) => {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j, data: j?.data ?? j };
};
const main = async () => {
  // 1 — دخول المالك
  const login = await call('POST', '/auth/login', CREDS);
  token = login.data?.accessToken ?? login.body?.accessToken ?? '';
  check('L01', Boolean(token), `login owner → ${login.status}`);

  // 2 — بطاقة عميل بمدة45 صريحة
  const custName = `عميل مدة45 D1-${Date.now()}`;
  const cust = await call('POST', '/parties', { kind: 'customer', name: custName, paymentTermsDays: 45 });
  check('P01', cust.status < 300 && cust.data.paymentTermsDays === 45, `POST /parties paymentTermsDays=45 → ${cust.status} (${cust.data?.paymentTermsDays})`);

  const branches = await call('GET', '/branches');
  const warehouses = await call('GET', '/warehouses');
  const locations = await call('GET', '/cash-locations');
  const items = await call('GET', '/organization/catalog/items?limit=5');
  const branchId = branches.data?.[0]?.id ?? branches.data?.rows?.[0]?.id;
  const warehouseId = warehouses.data?.[0]?.id ?? warehouses.data?.rows?.[0]?.id;
  const safeId = locations.data?.[0]?.id ?? locations.data?.rows?.[0]?.id;
  const itemId = items.data?.[0]?.id ?? items.data?.rows?.[0]?.id;
  check('R01', Boolean(branchId && warehouseId && safeId && itemId), `scope branch=${branchId} wh=${warehouseId} safe=${safeId} item=${itemId}`);

  // 3 — فاتورة آجلة مشتقّ استحقاقها من المدة
  const inv = await call('POST', '/sales/invoices', {
    branchId, warehouseId, partyId: cust.data.id, kind: 'sale', priceIncludesVat: false,
    lines: [{ quantity: '2', unitPrice: '20', taxRate: '15' }],
  });
  const due = inv.data?.dueDate;
  check('D01', inv.status < 300 && due === plus(45), `create sales invoice → ${inv.status}; dueDate=${due} (expected ${plus(45)})`);
  const posted = await call('POST', `/sales/invoices/${inv.data?.id}/post`, {});
  check('D02', posted.status < 300 && posted.data?.status === 'posted', `post → ${posted.status} status=${posted.data?.status}`);

  // 4 — أعمارٌ تُصفّ من الاستحقاق: إلى تاريخٍ بعد40 يوماً عمر القيد40 والاستحقاق لم يأتِ
  const aging = await call('GET', `/reports/ar-aging?from=${new Date().getUTCFullYear()}-01-01&to=${plus(40)}`);
  const rows = Array.isArray(aging.data) ? aging.data : (aging.data?.rows ?? []);
  const row = rows.find((r) => r.party === custName);
  check('A01', aging.status === 200 && row && Number(row.bucket_0_30) >= 46 && Number(row.bucket_31_60) === 0,
    `ar-aging@+40 → bucket_0_30=${row?.bucket_0_30} bucket_31_60=${row?.bucket_31_60} (>=46/0 = due-based)`);

  // 5 — الحظر الائتماني: آجل مرفوض، نقدي كلياً يمر، الرفع يُطلق المسودة
  const hold = await call('PUT', `/parties/${cust.data.id}`, { creditHold: true });
  check('H01', hold.status === 200 && hold.data.creditHold === true, `PUT creditHold=true → ${hold.status}`);
  const blocked = await call('POST', '/sales/invoices', {
    branchId, warehouseId, partyId: cust.data.id, kind: 'sale', priceIncludesVat: false,
    lines: [{ quantity: '1', unitPrice: '20', taxRate: '15' }],
  });
  const blockedPost = await call('POST', `/sales/invoices/${blocked.data?.id}/post`, {});
  check('H02', blockedPost.status === 422 && JSON.stringify(blockedPost.body).includes('PARTY_CREDIT_HOLD'),
    `credit post while held → ${blockedPost.status} ${(blockedPost.body?.code ?? '')}`);
  const cash = await call('POST', '/sales/invoices', {
    branchId, warehouseId, partyId: cust.data.id, kind: 'sale', priceIncludesVat: false,
    lines: [{ quantity: '1', unitPrice: '20', taxRate: '15' }],
    autoPost: true, settlement: 'cash', settlementCashLocationId: safeId,
  });
  check('H03', cash.status < 300 && cash.data?.status === 'posted', `full cash sale while held → ${cash.status} status=${cash.data?.status}`);
  await call('PUT', `/parties/${cust.data.id}`, { creditHold: false });
  const released = await call('POST', `/sales/invoices/${blocked.data?.id}/post`, {});
  check('H04', released.status < 300 && released.data?.status === 'posted', `after lifting the hold → ${released.status}`);

  // 6 — فاتورة شراء بمدة مورد30
  const supp = await call('POST', '/parties', { kind: 'supplier', name: 'مورد مدة30 D1', paymentTermsDays: 30 });
  const pi = await call('POST', '/purchase-invoices', {
    branchId, warehouseId, partyId: supp.data.id, kind: 'purchase', priceIncludesVat: false,
    lines: [{ itemId, quantity: '1', unitPrice: '12', taxRate: '15' }],
  });
  check('P02', pi.status < 300 && pi.data?.dueDate === plus(30), `purchase invoice status=${pi.status} dueDate=${pi.data?.dueDate} (expected ${plus(30)})`);

  // 7 — اشتقاق على بيانات البذور الحقيقية: فاتورة «عميل التحقق الآجل» (VRF-NET30 =30 يوماً)
  const seedList = await call('GET', '/sales/invoices');
  const seedRows = Array.isArray(seedList.data) ? seedList.data : (seedList.data?.rows ?? []);
  const seedCredit = seedRows.find((r) => r.number === 'SI-000002');
  check('B01', Boolean(seedCredit?.dueDate), `seed NET30 invoice ${seedCredit?.number ?? ''} dueDate=${seedCredit?.dueDate ?? 'NULL'}`);
  const seedCash = seedRows.find((r) => r.number === 'SI-000001');
  check('B02', seedCash?.dueDate == null, `seed cash invoice ${seedCash?.number ?? ''} dueDate=${seedCash?.dueDate ?? 'NULL'} (بلا مدة = NULL والعمار من القيد)`);

  console.log(results.join('\n'));
  console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILED`} (${results.length} checks)`);
  process.exitCode = failures === 0 ? 0 : 1;
};
main().catch((e) => { console.error(results.join('\n')); console.error('PROBE ERROR', e); process.exitCode = 2; });
