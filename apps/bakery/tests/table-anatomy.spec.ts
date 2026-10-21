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
    const [component, css, shared, anatomy] = await Promise.all([
      readFile(system('data-table.tsx'), 'utf8'),
      readFile(source('app/globals.css'), 'utf8'),
      readFile(sharedLayer, 'utf8'),
      readFile(system('table.tsx'), 'utf8'),
    ]);
    const from = css.indexOf('.bak-table-wrap');
    expect(from, 'طبقةُ `.bak-table` مفقودةٌ من globals.css').toBeGreaterThan(0);
    const start = css.lastIndexOf('/*', from);
    const layer = css.slice(start, css.indexOf('@media print', from));
    return { component, layer, shared, anatomy };
  };

  it('الجدولُ والرأسُ والخلايا: الأرقامُ نفسها في الطبقة المشتركة والطبقة المحلّية', async () => {
    const { component, layer, shared, anatomy } = await read();

    /**
     * التشريحُ انتقل إلى `Table` وحدها: `DataTable` صارت مُهايئًا يُمرّر الأعمدة،
     * و`<table>` الوحيد في الحزمة هو `<table>` في `table.tsx`.
     */
    expect(component).toContain('<Table');
    expect(
      component.replace(/\/\*[\s\S]*?\*\//g, '').includes('<table'),
      'جدولٌ يدويٌّ عاد إلى DataTable',
    ).toBe(false);
    expect(anatomy).toContain('<table className="w-full border-collapse text-[13px]">');
    expect(anatomy).toContain('<div className="max-h-[70vh] overflow-auto"');
    // الحشوُ يُعرَّف مرّةً واحدةً كثابتٍ ويُستعمل في الرأس والخلايا — لا نصًّا مكرّرًا.
    expect(anatomy.match(/const cellPad =/g)?.length).toBe(1);

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
    const { anatomy, layer } = await read();
    expect(anatomy).toContain("zebra && index % 2 === 1 ? 'bg-surface-2' : ''");
    // والطبقةُ المحلّية تظلّل الزوجيّة بترقيم CSS — الصفوفُ نفسها.
    expect(layer).toContain('.bak-table tbody tr:nth-child(even)');
    // وتمريرُ المؤشّر بلا لونٍ جديد: نفس سطح الصفحة.
    expect(layer.replace(/\s+/g, ' ')).toContain(
      '.bak-table tbody tr:hover td { background: var(--surface-2); }',
    );
  });

  it('الغلافُ غلافُ الطبقة المشتركة: تمريرٌ وحدودٌ ونصفُ قطرٍ وظلٌّ من الرموز', async () => {
    const { anatomy, layer } = await read();
    expect(anatomy).toContain("'w-full overflow-hidden rounded-xl border border-line bg-surface shadow-1'");
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

  it('ولا جدولَ يدويًّا في شاشات المخابز — كلُّها على `Table` المشترك', async () => {
    /**
     * الحالةُ التي تمنعها هذه المثبّتة: جدولٌ يدويٌّ (`<table>`) بلا مكوّن — أي شكلٌ رابعٌ
     * في التطبيق. وقد أُفرغت المخابزُ من الجداول اليدويّة كلِّها: صارت القوائمُ المسطّحةُ
     * وذواتُ الصفّ المنفتح (`/reps`) وجداولُ القرارات (`/custody`) على `Table` في `@erp/ui`،
     * فبقي الحكمُ: **صفرُ جداولَ يدويّة**، مع جدولٍ واحدٍ على الأقل على المكوّن حتى لا يمرّ
     * الحكمُ على مجلّدٍ فارغ.
     */
    const entries = await readdir(source('app'), { withFileTypes: true, recursive: true });
    const pages = entries.filter((entry) => entry.isFile() && entry.name.endsWith('.tsx'));
    expect(pages.length).toBeGreaterThan(5);
    let rawTables = 0;
    let sharedTables = 0;
    const offenders: string[] = [];
    for (const entry of pages) {
      const path = `${entry.parentPath}/${entry.name}`;
      /** تُحذف التعليقاتُ قبل العدّ: ذكرُ `<table>` في تعليقٍ توثيقيٍّ ليس جدولًا في الشاشة. */
      const text = (await readFile(path, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
      const raw = text.split('<table').length - 1;
      if (raw > 0) offenders.push(`${path.split('/app/').pop()} (${raw})`);
      rawTables += raw;
      sharedTables += text.split('<Table').length - 1;
    }
    expect(offenders, 'جدولٌ يدويٌّ خارج المكوّن المشترك').toEqual([]);
    expect(rawTables).toBe(0);
    // والمسحُ لا يمرّ على صفرِ جداولٍ فيظنّ نفسه ناجحًا: المخابزُ تعرض جداولَ فعلًا.
    expect(sharedTables).toBeGreaterThan(5);
  });
});
