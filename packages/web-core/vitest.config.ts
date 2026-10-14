import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // ‏`.spec.tsx` لأن بوابة الجلسة تُرسم فعلاً (renderToStaticMarkup) لا تُقرأ نصّاً.
    include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'],
  },
});
