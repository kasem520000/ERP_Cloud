import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), 'utf8');

describe('staff table anatomy', () => {
  /**
   * كان `DataTable` جدولاً كاملاً مكتوباً بخطّ اليد، و`Table` المشتركة في `@erp/ui`
   * نسخةً ثانية؛ فاختلف الحشو والحالة الفارغة بين شاشتين تعرضان الشيء نفسه. صار
   * `DataTable` غلافاً فقط — وأيُّ `<table>` يعود إلى الملف يعيد النسخة الثانية.
   */
  it('keeps DataTable a thin wrapper over the shared Table', () => {
    const source = read('components/data-view.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(source).not.toContain('<table');
    expect(source).not.toContain('<thead');
    expect(source).toContain('<Table');
    expect(source).toContain("from '@erp/ui'");
  });

  /** الغلاف نفسه لا يصنع طاولةً ثانية. */
  it('re-exports the shared table instead of re-implementing it', () => {
    const source = read('components/ui/table.tsx').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(source).not.toContain('<table');
    expect(source).toContain("export { Table } from '@erp/ui'");
  });
});
