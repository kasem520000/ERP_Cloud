import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AccessOverview, ContentPanel, FormField, PageFrame, PageHeader, PermissionChoice, SummaryStat, TableViewport, ViewNotice } from '../src/components/page-layout';

describe('operational page anatomy', () => {
  it('renders one semantic heading and keeps actions separate from content', () => {
    const html = renderToStaticMarkup(
      <PageFrame>
        <PageHeader title="كشف الحساب" description="حركات الفترة" actions={<button type="button">طباعة</button>} />
        <ContentPanel title="الحركات"><TableViewport label="حركات الحساب"><table><tbody><tr><td>1</td></tr></tbody></table></TableViewport></ContentPanel>
      </PageFrame>,
    );
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('class="erp-page');
    expect(html).toContain('role="region" aria-label="حركات الحساب" tabindex="0"');
    expect(html).toContain('class="erp-page-actions no-print"');
  });

  it('renders a role review summary and native permission choice without owning access policy', () => {
    const html = renderToStaticMarkup(
      <>
        <AccessOverview title="صلاحيات الوصول" description="راجع التغييرات قبل الحفظ" items={[
          { label: 'الأدوار', value: 5, hint: 'أدوار المنصة' },
          { label: 'التعديل', value: 'عرض فقط', hint: 'لا يمكن الحفظ' },
        ]} />
        <div className="erp-permission-grid">
          <PermissionChoice title="عرض سجل التدقيق" checked disabled changed onChange={() => {}} />
        </div>
      </>,
    );
    expect(html).toContain('aria-label="صلاحيات الوصول"');
    expect(html).toContain('عرض فقط');
    expect(html).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""[^>]*checked=""/);
    expect(html).toContain('data-changed="true"');
    expect(html).toContain('تغيير غير محفوظ');
  });

  it('pairs a real label with a field and presents an error', () => {
    const html = renderToStaticMarkup(<FormField label="البريد" error="البريد غير صالح"><input type="email" /></FormField>);
    expect(html).toContain('<label');
    expect(html).toContain('البريد');
    expect(html).toContain('role="alert"');
  });

  it('keeps financial summaries formatted by the caller and does not silently hide errors', () => {
    const html = renderToStaticMarkup(<><SummaryStat label="الرصيد" value="١٬٢٠٠ ر.س" /><ViewNotice state="error">رفض الخادم الطلب</ViewNotice></>);
    expect(html).toContain('١٬٢٠٠ ر.س');
    expect(html).toContain('role="alert"');
  });
});
