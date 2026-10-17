import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const source = (name: string) => new URL(`../${name}`, import.meta.url);
const system = (name: string) => new URL(`../../../packages/ui/src/components/${name}`, import.meta.url);

/**
 * 📱 تمريرُ الجوال على شاشات المخابز كلّها — ومثبّتتُه تقرأ **مصدرَ نظام التصميم** لتقول
 * لماذا الرفعُ لازم، لا أنّ الرفعَ موجودٌ فحسب.
 *
 * فالحكمُ هنا مزدوجُ الطرف: (١) في `@erp/ui` أحجامٌ أصغرُ من هدف الإبهام وخطُّ إدخالٍ أدنى
 * من ١٦px (مقاسٌ من `FIELD_BASE` و`SIZES`)، و(٢) في `globals.css` رفعٌ لهما تحت
 * ‏`@media (max-width: 640px)`. ولو رفع النظامُ أحجامَه يومًا سقط الطرفُ الأول ⇒ وسُحب
 * الرفعُ بدل أن يبقى CSS ميتًا يُوهم أنّ أحدًا قرّره. وهذا هو الفرقُ بين تعويضٍ مُوثَّق
 * وتعويضٍ منسيّ.
 *
 * وهي مثبّتةٌ نصّيةٌ كسائر مثبّتات التصميم هنا (لا متصفّحَ في اختبارات المستودع)، وما
 * تُثبته أنّ القرارَ مكتوبٌ حيث يجب.
 */
describe('تمريرُ الجوال على شاشات المخابز: تعويضٌ مقاسٌ عن أحجام نظام التصميم', () => {
  it('السببُ قائمٌ في `@erp/ui`: أحجامٌ دون ٤٤px وخطُّ إدخالٍ دون ١٦px', async () => {
    const button = await readFile(system('button.tsx'), 'utf8');
    const input = await readFile(system('input.tsx'), 'utf8');

    // ‏`sm: h-8` = ‏٣٢px و`md: h-9` = ‏٣٦px — وكلاهما دون إرشاد المنصّتين (٤٤px).
    expect(button).toMatch(/sm:\s*'h-8/);
    expect(button).toMatch(/md:\s*'h-9/);
    // ‏و`FIELD_BASE` بارتفاع ٣٦px وخطّ ١٣.٥ ⇒ iOS يُكبّر الصفحة عند التركيز ولا يعود.
    expect(input).toContain("const FIELD_BASE =");
    expect(input).toMatch(/h-9[^']*text-\[13\.5px\]/);
  });

  it('والرفعُ مكتوبٌ تحت ٦٤٠px: هدفُ لمسٍ ٤٤px وخطُّ إدخالٍ ١٦px', async () => {
    const css = await readFile(source('app/globals.css'), 'utf8');
    const from = css.indexOf('تمريرُ الجوال على شاشات المخابز');
    expect(from, 'طبقةُ تمرير الجوال مفقودة').toBeGreaterThan(0);
    const block = css.slice(from, css.indexOf('@media print', from));

    expect(block).toContain('@media (max-width: 640px)');
    expect(block).toContain('min-height: 44px');
    expect(block).toContain('font-size: 16px');
    // ‏ويُستثنى وسمُ حالة تطبيق المندوب فحجمُه هناك مقصود.
    expect(block).toContain('button:not(.rep-pill)');
    /**
     * ‏و`min-height` لا `height`: فرفعٌ لا استبدال، ولا يكسر زرًّا أكبر. والنمطُ بنظرةٍ
     * خلفيةٍ لا بـ`\b`: فالشرطةُ في `min-height` حدُّ كلمةٍ عند `\b`، فكان التعبيرُ
     * يُصيب `min-height: 44px` نفسها ويسقط الحكمُ على الصواب (وقِيس: ‏`expected … not to
     * match /\bheight:\s*44px/`).
     */
    expect(block).not.toMatch(/(?<![-\w])height:\s*44px/);
    // ‏والمناطقُ الآمنة والتمريرُ السلس للجداول.
    expect(block).toContain('env(safe-area-inset-bottom');
    expect(block).toContain('-webkit-overflow-scrolling: touch');
  });

  it('التعويضُ في هذه الواجهة لا في النظام — فلا يمسّ `staff` وسائرَ المستهلكين', async () => {
    const css = await readFile(source('app/globals.css'), 'utf8');
    const from = css.indexOf('تمريرُ الجوال على شاشات المخابز');
    const block = css.slice(from, css.indexOf('@media print', from));
    // ‏كلُّ قواعد الرفع مقيّدةٌ بـ`.bak-main` (قشرةُ هذه الواجهة) لا بعناصرَ عامّة.
    const rules = block
      .split('}')
      .map((chunk) => chunk.slice(chunk.lastIndexOf('}') + 1))
      .filter((chunk) => chunk.includes('min-height: 44px') || chunk.includes('font-size: 16px'));
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      const selector = rule.slice(0, rule.indexOf('{'));
      expect(selector, `قاعدةٌ بلا تقييدٍ بالقشرة: ${selector}`).toContain('.bak-main');
    }
  });
});
