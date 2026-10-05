import { describe, expect, it } from 'vitest';

import { MetricsService } from './metrics.service.js';

describe('MetricsService', () => {
  it('renders Prometheus counters, latency buckets and business gauges', () => {
    const metrics = new MetricsService();
    metrics.observeHttp('GET', '/api/v1/sales', 200, 12);
    metrics.observeHttp('GET', '/api/v1/sales', 503, 80);
    metrics.recordEinvoiceFailure();
    metrics.addMigrationThroughput(42);
    const body = metrics.renderPrometheus();
    expect(body).toContain('erp_up 1');
    expect(body).toContain('erp_http_requests_total{method="GET",route="/api/v1/sales",status_class="5xx"} 1');
    expect(body).toContain('erp_einvoice_failures_total 1');
    expect(body).toContain('erp_migration_imported_rows_total 42');
  });
});
