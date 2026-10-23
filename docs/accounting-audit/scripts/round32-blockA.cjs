// R32 Block A — API/DB retest of root-cause fixes on the merged remediation code (LOCAL AUDIT-TEST-2026-R24 tenant only).
// J1 collections (ACC-006/031, ACC-159 + suspected double posting), J8 numbering/concurrency (ACC-100, ACC-025),
// J4 period/date/module locks (ACC-024/070, ACC-053/097), J1 voucher void (ACC-009/029), J2 party stamping (ACC-004/142),
// ACC-123 tolerance, ACC-141 manual JE status, ACC-105 due date, ACC-049/090 allocation guards.
// Every write is an API call (no UI screen) — evidence = request/response JSON + REPEATABLE READ DB snapshots.
const { api, race, db, one, snapshot, remember, ids, stages } = require('./round32-lib.cjs');
const TODAY = new Date().toISOString().slice(0, 10);
const mem = (k, val) => remember('R32-A-ids.json', k, val);
const M = () => remember('R32-A-ids.json');
let ID;

async function createAndPostInvoice(tag, body, settlement = 'credit') {
  const c = await api(`R32-${tag}-create`, 'POST', '/sales/invoices', body);
  if (c.status !== 201) throw new Error(`${tag} create ${c.status}: ${JSON.stringify(c.body).slice(0, 200)}`);
  const p = await api(`R32-${tag}-post`, 'POST', `/sales/invoices/${c.data.id}/post`, { settlement });
  if (![200, 201].includes(p.status)) throw new Error(`${tag} post ${p.status}: ${JSON.stringify(p.body).slice(0, 300)}`);
  mem(tag, { id: c.data.id, number: p.data?.number ?? c.data.number, total: p.data?.total ?? c.data.total });
  return p.data ?? c.data;
}

(async () => {
  ID = await ids();
  await stages('R32-A', [
    ['A01-setup-item-stock', async () => {
      const item = await api('R32-A01-item', 'POST', '/organization/catalog/items', { sku: 'R32-ITEM', nameAr: 'صنف R32', nameEn: 'Item R32', categoryId: ID.category, kind: 'stock', baseUnitId: ID.unit, taxGroupId: ID.vat15, purchasePrice: '10.0000', salePrice: '50.0000', trackLot: false });
      const itemId = item.data?.id ?? (await one("select id from items where tenant_id=$1 and sku='R32-ITEM'", [ID.tenant]))?.id;
      if (!itemId) throw new Error('item create failed ' + item.status + ' ' + JSON.stringify(item.body).slice(0, 200));
      mem('item', itemId);
      const sv = await api('R32-A01-stockin', 'POST', '/inventory/vouchers', { branchId: ID.branch, warehouseId: ID.whMain, kind: 'stock_in', voucherDate: TODAY, reason: 'R32 opening stock', lines: [{ itemId, qty: '100', unitCost: '10.0000' }] });
      if (sv.status !== 201) throw new Error('stock-in create ' + sv.status + ' ' + JSON.stringify(sv.body).slice(0, 200));
      const post = await api('R32-A01-stockin-post', 'POST', `/inventory/vouchers/${sv.data.id}/post`, {});
      if (![200, 201].includes(post.status)) throw new Error('stock-in post ' + post.status + ' ' + JSON.stringify(post.body).slice(0, 200));
      mem('stockin', sv.data.id);
      snapshot('R32-DB-001-after-setup');
    }],
    ['A02-credit-invoice-115', async () => {
      // 2 × 50 + 15 % = 115.00 credit invoice for CUST-GEN — the base document for J1/J2 probes
      await createAndPostInvoice('A02-SI1', { branchId: ID.branch, warehouseId: ID.whMain, partyId: ID.custGen, kind: 'sale', lines: [{ itemId: M().item, quantity: '2', unitPrice: '50.0000', taxGroupId: ID.vat15 }] });
      snapshot('R32-DB-002-after-SI1');
    }],
    ['A03-gateway-config', async () => {
      await api('R32-A03-neoleap-config', 'PUT', '/payment-gateways/neoleap', { active: true, simulation: true, merchantKey: 'R32-TRANPORTAL', merchantSecret: 'R32-NEOLEAP-TOKEN', currency: 'SAR' });
      await api('R32-A03-geidea-config', 'PUT', '/payment-gateways/geidea', { active: true, simulation: true, merchantKey: 'R32-GEIDEA-KEY', merchantSecret: 'R32-GEIDEA-SECRET', currency: 'SAR' });
    }],
    ['A04-ACC159-partial-card-50', async () => {
      // ACC-159 retest + suspected double posting: partial card settlement 50.00 of SI1 (115.00)
      const r = await api('R32-A04-neoleap-sale-50', 'POST', '/payment-gateways/neoleap/sale', { amount: '50.00', invoiceId: M()['A02-SI1'].id, reference: 'R32-NL-SI1-50' });
      mem('gw50', r.data);
      snapshot('R32-DB-003-after-gateway-50');
    }],
    ['A05-ACC159-no-invoice-sale-125', async () => {
      const r = await api('R32-A05-neoleap-sale-noinv', 'POST', '/payment-gateways/neoleap/sale', { amount: '125.00', reference: 'R32-NL-NOINV-125' });
      mem('gwNoInv', r.data);
      snapshot('R32-DB-004-after-gateway-noinvoice');
    }],
    ['A06-ACC031-addPayment-cash-10', async () => {
      const inv = M()['A02-SI1'].id;
      const r = await api('R32-A06-addpayment-cash-10', 'POST', `/sales/invoices/${inv}/payments`, { method: 'cash', amount: '10.00', cashLocationId: ID.safe, idempotencyKey: 'R32-A06-PAY-10' });
      const again = await api('R32-A06-addpayment-cash-10-replay', 'POST', `/sales/invoices/${inv}/payments`, { method: 'cash', amount: '10.00', cashLocationId: ID.safe, idempotencyKey: 'R32-A06-PAY-10' });
      mem('pay10', { first: r.status, replay: again.status });
      snapshot('R32-DB-005-after-addPayment-10');
    }],
    ['A07-ACC123-tolerance', async () => {
      // remaining on SI1 after 50 card + 10 cash = 55.00; pay 55.01 (tolerance 0.01 → accepted per fix) then 0.02 over must be rejected
      const inv = M()['A02-SI1'].id;
      const cur = await api('R32-A07-SI1-read', 'GET', `/sales/invoices/${inv}`);
      const remaining = (Number(cur.data.total) - Number(cur.data.paidTotal)).toFixed(2);
      mem('remainingBeforeA07', remaining);
      const over2 = await api('R32-A07-pay-over-0.02', 'POST', `/sales/invoices/${inv}/payments`, { method: 'cash', amount: (Number(remaining) + 0.02).toFixed(2), cashLocationId: ID.safe, idempotencyKey: 'R32-A07-OVER-2' });
      const over1 = await api('R32-A07-pay-over-0.01', 'POST', `/sales/invoices/${inv}/payments`, { method: 'cash', amount: (Number(remaining) + 0.01).toFixed(2), cashLocationId: ID.safe, idempotencyKey: 'R32-A07-OVER-1' });
      mem('tolerance', { over2: over2.status, over1: over1.status });
      snapshot('R32-DB-006-after-tolerance');
    }],
    ['A08-ACC025-concurrent-voucher-post', async () => {
      const c = await api('R32-A08-voucher-create', 'POST', '/vouchers', { branchId: ID.branch, kind: 'receipt', subtype: 'customer', date: TODAY, partyId: ID.custGen, cashLocationId: ID.safe, method: 'cash', amount: '20.00', description: 'R32 receipt 20 (concurrency probe)' });
      if (c.status !== 201) throw new Error('voucher create ' + c.status + ' ' + JSON.stringify(c.body).slice(0, 200));
      mem('rv20', c.data.id);
      const results = await race('R32-A08-voucher-post-x3', [['POST', `/vouchers/${c.data.id}/post`, {}], ['POST', `/vouchers/${c.data.id}/post`, {}], ['POST', `/vouchers/${c.data.id}/post`, {}]]);
      mem('rv20post', results.map((r) => r.status));
      snapshot('R32-DB-007-after-concurrent-post');
    }],
    ['A09-ACC009-void-posted-voucher', async () => {
      const r = await api('R32-A09-voucher-void', 'POST', `/vouchers/${M().rv20}/void`, { reason: 'R32 void probe (ACC-009/029)' });
      mem('rv20void', r.status);
      snapshot('R32-DB-008-after-void');
    }],
    ['A10-ACC024-manual-JE-date-vs-period', async () => {
      const periods = await api('R32-A10-periods', 'GET', '/fiscal-periods');
      const list = periods.data?.results ?? periods.data ?? [];
      const open = list.filter((p) => p.status === 'open').sort((a, b) => a.startDate.localeCompare(b.startDate));
      const cur = open.find((p) => p.startDate <= TODAY && p.endDate >= TODAY);
      const other = open.find((p) => p.id !== cur?.id) || open[0];
      mem('periods', { cur: cur && { id: cur.id, s: cur.startDate, e: cur.endDate }, other: other && { id: other.id, s: other.startDate, e: other.endDate } });
      const lines = [{ accountId: ID.acc['1160002'] || Object.values(ID.acc)[0], debit: '1.0000', description: 'R32 date/period probe' }, { accountId: ID.acc['1211001'], credit: '1.0000', description: 'R32 date/period probe' }];
      // (a) today's date but a different open period id → expect 409 FISCAL_PERIOD_DATE_MISMATCH
      const mism = await api('R32-A10-je-period-mismatch', 'POST', '/journal-entries', { branchId: ID.branch, fiscalPeriodId: other.id, date: TODAY, description: 'R32 ACC-024 probe', lines });
      // (b) date inside a period that we close first → expect 409 FISCAL_PERIOD_CLOSED
      const closable = open.find((p) => p.endDate < TODAY) || null;
      let closed = null;
      if (closable) {
        closed = await api('R32-A10-close-period', 'POST', `/fiscal-periods/${closable.id}/close`, {});
        const inClosed = await api('R32-A10-je-in-closed-period', 'POST', '/journal-entries', { branchId: ID.branch, date: closable.startDate, description: 'R32 ACC-070 probe', lines });
        const bypass = await api('R32-A10-je-closed-date-open-period', 'POST', '/journal-entries', { branchId: ID.branch, fiscalPeriodId: cur.id, date: closable.startDate, description: 'R32 ACC-070 bypass probe', lines });
        mem('closedPeriod', { id: closable.id, closeStatus: closed.status, inClosed: inClosed.status, bypass: bypass.status });
      }
      mem('periodProbe', { mismatch: mism.status });
      snapshot('R32-DB-009-after-period-probes');
    }],
    ['A11-ACC053-module-lock', async () => {
      const cur = M().periods.cur;
      const lock = await api('R32-A11-lock-treasury', 'POST', `/fiscal-periods/${cur.id}/modules/treasury/lock`, {});
      const c = await api('R32-A11-voucher-create', 'POST', '/vouchers', { branchId: ID.branch, kind: 'receipt', subtype: 'customer', date: TODAY, partyId: ID.custGen, cashLocationId: ID.safe, method: 'cash', amount: '5.00', description: 'R32 module-lock probe' });
      const post = await api('R32-A11-voucher-post-locked', 'POST', `/vouchers/${c.data?.id}/post`, {});
      const unlock = await api('R32-A11-unlock-treasury', 'POST', `/fiscal-periods/${cur.id}/modules/treasury/unlock`, {});
      const lockSales = await api('R32-A11-lock-sales', 'POST', `/fiscal-periods/${cur.id}/modules/sales/lock`, {});
      const si = await api('R32-A11-SI-locked-create', 'POST', '/sales/invoices', { branchId: ID.branch, warehouseId: ID.whMain, partyId: ID.custGen, kind: 'sale', lines: [{ itemId: M().item, quantity: '1', unitPrice: '50.0000', taxGroupId: ID.vat15 }] });
      const siPost = await api('R32-A11-SI-locked-post', 'POST', `/sales/invoices/${si.data?.id}/post`, { settlement: 'credit' });
      const unlockSales = await api('R32-A11-unlock-sales', 'POST', `/fiscal-periods/${cur.id}/modules/sales/unlock`, {});
      mem('moduleLock', { lock: lock.status, voucherPostLocked: post.status, unlock: unlock.status, lockSales: lockSales.status, siPostLocked: siPost.status, unlockSales: unlockSales.status, lockedVoucher: c.data?.id, lockedSi: si.data?.id });
      snapshot('R32-DB-010-after-module-lock');
    }],
    ['A12-ACC100-second-branch-numbering', async () => {
      const br = await api('R32-A12-branch', 'POST', '/branches', { code: 'BR32', nameAr: 'فرع R32', nameEn: 'Branch R32' });
      const brId = br.data?.id ?? (await one("select id from branches where tenant_id=$1 and code='BR32'", [ID.tenant]))?.id;
      const wh = await api('R32-A12-warehouse', 'POST', '/warehouses', { branchId: brId, code: 'WH32', name: 'مستودع R32' });
      const whId = wh.data?.id ?? (await one("select id from warehouses where tenant_id=$1 and code='WH32'", [ID.tenant]))?.id;
      const safe = await api('R32-A12-safe', 'POST', '/cash-locations', { branchId: brId, kind: 'safe', name: 'صندوق R32', accountId: ID.acc['1211001'], isDefault: true });
      mem('br32', { brId, whId, safeId: safe.data?.id });
      // purchase 1 × 20 + 15 % = 23 on credit in BR32, then a cash sale 1 × 50 + 15 % from WH32
      const pi = await api('R32-A12-PI-BR32-create', 'POST', '/purchase-invoices', { branchId: brId, warehouseId: whId, partyId: ID.suppGen, lines: [{ itemId: M().item, quantity: '1', unitPrice: '20.0000', taxGroupId: ID.vat15 }] });
      const piPost = pi.data?.id ? await api('R32-A12-PI-BR32-post', 'POST', `/purchase-invoices/${pi.data.id}/post`, {}) : { status: pi.status };
      const si = await api('R32-A12-SI-BR32-create', 'POST', '/sales/invoices', { branchId: brId, warehouseId: whId, partyId: ID.custGen, kind: 'sale', lines: [{ itemId: M().item, quantity: '1', unitPrice: '50.0000', taxGroupId: ID.vat15 }] });
      const siPost = si.data?.id ? await api('R32-A12-SI-BR32-post', 'POST', `/sales/invoices/${si.data.id}/post`, { settlement: 'credit' }) : { status: si.status };
      mem('br32docs', { pi: pi.status, piPost: piPost.status, piNumber: piPost.data?.number, si: si.status, siPost: siPost.status, siNumber: siPost.data?.number, piId: pi.data?.id, siId: si.data?.id });
      snapshot('R32-DB-011-after-BR32');
    }],
    ['A13-ACC141-ACC105-ACC049', async () => {
      // ACC-141: manual JE status on creation (policy record)
      const je = await api('R32-A13-manual-je', 'POST', '/journal-entries', { branchId: ID.branch, date: TODAY, description: 'R32 ACC-141 status probe', lines: [{ accountId: ID.acc['1160002'] || Object.values(ID.acc)[0], debit: '1.0000' }, { accountId: ID.acc['1211001'], credit: '1.0000' }] });
      mem('manualJe', { status: je.status, docStatus: je.data?.status, number: je.data?.number });
      // ACC-105: credit invoice with a payment method carrying dueDays → validUntil/dueDate expected
      const pms = await api('R32-A13-payment-methods', 'GET', '/payment-methods');
      const pmList = pms.data?.results ?? pms.data ?? [];
      mem('paymentMethods', pmList.map((p) => ({ id: p.id, code: p.code, name: p.nameAr ?? p.name, dueDays: p.dueDays })));
      // ACC-049/090: allocation guard — allocate more than the open amount of SI1 to a fresh posted voucher
      const inv = M()['A02-SI1'];
      const c = await api('R32-A13-rv-alloc-create', 'POST', '/vouchers', { branchId: ID.branch, kind: 'receipt', subtype: 'customer', date: TODAY, partyId: ID.custGen, cashLocationId: ID.safe, method: 'cash', amount: '500.00', description: 'R32 allocation guard probe' });
      const post = await api('R32-A13-rv-alloc-post-over', 'POST', `/vouchers/${c.data?.id}/post`, { allocations: [{ partyId: ID.custGen, invoiceKind: 'sales', invoiceId: inv.id, amount: '500.00' }] });
      mem('allocGuard', { create: c.status, postOver: post.status, code: post.body?.code ?? post.body?.error?.code, voucher: c.data?.id });
      snapshot('R32-DB-012-after-A13');
    }],
  ]);
})().catch((e) => { console.error(e); process.exit(1); });
