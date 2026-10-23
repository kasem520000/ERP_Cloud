// R33 report sweep — every report in the catalog is called once with the catalog's own parameter list
// (a full-year window, defaults elsewhere) and once with no parameters; anything that is not 2xx/4xx is a
// broken query (ACC-182 class). Read-only. Run: R32_OUT=docs/accounting-audit/evidence/round-33 R33_RUN=NN node docs/accounting-audit/scripts/round33-report-sweep.cjs
const L = require('./round32-lib.cjs');
const fs = require('fs');
const RUN = process.env.R33_RUN || '33';
(async () => {
  const cat = await L.api(null, 'GET', '/reports');
  const reports = (cat.data && (cat.data.reports || cat.data)) || cat.body;
  const list = Array.isArray(reports) ? reports : (reports.data || []);
  console.log('catalog:', cat.status, 'reports:', list.length);
  const results = [];
  for (const r of list) {
    const params = (r.params || []).map((p) => p.key || p.name || p);
    const q = new URLSearchParams();
    for (const key of params) {
      if (key === 'from' || key === 'fromDate' || key === 'dateFrom') q.set(key, '2026-01-01');
      else if (key === 'to' || key === 'toDate' || key === 'dateTo' || key === 'asOf' || key === 'asOfDate') q.set(key, '2026-12-31');
      else if (key === 'year') q.set(key, '2026');
      else if (key === 'month') q.set(key, '11');
    }
    const withParams = await L.api(null, 'GET', `/reports/${r.key}?${q.toString()}`);
    const bare = await L.api(null, 'GET', `/reports/${r.key}`);
    const rows = (x) => (x.data && Array.isArray(x.data.rows) ? x.data.rows.length : null);
    const entry = { key: r.key, title: r.titleAr, group: r.group, params, withParams: { status: withParams.status, rows: rows(withParams), code: withParams.body && withParams.body.code }, bare: { status: bare.status, rows: rows(bare), code: bare.body && bare.body.code } };
    results.push(entry);
    const bad = entry.withParams.status >= 500 || entry.bare.status >= 500;
    if (bad) console.log('FAIL', r.key, JSON.stringify(entry.withParams), JSON.stringify(entry.bare));
  }
  const five = results.filter((e) => e.withParams.status >= 500 || e.bare.status >= 500);
  const fourTwoTwo = results.filter((e) => e.withParams.status === 422 || e.withParams.status === 400);
  fs.writeFileSync(L.out + `/R33-report-sweep-${RUN}.json`, JSON.stringify(results, null, 2));
  console.log(`\nR33 report sweep: ${results.length} reports — 5xx: ${five.length} [${five.map((e) => e.key).join(', ')}] — 4xx with params: ${fourTwoTwo.length} [${fourTwoTwo.map((e) => e.key + ':' + (e.withParams.code || e.withParams.status)).join(', ')}]`);
  const summary = results.map((e) => `${e.key}: ${e.withParams.status}/${e.withParams.rows ?? '-'} | bare ${e.bare.status}/${e.bare.rows ?? '-'}`);
  console.log(summary.join('\n'));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
