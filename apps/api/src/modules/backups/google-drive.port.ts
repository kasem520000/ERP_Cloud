import { createHash, randomBytes } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { DomainError, errorCodes } from '@erp/contracts';
import { env } from '@erp/config';

/**
 * P-C10 — **منفذ جوجل درايف للنسخ الاحتياطي.**
 *
 * التنفيذ المعتمَد هنا هو **محاكاة** (مثل بوابة ZATCA في `gateway.ts`): لا توجد اعتمادات
 * OAuth حقيقية في بيئة المراجعة، ولكن الواجهة والعمليات والأخطاء كلها حقيقية. الفصل
 * بين الواجهة والتنفيذ هو ما يجعل إضافة تنفيذ حقيقي (بتوثيق OAuth فعلي) تغييراً في
 * ملف واحد لا في كل مسار.
 *
 * ثلاث قواعد تحكم هذا المنفذ:
 *
 *   1. **الاتصال مرحلته واضحة.** `connect` يُنشئ «حساباً» بمعرفٍ ثابت وحفظه، و`disconnect`
 *      يمسح الملفّات المرفوعة ولا يمسّ السجلّ. و`status` يصف المرحلة الحالية بدقة.
 *   2. **الرفع يُحصى ولا يُعدّ.** كل رفع يُسجّل بحجمٍ وبصمة (`sha256`) في `google_drive_backups`،
 *      والاستعادة تقرأ من الملفّات المرفوعة لا من السجلّ.
 *   3. **الاستعادة من الدرايف تُنفّذ مثل الاستعادة من المخزن المحلي** — نفس الفحص
 *      (preflight) ونفس التحكّم في الجداول، فالدرايف بديلٌ للمكان لا للمنطقة.
 */

export const GOOGLE_DRIVE_PORT = 'GOOGLE_DRIVE_PORT';

export type GoogleDriveBackupStatus = 'connected' | 'disconnected' | 'never_connected';

export type GoogleDriveBackupFile = {
  id: string;
  name: string;
  sizeBytes: number;
  checksum: string;
  uploadedAt: string;
  scope: 'platform' | 'tenant';
  tenantId: string | null;
  backupJobId: string | null;
};

export type GoogleDriveConnection = {
  connected: boolean;
  email: string;
  connectedAt: string | null;
  files: number;
  totalBytes: number;
  status: GoogleDriveBackupStatus;
};

export interface GoogleDrivePort {
  readonly name: string;
  isConfigured(): boolean;
  connect(): Promise<GoogleDriveConnection>;
  disconnect(): Promise<void>;
  status(): Promise<GoogleDriveConnection>;
  upload(file: {
    name: string;
    data: Buffer;
    scope: 'platform' | 'tenant';
    tenantId: string | null;
    backupJobId: string | null;
  }): Promise<GoogleDriveBackupFile>;
  listFiles(filter?: { scope?: 'platform' | 'tenant'; tenantId?: string }): Promise<GoogleDriveBackupFile[]>;
  download(fileId: string): Promise<Buffer>;
  deleteFile(fileId: string): Promise<boolean>;
}

/**
 * المحاكاة: ملفات «مرفوعة» تحفظ في ذاكرة العملية (وفي سجلّ التدقيق). المعرفات
 * والأحجام والبصمات حقيقية — ما ينقص هو الناقل الفعلي إلى خوادم جوجل.
 */
@Injectable()
export class GoogleDriveSimulator implements GoogleDrivePort {
  readonly name = 'google-drive';
  private readonly logger = new Logger(GoogleDriveSimulator.name);

  private connected = false;
  private connectedAt: string | null = null;
  private email = '';
  private files = new Map<string, GoogleDriveBackupFile & { data: Buffer }>();

  isConfigured(): boolean {
    // التنفيذ الحقيقي يفحص اعتمادات OAuth؛ المحاكاة تُجيب دائماً أنها «قابلة للتشغيل».
    return true;
  }

  async connect(): Promise<GoogleDriveConnection> {
    const email = 'backup@erp-cloud.local';
    this.connected = true;
    this.connectedAt = new Date().toISOString();
    this.email = email;
    this.logger.log({ email }, 'google drive connected (simulated)');
    return this.status();
  }

  async disconnect(): Promise<void> {
    const count = this.files.size;
    this.files.clear();
    this.connected = false;
    this.connectedAt = null;
    this.email = '';
    this.logger.log({ count }, 'google drive disconnected (simulated)');
  }

  async status(): Promise<GoogleDriveConnection> {
    let totalBytes = 0;
    for (const file of this.files.values()) totalBytes += file.sizeBytes;
    return {
      connected: this.connected,
      email: this.email,
      connectedAt: this.connectedAt,
      files: this.files.size,
      totalBytes,
      status: this.connected ? 'connected' : this.files.size > 0 ? 'disconnected' : 'never_connected',
    };
  }

  async upload(file: {
    name: string;
    data: Buffer;
    scope: 'platform' | 'tenant';
    tenantId: string | null;
    backupJobId: string | null;
  }): Promise<GoogleDriveBackupFile> {
    if (!this.connected) {
      throw new DomainError(errorCodes.VERSION_CONFLICT, 'جوجل درايف غير متصل — اربِط الحساب أولاً', 409);
    }
    const id = `gdrive-${randomBytes(12).toString('hex')}`;
    const checksum = createHash('sha256').update(file.data).digest('hex');
    const record: GoogleDriveBackupFile & { data: Buffer } = {
      id,
      name: file.name,
      sizeBytes: file.data.length,
      checksum,
      uploadedAt: new Date().toISOString(),
      scope: file.scope,
      tenantId: file.tenantId,
      backupJobId: file.backupJobId,
      data: file.data,
    };
    this.files.set(id, record);
    this.logger.log({ id, name: file.name, bytes: file.data.length }, 'google drive upload (simulated)');
    return { ...record };
  }

  async listFiles(filter?: {
    scope?: 'platform' | 'tenant';
    tenantId?: string;
  }): Promise<GoogleDriveBackupFile[]> {
    const all = [...this.files.values()]
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))
      .map(({ data: _data, ...rest }) => rest);
    if (!filter) return all;
    return all.filter((f) => {
      if (filter.scope && f.scope !== filter.scope) return false;
      if (filter.tenantId && f.tenantId !== filter.tenantId) return false;
      return true;
    });
  }

  async download(fileId: string): Promise<Buffer> {
    const file = this.files.get(fileId);
    if (!file) {
      throw new DomainError(errorCodes.NOT_FOUND, `ملفّ غير موجود في جوجل درايف: ${fileId}`, 404);
    }
    return file.data;
  }

  async deleteFile(fileId: string): Promise<boolean> {
    return this.files.delete(fileId);
  }
}
