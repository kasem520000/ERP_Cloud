package com.erpcloud.bakery.printing

import android.graphics.Bitmap
import android.graphics.Color
import android.util.Base64
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.io.ByteArrayOutputStream

/**
 * 🧾 رمزُ الفاتورةِ الإلكترونيّة (فاتورة ضريبية مبسّطة — المرحلة الأولى).
 *
 * الحمولةُ Base64 لتسلسلِ TLV: بايتُ وسمٍ ثمّ بايتُ طولٍ ثمّ القيمةُ UTF-8.
 * الوسومُ الخمسةُ الأولى (البائع، الرقمُ الضريبيّ، الطابعُ الزمنيّ، الإجماليُّ
 * بضريبته، مبلغُ الضريبة) هي متطلبُّ المرحلةِ الأولى وتُبنى من بياناتِ الفاتورةِ
 * نفسِها — نفسُ ترميزِ وحدةِ الفوترةِ الإلكترونيّةِ عند الخادم (`einvoicing/zatca/qr.ts`)
 * ومثلُ `phaseOneQr` في قوالبِ الطباعةِ الرسميّة. الوسومُ ٦–٩ (البصمة والتوقيع)
 * مرحلةٌ ثانيةٌ لا تُنتحَل: إن أصدرها الخادمُ في `qrCode` تُستخدم كما هي.
 */
object ZatcaQr {

    /** بناءُ حمولةِ المرحلةِ الأولى — الأرقامُ بنصٍّ بخانتَي عشريّةٍ كما تطلبهُ الهيئة. */
    fun phase1Payload(
        sellerName: String,
        vatNo: String,
        timestampIso: String,
        grandTotal: String,
        vatTotal: String,
    ): String {
        val out = ByteArrayOutputStream()
        fun tlv(tag: Int, value: String) {
            val bytes = value.toByteArray(Charsets.UTF_8)
            val len = bytes.size.coerceAtMost(255)
            out.write(tag)
            out.write(len)
            out.write(bytes, 0, len)
        }
        tlv(1, sellerName.trim())
        tlv(2, vatNo.trim())
        tlv(3, timestampIso.trim())
        tlv(4, grandTotal.trim())
        tlv(5, vatTotal.trim())
        return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    }

    /**
     * تطبيعُ الطابعِ الزمنيّ كما يفعلُ الخادم: `2025-06-05T10:30:00.123Z`
     * تصبحُ `2025-06-05T10:30:00Z` — بأيّ صيغةِ ثوانٍَ دقيقة.
     */
    fun normalizeTimestamp(value: String): String =
        value.trim().replace(Regex("\\.\\d{1,9}(?=Z$|$)"), "")

    /**
     * رسمُ الحمولةِ مربّعَ QR أبيضَ الأسود — بحوافٍ بلا هامشٍ حتى يكبرَ المستطيل
     * داخلَ عرضِ الورقةِ الصغيرة.
     */
    fun bitmap(payload: String, sizePx: Int): Bitmap {
        val size = sizePx.coerceAtLeast(120)
        val matrix = QRCodeWriter().encode(
            payload,
            BarcodeFormat.QR_CODE,
            size,
            size,
            mapOf(EncodeHintType.MARGIN to 0),
        )
        val pixels = IntArray(size * size)
        for (y in 0 until size) {
            val offset = y * size
            for (x in 0 until size) {
                pixels[offset + x] = if (matrix.get(x, y)) Color.BLACK else Color.WHITE
            }
        }
        return Bitmap.createBitmap(pixels, size, size, Bitmap.Config.RGB_565)
    }
}
