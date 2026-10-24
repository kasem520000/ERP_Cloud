import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { DomainError, newId } from '@erp/contracts';
import { backupRuns, restoreRuns, withTenantTx, type DatabaseHandle, type DrizzleTx } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { tryGetAuthContext } from '../platform/context/tenant-context.js';

/**
 * Tables a logical backup never carries.
 *
 * The backups themselves and the append-only operational logs are excluded on purpose:
 * a snapshot of a snapshot is noise, and restoring an audit log would let someone rewrite
 * the record of what they did. Identity (`users`, `memberships`, `roles`) is excluded too
 * — this is a **business-data** export, and re-importing credentials or role grants is a
 * privilege-escalation path, not a restore.
 */
const NEVER_BACKED_UP = new Set([
  'backup_runs', 'restore_runs', 'maintenance_runs', 'company_files',
  'audit_log', 'outbox_jobs', 'idempotency_keys', 'notifications',
  // عدّادات تشغيلية (طلبات API/بريد/فروع…) — تُبنى من نشاط الملف نفسه. نقلها إلى ملفٍ
  // آخر يلوّث حصص مستأجرٍ حيّ بِسَجلّ غيره، والاستعادة نفسها تُعِد بناءها من نشاطها.
  'usage_counters',
  'users', 'memberships', 'membership_roles', 'roles', 'role_permissions', 'permissions',
  'tenants', 'tenant_subscriptions', 'activation_requests', 'schema_migrations',
  'refresh_tokens', 'sessions', 'password_reset_tokens', 'login_attempts',
]);

/** ACC-079: Child tables that belong to a tenant via parent foreign key */
const DEPENDENT_TABLES: Record<string, (tenantId: string) => SQL> = {
  approval_steps: (tenantId) =>
    sql`SELECT to_jsonb(s) AS row FROM approval_steps s JOIN approval_workflows w ON w.id = s.workflow_id WHERE w.tenant_id = ${tenantId}::uuid`,
  approval_decisions: (tenantId) =>
    sql`SELECT to_jsonb(d) AS row FROM approval_decisions d JOIN approval_requests r ON r.id = d.request_id WHERE r.tenant_id = ${tenantId}::uuid`,
};

/** A logical export is not a database dump; past this size it is a false promise. */
const MAX_BACKUP_ROWS = 50_000;

type Snapshot = Record<string, Array<Record<string, unknown>>>;

type TrialBalance = { debit: string; credit: string };
type TableCount = { before: number; after: number };
export type RestoreVerification = {
  passed: boolean;
  tablesChecked: number;
  tablesMatched: number;
  mismatches: Array<{ table: string; snapshotRows: number; actualAfter: number }>;
  trialBalance: {
    debitBefore: string;
    creditBefore: string;
    debitAfter: string;
    creditAfter: string;
    balancedBefore: boolean;
    balancedAfter: boolean;
    deltaBalanced: boolean;
  };
};

/**
 * تقرير التحقق بعد الاستعادة (MF-35): عدّ الجداول وميزان المراجعة قبل/بعد.
 *
 * المطابقة الكاملة تُقاس على الملف الفارغ: جدولٌ بلا صفوفٍ قبل الاستعادة يجب أن يستقبل
 * كل صفوف النسخة حرفياً؛ وأي جدولٍ لم يصل أو نقص يُعلَم بلا رحمة. الميزان يجب أن يبقى
 * متوازناً بعد الاستعادة، وفارق المدين يجب أن يساوي فارق الدائن (القيود تدخل كاملة لا
 * نصفها). الهدف الممتلئ لا يُطالَب بالتطابق حرفياً (إضافة فقط) — يُطالَب بعدم الفشل
 * وبقاء الميزان صحيحاً.
 */
function buildRestoreVerification(
  snapshot: Snapshot,
  counts: Record<string, TableCount>,
  unresolved: string[],
  tbBefore: TrialBalance,
  tbAfter: TrialBalance,
): RestoreVerification {
  const mismatches: RestoreVerification['mismatches'] = [];
  for (const [table, count] of Object.entries(counts)) {
    const snapshotRows = snapshot[table]?.length ?? 0;
    if (count.before === 0 && count.after !== snapshotRows) {
      mismatches.push({ table, snapshotRows, actualAfter: count.after });
    }
  }
  const failedTables = new Set<string>([...unresolved.filter((table) => snapshot[table]), ...mismatches.map((m) => m.table)]);
  const tablesChecked = Object.keys(snapshot).length;
  const num = (value: string) => Number(value);
  const round6 = (value: number) => Math.round(value * 1e6);
  const deltaDebit = num(tbAfter.debit) - num(tbBefore.debit);
  const deltaCredit = num(tbAfter.credit) - num(tbBefore.credit);
  const balancedAfter = round6(num(tbAfter.debit)) === round6(num(tbAfter.credit));
  const deltaBalanced = round6(deltaDebit) === round6(deltaCredit);
  return {
    passed: failedTables.size === 0 && balancedAfter && deltaBalanced,
    tablesChecked,
    tablesMatched: tablesChecked - failedTables.size,
    mismatches,
    trialBalance: {
      debitBefore: tbBefore.debit,
      creditBefore: tbBefore.credit,
      debitAfter: tbAfter.debit,
      creditAfter: tbAfter.credit,
      balancedBefore: round6(num(tbBefore.debit)) === round6(num(tbBefore.credit)),
      balancedAfter,
      deltaBalanced,
    },
  };
}

const asJsonParam = (table: string, column: string, value: unknown) => {
  if (value === null || value === undefined) return null;
  if (table === 'tenant_settings' && column === 'value') {
    return JSON.stringify(value);
  }
  return typeof value === 'object' ? JSON.stringify(value) : value;
};

/**
 * JSON قياسي: ترتيب المفاتيح عميقاً قبل التجزئة.
 *
 * `jsonb` يعيد ترتيب مفاتيح الكائنات عند تخزين الحمولة، فتجزئة «الترتيب الذي رآه
 * السائق» لا تُعاد حسابه أبداً بعد مرورٍ عبر قاعدة البيانات — ومسار الرفع العابر
 * للمستأجر (`payload + checksum`) يعيد حسابها حتماً. الترتيب العميق يجعل التجزئة
 * خاصيةً للبيانات لا لصورةٍ عابرة، ويسقط أي تغييرٍ حقيقي في المحتوى.
 */
const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(',')}}`;
};

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * معرّف الاستعادة الحتمي: مشتقّ من (المستأجر الهدف + المعرّف الأصلي) لا عشوائي.
 *
 * الاستعادة العابرة إلى مستأجر آخر تصطدم حتماً بصفوف المصدر الحيّة في القاعدة نفسها
 * (المعرّفات مفاتيح أساسية عالمية) — إعادة التوليد تُهرب التعارض، والحتمية تجعل تكرار
 * رفع نفس النسخة يستkip بلا تضاعف (نفس الإدخال ⇐ نفس المعرّفات ⇐ `ON CONFLICT`).
 */
const mappedRestoreId = (targetTenantId: string, oldId: string): string => {
  const digest = createHash('sha256').update(`restore:${targetTenantId}:${oldId}`).digest();
  const bytes = Uint8Array.from(digest.subarray(0, 16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50; // إصدار خامس-مُشتق (لا v7 تسلسلي)
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80; // تباين RFC-4122
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

type InsertContext = {
  tenantId: string;
  /** موجود فقط في الاستعادة العابرة للمستأجر: خريطة (المعرّف الأصلي ← المعرّف الجديد الحتمي). */
  remap?: Map<string, string>;
  /** أعمدة المفاتيح الأجنبية لكل جدول (كتالوج القاعدة) — مرجع مجهول يُبطل لا يُهدم. */
  fks: Map<string, Set<string>>;
};

/** بناء خريطة إعادة التوليد: كل صفٍّ يحمل `id` داخل النسخة ⇐ معرّف حتمي جديد للهدف. */
const buildRestoreIdMap = (snapshot: Snapshot, targetTenantId: string): Map<string, string> => {
  const map = new Map<string, string>();
  for (const rows of Object.values(snapshot)) {
    for (const row of rows) {
      if (row.id !== undefined && row.id !== null) map.set(String(row.id), mappedRestoreId(targetTenantId, String(row.id)));
    }
  }
  return map;
};

/** قيم الإدراج لصفٍّ واحد: تُفرض الهوية، وتُعاد خرائط المعرّفات في العبور بين الملفات. */
const rowValues = (ctx: InsertContext, table: string, columns: string[], row: Record<string, unknown>): unknown[] =>
  columns.map((column) => {
    const value = row[column] ?? null;
    if (column === 'tenant_id') return ctx.tenantId;
    if (ctx.remap) {
      if (column === 'id' && typeof value === 'string') return ctx.remap.get(value) ?? value;
      if (typeof value === 'string' && UUID_RE.test(value)) {
        const mapped = ctx.remap.get(value);
        if (mapped) return mapped;
        // مرجع إلى شيءٍ خارج النسخة: مفتاح أجنبي يُبطل (لا يُقفل الاستعادة)، وعمودٌ آخر
        // (كـ`created_by` بلا قيد) يبقى أثر تاريخي كما هو.
        if (ctx.fks.get(table)?.has(column)) return null;
      }
    }
    return asJsonParam(table, column, value);
  });

/** MF-35: كم تُحفظ نسخة اليوم — الاستبقاء جزءٌ من الجدولة لا وصفٌ لها. */
const BACKUP_RETENTION_DAYS = 14;

/**
 * النسخ الإحتياطي و إستعادة البيانات.
 *
 * This is a **logical, tenant-scoped** backup: every table that carries `tenant_id`,
 * read through RLS so it can only ever contain this tenant's rows, serialised to JSON with
 * a checksum. It is not a substitute for `pg_dump` and the service says so out loud by
 * refusing to produce one beyond `MAX_BACKUP_ROWS` rather than emitting a truncated file
 * that would fail silently at the worst possible moment.
 *
 * Restore is deliberately **additive**: rows are inserted where they are missing and
 * skipped where the primary key already exists. Nothing is ever deleted or overwritten.
 * A destructive "replace everything" restore belongs to a fresh company file, not to a
 * button inside a live one that somebody will press on a Thursday afternoon.
 */
@Injectable()
export class BackupService {
  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle) {}

  async listBackups(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, (tx) =>
      tx
        .select({
          id: backupRuns.id, kind: backupRuns.kind, status: backupRuns.status, note: backupRuns.note,
          tables: backupRuns.tables, rowCounts: backupRuns.rowCounts, totalRows: backupRuns.totalRows,
          sizeBytes: backupRuns.sizeBytes, checksum: backupRuns.checksum, failedReason: backupRuns.failedReason,
          completedAt: backupRuns.completedAt, createdAt: backupRuns.createdAt, createdBy: backupRuns.createdBy,
        })
        .from(backupRuns)
        .where(eq(backupRuns.tenantId, tenantId))
        .orderBy(desc(backupRuns.createdAt))
        .limit(100));
  }

  /** The payload is only ever handed out one backup at a time, never in a list. */
  async download(tenantId: string, id: string) {
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) => tx.select().from(backupRuns).where(and(eq(backupRuns.tenantId, tenantId), eq(backupRuns.id, id))));
    if (!row) throw new DomainError('BACKUP_NOT_FOUND', 'Backup was not found', 404);
    if (row.status !== 'ready') throw new DomainError('BACKUP_NOT_READY', 'That backup did not complete', 409);
    return { id: row.id, checksum: row.checksum, tables: row.tables, rowCounts: row.rowCounts, totalRows: row.totalRows, createdAt: row.createdAt, payload: row.payload ?? {} };
  }

  async createBackup(tenantId: string, input: { note?: string } = {}) {
    const id = newId();
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const tables = await this.tenantTables(tx);
      const snapshot: Snapshot = {};
      const rowCounts: Record<string, number> = {};
      let totalRows = 0;

      for (const table of tables) {
        const query = DEPENDENT_TABLES[table]
          ? DEPENDENT_TABLES[table](tenantId)
          : sql`SELECT to_jsonb(t) AS row FROM ${sql.identifier(table)} t`;
        const result = await tx.execute(query);
        const rows = result.rows.map((row) => (row as { row: Record<string, unknown> }).row);
        if (!rows.length) continue;
        totalRows += rows.length;
        if (totalRows > MAX_BACKUP_ROWS) {
          throw new DomainError(
            'BACKUP_TOO_LARGE',
            `This file holds more than ${MAX_BACKUP_ROWS} rows; take a physical database backup (pg_dump) instead of a logical export`,
            422,
          );
        }
        snapshot[table] = rows;
        rowCounts[table] = rows.length;
      }

      const serialised = JSON.stringify(snapshot);
      const checksum = sha256(canonicalJson(snapshot));
      await tx.insert(backupRuns).values({
        id,
        tenantId,
        kind: 'full',
        status: 'ready',
        note: input.note,
        tables: Object.keys(snapshot),
        rowCounts,
        totalRows,
        sizeBytes: Buffer.byteLength(serialised, 'utf8'),
        checksum,
        payload: snapshot,
        completedAt: new Date(),
        createdBy: tryGetAuthContext()?.userId,
      });
      const [row] = await tx.select({
        id: backupRuns.id, status: backupRuns.status, tables: backupRuns.tables, rowCounts: backupRuns.rowCounts,
        totalRows: backupRuns.totalRows, sizeBytes: backupRuns.sizeBytes, checksum: backupRuns.checksum,
        note: backupRuns.note, completedAt: backupRuns.completedAt, createdAt: backupRuns.createdAt,
      }).from(backupRuns).where(and(eq(backupRuns.tenantId, tenantId), eq(backupRuns.id, id)));
      return row;
    });
  }

  async listRestores(tenantId: string) {
    return withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(restoreRuns).where(eq(restoreRuns.tenantId, tenantId)).orderBy(desc(restoreRuns.createdAt)).limit(100));
  }

  /**
   * Restore a snapshot into this tenant. `dry_run` reports what would land; `apply`
   * inserts the missing rows. Applying demands the tenant code typed back, because the
   * one mistake that cannot be undone here is restoring last year's file into this year's.
   */
  async restore(tenantId: string, input: { backupId?: string; payload?: Snapshot; checksum?: string; mode?: 'dry_run' | 'apply'; confirmTenantCode?: string }) {
    const mode = input.mode ?? 'dry_run';
    const snapshot = await this.resolveSnapshot(tenantId, input);

    if (mode === 'apply') {
      const [tenant] = await withTenantTx(this.database.db, tenantId, (tx) => tx.execute(sql`SELECT code FROM tenants WHERE id = ${tenantId}`).then((result) => result.rows as Array<{ code: string }>));
      if (!tenant) throw new DomainError('NOT_FOUND', 'Tenant was not found', 404);
      if ((input.confirmTenantCode ?? '').trim().toLowerCase() !== tenant.code.toLowerCase()) {
        throw new DomainError('RESTORE_CONFIRMATION_REQUIRED', `Type the file code "${tenant.code}" to confirm the restore`, 422);
      }
    }

    const summary: Record<string, { rows: number; inserted: number; skipped: number; error?: string }> = {};
    const tableNames = Object.keys(snapshot);
    let inserted = 0;
    let skipped = 0;

    // سياق الإدراج: إن كان الأصل مستأجراً غير الهدف (نسخة رُفعت من ملفٍ آخر) تُعاد
    // خرائط المعرّفات حتمياً؛ وإلّا يبقى المسار الإضافي المعتاد (نفس الملف = نفس المعرّفات).
    const fks = await withTenantTx(this.database.db, tenantId, (tx) => this.foreignKeyColumns(tx));
    let originTenantId: string | undefined;
    for (const rows of Object.values(snapshot)) {
      for (const row of rows) {
        const value = row.tenant_id;
        if (typeof value === 'string' && value) { originTenantId = value; break; }
      }
      if (originTenantId) break;
    }
    const ctx: InsertContext = {
      tenantId,
      remap: originTenantId && originTenantId !== tenantId ? buildRestoreIdMap(snapshot, tenantId) : undefined,
      fks,
    };

    if (mode === 'dry_run') {
      let simInserted = 0;
      let simSkipped = 0;
      let dryPending = [...tableNames];
      const counts: Record<string, TableCount> = {};
      let tbBefore: TrialBalance = { debit: '0', credit: '0' };
      let tbAfter: TrialBalance = { debit: '0', credit: '0' };
      await withTenantTx(this.database.db, tenantId, async (tx) => {
        tbBefore = await this.trialBalance(tx, tenantId);
        await tx.execute(sql`SAVEPOINT restore_dry_run`);
        try {
          for (let pass = 0; pass < 4 && dryPending.length; pass += 1) {
            const failed: string[] = [];
            for (const table of dryPending) {
              // savepoint لكل جدول: خطأ واحد لا يسمّم معاملة المحاكاة كلها (كما أن
              // الاستعادة الفعلية تعزل كل جدول بمعاملة مستقلة — والمحاكاة تقلّدها).
              await tx.execute(sql`SAVEPOINT restore_dry_table`);
              try {
                const rows = snapshot[table]!;
                if (!rows.length) {
                  summary[table] = { rows: 0, inserted: 0, skipped: 0 };
                  counts[table] = { before: 0, after: 0 };
                  await tx.execute(sql`RELEASE SAVEPOINT restore_dry_table`);
                  continue;
                }
                const before = Number((((await tx.execute(sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)}`)).rows[0]) as { count: number }).count);
                const columns = Object.keys(rows[0]!);
                const columnList = sql.join(columns.map((column) => sql.identifier(column)), sql`, `);
                for (const row of rows) {
                  const values = rowValues(ctx, table, columns, row);
                  await tx.execute(sql`
                    INSERT INTO ${sql.identifier(table)} (${columnList})
                    VALUES (${sql.join(values.map((value) => sql`${value}`), sql`, `)})
                    ON CONFLICT DO NOTHING
                  `);
                }
                const after = Number((((await tx.execute(sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)}`)).rows[0]) as { count: number }).count);
                const insertedRows = after - before;
                const skippedRows = rows.length - insertedRows;
                simInserted += insertedRows;
                simSkipped += skippedRows;
                counts[table] = { before, after };
                summary[table] = { rows: rows.length, inserted: insertedRows, skipped: skippedRows };
                await tx.execute(sql`RELEASE SAVEPOINT restore_dry_table`);
              } catch (error) {
                await tx.execute(sql`ROLLBACK TO SAVEPOINT restore_dry_table`);
                failed.push(table);
                summary[table] = { rows: snapshot[table]!.length, inserted: 0, skipped: snapshot[table]!.length, error: error instanceof Error ? error.message.slice(0, 300) : String(error) };
              }
            }
            if (failed.length === dryPending.length) break;
            dryPending = failed;
          }
          // ميزان «كما سيصبح» يُقاس قبل التراجع — هذه هي أرقام المحاكاة الحقيقية.
          tbAfter = await this.trialBalance(tx, tenantId);
        } finally {
          await tx.execute(sql`ROLLBACK TO SAVEPOINT restore_dry_run`);
        }
      });
      const verification = buildRestoreVerification(snapshot, counts, dryPending, tbBefore, tbAfter);
      return this.recordRestore(tenantId, input.backupId, 'dry_run', { tables: summary, unresolved: dryPending, verification }, simInserted, simSkipped);
    }

    // Foreign keys make table order matter, and the snapshot does not carry a dependency
    // graph. Rather than guess one, retry the tables that fail until a pass makes no
    // progress — the graph resolves itself and a genuinely broken table still reports.
    const counts: Record<string, TableCount> = {};
    const tbBefore = await withTenantTx(this.database.db, tenantId, (tx) => this.trialBalance(tx, tenantId));
    let pending = [...tableNames];
    for (let pass = 0; pass < 4 && pending.length; pass += 1) {
      const failed: string[] = [];
      for (const table of pending) {
        try {
          const result = await this.insertTable(ctx, table, snapshot[table]!);
          inserted += result.inserted;
          skipped += result.skipped;
          counts[table] = { before: result.before, after: result.after };
          summary[table] = { rows: snapshot[table]!.length, inserted: result.inserted, skipped: result.skipped };
        } catch (error) {
          failed.push(table);
          summary[table] = { rows: snapshot[table]!.length, inserted: 0, skipped: 0, error: error instanceof Error ? error.message.slice(0, 300) : String(error) };
        }
      }
      if (failed.length === pending.length) break;
      pending = failed;
    }
    const tbAfter = await withTenantTx(this.database.db, tenantId, (tx) => this.trialBalance(tx, tenantId));
    const verification = buildRestoreVerification(snapshot, counts, pending, tbBefore, tbAfter);

    return this.recordRestore(tenantId, input.backupId, 'apply', { tables: summary, unresolved: pending, verification }, inserted, skipped);
  }

  /**
   * MF-35 — الجدولة اليومية: نسخة واحدة كل يوم لكل مستأجر، ثم استبقاء النسخ الأقدم من
   * 14 يوماً. الملاحظة تُسمّي نفسها «scheduled-daily» فالاختبار يميّزها عن النسخ اليدوية.
   */
  async dailyBackup(tenantId: string): Promise<{ backupId: string; pruned: number; totalRows: number }> {
    const backup = await this.createBackup(tenantId, { note: 'scheduled-daily' });
    if (!backup) throw new DomainError('BACKUP_FAILED', 'تعذّر إنشاء النسخة الاحتياطية.', 500);
    const pruned = await this.pruneBackupRuns(tenantId);
    return { backupId: backup.id, pruned, totalRows: backup.totalRows };
  }

  /** الاستبقاء يُنفَّذ لا يُوصف: نسخة لا تُحذف قديماً نسخةٌ تتضاعف بلا نهاية. */
  private async pruneBackupRuns(tenantId: string): Promise<number> {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const result = await tx.execute(sql`
        DELETE FROM backup_runs
        WHERE tenant_id = ${tenantId}::uuid
          AND created_at < now() - ${BACKUP_RETENTION_DAYS} * interval '1 day'
          AND status = 'ready'
      `);
      return result.rowCount ?? 0;
    });
  }

  /** أعمدة المفاتيح الأجنبية في `public` — لتمييز «مرجع خارج النسخة يُبطل» عن أثر تاريخي. */
  private async foreignKeyColumns(tx: DrizzleTx): Promise<Map<string, Set<string>>> {
    const result = await tx.execute(sql`
      SELECT kcu.table_name, kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON kcu.constraint_name = tc.constraint_name
       AND kcu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    `);
    const map = new Map<string, Set<string>>();
    for (const row of result.rows as Array<{ table_name: string; column_name: string }>) {
      const columns = map.get(row.table_name) ?? new Set<string>();
      columns.add(row.column_name);
      map.set(row.table_name, columns);
    }
    return map;
  }

  /** ميزان المراجعة (مدين/دائن لكل قيود المستأجر) — أساس تقرير التحقق قبل/بعد الاستعادة. */
  private async trialBalance(tx: DrizzleTx, tenantId: string): Promise<TrialBalance> {
    const result = await tx.execute(sql`
      SELECT COALESCE(SUM(debit), '0')::text AS debit, COALESCE(SUM(credit), '0')::text AS credit
      FROM journal_entry_lines WHERE tenant_id = ${tenantId}::uuid
    `);
    const row = result.rows[0] as { debit?: string; credit?: string } | undefined;
    return { debit: row?.debit ?? '0', credit: row?.credit ?? '0' };
  }

  // --------------------------------------------------------------------- helpers

  private async resolveSnapshot(tenantId: string, input: { backupId?: string; payload?: Snapshot; checksum?: string }): Promise<Snapshot> {
    if (input.backupId) {
      const backup = await this.download(tenantId, input.backupId);
      return (backup.payload ?? {}) as Snapshot;
    }
    if (!input.payload || typeof input.payload !== 'object') {
      throw new DomainError('RESTORE_SOURCE_REQUIRED', 'Provide a stored backup id or an uploaded snapshot', 422);
    }
    if (input.checksum) {
      // الملفات القديمة خُتمت على ترتيب السائق الخام؛ الجديدة على القياس. قبول
      // الاثنين يبقي النسخ المخزَّنة قابلة للاستعادة بعد رفع هذا التصحيح.
      const canonical = sha256(canonicalJson(input.payload));
      const legacy = sha256(JSON.stringify(input.payload));
      if (input.checksum !== canonical && input.checksum !== legacy) {
        throw new DomainError('RESTORE_CHECKSUM_MISMATCH', 'The uploaded snapshot does not match its checksum', 422);
      }
    }
    return input.payload;
  }

  private async insertTable(ctx: InsertContext, table: string, rows: Array<Record<string, unknown>>) {
    if (!rows.length) return { inserted: 0, skipped: 0, before: 0, after: 0 };
    return withTenantTx(this.database.db, ctx.tenantId, async (tx) => {
      const known = await this.tenantTables(tx);
      if (!known.includes(table)) throw new DomainError('RESTORE_UNKNOWN_TABLE', `Unknown table ${table}`, 422);
      const before = Number((((await tx.execute(sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)}`)).rows[0]) as { count: number }).count);
      const columns = Object.keys(rows[0]!);
      const columnList = sql.join(columns.map((column) => sql.identifier(column)), sql`, `);
      for (const row of rows) {
        // تُفرض الهوية دائماً: نسخةٌ من ملفٍ آخر لا تهرب صفوفها عبر الحدود.
        const values = rowValues(ctx, table, columns, row);
        await tx.execute(sql`
          INSERT INTO ${sql.identifier(table)} (${columnList})
          VALUES (${sql.join(values.map((value) => sql`${value}`), sql`, `)})
          ON CONFLICT DO NOTHING
        `);
      }
      const after = Number((((await tx.execute(sql`SELECT count(*)::int AS count FROM ${sql.identifier(table)}`)).rows[0]) as { count: number }).count);
      const insertedRows = after - before;
      return { inserted: insertedRows, skipped: rows.length - insertedRows, before, after };
    });
  }

  private async recordRestore(tenantId: string, backupId: string | undefined, mode: 'dry_run' | 'apply', summary: Record<string, unknown>, inserted: number, skipped: number) {
    const id = newId();
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      await tx.insert(restoreRuns).values({ id, tenantId, backupId, mode, status: 'ready', summary, insertedRows: inserted, skippedRows: skipped, createdBy: tryGetAuthContext()?.userId });
      const [row] = await tx.select().from(restoreRuns).where(and(eq(restoreRuns.tenantId, tenantId), eq(restoreRuns.id, id)));
      return row;
    });
  }

  /** Every tenant-scoped table, discovered from the catalog so new modules are covered. */
  private async tenantTables(tx: DrizzleTx) {
    const result = await tx.execute(sql`
      SELECT c.table_name
      FROM information_schema.columns c
      JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'tenant_id' AND t.table_type = 'BASE TABLE'
      ORDER BY c.table_name
    `);
    const tables = (result.rows as Array<{ table_name: string }>).map((row) => row.table_name).filter((table) => !NEVER_BACKED_UP.has(table));
    for (const depTable of Object.keys(DEPENDENT_TABLES)) {
      if (!tables.includes(depTable) && !NEVER_BACKED_UP.has(depTable)) {
        tables.push(depTable);
      }
    }
    return tables;
  }
}
