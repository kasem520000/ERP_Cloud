#!/usr/bin/env node
/**
 * `pnpm db:backup` / `db:restore` / `db:drill` — نسخُ القاعدة واستعادتها، **ومُختبَر الاستعادة
 * مُضمَّنٌ فيها** (‏`drill`) لأنّ نسخةً لم تُستعد ليست نسخة.
 *
 * لماذا وضعان؟
 *
 *   1. ‏**`pg_dump`** (المسار الإنتاجيّ، وهو ما تشغّله `deploy/k8s/backup.yaml`): أرشيفٌ
 *      ثنائيّ ‏`-Fc` يحمل المخطّط والبيانات معًا، وتُستعاد بـ`pg_restore --clean --if-exists`.
 *      وهو **الأداة الصحيحة** ولا يُستبدل بها شيء.
 *   2. ‏**`sql`** (مسارُ التطوير): نسخٌ منطقيٌّ بـ`SELECT`/`INSERT` عبر `pg` وحدها — لأنّ
 *      postgres المضمَّن في التطوير (`pnpm db:local`) يشحن `initdb` و`pg_ctl` و`postgres`
 *      **بلا `pg_dump`** (قِيس: `native/bin` فيها ثلاثةُ ملفات فقط)، فبلا هذا الوضع لا يُختبر
 *      الاستعادةُ على آلة المطوّر أصلًا. وهو **بياناتٌ فقط**: يفترض قاعدةً مُرحَّلة بنفس
 *      الإصدار، ويرفض إن اختلف رأسُ `erp_migrations` (فالاستعادةُ إلى مخطّطٍ آخر كسرٌ صامت).
 *
 * القواعدُ التي لا تُكسر:
 *   - **الاستعادةُ تكتب في قاعدةٍ الهدف**، ولا تلمس قاعدةَ المصدر؛ و`drill` ينشئ قاعدةً
 *     مؤقّتةً باسمٍ فيه `drill` ورقمُ العملية، ويُرحّلها، ويستعيد فيها، ويقارن، ثمّ
 *     **يحذفها** — فما يُحذف من صنع الأداة وحدها لا بياناتُ أحد.
 *   - كلّ كتابةِ استعادة في **معاملةٍ واحدة**: فإمّا أن تعود القاعدةُ كلّها أو لا يعود شيء.
 *   - `SET LOCAL session_replication_role = replica` (يتطلّب صلاحيةً عليا — قِيس أنّ مستخدم
 *     الترحيل `app` يملكها) حتى لا تُكسر المفاتيحُ الأجنبية بسبب ترتيب الجداول؛ وإن رفضها
 *     الخادمُ تتوقّف الأداةُ برسالتِه ولا تُكمل بنصف استعادة.
 *   - **التحقّقُ بالعدّ**: لكلّ جدولٍ عددُ صفوفٍ في البيان (‏`manifest.json`) يُقارن بما في
 *     القاعدة بعد الاستعادة، وأيُّ فرقٍ يُطبع ويُخرج الأداةَ بغير صفر.
 *   - أعمدةُ `bytea` (‏`users.mfa_secret_enc` و`esign_requests.signed_pdf` — قِيست: هما
 *     الوحيدان في المخطّط) تُحمل base64 وتُستعاد بـ`decode(…,'base64')::bytea`، فلا يضيع
 *     سرُّ MFA ولا ملفُّ توقيعٍ في النسخ.
 *   - لا تُخزَّن كلمةُ سرٍّ في الملفّات: البيانُ يحمل اسمَ القاعدة ورأسَ الهجرة والعدّ لا غير.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { loadEnvFiles } from './dotenv.mjs';

/**
 * ‏`pg` تُحلّ من `packages/database` لا من جذر المستودع: فـpnpm صارمٌّ في `node_modules`
 * والحزمةُ تابعةٌ لتلك الحزمة لا للجذر (‏`ERR_MODULE_NOT_FOUND` قِيس عند الاستيراد المباشر)،
 * والحلُّ بـ`createRequire` هو النمطُ المستعمل في `scripts/next-run.mjs` لحلّ `next`.
 */
const require = createRequire(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'database', 'noop.js'));
const pg = require('pg');

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadEnvFiles(repoRoot);

const HELP = `
نسخُ القاعدة واستعادتها — ونسخةٌ لم تُختبر استعادتها ليست نسخة.

  pnpm db:backup                         # نسخةٌ في backups/ (‏pg_dump إن وُجد، وإلا الوضع sql)
  pnpm db:backup -- --mode sql --keep 5  # وضعُ التطوير، وإبقاءُ آخر ٥ نسخ
  pnpm db:restore -- --from backups/<name> --db app_restored
  pnpm db:verify -- --from backups/<name> --db app
  pnpm db:drill                          # **اختبارُ استعادةٍ كامل**: نسخة ← قاعدةٌ مؤقّتة ←
                                         # ترحيل ← استعادة ← مقارنةُ العدّ ← حذفُ المؤقّتة

الخيارات:
  --db <name>        اسمُ القاعدة (افتراضيًّا من DATABASE_MIGRATOR_URL)
  --host/--port/--user/--password  overrides للاتصال (وإلا فمن DATABASE_MIGRATOR_URL)
  --out <dir>        مجلدُ النسخ (‏backups)
  --keep <n>         عددُ النسخ المُبقاة (٧) — والحذفُ للنسخ لا لبيانات القواعد
  --mode <auto|pg_dump|sql>   (‏auto)
  --from <path>      النسخةُ المراد استعادتها/التحقق منها
  --allow-migration-mismatch  استعادةُ نسخةٍ رأسُ هجرتها يختلف عن القاعدة الهدف (خطرٌ مُعلن)
  --max-table-rows <n>  سقفُ صفوف الجدول في وضع sql قبل الرفض (‏200000) — فوقه pg_dump أولى
  --help

ولا تُخزَّن كلمةُ سرّ في النسخة: البيانُ يحمل اسمَ القاعدة ورأسَ الهجرة وأعدادَ الصفوف.
`;

function parseArgs(argv) {
  const out = { mode: 'auto', out: 'backups', keep: 7, maxTableRows: 200000, help: false, allowMigrationMismatch: false };
  const keys = { db: 'db', host: 'host', port: 'port', user: 'user', password: 'password', out: 'out', keep: 'keep', mode: 'mode', from: 'from', 'max-table-rows': 'maxTableRows' };
  for (let i = 0; i < argv.length; i += 1) {
    const raw = argv[i];
    if (raw === '--') continue;
    if (!raw.startsWith('--')) { console.error(`✗ وسيطٌ غير متوقّع: ${raw}`); out.help = true; continue; }
    const name = raw.slice(2);
    if (name === 'help') { out.help = true; continue; }
    if (name === 'allow-migration-mismatch') { out.allowMigrationMismatch = true; continue; }
    const key = keys[name];
    if (!key) { console.error(`✗ خيارٌ غير معروف: --${name}`); out.help = true; continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) { console.error(`✗ الخيارُ --${name} يحتاج قيمة`); out.help = true; continue; }
    out[key] = key === 'keep' || key === 'port' || key === 'maxTableRows' ? Number(value) : value;
    i += 1;
  }
  return out;
}

const command = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'backup';
const args = parseArgs(process.argv.slice(command === process.argv[2] ? 3 : 2));
if (args.help) { console.log(HELP); process.exit(0); }
if (!['backup', 'restore', 'verify', 'drill'].includes(command)) {
  console.error(`✗ أمرٌ غير معروف: ${command} — المتوقّع backup|restore|verify|drill`);
  console.log(HELP);
  process.exit(2);
}

/** اتصالٌ من البيئة، مع تجاوزات السطر — وكلمةُ السرّ لا تُطبع أبدًا. */
function connectionFor(database) {
  const url = process.env.DATABASE_MIGRATOR_URL || process.env.DATABASE_URL;
  if (!url) { console.error('✗ لا DATABASE_MIGRATOR_URL ولا DATABASE_URL في البيئة'); process.exit(2); }
  const parsed = new URL(url);
  const config = {
    host: args.host ?? parsed.hostname,
    port: args.port ?? Number(parsed.port || 5432),
    user: args.user ?? decodeURIComponent(parsed.username),
    password: args.password ?? decodeURIComponent(parsed.password),
    database: database ?? args.db ?? (parsed.pathname.replace(/^\//, '') || 'postgres'),
  };
  return config;
}

const describeTarget = (config) => `${config.user}@${config.host}:${config.port}/${config.database}`;

async function connect(config) {
  const client = new pg.Client({ ...config, database: undefined });
  await client.connect();
  return client;
}

/** ‏`pg_dump` من PATH أو من `PG_DUMP` — ولا تخمين: فإمّا أن يعمل أو يُقال إنّه غير موجود. */
function resolvePgDump() {
  const candidate = process.env.PG_DUMP || 'pg_dump';
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) return { binary: candidate, version: String(probe.stdout).trim() };
  return null;
}
function resolvePgRestore() {
  const candidate = process.env.PG_RESTORE || 'pg_restore';
  const probe = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (probe.status === 0) return { binary: candidate, version: String(probe.stdout).trim() };
  return null;
}

function run(binary, binaryArgs, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, binaryArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += String(chunk); });
    child.on('error', (error) => reject(new Error(`${label}: ${error.message}`)));
    child.on('close', (code) => (code === 0 ? resolve(stderr) : reject(new Error(`${label} → خروج ${code}\n${stderr.slice(0, 800)}`))));
  });
}

async function migrationHead(client) {
  const rows = await client.query('SELECT name FROM erp_migrations ORDER BY name DESC LIMIT 1');
  return rows.rows[0]?.name ?? null;
}

async function tableNames(client) {
  const rows = await client.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `);
  return rows.rows.map((row) => row.table_name);
}

async function columnsOf(client, table) {
  const rows = await client.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  return rows.rows.map((row) => ({ name: row.column_name, type: row.data_type }));
}

async function countRows(client, table) {
  const rows = await client.query(`SELECT count(*)::bigint AS n FROM "${table}"`);
  return Number(rows.rows[0].n);
}

/** ‏bytea ⇒ ‏`{b64:…}` في JSON، والعودةُ بـ`decode(…,'base64')::bytea`. وكلُّ نوعٍ آخر كما هو. */
const BYTEA_MARKER = '__erp_bytea_base64__';
function encodeValue(value) {
  if (Buffer.isBuffer(value)) return { [BYTEA_MARKER]: value.toString('base64') };
  return value;
}

// ───────────────────────── الوضع sql (بياناتٌ فقط) ─────────────────────────

async function backupSql(config, outDir) {
  const client = await connect(config);
  try {
    const head = await migrationHead(client);
    const tables = await tableNames(client);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dir = path.join(outDir, `${config.database}-${stamp}.erpsql`);
    mkdirSync(path.join(dir, 'tables'), { recursive: true });

    const manifest = {
      mode: 'sql',
      database: config.database,
      createdAt: new Date().toISOString(),
      migrationHead: head,
      migratorUser: config.user,
      note: 'نسخةُ بياناتٍ فقط: الاستعادةُ تحتاج قاعدةً مُرحَّلةً بنفس رأس الهجرة (‏pnpm db:migrate).',
      tables: [],
    };

    for (const table of tables) {
      const columns = await columnsOf(client, table);
      const rows = await client.query(`SELECT * FROM "${table}"`);
      if (rows.rows.length > args.maxTableRows) {
        throw new Error(
          `الجدول «${table}» يحمل ${rows.rows.length} صفًّا وأكثرُ من ${args.maxTableRows} في وضع sql — ` +
          'فـ`pg_dump` أولى (‏--mode pg_dump) أو ارفع السقف بـ`--max-table-rows` وأنت تعرف ما تفعل',
        );
      }
      const file = path.join(dir, 'tables', `${table}.ndjson`);
      const stream = createWriteStream(file, { encoding: 'utf8' });
      for (const row of rows.rows) {
        const encoded = {};
        for (const column of columns) encoded[column.name] = encodeValue(row[column.name]);
        stream.write(`${JSON.stringify(encoded)}\n`);
      }
      // ‏`reject` مستعملٌ فعلًا: فخطأُ كتابةٍ على القرص (امتلاءٌ أو إذن) يجب أن يُفشل النسخةَ
      // بدل أن يُنتج ملفًّا ناقصًا يقول البيانُ إنّه كامل.
      await new Promise((resolve, reject) => {
        stream.once('error', reject);
        stream.end(resolve);
      });
      manifest.tables.push({
        name: table,
        rows: rows.rows.length,
        bytes: statSync(file).size,
        byteaColumns: columns.filter((column) => column.type === 'bytea').map((column) => column.name),
      });
      if (rows.rows.length > 0) process.stdout.write(`  ✓ ${table}: ${rows.rows.length} صفوف\n`);
    }
    writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    console.log(`\n✓ نسخة sql: ${dir}`);
    console.log(`  ${manifest.tables.length} جداول · ${manifest.tables.reduce((sum, t) => sum + t.rows, 0)} صفوف · رأسُ الهجرة ${head ?? '—'}`);
    return dir;
  } finally {
    await client.end();
  }
}

async function restoreSql(config, backupDir) {
  const manifest = JSON.parse(readFileSync(path.join(backupDir, 'manifest.json'), 'utf8'));
  if (manifest.mode !== 'sql') throw new Error(`النسخةُ بوضع «${manifest.mode}» فلا تُستعاد بالوضع sql`);
  const client = await connect(config);
  try {
    const head = await migrationHead(client);
    if (head !== manifest.migrationHead && !args.allowMigrationMismatch) {
      throw new Error(
        `رأسُ الهجرة في النسخة «${manifest.migrationHead}» وفي القاعدة الهدف «${head ?? '—'}» — ` +
        'فالمخطّطان مختلفان والاستعادةُ إلى مخطّطٍ آخر كسرٌ صامت. رحّل القاعدةَ الهدف إلى الإصدار نفسه ' +
        '(‏pnpm db:migrate) أو مرّر --allow-migration-mismatch وأنت تعرف أثره.',
      );
    }
    const tables = manifest.tables.map((entry) => entry.name);
    const missing = [];
    for (const table of tables) {
      const found = await client.query('SELECT to_regclass($1) AS r', [`public.${table}`]);
      if (!found.rows[0].r) missing.push(table);
    }
    if (missing.length > 0) throw new Error(`جداولٌ في النسخة لا وجود لها في القاعدة الهدف: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? '…' : ''}`);

    await client.query('BEGIN');
    try {
      await client.query('SET LOCAL session_replication_role = replica');
      await client.query(`TRUNCATE TABLE ${tables.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);

      for (const entry of manifest.tables) {
        const columns = await columnsOf(client, entry.name);
        const bytea = new Set(entry.byteaColumns ?? []);
        const file = path.join(backupDir, 'tables', `${entry.name}.ndjson`);
        if (!existsSync(file)) throw new Error(`ملفُّ الجدول «${entry.name}» ناقصٌ في النسخة`);
        const lines = readFileSync(file, 'utf8').split('\n').filter((line) => line.trim().length > 0);
        if (lines.length !== entry.rows) throw new Error(`الجدول «${entry.name}»: ${lines.length} أسطر في الملفّ و${entry.rows} في البيان`);

        const names = columns.map((column) => `"${column.name}"`);
        const batch = 200;
        for (let start = 0; start < lines.length; start += batch) {
          const chunk = lines.slice(start, start + batch).map((line) => JSON.parse(line));
          const values = [];
          const params = [];
          for (const row of chunk) {
            const placeholders = columns.map((column) => {
              const raw = row[column.name];
              if (bytea.has(column.name)) {
                params.push(raw && typeof raw === 'object' ? raw[BYTEA_MARKER] ?? null : raw ?? null);
                return `decode($${params.length}::text, 'base64')::bytea`;
              }
              /**
               * ‏`json`/`jsonb` تُمرَّر **نصَّ JSON صالحًا دائمًا**: فـ`pg` تُعيد القيمةَ
               * محلّلةً (‏`false` أو `1` أو `'SAR'`)، ومرّرُها كما هي يصل بالخادم نصًّا
               * غيرَ صالح للـjson («invalid input syntax for type json» — وأُصيب فعلًا على
               * ‏`cash_locations` ثمّ على `tenant_settings` حيث `value` ‏jsonb holds «SAR»).
               * فـ`JSON.stringify` تُعيد ما أخذه التحليل: ‏`'SAR'` ⇒ `"SAR"`، و`false` ⇒ `false`.
               */
              const isJson = column.type === 'json' || column.type === 'jsonb';
              const value = raw === undefined ? null : raw;
              params.push(isJson && value !== null ? JSON.stringify(value) : value);
              return `$${params.length}`;
            });
            values.push(`(${placeholders.join(', ')})`);
          }
          try {
            await client.query(
              `INSERT INTO "${entry.name}" (${names.join(', ')}) VALUES ${values.join(', ')}`,
              params,
            );
          } catch (error) {
            throw new Error(`الجدول «${entry.name}» (الدفعةُ عند الصف ${start}): ${error.message}`);
          }
        }
        if (lines.length > 0) process.stdout.write(`  ↩ ${entry.name}: ${lines.length}\n`);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    console.log('\n— التحقّقُ بالعدّ —');
    let mismatches = 0;
    for (const entry of manifest.tables) {
      const actual = await countRows(client, entry.name);
      if (actual !== entry.rows) {
        mismatches += 1;
        console.error(`  ✗ ${entry.name}: في النسخة ${entry.rows} وفي القاعدة ${actual}`);
      }
    }
    if (mismatches > 0) throw new Error(`${mismatches} جدولًا لم يتطابق عدُّه — فالاستعادةُ ناقصة`);
    console.log(`✓ ${manifest.tables.length} جداول تطابق عدُّها (${manifest.tables.reduce((sum, t) => sum + t.rows, 0)} صفوف)`);
  } finally {
    await client.end();
  }
}

// ───────────────────────── الوضع pg_dump ─────────────────────────

async function backupPgDump(config, outDir) {
  const dump = resolvePgDump();
  if (!dump) throw new Error('‏`pg_dump` غير موجود في PATH — فاستعمل `--mode sql` (تطوير) أو ثبّت أدوات العميل (إنتاج)');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(outDir, `${config.database}-${stamp}.dump`);
  console.log(`↻ ${dump.binary} (${dump.version})`);
  await run(dump.binary, ['-Fc', '--no-owner', '-h', config.host, '-p', String(config.port), '-U', config.user, '-d', config.database, '-f', file], 'pg_dump');
  const sidecar = { mode: 'pg_dump', database: config.database, createdAt: new Date().toISOString(), file: path.basename(file), bytes: statSync(file).size };

  // عدٌّ مصاحب حتى يعمل `verify` على الوضعين.
  const client = await connect(config);
  try {
    sidecar.migrationHead = await migrationHead(client);
    sidecar.tables = [];
    for (const table of await tableNames(client)) sidecar.tables.push({ name: table, rows: await countRows(client, table) });
  } finally {
    await client.end();
  }
  writeFileSync(`${file}.manifest.json`, JSON.stringify(sidecar, null, 2));
  console.log(`\n✓ نسخة pg_dump: ${file} (${sidecar.bytes} بايت · ${sidecar.tables.length} جداول · رأسُ الهجرة ${sidecar.migrationHead ?? '—'})`);
  return file;
}

async function restorePgDump(config, file) {
  const restore = resolvePgRestore();
  if (!restore) throw new Error('‏`pg_restore` غير موجود في PATH — فالاستعادةُ بوضع pg_dump تحتاج أدواتَ العميل');
  await run(restore.binary, ['--clean', '--if-exists', '--no-owner', '-h', config.host, '-p', String(config.port), '-U', config.user, '-d', config.database, file], 'pg_restore');
  console.log(`✓ استُعيدت ${file} إلى ${describeTarget(config)}`);
  await verifyCounts(config, `${file}.manifest.json`);
}

async function verifyCounts(config, manifestPath) {
  if (!existsSync(manifestPath)) { console.log('  ⚠ لا بيانَ مصاحبًا فلا مقارنةَ بالعدّ'); return; }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const client = await connect(config);
  try {
    let mismatches = 0;
    for (const entry of manifest.tables ?? []) {
      const found = await client.query('SELECT to_regclass($1) AS r', [`public.${entry.name}`]);
      if (!found.rows[0].r) { mismatches += 1; console.error(`  ✗ ${entry.name}: الجدولُ غير موجود`); continue; }
      const actual = await countRows(client, entry.name);
      if (actual !== entry.rows) { mismatches += 1; console.error(`  ✗ ${entry.name}: في البيان ${entry.rows} وفي القاعدة ${actual}`); }
    }
    if (mismatches > 0) throw new Error(`${mismatches} جدولًا لم يتطابق — فالنسخة/الاستعادةُ ناقصة`);
    console.log(`✓ التحقّقُ بالعدّ: ${(manifest.tables ?? []).length} جداول`);
  } finally {
    await client.end();
  }
}

function pruneBackups(outDir, keep) {
  if (!existsSync(outDir)) return;
  const entries = readdirSync(outDir)
    .filter((name) => name.endsWith('.erpsql') || name.endsWith('.dump') || name.endsWith('.dump.manifest.json'))
    .map((name) => ({ name, at: statSync(path.join(outDir, name)).mtimeMs }))
    .sort((a, b) => b.at - a.at);
  const groups = new Map();
  for (const entry of entries) {
    const key = entry.name.replace(/\.manifest\.json$/, '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry.name);
  }
  const keys = [...groups.keys()].sort((a, b) => (statSync(path.join(outDir, b)).mtimeMs - statSync(path.join(outDir, a)).mtimeMs));
  for (const key of keys.slice(Math.max(0, keep))) {
    for (const name of groups.get(key)) {
      const target = path.join(outDir, name);
      if (name.endsWith('.erpsql')) rmSync(target, { recursive: true, force: true });
      else rmSync(target, { force: true });
      console.log(`  🧹 حُذفت النسخةُ القديمة ${name} (--keep ${keep})`);
    }
  }
}

async function createDatabase(config, name) {
  const client = await connect({ ...config, database: 'postgres' });
  try {
    await client.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [name]).then(async (found) => {
      if (found.rows.length === 0) await client.query(`CREATE DATABASE "${name}"`);
    });
  } finally {
    await client.end();
  }
}

async function dropDatabase(config, name) {
  const client = await connect({ ...config, database: 'postgres' });
  try {
    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [name],
    );
    await client.query(`DROP DATABASE IF EXISTS "${name}"`);
  } finally {
    await client.end();
  }
}

async function migrateDatabase(config) {
  const url = `postgres://${encodeURIComponent(config.user)}:${encodeURIComponent(config.password ?? '')}@${config.host}:${config.port}/${config.database}`;
  const migrator = path.join(repoRoot, 'packages', 'database');
  // ‏`tsx` تُحلّ من حزمة قاعدة البيانات (لا من مسارٍ مكتوبٍ ينكسر بين الأنظمة).
  const dbRequire = createRequire(path.join(migrator, 'noop.js'));
  // ‏`exports` في tsx لا تُعلن `./dist/cli.mjs` (قِيس: ‏`ERR_PACKAGE_PATH_NOT_EXPORTED`)،
  // فيُبنى المسارُ من جذر الحزمة — وهو الحلُّ نفسه في `scripts/next-run.mjs` مع `next`.
  const tsxCli = path.join(path.dirname(dbRequire.resolve('tsx/package.json')), 'dist', 'cli.mjs');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsxCli, 'src/cli/migrate.ts'], {
      cwd: migrator,
      env: { ...process.env, DATABASE_MIGRATOR_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (chunk) => { out += String(chunk); });
    child.stderr.on('data', (chunk) => { out += String(chunk); });
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(`الترحيلُ فشل (خروج ${code})\n${out.slice(-900)}`))));
  });
}

async function main() {
  const outDir = path.isAbsolute(args.out) ? args.out : path.join(repoRoot, args.out);
  const source = connectionFor();

  if (command === 'backup') {
    const dump = resolvePgDump();
    const mode = args.mode === 'auto' ? (dump ? 'pg_dump' : 'sql') : args.mode;
    console.log(`\n▸ نسخُ ${describeTarget(source)} — الوضعُ ${mode}${mode === 'sql' && args.mode === 'auto' ? ' (‏pg_dump غير موجود — قِيس)' : ''}\n`);
    const produced = mode === 'pg_dump' ? await backupPgDump(source, outDir) : await backupSql(source, outDir);
    pruneBackups(outDir, args.keep);
    console.log(`\n✓ النسخة: ${produced}`);
    console.log('  والاستعادةُ لا تُعتبر صحيحةً قبل `pnpm db:drill` (اختبارٌ كامل) — فنسخةٌ لم تُستعد ليست نسخة.');
    return;
  }

  if (command === 'restore' || command === 'verify') {
    if (!args.from) { console.error('✗ يلزم --from <مسار النسخة>'); process.exit(2); }
    const backupPath = path.isAbsolute(args.from) ? args.from : path.join(repoRoot, args.from);
    if (!existsSync(backupPath)) { console.error(`✗ لا نسخة في ${backupPath}`); process.exit(2); }
    const target = connectionFor();
    if (command === 'verify') {
      const manifestPath = statSync(backupPath).isDirectory()
        ? path.join(backupPath, 'manifest.json')
        : `${backupPath}.manifest.json`;
      console.log(`\n▸ التحقّقُ بالعدّ على ${describeTarget(target)}`);
      await verifyCounts(target, manifestPath);
      return;
    }
    console.log(`\n▸ استعادةُ ${backupPath} إلى ${describeTarget(target)} — **ستُمحى بياناتُ الهدف**`);
    if (statSync(backupPath).isDirectory()) await restoreSql(target, backupPath);
    else await restorePgDump(target, backupPath);
    return;
  }

  // ‏drill — اختبارُ الاستعادة الكامل: نسخة ← قاعدةٌ مؤقّتة ← ترحيل ← استعادة ← مقارنة ← حذف.
  const dump = resolvePgDump();
  const mode = args.mode === 'auto' ? (dump ? 'pg_dump' : 'sql') : args.mode;
  const scratch = `${source.database}_drill_${process.pid}`;
  console.log(`\n▸ اختبارُ الاستعادة — الوضعُ ${mode} · المصدرُ ${describeTarget(source)} · المؤقّتةُ ${scratch}\n`);
  const backupPath = mode === 'pg_dump' ? await backupPgDump(source, outDir) : await backupSql(source, outDir);
  try {
    console.log(`\n— إنشاءُ القاعدة المؤقّتة ${scratch} —`);
    await createDatabase(source, scratch);
    console.log('— ترحيلُها (‏131 هجرة) —');
    const migrationLog = await migrateDatabase({ ...source, database: scratch });
    console.log(`  ${migrationLog.split('\n').filter(Boolean).slice(-2).join(' · ')}`);
    console.log('\n— الاستعادةُ في المؤقّتة —');
    const target = { ...source, database: scratch };
    if (mode === 'pg_dump') await restorePgDump(target, backupPath);
    else await restoreSql(target, backupPath);
    console.log('\n— عيّنةٌ من المحتوى لا العدّ وحده —');
    const client = await connect(target);
    try {
      const tenants = await client.query('SELECT code FROM tenants ORDER BY code');
      console.log(`  المنشآت: ${tenants.rows.map((row) => row.code).join(', ') || '—'}`);
      const groups = await client.query(`SELECT t.code, g.name_ar, g.rate::text FROM tax_groups g JOIN tenants t ON t.id = g.tenant_id WHERE g.name_ar LIKE '%القيمة المضافة%' ORDER BY t.code`);
      for (const row of groups.rows) console.log(`  ضريبةُ ${row.code}: «${row.name_ar}» = ${row.rate}`);
      const vouchers = await client.query('SELECT count(*)::int n FROM vouchers');
      const documents = await client.query('SELECT count(*)::int n FROM van_sales_documents');
      console.log(`  السندات: ${vouchers.rows[0].n} · مستنداتُ الخطّ: ${documents.rows[0].n}`);
      const secrets = await client.query(`SELECT count(*)::int n FROM users WHERE mfa_secret_enc IS NOT NULL`);
      console.log(`  أعمدةُ bytea (‏mfa_secret_enc غير فارغة): ${secrets.rows[0].n} — فـbase64 لم تُفسدها`);
    } finally {
      await client.end();
    }
    console.log(`\n✓ اختبارُ الاستعادة نجح: النسخةُ ${path.basename(backupPath)} استُعادت وطابق عدُّها`);
  } finally {
    console.log(`\n— حذفُ القاعدة المؤقّتة ${scratch} (من صنع الأداة وحدها) —`);
    await dropDatabase(source, scratch);
    console.log('✓ حُذفت');
  }
}

try {
  await main();
} catch (error) {
  console.error(`\n✗ ${error.message}`);
  process.exit(1);
}
