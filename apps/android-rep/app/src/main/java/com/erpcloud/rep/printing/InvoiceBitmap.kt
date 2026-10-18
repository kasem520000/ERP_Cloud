package com.erpcloud.rep.printing

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import com.erpcloud.rep.data.api.PrintViewDto
import com.erpcloud.rep.util.Dec
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter

/**
 * توليدُ صورةِ الفاتورة من `print-view` — تخطيطٌ احترافيٌّ بأسلوب إيصالات ZATCA:
 *
 * - ترويسةُ المنشأة (الاسم، الرقمُ الضريبيّ، السجلّ، الهواتف) وسطًا.
 * - شريطُ عنوانِ المستند، وصفوفُ بياناتٍ ثنائيّةَ الأعمدة (تسميةٌ يمينًا وقيمةٌ
 *   يسارًا) تفصل بينها فواصلُ منقّطة.
 * - الإجماليُّ المستحقُّ داخل إطارٍ ملوّنٍ خفيف، ورمزُ QR داخل إطارٍ مع تسميته.
 * - الرسمُ بـCanvas وStaticLayout (تشكيلٌ عربيٌّ سليم)، ورمزُ QR من `qrPayload`
 *   كما يرسله الخادم — لا يُخترع في التطبيق.
 *
 * البناءُ بمسارِ أوامرٍ واحد (Ops) يُقاس ويُرسَم بالترتيبِ نفسه — فلا انفصامَ بين
 * الارتفاعِ المحسوب والمحتوى المرسوم.
 *
 * العرضُ مُعاملٌ: ٥٧٦ نقطةً لطابعة ٨٠ملم و٣٨٤ لـ٥٨ملم، وأعلى للطباعة عبر النظام.
 */
object InvoiceBitmap {

    fun render(view: PrintViewDto, widthPx: Int, copyKind: String? = null): Bitmap {
        val width = widthPx.coerceAtLeast(200)
        val pad = width / 22
        val innerWidth = width - pad * 2
        val bodySize = (width / 26f).coerceIn(9f, 42f)
        val titleSize = bodySize * 1.5f
        val smallSize = bodySize * 0.85f

        fun paint(size: Float, bold: Boolean = false, color: Int = Color.BLACK) = TextPaint().apply {
            isAntiAlias = true
            textSize = size
            this.color = color
            isFakeBoldText = bold
        }

        fun layout(
            text: String,
            tp: TextPaint,
            w: Int,
            align: Layout.Alignment = Layout.Alignment.ALIGN_CENTER,
        ): StaticLayout = StaticLayout.Builder.obtain(text, 0, text.length, tp, w.coerceAtLeast(1))
            .setAlignment(align)
            .setLineSpacing(0f, 1.15f)
            .build()

        val titlePaint = paint(titleSize, bold = true)
        val bodyPaint = paint(bodySize)
        val boldPaint = paint(bodySize, bold = true)
        val smallPaint = paint(smallSize, color = Color.DKGRAY)
        val center = Layout.Alignment.ALIGN_CENTER
        val right = Layout.Alignment.ALIGN_NORMAL // مع RTL يبدأ من اليمين

        val copy = view.copies.firstOrNull { copyKind == null || it.kind == copyKind }
            ?: view.copies.firstOrNull()

        // ---------------- أنواعُ الأوامر ----------------
        data class KvRow(val label: String, val value: String, val bold: Boolean = false, val boxed: Boolean = false)
        data class ItemBlock(val name: StaticLayout, val details: StaticLayout)

        sealed class Op {
            data class Section(val block: StaticLayout, val topGap: Int = 0) : Op()
            data object Dash : Op()
            data class Kv(val row: KvRow) : Op()
            data class Item(val block: ItemBlock) : Op()
            data class Qr(val bitmap: Bitmap, val caption: StaticLayout, val frameSide: Int) : Op()
            data class Signatures(
                val height: Int,
                val customer: StaticLayout,
                val rep: StaticLayout,
                val boxWidth: Int,
            ) : Op()
        }

        val ops = mutableListOf<Op>()

        // ---------------- بناءُ المحتوى بالترتيب البصريّ ----------------

        // ١) ترويسةُ المنشأة
        ops += Op.Section(layout(view.companyName.ifBlank { "—" }, titlePaint, innerWidth, center))
        val headerLines = buildList {
            if (view.companyTaxNo.isNotBlank()) add("الرقمُ الضريبيّ: ${view.companyTaxNo}")
            if (view.companyCrNo.isNotBlank()) add("السجلُّ التجاريّ: ${view.companyCrNo}")
            view.companyPhones.joinToString(" · ").takeIf { it.isNotBlank() }?.let { add(it) }
            view.companyEmail.takeIf { it.isNotBlank() }?.let { add(it) }
        }
        headerLines.forEach { ops += Op.Section(layout(it, smallPaint, innerWidth, center)) }
        ops += Op.Dash

        // ٢) عنوانُ المستند وأرقامُه
        val docTitle = when {
            view.isZatca -> "فاتورة ضريبية"
            view.invoiceMode == "internal_delivery" -> "مستند تسليم داخلي"
            else -> "مستند بيع"
        }
        ops += Op.Section(layout(docTitle, titlePaint, innerWidth, center), topGap = pad / 3)
        ops += Op.Section(
            layout(
                "رقمُ المستند: ${view.documentNumber}" +
                    (view.invoiceNumber?.takeIf { it.isNotBlank() }?.let { " · رقمُ الفاتورة: $it" } ?: ""),
                bodyPaint, innerWidth, center,
            ),
        )
        ops += Op.Dash

        // ٣) بياناتُ الطرفين
        fun kv(label: String, value: String) = ops += Op.Kv(KvRow(label, value))
        kv("التاريخ", view.saleDate)
        kv("العميل", view.customerName.ifBlank { "عميل نقدي" })
        if (view.customerTaxNo.isNotBlank()) kv("الرقمُ الضريبيّ للعميل", view.customerTaxNo)
        val phone = listOf(view.customerMobile, view.customerPhone).firstOrNull { it.isNotBlank() }
        if (phone != null) kv("هاتف العميل", phone)
        kv("المندوب", view.salesmanName)
        if (view.vanWarehouseName.isNotBlank()) kv("السيارة", view.vanWarehouseName)
        if (view.loadOrderNumber.isNotBlank()) kv("أمرُ التحميل", view.loadOrderNumber)
        if (view.productionBatchNo.isNotBlank()) kv("دفعةُ الإنتاج", view.productionBatchNo)
        kv("طريقةُ الدفع", paymentAr(view.paymentMethod))
        kv("النسخة", copy?.copyLabel ?: "نسخة العميل")
        ops += Op.Dash

        // ٤) الأسطر
        for (line in view.lines) {
            val nameText = if (line.kind == "bonus") "${line.itemName} — كمية مجانية (بونص)" else line.itemName
            val details = buildList {
                add("الكميّة: ${Dec.fmt(line.quantity, 3)}")
                if (line.kind != "bonus") add("سعرُ الوحدة: ${Dec.money(line.unitPrice)}")
                if (line.reason != null && line.reason.isNotBlank()) add("السبب: ${line.reason}")
                if (line.kind != "bonus") add("الإجمالي: ${Dec.money(line.lineTotal)}")
            }
            ops += Op.Item(
                ItemBlock(
                    name = layout(nameText, boldPaint, innerWidth, right),
                    details = layout(details.joinToString("  ·  "), smallPaint, innerWidth, right),
                )
            )
        }
        if (view.lines.isNotEmpty()) ops += Op.Dash

        // ٥) المجموعات — الإجماليُّ مؤطَّر
        fun total(label: String, value: String, bold: Boolean = false, boxed: Boolean = false) =
            ops += Op.Kv(KvRow(label, value, bold, boxed))
        total("المجموعُ قبل الضريبة", Dec.money(view.subtotal))
        if (view.discountTotal.isNotBlank() && Dec.parse(view.discountTotal)?.signum() != 0) {
            total("الخصم", Dec.money(view.discountTotal))
        }
        if (view.isZatca) {
            total("ضريبةُ القيمة المضافة (${Dec.fmt(view.vatRate)}%)", Dec.money(view.vatTotal))
        }
        total("الإجماليُّ المستحقّ", Dec.money(view.grandTotal), bold = true, boxed = true)
        total("المدفوع", Dec.money(view.paidAmount))
        total("المتبقّي", Dec.money(view.outstandingAmount))
        if (Dec.parse(view.bonusQtyTotal)?.signum() > 0) {
            total("إجماليُّ البونص", "${Dec.fmt(view.bonusQtyTotal, 3)} كجم")
        }

        // ٦) رمزُ QR — من الخادم كما هو، داخل إطارٍ مع تسمية
        if (view.isZatca && view.qrPayload.isNotBlank()) {
            val qrSize = (innerWidth * 0.58f).toInt().coerceAtLeast(80)
            val qrImage = qrBitmap(view.qrPayload, qrSize)
            val caption = layout("امسح الرمز للتحقّق من الفاتورة", smallPaint, innerWidth, center)
            ops += Op.Qr(qrImage, caption, frameSide = qrSize + pad / 2)
        }

        // ٧) الملاحظاتُ والتذييل
        if (view.notes.isNotBlank()) {
            ops += Op.Section(layout("ملاحظات: ${view.notes}", smallPaint, innerWidth, right), topGap = pad / 3)
        }
        ops += Op.Section(layout("حُرِّرت في: ${view.printedAt}", smallPaint, innerWidth, center), topGap = pad / 2)
        ops += Op.Section(layout("شكرًا لثقتكم — مندوب التوزيع", boldPaint, innerWidth, center))

        // ٨) خانةُ التوقيع لنسخة المندوب
        if (copy?.requiresCustomerSignature == true) {
            val labelPaint = paint(smallSize)
            val boxWidth = (innerWidth - pad) / 2
            val sigHeight = (width * 0.15f).toInt()
            ops += Op.Signatures(
                height = sigHeight,
                customer = layout(
                    copy.signatureBlock?.customerSignatureLabel ?: "توقيع العميل / المستلم",
                    labelPaint, boxWidth, center,
                ),
                rep = layout(
                    copy.signatureBlock?.repSignatureLabel ?: "توقيع المندوب",
                    labelPaint, boxWidth, center,
                ),
                boxWidth = boxWidth,
            )
        }

        // ---------------- القياسُ بالترتيبِ نفسه ----------------
        fun kvRowHeight(row: KvRow): Int {
            val tp = if (row.bold) boldPaint else bodyPaint
            return maxOf(tp.fontSpacing, tp.textSize * 1.25f).toInt()
        }

        var height = pad
        for (op in ops) {
            height += when (op) {
                is Op.Section -> op.topGap + op.block.height
                is Op.Dash -> 14
                is Op.Kv -> kvRowHeight(op.row) + (if (op.row.boxed) pad / 2 else 0)
                is Op.Item -> op.block.name.height + op.block.details.height + pad / 3
                is Op.Qr -> op.frameSide + op.caption.height + pad / 2
                is Op.Signatures -> pad / 2 + op.height + maxOf(op.customer.height, op.rep.height) + 8
            }
        }
        height += pad

        // ---------------- الرسمُ بالترتيبِ نفسه ----------------
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        val dividerPaint = Paint().apply { color = Color.DKGRAY; strokeWidth = 2f }
        val framePaint = Paint().apply { style = Paint.Style.STROKE; color = Color.DKGRAY; strokeWidth = 2f }
        val softFillPaint = Paint().apply { color = Color.rgb(0xF5, 0xED, 0xE3); style = Paint.Style.FILL }

        fun dashedLine(y: Float) {
            var x = pad.toFloat()
            val end = (width - pad).toFloat()
            while (x < end) {
                canvas.drawLine(x, y, minOf(x + 8f, end), y, dividerPaint)
                x += 14f
            }
        }

        var y = pad.toFloat()
        for (op in ops) {
            when (op) {
                is Op.Section -> {
                    y += op.topGap
                    canvas.withTranslation(y) { op.block.draw(this) }
                    y += op.block.height
                }
                is Op.Dash -> {
                    dashedLine(y + 5f)
                    y += 14f
                }
                is Op.Kv -> {
                    val row = op.row
                    val tp = if (row.bold) boldPaint else bodyPaint
                    val rowH = kvRowHeight(row)
                    if (row.boxed) {
                        val box = RectF(pad.toFloat(), y + 2f, (width - pad).toFloat(), y + rowH + pad / 3f)
                        canvas.drawRoundRect(box, 8f, 8f, softFillPaint)
                        canvas.drawRoundRect(box, 8f, 8f, framePaint)
                        y += pad / 4f
                    }
                    // التسميةُ تلتصقُ باليمين، والقيمةُ باليسار — عمودان لا سطرٌ واحد.
                    val label = layout(row.label, tp, (innerWidth * 0.62f).toInt(), right)
                    val value = layout(row.value, tp, (innerWidth * 0.36f).toInt(), right)
                    canvas.save()
                    canvas.translate((pad + innerWidth - label.width).toFloat(), y + (rowH - label.height) / 2f)
                    label.draw(canvas)
                    canvas.restore()
                    canvas.save()
                    canvas.translate(pad.toFloat(), y + (rowH - value.height) / 2f)
                    value.draw(canvas)
                    canvas.restore()
                    y += rowH + (if (row.boxed) pad / 4 else 0)
                }
                is Op.Item -> {
                    canvas.withTranslation(y) { op.block.name.draw(this) }
                    y += op.block.name.height
                    canvas.withTranslation(y) { op.block.details.draw(this) }
                    y += op.block.details.height + pad / 3f
                }
                is Op.Qr -> {
                    val frameLeft = (width - op.frameSide) / 2f
                    val frameTop = y + pad / 6f
                    canvas.drawRect(
                        RectF(frameLeft, frameTop, frameLeft + op.frameSide, frameTop + op.frameSide),
                        framePaint,
                    )
                    canvas.drawBitmap(
                        op.bitmap,
                        (width - op.bitmap.width) / 2f,
                        frameTop + (op.frameSide - op.bitmap.width) / 2f,
                        null,
                    )
                    canvas.withTranslation(frameTop + op.frameSide + 6f) { op.caption.draw(this) }
                    y += op.frameSide + op.caption.height + pad / 2
                }
                is Op.Signatures -> {
                    val top = y + pad / 2f
                    canvas.drawRect(
                        RectF(
                            (width - pad - op.boxWidth).toFloat(), top,
                            (width - pad).toFloat(), top + op.height,
                        ),
                        framePaint,
                    )
                    canvas.drawRect(
                        RectF(pad.toFloat(), top, (pad + op.boxWidth).toFloat(), top + op.height),
                        framePaint,
                    )
                    canvas.save()
                    canvas.translate((width - pad - op.boxWidth).toFloat(), top + op.height + 4f)
                    op.customer.draw(canvas)
                    canvas.restore()
                    canvas.save()
                    canvas.translate(pad.toFloat(), top + op.height + 4f)
                    op.rep.draw(canvas)
                    canvas.restore()
                    y = top + op.height + maxOf(op.customer.height, op.rep.height) + 8f
                }
            }
        }

        return bitmap
    }

    private fun paymentAr(method: String): String = when (method) {
        "cash" -> "نقديّ"
        "card" -> "بطاقة"
        "credit" -> "آجل"
        else -> method
    }

    /** رمزُ QR من نصّ الحمولة (base64 TLV من الخادم) — محارفُ ASCII آمنة. */
    private fun qrBitmap(payload: String, size: Int): Bitmap {
        val matrix = QRCodeWriter().encode(
            payload,
            BarcodeFormat.QR_CODE,
            size,
            size,
            mapOf(EncodeHintType.CHARACTER_SET to "ISO-8859-1", EncodeHintType.MARGIN to 1),
        )
        val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.RGB_565)
        for (x in 0 until size) {
            for (y in 0 until size) {
                bitmap.setPixel(x, y, if (matrix.get(x, y)) Color.BLACK else Color.WHITE)
            }
        }
        return bitmap
    }

    private inline fun Canvas.withTranslation(y: Float, block: Canvas.() -> Unit) {
        save()
        translate(0f, y)
        block()
        restore()
    }
}
