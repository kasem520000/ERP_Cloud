/**
 * 📦 `@erp/web-core` — القشرة المشتركة لواجهات الويب المستأجرة.
 *
 * ما يجتمع هنا هو ما تحتاجه **كل** واجهة تتحدث إلى `apps/api` نفسها ولا يخصّ صناعةً ولا
 * شاشةً بعينها: جلسة العميل ورموزها وتجديدها، وعميل الطلبات (`apiData`/`apiPost`/…) مع
 * قراءة `application/problem+json`، ومزوّد اللغة والاتجاه، وخطّاف الاستعلام، ومخزن العمل
 * بلا اتصال ومحرك مزامنته، وجسر تسليم الجلسة (AUD-08).
 *
 * وما **ليس** هنا عن قصد: كتالوج الشاشات (`apps/staff/lib/navigation.ts`)، وسياسة الأسطح
 * (أي المسارات عامة وأيها قشرة موظف)، والقشرة البصرية (`AppShell`/`AuthGate`/`LoginScreen`) —
 * فهذه تحمل هوية كل تطبيق، ونقلها قبل تجهيز حدودها (manifest للتطبيق) كان سيُنتج قشرةً
 * واحدة بسلوكين مختلفين. تُستعمل عبر `transpilePackages` كما `@erp/ui` (ADR-030: تُشحن
 * مصدراً فلا خطوة بناء تُزامَن بين الواجهات).
 */
export * from './api';
export * from './i18n';
export * from './offline-db';
export * from './session';
export * from './sync-engine';
export * from './sync';
export * from './token-bridge';
export * from './use-query';
