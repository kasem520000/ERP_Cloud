package com.erpcloud.rep.printing

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.text.Layout
import android.text.StaticLayout
import android.text.TextPaint
import com.erpcloud.rep.data.api.PrintViewDto
import com.erpcloud.rep.util.Dec
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter

/**
 * توليدُ صورةِ الفاتورة من `print-view` — الرسمُ بـ Canvas وStaticLayout (تشكيلٌ
 * عربيٌّ سليمٌ ودعمُ ثنائيّة الاتجاه)، ورمزُ QR يُبنى من `qrPayload` كما يرسله الخادم
 * (لا يُخترع في التطبيق).
 *
 * العرضُ مُعاملٌ: ٥٧٦ نقطةً لطابعة ٨٠ملم و٣٨٤ لـ٥٨ملم، وعَرضٌ أعلى للطباعة عبر
 * نظام أندرويد أو مشاركة الصورة.
 */
object InvoiceBitmap {

    fun render(view: PrintViewDto, widthPx: Int, copyKind: String? = null): Bitmap {
        val width = widthPx.coerceAtLeast(200)
        val pad = width / 24
        val bodySize = (width / 26f).coerceIn(9f, 42f)
        val titleSize = bodySize * 1.55f
        val smallSize = bodySize * 0.85f

        fun paint(size: Float, bold: Boolean = false, color: Int = Color.BLACK) = TextPaint().apply {
            isAntiAlias = true
            textSize = size
            this.color = color
            isFakeBoldText = bold
        }

        fun layout(text: String, tp: TextPaint, width: Int, align: Layout.Alignment = Layout.Alignment.ALIGN_CENTER): StaticLayout =
            StaticLayout.Builder.obtain(text, 0, text.length, tp, width.coerceAtLeast(1))
                .setAlignment(align)
                .setLineSpacing(0f, 1.15f)
                .build()

        val innerWidth = width - pad * 2

        // ---------------- بناءُ المقاطع ثم قياسُ الارتفاع الكلّيّ ----------------
        data class Section(val block: StaticLayout, val topGap: Int, val bottomGap: Int)

        val sections = mutableListOf<Section>()
        var height = pad

        fun add(block: StaticLayout, topGap: Int = 0, bottomGap: Int = 0) {
            sections += Section(block, topGap, bottomGap)
            height += topGap + block.height + bottomGap
        }

        val titlePaint = paint(titleSize, bold = true)
        val bodyPaint = paint(bodySize)
        val boldPaint = paint(bodySize, bold = true)
        val smallPaint = paint(smallSize, color = Color.DKGRAY)
        val center = Layout.Alignment.ALIGN_CENTER
        val right = Layout.Alignment.ALIGN_NORMAL // مع RTL يبدأ من اليمين

        val copy = view.copies.firstOrNull { copyKind == null || it.kind == copyKind } ?: view.copies.firstOrNull()

        // الترويسة
        add(layout(view.companyName.ifBlank { "—" }, titlePaint, innerWidth, center))
        if (view.companyTaxNo.isNotBlank()) {
            add(layout("الرقمُ الضريبيّ: ${view.companyTaxNo}", smallPaint, innerWidth, center), bottomGap = pad / 2)
        }
        val contact = listOf(
            view.companyPhones.joinToString(" · ").takeIf { it.isNotBlank() },
            view.companyEmail.takeIf { it.isNotBlank() },
        ).filterNotNull().joinToString(" · ")
        if (contact.isNotBlank()) add(layout(contact, smallPaint, innerWidth, center), bottomGap = pad)

        // العنوان
        val docTitle = when {
            view.isZatca -> "فاتورة ضريبية"
            view.invoiceMode == "internal_delivery" -> "مستند تسليم داخلي"
            else -> "مستند بيع"
        }
        add(layout(docTitle, titlePaint, innerWidth, center))
        add(
            layout(
                "رقمُ المستند: ${view.documentNumber}" +
                    (view.invoiceNumber?.takeIf { it.isNotBlank() }?.let { " · رقمُ الفاتورة: $it" } ?: ""),
                bodyPaint, innerWidth, center,
            ),
            bottomGap = pad,
        )

        // بياناتٌ
        fun metaLine(label: String, value: String): String = "$label: $value"
        val meta = buildList {
            add(metaLine("التاريخ", view.saleDate))
            add(metaLine("العميل", view.customerName.ifBlank { "عميل نقدي" }))
            if (view.customerTaxNo.isNotBlank()) add(metaLine("الرقمُ الضريبيّ للعميل", view.customerTaxNo))
            if (view.customerPhone.isNotBlank() || view.customerMobile.isNotBlank()) {
                add(metaLine("الهاتف", (view.customerMobile.ifBlank { view.customerPhone })))
            }
            add(metaLine("المندوب", view.salesmanName))
            if (view.vanWarehouseName.isNotBlank()) add(metaLine("السيارة", view.vanWarehouseName))
            if (view.loadOrderNumber.isNotBlank()) add(metaLine("أمرُ التحميل", view.loadOrderNumber))
            if (view.productionBatchNo.isNotBlank()) add(metaLine("دفعةُ الإنتاج", view.productionBatchNo))
            add(metaLine("طريقةُ الدفع", paymentAr(view.paymentMethod)))
        }
        for (lineText in meta) add(layout(lineText, bodyPaint, innerWidth, right))
        add(layout(" ", bodyPaint, innerWidth, right), bottomGap = 0, topGap = 0)

        // الأسطر
        for (line in view.lines) {
            val nameText = if (line.kind == "bonus") "${line.itemName} — كمية مجانية (بونص)" else line.itemName
            add(layout(nameText, boldPaint, innerWidth, right), topGap = pad / 2)
            val details = buildList {
                add("الكميّة: ${Dec.fmt(line.quantity, 3)}")
                if (line.kind != "bonus") add("سعرُ الوحدة: ${Dec.money(line.unitPrice)}")
                if (line.reason != null && line.reason.isNotBlank()) add("السبب: ${line.reason}")
                if (line.kind != "bonus") add("الإجمالي: ${Dec.money(line.lineTotal)}")
            }
            add(layout(details.joinToString("  ·  "), smallPaint, innerWidth, right), bottomGap = pad / 6)
        }
        add(layout(" ", bodyPaint, innerWidth, right), topGap = pad / 4)

        // المجموعات
        fun totalLine(label: String, value: String) = layout(
            "$label: ${Dec.money(value)}", boldPaint, innerWidth, right,
        )
        add(totalLine("المجموعُ قبل الضريبة", view.subtotal))
        if (view.discountTotal.isNotBlank() && Dec.parse(view.discountTotal)?.signum() != 0) {
            add(layout("الخصم: ${Dec.money(view.discountTotal)}", bodyPaint, innerWidth, right))
        }
        if (view.isZatca) {
            add(layout("ضريبةُ القيمة المضافة (${Dec.fmt(view.vatRate)}%): ${Dec.money(view.vatTotal)}", bodyPaint, innerWidth, right))
        }
        add(totalLine("الإجماليُّ المستحقّ", view.grandTotal))
        add(layout("المدفوع: ${Dec.money(view.paidAmount)} · المتبقّي: ${Dec.money(view.outstandingAmount)}", bodyPaint, innerWidth, right))
        if (Dec.parse(view.bonusQtyTotal)?.signum() > 0) {
            add(layout("إجماليُّ البونص: ${Dec.fmt(view.bonusQtyTotal, 3)} كجم", bodyPaint, innerWidth, right))
        }

        // رمزُ QR — من الخادم كما هو
        var qr: Bitmap? = null
        if (view.isZatca && view.qrPayload.isNotBlank()) {
            qr = qrBitmap(view.qrPayload, (innerWidth * 0.62f).toInt().coerceAtLeast(80))
            height += qr.height + pad
        }

        // الملاحظاتُ والتذييل
        if (view.notes.isNotBlank()) {
            add(layout("ملاحظات: ${view.notes}", smallPaint, innerWidth, right), topGap = pad / 2)
        }
        add(layout("حُرِّرت في: ${view.printedAt}", smallPaint, innerWidth, center), topGap = pad)
        copy?.let { add(layout(it.copyLabel, smallPaint, innerWidth, center), topGap = pad / 3) }

        // خانةُ التوقيع لنسخة المندوب
        var signatureHeight = 0
        if (copy?.requiresCustomerSignature == true) {
            signatureHeight = (width * 0.16f).toInt()
            height += signatureHeight + pad
        }

        height += pad

        // ---------------- الرسمُ ----------------
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
        val canvas = Canvas(bitmap)
        canvas.drawColor(Color.WHITE)

        var y = pad
        val dividerPaint = Paint().apply { color = Color.DKGRAY; strokeWidth = 2f }
        for ((index, section) in sections.withIndex()) {
            y += section.topGap
            canvas.withTranslation(y) { section.block.draw(this) }
            y += section.block.height + section.bottomGap
            // فواصلُ عند الترويسة والأسطر
            if (index == 0 || index == 4) {
                canvas.drawLine(
                    pad.toFloat(), (y + 2).toFloat(), (width - pad).toFloat(), (y + 2).toFloat(), dividerPaint,
                )
                y += 6
            }
        }

        qr?.let {
            canvas.drawBitmap(it, (width - it.width) / 2f, y.toFloat(), null)
            y += it.height + pad
        }

        if (signatureHeight > 0) {
            val boxPaint = Paint().apply {
                style = Paint.Style.STROKE; color = Color.DKGRAY; strokeWidth = 2f
            }
            val labelPaint = paint(smallSize)
            val boxWidth = (innerWidth - pad) / 2
            val top = y + pad / 2
            // عمودان: توقيعُ العميل (يمين) وتوقيعُ المندوب (يسار) — التطبيقُ RTL
            canvas.drawRect(
                (width - pad - boxWidth).toFloat(), top.toFloat(),
                (width - pad).toFloat(), (top + signatureHeight).toFloat(), boxPaint,
            )
            canvas.drawRect(
                pad.toFloat(), top.toFloat(),
                (pad + boxWidth).toFloat(), (top + signatureHeight).toFloat(), boxPaint,
            )
            val customerLabel = copy?.signatureBlock?.customerSignatureLabel ?: "توقيع العميل / المستلم"
            val repLabel = copy?.signatureBlock?.repSignatureLabel ?: "توقيع المندوب"
            val c1 = layout(customerLabel, labelPaint, boxWidth, center)
            val c2 = layout(repLabel, labelPaint, boxWidth, center)
            canvas.save()
            canvas.translate((width - pad - boxWidth).toFloat(), (top + signatureHeight + 4).toFloat())
            c1.draw(canvas)
            canvas.restore()
            canvas.save()
            canvas.translate(pad.toFloat(), (top + signatureHeight + 4).toFloat())
            c2.draw(canvas)
            canvas.restore()
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
