import { createServer, type Server, type Socket } from 'node:net';

/**
 * خادم Redis مصغّر لاختبار العدّاد المشترك — `INCR` · `PEXPIRE` · `PTTL` وحدها.
 *
 * لماذا خادمٌ على السلك لا كائنٌ مُزيَّف؟ لأن العيب الذي يعالجه هذا الجزء **ليس في منطق
 * العدّ** بل في العبور إلى عمليةٍ أخرى: عميلٌ يفتح المقبس، ويرسل الأوامر، ويقرأ الردود.
 * وكائنٌ مُزيَّف يختبر أننا نستدعي `incr()` — لا أن العميل يفهم الردّ، ولا أن نسختين
 * تتشاركان المفتاح نفسه. فالمقبس الحقيقي هو الحدّ الأدنى الذي يجعل الاختبار ذا معنى.
 *
 * والبروتوكول المُنفَّذ هو RESP2 بقدر ما يرسله `ioredis`: مصفوفةُ بُلَك، وردودٌ بسيطة.
 * أي أمرٍ آخر يُجاب `+OK` — يكفي لـ`CLIENT SETINFO` و`SELECT` ولا يدّعي تنفيذاً.
 */
export type StubRedis = {
  url: string;
  /** المفاتيح كما رآها الخادم: العدّاد الانتهاء. */
  keys: () => Array<{ key: string; count: number; ttlMs: number }>;
  /** يُغلق الخادم ويقطع كل المقابس — لمحاكاة سقوط Redis. */
  crash: () => Promise<void>;
  close: () => Promise<void>;
};

type Entry = { count: number; expiresAt: number };

export async function startStubRedis(): Promise<StubRedis> {
  const entries = new Map<string, Entry>();
  const sockets = new Set<Socket>();

  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => sockets.delete(socket));

    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const parsed = takeCommand(buffer);
        if (!parsed) return;
        buffer = buffer.slice(parsed.consumed);
        socket.write(execute(parsed.args));
      }
    });
  });

  const execute = (args: string[]): string => {
    const command = (args[0] ?? '').toUpperCase();
    const now = Date.now();

    switch (command) {
      case 'INCR': {
        const key = args[1] ?? '';
        const entry = entries.get(key);
        if (!entry || entry.expiresAt <= now) {
          entries.set(key, { count: 1, expiresAt: 0 });
          return ':1\r\n';
        }
        entry.count += 1;
        return `:${entry.count}\r\n`;
      }
      case 'PEXPIRE': {
        const key = args[1] ?? '';
        const ttl = Number.parseInt(args[2] ?? '0', 10);
        const entry = entries.get(key);
        if (!entry) return ':0\r\n';
        // `NX` تعني «لا تمسّ مفتاحاً له انتهاء» — وهي الدلالة الحقيقية في Redis.
        if ((args[3] ?? '').toUpperCase() === 'NX' && entry.expiresAt > now) return ':0\r\n';
        entry.expiresAt = now + ttl;
        return ':1\r\n';
      }
      case 'PTTL': {
        const entry = entries.get(args[1] ?? '');
        if (!entry) return ':-2\r\n';
        if (entry.expiresAt === 0) return ':-1\r\n';
        const remaining = entry.expiresAt - now;
        return `:${remaining > 0 ? remaining : -2}\r\n`;
      }
      case 'INFO':
        return bulk('# Server\r\nredis_version:7.2.0\r\n');
      case 'QUIT':
        return '+OK\r\n';
      default:
        return '+OK\r\n';
    }
  };

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (typeof address === 'string' || address === null) throw new Error('stub redis has no port');

  const stop = async (): Promise<void> => {
    for (const socket of sockets) socket.destroy();
    sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  };

  return {
    url: `redis://127.0.0.1:${address.port}`,
    keys: () =>
      [...entries.entries()].map(([key, entry]) => ({
        key,
        count: entry.count,
        ttlMs: entry.expiresAt === 0 ? -1 : entry.expiresAt - Date.now(),
      })),
    crash: stop,
    close: stop,
  };
}

function bulk(payload: string): string {
  return `$${Buffer.byteLength(payload)}\r\n${payload}\r\n`;
}

/** يقرأ أمراً واحداً من الذيل؛ يعيد `null` إن لم يصل كاملاً بعد. */
function takeCommand(buffer: string): { args: string[]; consumed: number } | null {
  if (!buffer.startsWith('*')) {
    // أمرٌ مضمّن (inline) — `ioredis` قد يرسل `PING\r\n` أو `QUIT\r\n`.
    const end = buffer.indexOf('\r\n');
    if (end === -1) return null;
    return { args: buffer.slice(0, end).split(' ').filter(Boolean), consumed: end + 2 };
  }

  const lines = buffer.split('\r\n');
  const count = Number.parseInt(lines[0]?.slice(1) ?? '0', 10);
  if (!Number.isFinite(count) || count <= 0) return null;

  let offset = (lines[0]?.length ?? 0) + 2;
  const args: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const headerEnd = buffer.indexOf('\r\n', offset);
    if (headerEnd === -1) return null;
    const header = buffer.slice(offset, headerEnd);
    const length = Number.parseInt(header.slice(1), 10);
    if (!Number.isFinite(length)) return null;
    const start = headerEnd + 2;
    const end = start + length;
    if (buffer.length < end + 2) return null;
    args.push(buffer.slice(start, end));
    offset = end + 2;
  }
  return { args, consumed: offset };
}
