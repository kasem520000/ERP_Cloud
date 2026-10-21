import { newId, platformProblemEvents, withPlatformAdminTx, type DatabaseHandle } from '@erp/database';

/**
 * كاتب سجلّ أخطاء السيرفر — بلا حقنٍ في الفلتر.
 *
 * `AllExceptionsFilter` يُسجَّل عبر `APP_FILTER` ويُستدعى في **كل** طلب؛ وإضافة تبعيةٍ له
 * كانت ستُقلّل احتمال ألّا يعمل الفلتر نفسه إن تعثّر حقنُها. فالكُاتب singleton يُهيَّأ في
 * وحدة المنصّة عند الإقلاع، ويُستدعى بلا انتظار (`void`) حتى لا يؤخّر الردّ ولا يُسقطه:
 * فشلُ كتابة سجلّ خطأٍ لا يجوز أن يصير خطأً ثانياً.
 */

let handle: DatabaseHandle | undefined;

export function configureProblemRecorder(database: DatabaseHandle): void {
  handle = database;
}

export type ServerProblemInput = {
  source?: 'api' | 'staff' | 'platform-admin' | 'marketing' | 'customer-portal' | 'bakery' | 'worker';
  severity?: 'error' | 'warning';
  code?: string | null;
  message: string;
  path?: string | null;
  method?: string | null;
  status?: number | null;
  traceId?: string | null;
  tenantId?: string | null;
  actorUserId?: string | null;
  meta?: Record<string, unknown>;
};

/** آخر كتابة لكل بصمة — 60 ثانية: الاستثناء المتكرّر يُكتب مرّة، لا مئة مرّة. */
const recent = new Map<string, number>();
const DEDUPE_MS = 60_000;

export async function recordServerProblem(input: ServerProblemInput): Promise<void> {
  if (!handle) return;
  const message = input.message.trim().slice(0, 4000);
  if (message.length === 0) return;

  const fingerprint = `${input.source ?? 'api'}|${input.code ?? ''}|${message.slice(0, 160)}|${input.path ?? ''}`;
  const now = Date.now();
  const previous = recent.get(fingerprint);
  if (previous !== undefined && now - previous < DEDUPE_MS) return;
  recent.set(fingerprint, now);
  if (recent.size > 500) {
    for (const [key, at] of recent) if (now - at > DEDUPE_MS) recent.delete(key);
  }

  try {
    await withPlatformAdminTx(handle.db, (tx) =>
      tx.insert(platformProblemEvents).values({
        id: newId(),
        source: input.source ?? 'api',
        severity: input.severity ?? 'error',
        code: input.code ?? null,
        message,
        path: input.path ?? null,
        method: input.method ?? null,
        status: input.status ?? null,
        traceId: input.traceId ?? null,
        tenantId: input.tenantId ?? null,
        actorUserId: input.actorUserId ?? null,
        meta: input.meta ?? {},
        occurredAt: new Date(now),
      }),
    );
  } catch {
    // الكتابة لا تكسر الاستجابة: رفض القاعدة لصفّ سجلٍّ ليس سبباً لإسقاط الطلب.
  }
}
