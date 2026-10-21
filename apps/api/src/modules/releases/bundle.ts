import { createHash } from 'node:crypto';

import { releaseManifestSchema, type ReleaseManifest, type ReleaseRejectionCode } from '@erp/contracts';

import { readZip, readZipEntry } from './zip.js';

/**
 * 🗜️ فحص حزمة التحديث كاملةً: من بايتاتٍ وصلت إلى بيانٍ مقبول — أو سببِ رفضٍ مفهوم.
 *
 * ولا يُفكّ ضغطُ إلا ملفٍّ واحد: `release.json` في الجذر (وبسقف 64 KiB قبل الفكّ وبعده).
 * بقيّة الأرشيف يُقرأ فهرسه فقط، فلا يمرّ محتواه في الذاكرة ولا في مُفكِّك ضغط — وهو الفرق
 * بين «فحصنا الحزمة» و«جعجعنا أرشيفَ غريب».
 */

export const MANIFEST_NAME = 'release.json';
const MAX_MANIFEST_BYTES = 64 * 1024;

export type BundleInspection = {
  ok: true;
  manifest: ReleaseManifest;
  /** بصمة ما استُلم فعلاً — لا ما ادّعاه البيان. */
  checksum: string;
  bytes: number;
  files: string[];
  entries: number;
  /** هل أعلن الرافع بصمةً وطابقت ما حسبناه؟ */
  checksumVerified: boolean;
};

export type BundleRejection = {
  ok: false;
  code: ReleaseRejectionCode;
  detail?: string;
  /** رقم الإصدار حين قُرئ البيان وتحقّق قبل الرفض (انحرافُ بصمةٍ مثلاً) — يُحفظ في السجلّ. */
  version?: string;
};
export type BundleResult = BundleInspection | BundleRejection;

/**
 * الترتيب مقصود: بنية الأرشيف ← وجود البيان وموضعه ← صحّة البيان ← بصمته. وسبب الرفض
 * يتوقّف عند أول ما يمنع القبول، فالشاشة تقول «هذا الملف تنفيذي: `bin/setup.sh`» لا
 * «فشل الفحص».
 */
export function inspectReleaseBundle(buffer: Buffer, declaredChecksum?: string): BundleResult {
  const zip = readZip(buffer);
  if (!zip.ok) return { ok: false, code: zip.code, ...(zip.detail ? { detail: zip.detail } : {}) };

  const manifestEntry = zip.entries.find((entry) => entry.name === MANIFEST_NAME);
  if (!manifestEntry) {
    const nested = zip.entries.find((entry) => entry.name.endsWith(`/${MANIFEST_NAME}`));
    return {
      ok: false,
      code: 'MISSING_MANIFEST',
      ...(nested ? { detail: `موجود في «${nested.name}» ويجب أن يكون في الجذر` } : {}),
    };
  }

  const raw = readZipEntry(buffer, manifestEntry, MAX_MANIFEST_BYTES);
  if (!raw) return { ok: false, code: 'BAD_MANIFEST', detail: 'تعذّر فكّ ضغط release.json' };

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf8'));
  } catch {
    return { ok: false, code: 'BAD_MANIFEST', detail: 'release.json ليس JSON صالحاً' };
  }

  const parsed = releaseManifestSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      code: 'BAD_MANIFEST',
      detail: `${issue?.path.join('.') || 'release.json'}: ${issue?.message ?? 'غير صالح'}`,
    };
  }

  const checksum = createHash('sha256').update(buffer).digest('hex');
  // البصمة تُعلَن مع الطلب لا داخل الأرشيف (انظر `platformReleaseUploadSchema`).
  if (declaredChecksum && declaredChecksum !== checksum) {
    return {
      ok: false,
      code: 'CHECKSUM_MISMATCH',
      version: parsed.data.version,
      detail: `المُعلَن ${declaredChecksum.slice(0, 12)}… والمحسوب ${checksum.slice(0, 12)}…`,
    };
  }

  return {
    ok: true,
    manifest: parsed.data,
    checksum,
    bytes: buffer.length,
    files: zip.entries.map((entry) => entry.name).filter((name) => name !== MANIFEST_NAME),
    entries: zip.entries.length,
    checksumVerified: Boolean(declaredChecksum),
  };
}

/** فكّ ترميز base64 مع رفض ما ليس base64 صالحاً — لا يصل منه شيء إلى الأرشيف. */
export function decodeBundle(contentBase64: string): Buffer | null {
  const compact = contentBase64.trim();
  // `Buffer.from(x, 'base64')` **تتجاهل** المحارف غير الصالحة بدل أن ترفضها، فالفحص هنا.
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact) || compact.length % 4 !== 0) return null;
  const buffer = Buffer.from(compact, 'base64');
  return buffer.length > 0 ? buffer : null;
}
