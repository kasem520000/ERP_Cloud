import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withPlatformAdminTx } from '@erp/database';

import { decodeBundle, inspectReleaseBundle } from '../src/modules/releases/bundle.js';
import { isForbiddenArchiveFile, isSafeArchivePath, readZip } from '../src/modules/releases/zip.js';

import { ALL_TENANT_PERMISSIONS, createActor, type Actor } from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';
import { baseManifest, buildBundle, buildZip, sha256Of } from './zip-builder.js';

/**
 * 🗜️ تحديث المنصّة عبر حزمة ZIP — «حزمةٌ تُقاس ولا تُنفَّذ».
 *
 * القاعدة الأولى التي يقيسها هذا الملف: **لا شيفرة من العميل تصل إلى التنفيذ**. الأرشيف
 * يُقرأ فهرسه، ويُفكّ ضغطُ `release.json` وحده، ويُرفض ما فيه مسارٌ هارب أو ملفٌّ تنفيذي أو
 * قيدٌ مشفّر — ثم يُثبَّت القياس (بصمة/حجم/عدد/أسماء) في `platform_releases`.
 *
 * والثانية: **المرفوض يُسجَّل**. حزمةٌ تحمل `deploy.sh` تُترك صفاً بحالة `rejected` وسببها،
 * لأن سؤال التدقيق «هل حاول أحد؟» لا يُجاب بمحو المحاولة.
 *
 * والثالثة: **الإعلان فعلٌ صريح**. الرفع لا يُعلن إصداراً إن كان على القناة إصدارٌ حاليّ،
 * والسحب يُعيد آخر إصدارٍ مقبول — فلا تبقى المنصّة تشير إلى إصدارٍ سُحب.
 */
describe('platform releases — حزمة التحديث (ZIP) والتحقّق منها', () => {
  let ctx: TestApp;
  let platformOwner: Actor;
  let platformOperations: Actor;
  let platformAuditor: Actor;
  let tenantUser: Actor;

  const call = (
    method: 'get' | 'post',
    path: string,
    actor: Actor,
    body?: Record<string, unknown>,
  ) => api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });

  const upload = (
    actor: Actor,
    zip: Buffer,
    filename = 'erp-release.zip',
    reason = 'نشر إصدار الشهر',
    checksum: string | undefined = sha256Of(zip),
  ) =>
    call('post', '/platform/releases', actor, {
      filename,
      contentBase64: zip.toString('base64'),
      ...(checksum ? { checksum } : {}),
      reason,
    });

  const rows = async (): Promise<
    Array<{ version: string | null; status: string; is_current: boolean; rejection_code: string | null }>
  > =>
    withPlatformAdminTx(ctx.handle.db, async (tx) => {
      const result = await tx.execute(sql`
        SELECT version, status, is_current, rejection_code FROM platform_releases ORDER BY uploaded_at, id
      `);
      return (result as unknown as { rows: Array<Record<string, unknown>> }).rows.map((row) => ({
        version: row.version ? String(row.version) : null,
        status: String(row.status),
        is_current: row.is_current === true,
        rejection_code: row.rejection_code ? String(row.rejection_code) : null,
      }));
    });

  beforeAll(async () => {
    ctx = await createTestApp('platform-releases');

    const operator = (email: string, role: string): Promise<Actor> =>
      createActor(ctx, {
        tenantCode: 'release-ops',
        email,
        permissions: [],
        roleNames: ['Console'],
        isOwner: false,
        platformRoles: [role],
      });

    platformOwner = await operator('owner@release-ops.test', 'platform_owner');
    platformOperations = await operator('ops@release-ops.test', 'platform_operations');
    platformAuditor = await operator('audit@release-ops.test', 'platform_auditor');
    tenantUser = await createActor(ctx, {
      tenantCode: 'release-tenant',
      email: 'owner@release-tenant.test',
      permissions: ALL_TENANT_PERMISSIONS,
      isOwner: true,
    });
  }, 240_000);

  afterAll(async () => {
    await ctx.close();
  });

  // ───────────────────────────────────────────── 1. بنية الأرشيف نفسها

  it('يقرأ فهرس أرشيفٍ سليماً بلا فكّ ضغط محتواه', () => {
    const zip = buildZip([
      { name: 'release.json', content: '{"version":"2026.10.1"}', method: 'deflate' },
      { name: 'docs/CHANGELOG.md', content: '# ما الجديد', method: 'store' },
    ]);
    const read = readZip(zip);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.entries.map((entry) => entry.name)).toEqual(['release.json', 'docs/CHANGELOG.md']);
    expect(read.entries[0]?.method).toBe(8);
    expect(read.entries[1]?.method).toBe(0);
  });

  it('يرفض ما ليس ZIP، والأرشيف الفارغ، والأرشيف المبتور', () => {
    expect(readZip(Buffer.alloc(0))).toMatchObject({ ok: false, code: 'EMPTY_BUNDLE' });
    expect(readZip(Buffer.from('hello, this is not an archive'))).toMatchObject({
      ok: false,
      code: 'NOT_A_ZIP',
    });

    const zip = buildZip([{ name: 'release.json', content: '{}' }]);
    // قطعُ آخر 10 بايتات يمحو EOCD — وهو أوّل ما يقرؤه القارئ.
    expect(readZip(zip.subarray(0, zip.length - 10))).toMatchObject({ ok: false, code: 'NOT_A_ZIP' });
  });

  it('يرفض المسارات الهاربة والملفات التنفيذية بلا استثناء', () => {
    // الدالّتان صافيتان، فتُقاسان على الحالتين اللتين تهمّان.
    for (const name of ['../etc/passwd', 'a/../../x', '/etc/passwd', 'C:\\windows\\x', 'a\\b']) {
      expect(isSafeArchivePath(name), name).toBe(false);
    }
    expect(isSafeArchivePath('docs/README.md')).toBe(true);

    for (const name of ['deploy.sh', 'bin/setup.exe', 'lib/native.so', 'index.js', 'x.ps1', '.htaccess']) {
      expect(isForbiddenArchiveFile(name), name).toBe(true);
    }
    expect(isForbiddenArchiveFile('release.json')).toBe(false);
    expect(isForbiddenArchiveFile('docs/CHANGELOG.md')).toBe(false);

    expect(readZip(buildZip([{ name: '../escape.txt', content: 'x' }]))).toMatchObject({
      ok: false,
      code: 'UNSAFE_PATH',
    });
    expect(readZip(buildZip([{ name: 'release.json', content: '{}' }, { name: 'deploy.sh', content: 'rm -rf /' }]))).toMatchObject({
      ok: false,
      code: 'FORBIDDEN_FILE',
      detail: 'deploy.sh',
    });
    // القيد المشفّر يعني أرشيفاً لا نستطيع فحص محتواه — فيُرفض لا يُقبل على الثقة.
    expect(readZip(buildZip([{ name: 'release.json', content: '{}', encrypted: true }]))).toMatchObject({
      ok: false,
      code: 'ENCRYPTED_ENTRY',
    });
  });

  // ───────────────────────────────────────────── 2. البيان والبصمة

  it('يقبل حزمةً ببيانٍ سليم ويحسب بصمتها بنفسه', () => {
    const zip = buildBundle(baseManifest, [{ name: 'docs/CHANGELOG.md', content: '# 2026.10.2' }]);
    const result = inspectReleaseBundle(zip, sha256Of(zip));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.manifest.version).toBe('2026.10.2');
    expect(result.manifest.channel).toBe('stable');
    expect(result.checksumVerified).toBe(true);
    expect(result.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(result.bytes).toBe(zip.length);
    expect(result.files).toEqual(['docs/CHANGELOG.md']);
    expect(result.entries).toBe(2);
  });

  it('يرفض حزمةً بلا بيانٍ في الجذر، أو ببيانٍ ليس في الجذر', () => {
    expect(inspectReleaseBundle(buildZip([{ name: 'docs/CHANGELOG.md', content: 'x' }]))).toMatchObject({
      ok: false,
      code: 'MISSING_MANIFEST',
    });

    const nested = inspectReleaseBundle(
      buildZip([{ name: 'release/release.json', content: JSON.stringify(baseManifest) }]),
    );
    expect(nested.ok).toBe(false);
    if (nested.ok) return;
    expect(nested.code).toBe('MISSING_MANIFEST');
    expect(nested.detail).toContain('release/release.json');
  });

  it('يرفض بياناً تالفاً: JSON، أو إصداراً لا يُقارَن، أو حقلاً مجهولاً', () => {
    const badJson = inspectReleaseBundle(buildZip([{ name: 'release.json', content: '{oops' }]));
    expect(badJson).toMatchObject({ ok: false, code: 'BAD_MANIFEST' });

    const badVersion = inspectReleaseBundle(
      buildZip([{ name: 'release.json', content: JSON.stringify({ ...baseManifest, version: 'final-final' }) }]),
    );
    expect(badVersion).toMatchObject({ ok: false, code: 'BAD_MANIFEST' });

    const unknownKey = inspectReleaseBundle(
      buildZip([{ name: 'release.json', content: JSON.stringify({ ...baseManifest, run: 'curl evil' }) }]),
    );
    expect(unknownKey).toMatchObject({ ok: false, code: 'BAD_MANIFEST' });
  });

  it('يرفض بصمةً معلنة لا تطابق الملف — انحرافٌ بين البناء والرفع', () => {
    const zip = buildBundle(baseManifest);
    const result = inspectReleaseBundle(zip, 'a'.repeat(64));
    expect(result).toMatchObject({ ok: false, code: 'CHECKSUM_MISMATCH' });

    // وبلا بصمةٍ معلنة تُقبل الحزمة، وتُسجَّل بصفتها غير متحقَّقة (‏`checksumVerified: false`).
    const plain = inspectReleaseBundle(zip);
    expect(plain.ok).toBe(true);
    if (!plain.ok) return;
    expect(plain.checksumVerified).toBe(false);
  });

  it('لا يقبل base64 تالفاً — لا شرطة ولا مسافة ولا طولاً ناقصاً', () => {
    expect(decodeBundle('not base64 at all!')).toBeNull();
    expect(decodeBundle('abc')).toBeNull();
    expect(decodeBundle('')).toBeNull();
    expect(decodeBundle(Buffer.from('hello').toString('base64'))).toEqual(Buffer.from('hello'));
  });

  // ───────────────────────────────────────────── 3. الرفع والإعلان

  it('يرفع حزمةً مقبولة: تُسجَّل بقياسها وتُعلَن أول مرة، ثم لا تُعلَن ثانيةً تلقائياً', async () => {
    const first = await upload(
      platformOwner,
      buildBundle(baseManifest, [{ name: 'docs/CHANGELOG.md', content: '# 2026.10.2' }]),
    );
    expect(first.status, JSON.stringify(first.body).slice(0, 400)).toBe(201);
    const created = (first.body as { data: Record<string, unknown> }).data;
    expect(created.status).toBe('accepted');
    expect(created.version).toBe('2026.10.2');
    expect(created.isCurrent).toBe(true);
    expect(created.checksumVerified).toBe(true);
    expect(created.bytes).toBeGreaterThan(0);
    expect(created.files).toEqual(expect.arrayContaining(['docs/CHANGELOG.md']));
    expect(created.rejectedReason).toBeNull();

    // الإصدار المعروض للمستأجر: رقمٌ وما الجديد، بلا بصمةٍ ولا اسم ملفّ.
    const current = await call('get', '/releases/current', tenantUser);
    expect(current.status).toBe(200);
    const info = (current.body as { data: Record<string, unknown> }).data;
    expect(info.version).toBe('2026.10.2');
    expect(info.channel).toBe('stable');
    expect(info.highlights).toHaveLength(2);
    expect(Object.keys(info)).toEqual(['version', 'channel', 'notes', 'highlights', 'publishedAt']);

    // إصدارٌ ثانٍ يُرفع ولا يُعلَن: من يرفع للتجربة ليس من يقرّر النشر.
    const second = await upload(platformOwner, buildBundle({ ...baseManifest, version: '2026.10.3' }), 'next.zip');
    expect(second.status).toBe(201);
    expect((second.body as { data: Record<string, unknown> }).data.isCurrent).toBe(false);
    expect(((await call('get', '/releases/current', tenantUser)).body as { data: { version: string } }).data.version).toBe(
      '2026.10.2',
    );
  });

  it('يعيد 409 لإصدارٍ مكرّرٍ على القناة نفسها، ويقبل رقمه على قناةٍ أخرى', async () => {
    const duplicate = await upload(platformOwner, buildBundle(baseManifest));
    expect(duplicate.status).toBe(409);
    expect(JSON.stringify(duplicate.body)).toContain('2026.10.2');

    const beta = await upload(
      platformOwner,
      buildBundle({ ...baseManifest, channel: 'beta' }),
      'beta.zip',
    );
    expect(beta.status).toBe(201);
  });

  it('يرفض حزمةً فيها ملفٌّ تنفيذي: 422 برسالةٍ عربية، وصفٌّ مرفوضٌ في السجلّ', async () => {
    const evil = buildBundle(baseManifest, [{ name: 'bin/setup.sh', content: 'rm -rf /' }]);
    // `buildBundle` يبني الأرشيف بالقائمة نفسها، فالرفض يقع على الامتداد قبل أي شيء آخر.
    const response = await upload(platformOwner, evil, 'evil.zip');
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).toContain('قابلاً للتنفيذ');

    const ledger = await rows();
    const rejected = ledger.find((row) => row.rejection_code === 'FORBIDDEN_FILE');
    expect(rejected?.status).toBe('rejected');
    expect(rejected?.is_current).toBe(false);
  });

  it('يرفض base64 تالفاً كحزمةٍ مرفوضة، لا كخطأ خادم', async () => {
    const response = await call('post', '/platform/releases', platformOwner, {
      filename: 'broken.zip',
      contentBase64: 'not-base64!!',
      reason: 'محاولة رفع ملفّ تالف',
    });
    expect(response.status).toBe(422);
    const ledger = await rows();
    expect(ledger.some((row) => row.rejection_code === 'NOT_A_ZIP')).toBe(true);
  });

  it('الإعلان والسحب ينقلان «الحالي» بين الإصدارات المقبولة، والسحب يُعيد السابق', async () => {
    const listed = await call('get', '/platform/releases', platformOwner);
    expect(listed.status).toBe(200);
    const ledger = (listed.body as { data: { releases: Array<Record<string, unknown>> } }).data;
    const second = ledger.releases.find((row) => row.version === '2026.10.3')!;

    const promote = await call('post', `/platform/releases/${String(second.id)}/promote`, platformOwner, {
      reason: 'اعتماد إصدار الشهر بعد مراجعة الحسابات',
    });
    expect(promote.status).toBe(200);
    expect(((await call('get', '/releases/current', tenantUser)).body as { data: { version: string } }).data.version).toBe(
      '2026.10.3',
    );

    // سحبُ الإصدار المعلَن يُعيد آخر إصدارٍ مقبولٍ على القناة نفسها — لا يُبقي المنصّة بلا إصدار.
    const revoke = await call('post', `/platform/releases/${String(second.id)}/revoke`, platformOwner, {
      reason: 'خطأ في حساب الضريبة على المرتجعات — سحبٌ فوري',
    });
    expect(revoke.status).toBe(200);
    expect(((await call('get', '/releases/current', tenantUser)).body as { data: { version: string } }).data.version).toBe(
      '2026.10.2',
    );

    // والمسحوب لا يُعاد إعلانه: قرارُ السحب لا يُنقض بضغطةٍ ثانية.
    const again = await call('post', `/platform/releases/${String(second.id)}/promote`, platformOwner, {
      reason: 'محاولة إعلان إصدارٍ مسحوب',
    });
    expect(again.status).toBe(422);
  });

  // ───────────────────────────────────────────── 4. الصلاحيات

  it('القراءة تصل للتشغيل والرقابة، والكتابة لمالك المنصّة وحده', async () => {
    const readByOps = await call('get', '/platform/releases', platformOperations);
    expect(readByOps.status).toBe(200);
    const readByAuditor = await call('get', '/platform/releases', platformAuditor);
    expect(readByAuditor.status).toBe(200);

    const opsUpload = await upload(platformOperations, buildBundle({ ...baseManifest, version: '2026.10.9' }));
    expect(opsUpload.status).toBe(403);
    const opsPromote = await call('post', '/platform/releases/00000000-0000-4000-8000-000000000001/promote', platformOperations, {
      reason: 'محاولة إعلان بلا صلاحية',
    });
    expect(opsPromote.status).toBe(403);

    // ومنشأةٌ عادية لا ترى السجلّ، لكنها تقرأ إصدارها الحالي.
    const tenantLedger = await call('get', '/platform/releases', tenantUser);
    expect(tenantLedger.status).toBe(403);
    expect((await call('get', '/releases/current', tenantUser)).status).toBe(200);
  });

  it('كل رفعٍ وإعلانٍ وسحبٍ يُترك في سجلّ التدقيق', async () => {
    const actions = await withPlatformAdminTx(ctx.handle.db, async (tx) => {
      const result = await tx.execute(sql`
        SELECT action, count(*)::int AS total FROM audit_log
        WHERE action LIKE 'platform.release.%'
        GROUP BY action ORDER BY action
      `);
      return (result as unknown as { rows: Array<{ action: string; total: number }> }).rows.map((row) => ({
        action: String(row.action),
        total: Number(row.total),
      }));
    });
    const byAction = Object.fromEntries(actions.map((row) => [row.action, row.total]));
    expect(byAction['platform.release.upload']).toBeGreaterThanOrEqual(3);
    expect(byAction['platform.release.rejected']).toBeGreaterThanOrEqual(2);
    expect(byAction['platform.release.promote']).toBeGreaterThanOrEqual(1);
    expect(byAction['platform.release.revoke']).toBeGreaterThanOrEqual(1);
  });
});
