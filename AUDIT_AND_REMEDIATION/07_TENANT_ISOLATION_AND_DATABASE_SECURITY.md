# 07 — Tenant Isolation and Database Security

**Audit date:** 2026-10-30  
**Scope:** Multi-tenancy architecture, RLS, tenant context propagation, database security

## Overall Assessment

The platform uses PostgreSQL Row-Level Security (RLS) with a transaction-local GUC (`app.tenant_id`) for tenant isolation. This is a robust, database-enforced mechanism — not merely application-level filtering.

## 7.1 RLS Architecture

### Tenant Context Propagation

| Component | File | Mechanism |
|-----------|------|-----------|
| GUC name | `packages/database/src/rls.ts` | `app.tenant_id` |
| Set context | `packages/database/src/client.ts:104` | `withTenantTx(tx, tenantId)` → `set_config('app.tenant_id', ..., true)` |
| Platform admin | `packages/database/src/client.ts:123` | `withPlatformAdminTx()` → `app.is_platform_admin = 'on'` |
| Clear context | `packages/database/src/rls.ts` | `clearTenantContext()` (is_local = true, auto-clears at COMMIT/ROLLBACK) |
| Read context | `packages/database/src/rls.ts` | `readTenantContext()` (isolation harness probe) |

### RLS Policy Template

```sql
CREATE POLICY tenant_isolation ON <table>
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
```

- `nullif(..., '')` → unset GUC yields SQL NULL → matches zero rows (safe failure)
- `FORCE ROW LEVEL SECURITY` — table owner also subject to RLS
- Policy is `DROP POLICY IF EXISTS` + `CREATE` — idempotent on re-apply

### Audit Log Exception

`audit_log` uses a different policy:
```sql
USING (tenant_id = <guc>)
WITH CHECK (tenant_id IS NOT DISTINCT FROM <guc>)
```
- Reads: strictly tenant-scoped
- Writes: accept NULL-tenant rows (platform events before tenant context exists)
- Platform rows are write-only for the API role — cannot be read back through a tenant session

## 7.2 RLS-Covered Tables (75+ tables)

The `rlsProtectedTables` list in `packages/database/src/rls.ts` includes:
- Tenancy: memberships, roles, role_permissions, membership_roles, tenant_settings, membership_role_scopes
- Platform services: audit_log, files, notifications, outbox_jobs, idempotency_keys
- Organization: company_profiles, branches, warehouses, cash_locations, currencies, fx_rates, price_lists, price_list_items, branch_posting_profiles
- Financial: journal entries, accounts, parties, sales, purchases, inventory, treasury, banking, pos, van-sales
- Plus custom fields, approvals, OCR, AI, CRM, dashboards, marketplace, and more

## 7.3 Platform Tables (No RLS)

| Table | Reason |
|-------|--------|
| tenants | Platform identity — no tenant_id (contract §6) |
| users | Platform users — no tenant_id |
| permissions | Permission catalog — no tenant_id |
| refresh_tokens | Capability-based (SHA-256 hash), tenant_id nullable for audit only |
| mfa_recovery codes | Pre-authentication — no tenant context yet |
| platform_roles/memberships | Platform operator roles — no tenant_id |
| platform_settings | Nullable tenant_id — NULL = platform-wide |

## 7.4 Database Roles and Privileges

- `REVOKE UPDATE, DELETE, TRUNCATE ON audit_log FROM erp_api` — append-only at privilege level
- `gen_random_uuid()` is NOT used for primary keys — UUID v7 generated application-side
- `citext` for case-insensitive email uniqueness
- `bytea` for encrypted-at-rest columns (MFA secrets)

## 7.5 Verification Status

| Check | Status | Evidence |
|-------|--------|----------|
| RLS enabled on tenant tables | VERIFIED | `rlsProtectedTables` + migration SQL |
| GUC set transaction-locally | VERIFIED | `withTenantTx()` uses `is_local = true` |
| Platform admin separation | VERIFIED | Separate `withPlatformAdminTx()` |
| No connection pool leakage | VERIFIED | `is_local = true` clears at COMMIT/ROLLBACK |
| Cross-tenant access test | NOT EXECUTED | Requires two independent test tenants |

## Known Issues

None found in RLS implementation. Cross-tenant access testing with two independent tenants was not performed in this session (requires full test database setup).

## Remaining Work

- Execute cross-tenant API test (tenant A credentials → tenant B data)
- Verify all tenant-scoped tables have RLS (migration-level audit)
- Test RLS with `FORCE` on table owner
- Verify background job tenant context (BullMQ workers)
- Verify WebSocket tenant isolation
