import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { baseAuditColumns } from '../columns.js';

import { tenants } from './platform.js';

/**
 * 🖨️ إعدادات الطباعة — `SettingPrint(Inv_Id, …)` of `Desktop_ERP`.
 *
 * The desktop keys this table by a magic `Inv_Id` integer that two different windows
 * disagree about: `frmSettings.xaml.cs` L2095-L2116 saves 0 الإفتراضي · 1 مشتريات ·
 * 2 مبيعات · 3 نقطة بيع · 4 تأجير · 5 عقود · 6 تقارير, while every report window reads
 * its own constant (`frmRptKhzna` L106 reads `Inv_Id=12`, `frmRptEntries` reads 9,
 * `frmRptRentInvoices` L541 reads 14). The cloud keeps the *meaning* and drops the
 * integers: a scope is a name, and a report may carry settings of its own under
 * `report:<key>`, which fall back to «تقارير» and then to «الإفتراضي».
 *
 * The three images are URLs, not bytes: `HeaderImage` · `FooterImage` · `StampImage` are
 * `[image]` columns in the desktop's SQL Server, and this platform has no byte store
 * (`vessel_groups.image_url` set the precedent).
 */
export const printSettings = pgTable(
  'print_settings',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /**
     * 🎯 النطاق — one of «الإفتراضي · مشتريات · مبيعات · نقطة بيع · تأجير · عقود ·
     * تقارير», or `report:<key>` for one report's own settings.
     */
    scope: text('scope').notNull(),
    /** 📄 نوع الورقة — 1 «📄 ورقة A4» · 2 «🧾 ورق صغير» (`frmInvRptType` · `Print.cs` L56). */
    printType: integer('print_type').notNull().default(1),
    /** 🏛️ طباعة ترويسة الفاتورة (`chkInvHeader`) — `header.repx` under the report title. */
    printHeader: boolean('print_header').notNull().default(true),
    /** 📞 طباعة تذييل الفاتورة (`chkInvFooter`) — `footer.repx`: الهاتف والجوال والعنوان. */
    printFooter: boolean('print_footer').notNull().default(false),
    /** 🔖 طباعة الختم (`ckPrintStamp`) — the stamp image over the signature strip. */
    printStamp: boolean('print_stamp').notNull().default(true),
    /** 🧾 طباعة تفاصيل الأصناف (`ckPrintItems` → `PrintTotItem`). */
    printItemDetails: boolean('print_item_details').notNull().default(false),
    /** 🗂️ طباعة مجموعات الأصناف مع إغلاق اليومية (`ckPrintGroups` → `PrintTotGroup`). */
    printItemGroups: boolean('print_item_groups').notNull().default(false),
    /** 🧩 طباعة مكونات الأصناف المركبة بشكل منفرد (`chkPrintComponentsItemsIndividually`). */
    printComponentsIndividually: boolean('print_components_individually').notNull().default(false),
    /** 💳 طباعة make pay (`printmakpay`). */
    printMakePay: boolean('print_make_pay').notNull().default(false),
    /** 🔢 عدد النسخ — `cmbPrintNo` (`printNo`), the number `Printing` loops over (L201-L206). */
    printNo: integer('print_no').notNull().default(1),
    /** 🖨️ نوع طباعة الأصناف — `PrintItemType`, defaults to 1 in `Print.cs` L64. */
    printItemType: integer('print_item_type').notNull().default(1),
    /** 🖨️ طابعة الكاشير — `cmbCashPrinter` (`CasherPrinter`). */
    casherPrinter: text('casher_printer'),
    /** 🍳 طابعة المطبخ — `cmbKitchenprinter` (`kitchenprinter`), the second copy's printer. */
    kitchenPrinter: text('kitchen_printer'),
    /** 📝 اسم التقرير — `txtRptName` (`RptName`), the layout the operator designed. */
    rptName: text('rpt_name'),
    /** 📂 مسار التقرير — `txtRptPath` (`RptUrl`); a folder on the desktop's disk, a hint here. */
    rptUrl: text('rpt_url'),
    /** 📝 ملاحظات التقرير — `txtNote` (`note`), printed under the grid. */
    note: text('note'),
    /** 🏛️ الترويـسة — `HeaderImage`; a URL, because this platform has no byte store. */
    headerImageUrl: text('header_image_url'),
    /** 📞 التـذيـيـل — `FooterImage`. */
    footerImageUrl: text('footer_image_url'),
    /** 🔖 الخــتـم — `StampImage`. */
    stampImageUrl: text('stamp_image_url'),
    /**
     * 🎨 القالب — كيف تبدو الورقة لا ماذا تحمل: `classic` (الشكل الذي كان) · `modern`
     * (شريط لونٍ وحدود ناعمة) · `minimal` (خطوط رفيعة بلا تعبئة). التفصيل في
     * `print-templates.service.ts`؛ والقيد في القاعدة (`0137`).
     */
    template: text('template').notNull().default('classic'),
    /** 🖌️ لون التمييز `#RRGGBB`، وفارغه يعني «لون هوية المنشأة ثم أسود الورقة». */
    accentColor: text('accent_color'),
    /** ✍️ عائلة الخط: `segoe` · `naskh` · `sans` — خطوطُ النظام، لا تحميلَ من الشبكة. */
    fontFamily: text('font_family').notNull().default('segoe'),
    /** 🔎 مقياس الخط 85..130 (بالنسبة المئوية). */
    fontScale: integer('font_scale').notNull().default(100),
    /** ✒️ سطر التوقيعات في التقارير. */
    showSignatures: boolean('show_signatures').notNull().default(true),
    /** 🧩 إعدادات التصميم المتقدمة للقالب (ترتيب الأقسام والأعمدة، الهوامش، الإضافات، التوقيعات). */
    designConfig: jsonb('design_config').$type<Record<string, unknown>>().notNull().default({}),
    ...baseAuditColumns(),
  },
  (table) => ({
    scopeKey: uniqueIndex('print_settings_tenant_scope_key').on(table.tenantId, table.scope),
    tenantIdx: index('print_settings_tenant_idx').on(table.tenantId),
  }),
);

export const printerReportLinks = pgTable(
  'printer_report_links',
  {
    id: uuid('id').primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    /** 🎯 النطاق — نفس مفردات `print_settings.scope` (`default` · `sales` · `report:<key>`). */
    scope: text('scope').notNull(),
    /** 📑 اسم الطباعة — `PrintName` (`DgvName`). */
    printName: text('print_name').notNull(),
    /** 🖨️ اسم الطابعة — `Printer` (`DgvPrinterName`). */
    printerName: text('printer_name').notNull(),
    /** 📂 مسار التقرير — `RptUrl`، مجلد على قرص الديسكتوب، يُحفظ تذكارياً. */
    rptUrl: text('rpt_url'),
    /** 📄 اسم ملف التقرير — `RptName` (`DgvReport`) مثل `RptSalesInPeriod1.repx`. */
    rptName: text('rpt_name'),
    ...baseAuditColumns(),
  },
  (table) => ({
    tenantScopeIdx: index('printer_report_links_tenant_scope_idx').on(table.tenantId, table.scope),
    tenantIdx: index('printer_report_links_tenant_idx').on(table.tenantId),
  }),
);

export type PrintSetting = typeof printSettings.$inferSelect;
export type PrinterReportLink = typeof printerReportLinks.$inferSelect;
