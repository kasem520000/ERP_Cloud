import type { SalesmanCard } from '../../lib/reps-screen';

/**
 * بطاقاتُ مندوبين كما يرجعها `GET /van-sales/salesmen` — بالحقول نفسها وبقيم الخادم النصّية
 * (كمياتٌ وقيمٌ ونِسبٌ بأربعة كسور). ولا `Partial<SalesmanCard>`: فحقلٌ ناقصٌ في الـfixture
 * يتسرّب إلى أحكام «الحقل المفقود» فيصير الحكم يقيس الفراغ لا السلوك.
 */
export function readyRep(overrides: Partial<SalesmanCard> = {}): SalesmanCard {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'سالم المندوب',
    active: true,
    employeeRef: 'REP-1',
    commissionRate: '5.0000',
    collectionCommissionRate: '1.0000',
    profitCommissionRate: '2.5000',
    tel: '0112223344',
    mobile: '0555666777',
    email: 'salem@bakery.test',
    notes: null,
    employeeId: '22222222-2222-4222-8222-222222222222',
    employeeNo: 'EMP-7',
    employeeName: 'سالم عبدالله',
    employeeStatus: 'active',
    membershipId: '33333333-3333-4333-8333-333333333333',
    membershipStatus: 'active',
    userEmail: 'salem.login@bakery.test',
    userStatus: 'active',
    roleCount: 1,
    permissions: ['van_sales.view', 'van_sales.invoice.create'],
    warehouseId: '44444444-4444-4444-8444-444444444444',
    warehouseName: 'سيارة ١',
    warehouseCode: 'VAN-1',
    vehiclePlate: 'أ ب ج 1234',
    custody: {
      openLoadOrders: 2,
      pendingReceipts: 1,
      pendingClosings: 1,
      custodyQty: '120.5000',
      outstandingCash: '450.2500',
      items: [
        {
          itemId: '55555555-5555-4555-8555-555555555555',
          itemName: 'خبز بر 600جم',
          warehouseName: 'سيارة ١',
          quantity: '80.5000',
          value: '201.2500',
        },
      ],
    },
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

/** مندوبٌ جديد: بلا بطاقة موظف، بلا حساب دخول، وبلا عهدة. */
export function freshRep(overrides: Partial<SalesmanCard> = {}): SalesmanCard {
  return readyRep({
    id: '66666666-6666-4666-8666-666666666666',
    name: 'مندوب بلا حساب',
    employeeId: null,
    employeeNo: null,
    employeeName: null,
    employeeStatus: null,
    membershipId: null,
    membershipStatus: null,
    userEmail: null,
    userStatus: null,
    vehiclePlate: null,
    roleCount: 0,
    permissions: [],
    custody: {
      openLoadOrders: 0,
      pendingReceipts: 0,
      pendingClosings: 0,
      custodyQty: '0.0000',
      outstandingCash: '0.0000',
      items: [],
    },
    readiness: {
      hasEmployee: false,
      hasLoginAccount: false,
      loginActive: false,
      hasVanWarehouse: true,
      hasVanSalesPermissions: false,
    },
    ...overrides,
  });
}
