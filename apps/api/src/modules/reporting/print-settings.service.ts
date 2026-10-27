import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { DomainError, newId } from '@erp/contracts';
import { printSettings, withTenantTx, type DatabaseHandle } from '@erp/database';

import { DATABASE_HANDLE } from '../../database/database.module.js';
import { tryGetAuthContext } from '../platform/context/tenant-context.js';

import { REPORT_DEFINITIONS, reportByKey } from './report-catalog.js';

export const PRINT_SCOPES = ['default', 'purchases', 'sales', 'pos', 'rental', 'contracts', 'reports'] as const;
export type PrintScope = (typeof PRINT_SCOPES)[number];

export const PRINT_SCOPE_LABELS: Record<PrintScope, string> = {
  default: 'الإفتراضي',
  purchases: 'مشتريات',
  sales: 'مبيعات',
  pos: 'نقطة بيع',
  rental: 'تأجير',
  contracts: 'عقود',
  reports: 'تقارير',
};

export const REPORT_SCOPE_PREFIX = 'report:';
export const DOC_SCOPE_PREFIX = 'doc:';

export function reportScope(key: string): string {
  return `${REPORT_SCOPE_PREFIX}${key}`;
}

export type PrintableColumnDef = {
  key: string;
  labelAr: string;
};

export type PrintableSectionDef = {
  key: string;
  labelAr: string;
};

export type PrintableDocSpec = {
  scope: string;
  docKey: string;
  titleAr: string;
  hintAr: string;
  defaultPrintType: 1 | 2;
  fallbackScopes: PrintScope[];
  defaultColumns: PrintableColumnDef[];
  defaultSections: PrintableSectionDef[];
  defaultSignatures: string[];
};

const INVOICE_SECTIONS: PrintableSectionDef[] = [
  { key: 'letterhead', labelAr: 'ترويسة المنشأة والشعار' },
  { key: 'nationalAddress', labelAr: 'جدول العنوان الوطني للمنشأة' },
  { key: 'titleBanner', labelAr: 'شريط عنوان المستند' },
  { key: 'metaGrid', labelAr: 'جدول بيانات المستند (الرقم والتاريخ والفرع)' },
  { key: 'partyBox', labelAr: 'بيانات العميل / المورد' },
  { key: 'customTop', labelAr: 'إضافات وخانات مخصصة أعلى الجدول' },
  { key: 'linesTable', labelAr: 'جدول الأصناف والبنود' },
  { key: 'totalsAndQr', labelAr: 'الإجماليات والتفقيط وباركود QR والملاحظات' },
  { key: 'customBottom', labelAr: 'الشروط والأحكام والإضافات السفلية' },
  { key: 'signatures', labelAr: 'التوقيعات والختم الرسمي' },
  { key: 'footer', labelAr: 'شريط التذييل السفلي' },
];

const POS_SECTIONS: PrintableSectionDef[] = [
  { key: 'letterhead', labelAr: 'ترويسة المنشأة والشعار' },
  { key: 'titleBanner', labelAr: 'عنوان الفاتورة الضريبية' },
  { key: 'metaGrid', labelAr: 'بيانات الإيصال والكاشير' },
  { key: 'partyBox', labelAr: 'بيانات العميل' },
  { key: 'customTop', labelAr: 'إضافات مخصصة أعلى الأصناف' },
  { key: 'linesTable', labelAr: 'جدول الأصناف' },
  { key: 'totalsAndQr', labelAr: 'الإجماليات والتفقيط والملاحظات وسياسة الإرجاع' },
  { key: 'customBottom', labelAr: 'عبارات وشروط إضافية' },
  { key: 'signatures', labelAr: 'الختم والتوقيع المختصر' },
  { key: 'footer', labelAr: 'تذييل الإيصال' },
];

const VOUCHER_SECTIONS: PrintableSectionDef[] = [
  { key: 'letterhead', labelAr: 'ترويسة المنشأة والشعار' },
  { key: 'titleBanner', labelAr: 'شريط عنوان السند' },
  { key: 'metaGrid', labelAr: 'جدول رقم وتاريخ السند والصندوق' },
  { key: 'customTop', labelAr: 'إضافات مخصصة أعلى السند' },
  { key: 'voucherBody', labelAr: 'تفاصيل السند والمبلغ والتفقيط والبيان' },
  { key: 'customBottom', labelAr: 'ملاحظات وشروط إضافية' },
  { key: 'signatures', labelAr: 'التوقيعات والختم الرسمي' },
  { key: 'footer', labelAr: 'شريط التذييل السفلي' },
];

export const REPORT_SECTIONS: PrintableSectionDef[] = [
  { key: 'letterhead', labelAr: 'ترويسة المنشأة والشعار' },
  { key: 'titleBanner', labelAr: 'عنوان التقرير والفلاتر المطبقة' },
  { key: 'customTop', labelAr: 'إضافات ومقدمة التقرير' },
  { key: 'linesTable', labelAr: 'جدول بيانات التقرير' },
  { key: 'totalsAndQr', labelAr: 'شريط الملخص والمجاميع والملاحظات' },
  { key: 'customBottom', labelAr: 'شروط وملاحظات ختامية' },
  { key: 'signatures', labelAr: 'جدول التوقيعات والختم' },
  { key: 'footer', labelAr: 'شريط التذييل السفلي' },
];

const SALES_A4_COLUMNS: PrintableColumnDef[] = [
  { key: 'no', labelAr: 'م' },
  { key: 'sku', labelAr: 'الكود' },
  { key: 'description', labelAr: 'اسم الصنف / البيان' },
  { key: 'unit', labelAr: 'الوحدة' },
  { key: 'qty', labelAr: 'الكمية' },
  { key: 'unitPrice', labelAr: 'السعر' },
  { key: 'gross', labelAr: 'الإجمالي' },
  { key: 'discount', labelAr: 'الخصم' },
  { key: 'vat', labelAr: 'الضريبة' },
  { key: 'netTotal', labelAr: 'الصافي' },
];

const POS_SMALL_COLUMNS: PrintableColumnDef[] = [
  { key: 'description', labelAr: 'الصنف' },
  { key: 'qty', labelAr: 'الكمية' },
  { key: 'unitPrice', labelAr: 'السعر' },
  { key: 'netTotal', labelAr: 'الإجمالي' },
];

const PURCHASE_COLUMNS: PrintableColumnDef[] = [
  { key: 'no', labelAr: '#' },
  { key: 'description', labelAr: 'الصنف' },
  { key: 'unit', labelAr: 'الوحدة' },
  { key: 'qty', labelAr: 'الكمية' },
  { key: 'unitPrice', labelAr: 'السعر' },
  { key: 'discount', labelAr: 'الخصم' },
  { key: 'net', labelAr: 'الصافي' },
  { key: 'vat', labelAr: 'الضريبة' },
  { key: 'netTotal', labelAr: 'الإجمالي' },
];

const JOURNAL_COLUMNS: PrintableColumnDef[] = [
  { key: 'no', labelAr: '#' },
  { key: 'account', labelAr: 'الحساب' },
  { key: 'description', labelAr: 'البيان' },
  { key: 'costCenter', labelAr: 'مركز التكلفة' },
  { key: 'party', labelAr: 'الجهة' },
  { key: 'debit', labelAr: 'مدين' },
  { key: 'credit', labelAr: 'دائن' },
];

export const PRINTABLE_DOC_SPECS: PrintableDocSpec[] = [
  {
    scope: 'doc:pos_receipt',
    docKey: 'pos_receipt',
    titleAr: 'إيصال الكاشير الحراري (نقاط البيع)',
    hintAr: 'إيصال البيع السريع في الكاشير ونقاط البيع والمندوب (حراري 80 مم / 58 مم أو A4).',
    defaultPrintType: 2,
    fallbackScopes: ['pos', 'sales', 'default'],
    defaultColumns: POS_SMALL_COLUMNS,
    defaultSections: POS_SECTIONS,
    defaultSignatures: ['الكاشير', 'المستلم'],
  },
  {
    scope: 'doc:sales_invoice',
    docKey: 'sales_invoice',
    titleAr: 'فاتورة المبيعات الضريبية والمبسطة (A4)',
    hintAr: 'قالب فاتورة المبيعات الرسمية المتوافقة مع هيئة الزكاة والضريبة والجمارك (ZATCA).',
    defaultPrintType: 1,
    fallbackScopes: ['sales', 'default'],
    defaultColumns: SALES_A4_COLUMNS,
    defaultSections: INVOICE_SECTIONS,
    defaultSignatures: ['المستلم — Receiver', 'الختم — Official Stamp', 'البائع / المحاسب — Seller'],
  },
  {
    scope: 'doc:sales_return',
    docKey: 'sales_return',
    titleAr: 'إشعار دائن / مرتجع مبيعات',
    hintAr: 'قالب إشعار الدائن الضريبي والمبسط لمرتجعات المبيعات.',
    defaultPrintType: 1,
    fallbackScopes: ['sales', 'default'],
    defaultColumns: SALES_A4_COLUMNS,
    defaultSections: INVOICE_SECTIONS,
    defaultSignatures: ['المستلم — Receiver', 'الختم — Official Stamp', 'المحاسب — Accountant'],
  },
  {
    scope: 'doc:purchase_invoice',
    docKey: 'purchase_invoice',
    titleAr: 'فاتورة المشتريات',
    hintAr: 'قالب فاتورة الشراء وتوريد البضاعة من الموردين.',
    defaultPrintType: 1,
    fallbackScopes: ['purchases', 'default'],
    defaultColumns: PURCHASE_COLUMNS,
    defaultSections: INVOICE_SECTIONS,
    defaultSignatures: ['المورد', 'أمين المستودع', 'المحاسب'],
  },
  {
    scope: 'doc:purchase_return',
    docKey: 'purchase_return',
    titleAr: 'مرتجع المشتريات',
    hintAr: 'قالب إشعار مردودات المشتريات للمورد.',
    defaultPrintType: 1,
    fallbackScopes: ['purchases', 'default'],
    defaultColumns: PURCHASE_COLUMNS,
    defaultSections: INVOICE_SECTIONS,
    defaultSignatures: ['المورد', 'أمين المستودع', 'المحاسب'],
  },
  {
    scope: 'doc:receipt_voucher',
    docKey: 'receipt_voucher',
    titleAr: 'سند قبض مالي',
    hintAr: 'سند استلام نقدي أو بنكي أو شيك من عميل أو جهة.',
    defaultPrintType: 1,
    fallbackScopes: ['default'],
    defaultColumns: [],
    defaultSections: VOUCHER_SECTIONS,
    defaultSignatures: ['المستلم', 'أمين الصندوق', 'المدير المالي'],
  },
  {
    scope: 'doc:payment_voucher',
    docKey: 'payment_voucher',
    titleAr: 'سند صرف مالي',
    hintAr: 'سند صرف نقدي أو بنكي لمورد أو مصروفات تشغيلية.',
    defaultPrintType: 1,
    fallbackScopes: ['default'],
    defaultColumns: [],
    defaultSections: VOUCHER_SECTIONS,
    defaultSignatures: ['المستفيد', 'أمين الصندوق', 'المدير المالي'],
  },
  {
    scope: 'doc:journal_entry',
    docKey: 'journal_entry',
    titleAr: 'سند قيد يومية محاسبي',
    hintAr: 'قيد اليومية المزدوج (مدين / دائن) ومراكز التكلفة.',
    defaultPrintType: 1,
    fallbackScopes: ['default'],
    defaultColumns: JOURNAL_COLUMNS,
    defaultSections: [
      { key: 'letterhead', labelAr: 'ترويسة المنشأة والشعار' },
      { key: 'titleBanner', labelAr: 'شريط عنوان القيد' },
      { key: 'metaGrid', labelAr: 'بيانات رقم وتاريخ القيد والفرع' },
      { key: 'customTop', labelAr: 'إضافات أعلى جدول القيد' },
      { key: 'linesTable', labelAr: 'جدول أطراف القيد (مدين / دائن)' },
      { key: 'totalsAndQr', labelAr: 'التفقيط والملاحظات' },
      { key: 'customBottom', labelAr: 'شروط وملاحظات ختامية' },
      { key: 'signatures', labelAr: 'التوقيعات والختم الرسمي' },
      { key: 'footer', labelAr: 'شريط التذييل السفلي' },
    ],
    defaultSignatures: ['المحاسب', 'المراجع', 'المدير المالي'],
  },
  {
    scope: 'doc:shift_close',
    docKey: 'shift_close',
    titleAr: 'تقرير إغلاق وردية الكاشير',
    hintAr: 'مطابقة النقد المتوقع والمعدود وفئات العملة وطرق الدفع عند إغلاق الوردية.',
    defaultPrintType: 1,
    fallbackScopes: ['pos', 'reports', 'default'],
    defaultColumns: [],
    defaultSections: [
      { key: 'letterhead', labelAr: 'ترويسة المنشأة والشعار' },
      { key: 'titleBanner', labelAr: 'عنوان إغلاق اليومية' },
      { key: 'metaGrid', labelAr: 'بيانات الوردية والفرع ووقت الفتح والإغلاق' },
      { key: 'customTop', labelAr: 'إضافات أعلى المطابقة' },
      { key: 'voucherBody', labelAr: 'ملخص النقد وجداول طرق الدفع وفئات النقد' },
      { key: 'customBottom', labelAr: 'ملاحظات إغلاق الوردية' },
      { key: 'signatures', labelAr: 'التوقيعات والختم' },
      { key: 'footer', labelAr: 'شريط التذييل السفلي' },
    ],
    defaultSignatures: ['الكاشير', 'المشرف', 'المحاسب'],
  },
];

export const docSpecByScope = new Map(PRINTABLE_DOC_SPECS.map((spec) => [spec.scope, spec]));

export const PRINT_TEMPLATES = ['classic', 'modern', 'minimal'] as const;
export type PrintTemplate = (typeof PRINT_TEMPLATES)[number];
export const PRINT_TEMPLATE_LABELS: Record<PrintTemplate, string> = {
  classic: 'كلاسيكي',
  modern: 'عصري',
  minimal: 'مختصر',
};
export const PRINT_TEMPLATE_HINTS: Record<PrintTemplate, string> = {
  classic: 'الشكل الرسمي المؤطّر: جدول بحدود واضحة وعناوين مظلّلة.',
  modern: 'شريط لون أعلى الورقة وحدود ناعمة وترويسة جدول بلون الهوية.',
  minimal: 'خطوط رفيعة بلا تعبئة — ورق هادئ للقراءة والتوقيع.',
};

export const PRINT_FONTS = ['segoe', 'naskh', 'sans'] as const;
export type PrintFont = (typeof PRINT_FONTS)[number];
export const PRINT_FONT_LABELS: Record<PrintFont, string> = {
  segoe: 'Segoe UI — الافتراضي',
  naskh: 'Noto Naskh Arabic — نسخي',
  sans: 'خط النظام — حديث',
};

export const printAccentColor = z
  .string()
  .trim()
  .max(7)
  .refine((value) => value === '' || /^#[0-9a-fA-F]{6}$/.test(value), {
    message: 'must be a #RRGGBB colour or empty',
  });

export const printDesignColumnSchema = z.object({
  key: z.string().trim().min(1).max(60),
  labelAr: z.string().trim().max(80).optional(),
  visible: z.coerce.boolean(),
});

export const printCustomFieldSchema = z.object({
  label: z.string().trim().min(1).max(80),
  value: z.string().trim().max(240),
  placement: z.enum(['meta', 'above_table', 'below_table']),
});

export const printDesignConfigSchema = z
  .object({
    paperWidthMm: z.union([z.literal(80), z.literal(58)]).optional(),
    orientation: z.enum(['auto', 'portrait', 'landscape']).optional(),
    marginMm: z.coerce.number().int().min(2).max(25).optional(),
    tableStyle: z.enum(['grid', 'striped', 'clean']).optional(),
    headerBgColor: printAccentColor.optional(),
    logoSizePx: z.coerce.number().int().min(36).max(140).optional(),
    logoPosition: z.enum(['center', 'right', 'left', 'hidden']).optional(),
    qrSizePx: z.coerce.number().int().min(70).max(190).optional(),
    showNationalAddress: z.coerce.boolean().optional(),
    showCompanyBanks: z.coerce.boolean().optional(),
    showMetaGrid: z.coerce.boolean().optional(),
    showPartyBox: z.coerce.boolean().optional(),
    showTafqeet: z.coerce.boolean().optional(),
    showReturnPolicy: z.coerce.boolean().optional(),
    sectionOrder: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
    columns: z.array(printDesignColumnSchema).max(40).optional(),
    customTitleAr: z.string().trim().max(120).optional(),
    customSubtitleAr: z.string().trim().max(160).optional(),
    customHeaderLines: z.array(z.string().trim().max(140)).max(5).optional(),
    customFields: z.array(printCustomFieldSchema).max(12).optional(),
    customTerms: z.string().trim().max(800).optional(),
    /** مسمّيات التوقيعات — قائمةٌ فارغة تعني «التوقيعات الافتراضية للقالب» لا «بلا توقيعات». */
    signatureLabels: z.array(z.string().trim().min(1).max(60)).max(5).optional(),
    watermarkText: z.string().trim().max(60).optional(),
  })
  .strict();

export type PrintDesignConfig = z.infer<typeof printDesignConfigSchema>;

export type PrintSettings = {
  scope: string;
  printType: 1 | 2;
  printHeader: boolean;
  printFooter: boolean;
  printStamp: boolean;
  printItemDetails: boolean;
  printItemGroups: boolean;
  printComponentsIndividually: boolean;
  printMakePay: boolean;
  printNo: number;
  printItemType: number;
  casherPrinter: string;
  kitchenPrinter: string;
  rptName: string;
  rptUrl: string;
  note: string;
  headerImageUrl: string;
  footerImageUrl: string;
  stampImageUrl: string;
  template: PrintTemplate;
  accentColor: string;
  fontFamily: PrintFont;
  fontScale: number;
  showSignatures: boolean;
  designConfig: PrintDesignConfig;
  saved: boolean;
};

export const defaultsForScope = (scope: string): PrintSettings => {
  const docSpec = docSpecByScope.get(scope);
  return {
    scope,
    printType: docSpec?.defaultPrintType ?? 1,
    printHeader: true,
    printFooter: false,
    printStamp: true,
    printItemDetails: false,
    printItemGroups: false,
    printComponentsIndividually: false,
    printMakePay: false,
    printNo: 1,
    printItemType: 1,
    casherPrinter: '',
    kitchenPrinter: '',
    rptName: '',
    rptUrl: '',
    note: '',
    headerImageUrl: '',
    footerImageUrl: '',
    stampImageUrl: '',
    template: 'classic',
    accentColor: '',
    fontFamily: 'segoe',
    fontScale: 100,
    showSignatures: true,
    designConfig: {},
    saved: false,
  };
};

const url = z
  .string()
  .trim()
  .max(600)
  .refine((value) => value === '' || /^https?:\/\/\S+$/i.test(value), {
    message: 'must be an http(s) URL',
  });
const shortText = z.string().trim().max(120);

export const printSettingsInputSchema = z.object({
  printType: z.coerce.number().int().min(1).max(2).optional(),
  printHeader: z.coerce.boolean().optional(),
  printFooter: z.coerce.boolean().optional(),
  printStamp: z.coerce.boolean().optional(),
  printItemDetails: z.coerce.boolean().optional(),
  printItemGroups: z.coerce.boolean().optional(),
  printComponentsIndividually: z.coerce.boolean().optional(),
  printMakePay: z.coerce.boolean().optional(),
  printNo: z.coerce.number().int().min(1).max(50).optional(),
  printItemType: z.coerce.number().int().min(1).max(9).optional(),
  casherPrinter: shortText.optional(),
  kitchenPrinter: shortText.optional(),
  rptName: shortText.optional(),
  rptUrl: shortText.optional(),
  note: z.string().trim().max(600).optional(),
  headerImageUrl: url.optional(),
  footerImageUrl: url.optional(),
  stampImageUrl: url.optional(),
  template: z.enum(PRINT_TEMPLATES).optional(),
  accentColor: printAccentColor.optional(),
  fontFamily: z.enum(PRINT_FONTS).optional(),
  fontScale: z.coerce.number().int().min(85).max(130).optional(),
  showSignatures: z.coerce.boolean().optional(),
  designConfig: printDesignConfigSchema.optional(),
});

export type PrintSettingsInput = z.infer<typeof printSettingsInputSchema>;

export type PrintableTemplateEntry = {
  scope: string;
  titleAr: string;
  group: string;
  groupLabelAr: string;
  hintAr: string;
  saved: boolean;
  defaultPrintType: 1 | 2;
  defaultColumns: PrintableColumnDef[];
  defaultSections: PrintableSectionDef[];
  defaultSignatures: string[];
};

const REPORT_GROUP_LABELS_AR: Record<string, string> = {
  documents: 'الفواتير والإيصالات والسندات',
  defaults: 'القوالب العامة للأقسام',
  sales: 'تقارير المبيعات والعملاء',
  purchases: 'تقارير المشتريات والموردين',
  inventory: 'تقارير المخزون والمستودعات',
  accounting: 'التقارير المالية والمحاسبية',
  pos: 'تقارير نقاط البيع والكاشير',
  hrm: 'تقارير الموظفين والرواتب',
  marina: 'تقارير المراسي والتأجير',
  projects: 'تقارير المشاريع والمقاولات',
  zatca: 'تقارير الضريبة والفوترة الإلكترونية',
};

function sanitizeStoredDesignConfig(raw: unknown): PrintDesignConfig {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const parsed = printDesignConfigSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

@Injectable()
export class PrintSettingsService {
  constructor(@Inject(DATABASE_HANDLE) private readonly database: DatabaseHandle) {}

  /** Validate scope: fixed name, `doc:<docKey>`, or `report:<key>` for a registered report. */
  parseScope(scope: string): string {
    const value = decodeURIComponent((scope ?? '').trim());
    if (PRINT_SCOPES.includes(value as PrintScope)) return value;
    if (docSpecByScope.has(value)) return value;
    if (value.startsWith(REPORT_SCOPE_PREFIX)) {
      const key = value.slice(REPORT_SCOPE_PREFIX.length);
      if (!reportByKey.has(key)) throw new DomainError('REPORT_NOT_FOUND', 'Report key is not registered', 404);
      return value;
    }
    throw new DomainError('PRINT_SCOPE_INVALID', 'Unknown print scope', 404);
  }

  /** Every saved row for the 7 top-level scopes, and defaults for unsaved ones. */
  async list(tenantId: string): Promise<{ data: PrintSettings[] }> {
    const saved = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(printSettings).where(eq(printSettings.tenantId, tenantId)).orderBy(asc(printSettings.scope)));
    const byScope = new Map(saved.map((row) => [row.scope, this.toSettings(row)]));
    const data = PRINT_SCOPES.map((scope) => byScope.get(scope) ?? defaultsForScope(scope));
    return { data };
  }

  /** Complete catalog of every printable invoice, receipt, voucher, and report in the system. */
  async listPrintableTemplates(tenantId: string): Promise<{ data: PrintableTemplateEntry[] }> {
    const savedRows = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select({ scope: printSettings.scope }).from(printSettings).where(eq(printSettings.tenantId, tenantId)));
    const savedSet = new Set(savedRows.map((r) => r.scope));

    const items: PrintableTemplateEntry[] = [];

    for (const spec of PRINTABLE_DOC_SPECS) {
      items.push({
        scope: spec.scope,
        titleAr: spec.titleAr,
        group: 'documents',
        groupLabelAr: REPORT_GROUP_LABELS_AR.documents!,
        hintAr: spec.hintAr,
        saved: savedSet.has(spec.scope),
        defaultPrintType: spec.defaultPrintType,
        defaultColumns: spec.defaultColumns,
        defaultSections: spec.defaultSections,
        defaultSignatures: spec.defaultSignatures,
      });
    }

    const defaultScopeHints: Record<PrintScope, string> = {
      default: 'الإعدادات العامة المطبّقة تلقائياً على أي مستند لم يُخصَّص له قالب مستقل.',
      sales: 'الإعدادات الافتراضية المشتركة لكافة فواتير ومرتجعات المبيعات.',
      pos: 'الإعدادات الافتراضية المشتركة لإيصالات نقاط البيع والكاشير.',
      purchases: 'الإعدادات الافتراضية المشتركة لفواتير ومرتجعات المشتريات.',
      reports: 'الإعدادات الافتراضية المشتركة لجميع التقارير المالية والمخزنية.',
      rental: 'الإعدادات الافتراضية لعقود وفواتير التأجير والمراسي.',
      contracts: 'الإعدادات الافتراضية لعقود ومستخلصات المشاريع والمقاولات.',
    };

    for (const sc of PRINT_SCOPES) {
      items.push({
        scope: sc,
        titleAr: `القالب العام — ${PRINT_SCOPE_LABELS[sc]}`,
        group: 'defaults',
        groupLabelAr: REPORT_GROUP_LABELS_AR.defaults!,
        hintAr: defaultScopeHints[sc],
        saved: savedSet.has(sc),
        defaultPrintType: sc === 'pos' ? 2 : 1,
        defaultColumns:
          sc === 'pos'
            ? POS_SMALL_COLUMNS
            : sc === 'purchases'
              ? PURCHASE_COLUMNS
              : sc === 'reports'
                ? []
                : SALES_A4_COLUMNS,
        defaultSections: sc === 'pos' ? POS_SECTIONS : sc === 'reports' ? REPORT_SECTIONS : INVOICE_SECTIONS,
        defaultSignatures: ['أعده', 'راجعه', 'المدير'],
      });
    }

    for (const def of REPORT_DEFINITIONS) {
      const sc = reportScope(def.key);
      items.push({
        scope: sc,
        titleAr: def.titleAr,
        group: def.group,
        groupLabelAr: REPORT_GROUP_LABELS_AR[def.group] ?? def.group,
        hintAr: def.hintAr ?? `تخصيص طباعة ${def.titleAr} (الأعمدة، الترويسة، التوقيعات، الورق).`,
        saved: savedSet.has(sc),
        defaultPrintType: 1,
        defaultColumns: def.columns
          .filter((c) => !c.hidden)
          .map((c) => ({ key: c.key, labelAr: c.labelAr })),
        defaultSections: REPORT_SECTIONS,
        defaultSignatures: ['أعده', 'راجعه', 'المدير'],
      });
    }

    return { data: items };
  }

  /** Read one scope: returns saved row if present, else inherited effective settings with `saved: false`. */
  async read(tenantId: string, rawScope: string): Promise<PrintSettings> {
    const scope = this.parseScope(rawScope);
    const [row] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(printSettings).where(and(eq(printSettings.tenantId, tenantId), eq(printSettings.scope, scope))));
    if (row) return this.toSettings(row);
    const docSpec = docSpecByScope.get(scope);
    if (docSpec) {
      const inherited = await this.effective(tenantId, docSpec.fallbackScopes);
      return {
        ...inherited,
        scope,
        printType: inherited.saved ? inherited.printType : docSpec.defaultPrintType,
        saved: false,
      };
    }
    return defaultsForScope(scope);
  }

  /** Upsert one scope; absent fields keep their current (or default) value. */
  async write(tenantId: string, rawScope: string, input: PrintSettingsInput): Promise<PrintSettings> {
    const scope = this.parseScope(rawScope);
    const parsed = printSettingsInputSchema.parse(input);
    const [existingRow] = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(printSettings).where(and(eq(printSettings.tenantId, tenantId), eq(printSettings.scope, scope))));
    const current = existingRow ? this.toSettings(existingRow) : await this.read(tenantId, scope);
    const mergedDesign: PrintDesignConfig =
      parsed.designConfig !== undefined
        ? { ...current.designConfig, ...parsed.designConfig }
        : current.designConfig;
    const base: PrintSettings = {
      ...current,
      ...parsed,
      printType: (parsed.printType ?? current.printType) === 2 ? 2 : 1,
      designConfig: mergedDesign,
    };
    const patch = {
      printType: base.printType,
      printHeader: base.printHeader,
      printFooter: base.printFooter,
      printStamp: base.printStamp,
      printItemDetails: base.printItemDetails,
      printItemGroups: base.printItemGroups,
      printComponentsIndividually: base.printComponentsIndividually,
      printMakePay: base.printMakePay,
      printNo: base.printNo,
      printItemType: base.printItemType,
      casherPrinter: base.casherPrinter,
      kitchenPrinter: base.kitchenPrinter,
      rptName: base.rptName,
      rptUrl: base.rptUrl,
      note: base.note,
      headerImageUrl: base.headerImageUrl,
      footerImageUrl: base.footerImageUrl,
      stampImageUrl: base.stampImageUrl,
      template: base.template,
      accentColor: base.accentColor === '' ? null : base.accentColor,
      fontFamily: base.fontFamily,
      fontScale: base.fontScale,
      showSignatures: base.showSignatures,
      designConfig: base.designConfig as Record<string, unknown>,
      updatedAt: new Date(),
      updatedBy: tryGetAuthContext()?.userId ?? null,
    };

    return withTenantTx(this.database.db, tenantId, async (tx) => {
      if (existingRow) {
        await tx
          .update(printSettings)
          .set(patch)
          .where(and(eq(printSettings.tenantId, tenantId), eq(printSettings.scope, scope)));
      } else {
        await tx.insert(printSettings).values({
          id: newId(),
          tenantId,
          scope,
          ...patch,
          createdBy: tryGetAuthContext()?.userId ?? null,
        });
      }
      const [row] = await tx
        .select()
        .from(printSettings)
        .where(and(eq(printSettings.tenantId, tenantId), eq(printSettings.scope, scope)));
      return this.toSettings(row!);
    });
  }

  /** Reset scope back to defaults. */
  async reset(tenantId: string, rawScope: string): Promise<PrintSettings> {
    const scope = this.parseScope(rawScope);
    await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.delete(printSettings).where(and(eq(printSettings.tenantId, tenantId), eq(printSettings.scope, scope))));
    return defaultsForScope(scope);
  }

  /** Effective settings: first scope in `scopes` with a saved row wins. */
  async effective(tenantId: string, scopes: string[]): Promise<PrintSettings> {
    const list = await withTenantTx(this.database.db, tenantId, (tx) =>
      tx.select().from(printSettings).where(and(eq(printSettings.tenantId, tenantId))));
    const byScope = new Map(list.map((row) => [row.scope, row]));
    for (const scope of scopes) {
      const row = byScope.get(scope);
      if (row) return this.toSettings(row);
    }
    return defaultsForScope(scopes[0] ?? 'default');
  }

  /** Merge unsaved draft settings over current effective settings for live preview. */
  async mergeDraft(tenantId: string, rawScope: string, draft?: PrintSettingsInput): Promise<PrintSettings> {
    const base = await this.read(tenantId, rawScope);
    if (!draft) return base;
    const parsed = printSettingsInputSchema.parse(draft);
    return {
      ...base,
      ...parsed,
      printType: (parsed.printType ?? base.printType) === 2 ? 2 : 1,
      designConfig:
        parsed.designConfig !== undefined
          ? { ...base.designConfig, ...parsed.designConfig }
          : base.designConfig,
    };
  }

  private toSettings(row: typeof printSettings.$inferSelect): PrintSettings {
    return {
      scope: row.scope,
      printType: row.printType === 2 ? 2 : 1,
      printHeader: row.printHeader,
      printFooter: row.printFooter,
      printStamp: row.printStamp,
      printItemDetails: row.printItemDetails,
      printItemGroups: row.printItemGroups,
      printComponentsIndividually: row.printComponentsIndividually,
      printMakePay: row.printMakePay,
      printNo: row.printNo,
      printItemType: row.printItemType,
      casherPrinter: row.casherPrinter ?? '',
      kitchenPrinter: row.kitchenPrinter ?? '',
      rptName: row.rptName ?? '',
      rptUrl: row.rptUrl ?? '',
      note: row.note ?? '',
      headerImageUrl: row.headerImageUrl ?? '',
      footerImageUrl: row.footerImageUrl ?? '',
      stampImageUrl: row.stampImageUrl ?? '',
      template: (PRINT_TEMPLATES as readonly string[]).includes(row.template)
        ? (row.template as PrintTemplate)
        : 'classic',
      accentColor: row.accentColor ?? '',
      fontFamily: (PRINT_FONTS as readonly string[]).includes(row.fontFamily)
        ? (row.fontFamily as PrintFont)
        : 'segoe',
      fontScale: row.fontScale,
      showSignatures: row.showSignatures,
      designConfig: sanitizeStoredDesignConfig(row.designConfig),
      saved: true,
    };
  }
}
