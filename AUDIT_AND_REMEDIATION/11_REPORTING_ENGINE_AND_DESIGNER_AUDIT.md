# 11 — Reporting Engine and Designer Audit

**Audit date:** 2026-10-30  
**Scope:** Reporting architecture, report designer, print templates, export security

## Reporting Architecture

### Current Implementation

The reporting system consists of:

| Component | File | Purpose |
|-----------|------|---------|
| Reporting controller | `apps/api/src/modules/reporting/reporting.controller.ts` | Report catalog, layouts, print settings, printable templates |
| Reporting service | `apps/api/src/modules/reporting/reporting.service.ts` | Report generation, export |
| Report layouts service | `apps/api/src/modules/reporting/report-layouts.service.ts` | Report layout definitions |
| Print templates service | `apps/api/src/modules/reporting/print-templates.service.ts` | Printable document templates |
| Print settings service | `apps/api/src/modules/reporting/print-settings.service.ts` | Print settings per scope |
| Printer links service | `apps/api/src/modules/reporting/printer-links.service.ts` | Printer-report mapping |

### Report Output Format

Printable documents return `{ html }` — complete, self-contained HTML pages designed for browser iframe display and direct printing. Supported paper sizes: A4, 80mm.

### Report Security

| Control | Implementation | Status |
|---------|---------------|--------|
| Authentication | All routes require valid JWT | VERIFIED |
| Authorization | `@RequiresPermission('reporting.view')` / `('reporting.layout.manage')` | VERIFIED |
| Tenant isolation | `getTenantContext().tenantId` on all queries | VERIFIED |
| No public routes | No `@Public()` on reporting endpoints | VERIFIED |
| No sensitive data in URLs | Report ID is UUID, no sensitive params | VERIFIED |

### Report Designer

The report designer (`/settings/report-designer` in staff app) allows configuration of:
- Company logo, information, tax number
- Header, footer, colors, fonts
- Page size, margins, orientation
- Table styles, column visibility
- Number formats, Arabic/English layout
- Invoice template, document title
- Signature areas

### Print Settings Propagation

Print settings are scoped (`print_settings` table with `scope` column) and applied per report scope (e.g., `report:invoice`, `report:purchase_invoice`).

## Known Limitations

1. **HTML output, not PDF:** Reports return HTML for browser printing. No server-side PDF generation found in inspected code. PDF generation would require a library (e.g., puppeteer, wkhtmltopdf, pdfkit).
2. **Central designer not verified:** The report designer settings are stored but full propagation to all report types was not verified end-to-end.
3. **No Excel/CSV export:** Not found in inspected reporting code — may exist in other modules.
4. **No Arabic/RTL verification:** RTL layout support not verified in generated reports.

## Remaining Work

- Evaluate server-side PDF generation (puppeteer/pdfkit)
- Verify report designer settings propagate to all report types
- Add Excel/CSV export where appropriate
- Test Arabic/RTL report rendering
- Secure temporary file cleanup (if files are generated)
