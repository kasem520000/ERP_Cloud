package com.erpcloud.bakery.printing

import android.app.Activity
import java.lang.ref.WeakReference

/**
 * مرجعُ النشاطِ الحيّ — «Can print only from an activity»:
 *
 * `PrintHelper.printBitmap` يفتح خدمةَ طباعةِ النظام عبر `Activity.startActivityForResult`
 * فيرفض أيّ سياقٍ ليس نشاطًا (سياقُ التطبيقِ الذي يُرجعه `androidContext()` مثلًا).
 * النشاطُ يُسجَّل في `MainActivity.onCreate` ويُحرَّر تلقائيًّا عند تدميره
 * (WeakReference فلا تسريب)، وكلُّ مساراتِ الطباعةِ تمرّ من هنا.
 */
object ActivityRef {

    @Volatile
    private var ref: WeakReference<Activity>? = null

    /** يُستدعى من `MainActivity.onCreate` — سجِّل النشاطَ الحيّ. */
    fun set(activity: Activity) {
        ref = WeakReference(activity)
    }

    /** يُستدعى من `MainActivity.onDestroy` — أفقِد المرجعَ قبل التسريب. */
    fun clear(activity: Activity) {
        if (ref?.get() === activity) ref = null
    }

    /** النشاطُ المسجَّلُ إن كان حيًّا، أو null. */
    fun get(): Activity? = ref?.get()
}
