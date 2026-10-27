import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withOwnerClient } from '@erp/testing';

import { OrgProvisioningService } from '../src/modules/organization/provisioning/org-provisioning.service.js';
import { BackupService } from '../src/modules/operations/backup.service.js';
import { JobHandlerRegistry } from '../src/modules/platform-services/jobs/job-handlers.js';

import {
  ALL_ORGANIZATION_PERMISSIONS,
  ALL_PLATFORM_PERMISSIONS,
  createActor,
  createTenantFixture,
  type Actor,
} from './fixtures.js';
import { api } from './http.js';
import { createTestApp, type TestApp } from './test-app.js';

/**
 * خطة MISSING_FEATURES — دفقة D6، **MF-35: استعادة موثوقة وشاملة ومجدولة** (P1):
 *
 *   • **AC مُعلَن:** استعادة نسخة كاملة إلى مستأجر فارغ ⇒ عدّ كل الجداول وميزان
 *     المراجعة مطابقان 100%. الاستعادة التلقائية (additive) تُدرج كل صفوف النسخة في
 *     الهدف الفارغ، والتقرير يُبلّغ `verification` (مطابقة الجداول + ميزان مراجعة قبل/
 *     وبعد) داخل `restore_runs.summary` — بلا هجرة (jsonb).
 *   • **الجدولة اليومية:** نوع عمل `backup.daily` على طابور «الصيانة» (الطوابير الخمسة
 *     مجمّدة) + معالج مسجَّل من وحدة العمليات (نمط announcements) + مساعد
 *     `maintenanceJobsFor` يبني المهمة بمعرّف مُجمَّع يومي (BullMQ dedupe) ويعيد جدولة
 *     العامل كل 24 ساعة، مع **احتفاظ** (14 يوماً) يُنفَّذ داخل المعالج نفسه.
 *   • الاختبار الدوري الآلي = هذا الملف نفسه يجري مع كل مجموعة الاختبارات.
 *
 * الاستعادة الفعلية تجري عبر مسار الرفع (`payload + checksum`) — نسخة المستأجر
 * المصدر لا تُقرأ باسم المستأجر الهدف (عزل)! والتحكّم برموز المستأجر يبقى إلزامياً.
 */
describe('R40 — restore verification + scheduled daily backup (MF-35 D6)', () => {
  let ctx: TestApp;
  let source: Actor;
  let target: Actor;
  const targetCode = 'r40-empty';

  type Downloaded = {
    checksum: string;
    payload: Record<string, Array<Record<string, unknown>>>;
    totalRows: number;
    rowCounts: Record<string, number>;
    tables: string[];
  };
  let snapshot: Downloaded;

  const data = (body: Record<string, unknown>): Record<string, unknown> => (body.data ?? body) as Record<string, unknown>;
  const rows = (body: unknown): Array<Record<string, unknown>> => {
    if (Array.isArray(body)) return body as Array<Record<string, unknown>>;
    const b = body as { data?: unknown; rows?: unknown };
    if (Array.isArray(b?.rows)) return b.rows as Array<Record<string, unknown>>;
    if (Array.isArray(b?.data)) return b.data as Array<Record<string, unknown>>;
    return [];
  };
  const reqAs = (actor: Actor, method: 'get' | 'post', path: string, body?: unknown) =>
    api(ctx.server, method, `/api/v1${path}`, { token: actor.token, body });

  type Verification = {
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
  type RestoreBody = {
    mode: string;
    insertedRows: number;
    skippedRows: number;
    summary: {
      tables: Record<string, { rows: number; inserted: number; skipped: number; error?: string }>;
      unresolved?: string[];
      verification?: Verification;
    };
  };

  /** مجموع مدين/دائن المتوقع من قيود النسخة نفسها (مرجع ميزان المراجعة). */
  const journalSums = (payload: Record<string, Array<Record<string, unknown>>>): { debit: number; credit: number } => {
    const lines = payload.journal_entry_lines ?? [];
    return {
      debit: lines.reduce((sum, line) => sum + Number(line.debit ?? 0), 0),
      credit: lines.reduce((sum, line) => sum + Number(line.credit ?? 0), 0),
    };
  };
  const verifyOf = (body: RestoreBody): Verification => {
    const verification = body.summary.verification;
    expect(verification, `verification missing from summary: ${JSON.stringify(body.summary).slice(0, 300)}`).toBeDefined();
    return verification as Verification;
  };

  beforeAll(async () => {
    ctx = await createTestApp('r40-restore');
    source = await createActor(ctx, {
      tenantCode: 'r40-src',
      email: 'owner@r40-src.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'accounting.account.view',
        'accounting.account.manage',
        'accounting.journal.post',
        'accounting.period.view',
        'accounting.period.close',
        'accounting.reports.view',
        'reporting.view',
        'treasury.view',
        'treasury.voucher.create',
        'treasury.voucher.post',
        'settings.backup.manage',
        'settings.restore.manage',
      ],
    });
    await ctx.app.get(OrgProvisioningService).provisionOrgDefaults(source.tenantId);

    const year = new Date().getUTCFullYear();
    const fy = await reqAs(source, 'post', '/fiscal-years', {
      code: `FY${year}`,
      name: `FY ${year}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
    });
    expect(fy.status, JSON.stringify(fy.body)).toBe(201);

    // بيانات أعمال حقيقية للاختبار: سند قبض + سند صرف ⇐ قيود مرحّلة (ميزان غير صفري).
    const branchId = String(rows((await reqAs(source, 'get', '/branches')).body)[0]?.id ?? '');
    expect(branchId).toBeTruthy();
    const accounts = rows((await reqAs(source, 'get', '/accounts')).body);
    const idOf = (code: string): string => String(accounts.find((a) => a.code === code)?.id ?? '');
    const revenueId = String(
      accounts.find((a) => a.type === 'revenue' && a.isPostable !== false)?.id ?? idOf('4100001') ?? '',
    );
    const expenseId = String(
      accounts.find((a) => a.type === 'expense' && a.isPostable !== false)?.id ?? idOf('3110001') ?? '',
    );
    expect(revenueId, 'a revenue account must exist in the provisioned COA').toBeTruthy();
    expect(expenseId, 'an expense account must exist in the provisioned COA').toBeTruthy();
    const locations = rows((await reqAs(source, 'get', '/cash-locations')).body);
    const safeId = String(locations.find((l) => l.kind === 'safe')?.id ?? locations[0]?.id ?? '');
    expect(safeId, 'provisioning must create a cash location').toBeTruthy();

    const voucher = async (kind: 'receipt' | 'payment', counterAccountId: string, amount: string) => {
      const created = await reqAs(source, 'post', '/vouchers', {
        branchId,
        kind,
        subtype: 'account',
        date: `${year}-06-15`,
        counterAccountId,
        cashLocationId: safeId,
        method: 'cash',
        amount,
        description: `R40 ${kind}`,
      });
      expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
      const posted = await reqAs(source, 'post', `/vouchers/${String(data(created.body).id)}/post`, {});
      expect(posted.status, JSON.stringify(posted.body)).toBeLessThan(300);
    };
    await voucher('receipt', revenueId, '1000.0000');
    await voucher('payment', expenseId, '300.0000');

    // المستأجر الهدف: ملف فارغ تماماً (بلا بيانات أعمال).
    const empty = await createTenantFixture(ctx.db.ownerUrl, { code: targetCode, name: 'R40 Empty' });
    target = await createActor(ctx, {
      tenantId: empty.id,
      tenantCode: targetCode,
      email: 'owner@r40-empty.test',
      permissions: [
        ...ALL_PLATFORM_PERMISSIONS,
        ...ALL_ORGANIZATION_PERMISSIONS,
        'settings.backup.manage',
        'settings.restore.manage',
      ],
    });

    // نسخة المصدر + تنزيل حمولتها (مسار ما بعد الإقفال — لا حمولات في القوائم).
    const created = await reqAs(source, 'post', '/settings/backups', { note: 'r40-source' });
    expect(created.status, JSON.stringify(created.body)).toBeLessThan(300);
    const backupId = String(data(created.body).id ?? '');
    expect(backupId).toBeTruthy();
    const download = await reqAs(source, 'get', `/settings/backups/${backupId}/download`);
    expect(download.status, JSON.stringify(download.body)).toBeLessThan(300);
    snapshot = data(download.body) as unknown as Downloaded;
    expect(snapshot.totalRows, 'source backup must carry rows').toBeGreaterThan(0);
    expect(snapshot.payload.journal_entry_lines?.length, 'source must carry journal lines (TB)').toBeGreaterThan(0);
    expect(idOf('1211001'), 'cash account in snapshot COA').toBeTruthy();
  }, 120_000);

  afterAll(async () => {
    await ctx?.close();
  });

  it('dry_run إلى مستأجر فارغ: يُبلّغ بعددٍ وتحقّقٍ كاملين دون أي كتابة دائمة', async () => {
    const expected = journalSums(snapshot.payload);
    expect(expected.debit, 'source TB must be balanced and non-zero').toBeGreaterThan(0);
    expect(expected.debit).toBeCloseTo(expected.credit, 4);

    const res = await reqAs(target, 'post', '/settings/restores', {
      payload: snapshot.payload,
      checksum: snapshot.checksum,
      mode: 'dry_run',
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const body = data(res.body) as unknown as RestoreBody;
    expect(body.mode).toBe('dry_run');

    const verification = verifyOf(body);
    expect(verification.passed, JSON.stringify(verification)).toBe(true);
    expect(verification.tablesChecked).toBeGreaterThan(0);
    expect(verification.tablesMatched).toBe(verification.tablesChecked);
    expect(verification.mismatches).toEqual([]);
    // الهدف فارغ ⇐ المحاكاة تُدرج كل الصفوف (ACC-080: أرقام حقيقية لا أصفار).
    expect(body.insertedRows, JSON.stringify(body.summary).slice(0, 1800)).toBe(snapshot.totalRows);
    expect(body.skippedRows).toBe(0);
    // ميزان المراجعة بعد المحاكاة (قبل التراجع) = مجاميع قيود النسخة.
    expect(Number(verification.trialBalance.debitAfter)).toBeCloseTo(expected.debit, 4);
    expect(Number(verification.trialBalance.creditAfter)).toBeCloseTo(expected.credit, 4);
    expect(verification.trialBalance.balancedAfter).toBe(true);
    expect(verification.trialBalance.deltaBalanced).toBe(true);

    // لا شيء كُتب فعلاً: الاستعادة الفعلية لاحقاً ستُدرج كل شيء (الهدف ما زال فارغاً).
    const runs = await reqAs(target, 'get', '/settings/restores');
    expect(runs.status).toBe(200);
    const dryListed = rows(runs.body).find((r) => r.id === (data(res.body) as { id?: string }).id) as
      | (Record<string, unknown> & { summary?: RestoreBody['summary'] })
      | undefined;
    expect(dryListed?.summary?.verification, 'verification must be persisted on the run').toBeDefined();
  });

  it('apply إلى مستأجر فارغ: عدّ الجداول وميزان المراجعة مطابقان 100% (AC MF-35)', async () => {
    const expected = journalSums(snapshot.payload);

    // الحارس: بلا تأكيد رمز المستأجر لا شيء يُنفَّذ.
    const refused = await reqAs(target, 'post', '/settings/restores', {
      payload: snapshot.payload,
      checksum: snapshot.checksum,
      mode: 'apply',
      confirmTenantCode: 'not-the-code',
    });
    expect(refused.status).toBe(422);

    const res = await reqAs(target, 'post', '/settings/restores', {
      payload: snapshot.payload,
      checksum: snapshot.checksum,
      mode: 'apply',
      confirmTenantCode: targetCode,
    });
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    const body = data(res.body) as unknown as RestoreBody;
    expect(body.mode).toBe('apply');

    // 100% من الصفوف هبطت في الملف الفارغ: كل جدول بإدخاله المتوقع، بلا استثناء.
    expect(body.insertedRows, JSON.stringify(body.summary).slice(0, 1800)).toBe(snapshot.totalRows);
    expect(body.skippedRows).toBe(0);
    expect(body.summary.unresolved ?? []).toEqual([]);
    for (const [table, count] of Object.entries(snapshot.rowCounts)) {
      const entry = body.summary.tables[table];
      expect(entry, `table ${table} missing from restore summary`).toBeDefined();
      expect(entry.inserted, `table ${table}: inserted != snapshot rows`).toBe(count);
      expect(entry.error, `table ${table}: ${entry.error ?? ''}`).toBeUndefined();
    }

    const verification = verifyOf(body);
    expect(verification.passed, JSON.stringify(verification)).toBe(true);
    expect(verification.tablesMatched).toBe(verification.tablesChecked);
    expect(verification.mismatches).toEqual([]);
    expect(verification.trialBalance.balancedAfter).toBe(true);
    expect(verification.trialBalance.deltaBalanced).toBe(true);
    expect(Number(verification.trialBalance.debitAfter)).toBeCloseTo(expected.debit, 4);
    expect(Number(verification.trialBalance.creditAfter)).toBeCloseTo(expected.credit, 4);
    expect(Number(verification.trialBalance.debitBefore)).toBe(0);
    expect(Number(verification.trialBalance.creditBefore)).toBe(0);

    // استعادة ثانية فوق الملف الممتلئ: تُتخطّى كل الصفوف والتحقّق يبقى صحيحاً (additive).
    const again = await reqAs(target, 'post', '/settings/restores', {
      payload: snapshot.payload,
      checksum: snapshot.checksum,
      mode: 'apply',
      confirmTenantCode: targetCode,
    });
    expect(again.status, JSON.stringify(again.body)).toBeLessThan(300);
    const againBody = data(again.body) as unknown as RestoreBody;
    expect(againBody.insertedRows).toBe(0);
    expect(againBody.skippedRows).toBe(snapshot.totalRows);
    expect(verifyOf(againBody).passed, 're-restore must stay verified').toBe(true);
  });

  it('الجدولة اليومية: معالج backup.daily مسجَّل وينشئ نسخة ويحتفظ بال近期 (14 يوماً)', async () => {
    const registry = ctx.app.get(JobHandlerRegistry);
    expect(registry.registered(), 'operations module must register the handler on app init').toContain('maintenance:backup.daily');

    // نسخة قديمة (15 يوماً) يجب أن تُستأصل بالاحتفاظ؛ نسخة حديثة يجب أن تبقى.
    const ancient = await reqAs(source, 'post', '/settings/backups', { note: 'r40-ancient' });
    expect(ancient.status).toBeLessThan(300);
    const ancientId = String(data(ancient.body).id);
    await withOwnerClient(ctx.db.ownerUrl, async (client) => {
      await client.query(`UPDATE backup_runs SET created_at = now() - interval '15 days' WHERE id = $1`, [ancientId]);
    });

    const backups = ctx.app.get(BackupService);
    const result = await backups.dailyBackup(source.tenantId);
    expect(result.backupId, 'scheduled backup must produce a run').toBeTruthy();
    expect(result.pruned).toBeGreaterThanOrEqual(1);

    const list = rows((await reqAs(source, 'get', '/settings/backups')).body) as Array<Record<string, unknown>>;
    const createdRun = list.find((r) => r.id === result.backupId);
    expect(createdRun, 'scheduled backup must be listed').toBeDefined();
    expect(String(createdRun?.note ?? '')).toContain('scheduled-daily');
    expect(list.some((r) => r.id === ancientId), 'backups older than retention must be pruned').toBe(false);
    expect(list.some((r) => r.id !== ancientId && r.id !== result.backupId), 'recent backups must be kept').toBe(true);

    // مسار المعالج فعلياً: dispatch عبر السجل (نفس ما يستهلكه العامل بلا Redis).
    const dispatched = await registry.dispatch('maintenance', {
      tenantId: source.tenantId,
      type: 'backup.daily',
      payload: { scheduled: true },
    });
    expect(dispatched).toBe(true);
  });

  it('جدولة العامل: مهمة يومية بمعرّف مُجمَّع + إعادة جدولة كل 24 ساعة (maintenanceJobsFor)', async () => {
    const mod = (await import('../src/modules/platform-services/jobs/worker.runner.js')) as {
      maintenanceJobsFor?: (tenantId: string, now?: Date) => Array<{ queue: string; type: string; tenantId: string; jobId?: string; payload: Record<string, unknown> }>;
    };
    expect(typeof mod.maintenanceJobsFor, 'worker must export the per-tenant schedule builder').toBe('function');

    const jobs = mod.maintenanceJobsFor!(source.tenantId, new Date('2026-10-24T05:00:00Z'));
    const backupJob = jobs.find((job) => job.type === 'backup.daily');
    expect(backupJob, 'backup.daily must be part of the per-tenant schedule').toBeDefined();
    expect(backupJob!.queue).toBe('maintenance');
    expect(backupJob!.tenantId).toBe(source.tenantId);
    expect(backupJob!.jobId).toBe(`backup-daily-${source.tenantId}-2026-10-24`);
    expect(backupJob!.payload).toMatchObject({ scheduled: true });
    // الوظائف القائمة لا تختفي (الطابور نفسه، معرّفات مُجمَّعة كما كانت).
    expect(jobs.find((job) => job.type === 'ai.suggest')?.jobId).toBe(`ai-suggest-${source.tenantId}-2026-10-24`);
    expect(jobs.some((job) => job.type === 'files.orphan-gc')).toBe(true);
    // اليوم التالي معرّف آخر ⇐ تحرّك يومي فعلاً لا ازدواج.
    const tomorrow = mod.maintenanceJobsFor!(source.tenantId, new Date('2026-10-25T05:00:00Z'));
    expect(tomorrow.find((job) => job.type === 'backup.daily')?.jobId).toBe(`backup-daily-${source.tenantId}-2026-10-25`);
  });
});
