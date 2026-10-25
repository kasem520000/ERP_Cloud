ALTER TABLE email_settings DROP COLUMN IF EXISTS dkim_selector;
ALTER TABLE email_settings DROP COLUMN IF EXISTS dkim_public_key;
ALTER TABLE email_settings DROP COLUMN IF EXISTS spf_record;
ALTER TABLE email_settings DROP COLUMN IF EXISTS per_recipient_rate_limit;
