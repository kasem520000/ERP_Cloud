package com.erpcloud.rep.printing

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.graphics.Bitmap
import androidx.core.content.FileProvider
import androidx.print.PrintHelper
import java.io.File
import java.lang.ref.WeakReference

/**
 * طباعةُ الفاتورة عبر نظام أندرويد (أيّ طابعةٍ مثبَّتة أو «حفظ PDF») ومشاركتها
 * كصورةٍ عبر تطبيقات الجهاز.
 */
object InvoicePrint {

    @Volatile
    private var activityRef: WeakReference<Activity>? = null

    fun attachActivity(activity: Activity) {
        activityRef = WeakReference(activity)
    }

    fun detachActivity(activity: Activity) {
        if (activityRef?.get() === activity) activityRef = null
    }

    private fun resolveActivity(context: Context): Activity? {
        var cur: Context? = context
        while (cur is ContextWrapper) {
            if (cur is Activity) return cur
            cur = cur.baseContext
        }
        return activityRef?.get()
    }

    /** طباعةٌ عبر خدمة الطباعة في أندرويد — تتطلّب Activity صريحًا كي لا يرمي PrintHelper استثناءً. */
    fun printViaSystem(context: Context, bitmap: Bitmap, jobName: String): Boolean {
        val activity = resolveActivity(context) ?: return false
        val helper = PrintHelper(activity)
        helper.scaleMode = PrintHelper.SCALE_MODE_FIT
        helper.printBitmap(jobName, bitmap)
        return true
    }

    /** مشاركةُ الفاتورة كصورةٍ PNG عبر أيّ تطبيقٍ (واتساب، بريد…). */
    fun shareImage(context: Context, bitmap: Bitmap, fileName: String): Boolean {
        return try {
            val safeName = fileName.replace(Regex("[^A-Za-z0-9._-]"), "_")
            val dir = File(context.cacheDir, "share").apply { mkdirs() }
            val file = File(dir, safeName)
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
