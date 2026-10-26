-- 0155_arabic_warehouse_and_makkah_timezone.sql
-- 1) Ensure default warehouses provisioned earlier with English 'Main branch' / 'Main warehouse'
--    use the canonical Arabic label 'المستودع الرئيسي'.
UPDATE warehouses
   SET name = 'المستودع الرئيسي'
 WHERE is_default = true
   AND lower(trim(name)) IN ('main branch', 'main warehouse');

-- 2) Standardize tenant timezone & tenant_settings defaults to Makkah time ('Asia/Riyadh').
ALTER TABLE tenants ALTER COLUMN timezone SET DEFAULT 'Asia/Riyadh';

UPDATE tenants
   SET timezone = 'Asia/Riyadh'
 WHERE upper(trim(timezone)) = 'UTC' OR trim(timezone) = '';

UPDATE tenant_settings
   SET value = '"Asia/Riyadh"'::jsonb
 WHERE key IN ('timezone', 'locale.timezone')
   AND value = '"UTC"'::jsonb;
