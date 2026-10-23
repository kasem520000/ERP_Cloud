-- ACC-183 (R33): an individual salary payment flagged *every* payroll-run line of the employee as `paid`
-- (reversed runs, drafts, other months). The service is fixed to touch only the employee's line in a
-- live run of the same month; this repairs the rows already flipped. Every change is logged first so
-- it can be inspected and undone (see down/0143_*.sql).
CREATE TABLE IF NOT EXISTS payroll_run_line_status_repair_0143 (
  run_id uuid NOT NULL,
  line_no int NOT NULL,
  tenant_id uuid NOT NULL,
  employee_id uuid,
  old_status text NOT NULL,
  new_status text NOT NULL,
  repaired_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, line_no)
);

-- 1) lines of reversed runs are reversed, whatever a later إذن wrote on them
INSERT INTO payroll_run_line_status_repair_0143 (run_id, line_no, tenant_id, employee_id, old_status, new_status)
SELECT l.run_id, l.line_no, l.tenant_id, l.employee_id, l.status, 'reversed'
FROM payroll_run_lines l
JOIN payroll_runs r ON r.id = l.run_id
WHERE r.status = 'reversed' AND l.status <> 'reversed'
ON CONFLICT (run_id, line_no) DO NOTHING;

UPDATE payroll_run_lines l
SET status = 'reversed'
FROM payroll_runs r
WHERE r.id = l.run_id AND r.status = 'reversed' AND l.status <> 'reversed';

-- 2) a `paid` line in a **posted** run is legitimate only if that employee has an individual payment
--    for the run's own month; otherwise it was flipped by the bug and goes back to `posted`.
INSERT INTO payroll_run_line_status_repair_0143 (run_id, line_no, tenant_id, employee_id, old_status, new_status)
SELECT l.run_id, l.line_no, l.tenant_id, l.employee_id, l.status, 'posted'
FROM payroll_run_lines l
JOIN payroll_runs r ON r.id = l.run_id
WHERE r.status = 'posted' AND l.status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM salary_payments s
    WHERE s.tenant_id = l.tenant_id AND s.employee_id = l.employee_id
      AND s.year_month = r.year_month AND s.deleted_at IS NULL
  )
ON CONFLICT (run_id, line_no) DO NOTHING;

UPDATE payroll_run_lines l
SET status = 'posted'
FROM payroll_runs r
WHERE r.id = l.run_id AND r.status = 'posted' AND l.status = 'paid'
  AND NOT EXISTS (
    SELECT 1 FROM salary_payments s
    WHERE s.tenant_id = l.tenant_id AND s.employee_id = l.employee_id
      AND s.year_month = r.year_month AND s.deleted_at IS NULL
  );

-- 3) a line of a **draft** run carries no payment state at all (posting rewrites every line to `posted`
--    and the pay step re-derives who was already paid from salary_payments) — back to `draft`.
INSERT INTO payroll_run_line_status_repair_0143 (run_id, line_no, tenant_id, employee_id, old_status, new_status)
SELECT l.run_id, l.line_no, l.tenant_id, l.employee_id, l.status, 'draft'
FROM payroll_run_lines l
JOIN payroll_runs r ON r.id = l.run_id
WHERE r.status = 'draft' AND l.status <> 'draft'
ON CONFLICT (run_id, line_no) DO NOTHING;

UPDATE payroll_run_lines l
SET status = 'draft'
FROM payroll_runs r
WHERE r.id = l.run_id AND r.status = 'draft' AND l.status <> 'draft';
