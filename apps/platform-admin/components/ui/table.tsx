'use client';

import type { ReactNode } from 'react';

import { Badge, type BadgeTone } from './badge';

/**
 * الجدول المشترك صار في `@erp/ui` (`Table`) — نسخةٌ واحدة يستعملها المكتب ولوحة
 * المنصّة والمخابز، بدل نسخةٍ في كل تطبيق. هذا الملف يبقي مسارات الاستيراد
 * القديمة (`components/ui/table`) صالحة، ويضيف ما هو خاصّ بالمنصّة: `CellBadge`.
 */
export { Table } from '@erp/ui';
export type { TableColumn as Column, TableSortState as SortState } from '@erp/ui';

/** شارة صغيرة للاستخدام داخل الخلايا. */
export function CellBadge({
  tone = 'neutral',
  dot,
  children,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
}) {
  return (
    <Badge tone={tone} dot={dot}>
      {children}
    </Badge>
  );
}
