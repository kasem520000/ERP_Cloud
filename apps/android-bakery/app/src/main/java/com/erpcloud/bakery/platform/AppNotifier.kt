package com.erpcloud.bakery.platform

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.erpcloud.bakery.R

/**
 * إشعاراتُ النظام المحليّة — قناتان: الطابورُ والتوريد. تُطلب أثناء التشغيل على
 * أندرويد ١٣+ (من مساحة العمل)، ولا تُرسل إلا بإذنٍ: إشعارٌ بلا إذنٍ ضجيجٌ لا قيمة له.
 */
object AppNotifier {

    const val CHANNEL_QUEUE = "bakery_queue"
    const val CHANNEL_RECEIPTS = "bakery_receipts"

    fun ensureChannels(context: Context) {
        if (Build.VERSION.SDK_INT < 26) return
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
            ?: return
        val channels = listOf(
            NotificationChannel(
                CHANNEL_QUEUE,
                "الطابورُ دون اتصال",
                NotificationManager.IMPORTANCE_DEFAULT,
            ).apply { description = "حالةُ نيّاتك المحفوظة عند عودة الشبكة" },
            NotificationChannel(
                CHANNEL_RECEIPTS,
                "التوريدُ والاستلام",
                NotificationManager.IMPORTANCE_HIGH,
            ).apply { description = "توريدٌ بانتظار تأكيد استلامك" },
        )
        channels.forEach { manager.createNotificationChannel(it) }
    }

    fun canNotify(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED

    fun notify(context: Context, channel: String, id: Int, title: String, text: String) {
        if (!canNotify(context)) return
        val notification = NotificationCompat.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(context).notify(id, notification)
        } catch (_: SecurityException) {
            // سُحب الإذنُ بين الفحص والإرسال — لا يكسر التطبيق.
        }
    }
}
