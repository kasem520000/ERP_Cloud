/**
 * عقدُ النشر: ملفات `deploy/vps/` ليست ملاحظاتٍ جانبية، بل ما يُشغَّل فعلاً على الخادم.
 *
 * السبب المباشر: النسخة التي وصلت من الإعداد كانت تعمل ظاهرياً وتُسقط ثلاثة أشياء بصمت:
 *   • `return 301 https://hostrequest_uri;` — `$` ساقطة، فلا توجيه إلى https بل إلى مضيفٍ
 *     غير موجود (كل طلب http يفشل)؛
 *   • كتلةُ `staff` تحمل `server_name sahabaccounting.com` نفسَه المستخدم في كتلة التسويق،
 *     فيُحمِّل nginx أُولاهما فقط ويُهمل الأخرى (سطحٌ كامل غائب)؛
 *   • لا عملية `erp-worker` في PM2، فطابور البريد والإشعارات وإعادة محاولات ZATCA لا
 *     يُستهلك أبداً: «تم الإرسال» ولا بريد.
 *
 * كلٌّ من هذه الأخطاء صامتٌ في التشغيل ولا يظهر إلا في الإنتاج. لذلك يُقفل هنا بعقدٍ
 * يقرأ الملفات نفسها: مضيفٌ واحد ↔ منفذٌ واحد، لا تكرار في `server_name`، الـworker
 * موجود، والخدمات مستمعةٌ على loopback وحدها.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (statSync(join(dir, 'pnpm-workspace.yaml'), { throwIfNoEntry: false })) return dir;
    dir = join(dir, '..');
  }
  throw new Error('لم يُعثر على جذر المستودع (pnpm-workspace.yaml)');
}

const root = repoRoot();
const read = (relative: string): string => readFileSync(join(root, relative), 'utf8');

/** التعليقات تُحذف أولاً: مثالٌ داخل تعليقٍ ليس إعداداً، و`#` في هذه الملفات لا يظهر في نص. */
const stripComments = (text: string): string =>
  text
    .split('\n')
    .map((line) => {
      const hash = line.indexOf('#');
      return hash === -1 ? line : line.slice(0, hash);
    })
    .join('\n');

type Block = { port: number; names: string[]; body: string; tls: boolean };

/**
 * كتل `server { … }` مع منافذها وأسمائها. العدّ بالأقواس لا بالتعبير النمطي: الكتل
 * متداخلة (`location` داخل `server`)، والتعبير النمطي غير الجشع يتوقّف عند أول `}`.
 */
function serverBlocks(nginx: string): Block[] {
  const text = stripComments(nginx);
  const blocks: Block[] = [];
  const opener = /server\s*\{/g;
  let match = opener.exec(text);
  while (match) {
    let depth = 0;
    let cursor = match.index + match[0].length - 1; // على `{` نفسها
    const start = cursor;
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === '{') depth += 1;
      else if (text[cursor] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    const body = text.slice(start + 1, cursor);
    const listen = [...body.matchAll(/listen\s+(?:\[::\]:)?(\d+)/g)].map((m) => Number(m[1]));
    const names = [...body.matchAll(/server_name\s+([^;]+);/g)]
      .flatMap((m) => m[1].trim().split(/\s+/))
      .filter((name) => name && name !== '_');
    blocks.push({
      port: listen[0] ?? 0,
      names,
      body,
      tls: /listen\s+(?:\[::\]:)?443/.test(body),
    });
    opener.lastIndex = cursor;
    match = opener.exec(text);
  }
  return blocks;
}

describe('إعداد Nginx (deploy/vps/nginx-erpcloud.conf)', () => {
  const conf = read('deploy/vps/nginx-erpcloud.conf');
  const blocks = serverBlocks(conf);
  const tls = blocks.filter((block) => block.port === 443 && block.names.length > 0);

  it('لا يستخدم متغيّراً ناقصاً في إعادة توجيه http ⇒ https', () => {
    // الخطأ الأصلي: `https://hostrequest_uri` بلا `$` — توجيهٌ إلى مضيفٍ لا وجود له.
    expect(conf).not.toContain('https://hostrequest_uri');
    expect(conf.match(/return 301 https:\/\/\$host\$request_uri;/g)?.length ?? 0).toBeGreaterThanOrEqual(6);
  });

  it('لكل مضيفٍ كتلة TLS واحدة فقط — لا server_name مكرَّراً يبتلع الآخر', () => {
    const seen = new Map<string, number>();
    for (const block of tls) {
      for (const name of block.names) seen.set(name, (seen.get(name) ?? 0) + 1);
    }
    const duplicates = [...seen.entries()].filter(([, count]) => count > 1).map(([name]) => name);
    expect(duplicates).toEqual([]);
  });

  it('كل واجهة تُخدَم من منفذها هي، والـAPI من 3000', () => {
    const expected: Record<string, number> = {
      'api.sahabaccounting.com': 3000,
      'staff.sahabaccounting.com': 3001,
      'marketing.sahabaccounting.com': 3002,
      'admin.sahabaccounting.com': 3003,
      'portal.sahabaccounting.com': 3004,
      'bakery.sahabaccounting.com': 3005,
    };
    for (const [host, port] of Object.entries(expected)) {
      const block = tls.find((entry) => entry.names.includes(host));
      expect(block, `لا كتلة TLS للمضيف ${host}`).toBeDefined();
      const ports = [...block!.body.matchAll(/proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)/g)].map((m) =>
        Number(m[1]),
      );
      expect(new Set(ports), `${host} يُوكّل إلى منافذ ${[...new Set(ports)].join(',')}`).toEqual(
        new Set([port]),
      );
    }
  });

  it('الجذر يوجّه إلى التسويق بدل 404، والغريب يُقطع بـ444', () => {
    const rootBlock = tls.find((entry) => entry.names.includes('sahabaccounting.com'));
    expect(rootBlock).toBeDefined();
    expect(rootBlock!.body).toContain('return 301 https://marketing.sahabaccounting.com$request_uri;');

    const fallback = blocks.find((entry) => entry.body.includes('default_server'));
    expect(fallback).toBeDefined();
    expect(fallback!.body).toContain('return 444;');
    // منفذ 80 يحتاج default_server خاصاً به أيضاً، وإلا التقط أولُ بلوك 80 كلَّ طلبٍ بعنوان IP.
    expect(conf).toContain('listen 80 default_server;');
  });

  it('`/metrics` للتشغيل لا للعالم: منعٌ صريح وتوجيه داخلي', () => {
    const metrics = /location = \/metrics \{([\s\S]*?)\n {4}\}/.exec(conf);
    expect(metrics, 'لا يوجد location = /metrics').not.toBeNull();
    expect(metrics![1]).toContain('deny all;');
    expect(metrics![1]).toContain('allow 127.0.0.1;');
    expect(metrics![1]).toContain('proxy_pass http://127.0.0.1:3000/metrics;');
  });

  it('لا تُمنح كتلة الواجهة مساراً إلى منفذ تطبيقٍ آخر (عزل الأسطح)', () => {
    for (const block of tls) {
      // كتلة الجذر تحويلٌ فقط (بلا proxy_pass)، فلا منفذ لها أصلاً.
      const ports = new Set(
        [...block.body.matchAll(/proxy_pass\s+http:\/\/127\.0\.0\.1:(\d+)/g)].map((m) => Number(m[1])),
      );
      if (ports.size === 0) continue;
      expect(ports.size, `${block.names.join(',')} يخلط منافذ: ${[...ports].join(',')}`).toBe(1);
    }
  });
});

describe('إعداد PM2 (deploy/vps/ecosystem.config.cjs)', () => {
  const config = (() => {
    // الملف CommonJS: يُقرأ كما يقرأه PM2، لا يُستورد كوحدة ESM.
    const output = execFileSync(
      process.execPath,
      [
        '-e',
        `const c = require(${JSON.stringify(join(root, 'deploy/vps/ecosystem.config.cjs'))});
         process.stdout.write(JSON.stringify({ apps: c.apps.map((a) => ({
           name: a.name, cwd: a.cwd, script: a.script, args: a.args ?? null, env: a.env,
           max_memory_restart: a.max_memory_restart ?? null,
         })) }));`,
      ],
      { encoding: 'utf8' },
    );
    return JSON.parse(output) as {
      apps: {
        name: string;
        cwd: string;
        script: string;
        args: string | null;
        env: Record<string, string>;
        max_memory_restart: string | null;
      }[];
    };
  })();

  const byName = (name: string) => config.apps.find((app) => app.name === name);

  it('سبع عمليات: API + worker + خمس واجهات — الـworker ليس اختيارياً', () => {
    expect(config.apps.map((app) => app.name).sort()).toEqual([
      'erp-api',
      'erp-bakery',
      'erp-customer-portal',
      'erp-marketing',
      'erp-platform-admin',
      'erp-staff',
      'erp-worker',
    ]);
    const worker = byName('erp-worker')!;
    expect(worker.env.WORKER).toBe('1');
    // العملية نفسها هي `dist/main.js`؛ الدور يُختار من `WORKER` لا من سكربتٍ آخر.
    expect(worker.script).toBe('dist/main.js');
    // `PORT` لعمليةٍ بلا مستمع HTTP تُوهم القارئ وتُربك أدوات الفحص.
    expect(worker.env.PORT).toBeUndefined();
  });

  it('الـAPI وحده يستمع على 3000، وعناوين الاستماع كلها loopback', () => {
    const api = byName('erp-api')!;
    expect(api.env.PORT).toBe('3000');
    expect(api.env.API_HOST).toBe('127.0.0.1');

    const ports: Record<string, string> = {
      'erp-staff': '3001',
      'erp-marketing': '3002',
      'erp-platform-admin': '3003',
      'erp-customer-portal': '3004',
      'erp-bakery': '3005',
    };
    for (const [name, port] of Object.entries(ports)) {
      const app = byName(name)!;
      expect(app.env.WEB_HOST, `${name} يستمع على كل الواجهات`).toBe('127.0.0.1');
      // المنفذ يُمرَّر للواجهة عبر `*_PORT` التي يقرأها `scripts/next-run.mjs`،
      // وليس `PORT`: ‏`PORT` كان يُستخدم سابقاً كهدفِ وكيل `/api/v1` فوكّلت الواجهة إلى نفسها.
      expect(app.env.PORT, `${name} يجب ألا يضبط PORT`).toBeUndefined();
      expect(Object.values(app.env)).toContain(port);
    }
  });

  it('يوكّل خلف Nginx على loopback فقط، والسقف يعرف العنوان الحقيقي', () => {
    // الـworker بلا مستمع HTTP أصلاً، فلا معنى لـ`TRUST_PROXY` فيه.
    const api = byName('erp-api')!;
    expect(api.env.TRUST_PROXY).toBe('loopback');
    // `true` تثق بكل `X-Forwarded-For`، فيتجاوز المهاجم سقف IP بعناوين وهمية.
    for (const app of config.apps) expect(app.env.TRUST_PROXY).not.toBe('true');
  });

  it('cwd مطلق داخل المستودع، وسقف ذاكرة مضبوط، وسجلّاتٌ تدور', () => {
    for (const app of config.apps) {
      expect(app.cwd.startsWith('/'), `${app.name} cwd نسبي: ${app.cwd}`).toBe(true);
      expect(app.max_memory_restart, `${app.name} بلا سقف ذاكرة`).not.toBeNull();
    }
    const raw = read('deploy/vps/ecosystem.config.cjs');
    // سجلّات كل عملية إلى ملفٍّ داخل المستودع، وتدويرها عبر `pm2-logrotate` (§10 في الدليل).
    expect(raw).toContain("error_file");
    expect(raw).toContain("out_file");
    expect(raw).toContain("max_memory_restart");
  });
});

describe('سكربت النشر (deploy/vps/deploy.sh)', () => {
  const script = read('deploy/vps/deploy.sh');

  it('قابل للتنفيذ ومُتحقَّقٌ صياغياً', () => {
    const mode = statSync(join(root, 'deploy/vps/deploy.sh')).mode;
    expect(mode & 0o111, 'deploy.sh ليس قابلاً للتنفيذ (chmod +x)').not.toBe(0);
    expect(() =>
      execFileSync('bash', ['-n', join(root, 'deploy/vps/deploy.sh')], { stdio: 'pipe' }),
    ).not.toThrow();
  });

  it('الهجرة قبل إعادة التشغيل، والفحص بعدها', () => {
    const migrate = script.indexOf('db:migrate');
    const reload = script.indexOf('startOrReload');
    const health = script.indexOf('/health/ready');
    expect(migrate).toBeGreaterThan(-1);
    expect(reload).toBeGreaterThan(migrate);
    expect(health).toBeGreaterThan(reload);
  });

  it('يُثبّت `API_PROXY_TARGET` قبل البناء — القيمة تُخبز في routes-manifest', () => {
    const pinned = script.indexOf('API_PROXY_TARGET');
    const build = script.indexOf('pnpm run build');
    expect(pinned).toBeGreaterThan(-1);
    expect(build).toBeGreaterThan(pinned);
  });

  it('يمنع نشرين متزامنين', () => {
    expect(script).toContain('flock');
  });
});

describe('توثيق البيئة والبناء', () => {
  it('.env.example يشرح WEB_HOST وAPI_PROXY_TARGET', () => {
    const env = read('.env.example');
    expect(env).toContain('WEB_HOST');
    expect(env).toContain('API_PROXY_TARGET');
    expect(env).toContain('TRUST_PROXY');
  });

  it('كل واجهة تُوكّل افتراضياً إلى 127.0.0.1:3000 لا إلى منفذها', () => {
    for (const app of ['staff', 'marketing', 'platform-admin', 'customer-portal', 'bakery']) {
      const config = read(`apps/${app}/next.config.mjs`);
      expect(config, `${app} لا يضبط هدف الوكيل`).toContain('http://127.0.0.1:3000');
      expect(config, `${app} ما زال يبني الهدف من PORT`).not.toMatch(/API_PROXY_TARGET[^\n]*\$\{?PORT/);
    }
  });
});
