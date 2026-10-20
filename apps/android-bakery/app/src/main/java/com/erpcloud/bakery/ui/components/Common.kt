package com.erpcloud.bakery.ui.components

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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.WarningAmber
import androidx.compose.material3.Checkbox
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
import com.erpcloud.bakery.ui.theme.BakeryColors
import com.erpcloud.bakery.ui.theme.ShapeCard

/** إشعارٌ عابر — نتيجةُ إجراءٍ أو خطأ. */
data class Notice(
    val kind: Kind,
    val text: String,
    /** مُعرِّفٌ متزايد — يُميّز رسالتين متطابقتين فتلتقطهما الحركةُ العائمة. */
    val id: Long = nextId(),
) {
    enum class Kind { OK, WARN, DANGER }

    companion object {
        private val ids = java.util.concurrent.atomic.AtomicLong(0)
        private fun nextId(): Long = ids.incrementAndGet()

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
        shape = ShapeCard,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, BakeryColors.Hairline),
    ) {
        Column(Modifier.padding(16.dp)) {
            if (title != null) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onBackground,
                )
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
        ChipTone.OK -> BakeryColors.OkBg to BakeryColors.Ok
        ChipTone.WARN -> BakeryColors.WarnBg to BakeryColors.Warn
        ChipTone.DANGER -> BakeryColors.DangerBg to BakeryColors.Danger
        ChipTone.INFO -> BakeryColors.InfoBg to BakeryColors.Info
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Surface(color = bg, shape = RoundedCornerShape(50)) {
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
        ChipTone.OK -> BakeryColors.Ok
        ChipTone.WARN -> BakeryColors.Warn
        ChipTone.DANGER -> BakeryColors.Danger
        ChipTone.INFO -> BakeryColors.Info
        ChipTone.NEUTRAL -> MaterialTheme.colorScheme.primary
    }
    Card(
        modifier = modifier.fillMaxWidth(),
        shape = RoundedCornerShape(22.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, BakeryColors.Hairline),
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
        shape = RoundedCornerShape(50),
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
        modifier = modifier.fillMaxWidth().padding(vertical = 20.dp, horizontal = 8.dp),
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
    )
}

/**
 * لافتةُ الإشعار — رسائلُ الخادم وأخطاؤه كما يجبُ أن تُرى:
 * بطاقةٌ عائمةٌ بحوافٍ ١٨ وأيقونةٍ دائريّةٍ تقودُ العينَ ولونِ الحالة من
 * لوحة v3 (أخضرُ نجاحٍ / كهرمانُ تحذيرٍ / أحمرُ خطرٍ)، لا شريطٌ خامٌ
 * يلتصقُ بأعلى الشاشة.
 */
@Composable
fun NoticeBanner(notice: Notice?, onDismiss: () -> Unit, modifier: Modifier = Modifier) {
    if (notice == null) return
    val (bg, fg, icon) = when (notice.kind) {
        Notice.Kind.OK -> Triple(BakeryColors.OkBg, BakeryColors.Ok, Icons.Filled.CheckCircle)
        Notice.Kind.WARN -> Triple(BakeryColors.WarnBg, BakeryColors.Warn, Icons.Filled.WarningAmber)
        Notice.Kind.DANGER -> Triple(BakeryColors.DangerBg, BakeryColors.Danger, Icons.Filled.ErrorOutline)
    }
    Surface(
        color = bg,
        shape = RoundedCornerShape(18.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, fg.copy(alpha = 0.25f)),
        modifier = modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp),
    ) {
        Row(
            Modifier.padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Surface(
                color = fg.copy(alpha = 0.12f),
                shape = CircleShape,
                modifier = Modifier.size(34.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = fg, modifier = Modifier.size(20.dp))
                }
            }
            Spacer(Modifier.width(10.dp))
            Text(
                notice.text,
                color = fg,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDismiss) {
                Icon(Icons.Filled.Close, contentDescription = "إغلاق", tint = fg, modifier = Modifier.size(18.dp))
            }
        }
    }
}


/**
 * تنبيهُ الصلاحية المفقودة — **لا يُخفى الزرُّ بصمتًا أبدًا**: حين لا يملك دورُ
 * المستخدم إذنَ العملية، تُعرض هذه اللافتةُ مكانَ الزرّ، باسمِ الصلاحيةِ
 * **بالعربية**، فيعرفُ المستخدمُ أنّ الشاشةَ موجودةٌ والعمليةَ ممكنةٌ وأنّ
 * النقصَ في دورِه لا في التطبيق.
 */
@Composable
fun MissingPermissionHint(actionAr: String, permissionCode: String, modifier: Modifier = Modifier) {
    Surface(
        color = BakeryColors.WarnBg,
        shape = RoundedCornerShape(14.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, BakeryColors.Warn.copy(alpha = 0.25f)),
        modifier = modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 4.dp),
    ) {
        Text(
            "🔒 «$actionAr» متاحٌ لمن يحملُ صلاحية «${com.erpcloud.bakery.ui.screens.Labels.permission(permissionCode)}» — " +
                "دورُك الحاليُّ لا يملكُها. عدِّلها من شاشةِ الأدوار والصلاحيّات.",
            color = BakeryColors.Warn,
            style = MaterialTheme.typography.bodySmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center,
            modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
        )
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

/** نافذةُ انتقاءٍ متعدّدٍ (أذوناتُ دور، أدوارُ مستخدم، نطاقُ فروع) — toggle مباشر. */
@Composable
fun MultiPickerDialog(
    title: String,
    items: List<PickerItem>,
    selectedIds: Set<String>,
    onToggle: (String) -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title, style = MaterialTheme.typography.titleMedium) },
        text = {
            LazyColumn(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                items(items, key = { it.id }) { item ->
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { onToggle(item.id) }
                            .padding(vertical = 2.dp),
                    ) {
                        Checkbox(
                            checked = item.id in selectedIds,
                            onCheckedChange = { onToggle(item.id) },
                        )
                        Column(Modifier.padding(start = 4.dp)) {
                            Text(item.title, style = MaterialTheme.typography.bodyMedium)
                            item.subtitle?.takeIf { it.isNotBlank() }?.let {
                                Text(
                                    it,
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) { Text("تمّ") }
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
        shape = RoundedCornerShape(16.dp),
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
