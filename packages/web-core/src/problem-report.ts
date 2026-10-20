/**
 * أخطاء السيرفرات الأخرى تُبلَّغ إلى الـAPI — البند 3 من قائمة 20 أكتوبر.
 *
 * «سجلّ الأخطاء يجب أن يسجّل أي خطأ أو مشكلة من جانب السيرفر في كل السيرفرات.» والـAPI
 * يكتب أخطاءه بنفسه في `platform_problem_events`؛ أمّا سيرفرات Next (staff · platform-admin
 * · marketing · customer-portal · bakery) فتُبلّغ عبر `POST /platform/problems/ingest`،
 * لأن عمليةً أخرى لا تملك مقبض قاعدة البيانات ولا تحمل جلسة مستخدم.
 *
 * وثلاثة قيود تحكم هذا الملف:
 *   1. **لا يرمي أبداً** — تسجيل خطأٍ لا يجوز أن يصنع خطأً ثانياً، ولا أن يُسقط الردّ الأصلي.
 *   2. **مهلة قصيرة** — الردّ على المستخدم أسبق من تقرير عطله.
 *   3. **بلا رمز لا إرسال** — `PROBLEM_REPORT_TOKEN` غائب يعني أن الاستقبال مغلق؛ فلا نُنادي.
 */

export type ServerProblemSource =
  | 'api'
  | 'staff'
  | 'platform-admin'
  | 'marketing'
  | 'customer-portal'
  | 'bakery'
  | 'worker';

export type ServerProblemReport = {
  source: ServerProblemSource;
  severity?: 'error' | 'warning';
  code?: string | null;
  message: string;
  path?: string | null;
  method?: string | null;
  status?: number | null;
  traceId?: string | null;
  meta?: Record<string, unknown>;
};

export type ProblemIngestOptions = {
  /** جذر الـAPI بما فيه `/api/v1` — بلا شرطة أخيرة. */
  baseUrl: string;
  token: string;
  timeoutMs?: number;
};

/** الحمولة كما يقرأها `ProblemIngestController` حرفاً. */
export function toIngestBody(report: ServerProblemReport): Record<string, unknown> {
  return {
    source: report.source,
    severity: report.severity ?? 'error',
    code: report.code ?? null,
    message: report.message.slice(0, 4000),
    path: report.path ?? null,
    method: report.method ?? null,
    status: report.status ?? null,
    traceId: report.traceId ?? null,
    meta: report.meta ?? {},
  };
}

export async function postServerProblem(
  report: ServerProblemReport,
  options: ProblemIngestOptions,
): Promise<boolean> {
  try {
    const response = await fetch(`${options.baseUrl.replace(/\/+$/, '')}/platform/problems/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-problem-token': options.token },
      body: JSON.stringify(toIngestBody(report)),
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? 2500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * جذر الـAPI من ترويسات الطلب الفاشل — استدعاءُ الخادم لنفسه عبر المسار الذي يملك
 * إعادةَ التوجيه (`/api/v1` → الـAPI). يُفضَّل عليه `PROBLEM_INGEST_URL` المطلق في النشر،
 * لأن خلف الوسيط قد لا يستطيع الوصول إلى اسمه العام من الداخل.
 */
export function apiBaseFromHeaders(headers: Record<string, string | string[] | undefined>): string | null {
  const explicit = (process.env.PROBLEM_INGEST_URL ?? '').trim();
  if (explicit.length > 0) return explicit.replace(/\/+$/, '');
  const host = first(headers['x-forwarded-host']) ?? first(headers.host);
  if (!host) return null;
  const proto = first(headers['x-forwarded-proto']) ?? 'http';
  return `${proto}://${host}/api/v1`;
}

function first(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.split(',')[0]?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : undefined;
}

/** رسالة الاستثناء كما تُقرأ في صفّ السجلّ — ومكدّسٌ مختصر للسياق. */
export function describeThrown(error: unknown): { message: string; meta: Record<string, unknown> } {
  if (error instanceof Error) {
    return {
      message: error.message || error.name,
      meta: {
        name: error.name,
        stack: (error.stack ?? '').split('\n').slice(0, 10).join('\n'),
      },
    };
  }
  return { message: String(error).slice(0, 4000), meta: {} };
}
