-- MF-22 / دفقة D7 — المصروفات المقدّمة والمستحقة وجداول الإطفاء (amortization schedules).
-- كل صف = قسط محسوب؛ التوليد لاحقاً ينشئ قيداً بمفتاح idempotency فريد لكل (جدول، فترة)
-- عبر `postJournal` ⇐ حرّاسة إضافية في `journal_entries_idempotency_key` ضد التوليد المزدوج.
CREATE TABLE amortization_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('prepaid', 'accrual')),
  source_type text NOT NULL CHECK (source_type IN ('voucher', 'purchase_invoice', 'manual')),
  source_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  expense_account_id uuid NOT NULL REFERENCES accounts(id),
  deferral_account_id uuid NOT NULL REFERENCES accounts(id),
  total_amount numeric(20, 4) NOT NULL CHECK (total_amount > 0),
  installment_amount numeric(20, 4) NOT NULL CHECK (installment_amount > 0),
  months integer NOT NULL CHECK (months > 0),
  start_date date NOT NULL,
  generated_count integer NOT NULL DEFAULT 0 CHECK (generated_count >= 0),
  last_generated_period date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT amortization_schedules_count_le_months CHECK (generated_count <= months)
);

CREATE UNIQUE INDEX amortization_schedules_source_uniq
  ON amortization_schedules (tenant_id, source_type, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX amortization_schedules_scope_idx
  ON amortization_schedules (tenant_id, status);
