package com.erpcloud.bakery.printing

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import com.erpcloud.bakery.data.api.LoadOrderDto
import com.erpcloud.bakery.data.api.PrintViewDto
import com.erpcloud.bakery.data.api.ProductionBatchDto
import com.erpcloud.bakery.data.api.ReportResultDto
import com.erpcloud.bakery.util.Dec

/**
 * مستنداتُ طباعة تطبيق المخابز (ESC/POS عبر صورةٍ نقطيّة — العربيّةُ تُرسم في
 * الصورة فتخرجُ سليمةً على أيّ طابعةٍ حراريّة):
 *
 * - [loadOrderNotice]: إشعارُ تحميلٍ يوقّعه المندوبُ عند الاستلام.
 * - [closingSummary]: ملخّصُ إقفال ورديةٍ للمشرف/المحاسب (المتوقّع/الفعليّ/الفرق/النقد).
 * - [batchLabel]: بطاقةُ دفعةِ إنتاجٍ تُعلَّق على الرفّ.
 *
 * البناءُ بمسارِ أوامرٍ واحد (Ops) يُقاس ويُرسَم بالترتيبِ نفسه — فلا انفصامَ
 * بين الارتفاعِ المحسوب والمحتوى المرسوم (النمطُ المُقيسُ من فاتورة المندوب).
 */

/** لبناتُ مسار الرسم — خاصّةٌ بالملف. */
private data class KvRow(
    val label: String,
    val value: String,
    val bold: Boolean = false,
    val boxed: Boolean = false,
)

private sealed class Op {
    data class Section(val block: StaticLayout, val topGap: Int = 0) : Op()
    data class Banner(val block: StaticLayout, val topGap: Int = 4) : Op()
    data object Dash : Op()
    data object DoubleRule : Op()
    data class Kv(val row: KvRow) : Op()
    data class Signatures(val height: Int, val boxes: List<StaticLayout>, val boxWidth: Int) : Op()

    /** صفُّ أعمدةٍ (أسطرُ الفاتورة) — يُرسمُ من اليمين: أوّلُ خليّةٍ أقصى اليمين. */
    data class Cell(val weight: Float, val block: StaticLayout)
    data class Columns(val cells: List<Cell>, val header: Boolean = false) : Op()

    /** 🧾 مربّعُ QR الزكاة — يُرسمُ وسطًا بعرضٍ متناسبٍ مع الورقة. */
    data class Qr(val bitmap: Bitmap) : Op()
}

/** سياقُ الرسم المشترك بين المستندات — القياسُ والرسمُ بمسارٍ واحد. */
private class DocCanvas(widthPx: Int) {
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

    fun kvRowHeight(row: KvRow, bodyPaint: TextPaint, boldPaint: TextPaint): Int {
        val tp = if (row.bold) boldPaint else bodyPaint
        val right = Layout.Alignment.ALIGN_NORMAL
        val labelH = layout(row.label, tp, (innerWidth * 0.62f).toInt(), right).height
        val valueH = layout(row.value, tp, (innerWidth * 0.36f).toInt(), right).height
        return maxOf(labelH, valueH, tp.fontSpacing.toInt()) + 4
    }

    /** يبني الصورة من المسار — قياسًا ثمّ رسمًا بالترتيب نفسه. */
    fun render(ops: List<Op>): Bitmap {
        val titlePaint = paint(titleSize, bold = true)
        val bodyPaint = paint(bodySize)
        val boldPaint = paint(bodySize, bold = true)

        var height = pad
        for (op in ops) {
            height += when (op) {
                is Op.Section -> op.topGap + op.block.height
                is Op.Banner -> op.topGap + op.block.height + pad / 2 + 6
                is Op.Dash -> 14
                is Op.DoubleRule -> 16
                is Op.Kv -> kvRowHeight(op.row, bodyPaint, boldPaint) + (if (op.row.boxed) pad / 2 else 0)
                is Op.Signatures -> pad / 2 + op.height + (op.boxes.maxOfOrNull { it.height } ?: 0) + 8
                is Op.Columns -> (op.cells.maxOfOrNull { it.block.height } ?: 0) + (if (op.header) 14 else 8)
                is Op.Qr -> op.bitmap.height + pad + 10
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

        val right = Layout.Alignment.ALIGN_NORMAL // مع RTL يبدأ من اليمين
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
                    canvas.drawRoundRect(rect, 10f, 10f, bannerFillPaint)
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
                    val rowH = kvRowHeight(row, bodyPaint, boldPaint)
                    if (row.boxed) {
                        val box = RectF(pad.toFloat(), y + 2f, (width - pad).toFloat(), y + rowH + pad / 3f)
                        canvas.drawRoundRect(box, 8f, 8f, softFillPaint)
                        canvas.drawRoundRect(box, 8f, 8f, framePaint)
                        y += pad / 4f
                    }
                    // التسميةُ تلتصقُ باليمين، والقيمةُ باليسار — عمودان.
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
                is Op.Signatures -> {
                    y += pad / 4f
                    val count = op.boxes.size.coerceAtLeast(1)
                    val gap = 12f
                    val boxW = ((innerWidth - gap * (count - 1)) / count).toFloat()
                    var x = pad.toFloat()
                    for (box in op.boxes) {
                        val boxRect = RectF(x, y, x + boxW, y + op.height)
                        canvas.drawRect(boxRect, framePaint)
                        canvas.save()
                        canvas.translate(x + (boxW - box.width) / 2f, y + op.height - box.height - 6f)
                        box.draw(canvas)
                        canvas.restore()
                        x += boxW + gap
                    }
                    y += op.height + 8f
                }
                is Op.Qr -> {
                    val size = op.bitmap.width.toFloat()
                    val framePad = 8f
                    val left = (width - size) / 2f
                    y += pad / 3f
                    canvas.drawRoundRect(
                        RectF(left - framePad, y - framePad, left + size + framePad, y + size + framePad),
                        10f,
                        10f,
                        framePaint,
                    )
                    canvas.drawBitmap(op.bitmap, left, y, null)
                    y += size + pad / 2f + 10f
                }
            }
        }
        return bitmap
    }
}

/** حالةُ أمر التحميل بالعربيّة (تُشاركُ الملخّصَ والإشعار). */
private fun loadStatusAr(status: String): String = when (status) {
    "pending_receipt" -> "بانتظار الاستلام"
    "loaded" -> "مُحمَّل"
    "in_route" -> "في الطريق"
    "pending_closing" -> "بانتظار الإقفال"
    "pending_stock_settlement" -> "بانتظار تسوية المخزون"
    "settled" -> "مُسوّاة"
    "cancelled" -> "ملغاة"
    else -> status
}

/** إزاحةٌ عموديّة مؤقّتة للرسم — محليّةٌ بالملف (كما في فاتورة المندوب، بلا استيراد androidx). */
private inline fun Canvas.withTranslation(y: Float, block: Canvas.() -> Unit) {
    save()
    translate(0f, y)
    block()
    restore()
}

/** إشعارُ تحميلٍ — يوقّعه المندوبُ عند استلام التوريد. */
fun loadOrderNotice(order: LoadOrderDto, widthPx: Int = 576): Bitmap {
    val doc = DocCanvas(widthPx)
    val titlePaint = doc.paint(doc.titleSize, bold = true)
    val bodyPaint = doc.paint(doc.bodySize)
    val smallPaint = doc.paint(doc.smallSize, color = Color.DKGRAY)
    val center = Layout.Alignment.ALIGN_CENTER

    val ops = mutableListOf<Op>()
    ops += Op.Section(doc.layout("إشعار تحميل وتسلّم عهدة", titlePaint, doc.innerWidth, center))
    ops += Op.Section(
        doc.layout(
            "${order.number.ifBlank { "أمر تحميل" }} · ${loadStatusAr(order.status)}",
            smallPaint, doc.innerWidth, center,
        ),
    )
    ops += Op.Dash

    fun kv(label: String, value: String, bold: Boolean = false, boxed: Boolean = false) {
        ops += Op.Kv(KvRow(label, value, bold, boxed))
    }

    kv("التاريخ", order.loadDate.ifBlank { "—" })
    kv("المندوب", order.salesmanName.ifBlank { "—" })
    kv("الصنف", order.itemName.ifBlank { "—" })
    kv("الكميّةُ المحمَّلة", Dec.kg(order.loadedQty) + " كجم", bold = true, boxed = true)
    if (order.vehiclePlate.isNotBlank()) kv("المركبة", order.vehiclePlate)
    if (order.productionBatchNo.isNotBlank()) kv("دفعةُ الإنتاج", order.productionBatchNo)
    if (Dec.isPositive(order.maxBonusQty)) kv("سقفُ المجاني", Dec.kg(order.maxBonusQty) + " كجم")
    if (order.notes.isNotBlank()) kv("ملاحظات", order.notes)
    ops += Op.Dash
    ops += Op.Section(
        doc.layout(
            "يُوقّع المندوبُ على استلام العهدة أعلاه، وهي أساسُ ما يُسأل عنه عند الإقفال.",
            smallPaint, doc.innerWidth, center,
        ),
    )
    ops += Op.Signatures(
        height = 56,
        boxes = listOf(
            doc.layout("توقيعُ المندوب", smallPaint, doc.innerWidth / 2, center),
            doc.layout("توقيعُ أمين المستودع", smallPaint, doc.innerWidth / 2, center),
        ),
        boxWidth = doc.innerWidth / 2,
    )
    return doc.render(ops)
}

/** ملخّصُ إقفال ورديةٍ — للمشرف/المحاسب عند الاعتماد. */
fun closingSummary(order: LoadOrderDto, widthPx: Int = 576): Bitmap {
    val doc = DocCanvas(widthPx)
    val titlePaint = doc.paint(doc.titleSize, bold = true)
    val bodyPaint = doc.paint(doc.bodySize)
    val smallPaint = doc.paint(doc.smallSize, color = Color.DKGRAY)
    val center = Layout.Alignment.ALIGN_CENTER

    val ops = mutableListOf<Op>()
    ops += Op.Section(doc.layout("ملخّص إقفال وردية", titlePaint, doc.innerWidth, center))
    ops += Op.Section(
        doc.layout(
            "${order.number.ifBlank { "أمر" }} · ${order.salesmanName.ifBlank { "مندوب" }} · ${loadStatusAr(order.status)}",
            smallPaint, doc.innerWidth, center,
        ),
    )
    ops += Op.Dash

    fun kv(label: String, value: String, bold: Boolean = false, boxed: Boolean = false) {
        ops += Op.Kv(KvRow(label, value, bold, boxed))
    }

    kv("التاريخ", order.loadDate.ifBlank { "—" })
    kv("أساسُ العهدة (مستلَم)", Dec.kg(order.receivedQty) + " كجم")
    kv("المُباع", Dec.kg(order.soldQty) + " كجم")
    kv("المجاني", Dec.kg(order.bonusQty) + " كجم")
    kv("المرتجع", Dec.kg(order.returnedQty) + " كجم")
    kv("التالف", Dec.kg(order.damagedQty) + " كجم")
    kv("العجز", Dec.kg(order.shortageQty) + " كجم")
    kv("المتوقّعُ البقاء", Dec.kg(order.expectedRemainingQty) + " كجم", bold = true)
    kv("المُعلنُ بالجرد", Dec.kg(order.actualRemainingQty) + " كجم", bold = true)
    kv("فرقُ الاعتماد", Dec.kg(order.countVarianceQty) + " كجم", bold = true, boxed = true)
    if (order.vehicleCountQty != null) kv("عددُ المركبة المُعلن", Dec.kg(order.vehicleCountQty) + " كجم")
    ops += Op.Dash
    kv("النقدُ المتوقّع", Dec.money(order.expectedCash) + " ر.س")
    kv("النقدُ المُحصَّل", Dec.money(order.collectedCash) + " ر.س")
    kv("فرقُ النقد", Dec.money(order.cashVariance) + " ر.س", boxed = true)
    if (order.damageReason.isNotBlank()) kv("سببُ التالف", order.damageReason)
    if (order.closingNotes.isNotBlank()) kv("ملاحظاتُ الإقفال", order.closingNotes)
    if (order.approvedByLabel.isNotBlank()) kv("اعتُمد بوساطة", order.approvedByLabel)
    ops += Op.Signatures(
        height = 56,
        boxes = listOf(
            doc.layout("توقيعُ المندوب", smallPaint, doc.innerWidth / 2, center),
            doc.layout("توقيعُ المحاسب", smallPaint, doc.innerWidth / 2, center),
        ),
        boxWidth = doc.innerWidth / 2,
    )
    return doc.render(ops)
}

/** بطاقةُ دفعةِ إنتاجٍ — تُعلَّق على رفّ المخبز. */
fun batchLabel(batch: ProductionBatchDto, widthPx: Int = 576): Bitmap {
    val doc = DocCanvas(widthPx)
    val titlePaint = doc.paint(doc.titleSize, bold = true)
    val bodyPaint = doc.paint(doc.bodySize)
    val center = Layout.Alignment.ALIGN_CENTER

    val ops = mutableListOf<Op>()
    ops += Op.Section(doc.layout("دفعة إنتاج", titlePaint, doc.innerWidth, center))
    ops += Op.Section(
        doc.layout(batch.batchNo.ifBlank { "—" }, doc.paint(doc.titleSize), doc.innerWidth, center),
    )
    ops += Op.Dash

    fun kv(label: String, value: String, bold: Boolean = false, boxed: Boolean = false) {
        ops += Op.Kv(KvRow(label, value, bold, boxed))
    }

    kv("الصنف", batch.itemName.ifBlank { "—" })
    kv("تاريخُ الإنتاج", batch.productionDate.ifBlank { "—" })
    kv("المنتج", Dec.kg(batch.producedQty) + " كجم", bold = true, boxed = true)
    kv("الفاقد", Dec.kg(batch.scrapQty) + " كجم")
    kv("المتاحُ بالمستودع", Dec.kg(batch.availableWarehouseQty) + " كجم")
    kv("تكلفةُ الوحدة", Dec.money(batch.unitCost) + " ر.س")
    if (batch.supervisorName.isNotBlank()) kv("المشرف", batch.supervisorName)
    if (batch.lotId != null) kv("رقمُ اللوط", batch.lotId ?: "")
    return doc.render(ops)
}

/** سطرُ صنفٍ مطبوعٍ في فاتورة الكاشير الاحترافيّة. */
data class PosReceiptLine(
    val nameAr: String,
    val qty: String,
    val unitPrice: String,
    val lineTotal: String,
    val sku: String = "",
)

/** بياناتٌ تكميليّةٌ لترويسة فاتورة الكاشير (الفرع/الكاشير/العميل/التاريخ). */
data class PosReceiptMeta(
    val branchName: String = "",
    val cashierName: String = "",
    val customerName: String = "عميل نقدي",
    val issuedAt: String = "",
    val sellerCrNo: String = "",
    val sellerPhone: String = "",
)

/**
 * فاتورةُ كاشيرٍ ضريبيّةٌ احترافيّة (80mm / 58mm) — تُطبعُ فور نجاح `pos/checkout`
 * بترويسة المنشأة الكاملة، وجدولِ الأصناف ذي الـ٤ أعمدة، والإجماليّ المؤطّر، ورمز QR الزكاة.
 */
fun posReceipt(
    receipt: com.erpcloud.bakery.data.api.PosCheckoutReceiptDto,
    subtotal: java.math.BigDecimal,
    qrPayload: String? = null,
    sellerName: String = "",
    sellerTaxNo: String = "",
    widthPx: Int = 576,
    lines: List<PosReceiptLine> = emptyList(),
    meta: PosReceiptMeta = PosReceiptMeta(),
): Bitmap {
    val doc = DocCanvas(widthPx)
    val titlePaint = doc.paint(doc.titleSize, bold = true)
    val bannerPaint = doc.paint(doc.bodySize * 1.12f, bold = true, color = Color.WHITE)
    val bodyPaint = doc.paint(doc.bodySize)
    val boldPaint = doc.paint(doc.bodySize, bold = true)
    val smallPaint = doc.paint(doc.smallSize, color = Color.DKGRAY)
    val smallBold = doc.paint(doc.smallSize, bold = true)
    val center = Layout.Alignment.ALIGN_CENTER
    val right = Layout.Alignment.ALIGN_NORMAL

    val ops = mutableListOf<Op>()

    // ١) ترويسةُ المنشأة
    val effectiveSeller = sellerName.trim().ifBlank { "منشأة المخابز والإنتاج" }
    ops += Op.Section(doc.layout(effectiveSeller, titlePaint, doc.innerWidth, center))
    if (meta.branchName.isNotBlank()) {
        ops += Op.Section(doc.layout("الفرع: ${meta.branchName.trim()}", smallBold, doc.innerWidth, center))
    }
    if (sellerTaxNo.isNotBlank()) {
        ops += Op.Section(doc.layout("الرقمُ الضريبيّ: ${sellerTaxNo.trim()}", smallPaint, doc.innerWidth, center))
    }
    val subHeader = buildList {
        if (meta.sellerCrNo.isNotBlank()) add("س.ت: ${meta.sellerCrNo.trim()}")
        if (meta.sellerPhone.isNotBlank()) add("هاتف: ${meta.sellerPhone.trim()}")
    }.joinToString("  ·  ")
    if (subHeader.isNotBlank()) {
        ops += Op.Section(doc.layout(subHeader, smallPaint, doc.innerWidth, center))
    }
    ops += Op.DoubleRule

    // ٢) شريطُ عنوانِ فاتورة الكاشير
    val bannerTitle = if (sellerTaxNo.isNotBlank() || !qrPayload.isNullOrBlank()) {
        "فاتورة ضريبية مبسطة — إيصال كاشير"
    } else {
        "فاتورة مبيعات نقدية — إيصال كاشير"
    }
    ops += Op.Banner(doc.layout(bannerTitle, bannerPaint, doc.innerWidth, center))

    fun kv(label: String, value: String, bold: Boolean = false, boxed: Boolean = false) {
        ops += Op.Kv(KvRow(label, value, bold, boxed))
    }

    val stamp = meta.issuedAt.ifBlank {
        java.text.SimpleDateFormat("yyyy-MM-dd HH:mm", java.util.Locale.US).format(java.util.Date())
    }
    kv("رقمُ الفاتورة", receipt.number.ifBlank { "—" }, bold = true)
    kv("التاريخُ والوقت", stamp)
    kv("العميل", meta.customerName.ifBlank { "عميل نقدي" })
    if (meta.cashierName.isNotBlank()) kv("الكاشير", meta.cashierName)
    kv("طريقةُ الدفع", Labels_receipt(receipt))
    ops += Op.Dash

    // ٣) جدولُ الأصناف (٤ أعمدة احترافيّة)
    if (lines.isNotEmpty()) {
        fun tableRow(
            c1: String,
            c2: String,
            c3: String,
            c4: String,
            paint: TextPaint,
            header: Boolean = false,
        ) {
            ops += Op.Columns(
                listOf(
                    Op.Cell(0.42f, doc.layout(c1, paint, (doc.innerWidth * 0.42f).toInt(), if (header) center else right)),
                    Op.Cell(0.15f, doc.layout(c2, paint, (doc.innerWidth * 0.15f).toInt(), center)),
                    Op.Cell(0.19f, doc.layout(c3, paint, (doc.innerWidth * 0.19f).toInt(), center)),
                    Op.Cell(0.24f, doc.layout(c4, paint, (doc.innerWidth * 0.24f).toInt(), center)),
                ),
                header = header,
            )
        }
        tableRow("الصنف", "الكمية", "السعر", "الإجمالي", smallBold, header = true)
        var totalPieces = java.math.BigDecimal.ZERO
        for (line in lines) {
            totalPieces = totalPieces.add(Dec.orZero(line.qty))
            tableRow(
                line.nameAr,
                Dec.fmt(line.qty, 2, 0),
                Dec.money(line.unitPrice),
                Dec.money(line.lineTotal),
                bodyPaint,
            )
        }
        ops += Op.Section(
            doc.layout(
                "عددُ الأصناف: ${lines.size}   ·   إجمالي الكميّات: ${Dec.fmt(totalPieces.toPlainString(), 2, 0)}",
                smallPaint,
                doc.innerWidth,
                right,
            ),
            topGap = 4,
        )
        ops += Op.Dash
    }

    // ٤) ملخّصُ المبالغ والضريبة
    val effectiveSubtotal = receipt.subtotal?.takeIf { it.isNotBlank() } ?: subtotal.toPlainString()
    kv("المجموعُ الخاضع للضريبة", Dec.money(effectiveSubtotal) + " ر.س")
    receipt.taxTotal?.let { kv("ضريبةُ القيمة المضافة (15%)", Dec.money(it) + " ر.س") }
    receipt.total?.let { kv("الإجماليُّ شامل الضريبة", Dec.money(it) + " ر.س", bold = true, boxed = true) }
    receipt.paidTotal?.let { kv("المبلغُ المقبوض", Dec.money(it) + " ر.س") }
    receipt.change?.takeIf { it.isNotBlank() && Dec.isPositive(it) }?.let {
        kv("المتبقّي للعميل", Dec.money(it) + " ر.س", bold = true)
    }
    receipt.paymentStatus?.let { kv("حالةُ السداد", com.erpcloud.bakery.ui.screens.Labels.docStatus(it).first) }
    ops += Op.DoubleRule

    // ٥) رمزُ QR الزكاة المؤطّر
    if (!qrPayload.isNullOrBlank()) {
        val qrSize = (doc.innerWidth * 0.44f).toInt().coerceIn(148, 320)
        runCatching { ZatcaQr.bitmap(qrPayload, qrSize) }.getOrNull()?.let { square ->
            ops += Op.Qr(square)
            ops += Op.Section(
                doc.layout("فاتورة إلكترونيّة متوافقة مع متطلّبات ZATCA", smallBold, doc.innerWidth, center),
            )
        }
    }

    ops += Op.Section(
        doc.layout("شكرًا لتعاملكم معنا — نتمنّى لكم يومًا سعيدًا", boldPaint, doc.innerWidth, center),
        topGap = 6,
    )
    return doc.render(ops)
}

/** طريقةُ الدفع كما أعادها الخادم (cash/card/bank/credit/split). */
private fun Labels_receipt(receipt: com.erpcloud.bakery.data.api.PosCheckoutReceiptDto): String = when (receipt.method) {
    "cash" -> "نقدي"
    "card" -> "شبكة"
    "bank" -> "تحويل بنكي"
    "credit" -> "آجل"
    "split" -> "متعدّد"
    else -> receipt.method ?: "—"
}

/**
 * فاتورةُ البيع الرسميّة — من `GET /van-sales/documents/{id}/print-view`:
 * نسختان في صورةٍ واحدة (العميلُ ثمّ المندوبُ بخانةِ توقيعه)، بترويسةِ المنشأة
 * وضريبتها، وسطورِ الأصناف أعمدةً (الصنف/الكميّة/السعر/الإجمالي)، والإجمالياتُ
 * في إطار — كما تُطبعُ من نافذة الويب نفسها.
 */
fun saleInvoice(view: PrintViewDto, widthPx: Int = 576): Bitmap {
    val doc = DocCanvas(widthPx)
    val titlePaint = doc.paint(doc.titleSize, bold = true)
    val bodyPaint = doc.paint(doc.bodySize)
    val boldPaint = doc.paint(doc.bodySize, bold = true)
    val smallPaint = doc.paint(doc.smallSize, color = Color.DKGRAY)
    val center = Layout.Alignment.ALIGN_CENTER

    val ops = mutableListOf<Op>()

    fun kv(label: String, value: String, bold: Boolean = false, boxed: Boolean = false) {
        ops += Op.Kv(KvRow(label, value, bold, boxed))
    }

    fun columns(cells: List<Pair<Float, String>>, paint: TextPaint, header: Boolean = false) {
        ops += Op.Columns(
            cells.map { (weight, text) ->
                Op.Cell(weight, doc.layout(text, paint, (doc.innerWidth * weight).toInt().coerceAtLeast(1)))
            },
            header,
        )
    }

    val copies = view.copies.ifEmpty { listOf(view.toDefaultCopy()) }
    copies.forEachIndexed { index, copy ->
        if (index > 0) {
            ops += Op.Section(doc.layout(" ", smallPaint, doc.innerWidth, center), topGap = 18)
            ops += Op.Dash
        }

        // ------------------------------------------------ ترويسة المنشأة
        ops += Op.Section(doc.layout(view.companyName.ifBlank { "مؤسسة" }, titlePaint, doc.innerWidth, center))
        if (view.companyTaxNo.isNotBlank()) {
            ops += Op.Section(doc.layout("الرقمُ الضريبيّ: ${view.companyTaxNo}", smallPaint, doc.innerWidth, center))
        }
        if (view.companyPhones.isNotEmpty()) {
            ops += Op.Section(doc.layout(view.companyPhones.joinToString(" · "), smallPaint, doc.innerWidth, center))
        }
        ops += Op.Section(doc.layout(copy.copyLabel.ifBlank { "نسخة" }, boldPaint, doc.innerWidth, center))
        ops += Op.Dash

        // ------------------------------------------------ بيانات المستند
        kv("رقمُ المستند", copy.documentNumber.ifBlank { view.documentNumber })
        view.invoiceNumber?.let { kv("رقمُ الفاتورة", it) }
        kv("التاريخ", view.saleDate.ifBlank { "—" })
        if (view.customerName.isNotBlank()) kv("العميل", view.customerName)
        if (view.customerTaxNo.isNotBlank()) kv("الرقمُ الضريبيّ للعميل", view.customerTaxNo)
        if (view.salesmanName.isNotBlank()) kv("المندوب", view.salesmanName)
        kv("طريقةُ الدفع", paymentMethodAr(view.paymentMethod))
        kv("نوعُ المستند", if (view.isZatca) "فاتورة ضريبيّة (فاتورة)" else "تسليم داخليّ")
        ops += Op.Dash

        // ------------------------------------------------ سطور الأصناف
        columns(
            listOf(
                0.42f to "الصنف",
                0.14f to "الكميّة",
                0.18f to "السعر",
                0.26f to "الإجماليّ",
            ),
            smallPaint, header = true,
        )
        for (line in view.lines) {
            val label = when (line.kind) {
                "bonus" -> "${line.itemName} (مجاني)"
                "return" -> "${line.itemName} (مرتجع)"
                else -> line.itemName
            }
            columns(
                listOf(
                    0.42f to label,
                    0.14f to Dec.kg(line.quantity),
                    0.18f to Dec.money(line.unitPrice),
                    0.26f to Dec.money(line.lineTotal),
                ),
                bodyPaint,
            )
        }
        ops += Op.Dash

        // ------------------------------------------------ الإجماليات
        kv("المجموعُ قبل الضريبة", Dec.money(view.subtotal) + " ر.س")
        if (Dec.isPositive(view.discountTotal)) kv("الخصم", "−" + Dec.money(view.discountTotal) + " ر.س")
        kv("ضريبةُ القيمة المضافة", Dec.money(view.vatTotal) + " ر.س")
        kv("الإجماليُّ المستحقّ", Dec.money(copy.grandTotal.ifBlank { view.grandTotal }) + " ر.س", bold = true, boxed = true)
        kv("المدفوع", Dec.money(copy.paidAmount.ifBlank { view.paidAmount }) + " ر.س")
        val outstanding = Dec.parse(copy.grandTotal.ifBlank { view.grandTotal })
            ?.subtract(Dec.orZero(copy.paidAmount.ifBlank { view.paidAmount }))
        if (outstanding != null && outstanding.signum() > 0) {
            kv("المتبقّي", Dec.money(outstanding.toPlainString()) + " ر.س", bold = true)
        }
        if (view.notes.isNotBlank()) kv("ملاحظات", view.notes)

        val qrPayload = view.qrPayload.takeIf { it.isNotBlank() } ?: run {
            if (view.isZatca && view.companyName.isNotBlank() && view.companyTaxNo.isNotBlank()) {
                val stamp = ZatcaQr.normalizeTimestamp(view.printedAt.ifBlank { view.saleDate })
                if (stamp.isNotBlank()) {
                    ZatcaQr.phase1Payload(
                        sellerName = view.companyName,
                        vatNo = view.companyTaxNo,
                        timestampIso = stamp,
                        grandTotal = Dec.orZero(copy.grandTotal.ifBlank { view.grandTotal })
                            .setScale(2, java.math.RoundingMode.HALF_UP).toPlainString(),
                        vatTotal = Dec.orZero(copy.vatTotal.ifBlank { view.vatTotal })
                            .setScale(2, java.math.RoundingMode.HALF_UP).toPlainString(),
                    )
                } else null
            } else null
        }
        if (!qrPayload.isNullOrBlank()) {
            val qrSize = (doc.innerWidth * 0.40f).toInt().coerceIn(136, 300)
            runCatching { ZatcaQr.bitmap(qrPayload, qrSize) }.getOrNull()?.let { square ->
                ops += Op.Qr(square)
                ops += Op.Section(
                    doc.layout("امسحْ للتحقّق — فاتورة إلكترونيّة (ZATCA)", smallPaint, doc.innerWidth, center),
                )
            }
        }

        if (copy.requiresCustomerSignature) {
            val labels = copy.signatureBlock
            ops += Op.Signatures(
                height = 56,
                boxes = listOf(
                    doc.layout(labels?.customerSignatureLabel ?: "توقيعُ العميل", smallPaint, doc.innerWidth / 2, center),
                    doc.layout(labels?.repSignatureLabel ?: "توقيعُ المندوب", smallPaint, doc.innerWidth / 2, center),
                ),
                boxWidth = doc.innerWidth / 2,
            )
        }
        ops += Op.Section(
            doc.layout(
                "طُبعت ${view.printedAt.ifBlank { "—" }} — هذه الوثيقة صادرة من نظام إدارة المخابز",
                smallPaint, doc.innerWidth, center,
            ),
            topGap = 6,
        )
    }
    return doc.render(ops)
}

/** نسخةٌ افتراضيّةٌ إن لم يرسل الخادمُ تفاصيلَ النسخ (توافقٌ مع الاستجابات القديمة). */
private fun PrintViewDto.toDefaultCopy(): com.erpcloud.bakery.data.api.PrintCopyDto =
    com.erpcloud.bakery.data.api.PrintCopyDto(
        copyIndex = 1,
        kind = "customer",
        copyLabel = "نسخةُ العميل",
        documentNumber = documentNumber,
        grandTotal = grandTotal,
        vatTotal = vatTotal,
        paidAmount = paidAmount,
    )

/** طريقةُ الدفع بالعربيّة — كما في فاتورة الويب. */
private fun paymentMethodAr(method: String): String = when (method) {
    "cash" -> "نقديّ"
    "card" -> "شبكة"
    "bank" -> "تحويل بنكيّ"
    "credit" -> "آجل"
    else -> method.ifBlank { "—" }
}

/**
 * مستندُ **تقرير** — تقريرُ النظام كاملًا صورةً تُطبعُ أو تُشارَك PDF:
 * الترويسةُ (العنوانُ والمجموعةُ ووقتُ التوليد وعددُ الصفوف)، رأسُ الأعمدة،
 * ثمّ الصفوفُ (بحدٍّ أقصى لكلِّ صفحةِ صورةٍ طويلةٍ كي لا تنفجرَ الذاكرة)،
 * والإجماليّاتُ في الذيل. عرضٌ أوسعُ من الفواتير (٩٠٠) لأنّ التقاريرَ عريضة.
 *
 * الطباعةُ عبر نظامِ أندرويد تفتحُ نافذةً فيها «حفظُ PDF»، والمشاركةُ ترسلُ
 * الصورةَ لتطبيقاتٍ تحوِّلها PDF — فذلك هو «تصديرُ PDF» بلا مكتباتٍ خارجيّة.
 */
fun reportDocument(report: ReportResultDto, widthPx: Int = 900): Bitmap {
    val doc = DocCanvas(widthPx)
    val titlePaint = doc.paint(doc.titleSize, bold = true)
    val smallPaint = doc.paint(doc.smallSize)
    val smallBold = doc.paint(doc.smallSize, bold = true)
    val ops = mutableListOf<Op>()

    ops += Op.Section(doc.layout(report.titleAr, titlePaint, doc.innerWidth))
    ops += Op.Kv(KvRow("المجموعة", Labels_reportGroup(report.group)))
    report.generatedAt?.let { ops += Op.Kv(KvRow("وقتُ التوليد", it.take(19).replace('T', ' '))) }
    ops += Op.Kv(KvRow("عددُ الصفوف", report.rowCount.toString()))
    ops += Op.Dash

    val visible = report.columns.filter { !it.hidden }
    if (visible.isEmpty() || report.rows.isEmpty()) {
        ops += Op.Kv(KvRow("النتيجة", "لا صفوفَ في النتيجة.", boxed = true))
    } else {
        val colWeight = 1f / visible.size.toFloat()
        val colWidthPx = ((doc.innerWidth * colWeight).toInt() - 4).coerceAtLeast(24)
        // رأسُ الأعمدة — من اليمين بترتيبِ الخادم
        ops += Op.Columns(
            visible.map { column ->
                Op.Cell(colWeight, doc.layout(column.labelAr, smallBold, colWidthPx))
            },
            header = true,
        )
        ops += Op.Dash
        val maxRows = 80
        report.rows.take(maxRows).forEach { row ->
            ops += Op.Columns(
                visible.map { column ->
                    val raw = row[column.key] ?: row[column.key.replaceFirstChar { it.uppercase() }] ?: ""
                    val text = when (column.type) {
                        "money" -> com.erpcloud.bakery.util.Dec.money(raw)
                        "qty" -> com.erpcloud.bakery.util.Dec.kg(raw)
                        "percent" -> com.erpcloud.bakery.util.Dec.fmt(raw, 2, 0) + "%"
                        "int" -> com.erpcloud.bakery.util.Dec.intText(raw)
                        else -> raw
                    }
                    Op.Cell(colWeight, doc.layout(text, smallPaint, colWidthPx))
                },
            )
        }
        if (report.rows.size > maxRows) {
            ops += Op.Kv(KvRow("تنبيه", "عُرضت أول $maxRows صفًّا من ${report.rows.size} — صدِّر التقريرَ الكاملَ من نطاقٍ أضيق.", boxed = true))
        }
    }

    val totals = report.totals.filterValues { it.isNotBlank() }
    val grand = report.grandTotal
    if (totals.isNotEmpty() || grand.isNotEmpty()) {
        ops += Op.Dash
        totals.forEach { (key, value) ->
            val col = report.columns.firstOrNull { it.key == key }
            val labelAr = col?.labelAr ?: key
            val formatted = when (col?.type) {
                "int" -> com.erpcloud.bakery.util.Dec.intText(value)
                "qty" -> com.erpcloud.bakery.util.Dec.kg(value)
                else -> com.erpcloud.bakery.util.Dec.money(value)
            }
            ops += Op.Kv(KvRow(labelAr, formatted, bold = true))
        }
        grand.forEach { card -> ops += Op.Kv(KvRow(card.labelAr, com.erpcloud.bakery.util.Dec.money(card.amount), bold = true, boxed = true)) }
    }

    return doc.render(ops)
}

/** مجموعةُ التقرير بالعربيّة — نفسَ خرائط Labels دون تكرار السجلّ كاملًا. */
private fun Labels_reportGroup(group: String): String = when (group) {
    "sales" -> "المبيعات"
    "purchases" -> "المشتريات"
    "inventory" -> "المخزون"
    "treasury" -> "الخزينة"
    "hrm" -> "الموارد البشريّة"
    "accounting" -> "المحاسبة"
    "van_sales" -> "التوزيع والمندوبين"
    "parties" -> "الأطراف"
    else -> group
}
