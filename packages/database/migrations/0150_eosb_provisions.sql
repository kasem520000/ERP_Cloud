-- MF-42 / دفقة D10 — دورة مخصص نهاية الخدمة (§6.8 مُفكّ — قرار مالك «سياسة المخصصات»).
-- سياسة قابلة للتهيئة لكل مستأجر (المعدّلان افتراضيان 0.5 ثم 1 شهر/سنة) + سطور مرحّلة
-- لكل موظف/فترة؛ القيد يحمل المجموع ⇐ تقرير التفصيل = رصيد الحساب بالبناء (AC3).
CREATE TABLE eosb_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  months_per_year_first numeric(9, 4) NOT NULL DEFAULT 0.5 CHECK (months_per_year_first > 0),
  months_per_year_after numeric(9, 4) NOT NULL DEFAULT 1 CHECK (months_per_year_after > 0),
  enabled boolean NOT NULL DEFAULT true,
  expense_account_id uuid REFERENCES accounts(id),
  liability_account_id uuid REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE eosb_accruals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period text NOT NULL,
  employee_id uuid NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  service_years numeric(9, 4) NOT NULL,
  basis_amount numeric(20, 4) NOT NULL,
  cumulative_entitlement numeric(20, 4) NOT NULL,
  prior_accrued numeric(20, 4) NOT NULL,
  delta numeric(20, 4) NOT NULL,
  journal_entry_id uuid REFERENCES journal_entries(id),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT eosb_accruals_tenant_period_employee_key UNIQUE (tenant_id, period, employee_id)
);

CREATE INDEX eosb_accruals_scope_idx ON eosb_accruals (tenant_id, period, status);
CREATE INDEX eosb_accruals_employee_idx ON eosb_accruals (tenant_id, employee_id);
