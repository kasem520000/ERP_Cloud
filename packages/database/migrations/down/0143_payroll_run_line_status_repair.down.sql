-- Restore the statuses exactly as they were before 0143 (from the repair log), then drop the log.
UPDATE payroll_run_lines l
SET status = x.old_status
FROM payroll_run_line_status_repair_0143 x
WHERE x.run_id = l.run_id AND x.line_no = l.line_no;

DROP TABLE IF EXISTS payroll_run_line_status_repair_0143;
