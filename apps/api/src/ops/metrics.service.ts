import { Injectable } from '@nestjs/common';

type RouteKey = `${string} ${string}`;

type RouteMetric = {
  count: number;
  errors: number;
  totalMs: number;
  buckets: Map<number, number>;
};

const latencyBuckets = [5, 10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, Number.POSITIVE_INFINITY];

@Injectable()
export class MetricsService {
  /** متى أقلعت العملية — تقرؤه صفحة الصحة فيُقرأ لا يُخمَّن. */
  readonly startedAt = Date.now();
  private readonly routes = new Map<RouteKey, RouteMetric>();
  private einvoiceFailures = 0;
  private migrationImportedRows = 0;

  observeHttp(method: string, route: string, statusCode: number, durationMs: number): void {
    const key = `${method.toUpperCase()} ${route}` as RouteKey;
    const metric = this.routes.get(key) ?? {
      count: 0,
      errors: 0,
      totalMs: 0,
      buckets: new Map(latencyBuckets.map((bucket) => [bucket, 0])),
    };
    metric.count += 1;
    metric.totalMs += durationMs;
    if (statusCode >= 500) metric.errors += 1;
    for (const bucket of latencyBuckets) {
      if (durationMs <= bucket) metric.buckets.set(bucket, (metric.buckets.get(bucket) ?? 0) + 1);
    }
    this.routes.set(key, metric);
  }

  /**
   * P-C9 — ملخّص الطلبات لصفحة «صحة النظام»: العدد · 5xx · نسبتها · وp95.
   *
   * الدلاء موجودة أصلاً (كل استدعاء `observeHttp` يوزّعه عليها)، فالـp95 هنا **قراءةٌ لما
   * قيس** لا تقديرٌ من متوسّط. و«أقلّ دلواً يبلغ 95٪» هو تعريف توزيعيّ غير معلمي، وهو ما
   * يمكن قوله بصدقٍ من دلاءٍ تراكمية بلا تخزين كل زمنٍ على حدة.
   */
  requestSummary(): { count: number; errors: number; errorRate: number; p95Ms: number } {
    let count = 0;
    let errors = 0;
    let p95Ms = 0;
    for (const metric of this.routes.values()) {
      count += metric.count;
      errors += metric.errors;
      if (metric.count === 0) continue;
      const target = metric.count * 0.95;
      let cumulative = 0;
      for (const bucket of latencyBuckets) {
        cumulative += metric.buckets.get(bucket) ?? 0;
        if (cumulative >= target) {
          p95Ms = Math.max(p95Ms, bucket === Number.POSITIVE_INFINITY ? 0 : bucket);
          break;
        }
      }
    }
    return {
      count,
      errors,
      errorRate: count === 0 ? 0 : errors / count,
      p95Ms,
    };
  }

  recordEinvoiceFailure(): void {
    this.einvoiceFailures += 1;
  }
  addMigrationThroughput(rows: number): void {
    this.migrationImportedRows += rows;
  }

  renderPrometheus(): string {
    const lines = [
      '# HELP erp_up Process liveness gauge.',
      '# TYPE erp_up gauge',
      'erp_up 1',
      '# HELP erp_process_uptime_seconds Process uptime in seconds.',
      '# TYPE erp_process_uptime_seconds gauge',
      `erp_process_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`,
      '# HELP erp_http_requests_total HTTP request count by route and status class.',
      '# TYPE erp_http_requests_total counter',
      '# HELP erp_http_request_duration_ms_sum Total observed HTTP latency in milliseconds.',
      '# TYPE erp_http_request_duration_ms_sum counter',
      '# HELP erp_http_request_duration_ms_bucket Cumulative HTTP latency buckets in milliseconds.',
      '# TYPE erp_http_request_duration_ms_bucket histogram',
    ];
    for (const [key, metric] of this.routes) {
      const [method, ...pathParts] = key.split(' ');
      const route = pathParts.join(' ');
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}"`;
      lines.push(
        `erp_http_requests_total{${labels},status_class="2xx_3xx_4xx"} ${metric.count - metric.errors}`,
      );
      lines.push(`erp_http_requests_total{${labels},status_class="5xx"} ${metric.errors}`);
      lines.push(`erp_http_request_duration_ms_sum{${labels}} ${metric.totalMs.toFixed(3)}`);
      lines.push(`erp_http_request_duration_ms_count{${labels}} ${metric.count}`);
      for (const bucket of latencyBuckets)
        lines.push(
          `erp_http_request_duration_ms_bucket{${labels},le="${bucket === Number.POSITIVE_INFINITY ? '+Inf' : bucket}"} ${metric.buckets.get(bucket) ?? 0}`,
        );
    }
    lines.push(
      '# HELP erp_queue_depth Outbox queue depth placeholder by queue/status; tenant-scoped counts are exposed via /jobs/health.',
    );
    lines.push('# TYPE erp_queue_depth gauge');
    lines.push('erp_queue_depth{queue="outbox",status="pending"} 0');
    lines.push('# HELP erp_einvoice_failures_total E-invoice submission failures recorded by adapters.');
    lines.push('# TYPE erp_einvoice_failures_total counter');
    lines.push(`erp_einvoice_failures_total ${this.einvoiceFailures}`);
    lines.push(
      '# HELP erp_migration_imported_rows_total Migration throughput rows imported by migration runs.',
    );
    lines.push('# TYPE erp_migration_imported_rows_total counter');
    lines.push(`erp_migration_imported_rows_total ${this.migrationImportedRows}`);
    return `${lines.join('\n')}\n`;
  }
}

function escapeLabel(value: string | undefined): string {
  return String(value ?? '')
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"');
}
