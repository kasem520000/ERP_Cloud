import { describe, expect, it } from 'vitest';

import { listState, rowKeyFrom, tableColumns, type ScreenColumn } from '../lib/ui-kit';

/**
 * 🧰 جسرُ الشاشات إلى `@erp/ui` — الأحكامُ على المحوّلات الثلاثة، لأنّها هي ما يجعل هجرةَ
 * الشاشات ميكانيكيةً وآمنة: فلو تغيّرت محاذاةُ الأرقام أو ترتيبُ الحالات أو مفتاحُ الصفّ
 * هنا، تغيّرت في **كلّ** شاشةٍ مهاجَرة دفعةً واحدة.
 *
 * والقاعدةُ التي تُثبَّت: **الشاشةُ تُعلن الأعمدةَ والحالة، والنظامُ يرسم** — فلا JSX في
 * منطق الشاشة، ولا منطقُ عرضٍ في الصفحة.
 */
const columns: readonly ScreenColumn[] = [
  { key: 'number', labelAr: 'الرقم', ltr: true },
  { key: 'total', labelAr: 'الإجمالي', numeric: true },
  { key: 'notes', labelAr: 'ملاحظات', defaultHidden: true },
  { key: 'status', labelAr: 'الحالة' },
];

/** قارئُ خلايا بديلٌ بالتوقيع نفسه الذي لـ`cellText` في `reports-screen` (صفٌّ وعمود ⇒ نص). */
const readCell = (row: Record<string, unknown>, column: ScreenColumn): string =>
  String(row[column.key] ?? '—');

describe('جسرُ الشاشات إلى نظام التصميم: الأعمدةُ والحالةُ ومفتاحُ الصفّ', () => {
  it('إعلانُ العمود ⇒ عمودُ `DataTable` بكلّ سماته، والقارئُ يُستدعى بالعمود نفسه', () => {
    const mapped = tableColumns<Record<string, unknown>>(columns, readCell);
    expect(mapped.map((column) => column.key)).toEqual(['number', 'total', 'notes', 'status']);
    expect(mapped.map((column) => column.header)).toEqual(['الرقم', 'الإجمالي', 'ملاحظات', 'الحالة']);

    // ‏المحاذاةُ والاتّجاه من الإعلان لا من ذوق الصفحة.
    expect(mapped[0]).toMatchObject({ ltr: true, numeric: false });
    expect(mapped[1]).toMatchObject({ numeric: true, ltr: false });
    expect(mapped[2]).toMatchObject({ defaultHidden: true });
    expect(mapped[3]).toMatchObject({ numeric: false, ltr: false, defaultHidden: false });

    // ‏وكلُّ عمودٍ يُفرز ويُخفى — وهذا سببُ استعمال الجدول المشترك بدل جدولٍ يدويّ.
    for (const column of mapped) {
      expect(column.sortable, column.key).toBe(true);
      expect(column.hideable, column.key).toBe(true);
    }

    // ‏والخليةُ تُقرأ بالقارئ المُمرَّر (‏`cellText` في الشاشة) بالعمود نفسه — فلا قاعدةَ
    // ‏عرضٍ ثانية: وما ليس نصًّا ولا رقمًا ولا منطقيًّا يُعرض «—» هناك لا «[object Object]» هنا.
    const row = { number: 'VTX-1', total: '115.00', notes: null, status: 'posted' };
    expect(mapped[0]!.cell(row, 0)).toBe('VTX-1');
    expect(mapped[1]!.cell(row, 1)).toBe('115.00');
    expect(mapped[2]!.cell(row, 2)).toBe('—');
    // ‏والقارئُ يرى **عمودَه** لا مفتاحًا مجرّدًا (فـ`cellText` يحتاج `numeric` ليُنسّق).
    const seen: string[] = [];
    tableColumns<Record<string, unknown>>(columns, (_row, column) => {
      seen.push(column.key);
      return '';
    })[1]!.cell(row, 0);
    expect(seen).toEqual(['total']);
  });

  it('الحالاتُ الأربع بترتيبٍ مقصود: ممنوع ← تحميل ← خطأ ← جاهز', () => {
    expect(listState({})).toEqual({ kind: 'ready' });
    expect(listState({ loading: true })).toEqual({ kind: 'loading' });
    expect(listState({ error: 'تعذّر التحميل' })).toEqual({
      kind: 'error',
      message: 'تعذّر التحميل',
    });
    expect(listState({ forbidden: true, forbiddenMessage: 'reporting.view' })).toEqual({
      kind: 'forbidden',
      message: 'reporting.view',
    });
    /**
     * والترتيبُ هو الحكم: فلو عُرض «يُحمَّل» على شاشةٍ بلا صلاحية لانتظر المستخدمُ
     * تحميلًا لا يحدث، ولو عُرض «لا بيانات» مكانَ الخطأ لقِيل إنّ السجلّ فارغٌ وهو طلبٌ
     * فشل. لذا الممنوعُ يسبق التحميلَ والتحصيلَ في كلّ تركيب.
     */
    expect(
      listState({ forbidden: true, loading: true, error: 'تعذّر التحصيل' }),
    ).toEqual({ kind: 'forbidden', message: undefined });
    expect(listState({ loading: true, error: 'تعذّر التحميل' })).toEqual({ kind: 'loading' });
    // ‏وخطأٌ فارغُ النصّ لا يصير حالةَ خطأ (فـ`''` falsy) — بل جاهز، والقائمةُ الفارغة
    // ‏تقول نفسها بـ`EmptyState`.
    expect(listState({ error: '' })).toEqual({ kind: 'ready' });
    expect(listState({ error: null })).toEqual({ kind: 'ready' });
  });

  it('مفتاحُ الصفّ من أوّل حقلٍّ موجود — فالجداولُ تُعرِّف صفوفَها بحقولٍ مختلفة', () => {
    const keyOf = rowKeyFrom(['id', 'documentId', 'salesmanId', 'number']);
    expect(keyOf({ id: 'a1', documentId: 'd1' }, 0)).toBe('a1');
    expect(keyOf({ documentId: 'd1', salesmanId: 's1' }, 3)).toBe('d1');
    // ‏وجدولُ أداء المندوبين بلا `id` — فمفتاحٌ ثابتٌ يعني `undefined` مكرّرة.
    expect(keyOf({ salesmanId: 's1' }, 7)).toBe('s1');
    expect(keyOf({ number: 'VTX-9' }, 2)).toBe('VTX-9');
    // ‏والسقوطُ إلى الموضع حين لا شيء: نصٌّ فارغٌ أو قيمةٌ مفقودة.
    expect(keyOf({ id: '   ', salesmanId: '' }, 5)).toBe('row-5');
    expect(keyOf({}, 9)).toBe('row-9');
    // ‏ورقمٌ يُقبل مفتاحًا (فبعضُ الصفوف تحمل رقمًا لا نصًّا).
    expect(keyOf({ id: 42 }, 1)).toBe('42');
    // ‏و`NaN`/`Infinity` لا يصيران مفتاحًا.
    expect(keyOf({ id: Number.NaN }, 4)).toBe('row-4');
  });
});
