import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { useSubmissionKey } from '../src/use-submission-key';
import type { SubmissionKeyHandle } from '../src/use-submission-key';

/**
 * 🔑 خطّاف مفتاح الإرسال — **مقيسٌ عبر رسمٍ فعلي** (`renderToStaticMarkup`)، لأنه الوصلة بين
 * المسودة والمتتبّع النقي: لو بُني المفتاح أثناء الرسم بدل لحظة الإرسال، أو شاركت الشاشات رقماً
 * واحداً على مستوى الوحدة، لما ظهر ذلك في اختبار المتتبّع وحده.
 */
const KEY_SHAPE = /^[a-z0-9][a-z0-9-]*:[0-9a-f]{16}:[A-Za-z0-9]{1,16}$/;

const draft = { salesmanId: 's-1', itemId: 'i-1', loadedQty: '20', notes: 'توريد الصباح' };

/** يرسم المفتاح ويُخرج المقبض ليُمتحن بعد الرسم (فالرسم الساكن مرورٌ واحد بلا إعادة رسم). */
function Probe(props: { prefix: string; payload?: unknown; sink: (handle: SubmissionKeyHandle) => void }) {
  const handle = useSubmissionKey(props.prefix, props.payload);
  props.sink(handle);
  // النمط الثاني (بلا مسودة عند الرسم) لا يُستدعى `key()` إلا لحظة الإرسال، فلا يُرسم هنا.
  return <output data-testid="key">{props.payload === undefined ? '' : handle.key()}</output>;
}

function renderKey(prefix: string, payload?: unknown): { markup: string; handle: SubmissionKeyHandle | undefined } {
  let handle: SubmissionKeyHandle | undefined;
  const markup = renderToStaticMarkup(<Probe prefix={prefix} payload={payload} sink={(next) => { handle = next; }} />);
  return { markup, handle };
}

describe('useSubmissionKey', () => {
  it('يبني أثناء الرسم مفتاحاً بالشكل المطلوب للبادئة المعطاة', () => {
    const { markup } = renderKey('van-load-order', draft);
    expect(markup).toContain('<output');
    const rendered = /<output[^>]*>([^<]*)<\/output>/.exec(markup)?.[1] ?? '';
    expect(rendered).toMatch(KEY_SHAPE);
    expect(rendered.startsWith('van-load-order:')).toBe(true);
  });

  it('‏`key()` مرتان في الإرسال نفسه مفتاحٌ واحد (لا رقمَ جديداً لكلّ نداء)', () => {
    const { handle } = renderKey('van-production-batch', draft);
    expect(handle?.key()).toMatch(KEY_SHAPE);
    expect(handle?.key()).toBe(handle?.key());
  });

  it('شاشتان بمسودةٍ واحدة مفتاحاهما مختلفان: لا رقم محاولةٍ مشترك بينهما', () => {
    const first = renderKey('van-load-order', draft);
    const second = renderKey('van-load-order', draft);
    const firstKey = /<output[^>]*>([^<]*)<\/output>/.exec(first.markup)?.[1] ?? '';
    const secondKey = /<output[^>]*>([^<]*)<\/output>/.exec(second.markup)?.[1] ?? '';
    expect(firstKey).toMatch(KEY_SHAPE);
    expect(secondKey).toMatch(KEY_SHAPE);
    expect(firstKey).not.toBe(secondKey);
    // البصمة واحدة (المسودة نفسها) والاختلاف في رقم المحاولة وحده.
    expect(firstKey.slice(0, firstKey.lastIndexOf(':'))).toBe(secondKey.slice(0, secondKey.lastIndexOf(':')));
  });

  it('النمط الثاني: بلا مسودةٍ عند الرسم، `key(body)` تُتتبّع وترسم — والرسم لا يُدوّر الرقم', () => {
    const { handle } = renderKey('van-document');
    const body = { loadOrderId: 'l-1', soldQty: '12', customerName: 'محل تجزئة نقدي' };
    const first = handle?.key(body) ?? '';
    expect(first).toMatch(KEY_SHAPE);
    expect(first.startsWith('van-document:')).toBe(true);
    // إرسالٌ ثانٍ بالجسم نفسه (إعادة محاولة بعد مهلة) ⇒ المفتاح نفسه.
    expect(handle?.key(body)).toBe(first);
    expect(handle?.key({ ...body })).toBe(first);
    // وجسمٌ معدّل ⇒ نيّةٌ أخرى.
    expect(handle?.key({ ...body, soldQty: '13' })).not.toBe(first);
    // وبلا مسودةٍ مُمرَّرة: `key()` بلا حمولةٍ مرفوضٌ لا صامت.
    expect(() => renderKey('van-load-order').handle?.key()).toThrow(/لم تُتتبَّع مسودة/);
  });

  it('المقبض يُخرج `key` و`reset` ويعملان خارج الرسم: النجاح المرصود يبدأ نيّةً جديدة', () => {
    const { handle } = renderKey('van-load-order', draft);
    expect(typeof handle?.key).toBe('function');
    expect(typeof handle?.reset).toBe('function');
    const before = handle?.key() ?? '';
    handle?.reset();
    const after = handle?.key() ?? '';
    expect(before).toMatch(KEY_SHAPE);
    expect(after).toMatch(KEY_SHAPE);
    expect(after).not.toBe(before);
    // والمسودة لم تتغيّر، فالبصمة هي نفسها — تغيّر رقم المحاولة وحده.
    expect(after.slice(0, after.lastIndexOf(':'))).toBe(before.slice(0, before.lastIndexOf(':')));
  });
});
