/**
 * 🧾 ترميز رمز الاستجابة السريعة (QR) للفاتورة — **الترميز وحده، لا الحمولة**.
 *
 * الحمولة الصادقة هي `zatca_qr` التي كتبتها وحدة الفوترة الإلكترونية على الفاتورة في
 * الخادم؛ ولا يُبنى TLV محليًّا في أيّ متصفّح، لأنّ رمزًا يُقرأ ولا يقابله إصدارٌ
 * إلكترونيّ ادّعاءٌ أمام جهةٍ حكومية. وحين تغيب الحمولة يُطبع قولٌ صريح
 * (`ZATCA_QR_MISSING_TEXT`) — النصّ نفسه الذي تكتبه وثيقة الطباعة على الخادم
 * (`print-templates.service.qrBlock`)، فلا يختلف الورق عن الشاشة.
 *
 * ومكانه هنا لا في `apps/staff`: الرمز يُرسم على ورقةٍ رسمية يطبعها سطحان (لوحة staff
 * وواجهة المخابز)، ومُرمِّزان يعنيان ورقًا يختلف عن ورق.
 */
import qrcode from 'qrcode-generator';

/**
 * 🧾 ما يقوله المستند حين لا تكون للفاتورة حمولة فوترة إلكترونية صادرة فعلًا. النصّ
 * نفسه الذي تكتبه وثيقة الطباعة على الخادم (`print-templates.service.qrBlock`)، فلا
 * يختلف الورق عن الشاشة.
 */
export const ZATCA_QR_MISSING_TEXT = 'لم تُصدر بعد بيانات الفاتورة الإلكترونية (QR) لهذا المستند.';

/**
 * الرمز يُرسم بمُرمِّز QR حقيقي — `qrcode-generator`، المكتبة نفسها التي ترسمه في وثيقة
 * الطباعة على الخادم. ما كان هنا قبل ذلك مصفوفة 29×29 للزينة: أنماط تحديدٍ وتوقيت ثمّ
 * بتّات الحمولة تحت قناعٍ مختلَق، بلا تصحيح أخطاءٍ ولا معلومات إصدار ولا ترميز بيانات
 * صحيح — أي شكلٌ يشبه الرمز ولا يقرأه أيّ ماسح. ورقٌ يحمل رمزًا لا يُقرأ أسوأ من سطرٍ
 * يقول الحقيقة، لأنّه يوحي بأنّ الفاتورة صدرت إلكترونيًّا وهي لم تصدر.
 */
export function buildQrMatrix(payload: string): boolean[][] {
  const qr = qrcode(0, 'M');
  qr.addData(payload);
  qr.make();
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
  );
}

/**
 * حمولةٌ فارغة = لا رمز: تُرجع نصًّا فارغًا ليقول المستند «لم تُصدر بعد» بدل مربّعٍ
 * زائف. لا تُبنى حمولة TLV محليًّا هنا ولا في أيّ شاشة — الحمولة الصادقة هي التي
 * كتبتها وحدة الفوترة الإلكترونية على الفاتورة (`zatca_qr`).
 */
export function renderQrSvgMarkup(payload: string | null | undefined, px = 136): string {
  if (!payload) return '';
  const matrix = buildQrMatrix(payload);
  const n = matrix.length;
  const quiet = 2;
  const gridDim = n + quiet * 2;
  const rects: string[] = [];
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (matrix[r]?.[c]) {
        rects.push(`<rect x="${c + quiet}" y="${r + quiet}" width="1" height="1" fill="#000"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${gridDim} ${gridDim}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${gridDim}" height="${gridDim}" fill="#fff"/>${rects.join('')}</svg>`;
}
