import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';

/**
 * 🗜️ باني أرشيفات ZIP في الذاكرة — للاختبار وحده.
 *
 * لا نستعمل مكتبة ZIP في الإنتاج (انظر `modules/releases/zip.ts`)، فلولا باني الاختبار
 * لكانت الحزم المُختبَرة ملفّاتٍ جاهزة لا يقرؤها أحد ولا تُعدَّل. وهنا تُبنى بايتةً بايتةً:
 * ترويسةٌ محلية، بياناتٌ مخزَّنة أو مضغوطة (`deflateRaw`), ثم فهرسٌ مركزي وEOCD — وهذا
 * يجعل الحالات المضادّة (مسار هارب، قيدٌ مشفّر، امتدادٌ تنفيذي) بناءً مقصوداً لا ملفاً
 * عُدّل بمحرّر سداسي.
 */

export type ZipInput = {
  name: string;
  content: string | Buffer;
  /** `store` بلا ضغط، و`deflate` بالضغط — والاثنان مقبولان في القارئ. */
  method?: 'store' | 'deflate';
  /** يعلّم المدخل مشفّراً في الفهرس — يُستعمل لقياس الرفض. */
  encrypted?: boolean;
};

/** `crc32` في Node.js 22 متاحٌ في `node:zlib` (لقطةٌ من zlib)؛ البديل حسابٌ يدويّ هنا. */
function crc32Of(buffer: Buffer): number {
  if (typeof crc32 === 'function') return crc32(buffer) >>> 0;
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** DOS time/date ثابتان: الأرشيف المُختبَر يجب أن يكون حتميّاً بايتاً ببايت. */
const DOS_TIME = 0;
const DOS_DATE = 0x21; // 1980-01-01

export function buildZip(inputs: ZipInput[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const input of inputs) {
    const raw = Buffer.isBuffer(input.content) ? input.content : Buffer.from(input.content, 'utf8');
    const method = input.method === 'deflate' ? 8 : 0;
    const body = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(input.name, 'utf8');
    const flags = input.encrypted ? 0x1 : 0;
    const checksum = crc32Of(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // disk
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + body.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(inputs.length, 8);
  eocd.writeUInt16LE(inputs.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

/**
 * حزمةٌ صالحة: `release.json` + ملفات. والبصمة تُحسب على **النتيجة النهائية** وتُرسَل
 * مع الطلب خارج الأرشيف — كتابتها داخل البيان مستحيلة، لأن كتابتها تغيّر بايتات
 * الأرشيف فتغيّر بصمته.
 */
export function buildBundle(
  manifest: Record<string, unknown>,
  files: Array<{ name: string; content: string }> = [],
): Buffer {
  return buildZip([
    { name: 'release.json', content: JSON.stringify(manifest), method: 'deflate' },
    ...files.map((file) => ({ name: file.name, content: file.content, method: 'store' as const })),
  ]);
}

/** بصمة الحزمة كما يحسبها الخادم — تُرسَل في `checksum` مع الرفع. */
export function sha256Of(zip: Buffer): string {
  return createHash('sha256').update(zip).digest('hex');
}

export const baseManifest = {
  version: '2026.10.2',
  channel: 'stable' as const,
  notes: 'إصلاح حساب الضريبة في مرتجع المبيعات، وتسريع كشف حساب العملاء.',
  highlights: ['ضريبة المرتجع تُحسب على صافي السطر', 'كشف الحساب يفتح في أقل من ثانية'],
};
