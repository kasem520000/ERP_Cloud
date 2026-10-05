import { randomBytes } from 'node:crypto';
import { resolveTxt } from 'node:dns/promises';

import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { env } from '@erp/config';
import { DomainError, errorCodes, newId } from '@erp/contracts';
import {
  MARKETPLACE_APPS,
  MarketplaceRuleError,
  assertReviewedApp,
  enabledScreenHrefs,
  gatedScreenHrefs,
  normaliseDomain,
  txtMatches,
  verificationTxt,
  withPlatformAdminTx,
  withTenantTx,
  type DatabaseHandle,
  type DrizzleTx,
} from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { isUniqueViolation } from '../organization/shared/org-support.js';
import { signedContentUrl } from '../platform-services/files/download-token.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

type AppView = {
  code: string;
  nameAr: string;
  nameEn: string;
  descriptionAr: string;
  icon: string;
  version: string;
  monthlyPrice: string;
  isCore: boolean;
  isActive: boolean;
  enabled: boolean;
  installedAt: string | null;
  screens: string[];
};

export type MarketplaceList = {
  apps: AppView[];
  gatedHrefs: string[];
  enabledHrefs: string[];
};

type DomainView = {
  id: string;
  domain: string;
  status: string;
  sslStatus: string;
  txtHost: string;
  txtValue: string;
  verifiedAt: string | null;
};

type BrandingView = {
  logoFileId: string;
  logoUrl: string;
  primaryColor: string;
  secondaryColor: string;
  nameAr: string;
  nameEn: string;
};

type PublicBrand = {
  tenantCode: string;
  name: string;
  primaryColor: string;
  secondaryColor: string;
  logoUrl: string;
};

@Injectable()
export class MarketplaceService {
  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle) {}

  async listForTenant(tenantId: string): Promise<MarketplaceList> {
    await this.ensureCatalog();
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const catalog = rows(await tx.execute(sql`
        SELECT code, price_monthly::text AS monthly_price, is_active
        FROM marketplace_apps
        ORDER BY code
      `));
      const installed = rows(await tx.execute(sql`
        SELECT app_code, is_enabled, installed_at
        FROM tenant_apps
        WHERE tenant_id = ${tenantId}::uuid
      `));
      const stores = await this.legacyProviders(tx, tenantId);
      const byCode = new Map(catalog.map((row) => [str(row.code), row]));
      const installByCode = new Map(installed.map((row) => [str(row.app_code), row]));
      const apps = MARKETPLACE_APPS.map((app) => {
        const stored = byCode.get(app.code);
        const install = installByCode.get(app.code);
        const explicit = install ? flag(install.is_enabled) : undefined;
        const legacy = install === undefined && stores.has(app.code);
        return {
          code: app.code,
          nameAr: app.nameAr,
          nameEn: app.nameEn,
          descriptionAr: app.descriptionAr,
          icon: app.icon,
          version: app.version,
          monthlyPrice: moneyText(stored?.monthly_price ?? app.monthlyPrice),
          isCore: app.isCore,
          isActive: stored ? flag(stored.is_active) : true,
          enabled: explicit ?? legacy,
          installedAt: install?.installed_at ? iso(install.installed_at) : null,
          screens: [...app.screens],
        };
      });
      const enabledCodes = apps.filter((app) => app.enabled).map((app) => app.code);
      return { apps, gatedHrefs: gatedScreenHrefs(), enabledHrefs: enabledScreenHrefs(enabledCodes) };
    });
  }

  async install(tenantId: string, userId: string, code: string): Promise<AppView> {
    const app = this.reviewed(code);
    await this.ensureCatalog();
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const stored = first(await tx.execute(sql`
        SELECT is_active FROM marketplace_apps WHERE code = ${app.code} LIMIT 1
      `));
      if (!stored || !flag(stored.is_active)) {
        throw new DomainError(errorCodes.NOT_FOUND, 'الإضافة غير متاحة في السوق', 404);
      }
      await tx.execute(sql`
        INSERT INTO tenant_apps (id, tenant_id, app_code, is_enabled, settings, installed_at, installed_by)
        VALUES (${newId()}::uuid, ${tenantId}::uuid, ${app.code}, true, '{}'::jsonb, now(), ${userId}::uuid)
        ON CONFLICT (tenant_id, app_code) DO UPDATE
          SET is_enabled = true, updated_at = now()
      `);
      const list = await this.listInside(tx, tenantId);
      const view = list.find((item) => item.code === app.code);
      if (!view) throw new DomainError(errorCodes.NOT_FOUND, 'الإضافة غير متاحة في السوق', 404);
      return view;
    });
  }

  async uninstall(tenantId: string, code: string): Promise<AppView> {
    const app = this.reviewed(code);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const updated = rows(await tx.execute(sql`
        UPDATE tenant_apps
        SET is_enabled = false, updated_at = now()
        WHERE tenant_id = ${tenantId}::uuid AND app_code = ${app.code}
        RETURNING app_code
      `));
      if (!updated[0]) throw new DomainError(errorCodes.NOT_FOUND, 'الإضافة غير مثبّتة', 404);
      const list = await this.listInside(tx, tenantId);
      const view = list.find((item) => item.code === app.code);
      if (!view) throw new DomainError(errorCodes.NOT_FOUND, 'الإضافة غير مثبّتة', 404);
      return view;
    });
  }

  async listDomains(tenantId: string): Promise<DomainView[]> {
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const found = rows(await tx.execute(sql`
        SELECT id, domain, status, ssl_status, verification_token, verified_at
        FROM tenant_domains
        WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        ORDER BY created_at
      `));
      return found.map(toDomain);
    });
  }

  async addDomain(tenantId: string, raw: string): Promise<DomainView> {
    const domain = this.domainOf(raw);
    const token = randomBytes(16).toString('hex');
    try {
      return await withTenantTx(this.database.db, tenantId, async (tx) => {
        const inserted = first(await tx.execute(sql`
          INSERT INTO tenant_domains (id, tenant_id, domain, status, ssl_status, verification_token)
          VALUES (${newId()}::uuid, ${tenantId}::uuid, ${domain}, 'pending', 'manual', ${token})
          RETURNING id, domain, status, ssl_status, verification_token, verified_at
        `));
        if (!inserted) throw new DomainError(errorCodes.INTERNAL, 'تعذر حفظ الدومين', 500);
        return toDomain(inserted);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'هذا الدومين مستخدم', 422, { field: 'domain' });
      }
      throw error;
    }
  }

  async removeDomain(tenantId: string, id: string): Promise<{ id: string }> {
    this.uuid(id);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const removed = rows(await tx.execute(sql`
        UPDATE tenant_domains
        SET deleted_at = now(), updated_at = now()
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        RETURNING id
      `));
      if (!removed[0]) throw new DomainError(errorCodes.NOT_FOUND, 'الدومين غير موجود', 404);
      return { id };
    });
  }

  async verifyDomain(tenantId: string, id: string): Promise<DomainView> {
    this.uuid(id);
    const pending = await withTenantTx(this.database.db, tenantId, async (tx) =>
      first(await tx.execute(sql`
        SELECT id, domain, verification_token
        FROM tenant_domains
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        LIMIT 1
      `)),
    );
    if (!pending) throw new DomainError(errorCodes.NOT_FOUND, 'الدومين غير موجود', 404);
    const challenge = verificationTxt(str(pending.domain), str(pending.verification_token));
    const records = await this.lookupTxt(challenge.host);
    if (!txtMatches(challenge.value, records)) {
      throw new DomainError(
        errorCodes.VALIDATION_FAILED,
        `لم يُعثر على سجل TXT. أضف ${challenge.host} بالقيمة ${challenge.value}`,
        422,
        { field: 'domain' },
      );
    }
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      const updated = first(await tx.execute(sql`
        UPDATE tenant_domains
        SET status = 'active', verified_at = now(), updated_at = now()
        WHERE id = ${id}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
        RETURNING id, domain, status, ssl_status, verification_token, verified_at
      `));
      if (!updated) throw new DomainError(errorCodes.NOT_FOUND, 'الدومين غير موجود', 404);
      return toDomain(updated);
    });
  }

  async branding(tenantId: string): Promise<BrandingView> {
    return withTenantTx(this.database.db, tenantId, async (tx) => this.readBrand(tx, tenantId));
  }

  async saveBranding(
    tenantId: string,
    input: { logoFileId?: unknown; primaryColor?: unknown; secondaryColor?: unknown },
  ): Promise<BrandingView> {
    const primary = colorOf(input.primaryColor, 'primaryColor');
    const secondary = colorOf(input.secondaryColor, 'secondaryColor');
    const logoFileId = optionalUuid(input.logoFileId);
    return withTenantTx(this.database.db, tenantId, async (tx) => {
      if (logoFileId) await this.assertLogo(tx, tenantId, logoFileId);
      await tx.execute(sql`
        INSERT INTO tenant_branding (tenant_id, logo_file_id, primary_color, secondary_color, updated_at)
        VALUES (
          ${tenantId}::uuid,
          ${logoFileId}::uuid,
          ${primary},
          ${secondary},
          now()
        )
        ON CONFLICT (tenant_id) DO UPDATE SET
          logo_file_id = EXCLUDED.logo_file_id,
          primary_color = EXCLUDED.primary_color,
          secondary_color = EXCLUDED.secondary_color,
          updated_at = now()
      `);
      return this.readBrand(tx, tenantId);
    });
  }

  /**
   * One active domain, looked up by `app.lookup_host`. The GUC is set only for this
   * statement's transaction, and the policy matches that host alone.
   */
  async resolveHost(rawHost: string): Promise<PublicBrand | null> {
    let host: string;
    try {
      host = normaliseDomain(rawHost);
    } catch {
      return null;
    }
    const found = await this.database.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.lookup_host', ${host}, true)`);
      return first(await tx.execute(sql`
        SELECT d.tenant_id, t.code AS tenant_code, t.name,
               b.primary_color, b.secondary_color, b.logo_file_id
        FROM tenant_domains d
        JOIN tenants t ON t.id = d.tenant_id
        LEFT JOIN tenant_branding b ON b.tenant_id = d.tenant_id
        WHERE d.domain = ${host} AND d.status = 'active' AND d.deleted_at IS NULL
        LIMIT 1
      `));
    });
    if (!found) return null;
    const tenantId = str(found.tenant_id);
    const logoFileId = str(found.logo_file_id);
    return {
      tenantCode: str(found.tenant_code),
      name: str(found.name),
      primaryColor: str(found.primary_color),
      secondaryColor: str(found.secondary_color),
      logoUrl: logoFileId ? this.logoUrl(tenantId, logoFileId) : '',
    };
  }

  async platformList() {
    await this.ensureCatalog();
    return withPlatformAdminTx(this.database.db, async (tx) => {
      const stored = rows(await tx.execute(sql`
        SELECT code, price_monthly::text AS monthly_price, is_active
        FROM marketplace_apps
        ORDER BY code
      `));
      const byCode = new Map(stored.map((row) => [str(row.code), row]));
      return MARKETPLACE_APPS.map((app) => {
        const row = byCode.get(app.code);
        return {
          code: app.code,
          nameAr: app.nameAr,
          nameEn: app.nameEn,
          descriptionAr: app.descriptionAr,
          monthlyPrice: moneyText(row?.monthly_price ?? app.monthlyPrice),
          isCore: app.isCore,
          isActive: row ? flag(row.is_active) : true,
          screens: [...app.screens],
        };
      });
    });
  }

  async platformUpdate(code: string, input: { monthlyPrice?: unknown; isActive?: unknown }) {
    const app = this.reviewed(code);
    const monthly = input.monthlyPrice === undefined ? undefined : decimalText(input.monthlyPrice);
    const active = input.isActive === undefined ? undefined : input.isActive === true;
    if (monthly === undefined && active === undefined) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'لا شيء لتحديثه', 422);
    }
    await this.ensureCatalog();
    return withPlatformAdminTx(this.database.db, async (tx) => {
      if (monthly !== undefined) {
        await tx.execute(sql`
          UPDATE marketplace_apps
          SET price_monthly = ${monthly}::numeric, updated_at = now()
          WHERE code = ${app.code}
        `);
      }
      if (active !== undefined) {
        await tx.execute(sql`
          UPDATE marketplace_apps SET is_active = ${active}, updated_at = now() WHERE code = ${app.code}
        `);
      }
      const row = first(await tx.execute(sql`
        SELECT price_monthly::text AS monthly_price, is_active
        FROM marketplace_apps WHERE code = ${app.code} LIMIT 1
      `));
      return {
        code: app.code,
        nameAr: app.nameAr,
        monthlyPrice: moneyText(row?.monthly_price ?? app.monthlyPrice),
        isActive: row ? flag(row.is_active) : true,
      };
    });
  }

  private reviewed(code: string) {
    try {
      return assertReviewedApp(code);
    } catch (error) {
      if (error instanceof MarketplaceRuleError) {
        throw new DomainError(errorCodes.VALIDATION_FAILED, 'إضافة غير مُراجَعة. لا يُثبَّت كود طرف ثالث.', 422, {
          field: 'code',
        });
      }
      throw error;
    }
  }

  private domainOf(raw: string): string {
    if (typeof raw !== 'string' || !raw.trim()) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'الدومين مطلوب', 422, { field: 'domain' });
    }
    try {
      return normaliseDomain(raw);
    } catch {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'الدومين غير صالح', 422, { field: 'domain' });
    }
  }

  private uuid(value: string) {
    if (!UUID.test(value)) throw new DomainError(errorCodes.NOT_FOUND, 'غير موجود', 404);
  }

  /**
   * Inserts only the reviewed catalog. The platform GUC is required by the write
   * policy; the statement does not read tenant rows.
   */
  private async ensureCatalog() {
    await withPlatformAdminTx(this.database.db, async (tx) => {
      for (const app of MARKETPLACE_APPS) {
        await tx.execute(sql`
          INSERT INTO marketplace_apps (
            id, code, name_ar, name_en, description_ar, icon, version, price_monthly, is_core, is_active, screens
          ) VALUES (
            ${newId()}::uuid,
            ${app.code},
            ${app.nameAr},
            ${app.nameEn},
            ${app.descriptionAr},
            ${app.icon},
            ${app.version},
            ${app.monthlyPrice}::numeric,
            ${app.isCore},
            true,
            ${JSON.stringify(app.screens)}::jsonb
          )
          ON CONFLICT (code) DO NOTHING
        `);
      }
    });
  }

  private async listInside(tx: DrizzleTx, tenantId: string): Promise<AppView[]> {
    const installed = rows(await tx.execute(sql`
      SELECT app_code, is_enabled, installed_at FROM tenant_apps WHERE tenant_id = ${tenantId}::uuid
    `));
    const prices = rows(await tx.execute(sql`
      SELECT code, price_monthly::text AS monthly_price, is_active FROM marketplace_apps
    `));
    const stores = await this.legacyProviders(tx, tenantId);
    const installByCode = new Map(installed.map((row) => [str(row.app_code), row]));
    const priceByCode = new Map(prices.map((row) => [str(row.code), row]));
    return MARKETPLACE_APPS.map((app) => {
      const install = installByCode.get(app.code);
      const stored = priceByCode.get(app.code);
      const explicit = install ? flag(install.is_enabled) : undefined;
      return {
        code: app.code,
        nameAr: app.nameAr,
        nameEn: app.nameEn,
        descriptionAr: app.descriptionAr,
        icon: app.icon,
        version: app.version,
        monthlyPrice: moneyText(stored?.monthly_price ?? app.monthlyPrice),
        isCore: app.isCore,
        isActive: stored ? flag(stored.is_active) : true,
        enabled: explicit ?? (install === undefined && stores.has(app.code)),
        installedAt: install?.installed_at ? iso(install.installed_at) : null,
        screens: [...app.screens],
      };
    });
  }

  private async legacyProviders(tx: DrizzleTx, tenantId: string): Promise<Set<string>> {
    const found = rows(await tx.execute(sql`
      SELECT DISTINCT provider
      FROM ecommerce_stores
      WHERE tenant_id = ${tenantId}::uuid AND deleted_at IS NULL AND status = 'active'
    `));
    return new Set(found.map((row) => str(row.provider)));
  }

  private async readBrand(tx: DrizzleTx, tenantId: string): Promise<BrandingView> {
    const brand = first(await tx.execute(sql`
      SELECT logo_file_id, primary_color, secondary_color
      FROM tenant_branding WHERE tenant_id = ${tenantId}::uuid LIMIT 1
    `));
    const profile = first(await tx.execute(sql`
      SELECT name_ar, name_en FROM company_profiles WHERE tenant_id = ${tenantId}::uuid LIMIT 1
    `));
    const tenant = first(await tx.execute(sql`SELECT name FROM tenants WHERE id = ${tenantId}::uuid LIMIT 1`));
    const logoFileId = str(brand?.logo_file_id);
    return {
      logoFileId,
      logoUrl: logoFileId ? this.logoUrl(tenantId, logoFileId) : '',
      primaryColor: str(brand?.primary_color),
      secondaryColor: str(brand?.secondary_color),
      nameAr: str(profile?.name_ar) || str(tenant?.name),
      nameEn: str(profile?.name_en),
    };
  }

  private async assertLogo(tx: DrizzleTx, tenantId: string, fileId: string) {
    const file = first(await tx.execute(sql`
      SELECT mime, status FROM files
      WHERE id = ${fileId}::uuid AND tenant_id = ${tenantId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `));
    if (!file || str(file.status) !== 'ready' || !str(file.mime).startsWith('image/')) {
      throw new DomainError(errorCodes.VALIDATION_FAILED, 'الشعار يجب أن يكون صورة مرفوعة ومُثبَتة', 422, {
        field: 'logoFileId',
      });
    }
  }

  private logoUrl(tenantId: string, fileId: string): string {
    try {
      return signedContentUrl(fileId, tenantId, env.FILES_DOWNLOAD_URL_TTL_SECONDS);
    } catch {
      return '';
    }
  }

  private async lookupTxt(host: string): Promise<string[]> {
    try {
      const records = await Promise.race([
        resolveTxt(host),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('timeout')), 5_000);
        }),
      ]);
      return records.map((parts) => parts.join(''));
    } catch {
      return [];
    }
  }
}

function toDomain(row: Record<string, unknown>): DomainView {
  const domain = str(row.domain);
  const challenge = verificationTxt(domain, str(row.verification_token));
  return {
    id: str(row.id),
    domain,
    status: str(row.status),
    sslStatus: str(row.ssl_status),
    txtHost: challenge.host,
    txtValue: challenge.value,
    verifiedAt: row.verified_at ? iso(row.verified_at) : null,
  };
}

function colorOf(value: unknown, field: string): string {
  if (value === undefined || value === null || value === '') return '';
  const text = String(value).trim();
  if (!HEX_COLOR.test(text)) {
    throw new DomainError(errorCodes.VALIDATION_FAILED, 'اللون يجب أن يكون #RRGGBB', 422, { field });
  }
  return text.toLowerCase();
}

function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = String(value);
  if (!UUID.test(text)) {
    throw new DomainError(errorCodes.VALIDATION_FAILED, 'معرّف الشعار غير صالح', 422, { field: 'logoFileId' });
  }
  return text;
}

function decimalText(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!/^\d{1,8}(\.\d{1,4})?$/.test(text)) {
    throw new DomainError(errorCodes.VALIDATION_FAILED, 'السعر الشهري رقم عشري', 422, { field: 'monthlyPrice' });
  }
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(4, '0')}`;
}

function moneyText(value: unknown): string {
  const text = str(value);
  if (!text) return '0.0000';
  const [whole, fraction = ''] = text.split('.');
  return `${whole}.${fraction.padEnd(4, '0').slice(0, 4)}`;
}

function flag(value: unknown): boolean {
  return value === true || value === 't' || value === 'true' || value === 1;
}

function str(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const date = new Date(String(value).replace(' ', 'T'));
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function rows(result: unknown): Array<Record<string, unknown>> {
  return Array.isArray(result)
    ? (result as Array<Record<string, unknown>>)
    : ((result as { rows?: Array<Record<string, unknown>> }).rows ?? []);
}

function first(result: unknown): Record<string, unknown> | undefined {
  return rows(result)[0];
}
