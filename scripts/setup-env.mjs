#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * `pnpm env:setup` — create a working `.env` at the repository root.
 *
 * Copies every documented variable from `.env.example` and fills in the values that
 * cannot have a default:
 *
 *   • the RS256 JWT key pair, the AES-256-GCM data-encryption key and the file-URL
 *     signing secret;
 *   • the five seed passwords (platform operator, demo owner, accountant, cashier, van-sales
 *     rep), so
 *     `pnpm db:seed` produces accounts that can actually sign in without the operator
 *     inventing anything. They are written in clear text into `.env` (mode 0600, and
 *     git-ignored) and printed once below — this is a development convenience, a
 *     production deployment supplies its own.
 *
 * Never overwrites an existing `.env` unless `--force` is passed.
 */
import { generateKeyPairSync, randomBytes, randomInt } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const target = join(root, '.env');
const force = process.argv.includes('--force');
const localUrls = process.argv.includes('--local');

if (existsSync(target) && !force) {
  console.log(`.env already exists at ${target} — nothing to do (use --force to regenerate).`);
  process.exit(0);
}

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const escape = (pem) => pem.trim().replace(/\r?\n/g, '\\n');
const dataEncKey = randomBytes(32).toString('base64');
const fileSigningSecret = randomBytes(32).toString('base64');
const compatPepper = randomBytes(32).toString('base64');

/**
 * A password that satisfies the platform policy by construction: 20 characters, four
 * character classes, no dictionary word and nothing derived from the account it belongs
 * to. Ambiguous glyphs (O/0, l/1) are left out so it survives being read off a screen.
 */
function strongPassword() {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*?-_+=';
  const all = lower + upper + digits + symbols;

  const pick = (alphabet) => alphabet[randomInt(alphabet.length)];
  // One of each class first, so the class requirement can never fail by chance.
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (chars.length < 20) chars.push(pick(all));

  // Fisher–Yates with a CSPRNG so the guaranteed characters are not always in front.
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

const seedPasswords = {
  PLATFORM_ADMIN_PASSWORD: strongPassword(),
  DEMO_OWNER_PASSWORD: strongPassword(),
  DEMO_ACCOUNTANT_PASSWORD: strongPassword(),
  DEMO_CASHIER_PASSWORD: strongPassword(),
  DEMO_REP_PASSWORD: strongPassword(),
};

const templatePath = join(root, '.env.example');
let content = existsSync(templatePath) ? readFileSync(templatePath, 'utf8') : '';

const surfaceUrls = localUrls
  ? {
      PUBLIC_APP_URL: 'http://localhost:3002',
      NEXT_PUBLIC_STAFF_URL: 'http://localhost:3001',
      NEXT_PUBLIC_PORTAL_URL: 'http://localhost:3004',
      NEXT_PUBLIC_PLATFORM_URL: 'http://localhost:3003',
      NEXT_PUBLIC_MARKETING_URL: 'http://localhost:3002',
      NEXT_PUBLIC_BAKERY_URL: 'http://localhost:3005',
      NEXT_PUBLIC_SUPPORT_EMAIL: 'support@sahabaccounting.com',
      CUSTOMER_PUBLIC_URL: 'http://localhost:3004',
      CONSOLE_PUBLIC_URL: 'http://localhost:3003',
      CORS_ALLOWED_ORIGINS:
        'http://localhost:3001,http://localhost:3002,http://localhost:3003,http://localhost:3004,http://localhost:3005',
    }
  : {
      PUBLIC_APP_URL: 'https://sahabaccounting.com',
      NEXT_PUBLIC_STAFF_URL: 'https://staff.sahabaccounting.com',
      NEXT_PUBLIC_PORTAL_URL: 'https://portal.sahabaccounting.com',
      NEXT_PUBLIC_PLATFORM_URL: 'https://admin.sahabaccounting.com',
      NEXT_PUBLIC_MARKETING_URL: 'https://sahabaccounting.com',
      NEXT_PUBLIC_BAKERY_URL: 'https://bakery.sahabaccounting.com',
      NEXT_PUBLIC_SUPPORT_EMAIL: 'support@sahabaccounting.com',
      CUSTOMER_PUBLIC_URL: 'https://portal.sahabaccounting.com',
      CONSOLE_PUBLIC_URL: 'https://admin.sahabaccounting.com',
      CORS_ALLOWED_ORIGINS:
        'https://sahabaccounting.com,https://staff.sahabaccounting.com,https://portal.sahabaccounting.com,https://admin.sahabaccounting.com,https://bakery.sahabaccounting.com',
    };

const replacements = {
  JWT_PRIVATE_KEY: `"${escape(privateKey)}"`,
  JWT_PUBLIC_KEY: `"${escape(publicKey)}"`,
  DATA_ENC_KEY: dataEncKey,
  FILE_URL_SIGNING_SECRET: fileSigningSecret,
  COMPAT_KEY_PEPPER: compatPepper,
  ...surfaceUrls,
  ...seedPasswords,
};

for (const [key, value] of Object.entries(replacements)) {
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  /**
   * دالّةٌ لا نصّ استبدال: `String.replace` يقرأ `$&` و`$'` و`$\`` داخل النصّ البديل
   * كأنماطٍ خاصّة. وكلمات المرور المولّدة تحتوي `$` (من مجموعة الرموز)، فقد تُولَد كلمة
   * مرورٍ تحمل `$&` فيُحقَن سطر `.env` القديم داخل السطر الجديد — وتُكتب كلمةٌ تالفة بلا
   * خطأ. حدث هذا فعلاً: `DEMO_REP_PASSWORD=JQHX69$&…` صار سطراً مزدوجاً يحوي كلمة
   * «PASSWORD»، فرفضته سياسة كلمة المرور (تحتوي «password») وسقط التهيئة.
   */
  content = pattern.test(content)
    ? content.replace(pattern, () => `${key}=${value}`)
    : `${content}\n${key}=${value}\n`;
}

writeFileSync(target, content, { mode: 0o600 });

const readEnv = (key) => {
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match ? match[1].trim() : '';
};

console.log(`Wrote ${target}`);
console.log('  • generated a fresh RS256 key pair (JWT_PRIVATE_KEY / JWT_PUBLIC_KEY)');
console.log('  • generated DATA_ENC_KEY, FILE_URL_SIGNING_SECRET and COMPAT_KEY_PEPPER (32 random bytes each)');
console.log('  • generated the five seed passwords listed below');
console.log('');
console.log('Accounts `pnpm db:seed` will create (also stored in .env):');
console.log('');
console.log(`  platform console  ${readEnv('PLATFORM_ADMIN_EMAIL')}`);
console.log(`    tenant code     ${readEnv('PLATFORM_TENANT_CODE') || 'platform'}`);
console.log(`    password        ${seedPasswords.PLATFORM_ADMIN_PASSWORD}`);
console.log('');
console.log(`  company owner     ${readEnv('DEMO_OWNER_EMAIL')}`);
console.log(`    tenant code     ${readEnv('DEMO_TENANT_CODE') || 'demo'}`);
console.log(`    password        ${seedPasswords.DEMO_OWNER_PASSWORD}`);
console.log('');
console.log(`  accountant        ${readEnv('DEMO_ACCOUNTANT_EMAIL')}  /  ${seedPasswords.DEMO_ACCOUNTANT_PASSWORD}`);
console.log(`  cashier           ${readEnv('DEMO_CASHIER_EMAIL')}  /  ${seedPasswords.DEMO_CASHIER_PASSWORD}`);
console.log('');
console.log('The rep signs into the bakery app, not the staff panel:');
console.log(`  rep (van sales)   ${readEnv('DEMO_REP_EMAIL')}  /  ${seedPasswords.DEMO_REP_PASSWORD}`);
console.log(`    tenant code     ${readEnv('DEMO_TENANT_CODE') || 'demo'}`);
console.log(`    opens           http://localhost:${readEnv('BAKERY_PORT') || '3005'}/rep`);
console.log('');
console.log('Next steps:');
console.log('  1. pnpm db:up            # postgres + redis + minio via docker compose');
console.log('  2. pnpm db:roles         # create the erp_api / erp_migrator roles');
console.log('  3. pnpm db:migrate       # apply the SQL migrations');
console.log('  4. pnpm db:seed          # reads the passwords above from .env');
console.log('  5. pnpm dev              # api :3000, admin :3001, customer :3002, bakery :3005');
