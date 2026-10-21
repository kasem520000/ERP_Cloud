import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPool } from './client.js';

/**
 * المجمّع بلا مستمع `error` يقتل العملية: `EventEmitter` يرمي عند بثّ `error` بلا مستمع،
 * و`node-postgres` يبثّ خطأ العميل الخامل عبر المجمّع. فإعادة تشغيل القاعدة أو
 * `pg_terminate_backend` كانت تُسقط الـAPI كله — وهذا ما يُقفل هنا.
 */
describe('createPool — حماية العملية من أخطاء العملاء الخاملين', () => {
  let pool: ReturnType<typeof createPool> | undefined;

  afterEach(async () => {
    await pool?.end().catch(() => undefined);
    pool = undefined;
    vi.restoreAllMocks();
  });

  it('يبثّ خطأ عميل خامل بلا استثناء غير ملتقط', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    pool = createPool('postgres://erp_api:secret@127.0.0.1:1/app', 1);

    // `pg_terminate_backend` على عميلٍ خامل: نفس البثّ الذي كان يقتل العملية.
    expect(() => pool!.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('idle client error'));
  });

  it('لا يخفي الخطأ: الرسالة تصل إلى السجل', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    pool = createPool('postgres://erp_api:secret@127.0.0.1:1/app', 1);

    pool.emit('error', new Error('connection reset by peer'));

    expect(logged.mock.calls[0]?.[0]).toContain('connection reset by peer');
  });
});
