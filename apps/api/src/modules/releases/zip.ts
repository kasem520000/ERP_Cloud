import { inflateRawSync } from 'node:zlib';

import { platformReleaseLimits, releaseForbiddenExtensions, type ReleaseRejectionCode } from '@erp/contracts';

/**
 * 🗜️ قارئ ZIP صغير ومتشكّك — بلا تبعية جديدة، وبلا فكّ ضغط لمحتوى الأرشيف.
 *
 * المطلوب من الحزمة **ليس** استخراج ملفاتها بل الإجابة عن ثلاثة أسئلة قبل قبولها:
 * ما أسماء ملفاتها؟ ما أحجامها؟ وهل فيها ما لا يُقبل (مسار هارب، قيدٌ مشفّر، ملفٌّ تنفيذي)؟
 * وكلّ ذلك في **فهرس الأرشيف المركزي** (central directory) — لا يُفكّ ضغطُ مدخلٍ واحد.
 * فالقارئ يقرأ بنية الأرشيف فقط، وهذا هو سطح الهجوم الوحيد الذي نتعامل معه.
 *
 * البنية كما في مواصفة PKWARE:
 *
 *   [مدخلات محليّة] … [فهرس مركزي] … [EOCD]
 *
 *    EOCD (22 بايت على الأقل): 50 4B 05 06 | disk | disk | n | n | cdSize | cdOffset | commentLen
 *    مدخل الفهرس (46 بايت + الاسم والوصف):
 *      50 4B 01 02 | verMade | verNeed | flags | method | time | date | crc | csize | usize |
 *      nameLen | extraLen | commentLen | disk | iattr | eattr | localOffset | name…
 *
 * وحدودٌ صريحة في كل قراءة: أي إزاحةٍ أو طولٍ يخرج عن حدود المخزن = `BAD_ARCHIVE`،
 * لا استثناءَ من `Buffer` يصل إلى العميل كـ500.
 */

export type ZipEntry = {
  name: string;
  /** 0 = مخزَّن، 8 = deflate. ما عداهما لا يُقبل (لا نستطيع فحص محتواه). */
  method: 0 | 8;
  flags: number;
  compressedSize: number;
  size: number;
  checksum: number;
  /** إزاحة الترويسة المحلّية — منها تُقرأ بايتات المدخل عند الحاجة (البيان وحده). */
  localOffset: number;
};

export type ZipReadResult =
  | { ok: true; entries: ZipEntry[] }
  | { ok: false; code: ReleaseRejectionCode; detail?: string };

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
export const EOCD_MIN = 22;
const CENTRAL_MIN = 46;
const MAX_COMMENT = 0xffff;
const FLAG_ENCRYPTED = 0x1;
const SUPPORTED_METHODS = new Set([0, 8]);

/** نهاية الأرشيف: EOCD هو آخر ما كُتب، لكن تعليقاً حتى 64 KiB قد يليه. */
export function findEndOfCentralDirectory(buffer: Buffer): number {
  const stop = Math.max(0, buffer.length - EOCD_MIN - MAX_COMMENT);
  for (let offset = buffer.length - EOCD_MIN; offset >= stop; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) return offset;
  }
  return -1;
}

/**
 * هل الاسم آمناً؟ ثلاثة أشكال تخرج عن جذر الأرشيف:
 *   - `../x` أو `a/../../x` — zip-slip الكلاسيكي؛
 *   - `/etc/passwd` أو `C:\x` — مسار مطلق؛
 *   - `a\b` — فاصل مسارٍ ثانٍ يفهمه Windows ولا يفهمه فحصٌ يبحث عن `/` وحده.
 */
export function isSafeArchivePath(name: string): boolean {
  if (name.length === 0 || name.length > 1024) return false;
  if (name.includes('\\') || name.includes('\u0000')) return false;
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.split('/');
  return parts.every((part) => part !== '..' && part !== '.');
}

/**
 * هل الملفّ قابل للتنفيذ أو سكربت؟ بالفهرس لا بالمحتوى — وليس عندنا ما ننفّذه أصلاً،
 * فالقاعدة الأولى أن لا يدخل الحزمة شيءٌ من هذا القبيل.
 */
export function isForbiddenArchiveFile(name: string): boolean {
  const base = name.slice(name.lastIndexOf('/') + 1).toLowerCase();
  if (base === '.htaccess' || base === 'authorized_keys') return true;
  const dot = base.lastIndexOf('.');
  if (dot <= 0) return false;
  return (releaseForbiddenExtensions as readonly string[]).includes(base.slice(dot + 1));
}

/** بايتات مدخلٍ من الأرشيف: مخزَّن (0) أو deflate (8) — مع سقف إخراجٍ يمنع قنبلة ضغط. */
export function readZipEntry(buffer: Buffer, entry: ZipEntry, maxOutputBytes: number): Buffer | null {
  const offset = entry.localOffset;
  if (offset + 30 > buffer.length) return null;
  if (buffer.readUInt32LE(offset) !== LOCAL_SIGNATURE) return null;
  // طول الاسم والحقل الإضافي يُقرآن من الترويسة المحلّية: قد يختلفان عن الفهرس المركزي.
  const nameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > buffer.length) return null;
  if (entry.size > maxOutputBytes) return null;

  if (entry.method === 0) {
    return entry.compressedSize === entry.size ? buffer.subarray(start, end) : null;
  }
  try {
    // الفكّ يقع على مدخلٍ واحدٍ معلوم الحجم وبسقف إخراجٍ صريح — لا على الأرشيف كلّه.
    const inflated = inflateRawSync(buffer.subarray(start, end), { maxOutputLength: maxOutputBytes });
    return inflated.length === entry.size ? inflated : null;
  } catch {
    return null;
  }
}

/**
 * يقرأ فهرس الأرشيف المركزي ويتحقّق من كل ما يمكن التحقّق منه **بلا فكّ ضغط**.
 * الترتيب مقصود: البنية أولاً، ثم المسارات، ثم النوع — كي يكون السبب المعروض هو السبب
 * الأول الذي أوقف القبول، لا آخر ما صادفه المرور.
 */
export function readZip(buffer: Buffer): ZipReadResult {
  if (buffer.length === 0) return { ok: false, code: 'EMPTY_BUNDLE' };
  if (buffer.length > platformReleaseLimits.maxBytes) return { ok: false, code: 'TOO_LARGE' };
  if (buffer.length < EOCD_MIN) return { ok: false, code: 'NOT_A_ZIP' };

  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) return { ok: false, code: 'NOT_A_ZIP' };

  const diskNumber = buffer.readUInt16LE(eocd + 4);
  const centralDisk = buffer.readUInt16LE(eocd + 6);
  const entriesOnDisk = buffer.readUInt16LE(eocd + 8);
  const entriesTotal = buffer.readUInt16LE(eocd + 10);
  const centralSize = buffer.readUInt32LE(eocd + 12);
  const centralOffset = buffer.readUInt32LE(eocd + 16);

  // أرشيفات متعدّدة الأقراص وZIP64 خارج نطاق ما نقبله: كلاهما بنيةٌ لا نقرؤها كاملة.
  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entriesTotal) {
    return { ok: false, code: 'BAD_ARCHIVE' };
  }
  if (entriesTotal > platformReleaseLimits.maxEntries) return { ok: false, code: 'TOO_MANY_ENTRIES' };
  if (centralOffset + centralSize > buffer.length || centralOffset < 0) {
    return { ok: false, code: 'BAD_ARCHIVE' };
  }
  if (entriesTotal > 0 && centralSize < CENTRAL_MIN) return { ok: false, code: 'BAD_ARCHIVE' };

  const entries: ZipEntry[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < entriesTotal; index += 1) {
    if (cursor + CENTRAL_MIN > centralOffset + centralSize) return { ok: false, code: 'BAD_ARCHIVE' };
    if (buffer.readUInt32LE(cursor) !== CENTRAL_SIGNATURE) return { ok: false, code: 'BAD_ARCHIVE' };

    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const checksum = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + CENTRAL_MIN;
    const next = nameStart + nameLength + extraLength + commentLength;

    if (nameLength === 0 || next > centralOffset + centralSize || next > buffer.length) {
      return { ok: false, code: 'BAD_ARCHIVE' };
    }
    // الإزاحة إلى المدخل المحلي يجب أن تقع داخل الملف وأن تشير إلى ترويسته.
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== LOCAL_SIGNATURE) {
      return { ok: false, code: 'BAD_ARCHIVE' };
    }
    if (!SUPPORTED_METHODS.has(method)) return { ok: false, code: 'BAD_ARCHIVE' };
    if (size > platformReleaseLimits.maxEntryBytes || compressedSize > platformReleaseLimits.maxBytes) {
      return { ok: false, code: 'ENTRY_TOO_LARGE' };
    }

    const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
    if ((flags & FLAG_ENCRYPTED) !== 0) return { ok: false, code: 'ENCRYPTED_ENTRY' };
    if (!isSafeArchivePath(name)) return { ok: false, code: 'UNSAFE_PATH', detail: name };
    if (isForbiddenArchiveFile(name) && !name.endsWith('/')) {
      return { ok: false, code: 'FORBIDDEN_FILE', detail: name };
    }

    entries.push({ name, method: method as 0 | 8, flags, compressedSize, size, checksum, localOffset });
    cursor = next;
  }

  return { ok: true, entries };
}
