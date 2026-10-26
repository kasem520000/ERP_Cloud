package com.erpcloud.bakery.printing

import android.app.Activity
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
object PrintKit {

    /**
     * طباعةٌ عبر خدمة الطباعة في أندرويد — تعرض الخيارات بما فيها «حفظ كـ PDF».
     *
     * `PrintHelper` يرفض أيّ سياقٍ ليس نشاطًا ("Can print only from an activity")،
     * ومرتّبو الطباعةِ يستدعونها بسياقِ التطبيقِ من `vm.androidContext()`؛ فالسياقُ
     * يُفكُّ إلى النشاطِ الحيّ المسجَّل في [ActivityRef] (سجّله `MainActivity.onCreate`).
     * الطباعةُ عبر النظامِ إذن تعملُ من أيّ مسارٍ دون تعديلِ كلّ شاشة.
     */
    fun printViaSystem(context: Context, bitmap: Bitmap, jobName: String) {
        val activity = context as? Activity
            ?: ActivityRef.get()
            ?: throw IllegalStateException(
                "لا تتوفر نافذةُ طباعةٍ الآن — أعد المحاولة من داخل الشاشة.",
            )
        val helper = PrintHelper(activity)
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
