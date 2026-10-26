import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(TEST_DIR, '../../..');
const API_MODULES_DIR = path.join(REPO_ROOT, 'apps/api/src/modules');
const BAKERY_SRC = path.join(REPO_ROOT, 'apps/android-bakery/app/src/main/java/com/erpcloud/bakery');
const REP_SRC = path.join(REPO_ROOT, 'apps/android-rep/app/src/main/java/com/erpcloud/rep');

function walkFiles(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkFiles(full, suffix));
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
  return out.sort();
}

function normalizeRoute(route: string): string {
  return route
    .replace(/^\//, '')
    .replace(/\/$/, '')
    .replace(/\{[^}]+\}/g, ':param')
    .replace(/:[A-Za-z0-9_]+/g, ':param');
}

function collectNestRoutes(): Set<string> {
  const routes = new Set<string>();
  for (const file of walkFiles(API_MODULES_DIR, '.controller.ts')) {
    const src = fs.readFileSync(file, 'utf8');
    const ctrlRe = /@Controller\(([^)]*)\)/g;
    const ctrlMatches = [...src.matchAll(ctrlRe)];
    for (let idx = 0; idx < ctrlMatches.length; idx++) {
      const cm = ctrlMatches[idx]!;
      const rawArg = cm[1]!.trim();
      const prefixes: string[] = [];
      if (!rawArg) {
        prefixes.push('');
      } else if (rawArg.startsWith('[')) {
        for (const sm of rawArg.matchAll(/['"`]([^'"`]*)['"`]/g)) prefixes.push(sm[1]!);
      } else {
        const sm = rawArg.match(/['"`]([^'"`]*)['"`]/);
        prefixes.push(sm ? sm[1]! : '');
      }
      const start = cm.index!;
      const end = idx + 1 < ctrlMatches.length ? ctrlMatches[idx + 1]!.index! : src.length;
      const block = src.slice(start, end);
      const methodRe = /@(Get|Post|Put|Patch|Delete)\(([^)]*)\)/g;
      for (const mm of block.matchAll(methodRe)) {
        const verb = mm[1]!.toUpperCase();
        const mArg = mm[2]!.trim();
        const suffixes: string[] = [];
        if (!mArg) {
          suffixes.push('');
        } else if (mArg.startsWith('[')) {
          for (const sm of mArg.matchAll(/['"`]([^'"`]*)['"`]/g)) suffixes.push(sm[1]!);
        } else {
          const sm = mArg.match(/['"`]([^'"`]*)['"`]/);
          suffixes.push(sm ? sm[1]! : '');
        }
        for (const p of prefixes) {
          for (const s of suffixes) {
            const full = [p, s]
              .filter(Boolean)
              .join('/')
              .replace(/\/+/g, '/');
            routes.add(`${verb} ${normalizeRoute(full)}`);
          }
        }
      }
    }
  }
  return routes;
}

function collectRetrofitRoutes(ktPath: string): Array<{ verb: string; raw: string; normalized: string }> {
  const src = fs.readFileSync(ktPath, 'utf8');
  const re = /@(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"\)/g;
  const out: Array<{ verb: string; raw: string; normalized: string }> = [];
  for (const m of src.matchAll(re)) {
    const verb = m[1]!;
    const raw = m[2]!.split('?')[0]!;
    out.push({ verb, raw, normalized: `${verb} ${normalizeRoute(raw)}` });
  }
  return out;
}

/** Strips Kotlin line/block comments and string/char literals to inspect structural braces cleanly. */
function stripKotlinCommentsAndStrings(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (src.startsWith('/*', i)) {
      i += 2;
      while (i < src.length && !src.startsWith('*/', i)) i++;
      i += 2;
      continue;
    }
    if (src.startsWith('"""', i)) {
      i += 3;
      while (i < src.length && !src.startsWith('"""', i)) i++;
      i += 3;
      continue;
    }
    if (src[i] === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\') i += 2;
        else i++;
      }
      i++;
      continue;
    }
    if (src[i] === "'") {
      i++;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\') i += 2;
        else i++;
      }
      i++;
      continue;
    }
    out += src[i];
    i++;
  }
  return out;
}

describe('Android apps (`android-bakery` & `android-rep`) cloud contract & accounting parity', () => {
  const serverRoutes = collectNestRoutes();

  it('matches all 147 Retrofit routes in BakeryApi.kt and all 24 routes in RepApi.kt to NestJS controllers', () => {
    const bakeryRoutes = collectRetrofitRoutes(path.join(BAKERY_SRC, 'data/api/BakeryApi.kt'));
    const repRoutes = collectRetrofitRoutes(path.join(REP_SRC, 'data/api/RepApi.kt'));

    expect(bakeryRoutes.length).toBeGreaterThanOrEqual(147);
    expect(repRoutes.length).toBeGreaterThanOrEqual(24);

    const bakeryMismatches = bakeryRoutes.filter((r) => !serverRoutes.has(r.normalized));
    const repMismatches = repRoutes.filter((r) => !serverRoutes.has(r.normalized));

    expect(bakeryMismatches).toEqual([]);
    expect(repMismatches).toEqual([]);
  });

  it('pins cloud API endpoint to https://api.sahabaccounting.com/api/v1/ matching Nginx TLS vhost', () => {
    const nginx = fs.readFileSync(path.join(REPO_ROOT, 'deploy/vps/nginx-erpcloud.conf'), 'utf8');
    expect(nginx).toContain('server_name api.sahabaccounting.com;');

    for (const root of [BAKERY_SRC, REP_SRC]) {
      const network = fs.readFileSync(path.join(root, 'data/api/Network.kt'), 'utf8');
      const session = fs.readFileSync(path.join(root, 'data/offline/SessionStore.kt'), 'utf8');
      expect(network).toContain('.baseUrl("https://api.sahabaccounting.com/api/v1/")');
      expect(session).toContain('DEFAULT_SERVER_URL = "https://api.sahabaccounting.com"');
    }
  });

  it('enforces Makkah timezone (Asia/Riyadh) and minSdk 24 safety (zero java.time imports or unzoned formatters)', () => {
    const allKt = [...walkFiles(BAKERY_SRC, '.kt'), ...walkFiles(REP_SRC, '.kt')];
    expect(allKt.length).toBeGreaterThanOrEqual(107);

    for (const file of allKt) {
      const rel = path.relative(REPO_ROOT, file);
      const src = fs.readFileSync(file, 'utf8');
      const codeOnly = stripKotlinCommentsAndStrings(src);

      expect(codeOnly, `${rel} must not use API-26+ java.time.* on minSdk=24`).not.toMatch(/\bjava\.time\./);
      expect(codeOnly, `${rel} must not import java.time.* on minSdk=24`).not.toMatch(
        /\bimport\s+java\.time\./,
      );

      if (!rel.endsWith('MakkahTime.kt')) {
        expect(codeOnly, `${rel} must delegate SimpleDateFormat to MakkahTime`).not.toMatch(
          /\bSimpleDateFormat\b/,
        );
        expect(codeOnly, `${rel} must delegate Calendar to MakkahTime`).not.toMatch(
          /\bCalendar\.getInstance\b/,
        );
      } else {
        expect(src, `${rel} must pin ZONE_ID = "Asia/Riyadh"`).toContain('ZONE_ID: String = "Asia/Riyadh"');
      }
    }
  });

  it('preserves ACC-061 line discount rates, ACC-053 cost centers, safe/bank kind filters, and Arabic warehouse labels', () => {
    const staffDtos = fs.readFileSync(path.join(BAKERY_SRC, 'data/api/StaffDtos.kt'), 'utf8');
    expect(staffDtos).toContain('val costCenterId: String? = null');

    const purchases = fs.readFileSync(path.join(BAKERY_SRC, 'ui/screens/PurchasesScreen.kt'), 'utf8');
    expect(purchases).toContain('val discountRate: String = "0"');
    expect(purchases).toContain('discountRate = it.discountRate.ifBlank { "0" }');
    expect(purchases).toContain('put("discountRate", Dec.wire(line.discountRate))');
    expect(purchases).toContain('put("referenceInvoiceId", referenceInvoiceId)');
    expect(purchases).not.toContain('it.kind == "cash"');

    const sales = fs.readFileSync(path.join(BAKERY_SRC, 'ui/screens/SalesInvoicesScreen.kt'), 'utf8');
    expect(sales).toContain('val discountRate: String = "0"');
    expect(sales).toContain('discountRate = it.discountRate.ifBlank { "0" }');
    expect(sales).toContain('put("discountRate", Dec.wire(line.discountRate))');
    expect(sales).toContain('line.costCenterId?.takeIf { it.isNotBlank() }?.let { put("costCenterId", it) }');
    expect(sales).not.toContain('it.kind == "cash"');

    const bakeryDtos = fs.readFileSync(path.join(BAKERY_SRC, 'data/api/BakeryDtos.kt'), 'utf8');
    expect(bakeryDtos).toContain('"main branch", "main warehouse", "default warehouse" -> "المستودع الرئيسي"');

    const repDec = fs.readFileSync(path.join(REP_SRC, 'util/Dec.kt'), 'utf8');
    expect(repDec).toContain("if ('.' in intermediate) return intermediate.replace(\",\", \"\")");
    expect(repDec).toContain('if (commaCount > 1) return intermediate.replace(",", "")');

    const zatcaQr = fs.readFileSync(path.join(BAKERY_SRC, 'printing/ZatcaQr.kt'), 'utf8');
    expect(zatcaQr).toContain("[+-]\\\\d{2}(?::?\\\\d{2})?$");
  });

  it('aligns Android print engines and error catalogs with quota enforcement and rptInv / ZATCA Phase-2 rules', () => {
    const bakeryErrors = fs.readFileSync(path.join(BAKERY_SRC, 'data/api/ErrorsAr.kt'), 'utf8');
    const repErrors = fs.readFileSync(path.join(REP_SRC, 'data/api/ErrorsAr.kt'), 'utf8');
    expect(bakeryErrors).toContain('USAGE_LIMIT_REACHED');
    expect(bakeryErrors).toContain('إدارة المنصة');
    expect(repErrors).toContain('USAGE_LIMIT_REACHED');
    expect(repErrors).toContain('إدارة المنصة');

    const bakeryPrintDto = fs.readFileSync(path.join(BAKERY_SRC, 'data/api/PrintDtos.kt'), 'utf8');
    const repPrintDto = fs.readFileSync(path.join(REP_SRC, 'data/api/PrintDtos.kt'), 'utf8');
    for (const dto of [bakeryPrintDto, repPrintDto]) {
      expect(dto).toContain('val zatcaPhase: Int = 1');
      expect(dto).toContain('val invoiceTitleAr: String = ""');
      expect(dto).toContain('val returnPolicy: String = ""');
      expect(dto).toContain('val customerAddress: JsonObject? = null');
      expect(dto).toContain('fun JsonObject?.formatNationalAddressAr(): String');
    }

    const bakeryDocs = fs.readFileSync(path.join(BAKERY_SRC, 'printing/BakeryDocs.kt'), 'utf8');
    const repBitmap = fs.readFileSync(path.join(REP_SRC, 'printing/InvoiceBitmap.kt'), 'utf8');
    for (const renderer of [bakeryDocs, repBitmap]) {
      expect(renderer).toContain('"فاتورة ضريبية"');
      expect(renderer).toContain('"فاتورة ضريبية مبسطة"');
      expect(renderer).toContain('if (hasCustomerTax)');
      expect(renderer).toContain('"العنوان الوطني للعميل"');
      expect(renderer).toContain('سياسة الاسترجاع والاستبدال');
      expect(renderer).toContain('المرحلة الثانية');
    }

    const bakeryRepo = fs.readFileSync(path.join(BAKERY_SRC, 'data/BakeryRepository.kt'), 'utf8');
    expect(bakeryRepo).toContain('(?:sheet|pos-sheet)');
  });

  it('maintains balanced braces and parentheses across all Kotlin source files in both Android apps', () => {
    const allKt = [...walkFiles(BAKERY_SRC, '.kt'), ...walkFiles(REP_SRC, '.kt')];
    for (const file of allKt) {
      const rel = path.relative(REPO_ROOT, file);
      const stripped = stripKotlinCommentsAndStrings(fs.readFileSync(file, 'utf8'));
      let braces = 0;
      let parens = 0;
      for (const ch of stripped) {
        if (ch === '{') braces++;
        else if (ch === '}') braces--;
        else if (ch === '(') parens++;
        else if (ch === ')') parens--;
        if (braces < 0) throw new Error(`Unmatched '}' in ${rel}`);
        if (parens < 0) throw new Error(`Unmatched ')' in ${rel}`);
      }
      expect(braces, `Unclosed '{' in ${rel}`).toBe(0);
      expect(parens, `Unclosed '(' in ${rel}`).toBe(0);
    }
  });
});
