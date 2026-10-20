import { createHash, timingSafeEqual } from 'node:crypto';

import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodError, z } from 'zod';
import { env } from '@erp/config';
import { DomainError } from '@erp/contracts';

import { Public } from '../decorators/public.decorator.js';

import { recordServerProblem, type ServerProblemInput } from './problem-recorder.js';

/**
 * استقبال أخطاء السيرفرات الأخرى — البند 3: «أي خطأ من جانب السيرفر في كل السيرفرات».
 *
 * الـAPI يكتب أخطاءه بنفسه (فلتر الاستثناءات + معالجات العملية). أمّا سيرفرات Next
 * (staff · platform-admin · marketing · customer-portal · bakery) فترسل تقريرها هنا عبر
 * `onRequestError`، ويُقبل التقرير برمزٍ مشترك (`PROBLEM_REPORT_TOKEN`) لا بجلسة مستخدم:
 * خطأٌ في الخادم ليس فعلاً ينسبه أحد.
 *
 * والمسار عامٌّ من ناحية المصادقة (`@Public`) لأن النداء يأتي من عمليةٍ لا تحمل توكن؛
 * والحماية برمزٍ مشترك يُقارن بزمنٍ ثابت. وإن لم يُضبط الرمز فالمسار **مغلق** (404)، فلا
 * يُفتح بابُ كتابةٍ في السجلّ لمجرّد أن الميزة مضبوطة في الكود.
 */
@ApiTags('platform-problems')
@Controller('platform/problems')
export class ProblemIngestController {
  @Post('ingest')
  @Public()
  @HttpCode(202)
  @ApiHeader({ name: 'x-problem-token', required: true })
  @ApiOperation({ summary: 'Accept a server-side error report from another surface' })
  async ingest(
    @Headers('x-problem-token') token: string | undefined,
    @Body() body: unknown,
  ): Promise<{ data: { accepted: true } }> {
    assertToken(token);
    let input: ServerProblemInput;
    try {
      const parsed = ingestSchema.parse(body);
      input = {
        source: parsed.source,
        severity: parsed.severity,
        code: parsed.code ?? null,
        message: parsed.message,
        path: parsed.path ?? null,
        method: parsed.method ?? null,
        status: parsed.status ?? null,
        traceId: parsed.traceId ?? null,
        tenantId: parsed.tenantId ?? null,
        actorUserId: parsed.actorUserId ?? null,
        meta: parsed.meta ?? {},
      };
    } catch (error) {
      if (error instanceof ZodError) {
        throw new DomainError('INVALID_PROBLEM_REPORT', 'تقرير الخطأ غير صالح', 422, {
          issues: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
        });
      }
      throw error;
    }
    await recordServerProblem(input);
    return { data: { accepted: true } };
  }
}

const ingestSchema = z.object({
  source: z.enum(['api', 'staff', 'platform-admin', 'marketing', 'customer-portal', 'bakery', 'worker']).default('api'),
  severity: z.enum(['error', 'warning']).default('error'),
  code: z.string().max(120).nullable().optional(),
  message: z.string().trim().min(1).max(4000),
  path: z.string().max(1000).nullable().optional(),
  method: z.string().max(12).nullable().optional(),
  status: z.number().int().min(100).max(599).nullable().optional(),
  traceId: z.string().max(120).nullable().optional(),
  tenantId: z.string().uuid().nullable().optional(),
  actorUserId: z.string().uuid().nullable().optional(),
  meta: z.record(z.unknown()).optional(),
});

function assertToken(token: string | undefined): void {
  const expected = env.PROBLEM_REPORT_TOKEN;
  if (!expected || expected.length < 16) {
    throw new DomainError('PROBLEM_INGEST_DISABLED', 'استقبال تقارير الأخطاء غير مُهيّأ على هذا الخادم', 404);
  }
  const given = token ?? '';
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  if (!timingSafeEqual(a, b)) {
    throw new DomainError('PROBLEM_INGEST_FORBIDDEN', 'رمز تقرير الأخطاء غير صحيح', 401);
  }
}
