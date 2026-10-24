-- MF-21 / دفقة D8 — سجل الأصول الثابتة: فئات + أصول + تشغيلات إهلاك + استبعادات.
-- قاعدة الأمان: تشغيل واحد لكل فترة (فهرس فريد) ⇐ «لا تشغيل إهلاك مزدوج»،
-- وأصل واحد لكل مصدر (فهرس جزئي) ⇐ «لا رسملة مزدوجة من نفس الفاتورة».
CREATE TABLE asset_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code text NOT NULL,
  name_ar text NOT NULL,
  name_en text,
  method text NOT NULL CHECK (method IN ('straight_line', 'declining', 'units_of_production')),
  useful_life_months integer NOT NULL CHECK (useful_life_months > 0),
  residual_value numeric(20, 4) NOT NULL DEFAULT 0,
  declining_rate_percent numeric(9, 4) NOT NULL DEFAULT 0,
  total_units numeric(20, 4),
  asset_account_id uuid NOT NULL REFERENCES accounts(id),
  accumulated_depreciation_account_id uuid NOT NULL REFERENCES accounts(id),
  depreciation_expense_account_id uuid NOT NULL REFERENCES accounts(id),
  status text NOT NULL DEFAULT 'active',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_categories_tenant_code_key UNIQUE (tenant_id, code)
);

CREATE TABLE fixed_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  category_id uuid NOT NULL REFERENCES asset_categories(id),
  code text NOT NULL,
  name text NOT NULL,
  cost numeric(20, 4) NOT NULL CHECK (cost > 0),
  residual_value numeric(20, 4) NOT NULL DEFAULT 0,
  method text NOT NULL CHECK (method IN ('straight_line', 'declining', 'units_of_production')),
  useful_life_months integer NOT NULL CHECK (useful_life_months > 0),
  declining_rate_percent numeric(9, 4) NOT NULL DEFAULT 0,
  total_units numeric(20, 4),
  in_service_date date NOT NULL,
  cost_center_id uuid REFERENCES cost_centers(id),
  custodian_id uuid REFERENCES employees(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disposed')),
  disposal_date date,
  source_type text,
  source_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fixed_assets_tenant_code_key UNIQUE (tenant_id, code)
);

CREATE UNIQUE INDEX fixed_assets_tenant_source_key
  ON fixed_assets (tenant_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX fixed_assets_scope_idx ON fixed_assets (tenant_id, status);

CREATE TABLE asset_depreciation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  period date NOT NULL,
  status text NOT NULL DEFAULT 'preview' CHECK (status IN ('preview', 'posted')),
  total_amount numeric(20, 4) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES journal_entries(id),
  posted_at timestamptz,
  posted_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT asset_depreciation_runs_tenant_period_key UNIQUE (tenant_id, period)
);

CREATE INDEX asset_depreciation_runs_scope_idx ON asset_depreciation_runs (tenant_id, status);

CREATE TABLE asset_depreciation_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES asset_depreciation_runs(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES fixed_assets(id),
  amount numeric(20, 4) NOT NULL,
  accumulated_after numeric(20, 4) NOT NULL,
  book_value_after numeric(20, 4) NOT NULL,
  CONSTRAINT asset_depreciation_lines_run_asset_key UNIQUE (run_id, asset_id)
);

CREATE INDEX asset_depreciation_lines_asset_idx ON asset_depreciation_lines (asset_id);

CREATE TABLE asset_disposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  asset_id uuid NOT NULL REFERENCES fixed_assets(id),
  date date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('sale', 'scrap')),
  cost_disposed numeric(20, 4) NOT NULL CHECK (cost_disposed > 0),
  accumulated_removed numeric(20, 4) NOT NULL,
  proceeds numeric(20, 4) NOT NULL DEFAULT 0,
  gain_loss numeric(20, 4) NOT NULL,
  gain_account_id uuid NOT NULL REFERENCES accounts(id),
  loss_account_id uuid NOT NULL REFERENCES accounts(id),
  proceeds_account_id uuid REFERENCES accounts(id),
  cash_location_id uuid REFERENCES cash_locations(id),
  voucher_id uuid REFERENCES vouchers(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX asset_disposals_scope_idx ON asset_disposals (tenant_id, asset_id);
