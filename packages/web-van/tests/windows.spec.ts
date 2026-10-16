import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TOTALS_CLAUSE,
  WINDOW_LABELS,
  windowIsComplete,
  windowNote,
  type DashboardWindows,
} from '../src/windows';

const FALLBACK = 'جملةُ الشاشة الاحتياطية (حدُّ النافذة من استعلام الخادم)';

/**
 * 🪟 نوافذُ القراءة — التنفيذُ الواحد الذي تستعمله الأوجه: لوحةُ الخطّ في المخابز
 * (‏`apps/bakery/lib/dashboard-windows.ts` غلافٌ رقيقٌ حوله)، وشاشةُ المندوب في الطاقم
 * (‏`apps/staff/app/van-sales/rep/page.tsx`)، وتطبيقُ المندوب (`/rep`). والأعدادُ المستعملة
 * هنا هي **المقاسةُ من الخادم** في مثبّتاته: ‏`van-sales-dashboard-totals.spec.ts` للوحة
 * (‏٥٠/٦٠/١٢٠/٨٠/٥٠) و`van-sales-rep-workspace-totals.spec.ts` للمندوب (‏١٠٠ من ١٢٠
 * مستندًا، ٥٠ من ٦٠ أمرًا، ٥٠ من ٥٥ تحصيلًا، وصفرٌ من صفرٍ إشعارًا).
 */
describe('نوافذُ القراءة كما يعلنها الخادم — تنفيذٌ واحدٌ لكلّ الأوجه', () => {
  it('الاتّحادُ يشمل نوافذ الوجهين معًا، ولكلّ مفتاحٍ اسمٌ عربيّ', () => {
    /**
     * ‏اللوحةُ تُعلن خمسةً (`dashboard()`) والمندوبُ أربعةً (`repWorkspace`) واثنان مشتركان،
     * فالاتّحادُ سبعة. وأمّا `balances` و`pendingReceipts` فليستا هنا: فكلاهما كاملٌ في
     * استعلامه (بلا `LIMIT`) — وهذا مقيسٌ في حكم الخادم
     * (‏`windows.balances` و`windows.pendingReceipts` غيرُ موجودين) لا مفترضٌ هنا.
     */
    expect(Object.keys(WINDOW_LABELS).sort()).toEqual([
      'collections',
      'customerPriceHistory',
      'documents',
      'loadOrders',
      'movements',
      'notifications',
      'productionBatches',
    ]);
    expect(WINDOW_LABELS.collections).toBe('حركات التحصيل');
    expect(WINDOW_LABELS.notifications).toBe('الإشعارات');
    for (const label of Object.values(WINDOW_LABELS)) {
      expect(label.trim().length).toBeGreaterThan(2);
    }
  });

  it('نافذةٌ ناقصة: العددان وحدُّ الخادم وعددُ الصفوف الخارجة، وذيلُ المجاميع', () => {
    const windows: DashboardWindows = { documents: { returned: 100, total: 120, limit: 100 } };
    expect(windowNote(windows, 'documents', FALLBACK)).toBe(
      'مستندات البيع: 100 من 120 (نافذةُ الخادم LIMIT 100) — 20 صفًّا خارج هذه القائمة، ' +
        `و${DEFAULT_TOTALS_CLAUSE}.`,
    );
    // ‏والذيلُ الافتراضيّ عامٌّ لأنّ المجاميعَ اسمُها يختلف بين وجهٍ ووجه.
    expect(DEFAULT_TOTALS_CLAUSE).toBe('المجاميعُ جمعُ الجدول كلّه لا جمعُ هذه الصفوف');
  });

  it('ذيلُ الجملة تختاره الشاشة: ‏`summary` في اللوحة و`totals` عند المندوب — والبناءُ واحد', () => {
    const windows: DashboardWindows = { documents: { returned: 100, total: 120, limit: 100 } };
    const dashboardNote = windowNote(windows, 'documents', FALLBACK, {
      totalsClause: 'أرقامُ summary جمعُ الجدول كلّه لا جمعُ هذه الصفوف',
    });
    const repNote = windowNote(windows, 'documents', FALLBACK, {
      totalsClause: 'أرقامُ المندوب جمعُ جدوله كلّه لا جمعُ هذه الصفوف',
    });
    expect(dashboardNote).toContain('أرقامُ summary جمعُ الجدول كلّه');
    expect(repNote).toContain('أرقامُ المندوب جمعُ جدوله كلّه');
    // ‏وما عدا المفردةِ سواء: فالعددان والحدُّ وصفةُ الناقص من بناءٍ واحد.
    const head = 'مستندات البيع: 100 من 120 (نافذةُ الخادم LIMIT 100) — 20 صفًّا خارج هذه القائمة، ';
    expect(dashboardNote.startsWith(head)).toBe(true);
    expect(repNote.startsWith(head)).toBe(true);
  });

  it('نافذةٌ كاملة: لا يُقال «ناقصة» عن قائمةٍ هي كلّ السجلّ', () => {
    // ‏إشعاراتُ المندوب: صفرٌ من صفر — قائمةٌ كاملةٌ فارغة، لا قائمةٌ ناقصة.
    expect(windowNote({ notifications: { returned: 0, total: 0, limit: 20 } }, 'notifications', FALLBACK)).toBe(
      'الإشعارات: 0 من 0 — القائمة كلّ السجلّ، ولا صفوف خارجها.',
    );
    expect(windowIsComplete({ returned: 12, total: 12, limit: 120 })).toBe(true);
    // ‏و«ما في الجدول» أقلّ ممّا رجع (حالٌ شاذّة) تُعامل معاملةَ الكاملة ولا تُخترع لها صيغة.
    expect(windowIsComplete({ returned: 5, total: 3, limit: 120 })).toBe(true);
  });

  it('نوافذُ المندوب الأربعة بأعدادها المقاسة', () => {
    const rep: DashboardWindows = {
      loadOrders: { returned: 50, total: 60, limit: 50 },
      documents: { returned: 100, total: 120, limit: 100 },
      collections: { returned: 50, total: 55, limit: 50 },
      notifications: { returned: 0, total: 0, limit: 20 },
    };
    expect(windowNote(rep, 'collections', FALLBACK)).toContain('حركات التحصيل: 50 من 55');
    expect(windowNote(rep, 'collections', FALLBACK)).toContain('5 صفًّا خارج هذه القائمة');
    expect(windowNote(rep, 'loadOrders', FALLBACK)).toContain('أوامر التحميل: 50 من 60');
    expect(windowIsComplete(rep.notifications)).toBe(true);
    expect(windowIsComplete(rep.collections)).toBe(false);
    // ‏وحدُّ الخادم يُنقل من الحمولة لا من ثابتٍ في الشاشة: فنوافذُ المندوب (‏٥٠/١٠٠)
    // ‏أضيقُ من نوافذ اللوحة (‏٦٠/١٢٠) والجملةُ نفسها تصدق في الوجهين.
    expect(windowNote({ loadOrders: { returned: 60, total: 61, limit: 60 } }, 'loadOrders', FALLBACK)).toContain(
      'أوامر التحميل: 60 من 61 (نافذةُ الخادم LIMIT 60)',
    );
  });

  it('بلا `windows` من الخادم، أو بصفٍّ ناقصٍ أو فاسد: الجملةُ الاحتياطية ولا رقمَ مخمَّن', () => {
    expect(windowNote(undefined, 'documents', FALLBACK)).toBe(FALLBACK);
    expect(windowNote(null, 'documents', FALLBACK)).toBe(FALLBACK);
    expect(windowNote({}, 'documents', FALLBACK)).toBe(FALLBACK);
    expect(windowNote({ documents: { returned: 120, total: 347 } } as never, 'documents', FALLBACK)).toBe(FALLBACK);
    expect(windowNote({ documents: null } as never, 'documents', FALLBACK)).toBe(FALLBACK);
    expect(
      windowNote(
        { documents: { returned: '120', total: '347', limit: '120' } } as never,
        'documents',
        FALLBACK,
      ),
    ).toBe(FALLBACK);
    expect(windowNote({ documents: { returned: 1, total: 2, limit: Number.NaN } } as never, 'documents', FALLBACK)).toBe(
      FALLBACK,
    );
    expect(windowIsComplete(undefined)).toBe(false);
    expect(windowIsComplete({ returned: 0, total: 0 } as never)).toBe(false);
    // ‏والذيلُ المخصّص لا يُستعمل مع الاحتياطية: فالجملةُ الاحتياطيةُ نصُّ الشاشة كما هو.
    expect(windowNote(null, 'documents', FALLBACK, { totalsClause: 'ذيلٌ لا يظهر' })).toBe(FALLBACK);
  });
});
