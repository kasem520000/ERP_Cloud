import { describe, expect, it } from 'vitest';

import {
  SUBMISSION_KEY_MAX_LENGTH,
  canonicalPayloadText,
  createSubmissionKeyTracker,
  newSubmissionNonce,
  stableDigest,
  submissionIdempotencyKey,
} from '../src/idempotency';

/**
 * 🔁 مفاتيح عدم التكرار — **النيّة لا النقرة**.
 *
 * الحكم الوحيد الذي يهمّ في الإنتاج: محاولتان لنيّةٍ واحدة مفتاحُهما واحد (فلا مستندَ ثانٍ)،
 * ونيّتان مختلفتان مفتاحُهما مختلف (فلا يُبتلع إرسالٌ مقصود). وما عداهما تقنينٌ وقيودٌ تُقاس
 * هنا لأنّ كسرها صامت: لو اختلف المفتاح بترتيب حقول المسودة لانكسرت الحماية عند أول إعادة
 * ترتيبٍ في `useMemo`، ولو ابتلع المحتوى وحده النيّةَ الثانية لظنّ المندوب أنّ تحصيله سُجّل.
 */
const KEY_SHAPE = /^[a-z0-9][a-z0-9-]*:[0-9a-f]{16}:[A-Za-z0-9]{1,16}$/;

describe('canonicalPayloadText — النصّ القانوني هو ما يصل إلى السلك', () => {
  it('يرتّب المفاتيح فلا يغيّر ترتيبُ الحقول النصّ (متداخلاً كذلك)', () => {
    expect(canonicalPayloadText({ b: 2, a: 1, c: { z: [1, 2], y: 'x' } })).toBe(
      canonicalPayloadText({ a: 1, c: { y: 'x', z: [1, 2] }, b: 2 }),
    );
    expect(canonicalPayloadText({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
  });

  it('يحذف `undefined` كما يحذفه `JSON.stringify` في جسم الطلب', () => {
    expect(canonicalPayloadText({ a: 1, b: undefined })).toBe('{"a":1}');
    expect(canonicalPayloadText({ a: 1, b: undefined })).toBe(canonicalPayloadText({ a: 1 }));
    // داخل مصفوفةٍ يصير `null` لا حذفاً — وهو سلوك `JSON.stringify` نفسه.
    expect(canonicalPayloadText([1, undefined, 3])).toBe('[1,null,3]');
  });

  it('يفرّق النوعين كما يفرّقهما الخادم: ‏«10» نصٌّ و10 عدد', () => {
    expect(canonicalPayloadText({ qty: '10' })).not.toBe(canonicalPayloadText({ qty: 10 }));
    expect(canonicalPayloadText({ qty: null })).not.toBe(canonicalPayloadText({ qty: undefined }));
    expect(canonicalPayloadText({ qty: 0 })).not.toBe(canonicalPayloadText({ qty: false }));
  });

  it('يصيّر `Date` معياريّاً و`NaN`/`Infinity` إلى `null`', () => {
    expect(canonicalPayloadText({ at: new Date('2026-10-15T06:00:00.000Z') })).toBe('{"at":"2026-10-15T06:00:00.000Z"}');
    expect(canonicalPayloadText({ at: new Date('ليس تاريخاً') })).toBe('{"at":null}');
    expect(canonicalPayloadText({ n: Number.NaN, i: Number.POSITIVE_INFINITY })).toBe('{"i":null,"n":null}');
  });

  it('يستدعي `toJSON` إن وُجد (فلا تُبصَم بنية الكائن الداخلية)', () => {
    const decimalLike = { toJSON: () => '12.5000', d: [1, 2], s: 1 };
    expect(canonicalPayloadText({ unitCost: decimalLike })).toBe('{"unitCost":"12.5000"}');
  });

  it('يرفض المسودة الدائرية برسالةٍ واضحة بدل مفتاحٍ خاطئ', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic['self'] = cyclic;
    expect(() => canonicalPayloadText(cyclic)).toThrow(/دائرية/);
    // الكائن نفسه في فرعين شقيقين ليس دائرة.
    const shared = { id: 'x' };
    expect(canonicalPayloadText({ first: shared, second: shared })).toBe('{"first":{"id":"x"},"second":{"id":"x"}}');
  });
});

describe('stableDigest — بصمةٌ ثابتة الطول', () => {
  it('يثبّت قيمتين ذهبيّتين: تغيّرُ الخوارزمية يغيّر مفاتيح عملاءٍ في منتصف الإرسال', () => {
    expect(stableDigest('')).toBe('811c9dc501000193');
    expect(stableDigest('abc')).toBe('ae1e997d64b2be7b');
    expect(stableDigest('توريد')).toBe('4185ff2d6f79c20b');
  });

  it('يُميّز النصّ العربي حرفاً حرفاً (لا يُهمل البايت الأعلى)', () => {
    expect(stableDigest('توريد')).not.toBe(stableDigest('تورير'));
    expect(stableDigest('توريد')).toBe(stableDigest('توريد'));
    expect(stableDigest('أ')).not.toBe(stableDigest('آ'));
  });

  it('طوله 16 خانة سداسية لكلّ مدخل', () => {
    for (const text of ['', 'a', 'ملاحظات طويلة '.repeat(40), 'x'.repeat(5000)]) {
      expect(stableDigest(text)).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe('submissionIdempotencyKey — الشكل والقيود', () => {
  it('يبني مفتاحاً بالشكل المقروء في السجلات', () => {
    const key = submissionIdempotencyKey('van-load-order', { loadedQty: '20' }, 'Ab3xY9');
    expect(key).toMatch(KEY_SHAPE);
    expect(key.startsWith('van-load-order:')).toBe(true);
    expect(key.endsWith(':Ab3xY9')).toBe(true);
    expect(key.length).toBeLessThanOrEqual(SUBMISSION_KEY_MAX_LENGTH);
  });

  it('يثبت للمسودة نفسها ويختلف لأيّ تغييرٍ فيها', () => {
    const payload = { salesmanId: 's-1', itemId: 'i-1', loadedQty: '20', notes: 'توريد الصباح' };
    expect(submissionIdempotencyKey('van-load-order', payload, 'n1')).toBe(
      submissionIdempotencyKey('van-load-order', { ...payload }, 'n1'),
    );
    expect(submissionIdempotencyKey('van-load-order', { ...payload, loadedQty: '21' }, 'n1')).not.toBe(
      submissionIdempotencyKey('van-load-order', payload, 'n1'),
    );
    expect(submissionIdempotencyKey('van-load-order', payload, 'n2')).not.toBe(
      submissionIdempotencyKey('van-load-order', payload, 'n1'),
    );
    expect(submissionIdempotencyKey('van-production-batch', payload, 'n1')).not.toBe(
      submissionIdempotencyKey('van-load-order', payload, 'n1'),
    );
  });

  it('يبقى داخل السقف ولو كبرت المسودة (قائمة بنود طويلة)', () => {
    const lines = Array.from({ length: 400 }, (_, index) => ({ itemId: `item-${index}`, qty: `${index}`, notes: 'ملاحظة' }));
    const key = submissionIdempotencyKey('van-production-batch', { lines, notes: 'x'.repeat(4000) }, newSubmissionNonce());
    expect(key.length).toBeLessThanOrEqual(SUBMISSION_KEY_MAX_LENGTH);
    expect(key).toMatch(KEY_SHAPE);
  });

  it('يرفض بادئةً أو رقم محاولةٍ يكسران الشكل — خطأُ مبرمجٍ لا يُبتلع', () => {
    for (const prefix of ['', 'Van Load', 'van_load', 'مفتاح', '-van', 'van:load']) {
      expect(() => submissionIdempotencyKey(prefix, { a: 1 }, 'n1'), prefix).toThrow(/بادئة/);
    }
    for (const nonce of ['', 'n 1', 'n-1', 'n:1', 'محاولة']) {
      expect(() => submissionIdempotencyKey('van-load-order', { a: 1 }, nonce), nonce).toThrow(/رقم محاولة/);
    }
  });
});

describe('newSubmissionNonce', () => {
  it('ألف رقمٍ متمايزة بالشكل المسموح', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 1000; index += 1) {
      const nonce = newSubmissionNonce();
      expect(nonce).toMatch(/^[A-Za-z0-9]{1,16}$/);
      seen.add(nonce);
    }
    expect(seen.size).toBe(1000);
  });

  it('يعمل بلا `crypto.randomUUID` (متصفّحٌ قديم أو سياقٌ غير آمن)', () => {
    const original = globalThis.crypto;
    try {
      Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
      const nonce = newSubmissionNonce();
      expect(nonce).toMatch(/^[A-Za-z0-9]{1,16}$/);
      expect(submissionIdempotencyKey('van-load-order', { a: 1 }, nonce)).toMatch(KEY_SHAPE);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
    }
  });
});

describe('createSubmissionKeyTracker — الحماية المطلوبة في الإنتاج', () => {
  it('محاولتان لنيّةٍ واحدة مفتاحُهما واحد (وهذا ما يمنع المستند الثاني)', () => {
    const tracker = createSubmissionKeyTracker('van-load-order');
    tracker.track({ salesmanId: 's-1', loadedQty: '20' });
    const first = tracker.key();
    // نقرةٌ مزدوجة، ثم إعادة محاولة بعد مهلة شبكة، ثم رسمٌ جديد: المفتاح نفسه.
    expect(tracker.key()).toBe(first);
    tracker.track({ salesmanId: 's-1', loadedQty: '20' });
    expect(tracker.key()).toBe(first);
    tracker.track({ loadedQty: '20', salesmanId: 's-1' });
    expect(tracker.key()).toBe(first);
  });

  it('تغيّر المسودة نيّةٌ أخرى فمفتاحٌ آخر', () => {
    const tracker = createSubmissionKeyTracker('van-load-order');
    tracker.track({ loadedQty: '20' });
    const first = tracker.key();
    tracker.track({ loadedQty: '25' });
    expect(tracker.key()).not.toBe(first);
    // والعودة إلى القيمة الأولى نيّةٌ جديدة كذلك (لا يُعاد المفتاح القديم).
    tracker.track({ loadedQty: '20' });
    expect(tracker.key()).not.toBe(first);
  });

  it('‏`reset()` بعد نجاحٍ رُصد يجعل الثانية المقصودة مستنداً جديداً لا صدىً للأول', () => {
    const tracker = createSubmissionKeyTracker('van-production-batch');
    const draft = { itemId: 'i-1', producedQty: '100' };
    tracker.track(draft);
    const first = tracker.key();
    tracker.reset();
    tracker.track(draft);
    const second = tracker.key();
    expect(second).not.toBe(first);
    expect(second.slice(0, second.lastIndexOf(':'))).toBe(first.slice(0, first.lastIndexOf(':')));
  });

  it('‏`key(payload)` تتبّعٌ وبناءٌ في نداءٍ واحد', () => {
    const tracker = createSubmissionKeyTracker('van-load-order');
    const key = tracker.key({ salesmanId: 's-1', loadedQty: '20' });
    expect(key).toMatch(KEY_SHAPE);
    expect(tracker.key()).toBe(key);
    expect(tracker.key({ salesmanId: 's-1', loadedQty: '20' })).toBe(key);
  });

  it('بلا مسودةٍ مُتتبَّعة يرفض — فمفتاحٌ مشترك لكلّ الإرسالات ثغرةٌ لا تسهيل', () => {
    const tracker = createSubmissionKeyTracker('van-load-order');
    expect(() => tracker.key()).toThrow(/لم تُتتبَّع مسودة/);
    tracker.track({ a: 1 });
    expect(() => tracker.key()).not.toThrow();
  });

  it('متتبّعان مستقلّان: لا رقم محاولةٍ مشترك على مستوى الوحدة', () => {
    const draft = { itemId: 'i-1', producedQty: '100' };
    const first = createSubmissionKeyTracker('van-production-batch');
    const second = createSubmissionKeyTracker('van-production-batch');
    first.track(draft);
    second.track(draft);
    expect(first.key()).not.toBe(second.key());
  });
});
