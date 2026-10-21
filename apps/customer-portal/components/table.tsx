'use client';

import type { ReactNode } from 'react';

/**
 * جدولُ البوابة — نفسُ واجهة `Table` في `@erp/ui` (عمودٌ = مفتاح + عنوان + خليّة)،
 * لكنّه يُصيغ بـ`<table>` عارية تعتمد طبقة `@erp/ui/controls.css` و`globals.css`
 * البوابة، **لا** بأصناف Tailwind.
 *
 * ولماذا نسخةٌ ثانية هنا؟ لأنّ البوابة لا تمرّ على Tailwind أصلًا (لا `postcss` ولا
 * `@source`)، فأصنافُ `@erp/ui` هناك لا تُولَّد وحدها بلا قيمة — والجدولُ الذي يفقد
 * حشوَه وحدوده ليس جدولًا مشتركًا بل جدولًا مكسورًا. فبدل تسعِ طاولاتٍ مكتوبة بخطّ
 * اليد في تسع شاشات (وهو ما كان)، صار للبوابة **مكوّنٌ واحد** يُستدعى بالطريقة نفسها
 * التي تُستدعى بها `Table` في المكتب، وتُضبط مظهره في طبقةٍ واحدة
 * (`apps/customer-portal/app/globals.css` ← `.table-wrap` / `table th` / `table td` / `.num`).
 *
 * الخصائصُ المدعومة هي ما تحتاجه البوابة فعلًا: `bare` (داخل لوحة)، `dense`، `empty`،
 * و`numeric`/`ltr` للخلايا. ولا يُضاف هنا ما لا يُستعمل — فلا تتفرّع النسختان بلا سبب.
 */
export type PortalColumn<T> = {
  key: string;
  header: ReactNode;
  cell: (row: T, index: number) => ReactNode;
  /** رقم: يُحاذى إلى نهاية السطر بخطٍّ ثابت العرض. */
  numeric?: boolean;
  /** نصٌّ لاتيني (رقم فاتورة، مرجع): عزل اتجاه. */
  ltr?: boolean;
};

export function PortalTable<T>({
  columns,
  rows,
  rowKey,
  empty,
  footer,
  headless = false,
  dense = false,
  bare = false,
}: {
  columns: Array<PortalColumn<T>>;
  rows: T[];
  rowKey: (row: T, index: number) => string;
  /** يُعرض مكان الجسم حين لا صفوف — لا صفَّ `colSpan` مكتوبًا بخطّ اليد. */
  empty?: ReactNode;
  /** صفُّ الإجماليات: خلايا بترتيب الأعمدة. */
  footer?: ReactNode[];
  /** جدولُ «حقل/قيمة»: لوحتُه تعنونه، فلا رأسَ أعمدةٍ مكرَّر. */
  headless?: boolean;
  dense?: boolean;
  /** الجدولُ ابنُ لوحةٍ لها سطحها: يُسقط الغلافُ حدودَه وظلَّه. */
  bare?: boolean;
}) {
  return (
    <div className={bare ? 'table-wrap' : 'table-wrap table-wrap-card'}>
      <table className={dense ? 'table-dense' : undefined}>
        {headless ? null : (
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} className={column.numeric ? 'num' : undefined}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.length === 0 && empty ? (
            <tr>
              <td colSpan={columns.length} className="table-blank">
                {empty}
              </td>
            </tr>
          ) : null}
          {rows.map((row, index) => (
            <tr key={rowKey(row, index)}>
              {columns.map((column) => (
                <td key={column.key} className={column.numeric ? 'num' : undefined}>
                  {column.ltr ? <bdi dir="ltr">{column.cell(row, index)}</bdi> : column.cell(row, index)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {footer && rows.length > 0 ? (
          <tfoot>
            <tr>
              {footer.map((cell, index) => (
                <td key={index} className={columns[index]?.numeric ? 'num' : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}
