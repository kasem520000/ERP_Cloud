import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  DomainError,
  errorCodes,
  newId,
  releaseRejectionMessages,
  type PlatformRelease,
  type PlatformReleaseChannel,
  type PlatformReleaseList,
  type PlatformReleaseReason,
  type PlatformReleaseStatus,
  type PlatformReleaseUpload,
  type ReleaseRejectionCode,
  type TenantReleaseInfo,
} from '@erp/contracts';
import { withPlatformAdminTx, type DatabaseHandle } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { AuditService } from '../platform-services/audit/audit.service.js';

import { decodeBundle, inspectReleaseBundle } from './bundle.js';

/**
 * 🗜️ سجلّ إصدارات المنصّة — الخدمة.
 *
 * ثلاث قواعد تحكم هذا الملف:
 *
 *  1. **لا شيفرة من العميل تُنفَّذ ولا تُخزَّن.** الخدمة تستقبل أرشيفاً، تفحصه، وتُثبّت
 *     قياسه. لا فكّ ضغطٍ إلى القرص، ولا `import()`, ولا استدعاء لملفٍّ من الحزمة.
 *  2. **المرفوض يُسجَّل أيضاً.** حزمةٌ تحمل `deploy.sh` تُكتب صفاً بحالة `rejected` وسببها —
 *     لأن سؤال التدقيق «هل حاوَل أحدٌ نشر ملفٍّ تنفيذي؟» لا يُجاب بحذف المحاولة.
 *  3. **الإصدار الحالي واحدٌ لكل قناة.** يُنقل في معاملة: يُطفأ القديم ثم يُشعل الجديد،
 *     وفهرسٌ فريدٌ جزئي في القاعدة يمنع إصدارين حاليّين حتى لو أخطأ الكود.
 *
 * والرفع **لا يعلن** الإصدار تلقائياً إن كان على القناة إصدارٌ حاليّ: من يرفع حزمةً
 * للتجربة ليس بالضرورة من يقرّر أن يراها كل المستأجرين — الإعلان فعلٌ صريح (`promote`).
 */
@Injectable()
export class ReleasesService {
  constructor(
    @Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle,
    private readonly audit: AuditService,
  ) {}

  async list(): Promise<PlatformReleaseList> {
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const result = await tx.execute(sql`
        SELECT * FROM platform_releases ORDER BY uploaded_at DESC, id DESC LIMIT 100
      `);
      const releases = rowsOf(result).map((row) => this.toView(row));
      return { releases, current: releases.find((release) => release.isCurrent) ?? null };
    });
  }

  async upload(input: PlatformReleaseUpload, actorUserId: string | null): Promise<PlatformRelease> {
    const buffer = decodeBundle(input.contentBase64);
    if (!buffer) {
      // ما وصل ليس base64 صالحاً، فلا أرشيف نقرؤه: نفس مسار «ليس ZIP».
      const rejected = await this.recordRejection(
        input,
        actorUserId,
        'NOT_A_ZIP',
        'المحتوى ليس base64 صالحاً',
        Buffer.byteLength(input.contentBase64, 'utf8'),
      );
      throw new DomainError(errorCodes.VALIDATION_FAILED, rejected.rejectedReason!, 422, {
        field: 'bundle',
        rejectionCode: 'NOT_A_ZIP',
        releaseId: rejected.id,
      });
    }

    const inspection = inspectReleaseBundle(buffer, input.checksum);
    if (!inspection.ok) {
      const rejected = await this.recordRejection(
        input,
        actorUserId,
        inspection.code,
        inspection.detail ?? null,
        buffer.length,
        inspection.version ?? null,
      );
      // الرفض خطأُ طلبٍ (422) لا نجاحٌ بحالةٍ بائسة: من رفع الحزمة يجب أن يرى فشلاً،
      // مع بقاء الصفّ في السجلّ ليقرأه التدقيق.
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        rejected.rejectedReason ?? 'الحزمة مرفوضة',
        422,
        { field: 'bundle', rejectionCode: inspection.code, releaseId: rejected.id },
      );
    }

    const { manifest } = inspection;
    const id = newId();

    let alreadyCurrent = false;
    const row = await withPlatformAdminTx(this.database.db, async (tx) => {
      const existing = await tx.execute(sql`
        SELECT count(*)::int AS total FROM platform_releases
        WHERE channel = ${manifest.channel} AND status = 'accepted' AND is_current
      `);
      alreadyCurrent =
        Number(rowsOf<{ total: number }>(existing)[0]?.total ?? 0) > 0;

      const inserted = await tx.execute(sql`
        INSERT INTO platform_releases (
          id, version, channel, status, notes, highlights, min_from_version,
          filename, bytes, entries, checksum, checksum_verified, files,
          reason, is_current, uploaded_by
        ) VALUES (
          ${id}::uuid, ${manifest.version}, ${manifest.channel}, 'accepted',
          ${manifest.notes}, ${JSON.stringify(manifest.highlights)}::jsonb,
          ${manifest.minFromVersion ?? null},
          ${input.filename}, ${inspection.bytes}, ${inspection.entries},
          ${inspection.checksum}, ${inspection.checksumVerified},
          ${JSON.stringify(inspection.files)}::jsonb,
          ${input.reason}, ${!alreadyCurrent}, ${actorUserId}::uuid
        )
        RETURNING *
      `);
      return rowsOf(inserted)[0]!;
    }).catch((error: unknown) => {
      // إصدارٌ مكرّرٌ على القناة نفسها: 409 يسمّي الإصدار بدل خطأ قاعدةٍ خام. والمحرّك
      // يلفّ خطأ `pg` داخل خطأ استعلام، فالرمز `23505` يُقرأ من سلسلة الأسباب لا من الرسالة.
      if (isUniqueViolation(error)) {
        throw new DomainError(
          errorCodes.VERSION_CONFLICT,
          `الإصدار ${manifest.version} على القناة «${manifest.channel}» مُسجَّلٌ مسبقاً — ارفع رقماً جديداً بدل إعادة الملف`,
          409,
          { field: 'version' },
        );
      }
      throw error;
    });

    await this.audit.record({
      actorUserId,
      action: 'platform.release.upload',
      entity: 'platform_releases',
      entityId: id,
      meta: {
        version: manifest.version,
        channel: manifest.channel,
        bytes: inspection.bytes,
        entries: inspection.entries,
        checksum: inspection.checksum,
        files: inspection.files.slice(0, 50),
        reason: input.reason,
        published: !alreadyCurrent,
      },
    });

    return this.toView(row);
  }

  /** إعلان إصدارٍ مقبولٍ «حاليّاً» على قناته — وسحبُ العلم من سابقه في المعاملة نفسها. */
  async promote(id: string, input: PlatformReleaseReason, actorUserId: string | null): Promise<PlatformRelease> {
    const row = await withPlatformAdminTx(this.database.db, async (tx) => {
      const found = rowsOf(await tx.execute(sql`SELECT * FROM platform_releases WHERE id = ${id}::uuid LIMIT 1`))[0];
      if (!found) throw new DomainError(errorCodes.NOT_FOUND, 'الإصدار غير موجود', 404);
      if (found.status === 'rejected') {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'لا يمكن إعلان إصدارٍ مرفوض', 422, { field: 'id' });
      }
      if (found.status === 'revoked') {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'لا يمكن إعلان إصدارٍ مسحوب', 422, { field: 'id' });
      }
      if (found.is_current === true) return found;

      const channel = String(found.channel);
      await tx.execute(sql`
        UPDATE platform_releases SET is_current = false WHERE channel = ${channel} AND is_current
      `);
      const updated = await tx.execute(sql`
        UPDATE platform_releases SET is_current = true WHERE id = ${id}::uuid RETURNING *
      `);
      return rowsOf(updated)[0]!;
    });

    await this.audit.record({
      actorUserId,
      action: 'platform.release.promote',
      entity: 'platform_releases',
      entityId: id,
      meta: { version: row.version ?? null, channel: row.channel, reason: input.reason },
    });
    return this.toView(row);
  }

  /**
   * السحب: يُعلَّم الإصدار `revoked` ويُطفأ علمُه، ثم يُعاد إعلان آخر إصدارٍ مقبولٍ على
   * القناة نفسها إن وُجد — وإلّا بقيت المنصّة بلا إصدارٍ معلَن، وهو أصدق من الإبقاء على
   * إصدارٍ سُحب من العرض.
   */
  async revoke(id: string, input: PlatformReleaseReason, actorUserId: string | null): Promise<PlatformRelease> {
    const row = await withPlatformAdminTx(this.database.db, async (tx) => {
      const found = rowsOf(await tx.execute(sql`SELECT * FROM platform_releases WHERE id = ${id}::uuid LIMIT 1`))[0];
      if (!found) throw new DomainError(errorCodes.NOT_FOUND, 'الإصدار غير موجود', 404);
      if (found.status === 'rejected') {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'الحزمة مرفوضة أصلاً ولم تُعلَن', 422, { field: 'id' });
      }
      if (found.status === 'revoked') return found;

      const updated = await tx.execute(sql`
        UPDATE platform_releases
        SET status = 'revoked', revoked_at = now(), is_current = false
        WHERE id = ${id}::uuid RETURNING *
      `);
      if (found.is_current === true) {
        await tx.execute(sql`
          UPDATE platform_releases SET is_current = true
          WHERE id = (
            SELECT id FROM platform_releases
            WHERE channel = ${String(found.channel)} AND status = 'accepted' AND id <> ${id}::uuid
            ORDER BY uploaded_at DESC, id DESC LIMIT 1
          )
        `);
      }
      return rowsOf(updated)[0]!;
    });

    await this.audit.record({
      actorUserId,
      action: 'platform.release.revoke',
      entity: 'platform_releases',
      entityId: id,
      meta: { version: row.version ?? null, channel: row.channel, reason: input.reason },
    });
    return this.toView(row);
  }

  /**
   * ما يقرؤه المستأجر: الإصدار المعروض الآن (المستقرّ أولاً، ثم التجريبيّ). وما يُعاد
   * أربعةُ حقولٍ تُعرض في «حول النظام» — لا بصمة، ولا اسم ملفّ، ولا مَن رفعه.
   */
  async currentForTenants(): Promise<TenantReleaseInfo> {
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const result = await tx.execute(sql`
        SELECT version, channel, notes, highlights, uploaded_at
        FROM platform_releases
        WHERE status = 'accepted' AND is_current
        ORDER BY (channel = 'stable') DESC, uploaded_at DESC
        LIMIT 1
      `);
      const row = rowsOf(result)[0];
      if (!row) return null;
      return {
        version: String(row.version),
        channel: String(row.channel) as PlatformReleaseChannel,
        notes: String(row.notes ?? ''),
        highlights: toStringArray(row.highlights),
        publishedAt: new Date(row.uploaded_at as string | Date).toISOString(),
      };
    });
  }

  /**
   * الحزمة المرفوضة صفٌّ بقياسه: الإصدار `NULL` إن لم يُقرأ بيانها، وبصمةٌ صفرية صريحة
   * (العمود يطالب بـ64 حرفاً سادس عشري ولا يقبل الفراغ) — ولا تُشبه بصمةً حقيقية.
   */
  private async recordRejection(
    input: PlatformReleaseUpload,
    actorUserId: string | null,
    code: ReleaseRejectionCode,
    detail: string | null,
    bytes: number,
    version: string | null = null,
  ): Promise<PlatformRelease> {
    const id = newId();
    const row = await withPlatformAdminTx(this.database.db, async (tx) => {
      const inserted = await tx.execute(sql`
        INSERT INTO platform_releases (
          id, version, channel, status, notes, highlights, filename, bytes, entries,
          checksum, reason, rejection_code, rejection_detail, is_current, uploaded_by
        ) VALUES (
          ${id}::uuid, ${version}, 'stable', 'rejected', '', '[]'::jsonb,
          ${input.filename}, ${bytes}, 0, ${'0'.repeat(64)},
          ${input.reason}, ${code}, ${detail}, false, ${actorUserId}::uuid
        )
        RETURNING *
      `);
      return rowsOf(inserted)[0]!;
    });

    await this.audit.record({
      actorUserId,
      action: 'platform.release.rejected',
      entity: 'platform_releases',
      entityId: id,
      meta: { filename: input.filename, bytes, code, detail, reason: input.reason },
    });

    return this.toView(row);
  }

  private toView(row: Record<string, unknown>): PlatformRelease {
    const code = row.rejection_code as ReleaseRejectionCode | null;
    return {
      id: String(row.id),
      version: row.version === null || row.version === undefined ? null : String(row.version),
      channel: String(row.channel) as PlatformReleaseChannel,
      status: String(row.status) as PlatformReleaseStatus,
      notes: String(row.notes ?? ''),
      highlights: toStringArray(row.highlights),
      minFromVersion: row.min_from_version ? String(row.min_from_version) : null,
      filename: String(row.filename),
      bytes: Number(row.bytes ?? 0),
      entries: Number(row.entries ?? 0),
      checksum: String(row.checksum),
      checksumVerified: row.checksum_verified === true,
      files: toStringArray(row.files),
      reason: String(row.reason ?? ''),
      rejectionCode: code,
      rejectedReason: code
        ? `${releaseRejectionMessages[code] ?? 'مرفوضة'}${row.rejection_detail ? ` — ${String(row.rejection_detail)}` : ''}`
        : null,
      isCurrent: row.is_current === true,
      uploadedAt: new Date(row.uploaded_at as string | Date).toISOString(),
      uploadedBy: row.uploaded_by ? String(row.uploaded_by) : null,
      revokedAt: row.revoked_at ? new Date(row.revoked_at as string | Date).toISOString() : null,
    };
  }
}

/**
 * `23505` = انتهاك قيدٍ فريد. يُقرأ من السلسلة لأن drizzle يلفّ خطأ `pg` في خطأ استعلامٍ
 * رسالته نصُّ SQL لا اسم القيد.
 */
function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    const candidate = current as { code?: unknown; message?: unknown; cause?: unknown };
    if (candidate.code === '23505') return true;
    if (
      typeof candidate.message === 'string' &&
      /platform_releases_version_channel_key|duplicate key value/i.test(candidate.message)
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

/** `pg` يعيد نتيجة `tx.execute` في شكلٍ متغيّرٍ بين المحرّكات — هنا يُقرأ مرةً واحدة. */
function rowsOf<T = Record<string, unknown>>(result: unknown): T[] {
  const rows = (result as { rows?: unknown[] } | undefined)?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/** `jsonb` يعود مصفوفةً أو نصّاً حسب المحرّك — والقراءة تتحمّل الاثنين. */
function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item));
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
    } catch {
      return [];
    }
  }
  return [];
}
