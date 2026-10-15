import { describe, expect, it } from 'vitest';

import {
  ageDays,
  buildCollectionPayload,
  buildReconciliationPayload,
  COLLECTION_MESSAGES,
  COLLECTION_PERMISSION,
  COLLECTIONS_WINDOW_NOTE,
  collectionOutcome,
  collectionVerdict,
  emptyCollectionDraft,
  emptyReconciliationDraft,
  latestCollectionReceipt,
  movementTypeLabel,
  partyReceivables,
  RECONCILIATION_BATCH_MAX,
  RECONCILIATION_BATCH_MIN,
  reconciliationHeadline,
  RECONCILIATION_PERMISSION,
  reconciliationVerdict,
  receivablesTotal,
  receivableRows,
  remainingText,
  voucherPostState,
  VOUCHER_POST_LABELS,
  type MovementRow,
  type ReconciliationResult,
} from '../lib/collection-screen';

import { doc } from './fixtures/van-documents';

/**
 * 💵 التحصيل: ما يُقاس هنا أنّ الشاشة لا تقول «تمّ التحصيل» لمالٍ لم يصل الأستاذ. فسندُ
 * القبض قد يبقى **مسودةً** حين لا ينحلّ حساب ذمم العملاء، والخادم يكتب ذلك في سبب الحركة
 * بكلماته — والشاشة تقرأ كلماته، لا تستنتج من وجود معرّفٍ للسند. ويُقاس أيضًا أنّ جملةَ
 * «مبلغ التحصيل يتجاوز الرصيد المتبقي» تُبنى بالأرقام نفسها التي يبنيها الخادم، وأنّ
 * المطابقة القديمة تبقى معاينةً ما لم يُطلب التنفيذ صراحةً وبصلاحية.
 */

function movement(overrides: Partial<MovementRow> = {}): MovementRow {
  return {
    id: 'mv-1',
    movementType: 'collection_receipt',
    batchNo: 'BATCH-2026-10-01-A',
    qty: '0.00',
    unitPrice: '0.00',
    amount: '24.50',
    reason: 'سند قبض مُرحَّل لتحصيل مديونية الفاتورة VSD-2026-000123',
    voucherId: 'voucher-1',
    salesmanName: 'سالم المندوب',
    customerName: 'بقالة النور',
    actorLabel: 'المحاسب',
    approvedByLabel: '',
    createdAt: '2026-10-14T07:00:00.000Z',
    ...overrides,
  };
}

describe('قائمة الذمم: الأقدم أولًا، والمجموع مجموعُ القائمة لا ذممُ المنشأة', () => {
  it('لا تُدرج إلا آجلًا بقي عليه شيء، ويرتّب بعمر الدين', () => {
    const rows = receivableRows([
      doc({ id: 'new', docDate: '2026-10-10', total: '100.00', paidAmount: '0.00' }),
      doc({ id: 'old', docDate: '2026-09-01', total: '50.00', paidAmount: '10.00' }),
      doc({ id: 'paid', docDate: '2026-08-01', total: '50.00', paidAmount: '50.00' }),
      doc({ id: 'cash', docDate: '2026-07-01', paymentMethod: 'cash', total: '20.00', paidAmount: '0.00' }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(['old', 'new']);
    expect(receivablesTotal(rows).toFixed(2)).toBe('140.00');
    expect(partyReceivables(rows, 'party-1').toFixed(2)).toBe('140.00');
    expect(partyReceivables(rows, 'party-2').toFixed(2)).toBe('0.00');
    expect(remainingText(rows[0] ?? doc())).toBe('40.00');
    expect(COLLECTIONS_WINDOW_NOTE).toContain('١٢٠ مستندًا');
  });

  it('عمرُ الدين من تاريخ المستند، وتاريخٌ فاسد `null` لا صفر', () => {
    const now = new Date('2026-10-15T00:00:00.000Z');
    expect(ageDays(doc({ docDate: '2026-10-01' }), now)).toBe(14);
    expect(ageDays(doc({ docDate: '', createdAt: '2026-10-05T00:00:00.000Z' }), now)).toBe(10);
    expect(ageDays(doc({ docDate: 'ليس تاريخًا', createdAt: 'ولا هذا' }), now)).toBeNull();
  });
});

describe('حمولة سند القبض', () => {
  it('المبلغ بدقة الخادم، والفراغ لا يُرسل', () => {
    expect(
      buildCollectionPayload({ ...emptyCollectionDraft(), documentId: 'doc-1', collectedAmount: '24.5' }),
    ).toEqual({ documentId: 'doc-1', collectedAmount: '24.5000', cashLocationId: undefined, offsetAccountId: undefined, notes: undefined });
    expect(
      buildCollectionPayload({
        documentId: 'doc-1',
        collectedAmount: '10',
        cashLocationId: ' cash-1 ',
        offsetAccountId: 'acc-9',
        notes: '  تحصيلٌ نقدي  ',
      }),
    ).toEqual({
      documentId: 'doc-1',
      collectedAmount: '10.0000',
      cashLocationId: 'cash-1',
      offsetAccountId: 'acc-9',
      notes: 'تحصيلٌ نقدي',
    });
    // ‏ومبلغٌ لا يُقرأ يُرسل كما كُتب ليرفضه الخادم بنصّه — لا يُبتلع إلى صفر.
    expect(buildCollectionPayload({ ...emptyCollectionDraft(), collectedAmount: 'abc' }).collectedAmount).toBe('abc');
  });
});

describe('حكم التحصيل قبل الإرسال', () => {
  const credit = doc({ total: '34.50', paidAmount: '10.00' });

  it('بلا فاتورةٍ أو بلا مبلغٍ موجب: نصّ الخادم', () => {
    expect(collectionVerdict(emptyCollectionDraft(), { documents: [credit] }).blocked).toContain(
      COLLECTION_MESSAGES.documentAndAmountRequired,
    );
    expect(
      collectionVerdict({ ...emptyCollectionDraft(), documentId: 'doc-1', collectedAmount: '0' }, {
        documents: [credit],
      }).blocked,
    ).toContain(COLLECTION_MESSAGES.documentAndAmountRequired);
    expect(
      collectionVerdict({ ...emptyCollectionDraft(), documentId: 'doc-1', collectedAmount: '-5' }, {
        documents: [credit],
      }).blocked,
    ).toContain(COLLECTION_MESSAGES.documentAndAmountRequired);
  });

  it('فاتورةٌ مسدَّدة: رفض الخادم 409 كما هو', () => {
    const paid = doc({ total: '34.50', paidAmount: '34.50' });
    expect(
      collectionVerdict({ ...emptyCollectionDraft(), documentId: 'doc-1', collectedAmount: '1' }, {
        documents: [paid],
      }).blocked,
    ).toContain(COLLECTION_MESSAGES.invoiceAlreadyPaid);
  });

  it('مبلغٌ يتجاوز المتبقي: الجملة نفسها التي سيرفض بها الخادم', () => {
    const { blocked } = collectionVerdict(
      { ...emptyCollectionDraft(), documentId: 'doc-1', collectedAmount: '40' },
      { documents: [credit] },
    );
    expect(blocked).toContain(COLLECTION_MESSAGES.exceedsRemaining('40.00', '24.50'));
    expect(blocked[0]).toContain('مبلغ التحصيل (40.00 ريال) يتجاوز الرصيد المتبقي على الفاتورة (24.50 ريال)');
  });

  it('تحصيلٌ كاملٌ صحيح: لا حظر ولا ضجيج', () => {
    const verdict = collectionVerdict(
      { ...emptyCollectionDraft(), documentId: 'doc-1', collectedAmount: '24.50', cashLocationId: 'cash-1' },
      { documents: [credit] },
    );
    expect(verdict.blocked).toEqual([]);
    expect(verdict.warnings).toEqual([]);
  });

  it('تحصيلٌ جزئيّ: تحذيرٌ يقول ما يبقى على الفاتورة', () => {
    const { warnings } = collectionVerdict(
      { ...emptyCollectionDraft(), documentId: 'doc-1', collectedAmount: '10', cashLocationId: 'cash-1' },
      { documents: [credit] },
    );
    expect(warnings.some((line) => line.includes('تحصيلٌ جزئيّ') && line.includes('14.50'))).toBe(true);
  });

  it('متبقٍّ على مستندٍ غير آجل: إشارةُ مراجعةٍ في الترحيل لا تحصيلٌ عاديّ', () => {
    const odd = doc({ paymentMethod: 'cash', total: '34.50', paidAmount: '10.00' });
    const { warnings } = collectionVerdict(
      { ...emptyCollectionDraft(), documentId: 'doc-1', collectedAmount: '5', cashLocationId: 'cash-1' },
      { documents: [odd] },
    );
    expect(warnings.some((line) => line.includes('إشارةُ مراجعةٍ في الترحيل'))).toBe(true);
  });

  it('بلا صندوقٍ وبلا تغطيةٍ لسند القبض في ملف الترحيل: تحذيران يقولان المآل', () => {
    const { warnings } = collectionVerdict(
      { ...emptyCollectionDraft(), documentId: 'doc-1', collectedAmount: '24.50' },
      { documents: [credit] },
    );
    expect(warnings.some((line) => line.includes('بلا صندوقٍ نقديّ محدَّد'))).toBe(true);

    const noVoucherProfile = collectionVerdict(
      { ...emptyCollectionDraft(), documentId: 'doc-1', collectedAmount: '24.50', cashLocationId: 'cash-1' },
      {
        documents: [credit],
        postingReadiness: {
          branchId: 'branch-1',
          salesInvoice: true,
          stockTransfer: true,
          receiptVoucher: false,
          message: null,
        },
      },
    );
    expect(
      noVoucherProfile.warnings.some((line) => line.includes('مسودةً غير مُرحَّلة')),
    ).toBe(true);
  });

  it('حسابُ مقابلةٍ يدويّ: يُقال إنه يتقدّم على ترتيب الخادم', () => {
    const { warnings } = collectionVerdict(
      {
        ...emptyCollectionDraft(),
        documentId: 'doc-1',
        collectedAmount: '24.50',
        cashLocationId: 'cash-1',
        offsetAccountId: 'acc-9',
      },
      { documents: [credit] },
    );
    expect(warnings.some((line) => line.includes('يتقدّم على حساب ذمم العميل'))).toBe(true);
  });

  it('فاتورةٌ خارج نافذة اللوحة: تحذيرٌ يذكر نصّ الخادم 404 ولا يمنع الطلب', () => {
    const { blocked, warnings } = collectionVerdict(
      { ...emptyCollectionDraft(), documentId: 'doc-x', collectedAmount: '5' },
      { documents: [credit] },
    );
    expect(blocked).toEqual([]);
    expect(warnings.some((line) => line.includes(COLLECTION_MESSAGES.invoiceNotFound))).toBe(true);
  });

  it('الصلاحية المعلنة هي التي يفرضها الخادم على المسار', () => {
    expect(COLLECTION_PERMISSION).toBe('van_sales.collection.create');
    expect(RECONCILIATION_PERMISSION).toBe('van_sales.override.approve');
  });
});

describe('هل وصل المال إلى الأستاذ؟ — من كلمات الخادم لا من استنتاج الشاشة', () => {
  it('يقرأ أحدث حركة سند قبض', () => {
    const movements = [
      movement({ id: 'mv-0', movementType: 'van_sale' }),
      movement({ id: 'mv-1' }),
      movement({ id: 'mv-2', createdAt: '2026-10-13T07:00:00.000Z' }),
    ];
    expect(latestCollectionReceipt(movements)?.id).toBe('mv-1');
    expect(latestCollectionReceipt([movement({ movementType: 'van_sale' })])).toBeNull();
  });

  it('يصنّف الحالة من الجملة التي كتبها الخادم، والمجهول مجهول', () => {
    expect(voucherPostState('سند قبض مُرحَّل لتحصيل مديونية الفاتورة VSD-1')).toBe('posted');
    expect(
      voucherPostState('سند قبض مسجّل (غير مُرحَّل — يلزم تحديد حساب ذمم العملاء) لتحصيل مديونية الفاتورة VSD-1'),
    ).toBe('draft');
    expect(voucherPostState('سند قبض بدون سند خزينة لتحصيل مديونية الفاتورة VSD-1')).toBe('none');
    expect(voucherPostState('')).toBe('unknown');
    expect(voucherPostState(null)).toBe('unknown');
    expect(voucherPostState('جملةٌ لم تُعرف')).toBe('unknown');
  });

  it('وجودُ معرّفٍ للسند لا يعني ترحيله: المسودة لها معرّف', () => {
    const draftMovement = movement({
      voucherId: 'voucher-9',
      reason: 'سند قبض مسجّل (غير مُرحَّل — يلزم تحديد حساب ذمم العملاء) لتحصيل مديونية الفاتورة VSD-1',
    });
    const outcome = collectionOutcome(draftMovement);
    expect(outcome?.state).toBe('draft');
    expect(outcome?.label).toBe(VOUCHER_POST_LABELS.draft);
    // ‏ونصُّ الخادم يُعرض كما هو دائمًا، فالتصنيف لا يستبدل الدليل.
    expect(outcome?.reason).toBe(draftMovement.reason);
    expect(collectionOutcome(null)).toBeNull();
  });
});

describe('أداة مطابقة البيانات القديمة: معاينةٌ افتراضًا، وتنفيذٌ بصلاحية', () => {
  const result = (overrides: Partial<ReconciliationResult> = {}): ReconciliationResult => ({
    mode: 'dry_run',
    executedAt: '2026-10-15T05:00:00.000Z',
    counts: {
      totalProductionBatches: 12,
      linkedProductionBatches: 10,
      unlinkedProductionBatches: 2,
      totalLoadOrders: 30,
      linkedLoadOrders: 28,
      unlinkedLoadOrders: 2,
      pendingShortagePolicyOrders: 1,
      totalDocuments: 200,
      linkedDocuments: 180,
      unlinkedDocuments: 20,
      internalDeliveryDocuments: 5,
      customerPricesWithoutHistory: 3,
    },
    conflicts: [
      { entityType: 'van_sales_documents', entityId: 'd-1', code: 'DUPLICATE_DOCUMENT_NUMBER', detail: 'رقمٌ مكرر' },
    ],
    plan: [
      {
        entityType: 'van_sales_documents',
        entityId: 'd-2',
        number: 'VSD-2',
        action: 'skip_pending_tax_policy',
        canBackfillSafely: false,
        blockingReason: 'INTERNAL_DELIVERY_TAX_POLICY_PENDING',
      },
      {
        entityType: 'van_sales_customer_prices',
        entityId: 'cp-1',
        number: 'جملة الخطّ',
        action: 'backfill_price_audit_history',
        canBackfillSafely: true,
        blockingReason: null,
      },
    ],
    execution: { succeededCount: 0, failedCount: 0, succeeded: [], failed: [], nextResumeCursor: null },
    ...overrides,
  });

  it('الوضع معاينةٌ ما لم يُطلب التنفيذ، وحدُّ الدفعة يُقصّ كما يقصّه الخادم', () => {
    expect(buildReconciliationPayload(emptyReconciliationDraft())).toEqual({
      mode: 'dry_run',
      resumeFromId: undefined,
      batchLimit: undefined,
    });
    expect(buildReconciliationPayload({ mode: 'execute', resumeFromId: ' d-9 ', batchLimit: '25' })).toEqual({
      mode: 'execute',
      resumeFromId: 'd-9',
      batchLimit: 25,
    });
    expect(buildReconciliationPayload({ mode: 'dry_run', resumeFromId: '', batchLimit: '9999' }).batchLimit).toBe(
      RECONCILIATION_BATCH_MAX,
    );
    expect(buildReconciliationPayload({ mode: 'dry_run', resumeFromId: '', batchLimit: '0' }).batchLimit).toBe(
      RECONCILIATION_BATCH_MIN,
    );
    expect(buildReconciliationPayload({ mode: 'dry_run', resumeFromId: '', batchLimit: 'abc' }).batchLimit).toBeUndefined();
    expect(buildReconciliationPayload({ mode: 'dry_run', resumeFromId: '', batchLimit: '12.9' }).batchLimit).toBe(12);
  });

  it('بلا صلاحية: حظرٌ على الوضعين معًا — فالمسار كله محميّ', () => {
    for (const mode of ['dry_run', 'execute'] as const) {
      const { blocked } = reconciliationVerdict({ mode, resumeFromId: '', batchLimit: '' }, { canOverride: false });
      expect(blocked.some((line) => line.includes(RECONCILIATION_PERMISSION))).toBe(true);
    }
    expect(reconciliationVerdict(emptyReconciliationDraft(), { canOverride: true }).blocked).toEqual([]);
  });

  it('التنفيذ: تحذيران — وبلا معاينةٍ سابقة في هذه الجلسة تحذيرٌ ثالث', () => {
    const { warnings } = reconciliationVerdict(
      { mode: 'execute', resumeFromId: '', batchLimit: '' },
      { canOverride: true },
    );
    expect(warnings.some((line) => line.includes('تنفيذٌ لا معاينة'))).toBe(true);
    expect(warnings.some((line) => line.includes('لم تُجرَ معاينة'))).toBe(true);

    const afterDryRun = reconciliationVerdict(
      { mode: 'execute', resumeFromId: '', batchLimit: '' },
      { canOverride: true, lastResult: result() },
    );
    expect(afterDryRun.warnings.some((line) => line.includes('لم تُجرَ معاينة'))).toBe(false);
    expect(reconciliationVerdict(emptyReconciliationDraft(), { canOverride: true, lastResult: result() }).warnings).toEqual([]);
  });

  it('معرفُ استئنافٍ من غير ما أرجعته الدفعة السابقة: تحذير', () => {
    const { warnings } = reconciliationVerdict(
      { mode: 'dry_run', resumeFromId: 'd-1', batchLimit: '' },
      { canOverride: true },
    );
    expect(warnings.some((line) => line.includes('nextResumeCursor'))).toBe(true);
  });

  it('العنوان أرقامُ النتيجة كما رجعت — ولا «كلّ شيء سليم»', () => {
    const headline = reconciliationHeadline(result());
    expect(headline).toContain('معاينة (بلا كتابة)');
    expect(headline).toContain('1 تعارضًا');
    expect(headline).toContain('2 بندًا في الخطة');
    expect(headline).toContain('1 لا يُستكمل بأمان');
    expect(headline).toContain('20 من 200');
    expect(reconciliationHeadline(result({ mode: 'execute' }))).toContain('تنفيذ');
  });
});

describe('كلمات الحركات: معروفُها يُترجم ومجهولُها يُعرض خاماً', () => {
  it('لا يخترع ترجمةً لنوعٍ لم يُعرف', () => {
    expect(movementTypeLabel('collection_receipt')).toContain('سند قبض');
    expect(movementTypeLabel('van_shortage')).toContain('عجز');
    expect(movementTypeLabel('some_new_type')).toBe('some_new_type');
  });
});
