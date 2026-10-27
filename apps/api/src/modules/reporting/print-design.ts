/**
 * 🧩 محرّك تصميم الورقة — يطبّق `designConfig` على قوالب الطباعة.
 *
 * كل دالة هنا تُعيد نفس الـHTML الذي كان يُبنى قبل وجود التصميم عندما يكون
 * `designConfig` فارغاً؛ أي أن التصميم يغيّر ولا يحذف. ولهذا لا يمكن لمصمّم
 * القوالب أن يُسقط بنداً أو رقماً ضريبياً أو رمز QR: كل الأقسام تُرسم دائماً،
 * وما يفعله التصميم هو ترتيبها وإظهار/إخفاء ما هو زينة (عنوان وطني، بنوك،
 * سياسة إرجاع، تفقيط) أو تسمية/ترتيب أعمدة الجدول.
 */
import type { PrintDesignConfig } from './print-settings.service.js';

export type WorksheetSection = { key: string; html: string };

export type WorksheetColumn = { key: string; labelAr: string };

/** الترتيب الافتراضي — يُستعمل حين لا يُحدّد التصميم ترتيباً. */
export function composeSections(config: PrintDesignConfig | undefined, sections: WorksheetSection[]): string {
  const present = sections.filter((section) => section.html.trim().length > 0);
  const order = (config?.sectionOrder ?? []).filter((key) => present.some((section) => section.key === key));
  if (order.length === 0) return present.map((section) => section.html).join('\n');
  const byKey = new Map(present.map((section) => [section.key, section]));
  const ordered: WorksheetSection[] = [];
  for (const key of order) {
    const section = byKey.get(key);
    if (section) ordered.push(section);
  }
  // أقسام لم يذكرها الترتيب تبقى في مكانها الافتراضي في النهاية، فلا يضيع قسم.
  for (const section of present) {
    if (!ordered.some((entry) => entry.key === section.key)) ordered.push(section);
  }
  return ordered.map((section) => section.html).join('\n');
}

/**
 * ترتيب/إخفاء/تسمية أعمدة الجدول.
 *
 * وجود `columns` في التصميم يعني أن القائمة **مرجع**: ما لم يُذكر لا يُرسم (وهو ما
 * تفعله شاشة المصمّم، فهي ترسل كل الأعمدة مع `visible`)، وما ذُكر مرتّباً يُرسم
 * بترتيبه وتسميته. وقائمةٌ فارغة أو كلها مخفيّة ترجع إلى الافتراضي، فلا تُطبع ورقة
 * بلا أعمدة أبداً.
 */
export function resolveColumns(
  config: PrintDesignConfig | undefined,
  defaults: WorksheetColumn[],
): WorksheetColumn[] {
  const chosen = config?.columns ?? [];
  if (chosen.length === 0) return defaults;
  const known = new Map(defaults.map((column) => [column.key, column]));
  const output: WorksheetColumn[] = [];
  for (const entry of chosen) {
    const base = known.get(entry.key);
    if (!base || !entry.visible) continue;
    output.push({ key: base.key, labelAr: (entry.labelAr ?? '').trim() || base.labelAr });
  }
  return output.length > 0 ? output : defaults;
}

export function customFieldsHtml(config: PrintDesignConfig | undefined, placement: 'meta' | 'above_table' | 'below_table'): string {
  const fields = (config?.customFields ?? []).filter(
    (field) => field.placement === placement && (field.label.trim() || field.value.trim()),
  );
  if (fields.length === 0) return '';
  return `<table class="repx-meta-grid design-custom-fields">${fields
    .map(
      (field) =>
        `<tr><th>${escapeText(field.label)}</th><td>${escapeText(field.value)}</td></tr>`,
    )
    .join('')}</table>`;
}

export function customHeaderLinesHtml(config: PrintDesignConfig | undefined): string {
  const lines = (config?.customHeaderLines ?? []).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return '';
  return `<div class="design-head-lines">${lines
    .map((line) => `<div>${escapeText(line)}</div>`)
    .join('')}</div>`;
}

export function customTermsHtml(config: PrintDesignConfig | undefined): string {
  const terms = (config?.customTerms ?? '').trim();
  if (!terms) return '';
  return `<div class="design-terms"><b>شروط وأحكام:</b><div>${escapeText(terms).replace(/\n/g, '<br/>')}</div></div>`;
}

export function customTitles(config: PrintDesignConfig | undefined): { titleAr: string; subtitleAr: string } {
  return {
    titleAr: (config?.customTitleAr ?? '').trim(),
    subtitleAr: (config?.customSubtitleAr ?? '').trim(),
  };
}

export function signatureLabels(config: PrintDesignConfig | undefined, fallback: string[]): string[] {
  const labels = (config?.signatureLabels ?? []).map((label) => label.trim()).filter(Boolean);
  return labels.length > 0 ? labels : fallback;
}

export function watermarkHtml(config: PrintDesignConfig | undefined): string {
  const text = (config?.watermarkText ?? '').trim();
  if (!text) return '';
  return `<div class="design-watermark" aria-hidden="true">${escapeText(text)}</div>`;
}

/**
 * ورقة الطباعة: مقاس 58mm للطابعات الحرارية الصغيرة، أو 80mm، أو A4.
 * والهوامش والاتجاه من التصميم — وكلها قيمٌ مُتحقَّق منها في الخدمة.
 */
export function paperCss(
  printType: 1 | 2,
  config: PrintDesignConfig | undefined,
  landscapeRequested: boolean,
): { size: string; margin: string; maxWidth: string; padding: string; isSmall: boolean } {
  const smallWidth = config?.paperWidthMm === 58 ? 58 : 80;
  const isSmall = printType === 2;
  if (isSmall) {
    const margin = config?.marginMm ?? (smallWidth === 58 ? 2 : 3);
    return {
      size: `${smallWidth}mm auto`,
      margin: `${margin}mm`,
      maxWidth: `${smallWidth}mm`,
      padding: `${margin}mm ${margin + 0.5}mm`,
      isSmall: true,
    };
  }
  const landscape = config?.orientation === 'landscape' || (config?.orientation !== 'portrait' && landscapeRequested);
  const margin = config?.marginMm ?? 10;
  return {
    size: `A4${landscape ? ' landscape' : ''}`,
    margin: `${margin}mm`,
    maxWidth: landscape ? '297mm' : '210mm',
    padding: `${margin}mm ${margin + 1}mm`,
    isSmall: false,
  };
}

export function qrSizeCss(config: PrintDesignConfig | undefined): string {
  const size = config?.qrSizePx;
  return size ? `--qr-size:${size}px` : '';
}

export function logoSizeCss(config: PrintDesignConfig | undefined): string {
  const size = config?.logoSizePx;
  return size ? `--logo-size:${size}px` : '';
}

export function escapeText(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}
