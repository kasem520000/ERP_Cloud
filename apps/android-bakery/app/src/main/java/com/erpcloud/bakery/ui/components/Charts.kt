package com.erpcloud.bakery.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.erpcloud.bakery.ui.theme.BakeryColors
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * رسمٌ بيانيٌّ عموديٌّ مصغَّر (بلا مكتباتٍ خارجيّة — Canvas خالص):
 * الأعمدةُ من اليمين إلى اليسار (أحدثُ يومٍ أقصى اليمين)، والقيمُ نصوصٌ فوق
 * الأعمدة، والتسمياتُ أيّامَ الأسبوع تحتها — كما لوحة الويب.
 */
@Composable
fun MiniBarChart(
    points: List<Pair<String, Float>>,
    modifier: Modifier = Modifier,
    barColor: Color = MaterialTheme.colorScheme.primary,
    formatValue: (Float) -> String = { String.format(Locale.US, "%.0f", it) },
) {
    val textMeasurer = rememberTextMeasurer()
    val labelStyle = TextStyle(fontSize = 10.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    val valueStyle = TextStyle(fontSize = 10.sp, fontWeight = FontWeight.Bold, color = barColor)
    val trackColor = MaterialTheme.colorScheme.surfaceVariant

    Column(modifier) {
        Canvas(Modifier.fillMaxWidth().height(150.dp)) {
            if (points.isEmpty()) return@Canvas
            val maxValue = points.maxOf { it.second }.coerceAtLeast(0.0001f)
            val labelH = 16.dp.toPx()
            val valueH = 14.dp.toPx()
            val chartH = size.height - labelH - valueH - 4.dp.toPx()
            val gap = 6.dp.toPx()
            val barW = ((size.width - gap * (points.size + 1)) / points.size).coerceAtMost(46.dp.toPx())

            // من اليمين: أولُ نقطةٍ (الأقدم) أقصى اليسار — نرسمُ بالعكس.
            val totalW = barW * points.size + gap * (points.size - 1)
            var xRight = size.width

            // خطُّ قاعدةٍ خفيف.
            drawLine(
                color = trackColor,
                start = Offset(0f, chartH + 2.dp.toPx()),
                end = Offset(size.width, chartH + 2.dp.toPx()),
                strokeWidth = 2f,
            )

            for (index in points.indices) {
                val (label, value) = points[index]
                val h = (value / maxValue) * chartH
                val topLeft = Offset(xRight - barW, chartH - h + 2.dp.toPx())
                drawRoundRect(
                    color = barColor,
                    topLeft = topLeft,
                    size = Size(barW, h.coerceAtLeast(2f)),
                    cornerRadius = CornerRadius(6f, 6f),
                )
                // القيمةُ فوق العمود
                val valueText = textMeasurer.measure(formatValue(value), valueStyle)
                drawText(
                    valueText,
                    topLeft = Offset(
                        xRight - barW + (barW - valueText.size.width) / 2f,
                        (chartH - h - valueH + 6.dp.toPx()).coerceAtLeast(0f),
                    ),
                )
                // التسميةُ تحته
                val labelText = textMeasurer.measure(label, labelStyle)
                drawText(
                    labelText,
                    topLeft = Offset(
                        xRight - barW + (barW - labelText.size.width) / 2f,
                        chartH + 8.dp.toPx(),
                    ),
                )
                xRight -= barW + gap
            }
            // توسيطٌ افتراضيّ: totalW قد يقلّ عن العرض والبقاءُ من اليمين مقصود.
            if (totalW < 0f) { /* لا شيء — العرضُ محسوبٌ دائمًا */ }
        }
    }
}

/**
 * شريطُ حصّةٍ أفقيٌّ — سطرٌ واحدٌ بتسميةٍ وقيمةٍ وشريطٍ ملوّنٍ بنسبةِ الحصّة.
 * يُستعملُ لتوزيعِ الإيراد حسب طريقة الدفع ونحوه.
 */
@Composable
fun ShareBarRow(
    label: String,
    valueText: String,
    fraction: Float,
    color: Color = BakeryColors.Primary,
) {
    val track = MaterialTheme.colorScheme.surfaceVariant
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                label,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            Spacer(Modifier.width(8.dp))
            Text(
                valueText,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                color = color,
            )
        }
        Spacer(Modifier.height(4.dp))
        Canvas(Modifier.fillMaxWidth().height(8.dp)) {
            drawRoundRect(color = track, cornerRadius = CornerRadius(8f, 8f), size = size)
            val w = size.width * fraction.coerceIn(0f, 1f)
            if (w > 0f) {
                // يبدأُ من اليمين (RTL)
                drawRoundRect(
                    color = color,
                    topLeft = Offset(size.width - w, 0f),
                    size = Size(w, size.height),
                    cornerRadius = CornerRadius(8f, 8f),
                )
            }
        }
    }
}

/** تسميةُ اليوم بالعربيّة من تاريخ ISO (yyyy-MM-dd) — «السبت» مثلًا. */
fun dayLabelAr(isoDate: String): String {
    val parsed = runCatching { SimpleDateFormat("yyyy-MM-dd", Locale.US).parse(isoDate) }.getOrNull()
    return if (parsed != null) {
        SimpleDateFormat("EEEE", Locale("ar")).format(parsed)
    } else {
        isoDate
    }
}
