import { describe, expect, it } from 'vitest';

import {
  WINDOW_LABELS,
  windowIsComplete,
  windowNote,
  type DashboardWindows,
} from '../lib/dashboard-windows';

const FALLBACK = 'جملةُ الشاشة الاحتياطية (حدُّ النافذة من استعلام الخادم)';

describe('نوافذ اللوحة كما يعلنها الخادم', () => {
  it('نافذةٌ ناقصة: العددان معًا، وحدُّ الخادم، وعددُ الصفوف الخارجة', () => {
    const windows: DashboardWindows = { documents: { returned: 120, total: 347, limit: 120 } };
    const note = windowNote(windows, 'documents', FALLBACK);
    expect(note).toBe(
      'مستندات البيع: 120 من 347 (نافذةُ الخادم LIMIT 120) — 227 صفًّا خارج هذه القائمة، ' +
        'وأرقامُ summary جمعُ الجدول كلّه لا جمعُ هذه الصفوف.',
    );
  });

  it('نافذةٌ كاملة: لا يُقال «ناقصة» عن قائمةٍ هي كلّ السجلّ', () => {
    const note = windowNote({ documents: { returned: 12, total: 12, limit: 120 } }, 'documents', FALLBACK);
    expect(note).toBe('مستندات البيع: 12 من 12 — القائمة كلّ السجلّ، ولا صفوف خارجها.');
    expect(windowIsComplete({ returned: 12, total: 12, limit: 120 })).toBe(true);
    // ‏و«ما في الجدول» أقلّ ممّا رجع (حالٌ شاذّة) تُعامل معاملةَ الكاملة لا تُخترع لها صيغة.
    expect(windowIsComplete({ returned: 5, total: 3, limit: 120 })).toBe(true);
  });

  it('بلا `windows` من الخادم: الجملةُ الاحتياطية حرفًا، ولا رقمَ مخمَّن', () => {
    expect(windowNote(undefined, 'documents', FALLBACK)).toBe(FALLBACK);
    expect(windowNote(null, 'documents', FALLBACK)).toBe(FALLBACK);
    expect(windowNote({}, 'documents', FALLBACK)).toBe(FALLBACK);
  });

  it('صفٌّ ناقصٌ أو فاسدٌ لا يُترجم إلى رقم', () => {
    expect(windowNote({ documents: { returned: 120, total: 347 } } as never, 'documents', FALLBACK)).toBe(
      FALLBACK,
    );
    expect(windowNote({ documents: null } as never, 'documents', FALLBACK)).toBe(FALLBACK);
    expect(
      windowNote({ documents: { returned: '120', total: '347', limit: '120' } } as never, 'documents', FALLBACK),
    ).toBe(FALLBACK);
    expect(windowIsComplete(undefined)).toBe(false);
    expect(windowIsComplete({ returned: 0, total: 0 } as never)).toBe(false);
  });

  it('كلّ قائمةٍ لها اسمٌ عربيّ، والمفاتيح الخمسة هي ما يعلنه الخادم', () => {
    expect(Object.keys(WINDOW_LABELS).sort()).toEqual([
      'customerPriceHistory',
      'documents',
      'loadOrders',
      'movements',
      'productionBatches',
    ]);
    for (const label of Object.values(WINDOW_LABELS)) {
      expect(label.trim().length).toBeGreaterThan(2);
    }
    expect(windowNote({ loadOrders: { returned: 60, total: 61, limit: 60 } }, 'loadOrders', FALLBACK)).toContain(
      'أوامر التحميل: 60 من 61',
    );
    expect(windowNote({ movements: { returned: 80, total: 500, limit: 80 } }, 'movements', FALLBACK)).toContain(
      '420 صفًّا خارج هذه القائمة',
    );
  });
});
