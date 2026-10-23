-- ACC-100: قيد تفرد رقم القيد المحاسبي على مستوى المستأجر
CREATE UNIQUE INDEX IF NOT EXISTS journal_entries_tenant_number_key
  ON journal_entries (tenant_id, number)
  WHERE number IS NOT NULL;
