-- MF-18 / دفقة D11 — دورة الإقرار الضريبي: تقديم يجمّد أرقام التقرير ويقيّد صافي
-- الضريبة (2222001 ← ذمة/أصل) ويقفل الفترة الضريبية. AC1: اللقطة لا تتغيّر بعد التقديم؛
-- AC3: `net_vat` يطابق رصيد 2222001 لحظة التقديم. unique يمنع تقديم النطاق نفسه مرتين؛
-- التداخل بين نطاقين (شهر داخل ربع) يُمنع على مستوى التطبيق (409 VAT_FILING_ALREADY_FILED).
CREATE TABLE vat_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_from date NOT NULL,
  period_to date NOT NULL,
  snapshot jsonb NOT NULL,
  net_vat numeric(18, 4) NOT NULL,
  output_vat numeric(18, 4) NOT NULL DEFAULT 0,
  input_vat numeric(18, 4) NOT NULL DEFAULT 0,
  journal_entry_id uuid REFERENCES journal_entries(id),
  settlement_account_id uuid REFERENCES accounts(id),
  filed_at timestamptz NOT NULL DEFAULT now(),
  filed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vat_filings_period_check CHECK (period_from <= period_to),
  CONSTRAINT vat_filings_scope_key UNIQUE (tenant_id, period_from, period_to)
);

CREATE INDEX vat_filings_tenant_period_idx ON vat_filings (tenant_id, period_from, period_to);
