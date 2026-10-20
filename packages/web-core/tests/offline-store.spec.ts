import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const source = (name: string) => new URL(`../src/${name}`, import.meta.url);

/**
 * مخزن العمل بلا اتصال ومحرك المزامنة — نصف «offline POS PWA surface» الذي كان في
 * `apps/staff/tests/offline-pos.spec.ts`: انتقلت هذه الأحكام مع الكود الذي تفحصه إلى
 * `@erp/web-core`، وبقيت أحكام الشاشة والـmanifest والـservice worker في سبيك `apps/staff`.
 * **لم يُحذف حكم واحد** — القسمة على موضع الكود لا على قوته.
 */
describe('offline store and sync engine (web-core)', () => {
  it('keeps the IndexedDB queue, the offline id prefix and the ten-second reconnect loop', async () => {
    const db = await readFile(source('offline-db.ts'), 'utf8');
    const sync = await readFile(source('sync-engine.ts'), 'utf8');
    expect(db).toContain("createObjectStore('queue'");
    expect(db).toContain('OFFLINE-');
    expect(sync).toContain('10_000');
    expect(sync).toContain("'/pos/offline-sync'");
  });
});
