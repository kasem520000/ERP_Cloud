-- 0156_tenant_quota_requests.sql — طلبات المنشآت لاعتماد رفع الحصص وتفعيل الوحدات وترقية الباقات.
--
-- حين تبلغ منشأةٌ سقف حصّتها في الباقة (`USAGE_LIMIT_REACHED`) أو تطلب تفعيل ميزة/ترقية باقة،
-- تُقدِّم طلباً موثّقاً إلى إدارة المنصة، ويراجعه مشغّل المنصة لاعتماده (مع تطبيق الحدّ الجديد
-- أو الباقة تلقائياً داخل المعاملة نفسها) أو رفضه مع إشعار المنشأة بالقرار.

CREATE TABLE IF NOT EXISTS tenant_quota_requests (
  id                uuid PRIMARY KEY,
  tenant_id         uuid NOT NULL REFERENCES tenants (id) ON DELETE CASCADE,
  requested_by      uuid REFERENCES users (id) ON DELETE SET NULL,
  request_type      text NOT NULL DEFAULT 'quota_increase',
  metric_key        text,
  module_key        text,
  current_limit     integer,
  requested_limit   integer,
  requested_plan_id uuid REFERENCES billing_plans (id) ON DELETE SET NULL,
  reason            text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'pending',
  reviewed_by       uuid REFERENCES users (id) ON DELETE SET NULL,
  reviewed_at       timestamptz,
  approved_limit    integer,
  decision_notes    text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_quota_requests_type_check
    CHECK (request_type IN ('quota_increase', 'plan_upgrade', 'module_enable')),
  CONSTRAINT tenant_quota_requests_status_check
    CHECK (status IN ('pending', 'approved', 'rejected')),
  CONSTRAINT tenant_quota_requests_requested_limit_check
    CHECK (requested_limit IS NULL OR requested_limit >= 0),
  CONSTRAINT tenant_quota_requests_approved_limit_check
    CHECK (approved_limit IS NULL OR approved_limit >= 0)
);

CREATE INDEX IF NOT EXISTS tenant_quota_requests_tenant_idx
  ON tenant_quota_requests (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tenant_quota_requests_status_idx
  ON tenant_quota_requests (status, created_at ASC);

ALTER TABLE tenant_quota_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_quota_requests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tenant_quota_requests;
CREATE POLICY tenant_isolation ON tenant_quota_requests
  USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);

DROP POLICY IF EXISTS platform_admin_plane ON tenant_quota_requests;
CREATE POLICY platform_admin_plane ON tenant_quota_requests
  USING (COALESCE(current_setting('app.is_platform_admin', true), 'off') = 'on')
  WITH CHECK (COALESCE(current_setting('app.is_platform_admin', true), 'off') = 'on');

GRANT SELECT, INSERT, UPDATE ON tenant_quota_requests TO erp_api;
GRANT ALL PRIVILEGES ON tenant_quota_requests TO erp_migrator;
