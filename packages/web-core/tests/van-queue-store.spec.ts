import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const source = (name: string) => new URL(`../src/${name}`, import.meta.url);

/**
 * 🚐 مخزنُ طابور المندوب (`vanQueue`) في محوّل IndexedDB — على نمط `offline-store.spec.ts`
 * القائم في هذه الحزمة: **أحكامٌ على المصدر**، لأنّ المستودع لا يملك IndexedDB وهميًّا
 * (‏`fake-indexeddb` غير مثبّتة، وفحصُ الحزم أظهر أن لا بديلَ محليًّا). وهذا يُقال ولا
 * يُخفى: فهذه الأحكامُ تثبّت أنّ المستوى **مكتوبٌ كما صُمّم** (مخزنٌ واحدٌ في القاعدة
 * نفسها، هويّةٌ واحدة، حارسُ المسح) ولا تثبّت سلوكَ IndexedDB في متصفّح — وذاك يحتاج
 * متصفّحًا، ولم يُفتح متصفّحٌ في هذه البيئة.
 *
 * وأمّا **المنطق** الذي يُبنى عليه الطابور (ما يُحفظ، وما لا يُحفظ ولماذا، وتصنيفُ
 * الإعادة، وحكمُ ما قبل الإرسال) ففي `apps/bakery/lib/rep-queue.ts` وهو نقيٌّ ومختبَرٌ
 * سلوكيًّا في `apps/bakery/tests/rep-queue.spec.ts` — والقسمةُ مقصودة: ما يمكن جعلُه
 * نقيًّا جُعل نقيًّا واختُبر سلوكًا، وما لا يمكن (مخاطبةُ IndexedDB) بقي غراءً رقيقًا
 * مثبَّتًا هنا.
 */
describe('van queue store (web-core) — قاعدةٌ واحدة، هويّةٌ واحدة، ومسحٌ لا يبتلع نيّة', () => {
  it('مخزنٌ جديدٌ في القاعدة نفسها بإصدارٍ مُرقّى، وبفهارسه', async () => {
    const db = await readFile(source('offline-db.ts'), 'utf8');

    // ‏القاعدةُ نفسها (لا قاعدةَ ثانية) والإصدارُ رُقِّي لإنشاء المخزن.
    expect(db).toContain("const DB_NAME = 'erpcloud-pos-offline'");
    expect(db).toContain('const DB_VERSION = 2');
    // ‏والمخزنُ الجديد يُنشأ بجانب مخزن نقطة البيع القائم — فلا يُحذف ولا يُستبدل.
    expect(db).toContain("createObjectStore('vanQueue'");
    expect(db).toContain("createObjectStore('queue'");
    // ‏والإنشاءُ محروسٌ بـ`contains` فيبقى آمنًا على قاعدةٍ قائمة (ترقيةٌ لا إعادةُ بناء).
    expect(db).toContain("if (!db.objectStoreNames.contains('vanQueue'))");
    for (const index of ['status', 'createdAt', 'operation'])
      expect(db, `فهرسُ ${index} على vanQueue`).toContain(
        `vanQueue.createIndex('${index}', '${index}', { unique: false })`,
      );
    // ‏ووسمُ السجلّ مميّزٌ عن وسم نقطة البيع (`OFFLINE-`) فلا يختلط طابوران في عرضٍ واحد.
    expect(db).toContain('`VAN-${deviceId}-${sequenceNo}-');
  });

  it('هويّةُ الجهاز والتسلسلُ من `meta` المشتركة — لا هويّةَ ثانيةَ ولا تسلسلَ ثانيًا', async () => {
    const db = await readFile(source('offline-db.ts'), 'utf8');
    const enqueue = db.slice(db.indexOf('export async function enqueueVanOperation'));
    const body = enqueue.slice(0, enqueue.indexOf('export async function listVanQueue'));

    // ‏وكلاهما يُطلب من الدالتَين المشتركتَين مع طابور نقطة البيع (وكِلاهما يقرأ `meta`).
    expect(body).toContain('getOrCreateDeviceId()');
    expect(body).toContain('getNextSequence()');
    // ‏ولا إنشاءَ لهويّةٍ أو تسلسلٍ داخل مستوى المندوب نفسه.
    expect(body).not.toContain("put({ key: 'deviceId'");
    expect(body).not.toContain("put({ key: 'sequence'");
    // ‏والمفتاحُ يُخزَّن في الجسم وفي حقلٍّ ظاهر — فالمصدرُ `body.idempotencyKey`.
    expect(body).toContain('idempotencyKey: input.idempotencyKey');
  });

  it('المسحُ يرفض ابتلاعَ نيّةٍ لم تصل، إلا بـ`force` صريح', async () => {
    const db = await readFile(source('offline-db.ts'), 'utf8');
    const reset = db.slice(db.indexOf('export async function resetOfflineStorage'));

    // ‏والحارسُ قبل `deleteDatabase` لا بعده — فالمسحُ حذفُ القاعدة كلها.
    expect(reset.indexOf('options?.force !== true')).toBeLessThan(reset.indexOf('deleteDatabase'));
    expect(reset).toContain('vanQueueCounts()');
    expect(reset).toContain('cleared: false, pendingVanQueue: counts.pending');
    // ‏وتُعيد نتيجةً لا ترمي: فمستدعٍ قديم يتجاهل القيمةَ لا يبتلع استثناءً، والشاشةُ تقول
    // ‏لمستخدمها لماذا لم يُمسح — ولا يبقى الاعتقادُ أنّ التخزينَ مُسح وهو لم يُمسح.
    expect(reset).toContain('Promise<OfflineResetResult>');
    // ‏والتنظيفُ التلقائيّ يحذف الواصلَ وحده: فالمرفوضُ يبقى حتى يقرّر المندوب.
    expect(db).toContain("const synced = records.filter((record) => record.status === 'synced')");
  });

  it('الإعادةُ نيّةٌ نيّةً إلى مسارها الرسميّ — فلا مزامنةَ جماعيةً مخترعة', async () => {
    const db = await readFile(source('offline-db.ts'), 'utf8');
    const sync = await readFile(source('sync-engine.ts'), 'utf8');

    // ‏محركُ المزامنة القائم باقٍ على حاله لنقطة البيع (لم يُمدّ لابتلاع التوزيع).
    expect(sync).toContain("'/pos/offline-sync'");
    /**
     * ‏ومستوى المندوب لا **يستدعي** مسارَ مزامنةٍ جماعية: فالإعادةُ هناك إلى
     * ‏`/van-sales/documents` و`…/returns` و`…/collections` — والمساراتُ مثبّتةٌ في
     * ‏`apps/bakery/tests/rep-queue.spec.ts`. والحكمُ على شكل السطر البرمجيّ (بين علامتَي
     * اقتباس) لا على النصّ المجرّد: فشرحُ المستوى يذكر المسارَ **نفيًا**، وحكمٌ نصيٌّ كان
     * سيسقط على تعليقٍ يقول عكسَ ما يُتَّهم به.
     */
    expect(db).not.toContain("'/van-sales/offline-sync'");
    expect(db).not.toContain('"/van-sales/offline-sync"');
    expect(db).toContain("endpoint: input.endpoint");
  });
});
