package com.erpcloud.bakery.util

import java.math.BigDecimal
import java.math.BigInteger
import java.math.RoundingMode

/**
 * كل أرقام الخادم نصوص (numeric من PostgreSQL) — هذه الأداةُ تتعامل معها بدقةٍ عشرية
 * بلا تحويلٍ إلى double، وتطابقُ حسابات `@erp/contracts` (`invoice-math.ts`) بالهللة.
 */
object Dec {

    /** تطبيعُ الأرقام العربيّة/الفارسيّة وفواصلها إلى ASCII قياسيّ يقبله الخادم وBigDecimal. */
    fun normalizeDigits(raw: String): String {
        if (raw.isEmpty()) return ""
        val sb = StringBuilder(raw.length)
        for (ch in raw) {
            when (ch) {
                in '٠'..'٩' -> sb.append(('0'.code + (ch.code - '٠'.code)).toChar())
                in '۰'..'۹' -> sb.append(('0'.code + (ch.code - '۰'.code)).toChar())
                '٫' -> sb.append('.')
                '٬', ' ' , '\u00A0', '\u202F' -> { /* تجاهل فواصل الآلاف والمسافات */ }
                '−', '–' -> sb.append('-')
                else -> sb.append(ch)
            }
        }
        val cleaned = sb.toString()
        // إذا وُجدت نقطةٌ وفاصلةٌ معًا فالفاصلةُ فاصلةُ آلاف ("1,250.50")، وإلّا إن تكرّرت الفاصلةُ فهي آلاف، وإلّا فعشريّة ("12,5").
        return when {
            cleaned.contains('.') && cleaned.contains(',') -> cleaned.replace(",", "")
            cleaned.count { it == ',' } > 1 -> cleaned.replace(",", "")
            cleaned.contains(',') -> cleaned.replace(',', '.')
            else -> cleaned
        }
    }

    /** تحليلُ نصٍّ إلى BigDecimal — null إن كان فارغًا أو غير رقمي. */
    fun parse(value: String?): BigDecimal? {
        val text = normalizeDigits(value?.trim().orEmpty())
        if (text.isEmpty() || text == "-" || text == "." || text == "-.") return null
        return try {
            BigDecimal(text)
        } catch (_: NumberFormatException) {
            null
        }
    }

    fun orZero(value: String?): BigDecimal = parse(value) ?: BigDecimal.ZERO

    fun isPositive(value: String?): Boolean {
        val parsed = parse(value) ?: return false
        return parsed.signum() > 0
    }

    fun isNonNegative(value: String?): Boolean {
        val parsed = parse(value) ?: return false
        return parsed.signum() >= 0
    }

    /** هل النصُّ رقمٌ عشريٌّ صالحٌ للإدخال (يقبلُ الأرقام العربيّة واللاتينيّة ونقطةً واحدة)؟ */
    fun isValidInput(value: String): Boolean {
        if (value.isEmpty()) return true
        val normalized = normalizeDigits(value)
        return normalized.matches(Regex("^-?\\d*(\\.\\d*)?$"))
    }

    /** تنسيقُ قيمةٍ للعرض: قصّ الأصفار الزائدة مع حدٍّ أعلى للخانات. */
    fun fmt(value: String?, maxScale: Int = 2, minScale: Int = 0): String {
        val parsed = parse(value) ?: return value ?: ""
        val scaled = parsed.setScale(maxScale, RoundingMode.HALF_UP)
            .stripTrailingZeros()
        val final = if (scaled.scale() < minScale) scaled.setScale(minScale) else scaled
        return final.toPlainString()
    }

    /** المال: خانتان دائمًا. */
    fun money(value: String?): String = parse(value)
        ?.setScale(2, RoundingMode.HALF_UP)?.toPlainString() ?: (value ?: "")

    /** الكيلوغرام والكمّيات: حتّى ٣ خاناتٍ للعرض بلا أصفارٍ زائدة. */
    fun kg(value: String?): String = parse(value)
        ?.setScale(3, RoundingMode.HALF_UP)?.stripTrailingZeros()?.toPlainString() ?: (value ?: "")

    /** الأعدادُ الصحيحة في التقارير (عددُ الفواتير/العملاء): بلا كسورٍ زائفة. */
    fun intText(value: String?): String = parse(value)
        ?.setScale(0, RoundingMode.HALF_UP)?.toPlainString() ?: (value ?: "")

    /** إعدادُ النصّ للإرسال: أرقام ASCII نظيفةٌ تقبلها مخطّطات Zod على الخادم. */
    fun wire(value: String?): String = normalizeDigits(value?.trim().orEmpty())

    // --------------------------------------------------------- حسابُ الفواتير المطابق لـ @erp/contracts

    data class InvoiceLinePreviewInput(
        val quantity: String,
        val unitPrice: String,
        val discountRate: String = "0",
        val discountAmount: String = "0",
        val taxRate: String = "0",
    )

    data class InvoiceLinePreviewTotal(
        val gross: BigDecimal,
        val discount: BigDecimal,
        val net: BigDecimal,
        val tax: BigDecimal,
        val total: BigDecimal,
    )

    data class InvoicePreviewTotals(
        val lines: List<InvoiceLinePreviewTotal>,
        val subtotal: BigDecimal,
        val discount: BigDecimal,
        val tax: BigDecimal,
        val total: BigDecimal,
    )

    private val TEN_4: BigInteger = BigInteger.valueOf(10_000L)
    private val HUNDRED_UNIT: BigInteger = BigInteger.valueOf(100L) * TEN_4

    private fun parseScaled4(raw: String?): BigInteger {
        val bd = parse(raw) ?: return BigInteger.ZERO
        return bd.setScale(4, RoundingMode.HALF_UP).movePointRight(4).toBigInteger()
    }

    private fun divRound(numerator: BigInteger, denominator: BigInteger): BigInteger {
        if (denominator == BigInteger.ZERO) return BigInteger.ZERO
        val sameSign = (numerator.signum() >= 0) == (denominator.signum() >= 0)
        val n = numerator.abs()
        val d = denominator.abs()
        val half = d.shiftRight(1)
        val q = n.add(half).divide(d)
        return if (sameSign) q else q.negate()
    }

    /** ACC-108: تقريب HALF_UP من مقياس ٤ خانات إلى مقياس العملة (خانتان = هللة). */
    private fun roundScaled4To2(value: BigInteger): BigInteger {
        val unit = BigInteger.valueOf(100L)
        val qr = value.divideAndRemainder(unit)
        val q = qr[0]
        val r = qr[1]
        val half = BigInteger.valueOf(50L)
        return when {
            r >= half -> q.add(BigInteger.ONE).multiply(unit)
            r <= half.negate() -> q.subtract(BigInteger.ONE).multiply(unit)
            else -> q.multiply(unit)
        }
    }

    private fun scaled4ToBd(value: BigInteger): BigDecimal =
        BigDecimal(value, 4).setScale(2, RoundingMode.HALF_UP)

    /**
     * يحاكي `calculateInvoiceTotals` في `packages/contracts/src/invoice-math.ts` حرفيًّا:
     * توزيعُ خصم الرأس نسبيًّا على إجمالي السطور، واستخراجُ الضريبة من السعر الشامل
     * (`vatBase * rate / (100 + rate)`) أو إضافتُها للسعر غير الشامل، والتقريبُ إلى خانتين لكلّ سطر.
     */
    fun previewInvoiceTotals(
        lines: List<InvoiceLinePreviewInput>,
        priceIncludesVat: Boolean,
        invoiceDiscount: String = "0",
    ): InvoicePreviewTotals {
        if (lines.isEmpty()) {
            val z = BigDecimal.ZERO.setScale(2)
            return InvoicePreviewTotals(emptyList(), z, z, z, z)
        }
        data class Prepared(val gross: BigInteger, val discount: BigInteger, val net: BigInteger, val taxRate: BigInteger)
        val prepared = lines.map { line ->
            val qty = parseScaled4(line.quantity)
            val price = parseScaled4(line.unitPrice)
            val gross = divRound(qty.multiply(price), TEN_4)
            val rate = parseScaled4(line.discountRate)
            val rateDisc = divRound(gross.multiply(rate), HUNDRED_UNIT)
            val disc = rateDisc.add(parseScaled4(line.discountAmount))
            val net = gross.subtract(disc)
            val taxRate = parseScaled4(line.taxRate)
            Prepared(gross, disc, net, taxRate)
        }

        val headerDiscount = parseScaled4(invoiceDiscount)
        val shares = Array(prepared.size) { BigInteger.ZERO }
        if (headerDiscount != BigInteger.ZERO) {
            val totalGross = prepared.fold(BigInteger.ZERO) { acc, l ->
                acc.add(if (l.gross > BigInteger.ZERO) l.gross else BigInteger.ZERO)
            }
            if (totalGross > BigInteger.ZERO) {
                for (i in prepared.indices) {
                    val base = if (prepared[i].gross > BigInteger.ZERO) prepared[i].gross else BigInteger.ZERO
                    shares[i] = divRound(headerDiscount.multiply(base), totalGross)
                }
                val distributed = shares.fold(BigInteger.ZERO, BigInteger::add)
                val remainder = headerDiscount.subtract(distributed)
                if (remainder != BigInteger.ZERO) {
                    var target = 0
                    for (i in 1 until prepared.size) {
                        if (prepared[i].gross > prepared[target].gross) target = i
                    }
                    shares[target] = shares[target].add(remainder)
                }
            }
        }

        val computedLines = prepared.mapIndexed { idx, line ->
            val share = shares[idx]
            val base = roundScaled4To2(line.net.subtract(share))
            val tax = roundScaled4To2(
                if (priceIncludesVat) {
                    divRound(base.multiply(line.taxRate), HUNDRED_UNIT.add(line.taxRate))
                } else {
                    divRound(base.multiply(line.taxRate), HUNDRED_UNIT)
                }
            )
            val taxableNet = if (priceIncludesVat) base.subtract(tax) else base
            val total = if (priceIncludesVat) base else base.add(tax)
            InvoiceLinePreviewTotal(
                gross = scaled4ToBd(line.gross),
                discount = scaled4ToBd(line.discount),
                net = scaled4ToBd(taxableNet),
                tax = scaled4ToBd(tax),
                total = scaled4ToBd(total),
            )
        }

        val subtotal = computedLines.fold(BigDecimal.ZERO.setScale(2)) { acc, l -> acc.add(l.net) }
        val tax = computedLines.fold(BigDecimal.ZERO.setScale(2)) { acc, l -> acc.add(l.tax) }
        val distributed = shares.fold(BigInteger.ZERO, BigInteger::add)
        val unallocated = scaled4ToBd(roundScaled4To2(headerDiscount.subtract(distributed)))
        val total = subtotal.add(tax).subtract(unallocated)
        return InvoicePreviewTotals(
            lines = computedLines,
            subtotal = subtotal,
            discount = scaled4ToBd(roundScaled4To2(headerDiscount)),
            tax = tax,
            total = total,
        )
    }
}
