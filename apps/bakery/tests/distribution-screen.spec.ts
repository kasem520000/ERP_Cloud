import { describe, expect, it } from 'vitest';

import {
  awaitingReceiptRows,
  batchCellText,
  batchItemOption,
  batchOptionLabel,
  itemRequiresBatch,
  mapLoadOrders,
  mapSalesmen,
  salesmanAdvisories,
  salesmanBlockingWarning,
  salesmanLabel,
  type LoadOrderRow,
  type SalesmanRow,
} from '../lib/distribution-screen';

function salesman(overrides: Partial<SalesmanRow> = {}): SalesmanRow {
  return {
    id: 'rep-1',
    name: 'خالد المندوب',
    active: true,
    employeeNo: 'EMP-7',
    warehouseId: 'wh-van-1',
    warehouseName: 'سيارة ١',
    readiness: {
      hasEmployee: true,
      hasLoginAccount: true,
      loginActive: true,
      hasVanWarehouse: true,
      hasVanSalesPermissions: true,
    },
    ...overrides,
  };
}

describe('mapLoadOrders — لا إجراء على صفٍّ بلا معرّف', () => {
  it('يستبقي الصفوف ذات المعرّف بترتيبها ويستبعد ما لا معرّف له', () => {
    const rows = mapLoadOrders({
      loadOrders: [
        { id: 'a', number: 'LO-1' },
        { number: 'LO-بلا-معرّف' },
        null as unknown as LoadOrderRow,
        { id: '', number: 'LO-فارغ' },
        { id: 'b', number: 'LO-2' },
      ],
    });
    expect(rows.map((row) => row.number)).toEqual(['LO-1', 'LO-2']);
  });

  it('لوحةٌ بلا `loadOrders` قائمةٌ فارغة لا استثناء ولا `undefined`', () => {
    expect(mapLoadOrders(null)).toEqual([]);
    expect(mapLoadOrders({})).toEqual([]);
    expect(mapSalesmen(undefined)).toEqual([]);
  });
});

describe('salesmanLabel — الاسم كما يقول الخادم', () => {
  it('الاسم ورقم الموظف معاً', () => {
    expect(salesmanLabel(salesman())).toBe('خالد المندوب (EMP-7)');
  });

  it('بلا رقم موظف فالاسم وحده، وبلا اسمٍ فاسم الموظف، وبلا شيءٍ فالمعرّف', () => {
    expect(salesmanLabel(salesman({ employeeNo: null }))).toBe('خالد المندوب');
    expect(salesmanLabel(salesman({ name: null, employeeNo: null, employeeName: 'خالد أحمد' }))).toBe('خالد أحمد');
    // ورقم الموظف وحده كافٍ تسميةً حين لا اسم في البطاقة:
    expect(salesmanLabel(salesman({ name: null }))).toBe('EMP-7');
    expect(salesmanLabel(salesman({ name: null, employeeNo: null, employeeName: null }))).toBe('rep-1');
    expect(salesmanLabel({})).toBe('—');
  });
});

describe('salesmanBlockingWarning — ما يُرفض عند الخادم يُقال قبل الإرسال', () => {
  it('مندوبٌ بلا مستودع سيارة: الخادم يشتقّ الوجهة منه، فبلا مستودعٍ تُرفض الحمولة', () => {
    expect(salesmanBlockingWarning(salesman({ warehouseId: null }))).toContain('مستودع سيارة');
    expect(salesmanBlockingWarning(salesman({ readiness: { hasVanWarehouse: false } }))).toContain('مستودع سيارة');
  });

  it('مندوبٌ مجهّز لا يُقال عنه شيء', () => {
    expect(salesmanBlockingWarning(salesman())).toBeNull();
  });
});

describe('salesmanAdvisories — تنبيهٌ لا يمنع', () => {
  it('المندوب الجاهز لا تنبيهات عليه', () => {
    expect(salesmanAdvisories(salesman())).toEqual([]);
  });

  it('كلّ نقصٍ يُسمّى: غير نشط، بلا موظف، بلا دخول، دخولٌ غير مفعّل، بلا صلاحية', () => {
    const notes = salesmanAdvisories(
      salesman({
        active: false,
        readiness: {
          hasEmployee: false,
          hasLoginAccount: false,
          loginActive: false,
          hasVanSalesPermissions: false,
        },
      }),
    );
    expect(notes).toHaveLength(4); // بلا حساب دخول فلا يُقال أيضاً «الدخول غير مفعّل»
    expect(notes.join(' ')).toContain('غير نشطة');
    expect(notes.join(' ')).toContain('لا موظف');
    expect(notes.join(' ')).toContain('لا حساب دخول');
    expect(notes.join(' ')).toContain('لا صلاحية');
  });

  it('حساب دخولٍ موجود لكنه غير مفعّل يُقال وحده', () => {
    const notes = salesmanAdvisories(salesman({ readiness: { hasLoginAccount: true, loginActive: false } }));
    expect(notes).toEqual(['حساب الدخول غير مفعّل.']);
  });
});

describe('awaitingReceiptRows — الحالة تحكم لا العلم', () => {
  it('‏`pending_receipt` وحدها، ولو قال صفٌّ آخر إنه ينتظر استلاماً', () => {
    const rows: LoadOrderRow[] = [
      { id: '1', status: 'pending_receipt', number: 'LO-1' },
      { id: '2', status: 'loaded', awaitingReceipt: true, number: 'LO-2' },
      { id: '3', status: 'settled', number: 'LO-3' },
      { id: '4', status: null, number: 'LO-4' },
    ];
    expect(awaitingReceiptRows(rows).map((row) => row.number)).toEqual(['LO-1']);
  });
});

describe('batchOptionLabel / batchItemOption — ربط الإنتاج بالتوزيع بلا تخمين', () => {
  it('التسمية تحمل الرقم والصنف والكمية والحالة كما هي', () => {
    expect(
      batchOptionLabel({ id: 'b1', batchNo: 'PB-1', itemName: 'خبز عربي', producedQty: '500.0000', status: 'active' }),
    ).toBe('PB-1 · خبز عربي · أنتج 500.0000 · active');
  });

  it('الكمية الغائبة لا تُعرض «أنتج —» والصنف الغائب لا يُخترع', () => {
    expect(batchOptionLabel({ id: 'b2', batchNo: 'PB-2' })).toBe('PB-2');
    expect(batchOptionLabel({ id: 'b3' })).toBe('b3');
    expect(batchOptionLabel({})).toBe('—');
  });

  it('الصنف يُقرأ من `itemId` في الدفعة، وبلا `itemId` لا صنف', () => {
    expect(batchItemOption({ id: 'b1', itemId: 'item-1', itemName: 'خبز' })).toEqual({ id: 'item-1', nameAr: 'خبز' });
    expect(batchItemOption({ id: 'b1', itemId: null, itemName: 'خبز' })).toBeNull();
  });
});

describe('batchCellText / itemRequiresBatch — عمود الدفعة وحكم §5.1 قبل الإرسال', () => {
  it('أمرٌ بلا دفعةٍ مُسمّاة يُقال «بلا دفعة» — لا بياضاً ولا صفراً ولا رقماً مُختلَعاً', () => {
    expect(batchCellText({ productionBatchNo: '' })).toBe('بلا دفعة');
    expect(batchCellText({ productionBatchNo: '   ' })).toBe('بلا دفعة');
    expect(batchCellText({ productionBatchNo: null })).toBe('بلا دفعة');
    expect(batchCellText({})).toBe('بلا دفعة');
  });

  it('الدفعة المُسمّاة تُعرض كما هي، بأرقامها لا بترجمةٍ لها', () => {
    expect(batchCellText({ productionBatchNo: 'PROD-20261015-0001' })).toBe('PROD-20261015-0001');
  });

  it('يتطلّب دفعةً حين يكون الصنف مُتتبَّعاً بالدفعات ولا دفعةَ مُسمّاة', () => {
    const items = [
      { id: 'lot-1', nameAr: 'كرواسون', trackLot: true },
      { id: 'plain-1', nameAr: 'خبز عربي', trackLot: false },
    ];
    expect(itemRequiresBatch(items, 'lot-1', '')).toBe(true);
    expect(itemRequiresBatch(items, 'lot-1', '  ')).toBe(true);
    expect(itemRequiresBatch(items, 'lot-1', 'PB-1')).toBe(false);
    expect(itemRequiresBatch(items, 'plain-1', '')).toBe(false);
    expect(itemRequiresBatch(items, '', '')).toBe(false);
    expect(itemRequiresBatch(items, 'unknown-item', '')).toBe(false);
    // ‏وبطاقةٌ لم تحمل `trackLot` لا يُحكم عليها هنا — الحكم في الخادم من بطاقته.
    expect(itemRequiresBatch([{ id: 'x' }], 'x', '')).toBe(false);
  });
});
