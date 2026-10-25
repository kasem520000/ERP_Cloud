import { describe, expect, it } from 'vitest';
import { canonicalPayloadText, stableDigest } from '@erp/web-core/idempotency';
import type { VanQueueRecord } from '@erp/web-core/offline-db';

import {
  buildQueueIdempotencyKey,
  classifyReplay,
  countQueue,
  endpointFor,
  isQueueable,
  NOT_QUEUEABLE_OPERATIONS,
  QUEUEABLE_OPERATIONS,
  queueSummaryLine,
  queueVerdict,
  REP_PERMISSIONS,
  REP_QUEUE_MESSAGES,
  syncPlan,
} from '../lib/rep-queue';

/**
 * 🚐 طابورُ المندوب — الأحكامُ على المنطق النقيّ (لا شبكةَ ولا IndexedDB هنا).
 *
 * والمساراتُ والصلاحياتُ المثبّتةُ أدناه هي **المقاسةُ من `van-sales.controller.ts`**:
 * ‏`POST /van-sales/documents` بـ`van_sales.invoice.create` (‏:٢٣٢)، و
 * `POST /van-sales/documents/:id/returns` بالصلاحية نفسها (‏:١٩٥)، و
 * `POST /van-sales/collections` بـ`van_sales.collection.create` (‏:٤٣٥)، و
 * `POST /van-sales/load-orders/:id/submit-closing` بـ`van_sales.closing.submit` (‏:٣١١)، و
 * `POST /van-sales/load-orders/:id/confirm-receipt` بـ`van_sales.view` (‏:١٧٦). فلو تغيّر
 * مسارٌ أو رمزٌ في الخادم سقط حكمٌ هنا — وهذا هو المقصود: أن يبقى الوجه رقيقًا فوق
 * العقد نفسه لا فوق نسخةٍ منه.
 */
const record = (overrides: Partial<VanQueueRecord> = {}): VanQueueRecord => ({
  offlineId: 'VAN-dev-1-abc',
  deviceId: 'dev',
  sequenceNo: 1,
  createdAt: '2026-10-16T05:00:00.000Z',
  operation: 'document',
  endpoint: '/van-sales/documents',
  body: { loadOrderId: 'load-1', idempotencyKey: 'rep-document:x:y' },
  idempotencyKey: 'rep-document:x:y',
  status: 'pending',
  attempts: 0,
  lastAttemptAt: null,
  lastStatusCode: null,
  lastErrorCode: null,
  lastMessage: null,
  label: 'VLO-0001',
  ...overrides,
});

describe('طابور المندوب: ما يُحفظ، وما لا يُحفظ ولماذا، وكيف تُقرأ الإعادة', () => {
  it('المساراتُ والصلاحياتُ هي عقودُ الخادم نفسها', () => {
    expect(QUEUEABLE_OPERATIONS.document.endpointOf()).toBe('/van-sales/documents');
    expect(QUEUEABLE_OPERATIONS.return.endpointOf('doc-9')).toBe('/van-sales/documents/doc-9/returns');
    expect(QUEUEABLE_OPERATIONS.collection.endpointOf()).toBe('/van-sales/collections');
    expect(QUEUEABLE_OPERATIONS.document.permission).toBe('van_sales.invoice.create');
    expect(QUEUEABLE_OPERATIONS.return.permission).toBe('van_sales.invoice.create');
    expect(QUEUEABLE_OPERATIONS.collection.permission).toBe('van_sales.collection.create');
    expect(REP_PERMISSIONS.closing).toBe('van_sales.closing.submit');
    expect(endpointFor('closing', 'load-3')).toBe('/van-sales/load-orders/load-3/submit-closing');
    expect(endpointFor('receipt', 'load-3')).toBe('/van-sales/load-orders/load-3/confirm-receipt');
    // ‏ولا مسارَ مزامنةٍ جماعية مخترع: فالإعادةُ نيّةٌ نيّةً إلى مسارها الرسميّ.
    expect(NOT_QUEUEABLE_OPERATIONS.closing.permission).toBe('van_sales.closing.submit');
    expect(NOT_QUEUEABLE_OPERATIONS.receipt.permission).toBe('van_sales.view');
  });

  it('الإقفالُ والاستلامُ خارج الطابور، ولكلٍّ سببُه المقاس — لا «غير آمن» على عواهنه', () => {
    expect(isQueueable('document')).toBe(true);
    expect(isQueueable('return')).toBe(true);
    expect(isQueueable('collection')).toBe(true);
    expect(isQueueable('closing')).toBe(false);
    expect(isQueueable('receipt')).toBe(false);

    /**
     * سببُ الإقفال: بلا مفتاحٍ في الجسم، و`submitClosing` لا يرفض إعادةَ الإرسال ما دام
     * الأمرُ `pending_closing` (يرفض ٤٠٩ `VAN_LOAD_ORDER_ALREADY_SETTLED` إذا صارت
     * ‏`settled` فقط) ⇒ الإعادةُ العمياء تعيد كتابةَ إعلان الجرد.
     */
    expect(NOT_QUEUEABLE_OPERATIONS.closing.reasonAr).toContain('لا يحمل مفتاحَ عدم تكرار');
    expect(NOT_QUEUEABLE_OPERATIONS.closing.reasonAr).toContain('إعلان الجرد');
    /**
     * وسببُ الاستلام **مختلف**: فله حارسُ حالةٍ يجعل الإعادةَ مرفوضةً ٤٠٩
     * (‏`VAN_LOAD_ORDER_NOT_AWAITING_RECEIPT`) — فلا ضررَ على المخزون، لكنّ نيّةً ناجحةً
     * تظهر خطأً. ولو كُتب السببان بنصٍّ واحدٍ لكان أحدهما كذبًا.
     */
    expect(NOT_QUEUEABLE_OPERATIONS.receipt.reasonAr).toContain('٤٠٩');
    expect(NOT_QUEUEABLE_OPERATIONS.receipt.reasonAr).toContain('تم تأكيد استلام أمر التحميل هذا مسبقًا');
    expect(NOT_QUEUEABLE_OPERATIONS.receipt.reasonAr).not.toBe(NOT_QUEUEABLE_OPERATIONS.closing.reasonAr);
  });

  it('مفتاحُ النيّة من مخطّط المفاتيح نفسه: بادئةٌ وبصمةُ الحمولة ورقمُ محاولة', () => {
    const body = { loadOrderId: 'load-1', soldQty: '2', unitPrice: '10', paymentMethod: 'credit' };
    const key = buildQueueIdempotencyKey('document', body);
    const [prefix, digest, nonce] = key.split(':');
    expect(prefix).toBe('rep-document');
    expect(nonce).toMatch(/^[A-Za-z0-9]+$/);
    // ‏والبصمةُ من الحمولة المقنَّنة نفسها — فلا مخطّطَ بصماتٍ ثانٍ في هذا الوجه.
    expect(digest).toBe(stableDigest(canonicalPayloadText(body)));
    expect(key.length).toBeLessThanOrEqual(120);

    // ‏نيّةٌ واحدةٌ مفتاحٌ واحد: الحمولةُ نفسها ⇒ بصمةٌ نفسها، ورقمُ المحاولة هو ما يختلف.
    const again = buildQueueIdempotencyKey('document', body);
    expect(again.split(':')[1]).toBe(digest);
    // ‏وترتيبُ الحقول لا يغيّر البصمة (فالتقنينُ يرتّب المفاتيح) — وهذا ما كان ينكسر بصمت.
    const reordered = buildQueueIdempotencyKey('document', {
      paymentMethod: 'credit',
      unitPrice: '10',
      soldQty: '2',
      loadOrderId: 'load-1',
    });
    expect(reordered.split(':')[1]).toBe(digest);
    // ‏ونيّةٌ مختلفة ⇒ بصمةٌ مختلفة (فلا تُعاد نيّةٌ مكان أخرى).
    expect(buildQueueIdempotencyKey('document', { ...body, soldQty: '3' }).split(':')[1]).not.toBe(digest);
    // ‏ولكلّ عمليّةٍ بادئتُها كي يُقرأ في السجلّ نوعُ النيّة.
    expect(buildQueueIdempotencyKey('return', body).startsWith('rep-return:')).toBe(true);
    expect(buildQueueIdempotencyKey('collection', body).startsWith('rep-collection:')).toBe(true);
  });

  it('تصنيفُ الإعادة: ما وصل وصل، وما رُفض قيل، وما لم يصل بقي', () => {
    expect(classifyReplay({ status: 201 }).nextStatus).toBe('synced');
    expect(classifyReplay({ status: 200, detail: 'تم' }).nextStatus).toBe('synced');

    // ‏انقطاعُ الشبكة: لا حالةٌ أصلاً ⇒ `pending` (فالنيّةُ لم تُرفض، بل لم تصل).
    expect(classifyReplay({}).nextStatus).toBe('pending');
    expect(classifyReplay({ status: null }).nextStatus).toBe('pending');
    // ‏وخطأُ الخادم كذلك: لا يُرفض محليًّا ما لم يقل الخادم إنّه مرفوض.
    expect(classifyReplay({ status: 500 }).nextStatus).toBe('pending');
    expect(classifyReplay({ status: 503 }).nextStatus).toBe('pending');

    // ‏والرفضُ برسالة الخادم العربية كما هي — لا ترجمةً ولا تلخيصًا.
    const refused = classifyReplay({
      status: 422,
      code: 'VALIDATION_FAILED',
      detail: 'لا يمكن إصدار فاتورة ضريبية (ZATCA) وهويّةُ البائع ناقصة: الرقم الضريبي غير مُدخلٍ في بيانات المنشأة.',
    });
    expect(refused.nextStatus).toBe('refused');
    expect(refused.reasonAr).toContain('هويّةُ البائع ناقصة');
    expect(classifyReplay({ status: 403, detail: 'permission van_sales.invoice.create required' }).nextStatus).toBe(
      'refused',
    );
    expect(classifyReplay({ status: 404, detail: 'أمر التحميل غير موجود' }).reasonAr).toBe(
      'أمر التحميل غير موجود',
    );
    // ‏وتعديلُ نيّةٍ بعد حفظها يُكشف ولا يُعاد عمياءً.
    const replay = classifyReplay({ status: 409, code: 'IDEMPOTENCY_REPLAY' });
    expect(replay.nextStatus).toBe('refused');
    expect(replay.reasonAr).toContain('بحمولةٍ مختلفة');
    // ‏وبلا حالةٍ وبلا رسالة: سببٌ مقروءٌ لا نصٌّ فارغ.
    expect(classifyReplay({ status: 422 }).reasonAr).toContain('رفضَ الخادمُ النيّةَ (422)');
  });

  it('خطّةُ المزامنة: المعلّقُ وحده، وبترتيب الإدخال لا بترتيب الوصول', () => {
    const plan = syncPlan([
      record({ offlineId: 'c', sequenceNo: 3, status: 'pending', operation: 'collection' }),
      record({ offlineId: 'a', sequenceNo: 1, status: 'synced' }),
      record({ offlineId: 'b', sequenceNo: 2, status: 'pending', operation: 'return' }),
      record({ offlineId: 'd', sequenceNo: 4, status: 'refused' }),
    ]);
    expect(plan.map((row) => row.offlineId)).toEqual(['b', 'c']);
    // ‏فالمرفوضُ لا يُعاد (يحتاج قرار المندوب) والواصلُ لا يُعاد (بلا أثرٍ ثانٍ).
    expect(plan.some((row) => row.status !== 'pending')).toBe(false);
    expect(syncPlan([])).toEqual([]);
  });

  it('سطرُ الحالة يقول المرفوضَ ولا يذيبُه في رقمٍ إجماليّ', () => {
    expect(queueSummaryLine(countQueue([]))).toBe(REP_QUEUE_MESSAGES.nothingQueued);
    expect(countQueue([record(), record({ status: 'synced' }), record({ status: 'refused' })])).toEqual({
      pending: 1,
      synced: 1,
      refused: 1,
      total: 3,
    });
    const line = queueSummaryLine({ pending: 2, synced: 1, refused: 1, total: 4 });
    expect(line).toContain('4 نيّة');
    expect(line).toContain('2 بانتظار الإرسال');
    expect(line).toContain('1 مرفوضةٌ تحتاج قرار المندوب');
    expect(line).toContain('1 وصلت');
    // ‏وبلا مرفوضٍ لا تُذكر كلمةُ الرفض.
    expect(queueSummaryLine({ pending: 1, synced: 0, refused: 0, total: 1 })).not.toContain('مرفوضة');
  });

  it('حكمُ ما قبل الإرسال: بُعدُ الطابور وحده، والصلاحيةُ كنصّ الخادم', () => {
    const can = (permission: string) => permission === REP_PERMISSIONS.invoice;

    // ‏دون اتصال + عمليّةٌ قابلةٌ للحفظ ⇒ تحذيران ولا حظر (فالنيّةُ تُحفظ).
    const offlineDocument = queueVerdict({ online: false, operation: 'document', can });
    expect(offlineDocument.blocked).toEqual([]);
    expect(offlineDocument.warnings).toHaveLength(2);
    expect(offlineDocument.warnings[0]).toContain('حُفظت النيّةُ محليًّا');
    // ‏والأرقامُ المعروضة دون اتصال ليست مجاميعَ محليّة — فلا يُخترع رقم.
    expect(offlineDocument.warnings[1]).toContain('من آخر قراءةٍ ناجحة');

    // ‏دون اتصال + إقفال ⇒ حظرٌ بالسبب المقاس (لا يُحفظ ولا يُرسل عمياءً).
    const offlineClosing = queueVerdict({ online: false, operation: 'closing', can, targetId: 'load-1' });
    expect(offlineClosing.blocked).toContain(NOT_QUEUEABLE_OPERATIONS.closing.reasonAr);

    // ‏ومتّصل + إقفال + صلاحيةُ الإقفال ⇒ لا حظرَ من بُعد الطابور (والخادمُ هو الحكم).
    // ‏و`can` أعلاه تسمح بالفاتورة وحدها، فلهذا السطر دالتُه: فلو استُعملت تلك لسقط
    // ‏الحكمُ بسبب الصلاحية لا بسبب الطابور — وخلطُ البُعدَين في تثبيتٍ واحد يُخفي أيَّهما فشل.
    const canAll = () => true;
    expect(
      queueVerdict({ online: true, operation: 'closing', can: canAll, targetId: 'load-1' }).blocked,
    ).toEqual([]);
    // ‏وبلا صلاحية الإقفال يُحظر ولو كان متّصلًا — فالطابورُ ليس سببَ الحظر الوحيد هنا.
    expect(queueVerdict({ online: true, operation: 'closing', can, targetId: 'load-1' }).blocked).toContain(
      REP_QUEUE_MESSAGES.permissionRequired(['van_sales.closing.submit']),
    );
    expect(REP_QUEUE_MESSAGES.permissionRequired(['van_sales.closing.submit'])).toContain(
      'تقديم جرد وإغلاق وردية المندوب',
    );

    // ‏وبلا صلاحية: رسالةٌ عربية واضحة بلا رموز إنجليزية خام.
    const noPermission = queueVerdict({ online: false, operation: 'collection', can });
    expect(noPermission.blocked).toContain(
      REP_QUEUE_MESSAGES.permissionRequired(['van_sales.collection.create']),
    );
    expect(REP_QUEUE_MESSAGES.permissionRequired(['van_sales.collection.create'])).not.toMatch(/van_sales\./);

    // ‏ومرتجعٌ بلا مستندٍ مصدر ⇒ حظرٌ (فالمسارُ يحتاجه).
    expect(queueVerdict({ online: false, operation: 'return', can }).blocked).toContain(
      'حدّد مستندَ البيع الأصلي للمرتجع',
    );
    // ‏ومتّصلٌ ومستندٌ صحيحٌ وصلاحية ⇒ لا حظرَ ولا تحذير من هذا البُعد.
    const online = queueVerdict({ online: true, operation: 'document', can });
    expect(online.blocked).toEqual([]);
    expect(online.warnings).toEqual([]);
  });

  it('وسمُ الجهاز يُقال كما هو: تتبّعٌ لا حدٌّ أمنيّ', () => {
    expect(REP_QUEUE_MESSAGES.deviceLine('device-abc')).toContain('device-abc');
    expect(REP_QUEUE_MESSAGES.deviceLine('device-abc')).toContain('ليس حدًّا أمنيًّا');
    expect(REP_QUEUE_MESSAGES.deviceLine(null)).toContain('لم يُنشأ بعدُ وسمُ جهاز');
  });
});
