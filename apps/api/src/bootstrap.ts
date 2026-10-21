import { RequestMethod, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import helmet from 'helmet';
import { env } from '@erp/config';
import { DomainError, createProblemDetails, errorCodes } from '@erp/contracts';

import { getTraceId } from './request-context/request-context.js';

/**
 * Shared HTTP configuration, used by both `main.ts` and the OpenAPI exporter so the
 * published document always describes the real pipeline.
 */
export function applyHttpConfiguration(app: INestApplication): void {
  // Express 4.20+/5 default to the `simple` query parser, which does not understand the
  // bracket syntax the contract documents (`filter[field]=`, API_ARCHITECTURE §3).
  const instance = app.getHttpAdapter().getInstance() as {
    set?: (key: string, value: unknown) => void;
    disable?: (name: string) => void;
  };
  instance.set?.('query parser', 'extended');
  instance.disable?.('x-powered-by');

  /**
   * `trust proxy` لا يُضبط إلا بقرارٍ من المشغّل (`TRUST_PROXY`).
   *
   * بلا هذا السطر كان الخادم خلف Nginx يرى عنوان الوكيل وحده، فتصير دلو الـIP واحداً
   * للجميع (يُقفل الخدمة على الجميع بحملٍ من عميلٍ واحد). وبضبطه بلا حذرٍ يصير
   * `X-Forwarded-For` قابلاً للتزوير فيتجاوز المهاجم الحدّ عناوينَ وهمية. فالقيمة
   * الافتراضية `''` تعني «لا تثق بأحد» — وهي الآمنة حين لا وكيل.
   */
  const trustProxy = env.TRUST_PROXY.trim();
  if (trustProxy.length > 0) {
    instance.set?.(
      'trust proxy',
      trustProxy === 'true' ? true : trustProxy === 'false' ? false : /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy,
    );
  }

  app.use(
    helmet({
      // الـAPI لا يقدّم HTML؛ لكن الترويسات تمنع تضمينه/قراءته من سياقٍ آخر لو أُضيفت صفحة.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      crossOriginOpenerPolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      // HSTS يُفعَّل حين تكون الخدمة خلف TLS؛ فرضُه في التطوير قد يحبس المتصفّح على http.
      hsts: env.NODE_ENV === 'production' ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  /**
   * سقف طول الرابط — قبل أي تحليلٍ للاستعلام.
   *
   * `qs` (الموسَّع) يكلّف وقتاً يتناسب مع حجم المدخل؛ رابطٌ بطول ميغابايت يُستهلك في
   * التحليل قبل أن يصل أي حارس. الرفض هنا 414 صريح، لا 500 من قلب المحلّل.
   */
  app.use((request: Request, response: Response, next: NextFunction) => {
    const url = request.originalUrl ?? request.url ?? '';
    if (url.length > env.MAX_URL_LENGTH) {
      // نفس عقد الأخطاء الذي ينتجه المعالج العام (RFC 9457) — لا صيغةً موازية تعرفها
      // الواجهة وحدها. و`getTraceId` قد لا يكون مضبوطاً قبل الوسيط، فنقرأ الترويسة.
      const headerId = request.headers['x-request-id'];
      const traceId =
        (typeof headerId === 'string' && headerId) || safeTraceId();
      const problem = createProblemDetails(
        new DomainError(
          errorCodes.URI_TOO_LONG,
          `Request URL exceeds the ${env.MAX_URL_LENGTH}-character limit`,
          414,
        ),
        traceId,
      );
      response.status(414).type('application/problem+json').send(JSON.stringify(problem));
      return;
    }
    next();
  });

  /**
   * حدود الجسم — صريحةٌ لا افتراضية.
   *
   * الافتراضي في Express 100 ك.ب وهو أصغر من احتياجات الاستيراد دفعةً واحدة؛ فنسجّل
   * المحلّلين هنا قبل `init()` بحدٍّ واحد مضبوط. الطلب الأكبر يُرفض 413 قبل أن يُقرأ
   * كاملاً — لا يُحجَز في الذاكرة.
   */
  const expressApp = app as unknown as NestExpressApplication;
  // ⚠️ التوقيع العامّ `useBodyParser(type, options)` — وسيطان لا ثلاثة. غلاف Nest يحقن
  // `rawBody` من خيارات التطبيق بينهما (`createNestApplication({ rawBody: true })`)، فتمرير
  // `true` هنا يزيح كائن الخيارات ويُسقط `limit` بصمت فتبقى حدود Express الافتراضية (100 ك.ب).
  // ومع `rawBody: true` يضع Nest `verify` الذي يملأ `request.rawBody` بالبايتات كما وصلت —
  // وهي ما يُحسب عليها توقيع الويب هوك.
  expressApp.useBodyParser?.('json', {
    limit: env.BODY_LIMIT_BYTES,
  });
  expressApp.useBodyParser?.('urlencoded', {
    limit: env.BODY_LIMIT_BYTES,
    extended: true,
  });

  const origins = env.CORS_ALLOWED_ORIGINS;
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'X-Branch-Id', 'Idempotency-Key'],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // الواجهة تقرأ هذه الترويسات لتشرح «متى أعيد المحاولة» بدل تخمين.
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After', 'X-Request-Id'],
    maxAge: 600,
  });

  // `/health/*` are ops endpoints and stay outside the versioned contract (PHASE_02 §7).
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
}

/**
 * مهل المقبس — الحماية من الإغراق بالاتصالات البطيئة (slowloris).
 *
 * القيم على كائن `http.Server` لا في Express، فتُختبر دالّةٌ نقيّة بدل تشغيل خادمٍ حقيقي:
 *   `headersTimeout` — من يبدأ الطلب ولا يُكمل ترويساته؛
 *   `requestTimeout` — الطلب كاملاً بما فيه قراءة الجسم؛
 *   `keepAliveTimeout` — فوق مهلة الوكيل المعتادة (60 ث) بثوانٍ، فلا يُقطع اتصالٌ يظنّه
 *     الوكيل حيّاً؛
 *   `maxHeadersCount` — سقف عدد الترويسات؛
 *   `maxRequestsPerSocket` — سقف الطلبات على اتصالٍ واحد.
 */
export type TimeoutAwareServer = {
  headersTimeout: number;
  requestTimeout: number;
  keepAliveTimeout: number;
  maxHeadersCount: number | null;
  maxRequestsPerSocket: number;
};

export function applyServerTimeouts(server: TimeoutAwareServer): void {
  server.headersTimeout = env.HTTP_HEADERS_TIMEOUT_MS;
  server.requestTimeout = env.HTTP_REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = 65_000;
  server.maxHeadersCount = 100;
  server.maxRequestsPerSocket = 1_000;
}

/** معرّف تتبّعٍ من السياق إن وُجد، وإلا معرّفٌ بديل — لا نُسقط الطلب لأن التتبّع غائب. */
function safeTraceId(): string {
  try {
    return getTraceId();
  } catch {
    return 'unknown';
  }
}

export function buildOpenApiDocument(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('ERP SaaS API')
    .setDescription(
      'Cloud multi-tenant ERP. Errors are RFC 9457 application/problem+json with a stable ' +
        '`code` from @erp/contracts. Tenant context always comes from the access token.',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .addApiKey({ type: 'apiKey', name: 'X-Branch-Id', in: 'header' }, 'branchScope')
    .addApiKey({ type: 'apiKey', name: 'Idempotency-Key', in: 'header' }, 'idempotencyKey')
    .build();

  return SwaggerModule.createDocument(app, config);
}

export function registerOpenApi(app: INestApplication, document: OpenAPIObject): void {
  if (!env.OPENAPI_ENABLED) return;
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/openapi.json',
  });
}
