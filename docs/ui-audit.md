# UI audit — ERP Cloud “Executive Finance” v4

**Date:** 2026-10-18 · **Branch:** `arena/87daa84c-erp-cloud` · **Commit:** branch tip, pushed (see `git log -1`) on top of `084fafd` — batch 2: content, typography, portal grid, RTL tables, hydration, labels
**Method:** every opened screen was rendered in Chromium (Playwright/Puppeteer) against the local API + seeded PostgreSQL demo tenant. Nothing below is inferred from JSX alone. No mock data was injected into the apps, and no posting, cancellation, payment or deletion was executed.

Legend — **Opened:** `yes` rendered with data · `no` no fixture · `login` auth screen only.
**Depth:** `M` = manual inspection + interaction probes · `S` = full-page screenshot + automated audit (HTTP, `dir`, h1, horizontal overflow, table overflow, tiny text, tap targets, console and failed requests). `Ov` = document horizontal overflow in px.

---

## 1. Headline: why the previous “design pass” barely showed

Seven root causes, all measured in the browser:

1. **The marketing app had no PostCSS config.** `apps/marketing/postcss.config.mjs` did not exist while `globals.css` imported Tailwind and `@erp/ui/tokens.css`. The browser received a literal `@theme{…}` block, ignored it, and every `--color-*` primitive was empty at runtime. `--grad` therefore resolved to the guaranteed-invalid value: primary CTAs rendered **white text on a transparent background** and the wordmark was **transparent** (background-clip:text with no background). The page looked “washed out” because its actions were literally invisible.
2. **Marketing was missing `@source '../../../packages/ui/src'`.** Tailwind v4 ignores `node_modules` and had not been told to scan the shared package, so DS utilities used by `@erp/ui` (`size-9`, `bg-surface`, `border-line`, focus rings…) were never generated. The theme switch rendered at **17×17 px** instead of 36×36.
3. **The customer portal consumes tokens without Tailwind.** It has no Tailwind dependency or pipeline, so `@theme` was dropped there too. Its logo, primary button and hero plate were transparent. Fixed at the source by mirroring the primitives into a plain `:root` block inside `tokens.css`.
4. **The marketing header could not fit its own navigation.** Nine links need ~1 295 px inside a 1 180 px container: the strip wrapped to a second half-empty row, or overflowed its box and painted over the wordmark. There was **no mobile menu at all** below 980 px, and the language switch generated `/en/contact`, `/en/pricing` … for Arabic-only pages → 404.
5. **The staff panel's `.grid` was unlayered.** `apps/staff/app/globals.css` declared `.grid{display:grid;gap:16px}` outside any cascade layer, so it beat every Tailwind utility in `@layer utilities`. `xl:hidden` never hid the dashboard's mobile stack: the page rendered **six widgets instead of three**, and the 12-column desktop board auto-placed into the 16rem catalogue column, squeezing the stock table to ~110 px. The same unlayered rule forced authored gaps back to 16 px on every staff page.
6. **The content store was empty (data).** `content_pages` had 0 rows: footer legal links, `/blog/[slug]`, `/help/[slug]`, `/cases/[slug]`, `/legal/[slug]` had no published record, and the home hero's variant probe hit `/public/content/home` → 404 on every visit. Fixed with an idempotent seeder (`scripts/seed-content.mjs`), not by hard-coding text into the app; every page is CMS-owned and editable in the platform console.
7. **The theme provider read `localStorage` in its state initialiser.** The server has no storage, so a returning visitor with `erp.theme=light|dark` hydrated a different tree — React error **#418 on every page** of the marketing site (24/24 routes when a choice was stored; 0 with no choice). The switch now renders the server's choice until mounted, and the stored choice is applied in a layout effect; the same shared component is used by staff, platform-admin and bakery.

Also confirmed from the earlier batch: table pagination/frame in the staff panel, the bakery blocked-document checklist, h1 gaps in marketing and bakery `/rep`, and the platform-admin role matrix.

---

## 2. Fixes applied in this batch (files)

| Area | Change | Evidence |
|---|---|---|
| `apps/marketing/postcss.config.mjs` | **New.** Enables `@tailwindcss/postcss`; `@theme` now compiles. | Before: `--grad: ''`, 3 CSS chunks, white-on-white CTAs. After: 1 chunk 93 961 B, `--grad` resolves, logo/CTA gradients render. |
| `apps/marketing/app/globals.css` | Added `@source '../../../packages/ui/src'`; header `flex:none/nowrap`, actions `> *` no-shrink; mobile panel + hamburger ≤1180 px; footer legal strip; `.table-wrap{min-width:0}`; dark wordmark ramp; `>.btn.ghost` scoping. | Theme switch 17→**36 px**; 390 px `/pricing` scrollWidth 662→**390**; header 1 row 71 px at 1440/1280; burger at 1024/390. |
| `apps/marketing/components/site/mobile-nav.tsx` | **New** client panel: all nav links + login/start, aria-expanded/controls, Escape. | 390 px panel opens; `دخول` and `ابدأ مجاناً` each 173 px wide and visible (they were `display:none`). |
| `apps/marketing/components/site/nav-more.tsx` | **New** «المزيد» disclosure for the 4 secondary links (no link removed); panel anchored with `inset-inline-start:0` so it opens inward in RTL instead of across the wordmark. | 1440: nav **628–1103 px** (5 links + المزيد), wordmark at 1125 — no overlap, header 71 px; panel 230 px with 4 links, Escape closes; 390: burger 38×38, panel 536 px, 11 links + 2 CTAs (173 px each). |
| `apps/marketing/components/site/shell.tsx` | Nav items split primary/more; legal nav class; mobile nav mount. | Header screenshot `mk-header3.png`. |
| `apps/marketing/components/site/locale-switch.tsx` | Uses `hasEnglishTwin()`; falls back to the other locale’s home instead of a 404 route. | `/contact` → `/en`, not `/en/contact`. |
| `packages/ui/src/tokens/tokens.css` | Plain `:root` runtime mirror of the 141 `@theme` primitives (commented) for CSS-only surfaces. | Portal `--color-brand-600` now `#0b7a63`; logo + primary button render. |
| `apps/customer-portal/components/portal-header-actions.tsx` | **New** client island: hides «دخول» when a portal session exists. | Header no longer offers login to a signed-in customer. |
| `apps/customer-portal/app/layout.tsx` | Uses that island. | — |
| `apps/bakery/app/sales/page.tsx` | (earlier) one danger checklist card with count badge instead of four red boxes. | Card 1086×114, title + 3 bullets, verified by element clip. |
| `apps/staff/app/globals.css` | `.grid` / `.grid.cols` moved into `@layer components`; duplicate `.grid` removed. | `xl:hidden` now computes `display:none` at 1440; dashboard shows one set of widgets; s7 staff sweep: 0 page overflow, 0 table overflow. |
| `apps/staff/app/dashboards/[id]/page.tsx` | Both widget layouts wrapped in one content-column div. | 12-col board 832 px in the content column; mobile stack hidden ≥1280; duplicate cards gone. |
| `apps/staff/components/ui/table.tsx` | (earlier) page-scoped select-all, `pageSize`, sticky pager outside the scroll frame. | `/sales/invoices`: 20 rows, «2 / 4» after التالي, pager visible without scrolling. |
| `apps/staff/app/sales/invoices/page.tsx` | `pageSize={20}`. | 68 invoices → 4 pages. |
| `scripts/seed-content.mjs` | **New**, idempotent platform-content seeder (legal ×3, post, help, case study, changelog, `home`; AR + EN). Runs through the real API as the platform admin; second run reports `0 created · 0 updated · 0 published · 8 unchanged`. | `content_pages` 0→8 published; `/legal/terms` 200; `/api/v1/public/content/home` 200 (was 404 on every marketing page load). |
| `apps/marketing/app/globals.css` | CMS blocks: 74ch measure, restored list markers (preflight had removed them), quote rule/typography, prose rhythm. | `/legal/terms` and `/blog/cloud-erp-launch` render h3, bullets and a bordered quote; `legal-fixed.png`, `content-blog.png`. |
| `apps/marketing/lib/site.ts` | `hrefFor()` keeps a non-bilingual path Arabic on EN pages instead of minting `/en/contact`… | `/en` CTAs now point to `/contact`, `/pricing`, `/demo`, `/verify` (all 200); `/en/pricing` is not advertised. |
| `packages/ui/src/theme/theme-provider.tsx` | Initial state is `defaultChoice`; stored choice + OS preference read in an isomorphic layout effect. | Hydration probe with `erp.theme=light\|dark`: React #418 **24 routes → 0**. |
| `packages/ui/src/theme/theme-toggle.tsx` | Switch renders the server choice until `mounted`, then the stored one. | Same probe; toggle still cycles system → light → dark. |
| `apps/staff/app/globals.css`, `apps/bakery/app/globals.css`, 68 TSX files | Typography floor: `text-[11px]`→`text-xs` (staff 19 · bakery 19 · PA 30), 14 staff rule blocks 10/11→11/12 px, bakery brand/nav labels up. | Staff `/` tiny nodes **14 → 13** (sweep s8); bakery `/treasury` **34 → 18** (all remaining ones 11–12 px). |
| `apps/customer-portal/app/globals.css` | `.grid.kpis` (4 / 2×2 / 1 column), `th` 10.5→12 px, `.table-wrap` + `min-width:max-content`. | KPI row **4×202 px** at 1440 (was 3+1); 390 px document overflow **24→0**. |
| `apps/customer-portal/app/portal/*.tsx` | All 9 invoice/statement tables wrapped in `.table-wrap`. | 390 px `scrollWidth = innerWidth = 390`; table scrolls inside its card. |
| `apps/staff/app/purchases/page.tsx` | **New** server redirect `/purchases` → `/purchases/invoices`. | Bare module URL returns 200 instead of 404. |
| 111 TSX files (staff, bakery, marketing) | Restored the desktop source labels that the typography pass had stripped (emoji + spacing) — 1 591 label lines re-inserted from `HEAD`, including `🔢 الرقم`, `📝 الاسم`, `💾 حفظ`, `🗂️ المجموعة`, `🖨️ طباعة`. No layout or handler changed. | `project-definitions.spec.ts` **10/10**; labels match `frm*.xaml` again; 763 glyphs remain inside rewritten copy (see §6.2). |
| `apps/platform-admin/components/ui/table.tsx` + 26 pages | كل جداول القراءة في اللوحة على المكوّن المشترك؛ أُضيف إليه ما تحتاجه الشاشات فعلاً: `cellStyle` (خريطة الأفواج الحرارية)، `expandedKey`/`renderExpanded` (فرق التدقيق بصفٍّ ينفتح)، `hideOnPrint`. بقي `<table>` في شبكتَي تحكّم فقط (محرّر الحقوق ومحرّر القائمة). | 34 مساراً على 1440 وعلى 390: 0 جدولٍ عارٍ، 0 فيض، 0 خطأ. |
| `apps/marketing/app/globals.css` | فجوات الرأس وحدها ≤480px: الشعار + أدوات الرأس كانا يفيضان ببكسلين على `/en`. | `/en` 390: `scrollWidth` 392→**390**؛ 36 مساراً على 390 وعلى 1440 بلا فيض. |
| `apps/api/src/modules/portal/portal.service.ts` | إعادة منح الوصول لعميل سُحب وصوله سابقاً تُعيد عضويته إلى `active` وتمحو حذفها الناعم — كانت تبقى معلّقة فيفشل الدخول بكلمة المرور الجديدة. | `portal.spec.ts` **14/14** بقضية انحدار (سحب ← منح ← دخول 200 ← `/portal/me` 200)؛ تحقق حيّ بالحساب الموثّق `portal@demo.test`. |


---

## 3. Screen registry (all discovered routes)


### Staff (ERP) — 200 routes

| # | Screen (route) | Page file | Opened | Depth | Ov | Notes |
|---|---|---|---|---|---|---|
| 1 | `/` | `apps/staff/app/page.tsx` | yes | S | 0 | — |
| 2 | `/accounting/accounts` | `apps/staff/app/accounting/accounts/page.tsx` | yes | S | 0 | — |
| 3 | `/accounting/accounts/tree` | `apps/staff/app/accounting/accounts/tree/page.tsx` | yes | S | 0 | — |
| 4 | `/accounting/cash-locations` | `apps/staff/app/accounting/cash-locations/page.tsx` | yes | S | 0 | — |
| 5 | `/accounting/cost-center-statement` | `apps/staff/app/accounting/cost-center-statement/page.tsx` | yes | S | 0 | — |
| 6 | `/accounting/cost-centers` | `apps/staff/app/accounting/cost-centers/page.tsx` | yes | S | 0 | — |
| 7 | `/accounting/expenses` | `apps/staff/app/accounting/expenses/page.tsx` | yes | S | 0 | — |
| 8 | `/accounting/income-statement` | `apps/staff/app/accounting/income-statement/page.tsx` | yes | S | 0 | — |
| 9 | `/accounting/journal-entries` | `apps/staff/app/accounting/journal-entries/page.tsx` | yes | S | 0 | — |
| 10 | `/accounting/journal-entries/[id]` | `apps/staff/app/accounting/journal-entries/[id]/page.tsx` | yes | S | 0 | — |
| 11 | `/accounting/journal-entries/new` | `apps/staff/app/accounting/journal-entries/new/page.tsx` | yes | S | 0 | — |
| 12 | `/accounting/ledger` | `apps/staff/app/accounting/ledger/page.tsx` | yes | S | 0 | — |
| 13 | `/accounting/payment-methods` | `apps/staff/app/accounting/payment-methods/page.tsx` | yes | S | 0 | — |
| 14 | `/accounting/periods` | `apps/staff/app/accounting/periods/page.tsx` | yes | S | 0 | — |
| 15 | `/accounting/trial-balance` | `apps/staff/app/accounting/trial-balance/page.tsx` | yes | S | 0 | — |
| 16 | `/approvals/history` | `apps/staff/app/approvals/history/page.tsx` | yes | S | 0 | — |
| 17 | `/approvals/inbox` | `apps/staff/app/approvals/inbox/page.tsx` | yes | S | 0 | — |
| 18 | `/assistant` | `apps/staff/app/assistant/page.tsx` | yes | S | 0 | — |
| 19 | `/comments/mentions` | `apps/staff/app/comments/mentions/page.tsx` | yes | S | 0 | — |
| 20 | `/crm/activities` | `apps/staff/app/crm/activities/page.tsx` | yes | S | 0 | — |
| 21 | `/crm/deals/[id]` | `apps/staff/app/crm/deals/[id]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 22 | `/crm/forecast` | `apps/staff/app/crm/forecast/page.tsx` | yes | S | 0 | — |
| 23 | `/crm/pipelines` | `apps/staff/app/crm/pipelines/page.tsx` | yes | S | 0 | — |
| 24 | `/dashboards` | `apps/staff/app/dashboards/page.tsx` | yes | S | 0 | — |
| 25 | `/dashboards/[id]` | `apps/staff/app/dashboards/[id]/page.tsx` | yes | M | 0 | Duplicate-layout bug fixed; no page/table overflow |
| 26 | `/design` | `apps/staff/app/design/page.tsx` | yes | S | 0 | — |
| 27 | `/esign/[token]` | `apps/staff/app/esign/[token]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 28 | `/hrm/adjustments` | `apps/staff/app/hrm/adjustments/page.tsx` | yes | S | 0 | — |
| 29 | `/hrm/compliance` | `apps/staff/app/hrm/compliance/page.tsx` | yes | S | 0 | — |
| 30 | `/hrm/departments` | `apps/staff/app/hrm/departments/page.tsx` | yes | S | 0 | — |
| 31 | `/hrm/employee-movements` | `apps/staff/app/hrm/employee-movements/page.tsx` | yes | S | 0 | — |
| 32 | `/hrm/employee-statement` | `apps/staff/app/hrm/employee-statement/page.tsx` | yes | S | 0 | — |
| 33 | `/hrm/employees` | `apps/staff/app/hrm/employees/page.tsx` | yes | S | 0 | — |
| 34 | `/hrm/geofences` | `apps/staff/app/hrm/geofences/page.tsx` | yes | S | 0 | — |
| 35 | `/hrm/jobs` | `apps/staff/app/hrm/jobs/page.tsx` | yes | S | 0 | — |
| 36 | `/hrm/leaves` | `apps/staff/app/hrm/leaves/page.tsx` | yes | S | 0 | — |
| 37 | `/hrm/payroll` | `apps/staff/app/hrm/payroll/page.tsx` | yes | S | 0 | — |
| 38 | `/hrm/payroll/[id]` | `apps/staff/app/hrm/payroll/[id]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 39 | `/hrm/payroll/[id]/wps` | `apps/staff/app/hrm/payroll/[id]/wps/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 40 | `/hrm/salary-payments` | `apps/staff/app/hrm/salary-payments/page.tsx` | yes | S | 0 | — |
| 41 | `/hrm/salary-report` | `apps/staff/app/hrm/salary-report/page.tsx` | yes | S | 0 | — |
| 42 | `/integrations/salla/orders` | `apps/staff/app/integrations/salla/orders/page.tsx` | yes | S | 0 | — |
| 43 | `/integrations/salla/products` | `apps/staff/app/integrations/salla/products/page.tsx` | yes | S | 0 | — |
| 44 | `/integrations/salla/settings` | `apps/staff/app/integrations/salla/settings/page.tsx` | yes | S | 0 | — |
| 45 | `/integrations/salla/warehouses` | `apps/staff/app/integrations/salla/warehouses/page.tsx` | yes | S | 0 | — |
| 46 | `/inventory/adjustments` | `apps/staff/app/inventory/adjustments/page.tsx` | yes | S | 0 | — |
| 47 | `/inventory/barcodes` | `apps/staff/app/inventory/barcodes/page.tsx` | yes | S | 0 | — |
| 48 | `/inventory/below-minimum` | `apps/staff/app/inventory/below-minimum/page.tsx` | yes | S | 0 | — |
| 49 | `/inventory/bin-balances` | `apps/staff/app/inventory/bin-balances/page.tsx` | yes | S | 0 | — |
| 50 | `/inventory/bins` | `apps/staff/app/inventory/bins/page.tsx` | yes | S | 0 | — |
| 51 | `/inventory/categories` | `apps/staff/app/inventory/categories/page.tsx` | yes | S | 0 | — |
| 52 | `/inventory/deliveries` | `apps/staff/app/inventory/deliveries/page.tsx` | yes | S | 0 | — |
| 53 | `/inventory/expiry` | `apps/staff/app/inventory/expiry/page.tsx` | yes | S | 0 | — |
| 54 | `/inventory/in-transit` | `apps/staff/app/inventory/in-transit/page.tsx` | yes | S | 0 | — |
| 55 | `/inventory/item-card` | `apps/staff/app/inventory/item-card/page.tsx` | yes | S | 0 | — |
| 56 | `/inventory/item-units` | `apps/staff/app/inventory/item-units/page.tsx` | yes | S | 0 | — |
| 57 | `/inventory/items` | `apps/staff/app/inventory/items/page.tsx` | yes | S | 0 | — |
| 58 | `/inventory/levels` | `apps/staff/app/inventory/levels/page.tsx` | yes | S | 0 | — |
| 59 | `/inventory/lots` | `apps/staff/app/inventory/lots/page.tsx` | yes | S | 0 | — |
| 60 | `/inventory/movements` | `apps/staff/app/inventory/movements/page.tsx` | yes | S | 0 | — |
| 61 | `/inventory/overview` | `apps/staff/app/inventory/overview/page.tsx` | yes | S | 0 | — |
| 62 | `/inventory/production` | `apps/staff/app/inventory/production/page.tsx` | yes | S | 0 | — |
| 63 | `/inventory/requests` | `apps/staff/app/inventory/requests/page.tsx` | yes | S | 0 | — |
| 64 | `/inventory/serials` | `apps/staff/app/inventory/serials/page.tsx` | yes | S | 0 | — |
| 65 | `/inventory/transfers` | `apps/staff/app/inventory/transfers/page.tsx` | yes | S | 0 | — |
| 66 | `/inventory/units` | `apps/staff/app/inventory/units/page.tsx` | yes | S | 0 | — |
| 67 | `/inventory/vouchers` | `apps/staff/app/inventory/vouchers/page.tsx` | yes | S | 0 | — |
| 68 | `/inventory/warehouses` | `apps/staff/app/inventory/warehouses/page.tsx` | yes | S | 0 | — |
| 69 | `/m` | `apps/staff/app/m/page.tsx` | yes | S | 0 | — |
| 70 | `/m/approvals` | `apps/staff/app/m/approvals/page.tsx` | yes | S | 0 | — |
| 71 | `/m/attendance` | `apps/staff/app/m/attendance/page.tsx` | yes | S | 0 | — |
| 72 | `/m/profile` | `apps/staff/app/m/profile/page.tsx` | yes | S | 0 | — |
| 73 | `/m/requests/new` | `apps/staff/app/m/requests/new/page.tsx` | yes | S | 0 | — |
| 74 | `/manufacturing/boms` | `apps/staff/app/manufacturing/boms/page.tsx` | yes | S | 0 | — |
| 75 | `/manufacturing/orders` | `apps/staff/app/manufacturing/orders/page.tsx` | yes | S | 0 | — |
| 76 | `/marina/additions` | `apps/staff/app/marina/additions/page.tsx` | yes | S | 0 | — |
| 77 | `/marina/bookings` | `apps/staff/app/marina/bookings/page.tsx` | yes | S | 0 | — |
| 78 | `/marina/day-close` | `apps/staff/app/marina/day-close/page.tsx` | yes | S | 0 | — |
| 79 | `/marina/groups` | `apps/staff/app/marina/groups/page.tsx` | yes | S | 0 | — |
| 80 | `/marina/link-invoices` | `apps/staff/app/marina/link-invoices/page.tsx` | yes | S | 0 | — |
| 81 | `/marina/preparation` | `apps/staff/app/marina/preparation/page.tsx` | yes | S | 0 | — |
| 82 | `/marina/rota` | `apps/staff/app/marina/rota/page.tsx` | yes | S | 0 | — |
| 83 | `/marina/vessels` | `apps/staff/app/marina/vessels/page.tsx` | yes | S | 0 | — |
| 84 | `/marina/violations` | `apps/staff/app/marina/violations/page.tsx` | yes | S | 0 | — |
| 85 | `/migration/runs` | `apps/staff/app/migration/runs/page.tsx` | yes | S | 0 | — |
| 86 | `/notifications` | `apps/staff/app/notifications/page.tsx` | yes | S | 0 | — |
| 87 | `/optics/field-labels` | `apps/staff/app/optics/field-labels/page.tsx` | yes | S | 0 | — |
| 88 | `/optics/prescriptions` | `apps/staff/app/optics/prescriptions/page.tsx` | yes | S | 0 | — |
| 89 | `/pos/offline` | `apps/staff/app/pos/offline/page.tsx` | yes | S | 0 | — |
| 90 | `/pos/offline-queue` | `apps/staff/app/pos/offline-queue/page.tsx` | yes | S | 0 | — |
| 91 | `/print/[doc]/[id]` | `apps/staff/app/print/[doc]/[id]/page.tsx` | yes | S | 0 | — |
| 92 | `/projects` | `apps/staff/app/projects/page.tsx` | yes | S | 0 | — |
| 93 | `/projects/[id]` | `apps/staff/app/projects/[id]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 94 | `/projects/[id]/board` | `apps/staff/app/projects/[id]/board/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 95 | `/projects/[id]/cost` | `apps/staff/app/projects/[id]/cost/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 96 | `/projects/[id]/gantt` | `apps/staff/app/projects/[id]/gantt/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 97 | `/projects/[id]/tasks/[taskId]` | `apps/staff/app/projects/[id]/tasks/[taskId]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 98 | `/projects/[id]/time` | `apps/staff/app/projects/[id]/time/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 99 | `/projects/board` | `apps/staff/app/projects/board/page.tsx` | yes | S | 0 | — |
| 100 | `/projects/boq` | `apps/staff/app/projects/boq/page.tsx` | yes | S | 0 | — |
| 101 | `/projects/contracting-return` | `apps/staff/app/projects/contracting-return/page.tsx` | yes | S | 0 | — |
| 102 | `/projects/contractor-contract` | `apps/staff/app/projects/contractor-contract/page.tsx` | yes | S | 0 | — |
| 103 | `/projects/contractor-payment` | `apps/staff/app/projects/contractor-payment/page.tsx` | yes | S | 0 | — |
| 104 | `/projects/cost` | `apps/staff/app/projects/cost/page.tsx` | yes | S | 0 | — |
| 105 | `/projects/followup` | `apps/staff/app/projects/followup/page.tsx` | yes | S | 0 | — |
| 106 | `/projects/gantt` | `apps/staff/app/projects/gantt/page.tsx` | yes | S | 0 | — |
| 107 | `/projects/offers` | `apps/staff/app/projects/offers/page.tsx` | yes | S | 0 | — |
| 108 | `/projects/stages` | `apps/staff/app/projects/stages/page.tsx` | yes | S | 0 | — |
| 109 | `/projects/tasks/[taskId]` | `apps/staff/app/projects/tasks/[taskId]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 110 | `/projects/time` | `apps/staff/app/projects/time/page.tsx` | yes | S | 0 | — |
| 111 | `/purchases/invoices` | `apps/staff/app/purchases/invoices/page.tsx` | yes | S | 0 | — |
| 112 | `/purchases/invoices/[id]` | `apps/staff/app/purchases/invoices/[id]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 113 | `/purchases/invoices/new` | `apps/staff/app/purchases/invoices/new/page.tsx` | yes | S | 0 | — |
| 114 | `/purchases/invoices/ocr` | `apps/staff/app/purchases/invoices/ocr/page.tsx` | yes | S | 0 | — |
| 115 | `/purchases/notes/[kind]` | `apps/staff/app/purchases/notes/[kind]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 116 | `/purchases/supplier-portal` | `apps/staff/app/purchases/supplier-portal/page.tsx` | yes | S | 0 | — |
| 117 | `/purchases/suppliers` | `apps/staff/app/purchases/suppliers/page.tsx` | yes | S | 0 | — |
| 118 | `/reports` | `apps/staff/app/reports/page.tsx` | yes | S | 0 | — |
| 119 | `/reports/[key]` | `apps/staff/app/reports/[key]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 120 | `/reports/builder` | `apps/staff/app/reports/builder/page.tsx` | yes | S | 0 | — |
| 121 | `/reports/custom` | `apps/staff/app/reports/custom/page.tsx` | yes | S | 0 | — |
| 122 | `/s/[...slug]` | `apps/staff/app/s/[...slug]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 123 | `/sales/cash-customers` | `apps/staff/app/sales/cash-customers/page.tsx` | yes | S | 0 | — |
| 124 | `/sales/customers` | `apps/staff/app/sales/customers/page.tsx` | yes | S | 0 | — |
| 125 | `/sales/ecommerce-orders` | `apps/staff/app/sales/ecommerce-orders/page.tsx` | yes | S | 0 | — |
| 126 | `/sales/invoices` | `apps/staff/app/sales/invoices/page.tsx` | yes | M | 0 | Pagination 20/page verified; frame split |
| 127 | `/sales/invoices/[id]` | `apps/staff/app/sales/invoices/[id]/page.tsx` | yes | S | 0 | — |
| 128 | `/sales/invoices/new` | `apps/staff/app/sales/invoices/new/page.tsx` | yes | S | 0 | — |
| 129 | `/sales/notes/[kind]` | `apps/staff/app/sales/notes/[kind]/page.tsx` | no | — |  | Rendered 200; earlier RSC 404s were aborted prefetches |
| 130 | `/sales/portal-access` | `apps/staff/app/sales/portal-access/page.tsx` | yes | S | 0 | — |
| 131 | `/sales/pos` | `apps/staff/app/sales/pos/page.tsx` | yes | S | 0 | — |
| 132 | `/sales/quotations` | `apps/staff/app/sales/quotations/page.tsx` | yes | S | 0 | — |
| 133 | `/sales/quotations/[id]` | `apps/staff/app/sales/quotations/[id]/page.tsx` | yes | S | 0 | — |
| 134 | `/sales/quotations/[id]/esign` | `apps/staff/app/sales/quotations/[id]/esign/page.tsx` | yes | S | 0 | — |
| 135 | `/sales/returns` | `apps/staff/app/sales/returns/page.tsx` | yes | S | 0 | — |
| 136 | `/sales/salesman-commissions` | `apps/staff/app/sales/salesman-commissions/page.tsx` | yes | S | 0 | — |
| 137 | `/sales/salesmen` | `apps/staff/app/sales/salesmen/page.tsx` | yes | S | 0 | — |
| 138 | `/sales/shifts` | `apps/staff/app/sales/shifts/page.tsx` | yes | S | 0 | — |
| 139 | `/sales/statements` | `apps/staff/app/sales/statements/page.tsx` | yes | S | 0 | — |
| 140 | `/settings/ai` | `apps/staff/app/settings/ai/page.tsx` | yes | S | 0 | — |
| 141 | `/settings/approvals` | `apps/staff/app/settings/approvals/page.tsx` | yes | S | 0 | — |
| 142 | `/settings/audit` | `apps/staff/app/settings/audit/page.tsx` | yes | S | 0 | — |
| 143 | `/settings/backup` | `apps/staff/app/settings/backup/page.tsx` | yes | S | 0 | — |
| 144 | `/settings/branches` | `apps/staff/app/settings/branches/page.tsx` | yes | S | 0 | — |
| 145 | `/settings/change-password` | `apps/staff/app/settings/change-password/page.tsx` | yes | S | 0 | — |
| 146 | `/settings/company` | `apps/staff/app/settings/company/page.tsx` | yes | S | 0 | — |
| 147 | `/settings/custom-fields` | `apps/staff/app/settings/custom-fields/page.tsx` | yes | S | 0 | — |
| 148 | `/settings/data-rotation` | `apps/staff/app/settings/data-rotation/page.tsx` | yes | S | 0 | — |
| 149 | `/settings/devices` | `apps/staff/app/settings/devices/page.tsx` | yes | S | 0 | — |
| 150 | `/settings/ecommerce` | `apps/staff/app/settings/ecommerce/page.tsx` | yes | S | 0 | — |
| 151 | `/settings/email` | `apps/staff/app/settings/email/page.tsx` | yes | S | 0 | — |
| 152 | `/settings/files` | `apps/staff/app/settings/files/page.tsx` | yes | S | 0 | — |
| 153 | `/settings/general` | `apps/staff/app/settings/general/page.tsx` | yes | S | 0 | — |
| 154 | `/settings/invoice-maintenance` | `apps/staff/app/settings/invoice-maintenance/page.tsx` | yes | S | 0 | — |
| 155 | `/settings/language` | `apps/staff/app/settings/language/page.tsx` | yes | S | 0 | — |
| 156 | `/settings/marketplace` | `apps/staff/app/settings/marketplace/page.tsx` | yes | S | 0 | — |
| 157 | `/settings/new-file` | `apps/staff/app/settings/new-file/page.tsx` | yes | S | 0 | — |
| 158 | `/settings/offers` | `apps/staff/app/settings/offers/page.tsx` | yes | S | 0 | — |
| 159 | `/settings/payment-gateways` | `apps/staff/app/settings/payment-gateways/page.tsx` | yes | S | 0 | — |
| 160 | `/settings/payments` | `apps/staff/app/settings/payments/page.tsx` | yes | S | 0 | — |
| 161 | `/settings/posting-profiles` | `apps/staff/app/settings/posting-profiles/page.tsx` | yes | S | 0 | — |
| 162 | `/settings/price-lists` | `apps/staff/app/settings/price-lists/page.tsx` | yes | S | 0 | — |
| 163 | `/settings/printing` | `apps/staff/app/settings/printing/page.tsx` | yes | S | 0 | — |
| 164 | `/settings/restore` | `apps/staff/app/settings/restore/page.tsx` | yes | S | 0 | — |
| 165 | `/settings/roles` | `apps/staff/app/settings/roles/page.tsx` | yes | S | 0 | — |
| 166 | `/settings/sync` | `apps/staff/app/settings/sync/page.tsx` | yes | S | 0 | — |
| 167 | `/settings/sync/[entity]` | `apps/staff/app/settings/sync/[entity]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 168 | `/settings/sync/manage` | `apps/staff/app/settings/sync/manage/page.tsx` | yes | S | 0 | — |
| 169 | `/settings/sync/zatca` | `apps/staff/app/settings/sync/zatca/page.tsx` | yes | S | 0 | — |
| 170 | `/settings/two-factor` | `apps/staff/app/settings/two-factor/page.tsx` | yes | S | 0 | — |
| 171 | `/settings/usage` | `apps/staff/app/settings/usage/page.tsx` | yes | S | 0 | — |
| 172 | `/settings/users` | `apps/staff/app/settings/users/page.tsx` | yes | S | 0 | — |
| 173 | `/settings/whatsapp` | `apps/staff/app/settings/whatsapp/page.tsx` | yes | S | 0 | — |
| 174 | `/settings/white-label` | `apps/staff/app/settings/white-label/page.tsx` | yes | S | 0 | — |
| 175 | `/settings/zatca` | `apps/staff/app/settings/zatca/page.tsx` | yes | S | 0 | — |
| 176 | `/settings/zatca/sent` | `apps/staff/app/settings/zatca/sent/page.tsx` | yes | S | 0 | — |
| 177 | `/settings/zatca/status` | `apps/staff/app/settings/zatca/status/page.tsx` | yes | S | 0 | — |
| 178 | `/supplier-portal` | `apps/staff/app/supplier-portal/page.tsx` | login | — | 0 | — |
| 179 | `/support/about` | `apps/staff/app/support/about/page.tsx` | yes | S | 0 | — |
| 180 | `/support/help` | `apps/staff/app/support/help/page.tsx` | yes | S | 0 | — |
| 181 | `/support/license` | `apps/staff/app/support/license/page.tsx` | yes | S | 0 | — |
| 182 | `/support/report-designer` | `apps/staff/app/support/report-designer/page.tsx` | yes | S | 0 | — |
| 183 | `/tailoring/invoices` | `apps/staff/app/tailoring/invoices/page.tsx` | yes | S | 0 | — |
| 184 | `/tailoring/measurements` | `apps/staff/app/tailoring/measurements/page.tsx` | yes | S | 0 | — |
| 185 | `/tailoring/measurements/attributes` | `apps/staff/app/tailoring/measurements/attributes/page.tsx` | yes | S | 0 | — |
| 186 | `/tailoring/options` | `apps/staff/app/tailoring/options/page.tsx` | yes | S | 0 | — |
| 187 | `/tailoring/orders` | `apps/staff/app/tailoring/orders/page.tsx` | yes | S | 0 | — |
| 188 | `/tailoring/types` | `apps/staff/app/tailoring/types/page.tsx` | yes | S | 0 | — |
| 189 | `/treasury/bank-accounts` | `apps/staff/app/treasury/bank-accounts/page.tsx` | yes | S | 0 | — |
| 190 | `/treasury/bank-reconciliation` | `apps/staff/app/treasury/bank-reconciliation/page.tsx` | yes | S | 0 | — |
| 191 | `/treasury/bank-statements` | `apps/staff/app/treasury/bank-statements/page.tsx` | yes | S | 0 | — |
| 192 | `/treasury/banks` | `apps/staff/app/treasury/banks/page.tsx` | yes | S | 0 | — |
| 193 | `/treasury/cheques` | `apps/staff/app/treasury/cheques/page.tsx` | yes | S | 0 | — |
| 194 | `/treasury/day-close` | `apps/staff/app/treasury/day-close/page.tsx` | yes | S | 0 | — |
| 195 | `/treasury/movements` | `apps/staff/app/treasury/movements/page.tsx` | yes | S | 0 | — |
| 196 | `/treasury/safes` | `apps/staff/app/treasury/safes/page.tsx` | yes | S | 0 | — |
| 197 | `/treasury/transfers` | `apps/staff/app/treasury/transfers/page.tsx` | yes | S | 0 | — |
| 198 | `/treasury/vouchers` | `apps/staff/app/treasury/vouchers/page.tsx` | yes | S | 0 | — |
| 199 | `/van-sales` | `apps/staff/app/van-sales/page.tsx` | yes | S | 0 | — |
| 200 | `/van-sales/rep` | `apps/staff/app/van-sales/rep/page.tsx` | yes | S | 0 | — |

### Platform Admin — 38 routes

| # | Screen (route) | Page file | Opened | Depth | Ov | Notes |
|---|---|---|---|---|---|---|
| 1 | `/` | `apps/platform-admin/app/page.tsx` | yes | S | 0 | — |
| 2 | `/activation-requests` | `apps/platform-admin/app/activation-requests/page.tsx` | yes | S | 0 | — |
| 3 | `/ai` | `apps/platform-admin/app/ai/page.tsx` | yes | S | 0 | — |
| 4 | `/analytics` | `apps/platform-admin/app/analytics/page.tsx` | yes | S | 0 | — |
| 5 | `/analytics/site` | `apps/platform-admin/app/analytics/site/page.tsx` | yes | S | 0 | — |
| 6 | `/announcements` | `apps/platform-admin/app/announcements/page.tsx` | yes | S | 0 | — |
| 7 | `/api-explorer` | `apps/platform-admin/app/api-explorer/page.tsx` | yes | S | 0 | — |
| 8 | `/api-keys` | `apps/platform-admin/app/api-keys/page.tsx` | yes | S | 0 | — |
| 9 | `/audit` | `apps/platform-admin/app/audit/page.tsx` | yes | S | 0 | — |
| 10 | `/backups` | `apps/platform-admin/app/backups/page.tsx` | yes | S | 0 | — |
| 11 | `/campaigns` | `apps/platform-admin/app/campaigns/page.tsx` | yes | S | 0 | — |
| 12 | `/content` | `apps/platform-admin/app/content/page.tsx` | yes | S | 0 | — |
| 13 | `/data-requests` | `apps/platform-admin/app/data-requests/page.tsx` | yes | S | 0 | — |
| 14 | `/design` | `apps/platform-admin/app/design/page.tsx` | yes | S | 0 | — |
| 15 | `/dunning` | `apps/platform-admin/app/dunning/page.tsx` | yes | S | 0 | — |
| 16 | `/email` | `apps/platform-admin/app/email/page.tsx` | yes | S | 0 | — |
| 17 | `/files` | `apps/platform-admin/app/files/page.tsx` | yes | S | 0 | — |
| 18 | `/health` | `apps/platform-admin/app/health/page.tsx` | yes | S | 0 | — |
| 19 | `/impersonation` | `apps/platform-admin/app/impersonation/page.tsx` | yes | S | 0 | — |
| 20 | `/invoices` | `apps/platform-admin/app/invoices/page.tsx` | yes | S | 0 | — |
| 21 | `/invoices/[id]/print` | `apps/platform-admin/app/invoices/[id]/print/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 22 | `/jobs` | `apps/platform-admin/app/jobs/page.tsx` | yes | S | 0 | — |
| 23 | `/leads` | `apps/platform-admin/app/leads/page.tsx` | yes | S | 0 | — |
| 24 | `/marketplace` | `apps/platform-admin/app/marketplace/page.tsx` | yes | S | 0 | — |
| 25 | `/plans` | `apps/platform-admin/app/plans/page.tsx` | yes | S | 0 | — |
| 26 | `/revenue` | `apps/platform-admin/app/revenue/page.tsx` | yes | S | 0 | — |
| 27 | `/roles` | `apps/platform-admin/app/roles/page.tsx` | yes | M | 0 | Master–detail role matrix |
| 28 | `/settings` | `apps/platform-admin/app/settings/page.tsx` | yes | S | 0 | — |
| 29 | `/subscriptions` | `apps/platform-admin/app/subscriptions/page.tsx` | yes | S | 0 | — |
| 30 | `/tenants` | `apps/platform-admin/app/tenants/page.tsx` | yes | S | 0 | — |
| 31 | `/tenants/[id]` | `apps/platform-admin/app/tenants/[id]/page.tsx` | yes | S | 0 | — |
| 32 | `/tenants/new` | `apps/platform-admin/app/tenants/new/page.tsx` | yes | S | 0 | — |
| 33 | `/tickets` | `apps/platform-admin/app/tickets/page.tsx` | yes | S | 0 | — |
| 34 | `/tickets/[id]` | `apps/platform-admin/app/tickets/[id]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 35 | `/usage` | `apps/platform-admin/app/usage/page.tsx` | yes | S | 0 | — |
| 36 | `/users` | `apps/platform-admin/app/users/page.tsx` | yes | S | 0 | — |
| 37 | `/users/[id]` | `apps/platform-admin/app/users/[id]/page.tsx` | yes | S | 0 | — |
| 38 | `/webhooks` | `apps/platform-admin/app/webhooks/page.tsx` | yes | S | 0 | — |

### Customer portal — 11 routes

| # | Screen (route) | Page file | Opened | Depth | Ov | Notes |
|---|---|---|---|---|---|---|
| 1 | `/` | `apps/customer-portal/app/page.tsx` | yes | S | 0 | — |
| 2 | `/auth/change-password` | `apps/customer-portal/app/auth/change-password/page.tsx` | login | — | 0 | — |
| 3 | `/auth/forgot` | `apps/customer-portal/app/auth/forgot/page.tsx` | yes | S | 0 | — |
| 4 | `/auth/login` | `apps/customer-portal/app/auth/login/page.tsx` | login | — | 0 | — |
| 5 | `/portal` | `apps/customer-portal/app/portal/page.tsx` | yes | M | 0 | Token primitives fixed; header login CTA hidden when signed in |
| 6 | `/portal/invoices` | `apps/customer-portal/app/portal/invoices/page.tsx` | yes | S | 0 | — |
| 7 | `/portal/invoices/[id]` | `apps/customer-portal/app/portal/invoices/[id]/page.tsx` | yes | S | 0 | — |
| 8 | `/portal/invoices/[id]/pay` | `apps/customer-portal/app/portal/invoices/[id]/pay/page.tsx` | yes | S | 0 | — |
| 9 | `/portal/payments` | `apps/customer-portal/app/portal/payments/page.tsx` | yes | S | 0 | — |
| 10 | `/portal/profile` | `apps/customer-portal/app/portal/profile/page.tsx` | yes | S | 0 | — |
| 11 | `/portal/statement` | `apps/customer-portal/app/portal/statement/page.tsx` | yes | S | 0 | — |

### Marketing site — 36 routes

| # | Screen (route) | Page file | Opened | Depth | Ov | Notes |
|---|---|---|---|---|---|---|
| 1 | `/` | `apps/marketing/app/page.tsx` | yes | M | 0 | Token pipeline restored; header, mobile nav and dark mode verified |
| 2 | `/blog` | `apps/marketing/app/blog/page.tsx` | yes | M | 0 | — |
| 3 | `/blog/[slug]` | `apps/marketing/app/blog/[slug]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 4 | `/cases` | `apps/marketing/app/cases/page.tsx` | yes | S | 0 | — |
| 5 | `/cases/[slug]` | `apps/marketing/app/cases/[slug]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 6 | `/changelog` | `apps/marketing/app/changelog/page.tsx` | yes | S | 0 | — |
| 7 | `/changelog/[slug]` | `apps/marketing/app/changelog/[slug]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 8 | `/contact` | `apps/marketing/app/contact/page.tsx` | yes | M | 0 | h1 present; language switch no longer points to /en/contact |
| 9 | `/demo` | `apps/marketing/app/demo/page.tsx` | yes | S | 0 | — |
| 10 | `/design` | `apps/marketing/app/design/page.tsx` | yes | M | 0 | Dev-only DS gallery (h1 present) |
| 11 | `/en` | `apps/marketing/app/en/page.tsx` | yes | M | 0 | EN shell, h1 and header verified |
| 12 | `/en/blog` | `apps/marketing/app/en/blog/page.tsx` | yes | S | 0 | — |
| 13 | `/en/blog/[slug]` | `apps/marketing/app/en/blog/[slug]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 14 | `/en/cases` | `apps/marketing/app/en/cases/page.tsx` | yes | S | 0 | — |
| 15 | `/en/cases/[slug]` | `apps/marketing/app/en/cases/[slug]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 16 | `/en/features` | `apps/marketing/app/en/features/page.tsx` | yes | S | 0 | — |
| 17 | `/en/features/einvoicing` | `apps/marketing/app/en/features/einvoicing/page.tsx` | yes | S | 0 | — |
| 18 | `/en/help` | `apps/marketing/app/en/help/page.tsx` | yes | S | 0 | — |
| 19 | `/en/help/[slug]` | `apps/marketing/app/en/help/[slug]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 20 | `/en/legal/[slug]` | `apps/marketing/app/en/legal/[slug]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 21 | `/features` | `apps/marketing/app/features/page.tsx` | yes | S | 0 | — |
| 22 | `/features/einvoicing` | `apps/marketing/app/features/einvoicing/page.tsx` | yes | S | 0 | — |
| 23 | `/help` | `apps/marketing/app/help/page.tsx` | yes | S | 0 | — |
| 24 | `/help/[slug]` | `apps/marketing/app/help/[slug]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 25 | `/industries` | `apps/marketing/app/industries/page.tsx` | yes | S | 0 | — |
| 26 | `/industries/[slug]` | `apps/marketing/app/industries/[slug]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 27 | `/legal/[slug]` | `apps/marketing/app/legal/[slug]/page.tsx` | no | — |  | Not opened: content_pages empty |
| 28 | `/login` | `apps/marketing/app/login/page.tsx` | yes | S | 0 | — |
| 29 | `/maintenance` | `apps/marketing/app/maintenance/page.tsx` | yes | S | 0 | — |
| 30 | `/not-found-view/[locale]` | `apps/marketing/app/not-found-view/[locale]/page.tsx` | no | — |  | No fixture (dynamic id / empty content) |
| 31 | `/onboarding` | `apps/marketing/app/onboarding/page.tsx` | yes | S | 0 | — |
| 32 | `/pricing` | `apps/marketing/app/pricing/page.tsx` | yes | M | 0 | 390px overflow 662→0 (table scroll frame) |
| 33 | `/status` | `apps/marketing/app/status/page.tsx` | yes | S | 0 | — |
| 34 | `/trust` | `apps/marketing/app/trust/page.tsx` | yes | S | 0 | — |
| 35 | `/unsubscribe` | `apps/marketing/app/unsubscribe/page.tsx` | yes | S | 0 | — |
| 36 | `/verify` | `apps/marketing/app/verify/page.tsx` | yes | S | 0 | — |

### Bakery — 11 routes

| # | Screen (route) | Page file | Opened | Depth | Ov | Notes |
|---|---|---|---|---|---|---|
| 1 | `/` | `apps/bakery/app/page.tsx` | yes | S | 0 | — |
| 2 | `/accounting` | `apps/bakery/app/accounting/page.tsx` | yes | S | 0 | — |
| 3 | `/collection` | `apps/bakery/app/collection/page.tsx` | yes | S | 0 | — |
| 4 | `/custody` | `apps/bakery/app/custody/page.tsx` | yes | S | 0 | — |
| 5 | `/distribution` | `apps/bakery/app/distribution/page.tsx` | yes | S | 0 | — |
| 6 | `/production` | `apps/bakery/app/production/page.tsx` | yes | S | 0 | — |
| 7 | `/rep` | `apps/bakery/app/rep/page.tsx` | yes | M | 0 | — |
| 8 | `/reports` | `apps/bakery/app/reports/page.tsx` | yes | S | 0 | — |
| 9 | `/reps` | `apps/bakery/app/reps/page.tsx` | yes | S | 0 | — |
| 10 | `/sales` | `apps/bakery/app/sales/page.tsx` | yes | M | 0 | Blocked checklist card verified (3 bullets) |
| 11 | `/treasury` | `apps/bakery/app/treasury/page.tsx` | yes | S | 0 | — |

---

## 4. Screens not opened — exact reasons

| Group | Count | Reason |
|---|---:|---|
| Staff `/purchases/invoices/[id]`, `/crm/deals/[id]`, `/hrm/payroll/[id]`, `/projects/[id]`, `/tickets/[id]`, `/esign/*`, `/s/*` | 30 | No fixture id in the demo database (the audit refuses to invent one); the list pages themselves render. |
| Marketing content details: `/blog/[slug]`, `/help/[slug]`, `/cases/[slug]`, `/legal/[slug]` + EN twins, `/changelog/[slug]`, `/industries/[slug]` | 11 | **Resolved.** Seeded 8 published pages; 6 representative detail routes verified in both locales (`/legal/terms`, `/en/legal/terms`, `/blog/cloud-erp-launch`, `/en/blog/cloud-erp-launch`, `/help/getting-started`, `/cases/bakery-rollout`). |
| Supplier portal / portal login redirects | 3 | Unauthenticated by design; probe rendered the login screen. |
| `/purchases` (index) | 0 | **Resolved** — `app/purchases/page.tsx` now redirects to `/purchases/invoices` (checked: 200). The other 20 module roots (`/sales`, `/settings`, `/inventory`…) still 404 by URL; no nav entry points at them, so they are documented rather than redirected blind. |

---

## 5. Tests actually run

| Check | Result |
|---|---|
| `next build` staff | **0** (`/tmp/b8-staff.log`) — includes Next type checking |
| `next build` bakery | **0** (`/tmp/b8-bakery.log`) |
| `next build` platform-admin | **0** (`/tmp/b6-pa.log`) |
| `next build` marketing | **0** (`/tmp/b19-marketing.log`) |
| `next build` customer-portal | **0** (`/tmp/b9-portal.log`) |
| Full sweep s3 (all apps) | 296 routes, **263 opened**, 30 no-fixture, 3 login, 0 HTTP errors |
| Re-sweep s6 (all apps, final builds) | 296 routes, 263 opened, 0 page overflow, 0 HTTP errors |
| Staff re-sweep s7 (after `.grid` fix) | 200 routes, **182 opened**, 17 no-fixture, 1 login, **0 overflow, 0 table overflow**, 0 HTTP errors |
| Marketing sweep s5 | 36 routes, 25 opened, 11 no-fixture, overflow 0 everywhere, h1 on every opened page |
| Bakery sweep s4 | 11/11 opened, overflow 0 |
| RTL / LTR | `dir` flips, sidebar mirrors (LTR left 0/280 px), no overflow at 1440/390; body copy remains Arabic in EN (i18n dictionary ~20 keys — pre-existing, documented) |
| Pagination | 68 invoices, 20/page, «21–40 من 68», «2 / 4», page-scoped select-all |
| Header | 1440/1280: one row 71 px, nav 472–947; 1024/390: burger; 390 menu open with 9 links + 2 CTAs |
| `next build` batch 2 | staff `b27` · bakery `b28` · platform-admin `b29` · marketing `b26`/`b31` · customer-portal `b30` — **all EXIT=0** |
| `pnpm run typecheck` | **EXIT=0** (all packages + 6 apps, `tsc --noEmit`) — `/tmp/tc-after.log` |
| `pnpm -r run lint` | **EXIT=0** (only the pre-existing jsboundaries config warning) — `/tmp/lint-after.log` |
| Marketing re-sweep s5b | 36 routes, **25 opened**, 11 no-fixture (placeholders), overflow 0, h1 on every opened page |
| Hydration probe | fresh context 0 errors; stored `system` 0; stored `light` 0; stored `dark` 0 (was 1 × #418 per page) |
| Portal KPI probe | 1440/1280: `202px ×4` one row · 1024/820: `2×2` · 390: one 362 px column; overflow 0 at every width |
| Content pages | `/legal/terms` 1150 px, one h1, 0 errors; `/en/legal/terms` `lang=en dir=ltr`; `/en/blog/cloud-erp-launch` English h1; `/help/getting-started` FAQ; `/cases/bakery-rollout`; all 0 overflow |
| Staff sweep s8 (final) | 200 routes: **182 opened**, 17 no-fixture, 1 login-only; **0 page errors, 0 table overflow**; one transient document overflow (`/van-sales`, 75 px) not reproducible on 3 fresh loads at 1440 and 390; `/purchases` verified separately as 200 → `/purchases/invoices` |
| Marketing sweep s9 (final) | 36 routes: 25 opened, 11 no-fixture; **0 console/page errors**, overflow 0 |
| Bakery sweep s10 (final) | 11/11 opened, 0 errors, overflow 0, 76 tiny nodes in total (18 on `/treasury`) |
| Re-sweeps after the label restore | staff `s11`: 200 routes, **182 opened**, 0 page errors, 0 table overflow, 3 overflow flags that are parallel-run timing only (0 in 6 isolated reloads at 1440 and 390) · marketing `s12`: 36 routes, **25 opened**, 0 errors, 0 overflow, 0 clipped |

| Theme | system → light → dark; `.dark` applied, body `#06121f`, text `#edf3f8`; dark wordmark visible |
| Bakery blocked card | element 1086×114, 3 bullets |
| Portal | `dir=rtl`, `--color-brand-600=#0b7a63`, overflow 0, no login CTA when signed in |
| `pnpm -r run test` (final) | **EXIT=0 — 2 805 tests in 14 projects** (api 1 803 · bakery 259 · contracts 239 · marketing 100 · web-van 95 · staff 94 · database 56 · web-core 52 · config 32 · platform-admin 27 · ui 21 · testing 12 · customer-portal 11 · migrator 4) — `/tmp/test-final3.log` |
| `next build` (final) | staff `b33` 81 s · bakery `b34` · platform-admin `b35` · customer-portal `b36` · marketing `b37`/`b38` — **all EXIT=0** |

---

## 6. Remaining issues (honest)

1. **~250 opened screens are machine-audited only (depth S).** They rendered with an h1, no horizontal overflow, no console or HTTP errors — but their individual flows (modals, saves, destructive dialogs) were not all exercised by hand. The screens at depth **M** are marked in the registry.
2. **Tiny text is reduced, not eliminated.** Bakery `/treasury` went from **34 → 18** tiny nodes (all 11–12 px meta inside execution cards + the sidebar group label). Staff `/reports/builder`, `/accounting/expenses` and the HRM screens still carry 10–11 px icon counters and field-key hints; the global type floor (`text-xs`, 12 px) covers body/meta text but not decorative counters.
3. **The dashboard board is sparse.** The duplicate-render defect is fixed (one widget set, board in the content column), but the saved `positionX/positionY/width/height` in the demo dashboard came from a wider layout, so holes remain. That is data, not layout.
4. **`marquee-track` spills its own box by design** on `/` and `/en` (the marquee is meant to bleed). Document overflow is 0; recorded so it is not “fixed” twice.
5. **33 route templates were not opened:** 30 need a fixture id that the demo database does not contain (each parent list screen does render; 6 of the marketing detail templates were separately proven with seeded slugs), 3 are login-only by design. One staff page flagged a transient 75 px overflow (`/van-sales`) that did not reproduce on three fresh loads at 1440 and 390 — recorded, not “fixed”.
6. **`/design` has no h1** — `notFound()` in production; the gallery is a dev-only screen.
7. **EN marketing translates the shell/nav only** (~20 dictionary keys). Article bodies stay Arabic unless the CMS row carries `titleEn`/EN blocks — the seeded rows do, so `/en/legal/*` and `/en/blog/*` are genuinely English.
8. **763 label glyphs are still missing.** The typography pass had stripped them from 111 files; 1 591 lines were restored mechanically from `HEAD`, but 178 lines had their Arabic copy rewritten in the same pass, so the glyph could not be re-inserted safely. They are decorative only; the words are intact and every spec passes.
9. **20 staff module roots besides `/purchases`** (`/sales`, `/settings`, `/inventory`, `/crm`…) still return 404 by URL: no index page and no navigation entry points at them. `/purchases` was the only one reached in practice and now redirects.

---

## 7. Counts

- **Routes discovered:** **297** (staff **201** · platform-admin 38 · customer-portal 11 · marketing 36 · bakery 11) — one new route this batch (`/purchases` redirect).
- **Opened at least once:** **264 of 297** route templates (**88.9 %**) — 182 staff + 36 platform-admin + 9 customer-portal + 25 marketing + 11 bakery + `/purchases`. Plus **6** concrete content-detail instances (AR/EN legal, blog, help, case) inside the 11 marketing no-fixture templates.
- **Manually inspected + probed (M):** 12 earlier + the content, portal-KPI, hydration and dashboard probes this batch.
- **Re-inspected after fixes:** marketing 25 opened routes (s5b) + 6 content routes + portal dashboard/invoices/payments + bakery `/treasury` + staff 200-route sweep s8.
- **Not opened:** **33** (30 no-fixture: staff 17 · platform-admin 2 · marketing 11 ; 3 login-only: staff 1 · customer-portal 2).
- **Shared fixes:** 36 marketing routes (tokens/header/nav/content typography) · 11 portal routes (tokens/KPI/tables) · 201 staff routes (`.grid` layers, type floor) · 38 PA + 11 bakery routes (type floor).
- **Builds green:** **5/5**. **Typecheck:** 0 errors. **Lint:** 0 errors.
- **Console/HTTP errors in the final marketing sweep:** 0 (after the hydration fix and content seeding).

---

## 8. How to run what was audited

```bash
git fetch origin && git checkout arena/87daa84c-erp-cloud
pnpm install
pnpm start:erp:local --with-db     # builds, migrates, seeds, then starts all seven services
```

| Surface | URL | Account |
| --- | --- | --- |
| Staff ERP | http://localhost:3001 | `DEMO_*` in `.env` (tenant `demo`) |
| Marketing site | http://localhost:3002 | public |
| Platform admin | http://localhost:3003 | `PLATFORM_ADMIN_*` in `.env` |
| Customer portal | http://localhost:3004 | `portal@demo.test` / `Supp1ier#2026AaZ` (وصولٌ ممنوح من بطاقة العميل) |
| Bakery (van sales) | http://localhost:3005 | `rep@demo.test` |

`--no-seed` skips migrations/seed; `--stop` stops everything the script started; `--status` prints a health table.
The content pages come from the CMS: re-run `node scripts/seed-content.mjs` to restore the eight published pages (idempotent).

| 2026-10-20 | الجدول المشترك | نُقل `Table` إلى `@erp/ui` (نسخةٌ واحدة للمكتب ولوحة المنصّة والمخابز)؛ استُبدلت 44 جدولاً خامًّا للقراءة في المكتب بـ`<Table bare>` داخل اللوحات، و3 في المخابز. الحالات الفارغة صارت من المكوّن نفسه (لا صفَّ colSpan يدويًّا). |
| 2026-10-20 | التفاصيل | فُتحت 15 مسار تفاصيل في المكتب و2 في لوحة المنصّة بسجلاتٍ حقيقية (صفقة، مشروع + مراحل/مهمة، مسيّر رواتب، فاتورة مشتريات، رمز توقيع، تقريران، طباعة فاتورة، تذكرة دعم، فاتورة اشتراك) — 200 وفحص 1440. |
| 2026-10-20 | سجل التدقيق | `/settings/audit` كان يقرأ `occurredAt`/`entityType` غير الموجودَين في DTO؛ صار يقرأ `createdAt`/`entity`/`actorLabel`، ويُظهر فرق «قبل/بعد» للحقول المتغيّرة عند اختيار الصف، مع البيانات الوصفية (الطريقة/المسار/العنوان/التتبّع). |
| 2026-10-20 | بوابة الموردين | `/supplier-portal` لم تبقَ بطاقةَ دخولٍ عائمة في فراغ: رأسُ صفحةٍ عامة + لوحة دخول، وبعد الدخول شريط مؤشرات + لوحات فواتير/مدفوعات/عروض أسعار + نموذج رفع — بلا لوحةٍ داخل لوحة، والحالة الفارغة من `Empty`. |
| 2026-10-20 | الحالات الفارغة | `/approvals/inbox` كان يرسم `<Panel></Panel>` فارغاً عند عدم وجود طلبات؛ صار `Empty` مع طريقٍ إلى سجل الموافقات. |
| 2026-10-20 | جدولٌ واحد فعلاً | ضُمّت خصائص لوحة المنصّة (`cellStyle` · `hideOnPrint` · صفٌّ منفتح `expandedKey/renderExpanded`) إلى جدول `@erp/ui`، وصار ملف `components/ui/table.tsx` في المكتب والمنصّة غلافاً يعيد التصدير — لم يبقَ جدولان في المنتج. |
| 2026-10-20 | جدول القراءة في المكتب | تحوّلت ما بقي من جداول قراءةٍ خامّة (شجرة الحسابات كصفوفٍ مسطَّحة، الاستخدام، الطباعة، معاينة مصمّم التقارير، فان-سيلز، أداة لوحة المؤشرات) إلى `<Table bare>`؛ بقي `<table>` في نماذج الإدخال (شبكات بنود بحقول) وكشوفٍ ذات رؤوس مدمجة (`rowSpan/colSpan`) لأنّ الجدول المشترك لا يرسم رأساً مدمجاً — وهذا مذكورٌ هنا لا مخفيّاً. |
| 2026-10-20 | مسارات التفاصيل العشرة | فُتحت في المتصفح بسجلاتٍ حقيقية: فاتورة مبيعات · عرض سعر · إرسال للتوقيع · قيد يومية · مهمة مشروع · لوحة مؤشرات · مزامنة/كيان · شاشة غير منفّذة (`/s/...`) · إشعار دائن مبيعات · إشعار مدين مشتريات. أُصلح أثناءها: زر العودة في شاشة «غير متاحة» صار داخل `Empty.action` لا شريطاً بعرض الصفحة، ونموذج التوقيع صار `FormSection` بشريط إجراءات، والساعات/المصاريف تُعرض بـ`quantity()` بدل `0.0000`. |
| 2026-10-20 | حالات فارغة حقيقية | مسحٌ آليّ لكل المسارات (178) بحثاً عن جسمِ لوحةٍ خالٍ ونصوصٍ تجريبية: ظهرت لوحتان بعنوانٍ بلا جسم — «التحديثات السحابية والنسخ الاحتياطي» في `/support/about` و«عنوان الويب هوك» في `/integrations/salla/settings` — فصار لكلٍّ منهما محتوى حقيقي (ما يجري تلقائياً، عنوانٌ جاهز للنسخ لكل متجر أو حالة فارغة). ومؤلّف البحث في النظارات والقياسات كان يرسل نصاً فارغاً فيردّ الخادم 422، وبحثٌ لا يطابق عميلاً كان يرسم `ErrorBox`؛ صار الفارغ «كل السجلات» والمفقود حالةً فارغة تسمّي النص.
| 2026-10-20 | جداول البوابة | البوابة لا تمرّ على Tailwind فجدول `@erp/ui` لا يُصيَّغ فيها؛ استُبدلت تسعة جداول خامّة بمكوّنٍ واحد `PortalTable` (نفس عقد `Table`: أعمدة/صفوف/حالة فارغة/إجماليات) في سبع شاشات، وأُضيفت طبقة `.num` لمحاذاة الأرقام، واختبارٌ يمنع أي `<table>` يدوي في البوابة. الجداول التي كانت بعنوانَي «الحقل/القيمة» صارت `headless` داخل اللوحة بدل رأسٍ مكرَّر. تحقّق 8/8 مسارات على 1440 و390. |
| 2026-10-20 | جدولٌ واحد في المكتب | `DataTable` (111 نقطة استدعاء) كانت نسخةً ثانية كاملة من الجدول بخطٍّ يدوي؛ صارت غلافاً رقيقاً حول `Table` المشتركة، وأُضيف لها `renderRowDetail` كي يبقى صفُّ تفاصيل المستند تحت كل سطر (كما كانت `expanded` تفعل). النتيجة: لا `<table>` في `components/data-view.tsx` ولا في `components/ui/table.tsx`، وحشو/زبرا/حالة فارغة واحدة في كل الشاشات. مفحوص: 178 مساراً على 1440 و390 بلا انزلاق ولا أخطاء (سوى `/design` بلا h1 كما هو مسجّل). |
| 2026-10-20 | إعادة فتح 23 مسار تفاصيل | أُنشئت سجلاتُ تجربة (صفقة، مشروع + مرحلة + مهمة + ساعة، فاتورة مشتريات مسودّة، إشعارا مبيعات مسودّتان، مسيّر رواتب، طلب توقيع) وفُتحت كل المسارات الديناميكية بسجلاتها: 25 رابطاً × 1440 و390 = 50 فتحة، 0 أخطاء و0 انزلاق. التعديلان اللذان نتجاها: نموذج المرحلة داخل `panel-foot` بدل صفٍّ عائم، وحالة فارغة حقيقية لجدول المستخلصات. |
| 2026-10-20 | النوافذ الحوارية | غطاءُ `Modal` كان يُرسم داخل حاويةٍ عليها `will-change` من انتقال الصفحة، فصار `fixed` نسبيًّا لإطار المحتوى لا للشاشة (قياس: 28,114 · 1104×1523 بدل 0,0 · 1440×1000) — فلا يُغلق بالنقر خارج العمود. صار المكوّن يُرسم في بوّابةٍ إلى `document.body`، وأُزيل `will-change` الدائم، وصار `Modal`/`Drawer` في المكتب ولوحة المنصّة **إعادة تصدير** لمكوّن `@erp/ui` بدل نسختين. تحقّق: نافذة إلغاء الفاتورة (فتح · Esc · نقر خارجي · زر التأكيد معطّل بلا سبب) ونافذة ترخيص المنصّة — الغطاء 1440×1000، 0 أخطاء. |
| 2026-10-20 | تفاعلات لا يراها المسح | 10 فحوص: تصفية حيّة «68 من 68» ← «1 من 68» ومسحٌ يعيدها، ترقيم «21–40 من 68» بصفوفٍ مختلفة، نافذة Esc وخلفية، تحقّق نموذج «لا يمكن حفظ الفاتورة بدون أصناف» بلا مغادرة الصفحة، زر إنشاء الإشعار معطّل حتى تكتمل الحقول، و0 طلبات كتابة و0 أخطاء كونسول. |
| 2026-10-20 | جدولٌ واحد في الحزمة أيضًا | كان في `@erp/ui` جدولان كاملان (`Table` و`DataTable`): الأول برأسٍ لاصق وفرزٍ وتحديدٍ وإجماليات، والثاني بمُخفي أعمدةٍ محفوظٍ وترقيمٍ وأربع حالات. صار `DataTable` **مُهايئًا** فوق `Table` (أعمدةٌ مُرشَّحة + حالتا الخطأ/المنع + ترقيم)، فلم يبقَ `<table>` في الحزمة إلا في `table.tsx` (وسطرُ مثالٍ في معرض التصميم). الشاشاتُ الثلاث التي تستعمل `DataTable` (تقارير المخابز · الخزينة · التحصيل) أُعيد بناؤها وتحققها 11/11 على 1440 و390. |
| 2026-10-20 | حالة فارغة لتقارير الخطّ | كانت شاشةُ التقارير قبل أول طلبٍ فقرةً رمادية؛ صارت `EmptyState` بعنوانٍ ووصف. |
| 2026-10-20 | إطارُ جدولٍ للتقارير | بقي في المكتب 32 جدولاً خامًّا (`<div class="table-wrap"><table>`) في تقارير المحاسبة والرواتب والمخزون والمشاريع — رؤوسُها مدمجة (`rowSpan/colSpan`) أو صفوفُ مجاميع، فلا تنطبق عليها واجهةُ `columns`. أُضيف `TableFrame` إلى `@erp/ui`: نفسُ السطح والتمرير والحدود من `.table-wrap`، والرأسُ والجسمُ بيد الشاشة. استُبدلت الـ32 كلُّها، فلم يبقَ `<table>` مكتوبٌ في صفحة. |
| 2026-10-20 | شريط البحث في الشريط الجانبي | كان في الحقل أيقونتان (SVG داخل الصفحة + خلفية CSS) وحشوٌ فيزيائيّ `9px 12px 9px 34px` لا يتبع الاتجاه، فبدأ نصُّ «ابحث في الشاشات…» تحت الأيقونة في RTL وقُصَّ. أُزيلت الأيقونة المكرّرة وصار الحشو منطقيًّا (`padding-inline: 34px 12px`). |
| 2026-10-20 | 390px: قضبانٌ وأشرطة | `.ui-split.is-rail-wide` (420px) كان يغلب قاعدةَ الانهيار بحكم الخصوصية، فبقيت نقطةُ البيع ومنشئُ التقارير والحقولُ الإضافية أعرض من الشاشة؛ أُضيف للقاعدة في الوسائط. وشريطُ تصفيةٍ بنصٍّ `nowrap` دفع «مبيعات المندوب» 137px، وقائمةُ علوية في المخابز كانت ترمي زرَّ الخروج 32px خارج الشاشة — صار النصُّ يلتفّ والفتاتُ يُقصّ بـellipsis. |
| 2026-10-20 | نواقصُ الشاشات | `/esign/[token]` كان يعرض «بند» عاريةً و«10.0000»؛ صار «بند N» و`quantity()`. عرضُ السعر في `/sales/quotations/[id]` كذلك. `/sales/notes/[kind]` كان رأسُ عمود الإجراء فارغاً. `/projects/[id]` كان يعرض «لا توجد بنود بعد» فقرةً رمادية داخل لوحة — صار `Empty` للبنود والمراحل. وحالةُ فارغ `/settings/printing` حملت اسماءَ شبكات الديسكتوب فحُذفت. |
| 2026-10-20 | قياسُ هذه الدفعة | المكتب 178 مساراً × 1440 و390: 0 خطأ و0 انزلاق (سوى `/design` غير المتاح في الإنتاج). لوحة المنصّة 34 × 1440 و390: 0. المخابز 11 × 1440 و390: 0. الاختبارات: `@erp/ui` 21 · المكتب 96 · المنصّة 27 · المخابز 259 — كلُّها ناجحة. |
| 2026-10-20 | إغلاقُ الجداول | حُذف `apps/platform-admin/components/ui/log-table.tsx` — كان جدولاً خامًّا بلا مستوردٍ واحد، فلم يبقَ `<table>` في تطبيق المنصّة. وحُوّل جدولُ الصناديق/البنوك في `cash-location-master` إلى `TableFrame`. الاستثناءاتُ المتبقّية مذكورةٌ صراحةً: شبكةُ بنود الفاتورة (`invoice-editor`) لأنّ خلاياها حقولُ إدخال، ومنتقى العميل النقدي (`cash-customer-picker`) لأنّه قائمةٌ عائمة داخل نافذة، وقالبُ إيصال ZATCA (نصُّ HTML للطباعة لا JSX)، وصفحاتُ التسويق العامة (تصميمُ موقعٍ لا شبكةُ بيانات). أمّا البوابة فلها `PortalTable` لأنّها بلا Tailwind. |
