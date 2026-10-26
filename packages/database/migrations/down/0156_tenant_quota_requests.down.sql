-- 0156_tenant_quota_requests.down.sql
DROP POLICY IF EXISTS platform_admin_plane ON tenant_quota_requests;
DROP POLICY IF EXISTS tenant_isolation ON tenant_quota_requests;
DROP TABLE IF EXISTS tenant_quota_requests;
