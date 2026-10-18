package com.erpcloud.rep.ui.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp

/** إشعارٌ عابر — نتيجةُ إجراءٍ أو خطأ. */
data class Notice(
    val kind: Kind,
    val text: String,
) {
    enum class Kind { OK, WARN, DANGER }

    companion object {
        fun ok(text: String) = Notice(Kind.OK, text)
        fun warn(text: String) = Notice(Kind.WARN, text)
        fun danger(text: String) = Notice(Kind.DANGER, text)
    }
}

/** بطاقةُ قسمٍ بعنوان. */
@Composable
fun SectionCard(
    title: String?,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(14.dp)) {
            if (title != null) {
                Text(title, style = MaterialTheme.typography.titleMedium)
            }
            if (subtitle != null) {
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (title != null || subtitle != null) Spacer(Modifier.height(8.dp))
            content()
        }
    }
}

/** سطرُ مفتاح/قيمة. */
@Composable
fun KeyValue(label: String, value: String, modifier: Modifier = Modifier) {
    Row(
        modifier = modifier.fillMaxWidth().padding(vertical = 2.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            value,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.End,
        )
    }
}

/** شريحةُ حالةٍ ملوّنة. */
@Composable
fun StatusChip(text: String, tone: ChipTone = ChipTone.NEUTRAL) {
    val (bg, fg) = when (tone) {
        ChipTone.OK -> Color(0xFFDCFCE7) to Color(0xFF14532D)
        ChipTone.WARN -> Color(0xFFFEF3C7) to Color(0xFF78350F)
        ChipTone.DANGER -> Color(0xFFFEE2E2) to Color(0xFF7F1D1D)
        ChipTone.INFO -> Color(0xFFDBEAFE) to Color(0xFF1E3A8A)
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(color = bg, shape = RoundedCornerShape(8.dp)) {
        Text(
            text,
            color = fg,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        )
    }
}

enum class ChipTone { OK, WARN, DANGER, INFO, NEUTRAL }

/**
 * بطاقةُ إحصائيّةٍ للرأس — قيمةٌ كبيرة وخطٌّ ثانويّ ولونُ نغمة. الرقمُ دائمًا من
 * الخادم (نصًّا) — البطاقةُ تعرضُه ولا تحسبُه.
 */
@Composable
fun StatTile(
    label: String,
    value: String,
    modifier: Modifier = Modifier,
    sub: String? = null,
    icon: ImageVector? = null,
    tone: ChipTone = ChipTone.NEUTRAL,
) {
    val valueColor = when (tone) {
        ChipTone.OK -> Color(0xFF14532D)
        ChipTone.WARN -> Color(0xFF78350F)
        ChipTone.DANGER -> Color(0xFF7F1D1D)
        ChipTone.INFO -> Color(0xFF1E3A8A)
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.onSurface
    }
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(14.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
    ) {
        Column(Modifier.padding(12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (icon != null) {
                    Icon(
                        icon,
                        contentDescription = null,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(18.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                }
                Text(
                    label,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(6.dp))
            Text(
                value,
                style = MaterialTheme.typography.headlineSmall,
                fontWeight = FontWeight.Bold,
                color = valueColor,
            )
            if (!sub.isNullOrBlank()) {
                Text(
                    sub,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

/** شارةُ عدّادٍ صغيرة (غيرُ المقروء من الإشعارات، عددُ نيّات الطابور…). */
@Composable
fun BadgeCount(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    Surface(
        color = MaterialTheme.colorScheme.error,
        shape = RoundedCornerShape(10.dp),
        modifier = modifier,
    ) {
        Text(
            if (count > 99) "٩٩+" else formatArabicDigits(count),
            color = MaterialTheme.colorScheme.onError,
            style = MaterialTheme.typography.labelSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 5.dp, vertical = 1.dp),
        )
    }
}

/** أرقامٌ عربيّة-هندية للعرض — كلمةُ العدّاد في واجهةٍ عربيّة. */
private fun formatArabicDigits(value: Int): String =
    value.toString().map { char ->
        if (char in '0'..'9') ('٠' + (char - '0')) else char
    }.joinToString("")

/** حالةٌ فارغة. */
@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier.fillMaxWidth().padding(vertical = 12.dp),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}

/** شريطُ الإشعار العلوميّ. */
@Composable
fun NoticeBanner(notice: Notice?, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    if (notice == null) return
    val bg = when (notice.kind) {
        Notice.Kind.OK -> Color(0xFFDCFCE7)
        Notice.Kind.WARN -> Color(0xFFFEF3C7)
        Notice.Kind.DANGER -> Color(0xFFFEE2E2)
    }
    val fg = when (notice.kind) {
        Notice.Kind.OK -> Color(0xFF14532D)
        Notice.Kind.WARN -> Color(0xFF78350F)
        Notice.Kind.DANGER -> Color(0xFF7F1D1D)
    }
    Surface(color = bg, modifier = modifier.fillMaxWidth()) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                notice.text,
                color = fg,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) { Text("إغلاق", color = fg) }
        }
    }
}

/** عنصرُ اختيارٍ في نافذةِ الانتقاء. */
data class PickerItem(
    val id: String,
    val title: String,
    val subtitle: String? = null,
    val trailing: String? = null,
)

/** نافذةُ انتقاءٍ من قائمة (أمرُ تحميل، عميل، فاتورة…). */
@Composable
fun PickerDialog(
    title: String,
    items: List<PickerItem>,
    onDismiss: () -> Unit,
    onSelect: (PickerItem) -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("إلغاء") }
        },
        title = { Text(title) },
        text = {
            if (items.isEmpty()) {
                Text("لا عناصرَ متاحة.")
            } else {
                LazyColumn(
                    modifier = Modifier.height(360.dp),
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    items(items, key = { it.id }) { item ->
                        Surface(
                            shape = RoundedCornerShape(10.dp),
                            color = MaterialTheme.colorScheme.surfaceVariant,
                            onClick = { onSelect(item); onDismiss() },
                        ) {
                            Row(
                                Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 8.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(item.title, style = MaterialTheme.typography.bodyLarge, fontWeight = FontWeight.SemiBold)
                                    if (item.subtitle != null) {
                                        Text(
                                            item.subtitle,
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                                if (item.trailing != null) {
                                    Spacer(Modifier.width(8.dp))
                                    Text(item.trailing, style = MaterialTheme.typography.bodyMedium)
                                }
                            }
                        }
                    }
                }
            }
        },
    )
}

/** نافذةُ تأكيد. */
@Composable
fun ConfirmDialog(
    title: String,
    message: String,
    confirmLabel: String = "تأكيد",
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = onConfirm) { Text(confirmLabel) }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) { Text("رجوع") }
        },
        title = { Text(title) },
        text = { Text(message) },
    )
}

/** زرُّ إجراءٍ كبير. */
@Composable
fun ActionButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    androidx.compose.material3.Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.height(52.dp),
        shape = RoundedCornerShape(12.dp),
    ) {
        if (loading) {
            CircularProgressIndicator(
                modifier = Modifier.size(20.dp),
                strokeWidth = 2.dp,
                color = MaterialTheme.colorScheme.onPrimary,
            )
            Spacer(Modifier.width(8.dp))
        } else if (icon != null) {
            Icon(icon, contentDescription = null, modifier = Modifier.size(20.dp))
            Spacer(Modifier.width(8.dp))
        }
        Text(label)
    }
}

/** مؤشّرُ تحميلٍ وسطيّ. */
@Composable
fun CenterLoading(text: String? = null, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier.fillMaxWidth().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator()
        if (text != null) {
            Spacer(Modifier.height(10.dp))
            Text(text, style = MaterialTheme.typography.bodyMedium)
        }
    }
}
