/**
 * عقد المسارات بين الواجهات والـ API.
 *
 * السبب: لوحة المنصة كانت تنادي `GET /marketplace/platform/requests` بينما المسار الحقيقي
 * `GET /platform/marketplace/requests` — أي أنّ إدارة الباقات القطاعية في الكونسول كانت تردّ 404
 * دائماً، وبعضها كان مغلَّفاً بـ `.catch(() => [])` فبدا «لا طلبات» بدل أن يبدو عطلاً. الاختبارات
 * الوحدوية للـ API لم تكشفه لأنها تنادي المسارات الصحيحة، واختبارات الواجهات تُحاكي `apiFetch`
 * فلا ترى الجدول الحقيقي. هذا الاختبار يقرأ الجدول من ملفات الـ controllers نفسها ويقارنه بكل
 * نداءٍ حرفي في الواجهات، فيسقط على: بادئة خاطئة، فعل HTTP خاطئ، أو مقطع زائد/ناقص.
 *
 * الحدود (بصراحة): يفحص النداءات ذات المسار الحرفي فقط (نص أو قالب `${}`)، ويتجاهل المسارات
 * المبنية بمتغيّرات أو لواصق، لأنه لا يستطيع معرفة شكلها وقت التحليل.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i += 1) {
    if (statSync(join(dir, 'pnpm-workspace.yaml'), { throwIfNoEntry: false })) return dir;
    dir = join(dir, '..');
  }
  throw new Error('لم يُعثر على جذر المستودع (pnpm-workspace.yaml)');
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

type Route = { method: string; path: string; source: string };

/**
 * كل المسارات التي يصرّح بها الـ API، مقروءةً من زخارف `@Controller` + `@Get/@Post/...`.
 * الملف الواحد قد يعلن أكثر من controller (مثلاً `approvals.controller.ts`)، لذا يُنسب كل فعل إلى
 * أقرب `@Controller` سابقٍ له في نفس الملف لا إلى أول واحدٍ فيه.
 */
function apiRoutes(root: string): Route[] {
  const files = walk(join(root, 'apps', 'api', 'src')).filter((file) => file.endsWith('.controller.ts'));
  const decorator = /@(Controller|Get|Post|Put|Delete|Patch)\(\s*((?:\[[^\]]*\])|'[^']*'|`[^`]*`|\{[^}]*?path:\s*'[^']*')?/g;
  const routes: Route[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let prefix = '';
    let match = decorator.exec(text);
    while (match) {
      // الزخرفة قد تحمل مساراً واحداً أو قائمة مساراتٍ مترادفة: `@Get(['a', 'approvals/a'])`.
      const declared = (match[2] ?? '').match(/'[^']*'|`[^`]*`/g) ?? [];
      const values = (declared.length > 0 ? declared : ["''"]).map((literal) =>
        literal.slice(1, -1).replace(/^\/+|\/+$/g, ''),
      );
      if (match[1] === 'Controller') {
        prefix = values[0] ?? '';
      } else {
        for (const value of values) {
          routes.push({
            method: (match[1] as string).toUpperCase(),
            path: `/${[prefix, value].filter(Boolean).join('/')}`.replace(/\/{2,}/g, '/'),
            source: relative(root, file),
          });
        }
      }
      match = decorator.exec(text);
    }
  }
  return routes;
}

const HELPER_METHODS: Record<string, string> = {
  apiData: 'GET',
  apiList: 'GET',
  apiGet: 'GET',
  apiPost: 'POST',
  apiPut: 'PUT',
  apiPatch: 'PATCH',
  apiDelete: 'DELETE',
};

type CallSite = {
  file: string;
  line: number;
  helper: string;
  method: string;
  raw: string;
  path: string;
  /** true حين يحتوي القالب تعبيراً مركَّباً فيتوقّف التحليل عند أول مقطعٍ غير قابلٍ للحسم. */
  partial: boolean;
};

const METHOD_OVERRIDE = /\bmethod:\s*'(GET|POST|PUT|PATCH|DELETE)'/;

/**
 * `apiData`/`apiList` يقبلان تجاوز الفعل عبر `{ method: 'POST' }` — نمطٌ مستعمل فعلاً في لوحة
 * المنصة (نشر إعلان، دخول، …). نقرأ التجاوز من نفس العبارة (حتى أول `;`) ولا نخمّن بعده.
 */
function methodOverride(text: string, from: number): string | undefined {
  const statement = text.slice(from, from + 400).split(';')[0] ?? '';
  return statement.match(METHOD_OVERRIDE)?.[1];
}

/**
 * تطبيع مسارٍ حرفي إلى مقاطع:
 * - `${expr}` بسيط في موضع مقطع (مسبوق بـ `/`) → `:`.
 * - تعبيرٌ ملتصق بآخر مقطع (`${queryString}`، `?kind=${kind}`) أو مركَّب (شرط، استدعاء، قوس)
 *   → يُقطَّع المسار عنده ويُعلَّم `partial`، فيُقارن بالبادئة فقط؛ لأنّ ما بعده سلسلة استعلام
 *   في الغالب ولا يمكن حسْم شكله وقت التحليل.
 * - سلسلة الاستعلام تُحذف بعد تطبيع التعبيرات، حتى لا يقطع `?.` داخل تعبيرٍ صحيح.
 */
function normalisePath(raw: string): { path: string; partial: boolean } | undefined {
  if (!raw.startsWith('/')) return undefined;
  let out = '';
  let partial = false;
  let index = 0;
  while (index < raw.length) {
    const start = raw.indexOf('${', index);
    if (start < 0) {
      out += raw.slice(index);
      break;
    }
    out += raw.slice(index, start);
    const end = raw.indexOf('}', start);
    if (end < 0) {
      partial = true;
      break;
    }
    const expression = raw.slice(start + 2, end);
    const glued = start > 0 && raw[start - 1] !== '/';
    const complex = /[{}()]/.test(expression) || expression.includes('`');
    if (glued || complex) {
      partial = true;
      break;
    }
    out += ':';
    index = end + 1;
  }
  let path = (out.split('?')[0] ?? '').replace(/\/{2,}/g, '/');
  if (!path.startsWith('/')) return undefined;
  if (partial) path = path.replace(/\/?:[^/]*$/, ''); // آخر مقطعٍ قد يكون ناقصاً
  if (path.length > 1) path = path.replace(/\/+$/, '');
  return path === '' ? undefined : { path, partial };
}

/** كل نداءٍ حرفي في واجهات المستودع، مقترناً بمساعده المباشر (لا بأقرب اسمٍ قبله). */
function callSites(root: string, app: string): CallSite[] {
  const dir = join(root, 'apps', app);
  if (!statSync(dir, { throwIfNoEntry: false })) return [];
  const files = walk(dir).filter((file) => /\.(ts|tsx)$/.test(file) && !/\.(spec|test)\.tsx?$/.test(file));
  const helpers = Object.keys(HELPER_METHODS).join('|');
  const pattern = new RegExp(
    `\\b(${helpers})\\b(<[^()]*>)?\\(\\s*(\`[^\`\\n]*\`|'[^'\\n]*'|"[^"\\n]*")`,
    'g',
  );
  const sites: CallSite[] = [];
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    let match = pattern.exec(text);
    while (match) {
      const helper = match[1] as string;
      const raw = (match[3] as string).slice(1, -1);
      // مسارٌ مبنيٌّ باللصق (`'/x/' + id + '/y'`) لا يمكن حسْمه من النص، فيُتجاهل صراحةً.
      const after = text.slice(match.index + match[0].length, match.index + match[0].length + 3);
      const concatenated = /^\s*\+/.test(after);
      const normalised = concatenated ? undefined : normalisePath(raw);
      if (normalised) {
        sites.push({
          file: relative(root, file),
          line: text.slice(0, match.index).split('\n').length,
          helper,
          method: methodOverride(text, match.index + match[0].length) ?? HELPER_METHODS[helper] ?? 'GET',
          raw,
          path: normalised.path,
          partial: normalised.partial,
        });
      }
      match = pattern.exec(text);
    }
  }
  return sites;
}

function segments(path: string): string[] {
  return path.split('/').filter(Boolean);
}

function pathMatches(routePath: string, callPath: string): boolean {
  const route = segments(routePath);
  const call = segments(callPath);
  if (route.length !== call.length) return false;
  return route.every((segment, index) => {
    const other = call[index] ?? '';
    if (segment.startsWith(':') || other.startsWith(':')) return true;
    return segment === other;
  });
}

function startsWith(routePath: string, callPath: string): boolean {
  const route = segments(routePath);
  const call = segments(callPath);
  if (call.length > route.length) return false;
  return call.every((segment, index) => {
    const other = route[index] ?? '';
    if (segment.startsWith(':') || other.startsWith(':')) return true;
    return segment === other;
  });
}

/** هل يخدم الـ API هذا النداء (فعل + مسار، أو بادئة مسار حين يكون القالب مركَّباً)؟ */
function served(routes: Route[], site: CallSite): Route | undefined {
  return routes.find((route) => {
    if (route.method !== site.method) return false;
    return site.partial ? startsWith(route.path, site.path) : pathMatches(route.path, site.path);
  });
}

describe('console ↔ api route contract', () => {
  const root = repoRoot();
  const routes = apiRoutes(root);
  const apps = ['platform-admin', 'bakery', 'customer-portal', 'staff'];
  const sites = apps.flatMap((app) => callSites(root, app));

  it('يقرأ جدول مسارات الـ API من ملفات الـ controllers نفسها', () => {
    expect(routes.length).toBeGreaterThan(200);
    expect(routes.some((route) => route.path === '/platform/marketplace/requests')).toBe(true);
    // المسار الخاطئ الذي كانت لوحة المنصة تناديه يجب ألّا يكون موجوداً في الجدول.
    expect(routes.some((route) => route.path === '/marketplace/platform/requests')).toBe(false);
  });

  it('يجد نداءاتٍ حرفية في الواجهات (حتى لا يمرّ الاختبار وهو لا يفحص شيئاً)', () => {
    expect(sites.length).toBeGreaterThan(100);
    for (const app of ['platform-admin', 'bakery']) {
      expect(callSites(root, app).length, app).toBeGreaterThan(2);
    }
  });

  it('كل نداءٍ حرفي في الواجهات يقابله مسارٌ حقيقي بنفس فعل HTTP', () => {
    const violations: string[] = [];
    for (const site of sites) {
      if (served(routes, site)) continue;
      const samePathOtherVerb = routes
        .filter((route) => pathMatches(route.path, site.path))
        .map((route) => `${route.method} ${route.path}`)
        .join(' | ');
      violations.push(
        `${site.file}:${site.line} — ${site.method} ${site.path} (من ${site.raw})` +
          (samePathOtherVerb ? ` | المسار موجود بفعلٍ آخر: ${samePathOtherVerb}` : ''),
      );
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
