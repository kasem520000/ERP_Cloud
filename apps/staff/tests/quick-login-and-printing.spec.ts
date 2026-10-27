import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '..');

function read(relative: string): string {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

/**
 * 🔐 «تذكّرني» و«الدخول السريع» في تطبيقات الويب.
 *
 * الشكوى كانت: لا خيار لحفظ بيانات الدخول، ولا زر دخول سريع بالبيانات المحفوظة.
 * والحلّ ليس `localStorage` لكلمة المرور — بل خزنة `WebCrypto` بمفتاح `AES-GCM-256`
 * غير قابل للتصدير (`extractable: false`) مخزّن في IndexedDB، والواجهة تُظهر بريداً
 * مُقنّعاً فقط وتقرأ كلمة المرور عند الضغط على زر الدخول السريع ثم تنساها.
 *
 * والاختبار هنا يحرس العقد لا التصميم: كل تطبيق ويب يملك شاشة دخول يربط الخزنة،
 * ولا يُكتب السرّ في `localStorage`، والمعرّف يُقنّع قبل العرض.
 */
describe('🔐 تذكّر بيانات الدخول والدخول السريع', () => {
  it('خزنة الاعتماد في @erp/web-core تستعمل WebCrypto بمفتاح غير قابل للتصدير ولا تكتب السرّ نصاً', () => {
    const vault = fs.readFileSync(
      path.resolve(root, '../../packages/web-core/src/quick-login.tsx'),
      'utf8',
    );
    expect(vault).toContain("indexedDB.open(DB_NAME");
    expect(vault).toContain('AES-GCM');
    expect(vault).toContain('extractable');
    // المفتاح يُنشأ بـ false صراحةً: مفتاحٌ قابل للتصدير يُسرَّب بـ copy-paste.
    expect(vault).toMatch(/length: 256[\s\S]{0,20}?false,/);
    // ما يُكتب في localStorage هو الترويسة المُقنّعة فقط.
    expect(vault).toContain('maskEmail');
    expect(vault).toContain('maskTenantCode');
    expect(vault).not.toMatch(/localStorage\.setItem\([^)]*password/i);
  });

  it('كل تطبيق ويب يربط «تذكّرني» و«الدخول السريع» في شاشة الدخول', () => {
    const surfaces: Array<[string, string]> = [
      ['apps/staff', 'components/login-screen.tsx'],
      ['apps/bakery', 'components/login-screen.tsx'],
      ['apps/platform-admin', 'components/login-screen.tsx'],
      ['apps/marketing', 'components/smart-login.tsx'],
      ['apps/customer-portal', 'components/forms.tsx'],
    ];
    for (const [app, file] of surfaces) {
      const source = fs.readFileSync(path.resolve(root, `../../${app}/${file}`), 'utf8');
      expect(source, app).toContain('useQuickLogin');
      expect(source, app).toContain('QuickLoginPanel');
      expect(source, app).toContain('RememberMeCheckbox');
      // الحفظ بعد نجاح الدخول فقط، لا قبله.
      expect(source, app).toMatch(/persistIfRemembered|saveQuickLogin/);
    }
  });

  it('شاشة دخول لوحة الموظفين تحفظ بعد النجاح وتستعمل السرّ المحفوظ دون ملء الحقول', () => {
    const source = read('components/login-screen.tsx');
    expect(source).toContain("useQuickLogin('staff')");
    expect(source).toContain('attemptQuickLogin');
    // السرّ المحفوظ يُستعمل للنداء فقط، ولا يُسكب في حقول النموذج.
    expect(source).not.toMatch(/setPassword\(secret\.password\)/);
    expect(source).toContain('pendingQuickSecretRef');
    // وفشل الدخول السريع يُلغي السرّ المعلّق فلا يُعاد استعماله.
    expect(source).toMatch(/pendingQuickSecretRef\.current = null/);
  });
});

describe('🖨️ شاشة إعدادات الطباعة ومصمّم القوالب', () => {
  it('تعرض القوالب من الخادم وتعاين الورقة الحقيقية لا صورة تقريبية', () => {
    const source = read('app/settings/printing/page.tsx');
    expect(source).toContain('fetchPrintableTemplates');
    expect(source).toContain('previewPrintableTemplate');
    // المعاينة iframe بـsrcDoc: نفس HTML الخادم الذي يُطبع.
    expect(source).toContain('srcDoc={preview}');
    expect(source).toContain('openPrintWindow');
  });

  it('خيار الورق يغيّر المقاس فعلاً: A4 و80mm و58mm', () => {
    const source = read('app/settings/printing/page.tsx');
    expect(source).toContain("paperWidthMm: key === '58' ? 58 : 80");
    expect(source).toContain("printType: 2");
    expect(source).toContain("printType: 1");
    expect(source).toContain('حراري 80 مم');
    expect(source).toContain('حراري 58 مم');
  });

  it('طابعات الجهاز تُكتشف وتُقترح، و«طابعة المطبخ» تقترح A4، وحقول سطح المكتب مسمّاة صراحةً', () => {
    const source = read('app/settings/printing/page.tsx');
    expect(source).toContain('detectDevicePrinters');
    expect(source).toContain('chrome');
    expect(source).toContain('queryLocalPrinters');
    expect(source).toContain('طابعة المطبخ / الفواتير');
    expect(source).toContain('suggested="A4"');
    expect(source).toContain('اسم ملف التقرير (سطح المكتب)');
    expect(source).toContain('مسار التقارير على القرص (سطح المكتب)');
  });

  it('القالب له أقسام وأعمدة وإضافات وتوقيعات قابلة للتعديل', () => {
    const source = read('app/settings/printing/page.tsx');
    expect(source).toContain('sectionOrder');
    expect(source).toContain('customFields');
    expect(source).toContain('signatureLabels');
    expect(source).toContain('watermarkText');
    expect(source).toContain('designConfig');
  });
});

describe('🏢 بطاقة المنشأة والعنوان الوطني', () => {
  it('الإعدادات العامة تشير إلى المسار الموجود /settings/company لا المسار المحذوف', () => {
    const source = read('app/settings/general/page.tsx');
    expect(source).toContain('href="/settings/company"');
    expect(source).not.toContain('href="/organization/company"');
  });

  it('المسار القديم /organization/company يحوّل بدل أن يعطي 404', () => {
    const legacy = read('app/organization/company/page.tsx');
    expect(legacy).toContain("redirect('/settings/company')");
  });
});
