-- 0154_tax_groups_and_tenant_provisioning_backfill.down.sql
-- Data-only idempotent starter backfill; safe no-op on rollback aside from removing default platform.self_signup if untouched.
DELETE FROM platform_settings
 WHERE tenant_id IS NULL
   AND key = 'platform.self_signup'
   AND updated_by IS NULL;
