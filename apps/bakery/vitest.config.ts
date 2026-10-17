import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

/**
 * ‏`jsx: 'automatic'` لأنّ سبيك جدار الترخيص **يرسم** المكوّن فعلًا (`renderToStaticMarkup`)
 * بدل أن يقرأ نصّه، وملفات التطبيق تُكتب JSX بلا استيراد `React` — و`tsconfig` التطبيق على
 * `preserve` لـ Next فلا يصلح للقياس. و`@erp/contracts` يُوجَّه إلى المصدر لا إلى `dist`
 * كي لا يقيس السبيك نسخةً مترجمةً متأخرة.
 */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: {
    alias: [
      {
        find: '@erp/contracts',
        replacement: fileURLToPath(new URL('../../packages/contracts/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.spec.ts', 'tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
    // ‏الحزمتان المشتركتان تُشحنان مصدراً (`.ts`/`.tsx`) عبر `exports`، وNode لا يحمّل
    // ذلك من `node_modules` — فتُحوَّلان هنا كما يحوّلهما Next (`transpilePackages`).
    server: { deps: { inline: ['@erp/web-core', '@erp/web-van', '@erp/ui'] } },
  },
});
