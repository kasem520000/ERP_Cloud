import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { env } from '@erp/config';
import { withPlatformAdminTx } from '@erp/database';
import type { PlatformProblemsResponse } from '@erp/contracts';

import {
  configureProblemRecorder,
  recordServerProblem,
} from '../src/modules/platform/admin/problem-recorder.js';

import { createActor, type Actor, type ActorOptions } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * البند 3 من قائمة 20 أكتوبر — «سجلّ الأخطاء يسجّل أي خطأ من جانب السيرفر في كل السيرفرات».
 *
 * ما يُقاس هنا هو ما لا تراه بقية الاختبارات: الأخطاء التي **لا** يملكها فلتر استثناء —
 * استثناءٌ في مسارٍ بلا جدول، وعطبٌ في سيرفر Next آخر يُبلَّغ عبر مسار الاستقبال. والشاشة
 * التي تقرأها هي «سجلّ المشاكل» نفسها، فتُقاس من طرفها: صفٌّ يُكتب ثم يظهر.
 */
type OperatorOptions = ActorOptions & { platformRoles?: readonly string[] };
const createOperator = createActor as (ctx: TestApp, options: OperatorOptions) => Promise<Actor>;

describe('server problem log (batch 20 Oct · item 3)', () => {
  let ctx: TestApp;
  let operator: Actor;

  const base = '/api/v1';

  const countRows = async (): Promise<number> =>
    withPlatformAdminTx(ctx.handle.db, async (tx) => {
      const result = await tx.execute(sql`SELECT count(*)::int AS n FROM platform_problem_events`);
      return Number((result.rows[0] as { n: number }).n);
    });

  const problems = async (actor: Actor, filter = '') =>
    api(ctx.server, 'get', `${base}/platform/problems?limit=50${filter}`, { token: actor.token });

  beforeAll(async () => {
    ctx = await createTestApp('platform-problems');
    // `platform_owner` يحمل `console.health.view` (سجلّ المشاكل تشخيصُ صحةٍ لا سجلُّ أفعال).
    operator = await createOperator(ctx, {
      tenantCode: 'p-problems-console',
      email: 'ops@p-problems-console.test',
      permissions: [],
      roleNames: ['Console'],
      platformRoles: ['platform_owner'],
    });
    configureProblemRecorder(ctx.handle);
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('كاتب السجلّ يُدرج صفّاً، ويكتم التكرار خلال النافذة', async () => {
    const before = await countRows();
    await recordServerProblem({
      source: 'api',
      severity: 'error',
      code: 'TEST_BOOM',
      message: 'انفجارٌ في اختبار السجلّ',
      path: '/api/v1/spec/boom',
      method: 'POST',
      status: 500,
      meta: { stack: 'at spec' },
    });
    expect(await countRows()).toBe(before + 1);

    // البصمة نفسها داخل ٦٠ ثانية: لا صفّ ثانٍ — وإلا امتلأ السجلّ بسطرٍ واحدٍ مكرّر.
    await recordServerProblem({
      source: 'api',
      severity: 'error',
      code: 'TEST_BOOM',
      message: 'انفجارٌ في اختبار السجلّ',
      path: '/api/v1/spec/boom',
      method: 'POST',
      status: 500,
    });
    expect(await countRows()).toBe(before + 1);

    // مسارٌ مختلف بصمةٌ مختلفة: يُكتب.
    await recordServerProblem({
      source: 'api',
      message: 'انفجارٌ في اختبار السجلّ',
      path: '/api/v1/spec/other',
    });
    expect(await countRows()).toBe(before + 2);
  });

  it('سجلّ المشاكل يعرضها كمصدر «أخطاء السيرفر» مع تلميحٍ ووجهة', async () => {
    const response = await problems(operator, '&filter[source]=server');
    expect(response.status).toBe(200);
    const body = (response.body as { data: PlatformProblemsResponse }).data;
    expect(body.counts.bySource.server).toBeGreaterThanOrEqual(2);
    const row = body.rows.find((entry) => entry.title.includes('TEST_BOOM'));
    expect(row).toBeDefined();
    expect(row?.severity).toBe('error');
    expect(row?.detail).toContain('/api/v1/spec/boom');
    expect(row?.hint).toContain('الخادم');
    expect(row?.href).toContain('source]=server');

    const eventId = row!.key.replace(/^server:/, '');
    const detailRes = await api(ctx.server, 'get', `${base}/platform/problems/server/${eventId}`, {
      token: operator.token,
    });
    expect(detailRes.status).toBe(200);
    const detailData = (detailRes.body as { data: { id: string; code: string; path: string; meta: Record<string, unknown> } }).data;
    expect(detailData.id).toBe(eventId);
    expect(detailData.code).toBe('TEST_BOOM');
    expect(detailData.path).toBe('/api/v1/spec/boom');
    expect(detailData.meta.stack).toContain('at spec');

    const delRes = await api(ctx.server, 'delete', `${base}/platform/problems/server/${eventId}`, {
      token: operator.token,
    });
    expect(delRes.status).toBe(200);
    expect((delRes.body as { data: { deleted: number } }).data.deleted).toBe(1);
  });

  it('استقبال تقارير Next لا يُقبل دون الرمز المضبوط', async () => {
    const token = env.PROBLEM_REPORT_TOKEN;
    const anonymous = await api(ctx.server, 'post', `${base}/platform/problems/ingest`, {
      body: { message: 'من سيرفر آخر' },
    });

    if (!token) {
      // بلا رمزٍ في البيئة: الباب مغلق تماماً — ليس مفتوحاً بلا مصادقة.
      expect(anonymous.status).toBe(404);
      expect((anonymous.body as { code: string }).code).toBe('PROBLEM_INGEST_DISABLED');
      return;
    }

    expect(anonymous.status).toBe(401);
    expect((anonymous.body as { code: string }).code).toBe('PROBLEM_INGEST_FORBIDDEN');

    const before = await countRows();
    const accepted = await api(ctx.server, 'post', `${base}/platform/problems/ingest`, {
      body: { source: 'staff', code: 'next.render', message: 'عطبٌ من لوحة الموظفين', path: '/sales' },
      headers: { 'x-problem-token': token },
    });
    expect(accepted.status).toBe(202);
    expect((accepted.body as { data: { accepted: boolean } }).data.accepted).toBe(true);
    expect(await countRows()).toBe(before + 1);
  });
});
