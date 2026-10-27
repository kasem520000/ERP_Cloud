-- 0157_print_design_config.down.sql

ALTER TABLE print_settings DROP CONSTRAINT IF EXISTS print_settings_design_config_object_check;

ALTER TABLE print_settings
  DROP COLUMN IF EXISTS design_config;
