import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  CASH_LOCATION_COLUMNS,
  CASH_LOCATION_PERMISSION,
  LINE_VOUCHER_COLUMNS,
  NO_WRITE_HERE_AR,
  TREASURY_VIEW_PERMISSION,
  VAN_COLLECTION_VOUCHER_PREFIX,
  VOUCHER_CAP_NOTE,
  VOUCHER_COLUMNS,
  VOUCHER_SERVER_LIMIT,
  balanceText,
  cashLocationViewRows,
  draftLineVouchers,
  isLineCollectionVoucher,
  lineDocumentNumber,
  lineVouchers,
  locationNameOf,
  postedLineVouchers,
  shownSum,
  shownSumCaption,
  treasuryCellText,
  voucherKindLabel,
  voucherStatusLabel,
  voucherViewRows,
  vouchersQuery,
  type CashBalanceRow,
  type CashLocationRow,
  type VoucherRow,
} from '../lib/treasury-screen';

const pageSource = readFileSync(fileURLToPath(new URL('../app/treasury/page.tsx', import.meta.url)), 'utf8');

/**
 * المثبّتةُ تحاكي **صفًّا كاملًا** كما يرجعه `treasury.service.vouchers` (قائمةُ `select`
 * فيه قِيست) — لا بعضَه: فحكمُ «كلّ عمودٍ معلَنٍ موجودٌ في الصفّ المشتق» يسقط على حقلٍّ
 * موجودٍ في الخادم ومفقودٍ في المثبّتة، وهو سقوطٌ يكذب على القارئ (يبدو عيبًا في الشاشة).
 */
const voucher = (over: Partial<VoucherRow> = {}): VoucherRow => ({
  id: 'v-1',
  number: 'RV-000001',
  kind: 'receipt',
  subtype: 'customer',
  date: '2026-05-02',
  voucherTime: '09:15',
  method: 'cash',
  amount: '20.0000',
  currency: 'SAR',
  status: 'posted',
  cashLocationId: 'safe-1',
  partyId: 'party-1',
  salesmanId: 'emp-1',
  referenceNo: 'VSD-1',
  referenceDate: null,
  recipient: null,
  description: 'سند قبض وتحصيل مديونية للفاتورة VSD-1',
  chequeNo: null,
  chequeState: null,
  journalEntryId: 'je-1',
  postedAt: '2026-05-02T09:15:00.000Z',
  voidedAt: null,
  createdByName: 'مالك الحساب',
  createdAt: '2026-05-02T09:15:00.000Z',
  idempotencyKey: `${VAN_COLLECTION_VOUCHER_PREFIX}doc-1:key`,
  ...over,
});

describe('خزينةُ الخطّ — النسبةُ بالمفتاح، والمجموعُ من نافذةٍ مقطوعةٍ لا يُعرض', () => {
  it('السندُ يُنسب إلى الخطّ بمفتاح عدم التكرار وحده — لا بالمرجع ولا بالبيان', () => {
    expect(isLineCollectionVoucher(voucher())).toBe(true);
    // سندٌ يدويٌّ يحمل رقمَ مستندِ خطٍّ في المرجع: **ليس** من الخطّ (والنسبةُ بالتخمين كذب).
    expect(isLineCollectionVoucher(voucher({ idempotencyKey: null, referenceNo: 'VSD-1' }))).toBe(false);
    expect(isLineCollectionVoucher(voucher({ idempotencyKey: 'manual:voucher:9' }))).toBe(false);
    expect(isLineCollectionVoucher(null)).toBe(false);
    // والبادئةُ هي ما يكتبه المسارُ الرسميّ حرفيًّا (`van-sales.service.ts:7006`).
    expect(VAN_COLLECTION_VOUCHER_PREFIX).toBe('van-collection-voucher:');
  });

  it('رقمُ مستند الخطّ من `referenceNo` — للعرض لا للحكم', () => {
    expect(lineDocumentNumber(voucher({ referenceNo: ' VSD-12 ' }))).toBe('VSD-12');
    expect(lineDocumentNumber(voucher({ referenceNo: null }))).toBeNull();
    expect(lineDocumentNumber(voucher({ referenceNo: '   ' }))).toBeNull();
  });

  it('المسودةُ من سندات الخطّ تُعدّ فجوةً: تحصيلٌ لم يدخل الصندوقَ ولا الأستاذ', () => {
    const rows = [
      voucher({ id: 'a', status: 'posted' }),
      voucher({ id: 'b', status: 'draft' }),
      voucher({ id: 'c', status: 'voided' }),
      voucher({ id: 'd', status: 'draft', idempotencyKey: 'manual:x' }),
    ];
    expect(lineVouchers(rows).map((row) => row.id)).toEqual(['a', 'b', 'c']);
    expect(draftLineVouchers(rows).map((row) => row.id)).toEqual(['b']);
    expect(postedLineVouchers(rows).map((row) => row.id)).toEqual(['a']);
    // و«ملغى» ليس مسودةً ولا مُرحَّلًا — فلا يُحسب في أيٍّ منهما.
    expect(draftLineVouchers(rows).some((row) => row.id === 'c')).toBe(false);
    expect(postedLineVouchers(rows).some((row) => row.id === 'c')).toBe(false);
  });

  it('المجموعُ بـ`decimal.js` لا بعائمة JS، وما لا يُقرأ يُستثنى ولا يُصفر بصمت', () => {
    const rows = [voucher({ amount: '0.1000' }), voucher({ amount: '0.2000' }), voucher({ amount: 'not-a-number' })];
    const sum = shownSum(rows, (row) => row.amount ?? null);
    // ‏0.1 + 0.2 بعائمة JS = 0.30000000000000004 — وهنا 0.30 بالضبط.
    expect(sum?.text).toBe('0.30');
    expect(sum?.count, 'الصفّ الذي لا يُقرأ لا يُجمع').toBe(2);
    expect(shownSumCaption(3, 2)).toContain('2 من 3');
    expect(shownSumCaption(3, 3)).toContain('مجموعُ المعروض');
  });

  it('وحين تُلامس القائمةُ سقفَ الخادم **لا يُعرض مجموع** — فمجموعُ النافذة ليس إجماليًّا', () => {
    const atCap = Array.from({ length: VOUCHER_SERVER_LIMIT }, (_, index) => voucher({ id: `v-${index}` }));
    expect(shownSum(atCap, (row) => row.amount ?? null)).toBeNull();
    expect(shownSum(atCap.slice(0, VOUCHER_SERVER_LIMIT - 1), (row) => row.amount ?? null)).not.toBeNull();
    // والسقفُ مقاسٌ في الخادم (‏`.limit(500)` في `treasury.service.vouchers`) لا مُختارٌ هنا.
    expect(VOUCHER_SERVER_LIMIT).toBe(500);
    expect(VOUCHER_CAP_NOTE).toContain('500');
    expect(pageSource, 'الشاشةُ لا تُعلن القصّ').toContain('VOUCHER_CAP_NOTE');
    expect(pageSource, 'الشاشةُ تعرض المجموعَ المشروط').toContain('shownSum');
  });

  it('الرصيدُ من صفوفه — وبلا صفٍّ «—» لا صفرٌ مُخترع', () => {
    const balances: CashBalanceRow[] = [
      { cashLocationId: 'safe-1', currencyCode: 'SAR', balance: '1500.5000', updatedAt: null },
      { cashLocationId: 'safe-1', currencyCode: 'USD', balance: '20.0000', updatedAt: null },
      { cashLocationId: 'bank-1', currencyCode: 'SAR', balance: '0.0000', updatedAt: null },
    ];
    expect(balanceText(balances, 'safe-1')).toBe('1500.5000 SAR · 20.0000 USD');
    // صفرٌ مكتوبٌ في صفٍّ يُعرض صفرًا — فهو واقعٌ مرصود، لا غيابَ صفّ.
    expect(balanceText(balances, 'bank-1')).toBe('0.0000 SAR');
    expect(balanceText(balances, 'safe-2')).toBe('—');
    expect(balanceText(balances, null)).toBe('—');
  });

  it('اسمُ الموضع من القائمة — ومعرّفٌ لا موضعَ له يُعرض مبتورًا لا مُخفيًّا', () => {
    const locations: CashLocationRow[] = [
      { id: 'safe-1', name: 'الصندوق الرئيسي', kind: 'safe', isDefault: true, isActive: true, custodianIds: ['e1', 'e2'] },
      { id: 'bank-1', name: 'بنك الراجحي', kind: 'bank', isDefault: false, isActive: false, custodianIds: [] },
    ];
    expect(locationNameOf(locations, 'safe-1')).toBe('الصندوق الرئيسي (صندوق)');
    expect(locationNameOf(locations, 'bank-1')).toBe('بنك الراجحي (بنك)');
    // ومعرّفٌ مجهولٌ يُعرض مبتورًا (٨ محارف) — فلا خليةَ فارغةَ تُخفي أنّ الموضعَ لم يرجع.
    expect(locationNameOf(locations, 'unknown-id-1234')).toBe('unknown-…');
    expect(locationNameOf(locations, null)).toBe('—');
  });

  it('التسمياتُ من قاموسٍ مقاسٍ على قيم الخادم — وما لا يُعرف يُعرض خامًا', () => {
    expect(voucherKindLabel(voucher())).toBe('سند قبض — عميل');
    expect(voucherKindLabel(voucher({ kind: 'payment', subtype: 'expense' }))).toBe('سند صرف — مصروف');
    expect(voucherKindLabel(voucher({ kind: 'receipt', subtype: 'mystery' }))).toBe('سند قبض — mystery');
    expect(voucherStatusLabel(voucher({ status: 'draft' }))).toBe('مسودة');
    expect(voucherStatusLabel(voucher({ status: 'weird' }))).toBe('weird');
    expect(voucherStatusLabel(null)).toBe('—');
  });

  it('صفوفُ الجدول تُشتقّ مرةً واحدة: التسمياتُ والأسماءُ والمبلغ — والغائب «—»', () => {
    const locations: CashLocationRow[] = [{ id: 'safe-1', name: 'الصندوق الرئيسي', kind: 'safe' }];
    const rows = voucherViewRows(
      [voucher(), voucher({ id: 'v-2', idempotencyKey: 'manual:x', amount: null, cashLocationId: 'nope' })],
      locations,
    );
    expect(rows[0]?.lineDocument).toBe('VSD-1');
    expect(rows[0]?.locationName).toBe('الصندوق الرئيسي (صندوق)');
    expect(rows[0]?.amountText).toBe('20.0000');
    expect(rows[0]?.journal).toBe('je-1…');
    // سندٌ ليس من الخطّ: عمودُ «مستند الخطّ» «—» وإن حمل المرجعُ رقمًا.
    expect(rows[1]?.lineDocument).toBe('—');
    expect(rows[1]?.amountText).toBe('—');
    expect(rows[1]?.locationName).toBe('nope…');
  });

  it('صفوفُ مواضع النقد: العددُ من المصفوفة، والافتراضيّ والنشط نصًّا', () => {
    const rows = cashLocationViewRows(
      [
        { id: 'safe-1', name: 'الصندوق', kind: 'safe', isDefault: true, isActive: true, custodianIds: ['e1', 'e2'], currencyCode: 'SAR' },
        { id: 'bank-1', name: 'البنك', kind: 'bank', isDefault: false, isActive: false, custodianIds: [], currencyCode: null },
      ],
      [{ cashLocationId: 'safe-1', currencyCode: 'SAR', balance: '10.0000', updatedAt: null }],
    );
    expect(rows[0]?.custodians).toBe(2);
    expect(rows[0]?.defaultLabel).toBe('نعم');
    expect(rows[0]?.activeLabel).toBe('نشط');
    expect(rows[0]?.balanceText).toBe('10.0000 SAR');
    expect(rows[1]?.custodians).toBe(0);
    expect(rows[1]?.activeLabel).toBe('موقوف');
    expect(rows[1]?.currencyCode).toBe('—');
    expect(rows[1]?.balanceText).toBe('—');
  });

  it('قارئُ الخلية: نصٌّ ورقمٌ ومنطقيٌّ ومصفوفة — وما عداها «—» لا «[object Object]»', () => {
    expect(treasuryCellText({ amountText: '10.00' }, { key: 'amountText', labelAr: 'المبلغ', numeric: true })).toBe('10.00');
    expect(treasuryCellText({ custodians: 3 }, { key: 'custodians', labelAr: 'المسئولون', numeric: true })).toBe('3');
    expect(treasuryCellText({ isDefault: true }, { key: 'isDefault', labelAr: 'الافتراضي' })).toBe('نعم');
    expect(treasuryCellText({ notes: '' }, { key: 'notes', labelAr: 'ملاحظات' })).toBe('—');
    expect(treasuryCellText({ bank: { iban: 'SA00' } }, { key: 'bank', labelAr: 'البنك' })).toBe('—');
    expect(treasuryCellText(null, { key: 'x', labelAr: 'س' })).toBe('—');
  });

  it('الاستعلامُ يسمّى الوسائطَ كما يسمّيها `treasury.controller`: ‏from/to/q لا fromDate', () => {
    expect(vouchersQuery({ fromDate: '2026-05-01', toDate: '2026-05-31', search: 'RV-1' })).toBe(
      '?from=2026-05-01&to=2026-05-31&q=RV-1',
    );
    expect(vouchersQuery({ fromDate: '', toDate: '', search: '  ' })).toBe('');
    expect(vouchersQuery({ fromDate: '2026-05-01', toDate: '', search: '' })).toBe('?from=2026-05-01');
  });

  it('الأعمدةُ معلنةٌ ومفتاحُها في الصفوف المشتقة — فلا عمودَ فارغًا أبدًا', () => {
    const rows = voucherViewRows([voucher()], [{ id: 'safe-1', name: 'الصندوق', kind: 'safe' }]);
    for (const column of [...LINE_VOUCHER_COLUMNS, ...VOUCHER_COLUMNS]) {
      expect(Object.keys(rows[0] ?? {}), `العمود ${column.key} ليس في الصفّ المشتق`).toContain(column.key);
    }
    const locationRows = cashLocationViewRows([{ id: 'safe-1', name: 'الصندوق', kind: 'safe' }], []);
    for (const column of CASH_LOCATION_COLUMNS) {
      expect(Object.keys(locationRows[0] ?? {}), `العمود ${column.key} ليس في صفّ الموضع`).toContain(column.key);
    }
    // والعمودُ الماليّ يُحاذى رقميًّا — فالمحاذاةُ لليمين تُفسد مقارنةَ الأعمدة.
    expect(VOUCHER_COLUMNS.find((column) => column.key === 'amountText')?.numeric).toBe(true);
  });

  it('الصلاحيتان المعلنتان هما ما يفرضه الخادم على النقطتَين', () => {
    expect(TREASURY_VIEW_PERMISSION).toBe('treasury.view');
    expect(CASH_LOCATION_PERMISSION).toBe('organization.cashlocation.view');
  });

  /**
   * حارسٌ إلى الأمام: هذه الشاشةُ **لا تكتب في المال**. فسندُ قبض الخطّ يُنشئه ويُرحِّله
   * مسارُ التحصيل الرسميّ (`van-sales.service.ts:6996-7027`)، وسندٌ ثانٍ من هنا على النقد
   * نفسه قبضٌ مزدوج. فمن أضاف إنشاءَ سندٍ أو ترحيلَه إلى هذه الشاشة أسقط هذا الحكمُ عمله.
   */
  it('الشاشةُ قراءةٌ فقط: لا إنشاءَ سندٍ ولا ترحيلَه ولا تحويلًا', () => {
    expect(pageSource).not.toContain("apiPost('/vouchers'");
    expect(pageSource).not.toContain('/post');
    expect(pageSource).not.toContain('/cash-transfers');
    expect(pageSource).not.toContain('/void');
    // وما تفعله بدلَ ذلك معلَّنٌ **فيها** لا في وثيقةٍ بعيدة.
    expect(pageSource).toContain('NO_WRITE_HERE_AR');
    expect(NO_WRITE_HERE_AR.length).toBeGreaterThan(2);
    for (const line of NO_WRITE_HERE_AR) expect(line.length, line.slice(0, 30)).toBeGreaterThan(30);
    // والنقاطُ الثلاثُ التي تقرأها موجودةٌ في المصدر (فلا شاشةَ تدّعي قراءةً لا تناديها).
    expect(pageSource).toContain('/vouchers');
    expect(pageSource).toContain('/cash-locations');
    expect(pageSource).toContain('/balances');
  });
});
