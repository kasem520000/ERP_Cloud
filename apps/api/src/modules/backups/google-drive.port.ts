import { createHash } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  DomainError,
  errorCodes,
  type GoogleDriveBackupFile,
  type GoogleDriveConnectInput,
  type GoogleDriveConnection,
} from '@erp/contracts';
import { env } from '@erp/config';
import { platformSettings, withPlatformAdminTx, type DatabaseHandle } from '@erp/database';

import { openSecret, sealSecret } from '../platform/auth/secret-box.js';

export type { GoogleDriveBackupFile, GoogleDriveConnectInput, GoogleDriveConnection };

export const GOOGLE_DRIVE_PORT = Symbol('GOOGLE_DRIVE_PORT');

const SETTINGS_KEY = 'backups.google_drive';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';

export interface GoogleDrivePort {
  status(): Promise<GoogleDriveConnection>;
  connect(input?: GoogleDriveConnectInput): Promise<GoogleDriveConnection>;
  disconnect(): Promise<void>;
  upload(params: {
    name: string;
    data: Buffer;
    scope: 'platform' | 'tenant';
    tenantId: string | null;
    backupJobId: string | null;
  }): Promise<GoogleDriveBackupFile>;
  listFiles(filter?: {
    scope?: 'platform' | 'tenant';
    tenantId?: string;
  }): Promise<GoogleDriveBackupFile[]>;
  download(fileId: string): Promise<Buffer>;
  deleteFile(fileId: string): Promise<boolean>;
}

interface StoredGoogleDriveSettings {
  clientId?: string;
  clientSecretEnc?: string;
  refreshTokenEnc?: string;
  folderId?: string | null;
  connected?: boolean;
  email?: string;
  connectedAt?: string | null;
}

interface ResolvedCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  folderId: string | null;
}

/**
 * منفذ جوجل درايف الفعلي عبر OAuth2 + Google Drive REST API v3.
 *
 * يُقرأ الاعتماد من متغيرات البيئة (`GOOGLE_DRIVE_CLIENT_ID` · `GOOGLE_DRIVE_CLIENT_SECRET`
 * · `GOOGLE_DRIVE_REFRESH_TOKEN`) أو من إعداد المنصة المشفّر `backups.google_drive`.
 * وعند غياب الاعتمادات يُعلِن بصراحة `not_configured` بدل التظاهر باتصال وهمي.
 */
export class GoogleDriveRestPort implements GoogleDrivePort {
  constructor(private readonly database: DatabaseHandle) {}

  private async readStored(): Promise<StoredGoogleDriveSettings | null> {
    const [row] = await withPlatformAdminTx(this.database.db, (tx) =>
      tx
        .select({ value: platformSettings.value })
        .from(platformSettings)
        .where(and(isNull(platformSettings.tenantId), eq(platformSettings.key, SETTINGS_KEY)))
        .limit(1),
    );
    if (!row?.value || typeof row.value !== 'object') return null;
    return row.value as StoredGoogleDriveSettings;
  }

  private async writeStored(next: StoredGoogleDriveSettings): Promise<void> {
    await withPlatformAdminTx(this.database.db, async (tx) => {
      const existing = await tx
        .select({ id: platformSettings.id })
        .from(platformSettings)
        .where(and(isNull(platformSettings.tenantId), eq(platformSettings.key, SETTINGS_KEY)))
        .limit(1);
      if (existing[0]) {
        await tx
          .update(platformSettings)
          .set({ value: next as Record<string, unknown>, updatedAt: new Date() })
          .where(eq(platformSettings.id, existing[0].id));
      } else {
        await tx.execute(sql`
          INSERT INTO platform_settings (tenant_id, key, value, updated_at)
          VALUES (NULL, ${SETTINGS_KEY}, ${JSON.stringify(next)}::jsonb, now())
        `);
      }
    });
  }

  private resolveCredentials(
    stored: StoredGoogleDriveSettings | null,
    override?: GoogleDriveConnectInput,
  ): ResolvedCredentials | null {
    const clientId =
      override?.clientId?.trim() ||
      stored?.clientId?.trim() ||
      env.GOOGLE_DRIVE_CLIENT_ID?.trim() ||
      '';
    const clientSecret =
      override?.clientSecret?.trim() ||
      (stored?.clientSecretEnc ? openSecret(stored.clientSecretEnc).toString('utf8') : '') ||
      env.GOOGLE_DRIVE_CLIENT_SECRET?.trim() ||
      '';
    const refreshToken =
      override?.refreshToken?.trim() ||
      (stored?.refreshTokenEnc ? openSecret(stored.refreshTokenEnc).toString('utf8') : '') ||
      env.GOOGLE_DRIVE_REFRESH_TOKEN?.trim() ||
      '';
    const folderId =
      override?.folderId?.trim() ||
      stored?.folderId?.trim() ||
      env.GOOGLE_DRIVE_FOLDER_ID?.trim() ||
      null;

    if (!clientId || !clientSecret || !refreshToken) return null;
    return { clientId, clientSecret, refreshToken, folderId };
  }

  private async fetchAccessToken(creds: ResolvedCredentials): Promise<string> {
    let response: Response;
    try {
      response = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
          refresh_token: creds.refreshToken,
          grant_type: 'refresh_token',
        }).toString(),
      });
    } catch (err) {
      throw new DomainError(
        'GOOGLE_DRIVE_API_ERROR',
        `تعذّر الاتصال بخادم مصادقة جوجل (oauth2.googleapis.com): ${err instanceof Error ? err.message : String(err)}`,
        502,
      );
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        `رفضت جوجل بيانات اعتماد OAuth2 (${response.status}): تحقّق من معرّف العميل والسر ورمز التحديث (Refresh Token). ${text.slice(0, 180)}`,
        422,
      );
    }
    const json = (await response.json()) as { access_token?: string };
    if (!json.access_token) {
      throw new DomainError(
        'GOOGLE_DRIVE_API_ERROR',
        'لم تُرجع جوجل رمز وصول صالحاً (access_token).',
        502,
      );
    }
    return json.access_token;
  }

  private async fetchAccountEmail(accessToken: string): Promise<string> {
    const res = await fetch(`${DRIVE_API}/about?fields=user(emailAddress,displayName)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new DomainError(
        'GOOGLE_DRIVE_API_ERROR',
        `تعذّر قراءة معلومات حساب جوجل درايف (${res.status}) — تأكّد من تفعيل Google Drive API وصلاحية drive.file.`,
        502,
      );
    }
    const data = (await res.json()) as { user?: { emailAddress?: string; displayName?: string } };
    return data.user?.emailAddress || data.user?.displayName || 'حساب جوجل درايف مرتبط';
  }

  async status(): Promise<GoogleDriveConnection> {
    const stored = await this.readStored();
    const creds = this.resolveCredentials(stored);
    if (!creds) {
      return {
        configured: false,
        connected: false,
        email: '',
        folderId: null,
        connectedAt: null,
        files: 0,
        totalBytes: 0,
        status: 'not_configured',
      };
    }

    if (stored && stored.connected === false) {
      return {
        configured: true,
        connected: false,
        email: stored.email ?? '',
        folderId: creds.folderId,
        connectedAt: null,
        files: 0,
        totalBytes: 0,
        status: 'disconnected',
      };
    }

    if (!stored?.connected && !env.GOOGLE_DRIVE_REFRESH_TOKEN) {
      return {
        configured: true,
        connected: false,
        email: stored?.email ?? '',
        folderId: creds.folderId,
        connectedAt: null,
        files: 0,
        totalBytes: 0,
        status: 'never_connected',
      };
    }

    try {
      const files = await this.listFiles();
      const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);
      return {
        configured: true,
        connected: true,
        email: stored?.email || 'حساب جوجل درايف (عبر متغيرات البيئة)',
        folderId: creds.folderId,
        connectedAt: stored?.connectedAt ?? null,
        files: files.length,
        totalBytes,
        status: 'connected',
      };
    } catch {
      return {
        configured: true,
        connected: Boolean(stored?.connected),
        email: stored?.email ?? '',
        folderId: creds.folderId,
        connectedAt: stored?.connectedAt ?? null,
        files: 0,
        totalBytes: 0,
        status: stored?.connected ? 'connected' : 'disconnected',
      };
    }
  }

  async connect(input?: GoogleDriveConnectInput): Promise<GoogleDriveConnection> {
    const stored = await this.readStored();
    const creds = this.resolveCredentials(stored, input);
    if (!creds) {
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        'يرجى إدخال بيانات اعتماد Google OAuth2 (معرّف العميل Client ID، السر Client Secret، ورمز التحديث Refresh Token) أو ضبط متغيرات GOOGLE_DRIVE_* في البيئة أولاً.',
        422,
      );
    }

    const accessToken = await this.fetchAccessToken(creds);
    const email = await this.fetchAccountEmail(accessToken);
    const connectedAt = new Date().toISOString();

    await this.writeStored({
      clientId: creds.clientId,
      clientSecretEnc: sealSecret(creds.clientSecret),
      refreshTokenEnc: sealSecret(creds.refreshToken),
      folderId: creds.folderId,
      connected: true,
      email,
      connectedAt,
    });

    const files = await this.listFiles().catch(() => [] as GoogleDriveBackupFile[]);
    const totalBytes = files.reduce((sum, f) => sum + f.sizeBytes, 0);

    return {
      configured: true,
      connected: true,
      email,
      folderId: creds.folderId,
      connectedAt,
      files: files.length,
      totalBytes,
      status: 'connected',
    };
  }

  async disconnect(): Promise<void> {
    const stored = await this.readStored();
    await this.writeStored({
      ...(stored ?? {}),
      connected: false,
      connectedAt: null,
    });
  }

  private async requireActiveToken(): Promise<{ accessToken: string; creds: ResolvedCredentials }> {
    const stored = await this.readStored();
    const creds = this.resolveCredentials(stored);
    if (!creds || (stored && stored.connected === false)) {
      throw new DomainError(
        errorCodes.VERSION_CONFLICT,
        'جوجل درايف غير مرتبط حالياً — أدخل بيانات الاعتماد واربط الحساب أولاً.',
        409,
      );
    }
    const accessToken = await this.fetchAccessToken(creds);
    return { accessToken, creds };
  }

  async upload(params: {
    name: string;
    data: Buffer;
    scope: 'platform' | 'tenant';
    tenantId: string | null;
    backupJobId: string | null;
  }): Promise<GoogleDriveBackupFile> {
    const { accessToken, creds } = await this.requireActiveToken();
    const checksum = createHash('sha256').update(params.data).digest('hex');
    const uploadedAt = new Date().toISOString();

    const metadata: Record<string, unknown> = {
      name: params.name,
      mimeType: 'application/x-ndjson',
      appProperties: {
        erpBackup: '1',
        scope: params.scope,
        tenantId: params.tenantId ?? '',
        backupJobId: params.backupJobId ?? '',
        checksum,
      },
    };
    if (creds.folderId) {
      metadata.parents = [creds.folderId];
    }

    const boundary = `erp_backup_${Date.now().toString(36)}`;
    const preamble = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: application/x-ndjson\r\n\r\n`,
      'utf8',
    );
    const epilogue = Buffer.from(`\r\n--${boundary}--`, 'utf8');
    const body = Buffer.concat([preamble, params.data, epilogue]);

    const res = await fetch(
      `${DRIVE_UPLOAD_API}&fields=id,name,size,createdTime,appProperties`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body,
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new DomainError(
        'GOOGLE_DRIVE_API_ERROR',
        `تعذّر رفع النسخة إلى جوجل درايف (${res.status}): ${errText.slice(0, 180)}`,
        502,
      );
    }

    const created = (await res.json()) as {
      id: string;
      name?: string;
      size?: string;
      createdTime?: string;
    };

    return {
      id: created.id,
      name: created.name ?? params.name,
      sizeBytes: Number(created.size ?? params.data.byteLength),
      checksum,
      uploadedAt: created.createdTime ?? uploadedAt,
      scope: params.scope,
      tenantId: params.tenantId,
      backupJobId: params.backupJobId,
    };
  }

  async listFiles(filter?: {
    scope?: 'platform' | 'tenant';
    tenantId?: string;
  }): Promise<GoogleDriveBackupFile[]> {
    const stored = await this.readStored();
    const creds = this.resolveCredentials(stored);
    if (!creds || (stored && stored.connected === false)) {
      return [];
    }

    const accessToken = await this.fetchAccessToken(creds);
    const clauses = ["trashed = false", "appProperties has { key='erpBackup' and value='1' }"];
    if (creds.folderId) {
      clauses.push(`'${creds.folderId.replace(/'/g, "\\'")}' in parents`);
    }
    const q = clauses.join(' and ');
    const url = `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,createdTime,appProperties)&orderBy=createdTime desc&pageSize=100`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return [];

    const json = (await res.json()) as {
      files?: Array<{
        id: string;
        name: string;
        size?: string;
        createdTime?: string;
        appProperties?: Record<string, string>;
      }>;
    };

    let items: GoogleDriveBackupFile[] = (json.files ?? []).map((f) => {
      const props = f.appProperties ?? {};
      const scope = props.scope === 'tenant' ? 'tenant' : 'platform';
      return {
        id: f.id,
        name: f.name,
        sizeBytes: Number(f.size ?? 0),
        checksum: props.checksum ?? '',
        uploadedAt: f.createdTime ?? new Date().toISOString(),
        scope,
        tenantId: props.tenantId ? props.tenantId : null,
        backupJobId: props.backupJobId ? props.backupJobId : null,
      };
    });

    if (filter?.scope) items = items.filter((f) => f.scope === filter.scope);
    if (filter?.tenantId) items = items.filter((f) => f.tenantId === filter.tenantId);
    return items;
  }

  async download(fileId: string): Promise<Buffer> {
    const { accessToken } = await this.requireActiveToken();
    const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new DomainError(
        errorCodes.NOT_FOUND,
        `تعذّر تنزيل الملف من جوجل درايف (${res.status})`,
        res.status === 404 ? 404 : 502,
      );
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  async deleteFile(fileId: string): Promise<boolean> {
    const { accessToken } = await this.requireActiveToken();
    const res = await fetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return res.ok || res.status === 204;
  }
}
