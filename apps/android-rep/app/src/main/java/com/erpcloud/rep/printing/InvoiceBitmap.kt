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

private data class KvRow(
    val label: String,
    val value: String,
    val bold: Boolean = false,
    val boxed: Boolean = false,
)

private sealed class Op {
    data class Section(val block: StaticLayout, val topGap: Int = 0) : Op()
    data class Banner(val block: StaticLayout, val topGap: Int = 4, val outlined: Boolean = false) : Op()
    data object Dash : Op()
    data object DoubleRule : Op()
    data class Kv(val row: KvRow) : Op()
    data class Cell(val weight: Float, val block: StaticLayout)
    data class Columns(val cells: List<Cell>, val header: Boolean = false) : Op()
    data class Qr(val bitmap: Bitmap, val caption: StaticLayout, val frameSide: Int) : Op()
    data class Signatures(
        val height: Int,
        val customer: StaticLayout,
        val rep: StaticLayout,
        val boxWidth: Int,
    ) : Op()
}

/**
 * توليدُ فاتورة كاشير ضريبيّة احترافيّة (80mm / 58mm / PDF) مع دعم طباعة
 * نسختين رسميّتين (نسخة العميل + نسخة المندوب الموقّعة).
 */
object InvoiceBitmap {

    /** قائمةُ معرّفات النسخ الرسميّة: نسخة العميل (١/٢) ثم نسخة المندوب (٢/٢). */
    fun twoCopyKinds(view: PrintViewDto): List<String> {
        val kinds = view.copies.map { it.kind }.distinct()
        return when {
            kinds.size >= 2 -> kinds.take(2)
            kinds.size == 1 && kinds.first() == "customer" -> listOf("customer", "rep")
            kinds.size == 1 && kinds.first() == "rep" -> listOf("customer", "rep")
            else -> listOf("customer", "rep")
        }
    }

    /** رسمُ النسختين معًا في شريطٍ واحدٍ يفصل بينهما خطّ قصٍّ واضح (للمعاينة وطباعة النظام/PDF). */
    fun renderTwoCopies(view: PrintViewDto, widthPx: Int): Bitmap {
        val width = widthPx.coerceAtLeast(240)
        val kinds = twoCopyKinds(view)
        val first = render(view, widthPx = width, copyKind = kinds[0], copyBadgeOverride = "النسخة ١ من ٢ — نسخة العميل (الأصل)")
        val second = render(view, widthPx = width, copyKind = kinds[1], copyBadgeOverride = "النسخة ٢ من ٢ — نسخة المندوب (للمحاسبة والتوقيع)")

        val cutBarH = (width * 0.085f).toInt().coerceAtLeast(44)
        val combined = Bitmap.createBitmap(width, first.height + cutBarH + second.height, Bitmap.Config.RGB_565)
        val canvas = Canvas(combined)
        canvas.drawColor(Color.WHITE)
        canvas.drawBitmap(first, 0f, 0f, null)

        val pad = (width / 22).toFloat()
        val cutY = first.height + cutBarH / 2f
        val dashPaint = Paint().apply {
            color = Color.BLACK
            strokeWidth = 2.5f
            style = Paint.Style.STROKE
        }
        var x = pad
        val end = width - pad
        while (x < end) {
            canvas.drawLine(x, cutY, minOf(x + 12f, end), cutY, dashPaint)
            x += 20f
        }
        val labelPaint = TextPaint().apply {
            isAntiAlias = true
            textSize = (width / 32f).coerceIn(10f, 30f)
            color = Color.BLACK
            isFakeBoldText = true
        }
        val cutText = "✂  افصل هنا — النسخة الثانية للمندوب  ✂"
        val cutLayout = StaticLayout.Builder.obtain(cutText, 0, cutText.length, labelPaint, (width * 0.68f).toInt())
            .setAlignment(Layout.Alignment.ALIGN_CENTER)
            .build()
        val pillW = cutLayout.width + 24f
        val pillH = cutLayout.height + 10f
        val pillLeft = (width - pillW) / 2f
        val pillTop = cutY - pillH / 2f
        val whiteFill = Paint().apply { color = Color.WHITE; style = Paint.Style.FILL }
        canvas.drawRoundRect(RectF(pillLeft, pillTop, pillLeft + pillW, pillTop + pillH), 8f, 8f, whiteFill)
        canvas.drawRoundRect(RectF(pillLeft, pillTop, pillLeft + pillW, pillTop + pillH), 8f, 8f, dashPaint)
        canvas.save()
        canvas.translate((width - cutLayout.width) / 2f, cutY - cutLayout.height / 2f)
        cutLayout.draw(canvas)
        canvas.restore()

        canvas.drawBitmap(second, 0f, (first.height + cutBarH).toFloat(), null)
        return combined
    }

    /** توليدُ قائمتَي الصورتين المستقلّتين لإرسالهما إلى الطابعة الحراريّة (مع قطعٍ بينهما). */
    fun renderPairForThermal(view: PrintViewDto, widthPx: Int): List<Bitmap> {
        val kinds = twoCopyKinds(view)
        return listOf(
            render(view, widthPx = widthPx, copyKind = kinds[0], copyBadgeOverride = "النسخة ١ من ٢ — نسخة العميل (الأصل)"),
            render(view, widthPx = widthPx, copyKind = kinds[1], copyBadgeOverride = "النسخة ٢ من ٢ — نسخة المندوب (للمحاسبة والتوقيع)"),
        )
    }

    fun render(
        view: PrintViewDto,
        widthPx: Int,
        copyKind: String? = null,
        copyBadgeOverride: String? = null,
    ): Bitmap {
        val width = widthPx.coerceAtLeast(200)
        val pad = width / 22
        val innerWidth = width - pad * 2
        val bodySize = (width / 27f).coerceIn(9f, 40f)
        val titleSize = bodySize * 1.45f
        val smallSize = bodySize * 0.84f

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
            .setLineSpacing(0f, 1.14f)
            .build()

        val titlePaint = paint(titleSize, bold = true)
        val bannerPaint = paint(bodySize * 1.12f, bold = true, color = Color.WHITE)
        val bodyPaint = paint(bodySize)
        val boldPaint = paint(bodySize, bold = true)
        val smallPaint = paint(smallSize, color = Color.DKGRAY)
        val smallBold = paint(smallSize, bold = true)
        val center = Layout.Alignment.ALIGN_CENTER
        val right = Layout.Alignment.ALIGN_NORMAL

        val effectiveKind = copyKind ?: view.copies.firstOrNull()?.kind ?: "customer"
        val copy = view.copies.firstOrNull { it.kind == effectiveKind }
        val isRepCopy = effectiveKind == "rep" || copy?.requiresCustomerSignature == true

        val ops = mutableListOf<Op>()

        // ١) ترويسةُ المنشأة
        ops += Op.Section(layout(view.companyName.ifBlank { "منشأة التوزيع والمبيعات" }, titlePaint, innerWidth, center))
        if (view.companyTaxNo.isNotBlank()) {
            ops += Op.Section(layout("الرقمُ الضريبيّ: ${view.companyTaxNo}", smallBold, innerWidth, center))
        }
        val crAndPhones = buildList {
            if (view.companyCrNo.isNotBlank()) add("س.ت: ${view.companyCrNo}")
            view.companyPhones.joinToString(" · ").takeIf { it.isNotBlank() }?.let { add("هاتف: $it") }
        }.joinToString("  ·  ")
        if (crAndPhones.isNotBlank()) {
            ops += Op.Section(layout(crAndPhones, smallPaint, innerWidth, center))
        }
        ops += Op.DoubleRule

        // ٢) شريطُ عنوان فاتورة الكاشير + شارةُ النسخة
        val isReturnDoc = view.documentKind == "return" || view.documentKind == "sale_return"
        val docTitle = when {
            isReturnDoc && view.isZatca -> "إشعار دائن ضريبي — إيصال كاشير"
            isReturnDoc -> "إيصال مرتجع مبيعات"
            view.isZatca && view.customerTaxNo.isNotBlank() -> "فاتورة ضريبية — إيصال كاشير"
            view.isZatca -> "فاتورة ضريبية مبسطة — إيصال كاشير"
            view.invoiceMode == "internal_delivery" -> "سند تسليم بضاعة"
            else -> "فاتورة مبيعات — إيصال كاشير"
        }
        ops += Op.Banner(layout(docTitle, bannerPaint, innerWidth, center))

        val copyBadge = copyBadgeOverride ?: copy?.copyLabel ?: if (isRepCopy) {
            "نسخة المندوب — تُوقَّع وتُسلَّم للمحاسبة"
        } else {
            "نسخة العميل — الأصل"
        }
        ops += Op.Banner(layout(copyBadge, smallBold, innerWidth, center), topGap = 2, outlined = true)

        // ٣) بياناتُ المستند والطرفين
        fun kv(label: String, value: String, bold: Boolean = false, boxed: Boolean = false) {
            ops += Op.Kv(KvRow(label, value, bold, boxed))
        }
        val mainNo = view.invoiceNumber?.takeIf { it.isNotBlank() } ?: view.documentNumber
        kv("رقمُ الفاتورة", mainNo, bold = true)
        if (!view.invoiceNumber.isNullOrBlank() && view.documentNumber != view.invoiceNumber) {
            kv("مرجعُ السند", view.documentNumber)
        }
        kv("التاريخ", view.saleDate)
        kv("العميل", view.customerName.ifBlank { "عميل نقدي" }, bold = true)
        if (view.customerTaxNo.isNotBlank()) kv("الرقمُ الضريبيّ للعميل", view.customerTaxNo)
        val phone = listOf(view.customerMobile, view.customerPhone).firstOrNull { it.isNotBlank() }
        if (phone != null) kv("جوال العميل", phone)
        kv("المندوب", view.salesmanName)
        if (view.vanWarehouseName.isNotBlank()) kv("السيارة", view.vanWarehouseName)
        if (view.loadOrderNumber.isNotBlank()) kv("أمرُ التحميل", view.loadOrderNumber)
        kv("طريقةُ الدفع", paymentAr(view.paymentMethod), bold = true)
        ops += Op.Dash

        // ٤) جدولُ الأصناف بأربعة أعمدة احترافيّة (كاشير)
        if (view.lines.isNotEmpty()) {
            fun tableRow(
                c1: String,
                c2: String,
                c3: String,
                c4: String,
                tp: TextPaint,
                header: Boolean = false,
            ) {
                ops += Op.Columns(
                    listOf(
                        Op.Cell(0.42f, layout(c1, tp, (innerWidth * 0.42f).toInt(), if (header) center else right)),
                        Op.Cell(0.16f, layout(c2, tp, (innerWidth * 0.16f).toInt(), center)),
                        Op.Cell(0.19f, layout(c3, tp, (innerWidth * 0.19f).toInt(), center)),
                        Op.Cell(0.23f, layout(c4, tp, (innerWidth * 0.23f).toInt(), center)),
                    ),
                    header = header,
                )
            }
            tableRow("الصنف", "الكمية", "السعر", "الإجمالي", smallBold, header = true)
            for (line in view.lines) {
                val nameText = buildString {
                    append(line.itemName)
                    if (line.kind == "bonus" && !line.itemName.contains("بونص")) append(" (بونص)")
                    if (line.kind == "return" && !line.itemName.contains("مرتجع")) append(" (مرتجع)")
                }
                val priceStr = if (line.kind == "bonus") "مجاني" else Dec.money(line.unitPrice)
                val totalStr = if (line.kind == "bonus") "0.00" else Dec.money(line.lineTotal)
                tableRow(nameText, Dec.fmt(line.quantity, 2), priceStr, totalStr, bodyPaint)
                if (!line.reason.isNullOrBlank() || (line.kind != "bonus" && Dec.isPositive(line.discount))) {
                    val subNote = buildList {
                        if (line.kind != "bonus" && Dec.isPositive(line.discount)) add("خصم السطر: ${Dec.money(line.discount)}")
                        if (!line.reason.isNullOrBlank()) add("السبب: ${line.reason}")
                    }.joinToString(" · ")
                    ops += Op.Section(layout("   ↳ $subNote", smallPaint, innerWidth, right))
                }
            }
            ops += Op.Dash
        }

        // ٥) ملخّصُ المبالغ والضريبة
        kv("المجموعُ قبل الضريبة", Dec.money(view.subtotal) + " ر.س")
        if (view.discountTotal.isNotBlank() && Dec.parse(view.discountTotal)?.signum() != 0) {
            kv("الخصم", Dec.money(view.discountTotal) + " ر.س")
        }
        if (view.isZatca) {
            kv("ضريبةُ القيمة المضافة (${Dec.fmt(view.vatRate)}%)", Dec.money(view.vatTotal) + " ر.س")
        }
        kv("الإجماليُّ المستحقّ", Dec.money(view.grandTotal) + " ر.س", bold = true, boxed = true)
        kv("المدفوع", Dec.money(view.paidAmount) + " ر.س")
        kv("المتبقّي", Dec.money(view.outstandingAmount) + " ر.س", bold = Dec.isPositive(view.outstandingAmount))
        if (Dec.isPositive(view.bonusQtyTotal)) {
            kv("إجماليُّ البونص المجانيّ", "${Dec.fmt(view.bonusQtyTotal, 2)} كجم")
        }
        ops += Op.DoubleRule

        // ٦) رمزُ QR الزكاة
        val qrValue = view.effectiveQr
        if (view.isZatca && qrValue.isNotBlank()) {
            val qrSize = (innerWidth * 0.48f).toInt().coerceAtLeast(100)
            val qrImage = qrBitmap(qrValue, qrSize)
            val caption = layout("فاتورة إلكترونيّة متوافقة مع ZATCA — امسح للتحقّق", smallBold, innerWidth, center)
            ops += Op.Qr(qrImage, caption, frameSide = qrSize + pad / 2)
        }

        // ٧) الملاحظاتُ وخانةُ التوقيع (في نسخة المندوب)
        if (view.notes.isNotBlank()) {
            ops += Op.Section(layout("ملاحظات: ${view.notes}", smallPaint, innerWidth, right), topGap = pad / 3)
        }
        if (isRepCopy) {
            val boxWidth = (innerWidth - pad) / 2
            val sigHeight = (width * 0.14f).toInt()
            ops += Op.Signatures(
                height = sigHeight,
                customer = layout(
                    copy?.signatureBlock?.customerSignatureLabel ?: "توقيع وختم العميل المستلم",
                    smallBold, boxWidth, center,
                ),
                rep = layout(
                    copy?.signatureBlock?.repSignatureLabel ?: "توقيع المندوب",
                    smallBold, boxWidth, center,
                ),
                boxWidth = boxWidth,
            )
            val accNote = copy?.signatureBlock?.accountantNote?.trim().orEmpty()
                .ifBlank { "تُحفَظ هذه النسخةُ موقّعةً وتُسلَّم لقسم المحاسبة عند إقفال العهدة." }
            ops += Op.Section(layout(accNote, smallPaint, innerWidth, center), topGap = 4)
        }

        ops += Op.Section(layout("طُبعت في: ${view.printedAt}", smallPaint, innerWidth, center), topGap = pad / 3)
        ops += Op.Section(layout("شكرًا لتعاملكم معنا", boldPaint, innerWidth, center), topGap = 2)

        // ---------------- القياسُ والرسم ----------------
        fun kvRowHeight(row: KvRow): Int {
            val tp = if (row.bold) boldPaint else bodyPaint
            val labelLayout = layout(row.label, tp, (innerWidth * 0.58f).toInt(), right)
            val valueLayout = layout(row.value, tp, (innerWidth * 0.40f).toInt(), right)
            val minH = maxOf(tp.fontSpacing, tp.textSize * 1.25f).toInt()
            return maxOf(minH, labelLayout.height + 4, valueLayout.height + 4)
        }

        var height = pad
        for (op in ops) {
            height += when (op) {
                is Op.Section -> op.topGap + op.block.height
                is Op.Banner -> op.topGap + op.block.height + pad / 2 + 6
                is Op.Dash -> 14
                is Op.DoubleRule -> 16
                is Op.Kv -> kvRowHeight(op.row) + (if (op.row.boxed) pad / 2 else 0)
                is Op.Columns -> (op.cells.maxOfOrNull { it.block.height } ?: 0) + (if (op.header) 14 else 8)
                is Op.Qr -> op.frameSide + op.caption.height + pad / 2
                is Op.Signatures -> pad / 2 + op.height + maxOf(op.customer.height, op.rep.height) + 10
            }
        }
        height += pad

        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        val dividerPaint = Paint().apply { color = Color.DKGRAY; strokeWidth = 2f }
        val boldRulePaint = Paint().apply { color = Color.BLACK; strokeWidth = 3f }
        val framePaint = Paint().apply { style = Paint.Style.STROKE; color = Color.BLACK; strokeWidth = 2.5f }
        val softFillPaint = Paint().apply { color = Color.rgb(0xF5, 0xED, 0xE3); style = Paint.Style.FILL }
        val headerBarPaint = Paint().apply { color = Color.rgb(0xEB, 0xE5, 0xDC); style = Paint.Style.FILL }
        val bannerFillPaint = Paint().apply { color = Color.BLACK; style = Paint.Style.FILL }

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
                is Op.Banner -> {
                    y += op.topGap
                    val boxH = op.block.height + pad / 2f
                    val rect = RectF(pad.toFloat(), y, (width - pad).toFloat(), y + boxH)
                    if (op.outlined) {
                        canvas.drawRoundRect(rect, 8f, 8f, softFillPaint)
                        canvas.drawRoundRect(rect, 8f, 8f, framePaint)
                    } else {
                        canvas.drawRoundRect(rect, 10f, 10f, bannerFillPaint)
                    }
                    canvas.save()
                    canvas.translate(pad.toFloat(), y + (boxH - op.block.height) / 2f)
                    op.block.draw(canvas)
                    canvas.restore()
                    y += boxH + 6f
                }
                is Op.Dash -> {
                    dashedLine(y + 5f)
                    y += 14f
                }
                is Op.DoubleRule -> {
                    val left = pad.toFloat()
                    val end = (width - pad).toFloat()
                    canvas.drawLine(left, y + 4f, end, y + 4f, boldRulePaint)
                    canvas.drawLine(left, y + 10f, end, y + 10f, dividerPaint)
                    y += 16f
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
                    val label = layout(row.label, tp, (innerWidth * 0.58f).toInt(), right)
                    val value = layout(row.value, tp, (innerWidth * 0.40f).toInt(), right)
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
                is Op.Columns -> {
                    val rowH = (op.cells.maxOfOrNull { it.block.height } ?: 0).toFloat()
                    if (op.header) {
                        val headerBox = RectF(pad.toFloat(), y, (width - pad).toFloat(), y + rowH + 10f)
                        canvas.drawRoundRect(headerBox, 6f, 6f, headerBarPaint)
                        canvas.drawLine(pad.toFloat(), y + rowH + 10f, (width - pad).toFloat(), y + rowH + 10f, boldRulePaint)
                    }
                    val yText = if (op.header) y + 5f else y + 2f
                    var xRight = (width - pad).toFloat()
                    for (cell in op.cells) {
                        val w = innerWidth * cell.weight
                        canvas.save()
                        canvas.translate(xRight - w, yText)
                        cell.block.draw(canvas)
                        canvas.restore()
                        xRight -= w
                    }
                    y += rowH + (if (op.header) 14f else 8f)
                }
                is Op.Qr -> {
                    val frameLeft = (width - op.frameSide) / 2f
                    val frameTop = y + pad / 6f
                    canvas.drawRoundRect(
                        RectF(frameLeft, frameTop, frameLeft + op.frameSide, frameTop + op.frameSide),
                        10f,
                        10f,
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
                        RectF((width - pad - op.boxWidth).toFloat(), top, (width - pad).toFloat(), top + op.height),
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
                    y = top + op.height + maxOf(op.customer.height, op.rep.height) + 10f
                }
            }
        }

        return bitmap
    }

    private fun paymentAr(method: String): String = when (method) {
        "cash" -> "نقديّ"
        "card" -> "شبكة / بطاقة"
        "bank", "transfer" -> "تحويل بنكيّ"
        "credit" -> "آجل"
        else -> method
    }

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
