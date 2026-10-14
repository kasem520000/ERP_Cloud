import { defineConfig } from 'vitest/config';

/**
 * `jsx: 'automatic'` لأنّ سبيك تسليم الجلسة **يرسم** صفحة الدخول فعلًا
 * (`renderToStaticMarkup`) بدل أن يقرأ نصّها — وصفحة `app/auth/login` تُكتب JSX بلا
 * استيراد `React` (كما في بقية التطبيق)، و`tsconfig` التطبيق مضبوط على `preserve`
 * لـ Next فلا يصلح للقياس. التحويل التلقائي يُبقي القياس على بيئة node نفسها.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: { environment: 'node', include: ['lib/**/*.spec.ts', 'tests/**/*.spec.ts'] },
});
