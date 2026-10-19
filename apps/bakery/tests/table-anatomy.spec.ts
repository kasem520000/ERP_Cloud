import { readFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const source = (name: string) => new URL(`../${name}`, import.meta.url);
const system = (name: string) => new URL(`../../../packages/ui/src/components/${name}`, import.meta.url);
/** الطبقةُ المشتركة التي تحكم تشريح الجدول في كلّ الأسطح. */
const sharedLayer = new URL('../../../packages/ui/src/tokens/controls.css', import.meta.url);

/**
 * 🧾 تشريحُ الجدول اليدويّ (‏`.bak-table`) = تشريحُ `DataTable` في نظام التصميم — وهذه
 * المثبّتةُ هي ما يمنع التباعدَ بينهما.
 *
 * وليست مثبّتةَ ذوق: فكلُّ رقمٍ هنا يُقرأ من **ملفّ المكوّن** ويُقارن بما في CSS، ولو غيّر
 * النظامُ حشوَ الخلايا أو لونَ الرأس أو قاعدةَ التظليل لسقطت وقالت «أعد القياس». والأرقامُ
 * مقروءةٌ من `packages/ui/src/components/data-table.tsx`:
 *
 * | في المكوّن | في الطبقة |
 * |---|---|
 * | ‏`<table className="w-full border-collapse text-[13px]">` | ‏`.bak-table { font-size: 13px }` |
 * | ‏`headerCell = 'sticky top-0 z-10 border-b border-line bg-surface-2 font-bold text-[10.5px] uppercase tracking-[0.055em] text-muted whitespace-nowrap'` | ‏`.bak-table thead th { position: sticky; top: 0; z-index: 10; background: var(--surface-2); font-weight: 700; font-size: 10.5px; letter-spacing: 0.055em; text-transform: uppercase; … }` |
 * | ‏`cellPad = 'px-3 py-2.5'` (و`dense` ⇒ `'px-2.5 py-1.5'`) | ‏`padding: 10px 12px` (و`.bak-table--dense` ⇒ `6px 10px`) |
 * | ‏`zebra && index % 2 === 1 && 'bg-surface-2'` | ‏`tbody tr:nth-child(even) { background: var(--surface-2) }` |
 * | ‏غلافٌ `overflow-auto rounded-xl border border-line bg-surface shadow-1` | ‏`.bak-table-wrap` بالقيم نفسها من الرموز |
 *
 * ‏**ولا `hover` على الصفوف**: فالمكوّن يضع `transition-colors duration-150` على الصفّ بلا
 * ‏`hover:bg-*`، والطبقةُ تطابقه — فإضافةُ تأثيرٍ «أجمل» هنا تعني أنّ جدولين في التطبيق
 * الواحد يتصرّفان بشكلين مختلفين، وهذا هو بالضبط ما تُمنع منه المثبّتة.
 */
describe('تشريحُ الجدول اليدويّ يطابق `DataTable` — ولا يتباعدان', () => {
  const read = async () => {
    const [component, css, shared] = await Promise.all([
      readFile(system('data-table.tsx'), 'utf8'),
      readFile(source('app/globals.css'), 'utf8'),
      readFile(sharedLayer, 'utf8'),
    ]);
    const from = css.indexOf('.bak-table-wrap');
    expect(from, 'طبقةُ `.bak-table` مفقودةٌ من globals.css').toBeGreaterThan(0);
    const start = css.lastIndexOf('/*', from);
    const layer = css.slice(start, css.indexOf('@media print', from));
    return { component, layer, shared };
  };

  it('الجدولُ والرأسُ والخلايا: الأرقامُ نفسها في الطبقة المشتركة والطبقة المحلّية', async () => {
    const { component, layer, shared } = await read();

    // المكوّنُ نفسه لم يبقَ يحمل تشريحًا خاصًّا: الحشوُ والرأسُ من الطبقة المشتركة.
    expect(component).toContain("const headerCell = '';");
    expect(component).toContain("className={cn('w-full', dense && 'table-dense')}");
    expect(component).toContain('<div className="table-wrap">');
    expect(component.includes('px-3 py-2.5'), 'حشوٌ قديمٌ عاد إلى المكوّن').toBe(false);

    // والطبقةُ المحلّية (`.bak-table`) تقرأ القيم نفسها من `controls.css`.
    expect(shared).toMatch(/table th \{[^}]*padding: 9px 12px/);
    expect(shared).toMatch(/table th \{[^}]*font-size: 11\.5px/);
    expect(shared).toMatch(/table td \{[^}]*padding: 10px 12px/);
    expect(shared).toMatch(/table td \{[^}]*font-size: 13px/);
    expect(shared).toMatch(/\.table-dense th,\s*\n\.table-dense td \{[^}]*padding: 6px 10px/);

    const th = layer.slice(layer.indexOf('.bak-table thead th'));
    const thBody = th.slice(0, th.indexOf('}'));
    expect(thBody).toContain('position: sticky');
    expect(thBody).toContain('padding: 9px 12px');
    expect(thBody).toContain('font-size: 11.5px');
    expect(thBody).toContain('background: var(--surface-2)');
    expect(thBody).toContain('text-align: start');
    expect(thBody).not.toContain('text-transform: uppercase');

    const td = layer.slice(layer.indexOf('.bak-table tbody td'));
    expect(td.slice(0, td.indexOf('}'))).toContain('padding: 10px 12px');
    const dense = layer.slice(layer.indexOf('.bak-table--dense'));
    expect(dense.slice(0, dense.indexOf('}'))).toContain('padding: 6px 10px');
  });

  it('تظليلُ الصفوف: المكوّنُ يظلّل الفرديّة، والطبقةُ المحلّية تماثله', async () => {
    const { component, layer } = await read();
    const rowClasses = component.slice(component.indexOf("'transition-colors duration-150',"));
    const rowBlock = rowClasses.slice(0, rowClasses.indexOf(')}'));
    expect(rowBlock).toContain("zebra && index % 2 === 1 && 'bg-surface-2'");
    // والطبقةُ المحلّية تظلّل الزوجيّة بترقيم CSS — الصفوفُ نفسها.
    expect(layer).toContain('.bak-table tbody tr:nth-child(even)');
    // وتمريرُ المؤشّر بلا لونٍ جديد: نفس سطح الصفحة.
    expect(layer.replace(/\s+/g, ' ')).toContain(
      '.bak-table tbody tr:hover td { background: var(--surface-2); }',
    );
  });

  it('الغلافُ غلافُ الطبقة المشتركة: تمريرٌ وحدودٌ ونصفُ قطرٍ وظلٌّ من الرموز', async () => {
    const { component, layer } = await read();
    expect(component).toContain('<div className="table-wrap">');
    const wrap = layer.slice(layer.indexOf('.bak-table-wrap'));
    const body = wrap.slice(0, wrap.indexOf('}'));
    expect(body).toContain('overflow: auto');
    expect(body).toContain('border: 1px solid var(--line)');
    expect(body).toContain('background: var(--surface)');
    expect(body).toContain('box-shadow: var(--shadow-1)');
    expect(body).toContain('border-radius: var(--radius-lg)');
    expect(layer).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it('الأرقامُ بمنازلَ ثابتة حيث وُضع `dir="ltr"` — بلا تحرير كلّ خلية', async () => {
    const { layer } = await read();
    const numeric = layer.slice(layer.indexOf(".bak-table td[dir='ltr']"));
    const body = numeric.slice(0, numeric.indexOf('}'));
    expect(body).toContain('font-variant-numeric: tabular-nums');
    expect(body).toContain('unicode-bidi: isolate');
  });

  it('ولا جدولَ يدويًّا في شاشات المخابز خارجَ الطبقة', async () => {
    /**
     * الطبقةُ تُطبَّق على الجداول التي لا تسعها `DataTable` (صفٌّ مركّبٌ قابلٌ للتوسعة في
     * ‏`/reps`، وجداولُ القرارات في `/custody`) — وأمّا القوائمُ المسطّحة فتُرحَّل إلى
     * المكوّن (كما في `/reports`). وهذا الحكمُ يمنع الحالةَ الثالثة: جدولٌ يدويٌّ بلا
     * طبقةٍ ولا مكوّن، أي شكلٌ رابعٌ في التطبيق.
     */
    const entries = await readdir(source('app'), { withFileTypes: true, recursive: true });
    const pages = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'));
    expect(pages.length).toBeGreaterThan(5);
    let tables = 0;
    for (const entry of pages) {
      const path = `${entry.parentPath}/${entry.name}`;
      /**
       * ‏وتُحذف التعليقاتُ قبل العدّ: فصفحةُ التقارير توثّق في تعليقها ما كانت عليه
       * (‏`<table className="w-full border-collapse text-[12.5px]">`) وذكرٌ في تعليقٍ ليس
       * جدولًا في الشاشة — وهو الصنفُ نفسه من الخطأ الذي أُصيب مرّتين في الأحكام النصّية
       * على المصدر (تعليقٌ يذكر الشيءَ نفيًا فيُسقط حكمَ النفي).
       */
      const text = (await readFile(path, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      const count = text.split('<table').length - 1;
      if (count === 0) continue;
      tables += count;
      // ‏والعدُّ على `<table className="bak-table` لا على `className="bak-table` — فالأخير
      // ‏يعدّ الغلافَ (`bak-table-wrap`) أيضًا فيزيد العددُ على عدد الجداول.
      const styled = text.split('<table className="bak-table').length - 1;
      expect(styled, `${path.split('/app/').pop()}: ${count} جدولًا و${styled} على الطبقة`).toBe(count);
    }
    // ‏والمسحُ لا يمرّ على صفرِ جداول فيظنّ نفسه ناجحًا.
    expect(tables).toBeGreaterThan(5);
  });
});
