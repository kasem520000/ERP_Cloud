/**
 * تقرير أخطاء سيرفر `bakery` إلى سجلّ مشاكل المنصّة — البند 3.
 *
 * `onRequestError` يُستدعى لكل استثناءٍ في مسارٍ أو إجراءٍ أو RSC، وهو المكان الوحيد الذي
 * تراه Next Server ولا يراه أي فلترٍ في الـAPI. والتقرير يذهب إلى
 * `POST /platform/problems/ingest` برمزٍ مشترك، بلا انتظارٍ لنتيجة الإرسال.
 */
import type { Instrumentation } from 'next';
import { apiBaseFromHeaders, describeThrown, postServerProblem } from '@erp/web-core/problem-report';

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const token = (process.env.PROBLEM_REPORT_TOKEN ?? '').trim();
  if (token.length < 16) return; // الاستقبال مغلق: لا نُنادي بلا رمز.
  if (request.path.startsWith('/api/v1/platform/problems/ingest')) return; // لا حلقة.

  const baseUrl = apiBaseFromHeaders(request.headers);
  if (!baseUrl) return;

  const { message, meta } = describeThrown(error);
  await postServerProblem(
    {
      source: 'bakery',
      severity: 'error',
      code: `next.${context.routeType}`,
      message,
      path: request.path,
      method: request.method,
      meta: { ...meta, routePath: context.routePath, routerKind: context.routerKind },
    },
    { baseUrl, token },
  );
};
