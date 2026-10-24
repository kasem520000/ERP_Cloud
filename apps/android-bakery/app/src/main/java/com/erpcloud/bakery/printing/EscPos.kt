package com.erpcloud.bakery.printing

import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.Context
import android.graphics.Bitmap
import java.io.IOException
import java.util.UUID

/**
 * طباعةٌ حراريّةٌ عبر Bluetooth الكلاسيكيّ (SPP) وبروتوكول ESC/POS — **بلا مكتبات
 * خارجيّة**: تُحوَّل صورةُ الفاتورة (التي رُسم فيها العربيُّ سليمًا) إلى نقطاتٍ أحاديّة
 * اللون وتُرسل كصورةٍ نقطيّةٍ (`GS v 0`)، فتخرج العربيّةُ صحيحةً على أيّ طابعةٍ
 * تدعم ESC/POS ولو لم تكن تدعم العربيّة نصًّا.
 */
object EscPos {

    /** خدمةُ المنفذ التسلسليّ البلوتوثيّة (SPP) — المعيارُ في الطابعات الحراريّة. */
    private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    /** عرضُ ورق الطابعة بالنقطات: ٨٠ملم = ٥٧٦ و٥٨ملم = ٣٨٤. */
    const val WIDTH_80MM = 576
    const val WIDTH_58MM = 384

    class PrintException(messageAr: String) : Exception(messageAr)

    /** طابعاتٌ مقترنةٌ بهذا الجهاز (قائمةُ الأجهزة المرتبطة — لا اكتشافًا في النسخة الأولى). */
    fun bondedPrinters(context: Context): List<PrinterDevice> = try {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter
        if (adapter == null) emptyList()
        else adapter.bondedDevices.orEmpty().map { PrinterDevice(it.name ?: "جهاز بدون اسم", it.address) }
    } catch (_: SecurityException) {
        emptyList()
    }

    data class PrinterDevice(val name: String, val address: String)

    /**
     * طباعةُ صورةٍ على طابعةٍ حراريّة — يُستدعى من خيط IO.
     * الصورةُ تُقرَص إلى عرض الطابعة ثم تُحوَّل أحاديّةَ اللون بعتبةِ إضاءة.
     */
    fun printBitmap(context: Context, macAddress: String, widthDots: Int, bitmap: Bitmap) {
        val manager = context.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager
        val adapter = manager?.adapter
            ?: throw PrintException("لا يوجد بلوتوث في هذا الجهاز")
        if (!adapter.isEnabled) throw PrintException("البلوتوثُ مطفأ — شغّله وأعد المحاولة")

        val scaled = scaleToWidth(bitmap, widthDots)
        val bands = rasterBands(scaled, bandRows = 90)

        try {
            val device = adapter.getRemoteDevice(macAddress)
            val socket: BluetoothSocket = device.createRfcommSocketToServiceRecord(SPP_UUID)
            try {
                adapter.cancelDiscovery()
                socket.connect()
                val output = socket.getOutputStream()
                output.write(byteArrayOf(0x1B, 0x40)) // ESC @ — تهيئة
                for (band in bands) {
                    output.write(band)
                    output.flush()
                }
                output.write(byteArrayOf(0x1B, 0x64, 0x04)) // تغذية ٤ أسطر
                output.write(byteArrayOf(0x1D, 0x56, 0x00)) // قطع الورق
                output.flush()
            } finally {
                try {
                    socket.close()
                } catch (_: IOException) {
                    // الإغلاقُ أفضل جهدٍ.
                }
            }
        } catch (security: SecurityException) {
            throw PrintException("إذنُ البلوتوث غير ممنوح لهذا التطبيق")
        } catch (io: IOException) {
            throw PrintException("تعذّر الاتصال بالطابعة ($macAddress) — تأكّد أنها مُقرنةٌ ومشغّلةٌ وقريبة")
        }
    }

    /** قصُّ الصورة إلى العرض المطلوب مع الحفاظ على النسب. */
    private fun scaleToWidth(bitmap: Bitmap, widthDots: Int): Bitmap {
        if (bitmap.width == widthDots) return bitmap
        val height = (bitmap.height.toLong() * widthDots / bitmap.width).toInt().coerceAtLeast(1)
        return Bitmap.createScaledBitmap(bitmap, widthDots, height, true)
    }

    /**
     * تحويلُ الصورة إلى أوامر `GS v 0` على شرائطَ بارتفاعٍ محدودٍ كي لا يفيض
     * مخزنُ الطابعة المؤقّت. كلُّ بكسلٍ داكنٌ = نقطةٌ مطبوعة.
     */
    fun rasterBands(bitmap: Bitmap, bandRows: Int = 90): List<ByteArray> {
        val width = bitmap.width
        val height = bitmap.height
        val bytesPerRow = (width + 7) / 8
        val commands = mutableListOf<ByteArray>()

        var yStart = 0
        while (yStart < height) {
            val bandHeight = minOf(bandRows, height - yStart)
            val data = ByteArray(bytesPerRow * bandHeight)
            for (row in 0 until bandHeight) {
                for (x in 0 until width) {
                    if (isDark(bitmap.getPixel(x, yStart + row))) {
                        val byteIndex = row * bytesPerRow + x / 8
                        data[byteIndex] = (data[byteIndex].toInt() or (0x80 shr (x % 8))).toByte()
                    }
                }
            }
            val xL = bytesPerRow and 0xFF
            val xH = (bytesPerRow shr 8) and 0xFF
            val yL = bandHeight and 0xFF
            val yH = (bandHeight shr 8) and 0xFF
            val header = byteArrayOf(0x1D, 0x76, 0x30, 0x00, xL.toByte(), xH.toByte(), yL.toByte(), yH.toByte())
            commands += header + data
            yStart += bandHeight
        }
        return commands
    }

    private fun isDark(pixel: Int): Boolean {
        // getPixel تُرجع ARGB دائمًا — فُكَّ القنوات ثم حُسبت الإضاءة.
        val r = (pixel shr 16) and 0xFF
        val g = (pixel shr 8) and 0xFF
        val b = pixel and 0xFF
        val luminance = (r * 299 + g * 587 + b * 114) / 1000
        return luminance < 128 // دون منتصف الإضاءة ⇒ نقطةٌ مطبوعة
    }
}
