-- MF-17 / دفقة D9 — إدارة التحصيل: قواعد تذكير + سجل أحداث + مخصصات + شطوبات.
-- الأنظمة الأساسية للفواتير بقيت كما هي؛ هذه الجداول توثّق الدورة فقط:
-- فاتورة متأخرة → تذكير (مسجَّل دائماً) → مخصص → شطب (قيد AR بالطرف) → استرداد لاحق.
CREATE TABLE ar_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  min_days integer NOT NULL CHECK (min_days >= 0),
  max_days integer CHECK (max_days IS NULL OR max_days >= min_days),
  channel text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp', 'email', 'log_only')),
  cooldown_days integer NOT NULL DEFAULT 7 CHECK (cooldown_days >= 0),
  message_template text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ar_reminders_tenant_min_days_key UNIQUE (tenant_id, min_days)
);

CREATE TABLE ar_reminder_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  invoice_id uuid,
  band_days integer,
  channel text NOT NULL,
  message text NOT NULL,
  dispatch_status text NOT NULL,
  dispatched_at timestamptz NOT NULL DEFAULT now(),
  error text,
  created_by uuid
);

CREATE INDEX ar_reminder_events_party_idx ON ar_reminder_events (tenant_id, party_id);
CREATE INDEX ar_reminder_events_time_idx ON ar_reminder_events (tenant_id, dispatched_at);

CREATE TABLE ar_provisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  invoice_id uuid,
  basis_amount numeric(20, 4) NOT NULL,
  percent numeric(9, 4) NOT NULL CHECK (percent > 0 AND percent <= 100),
  amount numeric(20, 4) NOT NULL,
  expense_account_id uuid NOT NULL REFERENCES accounts(id),
  allowance_account_id uuid NOT NULL REFERENCES accounts(id),
  journal_entry_id uuid REFERENCES journal_entries(id),
  entry_date date NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ar_provisions_party_idx ON ar_provisions (tenant_id, party_id);
CREATE INDEX ar_provisions_date_idx ON ar_provisions (tenant_id, entry_date);

CREATE TABLE ar_writeoffs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  party_id uuid NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL,
  amount numeric(20, 4) NOT NULL CHECK (amount > 0),
  loss_account_id uuid NOT NULL REFERENCES accounts(id),
  allowance_account_id uuid REFERENCES accounts(id),
  allowance_used numeric(20, 4) NOT NULL DEFAULT 0,
  loss_used numeric(20, 4) NOT NULL DEFAULT 0,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  journal_entry_id uuid REFERENCES journal_entries(id),
  approved_by uuid,
  approved_at timestamptz,
  recovered_amount numeric(20, 4) NOT NULL DEFAULT 0,
  entry_date date NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ar_writeoffs_party_idx ON ar_writeoffs (tenant_id, party_id);
CREATE INDEX ar_writeoffs_status_idx ON ar_writeoffs (tenant_id, status);
CREATE INDEX ar_writeoffs_date_idx ON ar_writeoffs (tenant_id, entry_date);
