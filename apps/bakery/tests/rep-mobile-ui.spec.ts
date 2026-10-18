import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const source = (name: string) => new URL(`../${name}`, import.meta.url);

/**
 * 📱 تصميمُ تطبيق المندوب للجوال — أحكامٌ على **قراراتٍ مقاسةٍ لا ذوق**.
 *
 * وهذه مثبّتةٌ نصّية (على نمط `offline-pos.spec.ts` في الطاقم و`van-queue-store.spec.ts` في
 * ‏`web-core`): فالمستودعُ لا يملك متصفّحًا في الاختبارات، وما يُقاس هنا أنّ القرارَ
 * **مكتوبٌ حيث يجب** — لا أنّ الهاتفَ رسمه. ومن يقول إنّ تصميمًا «يظهر صحيحًا» من دون جهازٍ
 * فقد زاد على القياس؛ ولهذا يبقى «جهازٌ حقيقيّ» بندًا مفتوحًا في وثيقة التسليم.
 *
 * والأرقامُ المثبّتة أدناه كلّها لها سببٌ يُقال:
 *
 * | القرار | السبب |
 * |---|---|
 * | هدفُ لمسٍ ≥ ٤٨px | إرشادُ المنصّتين ٤٤ فأكثر، والمندوبُ يمسك الهاتفَ بيدٍ واحدة في سيارةٍ تهتزّ |
 * | خطُّ الإدخال ١٦px بالضبط | أدنى منه يُكبّر iOS الصفحةَ عند التركيز ولا يعود، فينكسر التخطيطُ في كلّ نموذج |
 * | ‏`env(safe-area-inset-*)` + ‏`viewport-fit=cover` | بلاهما يختفي آخرُ زرٍّ خلف شريط iPhone السفليّ |
 * | ‏`tabular-nums` + ‏`direction: ltr` + ‏`unicode-bidi: isolate` + ‏`--font-num` | أرقامُ المال في واجهةٍ عربيةٍ تُقرأ يسارًا‑يمينًا، وبلا منازلَ ثابتةٍ تتراقص بين سطرين |
 * | لا `<table>` في الشاشة | جدولٌ بستّة أعمدة على ٣٦٠px يعني تمريرًا أفقيًّا يُخفي العمودَ الذي يُقرأ |
 * | ‏`var(--…)` فقط، ولا لونٌ ستّ عشريّ | نظامُ تصميمٍ واحد (‏ADR-030): فلا لوحةَ ألوانٍ ثانيةً في تطبيق |
 * | ‏`themeColor` في الجذر = ‏`theme_color` في الـmanifest | لونُ شريط النظام ولونُ الترويسة شيءٌ واحد لا ذوقان |
 */
describe('تصميمُ تطبيق المندوب للجوال: قراراتٌ مقاسةٌ مثبّتة', () => {
  const read = async () => {
    const [page, css, layout, manifestRaw] = await Promise.all([
      readFile(source('app/rep/page.tsx'), 'utf8'),
      readFile(source('app/globals.css'), 'utf8'),
      readFile(source('app/layout.tsx'), 'utf8'),
      readFile(source('public/manifest.webmanifest'), 'utf8'),
    ]);
    const from = css.indexOf('تطبيقُ المندوب (`/rep`)');
    expect(from, 'طبقةُ تصميم المندوب مفقودةٌ من globals.css').toBeGreaterThan(0);
    const repCss = css.slice(from, css.indexOf('@media print', from));
    return { page, css, repCss, layout, manifest: JSON.parse(manifestRaw) as Record<string, unknown> };
  };

  it('لا جدولَ في شاشة المندوب: صفوفٌ بطاقيةٌ تُقرأ بلا تمريرٍ أفقيّ', async () => {
    const { page } = await read();
    expect(page).not.toContain('<table');
    expect(page).not.toContain('<thead');
    expect(page).toContain('className="rep-rows"');
    expect(page).toContain('className="rep-row"');
    // ‏وكلُّ قائمةٍ (طابور، توريدات، مستندات، أوامر، أرصدة، تحصيلات، إشعارات) صفوفٌ بطاقية.
    expect((page.match(/className="rep-rows"/g) ?? []).length).toBeGreaterThanOrEqual(7);
  });

  it('أهدافُ اللمس ≥ ٤٨px وارتفاعُ النظام مرفوعٌ بـ`max()` لا برقمٍ موازٍ', async () => {
    const { repCss } = await read();
    expect(repCss).toContain('min-height: max(var(--control-h), 48px)');
    expect(repCss).toContain('min-height: max(var(--control-h), 46px)');
    // ‏والرفعُ عن ارتفاع النظام (‏٣٦px) مقصودٌ ومُوثَّق، لا رقمٌ جديدٌ بجانبه.
    expect(repCss).toContain('--control-h');
    expect(repCss).not.toContain('min-height: 48px;');
  });

  it('خطُّ الإدخال ١٦px — حدٌّ أدنى إجباريٌّ لا ذوق (iOS يُكبّر الصفحة بدونه)', async () => {
    const { repCss } = await read();
    const fieldRule = repCss.slice(repCss.indexOf('.rep-field input'));
    expect(fieldRule.slice(0, fieldRule.indexOf('}'))).toContain('font-size: 16px');
    // ‏والحقولُ في الصفحة تحمل هذا الصنفَ فعلًا، لا أنّ القاعدةَ مكتوبةٌ وبلا مستعمل.
    const { page } = await read();
    expect(page).toContain('className="rep-field"');
    expect((page.match(/className="rep-field"/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it('المناطقُ الآمنة: ‏`viewport-fit=cover` في الجذر و`env(safe-area-inset-*)` في الطبقة', async () => {
    const { layout, repCss } = await read();
    expect(layout).toContain("viewportFit: 'cover'");
    expect(repCss).toContain('env(safe-area-inset-bottom');
    /**
     * ‏وبلا `maximumScale`: فمنعُ التكبير قرارُ وصوليةٍ يُتّخذ ضدّ المستخدم. والحكمُ على
     * **شكل الخاصّية** (`maximumScale:`) لا على الكلمة: فشرحُ الجذر يذكرها نفيًا، وحكمٌ نصيٌّ
     * كان سيسقط على تعليقٍ يقول عكسَ ما يُتَّهم به — وهو الصنفُ نفسه الذي سقط مرتين في
     * مثبّتتَي `van-queue-store` و`rep-pwa`.
     */
    expect(layout).not.toMatch(/maximumScale\s*:/);
  });

  it('أرقامُ المال: منازلُ ثابتةٌ واتّجاهٌ معزولٌ وخطُّ النظام الرقمي', async () => {
    const { repCss, page } = await read();
    for (const rule of ['.rep-num', '.rep-tile-value']) {
      const block = repCss.slice(repCss.indexOf(`${rule} {`));
      const body = block.slice(0, block.indexOf('}'));
      expect(body, `${rule}: بلا منازلَ ثابتة`).toContain('font-variant-numeric: tabular-nums');
      expect(body, `${rule}: بلا عزلِ اتّجاه`).toContain('unicode-bidi: isolate');
      expect(body, `${rule}: بلا خطٍّ رقميّ`).toContain('var(--font-num)');
    }
    expect(repCss).toContain('direction: ltr');
    // ‏والصفحةُ تستعمل الصنفَ على الأرقام المعروضة (لا أنّ القاعدةَ زينة).
    expect((page.match(/className="rep-num"/g) ?? []).length).toBeGreaterThanOrEqual(10);
    // ‏ولوحاتُ الإدخال الرقمية تطلب لوحةَ أرقامٍ على الهاتف.
    expect(page).toContain('inputMode="decimal"');
  });

  it('نظامُ تصميمٍ واحد: رموزُ `var(--…)` ولا لونٌ ستّ عشريّ في طبقة المندوب (‏ADR-030)', async () => {
    const { repCss } = await read();
    expect(repCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(repCss).toContain('var(--line)');
    expect(repCss).toContain('var(--surface)');
    expect(repCss).toContain('var(--radius-lg)');
    expect(repCss).toContain('var(--focus-ring)');
    expect(repCss).toContain('var(--dur-fast)');
    // ‏والأنصافُ من مقياس النظام لا أرقامٌ جديدة.
    expect(repCss).not.toContain('border-radius: 14px');
    expect(repCss).not.toContain('border-radius: 12px');
  });

  it('لونُ الترويسة واحدٌ في الجذر والـmanifest — لا ذوقان', async () => {
    const { layout, manifest } = await read();
    const theme = String(manifest.theme_color ?? '');
    expect(theme.length, 'الـmanifest بلا theme_color').toBeGreaterThan(0);
    expect(layout).toContain(`themeColor: '${theme}'`);
  });

  it('شريطُ الحالة لاصقٌ ويُظهر الشبكةَ والطابور — فالضغطُ إرسالٌ أو حفظٌ بحسبها', async () => {
    const { repCss, page } = await read();
    const bar = repCss.slice(repCss.indexOf('.rep-statusbar {'));
    expect(bar.slice(0, bar.indexOf('}'))).toContain('position: sticky');
 expect(page).toContain("online ? 'متصل' : 'دون اتصال'");
    // ‏وعددُ المعلّق والمرفوض ظاهران بلا تمرير.
    expect(page).toContain('{counts.pending}');
    expect(page).toContain('مرفوض');
  });

  it('الألوانُ تحمل المعنى بـ`data-tone` لا بأصنافٍ مكتوبةٍ في الصفحة', async () => {
    const { page, repCss } = await read();
    // ‏الصفحةُ تقول «تحذير» والـCSS يقرّر كيف يبدو — فلا ذوقَ في كلّ شاشة.
    expect(page).toContain('data-tone="warn"');
    expect(page).toContain('data-tone="danger"');
    expect(page).not.toContain('NOTICE_CLASSES');
    expect(repCss).toContain(".rep-note[data-tone='warn']");
    expect(repCss).toContain(".rep-pill[data-tone='danger']");
  });

  it('الطباعةُ ليست من هذه الشاشة: السندُ يُطبع من شاشة المستندات بنسختيه', async () => {
    const { css } = await read();
    /**
     * ‏وفي الملفّ كتلتا `@media print` (قشرةُ المكتب وطبقةُ المندوب) — فالحكمُ على كتلة
     * المندوب من علامتها لا من «آخر» كتلةٍ في الملفّ، وإلا قِستُ كتلةَ غيري.
     */
    const repLayer = css.slice(css.indexOf('تطبيقُ المندوب (`/rep`)'));
    const printBlock = repLayer.slice(repLayer.indexOf('@media print'));
    expect(printBlock).toContain('.rep-statusbar, .rep-actions, .rep-btn');
    expect(printBlock).toContain('display: none !important');
  });
});
