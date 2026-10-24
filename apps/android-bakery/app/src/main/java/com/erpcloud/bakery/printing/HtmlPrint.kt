package com.erpcloud.bakery.printing

import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintManager
import android.webkit.WebView
import android.webkit.WebViewClient

/**
 * 🖨️ طباعةُ مستنداتِ الخادمِ الاحترافيّة — HTML جاهزٌ من `GET /reports/print/…`:
 *
 * - **A4**: فواتيرُ المبيعاتِ والمشترياتِ وسنداتُ الخزينةِ وصفحاتُ التقارير —
 *   بأسلوبِ الويبِ الرسميِّ نفسِه (ترويسةٌ وتذييلٌ وتوقيعات).
 * - **ورقٌ صغيرٌ 80mm** (`?paper=small`): إيصالُ الكاشيرِ الحراريّ من نقطةِ البيع.
 * - **QR الزكاة** يأتي داخلَ الصفحةِ من الخادمِ (SVG مضمَّن — بلا شبكة).
 *
 * المسارُ واحدٌ مهما كان الورق: يُحمَّلُ الـHTML في WebView (بلا إظهارٍ على الشاشة)،
 * فإذا اكتملَ التحميلُ يُؤخذُ مهايئُ الطباعةِ منه ويُسلَّمُ لمديرِ طباعةِ أندرويد —
 * فيحترمُ `@page` في CSS (A4 أو 80mm) كما تفعلُ المتصفّحات، وتظهرُ خياراتُ الطباعة
 * أو «حفظ PDF». تحترمُ العمليةُ النشاطَ الحيَّ عبر [ActivityRef] كغيرِها من مساراتِ
 * الطباعةِ في التطبيق.
 */
object HtmlPrint {

    /**
     * طباعةُ صفحةِ HTML عبر خدمةِ الطباعةِ في أندرويد.
     *
     * @param html المستندُ كما أعادهُ الخادمُ (كتلةُ `<html>` كاملة).
     * @param jobName عنوانُ مهمّةِ الطباعةِ كما يظهرُ في نافذةِ الطباعةِ («فاتورة INV-42»).
     */
    fun printViaSystem(context: Context, html: String, jobName: String) {
        val activity: Activity = context as? Activity
            ?: ActivityRef.get()
            ?: throw IllegalStateException(
                "لا تتوفر نافذةُ طباعةٍ الآن — أعد المحاولة من داخل الشاشة.",
            )
        val manager = activity.getSystemService(Context.PRINT_SERVICE) as? PrintManager
            ?: throw IllegalStateException("خدمةُ الطباعةِ غيرُ متاحةٍ على هذا الجهاز.")

        val webView = WebView(activity)
        webView.settings.javaScriptEnabled = false
        // عرضُ الشاشةِ قياسًا أوّليًّا للرسم؛ مهايئُ الطباعةِ يعيدُ التخطيطَ على مقاسِ
        // الورقةِ (A4 أو 80mm) من CSS `@page` بنفسه.
        val metrics = activity.resources.displayMetrics
        webView.layout(0, 0, metrics.widthPixels, metrics.heightPixels)

        var printed = false
        webView.webViewClient = object : WebViewClient() {
            override fun onPageFinished(view: WebView, url: String) {
                if (printed) return
                printed = true
                val adapter = SelfDestructingAdapter(
                    wrapped = view.createPrintDocumentAdapter(jobName),
                    view = view,
                )
                manager.print(jobName, adapter, PrintAttributes.Builder().build())
            }
        }
        webView.loadDataWithBaseURL(null, html, "text/html", "utf-8", null)
    }

    /**
     * مهايئٌ يفكُّ كلَّ النداءاتِ إلى مهايئِ WebView ويُدمِّرُ الأخيرَ عند انتهاءِ
     * مهمّةِ الطباعةِ (إنجازًا أو إلغاءً) فلا يتسرّبُ عرضُ ويبٍ بسياقِ النشاط.
     */
    private class SelfDestructingAdapter(
        private val wrapped: PrintDocumentAdapter,
        private val view: WebView,
    ) : PrintDocumentAdapter() {

        override fun onLayout(
            oldAttributes: PrintAttributes?,
            newAttributes: PrintAttributes?,
            cancellationSignal: CancellationSignal?,
            callback: LayoutResultCallback?,
            extras: Bundle?,
        ) {
            wrapped.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras)
        }

        override fun onWrite(
            pages: Array<out PageRange>,
            destination: ParcelFileDescriptor,
            cancellationSignal: CancellationSignal?,
            callback: WriteResultCallback,
        ) {
            wrapped.onWrite(pages, destination, cancellationSignal, callback)
        }

        override fun onFinish() {
            wrapped.onFinish()
            view.post { view.destroy() }
        }
    }

    /** اسمُ ملفٍّ صالحٌ لمهمّةِ الطباعةِ (بلا محارفَ ترفضُها بعضُ خدماتِ الطباعة). */
    fun safeJobName(raw: String): String = raw.trim().ifBlank { "مستند" }.take(60)
}
