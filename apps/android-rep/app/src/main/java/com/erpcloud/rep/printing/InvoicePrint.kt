package com.erpcloud.rep.printing

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import androidx.core.content.FileProvider
import androidx.print.PrintHelper
import java.io.File

/**
 * طباعةُ الفاتورة عبر نظام أندرويد (أيّ طابعةٍ مثبَّتة أو «حفظ PDF») ومشاركتها
 * كصورةٍ عبر تطبيقات الجهاز.
 */
object InvoicePrint {

    /** طباعةٌ عبر خدمة الطباعة في أندرويد — تعرض الخيارات بما فيها «حفظ كـ PDF». */
    fun printViaSystem(context: Context, bitmap: Bitmap, jobName: String) {
        val helper = PrintHelper(context)
        helper.scaleMode = PrintHelper.SCALE_MODE_FIT
        helper.printBitmap(jobName, bitmap)
    }

    /** مشاركةُ الفاتورة كصورةٍ PNG عبر أيّ تطبيقٍ (واتساب، بريد…). */
    fun shareImage(context: Context, bitmap: Bitmap, fileName: String): Boolean {
        return try {
            val dir = File(context.cacheDir, "share").apply { mkdirs() }
            val file = File(dir, fileName)
            file.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            val uri = FileProvider.getUriForFile(context, "${context.packageName}.fileprovider", file)
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "image/png"
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(
                Intent.createChooser(intent, "مشاركة الفاتورة").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            )
            true
        } catch (_: Exception) {
            false
        }
    }
}
