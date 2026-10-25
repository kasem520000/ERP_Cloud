-- MF-28 / دفقة D12 — دورة العملات الكاملة:
--   • `sales_invoices.fx_rate` — سعر فاتورة أجنبية لحظة تسعيرها (الأساس = مبلغ × السعر)؛
--     NULL = فاتورة بالعملة الأساسية (السلوك القائم حرفياً).
--   • `fx_revaluation_runs` — تشغيل إعادة تقييم نهاية الفترة: قيد غير محقَّق + عكسه الآلي
--     (رُبطا معاً)؛ فريد (مستأجر، يوم) يمنع تكرار التشغيل لنفس اليوم (409 التطبيق).
ALTER TABLE sales_invoices ADD COLUMN IF NOT EXISTS fx_rate numeric(20, 10);

CREATE TABLE fx_revaluation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  run_date date NOT NULL,
  journal_entry_id uuid REFERENCES journal_entries(id),
  reversal_entry_id uuid REFERENCES journal_entries(id),
  status text NOT NULL DEFAULT 'posted' CHECK (status IN ('posted', 'reversed')),
  gain_loss numeric(20, 4) NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fx_revaluation_runs_tenant_date_key UNIQUE (tenant_id, run_date)
);

CREATE INDEX IF NOT EXISTS fx_revaluation_runs_tenant_date_idx
  ON fx_revaluation_runs (tenant_id, run_date DESC);
