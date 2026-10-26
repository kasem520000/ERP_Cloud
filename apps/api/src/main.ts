import 'reflect-metadata';

if (!process.env.TZ) {
  process.env.TZ = 'Asia/Riyadh';
}

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { assertRuntimeEnv, describeEnvSources, env, envIssues } from '@erp/config';
import { runMigrations } from '@erp/database';

import { AppModule } from './app.module.js';
import {
  applyHttpConfiguration,
  applyServerTimeouts,
  buildOpenApiDocument,
  isOpenApiEnabled,
  registerOpenApi,
} from './bootstrap.js';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware.js';
import { installProcessProblemHandlers } from './modules/platform/admin/process-problems.js';
import { WorkerRunner } from './modules/platform-services/index.js';

/**
 * Worker role — PHASE_04 §5.5: "worker bootstrap in apps/api behind flag `WORKER=1`".
 *
 * Same image, same DI graph, no HTTP listener: an application *context* rather than an
 * HTTP server. Running the consumers in-process during development is intentional; in
 * production this is a separate deployment of the same container with `WORKER=1` set.
 */
async function bootstrapWorker(): Promise<void> {
  assertRuntimeEnv();
  installProcessProblemHandlers('worker');

  const context = await NestFactory.createApplicationContext(AppModule, { bufferLogs: true });
  context.useLogger(context.get(Logger));

  const runner = context.get(WorkerRunner);
  await runner.start();
  // مؤقّتات `WorkerRunner` موسومة بـ`unref()` كي لا تمنع اختبارات الوحدة من الخروج؛
  // أمّا عملية `erp-worker` المستقلة فلا تملك مستمع HTTP، فتحتفظ بمقبض حيّ حتى تصل إشارة إيقاف.
  const keepAlive = setInterval(() => {}, 60_000);

  // إيقافٌ وحيدٌ متسلسل (بدون ازدواج `enableShutdownHooks` + `context.close()` الذي كان
  // يستدعي `pool.end()` مرّتين عند `SIGINT`/`SIGTERM` من PM2).
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(keepAlive);
    console.log(`erp-worker received ${signal}; draining`);
    try {
      await runner.stop();
    } catch {
      // ignore drain errors on exit
    }
    try {
      await context.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  console.log(`erp-worker started (${env.NODE_ENV})`);
}

async function bootstrap(): Promise<void> {
  // Say out loud where the configuration came from — the single most common support
  // question was "the API does not see my .env".
  console.log(`erp-api env sources: ${describeEnvSources()}`);
  // البند 3: استثناءٌ لم يلتقطه أحد يُسجَّل قبل أن يسقط العملية — لا في stdout وحده.
  installProcessProblemHandlers('api');
  if (envIssues.length > 0) console.warn(`erp-api env warnings: ${envIssues.join('; ')}`);

  // PHASE_02 §8: fail fast on a missing runtime variable instead of degrading silently.
  assertRuntimeEnv();

  if (env.AUTO_MIGRATE) {
    try {
      const outcome = await runMigrations();
      if (outcome.applied.length > 0) {
        console.log(`erp-api auto-migrated ${outcome.applied.length} migration(s): ${outcome.applied.join(', ')}`);
      }
    } catch (err) {
      console.warn(`erp-api auto-migrate skipped/warned: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });

  app.use(RequestIdMiddleware);
  applyHttpConfiguration(app);
  app.useLogger(app.get(Logger));

  if (isOpenApiEnabled()) {
    registerOpenApi(app, buildOpenApiDocument(app));
  }

  // مهل المقبس وحدود الاتصال — تُضبط **قبل** الاستماع فلا توجد نافذةٌ بلا حماية.
  // التفصيل في `applyServerTimeouts` (bootstrap.ts).
  applyServerTimeouts(app.getHttpServer() as Parameters<typeof applyServerTimeouts>[0]);
  await app.listen(env.PORT, env.API_HOST);

  let activeRunner: WorkerRunner | undefined;
  const runEmbeddedWorker = env.EMBEDDED_WORKER ?? env.NODE_ENV !== 'test';
  if (runEmbeddedWorker) {
    try {
      const runner = app.get(WorkerRunner);
      await runner.start();
      activeRunner = runner;
      console.log(`erp-api embedded worker active (poll=${env.OUTBOX_POLL_INTERVAL_MS}ms)`);
    } catch (err) {
      activeRunner = undefined;
      console.warn(
        `erp-api embedded worker start skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`erp-api received ${signal}; closing`);
    if (activeRunner) {
      await activeRunner.stop().catch(() => undefined);
    }
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  console.log(`erp-api listening on http://${env.API_HOST}:${env.PORT} (${env.NODE_ENV})`);
}

void (env.WORKER ? bootstrapWorker() : bootstrap());
